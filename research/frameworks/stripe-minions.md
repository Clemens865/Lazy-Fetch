# Stripe Minions

## Overview & Philosophy

Stripe's Minions are fully unattended, one-shot coding agents that produce complete pull requests without any human-written code. Over 1,300 PRs merge per week that are entirely minion-produced (human-reviewed but zero human code). The system was born from a core insight: **developer attention is the most constrained resource**, so parallelizing tasks via unattended agents unlocks massive throughput.

**Core philosophy:**
- "What's good for humans is good for agents" -- Minions reuse the exact same developer tooling, environments, lint rules, and CI pipelines that human engineers use. Years of investment in human developer productivity paid direct dividends when agents arrived.
- One-shot is the North Star. A typical run starts from a Slack message and ends with a CI-passing PR ready for human review, with zero interaction in between.
- Even imperfect runs are valuable -- a minion that gets 80% of the way there is still an excellent starting point for focused human work.
- Building in-house was necessary because Stripe's codebase is hundreds of millions of lines, primarily Ruby with Sorbet typing (not Rails), using vast numbers of homegrown libraries unfamiliar to LLMs, processing $1T+ in annual payment volume.

**Key motivation:** Off-the-shelf agents are optimized for human-supervised pair-programming. Minions are optimized for the opposite: fully autonomous operation with no human in the loop during execution.

## Architecture

### Environment: Devboxes
- Each minion run gets its own isolated **devbox** (AWS EC2 instance) -- the same type of machine human engineers use.
- Devboxes are **pre-warmed** from a proactively provisioned pool, ready in ~10 seconds.
- Pre-warming includes: cloning large git repos, warming Bazel and type-checking caches, starting code generation services.
- Devboxes are "cattle, not pets" -- standardized, disposable, easy to replace.
- **Isolation**: No access to production resources, real user data, or the internet. This eliminates the need for human permission checks and constrains blast radius.
- Engineers routinely have half a dozen devboxes running simultaneously (some for minions, some for manual work).
- This approach avoids git worktrees, which wouldn't scale at Stripe's size.

### Agent Core: Forked Goose
- Built on a fork of **Block's goose** (one of the first widely-used coding agents), forked in late 2024.
- Heavily customized for unattended operation rather than human-supervised use.
- Key difference from off-the-shelf agents: no interruptibility, no human-triggered commands, no confirmation prompts (the isolated devbox makes this safe).

### Orchestration: Blueprints
- Minions use a custom orchestration primitive called **"blueprints"** -- a hybrid of workflows and agents.
- A blueprint is a **state machine** that intermixes two types of nodes:
  - **Deterministic nodes** (rectangles): Run code with no LLM invocation. Examples: "Run configured linters", "Push changes", git operations.
  - **Agentic nodes** (cloud shapes): Free-flowing agent loops with wide latitude. Examples: "Implement task", "Fix CI failures".
- This guarantees certain subtasks always complete deterministically while allowing creative freedom where needed.
- Blueprint machinery makes **context engineering of subagents** easy: constraining tools, modifying system prompts, or simplifying conversation context per subtask.
- Individual teams can create **custom blueprints** for specialized needs (e.g., LLM-assisted migrations that couldn't be done with a deterministic codemod).

### Feedback Loop: Shift Left
1. **Local lint** (< 5 seconds): Pre-push hooks with heuristic-selected lints. A background daemon precomputes applicable lint rules and caches results, achieving sub-second lint fixes on push.
2. **Deterministic lint node**: Runs within the blueprint loop locally before any push, so the branch has a fair shot at passing CI on the first try.
3. **CI run 1**: Selective tests from 3+ million test battery. Auto-applies autofixes for known failure patterns.
4. **Agent fix round**: If failures have no autofix, they're sent back to an agentic blueprint node for one more attempt.
5. **CI run 2** (final): After the second push, the branch goes to the human operator regardless.
- **At most 2 CI rounds** -- diminishing returns from more iterations, and CI runs cost tokens, compute, and time.

### Entry Points
- **Slack** (most common): Tag the Slack app in a thread; the minion reads the entire thread and any linked content as context.
- **CLI** and **web interfaces**.
- **Embedded in internal apps**: docs platform, feature flag platform, internal ticketing UI.
- **Automated triggers**: CI-detected flaky tests auto-create tickets with "Fix with a minion" buttons.

### Post-Run Flow
1. Minion creates a branch, pushes to CI, prepares a PR following Stripe's PR template.
2. Engineer reviews: if good, opens PR and requests human review; if not, provides further instructions for another iteration.
3. Engineers can also manually iterate on a completed minion branch.

## Key Patterns

### [sandbox] Isolated Devbox Per Run
Each minion gets a fresh, pre-warmed EC2 instance isolated from production, the internet, and other devboxes. This eliminates permission concerns and enables full agent autonomy. The "cattle not pets" model means environments are disposable and standardized.

### [orchestration] Blueprint State Machine
The hybrid workflow-agent orchestration pattern where deterministic nodes (linting, git ops, pushing) are interwoven with agentic nodes (implementation, fixing). This is the core architectural innovation -- "putting LLMs into contained boxes" compounds into system-wide reliability.

### [orchestration] Subagent Context Engineering
Blueprint machinery allows per-node configuration of: tool availability, system prompts, and conversation context simplification. Each agentic node operates in a tailored "smaller box."

### [pattern] One-Shot with Bounded Retry
Design for one-shot success, but allow at most 2 CI rounds. The philosophy is that diminishing returns make unbounded retry loops wasteful. Local feedback (linting) is maximized before any CI run.

### [hook] Shift-Left Feedback
A background daemon precomputes which lint rules apply to a change and caches results, enabling sub-second lint feedback on push. This is a deterministic blueprint node that runs before any CI submission.

### [mcp] Centralized MCP Server ("Toolshed")
A single internal MCP server hosting ~500 tools spanning internal systems and SaaS platforms. All agents at Stripe (not just minions) connect to Toolshed. Tools are curated per-agent: minions get a small default subset, with per-user customizability for additional tool groups.

### [mcp] Pre-Hydration of Context
Before the agent loop even starts, minions deterministically run relevant MCP tools over links found in the input (Slack threads, tickets, docs). This front-loads context gathering outside the agent loop.

### [agent] Conditional Rule Files
Agent rules (CLAUDE.md, AGENTS.md, Cursor rules) are almost exclusively **scoped to subdirectories or file patterns**, not global. This prevents context window pollution in a massive codebase. Rules are automatically attached as the agent traverses the filesystem.

### [agent] Cross-Agent Rule Sharing
Standardized on Cursor's rule format, then sync rules into formats readable by Claude Code and minions. Three agent systems (minions, Cursor, Claude Code) all read the same guidance, preventing duplication.

### [pattern] Autofix-First CI
Many of Stripe's 3+ million tests have associated autofixes for failures. These are automatically applied before sending failures back to the agent, saving tokens and agent reasoning cycles.

### [skill] Team-Specific Custom Blueprints
Teams can encode specialized workflows as custom blueprints -- e.g., LLM-assisted migrations that mix deterministic codemods with agentic decision-making for edge cases.

### [sandbox] Security Control Framework
Internal security controls ensure MCP tools can't perform destructive actions. Combined with QA-environment isolation (no prod data, no prod services, no arbitrary network egress), this creates defense in depth.

### [memory] Thread-as-Context
Slack thread context (including all linked resources) is automatically ingested as the minion's task specification. Links are pre-fetched via MCP tools before the run starts.

### [pattern] Same Tools for Humans and Agents
A deliberate design principle: invest in developer tooling that benefits both humans and agents. Pre-push hooks, devboxes, lint caches, CI autofixes -- all built originally for humans, all reused directly by minions.

## Strengths

1. **Massive scale and proven production use**: 1,300+ PRs merged per week with zero human-written code is extraordinary validation. This is not a prototype.

2. **Isolated execution environment**: The devbox model elegantly solves parallelization, safety, and reproducibility simultaneously. Pre-warming to 10-second readiness removes friction.

3. **Blueprint orchestration is elegant**: The hybrid deterministic/agentic state machine is a genuinely novel and practical pattern. It captures the insight that not every step needs LLM reasoning -- some things should just be code.

4. **Shift-left feedback saves enormous cost**: Sub-second cached lint results before CI means fewer wasted CI runs, fewer tokens spent on trivially fixable issues.

5. **MCP centralization (Toolshed)**: A single tool registry serving all agent types across the company is a powerful architectural decision. Adding one tool benefits hundreds of agents instantly.

6. **Ergonomic entry points**: Slack-native invocation from the thread where engineers are already discussing a change is brilliant UX. The context is naturally co-located with the request.

7. **Bounded retry is pragmatic**: The "at most 2 CI rounds" policy shows mature engineering judgment about cost/benefit tradeoffs, avoiding the trap of infinite retry loops.

8. **Reuse of human infrastructure**: Years of DevEx investment (devboxes, lint caching, CI autofixes) directly accelerated agent capabilities. This validates investing in developer productivity as a long-term strategy.

## Weaknesses

1. **Extremely Stripe-specific**: The system is deeply integrated with Stripe's infrastructure (devboxes, Bazel, internal MCP tools, custom CI). Replicating this requires comparable internal tooling investment.

2. **Cloud-only execution**: Requires EC2 instances per run. Not applicable to teams without cloud dev environments or budget for per-task VMs.

3. **Limited retry budget**: At most 2 CI rounds means complex tasks that need iterative debugging may fail where more rounds could succeed. The tradeoff is acknowledged but still a limitation.

4. **Forked agent core**: Building on a fork of goose means ongoing maintenance burden to keep up with upstream improvements or diverge entirely. They acknowledge focusing feature development away from human-supervised use.

5. **No multi-agent collaboration described**: Each minion is a single agent working alone. No mention of multiple agents collaborating on a single task, decomposing complex problems, or coordinating across PRs.

6. **Opaque task complexity ceiling**: The blog posts don't discuss what types of tasks minions struggle with, failure rates, or the complexity boundary where one-shot approaches break down.

7. **Rule file scaling challenge acknowledged but unsolved**: They note that global rules would fill the context window, and their solution (subdirectory scoping) requires ongoing curation effort as the codebase evolves.

8. **Closed-source and non-replicable**: No open-source release of the blueprint system, Toolshed, or the customized goose fork. The ideas are transferable but the implementation is not.

## Unique Ideas Worth Extracting

1. **Blueprints as hybrid orchestration**: The state machine mixing deterministic and agentic nodes is the standout idea. It's more structured than a pure agent loop but more flexible than a rigid workflow DAG. This pattern is broadly applicable: any agentic system benefits from guaranteeing certain steps happen deterministically (formatting, linting, git operations) while leaving creative work to the LLM.

2. **MCP Pre-Hydration**: Deterministically running MCP tools on detected links *before* the agent loop starts is clever. It front-loads context gathering, reducing the agent's need to discover and fetch context during its reasoning loop. This reduces token waste and speeds up the core task.

3. **Centralized MCP Tool Registry (Toolshed)**: Building one MCP server that all agents share, with per-agent tool subsetting, is an excellent architectural pattern. It separates tool authorship from agent configuration and ensures consistency across agent types.

4. **Background Lint Daemon with Caching**: A daemon that precomputes which lint rules apply to a change and caches results for sub-second feedback is a powerful infrastructure pattern. It makes "shift left" practical rather than aspirational.

5. **"Cattle not pets" for agent environments**: Treating execution environments as disposable, pre-warmed, standardized instances rather than persistent workspaces. This maps naturally to container-based or VM-based approaches.

6. **Autofix-first before agent retry**: Running deterministic autofixes on CI failures before involving the agent saves tokens and reduces the problem space the agent needs to reason about. The agent only sees failures that genuinely require creative problem-solving.

7. **Per-subdirectory conditional agent rules**: Instead of massive global rule files, rules activate based on which directories the agent is working in. This is essential for large codebases and prevents context window pollution.

8. **Cross-agent rule format synchronization**: Maintaining one set of rules that syncs across multiple agent formats (Cursor, Claude Code, minions) ensures consistency and reduces maintenance burden.

9. **Embedded agent triggers in existing tools**: Putting "Fix with a minion" buttons in ticketing UIs, docs platforms, and feature flag tools meets engineers where they already are, rather than requiring them to context-switch to an agent-specific interface.

10. **Bounded CI iteration policy**: The explicit "often one, at most two CI runs" policy is a transferable heuristic. It codifies the insight that LLM debugging has diminishing returns and prevents runaway cost.

## Code Examples

The blog posts are deliberately light on code, focusing on architecture and patterns rather than implementation details. However, the following structural patterns are described:

### Blueprint Structure (Conceptual)
```
Blueprint: Standard Minion Run
├── [deterministic] Provision devbox (10s pre-warmed)
├── [deterministic] Pre-hydrate context (run MCP tools on detected links)
├── [deterministic] Load conditional rule files (based on target directories)
├── [agentic]       Implement task (wide latitude, curated tool subset)
├── [deterministic] Run configured linters (cached, <5 seconds)
├── [deterministic] Push changes to branch
├── [deterministic] Run CI (selective test battery from 3M+ tests)
├── [deterministic] Apply autofixes for known failure patterns
├── [conditional]   If failures remain with no autofix:
│   ├── [agentic]       Fix CI failures (agent node with failure context)
│   ├── [deterministic] Run linters again
│   └── [deterministic] Push changes (2nd attempt)
├── [deterministic] Prepare PR following Stripe's PR template
└── [deterministic] Notify engineer via Slack
```

### MCP Tool Configuration (Conceptual)
```
Toolshed (centralized MCP server):
  Total tools: ~500

Minion default tool subset (curated, small):
  - Internal documentation search
  - Ticket/issue details
  - Build status queries
  - Sourcegraph code intelligence/search
  - [additional per-user configured tool groups]

Security controls:
  - No destructive actions permitted
  - QA environment only (no prod data/services)
  - No arbitrary network egress
```

### Conditional Rule File Pattern
```
# Rules are NOT global -- they activate based on directory context

# Example: rules scoped to specific subdirectories
payments/
  .cursorrules           # Activates when agent works in payments/

api/v1/
  .cursorrules           # Different rules for API code

internal-tools/
  .cursorrules           # Different rules for internal tooling

# Synced across formats:
# .cursorrules  -> Cursor reads natively
# CLAUDE.md     -> Claude Code reads natively
# .minion-rules -> Minions read natively
# All generated from single source of truth
```

### Devbox Lifecycle
```
Pool Management:
  - Pre-provisioned EC2 instances kept warm
  - Git repos pre-cloned to recent master
  - Bazel caches warmed
  - Type checking caches warmed
  - Code generation services running
  - Ready in ~10 seconds from request

Per-Minion Run:
  1. Claim devbox from warm pool
  2. Check out fresh branch
  3. Run blueprint
  4. On completion: devbox returned/destroyed

Isolation Properties:
  - No production access
  - No internet access
  - No real user data
  - QA environment only
  - No cross-devbox interference
```

---

*Sources: [Part 1](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents) (2026-02-09) and [Part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2) (2026-02-19) by Alistair Gray, Stripe Leverage team.*
