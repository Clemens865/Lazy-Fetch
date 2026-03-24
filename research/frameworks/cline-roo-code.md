# Cline & Roo Code

## Overview & Philosophy

**Cline** is an autonomous coding agent that runs as a VS Code extension, positioning the IDE itself as the agent platform. The core philosophy: give an LLM access to the developer's actual tools (CLI, editor, browser, terminal) with a **human-in-the-loop approval system** for every action. The name is a portmanteau: **CLI** + a**N**d + **E**ditor.

**Roo Code** (formerly Roo-Cline) is a fork of Cline that extends the concept with a **multi-persona mode system** -- instead of one general-purpose agent, you get "a whole dev team of AI agents" with distinct roles (Code, Architect, Ask, Debug, Orchestrator) and fully customizable modes. Roo Code adds custom modes with per-mode tool restrictions, per-mode rules, subtask delegation, and a richer orchestration model.

Both are Apache 2.0 licensed. Cline is by Cline Bot Inc., Roo Code by Roo Code, Inc.

**Key shared principles:**
- The IDE is the agent runtime -- no separate orchestration server
- Human approves every file write, command execution, and browser action (unless auto-approved)
- LLM uses XML-based tool calls (or native function calling) to interact with the environment
- MCP (Model Context Protocol) extends the agent's capabilities dynamically
- Checkpoints provide git-based snapshots for safe rollback
- Multi-provider support (Anthropic, OpenAI, Google, local models, etc.)

## Architecture

### Agent Loop (Task Execution)

Both Cline and Roo Code follow the same core agent loop pattern:

1. **User submits a task** (text + optional images/files)
2. **System prompt is assembled** with: environment details, available tools, rules/instructions, MCP server descriptions, mode-specific instructions (Roo Code)
3. **LLM generates a response** that includes tool use blocks (XML `<tool_name>` tags or native function calls)
4. **Tool calls are parsed** from the streaming response via `parseAssistantMessage` (Cline) or `presentAssistantMessage` (Roo Code)
5. **Each tool call goes through approval** -- either auto-approved or presented to the user in the VS Code webview panel
6. **Tool executes** and returns results back into the conversation
7. **Loop continues** until `attempt_completion` is called or the user cancels

The main class is `Task` in both projects (Cline: `src/core/task/index.ts`, Roo Code: `src/core/task/Task.ts`). It manages the full lifecycle: API communication, message history, tool execution, checkpoints, context management, and state persistence.

### Tool System

**Cline's tools** are registered through a `ToolExecutor` class that uses a coordinator pattern with individual handler classes:

```
src/core/task/tools/handlers/
  ReadFileToolHandler.ts
  WriteToFileToolHandler.ts
  ExecuteCommandToolHandler.ts
  SearchFilesToolHandler.ts
  BrowserToolHandler.ts
  UseMcpToolHandler.ts
  AccessMcpResourceHandler.ts
  SubagentToolHandler.ts
  UseSkillToolHandler.ts
  AttemptCompletionHandler.ts
  NewTaskHandler.ts
  ...
```

Each handler is registered with a `ToolExecutorCoordinator` and receives a `TaskConfig` object containing all services, callbacks, and state. A `ToolValidator` checks permissions before execution.

**Roo Code's tools** use an inheritance-based pattern with a `BaseTool` class:

```
src/core/tools/
  BaseTool.ts          -- Abstract base with execute() and handlePartial()
  ReadFileTool.ts
  EditFileTool.ts
  ExecuteCommandTool.ts
  SwitchModeTool.ts    -- Mode switching
  NewTaskTool.ts       -- Subtask delegation
  SkillTool.ts         -- Skill activation
  ...
```

**Complete tool inventory (shared across both):**

| Category | Tools |
|----------|-------|
| File Operations | `read_file`, `write_to_file` / `apply_patch`, `search_files`, `list_files`, `list_code_definition_names` |
| Terminal | `execute_command` |
| Browser | `browser_action` (Puppeteer-based headless browser) |
| MCP | `use_mcp_tool`, `access_mcp_resource` |
| Interaction | `ask_followup_question`, `attempt_completion` |
| Context | `new_task` (fresh context window with summarized state) |
| Web | `web_fetch`, `web_search` |
| Meta | `use_subagents` (Cline), `switch_mode` (Roo Code), `use_skill` |

### Human-in-the-Loop Approval System

The approval system is the defining feature. Every tool call goes through this flow:

1. **Auto-approval check** -- settings determine if the tool can run without asking:
   - Per-tool-category toggles (read files, edit files, execute commands, browser, MCP)
   - Workspace vs. external file distinction
   - Safe command detection (model sets `requires_approval` flag)
   - "YOLO mode" -- auto-approve everything (dangerous, for prototyping)
   - Per-MCP-tool `alwaysAllow` flag

2. **If not auto-approved** -- the tool call is presented in the VS Code webview:
   - File diffs shown in VS Code's diff editor
   - Terminal commands shown with full command text
   - User can: Approve, Reject, or provide feedback text
   - The `ask()` callback pauses the agent loop via a promise until user responds

3. **Response handling**:
   - `yesButtonClicked` -- tool executes
   - `noButtonClicked` -- tool is skipped, error feedback sent to LLM
   - `messageResponse` -- user provides text feedback, LLM adjusts approach

The `AutoApprove` class (Cline) / `AutoApprovalHandler` (Roo Code) evaluates settings including workspace path checks to prevent operations outside the project.

### MCP Integration

Both projects integrate MCP through a `McpHub` class (`src/services/mcp/McpHub.ts`) that:

1. **Watches a settings file** (`mcp_settings.json`) via chokidar for hot-reloading
2. **Manages connections** to MCP servers using the official `@modelcontextprotocol/sdk`
3. **Supports multiple transports**: stdio (local processes), SSE, Streamable HTTP
4. **Discovers capabilities**: tools, resources, resource templates, prompts
5. **Generates unique short keys** for servers (e.g., `c` + nanoid(5)) to avoid long tool names
6. **Injects MCP tool descriptions** into the system prompt so the LLM knows what's available
7. **Handles OAuth** for remote MCP servers requiring authentication
8. **Per-tool auto-approve**: individual MCP tools can have `alwaysAllow: true` in settings

MCP servers are configured in JSON:
```json
{
  "mcpServers": {
    "weather-server": {
      "command": "node",
      "args": ["weather-server.js"],
      "disabled": false,
      "autoApprove": ["get_weather"],
      "timeout": 60
    }
  }
}
```

Cline has a unique feature: you can ask Cline to **create MCP servers for you** ("add a tool that fetches Jira tickets") and it will generate and install the server code.

### Context Management

Both use similar strategies:
- **Context window tracking** -- monitor token usage to avoid overflow
- **Conversation condensation** -- summarize older messages when context fills
- **Checkpoints** -- git-based workspace snapshots at each step (compare, restore)
- **Focus chain** (Cline) -- tracks which files are most relevant to guide the agent
- **New task tool** -- allows the agent to spawn a fresh context window with distilled state

### Roo Code's Mode System (Unique)

Roo Code's mode system is its primary differentiator. Each mode has:

```typescript
interface ModeConfig {
  slug: string;            // e.g., "code", "architect", "debug"
  name: string;            // Display name with emoji
  roleDefinition: string;  // System prompt role
  whenToUse: string;       // When to switch to this mode
  customInstructions?: string; // Mode-specific instructions
  groups: GroupEntry[];    // Which tool groups are available
  source?: "global" | "project";
}
```

**Built-in modes:**

| Mode | Role | Tool Groups | Key Behavior |
|------|------|-------------|--------------|
| Code | Software engineer | read, edit, command, mcp | Full coding capabilities |
| Architect | Technical planner | read, edit (*.md only), mcp | Plans before implementation, creates todo lists |
| Ask | Technical assistant | read, mcp | Read-only, answers questions |
| Debug | Debugger | read, edit, command, mcp | Systematic diagnosis, adds logging |
| Orchestrator | Workflow coordinator | (none -- delegates via `new_task`) | Breaks complex tasks into subtasks |

**Tool group restrictions** are enforced per mode:
- `read` -- file reading tools
- `edit` -- file writing tools, with optional `fileRegex` restrictions
- `command` -- terminal execution
- `mcp` -- MCP server access

**Mode-specific rules** live in the `.roo/` directory:
```
.roo/rules-code/         -- Rules only active in Code mode
.roo/rules-debug/        -- Rules only active in Debug mode
.roo/rules-architect/    -- Rules only active in Architect mode
.roo/rules-{custom-slug}/ -- Rules for custom modes
```

**Mode switching** is a tool call:
```typescript
// LLM can request mode switches
{ tool: "switch_mode", mode_slug: "code", reason: "Need to implement the plan" }
```

The user must approve mode switches. The Orchestrator mode delegates work by spawning **subtasks** via `new_task` with a specified mode.

## Key Patterns

### [agent][pattern] Streaming Tool Parsing
Both parse tool calls from streaming LLM output in real-time. Cline uses `parseAssistantMessageV2` to extract XML tool blocks as they stream in, showing partial tool calls to the user before they're complete. This enables showing file diffs as they're being generated.

### [agent][pattern] Ask-and-Wait Promise Pattern
The core human-in-the-loop mechanism uses a promise-based pattern: `ask(type, text)` returns a promise that resolves only when the user responds in the webview. This cleanly pauses the agent loop without polling.

### [agent][pattern] Checkpoint-Based Rollback
Git-based workspace snapshots are taken at each step. Users can compare any checkpoint to the current state and restore to any previous point. This is essentially version control for the agent's work, separate from the project's own git history.

### [pattern][hook] Lifecycle Hooks (Cline)
Eight hook points in the task lifecycle allow injecting custom logic via shell scripts:
- `TaskStart`, `TaskResume`, `TaskCancel`, `TaskComplete`
- `PreToolUse`, `PostToolUse` -- intercept/block tool execution
- `UserPromptSubmit` -- modify/block user messages
- `PreCompact` -- inject context before conversation condensation

Hooks receive JSON on stdin and return JSON on stdout. A hook returning `{"cancel": true}` blocks the operation. This is a deterministic guardrail on non-deterministic AI behavior.

### [skill] Progressive Skill Loading (Cline)
Skills are modular instruction sets with three loading levels:
1. **Metadata** (~100 tokens) -- always loaded at startup
2. **Instructions** (<5k tokens) -- loaded when `use_skill` is triggered
3. **Resources** (unlimited) -- bundled files loaded on-demand via `read_file`

Skills live in `.cline/skills/` (project) or `~/.cline/skills/` (global). The LLM sees skill descriptions and chooses to activate them contextually.

### [mcp] Dynamic Tool Extension via MCP
Both projects treat MCP servers as first-class tool providers. The system prompt is dynamically generated with all available MCP tools, their schemas, and descriptions. The LLM can call `use_mcp_tool` with server name, tool name, and arguments.

### [mcp] Self-Creating MCP Servers (Cline)
Cline can generate MCP server code on demand: "add a tool that fetches Jira tickets" causes Cline to write the server code, install it, and register it in the MCP settings file.

### [orchestration] Multi-Mode Orchestration (Roo Code)
The Orchestrator mode breaks complex tasks into subtasks, each delegated to a specific mode:
```
Orchestrator -> new_task(mode: "architect", message: "Design the auth system")
             -> new_task(mode: "code", message: "Implement JWT handling")
             -> new_task(mode: "debug", message: "Fix the token refresh bug")
```

Each subtask gets its own context window and can report back via `attempt_completion`.

### [orchestration] Hierarchical Subtasks (Roo Code)
Tasks form a parent-child hierarchy: `rootTaskId`, `parentTaskId`, `childTaskId`. The orchestrator receives completion summaries from subtasks and decides next steps. Todo lists can be passed between tasks.

### [memory] Per-Mode Custom Rules (Roo Code)
The `.roo/rules-{mode-slug}/` directory pattern allows mode-scoped instructions. A debug mode can have rules about logging strategies, while the code mode has rules about coding standards. Rules are loaded only when the corresponding mode is active.

### [sandbox] Read-Only Subagents (Cline)
Subagents run in parallel with restricted tool access: read-only file operations, search, and safe commands. They cannot edit files, use browsers, or access MCP servers. This provides safe parallel research without risking state changes.

### [pattern] Diff-Based File Editing
Both present file changes as diffs in VS Code's diff editor. The user can edit the diff directly before approving. Cline uses `apply_patch` (unified diff format) while Roo Code supports multiple strategies: `MultiSearchReplaceDiffStrategy`, `apply_diff`, `apply_patch`, `search_and_replace`, and `edit_file`.

### [agent][pattern] Consecutive Mistake Tracking
Both track `consecutiveMistakeCount` to detect when the agent is stuck in an error loop. This prevents infinite retries and prompts the agent to try a different approach.

### [pattern] Tool Repetition Detection (Roo Code)
`ToolRepetitionDetector` identifies when the agent is calling the same tools repeatedly with the same parameters, indicating it's stuck. This triggers intervention or error handling.

## Strengths

1. **Best-in-class human-in-the-loop UX**: The VS Code webview integration provides rich approval UI with file diffs, command previews, and inline feedback. The granular auto-approve settings let users tune the autonomy level precisely.

2. **MCP as the extensibility model**: Rather than building a plugin system, both use MCP as the universal extension point. This means any MCP server (community or custom) immediately extends the agent's capabilities.

3. **Checkpoint system**: Git-based workspace snapshots at every step provide a safety net that makes aggressive agent actions recoverable. Users can compare and restore at any point.

4. **Roo Code's mode system is genuinely innovative**: Per-mode tool restrictions, custom instructions, and file regex constraints create a principled way to constrain agent behavior. The Architect mode that can only edit markdown files is a powerful safety pattern.

5. **Progressive skill loading**: The three-tier loading system (metadata -> instructions -> resources) is token-efficient and scales well with many skills installed.

6. **Streaming tool display**: Showing partial tool calls as they stream in (e.g., building up a diff view in real-time) provides excellent user feedback during long operations.

7. **Multi-provider support**: Broad model compatibility (Anthropic, OpenAI, Google, Bedrock, local models) means users aren't locked into one provider.

8. **Hooks for deterministic guardrails (Cline)**: The hook system bridges the gap between non-deterministic AI and deterministic business rules. A `PreToolUse` hook that blocks `.js` file creation in a TypeScript project is a clean enforcement mechanism.

9. **Self-improving tooling**: Cline's ability to create its own MCP servers is a meta-capability that lets the agent extend itself.

10. **Roo Code's orchestrator pattern**: The built-in Orchestrator mode with `new_task` delegation is a well-designed pattern for complex multi-step projects.

## Weaknesses

1. **VS Code lock-in**: Both are deeply tied to VS Code's extension API (webview, terminal integration, diff views). Porting to other editors or headless environments requires significant rework. Cline has started a CLI (`cli/`) but it's secondary.

2. **Single-agent per task**: Despite Roo Code's mode system, only one mode is active at a time within a task. True parallel multi-agent work (like multiple agents editing different files simultaneously) isn't supported. Cline's subagents are read-only.

3. **No persistent memory across tasks**: There's no built-in knowledge base or memory system. Each task starts fresh (unless manually using `new_task` to carry context forward). Long-running projects require manual context management.

4. **Context window pressure**: Even with condensation and skills, complex projects can overwhelm the context window. The solutions (condensation, new_task) lose information.

5. **Approval fatigue**: Without auto-approve, users must click through many approvals. With auto-approve, safety diminishes. There's no middle ground like "approve the plan, auto-approve the execution."

6. **No sandboxing beyond VS Code**: Commands execute in the user's actual terminal with full system access. There's no container isolation, no filesystem sandboxing. YOLO mode with a confused agent could be destructive.

7. **Roo Code mode switching overhead**: The agent must explicitly call `switch_mode` and get user approval. This adds latency to workflows that naturally span multiple modes.

8. **MCP server management is manual**: Users must configure MCP servers in JSON files. There's no package manager or registry (though Cline has a marketplace feature in development).

9. **No native testing loop**: Neither has a built-in test-driven development loop where the agent writes tests, runs them, and iterates until they pass as a first-class workflow.

10. **Monolithic Task class**: Both projects have very large `Task` classes (thousands of lines) that handle the entire agent lifecycle. This makes the codebase harder to maintain and extend.

## Unique Ideas Worth Extracting

### 1. Mode-Scoped Tool Restrictions (Roo Code) -- [agent][pattern]
The idea that different agent personas should have different tool access is powerful. An architect that can only write markdown prevents accidental code generation during planning. A debug mode that has logging-first custom instructions guides systematic problem-solving. This pattern could be generalized to any multi-agent system.

**Configuration format:**
```yaml
customModes:
  - slug: architect
    groups:
      - read
      - - edit
        - fileRegex: "\\.md$"
          description: "Markdown files only"
      - mcp
```

### 2. File Regex Constraints per Mode (Roo Code) -- [sandbox]
Within the `edit` tool group, a `fileRegex` parameter restricts which files a mode can modify. The translate mode can only edit `*.json` and `*.md` files. This is a lightweight sandboxing mechanism that doesn't require containers.

### 3. Lifecycle Hooks with Cancel Semantics (Cline) -- [hook]
The hook system's `{"cancel": true}` return value is a clean way to inject deterministic veto logic into non-deterministic AI workflows. The eight hook points cover the complete task lifecycle. Combined with JSON stdin/stdout, any language can implement hooks.

### 4. Progressive Skill Loading with On-Demand Activation (Cline) -- [skill]
Skills cost ~100 tokens when dormant (just name + description) and only load full instructions when the LLM determines they're needed. This scales to many installed skills without context bloat.

### 5. Orchestrator Mode with Subtask Delegation (Roo Code) -- [orchestration]
The Orchestrator mode's `new_task` tool creates child tasks in specific modes with full instructions. The pattern of "break down, delegate, synthesize" is formalized in the mode's custom instructions and enforced by having no tool groups of its own (forcing it to delegate).

### 6. Per-Mode Rules Directory (Roo Code) -- [memory][pattern]
The `.roo/rules-{mode-slug}/` convention allows teams to commit mode-specific instructions to version control. A team can have shared coding standards in `rules-code/` and debugging strategies in `rules-debug/`. This is project-scoped agent configuration.

### 7. Checkpoint Compare & Restore (both) -- [sandbox]
The git-based checkpoint system with "Restore Workspace Only" vs "Restore Task and Workspace" gives users fine-grained control over rollback. "Restore Workspace Only" lets you test different agent-generated versions while keeping the conversation; "Restore Task and Workspace" fully rewinds.

### 8. Self-Creating MCP Servers (Cline) -- [mcp]
The ability to ask "add a tool that..." and have the agent create, install, and configure an MCP server is a meta-capability that makes the agent self-improving. This bootstrapping pattern could be extended to any plugin system.

### 9. Custom Mode Definitions in `.roomodes` (Roo Code) -- [pattern]
Project-level mode definitions in `.roomodes` YAML files allow teams to define specialized agent personas per project. An "Issue Fixer" mode with GitHub CLI expertise, a "Translate" mode for localization, a "Docs Extractor" mode for documentation -- all committed to the repo and shared across the team.

### 10. Subagent Parallel Research (Cline) -- [agent][orchestration]
Read-only subagents that run in parallel with separate context windows solve the "explore broadly without filling context" problem. Each subagent returns focused findings, and the main agent synthesizes. The restriction to read-only tools prevents state conflicts.

## Code Examples

### Roo Code Custom Mode Configuration (.roomodes)
```yaml
customModes:
  - slug: issue-fixer
    name: "Issue Fixer"
    roleDefinition: |
      You are a GitHub issue resolution specialist focused on fixing bugs
      and implementing feature requests from GitHub issues.
    whenToUse: >
      Use this mode when you have a GitHub issue that needs to be fixed
      or implemented.
    groups:
      - read
      - edit
      - command
    source: project
```

### Roo Code Mode-Scoped Rules (.roo/rules-{slug}/)
```
.roo/
  rules-code/
    use-safeWriteJson.md        # Coding standards
  rules-debug/
    cli.md                       # Debug-specific instructions
  rules-issue-fixer/
    1_Workflow.xml               # Step-by-step workflow
    2_best_practices.xml         # Best practices
    3_common_patterns.xml        # Common patterns
    4_github_cli_usage.xml       # GitHub CLI usage
    5_pull_request_workflow.xml  # PR workflow
```

### Cline Hook Script (PreToolUse)
```bash
#!/bin/bash
# Block .js file creation in TypeScript projects
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.preToolUse.tool')
FILE_PATH=$(echo "$INPUT" | jq -r '.preToolUse.parameters.path // "N/A"')

if [[ "$TOOL" == "write_to_file" && "$FILE_PATH" == *.js ]]; then
  echo '{"cancel":true,"message":"Use .ts files instead of .js in this project"}'
  exit 0
fi

echo '{"cancel":false}'
```

### Cline Skill Structure (SKILL.md)
```markdown
---
name: aws-deploy
description: Deploy applications to AWS using CDK. Use when deploying,
  updating infrastructure, or managing AWS resources.
---

# AWS CDK Deployment

## Steps
1. Check CDK bootstrap status: `cdk bootstrap`
2. Synthesize the stack: `cdk synth`
3. Deploy: `cdk deploy --require-approval never`

## Error Handling
- If bootstrap fails, check AWS credentials
- If synth fails, validate TypeScript compilation first
```

### Roo Code switch_mode Tool Definition
```typescript
{
  type: "function",
  function: {
    name: "switch_mode",
    description: "Request to switch to a different mode.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        mode_slug: {
          type: "string",
          description: "Slug of the mode to switch to (e.g., code, ask, architect)"
        },
        reason: {
          type: "string",
          description: "Explanation for why the mode switch is needed"
        }
      },
      required: ["mode_slug", "reason"],
      additionalProperties: false
    }
  }
}
```

### Cline Auto-Approve Configuration Logic
```typescript
// Three tiers of auto-approval
if (yoloModeToggled) {
  // Everything auto-approved
  return [true, true]; // [approved, includeExternal]
}
if (autoApproveAllToggled) {
  // All categories auto-approved
  return [true, true];
}
// Per-category settings
switch (toolName) {
  case ClineDefaultTool.FILE_READ:
    return [settings.actions.readFiles, settings.actions.readFilesExternally ?? false];
  case ClineDefaultTool.FILE_EDIT:
    return [settings.actions.editFiles, settings.actions.editFilesExternally ?? false];
  case ClineDefaultTool.BASH:
    return [settings.actions.executeCommands, settings.actions.executeCommandsExternally ?? false];
  case ClineDefaultTool.MCP_USE:
    return settings.actions.useMcp;
}
```

### Roo Code Orchestrator New Task Delegation
```typescript
// The new_task tool creates child tasks in specific modes
{
  tool: "new_task",
  mode: "code",
  message: `Implement JWT token management based on the architecture
    designed in the previous subtask. The auth service should...`,
  todos: `- [ ] Create JwtService class
- [ ] Implement token generation
- [ ] Implement token validation
- [ ] Add refresh token support`
}
```

### MCP Server Configuration
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" },
      "disabled": false,
      "autoApprove": ["search_repositories", "get_file_contents"],
      "timeout": 60
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
      "disabled": false
    }
  }
}
```
