# Cursor IDE Agent

## Overview & Philosophy

Cursor is an AI-native code editor (forked from VS Code) that integrates an autonomous coding agent directly into the IDE experience. The core philosophy is that the AI agent should have **the same tools a human developer uses** -- file editing, terminal access, browser control, search -- but orchestrated by an LLM that can chain these tools together autonomously to complete complex coding tasks.

Unlike CLI-based agentic frameworks (Claude Code, Aider, SWE-agent), Cursor's approach is **IDE-first**: the agent operates within the visual editor environment, with full access to the file tree, terminal panes, and a built-in browser. This creates a tight feedback loop where the developer can observe, interrupt, and redirect the agent in real-time while seeing diffs, terminal output, and browser screenshots inline.

Key philosophical principles:
- **Agent as pair programmer, not batch processor**: The agent works alongside you in the IDE, not in a separate terminal
- **Model-agnostic orchestration**: Cursor tunes its agent orchestration per-model (Claude, GPT, Gemini), handling model-specific optimizations transparently
- **Progressive autonomy**: From Tab (autocomplete) to Agent (autonomous coding) to Cloud Agents (fully async background work)
- **Context is king**: Deep codebase indexing, semantic search, and @-mention context injection make the agent aware of your entire project

## Architecture

### Three-Tier Agent Architecture

Cursor's agent capabilities span three tiers of increasing autonomy:

#### 1. Tab (Inline Completions)
- Autocomplete powered by fast models
- Context-aware suggestions using codebase index
- Has its own hook system (`beforeTabFileRead`, `afterTabFileEdit`) separate from Agent hooks
- Lightweight, low-latency, operates per-keystroke

#### 2. Agent (Interactive Agent Mode)
- Full autonomous coding agent in the sidebar chat (Cmd+I / Cmd+L)
- Can make unlimited tool calls per task
- Operates with a tool-calling loop: plan -> search -> edit -> verify -> repeat
- Three sub-modes:
  - **Agent Mode** (default): Autonomous coding with all tools enabled
  - **Plan Mode**: Research-first approach -- researches codebase, asks clarifying questions, generates a reviewable plan before writing code
  - **Debug Mode**: Error-focused investigation mode

#### 3. Cloud Agents (Background Agents)
- Run in isolated cloud VMs with full desktop environments
- Clone repo from GitHub/GitLab, work on separate branches, push PRs
- Have mouse/keyboard control of the desktop and browser (Computer Use)
- Can run unlimited parallel instances
- Support MCP servers (both HTTP and stdio transports with OAuth)
- Automatically fix CI failures on PRs they create
- Produce artifacts: screenshots, videos, log references attached to PRs
- Formerly called "Background Agents"

### Core Components

An agent is built on three components:
1. **Model** -- The underlying LLM (Claude, GPT, Gemini, etc.)
2. **Tools** -- The building blocks (search, edit, terminal, browser, MCP)
3. **Orchestration** -- Model-specific tuning of instructions and tool usage

Cursor handles model-specific optimizations transparently, tuning instructions and tools for every frontier model. As new models are released, the orchestration layer adapts.

### Tool System

The Agent has access to these built-in tools:

| Tool | Description |
|------|-------------|
| **Codebase Search** | Semantic search across the indexed codebase |
| **File/Folder Search** | Search by name, directory structure, exact keywords/regex |
| **Web Search** | Generate search queries and perform web searches |
| **Read File** | Read file contents, including images (.png, .jpg, .svg) for vision models |
| **Edit File** | Suggest edits and apply them automatically |
| **Terminal** | Execute commands with sandbox protection |
| **Browser** | Control a web browser for testing, screenshots, visual editing |
| **Image Generation** | Generate images from text descriptions |
| **Ask Clarification** | Ask the user clarifying questions (continues working while waiting) |
| **MCP Tools** | Any tools exposed through configured MCP servers |

### Context System

#### Codebase Indexing
- **Automatic indexing**: Begins when workspace is opened
- **Semantic embeddings**: Code indexed for meaning-based search
- **Incremental sync**: Re-indexes only changed files every 5 minutes
- **80% threshold**: Semantic search becomes available at 80% index completion
- **Respects .gitignore**: Indexes all files except those in .gitignore
- **6-week retention**: Indexed codebases deleted after 6 weeks of inactivity
- **Team sharing**: Indexes can be shared across team members
- **Multi-root workspace support**: Indexes all workspace roots

#### Search Strategy (Three-Layer)
1. **Instant Grep**: Exact match for function names, variables, regex patterns (`import.*PaymentService`)
2. **Semantic Search**: Meaning-based search when exact name is unknown ("where does session handling happen?" -> finds `middleware/session.ts`)
3. **Explore Subagent**: Autonomous search agent for complex tasks -- chains semantic search, grep, and file reads. Keeps main conversation focused by summarizing results

Agent decides the search strategy automatically based on the prompt. For complex tasks, it chains: semantic search -> grep -> file reads -> reference following.

#### @-Mentions
- Cursor 2.0 removed explicit context items like `@Codebase`, `@Web`, etc.
- Now uses simple `@` mentions for files when you know which files are relevant
- If unsure, skip it -- Agent finds relevant files through its own search
- Attach images via clipboard paste for visual context (UI work, debugging, design mockups)

### Sandbox System

Agent runs terminal commands in a restricted sandbox by default:

| Permission | Status |
|-----------|--------|
| Read access to filesystem | Allowed |
| Write access to workspace | Allowed |
| Write access outside workspace | Blocked |
| Network access | Restricted to allowlist |

Platform-specific implementations:
- **macOS**: Works out of the box (Cursor v2.0+)
- **Linux**: Uses Landlock LSM + user namespaces (kernel config required)
- **Windows**: Runs inside WSL2 with Linux restrictions

Configuration via `sandbox.json`:
- Custom network allowlists (default covers npm, pypi, common registries)
- Environment variable injection (`CURSOR_SANDBOX`, `CURSOR_ORIGINAL_UID/GID`)
- Command allowlists for bypassing sandbox
- Docker and container automation support

Auto-run modes:
- **Sandbox** (default): Auto-run in sandbox, ask for out-of-sandbox
- **Ask**: All commands require approval
- **Run Everything**: Full auto-run without restrictions

### Checkpoint System

- Automatic snapshots before significant changes
- Captures state of all modified files
- Click any checkpoint in chat timeline to preview/restore
- Separate from Git -- for undoing Agent changes only
- Supports exploratory work, complex refactoring, iterative development

### Message Queue

- Queue follow-up messages while Agent is working
- Messages appear in order, can be reordered via drag
- Agent processes them sequentially
- Pressing Enter while agent works creates an interrupt (attaches to current tool results)

## Key Patterns

### [agent] Model-Agnostic Orchestration
Cursor tunes its agent loop per-model -- different prompts, tool-calling strategies, and instructions for Claude vs GPT vs Gemini. Developers pick the model; Cursor handles the orchestration differences. Can switch models mid-conversation (e.g., fast model for exploration, reasoning model for implementation).

### [pattern] Plan-Then-Execute
Plan Mode separates planning from execution. The agent researches the codebase, asks clarifying questions, and generates a reviewable markdown plan. The developer edits the plan, then clicks "Build" to execute. Plans are saved as markdown files. If execution goes wrong, revert to checkpoint and refine the plan rather than patching.

### [hook] Comprehensive Hook System
Cursor's hook system is one of the most extensive in any agentic coding tool:

- **preToolUse / postToolUse / postToolUseFailure** -- Before/after any tool execution
- **beforeShellExecution / afterShellExecution** -- Terminal command hooks
- **beforeMCPExecution / afterMCPExecution** -- MCP tool hooks
- **beforeFileRead / afterFileEdit** -- File operation hooks
- **beforeTabFileRead / afterTabFileEdit** -- Tab-specific hooks (separate policies)
- **subagentStart / subagentStop** -- Control subagent (Task tool) spawning
- **beforePromptSubmission** -- Gate user prompts before submission
- **afterAssistantMessage / afterThinkingBlock** -- Observe agent reasoning
- **agentLoopEnd** -- Auto-submit follow-up messages to keep iterating
- **composerStart / composerEnd** -- Session lifecycle hooks
- **beforeContextCompaction** -- Observe context window summarization

Hooks communicate over stdio with JSON. They can:
- Block/allow actions
- Modify tool inputs/outputs
- Inject context
- Set session-scoped environment variables
- Auto-continue with follow-up messages

Supports command-based hooks (shell scripts) and prompt-based hooks (LLM-evaluated natural language conditions).

### [hook] Enterprise Hook Distribution
Four-tier hook priority: Enterprise > Team > Project (`.cursor/`) > User (`~/.cursor/`)
Distribution methods:
- Version control (project hooks)
- MDM tools
- Cloud distribution (enterprise, auto-sync every 30 minutes)

### [skill] Explore Subagent
When a task benefits from broad search, Agent spawns an Explore subagent automatically. This subagent searches through many files, follows references, and summarizes results -- keeping the main conversation's context window clean. Users can also request it directly: "explore the authentication flow."

### [mcp] Full MCP Integration
- Supports stdio, SSE, and HTTP transports
- OAuth support (including static OAuth with fixed redirect URLs)
- MCP Apps: Interactive UI views returned by MCP tools (progressive enhancement)
- Config interpolation with environment variables
- Extension API for programmatic MCP server registration (`vscode.cursor.mcp.registerServer()`)
- Project-level (`.cursor/mcp.json`) and global configuration
- Auto-run support for trusted MCP tools
- Cloud Agents can use MCP servers too (both HTTP and stdio)

### [memory] Cloud Agent Memory Tool
Cloud agents have access to a memory tool that lets them learn from past runs and improve with repetition. This enables agents to accumulate knowledge across sessions.

### [sandbox] Defense-in-Depth Sandboxing
Multiple layers: filesystem restrictions, network allowlists, command allowlists, MCP tool allowlists, file-deletion protection, dot-file protection, external-file protection. Enterprise admins can override all settings.

### [orchestration] Agent Client Protocol (ACP)
Cursor has created the Agent Client Protocol to extend agent capabilities to other IDEs. Now available in JetBrains IDEs (IntelliJ, PyCharm, WebStorm) -- any frontier model can be used for agent-driven development through ACP.

### [pattern] AGENTS.md Convention
Cloud Agents read instructions from `AGENTS.md` files in the repository. This is similar to `CLAUDE.md` or `.cursorrules` but specifically for cloud agent context. Supports a dedicated "Cursor Cloud specific instructions" section, and can reference other files for detailed task-specific instructions.

### [sandbox] Cloud Agent VM Architecture
Each cloud agent runs in an isolated Ubuntu VM with:
- Full desktop environment with mouse/keyboard control
- Docker support (runs inside container layer)
- Tailscale support (userspace networking mode)
- Environment snapshots for fast startup
- Dockerfile-based custom environments
- Secrets management (encrypted at rest, KMS, redacted option)
- Automatic CI failure fixing

### [pattern] Artifact-Driven PR Workflow
Cloud agents create PRs with attached artifacts (screenshots, videos, logs) so reviewers can validate changes without checking out branches locally. Agents clone repos, work on separate branches, and push changes for handoff.

### [hook] Context Compaction Hooks
The `beforeContextCompaction` hook fires when the context window needs summarization. Provides usage percentage, token counts, message counts, and reason for compaction (automatic vs manual). Allows observing when and why context is being compressed.

## Strengths

1. **Seamless IDE Integration**: The agent operates within the same visual environment where you code. Diffs, terminal output, browser screenshots, and checkpoint history are all visible inline. No context-switching to a terminal.

2. **Three-Tier Autonomy Progression**: Tab -> Agent -> Cloud Agent provides a natural progression from autocomplete to fully autonomous background coding. Each tier has appropriate guardrails.

3. **Sophisticated Search**: The three-layer search system (Instant Grep + Semantic Search + Explore Subagent) means the agent can find code whether you give it exact names or vague descriptions. The subagent pattern for context management is particularly clever.

4. **Best-in-Class Hook System**: The hook system is remarkably comprehensive -- covering every phase of the agent loop, supporting both script and LLM-based hooks, with enterprise distribution. This enables security scanning, policy enforcement, analytics, and custom integrations.

5. **Cloud Agent Maturity**: Full VM isolation, Docker support, CI auto-fix, artifact attachment to PRs, Tailscale support, environment snapshots -- this is production-ready background agent infrastructure.

6. **MCP Ecosystem**: Deep MCP integration with marketplace, OAuth, MCP Apps (interactive UI), and extension API for programmatic registration. The marketplace of agents, skills, and commands creates a plugin ecosystem.

7. **Model Flexibility**: True model-agnostic design with per-model orchestration tuning. Switch models mid-conversation. Supports Claude, GPT, Gemini, and custom models via API keys.

8. **Checkpoint Safety**: Automatic snapshots before changes provide easy rollback without polluting Git history.

## Weaknesses

1. **Closed Source**: The core agent orchestration logic is proprietary. You cannot inspect, modify, or self-host the agent loop. Lock-in to Cursor's platform.

2. **IDE-Bound**: Requires using Cursor IDE (or JetBrains via ACP). Cannot be used in arbitrary environments, CI pipelines, or headless servers without the Cloud Agent tier.

3. **Context Window Opacity**: The semantic indexing and context selection happens as a black box. Users cannot see exactly what context is being sent to the model or fine-tune the retrieval strategy.

4. **Cloud Agent Cost**: Cloud agents run at API pricing with full VM overhead. Heavy usage can be expensive. Enterprise features (cloud hook distribution, advanced sandbox controls) require premium plans.

5. **JavaScript-Rendered Documentation**: The documentation site is entirely client-side rendered, making it difficult to crawl, index externally, or access programmatically.

6. **Single-Agent Focus**: Unlike swarm-based approaches (Claude Code's orchestrator pattern, Stripe's Minions), Cursor's agent model is primarily single-agent with subagent support. No built-in multi-agent coordination beyond the Explore subagent and Cloud Agent parallelism.

7. **Sandbox Platform Dependencies**: Linux sandbox requires specific kernel config (Landlock, user namespaces). Some distributions need additional AppArmor profile setup. Docker/Tailscale have edge cases.

8. **No Offline Mode**: Requires Cursor's servers for model access, indexing, and cloud agent features. Cannot operate fully offline.

## Unique Ideas Worth Extracting

### 1. Explore Subagent Pattern
The idea of spawning a dedicated search subagent that summarizes findings rather than dumping raw file contents into the main context is excellent for context management. This prevents the main conversation from being polluted with search results.

**Extractable principle**: When an agent needs to search broadly, delegate to a subagent that returns a summary, not raw data.

### 2. Per-Model Orchestration Tuning
Cursor automatically adjusts prompts, tool-calling patterns, and instructions based on which model is selected. This is a key insight: **the same task requires different orchestration for different models**.

**Extractable principle**: Agent frameworks should have model-specific profiles that tune prompting strategy, tool use patterns, and error handling per LLM.

### 3. Hook-Based Extension System
Rather than requiring plugins or extensions, Cursor's hook system lets you intercept and modify agent behavior through simple shell scripts or LLM-evaluated prompts. The `agentLoopEnd` hook that can auto-submit follow-up messages is particularly powerful for creating custom agent loops.

**Extractable principle**: Provide lifecycle hooks at every agent decision point. Support both deterministic (script) and probabilistic (LLM-evaluated) hooks.

### 4. Plan-as-Artifact Pattern
Plan Mode saves plans as markdown files that can be edited, version-controlled, and re-executed. The advice to "revert to checkpoint and refine the plan" rather than patching a failed execution is a key workflow insight.

**Extractable principle**: Separate planning from execution with a reviewable, editable artifact. Failed execution should trigger plan refinement, not incremental patching.

### 5. Progressive Sandbox Escalation
The sandbox starts restrictive, shows clear indicators when commands run outside sandbox, and offers three escalation options: cancel, run once without sandbox, or permanently allowlist. This is better UX than binary allow/deny.

**Extractable principle**: Security should be progressive -- start restricted, offer clear escalation paths, and remember user decisions.

### 6. Checkpoint System (Separate from Git)
Using lightweight, ephemeral checkpoints for agent changes while keeping Git for permanent version control. This gives safe exploration without cluttering commit history.

**Extractable principle**: Agent-specific undo history should be separate from version control.

### 7. Cloud Agent Memory Tool
Agents that learn from past runs and improve with repetition. This accumulated knowledge across sessions enables agents to get better at recurring tasks for a specific codebase.

**Extractable principle**: Persist agent learnings across sessions for the same project/repository.

### 8. AGENTS.md Convention
A standardized file for agent-specific instructions, separate from human-facing README or contributing guides. With sections for cloud-specific instructions and references to detailed task files.

**Extractable principle**: Standardize agent instruction files in repositories. Allow layered instructions (general + environment-specific).

### 9. MCP Apps (Interactive UI in Agent Chat)
MCP tools can return interactive UI views directly in the agent chat. This enables rich tool interactions beyond text -- forms, visualizations, previews. Progressive enhancement means the same tool works in non-UI hosts.

**Extractable principle**: Agent tool responses should support rich, interactive UI when the host supports it, with graceful text fallback.

### 10. Agent Client Protocol (ACP)
Rather than locking agent capabilities to one IDE, Cursor created a protocol for exposing agent features to other editors. This is the right abstraction layer for IDE-agent integration.

**Extractable principle**: Define a protocol layer between agent capabilities and editor integration, enabling multi-editor support.

## Code Examples

### sandbox.json Configuration
```json
{
  "network": {
    "allowlist": [
      "registry.npmjs.org",
      "api.github.com",
      "pypi.org",
      "*.amazonaws.com"
    ]
  },
  "filesystem": {
    "workspace": "read-write",
    "system": "read-only",
    "blocked": ["/etc/shadow", "/root/.ssh"]
  },
  "commands": {
    "allowlist": ["npm install", "pip install", "cargo build"]
  }
}
```

### .cursor/hooks.json (Hook Configuration)
```json
{
  "version": 1,
  "hooks": {
    "afterFileEdit": [
      {
        "command": "chmod +x .cursor/hooks/format.sh",
        "timeout": 10
      }
    ],
    "beforeShellExecution": [
      {
        "command": "python3 .cursor/hooks/kube_guard.py",
        "matchers": ["kubectl*"],
        "failOpen": false
      }
    ],
    "preToolUse": [
      {
        "prompt": "Does this command look safe to execute? Only allow read-only operations.",
        "matchers": ["Shell"]
      }
    ],
    "subagentStart": [
      {
        "command": "bun run .cursor/hooks/track-stop.ts --stop",
        "timeout": 5,
        "loopLimit": 3
      }
    ],
    "composerStart": [
      {
        "command": "node .cursor/hooks/session-init.js"
      }
    ]
  }
}
```

### Hook Script Example (TypeScript stop-automation)
```typescript
// .cursor/hooks/track-stop.ts
import { readFileSync } from "fs";

const input = JSON.parse(readFileSync("/dev/stdin", "utf-8"));

// Hooks receive base fields:
// - conversationId: stable ID across turns
// - generationId: changes with every user message
// - model: configured model name
// - hookName: which hook is running
// - cursorVersion: e.g., "2.0.0"
// - workspaceFolders: root folders in workspace

if (input.hookName === "subagentStop") {
  const result = {
    // Auto-continue with a follow-up message
    autoFollowUp: "Verify the changes compile correctly",
    // Or block/allow
    decision: "allow"
  };
  console.log(JSON.stringify(result));
}
```

### MCP Server Configuration (.cursor/mcp.json)
```json
{
  "mcpServers": {
    "local-db": {
      "transport": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "${env:DATABASE_URL}"
      }
    },
    "remote-api": {
      "transport": "http",
      "url": "https://mcp.example.com/api",
      "headers": {
        "Authorization": "Bearer ${env:MY_SERVICE_TOKEN}"
      }
    },
    "oauth-service": {
      "transport": "http",
      "url": "https://service.example.com/mcp",
      "oauth": {
        "clientId": "${env:OAUTH_CLIENT_ID}",
        "clientSecret": "${env:OAUTH_CLIENT_SECRET}",
        "scopes": ["read", "write"]
      }
    }
  }
}
```

### AGENTS.md for Cloud Agents
```markdown
# Agent Instructions

## Setup
Run `npm install` before making changes.
Always run `npm test` after modifying code.

## Cursor Cloud specific instructions
- Use `npm run build` to verify compilation
- Run `npm run e2e` for end-to-end tests
- If CI fails, check the `test:integration` script first
- For database changes, run migrations with `npm run db:migrate`

## Architecture
See `/docs/architecture.md` for system overview.
See `/docs/api-design.md` for API conventions.
```

### Cloud Agent Environment Configuration (environment.json)
```json
{
  "dockerfile": "./Dockerfile.cloud-agent",
  "update": "npm install && npm run build",
  "startup": "npm run dev",
  "secrets": {
    "API_KEY": "from-cursor-dashboard",
    "DATABASE_URL": "from-cursor-dashboard"
  }
}
```

### MCP Extension API (Programmatic Registration)
```typescript
// In a VS Code/Cursor extension
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  // Register an MCP server programmatically
  const cursor = vscode.extensions.getExtension("cursor.cursor");
  if (cursor) {
    const api = cursor.exports;
    api.mcp.registerServer({
      name: "my-custom-mcp",
      transport: "stdio",
      command: "node",
      args: ["./mcp-server.js"],
      env: {
        API_KEY: process.env.MY_API_KEY
      }
    });
  }
}
```

### Auto-Run Configuration (Cursor Settings)
```
Settings > Cursor Settings > Agents > Auto-Run:
  - Sandbox (default): Tools auto-run in sandbox
  - Ask: All tools require approval
  - Run Everything: Full auto-run

Auto-Run Network Access:
  - sandbox.json only
  - sandbox.json + Defaults (recommended)
  - Allow All

Protections:
  - File-Deletion Protection: ON
  - Dot-File Protection: ON
  - External-File Protection: ON
  - MCP Auto-Run Protection: ON
```

---

*Research compiled from Cursor documentation (docs.cursor.com), changelog, sitemap, and AIDE open-source comparison. Cloud Agents were formerly called Background Agents. Cursor version referenced: 2.0+. Analysis date: 2026-03-23.*
