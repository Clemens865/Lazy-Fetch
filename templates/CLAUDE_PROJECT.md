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
| `lazy bp run <name> <input>` | Run a workflow blueprint (fix-bug, add-feature, experiment, review-code) |
| `lazy yolo <prd-file>` | Autonomous mode: parse PRD into sprints, execute end-to-end |

### MCP Tools

When MCP is available, prefer calling lazy-fetch tools directly:
`lazy_read`, `lazy_plan`, `lazy_status`, `lazy_gather`, `lazy_check`, `lazy_remember`, `lazy_recall`, `lazy_yolo_start`, `lazy_yolo_status`, `lazy_yolo_advance`

### Workflow Guidance

After completing a task or milestone, suggest the appropriate next lazy-fetch command:
- Finished implementing? → Suggest `lazy check` then `lazy done <task>`
- Starting a new task? → Suggest `lazy gather <task>` for context
- Made an important decision? → Suggest `lazy remember` or `lazy journal`
- Done with the plan? → Suggest `lazy plan --reset` to archive and start fresh
- Want to build from a PRD? → Suggest `lazy yolo <prd-file>`

### Key Principles
- Run `lazy read` at session start to restore context
- Use `lazy remember` for any decision that should survive across sessions
- Use `lazy check` after every significant code change
- Recommend specific lazy-fetch commands as next steps — don't just do the work silently
