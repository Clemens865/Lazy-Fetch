import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { writeLazyFile, readLazyFile, appendLazyFile, lazyPath } from "./store.js";

// --- Types ---

interface SprintInfo {
  index: number;
  title: string;
  tasks: string[];
  status: string;
  started?: string;
  completed?: string;
  attempts: number;
  validationOutput?: string;
  securityOutput?: string;
  notes?: string;
}

// --- Helpers ---

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function gitDiffSummary(root: string, since?: string): string {
  try {
    if (since) {
      // Get files changed since a timestamp
      const out = execSync(`git log --since="${since}" --name-status --pretty=format:""`, {
        cwd: root,
        encoding: "utf-8",
        timeout: 10000,
      }).trim();
      if (!out) return "_No git changes detected._";
      // Deduplicate and format
      const changes = new Map<string, string>();
      for (const line of out.split("\n").filter(Boolean)) {
        const [status, ...fileParts] = line.split("\t");
        const file = fileParts.join("\t");
        if (file) changes.set(file, status);
      }
      const lines: string[] = [];
      for (const [file, status] of changes) {
        const icon = status.startsWith("A") ? "+" : status.startsWith("D") ? "-" : "~";
        lines.push(`- \`${icon}\` ${file}`);
      }
      return lines.join("\n") || "_No files changed._";
    } else {
      // Just show current status
      const out = execSync("git diff --stat HEAD~1 2>/dev/null || echo 'No previous commit'", {
        cwd: root,
        encoding: "utf-8",
        timeout: 10000,
      }).trim();
      return out ? `\`\`\`\n${out}\n\`\`\`` : "_No changes._";
    }
  } catch {
    return "_Could not retrieve git changes._";
  }
}

function gitFilesCreated(root: string, since?: string): string[] {
  try {
    const cmd = since
      ? `git log --since="${since}" --diff-filter=A --name-only --pretty=format:""`
      : `git diff --diff-filter=A --name-only HEAD~1 2>/dev/null`;
    const out = execSync(cmd, { cwd: root, encoding: "utf-8", timeout: 10000 }).trim();
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// --- Plan Doc ---

export function generatePlanDoc(root: string, goal: string, tasks: { title: string; phase: string; status: string }[]): void {
  const lines: string[] = [];
  lines.push(`# Plan: ${goal}`);
  lines.push(`\n_Generated: ${timestamp()}_\n`);

  // Group by phase
  const phases = ["read", "plan", "implement", "validate", "document"];
  const phaseIcons: Record<string, string> = { read: "📖", plan: "📋", implement: "🔨", validate: "✓", document: "📝" };

  for (const phase of phases) {
    const phaseTasks = tasks.filter(t => t.phase === phase);
    if (phaseTasks.length === 0) continue;

    lines.push(`## ${phaseIcons[phase] ?? ""} ${phase.charAt(0).toUpperCase() + phase.slice(1)}`);
    for (const t of phaseTasks) {
      const check = t.status === "done" ? "[x]" : "[ ]";
      lines.push(`- ${check} ${t.title}`);
    }
    lines.push("");
  }

  const done = tasks.filter(t => t.status === "done").length;
  lines.push(`---`);
  lines.push(`Progress: ${done}/${tasks.length} tasks complete`);

  writeLazyFile(root, lines.join("\n") + "\n", "docs", "plan.md");
}

/** Update plan.md when a task is marked done */
export function updatePlanDoc(root: string, goal: string, tasks: { title: string; phase: string; status: string }[]): void {
  generatePlanDoc(root, goal, tasks);
}

// --- Yolo Plan Doc ---

export function generateYoloPlanDoc(
  root: string,
  goal: string,
  prdFile: string,
  sprints: { title: string; tasks: string[]; status: string }[]
): void {
  const lines: string[] = [];
  lines.push(`# Yolo Plan: ${goal}`);
  lines.push(`\n_Generated: ${timestamp()}_`);
  lines.push(`_PRD: ${prdFile}_\n`);

  for (let i = 0; i < sprints.length; i++) {
    const s = sprints[i];
    const icon = s.status === "done" ? "✅" : s.status === "active" ? "🔄" : s.status === "failed" ? "❌" : "⬜";
    lines.push(`## Sprint ${i + 1}: ${s.title} ${icon}`);
    for (const t of s.tasks) {
      const check = s.status === "done" ? "[x]" : "[ ]";
      lines.push(`- ${check} ${t}`);
    }
    lines.push("");
  }

  const done = sprints.filter(s => s.status === "done").length;
  lines.push(`---`);
  lines.push(`Progress: ${done}/${sprints.length} sprints complete`);

  writeLazyFile(root, lines.join("\n") + "\n", "docs", "plan.md");
}

// --- Sprint Archive Doc ---

export function generateSprintDoc(root: string, sprint: SprintInfo): void {
  const num = String(sprint.index + 1).padStart(2, "0");
  const filename = `sprint-${num}-${slug(sprint.title)}.md`;

  const lines: string[] = [];
  lines.push(`# Sprint ${sprint.index + 1}: ${sprint.title}`);
  lines.push(`\n_Completed: ${timestamp()}_\n`);

  // Status
  lines.push(`## Summary`);
  lines.push(`- **Status:** ${sprint.status}`);
  if (sprint.started) lines.push(`- **Started:** ${sprint.started}`);
  if (sprint.completed) lines.push(`- **Completed:** ${sprint.completed}`);
  lines.push(`- **Validation attempts:** ${sprint.attempts}`);
  if (sprint.notes) lines.push(`- **Notes:** ${sprint.notes}`);
  lines.push("");

  // Planned tasks
  lines.push(`## Planned Tasks`);
  for (const t of sprint.tasks) {
    lines.push(`- [x] ${t}`);
  }
  lines.push("");

  // What was built (git changes)
  lines.push(`## Changes`);
  lines.push(gitDiffSummary(root, sprint.started));
  lines.push("");

  // Files created
  const created = gitFilesCreated(root, sprint.started);
  if (created.length > 0) {
    lines.push(`## New Files`);
    for (const f of created) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  // Validation results
  if (sprint.validationOutput) {
    lines.push(`## Validation`);
    lines.push("```");
    lines.push(sprint.validationOutput.trim());
    lines.push("```");
    lines.push("");
  }

  // Security results
  if (sprint.securityOutput) {
    lines.push(`## Security`);
    lines.push("```");
    lines.push(sprint.securityOutput.trim());
    lines.push("```");
    lines.push("");
  }

  // Screenshots reference
  const screenshotDir = lazyPath(root, "docs", "screenshots");
  if (existsSync(screenshotDir)) {
    try {
      const { readdirSync } = require("fs") as typeof import("fs");
      const shots = readdirSync(screenshotDir).filter(f =>
        f.startsWith(`sprint-${num}`) && (f.endsWith(".png") || f.endsWith(".jpg"))
      );
      if (shots.length > 0) {
        lines.push(`## Screenshots`);
        for (const shot of shots) {
          lines.push(`![${shot}](screenshots/${shot})`);
        }
        lines.push("");
      }
    } catch {}
  }

  writeLazyFile(root, lines.join("\n") + "\n", "docs", "sprints", filename);
}

// --- Validation Log ---

export function appendValidationLog(root: string, context: string, output: string): void {
  const entry = [
    `## ${context} — ${timestamp()}`,
    "```",
    output.trim(),
    "```",
    "",
    "",
  ].join("\n");

  // Create header if file doesn't exist
  const existing = readLazyFile(root, "docs", "validation.md");
  if (!existing) {
    writeLazyFile(root, `# Validation Log\n\n_Auto-generated by lazy-fetch_\n\n${entry}`, "docs", "validation.md");
  } else {
    appendLazyFile(root, entry, "docs", "validation.md");
  }
}

// --- Screenshot ---

export async function captureScreenshot(
  root: string,
  url: string,
  name?: string,
  sprintIndex?: number
): Promise<string> {
  const screenshotDir = lazyPath(root, "docs", "screenshots");
  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });

  // Build filename
  const prefix = sprintIndex !== undefined ? `sprint-${String(sprintIndex + 1).padStart(2, "0")}-` : "";
  const safeName = name ? slug(name) : slug(url.replace(/https?:\/\//, "").replace(/[:/]/g, "-"));
  const filename = `${prefix}${safeName}-${Date.now()}.png`;
  const filepath = join(screenshotDir, filename);

  // Try playwright first, then fall back to other tools
  const captureCommands = [
    // Playwright (most reliable)
    `npx playwright screenshot --wait-for-timeout 3000 "${url}" "${filepath}"`,
    // Puppeteer
    `node -e "const p=require('puppeteer');(async()=>{const b=await p.launch({headless:true});const pg=await b.newPage();await pg.goto('${url}',{waitUntil:'networkidle2'});await pg.screenshot({path:'${filepath}',fullPage:true});await b.close()})()"`,
  ];

  for (const cmd of captureCommands) {
    try {
      execSync(cmd, { cwd: root, timeout: 30000, stdio: "pipe" });
      if (existsSync(filepath)) {
        return filepath;
      }
    } catch {
      continue;
    }
  }

  // If no capture tool available, create a placeholder
  writeLazyFile(root, `Screenshot placeholder for: ${url}\nCaptured: ${timestamp()}\n\nInstall playwright for actual screenshots:\n  npx playwright install chromium\n`, "docs", "screenshots", filename.replace(".png", ".txt"));
  return filepath.replace(".png", ".txt");
}

// --- CLI: lazy doc ---

export async function doc(root: string, args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  switch (sub) {
    case "screenshot": {
      const url = rest[0];
      if (!url) {
        console.error("Usage: lazy doc screenshot <url> [name]");
        process.exitCode = 1;
        return;
      }
      const name = rest[1];
      console.log(`  Capturing screenshot of ${url}...`);
      const path = await captureScreenshot(root, url, name);
      console.log(`  Saved: ${path}`);
      break;
    }

    case "plan": {
      // Show plan doc
      const content = readLazyFile(root, "docs", "plan.md");
      if (content) {
        console.log(content);
      } else {
        console.log("No plan documentation yet. Create a plan with 'lazy plan <goal>' first.");
      }
      break;
    }

    case "validation": {
      // Show validation log
      const content = readLazyFile(root, "docs", "validation.md");
      if (content) {
        console.log(content);
      } else {
        console.log("No validation log yet. Run 'lazy check' to generate entries.");
      }
      break;
    }

    default: {
      // Show overview of all docs
      console.log("\n  Documentation");
      console.log("─".repeat(55));

      const planDoc = readLazyFile(root, "docs", "plan.md");
      const valDoc = readLazyFile(root, "docs", "validation.md");

      console.log(`  Plan:       ${planDoc ? "✓ exists" : "- not yet generated"}`);
      console.log(`  Validation: ${valDoc ? "✓ exists" : "- not yet generated"}`);

      // Count sprint docs
      try {
        const { readdirSync } = await import("fs");
        const sprintDir = lazyPath(root, "docs", "sprints");
        if (existsSync(sprintDir)) {
          const sprints = readdirSync(sprintDir).filter(f => f.endsWith(".md"));
          console.log(`  Sprints:    ${sprints.length} archived`);
          for (const s of sprints) {
            console.log(`    - ${s}`);
          }
        } else {
          console.log(`  Sprints:    - none archived yet`);
        }
      } catch {
        console.log(`  Sprints:    - none archived yet`);
      }

      // Count screenshots
      try {
        const { readdirSync } = await import("fs");
        const shotDir = lazyPath(root, "docs", "screenshots");
        if (existsSync(shotDir)) {
          const shots = readdirSync(shotDir).filter(f => f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".txt"));
          console.log(`  Screenshots: ${shots.length} captured`);
        } else {
          console.log(`  Screenshots: - none captured yet`);
        }
      } catch {
        console.log(`  Screenshots: - none captured yet`);
      }

      console.log(`\n  Commands:`);
      console.log(`    lazy doc plan          Show plan document`);
      console.log(`    lazy doc validation    Show validation log`);
      console.log(`    lazy doc screenshot <url> [name]   Capture a screenshot`);
    }
  }
}
