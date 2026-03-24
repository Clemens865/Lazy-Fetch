# SWE-Agent

## Overview & Philosophy

SWE-agent is an academic research project from Princeton University and Stanford University that enables LLMs (GPT-4o, Claude Sonnet, etc.) to autonomously fix issues in real GitHub repositories, find cybersecurity vulnerabilities, and perform custom coding tasks. It was published at NeurIPS 2024 (arxiv: 2405.15793) and has ~18.8k GitHub stars.

**Core thesis**: The interface between an AI agent and the computer matters as much as the model itself. SWE-agent introduces the concept of the **Agent-Computer Interface (ACI)** -- analogous to how UI/UX design matters for human-computer interaction, ACI design matters for agent-computer interaction. A well-designed ACI dramatically improves agent performance vs. giving the agent raw shell access.

**Key insight**: Rather than letting an LLM use arbitrary bash commands to interact with code, SWE-agent constrains the action space through purpose-built tools (file viewer, editor, search) that are designed to produce output the LLM can reliably interpret. A baseline agent without a tuned ACI performs far worse.

**Current status**: The team has shifted primary development to [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent/), a radically simpler ~100-line agent that matches SWE-agent's performance. This reflects the broader trend: as LLMs improve, heavy scaffolding becomes less necessary. Mini-swe-agent uses only bash (no custom tools), stateless `subprocess.run` instead of persistent shell sessions, and a completely linear message history. It scores >74% on SWE-bench verified.

**State of the art**: SWE-agent 1.0 + Claude 3.7 achieved SoTA on SWE-bench full and SWE-bench verified. Mini-swe-agent + Gemini 3 Pro reaches 74% on SWE-bench verified.

## Architecture

### High-Level Flow

```
CLI (sweagent run)
  -> SWEEnv (environment wrapper around SWE-ReX)
    -> Deployment (Docker container, local, or remote via Modal/AWS)
      -> Shell session (executes commands)
      -> ACI tools installed as custom executables in container
  -> Agent (configured via YAML)
    -> forward() loop: prompt model -> parse action -> execute -> observe
    -> HistoryProcessor (compresses context window)
    -> Model (via litellm - supports any LLM)
```

### Core Components

1. **SWEEnv** (`sweagent/environment/swe_env.py`): Thin wrapper around [SWE-ReX](https://github.com/SWE-agent/SWE-ReX), which manages Docker container deployments. Handles repo cloning, environment reset, command execution. Communicates with a server running inside the Docker container.

2. **Agent** (`sweagent/agent/agents.py`): The main agent loop. `forward()` method prompts the model and executes actions. Configurable via Pydantic models (`DefaultAgentConfig`, `RetryAgentConfig`, `ShellAgentConfig`). Supports max re-queries on format errors (default: 3).

3. **Tool Bundles** (`tools/`): Each tool is a directory with `bin/` executables, `config.yaml` (signatures, docstrings, arguments), optional `install.sh`, and optional `lib/`. Tools are installed into the container's PATH. A `state_command` runs after every action to extract environment state (open file, working dir).

4. **HistoryProcessors** (`sweagent/agent/history_processors.py`): Compress message history to fit context windows. Key processors:
   - `DefaultHistoryProcessor`: passes through unchanged
   - `LastNObservations`: elides all but last N observations (classic approach from paper)
   - `CacheControl`: marks last N messages for prompt caching (Anthropic-style)

5. **Reviewer / Retry Loop** (`sweagent/agent/reviewer.py`): Enables multi-attempt solving. After the agent submits, a reviewer (potentially a separate LLM call) evaluates the solution. `ScoreRetryLoop` and `ChooserRetryLoop` let the agent retry and pick the best solution.

6. **Hooks System**: Both agent and environment support hooks for extensibility:
   - `AbstractAgentHook`: `on_run_start`, `on_step_start`, `on_actions_generated`, `on_action_executed`, `on_step_done`, `on_run_done`, `on_model_query`, etc.
   - `EnvHook`: environment lifecycle hooks
   - `RunHook`: `on_init`, `on_instance_start`, `on_instance_completed` -- used for `SaveApplyPatchHook`, `OpenPRHook`, `SWEBenchEvaluateHook`

7. **Trajectories**: JSON files recording every (thought, action, observation, state) tuple. Used for debugging, demonstrations, and fine-tuning.

### The ACI (Agent-Computer Interface) in Detail

The ACI is the central innovation. Rather than raw bash, the agent gets purpose-built commands:

**File Viewing (windowed)**:
- `open <path> [line_number]` -- opens file in a windowed viewer (default 100 lines)
- `goto <line_number>` -- jump to line
- `scroll_up` / `scroll_down` -- navigate by window size
- `create <filename>` -- create new file
- Internal `WindowedFile` class manages cursor position, window size, overlap

**File Editing (multiple variants)**:
- `edit_anthropic` / `str_replace_editor`: Anthropic-style str_replace with `view`, `create`, `str_replace`, `insert`, `undo_edit` commands
- `windowed_edit_linting`: line-range based editing with syntax linting gate
- `windowed_edit_replace`: search-and-replace based editing
- `windowed_edit_rewrite`: full rewrite of line ranges

**Search**:
- `find_file <name> [dir]` -- find files by name/glob pattern
- `search_dir <term> [dir]` -- grep across directory (returns only file names with matches, not full context -- deliberately concise)
- `search_file <term> [file]` -- search within current open file

**Other Tools**:
- `filemap <path>` -- prints Python file contents with long functions/methods collapsed (structural overview)
- `submit` -- submits the solution (with optional review gate)
- `diff_state` -- shows current diff state
- `view_image` -- multimodal image viewing
- Web browser tools (for CTF/cyber challenges): `open_site`, `click_mouse`, `screenshot_site`, etc.

**Registry System** (`tools/registry/`): A key-value store persisted across tool invocations within a session. Tools use it to share state (e.g., `CURRENT_FILE`, `FIRST_LINE`, `WINDOW` size). This is how the windowed file viewer maintains its position.

### Configuration System

Everything is governed by a single YAML file. The default config (`config/default.yaml`) specifies:
- `agent.templates`: system prompt, instance template, next_step templates, observation truncation
- `agent.tools`: env variables (PAGER=cat, etc.), tool bundles to load, registry variables, parse function type
- `agent.history_processors`: how to compress history
- Environment variables set to disable interactive pagers (`PAGER=cat`, `GIT_PAGER=cat`, `LESS=-R`)

### Execution Model

The agent runs in a loop:
1. Format the prompt using Jinja2 templates with current state variables
2. Send full history (after HistoryProcessor compression) to LLM
3. Parse response into thought + action (via `ThoughtActionParser` or `ActionOnlyParser` or function calling)
4. Execute action in the container shell via SWE-ReX
5. Capture output, run state command, format observation
6. If output is empty: "Your command ran successfully and did not produce any output."
7. If output exceeds `max_observation_length` (100k chars): truncate with explanation
8. If bash syntax error: reject command and show error, do not execute
9. Append to trajectory, repeat

## Key Patterns

### [agent][pattern] Constrained Action Space via ACI
Instead of giving the LLM unrestricted shell access, SWE-agent designs custom commands that produce LLM-friendly output. The `search_dir` command deliberately shows only file names (not full grep context) because more context confused the model. The file viewer shows only 100 lines at a time. This is the core pattern: **design the tool output format for the consumer (the LLM), not the human**.

### [agent][pattern] Windowed File Viewer with State
The agent cannot `cat` entire files. It must navigate files through a 100-line window with `open`, `scroll_up`, `scroll_down`, `goto`. This forces incremental exploration and prevents context window flooding. State (current file, line position) persists via a registry between tool calls.

### [agent][pattern] Linting Gate on Edits
Edit commands run a linter (flake8 for Python) before accepting changes. If the edited code has syntax errors, the edit is rejected and the agent gets feedback. This prevents the agent from introducing broken code and creates a tight feedback loop.

### [pattern][sandbox] Docker-Based Isolation
Every task runs in a fresh Docker container via SWE-ReX. The agent's actions are fully sandboxed. The container includes the cloned repo, installed dependencies, and the ACI tools. This enables safe execution of arbitrary code.

### [pattern][memory] History Compression
`LastNObservations` keeps only the last N observation outputs in the message history, replacing older ones with "Old environment output: (n lines omitted)". This manages context window limits while preserving recent state. A `polling` parameter controls how frequently the window slides (for prompt caching optimization).

### [hook] Extensible Hook System
Both agent and environment expose hook interfaces at every lifecycle point. Hooks are the primary extension mechanism -- used for: saving patches (`SaveApplyPatchHook`), opening PRs (`OpenPRHook`), running SWE-bench evaluation (`SWEBenchEvaluateHook`), status reporting. The `CombinedHook` pattern aggregates multiple hooks.

### [pattern][agent] Retry Loop with Review
The `RetryAgent` wraps a `DefaultAgent` with a retry loop. After each attempt, a reviewer (which can be a separate LLM call) scores or accepts/rejects the submission. Multiple attempts are collected, and the best is chosen. `ChooserRetryLoop` uses an LLM to compare solutions; `ScoreRetryLoop` uses numerical scoring.

### [pattern] State Command After Every Action
A special `_state` executable runs after every tool invocation, returning JSON with current environment state (open file, working directory). This state is injected into prompt templates, giving the LLM persistent context about where it is in the codebase.

### [pattern] Registry for Cross-Tool State
The `tools/registry/` bundle provides a persistent key-value store within the container session. Tools read/write to it (e.g., `CURRENT_FILE`, `WINDOW`, `FIRST_LINE`). This allows stateless tool executables to share state without environment variables or temp files.

### [pattern][agent] Demonstration Trajectories
Pre-recorded trajectories (thought, action, observation sequences) can be included in the prompt as few-shot demonstrations. These show the agent how to use the ACI tools effectively. Demonstrations can be placed in history or shown as a single message.

### [pattern] Empty Output Handling
When a command produces no output, instead of showing nothing (which confuses LLMs), SWE-agent returns: "Your command ran successfully and did not produce any output." This small detail significantly improves agent behavior.

### [pattern] Observation Truncation with Guidance
When output exceeds 100k characters, it is truncated with a helpful message: "Observations should not exceed N characters. M characters were elided. Please try a different command that produces less output or use head/tail/grep/redirect the output to a file."

### [mcp][pattern] Tool Bundle Architecture
Tools are packaged as self-contained bundles with `config.yaml` (interface definition), `bin/` (executables), `install.sh` (setup), and `lib/` (shared code). This is conceptually similar to MCP tools but uses filesystem-based conventions rather than a protocol. Each tool has typed arguments, docstrings, and signatures -- all surfaced to the LLM.

### [orchestration] Batch Mode
`sweagent run-batch` processes multiple instances in parallel with thread-local storage for concurrent workers. Results are aggregated into `preds.json` for SWE-bench evaluation.

### [skill] Function Calling Support
The parse function can be `function_calling` (native LLM tool use), `ThoughtActionParser` (text-based thought/action parsing), or `ActionOnlyParser`. Function calling maps each ACI tool to an LLM function definition with typed parameters.

## Strengths

1. **Empirically validated ACI design**: Not just theory -- every design decision (100-line windows, concise search output, linting gates) was validated through ablation studies on SWE-bench. The paper shows each feature contributes measurably.

2. **Clean separation of concerns**: Environment (SWEEnv/SWE-ReX), Agent logic, Tools, and Configuration are cleanly separated. The YAML-driven configuration makes it easy to experiment with different tool combinations.

3. **Tool bundle architecture**: Adding new tools is straightforward -- create a directory with a config and executables. No need to modify core agent code. Tools are language-agnostic (any executable works).

4. **Research-oriented design**: Trajectories capture everything needed for analysis, debugging, and fine-tuning. The inspector UI lets you replay agent sessions step by step.

5. **Robust error handling**: Bash syntax checking before execution, linting gates on edits, observation truncation, format error re-querying -- the system handles many failure modes gracefully.

6. **Self-aware evolution**: The team recognized that as models improve, heavy scaffolding becomes less necessary, and built mini-swe-agent as a minimal alternative. This intellectual honesty is rare.

7. **Prompt caching awareness**: The `CacheControl` history processor and `polling` parameter in `LastNObservations` show awareness of API cost optimization through prompt caching.

## Weaknesses

1. **Complexity vs. mini-swe-agent**: The full SWE-agent is significantly more complex than necessary. Mini-swe-agent matches its performance with ~100 lines of Python and only bash. This suggests the ACI design, while important in 2024, may be increasingly obsolete as models improve.

2. **Single-agent architecture**: No native multi-agent coordination. One agent works on one issue at a time. The retry loop is the only form of "multi-attempt" reasoning.

3. **Docker dependency**: Requires Docker for sandboxing. No lightweight sandboxing alternatives (though SWE-ReX adds some flexibility with remote deployments).

4. **Python/SWE-bench-centric**: While technically language-agnostic, the tools (flake8 linting, Python-oriented filemap) and benchmarks are heavily Python-focused. The `filemap` tool specifically parses Python ASTs.

5. **No persistent memory across tasks**: Each task instance starts fresh. No cross-instance learning or memory. The registry is session-scoped only.

6. **Limited web/UI interaction**: The web browser tools exist for CTF challenges but are not deeply integrated into the main software engineering workflow.

7. **History processor limitations**: The `LastNObservations` approach is crude -- it discards observations without semantic awareness. No summarization, no relevance-based retention.

8. **No planning/decomposition**: The agent operates in a flat loop. There is no explicit planning step, task decomposition, or hierarchical goal structure. It relies entirely on the LLM's in-context reasoning.

## Unique Ideas Worth Extracting

### 1. ACI Design as First-Class Concern
The insight that **tool output format should be designed for the LLM consumer** is profound and underappreciated. Most frameworks give agents raw command output. SWE-agent shows that curating what the agent sees (concise search results, windowed file views, explicit empty-output messages) dramatically improves performance. This principle should be applied to any agent framework.

### 2. Linting Gate Pattern
Rejecting edits that introduce syntax errors before they are applied is a simple but powerful idea. It prevents cascading failures where the agent's subsequent actions are confused by broken code it introduced. Generalizable to any structured output: validate before committing.

### 3. State Command Pattern
Running a state extraction command after every action and injecting results into prompt templates is elegant. It gives the LLM a consistent "status bar" without requiring it to explicitly check state. This could be generalized: any agent could have post-action state extractors that enrich the next prompt.

### 4. Registry for Cross-Tool State
The filesystem-based key-value registry that tools read/write is a clean way to share state between stateless tool invocations. Better than environment variables (persists across subprocesses) and simpler than a database.

### 5. Observation Truncation with Actionable Guidance
Instead of just truncating long output, telling the agent why and suggesting alternatives (use head/tail/grep) is a form of embedded coaching. The agent learns to produce better commands.

### 6. Deliberate Output Conciseness
The `search_dir` tool intentionally shows only file names, not full grep output with line context. This was an empirical finding: more context confused the model. This counter-intuitive insight (less information can be better for LLM agents) is worth internalizing.

### 7. Mini-SWE-Agent's Lessons
The evolution to mini-swe-agent teaches a meta-lesson: **stateless subprocess.run > persistent shell sessions** for stability and simplicity. A linear message history with no compression or manipulation is easier to debug and fine-tune. As models improve, invest in prompt quality rather than tool complexity.

### 8. Demonstration Trajectories as Few-Shot Examples
Using recorded (thought, action, observation) sequences as in-context demonstrations teaches the agent how to use tools effectively. This is more powerful than just describing tools -- it shows the workflow.

## Code Examples

### Default YAML Configuration (simplified)
```yaml
agent:
  templates:
    system_template: |-
      You are a helpful assistant that can interact with a computer to solve tasks.
    instance_template: |-
      <uploaded_files>{{working_dir}}</uploaded_files>
      I've uploaded a python code repository in {{working_dir}}.
      <pr_description>{{problem_statement}}</pr_description>
      Can you help me implement the necessary changes?
    next_step_template: |-
      OBSERVATION:
      {{observation}}
    next_step_no_output_template: |-
      Your command ran successfully and did not produce any output.
  tools:
    env_variables:
      PAGER: cat
      GIT_PAGER: cat
    bundles:
      - path: tools/registry
      - path: tools/edit_anthropic
      - path: tools/review_on_submit_m
    enable_bash_tool: true
    parse_function:
      type: function_calling
  history_processors:
    - type: cache_control
      last_n_messages: 2
```

### Tool Bundle Structure
```
tools/search/
├── config.yaml          # Tool signatures and docstrings
├── install.sh           # Optional setup script
└── bin/
    ├── find_file        # Executable: find files by name
    ├── search_dir       # Executable: grep across directory (concise output)
    └── search_file      # Executable: search within open file
```

### Tool Config (search tools)
```yaml
tools:
  find_file:
    signature: "find_file <file_name> [<dir>]"
    docstring: "finds all files with the given name or pattern in dir"
    arguments:
      - name: file_name
        type: string
        required: true
      - name: dir
        type: string
        required: false
  search_dir:
    signature: "search_dir <search_term> [<dir>]"
    docstring: "searches for search_term in all files in dir"
    arguments:
      - name: search_term
        type: string
        required: true
      - name: dir
        type: string
        required: false
```

### State Command (runs after every action)
```python
#!/usr/bin/env python3
# tools/windowed/bin/_state
import json, os
from pathlib import Path
from registry import registry

def main():
    current_file = registry.get("CURRENT_FILE")
    open_file = "n/a" if not current_file else str(Path(current_file).resolve())
    state = {"open_file": open_file, "working_dir": os.getcwd()}
    print(json.dumps(state))

if __name__ == "__main__":
    main()
```

### Agent Hook Interface
```python
class AbstractAgentHook:
    def on_init(self, *, agent): ...
    def on_run_start(self): ...
    def on_step_start(self): ...
    def on_actions_generated(self, *, step: StepOutput): ...
    def on_action_started(self, *, step: StepOutput): ...
    def on_action_executed(self, *, step: StepOutput): ...
    def on_step_done(self, *, step: StepOutput, info: AgentInfo): ...
    def on_run_done(self, *, trajectory: Trajectory, info: AgentInfo): ...
    def on_model_query(self, *, messages, agent): ...
```

### Trajectory Format (JSON)
```json
{
  "response": "Let me look at the fields.py file...",
  "thought": "The issue suggests line 1474 of fields.py...",
  "action": "open /marshmallow-code__marshmallow/src/marshmallow/fields.py 1474",
  "observation": "[File: /marshmallow-code__marshmallow/src/marshmallow/fields.py (1997 lines total)]\n(1474 more lines above)\n1475: ...",
  "state": "{\"open_file\": \"/marshmallow-code__marshmallow/src/marshmallow/fields.py\", \"working_dir\": \"/marshmallow-code__marshmallow\"}",
  "query": [{"role": "system", "content": "You are a helpful assistant ..."}]
}
```

### History Processor Configuration
```yaml
# Keep last 5 observations, elide older ones
history_processors:
  - type: last_n_observations
    n: 5

# Or use prompt caching (Anthropic-style)
history_processors:
  - type: cache_control
    last_n_messages: 2
```

### Anthropic-Style Editor Tool (str_replace_editor)
```yaml
tools:
  str_replace_editor:
    signature: "str_replace_editor <command> <path> [options]"
    docstring: "Custom editing tool for viewing, creating and editing files"
    arguments:
      - name: command
        type: string
        enum: ["view", "create", "str_replace", "insert", "undo_edit"]
        required: true
      - name: path
        type: string
        required: true
      - name: old_str
        type: string
        required: false
      - name: new_str
        type: string
        required: false
```
