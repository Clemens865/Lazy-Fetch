# Framework Proposal: "Forge"

*Working name — an agentic coding framework that combines the best patterns from 18 frameworks analyzed.*

## Design Philosophy

Three principles derived from research:

1. **Deterministic orchestration, agentic execution** (from Stripe, SWE-Agent, Ralph)
   - The framework controls flow. The LLM controls creativity.
   - Every non-creative step is deterministic.

2. **Context is the product** (from Aider, Cursor, OpenHands)
   - The hardest problem is getting the right information to the LLM at the right time.
   - Context management is not a feature — it's the core.

3. **Start simple, earn complexity** (from mini-swe-agent, Ralph, AutoResearch)
   - 100 lines of good scaffolding beats 10,000 lines of over-engineering.
   - Every abstraction must justify itself with measured improvement.

---

## Core Architecture

### Layer 1: Agent-Computer Interface (ACI)
*Inspired by: SWE-Agent, Aider, bolt.new*

The tool interface the LLM sees. This is the most important layer.

```
┌─────────────────────────────────────────┐
│              LLM (any model)            │
├─────────────────────────────────────────┤
│           ACI Layer (tools)             │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌───────┐  │
│  │ View │ │ Edit │ │Search│ │Execute│  │
│  └──────┘ └──────┘ └──────┘ └───────┘  │
├─────────────────────────────────────────┤
│        Environment (filesystem)         │
└─────────────────────────────────────────┘
```

Key decisions:
- **Windowed file viewer** (SWE-Agent) — not raw cat, but paginated with line numbers
- **Pluggable edit formats** (Aider) — diff/whole/search-replace, selected per-model
- **Linting gate** (SWE-Agent) — reject syntactically invalid edits before they land
- **State injection** (SWE-Agent) — auto-show current file/cwd after every action

### Layer 2: Context Engine
*Inspired by: Aider (repo-map), Cursor (three-layer search), Stripe (pre-hydration), OpenHands (condensers)*

```
┌─────────────────────────────────────────┐
│            Context Budget               │
│     (token limit, managed actively)     │
├────────┬────────┬────────┬──────────────┤
│Repo Map│ Search │Pre-load│  Condenser   │
│(graph) │(3-tier)│(rules) │  (shrink)    │
└────────┴────────┴────────┴──────────────┘
```

- **Repo-map** (Aider) — tree-sitter + PageRank for intelligent context selection
- **Three-tier search** (Cursor) — fast grep -> semantic -> deep explore
- **Pre-hydration rules** (Stripe) — deterministic context loading before agent starts
- **Context condensation** (OpenHands) — pipeline of strategies to shrink when nearing limits
- **Context forking** (Claude Code) — isolate subagent context to prevent pollution

### Layer 3: Blueprints (Orchestration)
*Inspired by: Stripe (blueprints), LangGraph (state graphs), Roast (two-phase)*

```yaml
# Example blueprint: fix-bug.yaml
name: fix-bug
steps:
  - type: deterministic
    action: gather-context
    # Pre-hydrate: find relevant files, load test results, read issue

  - type: agentic
    action: analyze-and-plan
    model: opus
    # LLM analyzes the bug and proposes a fix plan

  - type: deterministic
    action: checkpoint
    # Git commit before changes

  - type: agentic
    action: implement-fix
    model: sonnet
    # LLM implements the fix (cheaper model for mechanical work)

  - type: deterministic
    action: validate
    # Lint, typecheck, run tests

  - type: gate
    condition: tests-pass
    on_fail: retry(max=2, strategy=autofix-first)
    on_success: next

  - type: deterministic
    action: create-pr
```

Key decisions:
- **YAML-defined workflows** — not code, readable by humans and agents alike
- **Deterministic + agentic node types** (Stripe) — explicit about what's automated vs. LLM-driven
- **Gate nodes** with bounded retry (Stripe) — max attempts, autofix-first strategy
- **Two-model routing** (Aider) — expensive model plans, cheap model executes
- **Checkpointing** at each step — git-based, cheap to create

### Layer 4: Safety & Permissions
*Inspired by: Claude SDK (5-step chain), Goose (4-layer pipeline), Codex (OS-level sandbox)*

```
Request → Hook(pre) → Deny rules → Mode check → Allow rules → Execute → Hook(post)
```

- **Permission evaluation chain** (Claude SDK) — hooks -> deny -> mode -> allow -> callback
- **Graduated autonomy** (Codex) — suggest / auto-edit / full-auto tiers
- **Linting gate** (SWE-Agent) — pre-commit validation
- **Budget limits** (Paperclip) — per-task token/cost caps
- **OS-level sandbox** when available (Codex) — Seatbelt/Landlock

### Layer 5: Extension (MCP-Native)
*Inspired by: Goose (MCP-first), Stripe (Toolshed), Claude Code*

```
┌─────────────────────────────────────────┐
│             Extension Hub               │
├──────────┬──────────┬───────────────────┤
│MCP Tools │  Skills  │  Hooks            │
│(any srv) │(.md def) │(pre/post/gate)    │
└──────────┴──────────┴───────────────────┘
```

- **MCP-native** (Goose) — any MCP server is an extension, no adapter needed
- **Skills as markdown** (Claude Code, ruflo) — `.md` with YAML frontmatter
- **Hook system** (Claude Code, Cursor) — pre/post tool execution interceptors
- **Per-blueprint tool subsetting** (Stripe Toolshed) — each workflow gets only the tools it needs

### Layer 6: Memory & Learning
*Inspired by: ruflo (ReasoningBank), CrewAI (composite scoring), Paperclip (goal ancestry)*

```
┌─────────────────────────────────────────┐
│           Memory System                 │
├──────────┬──────────┬───────────────────┤
│ Session  │ Project  │  Trajectory       │
│(current) │(persist) │  (learned)        │
└──────────┴──────────┴───────────────────┘
```

- **Session memory** — current conversation context
- **Project memory** — persistent across sessions (CLAUDE.md pattern)
- **Trajectory memory** (ruflo ReasoningBank) — store what worked, search before acting
- **Goal ancestry** (Paperclip) — every task knows why it exists

---

## What Makes This Different

### vs. Stripe Minions
We're open-source and model-agnostic. Stripe's blueprints are internal; ours are shareable YAML.

### vs. Aider
We add orchestration (blueprints) and multi-step workflows on top of Aider's excellent ACI and repo-map ideas.

### vs. LangGraph
We're purpose-built for coding, not general agent orchestration. Simpler API, better defaults for software engineering.

### vs. CrewAI
We reject role-playing personas in favor of tool-scoped modes (Roo Code pattern). Roles are emergent from tools, not declared.

### vs. Ralph Loop
We provide structure for teams, not just solo operators. Blueprints are shareable, reproducible, and composable.

### vs. Claude Code
We're model-agnostic and add the context engine (repo-map, pre-hydration) that Claude Code lacks.

---

## Implementation Strategy

### Phase 1: Foundation (MVP)
Minimum viable agent with the highest-impact patterns:

1. **ACI layer** — windowed viewer, search-replace edits, linting gate, state injection
2. **Simple context** — file-based context with manual selection (like early Aider)
3. **Single blueprint** — the basic "analyze -> implement -> validate" loop
4. **Git checkpointing** — commit before/after changes
5. **Bounded retry** — max 2 attempts with autofix-first

This alone matches mini-swe-agent / early Aider capability.

### Phase 2: Context Engine
The biggest differentiator:

1. **Repo-map** — tree-sitter + graph-based relevance
2. **Three-tier search** — grep -> semantic -> deep explore
3. **Context budget management** — active tracking and condensation
4. **Pre-hydration rules** — YAML-defined context loading

### Phase 3: Blueprints & Orchestration
Multi-step structured workflows:

1. **Blueprint YAML format** — deterministic + agentic nodes
2. **Gate nodes** with bounded retry
3. **Two-model routing** — plan with expensive, execute with cheap
4. **Blueprint library** — common workflows (fix-bug, add-feature, refactor, review)

### Phase 4: Extension & Memory
The ecosystem layer:

1. **MCP integration** — native MCP tool support
2. **Hook system** — pre/post interceptors
3. **Trajectory memory** — store and search execution patterns
4. **Skill definitions** — markdown-based reusable capabilities

---

## Technology Choices

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Ecosystem compatibility (Claude Code, MCP, VS Code) |
| Model interface | MCP + direct API | MCP-native for tools, direct API for LLM calls |
| Edit format | Search/Replace default | Best balance of reliability and token efficiency |
| State management | Git-based | No custom state layer needed (AutoResearch pattern) |
| Config format | YAML | Human-readable, LLM-readable, established |
| Sandbox | OS-level when available | Seatbelt (macOS) / Landlock (Linux), fallback to Docker |
| Parser | tree-sitter | Industry standard for code analysis (Aider, SWE-Agent) |

---

## Open Design Decisions (Need Input)

1. **CLI-first or library-first?** CLI is faster to ship, library enables embedding (like Claude SDK wrapping Claude Code CLI)
2. **Model-agnostic from day 1, or Claude-optimized first?** Aider supports 100+ models but is best with certain ones
3. **How opinionated on project structure?** Strict conventions (like Rails) vs. flexible (like Express)?
4. **Blueprint sharing format?** Git repos of blueprints? NPM packages? Central registry?
5. **Metric for success?** SWE-bench score? User satisfaction? Cost per task?
