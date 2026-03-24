# Shopify Roast

## Overview & Philosophy

Roast is a Ruby-based domain-specific language (DSL) for creating structured AI workflows. Built by Shopify, it takes the position that AI orchestration should be expressed as **declarative Ruby code** rather than YAML/JSON configuration or visual flow builders. The framework models workflows as sequences of "cogs" -- composable building blocks that interact with LLMs, run shell commands, execute Ruby code, and process data.

**Core philosophy**: Workflows are programs, not configurations. By using a real programming language (Ruby) as the DSL host, Roast gets conditionals, loops, error handling, string interpolation, and composability for free. There is no intermediate representation or config layer -- the workflow definition IS the execution plan.

**Key motivations**:
- Chain AI steps together with output flowing seamlessly between them
- Run local coding agents (Claude Code) with full filesystem access
- Process collections with serial or parallel execution (map/reduce)
- Provide intelligent control flow: conditionals, iteration, error handling
- Enable reusable, parameterized workflow components (scopes)

**Language**: Ruby (3.0+), distributed as a gem (`roast-ai`). Uses Sorbet for type checking. Currently supports Claude Code as agent provider and OpenAI-compatible APIs for chat via the RubyLLM library.

**Repository**: https://github.com/Shopify/roast

## Architecture

### Execution Model

Roast uses a **two-phase evaluation model**:

1. **Preparation phase**: The workflow Ruby file is `instance_eval`'d on the `Workflow` object. This collects `config` and `execute` blocks as procs but does NOT evaluate them yet. A `ConfigManager` processes config blocks, and an `ExecutionManager` is prepared with execution blocks.

2. **Execution phase**: The `ExecutionManager` runs cogs in declared order. Each cog receives its input via a proc evaluated in a `CogInputContext`, executes its logic, and produces a typed `Output` object. Output from earlier cogs is accessible to later cogs via bang-method accessors (e.g., `cmd!(:step_name)`).

### Core Components

```
Workflow
  -> ConfigManager          (processes `config` blocks, scoped config per cog)
  -> ExecutionManager        (processes `execute` blocks, runs cogs sequentially)
       -> CogInputManager    (provides inter-cog communication context)
       -> Cog::Stack         (ordered list of cogs to execute)
       -> Cog::Store         (name-indexed lookup of cog instances)
       -> Async::Barrier     (async execution coordination via async-ruby)
```

### Cog Type Hierarchy

```
Cog (base class)
  |-- Cogs::Agent     - Local coding agent (Claude Code CLI)
  |-- Cogs::Chat      - Cloud LLM interaction (OpenAI/Anthropic/Gemini via RubyLLM)
  |-- Cogs::Cmd       - Shell command execution
  |-- Cogs::Ruby      - Arbitrary Ruby code execution

SystemCog (base for control flow cogs)
  |-- SystemCogs::Call     - Invoke named execution scopes (subroutines)
  |-- SystemCogs::Map      - Iterate over collections (serial or parallel)
  |-- SystemCogs::Repeat   - Loop until break condition
```

### Each Cog Has Three Inner Classes

Every cog type defines its own:
- **Config** (extends `Cog::Config`) -- configuration options (model, display settings, etc.)
- **Input** (extends `Cog::Input`) -- validated/coerced input specification
- **Output** (extends `Cog::Output`) -- typed output with parsing helpers (WithJson, WithText, WithNumber)

### Concurrency Model

Built on **async-ruby** (`Async::Barrier`, `Async::Semaphore`, `Async::Task`). Cogs can be configured as `async!` to run in the background. Accessing an async cog's output blocks until it completes. The `map` cog supports parallel execution with configurable concurrency limits via semaphores.

### Output Routing

Roast intercepts `$stdout` and `$stderr` at the fiber level via `OutputRouter`, redirecting non-main-fiber output to the event system. This allows background cogs to produce output that gets captured as events rather than interleaving with the main output stream.

## Key Patterns

### [pattern] Cog-as-Unit-of-Work
Every operation is a "cog" with a uniform lifecycle: configure -> validate input -> execute -> produce typed output. This provides a consistent abstraction whether the operation is an LLM call, shell command, or Ruby computation.

### [pattern] Bang-Method Output Access
Cog outputs are accessed via bang methods (`cmd!(:step_name)`, `agent!(:review)`). The bang variant raises if the cog failed/skipped; the non-bang variant returns nil. A question-mark variant (`cmd?(:step_name)`) returns a boolean. This three-method pattern provides ergonomic error handling.

### [pattern] Input Coercion
Cog input blocks can either set input properties explicitly (`my.command = "ls"`) or return a value that gets auto-coerced. For example, returning a string from a `cmd` block auto-sets the command. This dual-mode input reduces boilerplate for simple cases while allowing full control for complex ones.

### [orchestration] Scoped Execution
Named execution scopes (`execute(:scope_name) do ... end`) define reusable sub-workflows. The `call` cog invokes them, and `map`/`repeat` iterate over them. Scopes receive a value and index, creating a clean boundary for parameterized sub-tasks.

### [orchestration] Config Cascading with Pattern Matching
Configuration can be applied at multiple granularities:
- Global (all cogs): `global { working_directory "..." }`
- Per cog type: `cmd { display! }`
- Per regex pattern: `cmd(/slow/) { async! }`
- Per named instance: `cmd(:specific_step) { quiet! }`
Configs merge in specificity order, with more specific configs overriding less specific ones.

### [agent] Agent-vs-Chat Separation
Roast cleanly separates two AI interaction modes:
- `agent` cog: Runs a **local coding agent** (Claude Code CLI) with filesystem access, tool use, and session persistence
- `chat` cog: Pure **cloud LLM interaction** via API, no local access, stateless (sessions planned)

### [agent] Session Persistence
Agent cogs support session IDs, allowing conversations to resume across invocations. The agent output includes a session identifier that can be stored and reused.

### [hook] Control Flow via Exceptions
Flow control uses a clean exception-based model:
- `skip!` -- Skip current cog (mark as skipped, continue workflow)
- `fail!` -- Fail current cog (may abort workflow based on config)
- `next!` -- Skip to next iteration in a loop
- `break!` -- Exit the current loop entirely

### [pattern] Outputs Block
Each scope can define an `outputs` block that computes the final return value. Without it, the output of the last cog is used. The `outputs!` variant is strict (raises on access errors), while `outputs` is lenient (swallows errors from broken loops).

### [pattern] Collect and Reduce on Map Results
After a `map` operation, results can be processed with `collect` (extract all iteration outputs) or `reduce` (fold into single value). Both execute blocks in the context of each iteration's input context, allowing access to inner cog outputs.

### [sandbox] Temporary Directory per Workflow
Each workflow invocation gets a unique temp directory (`Dir.mktmpdir("roast-")`) available via `tmpdir` in cog input blocks. Automatically cleaned up when the workflow completes.

### [pattern] Template Rendering with ERB
The `template` method resolves and renders ERB templates with a comprehensive search strategy (workflow dir, prompts subdirectory, current dir) and variable interpolation. Enables separating prompts from workflow logic.

### [skill] Plugin/Custom Cog System
Custom cogs can be loaded via `use :my_cog` (from local `cogs/` directory) or `use :my_cog, from: "gem-name"` (from a gem). Custom cogs must subclass `Roast::Cog` and implement the `execute(input)` method, automatically getting config, input validation, and output typing.

### [mcp] MCP Server Access
Agent cogs have access to locally-configured MCP servers through the Claude Code CLI. Chat cogs can access cloud-based MCP servers provided by the LLM provider. This is delegated to the underlying provider rather than managed by Roast directly.

### [pattern] Event System
All cog operations emit structured events via `Event << { type: value }`. Events include begin/end markers, log messages (at multiple severity levels), and stdout/stderr captures. An `EventMonitor` collects and processes these events.

### [pattern] Deep-Dup Isolation
Config objects and scope values are `deep_dup`'d before being passed to cog execution. This prevents mutations in one cog from affecting others, critical for parallel map operations.

## Strengths

1. **Pure Ruby DSL** -- No YAML/JSON/config parsing. Full power of Ruby for workflow logic. IDE support, debugging, and testing come for free.

2. **Clean cog abstraction** -- The Config/Input/Output triad per cog type creates a well-structured, consistent interface. Input validation and coercion reduce runtime errors.

3. **Excellent concurrency model** -- Built on async-ruby with proper fiber-based concurrency. Async cogs, parallel maps with semaphore-based limits, and output-access-blocks-until-ready semantics are all well-designed.

4. **Config cascading** -- The global -> type -> regex -> name specificity chain for configuration is elegant and reduces repetition.

5. **Type safety** -- Sorbet typing throughout the codebase. RBI shims for the DSL contexts. Method signatures documented with type annotations.

6. **Output parsing helpers** -- WithJson, WithText, and WithNumber modules provide robust parsing with multiple fallback strategies (code block extraction, JSON-like pattern matching, number normalization).

7. **Composability** -- Named scopes + call/map/repeat create a clean composition model. Workflows can be built from reusable sub-workflows.

8. **Extensibility** -- Custom cogs can be loaded from local files or gems, inheriting the full cog lifecycle.

9. **Clean separation of concerns** -- Configuration, execution, and input contexts are separate evaluation contexts. No global state leakage.

10. **Pragmatic control flow** -- Exception-based skip/fail/next/break is simple and integrates well with Ruby's exception handling.

## Weaknesses

1. **Ruby-only** -- The DSL is Ruby. Teams using Python, TypeScript, or other languages cannot use Roast without running Ruby.

2. **Limited provider support** -- Agent cog only supports Claude Code (`:claude` is the only valid provider). Chat cog uses RubyLLM which supports more providers, but the agent ecosystem is constrained.

3. **No built-in memory/persistence** -- No cross-workflow memory system. Session persistence exists for agents but there is no general key-value store or knowledge graph for sharing information across workflows.

4. **No visual debugging/monitoring UI** -- The EventMonitor captures events, but there is no built-in dashboard or visualization. Debugging complex parallel workflows requires log analysis.

5. **No built-in retry/backoff** -- Failed cogs can abort the workflow or continue, but there is no automatic retry with exponential backoff for transient failures (rate limits, network errors).

6. **Repeat loop requires explicit break** -- The repeat cog loops forever until `break!` is called. There is a `max_iterations` safety valve, but no built-in convergence detection.

7. **No streaming output support** -- Chat and agent cogs collect full responses. There is no streaming/progressive output for long-running LLM calls (agent progress display exists but is provider-specific).

8. **Immature ecosystem** -- Limited number of built-in cogs. No marketplace or registry for community cogs. The plugin system exists but the ecosystem is nascent.

9. **No sandboxing for cmd/ruby cogs** -- Shell commands and Ruby code execute with full process permissions. No containerization or permission scoping for untrusted workflow code.

10. **Documentation is code-level** -- Extensive method-level docs, but conceptual architecture documentation and design decision rationale are sparse.

## Unique Ideas Worth Extracting

1. **Config cascading with regex matching** -- The ability to configure cogs by regex pattern (`cmd(/slow/) { async! }`) is a powerful pattern for cross-cutting configuration. Worth adopting for any workflow system where steps follow naming conventions.

2. **Input coercion as first-class concept** -- The dual-mode input (explicit property setting OR return-value coercion) significantly reduces boilerplate. Simple cases stay simple; complex cases get full control.

3. **Bang/question/normal method triad for output access** -- `cog!(:name)` (raises), `cog(:name)` (returns nil), `cog?(:name)` (boolean) is an elegant Ruby-ism that could be adapted to any language with method naming flexibility.

4. **Output-access-blocks-until-ready** -- When accessing an async cog's output, the calling fiber transparently blocks until the result is available. No explicit await/promise syntax needed. This is possible due to async-ruby's cooperative scheduling.

5. **Two-phase DSL evaluation** -- Collecting procs during phase 1 and executing them during phase 2 allows the framework to introspect and validate the entire workflow structure before any execution begins. This enables pre-flight checks and optimization.

6. **Stdout/Stderr interception at fiber level** -- The OutputRouter's approach of monkey-patching `$stdout.write` to redirect non-main-fiber output to the event system is creative. It allows background cogs to "print" normally while their output gets captured and routed appropriately.

7. **Scope-as-subroutine model** -- Named execution scopes that receive a value and index, combined with `call`, `map`, and `repeat`, create a minimal but complete composition model that maps well to common AI workflow patterns (fan-out/fan-in, iterative refinement, sub-task delegation).

8. **Outputs vs Outputs! strictness toggle** -- Having both a lenient and strict version of the outputs block handler is thoughtful. The lenient version swallows errors from broken loops (common in iterative AI workflows), while the strict version surfaces them for debugging.

9. **Template resolution with priority search** -- The multi-path template search (workflow dir, prompts subdir, cwd, with .erb and .md.erb extension fallback) is a practical pattern for organizing prompts separately from workflow logic.

10. **Deep-dup isolation for parallel safety** -- Automatically deep-copying config and scope values before passing to parallel cog executions prevents subtle mutation bugs that are common in concurrent workflows.

## Code Examples

### Basic Workflow with Chained Steps

```ruby
# analyze_codebase.rb
config do
  agent do
    provider :claude
    model "haiku"
    show_stats!
  end
  cmd { display! }
end

execute do
  cmd(:recent_changes) { "git diff --name-only HEAD~5..HEAD" }

  agent(:review) do
    files = cmd!(:recent_changes).lines
    <<~PROMPT
      Review these recently changed files for potential issues:
      #{files.join("\n")}
      Focus on security, performance, and maintainability.
    PROMPT
  end

  chat(:summary) do
    "Summarize this for non-technical stakeholders:\n\n#{agent!(:review).response}"
  end
end
```

### Config Cascading with Regex

```ruby
config do
  cmd { display! }              # All cmd cogs show output
  cmd(/slow/) { async! }        # Slow-prefixed cmds run async
  cmd(:critical) { abort_on_failure! }  # Named instance config
end
```

### Map/Reduce over Collections

```ruby
execute(:capitalize_a_word) do
  cmd(:to_upper) do |my, word|
    my.command = "sh"
    my.args << "-c"
    my.args << "echo \"#{word}\" | tr '[:lower:]' '[:upper:]'"
  end
end

execute do
  map(:words, run: :capitalize_a_word) { ["Hello", "World"] }

  cmd do
    words = reduce(map!(:words), "results:") do |acc|
      acc + " " + cmd!(:to_upper).text
    end
    "echo \"#{words}\""
  end
end
```

### Async Cog with Auto-Blocking

```ruby
config do
  cmd(/slow/) { async! }
end

execute do
  cmd(:fast_1) { "echo fast" }
  cmd(:slow_bg) { sleep 2; "echo background done" }  # runs async
  cmd(:fast_2) { "echo still going" }                 # starts immediately

  # Accessing slow_bg output blocks until it completes
  cmd(:needs_result) { "echo #{cmd!(:slow_bg).text}" }
end
```

### Iterative Refinement with Repeat

```ruby
execute do
  repeat(:loop, run: :refine) { initial_draft }
end

execute(:refine) do
  ruby(:one) do |_, _, idx|
    puts "iteration #{idx}"
  end
  ruby { |_, _, idx| break! if idx >= 3 }
  outputs { |_, idx| "output of iteration #{idx}" }
end
```

### Reusable Scopes with Call

```ruby
execute(:my_subroutine) do
  cmd(:capitalize) do |my, value_from_caller|
    word = value_from_caller || cmd!(:word).text
    my.command = "/bin/echo"
    my.args << word.upcase
  end
end

execute do
  call(:first, run: :my_subroutine)           # no value passed
  call(run: :my_subroutine) { "hello world" } # value passed via coercion
  call(run: :my_subroutine) do |my|           # value passed explicitly
    my.value = "scope value: roast"
  end
end
```

### Custom Cog Plugin

```ruby
# In workflow file:
use :my_custom_cog               # loads from ./cogs/my_custom_cog.rb
use :shared_cog, from: "my-gem"  # loads from gem

# In cogs/my_custom_cog.rb:
class MyCustomCog < Roast::Cog
  class Config < Roast::Cog::Config
    def my_option!(val)
      @values[:my_option] = val
    end
  end

  class Input < Roast::Cog::Input
    attr_accessor :data
    def validate!
      raise InvalidInputError unless data.present?
    end
    def coerce(return_value)
      @data = return_value
    end
  end

  class Output < Roast::Cog::Output
    include Roast::Cog::Output::WithJson
    attr_reader :result
    def initialize(result)
      super()
      @result = result
    end
    private
    def raw_text = @result.to_json
  end

  def execute(input)
    Output.new(process(input.data))
  end
end
```

### ERB Template Usage

```ruby
execute do
  agent(:review) do
    # Resolves prompts/review.md.erb relative to workflow file
    template("review", files: cmd!(:changed_files).lines, focus: "security")
  end
end
```

```erb
<%# prompts/review.md.erb %>
Review the following files for <%= focus %> issues:

<% files.each do |file| %>
- <%= file %>
<% end %>

Provide specific line-level feedback.
```
