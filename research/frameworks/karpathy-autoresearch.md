# Karpathy AutoResearch

## Overview & Philosophy

AutoResearch is Karpathy's experiment in fully autonomous AI-driven ML research. The core thesis: give an AI agent a small but real LLM training setup (a single-GPU GPT implementation derived from [nanochat](https://github.com/karpathy/nanochat)), define a clear metric (val_bpb -- validation bits per byte), and let it experiment autonomously overnight. The agent modifies code, trains for 5 minutes, evaluates, keeps or discards the result, and repeats indefinitely.

The philosophical shift is radical: **you don't write Python anymore -- you write Markdown that programs AI agents**. The human's job is to author `program.md`, which is the "research org code" that instructs the agent. The Python files are the agent's domain. This inverts the traditional programming model where humans write code and AI assists.

Motivation: run ~100 experiments overnight (12/hour x 8 hours of sleep) and wake up to a log of results and (hopefully) a better model. The agent is explicitly told to **never stop** and **never ask for confirmation**.

Repository: https://github.com/karpathy/autoresearch (MIT License, March 2026)

## Architecture

The architecture is deliberately minimal -- three files that matter:

```
prepare.py      -- Fixed infrastructure: data download, BPE tokenizer training,
                   dataloader, evaluation metric (evaluate_bpb). READ-ONLY.
train.py        -- The single file the agent edits. Contains full GPT model,
                   MuonAdamW optimizer, training loop, all hyperparameters.
program.md      -- Agent instructions. The "skill" file. Human-authored.
```

### Execution Flow

1. **Setup phase**: Agent reads all files, creates a git branch (`autoresearch/<tag>`), establishes baseline by running `train.py` unmodified, initializes `results.tsv`.
2. **Experiment loop** (runs forever):
   - Agent proposes a modification to `train.py` (architecture, hyperparams, optimizer, etc.)
   - Git commit the change
   - Run: `uv run train.py > run.log 2>&1`
   - Extract metrics: `grep "^val_bpb:\|^peak_vram_mb:" run.log`
   - If improved: keep commit, advance branch
   - If worse or crashed: `git reset` to previous good state
   - Log result to `results.tsv` (untracked)
3. **Constraints**: Fixed 5-minute wall-clock training budget, single GPU, no new dependencies, cannot modify `prepare.py` or evaluation harness.

### The Training Setup

- Model: GPT with RoPE, Flash Attention 3, sliding window attention (SSSL pattern), value embeddings (ResFormer), RMS norm, ReluSquared MLP, logit soft-capping
- Optimizer: Custom MuonAdamW -- Muon (momentum + polar express orthogonalization + NorMuon variance reduction) for 2D matrix params, AdamW for embeddings/scalars
- Metric: val_bpb (bits per byte) -- vocab-size-independent so architecture changes are fairly compared
- Data: climbmix-400b-shuffle dataset from HuggingFace, BPE tokenizer trained with rustbpe

## Key Patterns

### [agent] Autonomous Never-Stop Agent
The agent is explicitly instructed to **never pause, never ask permission, never stop**. The human may be asleep. This is a core design constraint that shapes everything else -- the agent must be self-sufficient in decision-making, error recovery, and idea generation.

### [pattern] Markdown-as-Program
`program.md` is the central artifact. It replaces traditional configuration, scripts, and orchestration code with natural language instructions. The human iterates on `program.md` to find the "research org code" that achieves the fastest research progress. This is a form of **metaprogramming** where the program being written instructs an AI rather than a machine.

### [pattern] Single-File Mutation Surface
Only `train.py` is mutable. This is a deliberate constraint that keeps the search space manageable, diffs reviewable, and rollbacks clean. The immutable `prepare.py` provides a stable evaluation harness that the agent cannot corrupt.

### [pattern] Git-as-State-Machine
Git branches serve as the experiment state machine. Each experiment is a commit. Successful experiments advance the branch; failures trigger `git reset`. The branch history IS the research log. `results.tsv` is kept untracked as a human-readable summary.

### [pattern] Fixed-Budget Comparability
Every experiment runs for exactly 5 minutes wall-clock time. This makes all experiments directly comparable regardless of what the agent changes (model size, batch size, architecture). The agent optimizes for the best model achievable in a fixed compute budget on your specific hardware.

### [pattern] Simplicity Criterion
The instructions explicitly encode a simplicity preference: "A 0.001 val_bpb improvement that adds 20 lines of hacky code? Probably not worth it. A 0.001 val_bpb improvement from deleting code? Definitely keep." This prevents the agent from accumulating complexity debt.

### [skill] Lightweight Skill Definition
`program.md` is described as a "super lightweight skill." It has sections for Setup, Experimentation rules, Output format, Logging format, and the Experiment Loop. This is the entire agent programming interface -- no SDK, no API, no framework. Just structured Markdown.

### [orchestration] Human-in-the-Loop via Branch Review
The human's role is reduced to: (1) authoring `program.md`, (2) reviewing `results.tsv` and git log after the fact, (3) optionally iterating on `program.md` for the next run. The orchestration is entirely within the agent's context window.

### [sandbox] Constrained Execution Environment
The agent operates within strict constraints: single file to edit, fixed dependencies (`pyproject.toml`), fixed evaluation harness, fixed time budget, redirect all output to `run.log` (to avoid flooding agent context). This is a form of sandboxing without containers.

### [pattern] Output-Driven Evaluation
The training script outputs a structured summary block (val_bpb, training_seconds, peak_vram_mb, mfu_percent, etc.) that the agent parses with grep. The TSV logging format is also strictly defined. Machine-parseable output enables the agent to make data-driven decisions.

### [memory] Results TSV as External Memory
`results.tsv` serves as the agent's external memory -- a running log of all experiments tried, their outcomes, and descriptions. This prevents the agent from repeating failed experiments and provides context for strategy decisions. The analysis notebook (`analysis.ipynb`) provides post-hoc visualization.

### [pattern] Crash Recovery Protocol
The instructions include explicit crash handling: check if grep output is empty (indicates crash), read the stack trace with `tail -n 50 run.log`, attempt a fix if trivial, otherwise log as crash and move on. This makes the agent robust to its own mistakes.

### [hook] Fast-Fail Training Guard
`train.py` includes `if math.isnan(train_loss_f) or train_loss_f > 100: print("FAIL"); exit(1)` -- a fast-fail hook that aborts diverged runs early, saving the agent time within the 5-minute budget.

## Strengths

1. **Radical simplicity**: Three files, no framework, no SDK, no complex orchestration. The entire system fits in a single context window. This is arguably the most minimal viable autonomous research system possible.

2. **Real research, not toy problems**: The agent works on actual LLM pretraining with a state-of-the-art training recipe (Muon optimizer, Flash Attention 3, value embeddings, sliding window attention). Results are scientifically meaningful.

3. **Clean experiment isolation**: Git branching + fixed time budget + single metric creates a clean A/B testing framework. Every experiment is comparable, reversible, and logged.

4. **Scales with agent capability**: As AI agents get smarter, the same `program.md` produces better results. The human's `program.md` is the bottleneck, not the infrastructure.

5. **Zero infrastructure overhead**: No servers, no databases, no APIs, no cloud services. One GPU, one agent, one repo. Can run on a laptop (with forks for MPS/CPU).

6. **Composability vision**: Karpathy hints at adding more agents, iterating on `program.md` to find optimal "research org code," and scaling to multi-agent setups. The simplicity makes this extensible.

7. **Practical autonomy constraints**: The "never stop" instruction, crash recovery protocol, simplicity criterion, and context management (redirect to log file) show mature thinking about what makes agents actually work unattended.

## Weaknesses

1. **Single-agent bottleneck**: One agent, one GPU, sequential experiments. No parallel exploration, no ensemble strategies, no division of labor. The 5-minute budget means ~12 experiments/hour -- a human researcher might explore more efficiently by reasoning about multiple ideas simultaneously.

2. **No persistent learning across runs**: Each `program.md` invocation starts fresh (modulo the git branch state). The agent has no mechanism to learn from patterns across runs -- e.g., "increasing depth always helps on this hardware" or "Muon LR > 0.06 always diverges."

3. **Context window dependency**: The agent must hold the entire codebase + experiment history in context. As `results.tsv` grows and `train.py` accumulates changes, context pressure increases. No explicit context management strategy.

4. **No search strategy beyond agent intuition**: There is no explicit exploration strategy (e.g., Bayesian optimization, evolutionary search, bandit algorithms). The agent just "thinks of ideas." This is both a strength (flexibility) and weakness (no guarantees of efficient search).

5. **Hardware-specific results**: Fixed time budget means results are not comparable across different GPUs. An H100 run and an RTX 4090 run will find different optima. This limits reproducibility and community collaboration.

6. **No safety rails for destructive changes**: The agent could theoretically make `train.py` worse in ways that aren't caught by val_bpb (e.g., introducing subtle bugs that only manifest at scale, or optimizing for a metric that doesn't correlate with actual model quality at longer training times).

7. **No multi-objective optimization**: Only val_bpb matters. VRAM is a "soft constraint" with no formal treatment. In practice, researchers care about training efficiency, inference cost, model size, and other factors.

8. **Fragile to agent mistakes**: If the agent corrupts `train.py` in a way that still runs but produces meaningless metrics, there is no detection mechanism beyond the fast-fail NaN/loss check.

## Unique Ideas Worth Extracting

### 1. Markdown-as-Program for Agent Orchestration
The idea that `program.md` IS the program -- not configuration, not a prompt template, but the actual orchestration logic -- is powerful. This could be generalized: any complex agent workflow could be defined as structured Markdown with sections for setup, constraints, loop logic, output format, and error handling. The human "programs" the agent in natural language, and iterates on the Markdown to improve agent performance.

### 2. Git-as-Experiment-State-Machine
Using git branches as a formal state machine for autonomous experimentation is elegant. Commits are checkpoints, resets are rollbacks, the branch history is the experiment log. This pattern could be extracted into a general-purpose "git-backed autonomous experimentation" framework for any domain (not just ML training).

### 3. Fixed-Budget Comparability
The insight that fixing wall-clock time (rather than steps, tokens, or epochs) makes ALL experiments comparable regardless of what the agent changes is subtle and powerful. This eliminates the "but my experiment used more compute" confound. Applicable to any optimization domain: fix the budget, let the agent optimize within it.

### 4. Never-Stop Autonomy with Crash Recovery
The explicit "NEVER STOP" instruction combined with structured crash recovery (check for empty output, read stack trace, attempt fix, log and move on) is a practical pattern for long-running autonomous agents. Most agent frameworks assume human-in-the-loop; this assumes human-out-of-the-loop.

### 5. Simplicity as an Explicit Optimization Objective
Encoding "simpler is better, all else equal" directly into agent instructions is a novel approach to preventing complexity accumulation. The specific heuristic ("0.001 improvement + 20 lines of complexity = not worth it") gives the agent a concrete decision framework that mirrors good engineering judgment.

### 6. Immutable Evaluation Harness Pattern
Separating the mutable experiment code (`train.py`) from the immutable evaluation code (`prepare.py`) prevents the agent from gaming the metric. This "trusted evaluator" pattern is applicable to any autonomous optimization system.

### 7. Context Management via Output Redirection
The instruction to redirect all training output to a log file (`> run.log 2>&1`) and then selectively extract results with `grep` is a practical pattern for keeping agent context clean during long-running processes. Avoids flooding the context window with thousands of lines of training logs.

### 8. Human Metaprogramming Loop
The vision of humans iterating on `program.md` to find optimal "research org code" creates a new level of abstraction: **metaprogramming AI agents**. The human doesn't optimize the model -- they optimize the instructions that make the agent optimize the model. This recursive optimization is a novel framing.

## Code Examples

### The Experiment Loop (from program.md)
```
LOOP FOREVER:
1. Look at the git state: the current branch/commit we're on
2. Tune train.py with an experimental idea by directly hacking the code.
3. git commit
4. Run the experiment: uv run train.py > run.log 2>&1
5. Read out the results: grep "^val_bpb:\|^peak_vram_mb:" run.log
6. If the grep output is empty, the run crashed. Run tail -n 50 run.log
7. Record the results in the tsv
8. If val_bpb improved (lower), keep the git commit
9. If val_bpb is equal or worse, git reset back
```

### Structured Output Block (from train.py)
```python
print("---")
print(f"val_bpb:          {val_bpb:.6f}")
print(f"training_seconds: {total_training_time:.1f}")
print(f"total_seconds:    {t_end - t_start:.1f}")
print(f"peak_vram_mb:     {peak_vram_mb:.1f}")
print(f"mfu_percent:      {steady_state_mfu:.2f}")
print(f"total_tokens_M:   {total_tokens / 1e6:.1f}")
print(f"num_steps:        {step}")
print(f"num_params_M:     {num_params / 1e6:.1f}")
print(f"depth:            {DEPTH}")
```

### Fast-Fail Guard (from train.py)
```python
# Fast fail: abort if loss is exploding or NaN
if math.isnan(train_loss_f) or train_loss_f > 100:
    print("FAIL")
    exit(1)
```

### TSV Logging Format (from program.md)
```
commit	val_bpb	memory_gb	status	description
a1b2c3d	0.997900	44.0	keep	baseline
b2c3d4e	0.993200	44.2	keep	increase LR to 0.04
c3d4e5f	1.005000	44.0	discard	switch to GeLU activation
d4e5f6g	0.000000	0.0	crash	double model width (OOM)
```

### Hyperparameters as Editable Constants (from train.py)
```python
# Hyperparameters (edit these directly, no CLI flags needed)
ASPECT_RATIO = 64       # model_dim = depth * ASPECT_RATIO
HEAD_DIM = 128          # target head dimension for attention
WINDOW_PATTERN = "SSSL" # sliding window pattern: L=full, S=half context
TOTAL_BATCH_SIZE = 2**19 # ~524K tokens per optimizer step
EMBEDDING_LR = 0.6      # learning rate for token embeddings (Adam)
MATRIX_LR = 0.04        # learning rate for matrix parameters (Muon)
DEPTH = 8               # number of transformer layers
DEVICE_BATCH_SIZE = 128  # per-device batch size (reduce if OOM)
```

### Agent Invocation (the entire "framework")
```
Hi have a look at program.md and let's kick off a new experiment!
let's do the setup first.
```
