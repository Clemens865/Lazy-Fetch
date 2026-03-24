# Forge v2 — Simplified Design

> Simplicity & brilliance. Context is king. Persistence matters. Process tracking is a must.

## What Forge Is

A CLI companion for Claude Code that solves the three things Claude Code doesn't:

1. **Context** — Intelligently gather and manage what Claude Code sees
2. **Persistence** — Remember across sessions what matters
3. **Process** — Track what's happening, what's done, what's stuck

## What Forge Is NOT

- Not a replacement for Claude Code
- Not a multi-agent orchestration framework
- Not model-agnostic (Claude Code first)
- Not opinionated about your project

## Architecture

```
┌──────────────────────────────┐
│        forge CLI             │
│  ┌────────┬────────┬───────┐ │
│  │Context │Persist │Process│ │
│  │Engine  │Store   │Track  │ │
│  └────────┴────────┴───────┘ │
│         ↕ Claude Code        │
└──────────────────────────────┘
```

That's it. Three modules. One CLI.

### Context Engine
The smartest part. Answers: "What does Claude Code need to know right now?"

- `forge context` — Analyze codebase, build repo-map (tree-sitter + relevance graph)
- `forge context <query>` — Find the most relevant files/symbols for a task
- `forge gather <task>` — Pre-hydrate context: collect everything Claude Code needs before you start
- `forge watch` — Track what files Claude Code touches, learn what's relevant

Output goes to CLAUDE.md, context files, or clipboard — whatever feeds Claude Code best.

### Persist Store
Answers: "What did we learn last session?"

- `forge remember <key> <value>` — Store a fact
- `forge recall [key]` — Retrieve what matters
- `forge journal` — Append-only log of decisions, outcomes, learnings
- `forge snapshot` — Save current project state (what's done, what's planned)

Backed by simple files (markdown + JSON). No database. Git-friendly.

### Process Tracker
Answers: "Where are we? What's next? What's stuck?"

- `forge plan <goal>` — Break a goal into tracked steps
- `forge status` — Show current state of all tasks
- `forge check` — Validate: are tests passing? Lint clean? Types OK?
- `forge update <task> <status>` — Mark progress
- `forge review` — Compare current state vs. plan, flag drift

---

## Usage Flow

```bash
# Starting a new feature
forge plan "Add user authentication with JWT"
# → Creates tracked steps, gathers context, persists the plan

# Before a Claude Code session
forge gather "implement login endpoint"
# → Builds context: relevant files, dependencies, test patterns
# → Outputs to CLAUDE.md or clipboard

# During work (in another terminal)
forge status
# → Shows: Step 2/5: "implement login endpoint" — in progress
# → Tests: 3 failing, Lint: clean, Types: 2 errors

# After a session
forge update "login endpoint" done
forge remember "auth" "Using bcrypt for password hashing, JWT with 24h expiry"

# Next session
forge recall "auth"
# → "Using bcrypt for password hashing, JWT with 24h expiry"
forge status
# → Step 3/5: "add token refresh" — next up
forge gather "add token refresh"
```

---

## Implementation Plan

### Phase 1: Skeleton + Process Tracker
The process tracker is the most immediately useful.

- CLI scaffold (TypeScript, single binary)
- `forge plan` / `forge status` / `forge update` / `forge check`
- Simple markdown-backed task storage
- `forge check` runs: test suite, linter, typecheck (auto-detected)

### Phase 2: Persist Store
Memory across sessions.

- `forge remember` / `forge recall` / `forge journal`
- File-backed (`.forge/` directory)
- `forge snapshot` for project state capture

### Phase 3: Context Engine
The hard and brilliant part.

- `forge context` — tree-sitter repo map
- `forge gather` — task-aware context collection
- `forge watch` — learn from file access patterns
- Integration with CLAUDE.md for seamless Claude Code feeding

---

## File Structure

```
.forge/
  plan.md          # Current plan with task states
  journal.md       # Append-only decision log
  memory.json      # Key-value persist store
  context/
    repo-map.json  # Cached repo structure
    snapshots/     # Project state snapshots
```

No config files needed to start. `forge init` is optional.
