## Lazy Fetch (CLI Companion)

This project uses [lazy-fetch](https://github.com/Clemens865/Lazy-Fetch) for context, persistence, and process tracking.

### Available Commands

**Start every session with:** `lazy read` — loads git state, plan progress, and stored memory.

| Command | When to use |
|---------|------------|
| `lazy plan <goal>` | Break a goal into phased tasks |
| `lazy plan --file <file>` | Import tasks from a bullet-point markdown file |
| `lazy status` | Check current plan progress |
| `lazy done <task or #>` | Mark a task complete (supports name or index number) |
| `lazy add <task>` | Add a task to the current plan |
| `lazy gather <task>` | Find relevant files before starting a task |
| `lazy check` | Validate: typecheck, tests, lint |
| `lazy remember <key> <value>` | Store a decision or fact for future sessions |
| `lazy recall [key]` | Retrieve stored knowledge |
| `lazy journal <entry>` | Log a decision or milestone |
| `lazy yolo <prd-file>` | Autonomous mode: parse PRD into sprints, execute end-to-end |
| `lazy yolo <prd> --dry-run` | Preview sprint plan without writing state |
| `lazy yolo report` | Run scorecard: process quality, build quality, per-sprint timing |
| `lazy selftest` | Verify lazy-fetch works correctly (22 built-in tests) |
| `lazy selftest --quick` | Fast validation (17 tests, ~20ms) |

### Blueprints — Use These for Common Tasks

Blueprints are pre-built workflows that handle the full cycle: gather context, checkpoint, implement, validate, and remember. **Prefer blueprints over ad-hoc implementation** when the user's intent matches one.

| Blueprint | When to trigger | Command |
|-----------|----------------|---------|
| **fix-bug** | User reports a bug, error, crash, or unexpected behavior. Keywords: "bug", "broken", "error", "fix", "crash", "doesn't work", "500", "fails" | `lazy bp run fix-bug "<description>"` |
| **add-feature** | User wants new functionality added. Keywords: "add", "implement", "build", "create", "new feature", "support for" | `lazy bp run add-feature "<description>"` |
| **experiment** | User wants to try something without committing. Keywords: "try", "experiment", "what if", "explore", "prototype", "test an idea", "spike" | `lazy bp run experiment "<description>"` |
| **review-code** | User wants code reviewed. Keywords: "review", "check my code", "audit", "look over", "any issues", "code quality" | `lazy bp run review-code "<description>"` |

**How blueprints work:**
- Deterministic steps (gather, typecheck, tests, git checkpoint) run automatically
- Agentic steps (analyze, implement, document) return prompts — follow them in order
- Validation gates retry on failure (typecheck + tests must pass)
- Results are persisted to memory via `lazy remember`

**When to suggest a blueprint:**
1. When the user describes a task that matches a blueprint, suggest the blueprint command *before* starting the work
2. Example: User says "the login page throws a 500 error" → say: *"This sounds like a bug fix. I'll run `lazy bp run fix-bug "login page throws 500 error"` to gather context, analyze, fix, and validate systematically."*
3. If the user prefers to work without blueprints, respect that — they're a suggestion, not a requirement

### MCP Tools

When MCP is available, prefer calling lazy-fetch tools directly:
`lazy_read`, `lazy_plan`, `lazy_status`, `lazy_gather`, `lazy_check`, `lazy_remember`, `lazy_recall`, `lazy_blueprint_run`, `lazy_blueprint_list`, `lazy_yolo_start`, `lazy_yolo_status`, `lazy_yolo_advance`, `lazy_yolo_report`

### Workflow Guidance

After completing a task or milestone, suggest the appropriate next lazy-fetch command:
- **Bug reported?** → Suggest `lazy bp run fix-bug "<description>"`
- **New feature requested?** → Suggest `lazy bp run add-feature "<description>"`
- **Want to try something?** → Suggest `lazy bp run experiment "<description>"`
- **Review needed?** → Suggest `lazy bp run review-code "<scope>"`
- Finished implementing? → Suggest `lazy check` then `lazy done <task>`
- Starting a new task? → Suggest `lazy gather <task>` for context
- Made an important decision? → Suggest `lazy remember` or `lazy journal`
- Done with the plan? → Suggest `lazy plan --reset` to archive and start fresh
- Want to build from a PRD? → Suggest `lazy yolo <prd-file>`
- Yolo run finished? → Suggest `lazy yolo report` for a quality scorecard
- Something seems broken? → Suggest `lazy selftest` to verify lazy-fetch health

### Key Principles
- Run `lazy read` at session start to restore context
- **Use blueprints for structured tasks** — they enforce gather → implement → validate → remember
- Use `lazy remember` for any decision that should survive across sessions
- Use `lazy check` after every significant code change
- Recommend specific lazy-fetch commands as next steps — don't just do the work silently
