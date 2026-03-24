# Lazy Fetch

**Minimum effort, maximum result.**

A CLI companion for Claude Code that solves three things Claude Code doesn't: **context**, **persistence**, and **process tracking**.

Born from analyzing 18 agentic coding frameworks — Stripe Minions, Aider, SWE-Agent, OpenHands, Cursor, and more — and extracting the patterns that actually matter.

---

## Install

```bash
git clone <repo>
cd Agentic-Coding-Framework
npm install && npm run build
npm link   # makes `lazy` available globally
```

## The Idea

Every Claude Code session starts the same way: you re-explain context, forget what you decided last time, and lose track of where you are. Lazy Fetch fixes this with three modules and one development loop.

### The Loop

```
📖 read → 📋 plan → 🔨 implement → ✓ validate → 📝 document
```

This isn't a rigid process — it's a compass. Each task you create gets auto-assigned to a phase. `lazy status` shows where you are. `lazy check` tells you if things are healthy. The loop keeps you oriented.

---

## Commands

### Getting Oriented

```bash
lazy read                    # What changed? Where are we? What do we know?
lazy status                  # Full plan view, grouped by phase
lazy check                   # Tests passing? Types clean? Plan on track?
```

`lazy read` is the first thing you run in a new session. It shows:
- Git branch, recent commits, uncommitted changes
- Plan progress and current phase
- Stored memory from previous sessions

### Planning Work

```bash
lazy plan "add user authentication"
# Creates 5 phased tasks automatically:
#   📖 Read & understand: add user authentication
#   📋 Plan approach for: add user authentication
#   🔨 Implement: add user authentication
#   ✓  Validate: add user authentication
#   📝 Document: add user authentication

lazy plan "fix login bug, add rate limiting, write tests"
# Multiple goals → one task per item, phases auto-inferred

lazy add "add JWT token refresh" implement
# Append a task to the current plan (phase optional, auto-inferred from wording)

lazy update "authentication" active     # Mark a task as in-progress
lazy update "authentication" done       # Mark it done → shows "next up"
lazy update "rate limiting" stuck       # Flag a blocker

lazy plan --reset                       # Clear the plan, start fresh
```

### Managing Context

```bash
lazy context                 # Repo map: file tree + symbol index
lazy context "auth"          # Search files, content, AND symbols for "auth"
lazy gather "JWT token refresh"  # Find everything relevant to a task
lazy watch                   # Learn which files matter from git history
lazy claudemd                # Generate .lazy/CONTEXT.md for Claude Code
```

**`lazy context`** builds a lightweight repo-map inspired by Aider's PageRank approach (but simpler). It extracts symbols (functions, classes, types, interfaces) from TypeScript, JavaScript, Python, Rust, Go, and Ruby using regex patterns.

**`lazy gather`** is the power move. Give it a task description and it:
1. Extracts keywords
2. Searches file names
3. Searches file contents (grep)
4. Searches the symbol index
5. Outputs `@file` references you can paste into Claude Code

**`lazy claudemd`** generates a context file containing:
- Project overview and symbol map
- Current plan and progress
- Persistent memory
- Frequently changed files (from `lazy watch`)

Use it with `@.lazy/CONTEXT.md` in Claude Code, or copy sections into your CLAUDE.md.

### Persisting Knowledge

```bash
lazy remember "auth" "Using bcrypt for passwords, JWT with 24h expiry"
lazy remember "db" "PostgreSQL with Prisma ORM, migrations in /prisma"
lazy recall                  # Show all stored knowledge
lazy recall "auth"           # Fuzzy search stored facts

lazy journal "Decided to use refresh tokens instead of long-lived JWTs"
lazy journal                 # Read the full decision log

lazy snapshot "pre-refactor" # Save current state (plan + memory)
```

**Memory** persists across sessions. Simple key-value, stored in `.lazy/memory.json`.

**Journal** is append-only — a timestamped log of decisions and learnings. Never edited, always growing.

**Snapshots** capture plan + memory at a point in time. Useful before big changes.

---

## File Structure

```
.lazy/
  plan.json          # Machine-readable plan
  plan.md            # Human-readable plan (auto-generated)
  memory.json        # Key-value persistent store
  journal.md         # Append-only decision log
  CONTEXT.md         # Generated context for Claude Code
  context/
    symbols.json     # Cached symbol index
    access.json      # File access patterns from git
  snapshots/
    pre-refactor.json
```

No config needed. `lazy init` is optional — commands auto-create `.lazy/` when needed.

---

## Design Principles

These emerged from analyzing 18 frameworks:

1. **Simplicity wins.** mini-swe-agent (~100 lines) matches SWE-agent's performance. Ralph's bash loop delivers $50k contracts for $297. We don't add complexity unless it earns its place.

2. **Context is king.** Every framework's most engineered component is context management. Aider's PageRank repo-map, Cursor's three-layer search, Stripe's MCP pre-hydration — they all invest here. So do we.

3. **Persistence matters.** Claude Code forgets between sessions. We don't.

4. **The loop keeps you honest.** Read → plan → implement → validate → document. Not every task needs all five, but knowing which phase you're in prevents drift.

---

## What This Is Built On

Research from 18 frameworks distilled into what works:

| Pattern | Source | How We Use It |
|---------|--------|---------------|
| Symbol-aware repo map | Aider | `lazy context` extracts functions/classes/types |
| Pre-hydration | Stripe Minions | `lazy gather` collects context before you start |
| Development phases | SWE-Agent, Stripe | The read→plan→implement→validate→document loop |
| Persistent memory | Claude Code ecosystem | `lazy remember` / `lazy recall` |
| File access learning | Cursor | `lazy watch` tracks git change patterns |
| Context generation | Claude Code | `lazy claudemd` generates structured context |
| Linting gate | SWE-Agent | `lazy check` validates before you move on |
| Decision logging | AutoResearch | `lazy journal` keeps an append-only record |

Full research available in `research/frameworks/` (18 analyses) and `research/analysis/cross-cutting-patterns.md`.

---

## What's Next

- **Tree-sitter integration** for AST-level symbol extraction (currently regex-based)
- **Semantic search** over the symbol index
- **Blueprint workflows** — YAML-defined sequences of deterministic + agentic steps (inspired by Stripe)
- **MCP server** — expose lazy fetch as tools Claude Code can call directly
- **Cost tracking** — log token usage per task

---

## Quick Start

```bash
# Start a new session
lazy read

# Plan your work
lazy plan "refactor the payment module"

# Get context for the first task
lazy gather "understand payment module structure"

# Start working with Claude Code, then track progress
lazy update "read" done
lazy update "plan" done

# Store decisions as you go
lazy remember "payments" "Switched from Stripe to PayPal SDK"
lazy journal "PayPal SDK has better webhook handling for our use case"

# Validate before wrapping up
lazy check

# Generate fresh context for the next session
lazy claudemd
```
