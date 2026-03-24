# Ralph Loop Pattern & Agentic Coding Critiques

## Overview & Philosophy

The **Ralph Wiggum technique** (often shortened to "Ralph" or "RALF") is an autonomous AI coding loop pattern created by Geoffrey Huntley. Named after the perpetually confused but persistent character from The Simpsons, the technique embodies a single philosophy: **iteration beats perfection**.

At its core, Ralph is deceptively simple -- it is a Bash loop:

```bash
while :; do cat PROMPT.md | claude-code ; done
```

The agent runs on the same prompt repeatedly until a stop condition is met. Each iteration, the agent sees its previous work (via git history and modified files), learns from it, and iteratively improves. This replaces the traditional "human-in-the-loop" bottleneck where a developer must review and approve every single AI action.

### The Core Insight

> "The technique is deterministically bad in an undeterministic world." -- Geoffrey Huntley

AI agents are probabilistic. They hallucinate, take wrong turns, and don't always make the same decision twice. But when placed in a loop, failures become **predictable**. You know the agent will fail sometimes -- the loop catches it and tries again. It is better to fail predictably and recover automatically than to succeed unpredictably and require manual intervention.

### The Problem It Solves

Traditional AI coding operates in **single-pass mode**: prompt -> generate -> stop -> wait for human review -> repeat. For complex work (migrations, refactors, multi-file changes), this creates exhaustion from constant babysitting. Ralph eliminates this bottleneck by letting the agent run autonomously in a continuous loop, defining success criteria upfront and letting the agent iterate toward completion.

### Key Critiques

Huntley himself is candid about the limitations:
- Ralph will break your codebase overnight -- you will wake up to code that doesn't compile
- It works best for **greenfield projects only** -- Huntley explicitly states: "There's no way in heck would I use Ralph in an existing code base"
- It displaces many SWEs for greenfield work, but **senior expertise is still essential** to guide Ralph
- Expect to get ~90% done with it; the last 10% requires human intervention
- Without skilled operators shaping prompts from real expertise, outcomes degrade significantly

## Architecture

### The Loop Mechanism

Ralph operates as a monolithic, single-process loop (deliberately NOT multi-agent):

```
┌─────────────────────────────────────────────┐
│                  RALPH LOOP                  │
│                                              │
│  1. Load PROMPT.md + specs/* + fix_plan.md   │
│  2. Agent reads git history / modified files │
│  3. Agent chooses most important next task   │
│  4. Agent implements (using subagents)       │
│  5. Agent runs tests (backpressure)          │
│  6. If tests pass: git commit + push + tag   │
│  7. If tests fail: iterate within loop       │
│  8. Update fix_plan.md + AGENT.md            │
│  9. Exit -> Stop Hook intercepts (code 2)    │
│ 10. Re-inject original prompt                │
│ 11. GOTO 1 (new context window)              │
└─────────────────────────────────────────────┘
```

### Stop Hook Mechanism

The Claude Code plugin uses a **Stop Hook** that intercepts the agent's exit:

1. You give Claude a task + completion promise
2. Claude executes tool calls
3. Claude tries to exit
4. Stop Hook intercepts with **exit code 2**
5. If completion promise not found, re-inject original prompt
6. Claude sees previous work and continues
7. Repeat until completion or max iterations

### Why Monolithic (Not Multi-Agent)

Huntley explicitly rejects multi-agent architectures at this stage:

> "Consider microservices and all the complexities that come with them. Now, consider what microservices would look like if the microservices (agents) themselves are non-deterministic -- a red hot mess."

Ralph is a single operating system process that scales vertically. One repository, one process, one task per loop. The primary context window operates as a **scheduler**, spawning subagents for expensive work (file search, summarization) while keeping the main context clean.

### Context Window Management

- Only ~170k of usable context window available
- Use as little as possible -- more context = worse outcomes
- Specs and plan are burned (re-loaded) every loop, not reused
- Expensive operations (test summarization, codebase search) delegated to subagents
- Git history serves as the agent's persistent memory across loops

## Key Patterns

### [agent][orchestration] One Item Per Loop
The most critical constraint: ask Ralph to do **one thing per loop**. This keeps context window usage minimal and outcomes focused. You may relax this as the project progresses, but narrow back down when things go off the rails.

### [pattern][memory] Git History as Memory
Each commit is a checkpoint. The git history becomes the AI's persistent memory across loop iterations. Each new context window starts fresh but can reconstruct state from git.

### [pattern][orchestration] Plan-Build-Plan Cycle
Two distinct modes of operation:
- **Planning mode**: Use subagents to study source code, compare against specs, generate/update `fix_plan.md`
- **Building mode**: Follow `fix_plan.md`, implement the most important items, commit results
- The TODO list (`fix_plan.md`) is frequently regenerated from scratch when it drifts

### [hook] Stop Hook / Exit Code 2
The mechanism that prevents premature termination. When the agent tries to exit without meeting completion criteria, exit code 2 forces re-entry into the loop.

### [sandbox][pattern] Backpressure Through Tests
The "engineering hat" part of Ralph: anything can be wired in as backpressure to reject invalid code generation:
- Type systems (compiler errors)
- Test suites (unit tests per change)
- Static analyzers (especially critical for dynamically typed languages)
- Security scanners
- Linters

> "It's the speed of the wheel turning that matters, balanced against the axis of correctness."

### [agent] Subagent Delegation
The primary context window should NOT do expensive work. Instead:
- Use up to N parallel subagents for file search and writing
- Use only 1 subagent for build/test (prevents backpressure issues)
- Fan-out for reading, funnel for validation

### [memory][pattern] Self-Improving Documentation
Ralph updates its own operational knowledge:
- `AGENT.md`: How to compile, run, test the project (updated when Ralph learns new commands)
- `fix_plan.md`: Prioritized TODO list (updated every loop)
- Test documentation: Capture WHY tests exist so future loops understand their importance

### [pattern] Specification-Driven Development
Before coding, have a long conversation with the LLM about requirements, then write specs (one per file) in a `/specs` folder. These specs are loaded every loop as the ground truth for what to build.

### [skill] Sign Posting (Tuning)
When Ralph exhibits bad behavior, you don't fix the code -- you add "signs" to the prompt:
> "Ralph is very good at making playgrounds, but he comes home bruised because he fell off the slide, so one then tunes Ralph by adding a sign next to the slide saying 'SLIDE DOWN, DON'T JUMP, LOOK AROUND,' and Ralph is more likely to look and see the sign."

This is iterative prompt tuning based on observed LLM behavior patterns.

### [pattern] Anti-Assumption Guard
A common failure: the LLM runs `ripgrep`, gets incomplete results, and concludes code hasn't been implemented -- then creates duplicates. Counter with:
```
Before making changes search codebase (don't assume not implemented) using parallel subagents. Think hard.
```

### [pattern] Anti-Placeholder Enforcement
LLMs are biased toward minimal/placeholder implementations (chasing the "compiling code" reward function). Counter aggressively:
```
DO NOT IMPLEMENT PLACEHOLDER OR SIMPLE IMPLEMENTATIONS. WE WANT FULL IMPLEMENTATIONS. DO IT OR I WILL YELL AT YOU
```

### [mcp] Loop-Back Evaluation
Always look for opportunities to loop Ralph's output back into the LLM for evaluation. Examples:
- Compile code and examine LLVM IR representation
- Add extra logging for debugging
- Run tests and feed results back

### [pattern] Priority Through Numbering
Huntley uses an escalating numbering scheme (1, 2, 999, 9999, 99999...) in prompts to signal priority levels to the LLM, with critical constraints getting astronomically large numbers.

## Strengths

1. **Radical simplicity**: A Bash while loop is the entire architecture. No complex orchestration framework needed.

2. **Fault tolerance through iteration**: Errors are data, not failures. The loop catches mistakes and the next iteration learns from them.

3. **Deterministic recovery from non-deterministic failures**: By accepting that the agent will fail, you design for recovery rather than prevention.

4. **Massive cost efficiency**: Huntley reports a $50k USD contract delivered as MVP, tested and reviewed, for $297 USD in compute costs.

5. **Greenfield bootstrapping**: Extremely effective for starting new projects from scratch, getting to 90% completion autonomously.

6. **Context window discipline**: The monolithic single-task approach avoids the context pollution that plagues multi-agent systems.

7. **Git as free persistence**: No need for external memory systems -- git history provides cross-iteration state.

8. **Self-improving system**: Ralph updates its own documentation (`AGENT.md`, `fix_plan.md`), making each subsequent loop more informed.

9. **Scales with operator skill**: "LLMs are mirrors of operator skill" -- experienced engineers get dramatically better results because their prompts encode real expertise.

10. **Language/framework agnostic**: Works with any tool that doesn't cap tool calls. The pattern is tool-independent.

## Weaknesses

### From Huntley's Own Observations

1. **Broken codebases overnight**: "You will wake up to a broken codebase that doesn't compile from time to time." Requires judgment calls on whether to `git reset --hard` or craft rescue prompts.

2. **Greenfield only**: Huntley explicitly warns against using Ralph on existing codebases. The technique works for bootstrapping, not maintenance.

3. **Duplicate implementation problem**: Non-deterministic `ripgrep` results cause the LLM to incorrectly conclude code doesn't exist and re-implement it. This is "the Achilles' heel of Ralph."

4. **Specification errors compound**: A keyword defined twice for opposing scenarios in the lexer spec caused a month of wasted loops. Garbage specs in, garbage code out.

5. **Placeholder/minimal implementation bias**: LLMs chase the reward function of "code that compiles" rather than "complete implementation." Requires aggressive prompt countermeasures.

6. **Slow language penalty**: Languages with slow compilation (Rust) reduce the speed of the iteration wheel, creating a tradeoff between correctness and velocity.

7. **Requires senior expertise**: "Anyone claiming that engineers are no longer required and a tool can do 100% of the work without an engineer is peddling horseshit."

8. **The 90% problem**: Gets you 90% of the way; the remaining 10% requires human intervention and judgment.

### From the Broader Agentic Coding Critique

9. **Autoregressive failure cascading**: LLMs predict the next token based on what came before. When errors enter the context window, they compound -- each subsequent generation builds on flawed context (Huntley's "autoregressive queens of failure").

10. **Context window clipping**: Quality degrades as context fills. Claude 3.7's advertised 200k window clips quality around 147-152k. When clipping occurs, tool calls start failing.

11. **Skill atrophy misconception**: People use AI only to "do" rather than "learn," missing the educational potential. The tool amplifies existing skills but doesn't replace the need to understand fundamentals.

12. **Multi-agent complexity explosion**: Agents coordinating with other non-deterministic agents creates compounding unpredictability -- the distributed systems problem squared.

### From "Cars" Post (LLM Selection Critique)

13. **Wrong selection criteria**: People choose LLMs based on context window size and cost-per-token (like buying a car based on seat count and price), rather than evaluating the model's latent behavioral patterns and fitness for specific tasks.

14. **Model behavioral differences matter**: Different LLMs have fundamentally different behavioral patterns -- "galaxy-brained precision sloths (oracles)" vs. "small-brained hyperactive incremental squirrels (agents)." Using the wrong model for a task produces poor results regardless of prompt quality.

15. **Four-quadrant model**: LLM behavior maps to at least four quadrants of capability. Treating all models as interchangeable (like treating all cars as the same) leads to systematic misuse.

## Unique Ideas Worth Extracting

### Lessons Learned

1. **[pattern] Eventual consistency mindset**: Building software with Ralph requires faith in eventual consistency. Most issues can be resolved through more loops with different prompts. Any problem created by AI can be resolved through a different series of prompts.

2. **[orchestration] Scheduler pattern for primary context**: The main loop should act as a lightweight scheduler, delegating heavy work to subagents. Keep the primary context window as clean as possible.

3. **[memory] Throwaway TODO lists**: Don't treat the plan as sacred. Regenerate `fix_plan.md` from scratch frequently by running a planning-mode loop. The plan is a snapshot, not a contract.

4. **[pattern] Test documentation as LLM memory**: When writing tests in a loop, capture WHY the test exists in docstrings/comments. Future loops won't have the original reasoning in context -- these notes serve as inter-iteration memory.

5. **[skill] Tuning as the primary skill**: The shift from "writing code" to "designing convergence" -- the developer's job becomes observing LLM behavior patterns and adding corrective "signs" to prompts.

6. **[pattern] Backpressure is the engineering**: Code generation is now cheap. The hard part is validation. Wire in type checkers, test suites, static analyzers, and security scanners as rejection gates.

7. **[agent] Parallelism control**: Fan out subagents for read operations (searching, studying code) but funnel to a single agent for write/validate operations (build, test). This prevents resource contention.

8. **[pattern] Speed of the wheel**: The iteration cycle speed matters more than individual iteration quality. Choose languages and tools that enable fast feedback loops over those with maximum correctness guarantees.

### Anti-Patterns to Avoid

1. **[anti-pattern] Multi-agent coordination at this stage**: Don't build complex agent-to-agent communication. A single monolithic loop outperforms distributed agent architectures when agents themselves are non-deterministic.

2. **[anti-pattern] Trusting ripgrep results**: Code search is non-deterministic. Never let the agent assume something doesn't exist based on a single search. Always instruct: "don't assume not implemented."

3. **[anti-pattern] Large context windows as a solution**: More context = worse outcomes. The discipline is to use LESS context, not more. Delegate expensive allocations to subagents.

4. **[anti-pattern] Blaming the tool**: "Each time Ralph does something bad, Ralph gets tuned -- like a guitar." When the agent produces bad output, look at the prompt and specs, not the model.

5. **[anti-pattern] One-shot perfection**: Expecting the AI to get it right on the first try is the fundamental mistake. Design for iteration, not perfection.

6. **[anti-pattern] Unattended operation without expertise**: Running Ralph loops without domain expertise produces garbage. The technique amplifies skill -- an unskilled operator gets amplified unskill.

7. **[anti-pattern] Treating maintainability through human lens only**: Huntley provocatively challenges: "By whom? By humans? Why are humans the frame for maintainability? Aren't we in the post-AI phase where you can just run loops to resolve/adapt when needed?"

### Best Practices

1. **[pattern] Spec-first development**: Write detailed specifications before any code generation. Have a long conversation with the LLM about requirements, then output specs one-per-file.

2. **[pattern] Commit-per-loop**: Each successful loop iteration should produce a git commit. This creates rollback points and serves as cross-iteration memory.

3. **[pattern] Escalating prompt priority**: Use escalating numbering (1, 999, 9999999...) to signal constraint importance to the LLM.

4. **[pattern] Dynamic language + static analysis**: If using dynamically typed languages, always wire in static analyzers (Dialyzer for Erlang, Pyrefly for Python) as backpressure gates. Without this, outcomes are "a bonfire."

5. **[memory] AGENT.md as operational knowledge**: Let the agent update its own operational documentation. When it discovers the right build command after multiple attempts, it records this for future loops.

6. **[orchestration] Planning loops vs. building loops**: Separate concerns: run dedicated loops just for generating/updating the plan, then switch to building loops that execute the plan.

## Code Examples

### Minimal Ralph Loop (Bash)

```bash
while :; do cat PROMPT.md | claude-code ; done
```

### Ralph with Stop Hook (Claude Code Plugin)

```bash
/ralph-loop "Migrate all tests from Jest to Vitest" \
  --max-iterations 50 \
  --completion-promise "All tests migrated"
```

### Prompt Structure for Building (from CURSED compiler)

```markdown
0a. study specs/* to learn about the compiler specifications
0b. The source code of the compiler is in src/
0c. study fix_plan.md.

1. Your task is to implement missing stdlib (see @specs/stdlib/*) and compiler
   functionality. Follow the fix_plan.md and choose the most important 10 things.
   Before making changes search codebase (don't assume not implemented) using
   subagents. You may use up to 500 parallel subagents for all operations but
   only 1 subagent for build/tests.

2. After implementing functionality or resolving problems, run the tests for
   that unit of code that was improved. If functionality is missing then it's
   your job to add it as per the application specifications. Think hard.

3. When the tests pass update fix_plan.md, then add changed code with
   "git add -A" then do a "git commit" with a descriptive message.
   After the commit do a "git push".

999. Capture the WHY in documentation for tests and implementations.
9999. No migrations/adapters. Single sources of truth.
99999. Create git tags when build passes (semver increment).
999999. Keep fix_plan.md and AGENT.md up to date using subagents.
9999999. DO NOT IMPLEMENT PLACEHOLDER OR SIMPLE IMPLEMENTATIONS.
```

### Prompt Structure for Planning

```markdown
study specs/* and fix_plan.md to understand the plan so far.

First task: use up to 500 subagents to study existing source code in src/
and compare against compiler specifications. Create/update fix_plan.md as
a bullet point list sorted by priority. Consider searching for TODO,
minimal implementations, and placeholders.

Second task: study examples/* and compare against specifications.
Update fix_plan.md with findings.

ULTIMATE GOAL: self-hosting compiler with full standard library.
```

### Self-Improving Agent Configuration

```markdown
# AGENT.md (updated by Ralph during loops)

## Build Commands
- `cargo build --release` for compiler
- `./target/release/cursed compile examples/hello.cursed` for testing

## Learned Patterns
- Always run `cargo test -- --nocapture` to see output
- LLVM IR can be inspected with `--emit-llvm` flag
- stdlib tests are in src/stdlib/*/tests/
```

### Backpressure Configuration Pattern

```markdown
After implementing, run tests for that unit of code.
If using dynamic language, also run:
- Static analysis (pyrefly/dialyzer/mypy)
- Security scanner
- Linter

Only commit if ALL backpressure gates pass.
```

---

## Sources

- [The Ralph Wiggum Technique Breakdown](https://dev.to/ibrahimpima/the-ralf-wiggum-breakdown-3mko) by Ibrahim Pima
- [Ralph Wiggum as a "software engineer"](https://ghuntley.com/ralph/) by Geoffrey Huntley (Jul 2025)
- [Claude in a loop for three months: Cursed programming language](https://ghuntley.com/cursed/) by Geoffrey Huntley (Sep 2025)
- [Claude Sonnet is a small-brained mechanical squirrel](https://ghuntley.com/cars/) by Geoffrey Huntley (Jul 2025, partially paywalled)
- Related: [Autoregressive queens of failure](https://ghuntley.com/autoregressive/) by Geoffrey Huntley
- Related: [LLMs are mirrors of operator skill](https://ghuntley.com/mirrors/) by Geoffrey Huntley
- Related: [Deliberate intentional practice](https://ghuntley.com/practice/) by Geoffrey Huntley
