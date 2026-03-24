# Lazy Fetch — Complete Reference

**Minimum effort, maximum result.**

A CLI companion for Claude Code that solves three things Claude Code doesn't: **context**, **persistence**, and **process tracking**. Plus an MCP server for native integration and a blueprint engine for reusable workflows.

Born from analyzing 18 agentic coding frameworks — Stripe Minions, Aider, SWE-Agent, OpenHands, Cursor, and more — and extracting the patterns that actually matter.

---

## Install

```bash
git clone https://github.com/Clemens865/Lazy-Fetch.git
cd Lazy-Fetch
npm install && npm run build
npm link   # makes `lazy` available globally
```

For the MCP server, update the `cwd` path in `.mcp.json` to your clone location.

---

## Architecture

Lazy Fetch has five components:

```
┌─────────────────────────────────────────────────┐
│                  lazy CLI                        │
│  ┌──────────┬──────────┬──────────┬───────────┐ │
│  │ Context  │ Process  │ Persist  │ Blueprint │ │
│  │ Engine   │ Tracker  │ Store    │ Engine    │ │
│  └──────────┴──────────┴──────────┴───────────┘ │
│         ↕ MCP Server (15 tools)                  │
│         ↕ Hooks (4 lifecycle events)             │
│         ↕ Claude Code                            │
└─────────────────────────────────────────────────┘
```

1. **Context Engine** — Repo-map, symbol index, file search, context gathering
2. **Process Tracker** — Phased plans (read/plan/implement/validate/document)
3. **Persist Store** — Key-value memory, decision journal, snapshots
4. **Blueprint Engine** — YAML workflows mixing deterministic + agentic steps
5. **Integration Layer** — MCP server (15 tools) + hooks (4 lifecycle events)

---

## The Loop

Every task follows five phases:

```
📖 read → 📋 plan → 🔨 implement → ✓ validate → 📝 document
```

This isn't a rigid process — it's a compass. Each task gets auto-assigned to a phase. `lazy status` shows where you are. `lazy check` tells you if things are healthy. The loop keeps you oriented.

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

Phase auto-inference from keywords:
- `read/understand/review/explore/analyze/research` → 📖 read
- `plan/design/architect/spec/define` → 📋 plan
- `implement/build/code/create/add/write/fix` → 🔨 implement
- `test/validate/check/verify/lint` → ✓ validate
- `doc/document/readme/explain` → 📝 document

### Managing Context

```bash
lazy context                 # Repo map: file tree + symbol index
lazy context "auth"          # Search files, content, AND symbols for "auth"
lazy gather "JWT token refresh"  # Find everything relevant to a task
lazy watch                   # Learn which files matter from git history
lazy claudemd                # Generate .lazy/CONTEXT.md for Claude Code
```

**`lazy context`** builds a lightweight repo-map. It extracts symbols (functions, classes, types, interfaces) from TypeScript, JavaScript, Python, Rust, Go, and Ruby using regex patterns. Shows file tree + key symbols per file.

**`lazy gather`** is the power move. Give it a task description and it:
1. Extracts keywords from the task description
2. Searches file names for matches
3. Searches file contents via grep
4. Searches the symbol index for matching function/class/type names
5. Outputs `@file` references you can paste into Claude Code

**`lazy watch`** analyzes git history to learn which files change most frequently — these are likely the files you'll need context for.

**`lazy claudemd`** generates a context file containing:
- Project overview and symbol map
- Current plan and progress
- Persistent memory
- Frequently changed files (from `lazy watch`)

Use it with `@.lazy/CONTEXT.md` in Claude Code, or copy sections into your CLAUDE.md.

### Blueprints

Reusable workflows that mix deterministic and agentic steps:

```bash
lazy bp list                              # Show available blueprints
lazy bp show fix-bug                      # Preview steps before running
lazy bp run fix-bug "login returns 500"   # Execute it
lazy bp run experiment "try WebSocket"    # Shorthand
```

**Built-in blueprints:**

#### `fix-bug` — Find and fix a bug with validation
```
📎 gather-context     → Find relevant files automatically
⚙ checkpoint-before  → Git stash for safety
🤖 analyze-bug        → Claude Code analyzes root cause
🤖 implement-fix      → Claude Code implements the fix
⚙ typecheck          → Run tsc --noEmit (retry up to 2x)
⚙ run-tests          → Run npm test (retry up to 2x)
📎 remember-fix       → Store what was fixed
```

#### `add-feature` — Full development loop
```
📎 gather-context     → Find relevant files
🤖 research           → Claude Code researches what's needed
🤖 plan-approach      → Claude Code plans the implementation
⚙ checkpoint         → Git stash for safety
🤖 implement          → Claude Code builds it
⚙ typecheck          → Validate types (retry 2x)
⚙ run-tests          → Validate tests (skip on fail)
🤖 document           → Claude Code updates docs
📎 remember-feature   → Store what was added
```

#### `experiment` — AutoResearch-inspired try/evaluate loop
```
📎 gather-context          → Find relevant files
⚙ create-branch           → git checkout -b experiment/...
⚙ snapshot-before         → Commit checkpoint
🤖 implement-experiment    → Claude Code tries the idea
⚙ typecheck               → Must pass (stops on fail)
⚙ run-tests               → Must pass (stops on fail)
🤖 evaluate                → Claude Code: keep, iterate, or discard?
📎 remember-result         → Store what was learned
```

#### `review-code` — Quality review
```
📎 gather-context     → Find relevant files
⚙ check-diff         → Show recent git changes
⚙ typecheck          → Check types (skip on fail)
🤖 review             → Claude Code reviews for bugs, security, performance
🤖 suggest            → Claude Code suggests improvements
```

#### Writing Your Own

Create a `.yaml` file in `blueprints/`:

```yaml
name: my-workflow
description: What this workflow does
input: What the user provides

steps:
  - name: gather-context
    type: gather
    task: "${input}"

  - name: do-the-thing
    type: prompt
    prompt: "Do this: ${input}. Be specific and minimal."

  - name: validate
    type: run
    command: "npm test"
    gate:
      on_fail: retry
      max_retries: 2

  - name: save-result
    type: remember
    key: "result"
    value: "Completed: ${input}"
```

**Step types:**

| Type | What it does | Runs automatically? |
|------|-------------|-------------------|
| `run` | Execute a shell command | Yes |
| `prompt` | Return instruction for Claude Code | No — returned as output |
| `gather` | Run `lazy gather` with a task | Yes |
| `remember` | Store a key-value in memory | Yes |
| `gate` | Check a condition | Yes |

**Gate options:** `on_fail: retry` (with `max_retries`), `on_fail: stop`, `on_fail: skip`

**Variables:** `${input}` = blueprint input. `${step_N_output}` = output from step N. `${step_N_error}` = error from step N.

Blueprint runs are logged to `.lazy/runs/` for review.

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

## MCP Server

Lazy Fetch runs as an MCP server, exposing **15 tools** that Claude Code can call directly:

| Tool | Maps to |
|------|---------|
| `lazy_read` | `lazy read` |
| `lazy_plan` | `lazy plan` |
| `lazy_add` | `lazy add` |
| `lazy_status` | `lazy status` |
| `lazy_update` | `lazy update` |
| `lazy_check` | `lazy check` |
| `lazy_context` | `lazy context` |
| `lazy_gather` | `lazy gather` |
| `lazy_remember` | `lazy remember` |
| `lazy_recall` | `lazy recall` |
| `lazy_journal` | `lazy journal` |
| `lazy_snapshot` | `lazy snapshot` |
| `lazy_blueprint_list` | `lazy bp list` |
| `lazy_blueprint_show` | `lazy bp show` |
| `lazy_blueprint_run` | `lazy bp run` |

Configured in `.mcp.json`. Claude Code calls these as native tools — no terminal switching, no copy-paste.

---

## Hooks (Autonomous Mode)

Hooks in `.claude/settings.json` make lazy fetch autonomous:

| Event | Hook | What happens |
|-------|------|-------------|
| **SessionStart** | `session-start.sh` | Runs `lazy watch` + `lazy claudemd`, injects plan + memory + git state into Claude Code context |
| **PostToolUse** (Write/Edit) | `post-edit-check.sh` | TypeScript check after every code edit, warns about errors |
| **PreCompact** | `pre-compact.sh` | Snapshots state, injects plan + memory so they survive context compression |
| **Stop** | `session-stop.sh` | Auto-journals changed files, updates access patterns, regenerates context |

The lifecycle:
```
Session opens → context auto-loaded
    ↓
Code edited → types checked
    ↓
Context compacts → state preserved
    ↓
Session ends → changes logged, context regenerated
```

---

## File Structure

```
.lazy/
  plan.json            # Machine-readable plan
  plan.md              # Human-readable plan (auto-generated)
  memory.json          # Key-value persistent store
  journal.md           # Append-only decision log
  CONTEXT.md           # Generated context for Claude Code
  context/
    symbols.json       # Cached symbol index
    access.json        # File access patterns from git
  snapshots/           # Point-in-time state captures
  runs/                # Blueprint execution logs

blueprints/            # YAML workflow definitions
  fix-bug.yaml
  add-feature.yaml
  review-code.yaml
  experiment.yaml

hooks/                 # Hook scripts for Claude Code integration
  session-start.sh
  post-edit-check.sh
  pre-compact.sh
  session-stop.sh
```

No config needed. `lazy init` is optional — commands auto-create `.lazy/` when needed.

---

## Design Principles

These emerged from analyzing 18 frameworks:

1. **Simplicity wins.** mini-swe-agent (~100 lines) matches SWE-agent's performance. Ralph's bash loop delivers $50k contracts for $297. We don't add complexity unless it earns its place.

2. **Context is king.** Every framework's most engineered component is context management. Aider's PageRank repo-map, Cursor's three-layer search, Stripe's MCP pre-hydration — they all invest here. So do we.

3. **Persistence matters.** Claude Code forgets between sessions. We don't.

4. **The loop keeps you honest.** Read → plan → implement → validate → document. Not every task needs all five, but knowing which phase you're in prevents drift.

5. **Deterministic where possible, agentic where needed.** Blueprints automate everything that doesn't require judgment. The LLM only runs where human-like creativity is needed.

---

## What This Is Built On

Research from 18 frameworks distilled into what works:

| Pattern | Source | How We Use It |
|---------|--------|---------------|
| Deterministic + agentic nodes | Stripe Minions | Blueprint step types (run vs. prompt) |
| Symbol-aware repo map | Aider | `lazy context` symbol extraction |
| ACI design, linting gate | SWE-Agent | `lazy check`, post-edit typecheck hook |
| Three-layer search, hooks | Cursor | Context engine + 4 lifecycle hooks |
| Memory condensation | OpenHands | PreCompact hook preserves state |
| Markdown-as-program, git-as-state | AutoResearch | `experiment` blueprint, git checkpointing |
| Radical simplicity | Ralph Loop | Design philosophy |
| 7-layer extensibility | Claude Code | MCP + hooks + skills integration |
| Handoff-as-tools | OpenAI Agents SDK | MCP tool design |
| Two-phase execution | Shopify Roast | Blueprint gather-then-act pattern |
| MCP-first extension | Goose | MCP server as primary integration |
| Delegation as tool use | CrewAI | Blueprint prompt steps |
| Pre-hydration | Stripe Minions | `lazy gather` pre-loads context |
| Decision logging | AutoResearch | `lazy journal` append-only log |
| File access learning | Cursor | `lazy watch` git history analysis |
| Bounded retry | Stripe Minions | Blueprint gate with max_retries |

Full research available in `research/frameworks/` (18 analyses) and `research/analysis/cross-cutting-patterns.md`.

---

## What's Next

- [ ] Tree-sitter for AST-level symbol extraction
- [ ] Semantic search over the symbol index
- [ ] Cost tracking per task
- [ ] Blueprint chaining — one blueprint triggers another
- [ ] `lazy diff` — smart diff summary for Claude Code context

---

## Quick Start

```bash
# Install
git clone https://github.com/Clemens865/Lazy-Fetch.git
cd Lazy-Fetch && npm install && npm run build && npm link

# Start a new session
lazy read

# Plan your work
lazy plan "refactor the payment module"

# Get context for the first task
lazy gather "understand payment module structure"

# Or run a full blueprint
lazy bp run add-feature "payment module refactor"

# Track progress manually
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
