# OpenAI Agents SDK & Codex

## Overview & Philosophy

OpenAI provides two complementary agentic systems:

1. **OpenAI Agents SDK** (`openai-agents-python`) -- a lightweight, provider-agnostic Python framework for building multi-agent workflows. It focuses on composition through primitives rather than heavy abstractions: agents, tools, handoffs, guardrails, sessions, and tracing. The SDK supports OpenAI Responses API, Chat Completions API, and 100+ LLMs via LiteLLM integration. The philosophy is "minimal surface area, maximum composability" -- you define agents as data structures (instructions + tools + handoffs + guardrails), then run them through a single `Runner` that manages the agentic loop.

2. **Codex CLI** (`openai/codex`) -- a terminal-native coding agent that combines chat-driven development with sandboxed command execution. Originally written in TypeScript, now rewritten in Rust for zero-dependency native installation. The philosophy is "chat-driven development that understands and executes your repo" -- it reads, writes, and runs code in a sandboxed environment with configurable autonomy levels (suggest, auto-edit, full-auto).

The unifying design principle across both: **agents are LLMs + instructions + tools**, handoffs enable delegation, and safety comes from guardrails and sandboxing rather than restricting capabilities.

## Architecture

### Agents SDK Architecture

The core loop (`Runner.run()` in `src/agents/run.py`) works as follows:

1. **Agent Resolution**: Start with the initial agent. Each iteration of the turn loop uses the current agent.
2. **Session History**: If a `Session` is provided, retrieve conversation history and merge with new input via `session_input_callback`.
3. **Input Guardrails**: Run input guardrails (parallel or blocking, depending on config). If a tripwire triggers, halt immediately with `InputGuardrailTripwireTriggered`.
4. **Model Call**: Send the agent's instructions + input items + tool definitions to the model. The agent's tools, handoffs-as-tools, and MCP server tools are all unified into a single tool list.
5. **Response Processing**: Parse the model response:
   - **Tool calls**: Execute function tools (with tool guardrails), hosted tools (web search, file search, code interpreter), or MCP tools. Results fed back as input for next turn.
   - **Handoff**: If a handoff tool is called, invoke the handoff's `on_invoke_handoff`, apply input filters, switch the current agent, and continue the loop.
   - **Final output**: If the model produces a final text/structured output, run output guardrails and return.
6. **Turn Limit**: If `max_turns` is exceeded, raise `MaxTurnsExceeded`.
7. **Session Persistence**: After the run, save new items to the session.
8. **Tracing**: The entire run is wrapped in a trace, with nested spans for agents, generations, tool calls, guardrails, and handoffs.

Key architectural components:

- **`Agent`** (dataclass): instructions, tools, handoffs, guardrails, hooks, model settings, output schema
- **`Runner`**: static methods `run()`, `run_sync()`, `run_streamed()` -- the only entry point
- **`RunConfig`**: per-run configuration (model override, guardrails, tracing, session settings, handoff filters)
- **`RunContextWrapper`**: typed context shared across the entire run, accessible by tools and guardrails
- **`Handoff`**: a tool representation that switches the active agent
- **`Session`** (protocol): pluggable conversation memory (SQLite, OpenAI Conversations, Redis, custom)
- **Tracing** (spans + traces): hierarchical, context-var-based, with pluggable processors

### Codex CLI Architecture

Codex is organized as a Cargo workspace:

- **`codex-rs/core/`** -- business logic library. Contains the agent loop, sandboxing, MCP client/server, memory system, exec policy, tool execution, and model integration.
- **`codex-rs/tui/`** -- terminal UI built with Ratatui.
- **`codex-rs/exec/`** -- headless CLI for CI/automation (`codex exec PROMPT`).
- **`codex-rs/cli/`** -- multitool that unifies subcommands.

The Codex agent loop:
1. Load project context from `AGENTS.md` files (global, repo root, cwd).
2. Accept user prompt.
3. Call OpenAI model with conversation history + available tools (shell execution, file read/write, apply-patch).
4. When the model wants to execute a command, apply the sandbox policy (Seatbelt on macOS, Landlock on Linux, Windows Sandbox).
5. Based on approval mode, either auto-approve or ask the user.
6. Execute, capture output, feed back to model.
7. Repeat until model indicates completion.

Sandbox modes: `read-only` (default), `workspace-write`, `danger-full-access`. Network is fully blocked in auto modes.

## Key Patterns

### Agent Definition [agent]
Agents are declarative dataclasses combining instructions, tools, handoffs, and guardrails. No subclassing required:
```python
agent = Agent(
    name="Support Agent",
    instructions="You handle customer support.",
    tools=[lookup_order, cancel_order],
    handoffs=[billing_agent, refund_agent],
    input_guardrails=[toxicity_check],
    output_type=SupportResponse,  # Pydantic model for structured output
)
```

### Handoff Pattern [orchestration] [agent]
Handoffs are the primary multi-agent coordination mechanism. They are exposed to the LLM as tools named `transfer_to_{agent_name}`. When the LLM calls the handoff tool, control transfers to the target agent:
- The new agent inherits the conversation history (configurable via `input_filter`)
- Optional `on_handoff` callback for side effects (logging, data fetching)
- Optional `input_type` for LLM-generated metadata (reason, priority)
- Dynamically enable/disable handoffs via `is_enabled` callable
- Per-handoff or global `nest_handoff_history` to collapse prior transcript into a summary

### Agents as Tools [orchestration] [pattern]
Alternative to handoffs: `Agent.as_tool()` wraps a specialist agent as a tool that the manager agent calls. The manager retains control and can combine outputs from multiple specialists. Use for bounded subtasks where the specialist should not own the conversation.

### Guardrails Pipeline [guardrail] [pattern]
Three-level guardrail system:
1. **Input Guardrails** -- run on first agent's input (parallel or blocking)
2. **Output Guardrails** -- run on final agent's output
3. **Tool Guardrails** -- run before/after each function tool call (input + output)

Tool guardrails have three behaviors: `allow`, `reject_content` (continue with error message to model), `raise_exception` (halt execution). All guardrails use the tripwire pattern -- when triggered, execution halts with a typed exception.

### Lifecycle Hooks [hook]
Two hook levels:
- **`RunHooks`** (global): `on_agent_start`, `on_agent_end`, `on_handoff`, `on_tool_start`, `on_tool_end`, `on_llm_start`, `on_llm_end`
- **`AgentHooks`** (per-agent): same events but scoped to a specific agent

Hooks receive typed context and are async. They enable logging, metrics, custom tracing, and side effects without modifying agent logic.

### MCP Integration [mcp] [pattern]
The SDK is both an MCP client and supports hosted MCP tools:
- `MCPServer` base class with `MCPServerStdio`, `MCPServerSSE`, `MCPServerStreamableHTTP` implementations
- Per-server approval policies: `always`, `never`, or per-tool-name mapping
- Tool filtering: static lists or dynamic callables based on context
- MCP tool metadata resolver for custom `_meta` in tool calls
- Codex CLI also functions as both MCP client (connecting to servers) and MCP server (`codex mcp-server`)

### Session / Memory [memory] [pattern]
Pluggable session protocol for conversation persistence:
- `SQLiteSession` -- local file-based storage
- `OpenAIConversationsSession` -- server-managed via OpenAI API
- `OpenAIResponsesCompactionSession` -- with automatic context compaction
- Redis session (optional dependency)
- Custom implementations via `Session` protocol (just implement `get_items`, `add_items`, `pop_item`, `clear_session`)

Codex CLI has its own memory system via `AGENTS.md` files (hierarchical: global -> repo -> cwd) and persistent session rollout files.

### Tracing / Observability [tracing] [pattern]
Context-var-based hierarchical tracing:
- **Trace** wraps an entire workflow run
- **Spans** nest within traces: `AgentSpanData`, `GenerationSpanData`, `FunctionSpanData`, `HandoffSpanData`, `GuardrailSpanData`, `ResponseSpanData`, `CustomSpanData`
- Automatic span creation for all agent operations
- Sensitive data control via `trace_include_sensitive_data` flag
- Pluggable `TracingProcessor` interface with batch export
- Default exports to OpenAI Traces dashboard (free for all users)
- 25+ ecosystem integrations: Weights & Biases, Arize-Phoenix, LangSmith, Langfuse, MLflow, Datadog, etc.

### Sandbox Security [sandbox] [pattern]
Codex CLI's three-tier approval model:
- **Suggest** (default): agent can read files; all writes and commands need approval
- **Auto Edit**: agent can read and apply patches; commands need approval
- **Full Auto**: agent can read, write, and execute -- but all commands run network-disabled and directory-sandboxed

Platform-specific sandboxing:
- macOS: Apple Seatbelt (`sandbox-exec`) with read-only jail + writable roots
- Linux: Landlock LSM or Docker container with iptables firewall
- Windows: Windows Sandbox

### Structured Output [pattern]
Agents can define `output_type` as a Pydantic model, enforcing structured JSON output from the model. Combined with `strict_json_schema=True` (default), this gives reliable typed responses.

### Dynamic Instructions [pattern]
Agent instructions can be:
- Static string
- Callable `(RunContextWrapper, Agent) -> str` for dynamic prompts based on context
- `Prompt` object with configurable sections

### Retry / Error Handling [pattern]
- `ModelRetrySettings` with configurable backoff
- `RetryPolicy` protocol for custom retry logic
- `RunErrorHandlers` for `max_turns` exceeded and other error conditions
- Tool error functions that convert exceptions to model-visible messages

### Skills System [skill]
Both repos use a `.agents/skills/` directory pattern with:
- `SKILL.md` describing the skill
- `agents/openai.yaml` for agent configuration
- `scripts/` for executable skill logic
- `references/` for reference documentation

Codex uses this for internal development (PR review, code verification, test coverage). The pattern is meant for human developers using AI agents, not runtime agent skills.

## Strengths

1. **Minimal, composable API surface**: The entire SDK revolves around `Agent`, `Runner.run()`, `handoff()`, and decorators. No complex inheritance hierarchies or framework lock-in.

2. **First-class handoff system**: The handoff pattern is the cleanest multi-agent routing mechanism in any framework. Handoffs-as-tools means the LLM naturally decides when to delegate, with full control over history filtering and metadata passing.

3. **Three-level guardrail architecture**: Input, output, and tool-level guardrails with both parallel and blocking execution modes. The `reject_content` behavior (continue with error message rather than halt) is particularly practical.

4. **Production-grade tracing**: Built-in, zero-config tracing with hierarchical spans, sensitive data control, and 25+ ecosystem integrations. The OpenAI Traces dashboard provides free visualization.

5. **Provider agnosticism**: Despite being from OpenAI, the SDK supports 100+ LLMs via LiteLLM and has a clean `Model`/`ModelProvider` abstraction.

6. **Codex's sandboxing model**: The three-tier approval system (suggest/auto-edit/full-auto) with OS-level sandboxing (Seatbelt, Landlock) is the gold standard for safe autonomous code execution.

7. **Session protocol simplicity**: Four methods (`get_items`, `add_items`, `pop_item`, `clear_session`) make it trivial to implement custom persistence.

8. **Type safety throughout**: Heavy use of Python generics, Pydantic models, and TypedDict. The `TContext` generic propagates through agents, tools, guardrails, and hooks.

9. **Codex's hierarchical AGENTS.md**: The three-level instruction loading (global -> repo -> cwd) is an elegant pattern for project-specific agent configuration.

## Weaknesses

1. **No built-in planning/reasoning loop**: The SDK provides a turn-based loop but no built-in chain-of-thought planning, goal decomposition, or self-reflection patterns. You must implement these yourself.

2. **Handoff history management is complex**: The `input_filter`, `nest_handoff_history`, `handoff_history_mapper`, and conversation history wrapper system has many interacting options. The nested history feature is still marked as "opt-in beta."

3. **No persistent agent state**: Sessions store conversation history, but there is no built-in mechanism for agents to persist structured state (key-value store, working memory, scratchpad) across turns or runs.

4. **Limited orchestration primitives**: Beyond handoffs and agents-as-tools, there are no built-in patterns for parallel agent execution, DAG-based workflows, or conditional branching. You must use Python primitives (`asyncio.gather`, loops, etc.).

5. **Guardrails are position-dependent**: Input guardrails only run on the first agent; output guardrails only on the last. In complex multi-agent workflows, this means intermediate agent inputs/outputs are unguarded unless you use tool guardrails on every function tool.

6. **Codex is OpenAI-locked for best experience**: While it supports other providers, the sandbox + Responses API + tracing integration is deeply tied to OpenAI infrastructure.

7. **No streaming for handoff input filters**: The docs explicitly note that in streaming mode, items generated before the input filter runs will already have been streamed. This creates potential UX inconsistencies.

8. **Limited code generation tooling**: Unlike Claude Code which has built-in file editing tools, the Agents SDK requires you to build your own tool implementations for code modification.

## Unique Ideas Worth Extracting

### 1. Handoffs-as-Tools Pattern [orchestration]
Representing agent delegation as tool calls is elegant. The LLM decides when to hand off by calling `transfer_to_{agent_name}`, which means routing decisions emerge naturally from the conversation rather than requiring explicit routing logic. The `input_filter` mechanism for controlling what history the receiving agent sees is particularly powerful.

### 2. Parallel vs. Blocking Guardrails [guardrail]
The `run_in_parallel` flag on input guardrails is a novel optimization. Parallel guardrails run concurrently with the agent for minimum latency (the guardrail can halt mid-generation), while blocking guardrails prevent any token consumption before validation passes. This dual-mode approach lets you optimize cost vs. latency per guardrail.

### 3. Tool Guardrails with Three Behaviors [guardrail]
The `allow`/`reject_content`/`raise_exception` trichotomy for tool guardrails is more nuanced than simple pass/fail. `reject_content` is especially useful -- it blocks the tool but continues execution with a message to the model, letting it self-correct rather than crashing the entire run.

### 4. Nested Handoff History [memory] [orchestration]
The `nest_handoff_history` system collapses prior conversation into `<CONVERSATION HISTORY>` blocks when handing off. This prevents context explosion in multi-handoff chains while preserving information. The flattening/re-parsing logic in `history.py` handles recursive nesting elegantly.

### 5. Context-var-based Tracing Scope [tracing]
Using Python `contextvars` for trace/span scoping means tracing works automatically with async concurrency. No manual span passing or thread-local hacks. Spans auto-nest under the current span, and traces auto-propagate through `Runner.run()` calls.

### 6. AGENTS.md Hierarchical Instructions [memory] [pattern]
Codex's three-level AGENTS.md loading (global `~/.codex/AGENTS.md` -> repo root -> cwd) is a clean pattern for project-specific agent behavior. This could be generalized as a "layered instruction system" for any agent framework.

### 7. Codex Sandbox Policy Architecture [sandbox]
The OS-level sandboxing (Seatbelt profiles on macOS, Landlock on Linux) with writable root configuration is more secure than container-only approaches. The `sandbox_mode` configuration (`read-only`, `workspace-write`, `danger-full-access`) gives users clear security posture choices.

### 8. Session Compaction [memory]
The `OpenAIResponsesCompactionSession` can automatically compact conversation history using the model itself, preventing context window overflow in long-running sessions. The compaction modes (`previous_response_id`, `input`, `auto`) provide flexibility.

### 9. Agents as Tools vs. Handoffs Decision Framework [orchestration]
The SDK explicitly documents when to use each pattern:
- **Agents as tools**: manager retains control, combines outputs, enforces shared guardrails
- **Handoffs**: specialist owns the conversation, prompts stay focused, clean context switch

This decision framework is valuable for any multi-agent system.

### 10. RunConfig Input Filter [pattern]
The `call_model_input_filter` callback in `RunConfig` intercepts input just before the model call, enabling token budget management, system prompt injection, or input transformation without modifying agents.

## Code Examples

### Basic Agent with Handoffs
```python
from agents import Agent, Runner, handoff

billing_agent = Agent(
    name="Billing Agent",
    instructions="You handle billing inquiries.",
    handoff_description="Handles billing and payment questions",
)

refund_agent = Agent(
    name="Refund Agent",
    instructions="You process refund requests.",
)

triage_agent = Agent(
    name="Triage Agent",
    instructions="Route the customer to the right specialist.",
    handoffs=[billing_agent, handoff(refund_agent)],
)

result = Runner.run_sync(triage_agent, "I want a refund for order #123")
print(result.final_output)
```

### Guardrail with Tripwire
```python
from agents import (
    Agent, Runner, GuardrailFunctionOutput, RunContextWrapper,
    TResponseInputItem, input_guardrail, InputGuardrailTripwireTriggered,
)

@input_guardrail
async def toxicity_check(
    ctx: RunContextWrapper[None], agent: Agent, input: str | list[TResponseInputItem]
) -> GuardrailFunctionOutput:
    # Use a cheap model to classify
    result = await Runner.run(
        Agent(name="Checker", instructions="Is this toxic?", output_type=ToxicityResult),
        input, context=ctx.context
    )
    return GuardrailFunctionOutput(
        output_info=result.final_output,
        tripwire_triggered=result.final_output.is_toxic,
    )

agent = Agent(
    name="Assistant",
    input_guardrails=[toxicity_check],
    instructions="Help the user.",
)
```

### Tool Guardrails
```python
from agents import (
    function_tool, tool_input_guardrail, tool_output_guardrail,
    ToolGuardrailFunctionOutput,
)

@tool_input_guardrail
def block_sensitive_input(data):
    if "password" in str(data.context.tool_arguments):
        return ToolGuardrailFunctionOutput.reject_content(
            "Do not pass passwords to this tool."
        )
    return ToolGuardrailFunctionOutput.allow()

@function_tool(tool_input_guardrails=[block_sensitive_input])
def search_database(query: str) -> str:
    """Search the database."""
    return f"Results for: {query}"
```

### Handoff with Input Filter and Metadata
```python
from pydantic import BaseModel
from agents import Agent, handoff, RunContextWrapper, HandoffInputData

class EscalationReason(BaseModel):
    reason: str
    priority: str

async def on_escalate(ctx: RunContextWrapper, data: EscalationReason):
    print(f"Escalating: {data.reason} (priority: {data.priority})")

def remove_tool_calls(data: HandoffInputData) -> HandoffInputData:
    """Strip tool call history from handoff input."""
    filtered = [item for item in data.new_items
                if item.to_input_item().get("type") not in ("function_call", "function_call_output")]
    return data.clone(new_items=tuple(filtered))

escalation_agent = Agent(name="Escalation Agent", instructions="Handle escalated issues.")

escalation_handoff = handoff(
    agent=escalation_agent,
    on_handoff=on_escalate,
    input_type=EscalationReason,
    input_filter=remove_tool_calls,
)
```

### Custom Tracing
```python
from agents import Agent, Runner, trace, custom_span

async def main():
    agent = Agent(name="Researcher", instructions="Research the topic.")

    with trace("Research Workflow", group_id="thread-123"):
        with custom_span("preprocessing", {"query": "AI frameworks"}):
            processed_query = preprocess("AI frameworks")

        result = await Runner.run(agent, processed_query)
        # Both the custom span and the agent run appear in the same trace
```

### Lifecycle Hooks
```python
from agents import Agent, RunHooks, RunContextWrapper, ModelResponse, Tool

class MetricsHooks(RunHooks):
    async def on_agent_start(self, context, agent):
        print(f"Agent started: {agent.name}")

    async def on_tool_end(self, context, agent, tool, result):
        print(f"Tool {tool.name} returned: {result[:100]}")

    async def on_handoff(self, context, from_agent, to_agent):
        print(f"Handoff: {from_agent.name} -> {to_agent.name}")

result = await Runner.run(agent, "hello", hooks=MetricsHooks())
```

### Session Persistence
```python
from agents import Agent, Runner, SQLiteSession

session = SQLiteSession("my_session_id", db_path="./chat.db")
agent = Agent(name="Assistant", instructions="You are helpful.")

# First conversation
result = await Runner.run(agent, "My name is Alice", session=session)

# Later -- agent remembers the name
result = await Runner.run(agent, "What's my name?", session=session)
```

### Codex CLI Configuration (config.toml)
```toml
model = "o4-mini"
approval_mode = "auto-edit"
sandbox_mode = "workspace-write"

[history]
max_size = 1000
save_history = true
```

### Codex AGENTS.md (Project Instructions)
```markdown
# ~/.codex/AGENTS.md (global)
- Always use TypeScript for new files
- Run tests before committing

# repo-root/AGENTS.md (project)
- This project uses pnpm
- Database migrations are in /prisma/migrations

# src/features/AGENTS.md (subdirectory)
- Components in this directory use Zustand for state
```
