# Agentic Coding Framework Research

## Project Purpose
Explore, analyze, and synthesize agentic coding frameworks. The goal is to:
1. **Discover** — Find and catalog agentic coding frameworks, patterns, and tools
2. **Analyze** — Deep-dive into each framework's architecture, strengths, and weaknesses
3. **Synthesize** — Extract the best ideas and combine them into novel approaches
4. **Build** — Create our own improved framework leveraging the best discoveries

## Project Structure
```
research/
  frameworks/    # One markdown per framework analyzed
  analysis/      # Comparative analyses and deep-dives
  synthesis/     # Combined insights and new ideas
docs/            # Project documentation
hooks/           # Custom hook scripts
tools/           # Utility scripts
.claude/
  commands/      # Custom slash commands
```

## Research Methodology
When analyzing a framework:
1. Document its core architecture and design philosophy
2. Identify unique patterns (hooks, skills, MCPs, agents, etc.)
3. Rate strengths/weaknesses on: extensibility, composability, developer UX, reliability
4. Extract reusable patterns with concrete code examples
5. Note what's novel vs. borrowed from other frameworks

## Framework Analysis Template
Each framework analysis in `research/frameworks/` should follow:
```markdown
# [Framework Name]
## Overview & Philosophy
## Architecture
## Key Patterns
## Strengths
## Weaknesses
## Unique Ideas Worth Extracting
## Code Examples
```

## Conventions
- All research notes in Markdown
- Use descriptive filenames: `research/frameworks/claude-code.md` not `fw1.md`
- Tag insights with categories: `[hook]`, `[skill]`, `[mcp]`, `[agent]`, `[pattern]`
- When discovering a new pattern, immediately document it before moving on
- Cross-reference between documents using relative links

## Key Concepts We're Tracking
- **Hooks** — Pre/post execution interceptors, validation gates, behavioral guardrails
- **Skills** — Reusable, composable capabilities that can be invoked on demand
- **MCPs** — Model Context Protocol servers for tool/resource integration
- **Agent Orchestration** — Multi-agent coordination patterns (swarms, hierarchies, meshes)
- **Memory Systems** — Persistent context across sessions and agents
- **Code Generation** — How frameworks approach generating vs. templating code
- **Sandboxing** — Isolation and safety mechanisms for agent execution
- **Human-in-the-loop** — Approval workflows and intervention patterns

## Working Guidelines
- Prefer depth over breadth — a thorough analysis of 5 frameworks beats a surface scan of 20
- Always verify claims by reading actual source code when available
- Document surprises and anti-patterns, not just best practices
- When in doubt about a framework's behavior, test it rather than assume

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
`lazy_read`, `lazy_plan`, `lazy_status`, `lazy_gather`, `lazy_check`, `lazy_remember`, `lazy_recall`, `lazy_blueprint_run`, `lazy_blueprint_list`, `lazy_yolo_start`, `lazy_yolo_status`, `lazy_yolo_advance`

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

### Key Principles
- Run `lazy read` at session start to restore context
- **Use blueprints for structured tasks** — they enforce gather → implement → validate → remember
- Use `lazy remember` for any decision that should survive across sessions
- Use `lazy check` after every significant code change
- Recommend specific lazy-fetch commands as next steps — don't just do the work silently
