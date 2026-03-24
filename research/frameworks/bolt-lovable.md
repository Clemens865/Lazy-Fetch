# bolt.new & Lovable — App Generators

## Overview & Philosophy

**bolt.new** (by StackBlitz) and **Lovable** (formerly GPT-Engineer) represent the "one-shot app generation" paradigm: a user describes an application in natural language and receives a fully functional, running web application within seconds. Both tools eliminate the gap between ideation and working software.

**bolt.new** is built on StackBlitz's **WebContainer** technology — a full Node.js runtime that executes entirely in the browser via WebAssembly. The core insight is that the AI doesn't just generate code; it has complete control over the filesystem, package manager, dev server, terminal, and browser console. The AI agent handles the entire app lifecycle from creation to deployment without any cloud VM.

**Lovable** takes a similar prompt-to-app approach but uses a cloud-based sandbox (built on Supabase's open-source technology) rather than an in-browser VM. Lovable generates React + TypeScript + Vite + Tailwind CSS applications with native Supabase integration for backend functionality (auth, database, edge functions). Since October 2025, "Lovable Cloud" provides built-in database, authentication, and file storage.

**bolt.diy** is the community-driven open-source fork of bolt.new that supports 19+ LLM providers (OpenAI, Anthropic, Google, Ollama, Groq, DeepSeek, Mistral, etc.) instead of being locked to a single model.

Key metrics:
- Lovable: 8M+ users, $100M ARR, $6.6B valuation (Series B, Dec 2025)
- bolt.new: $40M+ ARR, powers millions of app generations
- bolt.diy: 90k+ GitHub stars, massive open-source community

## Architecture

### bolt.new / bolt.diy — Five-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: User Interface                                │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐     │
│  │  Chat UI  │  │  Workbench   │  │  Settings/    │     │
│  │  (Remix)  │  │  (Editor +   │  │  Provider     │     │
│  │           │  │   Preview +  │  │  Config)      │     │
│  │           │  │   Terminal)  │  │               │     │
│  └──────────┘  └──────────────┘  └───────────────┘     │
├─────────────────────────────────────────────────────────┤
│  Layer 2: State Management (nanostores + zustand)       │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Chat Store │ Workbench Store │ Editor Store     │   │
│  │  Files Map  │ Actions Map     │ Terminal Store   │   │
│  └──────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│  Layer 3: AI Integration                                │
│  ┌──────────────────────────────────────────────────┐   │
│  │  System Prompt → LLM API → SSE Stream Response   │   │
│  │  StreamingMessageParser → boltArtifact/Action     │   │
│  └──────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│  Layer 4: Action Execution                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │  ActionRunner (sequential queue)                  │   │
│  │  ├─ FileAction  → write to WebContainer FS       │   │
│  │  ├─ ShellAction → spawn process in WebContainer  │   │
│  │  └─ (bolt.diy) SupabaseAction → migration/query  │   │
│  └──────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│  Layer 5: WebContainer Runtime                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  In-browser Node.js VM (WebAssembly)              │   │
│  │  ├─ Virtual filesystem                            │   │
│  │  ├─ npm/pnpm package management                   │   │
│  │  ├─ Vite dev server                               │   │
│  │  ├─ zsh-emulated shell                            │   │
│  │  └─ Preview iframe                                │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Prompt-to-App Pipeline (bolt.new)

1. **User Prompt** → Optional "enhance" step refines the prompt via LLM
2. **System Prompt Injection** → Comprehensive system prompt defines:
   - WebContainer constraints (no native binaries, no git, limited Python)
   - Output format: `<boltArtifact>` containing `<boltAction>` elements
   - Diff spec for user modifications (GNU unified diff or full file)
   - Artifact instructions (holistic thinking, full file content, no placeholders)
3. **LLM Streaming** → Response streamed via Server-Sent Events (SSE)
4. **Concurrent WebContainer Boot** → While LLM generates, WebContainer boots in parallel
5. **StreamingMessageParser** → Parses `<boltArtifact>` and `<boltAction>` tags from stream in real-time
6. **ActionRunner** → Executes actions sequentially in WebContainer:
   - `type="file"` → Writes file to virtual filesystem
   - `type="shell"` → Executes command (npm install, dev server start, etc.)
7. **Live Preview** → Vite dev server auto-refreshes in preview iframe
8. **Iterative Refinement** → User can chat to modify; diffs of manual edits are sent back to LLM

### Lovable Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Chat Interface (Left Panel)                            │
│  ├─ Agent Mode (autonomous implementation)              │
│  ├─ Edit Mode  (targeted visual modifications)          │
│  └─ Chat Mode  (planning/debugging, no code changes)    │
├─────────────────────────────────────────────────────────┤
│  AI Agent (Claude Sonnet 4.5 default)                   │
│  ├─ Tool-based execution (not tag-based like bolt)      │
│  ├─ lov-write, lov-line-replace, lov-search-files       │
│  ├─ lov-add-dependency, lov-rename-file, lov-delete     │
│  ├─ lov-download-to-repo, read-console-logs             │
│  ├─ read-network-requests (debugging)                   │
│  └─ Plan Mode (Feb 2026): shows plan before execution   │
├─────────────────────────────────────────────────────────┤
│  Cloud Sandbox / Dev Server                             │
│  ├─ Real-time preview (iframe, right panel)             │
│  ├─ React + Vite + Tailwind + TypeScript                │
│  └─ Supabase integration (auth, DB, edge functions)     │
├─────────────────────────────────────────────────────────┤
│  Deployment                                             │
│  ├─ One-click deploy (Cloudflare)                       │
│  ├─ GitHub export                                       │
│  └─ Netlify export                                      │
└─────────────────────────────────────────────────────────┘
```

### Key Architectural Difference

| Aspect | bolt.new | Lovable |
|--------|----------|---------|
| **Execution** | In-browser WebContainer (WASM) | Cloud-based sandbox |
| **AI Output** | XML tags in stream (`<boltAction>`) | Tool calls (`lov-write`, `lov-line-replace`) |
| **Backend** | Node.js in WebContainer | Supabase (native integration) |
| **File Edits** | Full file replacement always | Line-replace preferred, `// ... keep existing code` |
| **Stack Lock** | Any Node.js framework | React + Vite + Tailwind only |
| **LLM** | Anthropic Claude (bolt.new), any (bolt.diy) | Claude Sonnet 4.5 (default), multiple options |

## Key Patterns

### Streaming Artifact Parser [pattern] [agent]

The `StreamingMessageParser` is the core innovation — it parses structured XML tags from a streaming LLM response in real-time, extracting file operations and shell commands as they arrive:

```typescript
// bolt.new: Tags parsed from LLM stream
const ARTIFACT_TAG_OPEN = '<boltArtifact';     // Container for all actions
const ARTIFACT_ACTION_TAG_OPEN = '<boltAction'; // Individual file/shell action

// Two action types drive everything:
type ActionType = 'file' | 'shell';
interface FileAction { type: 'file'; filePath: string; content: string; }
interface ShellAction { type: 'shell'; content: string; }
```

This is distinct from OpenAI-style function calling — the LLM generates structured XML inline with its text response, allowing the parser to begin execution before the full response completes. [pattern] [agent]

### Sequential Action Queue [pattern] [orchestration]

Actions are chained via a promise queue to prevent race conditions during streaming:

```typescript
class ActionRunner {
  #currentExecutionPromise: Promise<void> = Promise.resolve();

  async runAction(data: ActionCallbackData) {
    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => this.#executeAction(actionId))
      .catch((error) => console.error('Action failed:', error));
  }
}
```

This ensures `package.json` is written before `npm install` runs, and files exist before commands reference them. [pattern] [orchestration]

### WebContainer Sandboxing [sandbox] [pattern]

The entire development environment runs in the browser — no cloud VM needed:

```typescript
import { WebContainer } from '@webcontainer/api';

// Boot once, persist across HMR
export let webcontainer: Promise<WebContainer> =
  Promise.resolve()
    .then(() => WebContainer.boot({ workdirName: 'project' }));

// AI writes files directly to the virtual FS
await webcontainer.fs.writeFile(filePath, content);

// AI spawns processes
const process = await webcontainer.spawn('npm', ['install']);
```

Key constraints the system prompt enforces:
- No native binaries (JS/WASM only)
- No git
- Limited Python (stdlib only)
- Prefer Vite for dev servers
- Prefer libsql/sqlite over native databases [sandbox]

### CDN-Optimized Package Installation [pattern] [skill]

bolt.new pre-compresses popular npm packages on a CDN. After the first hit, packages sit in the browser cache, so `npm install` often finishes in < 500ms or is skipped entirely. Web Workers handle compilation to keep the UI thread free. [pattern]

### Diff-Based Context for Iterative Refinement [pattern] [memory]

When users manually edit code in the workbench, bolt sends diffs back to the LLM rather than full files:

```xml
<bolt_file_modifications>
  <diff path="/home/project/src/main.js">
    @@ -2,7 +2,10 @@
      return a + b;
    }
    -console.log('Hello, World!');
    +console.log('Hello, Bolt!');
  </diff>
  <file path="/home/project/package.json">
    // full file content when diff > new content size
  </file>
</bolt_file_modifications>
```

The system intelligently chooses between diff and full-file based on which is smaller. [pattern] [memory]

### Tool-Based Agent Architecture (Lovable) [agent] [pattern]

Unlike bolt's tag-based approach, Lovable uses explicit tool calls:

```json
{
  "lov-write": "Create/overwrite files (supports '// ... keep existing code')",
  "lov-line-replace": "Surgical line-range replacements with ellipsis support",
  "lov-search-files": "Regex search across codebase with glob filtering",
  "lov-add-dependency": "Add npm packages",
  "lov-download-to-repo": "Download external assets to project",
  "lov-rename-file": "Rename files",
  "lov-delete-file": "Delete files",
  "read-console-logs": "Debug via browser console",
  "read-network-requests": "Debug via network tab"
}
```

This gives the AI more structured control and enables parallel tool execution. [agent] [pattern]

### Three Operational Modes (Lovable) [agent] [orchestration]

- **Agent Mode**: Autonomous — AI explores codebase, makes changes, runs verification
- **Edit Mode**: Targeted — User selects UI elements for visual modification
- **Chat Mode**: Planning — Discussion without code changes
- **Plan Mode** (Feb 2026): AI shows detailed plan before writing any code

This modal approach prevents scope creep and gives users control over AI autonomy. [agent] [orchestration]

### Lazy Write Pattern (Lovable) [pattern] [skill]

Lovable's `lov-write` tool supports `// ... keep existing code` comments to avoid rewriting entire files:

```typescript
// Lovable generates this instead of full file rewrites:
function App() {
  // ... keep existing code (all UI components)

  // Only the new footer is being added
  const Footer = () => (
    <footer>New Footer Component</footer>
  );

  return (
    <div>
      {/* ... keep existing code (main content) */}
      <Footer />
    </div>
  );
}
```

This dramatically reduces token usage and generation time for incremental changes. [pattern] [skill]

### Prompt Enhancement [hook] [pattern]

Both tools offer prompt enhancement before submission:
- bolt.new: "enhance" icon refines user prompt via LLM before sending
- bolt.diy: `prompt-library.ts` with specialized prompts (new project vs. discussion vs. optimized)

This improves output quality significantly for vague user inputs. [hook] [pattern]

### Multi-Provider Architecture (bolt.diy) [pattern] [mcp]

bolt.diy abstracts LLM providers behind a unified interface supporting 19+ providers:

```
OpenAI, Anthropic, Google Gemini, Ollama, OpenRouter,
LMStudio, Mistral, xAI, HuggingFace, DeepSeek, Groq,
Cohere, Together, Perplexity, Moonshot, Hyperbolic,
GitHub Models, Amazon Bedrock, OpenAI-like
```

All use the Vercel AI SDK's `streamText` function with provider-specific model initialization. [pattern] [mcp]

### Debugging-First Workflow (Lovable) [agent] [hook]

Lovable's system prompt mandates: "Use debugging tools FIRST before examining or modifying code." The agent has access to `read-console-logs` and `read-network-requests` tools, enabling it to diagnose issues from runtime errors rather than just static analysis. [agent] [hook]

### State Management: nanostores + zustand [pattern]

bolt uses a three-tier state approach:
- **nanostores**: Global state (files map, actions map) — lightweight, framework-agnostic
- **zustand**: UI state — React-optimized
- **Persistence layers**: Chat history, project snapshots for restoration [pattern]

## Strengths

1. **Zero-setup development**: Users go from idea to running app in seconds. No local environment, no dependency hell, no configuration.

2. **Full lifecycle control**: The AI handles everything — scaffolding, dependency installation, dev server, file creation, debugging, and deployment. This is fundamentally different from code-completion tools.

3. **Real-time streaming execution**: Actions execute as the LLM streams, so users see files appearing and npm installing before the LLM finishes generating. This creates a feeling of "watching the AI build."

4. **In-browser sandboxing (bolt)**: WebContainer eliminates cloud infrastructure costs and latency. Everything runs locally in WASM, with CDN-cached packages for near-instant installs.

5. **Iterative refinement loop**: The chat-based interface naturally supports "make this button blue" or "add authentication" follow-ups. Diffs from manual edits feed back into context.

6. **Low barrier to entry**: Non-developers (PMs, designers, entrepreneurs) can build functional prototypes. Lovable reports that many users have zero coding experience.

7. **Instant preview**: Both tools show live preview as code is generated, providing immediate visual feedback.

8. **Open-source availability (bolt.diy)**: The entire architecture is available for study, modification, and self-hosting with any LLM provider.

## Weaknesses

1. **Complexity ceiling**: Generated apps work well for CRUD apps, landing pages, and simple dashboards but struggle with complex business logic, multi-service architectures, or performance-critical code.

2. **Full-file rewrites (bolt)**: bolt.new always sends complete file contents (no placeholders allowed), which burns tokens rapidly as files grow. Lovable partially addresses this with `// ... keep existing code` but it's fragile.

3. **WebContainer limitations (bolt)**: No native binaries, no git, limited Python, no C/C++. This rules out many real-world backends. The LLM must constantly work around these constraints.

4. **Stack lock-in (Lovable)**: Locked to React + Vite + Tailwind + TypeScript. Cannot generate Angular, Vue, Svelte, Next.js, or native mobile apps.

5. **Context window exhaustion**: As projects grow, the conversation history plus file contents can exceed context limits, leading to the AI "forgetting" earlier decisions or generating inconsistent code.

6. **Debugging complexity**: When generated code fails, users without programming knowledge struggle to describe the problem. Console log tools help but don't replace understanding.

7. **No true backend (Lovable)**: Cannot run Node.js, Python, or Ruby server-side. Supabase integration covers common cases but limits custom backend logic.

8. **Maintainability**: AI-generated codebases can become "spaghetti" over many iterations. Both tools include prompts about clean architecture, but enforcement is limited.

9. **Single-agent limitation**: Both tools use a single LLM call per user message. There's no multi-agent coordination, no parallel exploration of approaches, no specialist agents for different concerns.

10. **No test generation**: Neither tool generates tests by default, making it hard to verify correctness as apps evolve.

## Unique Ideas Worth Extracting

### 1. Streaming XML Tag Parser for Real-Time Execution
The `StreamingMessageParser` pattern — parsing structured actions from an LLM stream before it completes — is powerful. It enables "execute-as-you-generate" rather than "generate-then-execute." This could apply to any agent system that needs to start acting before the full plan is known.

### 2. Promise-Chain Action Queue
The sequential execution queue (`#currentExecutionPromise.then(...)`) is an elegant pattern for ensuring ordered execution of streaming actions without blocking the parser. This prevents race conditions without complex concurrency primitives.

### 3. CDN-Cached Dependency Layers
Pre-compressing and CDN-caching popular packages so `npm install` finishes in < 500ms is a massive UX improvement. Any sandbox system could benefit from pre-warming common dependencies.

### 4. Diff vs Full-File Heuristic
Automatically choosing between sending a diff or full file content based on which is smaller is a practical optimization for context window management.

### 5. "Keep Existing Code" Lazy Writes
Lovable's `// ... keep existing code` pattern lets the AI skip unchanged sections when writing files. This is a pragmatic middle ground between full rewrites and surgical diffs.

### 6. Debugging-First Agent Workflow
Mandating that the AI check console logs and network requests BEFORE examining code is a powerful pattern. It mirrors how experienced developers debug — start from symptoms, not source.

### 7. Modal Agent Behavior
Lovable's three modes (Agent/Edit/Chat) plus Plan Mode give users explicit control over AI autonomy. This prevents the common frustration of AI making unwanted changes when you just want to discuss.

### 8. Prompt Enhancement as First-Class Feature
The "enhance" button that refines a user's prompt before sending it is a simple but high-impact pattern. It bridges the gap between what users say and what the LLM needs to hear.

### 9. System Prompt as Environment Contract
bolt.new's system prompt is essentially a contract between the AI and the runtime environment — it declares available commands, filesystem constraints, package limitations, and output format. This "environment-aware prompting" pattern is transferable to any agent that operates in a constrained environment.

### 10. Concurrent Environment Boot
Booting the WebContainer in parallel with the LLM call (rather than sequentially) saves significant time. The environment is ready when the first action arrives.

## Code Examples

### bolt.new System Prompt Structure (from source)

```typescript
// app/lib/.server/llm/prompts.ts
export const getSystemPrompt = (cwd: string = WORK_DIR) => `
You are Bolt, an expert AI assistant...

<system_constraints>
  You are operating in WebContainer, an in-browser Node.js runtime...
  - No native binaries, no git, no pip
  - Available commands: cat, cp, ls, mkdir, mv, rm, node, python3, curl...
</system_constraints>

<diff_spec>
  For user-made file modifications, a <bolt_file_modifications> section...
  System chooses <file> if diff exceeds new content size, otherwise <diff>.
</diff_spec>

<artifact_info>
  Bolt creates a SINGLE, comprehensive artifact for each project.

  <artifact_instructions>
    1. Think HOLISTICALLY before creating an artifact
    4. Wrap content in <boltArtifact> tags with <boltAction> elements
    8. Action types: shell (commands), file (write files)
    11. ALWAYS provide FULL file contents. NEVER use placeholders.
    14. Split functionality into smaller modules
  </artifact_instructions>
</artifact_info>
`;
```

### bolt.new LLM Output Format (what the AI generates)

```xml
<boltArtifact id="todo-app" title="Todo Application">
  <boltAction type="file" filePath="package.json">
{
  "name": "todo-app",
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.0.0"
  }
}
  </boltAction>

  <boltAction type="shell">
npm install
  </boltAction>

  <boltAction type="file" filePath="src/App.tsx">
import { useState } from 'react';

export default function App() {
  const [todos, setTodos] = useState<string[]>([]);
  // ... full component code, never truncated
}
  </boltAction>

  <boltAction type="shell">
npm run dev
  </boltAction>
</boltArtifact>
```

### bolt.new Stream Processing Pipeline

```typescript
// app/lib/.server/llm/stream-text.ts
import { streamText as _streamText, convertToCoreMessages } from 'ai';

export function streamText(messages: Messages, env: Env, options?: StreamingOptions) {
  return _streamText({
    model: getAnthropicModel(getAPIKey(env)),
    system: getSystemPrompt(),
    maxTokens: MAX_TOKENS,
    messages: convertToCoreMessages(messages),
    ...options,
  });
}
```

### bolt.new WebContainer Bootstrap

```typescript
// app/lib/webcontainer/index.ts
import { WebContainer } from '@webcontainer/api';

// Singleton — boots once, survives HMR
export let webcontainer: Promise<WebContainer> =
  import.meta.hot?.data.webcontainer ??
  Promise.resolve()
    .then(() => WebContainer.boot({ workdirName: WORK_DIR_NAME }))
    .then((wc) => { webcontainerContext.loaded = true; return wc; });

if (import.meta.hot) {
  import.meta.hot.data.webcontainer = webcontainer;
}
```

### bolt.new ActionRunner — Sequential Execution

```typescript
// app/lib/runtime/action-runner.ts
class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #currentExecutionPromise: Promise<void> = Promise.resolve();
  actions: MapStore<Record<string, ActionState>> = map({});

  async runAction(data: ActionCallbackData) {
    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => this.#executeAction(actionId))
      .catch((error) => console.error('Action failed:', error));
  }

  async #executeAction(actionId: string) {
    const action = this.actions.get()[actionId];
    switch (action.type) {
      case 'shell': await this.#runShellAction(action); break;
      case 'file':  await this.#runFileAction(action);  break;
    }
  }
}
```

### Lovable Tool Definitions (from leaked agent config)

```json
{
  "lov-write": {
    "description": "Write to a file. Supports '// ... keep existing code' markers.",
    "parameters": { "file_path": "string", "content": "string" }
  },
  "lov-line-replace": {
    "description": "Line-based search and replace with ellipsis support for large sections.",
    "parameters": {
      "file_path": "string",
      "search": "string (with ... for large sections)",
      "first_replaced_line": "number",
      "last_replaced_line": "number",
      "replace": "string"
    }
  },
  "lov-search-files": {
    "description": "Regex search across project files with glob filtering.",
    "parameters": { "query": "regex", "include_pattern": "glob" }
  },
  "lov-add-dependency": {
    "description": "Add npm package to project.",
    "parameters": { "package": "string (e.g., lodash@latest)" }
  },
  "read-console-logs": { "description": "Read browser console output for debugging." },
  "read-network-requests": { "description": "Read network requests for API debugging." }
}
```

### bolt.diy Supabase Action Extension

```xml
<!-- bolt.diy extends the action system with Supabase operations -->
<boltArtifact id="create-users-table" title="Create Users Table">
  <boltAction type="supabase" operation="migration" filePath="/supabase/migrations/create_users.sql">
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL
    );
  </boltAction>
  <boltAction type="supabase" operation="query" projectId="${projectId}">
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL
    );
  </boltAction>
</boltArtifact>
```

---

**Sources:**
- [bolt.new GitHub](https://github.com/stackblitz/bolt.new) — source code and README
- [bolt.diy GitHub](https://github.com/stackblitz-labs/bolt.diy) — open-source fork
- [bolt.new system prompts](https://github.com/stackblitz/bolt.new/blob/main/app/lib/.server/llm/prompts.ts)
- [bolt.diy DeepWiki](https://deepwiki.com/stackblitz-labs/bolt.diy) — architecture analysis
- [bolt.new DeepWiki](https://deepwiki.com/stackblitz/bolt.new) — architecture analysis
- [How bolt.new works — PostHog](https://newsletter.posthog.com/p/from-0-to-40m-arr-inside-the-tech)
- [Lovable system prompt leak](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Lovable/Agent%20Prompt.txt)
- [Lovable official site](https://lovable.dev/)
- [Lovable documentation](https://docs.lovable.dev/)
- [Architecture Behind Lovable and Bolt — Beam](https://www.beam.cloud/blog/agentic-apps)
- [How AI Prototyping Tools Work — Substack](https://amankhan1.substack.com/p/how-ai-prototyping-tools-actually)
