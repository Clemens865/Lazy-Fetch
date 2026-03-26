import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, extname } from "path";
import { ensureLazyDir, writeLazyJson, readLazyJson } from "./store.js";

// --- Types ---

interface ScanResult {
  stack: string[];
  buildCmd: string | null;
  testCmd: string | null;
  lintCmd: string | null;
  entryPoints: string[];
  fileCount: number;
  symbolCount: number;
  gitInfo: {
    branch: string;
    recentCommits: string[];
    activeFiles: string[];
    contributors: string[];
    lastCommit: string;
  } | null;
  todos: string[];
  docs: string[];
}

// --- Stack Detection ---

interface StackDetector {
  name: string;
  detect: string; // file to check
  extras?: (root: string) => string[]; // additional stack items from config
}

const STACK_DETECTORS: StackDetector[] = [
  // JS/TS ecosystem
  { name: "TypeScript", detect: "tsconfig.json" },
  { name: "JavaScript", detect: "package.json" },
  {
    name: "Node.js", detect: "package.json",
    extras: (root) => {
      const items: string[] = [];
      try {
        const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        // Frameworks
        if (allDeps["next"]) items.push(`Next.js ${allDeps["next"].replace(/[\^~]/g, "")}`);
        if (allDeps["react"]) items.push("React");
        if (allDeps["vue"]) items.push("Vue");
        if (allDeps["svelte"]) items.push("Svelte");
        if (allDeps["express"]) items.push("Express");
        if (allDeps["fastify"]) items.push("Fastify");
        if (allDeps["hono"]) items.push("Hono");
        // Database/ORM
        if (allDeps["prisma"] || allDeps["@prisma/client"]) items.push("Prisma");
        if (allDeps["drizzle-orm"]) items.push("Drizzle ORM");
        if (allDeps["@supabase/supabase-js"]) items.push("Supabase");
        if (allDeps["mongoose"]) items.push("Mongoose");
        // Styling
        if (allDeps["tailwindcss"]) items.push("Tailwind CSS");
        // Testing
        if (allDeps["vitest"]) items.push("Vitest");
        if (allDeps["jest"]) items.push("Jest");
        if (allDeps["playwright"] || allDeps["@playwright/test"]) items.push("Playwright");
        // State
        if (allDeps["zustand"]) items.push("Zustand");
        if (allDeps["@tanstack/react-query"]) items.push("TanStack Query");
        // API
        if (allDeps["@trpc/server"] || allDeps["@trpc/client"]) items.push("tRPC");
        if (allDeps["graphql"]) items.push("GraphQL");
        // Auth
        if (allDeps["next-auth"]) items.push("NextAuth");
        if (allDeps["@clerk/nextjs"]) items.push("Clerk");
        // AI
        if (allDeps["@anthropic-ai/sdk"]) items.push("Claude API");
        if (allDeps["openai"]) items.push("OpenAI API");
        if (allDeps["ai"]) items.push("Vercel AI SDK");
      } catch {}
      return items;
    },
  },
  // Python
  {
    name: "Python", detect: "pyproject.toml",
    extras: (root) => {
      const items: string[] = [];
      try {
        const content = readFileSync(join(root, "pyproject.toml"), "utf-8");
        if (content.includes("django")) items.push("Django");
        if (content.includes("fastapi")) items.push("FastAPI");
        if (content.includes("flask")) items.push("Flask");
        if (content.includes("sqlalchemy")) items.push("SQLAlchemy");
        if (content.includes("pytest")) items.push("pytest");
      } catch {}
      return items;
    },
  },
  { name: "Python", detect: "requirements.txt" },
  // Rust
  { name: "Rust", detect: "Cargo.toml" },
  // Go
  { name: "Go", detect: "go.mod" },
  // Ruby
  { name: "Ruby", detect: "Gemfile" },
  // Java
  { name: "Java", detect: "pom.xml" },
  { name: "Java (Gradle)", detect: "build.gradle" },
  // Docker
  { name: "Docker", detect: "Dockerfile" },
  { name: "Docker Compose", detect: "docker-compose.yml" },
];

// --- Command Detection ---

function detectBuildCmd(root: string): string | null {
  if (existsSync(join(root, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
      if (pkg.scripts?.build) return "npm run build";
    } catch {}
  }
  if (existsSync(join(root, "Cargo.toml"))) return "cargo build";
  if (existsSync(join(root, "go.mod"))) return "go build ./...";
  if (existsSync(join(root, "Makefile"))) return "make";
  return null;
}

function detectTestCmd(root: string): string | null {
  if (existsSync(join(root, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
      const testCmd = pkg.scripts?.test ?? "";
      if (testCmd && !testCmd.includes("no test specified") && testCmd !== "echo") {
        return "npm test";
      }
    } catch {}
  }
  if (existsSync(join(root, "Cargo.toml"))) return "cargo test";
  if (existsSync(join(root, "go.mod"))) return "go test ./...";
  if (existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "pytest.ini"))) return "pytest";
  return null;
}

function detectLintCmd(root: string): string | null {
  if (existsSync(join(root, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
      if (pkg.scripts?.lint) return "npm run lint";
    } catch {}
  }
  const eslintConfigs = [".eslintrc", ".eslintrc.js", ".eslintrc.json", "eslint.config.js", "eslint.config.mjs", "eslint.config.ts"];
  if (eslintConfigs.some(c => existsSync(join(root, c)))) return "npx eslint .";
  if (existsSync(join(root, "pyproject.toml"))) {
    try {
      const content = readFileSync(join(root, "pyproject.toml"), "utf-8");
      if (content.includes("ruff")) return "ruff check .";
    } catch {}
  }
  return null;
}

// --- Entry Point Detection ---

function detectEntryPoints(root: string): string[] {
  const candidates = [
    "src/index.ts", "src/index.tsx", "src/main.ts", "src/main.tsx",
    "src/app.ts", "src/app.tsx", "src/server.ts",
    "src/cli.ts", "src/index.js", "src/main.js",
    "app/layout.tsx", "app/page.tsx", "pages/index.tsx", "pages/_app.tsx",
    "src/app/layout.tsx", "src/app/page.tsx",
    "main.py", "app.py", "src/main.py",
    "main.go", "cmd/main.go",
    "src/main.rs", "src/lib.rs",
  ];
  return candidates.filter(f => existsSync(join(root, f)));
}

// --- Git Info ---

function getGitInfo(root: string): ScanResult["gitInfo"] {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: root, stdio: "pipe" });
  } catch {
    return null;
  }

  try {
    const branch = execSync("git branch --show-current", { cwd: root, encoding: "utf-8" }).trim();

    const logOutput = execSync('git log --oneline -10 2>/dev/null || true', { cwd: root, encoding: "utf-8" }).trim();
    const recentCommits = logOutput.split("\n").filter(Boolean);

    const activeOutput = execSync(
      'git log --name-only --pretty=format: -20 2>/dev/null | sort | uniq -c | sort -rn | head -15',
      { cwd: root, encoding: "utf-8" }
    ).trim();
    const activeFiles = activeOutput.split("\n").filter(Boolean).map(l => {
      const match = l.trim().match(/^\d+\s+(.+)/);
      return match ? match[1] : "";
    }).filter(Boolean);

    const contribOutput = execSync(
      'git log --format="%aN" -50 2>/dev/null | sort | uniq -c | sort -rn | head -5',
      { cwd: root, encoding: "utf-8" }
    ).trim();
    const contributors = contribOutput.split("\n").filter(Boolean).map(l => {
      const match = l.trim().match(/^\d+\s+(.+)/);
      return match ? match[1] : "";
    }).filter(Boolean);

    const lastCommit = execSync(
      'git log --format="%ar" -1 2>/dev/null || echo "unknown"',
      { cwd: root, encoding: "utf-8" }
    ).trim();

    return { branch, recentCommits, activeFiles, contributors, lastCommit };
  } catch {
    return null;
  }
}

// --- TODO Scanner ---

function scanTodos(root: string): string[] {
  const todos: string[] = [];
  try {
    const output = execSync(
      'grep -rn "TODO\\|FIXME\\|HACK\\|XXX" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build --exclude-dir=.next --exclude-dir=coverage --exclude-dir=.lazy --exclude-dir=.git --exclude-dir=__pycache__ --exclude-dir=.venv --exclude-dir=venv --exclude-dir=.cache --exclude-dir=target --exclude-dir=.turbo --exclude-dir=.vercel . 2>/dev/null | head -30',
      { cwd: root, encoding: "utf-8", timeout: 10000 }
    ).trim();
    for (const line of output.split("\n").filter(Boolean)) {
      const match = line.match(/^\.\/(.+?):(\d+):\s*.*?(TODO|FIXME|HACK|XXX):?\s*(.+)/i);
      if (match) {
        todos.push(`${match[3]}: ${match[4].trim()} (${match[1]}:${match[2]})`);
      }
    }
  } catch {}
  return todos;
}

// --- Doc Scanner ---

function scanDocs(root: string): string[] {
  const docFiles = [
    "README.md", "CONTRIBUTING.md", "ARCHITECTURE.md", "CHANGELOG.md",
    "docs/README.md", "docs/ARCHITECTURE.md", "docs/API.md",
    "doc/README.md", "DEVELOPMENT.md",
  ];
  return docFiles.filter(f => existsSync(join(root, f)));
}

// --- Main Scan ---

export async function scan(root: string): Promise<void> {
  console.log("\n  Scanning project...");
  console.log("─".repeat(55));

  ensureLazyDir(root);
  const mem = readLazyJson<Record<string, { value: string; stored: string; updated: string }>>(root, {}, "memory.json");
  const now = new Date().toISOString();

  // 1. Detect stack
  const stack: string[] = [];
  const seen = new Set<string>();
  for (const d of STACK_DETECTORS) {
    if (existsSync(join(root, d.detect)) && !seen.has(d.name)) {
      seen.add(d.name);
      stack.push(d.name);
      if (d.extras) {
        for (const extra of d.extras(root)) {
          if (!seen.has(extra)) {
            seen.add(extra);
            stack.push(extra);
          }
        }
      }
    }
  }

  if (stack.length > 0) {
    const stackStr = stack.join(", ");
    mem["stack"] = { value: stackStr, stored: now, updated: now };
    console.log(`  Stack: ${stackStr}`);
  }

  // 2. Detect commands
  const buildCmd = detectBuildCmd(root);
  const testCmd = detectTestCmd(root);
  const lintCmd = detectLintCmd(root);

  if (buildCmd) {
    mem["build-cmd"] = { value: buildCmd, stored: now, updated: now };
    console.log(`  Build: ${buildCmd}`);
  }
  if (testCmd) {
    mem["test-cmd"] = { value: testCmd, stored: now, updated: now };
    console.log(`  Test:  ${testCmd}`);
  }
  if (lintCmd) {
    mem["lint-cmd"] = { value: lintCmd, stored: now, updated: now };
    console.log(`  Lint:  ${lintCmd}`);
  }

  // 3. Entry points
  const entryPoints = detectEntryPoints(root);
  if (entryPoints.length > 0) {
    mem["entry-points"] = { value: entryPoints.join(", "), stored: now, updated: now };
    console.log(`  Entry: ${entryPoints.join(", ")}`);
  }

  // 4. Git info
  const gitInfo = getGitInfo(root);
  if (gitInfo) {
    console.log(`\n  Git:`);
    console.log(`    Branch: ${gitInfo.branch}`);
    console.log(`    Last commit: ${gitInfo.lastCommit}`);
    console.log(`    Contributors: ${gitInfo.contributors.join(", ") || "none"}`);

    if (gitInfo.activeFiles.length > 0) {
      console.log(`    Active files (${gitInfo.activeFiles.length}):`);
      for (const f of gitInfo.activeFiles.slice(0, 8)) {
        console.log(`      ${f}`);
      }
    }

    mem["git-branch"] = { value: gitInfo.branch, stored: now, updated: now };
    if (gitInfo.contributors.length > 0) {
      mem["contributors"] = { value: gitInfo.contributors.join(", "), stored: now, updated: now };
    }
  }

  // 5. TODOs
  const todos = scanTodos(root);
  if (todos.length > 0) {
    console.log(`\n  TODOs found: ${todos.length}`);
    for (const t of todos.slice(0, 5)) {
      console.log(`    ${t}`);
    }
    if (todos.length > 5) {
      console.log(`    ... and ${todos.length - 5} more`);
    }
    mem["todos"] = { value: `${todos.length} items found`, stored: now, updated: now };
  }

  // 6. Existing docs
  const docs = scanDocs(root);
  if (docs.length > 0) {
    console.log(`\n  Docs: ${docs.join(", ")}`);
    mem["docs"] = { value: docs.join(", "), stored: now, updated: now };
  }

  // 7. Save memory
  writeLazyJson(root, mem, "memory.json");

  // 8. Build symbol index + CONTEXT.md
  console.log("\n  Building symbol index...");
  try {
    const { context } = await import("./context.js");
    // Capture output — context prints to console
    const origLog = console.log;
    const lines: string[] = [];
    console.log = (...args: any[]) => lines.push(args.map(String).join(" "));
    try {
      await context(root);
    } finally {
      console.log = origLog;
    }
    // Extract symbol count from output
    const symbolLine = lines.find(l => l.includes("Symbols:"));
    if (symbolLine) {
      const match = symbolLine.match(/Symbols:\s*(\d+)/);
      if (match) console.log(`  Symbols indexed: ${match[1]}`);
    }
  } catch (err: any) {
    console.log(`  Warning: symbol indexing failed: ${err.message}`);
  }

  // 9. Build watch data (file access patterns from git)
  try {
    const { watch } = await import("./context.js");
    const origLog = console.log;
    console.log = () => {};
    try { await watch(root); } finally { console.log = origLog; }
  } catch {}

  // 10. Discover installed skills
  try {
    const { scanSkills } = await import("./skills.js");
    await scanSkills(root);
  } catch (err: any) {
    console.log(`  Warning: skill discovery failed: ${err.message}`);
  }

  // 11. Journal the scan
  try {
    const { journal } = await import("./persist.js");
    const parts = [`Project scanned: ${stack.join(", ") || "unknown stack"}`];
    if (gitInfo) parts.push(`branch ${gitInfo.branch}`);
    parts.push(`${entryPoints.length} entry points`);
    if (todos.length > 0) parts.push(`${todos.length} TODOs`);
    await journal(root, parts.join(", "));
  } catch {}

  // Summary
  const memCount = Object.keys(mem).length;
  console.log("\n" + "─".repeat(55));
  console.log(`  Scan complete: ${memCount} facts stored in memory`);
  console.log(`  Run 'lazy read' to see the full picture.`);
}
