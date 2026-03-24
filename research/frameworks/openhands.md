# OpenHands (formerly OpenDevin)

## Overview & Philosophy

OpenHands is an open-source AI-driven software development platform that provides autonomous coding agents with full access to a sandboxed development environment. The core philosophy is that AI agents should operate like human developers: with a real shell, a real browser, a real file system, and real development tools -- not through constrained APIs or config-driven abstractions.

Key motivations:
- **Full autonomy**: Agents can run any bash command, edit files, browse the web, and execute Python -- just like a developer at a terminal.
- **Safety through isolation**: All agent actions execute inside a Docker sandbox, preventing damage to the host system.
- **Composable SDK**: The agentic core is extracted into a standalone Python SDK (`software-agent-sdk`) that can be used independently of the GUI/server, enabling programmatic orchestration and scaling to thousands of agents.
- **Multiple interfaces**: CLI (comparable to Claude Code/Codex), local GUI (comparable to Devin/Jules), cloud-hosted SaaS, and enterprise self-hosted options.
- **Model-agnostic**: Powered by LiteLLM, supporting Claude, GPT, Gemini, open-source models, and any OpenAI-compatible endpoint.

The project holds a **77.6% score on SWE-Bench**, making it one of the highest-performing open-source agent frameworks for real-world software engineering tasks.

**Important architecture note**: The codebase is currently transitioning from V0 (monolithic, in `openhands/` directory) to V1 (modular SDK in `software-agent-sdk` + new app server in `openhands/app_server/`). The V0 code is marked as legacy and scheduled for removal by April 2026. This analysis covers both, with emphasis on the architectural patterns that persist.

## Architecture

### High-Level Components

```
User (CLI / GUI / API)
       |
  [App Server] -- REST API + WebSocket
       |
  [AgentController] -- orchestration loop, state machine
       |           \
  [EventStream]     [Agent (e.g. CodeActAgent)]
       |                    |
  [Runtime]            [LLM via LiteLLM]
  (Docker/Remote/Local/K8s)
       |
  [Action Execution Server] -- runs INSIDE the sandbox
       |
  [bash, browser, jupyter, file system, MCP tools]
```

### The Event Stream (Central Nervous System)

The `EventStream` is the backbone of the entire system. It is a persistent, append-only log of all events (actions + observations) in a conversation. Every component communicates through it:

- **Events** are typed dataclasses with `id`, `timestamp`, `source` (AGENT/USER/ENVIRONMENT), optional `cause` (linking observation to action), and optional `tool_call_metadata`.
- **Actions** (agent intents): `CmdRunAction`, `FileEditAction`, `BrowseURLAction`, `IPythonRunCellAction`, `AgentDelegateAction`, `AgentFinishAction`, `MCPAction`, `MessageAction`, `RecallAction`, `CondensationAction`, etc.
- **Observations** (environment responses): `CmdOutputObservation`, `FileReadObservation`, `ErrorObservation`, `AgentDelegateObservation`, `BrowserOutputObservation`, etc.
- **Subscribers**: Components register as named subscribers (`AGENT_CONTROLLER`, `RUNTIME`, `SERVER`, `MEMORY`, `MAIN`) with callbacks. Each subscriber gets its own thread pool for async processing.
- **Persistence**: Events are serialized to JSON and stored via a pluggable `FileStore` (local filesystem, S3, GCS). Secret values are automatically scrubbed before persistence.

### The Agent Controller (Orchestration Loop)

The `AgentController` is the main loop that drives the agent:

1. Receives events from the EventStream via subscription
2. Manages agent state machine: `INIT -> RUNNING -> AWAITING_USER_INPUT / FINISHED / ERROR / STOPPED`
3. Calls `agent.step(state)` to get the next action
4. Publishes actions back to the EventStream
5. Handles **agent delegation**: when an agent emits `AgentDelegateAction`, a child `AgentController` is spawned with a different agent type
6. Enforces budget limits (max iterations, max cost per task)
7. Integrates `StuckDetector` to detect and break infinite loops
8. Manages `confirmation_mode` where human approval is required for certain actions

### The Sandboxed Runtime

The runtime is the execution environment where agent actions are carried out. Multiple implementations exist:

- **DockerRuntime**: Spins up a Docker container per session. Inside the container, an `ActionExecutionServer` (FastAPI app) listens for action requests over HTTP. The host-side `ActionExecutionClient` sends actions to this server.
- **RemoteRuntime**: Connects to a remote execution server (for cloud deployments).
- **LocalRuntime**: Runs directly on the host (development only).
- **KubernetesRuntime**: Kubernetes pod-based execution.
- **CLIRuntime**: Lightweight runtime for CLI usage.

The Docker sandbox includes:
- A full Linux environment with bash
- Jupyter/IPython for Python execution
- A browser environment (Playwright-based) for web interaction
- VSCode server (optional, for interactive mode)
- File upload/download capabilities
- MCP proxy for tool integration
- Memory monitoring for resource limits

### Memory & Condensation System

The memory system handles context window management:

- **ConversationMemory**: Builds the LLM message list from the event stream, filtering irrelevant events
- **Condenser**: Abstract strategy for compressing history when context limits are reached. Implementations include:
  - `NoOpCondenser` -- pass-through, no compression
  - `RecentEventsCondenser` -- keep only the N most recent events
  - `ConversationWindowCondenser` -- sliding window approach
  - `LLMSummarizingCondenser` -- uses LLM to summarize older chunks
  - `LLMAttentionCondenser` -- attention-based selection of important events
  - `AmortizedForgettingCondenser` -- gradual forgetting of older events
  - `ObservationMaskingCondenser` -- masks verbose observation content
  - `BrowserOutputCondenser` -- specifically compresses browser output
  - `StructuredSummaryCondenser` -- structured summaries of event chunks
  - `Pipeline` -- chains multiple condensers together

The condenser can request condensation proactively (via `CondensationRequestAction` from the agent), and the result is stored as metadata in the `State` for introspection.

## Key Patterns

### [agent][pattern] CodeAct: Unified Code Action Space
The flagship agent pattern. Instead of separate tool-calling mechanisms, the agent can execute arbitrary bash commands and Python code as its primary action space. This collapses the traditional "tool selection" problem into "write code that does the thing." Based on the research paper (arxiv.org/abs/2402.01030). The agent uses function calling under the hood to structure its tool use (bash, file edit, browser, IPython, think, finish).

### [sandbox][pattern] In-Container Action Execution Server
The `ActionExecutionServer` is a FastAPI app that runs INSIDE the Docker container. The host sends action requests via HTTP to this server. This is a critical design choice: it means the sandbox has a clean HTTP API boundary, and the host never needs to exec into the container or mount shared volumes for communication. The server handles bash sessions, file operations, browser control, Jupyter execution, and MCP tool proxying.

### [orchestration][pattern] Event-Driven Architecture with Typed Event Stream
All communication flows through a single append-only event stream. Events are typed (Action or Observation), have sources (AGENT, USER, ENVIRONMENT), carry timestamps and IDs, and are persisted. Subscribers register callbacks. This pattern enables: replay, debugging, auditing, and decoupled components.

### [agent][pattern] Agent Delegation (Hierarchical Agents)
An agent can emit `AgentDelegateAction(agent="BrowsingAgent", inputs={...})` to spawn a child agent with a different specialization. The parent `AgentController` creates a child controller, runs it to completion, and returns the result as an `AgentDelegateObservation`. This enables hierarchical task decomposition -- e.g., CodeActAgent delegates web research to BrowsingAgent.

### [memory][pattern] Pluggable Condenser Pipeline
The condenser system is fully pluggable with a registry pattern. Different strategies can be composed into a pipeline. The agent can even REQUEST condensation (`CondensationRequestAction`) when it senses the context is getting too long. Condensation metadata is stored for debugging.

### [agent][pattern] Stuck Detection and Loop Breaking
The `StuckDetector` analyzes the last N actions/observations for repetitive patterns (same action repeated 3-4 times, syntax errors in a loop, identical command outputs). When detected, it triggers a `LoopDetectionObservation` and can inject `LoopRecoveryAction` to break the agent out. It distinguishes between headless mode (full history) and interactive mode (only post-last-user-message history).

### [skill][pattern] Microagents (Domain-Specific Knowledge Injection)
Microagents are markdown files with optional YAML frontmatter that inject domain-specific knowledge into the agent's context. Two types:
- **Public microagents** (in `microagents/`): Available to all users, covering topics like GitHub, Docker, Kubernetes, SSH, npm, security best practices.
- **Repository microagents** (in `.openhands/microagents/`): Project-specific knowledge.
- **Trigger-based loading**: Microagents with `triggers` in frontmatter are only loaded when the user message matches keywords, keeping context lean.
- **Third-party compatibility**: Automatically reads `.cursorrules` and `agents.md` files from repos.

### [sandbox][pattern] Plugin System for Runtime Capabilities
Plugins extend the sandbox with additional capabilities:
- `JupyterRequirement` -- IPython/Jupyter kernel for Python execution
- `AgentSkillsRequirement` -- Pre-loaded Python utility functions
- `VSCodeRequirement` -- VSCode server for interactive editing
Plugins are injected into the container at runtime startup.

### [mcp][pattern] MCP Integration (Bidirectional)
OpenHands supports MCP (Model Context Protocol) both as a client (connecting to external MCP servers for tools) and as a server (exposing its own capabilities via MCP). The `MCPProxyManager` runs inside the sandbox, allowing the agent to use MCP tools within the sandboxed environment. MCP servers can be configured per-user.

### [hook][pattern] Security Analyzer Pipeline
A security analysis layer (`openhands/security/`) can intercept actions before execution. Options include invariant checking and LLM-based security assessment (e.g., GraySwan). Actions can be tagged with `ActionSecurityRisk` levels, and `confirmation_mode` can require human approval for risky actions.

### [pattern] Secrets Management via EventStream Scrubbing
The EventStream automatically replaces secret values with placeholders before persisting events. Secrets are registered on the stream and scrubbed from all serialized data. The sandbox gets secrets via environment variables and a secure settings API (`X-Session-API-Key` header validation).

### [orchestration][pattern] State Machine with Budget Control
The agent controller maintains a formal state machine (`AgentState` enum) and enforces both iteration limits and cost budgets. The `ConversationStats` tracks token usage, costs, and iteration counts. When limits are exceeded, the agent is gracefully stopped.

## Strengths

1. **Production-grade sandbox isolation**: The Docker-based sandbox with HTTP API boundary is one of the most robust approaches to agent safety. The in-container action execution server is elegant -- clean separation of concerns without complex IPC.

2. **Event stream as single source of truth**: Everything is an event, everything is persisted, everything is replayable. This makes debugging, auditing, and testing straightforward. The event stream also naturally enables features like conversation resumption.

3. **SWE-Bench leader**: 77.6% on SWE-Bench validates that the architecture actually works for real-world software engineering tasks.

4. **Condenser pipeline is sophisticated**: The variety of condensation strategies (10+ implementations) and ability to pipeline them shows deep understanding of the context window management problem.

5. **Multi-agent delegation**: Clean hierarchical delegation where CodeActAgent can hand off to BrowsingAgent or other specialists.

6. **Microagent knowledge injection**: Elegant solution for domain-specific knowledge that keeps the core agent generic while allowing per-project and per-domain customization.

7. **SDK extraction**: Moving the agentic core to a standalone SDK (`software-agent-sdk`) is forward-thinking -- enables programmatic orchestration at scale without the GUI overhead.

8. **Model agnostic**: LiteLLM integration means any model works, with per-model feature flags (function calling support, reasoning effort, cache prompting, stop words).

9. **Multiple deployment modes**: Docker, Kubernetes, remote, local, CLI, GUI, cloud -- covers virtually every use case.

10. **Active open-source community**: MIT licensed (except enterprise directory), Slack community, strong contribution guidelines.

## Weaknesses

1. **V0/V1 transition creates confusion**: The codebase currently has two parallel architectures. The V0 code (most of what we analyzed) is marked "LEGACY" and scheduled for removal. The V1 SDK lives in a separate repo. This makes it hard to understand the "real" current architecture.

2. **Docker dependency is heavy**: Requiring Docker for the sandbox is a significant barrier to entry. The local runtime exists but is explicitly marked as development-only. This limits adoption in environments where Docker is not available (some CI systems, serverless, restricted environments).

3. **Single-agent-at-a-time within a session**: While delegation exists, it's hierarchical (parent waits for child). There's no true parallel multi-agent execution within a single session -- no swarm or mesh coordination.

4. **Context window management complexity**: The 10+ condenser implementations suggest the problem is not fully solved. The agent can request condensation, but the decision of when and how to condense is still heuristic.

5. **Stuck detection is pattern-matching**: The `StuckDetector` uses hardcoded patterns (3-4 repeated actions, specific syntax error messages). This is fragile and may not catch all loop types or may false-positive on legitimate repetition.

6. **Enterprise features are source-available but license-restricted**: The enterprise directory (auth, billing, integrations) uses a 30-day trial license, creating a split between the open-source and commercial versions.

7. **Browser interaction is limited**: The browsing agent exists but is separate from the main CodeAct agent and requires delegation. Browser tasks add latency and complexity.

8. **No persistent long-term memory across sessions**: The memory/condenser system is within-session only. There's a `Memory` class and `RecallAction` for retrieval, but cross-session knowledge accumulation appears limited.

## Unique Ideas Worth Extracting

### 1. In-Container HTTP Action Server
Running a FastAPI server inside the Docker sandbox rather than using docker exec or shared volumes. This creates a clean API boundary, enables proper error handling, supports concurrent operations, and makes the sandbox interface testable independently.

### 2. Event Stream as Universal Bus
Using a single persistent event stream for all communication (agent<->runtime, agent<->user, agent<->server, memory tracking) with typed events, subscriber pattern, and automatic secret scrubbing. This is more principled than most frameworks which use ad-hoc message passing.

### 3. Condenser Pipeline with Agent-Initiated Condensation
Letting the agent itself request condensation when it detects context pressure, rather than only having the framework make that decision. The `CondensationRequestAction` is a tool the agent can call.

### 4. Microagent Trigger System
Loading specialized knowledge only when keywords in the user message match frontmatter triggers. This keeps base context lean while providing rich domain knowledge on demand. Compatibility with `.cursorrules` is a nice touch for adoption.

### 5. Stuck Detection as First-Class Concern
Building loop detection directly into the controller rather than leaving it to the agent. The separation of headless vs. interactive mode detection is thoughtful.

### 6. Agent Type Registry with Delegation
The `agenthub` pattern where different agent types (CodeAct, Browsing, ReadOnly, LOC, VisualBrowsing) are registered and can be dynamically delegated to. Each agent type has its own tools, prompts, and capabilities.

### 7. Runtime as Pluggable Extension Point
The abstract `Runtime` base class with multiple implementations (Docker, Remote, K8s, Local, CLI) makes the execution environment completely swappable without changing agent logic.

### 8. Replay/Trajectory System
The ability to save and replay full interaction trajectories (`save_trajectory_path`, `replay_trajectory_path`) is valuable for debugging, benchmarking, and training.

## Code Examples

### Event Stream Usage Pattern
```python
# Creating and subscribing to an event stream
event_stream = EventStream(sid="session-123", file_store=file_store)

# Subscribe a component
event_stream.subscribe(
    EventStreamSubscriber.AGENT_CONTROLLER,
    callback=self.on_event,
    callback_id=self.id
)

# Publish an action
event_stream.add_event(
    CmdRunAction(command="ls -la /workspace"),
    source=EventSource.AGENT
)

# Events are automatically:
# - Assigned monotonic IDs
# - Timestamped
# - Secret-scrubbed
# - Persisted to FileStore
# - Dispatched to all subscribers
```

### Agent Delegation Pattern
```python
@dataclass
class AgentDelegateAction(Action):
    agent: str          # e.g., "BrowsingAgent"
    inputs: dict        # task-specific parameters
    thought: str = ''
    action: str = ActionType.DELEGATE

# In AgentController, when this action is received:
# 1. A child AgentController is spawned with the specified agent type
# 2. The child runs to completion
# 3. Result comes back as AgentDelegateObservation
```

### Docker Runtime Initialization
```python
class DockerRuntime(ActionExecutionClient):
    """
    Subscribes to EventStream.
    On receiving an action event, sends HTTP request to
    ActionExecutionServer running inside the Docker container.
    """
    def __init__(self, config, event_stream, ...):
        # Build or pull the runtime Docker image
        self.runtime_container_image = config.sandbox.runtime_container_image
        # Start container with ActionExecutionServer
        self.container = docker_client.containers.run(
            image=self.runtime_container_image,
            name=f"openhands-runtime-{sid}",
            # Port mapping for HTTP communication
            ports={f"{container_port}/tcp": host_port},
            ...
        )
        # API endpoint for sending actions
        self.api_url = f"http://localhost:{host_port}"
```

### Condenser Configuration (TOML)
```toml
[core]
default_agent = "CodeActAgent"
runtime = "docker"
max_iterations = 500

[llm]
model = "anthropic/claude-sonnet-4-20250514"

[agent.CodeActAgent]
# Condenser strategy
condenser = "llm_summarizing"

# Or use a pipeline of condensers:
# condenser = "pipeline"
# [agent.CodeActAgent.condenser_config]
# condensers = ["observation_masking", "browser_output", "recent_events"]
```

### Microagent Definition
```markdown
---
triggers:
- docker
- dockerfile
- container
---
# Docker Best Practices

When working with Docker:
1. Always use multi-stage builds for production images
2. Pin base image versions (don't use :latest)
3. Use .dockerignore to exclude unnecessary files
4. Run as non-root user in production
...
```

### Stuck Detection Pattern
```python
class StuckDetector:
    def is_stuck(self, headless_mode=True) -> bool:
        # In interactive mode: only check history after last user message
        # In headless mode: check full history

        # Detect: same action repeated 3-4 times
        # Detect: syntax error loops
        # Detect: identical command outputs

        # Returns True if pattern detected
        # AgentController then injects LoopRecoveryAction
```

### Action Execution Server (runs INSIDE Docker sandbox)
```python
# This FastAPI app runs inside the container
app = FastAPI()

@app.post("/execute_action")
async def execute_action(request: ActionRequest):
    action = event_from_dict(request.action)

    if isinstance(action, CmdRunAction):
        obs = await bash_session.execute(action.command)
    elif isinstance(action, FileEditAction):
        obs = await editor.edit(action)
    elif isinstance(action, BrowseURLAction):
        obs = await browser.browse(action.url)
    elif isinstance(action, IPythonRunCellAction):
        obs = await jupyter.execute(action.code)
    elif isinstance(action, MCPAction):
        obs = await mcp_proxy.execute(action)

    return event_to_dict(obs)
```
