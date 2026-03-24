# Devin & Goose — Autonomous Coding Agents

## Overview & Philosophy

### Devin (Cognition)
Devin is a **closed-source, cloud-hosted autonomous software engineer** built by Cognition AI. Its core philosophy is to be a fully autonomous "AI teammate" — not a copilot that assists, but an agent that independently takes on entire engineering tasks from specification to PR. Devin runs in an isolated cloud VM with a complete development environment (shell, VS Code-style editor, Chrome browser), enabling it to autonomously plan, code, test, debug, and iterate without human intervention.

Key philosophy: **Replace the junior engineer workflow** — give Devin a task via Slack or a web interface, and it delivers a pull request. The human reviews; Devin handles everything else. Cognition explicitly positions Devin as a "team member" with its own Slack presence, knowledge base, and performance reviews.

Pricing: Starting at $20/month (Devin 2.0), Team plan at $500/month for 250 Agent Compute Units (ACUs), Enterprise with custom pricing and VPC deployment.

### Goose (Block/Square)
Goose is an **open-source, local-first, extensible AI agent** built in Rust by Block (parent company of Square, Cash App, TIDAL). Its philosophy centers on developer sovereignty — the agent runs on your machine, works with any LLM, and extends through the Model Context Protocol (MCP). Goose is not locked to a cloud service or specific model; it is a framework for building autonomous coding agents.

Key philosophy: **Local extensibility over cloud lock-in** — Goose gives developers a modular agent that can be customized, forked, and distributed as "custom distros" with organization-specific providers, extensions, and branding. It was contributed to the Linux Foundation's Agentic AI Foundation (AAIF) in December 2025 alongside MCP.

Pricing: Free and open-source (Apache 2.0). You pay only for LLM API costs.

---

## Architecture

### Devin Architecture

Devin is a **compound AI system** — not a single model but a swarm of specialized models:

```
┌──────────────────────────────────────────────────────────┐
│                    Devin Session (Cloud VM)               │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Planner │  │  Coder   │  │  Critic  │  │ Browser  │  │
│  │ (reason)│  │ (codegen)│  │ (review) │  │ (scrape) │  │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       │            │             │              │         │
│  ┌────▼────────────▼─────────────▼──────────────▼─────┐  │
│  │              Sandbox Environment                    │  │
│  │  ┌──────────┐ ┌────────────┐ ┌──────────────────┐  │  │
│  │  │  Bash    │ │ VS Code    │ │ Chrome (headless)│  │  │
│  │  │  Shell   │ │ Editor     │ │ Browser          │  │  │
│  │  └──────────┘ └────────────┘ └──────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │     Memory Layer (vectorized snapshots + replay)   │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
         │
         │ gRPC/WebSocket (<50ms latency)
         ▼
┌──────────────────────────────┐
│  Client (Slack / Web / API)  │
│  Bidirectional file sync     │
│  Real-time session display   │
└──────────────────────────────┘
```

**Key architectural decisions:**
- Each session is a fresh, isolated cloud VM with full dev stack
- Multiple sandboxes can run in parallel (parallelized task execution)
- Persistent memory layer stores vectorized code snapshots + full replay timeline of every command, file diff, and browser tab
- Enterprise VPC deployment: VMs run inside customer infrastructure, stateless (no data at rest outside customer environment)
- Auto-indexes repositories every few hours to build searchable wiki with architecture diagrams

### Goose Architecture

Goose is a **modular Rust agent** with a client-server architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interfaces                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  CLI        │  │  Desktop    │  │  Your Custom UI         │  │
│  │  (goose-cli)│  │  (Electron) │  │  (web, mobile, etc.)    │  │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘  │
└─────────┼────────────────┼──────────────────────┼───────────────┘
          │                │                      │
          ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    goose-server (goosed)                        │
│         REST API for all goose functionality                    │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Core (goose crate)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Providers  │  │  Extensions │  │  Config & Recipes       │  │
│  │  (AI models)│  │  (MCP tools)│  │  (behavior & defaults)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Crate structure:**
- `goose` — core logic: agents, providers, extensions, config, prompts, recipes, permissions, security
- `goose-acp` — Agent Client Protocol implementation
- `goose-acp-macros` — ACP proc macros
- `goose-cli` — CLI entry point
- `goose-server` — backend REST server (binary: `goosed`)
- `goose-mcp` — MCP extension implementations
- `goose-test` / `goose-test-support` — test utilities

**Key architectural decisions:**
- Agent struct holds: provider, extension_manager, prompt_manager, tool_confirmation_router, retry_manager, tool_inspection_manager, permission system
- Tool inspection pipeline: SecurityInspector -> AdversaryInspector (LLM-based) -> PermissionInspector -> RepetitionInspector
- Streaming tool execution with async notification channels
- Context compaction for long conversations (automatic summarization when context exceeds threshold)
- Subagent execution for complex multi-step tasks
- Declarative provider system — add new LLM providers via configuration, not code

---

## Key Patterns

### Devin Patterns

**[agent][orchestration] Multi-Model Swarm Architecture**
Devin uses specialized models for different phases: Planner (high-reasoning), Coder (code-specialized), Critic (adversarial review), Browser (web scraping). Each model is optimized for its role rather than using one general-purpose model for everything.

**[sandbox][agent] Isolated Cloud VM Per Session**
Every Devin session spawns a fresh cloud VM with a complete development environment. This provides perfect isolation — sessions cannot interfere with each other, and multiple sessions can run in parallel for batch operations.

**[memory][agent] Vectorized Codebase Memory + Replay Timeline**
Devin maintains a memory layer with vectorized snapshots of the codebase plus a full replay timeline of every command, file diff, and browser tab. This enables long-running migrations where Devin maintains a running to-do list across hours or days.

**[agent][pattern] Adaptive Planning Loop**
Devin's plan is not static — it evolves as new information becomes available during execution. The agent decomposes goals, implements steps, runs tests, diagnoses failures, and iterates. Plans adapt when requirements are ambiguous or change during implementation.

**[agent][hook] Autofix Review Comments Loop**
When Devin receives PR review comments (from humans or bots), it automatically resolves them and feeds fixes back into the PR, creating a closed feedback loop. This extends to autofixing lint errors and CI/CD failures.

**[memory][pattern] Auto-Indexing Knowledge Base**
Devin automatically indexes repositories every few hours, generating comprehensive wikis with architecture diagrams, source links, and searchable documentation. "Devin Search" allows natural language questions about codebases.

**[orchestration][agent] Slack-Native Session Management**
Sessions can be initiated via Slack (@devin), web UI, API, Linear, Jira, or Microsoft Teams. Voice messages in Slack are supported. Each session has a unique origin that can be filtered and tracked.

**[sandbox][pattern] Enterprise VPC Deployment**
For enterprise customers, Devin's VMs run inside the customer's VPC, accessing proprietary resources behind corporate firewalls. The system is entirely stateless — no data is stored at rest outside the customer environment.

### Goose Patterns

**[mcp][agent] MCP-First Extension System**
Goose's entire tool ecosystem is built on the Model Context Protocol. Extensions are MCP servers — either builtin (compiled into Goose) or external (stdio/SSE processes). This means any MCP server in the ecosystem automatically works with Goose.

**[agent][pattern] Four Operating Modes**
Goose supports four permission modes that control agent autonomy:
- `auto` — automatically approve all tool calls (full autonomy)
- `approve` — ask before every tool call (maximum safety)
- `smart_approve` — ask only for sensitive tool calls (balanced)
- `chat` — chat only, no tool calls (conversation mode)

**[skill][pattern] Recipe System (Shareable Workflows)**
Recipes are YAML files that bundle instructions, required extensions, parameters, and retry logic into shareable configurations. A recipe defines what the agent should do, which extensions it needs, and how it should behave — making workflows reproducible and distributable.

**[security][agent] Multi-Layer Tool Inspection Pipeline**
Before any tool is executed, it passes through a chain of inspectors:
1. SecurityInspector — blocks dangerous operations
2. AdversaryInspector — LLM-based review (configurable via `~/.config/goose/adversary.md`)
3. PermissionInspector — checks user-defined permission rules
4. RepetitionInspector — detects and breaks repetitive tool call loops

**[agent][pattern] Context Compaction**
When conversations exceed a configurable threshold, Goose automatically compacts the conversation history using summarization, preserving key context while reducing token usage. This enables very long sessions without context window overflow.

**[agent][orchestration] Subagent Execution**
Goose supports spawning subagents for complex multi-step tasks, with a dedicated subagent system prompt and task configuration. This enables hierarchical task decomposition within a single session.

**[mcp][pattern] Extension Environment Security**
Extensions cannot override sensitive environment variables (PATH, LD_PRELOAD, LD_LIBRARY_PATH, etc. — 31 disallowed keys). This prevents MCP servers from hijacking the execution environment.

**[agent][pattern] Custom Distributions ("Distros")**
Organizations can fork Goose and create branded distributions with preconfigured providers, bundled extensions, custom system prompts, and modified UI — similar to Linux distributions. This is a unique approach to enterprise customization.

**[pattern][agent] Declarative Provider System**
New LLM providers can be added via YAML configuration in `crates/goose/src/providers/declarative/` without writing Rust code, lowering the barrier for model integration.

**[agent][pattern] Jinja-Templated System Prompts**
System prompts use Jinja2 templating with dynamic sections for active extensions, tool limits, and mode-specific behavior. This enables context-aware prompt construction.

---

## Strengths

### Devin Strengths
- **True autonomy**: Can take a Slack message and deliver a merged PR without human intervention beyond review
- **Full environment access**: Shell, editor, and browser in a sandboxed VM — can install dependencies, run tests, browse documentation, debug visually
- **Parallel execution**: Multiple isolated sessions running simultaneously for batch operations
- **Persistent memory**: Long-running tasks spanning hours or days with maintained context and to-do lists
- **Enterprise-ready**: VPC deployment, SOC2 compliance, Slack/Jira/Linear integration
- **Closed feedback loop**: Autofixes review comments, lint errors, and CI failures without human intervention
- **Performance trajectory**: 67% PR merge rate (up from 34%), 4x faster problem-solving, 2x more efficient resource usage over 18 months
- **Knowledge base**: Auto-generated wiki with architecture diagrams and searchable codebase Q&A

### Goose Strengths
- **Open source (Apache 2.0)**: Full code visibility, community contributions, no vendor lock-in
- **Model agnostic**: Works with any LLM that supports tool calling — OpenAI, Anthropic, local models via Ollama
- **MCP ecosystem**: Instant access to 100+ MCP servers for databases, APIs, services
- **Local-first**: Runs on your machine, no data leaves unless you choose a cloud LLM
- **Extensible architecture**: Modular Rust codebase with clean separation of concerns
- **Multi-layer security**: Four operating modes plus a pipeline of security/permission/adversary inspectors
- **Recipe system**: Shareable, reproducible workflows as YAML files
- **Custom distros**: Organizations can build branded Goose distributions
- **Fast Rust implementation**: High performance, low overhead compared to Python-based agents
- **Linux Foundation backing**: Part of the Agentic AI Foundation alongside MCP

---

## Weaknesses

### Devin Weaknesses
- **Cost**: $500/month team plan + per-ACU charges; expensive for extensive use
- **Black box**: Closed-source compound system — when it fails, debugging is opaque
- **Cloud dependency**: Requires internet connectivity and Cognition's infrastructure (unless enterprise VPC)
- **Latency**: Cloud VM spin-up time, network round-trips for every interaction
- **Junior-level ceiling**: Works best on well-defined, routine tasks; struggles with ambiguous architectural decisions
- **Reliability concerns**: Despite 67% merge rate improvement, 33% of PRs still need rework
- **Vendor lock-in**: Proprietary system with no open-source alternative for the architecture
- **Context limitations**: Memory layer helps but very large codebases still challenge understanding
- **Review overhead**: Teams must still review every PR — the "autonomous" promise shifts work from coding to reviewing

### Goose Weaknesses
- **No built-in sandbox**: Runs directly on your machine — tool calls can modify local files, run arbitrary commands
- **Single-model limitation**: Uses one provider at a time (no specialized planner/coder/critic swarm)
- **No built-in browser**: Cannot natively browse the web or interact with UIs (requires MCP extensions)
- **Configuration complexity**: YAML configs, extension setup, provider configuration requires technical knowledge
- **No persistent memory across sessions**: No built-in long-term memory or codebase indexing
- **Community maturity**: Younger project, smaller ecosystem than established tools
- **Desktop app quality**: Electron app is functional but less polished than commercial tools
- **No parallel sessions**: Single agent per session, no built-in multi-agent swarm coordination
- **LLM dependency**: Quality is entirely dependent on the underlying model's capabilities

---

## Unique Ideas Worth Extracting

### From Devin

1. **[orchestration] Multi-model specialization**: Using different models optimized for planning, coding, reviewing, and browsing rather than one general-purpose model. This is the most significant architectural insight — compound AI systems outperform monolithic ones.

2. **[memory] Vectorized codebase snapshots + replay timeline**: Combining semantic search over code with a complete temporal record of all agent actions. This enables both "what does this code do?" and "what did the agent do and why?"

3. **[sandbox] VM-per-session isolation**: Perfect sandboxing through virtualization. Each task gets a clean environment that cannot affect others. This pattern is essential for running untrusted agent actions safely.

4. **[hook] Closed-loop autofix on review comments**: Automatically processing PR review feedback and iterating until reviewers approve. This turns code review from a blocking handoff into an asynchronous refinement loop.

5. **[memory] Auto-indexing knowledge base with architecture diagrams**: Proactively building searchable, visual documentation of codebases rather than waiting for queries. This inverts the typical RAG pattern.

6. **[pattern] Session origin tracking**: Tagging sessions by origin (Slack, API, Jira, etc.) for analytics, filtering, and workflow optimization.

### From Goose

1. **[mcp] MCP as the universal extension protocol**: Building the entire tool ecosystem on a single open standard means any tool built for any MCP-compatible agent works with Goose. This is the most strategically important pattern for the agent ecosystem.

2. **[pattern] Recipe system for reproducible workflows**: Packaging agent instructions, required extensions, parameters, and retry logic into shareable YAML files. This solves the "how do I share what works" problem elegantly.

3. **[security] Multi-layer tool inspection pipeline**: Chaining SecurityInspector -> AdversaryInspector -> PermissionInspector -> RepetitionInspector before every tool call. The adversary inspector (LLM-based review) is particularly novel.

4. **[agent] Custom distributions**: Treating an AI agent like a Linux distribution — fork, customize providers/extensions/prompts/branding, and ship to your organization. This is a unique open-source go-to-market pattern.

5. **[pattern] Environment variable security blocklist**: Preventing extensions from overriding 31 sensitive env vars (PATH, LD_PRELOAD, etc.). Simple but critical for preventing supply-chain attacks via malicious MCP servers.

6. **[agent] Context compaction for long sessions**: Automatically summarizing conversation history when it exceeds a threshold, enabling indefinitely long sessions without context window overflow.

7. **[pattern] Declarative provider registration**: Adding new LLM providers via configuration rather than code changes. This dramatically lowers the barrier for supporting new models.

8. **[agent] GooseMode enum (auto/approve/smart_approve/chat)**: A clean, graduated permission model that lets users choose their comfort level with agent autonomy. This is better than binary "allow/deny" approaches.

---

## Code Examples

### Goose: Recipe Configuration (YAML)
```yaml
# recipe.yaml — Shareable workflow definition
version: 1.0.0
title: "404Portfolio"
description: "Create personalized, creative 404 pages using public profile data"

instructions: |
  Create an engaging 404 error page that tells a creative story
  using a user's recent public content from GitHub, Dev.to, or Bluesky.

  The page should be fully built with HTML, CSS, and JavaScript, featuring:
  * Responsive design
  * Personal branding elements (name, handle, avatar)
  * Narrative-driven layout

  Ask the user:
  1. Which platform to use: GitHub, Dev.to, or Bluesky
  2. Their username on that platform

  Then generate the complete code in a folder called 404-story.

activities:
  - "Build error page from GitHub repos"
  - "Generate error page from dev.to blog posts"
  - "Create a 404 page featuring Bluesky bio"

extensions:
  - type: builtin
    name: developer
  - type: builtin
    name: computercontroller
```

### Goose: Extension Configuration (config.yaml)
```yaml
# ~/.config/goose/config.yaml
GOOSE_PROVIDER: anthropic
GOOSE_MODEL: claude-sonnet-4-20250514

extensions:
  - type: builtin
    name: developer
    display_name: "Developer Tools"
    enabled: true
    timeout: null

  - type: stdio
    name: github
    display_name: "GitHub"
    enabled: true
    cmd: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env_keys:
      - GITHUB_PERSONAL_ACCESS_TOKEN
```

### Goose: Agent Core Structure (Rust)
```rust
// crates/goose/src/agents/agent.rs — Core agent struct
pub struct Agent {
    provider: SharedProvider,                          // LLM provider (any model)
    config: AgentConfig,                               // Session/permission/mode config
    extension_manager: Arc<ExtensionManager>,          // MCP extension management
    prompt_manager: Mutex<PromptManager>,              // Jinja-templated prompts
    tool_confirmation_router: ToolConfirmationRouter,  // Route tool calls to confirmation
    retry_manager: RetryManager,                       // Automatic retry logic
    tool_inspection_manager: ToolInspectionManager,    // Security/permission pipeline
    container: Mutex<Option<Container>>,               // Optional container sandbox
}

// Tool inspection pipeline — runs before every tool execution
fn create_tool_inspection_manager(...) -> ToolInspectionManager {
    let mut manager = ToolInspectionManager::new();
    manager.add_inspector(Box::new(SecurityInspector::new()));        // Block dangerous ops
    manager.add_inspector(Box::new(AdversaryInspector::new(provider))); // LLM review
    manager.add_inspector(Box::new(PermissionInspector::new(...)));   // User permissions
    manager.add_inspector(Box::new(RepetitionInspector::new(None)));  // Break loops
    manager
}
```

### Goose: Operating Modes
```rust
// crates/goose/src/config/goose_mode.rs
pub enum GooseMode {
    Auto,         // Automatically approve tool calls (full autonomy)
    Approve,      // Ask before every tool call (maximum safety)
    SmartApprove, // Ask only for sensitive tool calls (balanced)
    Chat,         // Chat only, no tool calls (conversation mode)
}
```

### Goose: System Prompt (Jinja2 Template)
```markdown
{# crates/goose/src/prompts/system.md #}
You are a general-purpose AI agent called goose, created by Block.

# Extensions
{% for extension in extensions %}
## {{extension.name}}
{% if extension.instructions %}### Instructions
{{extension.instructions}}{% endif %}
{% endfor %}

{% if extension_tool_limits is defined %}
# Suggestion
The user has {{extension_count}} extensions with {{tool_count}} tools enabled,
exceeding recommended limits. Consider asking to disable some extensions.
{% endif %}
```

### Goose: Custom Distribution Architecture
```
# Organizations can fork and customize:
┌──────────────────────────────────────────┐
│  Your Custom Goose Distribution          │
├──────────────────────────────────────────┤
│  Preconfigured provider (e.g. Ollama)    │  ← config.yaml
│  Bundled internal MCP extensions         │  ← extensions section
│  Custom system prompts                   │  ← crates/goose/src/prompts/
│  Branded desktop UI                      │  ← ui/desktop/
│  Organization-specific recipes           │  ← workflow_recipes/
│  Guided onboarding flows                 │  ← init-config.yaml
└──────────────────────────────────────────┘
```

### Devin: Session Interaction (API)
```bash
# Start a Devin session via API
curl -X POST https://api.devin.ai/v1/sessions \
  -H "Authorization: Bearer $DEVIN_API_KEY" \
  -d '{
    "prompt": "Fix the failing test in src/auth/login.test.ts",
    "repository": "org/repo",
    "branch": "main"
  }'

# Devin spawns a cloud VM, clones the repo, analyzes the test,
# fixes the code, runs the test suite, and opens a PR.
# Session can be monitored in real-time via Slack or web UI.
```

### Devin: Slack Integration Pattern
```
# In Slack channel:
@devin Fix the N+1 query in the users endpoint.
       Check the slow query log at /var/log/pg_slow.log

# Devin:
# 1. Spins up isolated VM
# 2. Clones repo, checks out branch
# 3. Analyzes slow query log
# 4. Identifies N+1 query pattern
# 5. Implements eager loading fix
# 6. Runs test suite
# 7. Opens PR with description
# 8. Posts PR link back to Slack
# 9. Autofixes any review comments
```
