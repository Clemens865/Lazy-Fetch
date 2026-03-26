<p align="center">
  <img src="assets/banner.png" alt="lazy fetch — minimum effort, maximum result" width="400" />
</p>

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
lazy contract   → 📝 Define testable success criteria before building
lazy eval       → 🧪 Skeptical QA: test against contract, grade, report
lazy remember   → 🧠 Persist knowledge across sessions
lazy secure     → 🔒 Security audit: secrets, injection, auth, deps
lazy doc        → 📄 Auto-generated docs: plan, sprints, validation, screenshots
lazy yolo       → 🚀 Autonomous mode: PRD → sprints → done
lazy selftest   → 🔬 Verify everything works (22 built-in tests)
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
lazy init              # Fresh project
lazy init --scan       # Existing project — auto-detects stack, commands, git history
```

`lazy init` scaffolds everything: `.lazy/` state directory, hooks, blueprints, slash commands, MCP config, and a `CLAUDE.md` that teaches Claude Code how to use lazy-fetch automatically.

**Joining an existing project?** Use `--scan` to bootstrap lazy-fetch with intelligence from the codebase:

```
$ lazy init --scan

  Scanning project...
  ─────────────────────────────────────────
  Stack: TypeScript, Node.js, Next.js 16, React, Supabase, Tailwind CSS
  Build: npm run build
  Lint:  npm run lint
  Entry: src/app/layout.tsx, src/app/page.tsx

  Git:
    Branch: main
    Last commit: 2 hours ago
    Active files: src/lib/api.ts, src/app/page.tsx, ...

  Symbols indexed: 171
  Scan complete: 11 facts stored in memory
```

You can also re-scan anytime with `lazy scan`.

**Keeping up to date:**

```bash
lazy upgrade               # Update lazy-fetch itself from GitHub
lazy init --update         # Refresh hooks, commands, blueprints in your project
```

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

## Yolo Mode

Two ways to start. A PRD file, or just a one-liner:

```bash
# From a PRD
lazy yolo PRD.md

# From a one-liner — AI planner expands into full PRD first
lazy yolo "Build a 2D retro game maker with level editor and sprite tools"
```

Both produce the same result: an autonomous sprint-by-sprint build with validation gates, security checks, sprint contracts, and documentation — until the whole thing is done.

### One-Liner Mode

Inspired by [Anthropic's harness design research](https://www.anthropic.com/engineering/harness-design-long-running-apps): a senior product architect planner expands your idea into a comprehensive PRD with features, data models, tech stack, design direction, and phased roadmap. Then yolo mode executes it.

The planner is opinionated:
- **Ambitious** — builds something a real user would want, not a toy
- **Product-focused** — high-level design, not implementation details (those cascade errors)
- **Context-aware** — reads your existing stack, entry points, and memory
- **Phase-structured** — MVP first, then expansion, each phase independently useful

### How It Works

1. **Plans** (one-liner mode) — AI planner generates a full PRD from your idea
2. **Parses** — `##` headings become sprints, bullet points become tasks
3. **Contracts** — testable success criteria auto-generated per sprint
4. **Builds** — Claude Code implements sprint by sprint using blueprints
5. **Validates** — typecheck + tests + security gate + contract evaluation
6. **Documents** — sprint archives, validation log, screenshots auto-generated
7. **Advances** — passes all gates → next sprint. Fails → retries (max 3), then pauses

### Commands

```bash
lazy yolo <prd-file>              # Start from a PRD file
lazy yolo "<idea>"                # Start from a one-liner (AI planner first)
lazy yolo <prd-file> --dry-run    # Preview sprint plan without writing state
lazy yolo status                  # Show current sprint progress
lazy yolo report                  # Quality scorecard after completion
lazy yolo resume                  # Resume a paused/failed session
lazy yolo reset                   # Clear yolo state and start over
```

### Example PRD

```markdown
# Task Tracker CLI

A command-line task tracker built with TypeScript.

## Setup & Foundation
- Initialize Node.js project with TypeScript
- Define core types: Task, Priority, Status
- Set up CLI entry point

## Core Features
- Implement `add` command with priority flag
- Implement `list` command with formatted output
- Implement `done` command to mark tasks complete
- Store tasks in a local JSON file

## Testing & Polish
- Add unit tests for task operations
- Add input validation and error messages
- Handle edge cases
```

Running `lazy yolo PRD.md` on this creates 3 sprints with those exact tasks, then Claude Code builds the whole thing autonomously.

## Claude Code Integration

After `lazy init`, Claude Code **automatically knows about lazy-fetch** and **proactively uses it**. A `CLAUDE.md` section is injected that teaches Claude three levels of behavior:

### Automatic Actions (no prompting needed)

Claude will do these without being asked:

| Trigger | Claude does |
|---------|------------|
| Session starts | Calls `lazy_read` to load context |
| Before implementing | Calls `lazy_contract` to define "done" |
| After code changes | Calls `lazy_check` (typecheck + tests + security) |
| After implementing | Calls `lazy_eval` for skeptical QA against contract |
| Architectural decision | Calls `lazy_remember` to persist it |
| Task complete | Calls `lazy_done` to mark progress |
| Empty memory (first session) | Calls `lazy scan` to bootstrap from codebase |

### Pattern Recognition

Claude maps what you say to the right tool:

| You say | Claude does |
|---------|------------|
| "The login page throws a 500" | Runs `fix-bug` blueprint automatically |
| "Add user authentication" | Runs `add-feature` blueprint |
| "Where are we?" | Shows `lazy status` then `lazy next` |
| "Does it work?" | Runs `lazy check` then `lazy eval` |
| "Is it secure?" | Runs `lazy secure` for full audit |

### Standard Loop

Every task follows: **gather → contract → implement → check → eval → done**. You don't have to remember this — Claude follows it automatically.

## The Loop

Every task follows five phases. You don't have to use all five — but knowing where you are prevents drift.

```
📖 read → 📋 plan → 🔨 implement → ✓ validate → 📝 document
```

```bash
# Start a session — what changed? where are we?
lazy read

# Plan from a goal (auto-generates 5-phase tasks)
lazy plan "add user authentication with JWT"

# Or plan from a file (import your own task list)
lazy plan --file tasks.md

# Get context for Claude Code
lazy gather "implement login endpoint"

# Track progress (by name or number)
lazy done 3
lazy update "implement" active

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
| `lazy plan --file <file>` | Import tasks from a bullet-point markdown file |
| `lazy plan --reset` | Archive the current plan and start fresh |
| `lazy add <task> [phase]` | Append a task to the plan (phase auto-inferred from wording) |
| `lazy status` | Phase-grouped view with numbered tasks and ◄ current phase |
| `lazy update <task> <status>` | Mark progress: `todo`, `active`, `done`, `stuck` |
| `lazy done <task or #>` | Mark done by name, partial match, or task number |
| `lazy stuck <task or #>` | Mark stuck by name or number |
| `lazy next` | Show the next task and gather context for it |
| `lazy check` | Run tests, lint, typecheck — plus plan progress |
| `lazy remove <task or #>` | Delete a task by name or number |

### Context
| Command | What it does |
|---------|-------------|
| `lazy context` | Repo map with file tree and symbol index (also regenerates `.lazy/CONTEXT.md`) |
| `lazy context <query>` | Search files, content, and symbols in one shot |
| `lazy gather <task>` | Find relevant files for a task (respects `.gitignore`) |
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

### Evaluate
| Command | What it does |
|---------|-------------|
| `lazy contract <title>` | Generate testable success criteria for a task/sprint |
| `lazy contract` | List existing contracts |
| `lazy eval` | Evaluate work against active contract (returns QA prompt) |

### Yolo
| Command | What it does |
|---------|-------------|
| `lazy yolo <prd-file>` | Parse PRD into sprints, start autonomous execution |
| `lazy yolo "<idea>"` | One-liner → AI planner → PRD → sprints → done |
| `lazy yolo <prd> --dry-run` | Preview sprint plan without writing state |
| `lazy yolo status` | Current sprint progress and overview |
| `lazy yolo report` | Run scorecard: process quality, build quality, per-sprint timing |
| `lazy yolo resume` | Resume a paused or failed yolo session |
| `lazy yolo reset` | Clear yolo state |

### Documentation
| Command | What it does |
|---------|-------------|
| `lazy doc` | Show documentation overview |
| `lazy doc plan` | Show auto-generated plan document |
| `lazy doc validation` | Show validation log (appended on every `lazy check`) |
| `lazy doc screenshot <url>` | Capture a Playwright screenshot for frontend validation |

### Security
| Command | What it does |
|---------|-------------|
| `lazy secure` | Full security audit: secrets, injection, auth, deps (23 rules) |
| `lazy secure --gate` | Quick check — critical + high only, for CI/yolo gates |

### Validate
| Command | What it does |
|---------|-------------|
| `lazy selftest` | Run all self-validation checks (22 tests in isolated temp dir) |
| `lazy selftest --quick` | Skip git and yolo tests (17 tests, ~20ms) |
| `lazy selftest --report` | Output JSON metrics to `.lazy/selftest-report.json` |

### Other
| Command | What it does |
|---------|-------------|
| `lazy init` | Initialize `.lazy/` with full scaffolding |
| `lazy init --scan` | Initialize and bootstrap from existing project |
| `lazy init --update` | Refresh hooks, commands, blueprints to latest version |
| `lazy scan` | Re-scan project: detect stack, commands, git history, TODOs |
| `lazy upgrade` | Update lazy-fetch itself from GitHub |

## Slash Commands

All commands are available as Claude Code slash commands after `lazy init`:

```
/project:read      /project:plan      /project:status    /project:gather
/project:check     /project:next      /project:done      /project:remember
/project:recall    /project:journal   /project:context   /project:snapshot
/project:blueprint /project:yolo      /project:init
```

## Blueprints

Pre-built workflows for common tasks. Each blueprint handles the full cycle: **gather context → checkpoint → implement → validate → remember**. Claude Code automatically suggests the right blueprint based on what you're doing.

| Blueprint | When it triggers | What it does |
|-----------|-----------------|-------------|
| `fix-bug` | Bug, error, crash, "doesn't work" | Gather → checkpoint → analyze → fix → typecheck → test → remember |
| `add-feature` | New functionality, "add", "implement" | Gather → research → plan → implement → typecheck → test → document |
| `experiment` | "Try", "what if", prototype, spike | Gather → branch → implement → validate → evaluate (keep or discard) |
| `review-code` | "Review", audit, code quality | Gather → diff → typecheck → review → suggest improvements |

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

Blueprints auto-detect your project type (TypeScript, Python, Rust, Go) for validation steps.

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

## Security

Built-in security scanner that catches vulnerabilities before they ship. No external tools needed — pattern-based analysis across 23 rules.

```bash
lazy secure
```
```
  Security Audit
  ─────────────────────────────────────────
  Files scanned: 135
  Rules checked: 26

  MEDIUM:    18

  src/app/api/ai/assistant/route.ts
     ! L5: [MEDIUM] API route without authentication check
     ! L5: [MEDIUM] Public API endpoint without rate limiting

  Total: 18 finding(s) (0 critical, 0 high, 18 medium, 0 low)
```

### What It Checks

| Severity | Examples |
|----------|---------|
| **Critical** | Hardcoded API keys, passwords, AWS keys, private keys, committed `.env` files, DB connection strings |
| **High** | SQL injection, command injection, path traversal, XSS, `eval()`, unsafe regex, `.env` not gitignored |
| **Medium** | CORS wildcard, missing auth on API routes, missing rate limiting, HTTP URLs, insecure cookies, dependency vulnerabilities |
| **Low** | Sensitive data in console.log, security TODOs, debug mode, weak crypto (MD5/SHA1) |

### Integration

- **`lazy check`** includes a security gate — critical and high issues always flagged
- **`lazy yolo advance`** runs a security gate between sprints — blocks advancement if critical/high issues found
- **`lazy_secure` MCP tool** — Claude Code can run it directly
- **`--gate` flag** for fast CI-friendly checks (critical + high only, skips dependency audit)

## Sprint Contracts & Evaluation

Inspired by [Anthropic's research on harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps): separating generation from evaluation produces better results than self-assessment. Lazy-fetch implements this as **sprint contracts** + **skeptical evaluation**.

### The Flow

```
lazy contract "User authentication"    → Define testable success criteria
  ↓ implement...
lazy eval                              → Skeptical QA: actually test each criterion
  ↓ Claude tests via HTTP requests, Playwright, etc.
lazy eval record [results]             → Record pass/fail for each criterion
  → Grade: 4/5 (80%) — PASS
```

### How It Works

1. **`lazy contract <title>`** generates testable criteria from your tasks. Auto-detects API vs UI test types from the task description and adds implicit quality criteria based on your stack.

2. **`lazy eval`** returns a **skeptical QA prompt** that instructs Claude to actually test each criterion — not just read code. Rules: "Do NOT assume something works because the code looks correct. Actually run, click, call, or test."

3. **`lazy eval record`** records results with pass/fail and notes per criterion. Grades against threshold (default 80%).

### Integration

- **Normal mode**: run `lazy contract` before implementing, `lazy eval` after
- **Yolo mode**: contracts auto-generated per sprint, evaluation prompt included in the loop
- **MCP tools**: `lazy_contract`, `lazy_eval`, `lazy_eval_record`

## Auto-Documentation

Lazy-fetch automatically generates structured documentation as you work. No extra steps needed — docs are created as a side effect of planning, checking, and completing sprints.

### What gets generated

```
.lazy/docs/
  plan.md                        # Living plan — updates on every task/sprint change
  validation.md                  # Append-only log of every lazy check run
  sprints/
    sprint-01-authentication.md  # Per-sprint archive (created on completion)
    sprint-02-dashboard.md
  screenshots/
    sprint-01-login-page.png     # Playwright captures for frontend validation
```

### When docs are written

| Event | What happens |
|-------|-------------|
| `lazy plan <goal>` | Creates `docs/plan.md` with phases and tasks |
| `lazy done <task>` | Updates `docs/plan.md` with completion |
| `lazy check` | Appends results to `docs/validation.md` |
| `lazy yolo advance` (sprint done) | Creates `docs/sprints/sprint-NN-title.md` with full record |
| `lazy doc screenshot <url>` | Captures via Playwright to `docs/screenshots/` |

### Sprint archive contents

Each sprint doc captures:
- **Planned tasks** from the PRD
- **Changes** — files created/modified (from git)
- **Validation results** — typecheck, tests, security
- **Screenshots** — linked if captured during the sprint

### Yolo mode

In yolo mode, documentation is fully automatic — the plan doc updates as sprints complete, each finished sprint gets its own archive, and all validation results are logged. After a yolo run, `.lazy/docs/` contains a complete record of what was planned, built, and validated.

## MCP Server

Lazy Fetch runs as an MCP server, giving Claude Code **35 native tools**:

```
The Loop:    lazy_read, lazy_plan, lazy_plan_from_file, lazy_add, lazy_status,
             lazy_update, lazy_done, lazy_stuck, lazy_next, lazy_remove,
             lazy_reset_plan, lazy_check
Context:     lazy_context, lazy_gather, lazy_watch, lazy_claudemd
Persist:     lazy_remember, lazy_recall, lazy_journal, lazy_snapshot
Evaluate:    lazy_contract, lazy_eval, lazy_eval_record
Docs:        lazy_doc, lazy_doc_screenshot
Security:    lazy_secure
Blueprints:  lazy_blueprint_list, lazy_blueprint_show, lazy_blueprint_run
Yolo:        lazy_yolo_plan, lazy_yolo_start, lazy_yolo_status,
             lazy_yolo_advance, lazy_yolo_resume, lazy_yolo_report
```

Configured in `.mcp.json`. Claude Code can call these directly — no terminal switching needed.

## Hooks

Lazy Fetch integrates with Claude Code via hooks in `.claude/settings.json`:

| Event | What happens |
|-------|-------------|
| **SessionStart** | Injects plan, memory, git state into Claude Code context |
| **PostToolUse** (Write/Edit) | TypeScript check after every code edit |
| **PreCompact** | Preserves plan + memory through context compression |
| **Stop** | Auto-journals changes, updates file access patterns |

Hooks are pre-configured by `lazy init`.

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
  yolo.json          # Yolo mode sprint state
  CONTEXT.md         # Generated context for Claude Code
  context/
    symbols.json     # Cached symbol index
    access.json      # File access patterns
  snapshots/         # Point-in-time state captures
  runs/              # Blueprint execution logs
  archive/           # Archived plans (created on lazy plan --reset)
hooks/               # Hook scripts for Claude Code events
blueprints/          # YAML workflow definitions
.claude/
  settings.json      # Hook configuration
  commands/          # Slash commands
.mcp.json            # MCP server configuration
CLAUDE.md            # Lazy-fetch guidance for Claude Code (auto-generated section)
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
6. **Let the agent be the agent.** Yolo mode doesn't build a loop runner — it gives Claude Code a plan and tools, then gets out of the way.

## License

MIT
