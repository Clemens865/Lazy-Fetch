# lazy fetch

**Minimum effort, maximum result.**

A CLI companion for [Claude Code](https://claude.ai/code) that solves three things it doesn't: **context**, **persistence**, and **process tracking**.

Built from analyzing 18 agentic coding frameworks — then extracting only the patterns that actually work.

```
lazy read       → 📖 Get up to date (git, plan, memory)
lazy plan       → 📋 Break goals into phased steps
lazy gather     → 🔍 Pre-hydrate context for Claude Code
lazy check      → ✓  Validate: tests, types, plan progress
lazy remember   → 🧠 Persist knowledge across sessions
```

---

## Why

Every Claude Code session starts the same way: you re-explain context, forget what you decided last time, and lose track of where you are.

Lazy Fetch fixes this with **hooks that run automatically**:
- **Session starts** → plan, memory, and git state injected into context
- **Code edited** → types checked immediately
- **Context compacts** → plan and memory preserved through compression
- **Session ends** → changes logged, context regenerated for next time

## Install

```bash
git clone https://github.com/YOUR_USERNAME/lazy-fetch.git
cd lazy-fetch
npm install
npm run build
npm link        # makes `lazy` available globally
```

## The Loop

Every task follows five phases. You don't have to use all five — but knowing where you are prevents drift.

```
📖 read → 📋 plan → 🔨 implement → ✓ validate → 📝 document
```

```bash
# Start a session — what changed? where are we?
lazy read

# Plan your work — auto-creates phased tasks
lazy plan "add user authentication with JWT"

# Get context for Claude Code
lazy gather "implement login endpoint"

# Track progress
lazy update "implement" active
lazy update "implement" done

# Validate
lazy check

# Persist knowledge for next time
lazy remember "auth" "bcrypt passwords, JWT 24h expiry, refresh tokens"
lazy journal "Chose refresh tokens over long-lived JWTs for security"
```

## Commands

### The Loop
| Command | What it does |
|---------|-------------|
| `lazy read` | Git status, plan progress, stored memory — everything you need to start |
| `lazy plan <goal>` | Break a goal into 5 phased tasks (read/plan/implement/validate/document) |
| `lazy add <task> [phase]` | Append a task to the plan (phase auto-inferred from wording) |
| `lazy status` | Phase-grouped view with ◄ current phase indicator |
| `lazy update <task> <status>` | Mark progress: `todo`, `active`, `done`, `stuck` |
| `lazy check` | Run tests, lint, typecheck — plus plan progress |

### Context
| Command | What it does |
|---------|-------------|
| `lazy context` | Repo map with file tree and symbol index |
| `lazy context <query>` | Search files, content, and symbols in one shot |
| `lazy gather <task>` | Find all relevant files for a task, output as `@file` references |
| `lazy watch` | Learn which files matter from git history |
| `lazy claudemd` | Generate `.lazy/CONTEXT.md` for Claude Code |

### Persist
| Command | What it does |
|---------|-------------|
| `lazy remember <key> <value>` | Store a fact across sessions |
| `lazy recall [key]` | Retrieve stored knowledge (fuzzy search) |
| `lazy journal [entry]` | Append-only decision log |
| `lazy snapshot [name]` | Save current state (plan + memory) |

## Hooks (Autonomous Mode)

Lazy Fetch integrates with Claude Code via hooks in `.claude/settings.json`:

| Event | What happens |
|-------|-------------|
| **SessionStart** | Injects plan, memory, git state into Claude Code context |
| **PostToolUse** (Write/Edit) | TypeScript check after every code edit |
| **PreCompact** | Preserves plan + memory through context compression |
| **Stop** | Auto-journals changes, updates file access patterns |

Hooks are pre-configured. They activate on next session start.

## Symbol Index

`lazy context` and `lazy gather` extract symbols (functions, classes, types, interfaces) from:

- TypeScript / JavaScript
- Python
- Rust
- Go
- Ruby

Currently regex-based (fast, zero dependencies). Inspired by [Aider's repo-map](https://aider.chat/docs/repomap.html).

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
    access.json      # File access patterns
  snapshots/         # Point-in-time state captures
```

## Research

This tool was born from analyzing 18 agentic coding frameworks. The full research is in `research/`:

| Framework | Key Pattern We Took |
|-----------|-------------------|
| [Stripe Minions](research/frameworks/stripe-minions.md) | Deterministic scaffolding + agentic execution |
| [Aider](research/frameworks/aider.md) | Symbol-aware repo-map for context selection |
| [SWE-Agent](research/frameworks/swe-agent.md) | ACI design, linting gate, "simpler wins" |
| [Cursor](research/frameworks/cursor-ide.md) | Three-layer search, hooks at every phase |
| [OpenHands](research/frameworks/openhands.md) | Event stream, memory condensation |
| [AutoResearch](research/frameworks/karpathy-autoresearch.md) | Markdown-as-program, git-as-state |
| [Ralph Loop](research/frameworks/ralph-loop-pattern.md) | Radical simplicity, convergent iteration |
| [Claude Code](research/frameworks/claude-code-ecosystem.md) | 7-layer extensibility, context forking |
| [OpenAI Agents SDK](research/frameworks/openai-agents-sdk.md) | Handoff-as-tools, guardrails |
| [Shopify Roast](research/frameworks/shopify-roast.md) | Two-phase execution with pre-flight validation |

Plus 8 more. See [cross-cutting analysis](research/analysis/cross-cutting-patterns.md) for the full synthesis.

## Design Principles

1. **Simplicity wins.** mini-swe-agent (~100 LOC) matches SWE-agent's performance. We don't add complexity unless it earns its place.
2. **Context is king.** The #1 investment area, across all 18 frameworks we studied.
3. **Persistence matters.** Claude Code forgets between sessions. We don't.
4. **The loop keeps you honest.** Read → plan → implement → validate → document.

## What's Next

- [ ] Tree-sitter for AST-level symbol extraction
- [ ] Semantic search over the symbol index
- [ ] Blueprint workflows (YAML-defined deterministic + agentic steps)
- [ ] MCP server — expose lazy fetch as tools Claude Code calls directly
- [ ] Cost tracking per task

## License

MIT
