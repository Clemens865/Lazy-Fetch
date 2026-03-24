# Claude Agent SDK

## Overview & Philosophy

The Claude Agent SDK (formerly "Claude Code SDK", renamed ~early 2026) is Anthropic's official toolkit for building autonomous AI agents powered by Claude. The core philosophy: **give developers the same agentic loop that powers Claude Code, but as a programmable library**.

The SDK embeds Claude Code's full execution engine -- tool use, permission management, context window handling, session persistence, and multi-turn orchestration -- into a Python or TypeScript package. Rather than requiring developers to implement tool loops, manage context windows, or handle permission flows, the SDK handles all of this autonomously. Developers focus on *what* the agent should do (prompt, tool access, constraints) rather than *how* the loop runs.

**Key philosophical tenets:**
- **Agent = Claude + Tools + Loop**: An agent is not just an LLM call; it is an autonomous loop where Claude evaluates, calls tools, receives results, and repeats until done.
- **Built-in tools by default**: Agents ship with Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch out of the box -- no tool implementation required.
- **Permission-first design**: Every tool call passes through a layered permission system (hooks -> deny rules -> permission mode -> allow rules -> canUseTool callback).
- **Session continuity**: Conversations persist to disk and can be resumed, forked, or continued across process restarts.
- **Subagents for isolation**: Complex tasks are decomposed via subagents that run in isolated context windows and return summarized results.

**Repositories:**
- Python SDK: `github.com/anthropics/claude-code-sdk-python` (package: `claude-agent-sdk`)
- TypeScript SDK: `github.com/anthropics/claude-agent-sdk-typescript` (package: `@anthropic-ai/claude-agent-sdk`)
- Demo agents: `github.com/anthropics/claude-agent-sdk-demos`
- Docs: `platform.claude.com/docs/en/agent-sdk/overview`

**Latest versions (as of March 2026):**
- Python: `pip install claude-agent-sdk` (bundles Claude Code CLI automatically)
- TypeScript: v0.2.81, `npm install @anthropic-ai/claude-agent-sdk`

---

## Architecture

### The Agent Loop

The SDK runs the same agentic loop as Claude Code CLI:

```
Prompt -> Claude Evaluates -> Tool Calls? --YES--> Execute Tools -> Feed Results Back -> Repeat
                                          --NO---> Return Final Result
```

Each full cycle (Claude responds with tool calls, SDK executes them, results feed back) is one **turn**. The loop continues until Claude produces a text-only response with no tool calls, or until a limit (max_turns, max_budget_usd) is reached.

### Message Types

Five core message types flow through the loop:

| Type | Purpose |
|------|---------|
| `SystemMessage` | Session lifecycle (init, compact_boundary) |
| `AssistantMessage` | Claude's response each turn (text + tool calls) |
| `UserMessage` | Tool results fed back to Claude |
| `StreamEvent` | Partial streaming events (text deltas, tool input chunks) |
| `ResultMessage` | Final message with result text, cost, usage, session_id |

### Two API Surfaces

1. **`query()`** -- Stateless, one-shot async generator. Fire prompt, iterate messages, done. Ideal for CI/CD, batch processing, scripts.
2. **`ClaudeSDKClient`** -- Stateful, bidirectional client. Supports multi-turn conversations, interrupts, dynamic permission/model changes, MCP server management. Ideal for chat UIs, interactive apps.

### Context Window Management

- Context accumulates across turns (system prompt + tool definitions + conversation history)
- CLAUDE.md and tool definitions are prompt-cached (reduced cost for repeated prefixes)
- **Automatic compaction**: When context approaches limits, older history is summarized. A `compact_boundary` SystemMessage fires. Persistent rules belong in CLAUDE.md (re-injected every request), not in the initial prompt.
- **Manual compaction**: Send `/compact` as a prompt to trigger on demand.
- **PreCompact hook**: Archive full transcript before summarization.

### Session Persistence

Sessions are stored as JSONL files at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Three operations:

- **Continue**: Resume most recent session in CWD (no ID needed)
- **Resume**: Resume a specific session by ID
- **Fork**: Create a new session branching from an existing one's history (original unchanged)

### Authentication

- Anthropic API key (primary)
- Amazon Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`)
- Google Vertex AI (`CLAUDE_CODE_USE_VERTEX=1`)
- Microsoft Azure AI Foundry (`CLAUDE_CODE_USE_FOUNDRY=1`)

---

## Key Patterns

### [agent][orchestration] Subagent Delegation

Define specialized subagents that run in isolated context windows. The parent delegates via the `Agent` tool; only the subagent's final message returns to the parent context.

```python
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

async for message in query(
    prompt="Review the auth module for security issues",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Grep", "Glob", "Agent"],
        agents={
            "code-reviewer": AgentDefinition(
                description="Expert code reviewer for quality and security.",
                prompt="Analyze code quality and suggest improvements.",
                tools=["Read", "Glob", "Grep"],  # Read-only
                model="sonnet",  # Can override model per subagent
            ),
            "test-runner": AgentDefinition(
                description="Runs and analyzes test suites.",
                prompt="Run tests and provide analysis.",
                tools=["Bash", "Read", "Grep"],
            ),
        },
    ),
):
    pass
```

Key properties:
- Subagents **cannot** spawn their own subagents (no `Agent` in subagent tools)
- Subagents can be **resumed** by capturing their `agentId` from tool results
- Subagent transcripts persist independently and survive main conversation compaction
- Claude auto-delegates based on `description` field, or you explicitly name the agent in the prompt
- Dynamic agent factories allow runtime configuration (e.g., security level -> model choice)

### [hook] Lifecycle Hooks

Python callbacks that fire at specific points in the agent loop. Hooks run in-process (not in the agent's context window).

**Available hooks:**
- `PreToolUse` -- Block, allow, or modify tool inputs before execution
- `PostToolUse` -- Audit, log, or inject context after tool results
- `PostToolUseFailure` -- Handle tool errors
- `UserPromptSubmit` -- Inject context at prompt submission
- `Stop` -- Validate results, save state before exit
- `SubagentStart` / `SubagentStop` -- Track parallel agent activity
- `PreCompact` -- Archive before context summarization
- `PermissionRequest` -- Custom permission handling
- `Notification` -- Forward status updates to external services
- `SessionStart` / `SessionEnd` (TypeScript only)

Hook pattern with matchers:

```python
from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

options = ClaudeAgentOptions(
    hooks={
        "PreToolUse": [
            HookMatcher(matcher="Write|Edit", hooks=[protect_env_files]),
            HookMatcher(matcher="^mcp__", hooks=[mcp_audit_hook]),
            HookMatcher(hooks=[global_logger]),  # No matcher = all tools
        ],
        "PostToolUse": [
            HookMatcher(matcher="Bash", hooks=[stop_on_critical_error]),
        ],
    }
)
```

Hook output controls:
- `permissionDecision: "allow" | "deny"` -- Gate tool execution
- `updatedInput` -- Modify tool input (e.g., redirect file paths to sandbox)
- `systemMessage` -- Inject guidance into conversation
- `continue_: False` + `stopReason` -- Halt agent execution
- `async_: True` -- Fire-and-forget for logging/webhooks (non-blocking)

### [mcp] In-Process SDK MCP Servers

Define MCP tools as Python functions that run in the same process -- no subprocess management, no IPC overhead.

```python
from claude_agent_sdk import tool, create_sdk_mcp_server

@tool("greet", "Greet a user", {"name": str})
async def greet_user(args):
    return {"content": [{"type": "text", "text": f"Hello, {args['name']}!"}]}

server = create_sdk_mcp_server(name="my-tools", version="1.0.0", tools=[greet_user])

options = ClaudeAgentOptions(
    mcp_servers={"tools": server},
    allowed_tools=["mcp__tools__greet"],
)
```

MCP tool naming convention: `mcp__<server-name>__<tool-name>`

Supports mixed mode: SDK servers (in-process) + external servers (stdio/SSE/HTTP) together.

### [pattern] Permission Evaluation Chain

Five-step evaluation order for every tool call:

1. **Hooks** (PreToolUse) -- can allow, deny, or pass through
2. **Deny rules** (`disallowed_tools`) -- always enforced, even in bypassPermissions
3. **Permission mode** (default, acceptEdits, bypassPermissions, plan, dontAsk)
4. **Allow rules** (`allowed_tools`) -- auto-approve listed tools
5. **canUseTool callback** -- runtime approval prompt (skipped in dontAsk mode)

Deny always wins: if any hook or rule denies, the tool is blocked regardless of other settings.

### [pattern] Dynamic Permission Mode Changes

Permission mode can be changed mid-session for progressive trust:

```python
async with ClaudeSDKClient(options=options) as client:
    await client.query("Help me understand this codebase")  # Read-only phase
    await client.set_permission_mode('acceptEdits')           # Now allow edits
    await client.query("Implement the fix we discussed")
```

### [session] Session Resume and Fork

```python
# Capture session ID
async for message in query(prompt="Analyze auth module", options=opts):
    if isinstance(message, ResultMessage):
        session_id = message.session_id

# Resume with full context
async for message in query(
    prompt="Now implement the refactoring",
    options=ClaudeAgentOptions(resume=session_id),
):
    pass

# Fork to explore alternative
async for message in query(
    prompt="Try OAuth2 instead",
    options=ClaudeAgentOptions(resume=session_id, fork_session=True),
):
    pass  # Original session unchanged
```

### [sandbox] Sandboxed Execution

The SDK includes sandbox configuration for controlling file and network access:

```python
SandboxSettings(
    enabled=True,
    autoAllowBashIfSandboxed=True,
    excludedCommands=["rm -rf /"],
    network=SandboxNetworkConfig(
        allowUnixSockets=["/tmp/socket"],
        allowLocalBinding=True,
    ),
    ignoreViolations=SandboxIgnoreViolations(
        file=["*.log"],
        network=["localhost:*"],
    ),
)
```

### [skill] Skills and Slash Commands

When `setting_sources=["project"]` is set, the SDK loads:
- `.claude/skills/SKILL.md` -- Specialized capabilities defined in Markdown
- `.claude/commands/*.md` -- Custom slash commands
- `CLAUDE.md` / `.claude/CLAUDE.md` -- Project context and persistent instructions

### [memory] CLAUDE.md as Persistent Memory

CLAUDE.md files serve as the project memory layer. They are re-injected into every request (prompt-cached), survive compaction, and provide persistent instructions across sessions. This is the canonical place for coding standards, architecture decisions, and agent behavioral rules.

### [pattern] Effort-Based Reasoning Control

```python
options = ClaudeAgentOptions(
    effort="low",   # File lookups, listing -- minimal reasoning
    effort="medium", # Routine edits -- balanced
    effort="high",  # Refactors, debugging -- thorough
    effort="max",   # Complex multi-step problems -- maximum depth
)
```

### [pattern] File Checkpointing and Rewind

```python
options = ClaudeAgentOptions(
    enable_file_checkpointing=True,
    extra_args={"replay-user-messages": None},
)

async with ClaudeSDKClient(options) as client:
    await client.query("Make changes to files")
    # ... capture checkpoint_id from UserMessage.uuid ...
    await client.rewind_files(checkpoint_id)  # Revert file changes
```

### [pattern] Interrupt and Model Switching

```python
async with ClaudeSDKClient(options) as client:
    await client.query("Start a long analysis")
    await client.interrupt()  # Cancel current work
    await client.set_model('claude-sonnet-4-5')  # Switch to faster model
    await client.query("Quick summary instead")
```

### [orchestration] Result Subtypes for Robust Error Handling

```python
if isinstance(message, ResultMessage):
    match message.subtype:
        case "success":
            print(message.result)
        case "error_max_turns":
            # Resume with higher limit
            query(prompt="Continue", options=ClaudeAgentOptions(resume=message.session_id, max_turns=60))
        case "error_max_budget_usd":
            print("Budget exhausted")
        case "error_during_execution":
            print("API or runtime error")
```

---

## Strengths

1. **Zero tool implementation burden**: Built-in tools (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch) work immediately. No need to implement file I/O, command execution, or search.

2. **Production-grade permission system**: The 5-step permission evaluation chain with hooks, deny/allow rules, permission modes, and runtime callbacks is the most sophisticated permission model in any agent SDK. Deny rules cannot be overridden even by bypassPermissions.

3. **Session persistence and forking**: First-class session management with resume, continue, and fork. Sessions are JSONL files that can be moved between machines. `ClaudeSDKClient` handles session IDs automatically.

4. **Subagent architecture**: Context isolation via subagents is elegant -- each subagent gets a fresh context window, only its final message returns to the parent. Subagent transcripts persist independently and survive parent compaction.

5. **Hook system**: Comprehensive lifecycle hooks with regex matchers, permission decisions, input mutation, system message injection, execution halting, and async fire-and-forget mode. Hooks run in-process (not consuming context).

6. **In-process MCP servers**: The `@tool` decorator + `create_sdk_mcp_server()` pattern eliminates subprocess overhead for custom tools while maintaining MCP protocol compatibility.

7. **Automatic context management**: Prompt caching for repeated prefixes, automatic compaction when nearing limits, and customizable compaction behavior via CLAUDE.md instructions.

8. **Multi-cloud authentication**: Native support for Anthropic API, AWS Bedrock, Google Vertex AI, and Azure AI Foundry.

9. **Effort-level control**: Fine-grained reasoning depth (low/medium/high/max) trades off latency and cost against reasoning quality per-request.

10. **CLI bundled with SDK**: The Python package bundles the Claude Code CLI -- no separate installation step.

---

## Weaknesses

1. **Claude-only**: Tightly coupled to Anthropic's Claude models. Cannot use with OpenAI, Gemini, or open-source models. The SDK literally wraps the Claude Code CLI binary.

2. **CLI-as-runtime dependency**: The SDK is fundamentally a wrapper around the Claude Code CLI process. The Python SDK spawns/communicates with the CLI binary. This adds deployment complexity (platform-specific binaries) and constrains the architecture.

3. **TypeScript SDK lags in documentation**: The TypeScript repo README is nearly empty -- just an npm install command and links. Most documentation is in the Python examples. The TS SDK is labeled "Shell 100%" language on GitHub, suggesting it is mostly CLI wrapper scripts.

4. **No cross-language subagent communication**: Subagents cannot spawn their own subagents (single level only). No direct inter-agent messaging -- all coordination goes through the parent.

5. **Limited session portability**: Sessions are local JSONL files tied to the machine's `~/.claude/projects/<encoded-cwd>/` path. Cross-host resume requires manually copying files and matching paths.

6. **Python SDK async-only**: All APIs are async. No synchronous interface for simple scripting use cases. Cannot use a `ClaudeSDKClient` across different async runtime contexts.

7. **No structured output validation**: While there is an `error_max_structured_output_retries` result subtype, the structured output / JSON schema enforcement capabilities are not prominently documented.

8. **Hook parity gap**: `SessionStart` and `SessionEnd` hooks are TypeScript-only. Python lacks these as SDK callbacks (only available via shell command hooks in settings files).

9. **No built-in agent-to-agent orchestration**: Unlike frameworks that support multi-agent topologies (mesh, hierarchical, etc.), the SDK only supports parent -> subagent delegation (tree structure).

10. **Cost opacity during execution**: While `ResultMessage` reports final cost, there is no per-turn cost reporting during execution. Budget limits trigger after the fact rather than providing real-time feedback.

---

## Unique Ideas Worth Extracting

1. **[pattern] Permission Evaluation Chain**: The 5-step layered permission system (hooks -> deny -> mode -> allow -> callback) is the gold standard for agent safety. The principle that deny rules always win, regardless of permission mode, prevents accidental override. Worth adopting in any agent framework.

2. **[pattern] In-Process MCP via Decorator**: The `@tool` decorator that creates MCP-compatible tools running in-process (no subprocess) is brilliant. It gives you MCP protocol compatibility without MCP overhead. The mixed-mode support (SDK + external servers) is also elegant.

3. **[session] Session Forking**: The ability to fork a session to explore alternative approaches without modifying the original is a unique concept. This enables A/B testing of agent approaches, recovery from mistakes, and branching exploration.

4. **[hook] Input Mutation via Hooks**: PreToolUse hooks that return `updatedInput` to transparently modify tool inputs (e.g., redirecting all file writes to a sandbox directory) is a powerful sandboxing primitive that separates policy from mechanism.

5. **[orchestration] Context Isolation via Subagents**: Using subagents primarily for context management (not just parallelism) is a key insight. Intermediate tool calls stay inside the subagent; only the final summary returns. This prevents context window bloat from exploratory work.

6. **[memory] CLAUDE.md as Compaction-Resistant Memory**: Instructions in CLAUDE.md survive compaction because they are re-injected on every request. This creates a two-tier memory system: ephemeral (conversation history, subject to compaction) and persistent (CLAUDE.md, always present).

7. **[pattern] Progressive Permission Escalation**: The ability to change permission mode mid-session (`set_permission_mode()`) enables a trust-building pattern: start read-only, escalate to edit permissions after reviewing the agent's analysis. This is more nuanced than static permission assignment.

8. **[pattern] Effort-Based Resource Control**: The `effort` parameter (low/medium/high/max) is orthogonal to extended thinking and provides a simple knob for cost/quality tradeoffs without changing the prompt or model.

9. **[hook] Async Fire-and-Forget Hooks**: Hooks that return `{async_: True}` tell the agent to continue immediately without waiting. This cleanly separates observability (logging, webhooks) from control flow (approval, blocking).

10. **[agent] File Checkpointing + Rewind**: The `rewind_files()` method that reverts the filesystem to a specific checkpoint is a unique undo capability. Combined with session forking, it enables true branching exploration where both conversation and filesystem can diverge and reconverge.

---

## Code Examples

### Minimal Agent (One-Shot)

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

async def main():
    async for message in query(
        prompt="Find and fix the bug in auth.py",
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Edit", "Bash"],
            max_turns=30,
            max_budget_usd=1.00,
            effort="high",
        ),
    ):
        if hasattr(message, "result"):
            print(message.result)

asyncio.run(main())
```

### Multi-Turn Interactive Client

```python
import asyncio
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, AssistantMessage, TextBlock, ResultMessage

async def main():
    options = ClaudeAgentOptions(
        allowed_tools=["Read", "Edit", "Glob", "Grep"],
    )

    async with ClaudeSDKClient(options=options) as client:
        # Turn 1: Analysis
        await client.query("Analyze the auth module")
        async for msg in client.receive_response():
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock):
                        print(block.text)

        # Turn 2: Action (same session, full context)
        await client.set_permission_mode('acceptEdits')
        await client.query("Now refactor it to use JWT")
        async for msg in client.receive_response():
            if isinstance(msg, ResultMessage):
                print(f"Cost: ${msg.total_cost_usd:.4f}")

asyncio.run(main())
```

### Custom In-Process MCP Tool

```python
from claude_agent_sdk import tool, create_sdk_mcp_server, ClaudeAgentOptions, ClaudeSDKClient

@tool("search_docs", "Search documentation database", {"query": str, "limit": int})
async def search_docs(args):
    results = my_db.search(args["query"], limit=args.get("limit", 5))
    return {"content": [{"type": "text", "text": format_results(results)}]}

server = create_sdk_mcp_server(name="docs", version="1.0.0", tools=[search_docs])

options = ClaudeAgentOptions(
    mcp_servers={
        "docs": server,  # In-process
        "playwright": {"command": "npx", "args": ["@playwright/mcp@latest"]},  # External
    },
    allowed_tools=["mcp__docs__search_docs", "mcp__playwright__browser_navigate"],
)
```

### Hook: Sandbox File Writes

```python
async def redirect_to_sandbox(input_data, tool_use_id, context):
    if input_data["tool_name"] == "Write":
        original_path = input_data["tool_input"].get("file_path", "")
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
                "updatedInput": {
                    **input_data["tool_input"],
                    "file_path": f"/sandbox{original_path}",
                },
            }
        }
    return {}

options = ClaudeAgentOptions(
    hooks={"PreToolUse": [HookMatcher(matcher="Write", hooks=[redirect_to_sandbox])]}
)
```

### Multi-Agent Review Pipeline

```python
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

async for message in query(
    prompt="Do a comprehensive review: check code quality, run tests, and scan for security issues",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Grep", "Glob", "Bash", "Agent"],
        agents={
            "style-checker": AgentDefinition(
                description="Code style and quality reviewer",
                prompt="Check code style, naming conventions, and best practices.",
                tools=["Read", "Grep", "Glob"],
                model="sonnet",
            ),
            "security-scanner": AgentDefinition(
                description="Security vulnerability scanner",
                prompt="Identify security vulnerabilities, injection risks, auth issues.",
                tools=["Read", "Grep", "Glob"],
                model="opus",
            ),
            "test-runner": AgentDefinition(
                description="Test execution and coverage analysis",
                prompt="Run tests, analyze failures, check coverage.",
                tools=["Bash", "Read", "Grep"],
                model="sonnet",
            ),
        },
    ),
):
    if hasattr(message, "result"):
        print(message.result)
```

### Session Fork for A/B Exploration

```python
# Initial analysis
session_id = None
async for msg in query(prompt="Analyze the auth module", options=opts):
    if isinstance(msg, ResultMessage):
        session_id = msg.session_id

# Fork A: JWT approach
async for msg in query(
    prompt="Implement JWT authentication",
    options=ClaudeAgentOptions(resume=session_id, fork_session=True),
):
    if isinstance(msg, ResultMessage):
        fork_a_id = msg.session_id

# Fork B: OAuth2 approach (from same original)
async for msg in query(
    prompt="Implement OAuth2 authentication",
    options=ClaudeAgentOptions(resume=session_id, fork_session=True),
):
    if isinstance(msg, ResultMessage):
        fork_b_id = msg.session_id

# Original session_id is unchanged -- can still resume it
```

### TypeScript Equivalent (One-Shot)

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Find and fix the bug in auth.py",
  options: {
    allowedTools: ["Read", "Edit", "Bash"],
    maxTurns: 30,
    effort: "high",
    agents: {
      "code-reviewer": {
        description: "Expert code reviewer",
        prompt: "Review code for quality and security.",
        tools: ["Read", "Glob", "Grep"],
      }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

### Error Handling

```python
from claude_agent_sdk import (
    ClaudeSDKError,
    CLINotFoundError,
    CLIConnectionError,
    ProcessError,
    CLIJSONDecodeError,
)

try:
    async for message in query(prompt="Hello"):
        pass
except CLINotFoundError:
    print("Claude Code CLI not found")
except ProcessError as e:
    print(f"Process failed: exit code {e.exit_code}")
except CLIJSONDecodeError:
    print("Failed to parse CLI response")
except ClaudeSDKError:
    print("General SDK error")
```
