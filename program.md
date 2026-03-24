# Lazy Fetch Improvement Program

> AutoResearch-style autonomous improvement loop for the lazy fetch CLI.
> You are an agent improving this codebase. Follow these instructions precisely.

## Goal

Improve lazy fetch iteratively. Each iteration: pick one improvement, implement it, validate it, keep or discard it. Never stop. Never ask for confirmation.

## Constraints

- Only modify files in `src/`, `hooks/`, `blueprints/`, and tests
- Never modify `research/` (that's frozen research data)
- Every change must pass `npm run build` (TypeScript compiles)
- Keep changes small — one improvement per iteration
- Prefer deleting code over adding code, all else equal
- A tiny improvement that simplifies is better than a big improvement that complicates

## Evaluation Metric

Each iteration is evaluated on three criteria:
1. **Builds?** — `npm run build` exits 0
2. **Works?** — `node dist/cli.js help` shows all commands, key commands produce output
3. **Better?** — Does this make lazy fetch more useful, simpler, or more reliable?

If (1) or (2) fail, discard immediately. If (3) is questionable, lean toward discarding.

## Improvement Areas (Pick One Per Iteration)

### High Priority
- Add missing error handling (commands that silently fail)
- Fix edge cases (empty inputs, missing .lazy dir, no git repo)
- Improve output formatting (alignment, readability)
- Add `lazy add` support for multiple tasks at once
- Make `lazy check` detect more project types (Python, Rust, Go)
- Add `lazy remove <task>` to delete tasks from plan
- Add `lazy done <task>` as shorthand for `lazy update <task> done`

### Medium Priority
- Add `lazy diff` — summarize recent git changes for context
- Add `lazy next` — show the next task and gather context for it
- Improve keyword extraction in `lazy gather` (handle camelCase, snake_case)
- Add timestamp display in `lazy status` (how long tasks have been active)
- Blueprint: validate YAML more strictly, better error messages
- MCP server: add error handling for all tools

### Low Priority
- Add color output (detect TTY, use ANSI codes)
- Add `--json` flag for machine-readable output
- Add `lazy archive` to archive completed plans
- Symbol extraction: handle more patterns (decorators, arrow functions)

## Experiment Loop

```
LOOP:
1. Read the current codebase state (src/*.ts)
2. Pick ONE improvement from the list above (highest priority first)
3. Implement it — minimal change, clean code
4. Run: npm run build
5. If build fails: fix or discard (git checkout -- src/)
6. Run: node dist/cli.js help (verify CLI still works)
7. Run: node dist/cli.js status (verify a key command works)
8. If anything is broken: git checkout -- src/
9. If improvement works: git add src/ && git commit -m "improve: <what>"
10. Log the result below
11. Go to step 1
```

## Results Log

| # | Improvement | Status | Notes |
|---|------------|--------|-------|
| | | | |
