# CrewAI

## Overview & Philosophy

CrewAI (47k GitHub stars, 6.4k forks, MIT license) is a Python framework for orchestrating role-playing, autonomous AI agents. The core philosophy is **role-based multi-agent collaboration** -- agents are defined by their role, goal, and backstory, forming "crews" that tackle complex tasks through delegation and specialization.

Key philosophical tenets:
- **Standalone framework**: Built entirely from scratch, independent of LangChain or other agent frameworks (though it can interop with LangChain tools)
- **Two execution paradigms**: "Crews" for autonomous agent collaboration, "Flows" for precise event-driven orchestration
- **YAML-driven configuration**: Agents and tasks are declaratively defined in YAML, with Python code for wiring and logic
- **Production-grade**: Designed for enterprise use with observability, security fingerprinting, guardrails, and a commercial control plane (CrewAI AMP)

The framework targets the sweet spot between full autonomy (agents deciding what to do) and precise control (developers dictating execution paths), letting users combine both via Crews-inside-Flows.

## Architecture

### Core Primitives

**Agent** (`lib/crewai/src/crewai/agent/core.py`):
- Extends `BaseAgent` (Pydantic BaseModel + ABC)
- Defined by: `role`, `goal`, `backstory` (the "persona trifecta")
- Has: `llm`, `tools`, `memory`, `knowledge_sources`, `max_iter`, `max_rpm`
- Supports: delegation (`allow_delegation`), code execution (`allow_code_execution` with Docker sandbox), multimodal input, MCP server connections
- Agent execution is handled by `CrewAgentExecutor` -- a ReAct-style loop with tool calling
- Agents can have `planning_config` for pre-task planning via a separate LLM call
- System/prompt/response templates are fully customizable

**Task** (`lib/crewai/src/crewai/task.py`):
- Defined by: `description`, `expected_output`, `agent` (assigned executor)
- Supports: `context` (list of predecessor Tasks whose output feeds in), `tools` (task-specific tool overrides), `output_json`/`output_pydantic` (structured output), `output_file`, `guardrail` (validation function)
- Has `async_execution` flag for concurrent execution
- `ConditionalTask` subclass: executes only if a `condition(previous_task_output)` returns True
- `human_input` flag: requires human review before proceeding
- `callback`: post-completion hook
- Tasks track `used_tools`, `tools_errors`, `delegations` metrics

**Crew** (`lib/crewai/src/crewai/crew.py`):
- Container for agents + tasks + process type
- Defined by: `agents`, `tasks`, `process` (sequential or hierarchical), `memory`, `cache`, `verbose`
- Has lifecycle hooks: `before_kickoff_callbacks`, `after_kickoff_callbacks`
- Entry point: `crew.kickoff(inputs={...})` -- inputs get interpolated into agent/task YAML templates via `{variable}` syntax
- Supports `kickoff_for_each` for batch processing and `kickoff_async` for async execution
- Has `planning` mode: generates an execution plan before running tasks
- Built-in training and testing modes for evaluating crew performance
- Validates task ordering, async constraints, and conditional task placement at construction time

**Process** (`lib/crewai/src/crewai/process.py`):
```python
class Process(str, Enum):
    sequential = "sequential"
    hierarchical = "hierarchical"
    # TODO: consensual = 'consensual'
```

**Flow** (`lib/crewai/src/crewai/flow/flow.py`):
- Event-driven workflow orchestration layer that sits above Crews
- Typed state management via Pydantic models (`Flow[MarketState]`)
- Decorator-based: `@start()`, `@listen(method)`, `@router(method)`
- Supports logical combinators: `or_()` and `and_()` for complex triggering
- Can embed Crew kickoffs as steps in the flow
- Has persistence layer (SQLite-backed) for flow state
- Supports human-in-the-loop feedback via `HumanFeedback`
- Visualizable: generates interactive HTML flow diagrams

### Process Types

**Sequential Process**:
- Tasks execute in order, each receiving the output of the previous task as context
- Every task must have an assigned agent
- Simple pipeline: Task1 -> Task2 -> Task3

**Hierarchical Process**:
- Requires a `manager_llm` or `manager_agent`
- Manager agent dynamically delegates tasks to worker agents
- Manager validates results and can re-delegate if unsatisfied
- Manager agent is automatically created if only `manager_llm` is provided
- Worker agents don't need to be pre-assigned to tasks

### Delegation System

When `allow_delegation=True` on an agent, it receives two extra tools:
1. **DelegateWorkTool**: Delegates a task to a coworker by role/name with task description and context
2. **AskQuestionTool**: Asks a specific question to a coworker agent

These are injected via `AgentTools` class which builds tool instances with the coworker roster. Delegation is agent-initiated (the agent decides to use the delegation tool during ReAct execution).

### Tool System

- `BaseTool` (abstract, Pydantic BaseModel): requires `name`, `description`, `_run()` method
- `Tool` (generic wrapper): wraps any callable with auto-inferred `args_schema`
- `@tool` decorator: converts a function into a Tool (requires docstring and type annotations)
- Auto-generates JSON schema from function signatures for LLM tool calling
- Supports: `max_usage_count`, `cache_function`, `result_as_answer` (tool output becomes final answer)
- `MCPToolWrapper`: on-demand MCP server connections with server-name prefixed tool names
- Native MCP support via `MCPServerConfig` on agents
- `from_langchain()` converter for LangChain tool interop
- Thread-safe usage counting via `_usage_lock`

### Memory System

**Unified Memory** (`lib/crewai/src/crewai/memory/unified_memory.py`):
- Single `Memory` class with LLM-analyzed storage and intelligent recall
- Works standalone (no agent/crew required)
- Records have: `content`, `scope` (hierarchical path like `/company/team/user`), `categories`, `importance` (0-1), `metadata`, `embedding`, `source`, `private` flag
- **Composite scoring** on recall: `semantic_weight * similarity + recency_weight * decay + importance_weight * importance`
- Recency uses exponential decay with configurable half-life (default 30 days)
- **Consolidation on save**: checks for near-duplicates via cosine similarity, LLM decides merge/update/delete
- **Adaptive recall depth**: RecallFlow router decides between direct results and deeper LLM-driven exploration based on confidence thresholds
- `MemoryScope` and `MemorySlice` for scoped/filtered views
- Pluggable storage backends (LanceDB default)
- Crew-level memory: when `memory=True`, a shared Memory instance is created for all agents

### Knowledge System

- Separate from memory: `Knowledge` class with `BaseKnowledgeSource` sources
- Supports: files, URLs, databases, various document formats
- Embedded via configurable embedder (OpenAI default)
- Crew-level and agent-level knowledge sources
- RAG pipeline with chunkers (text, structured, web) and loaders (CSV, PDF, DOCX, JSON, etc.)

### Event System

- Global `crewai_event_bus` for pub/sub event propagation
- Rich event taxonomy: agent events, crew events, flow events, LLM events, MCP events, knowledge events, memory events
- `EventListener` class for subscribing to events with formatted output
- `TraceCollectionListener` for OpenTelemetry-based tracing
- Events include: `CrewKickoffStartedEvent`, `TaskStartedEvent`, `LLMCallCompletedEvent`, `MemorySaveCompletedEvent`, etc.
- Enables observability integrations (Langfuse, Datadog, Arize Phoenix, etc.)

### Security

- `Fingerprint` system for uniquely identifying agents, tasks, and crews
- `SecurityConfig` on agents, tasks, and crews
- Hallucination guardrail (enterprise feature, open-source has placeholder)

## Key Patterns

### Role-Based Agent Design [agent] [pattern]
Agents are defined by a persona trifecta: `role` (what they do), `goal` (what they optimize for), `backstory` (personality and expertise context). This shapes the system prompt and influences agent behavior without explicit programming.

### YAML + Python Hybrid Configuration [pattern]
Agent roles/goals/backstories and task descriptions live in YAML files with `{variable}` interpolation. Python code handles wiring, tool assignment, and logic. The `@CrewBase` decorator auto-loads YAML configs and provides `self.agents_config` and `self.tasks_config` dicts.

### Decorator-Driven Crew Assembly [pattern]
```python
@CrewBase
class MyCrew:
    @agent
    def researcher(self) -> Agent: ...

    @task
    def research_task(self) -> Task: ...

    @crew
    def crew(self) -> Crew: ...
```
The `@agent` and `@task` decorators auto-collect instances into `self.agents` and `self.tasks` lists.

### Flow-over-Crew Orchestration [orchestration] [pattern]
Flows wrap Crews for production use. A Flow step can kick off an entire Crew, capturing its output as the step result. This separates "what agents do" (Crew) from "when and how things execute" (Flow).

### Event-Driven Routing [orchestration] [hook]
Flow `@router` decorator enables conditional branching based on method return values. Combined with `@listen("route_name")`, this creates dynamic execution paths.

### Conditional Task Execution [pattern]
`ConditionalTask` with a `condition: Callable[[TaskOutput], bool]` allows runtime task graph pruning based on previous task outputs.

### Guardrail Validation [pattern] [hook]
Tasks can have a `guardrail` function that validates output before passing to the next task. If validation fails, the agent retries. Supports both function-based and LLM-based guardrails.

### Delegation as Tool Use [agent] [pattern]
Agent delegation is modeled as tool invocation -- `DelegateWorkTool` and `AskQuestionTool` are regular tools that the agent can choose to use during its ReAct loop. This keeps delegation emergent rather than prescribed.

### MCP Native Integration [mcp] [pattern]
Agents can declare MCP servers via `mcps=[MCPServerConfig(...)]`. Tools are discovered from MCP servers on-demand and wrapped as `MCPToolWrapper` instances with server-name prefixes to avoid naming collisions.

### Unified Memory with LLM Analysis [memory] [pattern]
Memory save path uses LLM to infer scope, categories, and importance. Recall uses adaptive-depth retrieval with composite scoring (semantic + recency + importance). Consolidation prevents duplicates by detecting similar existing memories.

### Hierarchical Scoped Memory [memory] [pattern]
Memory records are organized in hierarchical scopes (e.g., `/company/engineering/backend`). `MemoryScope` and `MemorySlice` provide filtered views. This enables multi-tenant and multi-project memory isolation.

### Code Execution Sandbox [sandbox] [agent]
Agents with `allow_code_execution=True` can run code. `code_execution_mode="safe"` uses Docker containers; `"unsafe"` runs directly. Enables agents to validate their own outputs programmatically.

### Before/After Kickoff Hooks [hook]
```python
Crew(
    before_kickoff_callbacks=[adjust_inputs],
    after_kickoff_callbacks=[post_process],
)
```
Callbacks can modify inputs before execution and process outputs after completion.

### Planning Mode [agent] [pattern]
When `planning=True`, the crew generates a step-by-step execution plan before running tasks. Uses a separate `planning_llm` to create the plan, which is then injected into task contexts.

### Agent-to-Agent Protocol (A2A) [agent] [pattern]
Support for A2A protocol enabling cross-framework agent communication via standardized message passing.

### Training and Testing [pattern]
Built-in `crew.train(n_iterations)` for iterative agent training with human feedback, and `crew.test(n_iterations)` for automated quality evaluation.

## Strengths

1. **Intuitive mental model**: The role/goal/backstory persona system is immediately understandable and maps well to how humans think about team composition. Low barrier to entry.

2. **Two-tier orchestration**: Crews for autonomous collaboration + Flows for deterministic control is a powerful combination. You get agent agency where you want it and precise control where you need it.

3. **Rich YAML configuration**: Separating agent personas and task descriptions into YAML makes it easy to iterate on prompts without touching code. Template interpolation (`{topic}`) keeps things DRY.

4. **Production-ready features**: Guardrails, hallucination detection, security fingerprinting, OpenTelemetry tracing, rate limiting, and extensive observability integrations show enterprise focus.

5. **Sophisticated memory system**: Unified memory with composite scoring (semantic + recency + importance), LLM-analyzed saves, adaptive recall depth, and hierarchical scoping is one of the most advanced memory implementations in the space.

6. **MCP-native**: First-class MCP support with on-demand connections and tool discovery, not bolted on.

7. **Massive ecosystem**: 100k+ certified developers, extensive tool library (50+ built-in tools), multiple observability integrations, enterprise platform.

8. **Conditional and async tasks**: ConditionalTask and async_execution provide runtime flexibility without requiring a full workflow engine.

9. **Delegation as emergent behavior**: Modeling delegation as tool use means agents organically decide when to collaborate, rather than following rigid handoff rules.

## Weaknesses

1. **Python-only**: No JavaScript/TypeScript SDK. All agent logic, tools, and configurations must be in Python.

2. **Process types are limited**: Only sequential and hierarchical. No built-in support for parallel fan-out/fan-in, voting/consensus, or graph-based task dependencies (the "consensual" process is still TODO).

3. **Tight coupling to Pydantic**: Everything is a Pydantic model with extensive validators. While this provides safety, it creates a learning curve and makes runtime modification difficult.

4. **Manager agent is a bottleneck**: In hierarchical mode, all delegation goes through a single manager agent. No support for multi-level hierarchies or peer-to-peer negotiation natively.

5. **Memory requires LLM calls on save**: The automatic scope/category inference adds latency and cost to every memory write. For high-throughput scenarios, this could be prohibitive.

6. **Flow system adds complexity**: While powerful, the Flow layer adds another abstraction that users must learn. The decorator-based approach (`@start`, `@listen`, `@router`) can be confusing for complex graphs.

7. **Telemetry is opt-out**: Anonymous telemetry is enabled by default, which may concern privacy-sensitive users/enterprises.

8. **Enterprise features gated**: Hallucination guardrails, crew studio, and advanced tracing are placeholders in the open-source version, requiring the commercial AMP platform.

9. **No built-in sandbox isolation between agents**: While code execution can use Docker, agents themselves share the same process space. No resource isolation or capability restrictions between agents in a crew.

## Unique Ideas Worth Extracting

1. **Persona Trifecta (role/goal/backstory)**: Simple but effective pattern for agent identity. The backstory especially adds nuance that pure role-based systems miss. Worth adopting as a standard agent configuration pattern.

2. **Crews-inside-Flows Architecture**: The separation between autonomous collaboration (Crew) and deterministic orchestration (Flow) is elegant. A Flow step can kick off an entire multi-agent Crew. This is a powerful composition pattern for production systems.

3. **Delegation-as-Tool-Use**: Rather than having a delegation protocol, agents simply have `DelegateWorkTool` and `AskQuestionTool` in their toolbelt. The agent's ReAct loop naturally decides when to delegate. This makes delegation emergent and avoids complex routing logic.

4. **Composite Memory Scoring**: The `semantic_weight * similarity + recency_weight * decay + importance_weight * importance` formula with configurable weights is a practical approach to memory relevance ranking. The exponential recency decay with configurable half-life is particularly clever.

5. **Memory Consolidation on Save**: Checking for near-duplicates on write and using an LLM to decide merge/update/delete prevents memory bloat. Most systems only deduplicate on read.

6. **Adaptive Recall Depth**: The RecallFlow router that decides between quick vector search and deeper LLM-driven exploration based on confidence thresholds is novel. It balances speed vs. thoroughness automatically.

7. **Conditional Tasks with Runtime Pruning**: `ConditionalTask` that evaluates `condition(previous_output)` before executing is a simple but powerful pattern for dynamic workflows without a full DAG engine.

8. **YAML Template Interpolation**: Using `{variable}` in YAML agent/task configs with runtime `inputs={}` substitution is a clean separation of configuration from parameterization. Enables the same crew definition to handle different topics/domains.

9. **Task Guardrails**: Per-task validation functions that can reject output and force retries. Provides fine-grained quality control at the task boundary.

10. **Flow State Persistence**: SQLite-backed flow state that survives process restarts, enabling long-running workflows with checkpointing.

11. **Before/After Kickoff Callbacks**: Simple hook system for input preprocessing and output postprocessing at the crew level.

## Code Examples

### Basic Crew with Sequential Process
```python
from crewai import Agent, Task, Crew, Process

researcher = Agent(
    role="Senior Researcher",
    goal="Find the most relevant information about {topic}",
    backstory="You're an expert researcher with deep domain knowledge.",
    tools=[SerperDevTool()],
    verbose=True,
)

writer = Agent(
    role="Technical Writer",
    goal="Create clear, comprehensive reports",
    backstory="You excel at turning complex research into readable content.",
)

research_task = Task(
    description="Research {topic} thoroughly",
    expected_output="10 key findings as bullet points",
    agent=researcher,
)

writing_task = Task(
    description="Write a detailed report based on the research",
    expected_output="A markdown report with sections and citations",
    agent=writer,
    output_file="report.md",
)

crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process=Process.sequential,
    memory=True,
    verbose=True,
)

result = crew.kickoff(inputs={"topic": "quantum computing"})
```

### Hierarchical Process with Manager
```python
crew = Crew(
    agents=[researcher, writer, analyst],
    tasks=[research_task, analysis_task, writing_task],
    process=Process.hierarchical,
    manager_llm="gpt-4",  # Auto-creates manager agent
    verbose=True,
)
```

### Conditional Task
```python
from crewai.tasks.conditional_task import ConditionalTask

quality_check = ConditionalTask(
    description="Perform deep analysis if initial findings are promising",
    expected_output="Detailed analysis report",
    agent=analyst,
    condition=lambda output: "promising" in output.raw.lower(),
)
```

### Flow with Crew Integration
```python
from crewai.flow.flow import Flow, listen, start, router, or_
from pydantic import BaseModel

class ResearchState(BaseModel):
    topic: str = ""
    confidence: float = 0.0
    results: list = []

class ResearchFlow(Flow[ResearchState]):
    @start()
    def initialize(self):
        self.state.topic = "AI agents"
        return {"topic": self.state.topic}

    @listen(initialize)
    def run_research_crew(self, data):
        crew = Crew(agents=[...], tasks=[...], process=Process.sequential)
        return crew.kickoff(inputs=data)

    @router(run_research_crew)
    def evaluate_quality(self):
        if self.state.confidence > 0.8:
            return "publish"
        return "revise"

    @listen("publish")
    def publish_results(self):
        return self.state.results

    @listen("revise")
    def request_revision(self):
        return "Need more research"

flow = ResearchFlow()
result = flow.kickoff()
```

### Custom Tool with @tool Decorator
```python
from crewai.tools import tool

@tool
def search_database(query: str, limit: int = 10) -> str:
    """Search the internal database for relevant records."""
    # Implementation here
    return f"Found {limit} results for: {query}"
```

### YAML Agent Configuration (agents.yaml)
```yaml
researcher:
  role: >
    {topic} Senior Data Researcher
  goal: >
    Uncover cutting-edge developments in {topic}
  backstory: >
    You're a seasoned researcher with a knack for uncovering the latest
    developments in {topic}. Known for your ability to find the most relevant
    information and present it in a clear and concise manner.

analyst:
  role: >
    {topic} Reporting Analyst
  goal: >
    Create detailed reports based on {topic} data analysis
  backstory: >
    You're a meticulous analyst with a keen eye for detail.
```

### YAML Task Configuration (tasks.yaml)
```yaml
research_task:
  description: >
    Conduct thorough research about {topic}.
    Make sure you find any interesting and relevant information.
  expected_output: >
    A list with 10 bullet points of the most relevant information
  agent: researcher

reporting_task:
  description: >
    Review the context you got and expand each topic into a full section.
  expected_output: >
    A full report with sections, formatted as markdown
  agent: analyst
  output_file: report.md
```

### Crew with Guardrails and Hooks
```python
def validate_report(task_output):
    """Guardrail: ensure report has minimum sections."""
    if task_output.raw.count("##") < 3:
        return (False, "Report needs at least 3 sections")
    return (True, task_output)

def preprocess_inputs(inputs):
    inputs["topic"] = inputs["topic"].strip().title()
    return inputs

crew = Crew(
    agents=[researcher, writer],
    tasks=[
        research_task,
        Task(
            description="Write report on {topic}",
            expected_output="Markdown report",
            agent=writer,
            guardrail=validate_report,
        ),
    ],
    process=Process.sequential,
    before_kickoff_callbacks=[preprocess_inputs],
    planning=True,
    planning_llm="gpt-4",
)
```

### Memory Configuration
```python
from crewai.memory.unified_memory import Memory

memory = Memory(
    recency_weight=0.3,
    semantic_weight=0.5,
    importance_weight=0.2,
    recency_half_life_days=30,
    consolidation_threshold=0.85,
)

crew = Crew(
    agents=[...],
    tasks=[...],
    memory=memory,
)
```

### MCP Server Integration
```python
from crewai.mcp import MCPServerConfig

agent = Agent(
    role="Data Analyst",
    goal="Analyze data from multiple sources",
    backstory="Expert data analyst",
    mcps=[
        MCPServerConfig(
            name="database",
            command="npx",
            args=["-y", "@modelcontextprotocol/server-postgres"],
        ),
    ],
)
```
