# lazy fetch

**Minimum effort, maximum result.**

A CLI companion for [Claude Code](https://claude.ai/code) that solves three things it doesn't: **context**, **persistence**, and **process tracking**.

Built from analyzing 18 agentic coding frameworks — then extracting only the patterns that actually work.

```
lazy read       → 📖 Get up to date (git, plan, memory)
lazy plan       → 📋 Break goals into phased steps
lazy gather     → 🔍 Pre-hydrate context for Claude Code
lazy bp run     → ⚙  Execute a workflow (deterministic + agentic)
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

Plus an **MCP server** so Claude Code can call `lazy_status`, `lazy_gather`, `lazy_remember` directly as tools — no copy-paste, no switching terminals.

## Install

**One command:**

```bash
curl -fsSL https://raw.githubusercontent.com/Clemens865/Lazy-Fetch/main/install.sh | bash
```

Then in any project:

```bash
cd your-project
lazy init
```

`lazy init` scaffolds everything: `.lazy/` state directory, hooks, blueprints, slash commands, and MCP config.

<details>
<summary>Alternative: npm global install</summary>

```bash
npm install -g github:Clemens865/Lazy-Fetch
```

</details>

<details>
<summary>Alternative: manual install</summary>

```bash
git clone https://github.com/Clemens865/Lazy-Fetch.git
cd Lazy-Fetch
npm install
npm run build
npm link
```

</details>

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

### Blueprints
| Command | What it does |
|---------|-------------|
| `lazy bp list` | Show available blueprints with step icons |
| `lazy bp show <name>` | Preview a blueprint's steps before running |
| `lazy bp run <name> <input>` | Execute a blueprint |

### Persist
| Command | What it does |
|---------|-------------|
| `lazy remember <key> <value>` | Store a fact across sessions |
| `lazy recall [key]` | Retrieve stored knowledge (fuzzy search) |
| `lazy journal [entry]` | Append-only decision log |
| `lazy snapshot [name]` | Save current state (plan + memory) |

## Blueprints

YAML-defined workflows that mix **deterministic** steps (shell commands, gates) with **agentic** steps (prompts for Claude Code). Inspired by Stripe's blueprint system and Karpathy's AutoResearch loop.

```bash
lazy bp list
```
```
  add-feature          📎🤖🤖⚙🤖⚙⚙🤖📎  Full development loop with research and docs
  experiment           📎⚙⚙🤖⚙⚙🤖📎     AutoResearch-inspired: try, validate, evaluate
  fix-bug              📎⚙🤖🤖⚙⚙📎       Gather → analyze → fix → typecheck → test
  review-code          📎⚙⚙🤖🤖           Diff → typecheck → review → suggest

  Legend: ⚙ = deterministic  🤖 = agentic  📎 = other
```

### How It Works

Deterministic steps run automatically. Agentic steps return prompts for Claude Code:

```bash
lazy bp run fix-bug "login returns 500 on empty password"
```
```
  Step 1/7: gather-context (gather)     ← runs automatically
  Step 2/7: checkpoint-before (run)     ← runs automatically
  Step 3/7: analyze-bug (prompt)        ← returned to Claude Code
    → Analyze this bug: login returns 500 on empty password...
  Step 4/7: implement-fix (prompt)      ← returned to Claude Code
    → Implement the fix...
  Step 5/7: typecheck (run)             ← runs automatically, retries on failure
  Step 6/7: run-tests (run)             ← runs automatically, retries on failure
  Step 7/7: remember-fix (remember)     ← runs automatically
```

### Writing Your Own

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
- `run` — Execute a shell command. Add `gate` for retry/stop/skip on failure.
- `prompt` — Return a prompt for Claude Code to act on.
- `gather` — Run `lazy gather` with the given task description.
- `remember` — Store a key-value fact in memory.
- `gate` — Check a condition, control flow on failure.

Variables: `${input}` is replaced with the blueprint input. `${step_N_output}` contains output from step N.

## MCP Server

Lazy Fetch runs as an MCP server, giving Claude Code **15 native tools**:

```
lazy_read, lazy_plan, lazy_add, lazy_status, lazy_update, lazy_check,
lazy_context, lazy_gather, lazy_remember, lazy_recall, lazy_journal,
lazy_snapshot, lazy_blueprint_list, lazy_blueprint_show, lazy_blueprint_run
```

Configured in `.mcp.json`. Claude Code can call these directly — no terminal switching needed.

Example: Claude Code can call `lazy_gather` to find relevant files, `lazy_remember` to store a decision, and `lazy_blueprint_run` to execute a workflow — all within the conversation.

## Hooks (Autonomous Mode)

Lazy Fetch integrates with Claude Code via hooks in `.claude/settings.json`:

| Event | What happens |
|-------|-------------|
| **SessionStart** | Injects plan, memory, git state into Claude Code context |
| **PostToolUse** (Write/Edit) | TypeScript check after every code edit |
| **PreCompact** | Preserves plan + memory through context compression |
| **Stop** | Auto-journals changes, updates file access patterns |

Hooks are pre-configured. They activate on session start.

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
  runs/              # Blueprint execution logs
```

## Research

This tool was born from analyzing 18 agentic coding frameworks. The full research is in `research/`:

| Framework | Key Pattern We Took |
|-----------|-------------------|
| [Stripe Minions](research/frameworks/stripe-minions.md) | Deterministic scaffolding + agentic execution → **Blueprints** |
| [Aider](research/frameworks/aider.md) | Symbol-aware repo-map → **Context engine** |
| [SWE-Agent](research/frameworks/swe-agent.md) | ACI design, linting gate → **`lazy check`** |
| [Cursor](research/frameworks/cursor-ide.md) | Three-layer search, hooks at every phase → **Hooks** |
| [OpenHands](research/frameworks/openhands.md) | Event stream, memory condensation → **PreCompact hook** |
| [AutoResearch](research/frameworks/karpathy-autoresearch.md) | Markdown-as-program, git-as-state → **`experiment` blueprint** |
| [Ralph Loop](research/frameworks/ralph-loop-pattern.md) | Radical simplicity, convergent iteration → **Design philosophy** |
| [Claude Code](research/frameworks/claude-code-ecosystem.md) | 7-layer extensibility, context forking → **MCP + hooks** |
| [OpenAI Agents SDK](research/frameworks/openai-agents-sdk.md) | Handoff-as-tools, guardrails → **MCP tool design** |
| [Shopify Roast](research/frameworks/shopify-roast.md) | Two-phase execution → **Blueprint deterministic/agentic split** |
| [Goose](research/frameworks/devin-goose.md) | MCP-first extension model → **MCP server** |
| [CrewAI](research/frameworks/crewai.md) | Delegation as tool use → **MCP tool pattern** |

Plus 6 more. See [cross-cutting analysis](research/analysis/cross-cutting-patterns.md) for the full synthesis.

## Design Principles

1. **Simplicity wins.** mini-swe-agent (~100 LOC) matches SWE-agent's performance. We don't add complexity unless it earns its place.
2. **Context is king.** The #1 investment area, across all 18 frameworks we studied.
3. **Persistence matters.** Claude Code forgets between sessions. We don't.
4. **The loop keeps you honest.** Read → plan → implement → validate → document.
5. **Deterministic where possible, agentic where needed.** Blueprints automate everything that doesn't require judgment.

## What's Next

- [ ] Tree-sitter for AST-level symbol extraction
- [ ] Semantic search over the symbol index
- [ ] Cost tracking per task
- [ ] Blueprint chaining — one blueprint triggers another
- [ ] `lazy diff` — smart diff summary for Claude Code context

## License

MIT
