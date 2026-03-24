# Paperclip AI

## Overview & Philosophy

Paperclip is an open-source Node.js/React application that orchestrates teams of AI agents as autonomous companies. Created in early 2026, it has rapidly gained traction (32k+ GitHub stars) by addressing a real pain point: coordinating many AI coding agents (Claude Code, Codex, Cursor, etc.) toward a unified business goal without losing track of who is doing what, how much it costs, and whether it is working.

**Core thesis:** "If OpenClaw is an employee, Paperclip is the company." Paperclip does not build agents or tell you how to build them. It provides the organizational infrastructure -- org charts, goals, budgets, governance, task management, and audit trails -- that a company of AI agents needs to function coherently.

**Key distinction from other frameworks:** Paperclip explicitly models itself as a **control plane, not an execution plane**. It does not run agents. It orchestrates them. Agents run wherever they run (local CLI, cloud, webhook) and "phone home" to Paperclip's REST API. This is fundamentally different from frameworks like CrewAI or LangGraph that own the agent execution loop.

**Problem it solves:** When you have 20 Claude Code terminals open, you lose track of context, spend, and coordination. Paperclip replaces that chaos with a ticketing system, org chart, budget enforcement, and governance layer -- making multi-agent work feel like running a company rather than babysitting scripts.

## Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6, React Router 7, Radix UI, Tailwind CSS 4, TanStack Query |
| Backend | Node.js 20+, Express.js 5, TypeScript |
| Database | PostgreSQL 17 (or embedded PGlite for zero-config local dev), Drizzle ORM |
| Auth | Better Auth (sessions + API keys + short-lived JWTs for agents) |
| Package manager | pnpm 9 with workspaces |

### Layered Architecture

```
┌─────────────────────────────────────┐
│  React UI (Vite)                    │  Dashboard, org management, tasks
├─────────────────────────────────────┤
│  Express.js REST API (Node.js)      │  Routes, services, auth, adapters
├─────────────────────────────────────┤
│  PostgreSQL (Drizzle ORM)           │  Schema, migrations, embedded mode
├─────────────────────────────────────┤
│  Adapters                           │  Claude Local, Codex Local, Process, HTTP
└─────────────────────────────────────┘
```

### Monorepo Structure

```
paperclip/
├── ui/                    # React frontend (pages, components, API client, contexts)
├── server/                # Express.js API (routes, ~60 services, adapters, middleware)
├── packages/
│   ├── db/                # Drizzle schema + migrations (~55 schema tables)
│   ├── shared/            # API types, constants, validators
│   ├── adapter-utils/     # Adapter interfaces and helpers
│   └── adapters/          # claude-local, codex-local, cursor-local, gemini-local, etc.
├── skills/                # Agent skills (core Paperclip heartbeat skill)
├── cli/                   # CLI client (setup, control-plane commands)
├── evals/                 # Agent evaluation framework (promptfoo)
└── doc/                   # Internal documentation, specs, plans
```

### Request Flow (Heartbeat)

1. **Trigger** -- scheduler, manual invoke, assignment event, or @-mention triggers a heartbeat
2. **Budget check** -- atomic budget enforcement before execution (auto-pause at 100%)
3. **Adapter invocation** -- server calls the configured adapter's `execute()` with env vars and prompt
4. **Agent process** -- adapter spawns the agent (e.g., Claude Code CLI) with Paperclip env vars
5. **Agent work** -- agent calls Paperclip's REST API to check assignments, checkout tasks, do work, update status
6. **Result capture** -- adapter captures stdout, parses usage/cost data, extracts session state
7. **Run record** -- server records run result, costs, session state for next heartbeat; publishes live events

## Key Patterns

### Company-as-First-Class-Entity [orchestration] [pattern]
Everything is scoped to a company. One Paperclip instance runs unlimited companies with complete data isolation. Companies have goals, org charts, budgets, and employees (agents). This is the organizing metaphor that makes multi-agent coordination legible.

### Heartbeat Protocol [agent] [pattern] [orchestration]
Agents do not run continuously. They execute in short bursts ("heartbeats") triggered by schedule, assignment, @-mention, approval resolution, or manual invoke. Each heartbeat follows a strict 9-step protocol: identity check, approval follow-up, get assignments, pick work, atomic checkout, understand context, do work, update status, delegate if needed. This prevents runaway execution and enables cost control.

### Atomic Task Checkout [pattern] [orchestration]
Only one agent can own a task at a time. Checkout is atomic -- if two agents race for the same task, one gets a 409 Conflict. The rule "never retry a 409" prevents double-work. Tasks carry a `X-Paperclip-Run-Id` header on all mutations for audit traceability.

### Adapter Model [agent] [pattern]
Adapters bridge Paperclip and agent runtimes. Each adapter has three modules: server (execute, parse, test), UI (transcript parser, config builder), CLI (terminal formatter). Built-in adapters: `claude_local`, `codex_local`, `cursor_local`, `gemini_local`, `opencode_local`, `process`, `http`, `openclaw`. Custom adapters can be created for any runtime that can call an HTTP API.

### Skill Injection [skill] [agent] [pattern]
Skills are markdown files (SKILL.md) with YAML frontmatter that teach agents specific procedures. The description field acts as routing logic -- agents read it to decide whether to load the full content. Skills are loaded on-demand to keep base prompts small. Adapters handle skill injection differently: Claude adapter uses tmpdir + symlinks + `--add-dir`; Codex uses global skills directory. Company-level skill management allows installing, scanning, and assigning skills to agents.

### Session Persistence [memory] [agent]
Agents maintain conversation context across heartbeats. Adapters serialize session state (e.g., Claude Code session ID) after each run and restore it on the next wake. This means agents remember their working context without re-reading everything. Session compaction policies prevent sessions from growing unbounded.

### Goal Ancestry / Context Chain [orchestration] [pattern]
Every task traces back to the company goal through a chain of parent tasks. Agents always see the "why," not just the title. The `GET /api/issues/{issueId}/heartbeat-context` endpoint provides compact ancestor summaries, goal/project info, and comment cursor metadata for efficient context hydration.

### Budget Enforcement [orchestration] [pattern]
Three tiers: visibility (dashboards), soft alerts (80% warning), hard ceiling (auto-pause at 100%). Budgets cascade: board sets company budgets, CEO sets budgets for reports, managers set budgets for their teams. Cost tracking is per-agent, per-task, per-project, per-company, denominated in tokens and dollars. Billing codes on cross-team tasks enable cost attribution.

### Board Governance [orchestration] [pattern]
The human is "the board" with unrestricted control: approve hires, override strategy, pause/terminate any agent, reassign tasks, modify budgets. Approval gates are enforced for high-impact decisions (hiring, CEO strategy). Every mutation is logged in an immutable activity audit trail. Config changes are revisioned with rollback capability.

### Company Portability / Templates [orchestration] [pattern]
Entire company configurations (agents, org charts, skills, adapter configs) can be exported/imported as portable artifacts. Two modes: template export (structure only, secret-scrubbed) and snapshot export (full state). Collision handling with rename/skip strategies. This enables sharing pre-built company templates ("here's a marketing agency org").

### Plugin System [hook] [pattern]
Post-V1 plugin architecture with: manifest-based capabilities, worker-based sandbox isolation, host RPC services, event bus, job scheduling, state store, stream bus, tool dispatch/registry, log retention, and secrets handling. Plugins extend Paperclip without modifying core. Currently early implementation with admin UI.

### Execution Workspaces [sandbox] [pattern]
Managed workspace system that handles git clones, worktrees, and per-run workspace isolation. Projects can have workspace configurations (local folder and/or GitHub repo). The system supports workspace-per-issue strategies with git worktrees for branch isolation.

### Cross-Team Delegation Protocol [orchestration] [agent] [pattern]
Agents can create tasks and assign them across team boundaries. Task acceptance rules: agree and complete, agree and mark blocked, or escalate to manager (never cancel cross-team tasks). Request depth tracking counts delegation hops. Billing codes attribute costs upstream to the requesting agent.

### Incremental Context Loading [memory] [pattern]
Agents use incremental comment fetching (`?after={last-seen-comment-id}&order=asc`) instead of replaying full threads. The `heartbeat-context` endpoint provides compact state. Wake-specific context (comment ID, approval ID) allows targeted context loading. This is a deliberate token optimization strategy.

### Memory Service (Planned) [memory] [pattern]
Company-scoped memory control plane with a normalized adapter contract. Memory providers (local markdown + vector index, mem0, supermemory, MemOS) are selected by key. Paperclip owns routing, provenance, and accounting. Automatic capture hooks: post-run capture, issue comment/document capture, pre-run recall for context hydration.

## Strengths

1. **Organizational metaphor is powerful.** Modeling agents as employees in a company with org charts, budgets, and governance makes multi-agent coordination intuitive and auditable. This is a novel framing that solves real coordination problems.

2. **Agent-agnostic by design.** The adapter model means Paperclip works with any agent runtime (Claude Code, Codex, Cursor, Gemini, custom scripts, HTTP webhooks). No vendor lock-in. "If it can receive a heartbeat, it's hired."

3. **Strong cost control primitives.** Per-agent monthly budgets with automatic pause at ceiling, cascading budget delegation, billing codes for cross-team attribution, and multi-dimensional cost views (agent/task/project/company). This is essential for production multi-agent systems.

4. **Atomic checkout prevents chaos.** Single-assignee tasks with atomic checkout and 409 Conflict semantics eliminate the double-work problem that plagues naive multi-agent setups.

5. **Session persistence across heartbeats.** Agents resume context instead of cold-starting, which is both token-efficient and behavior-consistent.

6. **Zero-config local development.** Embedded PGlite means `pnpm dev` just works without database setup. This dramatically lowers the barrier to trying it.

7. **Comprehensive audit trail.** Every mutation logged, every decision traced, every cost attributed. This is table-stakes for production autonomous systems but rarely implemented well.

8. **Portable company templates.** Export/import entire company configurations with secret scrubbing. This enables a marketplace of pre-built agent organizations (the "ClipMart" vision).

9. **Governance with human override.** The board model provides meaningful human control without being a bottleneck. Approval gates for high-impact decisions, but humans can intervene at any level at any time.

10. **Mature engineering.** ~55 database tables, ~60 server services, comprehensive TypeScript types shared across packages, proper auth (Better Auth + JWT), and a clean monorepo structure. This is production-grade software, not a demo.

## Weaknesses

1. **Complexity overhead for simple use cases.** If you have 2-3 agents doing straightforward coding, the full company/org-chart/budget model is heavy. Paperclip explicitly states "if you have one agent, you probably don't need Paperclip."

2. **No built-in agent capabilities.** Paperclip deliberately does not build agents. You must bring your own. This means the out-of-box experience requires already having working agents (Claude Code, Codex, etc.) configured and accessible.

3. **Heartbeat model limits real-time responsiveness.** Agents wake in discrete bursts, not continuously. For tasks requiring real-time collaboration between agents, the heartbeat model introduces latency. Event-based triggers (assignment, @-mention) help, but fundamental architecture is batch-oriented.

4. **Heavy reliance on REST API for agent coordination.** Every agent action (checkout, status update, comment, delegation) requires HTTP calls to Paperclip. In high-throughput scenarios with many agents, the API becomes a bottleneck. No message queue or event streaming for inter-agent communication.

5. **Skill system is prompt-based, not tool-based.** Skills are markdown documents injected into agent prompts, not executable code. This means skill behavior depends entirely on the LLM's interpretation. No programmatic guarantees that a skill will be followed correctly.

6. **Memory system is still planned, not implemented.** The memory service plan is thoughtful but not yet built. Current agents rely on session persistence and issue comments for context, which has limits for long-running projects.

7. **Plugin system is early.** The spec is comprehensive but the implementation is described as early. Plugin UI runs as trusted same-origin JavaScript (not sandboxed). Runtime installs require writable filesystem and npm availability.

8. **Local-first bias.** While production deployment is possible, the default experience is single-node with embedded Postgres and local file storage. Scaling to multiple nodes or cloud deployment requires significant configuration.

9. **Limited evaluation framework.** The `evals/` directory contains promptfoo configs for heartbeat behavior, but there is no systematic framework for evaluating end-to-end company performance or agent coordination quality.

10. **No built-in code review or CI/CD.** Paperclip explicitly states it is "not a code review tool." For software development companies, integrating with external code review and deployment systems adds friction.

## Unique Ideas Worth Extracting

### 1. Company-as-Orchestration-Primitive
The idea that multi-agent coordination should mirror corporate structure (org charts, reporting lines, delegation protocols, budgets) rather than DAGs or state machines. This is a genuinely novel framing that makes complex orchestration legible to humans.

### 2. Heartbeat-Driven Execution with Atomic Checkout
Combining periodic wake-ups with atomic task claiming creates a naturally rate-limited, conflict-free coordination system. The "never retry a 409" rule is elegant -- agents gracefully back off instead of contending.

### 3. Goal Ancestry on Every Task
Every task carrying its full goal ancestry chain means agents always have the "why." This is a simple data model decision with profound implications for agent alignment -- agents self-correct toward company goals because the context is always present.

### 4. Billing Code Attribution Across Teams
When Agent A asks Agent B to do work, B's costs are tracked against A's request via billing codes. This enables accurate cost attribution in hierarchical organizations and prevents budget gaming.

### 5. Adapter Three-Module Pattern (Server/UI/CLI)
Each adapter providing server execution, UI transcript parsing, and CLI formatting as separate modules is a clean separation that enables rich tooling without coupling concerns.

### 6. Incremental Heartbeat Context Endpoint
The `heartbeat-context` endpoint that provides compact state (ancestor summaries, goal info, comment cursor metadata) without full thread replay is a practical token optimization. Combined with `?after={commentId}` for incremental comment loading, this significantly reduces per-heartbeat token costs.

### 7. Skill-as-Routing-Logic
Writing skill descriptions as decision logic ("use when X, don't use when Y") rather than marketing copy, then loading full skill content only when the agent decides it is relevant. This is a lightweight retrieval mechanism that keeps base prompts small.

### 8. Portable Company Templates with Secret Scrubbing
The ability to export an entire organizational structure (agents, configs, org chart, skills, seed tasks) as a portable artifact with automatic secret scrubbing enables a marketplace model ("ClipMart") for pre-built agent organizations.

### 9. Board-as-Live-Control-Surface
The governance model where the human is not just an approval gate but a live control surface with full intervention capability at any level at any time. This is a practical middle ground between full autonomy and full oversight.

### 10. Request Depth Tracking
Tracking how many delegation hops a cross-team request accumulates provides visibility into organizational complexity and potential bottlenecks. Simple integer metadata with significant diagnostic value.

## Code Examples

### Heartbeat Protocol (Agent-Side)
The core contract between agents and Paperclip, implemented via the Paperclip skill:

```bash
# Step 1: Identity
GET /api/agents/me
# Returns: id, companyId, role, chainOfCommand, budget

# Step 3: Get assignments (compact inbox)
GET /api/agents/me/inbox-lite

# Step 5: Atomic checkout (MUST do before any work)
POST /api/issues/{issueId}/checkout
Headers: Authorization: Bearer $PAPERCLIP_API_KEY
         X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
Body: { "agentId": "{your-id}", "expectedStatuses": ["todo", "backlog", "blocked"] }
# Returns 409 Conflict if another agent owns it -- NEVER retry

# Step 6: Efficient context loading
GET /api/issues/{issueId}/heartbeat-context
# Returns compact ancestor summaries, goal/project info, comment cursor

# Step 8: Update status with audit trail
PATCH /api/issues/{issueId}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
Body: { "status": "done", "comment": "What was done and why." }
```

### Agent Environment Variables (Injected by Adapter)

```typescript
// Core identity (always present)
PAPERCLIP_AGENT_ID     // The agent's unique ID
PAPERCLIP_COMPANY_ID   // The company the agent belongs to
PAPERCLIP_API_URL      // Base URL for the Paperclip API
PAPERCLIP_API_KEY      // Short-lived JWT for API authentication
PAPERCLIP_RUN_ID       // Current heartbeat run ID

// Wake context (set when triggered by specific event)
PAPERCLIP_TASK_ID          // Issue that triggered this wake
PAPERCLIP_WAKE_REASON      // e.g., "issue_assigned", "issue_comment_mentioned"
PAPERCLIP_WAKE_COMMENT_ID  // Specific comment that triggered this wake
PAPERCLIP_APPROVAL_ID      // Approval that was resolved
PAPERCLIP_APPROVAL_STATUS  // "approved" or "rejected"
```

### Adapter Execute Pattern (Claude Local)

```typescript
// packages/adapters/claude-local/src/server/execute.ts
async function buildSkillsDir(config: Record<string, unknown>): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-skills-"));
  const target = path.join(tmp, ".claude", "skills");
  await fs.mkdir(target, { recursive: true });
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredNames = new Set(resolveClaudeDesiredSkillNames(config, availableEntries));
  for (const entry of availableEntries) {
    if (!desiredNames.has(entry.key)) continue;
    await fs.symlink(entry.source, path.join(target, entry.runtimeName));
  }
  return tmp;  // Passed to Claude Code via --add-dir flag
}
```

### Skill Definition Format

```markdown
---
name: paperclip
description: >
  Interact with the Paperclip control plane API to manage tasks, coordinate with
  other agents, and follow company governance. Use when you need to check
  assignments, update task status, delegate work, post comments, or call any
  Paperclip API endpoint. Do NOT use for the actual domain work itself (writing
  code, research, etc.) -- only for Paperclip coordination.
---

# Paperclip Skill

You run in **heartbeats** -- short execution windows triggered by Paperclip.
Each heartbeat, you wake up, check your work, do something useful, and exit.
...
```

### Adapter Interface (Minimum Contract)

```typescript
// Every adapter implements:
execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult>
// AdapterExecutionContext includes: agent identity, config, auth token, run ID,
//   workspace context, session params, skills list
// AdapterExecutionResult includes: exit code, stdout, stderr, usage summary,
//   session state for next heartbeat, cost events

// Optional diagnostics:
test(config: Record<string, unknown>): Promise<DiagnosticResult[]>
// Returns: error/warn/info entries about adapter readiness
```

### Budget Enforcement Flow

```typescript
// server/src/services/budgets.ts (conceptual)
// Before each heartbeat execution:
const budget = await budgetService.checkBudget(agent);
// budget.status: "ok" | "warning" | "exceeded"
// At 80%: agent receives soft alert to focus on critical tasks only
// At 100%: agent auto-paused, board notified, no more heartbeats until:
//   - budget increased by board
//   - new calendar month resets spend
```

### Company Export/Import

```typescript
// Two export modes:
// 1. Template: structure only (agents, org chart, configs, skills, seed tasks)
//    Secret-scrubbed, collision-safe, portable blueprint
POST /api/companies/{companyId}/exports
Body: { "mode": "template", "include": { "agents": true, "skills": true } }

// 2. Snapshot: full state (structure + tasks, progress, agent status)
POST /api/companies/{companyId}/exports
Body: { "mode": "snapshot", "include": { "agents": true, "issues": true } }

// Import with collision handling:
POST /api/companies/{companyId}/imports/preview   // Dry-run first
POST /api/companies/{companyId}/imports/apply      // Then apply
// Collisions resolve with "rename" or "skip" (never "replace" for safety)
```
