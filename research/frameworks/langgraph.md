# LangGraph

## Overview & Philosophy

LangGraph is a **low-level orchestration framework for building stateful, long-running agents** built by LangChain Inc. Its core idea is modeling agent workflows as **directed graphs** where nodes are computation steps and edges define control flow. The framework is inspired by Google's Pregel (bulk synchronous parallel) model and Apache Beam, with a public API influenced by NetworkX.

The fundamental philosophy is that agent orchestration is a **graph execution problem** with first-class state management. Unlike higher-level agent frameworks that abstract away control flow, LangGraph exposes the graph structure directly, giving developers precise control over:

- How state flows between nodes
- When and where to checkpoint execution
- Where to insert human oversight
- How to compose subgraphs into larger systems

LangGraph is framework-agnostic at its core — it can be used without LangChain — but integrates deeply with the LangChain ecosystem (LangSmith for observability, LangSmith Deployments for hosting).

**Key design choice**: State is defined declaratively via typed schemas (TypedDict, Pydantic, dataclass) with **reducer annotations** that define how concurrent updates to the same channel are merged. This is the single most distinctive architectural decision in LangGraph.

## Architecture

### Core Execution Model: Pregel

The runtime engine is called **Pregel** (after Google's paper on large-scale graph computation). Execution proceeds in **super-steps**:

1. All triggered nodes in the current step execute (potentially in parallel)
2. Each node writes updates to **channels**
3. Channel updates are applied using **reducers** (binary operators)
4. The next set of nodes to execute is determined by examining which channels changed
5. A **checkpoint** is created after each super-step
6. Repeat until no more nodes are triggered (or `END` is reached)

### State Graphs (`StateGraph`)

The primary API. Developers define:

- **State schema**: A TypedDict/Pydantic model/dataclass defining the shape of state
- **Nodes**: Functions that receive state and return partial updates
- **Edges**: Static connections between nodes
- **Conditional edges**: Functions that examine state and return the next node name(s)
- **Entry point**: `START` — the virtual first node
- **Exit point**: `END` — the virtual terminal node

```
StateGraph(schema) → add_node() → add_edge() / add_conditional_edges() → compile() → Pregel
```

Compilation transforms the declarative graph definition into an executable Pregel instance with channels, triggers, and writers.

### Channels (State Primitives)

Channels are the fundamental state storage units. Each key in the state schema maps to a channel:

| Channel Type | Behavior | Use Case |
|---|---|---|
| `LastValue` | Stores the most recent value, errors on concurrent writes | Simple state fields |
| `BinaryOperatorAggregate` | Applies a reducer function (e.g., `operator.add` for lists) | Accumulating messages, merging results |
| `EphemeralValue` | Value available only for the current step, then cleared | Transient inputs |
| `Topic` | Pub/sub style, collects all values written in a step | Fan-out patterns |
| `NamedBarrierValue` | Waits for all named writers before making value available | Synchronization barriers |
| `UntrackedValue` | Not tracked in channel versions (no trigger) | Metadata that shouldn't trigger execution |

The `Annotated[type, reducer]` pattern is used to attach reducers to state fields:

```python
class State(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]  # BinaryOperatorAggregate
    count: int  # LastValue (default)
```

### Checkpointing System

Checkpoints capture the complete execution state at each super-step:

```python
class Checkpoint(TypedDict):
    v: int                           # Format version
    id: str                          # Monotonically increasing ID
    ts: str                          # ISO 8601 timestamp
    channel_values: dict[str, Any]   # Serialized channel state
    channel_versions: ChannelVersions # Version vector per channel
    versions_seen: dict[str, ChannelVersions]  # What each node has seen
    updated_channels: list[str] | None
```

The `versions_seen` field is critical — it tracks which channel version each node has already processed, enabling the runtime to determine which nodes need to execute next (only nodes whose input channels have new versions they haven't seen).

**Checkpoint savers** implement `BaseCheckpointSaver`:
- `InMemorySaver` — for development/testing
- `PostgresSaver` / `AsyncPostgresSaver` — for production
- `SqliteSaver` — lightweight persistent option
- Custom implementations via the base class

Key checkpoint operations:
- `get_tuple(config)` — fetch a specific checkpoint
- `list(config)` — list checkpoints (supports filtering, pagination)
- `put(config, checkpoint, metadata)` — store a checkpoint
- `put_writes(config, writes, task_id)` — store intermediate writes
- `delete_thread(thread_id)` — delete all checkpoints for a thread
- `copy_thread(source, target)` — clone a thread's history

### Human-in-the-Loop via `interrupt()`

The `interrupt()` function is a first-class primitive that:

1. Raises a `GraphInterrupt` exception on first call
2. Serializes the interrupt value and sends it to the client
3. Persists the current state via the checkpointer
4. On resume, re-executes the node from the beginning
5. When `interrupt()` is called again, returns the resume value instead of raising

```python
def node(state):
    answer = interrupt("What is your age?")  # Pauses here, returns resume value on retry
    return {"human_value": answer}

# Resume with:
graph.stream(Command(resume="25"), config)
```

Multiple interrupts in a single node are supported — they are matched by index order. The `Command` primitive can also target specific interrupt IDs.

### Subgraph Pattern

Subgraphs are first-class in LangGraph. A compiled graph can be added as a node in a parent graph:

- **State mapping**: Subgraphs can have different state schemas from the parent; input/output state is mapped at the boundary
- **Checkpoint inheritance**: `Checkpointer = None | True | False` controls whether subgraphs share the parent's checkpointer, use their own, or disable checkpointing
- **Namespace isolation**: Subgraphs execute in their own checkpoint namespace (`NS_SEP` separated)
- **`Command.PARENT`**: Subgraphs can send commands to the parent graph via `Command(graph=Command.PARENT, update=...)`

### Functional API (`entrypoint` + `task`)

An alternative to the graph API for simpler workflows:

```python
@task
def process(data: str) -> str:
    return data.upper()

@entrypoint(checkpointer=InMemorySaver())
def workflow(input: str, *, previous: str | None = None) -> str:
    result = process(input).result()  # Tasks return futures
    return result
```

Key features:
- Tasks return `SyncAsyncFuture` objects enabling parallel execution
- `entrypoint.final(value=..., save=...)` decouples return value from checkpointed state
- `previous` parameter gives access to the last return value for the same thread
- Full interrupt/resume support within entrypoints

### Store (Long-term Memory)

The `BaseStore` provides a hierarchical key-value store with optional vector search:

- **Namespaced storage**: `("users", "user123", "preferences")` — tuple-based hierarchy
- **CRUD operations**: `GetOp`, `PutOp`, `SearchOp`, `ListNamespacesOp`
- **Vector search**: Optional embeddings support via `SearchItem` with similarity scores
- **TTL support**: Time-to-live for automatic expiration
- Distinct from checkpointing — store persists across threads/conversations

### Streaming

Seven streaming modes available simultaneously:

| Mode | Output |
|---|---|
| `values` | Full state after each step |
| `updates` | Node name → output dict per step |
| `messages` | LLM token-by-token with metadata |
| `custom` | User-defined via `StreamWriter` |
| `checkpoints` | Checkpoint events |
| `tasks` | Task start/finish events |
| `debug` | Combined checkpoints + tasks |

### Durable Execution

Three durability modes:
- `sync` — checkpoint persisted before next step (safest)
- `async` — checkpoint persisted concurrently with next step (faster)
- `exit` — checkpoint persisted only when graph finishes (fastest, least durable)

## Key Patterns

### [state] Reducer-based State Composition
State fields use `Annotated[type, reducer_fn]` to define how concurrent writes merge. The `add_messages` reducer intelligently merges message lists by ID. The `Overwrite` type bypasses reducers entirely for full replacement semantics.

### [orchestration] Pregel Super-step Execution
Nodes execute in parallel within a super-step, write to channels, and trigger the next wave of execution based on channel version changes. This is the core execution model.

### [pattern] Conditional Branching via `add_conditional_edges`
A function examines state and returns the name(s) of the next node(s). Supports fan-out to multiple nodes and the special `Send` object for dynamic map-reduce patterns.

### [pattern] Map-Reduce with `Send`
```python
def fan_out(state):
    return [Send("process_item", {"item": i}) for i in state["items"]]
```
Each `Send` creates a separate task with its own input state, results merge back via reducers.

### [memory] Dual Memory Architecture
- **Short-term**: Checkpoint-based state within a thread (channel values persisted per super-step)
- **Long-term**: Store-based cross-thread memory with hierarchical namespaces and optional vector search

### [hook] Human-in-the-Loop Interrupts
`interrupt(value)` is a synchronous call that pauses execution, persists state, surfaces a value to the client, and resumes with `Command(resume=...)`. Multiple interrupts per node supported with index-based matching.

### [orchestration] Subgraph Composition
Compiled graphs can be nested as nodes. State mapping at boundaries, namespace-isolated checkpoints, and `Command.PARENT` for child-to-parent communication.

### [agent] Prebuilt ReAct Agent
`create_react_agent()` provides a batteries-included agent with tool calling, structured output, and prompt handling — built on top of StateGraph internally.

### [pattern] `entrypoint.final` for Decoupled Return/Save
Allows returning one value to the caller while saving a different value as the checkpoint state. Useful for accumulating internal context while presenting clean outputs.

### [mcp] MCP Server Integration
LangGraph provides an MCP server mode (`./claude-flow mcp start`) and SDK clients for remote graph execution.

### [sandbox] Durable Execution with Failure Recovery
Checkpointing after each super-step means execution automatically resumes from the last checkpoint on failure. Combined with `RetryPolicy` for node-level retry with exponential backoff.

### [skill] Task Caching with `CachePolicy`
Tasks can be cached based on input hashing (`CachePolicy(key_func=..., ttl=...)`). Cache keys use `xxh3_128` hashing of pickled inputs by default.

### [pattern] Channel Version Tracking
The `versions_seen` mechanism ensures nodes only execute when their input channels have genuinely new data, preventing redundant execution in complex graphs.

### [orchestration] `Command` Primitive for Multi-action Updates
A single `Command` can simultaneously update state, resume from an interrupt, and navigate to specific nodes — replacing separate API calls with an atomic operation.

## Strengths

1. **Precise control flow**: The graph-based model gives developers explicit, visual control over agent execution paths — no magic routing or implicit behavior.

2. **First-class checkpointing**: Every super-step is checkpointed by default, enabling time-travel debugging, replay, and crash recovery out of the box.

3. **Sophisticated state management**: The reducer/channel system elegantly handles concurrent state updates. The `Annotated[type, reducer]` pattern is both Pythonic and powerful.

4. **Human-in-the-loop as a primitive**: `interrupt()` is not an afterthought — it's deeply integrated into the execution model with proper state persistence and resume semantics.

5. **Composability via subgraphs**: Nested graphs with isolated namespaces, state mapping, and cross-graph commands enable building complex multi-agent systems from reusable components.

6. **Multiple streaming modes**: Seven distinct streaming modes (values, updates, messages, custom, checkpoints, tasks, debug) provide fine-grained observability.

7. **Dual API surface**: Graph API for complex workflows, functional API (`entrypoint`/`task`) for simpler use cases — same underlying engine.

8. **Production-ready persistence**: PostgreSQL checkpoint saver, proper serialization (JsonPlusSerializer with msgpack support), thread management (copy, delete, fork).

9. **Strong typing throughout**: TypedDict/Pydantic/dataclass state schemas, typed stream parts, generic protocol classes.

10. **Ecosystem integration**: Deep integration with LangSmith for tracing, debugging, and deployment.

## Weaknesses

1. **Complexity ceiling**: The Pregel model, channels, reducers, and checkpoint namespaces create significant conceptual overhead. The learning curve is steep for non-trivial workflows.

2. **Re-execution on resume**: When resuming from an interrupt, the entire node re-executes from the beginning. Multiple interrupts use index-based matching, which is fragile if node logic changes between versions.

3. **Python-centric**: While LangGraph.js exists, the core development and most advanced features are Python-first. The JS version lags behind.

4. **LangChain coupling**: Despite claims of independence, deep integration with `langchain_core` (RunnableConfig, callbacks, messages) means practical independence is limited.

5. **Serialization constraints**: All state must be serializable for checkpointing. Complex Python objects, closures, and certain types require custom serialization handling.

6. **Debugging complexity**: While LangSmith helps, understanding state flow through channels, reducers, and super-steps in a multi-subgraph system can be challenging without the paid observability tool.

7. **No built-in sandboxing**: Code execution and tool use have no built-in isolation — security must be handled externally.

8. **Monorepo complexity**: The split across checkpoint, checkpoint-postgres, checkpoint-sqlite, langgraph, prebuilt, sdk-py, sdk-js, and cli packages creates dependency management overhead.

9. **Opinionated state model**: The reducer-based channel system is powerful but rigid. Use cases that don't fit the TypedDict-with-reducers model feel awkward.

10. **Thread-based isolation**: State is isolated per thread_id. Cross-thread coordination requires the separate Store abstraction, adding another conceptual layer.

## Unique Ideas Worth Extracting

### 1. Reducer-Annotated State Fields
The `Annotated[list[Message], add_messages]` pattern is elegant. Instead of requiring explicit merge logic, the state schema itself declares how concurrent updates combine. This could be adopted for any framework with shared state.

### 2. Channel Version Vectors for Execution Triggering
Tracking `versions_seen` per node per channel creates a precise, minimal execution model — nodes only run when their inputs genuinely change. This avoids both redundant execution and missed updates.

### 3. `interrupt()` as a Synchronous Call
Making human-in-the-loop feel like a regular function call (that internally raises, checkpoints, and resumes) is a much better DX than callback-based or event-based patterns. The index-based multi-interrupt matching within a single node is novel.

### 4. `Command` as a Multi-action Primitive
Combining state update + resume + navigation into a single atomic `Command` object simplifies client code significantly. The `Command.PARENT` for child-to-parent communication in subgraphs is particularly useful.

### 5. `entrypoint.final` for Decoupled Return/Save
The ability to return one thing to the caller while persisting a different value as state is a clean solution to a common problem in stateful workflows.

### 6. `Overwrite` for Bypassing Reducers
When a reducer is defined but occasionally needs to be bypassed (e.g., resetting an accumulator), the `Overwrite(value)` wrapper is a clean escape hatch.

### 7. Super-step Checkpointing with Durability Modes
The three durability modes (sync/async/exit) let developers trade safety for performance on a per-graph basis, rather than forcing a one-size-fits-all approach.

### 8. Hierarchical Namespace Store with Vector Search
The Store abstraction combines key-value storage with optional embeddings-based search, all scoped to hierarchical namespaces. This is a practical pattern for agent long-term memory.

### 9. `Send` for Dynamic Fan-out
Rather than pre-defining all parallel paths, `Send` allows runtime-determined fan-out with per-instance state. This enables true map-reduce patterns within the graph model.

### 10. Checkpoint Forking via `source: "fork"` Metadata
The ability to fork a checkpoint (create a branch from any point in history) enables experimentation and what-if analysis on agent execution.

## Code Examples

### Basic StateGraph with Conditional Edges

```python
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import InMemorySaver
import operator

class State(TypedDict):
    messages: Annotated[list[str], operator.add]
    next_step: str

def router(state: State) -> str:
    if "error" in state["messages"][-1]:
        return "handle_error"
    return "process"

builder = StateGraph(State)
builder.add_node("classify", lambda s: {"next_step": "process", "messages": ["classified"]})
builder.add_node("process", lambda s: {"messages": ["processed"]})
builder.add_node("handle_error", lambda s: {"messages": ["error handled"]})

builder.add_edge(START, "classify")
builder.add_conditional_edges("classify", router, ["process", "handle_error"])
builder.add_edge("process", END)
builder.add_edge("handle_error", END)

graph = builder.compile(checkpointer=InMemorySaver())
```

### Human-in-the-Loop with interrupt()

```python
from langgraph.types import interrupt, Command
from langgraph.checkpoint.memory import InMemorySaver

class ReviewState(TypedDict):
    draft: str
    approved: bool

def write_draft(state: ReviewState) -> dict:
    return {"draft": "Generated draft content..."}

def human_review(state: ReviewState) -> dict:
    decision = interrupt({
        "question": "Approve this draft?",
        "draft": state["draft"]
    })
    return {"approved": decision == "yes"}

builder = StateGraph(ReviewState)
builder.add_node("write", write_draft)
builder.add_node("review", human_review)
builder.add_edge(START, "write")
builder.add_edge("write", "review")
builder.add_edge("review", END)

graph = builder.compile(checkpointer=InMemorySaver())

config = {"configurable": {"thread_id": "review-1"}}

# First run — pauses at interrupt
for chunk in graph.stream({"draft": "", "approved": False}, config):
    print(chunk)
# Output: {'__interrupt__': (Interrupt(value={'question': '...', 'draft': '...'}),)}

# Resume with approval
for chunk in graph.stream(Command(resume="yes"), config):
    print(chunk)
# Output: {'review': {'approved': True}}
```

### Map-Reduce with Send

```python
from langgraph.types import Send

class OverallState(TypedDict):
    topics: list[str]
    summaries: Annotated[list[str], operator.add]

def fan_out_to_summarize(state: OverallState):
    return [Send("summarize", {"topic": t}) for t in state["topics"]]

def summarize(state: dict) -> dict:
    return {"summaries": [f"Summary of {state['topic']}"]}

builder = StateGraph(OverallState)
builder.add_node("summarize", summarize)
builder.add_conditional_edges(START, fan_out_to_summarize)
builder.add_edge("summarize", END)

graph = builder.compile()
result = graph.invoke({"topics": ["AI", "ML", "NLP"], "summaries": []})
# result["summaries"] == ["Summary of AI", "Summary of ML", "Summary of NLP"]
```

### Functional API with Tasks and Interrupts

```python
from langgraph.func import entrypoint, task
from langgraph.types import interrupt, Command
from langgraph.checkpoint.memory import InMemorySaver

@task
def generate_essay(topic: str) -> str:
    return f"An essay about {topic}..."

@entrypoint(checkpointer=InMemorySaver())
def review_workflow(topic: str) -> dict:
    essay = generate_essay(topic).result()  # Returns a future
    review = interrupt({"essay": essay, "question": "Please review"})
    return {"essay": essay, "review": review}

config = {"configurable": {"thread_id": "essay-1"}}

# Generates essay, pauses for review
for chunk in review_workflow.stream("quantum computing", config):
    print(chunk)

# Resume with review
for chunk in review_workflow.stream(Command(resume="Looks good!"), config):
    print(chunk)
```

### Subgraph Composition

```python
# Inner graph with its own state schema
class InnerState(TypedDict):
    query: str
    result: str

inner_builder = StateGraph(InnerState)
inner_builder.add_node("search", lambda s: {"result": f"Found: {s['query']}"})
inner_builder.add_edge(START, "search")
inner_builder.add_edge("search", END)
inner_graph = inner_builder.compile()

# Outer graph that uses the inner graph as a node
class OuterState(TypedDict):
    question: str
    answer: str

def prepare_query(state: OuterState) -> dict:
    return {"query": state["question"]}  # Map outer state to inner state

builder = StateGraph(OuterState)
builder.add_node("research", inner_graph)  # Subgraph as node
builder.add_node("prepare", prepare_query)
builder.add_edge(START, "prepare")
builder.add_edge("prepare", "research")
builder.add_edge("research", END)

graph = builder.compile(checkpointer=InMemorySaver())
```

### Time-Travel / State Inspection

```python
config = {"configurable": {"thread_id": "my-thread"}}

# Get current state
snapshot = graph.get_state(config)
print(snapshot.values)    # Current channel values
print(snapshot.next)      # Next nodes to execute
print(snapshot.metadata)  # Step number, source, etc.

# Browse state history
for state in graph.get_state_history(config):
    print(f"Step {state.metadata['step']}: {state.values}")

# Fork from a previous checkpoint
old_config = state.config  # Config pointing to a historical checkpoint
graph.update_state(old_config, {"messages": ["corrected value"]}, as_node="editor")

# Resume from the forked state
for chunk in graph.stream(None, old_config):
    print(chunk)
```

### Retry and Cache Policies

```python
from langgraph.types import RetryPolicy, CachePolicy

builder = StateGraph(State)
builder.add_node(
    "flaky_api_call",
    call_api,
    retry=RetryPolicy(
        initial_interval=0.5,
        backoff_factor=2.0,
        max_attempts=3,
        retry_on=ConnectionError,
    ),
)

# With caching (functional API)
@task(cache_policy=CachePolicy(ttl=3600))
def expensive_computation(data: str) -> str:
    return process(data)
```
