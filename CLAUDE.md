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
