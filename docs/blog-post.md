# I Analyzed 18 AI Coding Frameworks and Built a Tool From the Best Parts

I spent a week going deep on every agentic coding framework I could find. Stripe's Minions, Aider, SWE-Agent, Cursor, OpenHands, Karpathy's AutoResearch, the Ralph Loop, LangGraph, CrewAI — 18 in total. Then I extracted the patterns that actually work and built a CLI tool that embodies them.

The result is **lazy fetch** — a companion for Claude Code. The name is the philosophy: minimum effort, maximum result.

## What I learned from 18 frameworks

The research produced some surprising findings.

### Simpler scaffolding wins

Princeton's mini-swe-agent — about 100 lines of Python, just bash commands — matches the performance of their full SWE-agent framework on SWE-bench. Karpathy's AutoResearch is three files and a markdown document. Ralph Loop is literally a `while true` bash loop that delivered a $50k contract for $297 in compute.

Meanwhile, some frameworks have 259 tools, Byzantine consensus protocols, and quantum cryptography. For a dev tool.

The trend is clear: as models get smarter, the scaffolding around them matters less. What matters more is *what you feed them*.

### Context is the hard problem

Every framework's most engineered component is context management. Aider built a PageRank-based repo-map with tree-sitter. Cursor has three-layer search (grep → semantic → explore subagent). Stripe deterministically pre-hydrates context before agents even start. OpenHands has 10+ condensation strategies.

They all converge on the same insight: the context window is the scarcest resource. Treat it as a budget, not a dumping ground.

### Deterministic where possible, agentic where needed

Stripe ships 1,300 PRs per week with zero human-written code. Their secret? Agents don't run free. Blueprints (their name) define state machines where most steps are deterministic — lint, test, git operations — and only the creative steps (analyze the bug, implement the fix) are agentic.

This is the pattern that keeps appearing: don't let the LLM do things a shell script could do better.

### The multi-agent debate is settled (sort of)

Ralph Huntley calls multi-agent coordination "microservices but worse." He's not wrong — when agents need to negotiate or share mutable state, things break. But Stripe runs multi-agent at massive scale. The difference? Their agents never talk to each other. The orchestration is deterministic; only individual steps are agentic.

Multi-agent works when coordination is deterministic and agents are isolated. It fails when agents negotiate.

## What I built

**lazy fetch** is a CLI that solves three things Claude Code doesn't handle well: context, persistence, and process tracking.

### The loop

Every task follows five phases: read → plan → implement → validate → document. It's not a rigid process — it's a compass.

```
$ lazy plan "add user authentication"

  📖 [ ] Read & understand: add user authentication
  📋 [ ] Plan approach for: add user authentication
  🔨 [ ] Implement: add user authentication
  ✓  [ ] Validate: add user authentication
  📝 [ ] Document: add user authentication
```

You move through phases with `lazy done`, `lazy stuck`, `lazy next`. At any point, `lazy status` shows where you are.

### Context engine

`lazy gather "JWT token refresh"` finds everything relevant — files by name, by content, and by symbol index. It handles camelCase, snake_case, and kebab-case automatically. It outputs `@file` references you can paste into Claude Code.

`lazy context` builds a repo-map with symbol extraction for TypeScript, JavaScript, Python, Rust, Go, and Ruby. No tree-sitter dependency — regex-based, fast, zero install friction.

### Persistence

`lazy remember "auth" "bcrypt passwords, JWT 24h expiry"` stores knowledge that survives between sessions. `lazy journal "chose refresh tokens over long-lived JWTs"` keeps an append-only decision log.

Next time you open Claude Code, a SessionStart hook automatically injects your plan, memory, and git state into context. You don't have to re-explain anything.

### Blueprints

YAML-defined workflows mixing deterministic and agentic steps. Directly inspired by Stripe's blueprint system:

```yaml
steps:
  - name: gather-context
    type: gather              # deterministic — runs automatically
    task: "${input}"

  - name: implement-fix
    type: prompt              # agentic — returned to Claude Code
    prompt: "Fix: ${input}"

  - name: typecheck
    type: run                 # deterministic — runs automatically
    command: "npx tsc --noEmit"
    gate:
      on_fail: retry
      max_retries: 2
```

Four built-in blueprints: `fix-bug`, `add-feature`, `review-code`, and `experiment` (that last one is the AutoResearch loop applied to code).

### MCP server

15 tools exposed as an MCP server. Claude Code calls `lazy_gather`, `lazy_remember`, `lazy_blueprint_run` directly — no terminal switching, no copy-paste. This is the integration pattern we saw in Goose (MCP-first) and Stripe (Toolshed).

### Autonomous hooks

Four lifecycle hooks make it autonomous:
- **SessionStart**: injects plan + memory + git state
- **PostToolUse**: TypeScript check after every edit
- **PreCompact**: preserves state through context compression
- **Stop**: auto-journals changes, regenerates context

The tool runs itself. You just code.

## Dog-fooding

The best part: we used lazy fetch to improve lazy fetch. Ran the full loop — `lazy read` found the project state, `lazy plan` created phased tasks, `lazy check` revealed that tests were missing (because there were none), `lazy add` tracked the bugs we found, and `lazy done` marked them fixed.

Three bugs found and fixed:
1. `lazy check` crashed on projects with placeholder test scripts — now detects and skips them
2. `lazy plan` split sentences on commas too aggressively — now requires each part to have 2+ words
3. `lazy add` confused phase arguments with task title words — now only treats the last word as a phase if it matches a valid phase name

Then we wrote 22 smoke tests. All pass. `lazy check` now shows green.

The AutoResearch-inspired `improve` blueprint lets anyone run `lazy bp run improve auto` to trigger another iteration.

## The patterns that made it in

| Pattern | From | How we use it |
|---------|------|---------------|
| Deterministic + agentic nodes | Stripe Minions | Blueprint step types |
| Symbol-aware repo map | Aider | `lazy context` |
| Linting gate | SWE-Agent | `lazy check`, post-edit hook |
| Lifecycle hooks | Cursor | 4 autonomous hooks |
| Pre-hydration | Stripe Minions | `lazy gather` |
| Markdown-as-program | AutoResearch | `program.md` + blueprints |
| Git-as-state | AutoResearch | Blueprint checkpointing |
| Memory condensation | OpenHands | PreCompact hook |
| MCP-first extension | Goose | MCP server |
| Radical simplicity | Ralph Loop | Design philosophy |

## What I'd tell someone building an agentic tool

1. **Start with context management.** It's the highest-ROI investment. Everything else is scaffolding.
2. **Don't let agents do deterministic work.** If a shell script can do it, run the shell script.
3. **Persistence is underrated.** The gap between sessions is where knowledge dies. Bridge it.
4. **Complexity must be earned.** If 50 lines does it, don't write 500. You can always add more later.
5. **Dog-food immediately.** We found three bugs in an hour by using the tool on itself. No amount of planning finds real issues like real usage.

---

**lazy fetch** is open source: [github.com/Clemens865/Lazy-Fetch](https://github.com/Clemens865/Lazy-Fetch)

The research (18 framework analyses + cross-cutting synthesis) ships with the repo in `research/`.
