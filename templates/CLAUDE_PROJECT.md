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
| `lazy stuck <task or #>` | Mark a task as blocked |
| `lazy add <task>` | Add a task to the current plan |
| `lazy gather <task>` | Find relevant files before starting a task |
| `lazy check` | Validate: typecheck, tests, lint, security |
| `lazy remember <key> <value>` | Store a decision or fact for future sessions |
| `lazy recall [key]` | Retrieve stored knowledge |
| `lazy journal <entry>` | Log a decision or milestone |
| `lazy scan` | Re-scan project: detect stack, commands, git history, TODOs |
| `lazy secure` | Full security audit: secrets, injection, auth, dependencies |
| `lazy secure --gate` | Quick security check (critical + high only) |
| `lazy contract <title>` | Generate testable success criteria before implementing |
| `lazy eval` | Evaluate work against the active contract (skeptical QA) |
| `lazy doc` | Show documentation overview (plan, validation log, sprints, screenshots) |
| `lazy doc screenshot <url>` | Capture a Playwright screenshot for frontend validation |
| `lazy yolo <prd-file>` | Autonomous mode: parse PRD into sprints, execute end-to-end |
| `lazy yolo <prd> --dry-run` | Preview sprint plan without writing state |
| `lazy yolo report` | Run scorecard: process quality, build quality, per-sprint timing |
| `lazy yolo resume` | Resume a paused or failed yolo session |
| `lazy selftest` | Verify lazy-fetch works correctly (22 built-in tests) |

### First Session in an Existing Project

If this is a project that was already underway before lazy-fetch was added, run `lazy scan` to bootstrap context:
```
lazy scan
```
This auto-detects the tech stack, build/test/lint commands, entry points, git history, active files, TODOs, and existing docs — storing everything in memory so you have full project awareness immediately. It also builds a symbol index and generates `.lazy/CONTEXT.md`.

**When to suggest `lazy scan`:**
- First session in a project: "I notice memory is empty — run `lazy scan` to bootstrap from the existing codebase."
- After major refactors: "The project structure changed significantly — run `lazy scan` to update the stack and entry point data."
- When memory seems stale: "The stack info in memory may be outdated — run `lazy scan` to refresh."

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

### Security

`lazy check` automatically includes a security gate (critical + high issues). For a full audit:
- `lazy secure` — scans for hardcoded secrets, injection vulnerabilities, missing auth, dependency vulnerabilities (23 rules)
- In yolo mode, security gates run automatically between sprints — blocking advancement if critical/high issues are found

### Auto-Documentation

Documentation is generated automatically as you work:
- `docs/plan.md` — living plan document, updates on every task change
- `docs/validation.md` — append-only log of every `lazy check` run
- `docs/sprints/sprint-NN-title.md` — per-sprint archive (yolo mode), includes tasks, git changes, validation, security
- `docs/screenshots/` — Playwright captures via `lazy doc screenshot <url>`

### MCP Tools

When MCP is available, prefer calling lazy-fetch tools directly:

**The Loop:** `lazy_read`, `lazy_plan`, `lazy_plan_from_file`, `lazy_add`, `lazy_status`, `lazy_update`, `lazy_done`, `lazy_stuck`, `lazy_next`, `lazy_remove`, `lazy_reset_plan`, `lazy_check`

**Context:** `lazy_context`, `lazy_gather`, `lazy_watch`, `lazy_claudemd`

**Persist:** `lazy_remember`, `lazy_recall`, `lazy_journal`, `lazy_snapshot`

**Evaluate:** `lazy_contract`, `lazy_eval`, `lazy_eval_record`

**Documentation:** `lazy_doc`, `lazy_doc_screenshot`

**Security:** `lazy_secure`

**Blueprints:** `lazy_blueprint_list`, `lazy_blueprint_show`, `lazy_blueprint_run`

**Yolo:** `lazy_yolo_start`, `lazy_yolo_status`, `lazy_yolo_advance`, `lazy_yolo_resume`, `lazy_yolo_report`

### Sprint Contracts & Evaluation

**Before implementing a task or sprint**, generate a contract to define what "done" means:
1. Run `lazy_contract` with the task/sprint title → generates testable success criteria
2. Implement the work
3. Run `lazy_eval` → returns a skeptical QA prompt with testing instructions
4. Actually test each criterion (HTTP requests, page navigation, etc.) — do NOT just read code
5. Call `lazy_eval_record` with results for each criterion
6. If grade is below threshold, fix failures and re-evaluate

**When to suggest contracts:**
- Before starting any non-trivial task: "Let me create a contract first so we know what 'done' looks like."
- In yolo mode: contracts are auto-generated for each sprint
- After a task fails validation: "Let me create a contract to be specific about what needs to work."

**Evaluation rules (from Anthropic research):**
- Separating evaluation from generation produces better results than self-assessment
- Be a skeptical QA tester — actually test, don't assume
- A failing grade with specific feedback is more valuable than a false pass

### Workflow Guidance

After completing a task or milestone, suggest the appropriate next lazy-fetch command:
- **First session / empty memory?** → Suggest `lazy scan` to bootstrap from existing codebase
- **Bug reported?** → Suggest `lazy bp run fix-bug "<description>"`
- **New feature requested?** → Suggest `lazy bp run add-feature "<description>"`
- **Want to try something?** → Suggest `lazy bp run experiment "<description>"`
- **Review needed?** → Suggest `lazy bp run review-code "<scope>"`
- Starting a non-trivial task? → Suggest `lazy contract <title>` to define success criteria first
- Finished implementing? → Suggest `lazy eval` to test against contract, then `lazy check` then `lazy done <task>`
- Starting a new task? → Suggest `lazy gather <task>` for context
- Made an important decision? → Suggest `lazy remember` or `lazy journal`
- Done with the plan? → Suggest `lazy plan --reset` to archive and start fresh
- Want to build from a PRD? → Suggest `lazy yolo <prd-file>`
- Yolo run finished? → Suggest `lazy yolo report` for a quality scorecard
- Yolo paused/failed? → Suggest `lazy yolo resume` after fixing issues
- Sprint or task complete? → Docs auto-generated in `.lazy/docs/`
- Frontend sprint done? → Suggest `lazy doc screenshot <url>` to capture the result
- Code deployed or PR ready? → Suggest `lazy secure` for a security audit
- Something seems broken? → Suggest `lazy selftest` to verify lazy-fetch health
- Project structure changed? → Suggest `lazy scan` to refresh stack and entry points

### Key Principles
- Run `lazy read` at session start to restore context
- **Use `lazy scan` when joining an existing project** — it bootstraps full awareness
- **Use blueprints for structured tasks** — they enforce gather → implement → validate → remember
- Use `lazy remember` for any decision that should survive across sessions
- Use `lazy check` after every significant code change (includes security gate)
- Recommend specific lazy-fetch commands as next steps — don't just do the work silently
