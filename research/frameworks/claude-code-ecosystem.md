# Claude Code Ecosystem (Best Practices & Skills)

## Overview & Philosophy

Claude Code's extensibility model is built on a layered architecture of **Commands, Subagents, Skills, Hooks, MCP Servers, and Plugins**. The core philosophy, articulated by Claude Code creator Boris Cherny and team, centers on several key principles:

1. **Agentic search beats RAG** -- Claude Code tried and discarded vector databases because code drifts out of sync and permissions are complex. Instead, it uses glob + grep for real-time codebase understanding.

2. **Don't babysit the agent** -- The recommended approach is to give Claude goals and constraints, not prescriptive step-by-step instructions. Trust the model to figure out *how*.

3. **Prototype over PRD** -- Building 20-30 versions is preferred over writing detailed specs, because the cost of building is low. Take many shots.

4. **Context is king** -- The entire system is designed around managing, preserving, and isolating context windows. Subagents get fresh contexts, skills use progressive disclosure, CLAUDE.md files load lazily in monorepos.

5. **Skills are portable** -- Skills work identically across Claude.ai, Claude Code CLI, and the API. Once created, they're platform-agnostic.

6. **Composability through separation** -- The Command -> Agent -> Skill pattern enforces single-responsibility: commands orchestrate, agents fetch/process, skills render/produce output.

Sources: [shanraisshan/claude-code-best-practice](https://github.com/shanraisshan/claude-code-best-practice), [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)

---

## Architecture

### Core Extensibility Layers

Claude Code has 7 primary extension mechanisms, each serving a distinct role:

| Layer | Location | Purpose | Context Behavior |
|-------|----------|---------|-----------------|
| **Subagents** | `.claude/agents/<name>.md` | Autonomous actors with isolated context, custom tools, permissions, model, memory | Fresh isolated context per invocation |
| **Commands** | `.claude/commands/<name>.md` | User-invoked prompt templates for workflow orchestration | Injected into existing context |
| **Skills** | `.claude/skills/<name>/SKILL.md` | Configurable, preloadable, auto-discoverable knowledge units | Injected or forked (`context: fork`) |
| **Hooks** | `.claude/hooks/` or settings.json | User-defined handlers on lifecycle events (PreToolUse, PostToolUse, Stop, etc.) | Run outside the agentic loop |
| **MCP Servers** | `.mcp.json`, `.claude/settings.json` | Model Context Protocol connections to external tools/APIs | Tool-level integration |
| **Plugins** | Distributable packages | Bundles of skills, subagents, hooks, and MCP servers | Composite packages |
| **Memory** | `CLAUDE.md`, `.claude/rules/` | Persistent context files loaded hierarchically | Ancestor=eager, Descendant=lazy |

### Orchestration Pattern: Command -> Agent -> Skill

The canonical architecture pattern demonstrated in the best-practices repo:

```
User invokes /command
  -> Command asks user questions (AskUser tool)
  -> Command spawns Agent (Agent tool) with preloaded skills
     -> Agent uses skill knowledge to fetch/process data
     -> Agent returns results to command
  -> Command invokes Skill (Skill tool) for output generation
     -> Skill produces files/artifacts
  -> Command displays summary to user
```

Two distinct skill patterns exist:
- **Agent Skills (preloaded)**: Full skill content injected into agent context at startup via the `skills:` frontmatter field
- **Skills (direct invocation)**: Invoked via `Skill()` tool call, run in the caller's context or in a forked subagent (`context: fork`)

### Memory Loading in Monorepos

- **Ancestor loading (UP)**: At startup, walks upward from cwd to root, loading every CLAUDE.md found
- **Descendant loading (DOWN)**: Subdirectory CLAUDE.md files load lazily only when Claude reads files in those directories
- **Siblings never load**: Working in `frontend/` will not load `backend/CLAUDE.md`
- **Global CLAUDE.md**: `~/.claude/CLAUDE.md` applies to all sessions

### Settings Hierarchy (highest to lowest precedence)

1. Managed settings (organization-enforced, cannot be overridden)
2. Command line arguments (session-level)
3. `.claude/settings.local.json` (personal, git-ignored)
4. `.claude/settings.json` (team-shared, committed)
5. `~/.claude/settings.json` (global personal defaults)

### MCP Server Scopes

- **Project**: `.mcp.json` at repo root (committed, team-shared)
- **User**: `~/.claude.json` (personal, all projects)
- **Subagent**: Agent frontmatter `mcpServers` field (scoped to one agent)
- Precedence: Subagent > Project > User

---

## Key Patterns

### Prompting & Planning

- [pattern] **Challenge the agent**: "Grill me on these changes and don't make a PR until I pass your test" or "prove to me this works" -- forces verification before shipping
- [pattern] **Elegant solution restart**: After a mediocre fix, say "knowing everything you know now, scrap this and implement the elegant solution"
- [pattern] **Plan-first always**: Start every task with plan mode (`/plan`). Use Opus for planning, Sonnet for code execution
- [pattern] **Interview-driven specs**: Start with a minimal spec, ask Claude to interview you using AskUserQuestion tool, then make a new session to execute
- [pattern] **Phase-wise gated plans**: Make plans with multiple phases, each gated by tests (unit, automation, integration)
- [pattern] **Cross-model review**: Spin up a second Claude (or use Codex CLI) to review your plan as a staff engineer

### CLAUDE.md & Memory

- [memory] **Under 200 lines per file**: CLAUDE.md should target under 200 lines. HumanLayer's CLAUDE.md is about 60 lines
- [memory] **Conditional importance tags**: Wrap domain-specific rules in `<important if="...">` tags to prevent Claude from ignoring them
- [memory] **Multiple CLAUDE.md for monorepos**: Root = shared conventions; component dirs = framework-specific patterns
- [memory] **CLAUDE.local.md for personal preferences**: Add to `.gitignore`
- [memory] **`.claude/rules/` for splitting instructions**: Break large instruction sets into separate rule files
- [memory] **Run-the-tests litmus test**: Any developer should be able to launch Claude, say "run the tests" and it works on the first try. If not, your CLAUDE.md is missing essential setup commands
- [memory] **Clean codebases**: Keep codebases clean and finish migrations -- partially migrated frameworks confuse models

### Subagents

- [agent] **Feature-specific subagents**: Create agents for specific features (not generic "qa" or "backend engineer") with relevant skills preloaded
- [agent] **"Use subagents" to throw compute**: Offload tasks to keep main context clean and focused
- [agent] **Test time compute**: Separate context windows make results better; one agent can introduce bugs and another (same model) can find them
- [agent] **Agent teams with tmux + git worktrees**: Parallel development with isolated branches per agent
- [agent] **6 official agent types**: `general-purpose` (default), `Explore` (haiku, read-only), `Plan` (read-only), `Bash` (terminal only), `statusline-setup` (sonnet), `claude-code-guide` (haiku)
- [agent] **15 frontmatter fields**: name, description, tools, disallowedTools, model, permissionMode, maxTurns, skills, mcpServers, hooks, memory, background, effort, isolation, color

### Skills

- [skill] **Context fork for isolation**: Use `context: fork` to run a skill in an isolated subagent -- main context only sees the final result
- [skill] **Skills are folders, not files**: Use `references/`, `scripts/`, `examples/` subdirectories for progressive disclosure
- [skill] **Gotchas section**: Build a Gotchas section in every skill -- highest-signal content, add Claude's failure points over time
- [skill] **Description as trigger**: The description field is a trigger ("when should I fire?"), not a summary
- [skill] **Don't state the obvious**: Focus on what pushes Claude out of its default behavior
- [skill] **Don't railroad**: Give goals and constraints, not prescriptive step-by-step instructions
- [skill] **Include scripts and libraries**: So Claude composes rather than reconstructs boilerplate
- [skill] **Dynamic shell injection**: Embed `` !`command` `` in SKILL.md to inject dynamic shell output into the prompt at invocation time
- [skill] **On-demand hooks in skills**: `/careful` blocks destructive commands, `/freeze` blocks edits outside a directory
- [skill] **Measure skill usage**: Use a PreToolUse hook to find popular or undertriggering skills
- [skill] **11 frontmatter fields**: name, description, argument-hint, disable-model-invocation, user-invocable, allowed-tools, model, effort, context, agent, hooks
- [skill] **5 official skills**: `simplify`, `batch`, `debug`, `loop`, `claude-api`

### Hooks

- [hook] **PostToolUse auto-format**: Auto-format code after Claude writes it -- handles the last 10% to avoid CI failures
- [hook] **Permission routing to Opus**: Route permission requests via a hook to Opus model to scan for attacks and auto-approve safe ones
- [hook] **Stop hook for verification**: Nudge Claude to keep going or verify its work at the end of a turn
- [hook] **Skill usage measurement**: PreToolUse hook to track which skills are being invoked and how often
- [hook] **On-demand safety hooks**: `/careful` and `/freeze` patterns for destructive command prevention

### MCP Servers

- [mcp] **Recommended daily servers**: Context7 (library docs), Playwright (browser automation), Claude in Chrome (real browser debugging), DeepWiki (GitHub repo docs), Excalidraw (diagrams)
- [mcp] **Don't overload**: Community consensus is 4-5 daily servers max, not 15+
- [mcp] **Environment variable expansion**: Use `${MCP_API_TOKEN}` in `.mcp.json` for secrets instead of committing API keys
- [mcp] **Permission rules**: MCP tools follow `mcp__<server>__<tool>` naming in permission rules. Use wildcards: `mcp__context7__*`
- [mcp] **Research -> Debug -> Document pipeline**: Context7/DeepWiki for research, Playwright/Chrome for debugging, Excalidraw for documentation

### Workflows & Session Management

- [orchestration] **Avoid agent dumb zone**: Manual `/compact` at max 50% context usage. Use `/clear` when switching tasks
- [orchestration] **Vanilla Claude Code beats complex workflows for small tasks**: Don't over-engineer
- [orchestration] **Ralph Wiggum Loop**: Autonomous development loop plugin for long-running tasks that iterates until completion
- [orchestration] **Rename and resume sessions**: `/rename` important sessions, `/resume` them later
- [orchestration] **Esc Esc or /rewind**: Undo when Claude goes off-track instead of trying to fix in same context
- [orchestration] **Commit hourly**: Commit at least once per hour as soon as a task completes

### Sandbox & Permissions

- [sandbox] **Sandboxing reduces permission prompts by 84%**: `/sandbox` for file and network isolation
- [sandbox] **Wildcard permissions**: `Bash(npm run *)`, `Edit(/docs/**)` instead of `dangerously-skip-permissions`
- [sandbox] **Worktree isolation**: Set `isolation: "worktree"` in agent frontmatter to run in temporary git worktrees

### Advanced Features

- [orchestration] **Channels (beta)**: Push events from Telegram, Discord, or webhooks into a running session
- [orchestration] **Scheduled tasks**: `/loop` for local recurring (up to 3 days), `/schedule` for cloud-based recurring tasks
- [orchestration] **Voice dictation**: `/voice` for push-to-talk speech input with 20-language support
- [orchestration] **Agent teams (beta)**: Multiple agents working in parallel on same codebase with shared task coordination
- [orchestration] **Remote control**: `/remote-control` to continue local sessions from phone, tablet, or browser
- [orchestration] **Code review (beta)**: Multi-agent PR analysis catching bugs, security vulnerabilities, regressions

---

## Strengths

1. **Layered extensibility**: The 7-layer system (Memory, Commands, Skills, Agents, Hooks, MCP, Plugins) provides extension points at every level of abstraction, from simple prompt templates to full autonomous agents.

2. **Context isolation by design**: Subagents get fresh contexts, skills can fork, CLAUDE.md loads lazily -- the system actively prevents context pollution, which is the #1 failure mode of agentic coding tools.

3. **Progressive disclosure in skills**: Skills are folders with subdirectories (`references/`, `scripts/`, `examples/`), allowing Claude to drill into detail only when needed rather than front-loading everything.

4. **Real file output, not config**: The philosophy explicitly avoids JSON config generation in favor of producing real code files -- aligned with the "should AI generate this?" principle.

5. **Git-native**: Checkpointing is automatic via git, worktrees provide parallel isolation, `/rewind` gives precise undo. The entire workflow is git-aware without needing external state management.

6. **Community-driven skill ecosystem**: 100+ skills across document processing, code tools, data analysis, business, creative, security, and 78+ SaaS automation skills via Composio.

7. **Enterprise controls**: Managed settings hierarchy, MDM profiles, registry policies, organization-enforced permissions that cannot be overridden locally.

8. **Cross-platform skill portability**: Skills work identically on Claude.ai, Claude Code CLI, and the API.

9. **Test-time compute through separation**: Using separate agents for the same task improves quality -- one agent finds bugs another created, because fresh context windows provide new perspective.

---

## Weaknesses

1. **CLAUDE.md compliance is unreliable**: Even with MUST in all caps, Claude still ignores CLAUDE.md instructions. The `<important if="...">` tag workaround is a band-aid, not a solution. This is listed as an open "billion-dollar question" by the community.

2. **No guaranteed instruction adherence**: `memory.md`, `constitution.md`, and rule files do not guarantee anything. There is no enforcement mechanism -- only probabilistic compliance.

3. **Skill/Command/Agent confusion**: When to use a command vs an agent vs a skill is unclear. The community explicitly lists this as an unresolved question. Boris suggests preferring commands for workflows over agents, but the line is blurry.

4. **Context window cliff**: The "agent dumb zone" (performance degradation as context fills up) requires manual intervention (`/compact` at 50%). There is no automatic context management that maintains quality.

5. **Spec drift**: Community asks "how often should you update specs?" and "how do you handle ripple effects?" -- there's no built-in mechanism for keeping specs, plans, and code in sync.

6. **MCP server overload trap**: Users commonly add 15+ MCP servers thinking more is better, but end up using only 4-5. There's no guidance on which combinations work well together.

7. **No verification guarantees**: While hooks can run post-tool, there's no built-in assertion system that verifies agent output meets a specification before committing.

8. **Skill measurement is manual**: Tracking which skills trigger and how often requires custom PreToolUse hooks -- there are no built-in analytics.

9. **Model-specific behavior drift**: As models improve, agents/commands/workflows may need updating. There's no versioning or compatibility system for skills tied to model capabilities.

---

## Unique Ideas Worth Extracting

### From claude-code-best-practice

1. **Orchestration pattern (Command -> Agent -> Skill)**: The cleanest agentic architecture pattern seen -- commands handle user interaction, agents handle data/processing with preloaded skill knowledge, skills handle output generation. Each layer has a single responsibility.

2. **`context: fork` for skill isolation**: Running skills in isolated subagent contexts so the main conversation only sees the final result. This is the key to preventing context pollution in multi-step workflows.

3. **Dynamic shell injection in skills** (`` !`command` ``): Embedding shell commands in SKILL.md that execute at invocation time, injecting fresh runtime data into the prompt.

4. **On-demand hook patterns**: Skills that activate hooks (like `/careful` blocking destructive commands) -- composing safety controls with domain skills.

5. **Stop hooks for verification**: Nudging Claude to keep going or verify work at turn boundaries -- a lightweight "inner critic" pattern.

6. **Permission routing to Opus**: Using a hook to route permission requests to Opus for security scanning before auto-approval. Cost-effective security layer.

7. **Agent worktree isolation**: `isolation: "worktree"` in agent frontmatter creates temporary git worktrees that auto-clean if no changes are made.

8. **Skill description as model trigger**: Writing descriptions as "when should I fire?" instructions rather than human-readable summaries -- optimizing for model activation, not documentation.

9. **Channels for async events**: Pushing external events (Telegram, Discord, webhooks) into a running session so Claude reacts while you're away.

10. **Sparce checkout for worktrees**: `worktree.sparsePaths` setting to check out only specific directories in each worktree, reducing disk usage in large monorepos.

### From awesome-claude-skills

11. **SaaS automation skills via Composio**: Pre-built workflow skills for 78 SaaS apps (CRM, project management, email, social media, etc.) -- each skill includes tool sequences, parameter guidance, known pitfalls, and quick reference tables.

12. **Subagent-driven development**: Dispatching independent subagents for individual tasks with code review checkpoints between iterations.

13. **Reddit-fetch via Gemini CLI**: Using Gemini CLI as a fallback when WebFetch is blocked or returns 403 errors -- cross-model tool composition.

14. **Skill Seekers**: Auto-converting any documentation website into a Claude AI skill in minutes.

15. **Test-driven development skill**: Using skills to enforce TDD workflow -- write tests before implementation code.

16. **Product verification skills**: Signup-flow-driver, checkout-verifier patterns -- worth investing a week to perfect per Boris Cherny.

### From Development Workflows Ecosystem

17. **Superpowers framework** (107k stars): TDD-first with "Iron Laws" and whole-plan review. 5 agents, 3 commands, 14 skills.

18. **Everything Claude Code** (101k stars): Instinct scoring, AgentShield safety layer, multi-language rules. 28 agents, 60 commands, 125 skills.

19. **Get Shit Done** (40k stars): Fresh 200K contexts per task, wave execution pattern, XML plans. 18 agents, 57 commands.

20. **OpenSpec** (33k stars): Delta specs for brownfield projects, artifact DAG for dependency tracking.

---

## Code Examples

### Subagent Definition (`.claude/agents/weather-agent.md`)

```yaml
---
name: weather-agent
description: Fetches real-time weather data using preloaded skill
tools: WebFetch, Read
model: sonnet
skills:
  - weather-fetcher
memory: project
color: green
---

You are a weather data fetching agent. Follow the instructions
in your preloaded weather-fetcher skill to retrieve temperature data.
Return the temperature value and unit to the caller.
```

### Subagent with Full Frontmatter Options

```yaml
---
name: code-reviewer
description: "PROACTIVELY review code changes for quality and security"
tools: Read, Glob, Grep, Bash
disallowedTools: Write, Edit
model: opus
permissionMode: dontAsk
maxTurns: 20
skills:
  - security-checklist
  - style-guide
mcpServers:
  - context7
hooks:
  PostToolUse:
    - command: "echo 'Tool used: $TOOL_NAME' >> /tmp/review.log"
memory: project
background: false
effort: high
isolation: worktree
color: magenta
---
```

### Skill Definition (`.claude/skills/weather-svg-creator/SKILL.md`)

```yaml
---
name: weather-svg-creator
description: Creates an SVG weather card when temperature data is available
context: fork
agent: general-purpose
allowed-tools: Write, Read
---

# Weather SVG Creator

Create a professional SVG weather card using the provided temperature data.

## Instructions
1. Read the temperature and unit from the conversation context
2. Generate an SVG card with the temperature display
3. Write the SVG to `orchestration-workflow/weather.svg`
4. Write a summary to `orchestration-workflow/output.md`

## Gotchas
- Always check if temperature data exists before rendering
- SVG viewBox should be 400x300 for optimal display
- Use web-safe fonts only
```

### Command Definition (`.claude/commands/weather-orchestrator.md`)

```yaml
---
name: weather-orchestrator
description: Fetches weather and creates an SVG card
model: haiku
---

# Weather Orchestrator

1. Ask the user: "Would you like temperature in Celsius or Fahrenheit?"
2. Invoke the `weather-agent` via the Agent tool with the user's preference
3. Invoke the `weather-svg-creator` via the Skill tool with the returned data
4. Display summary with temperature, unit, and file locations
```

### MCP Server Configuration (`.mcp.json`)

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"]
    },
    "deepwiki": {
      "command": "npx",
      "args": ["-y", "deepwiki-mcp"]
    },
    "remote-api": {
      "type": "http",
      "url": "https://mcp.example.com/mcp?token=${MCP_API_TOKEN}"
    }
  }
}
```

### Hook Configuration in Settings (`.claude/settings.json`)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "command": "npx prettier --write $TOOL_INPUT_PATH"
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "echo 'Bash command: $TOOL_INPUT' >> /tmp/skill-usage.log"
      }
    ],
    "Stop": [
      {
        "command": "echo 'Turn complete' && cat /tmp/skill-usage.log"
      }
    ]
  }
}
```

### Permission Configuration with Wildcards

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Glob",
      "Grep",
      "Bash(npm run *)",
      "Bash(npx jest *)",
      "Bash(git *)",
      "Edit(/src/**)",
      "Write(/src/**)",
      "mcp__context7__*",
      "mcp__playwright__browser_snapshot"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(sudo *)",
      "mcp__dangerous-server__*"
    ]
  }
}
```

### Skill with Dynamic Shell Injection

```markdown
---
name: project-status
description: When user asks about project health or status
---

# Project Status

Current git status:
!`git status --short`

Recent commits:
!`git log --oneline -5`

Test results:
!`npm test 2>&1 | tail -5`

Based on the above runtime data, provide a project health summary.
```

### Skill with On-Demand Hooks (Safety Pattern)

```markdown
---
name: careful-mode
description: Activates safety guards for destructive operations
hooks:
  PreToolUse:
    - matcher: "Bash"
      command: |
        if echo "$TOOL_INPUT" | grep -qE 'rm -rf|drop table|git push -f'; then
          echo "BLOCKED: Destructive command detected"
          exit 1
        fi
---

# Careful Mode

Safety guards are now active. Destructive bash commands (rm -rf, drop table,
git push -f) will be blocked. Use this when working in production environments
or with critical data.
```

### Worktree Settings for Large Monorepos

```json
{
  "worktree": {
    "symlinkDirectories": ["node_modules", ".cache", "dist"],
    "sparsePaths": ["packages/my-app", "shared/utils", "configs"]
  }
}
```

### Composio Connect Plugin Setup (from awesome-claude-skills)

```bash
# Install the connect-apps plugin
claude --plugin-dir ./connect-apps-plugin

# Run setup (inside Claude Code session)
/connect-apps:setup

# After restart, Claude can:
# - Send emails via Gmail
# - Create GitHub issues
# - Post to Slack channels
# - Update Notion databases
# - Manage Jira tickets
# etc. (500+ apps supported)
```

### Skill Structure for Progressive Disclosure

```
my-complex-skill/
  SKILL.md              # Core instructions (what Claude sees first)
  scripts/
    validate.sh         # Helper scripts Claude can invoke
    transform.py        # Processing utilities
  references/
    api-spec.md         # Detailed API documentation
    error-codes.md      # Error handling reference
  examples/
    basic-usage.md      # Simple examples
    advanced-usage.md   # Complex patterns
    edge-cases.md       # Known edge cases
  templates/
    output-template.md  # Output format templates
```
