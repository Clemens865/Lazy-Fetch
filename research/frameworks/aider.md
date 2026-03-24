# Aider

## Overview & Philosophy

Aider is an open-source AI pair programming tool that runs in the terminal. Created by Paul Gauthier, it lets developers use LLMs to edit code in existing Git repositories. The core philosophy is **AI as a collaborator within your existing workflow** -- not a separate IDE or walled garden.

Key motivations:
- Work with **existing codebases**, not just greenfield projects
- Maintain **Git-native workflow** with automatic commits for every change
- Support **any LLM** (Claude, GPT, DeepSeek, Gemini, local models) via litellm
- Keep the developer in control with a conversational REPL interface
- Scale to large repos through intelligent context management (repo-map)

The project is remarkably self-referential: 88% of new code in recent releases was written by Aider itself ("Singularity" metric). It processes ~15B tokens/week across its user base and ranks in the Top 20 on OpenRouter.

## Architecture

### High-Level Structure

```
aider/
  main.py          # Entry point, CLI argument parsing
  models.py         # Model registry, settings, aliases, litellm integration
  repo.py           # Git repository wrapper
  repomap.py        # Repository map (tree-sitter + PageRank)
  linter.py         # Tree-sitter based linting
  watch.py          # File watcher for IDE integration (AI comments)
  history.py        # Chat summarization system
  sendchat.py       # LLM communication, message validation
  commands.py       # Slash commands (/add, /drop, /clear, etc.)
  scrape.py         # Web page scraping for context
  voice.py          # Voice-to-code input
  io.py             # Terminal I/O, rich formatting
  coders/
    base_coder.py         # Abstract base: context assembly, run loop, send/receive
    chat_chunks.py        # Message assembly data structure
    editblock_coder.py    # SEARCH/REPLACE edit format ("diff")
    wholefile_coder.py    # Whole file replacement format ("whole")
    udiff_coder.py        # Unified diff format ("udiff")
    patch_coder.py        # Structured patch format ("patch")
    architect_coder.py    # Two-model architect pattern
    ask_coder.py          # Question-only mode (no edits)
    context_coder.py      # Context-gathering mode
    help_coder.py         # Help/documentation mode
    editor_*.py           # Editor variants for architect mode
    *_prompts.py          # Prompt templates for each format
    search_replace.py     # Fuzzy matching for SEARCH/REPLACE blocks
```

### The Coder Class Hierarchy

The `Coder` base class is the central orchestrator. It implements a **factory pattern** via `Coder.create()` that selects the right subclass based on `edit_format`:

```python
# Factory selects coder based on edit_format
coder = Coder.create(main_model=model, edit_format="diff")
```

Each subclass overrides two key methods:
- `get_edits()` -- Parse LLM response into structured edits
- `apply_edits()` -- Apply parsed edits to files on disk

### Edit Formats (The Core Differentiator)

Aider's most innovative design is its **pluggable edit format system**. Different LLMs perform better with different edit representations:

**1. SEARCH/REPLACE Blocks (`diff` format -- EditBlockCoder)**
The default and most robust format. The LLM outputs blocks like:
```
filename.py
<<<<<<< SEARCH
old code here
=======
new code here
>>>>>>> REPLACE
```
- Uses **fuzzy matching** (SequenceMatcher) when exact match fails
- Tries applying failed edits against other files in chat
- Empty SEARCH section = create new file
- Most reliable across models

**2. Whole File (`whole` format -- WholeFileCoder)**
LLM outputs the entire file content. Simpler but more expensive in tokens.
- Best for smaller files or weaker models
- Aider detects filename from preceding line or code fence
- Falls back to single-file chat if filename ambiguous

**3. Unified Diff (`udiff` format -- UnifiedDiffCoder)**
Standard unified diff format with `+`/`-` lines.
- More token-efficient for small changes in large files
- Harder for LLMs to produce correctly
- Includes context-based fuzzy matching

**4. Patch Format (`patch` -- PatchCoder)**
Structured patch format with explicit Add/Delete/Update actions.
- Multiple fuzz levels: exact match -> rstrip -> strip
- Includes `move_path` for file renames

**5. Architect Mode (`architect` -- ArchitectCoder)**
A **two-model orchestration** pattern:
- A "big" model (e.g., Claude Opus) describes changes in natural language
- An "editor" model (e.g., Claude Sonnet) translates to actual code edits
- The architect model never sees edit format instructions
- Separates reasoning from mechanical code editing

```python
class ArchitectCoder(AskCoder):
    def reply_completed(self):
        # Create a secondary coder with the editor model
        editor_coder = Coder.create(
            main_model=self.main_model.editor_model,
            edit_format=self.main_model.editor_edit_format,
            from_coder=self,
        )
        editor_coder.run(with_message=content, preproc=False)
```

### Context Assembly (ChatChunks)

The message assembly pipeline is carefully structured into ordered chunks:

```python
@dataclass
class ChatChunks:
    system: List       # System prompt with edit format instructions
    examples: List     # Few-shot examples of the edit format
    done: List         # Summarized previous conversation history
    repo: List         # Repository map (ranked file/symbol listing)
    readonly_files: List  # Read-only file contents
    chat_files: List   # Editable file contents
    cur: List          # Current conversation turn
    reminder: List     # System reminder (edit format rules repeated)
```

The order matters for **prompt caching** (Anthropic's cache_control). Cache breakpoints are placed after stable content (system, examples, repo) to maximize cache hits.

### The Repo-Map System (repomap.py)

This is Aider's most technically sophisticated component. It builds a **ranked summary of the entire codebase** that fits within a token budget.

**How it works:**

1. **Tag Extraction**: Uses **tree-sitter** to parse every file and extract "tags" -- definitions and references for functions, classes, variables. Falls back to **Pygments** lexer for languages without tree-sitter reference support.

2. **Graph Construction**: Builds a **NetworkX MultiDiGraph** where:
   - Nodes = files (relative paths)
   - Edges = symbol references (file A references a symbol defined in file B)
   - Edge weights = adjusted by identifier characteristics:
     - `*10` for snake_case/camelCase identifiers >= 8 chars (more specific)
     - `*10` for mentioned identifiers (from user message)
     - `*50` for references FROM files in the chat
     - `*0.1` for `_private` identifiers
     - `*0.1` for identifiers defined in >5 files (too generic)
     - `sqrt(num_refs)` scaling to prevent high-frequency tokens from dominating

3. **PageRank**: Runs `nx.pagerank()` with **personalization** biased toward:
   - Files currently in the chat
   - Files mentioned by name in the conversation
   - Files whose path components match mentioned identifiers

4. **Tree Rendering**: Uses `grep_ast.TreeContext` to render file summaries showing only the **lines of interest** (definitions) with surrounding context collapsed. Binary search finds the right number of tags to include to hit the token budget.

5. **Caching**: SQLite-backed `diskcache.Cache` for parsed tags (keyed by file mtime). In-memory caches for rendered trees and complete maps. Refresh modes: `auto` (cache if processing > 1s), `always`, `files`, `manual`.

**Token budget scaling**: When no files are in the chat, the repo map gets up to `map_tokens * map_mul_no_files` (default 8x) tokens, giving a broader view. When files are added, it shrinks to the base `map_tokens` (default 1024).

### Chat History & Summarization

Aider manages context window pressure through **automatic chat summarization**:

```python
class ChatSummary:
    def summarize(self, messages, depth=0):
        # Split messages into head (to summarize) and tail (to keep)
        # Recursively summarize head using a weak model
        # Binary split at half_max_tokens boundary
        # Ensures splits happen at assistant message boundaries
```

- Runs in a **background thread** so it doesn't block the user
- Uses the "weak model" (cheaper/faster) for summarization
- Preserves recent messages verbatim, summarizes older ones
- Done messages are accumulated after each turn completes

### The Run Loop

```
User Input
    |
    v
preproc_user_input()  -- handle /commands, check file mentions, detect URLs
    |
    v
send_message()
    |-> format_chat_chunks()  -- assemble system + examples + history + repo + files + current
    |-> check_tokens()        -- verify within context window
    |-> warm_cache()          -- background cache warming for Anthropic
    |-> send()                -- call LLM via litellm
    |-> show_send_output()    -- stream response with markdown rendering
    |
    v
get_edits()            -- parse response into structured edits (subclass-specific)
    |
    v
apply_edits()          -- write changes to disk
    |
    v
lint_edited()          -- run linter on changed files
    |
    v
auto_commit()          -- git commit with auto-generated message
    |
    v
reply_completed()      -- post-processing hook (architect mode chains here)
    |
    v
[If lint/test errors -> reflected_message -> loop back to send_message]
```

### Reflection Loop

When linting or testing fails, Aider enters a **reflection loop**:
- Lint errors or test failures become the next user message
- The LLM sees the error output and attempts a fix
- Capped at `max_reflections = 3` to prevent infinite loops

### File Watcher (IDE Integration)

The `watch.py` module enables **IDE integration without plugins**:
- Watches files for changes using `watchfiles`
- Detects **AI comments** matching pattern: `# ai ...` or `// ai ...`
- When a developer adds `# ai fix this bug` in their editor, Aider picks it up
- Uses tree-sitter to extract the surrounding code context
- Respects `.gitignore` and `.aiderignore` patterns

## Key Patterns

### [pattern] Pluggable Edit Formats
Each edit format is a separate Coder subclass with its own prompt templates and parsing logic. Models are mapped to their best-performing format via `ModelSettings.edit_format`. This is the key insight: **the same task requires different LLM output formats depending on the model**.

### [agent] Architect Mode (Two-Model Orchestration)
The architect pattern separates **planning** (big model) from **execution** (smaller editor model). The architect describes changes in natural language; the editor translates to code. This allows using expensive reasoning models for design while using cheaper models for mechanical edits.

### [memory] Chat Summarization Pipeline
Background-threaded summarization compresses old conversation turns. Uses binary splitting to preserve recent context while summarizing older exchanges. The "weak model" handles summarization to save costs.

### [pattern] PageRank-Based Context Selection
The repo map uses graph-based ranking (PageRank with personalization) to select the most relevant code context. This is far more sophisticated than simple keyword matching or embedding-based retrieval.

### [hook] Lint-Test-Reflect Loop
After every edit, Aider can automatically lint and test. Failures feed back as reflection messages, creating an autonomous fix loop (capped at 3 iterations).

### [pattern] Fuzzy Edit Matching
SEARCH/REPLACE blocks use `SequenceMatcher` for fuzzy matching when exact matches fail. The system also tries applying failed edits to other files in the chat -- handling cases where the LLM targets the wrong file.

### [pattern] Git-Native Workflow
Every successful edit is automatically committed with an LLM-generated commit message. This provides natural undo (git revert), diffing, and history -- leveraging existing developer tools rather than inventing new ones.

### [hook] File Mention Detection
User messages are scanned for filenames. If a mentioned file isn't in the chat, Aider prompts to add it. This reduces friction in managing context.

### [pattern] Prompt Cache Warming
For Anthropic models, Aider runs background "warming pings" (1-token completions) every ~5 minutes to keep the prompt cache hot, reducing costs for long sessions.

### [skill] Voice-to-Code
Speech input via `voice.py` allows hands-free coding requests.

### [hook] URL Detection and Scraping
URLs in user messages are detected and optionally scraped, adding web content as context. Enables referencing documentation, issues, or examples by URL.

### [pattern] Fence Detection
Aider dynamically detects which code fence style the LLM prefers (triple backtick, quad backtick, XML tags) and adapts accordingly, preventing parsing failures.

### [sandbox] Read-Only Files
Files can be added as read-only context (visible to LLM but not editable). The LLM is instructed not to propose edits to these files, providing reference context without risk.

### [pattern] Special File Detection
The `filter_important_files` function identifies important files (README, package.json, Makefile, etc.) and ensures they appear in the repo map even if PageRank doesn't surface them.

### [mcp] No Native MCP Support
Aider does not implement MCP (Model Context Protocol) as a first-class feature. It relies on its own context management system (repo map, file chat, read-only files) rather than external tool protocols.

## Strengths

1. **Repo-map is best-in-class context management**. The tree-sitter + PageRank approach is more intelligent than embedding search or naive file inclusion. It understands code structure, not just text.

2. **Edit format flexibility is battle-tested**. Supporting multiple edit formats and mapping models to their best format is a competitive advantage validated by extensive benchmarking (SWE-bench, aider leaderboards).

3. **Git integration is seamless**. Auto-commits with meaningful messages provide natural undo, history, and collaboration. No proprietary state to manage.

4. **Works with any LLM**. Via litellm, Aider supports 100+ model providers. Model-specific settings (edit format, temperature, cache control) are pre-configured.

5. **Reflection loop catches errors automatically**. Lint + test feedback creates a self-correcting cycle without manual intervention.

6. **Architect mode enables cost-effective reasoning**. Using expensive models for design and cheap models for execution is economically sound.

7. **Minimal footprint**. No daemon, no database (besides tag cache), no server required. It's a CLI tool that works in any terminal.

8. **Prompt caching awareness**. First-class support for Anthropic prompt caching with cache warming reduces costs significantly for long sessions.

9. **IDE-agnostic integration**. The file watcher + AI comment pattern works with any editor without plugins.

## Weaknesses

1. **Single-agent only**. Aider has no multi-agent orchestration. It's one conversation with one LLM at a time (architect mode is the closest to multi-agent, but it's sequential).

2. **No persistent memory across sessions**. Each session starts fresh (unless chat history is restored). There's no long-term knowledge base or project memory.

3. **Repo-map is expensive for huge repos**. The initial scan with tree-sitter can be slow for very large repositories (>1000 files triggers a warning). PageRank computation scales with graph size.

4. **SEARCH/REPLACE fragility**. Despite fuzzy matching, LLMs still produce blocks that don't match. This is a fundamental tension: the format is robust but not foolproof.

5. **No sandboxing**. Code changes are applied directly to the working directory. There's no preview environment or rollback beyond git.

6. **Limited tool use**. Aider doesn't have a general tool-use framework. It can run shell commands and lint/test, but can't browse APIs, query databases, or use arbitrary tools.

7. **No parallel execution**. Everything is sequential: one edit at a time, one reflection at a time. No concurrent file editing or parallel model calls.

8. **Chat-only interface**. While the file watcher adds IDE integration, the primary interface is still a terminal chat. No visual diffing, no code review UI.

## Unique Ideas Worth Extracting

### 1. PageRank for Code Context (repo-map)
The graph-based approach to selecting relevant context is Aider's most novel contribution. Building a definition-reference graph and running PageRank with personalization biased toward the current task is far superior to embedding-based RAG for code. **Worth adopting for any code-aware agent system.**

### 2. Edit Format as a First-Class Abstraction
The insight that different models need different edit formats, and that this should be a pluggable system with per-model defaults, is powerful. The `ModelSettings.edit_format` mapping is a simple but high-impact design decision.

### 3. Architect Mode (Plan/Execute Separation)
Using one model to plan and another to execute is a reusable pattern. The key insight: expensive reasoning models shouldn't waste tokens on mechanical edit formatting.

### 4. Chat Summarization with Binary Splitting
The recursive binary split approach to summarization (keep recent, summarize old, recurse if still too big) is an elegant solution to context window management.

### 5. Token Budget Binary Search for Repo Map
Using binary search to find the right number of ranked tags that fit within a token budget is a clever optimization. The `to_tree()` method renders progressively more tags until the budget is exhausted.

### 6. Prompt Cache Warming
Background threads that send 1-token completions to keep Anthropic's prompt cache warm. Simple, effective cost optimization for long coding sessions.

### 7. AI Comments as IDE Bridge
The pattern of detecting `# ai ...` comments in source files as instructions is a zero-dependency IDE integration that works everywhere. No plugins, no extensions, no protocol -- just text in files.

### 8. Fuzzy Edit Application with Cross-File Fallback
When a SEARCH/REPLACE block fails on the target file, trying it against all other files in the chat is a practical recovery strategy that handles LLM mistakes gracefully.

### 9. Special File Boosting
Identifying "important" files (README, Makefile, package.json) and ensuring they appear in the repo map regardless of PageRank score provides essential project context that pure graph ranking might miss.

## Code Examples

### Repo Map Personalization (PageRank Bias)
```python
# Files in chat and mentioned files get boosted personalization
personalize = 100 / len(fnames)

if fname in chat_fnames:
    current_pers += personalize
if rel_fname in mentioned_fnames:
    current_pers = max(current_pers, personalize)

# Identifier-based edge weighting
if ident in mentioned_idents:
    mul *= 10              # 10x boost for mentioned symbols
if (is_snake or is_camel) and len(ident) >= 8:
    mul *= 10              # 10x boost for descriptive names
if ident.startswith("_"):
    mul *= 0.1             # Downweight private symbols
if referencer in chat_rel_fnames:
    use_mul *= 50          # 50x boost for refs FROM chat files

ranked = nx.pagerank(G, weight="weight", personalization=personalization)
```

### Context Assembly Order (ChatChunks)
```python
def all_messages(self):
    return (
        self.system           # Edit format instructions
        + self.examples       # Few-shot demonstrations
        + self.readonly_files # Reference-only file contents
        + self.repo           # Ranked repo map
        + self.done           # Summarized history
        + self.chat_files     # Editable file contents
        + self.cur            # Current user message
        + self.reminder       # System reminder (format rules again)
    )
```

### SEARCH/REPLACE Prompt Template
```python
main_system = """Act as an expert software developer.
Take requests for changes to the supplied code.
Once you understand the request you MUST:
1. Decide if you need to propose edits to files not in chat
2. Think step-by-step and explain needed changes
3. Describe each change with a *SEARCH/REPLACE block*"""

# The reminder repeats the format rules at the end of context
system_reminder = """Every *SEARCH/REPLACE block* must use this format:
1. The file path alone on a line
2. Opening fence and language: ```python
3. <<<<<<< SEARCH
4. Lines to find in existing code
5. =======
6. Replacement lines
7. >>>>>>> REPLACE
8. Closing fence: ```"""
```

### Architect Two-Model Chain
```python
class ArchitectCoder(AskCoder):
    def reply_completed(self):
        # Architect's natural language response becomes editor's input
        editor_coder = Coder.create(
            main_model=self.main_model.editor_model,
            edit_format=self.main_model.editor_edit_format,
            from_coder=self,          # inherit file context
            summarize_from_coder=False,
        )
        editor_coder.cur_messages = []
        editor_coder.done_messages = []
        editor_coder.run(with_message=content, preproc=False)
        self.move_back_cur_messages("I made those changes to the files.")
```

### Model Settings Configuration
```python
@dataclass
class ModelSettings:
    name: str
    edit_format: str = "whole"           # Default edit format for this model
    weak_model_name: Optional[str] = None  # Cheaper model for summarization
    use_repo_map: bool = False           # Whether to include repo map
    editor_model_name: Optional[str] = None  # For architect mode
    editor_edit_format: Optional[str] = None
    cache_control: bool = False          # Anthropic prompt caching
    reminder: str = "user"               # Where to put format reminder: "sys" | "user"
    examples_as_sys_msg: bool = False    # Inline examples in system prompt
    streaming: bool = True
    use_temperature: Union[bool, float] = True
```

### File Watcher AI Comment Detection
```python
class FileWatcher:
    # Matches: # ai fix this, // AI refactor, -- ai!
    ai_comment_pattern = re.compile(
        r"(?:#|//|--|;+) *(ai\b.*|ai\b.*|.*\bai[?!]?) *$", re.IGNORECASE
    )

    def filter_func(self, change_type, path):
        comments, _, _ = self.get_ai_comments(str(path_abs))
        return bool(comments)  # Only trigger on files with AI comments
```
