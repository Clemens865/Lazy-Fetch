# Cross-Cutting Pattern Analysis

Comprehensive synthesis across all 18 frameworks analyzed. Patterns organized by category.

## Spectrum of Complexity

```
Simple ◄─────────────────────────────────────────────────────────────────────────► Complex
Ralph    mini-swe   AutoResearch   Aider    SWE-Agent   Roast    Cline    Minions    Cursor    LangGraph    Paperclip    CrewAI    ruflo
(bash)   (100 LOC)  (md+git)       (Python) (ACI)       (DSL)    (ext)    (blueprints)(IDE)    (graphs)     (company)    (crews)   (259 tools)
```

**Key insight**: The most battle-tested systems are NOT the most complex. mini-swe-agent (~100 LOC) matches SWE-agent's performance. Stripe ships 1,300 PRs/week with constrained blueprints. Ralph delivers $50k contracts for $297. **As models improve, simpler scaffolding wins.** [pattern]

---

## Pattern 1: Deterministic Scaffolding Around Agentic Cores [pattern] [agent]

**Seen in**: Stripe Minions, Shopify Roast, AutoResearch, SWE-Agent, Cursor, Codex CLI

The most successful frameworks constrain agents with deterministic structure:
- **Stripe**: State machine with deterministic nodes (lint, CI, git) and agentic nodes (implement, fix)
- **Roast**: Two-phase execution — collect procs, then execute with pre-flight validation
- **AutoResearch**: Fixed 5-minute budget, immutable evaluation harness
- **SWE-Agent**: Linting gate rejects syntactically invalid edits before they enter the codebase
- **Cursor**: Plan-as-artifact — deterministic plan, agentic execution of each step
- **Codex CLI**: Three approval tiers (suggest/auto-edit/full-auto) as deterministic safety layers

**Principle**: Maximize determinism. Only invoke the LLM where human-like judgment is truly needed.

---

## Pattern 2: Context as First-Class Resource [memory] [pattern]

Every framework treats context differently, and this is often the key differentiator:

| Strategy | Frameworks | Mechanism |
|----------|-----------|-----------|
| **Minimal** | Ralph, mini-swe-agent | Keep context tiny, delegate to subagents |
| **Single-file** | AutoResearch | `train.py` IS the context |
| **Pre-hydration** | Stripe Minions | Deterministic fetch before agent loop |
| **PageRank selection** | Aider | Repo-map with graph-based relevance scoring |
| **Keyword-triggered** | OpenHands (microagents) | Lazy-load knowledge by keyword match |
| **Fork/isolate** | Claude Code, Roast | `context: fork` prevents cross-step pollution |
| **Condenser pipeline** | OpenHands | 10+ strategies, agent can request own condensation |
| **Three-layer search** | Cursor | Grep -> Semantic -> Explore Subagent (progressive) |
| **State injection** | SWE-Agent | Auto-inject current file/cwd after every action |
| **Goal ancestry** | Paperclip | Mission lineage as context |
| **Three-scope memory** | ruflo, CrewAI | Project/local/user with cross-agent transfer |

**Principle**: Context window is the scarcest resource. Aider's PageRank repo-map and Cursor's three-layer search represent the state of the art for large codebases.

---

## Pattern 3: Agent-Computer Interface (ACI) Design [pattern] [agent]

**Seen in**: SWE-Agent (coined the term), Aider, bolt.new, Lovable, Cline

How agents interact with the environment matters as much as the model:
- **SWE-Agent**: Custom LLM-friendly tools (100-line windowed viewer, concise search). Ablation studies prove this outperforms raw bash.
- **Aider**: Pluggable edit formats (diff/whole/udiff/patch) mapped per-model. Each model gets the format it's best at.
- **bolt.new**: Streaming XML parser — execute-as-you-generate with zero latency.
- **Lovable**: Explicit tool calls (`lov-write`, `lov-line-replace`) for reliability.
- **Cline**: Promise-based `ask()` pauses agent until human responds.

**Principle**: Design your tool interface for LLM consumption. The ACI is as important as the model choice.

---

## Pattern 4: Instructions-as-Code [skill] [pattern]

**Seen in**: AutoResearch, Claude Code, Stripe, ruflo, Cursor, Roo Code

Natural language instructions are becoming a programming medium:
- **AutoResearch**: `program.md` replaces all orchestration code
- **Claude Code**: CLAUDE.md + skills with YAML frontmatter
- **Stripe**: Conditional rule files scoped to subdirectories, synced across tools
- **Roo Code**: Per-mode rules directories (`.roo/rules-{slug}/`)
- **Cursor**: Per-model orchestration tuning via rule files
- **Goose**: Recipe system — shareable YAML workflows

**Warning**: CLAUDE.md compliance is unreliable (the "billion-dollar question"). Needs enforcement via hooks/validators. [hook]

---

## Pattern 5: Orchestration Metaphors [orchestration] [agent]

| Metaphor | Frameworks | Best For |
|----------|-----------|----------|
| **State Machine** | Stripe Minions, LangGraph | Predictable flows, explicit transitions |
| **Graph/DAG** | LangGraph, CrewAI Flows | Complex dependencies, parallel execution |
| **DSL/Pipeline** | Shopify Roast | Composable, type-safe workflows |
| **Company/Org** | Paperclip AI | Role-based, budget-aware teams |
| **While Loop** | Ralph, AutoResearch | Convergent iteration |
| **Swarm** | ruflo | Distributed, consensus-based |
| **Handoff** | OpenAI Agents SDK | Agent-decided routing via tool calls |
| **Mode/Persona** | Roo Code, Cursor | Context-dependent behavior switching |
| **Event Stream** | OpenHands | Append-only bus, typed events |

**Principle**: The orchestration metaphor shapes what's easy and what's hard. The strongest emerging pattern is **handoff/delegation as tool use** (seen in OpenAI, CrewAI, Claude SDK) — let the LLM decide when to delegate.

---

## Pattern 6: Safety & Sandboxing [sandbox] [pattern]

A clear hierarchy of safety mechanisms has emerged:

| Level | Mechanism | Frameworks |
|-------|-----------|-----------|
| **OS-level** | Seatbelt/Landlock/seccomp | Codex CLI, Claude Code, Cursor |
| **Container** | Docker with HTTP API | OpenHands, Devin |
| **Browser** | WebContainer (WASM) | bolt.new |
| **VM** | Full cloud VM per session | Devin, Cursor Cloud Agents |
| **Permission chain** | Multi-step evaluation | Claude SDK (5-step), Goose (4-layer pipeline) |
| **Budget** | Per-agent cost limits | Paperclip, AutoResearch (time) |
| **Approval tiers** | Graduated autonomy | Codex (3 tiers), Goose (4 modes), Cline (3 tiers) |
| **Linting gate** | Reject invalid before commit | SWE-Agent, Aider |

**Principle**: Defense in depth. The best systems layer multiple mechanisms: OS sandbox + permission chain + budget limits + linting gates.

---

## Pattern 7: The Multi-Agent Debate [orchestration] [agent]

Expanded with new data — the picture is now clearer:

**Multi-agent works when:**
- Coordination is deterministic (Stripe blueprints)
- Agents don't share mutable state (Claude SDK subagents with context isolation)
- Delegation is via tool calls, not free-form communication (OpenAI handoffs, CrewAI delegation)
- There's a clear hierarchy (Cursor: main agent -> explore subagent)

**Multi-agent fails when:**
- Agents negotiate or debate (compounding non-determinism)
- Shared state creates race conditions
- The orchestration itself is agentic (ruflo's swarm consensus)

**The emerging consensus**: Use subagents for context isolation and parallelism, but keep orchestration deterministic. OpenAI's handoff-as-tools and CrewAI's delegation-as-tools are converging on the same insight.

---

## Pattern 8: Two-Model Architecture [pattern] [agent]

**Seen in**: Aider (Architect mode), Devin (Planner/Coder/Critic), Cursor (per-model tuning)

Separate planning from execution:
- **Expensive model** plans, reasons, decides what to do
- **Cheap model** executes edits, writes code, does mechanical work
- **Critic model** reviews output before committing (Devin)

**Principle**: Not all agent work requires the same intelligence level. Route by cognitive demand.

---

## Pattern 9: Checkpointing & Time-Travel [memory] [pattern]

**Seen in**: LangGraph (version vectors), Cursor (checkpoint system), Claude SDK (session forking), OpenHands (event replay)

The ability to save, fork, and restore agent state:
- **LangGraph**: Per-node per-channel version vectors — precise re-execution determination
- **Cursor**: Checkpoint system separate from git — agent-level save/restore
- **Claude SDK**: Session forking — branch conversations to explore alternatives
- **OpenHands**: Append-only event stream enables full replay

**Principle**: Agent work is exploratory. The ability to cheaply fork, explore, and backtrack is fundamental.

---

## Pattern 10: MCP as Universal Extension [mcp] [pattern]

**Seen in**: Goose (MCP-first), Claude Code (7 extensibility layers), Cursor (marketplace), Cline, Stripe (Toolshed)

MCP is becoming the universal agent extension mechanism:
- **Goose**: Purest MCP-native — any MCP server IS an extension
- **Stripe Toolshed**: ~500 tools as centralized MCP with per-agent subsetting
- **Claude Code**: In-process MCP servers via `@tool` decorator
- **Cline**: Can self-create MCP servers on the fly
- **Cursor**: MCP marketplace with OAuth, MCP Apps for interactive UI

**Principle**: MCP is winning as the standard for agent tool integration. Build MCP-native.

---

## Top 20 Ideas Worth Stealing

### Tier 1: Proven at Scale
1. **Blueprints** (Stripe) — Deterministic + agentic state machines
2. **Repo-map with PageRank** (Aider) — Graph-based context selection
3. **Linting gate on edits** (SWE-Agent) — Reject invalid before commit
4. **MCP pre-hydration** (Stripe) — Deterministic context fetch before agent loop
5. **OS-level sandboxing** (Codex CLI) — Seatbelt/Landlock for real isolation
6. **Bounded retry with autofix-first** (Stripe) — Max 2 CI rounds

### Tier 2: Architecturally Elegant
7. **Handoff-as-tools** (OpenAI) — LLM decides when to delegate
8. **`context: fork`** (Claude Code) — Prevent context pollution
9. **Reducer-annotated state** (LangGraph) — Fields declare merge strategy
10. **Two-phase execution** (Roast) — Collect then execute with validation
11. **Event stream architecture** (OpenHands) — Append-only typed event bus
12. **Session forking** (Claude SDK) — Branch conversations to explore alternatives
13. **Three-layer search** (Cursor) — Grep -> Semantic -> Explore Subagent

### Tier 3: Novel & Promising
14. **Markdown-as-Program** (AutoResearch) — `program.md` as orchestration
15. **Company-as-orchestration** (Paperclip) — Roles, teams, budgets
16. **ReasoningBank** (ruflo) — Store/search execution trajectories
17. **WASM fast-path** (ruflo) — Bypass LLM for simple transforms
18. **Mode-scoped tool restrictions** (Roo Code) — Different personas get different tools
19. **Streaming XML parser** (bolt.new) — Execute-as-you-generate
20. **Recipe system** (Goose) — Shareable YAML workflows

---

## Anti-Patterns Identified

1. **Scope creep** — ruflo's 259 tools, Byzantine consensus for a dev tool
2. **CLAUDE.md non-compliance** — instructions get ignored, no enforcement
3. **Unbounded iteration** — agents looping forever on unsolvable problems
4. **Context window abuse** — stuffing everything in instead of managing it
5. **Marketing over substance** — unverified performance claims
6. **Free-form agent-to-agent communication** — compounding non-determinism
7. **Greenfield bias** — frameworks that only work on new codebases
8. **Over-abstraction** — building registries/renderers instead of generating code
9. **Ignoring ACI design** — giving agents raw bash instead of LLM-friendly tools
10. **Single security layer** — relying only on permissions without OS-level sandboxing

---

## Convergent Themes Across All 18 Frameworks

Three themes appear repeatedly regardless of framework philosophy:

### 1. "Simpler scaffolding wins as models improve"
mini-swe-agent (~100 LOC) matches SWE-agent. Ralph's bash loop delivers production results. AutoResearch uses just markdown + git. The trend is clear: invest in constraints and context, not orchestration complexity.

### 2. "The tool interface is the product"
SWE-Agent's ACI research proves it. Aider's edit format selection proves it. bolt.new's streaming parser proves it. The way you present tools to the LLM matters more than the framework around it.

### 3. "Context management is the hard problem"
Every framework has a different context strategy, and it's always the most engineered part. Aider's PageRank, OpenHands' condensers, Cursor's three-layer search, Claude Code's context forking — this is where the real complexity lives.

---

## Open Questions for Our Framework

1. Where on the simplicity↔complexity spectrum should we aim? (Evidence suggests: start simple, add complexity only when proven necessary)
2. How do we enforce instruction compliance? (Hooks + validators + linting gates?)
3. Can we combine blueprints (Stripe) with convergent iteration (Ralph)?
4. What's the right ACI? (SWE-Agent's research suggests custom tools >> raw bash)
5. What's the right context architecture? (Aider's PageRank + Cursor's progressive search?)
6. Should we be MCP-native from day one? (Goose and Stripe suggest yes)
7. How do we handle the "last 10%" gracefully? (Graduated autonomy like Codex's 3 tiers?)
8. Two-model architecture by default? (Aider's architect mode is compelling)
9. What checkpointing model? (LangGraph's version vectors vs. git-as-state vs. Claude SDK session forking?)
10. How do we measure success? (SWE-bench? PR merge rate? Cost per task? Human satisfaction?)
