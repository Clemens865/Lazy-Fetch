# ruvnet Agentic Tools (agentic-flow & ruflo)

## Overview & Philosophy

**ruvnet** (Reuven Cohen) maintains two closely related open-source projects that form a layered AI agent orchestration ecosystem built primarily for Claude Code:

- **agentic-flow** (v2, 564 stars) -- The lower-level intelligence engine providing vector search (HNSW), self-learning (SONA/ReasoningBank), attention mechanisms, GNN query refinement, and agent coordination primitives. Published as `agentic-flow` on npm. Written in TypeScript with Rust/WASM components for performance-critical paths.

- **ruflo** (v3.5, 23,700+ stars, formerly "claude-flow") -- The higher-level orchestration platform that wraps agentic-flow and provides 60+ specialized agents, 259 MCP tools, CLI commands, swarm coordination, hooks system, skills system, background workers, and multi-provider LLM routing. Published as both `ruflo` and `claude-flow` on npm (5,900+ commits).

**Core philosophy**: "Agents that learn, build, and work perpetually." The system is designed around:
1. **Self-learning loops** -- Every task execution feeds back into a ReasoningBank pattern store, improving future routing and quality.
2. **Multi-agent swarms** -- Complex work is decomposed across coordinated agent teams using consensus protocols (Raft, Byzantine, Gossip, CRDT).
3. **Claude Code native integration** -- Hooks into Claude Code's lifecycle via MCP protocol, `.claude/` directory conventions, and CLAUDE.md behavioral rules.
4. **Cost optimization** -- 3-tier model routing skips LLM calls entirely for simple transforms (WASM Agent Booster), routes medium tasks to cheaper models, reserves expensive models for complex reasoning.

## Architecture

### System Layers (ruflo v3.5)

```
User Layer:        Claude Code / CLI / MCP Client
                        |
Entry Layer:       CLI (26 commands) + AIDefence Security
                        |
Routing Layer:     Q-Learning Router + MoE (8 Experts) + Skills (42+) + Hooks (17)
                        |
Swarm Layer:       Topologies (mesh/hierarchical/ring/star) + Consensus (Raft/BFT/Gossip/CRDT) + Claims
                        |
Agent Layer:       60+ Specialized Agents (coder, tester, reviewer, architect, security, ...)
                        |
Resource Layer:    Memory (AgentDB) + Providers (Claude/GPT/Gemini/Ollama) + Workers (12)
                        |
Intelligence:      SONA + EWC++ + Flash Attention + HNSW + ReasoningBank + Hyperbolic Embeddings
                        |
Learning Loop:     RETRIEVE -> JUDGE -> DISTILL -> CONSOLIDATE -> ROUTE (loops back to Router)
```

### Package Structure (ruflo)

| Package | Purpose |
|---------|---------|
| `@claude-flow/cli` | CLI entry point, 26 commands |
| `@claude-flow/codex` | Dual-mode Claude + OpenAI Codex collaboration |
| `@claude-flow/guidance` | Governance control plane |
| `@claude-flow/hooks` | 17 hooks + 12 background workers |
| `@claude-flow/memory` | AgentDB + HNSW vector search |
| `@claude-flow/security` | Input validation, CVE remediation |
| `@claude-flow/shared` | Core interfaces, event bus, orchestrator, hooks system |
| `@claude-flow/aidefence` | Threat detection and learning service |
| `@claude-flow/browser` | Browser automation agent with Playwright |

### Agent Architecture (agentic-flow v2)

agentic-flow provides the "intelligence layer" consumed by ruflo:
- **EnhancedAgentDBWrapper** -- Core vector DB with GNN-enhanced search, flash attention, HNSW indexing
- **AttentionCoordinator** -- Multi-agent consensus via 5 attention mechanisms (Flash, Multi-Head, Linear, Hyperbolic, MoE)
- **ReasoningBank** -- Pattern store with trajectory learning (store success/failure patterns, search for similar past solutions)
- **SONA** -- Self-Optimizing Neural Architecture with LoRA fine-tuning, EWC++ anti-forgetting
- **Agent Booster** -- WASM-based AST transforms that skip LLM for simple code edits (<1ms vs 2-5s)

### Domain-Driven Design

ruflo v3 follows DDD with bounded contexts:
- **Core** (Agents, Swarms, Tasks)
- **Memory** (AgentDB, HNSW, Cache)
- **Security** (AIDefence, Validation, CVE Fixes)
- **Integration** (agentic-flow, MCP)
- **Coordination** (Consensus, Hive-Mind)

The codebase enforces small file sizes (~200 lines target per module), typed interfaces for all public APIs, and event sourcing for state changes.

## Key Patterns

### [hook] Claude Code Lifecycle Hooks
The hooks system intercepts Claude Code operations at multiple points:
```typescript
enum HookEvent {
  PreToolUse, PostToolUse,       // Before/after any tool call
  PreEdit, PostEdit,             // File editing
  PreCommand, PostCommand,       // Bash commands
  SessionStart, SessionEnd,      // Session lifecycle
  PreAgentSpawn, PostAgentSpawn, // Agent lifecycle
  PreTaskExecute, PostTaskExecute,
  PreMemoryStore, PostMemoryStore,
  OnError, OnWarning
}
```
Hooks have priorities (Critical/High/Normal/Low), can abort operations, modify context, and chain results. The `HookRegistry` manages registration with statistics tracking (execution count, failure rate, avg time).

### [agent] Markdown-Based Agent Definitions
Agents are defined as `.md` files in `.claude/agents/` with YAML frontmatter:
```yaml
---
name: coder
type: developer
capabilities: [code_generation, refactoring, optimization]
priority: high
hooks:
  pre: |
    echo "Coder agent implementing: $TASK"
  post: |
    npm run lint --if-present
---
# Code Implementation Agent
You are a senior software engineer...
[Full system prompt follows]
```
This pattern makes agents human-readable documents that double as executable configurations. Each agent gets its own system prompt, hooks, MCP tool access patterns, and collaboration instructions.

### [orchestration] Swarm Topologies with Consensus
Four swarm topologies with configurable consensus:
- **Hierarchical** (queen-worker) -- Single coordinator validates outputs against goals, prevents drift. Preferred for coding tasks.
- **Mesh** (peer-to-peer) -- Equal peers with broadcast communication. Good for distributed analysis.
- **Ring** -- Sequential pipeline processing. Good for document pipelines.
- **Star** -- Central hub routing. Lowest latency.

Consensus algorithms: Majority voting, Weighted (Queen 3x weight), Byzantine fault-tolerant (handles f < n/3 failures).

### [memory] Three-Scope Agent Memory
```
project/  -- Shared across all agents in a project
local/    -- Per-agent isolated memory
user/     -- Cross-project user preferences
```
Memory uses HNSW vector search with 384-dim embeddings (ONNX MiniLM, local inference), SQLite persistence with WAL mode, and LRU cache. Knowledge graph layer uses PageRank + community detection to identify influential insights.

### [memory] ReasoningBank Pattern Learning
Every task execution stores a trajectory:
```typescript
await reasoningBank.storePattern({
  sessionId: `coder-${agentId}-${Date.now()}`,
  task: 'Implement user authentication',
  input: 'Requirements: OAuth2, JWT tokens',
  output: generatedCode,
  reward: 0.95,       // Success score 0-1
  success: true,
  critique: 'Good test coverage, could improve error messages',
  tokensUsed: 15000,
  latencyMs: 2300
});
```
Before each task, agents search for similar past solutions (top-K by vector similarity) and apply lessons. This creates a continual improvement loop (+10% accuracy per 10 iterations, per their benchmarks).

### [mcp] 259 MCP Tools as Integration Surface
The entire system is exposed via Model Context Protocol tools, making it usable from any MCP-capable client:
- `swarm_init` -- Initialize agent swarms with topology config
- `agent_spawn` -- Spawn specialized agents
- `memory_search` / `memory_store` -- Vector memory operations
- `hooks_route` -- Intelligent task routing
- `neural_train` -- Train on patterns
- `github_pr_manage`, `github_repo_analyze` -- GitHub integration
- `benchmark_run`, `bottleneck_analyze` -- Performance tools

### [pattern] Anti-Drift Swarm Configuration
A notable defensive pattern for multi-agent coding:
```javascript
swarm_init({
  topology: "hierarchical",  // Single coordinator enforces alignment
  maxAgents: 8,              // Fewer agents = less coordination overhead
  strategy: "specialized"    // Clear roles reduce ambiguity
})
```
Combined with frequent checkpoints via post-task hooks, shared memory namespaces, short task cycles with verification gates, and hierarchical coordinator review of all outputs.

### [sandbox] Agent Booster (WASM Code Transforms)
Simple code transforms are handled by a WASM engine without calling the LLM:
- `var-to-const` -- Convert var/let to const
- `add-types` -- Add TypeScript type annotations
- `add-error-handling` -- Wrap in try/catch
- `async-await` -- Convert promise chains to async/await
- `remove-console` -- Strip console.* calls

Performance: <1ms latency, $0 cost, 352x faster than LLM. The hooks system detects when Agent Booster can handle a task and emits `[AGENT_BOOSTER_AVAILABLE]` signals.

### [skill] Slash-Command Skills System
42+ pre-built skills stored as `SKILL.md` files in `.claude/skills/`:
- `swarm-orchestration`, `hive-mind-advanced`
- `github-code-review`, `github-workflow-automation`
- `sparc-methodology` (Specification, Pseudocode, Architecture, Refinement, Completion)
- `pair-programming` (driver/navigator mode)
- `stream-chain` (JSON pipeline processing)
- `agentdb-vector-search`, `agentdb-learning`
- `dual-mode` (Claude + Codex collaboration)

Skills are invoked as slash commands (`/swarm-orchestration` in Claude Code, `$swarm-orchestration` in Codex).

### [orchestration] Dual-Mode Orchestration (Claude + Codex)
A unique pattern for running Claude Code and OpenAI Codex in parallel:
```
Claude Code (interactive)  <-->  Codex Workers (headless)
- Main conversation          - Parallel background execution
- Complex reasoning          - Bulk code generation
- Architecture decisions     - Test execution
```
Pre-built collaboration templates: `feature` (architect -> coder -> tester -> reviewer), `security` (scanner -> analyzer -> fixer), `refactor` (analyzer -> planner -> refactorer -> validator).

### [pattern] Event-Sourced State Management
The v3 shared library uses event sourcing for all state changes:
- `EventBus` with typed events, correlation IDs, wildcard subscriptions
- `EventStore` with projections and state reconstruction
- Domain events for agent lifecycle, task lifecycle, memory operations
- Secure event IDs using `crypto.randomBytes`

### [orchestration] 3-Tier Model Routing (ADR-026)
Intelligent cost optimization:

| Tier | Handler | Latency | Cost |
|------|---------|---------|------|
| 1 | Agent Booster (WASM) | <1ms | $0 |
| 2 | Haiku/fast model | ~500ms | $0.0002 |
| 3 | Sonnet/Opus | 2-5s | $0.003-$0.015 |

The router analyzes task complexity and routes to the cheapest handler that can meet quality requirements. Claims 75% cost reduction and 2.5x extension of Claude Max quotas.

### [pattern] Claims System for Human-Agent Coordination
Work ownership protocol with claim/release/handoff:
- Agents claim tasks to prevent conflicts
- Humans can claim tasks back from agents
- Handoff protocol for transferring work between human and AI

## Strengths

1. **Comprehensive hook system** -- The pre/post lifecycle hooks for every Claude Code operation (tool use, file edit, command, session, agent, task, memory) provide deep integration points. The priority system, abort capability, and statistics tracking are well-designed.

2. **Self-learning feedback loop** -- The ReasoningBank pattern store with trajectory learning is a genuinely useful concept. Storing success/failure patterns with reward scores and searching for similar past solutions before each task creates meaningful improvement over time.

3. **Cost-conscious architecture** -- The 3-tier model routing and WASM Agent Booster demonstrate sophisticated cost optimization. Skipping LLM entirely for simple AST transforms is pragmatic and impactful.

4. **Agent definitions as documents** -- Using markdown files with YAML frontmatter for agent definitions makes them readable, versionable, and self-documenting. The system prompt, hooks, and capabilities are all in one place.

5. **Production-grade primitives** -- Consensus protocols (Raft, Byzantine, CRDT), fault tolerance, retry policies with backoff, health monitoring, secure ID generation, and input validation show enterprise-level thinking.

6. **Multi-provider LLM support** -- Automatic failover across 6 providers (Anthropic, OpenAI, Google, Cohere, Ollama, local) with cost-based routing is genuinely useful for production systems.

7. **Deep MCP integration** -- 259 tools exposed via MCP makes the entire system accessible from any MCP client, not just Claude Code.

8. **Well-typed TypeScript interfaces** -- The DDD approach with clean interface boundaries (IAgent, IAgentPool, IAgentLifecycleManager, ITaskManager, IEventBus) provides good extensibility.

## Weaknesses

1. **Extreme feature scope creep** -- The system claims 66+ agents, 213+ MCP tools, 42+ skills, 17 hooks, 12 workers, 5 attention mechanisms, 9 RL algorithms, quantum-resistant VCS, hyperbolic embeddings, etc. Many of these are likely thin wrappers or incomplete implementations. The "everything and the kitchen sink" approach makes it hard to evaluate what actually works in production.

2. **Marketing-heavy documentation** -- The READMEs read more like product marketing than technical documentation. Performance claims (352x faster, 12,500x speedup, +55% quality improvement) are presented without reproducible benchmarks or clear methodology. Many metrics appear to be micro-benchmarks on trivial operations.

3. **Unclear boundary between agentic-flow and ruflo** -- The relationship between the two repos is confusing. ruflo's package.json still uses the name "claude-flow", agentic-flow agents are duplicated in ruflo, and the README cross-references are tangled. It is unclear which repo is the canonical source of truth.

4. **Potential for over-engineering** -- Byzantine fault tolerance, quantum-resistant cryptography, QUIC transport, and hyperbolic Poincare embeddings are impressive-sounding but questionable for a developer tool orchestrating LLM calls. The coordination overhead may exceed the complexity of most real tasks.

5. **Dependency on Claude Code internals** -- Deep integration with Claude Code's `.claude/` directory, `settings.json`, hook system, and MCP protocol means tight coupling to a specific tool. Changes to Claude Code could break the entire system.

6. **Limited community validation** -- Despite high star counts, there is limited evidence of production usage by teams outside the author. The 5,900+ commits are primarily from a single developer.

7. **CLAUDE.md is extremely prescriptive** -- The behavioral rules ("ALWAYS batch ALL todos in ONE TodoWrite call", "NEVER save to root folder") are optimized for ruflo's own development workflow and may conflict with how other teams work.

## Unique Ideas Worth Extracting

1. **ReasoningBank trajectory learning** -- The pattern of storing task executions with reward scores and searching for similar past solutions before each new task is a genuinely novel and useful concept for any agentic system. The RETRIEVE -> JUDGE -> DISTILL -> CONSOLIDATE -> ROUTE learning loop is well-conceived.

2. **WASM Agent Booster for LLM bypass** -- Using WebAssembly AST transforms to handle simple code edits without any LLM call is pragmatic and impactful. The pattern of detecting when a task is simple enough for local handling and emitting signals is worth adopting.

3. **Anti-drift swarm configuration** -- The explicit anti-drift pattern (hierarchical topology, small team size, specialized roles, frequent checkpoints, shared memory) is a practical solution to a real problem in multi-agent systems where agents go off-task.

4. **Three-scope agent memory** -- The project/local/user memory scoping model with cross-agent transfer provides useful isolation without preventing knowledge sharing.

5. **Markdown agent definitions** -- Defining agents as `.md` files with YAML frontmatter that combine configuration (capabilities, hooks, priority) with the system prompt in a single readable document is elegant.

6. **Claims system for human-agent coordination** -- The claim/release/handoff protocol for managing work ownership between humans and AI agents addresses a real gap in most agentic frameworks.

7. **Hook-based cost routing signals** -- Emitting `[AGENT_BOOSTER_AVAILABLE]` and `[TASK_MODEL_RECOMMENDATION]` signals from hooks so the calling agent can make informed routing decisions is a clean separation of concerns.

8. **Dual-mode orchestration** -- Running Claude Code and OpenAI Codex in parallel with shared memory coordination and pre-built collaboration templates is a creative approach to multi-platform agentic work.

9. **Knowledge graph from memory entries** -- Building a PageRank + community detection graph from accumulated memory entries, then using graph ranking to inject context into routing decisions, creates a compounding intelligence effect.

10. **Spec-driven development with ADRs** -- Using Architecture Decision Records as enforceable specifications that agents must comply with, combined with statusline compliance percentage display, provides real guardrails for multi-agent development.

## Code Examples

### Agent Interface (TypeScript)
```typescript
// v3/@claude-flow/shared/src/core/interfaces/agent.interface.ts
export interface IAgentConfig {
  readonly id: string;
  readonly name: string;
  readonly type: AgentType | string;
  capabilities: string[];
  maxConcurrentTasks: number;
  priority: number;
  timeout?: number;
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
    backoffMultiplier: number;
  };
  resources?: { maxMemoryMb?: number; maxCpuPercent?: number };
}

export interface IAgent {
  readonly id: string;
  readonly type: AgentType | string;
  readonly config: IAgentConfig;
  status: AgentStatus;
  currentTaskCount: number;
  metrics?: {
    tasksCompleted: number;
    tasksFailed: number;
    avgTaskDuration: number;
  };
  health?: { status: 'healthy' | 'degraded' | 'unhealthy'; issues?: string[] };
}
```

### Hook Registration and Execution
```typescript
// v3/@claude-flow/shared/src/hooks/types.ts
export type HookHandler = (context: HookContext) => Promise<HookResult> | HookResult;

export interface HookResult {
  success: boolean;
  data?: Partial<HookContext>;  // Can modify context
  abort?: boolean;               // Can abort the operation
  continueChain?: boolean;       // Can stop other hooks
}

// v3/@claude-flow/shared/src/hooks/registry.ts
const registry = new HookRegistry();
const hookId = registry.register(
  HookEvent.PreEdit,
  async (ctx) => {
    // Validate file before edit
    if (ctx.file?.path.includes('.env')) {
      return { success: false, abort: true };
    }
    return { success: true };
  },
  HookPriority.High,
  { name: 'env-file-protection' }
);
```

### Swarm Initialization via MCP
```javascript
// Anti-drift swarm for coding tasks
mcp__ruv_swarm__swarm_init({
  topology: "hierarchical",
  maxAgents: 8,
  strategy: "specialized"
})

// Spawn agents in parallel via Claude Code Task tool
Task("Architect", "Design implementation. Store in memory namespace 'collab'.", "system-architect")
Task("Coder", "Implement based on architect design.", "coder")
Task("Tester", "Write tests for implementation.", "tester")
Task("Reviewer", "Review code quality. Store findings in 'collab'.", "reviewer")
```

### ReasoningBank Pattern Store
```typescript
// Store a task execution pattern
await reasoningBank.storePattern({
  sessionId: `coder-${agentId}-${Date.now()}`,
  task: 'Implement user authentication',
  input: 'Requirements: OAuth2, JWT tokens, rate limiting',
  output: generatedCode,
  reward: 0.95,
  success: true,
  critique: 'Good test coverage, could improve error messages',
  tokensUsed: 15000,
  latencyMs: 2300
});

// Search for similar past solutions before starting a new task
const patterns = await reasoningBank.searchPatterns({
  task: 'Implement user authentication',
  k: 5,
  minReward: 0.8  // Only successful patterns
});
```

### Agent Booster WASM Transform
```typescript
// Hook detects simple transform and signals bypass
// [AGENT_BOOSTER_AVAILABLE] Intent: var-to-const
// -> Use Edit tool directly, 352x faster than LLM

// Agent Booster supported intents:
// var-to-const, add-types, add-error-handling,
// async-await, add-logging, remove-console
```

### Event Bus (Core Infrastructure)
```typescript
// v3/@claude-flow/shared/src/core/event-bus.ts
const bus = createEventBus();

// Subscribe to task events
bus.on('task:completed', async (event) => {
  await reasoningBank.storePattern(event.payload);
});

// Emit with correlation tracking
bus.emit('task:started', taskData, {
  source: 'task-manager',
  correlationId: requestId,
  priority: 'high'
});
```

### Markdown Agent Definition
```yaml
# .claude/agents/core/coder.md
---
name: coder
type: developer
color: "#FF6B35"
capabilities: [code_generation, refactoring, optimization, api_design]
priority: high
hooks:
  pre: |
    echo "Coder agent implementing: $TASK"
    if grep -q "test\|spec" <<< "$TASK"; then
      echo "Remember: Write tests first (TDD)"
    fi
  post: |
    echo "Implementation complete"
    npm run lint --if-present
---
# Code Implementation Agent
You are a senior software engineer specialized in writing clean,
maintainable, and efficient code...
```

---

*Analysis conducted 2026-03-23. Sources: github.com/ruvnet/agentic-flow (v2.0.2-alpha, 564 stars), github.com/ruvnet/ruflo (v3.5.42, 23,754 stars).*
