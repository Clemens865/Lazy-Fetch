import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { readLazyJson, writeLazyJson, readLazyFile } from "./store.js";
import { check } from "./process.js";
import { journal, snapshot } from "./persist.js";

// --- Types ---

type SprintStatus = "pending" | "active" | "done" | "failed";

interface Sprint {
  id: string;
  title: string;
  tasks: string[];
  status: SprintStatus;
  started?: string;
  completed?: string;
  validation?: {
    pass: boolean;
    output: string;
    notes: string;
  };
}

interface YoloPlan {
  prdFile: string;
  prdContent: string;
  goal: string;
  sprints: Sprint[];
  created: string;
  updated: string;
}

interface YoloState {
  plan: YoloPlan;
  currentSprint: number;
  status: "ready" | "running" | "paused" | "completed" | "failed";
  iterations: number;
  maxIterationsPerSprint: number;
  snapshotBefore?: string;
}

const YOLO_FILE = "yolo.json";

// --- State I/O ---

function loadState(root: string): YoloState | null {
  return readLazyJson<YoloState | null>(root, null, YOLO_FILE);
}

function saveState(root: string, state: YoloState): void {
  state.plan.updated = new Date().toISOString();
  writeLazyJson(root, state, YOLO_FILE);
}

// --- PRD Parsing ---

function parsePrdToSprints(prdContent: string): { goal: string; sprints: Sprint[] } {
  const lines = prdContent.split("\n");

  // Extract goal from first heading
  const goalLine = lines.find(l => /^#\s+/.test(l));
  const goal = goalLine?.replace(/^#+\s*/, "").trim() || "Project from PRD";

  // Try to find sprint/phase sections
  const sprintSections: { title: string; tasks: string[] }[] = [];
  let currentSection: { title: string; tasks: string[] } | null = null;

  for (const line of lines) {
    // Match ## headings as sprint boundaries
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentSection) sprintSections.push(currentSection);
      currentSection = { title: headingMatch[1].trim(), tasks: [] };
      continue;
    }

    // Collect bullet points as tasks
    const bulletMatch = line.match(/^[\s]*[-*]\s+(.+)/);
    if (bulletMatch && currentSection) {
      const task = bulletMatch[1].trim();
      // Skip very short items (likely not real tasks)
      if (task.length > 5) {
        currentSection.tasks.push(task);
      }
    }
  }
  if (currentSection) sprintSections.push(currentSection);

  // Filter out sections that are just metadata (no tasks)
  const validSections = sprintSections.filter(s => s.tasks.length > 0);

  let sprints: Sprint[];

  if (validSections.length >= 2) {
    // PRD has structure — use it
    sprints = validSections.map((s, i) => ({
      id: `sprint-${i + 1}`,
      title: s.title,
      tasks: s.tasks,
      status: "pending" as SprintStatus,
    }));
  } else {
    // Unstructured PRD — collect all tasks and divide into 3 sprints
    const allTasks = sprintSections.flatMap(s => s.tasks);

    if (allTasks.length === 0) {
      // No bullet points at all — create generic sprints from prose
      sprints = [
        { id: "sprint-1", title: "Foundation & Setup", tasks: ["Set up project structure, dependencies, and core types based on the PRD"], status: "pending" },
        { id: "sprint-2", title: "Core Implementation", tasks: ["Implement the main features described in the PRD"], status: "pending" },
        { id: "sprint-3", title: "Validation & Polish", tasks: ["Add tests, fix edge cases, validate all features work end-to-end"], status: "pending" },
      ];
    } else {
      // Divide tasks into sprints of roughly equal size
      const chunkSize = Math.max(1, Math.ceil(allTasks.length / 3));
      const names = ["Foundation", "Core Features", "Polish & Validation"];
      sprints = [];
      for (let i = 0; i < 3; i++) {
        const tasks = allTasks.slice(i * chunkSize, (i + 1) * chunkSize);
        if (tasks.length > 0) {
          sprints.push({
            id: `sprint-${i + 1}`,
            title: names[i],
            tasks,
            status: "pending",
          });
        }
      }
    }
  }

  return { goal, sprints };
}

// --- Validation ---

async function runValidation(root: string): Promise<{ pass: boolean; output: string }> {
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: any[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: any[]) => lines.push(args.map(String).join(" "));

  try {
    await check(root);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }

  const output = lines.join("\n");
  // Only fail on real check failures (✗), not warnings or missing tools
  const hasFailures = lines.some(l => l.includes("✗"));
  return { pass: !hasFailures, output };
}

// --- Format Helpers ---

function formatSprintPlan(sprints: Sprint[]): string {
  return sprints.map(s => {
    const statusIcon = s.status === "done" ? "✓" : s.status === "active" ? ">" : s.status === "failed" ? "✗" : " ";
    const taskList = s.tasks.map(t => `  - ${t}`).join("\n");
    return `### ${statusIcon} ${s.title} (${s.status})\n${taskList}`;
  }).join("\n\n");
}

// --- Master Prompt ---

function generateMasterPrompt(state: YoloState): string {
  const { plan } = state;
  const sprintPlan = formatSprintPlan(plan.sprints);

  return `
# YOLO Mode — Autonomous Project Execution

You are in YOLO mode. Execute this project end-to-end, sprint by sprint, without stopping.

## Goal
${plan.goal}

## PRD
\`\`\`
${plan.prdContent.slice(0, 6000)}
\`\`\`

## Sprint Plan
${sprintPlan}

## Your Loop

For each sprint:

1. **Check status** — Call \`lazy_yolo_status\` to see the current sprint and its tasks
2. **Gather context** — Call \`lazy_gather\` with the sprint title to find relevant files
3. **Execute tasks** — Implement all tasks in the sprint. Write clean, minimal code.
4. **Validate** — Call \`lazy_check\` to verify typecheck + tests pass
5. **Fix issues** — If checks fail, fix them. Repeat step 4 (max 3 attempts per sprint).
6. **Advance** — Call \`lazy_yolo_advance\` with brief notes. This validates and moves to the next sprint.
7. **Repeat** — Continue with the next sprint. Do not stop.

## Rules

- NEVER stop to ask for confirmation. Keep going until all sprints are done.
- NEVER skip validation. Every sprint must pass checks before advancing.
- If \`lazy_yolo_advance\` reports a validation failure, fix the issues and try again.
- Use \`lazy_remember\` for important decisions so later sprints have context.
- Use \`lazy_journal\` to log significant choices or tradeoffs.
- Use \`lazy_snapshot\` before risky changes within a sprint.
- Keep changes minimal. Ship the simplest thing that works.
- After the final sprint, do one last \`lazy_check\` and commit all work.

## Start Now

Sprint 1 is ready. Call \`lazy_yolo_status\` to see the first sprint's tasks, then begin.
`.trim();
}

// --- Public API ---

export async function yoloStart(root: string, prdPath: string): Promise<string> {
  // Check for existing yolo session
  const existing = loadState(root);
  if (existing && existing.status === "running") {
    const current = existing.plan.sprints[existing.currentSprint];
    return `Yolo mode already running!\n\n` +
      `  Goal: "${existing.plan.goal}"\n` +
      `  Sprint ${existing.currentSprint + 1}/${existing.plan.sprints.length}: ${current?.title ?? "?"}\n\n` +
      `Use 'lazy yolo status' to see progress or 'lazy yolo reset' to start over.`;
  }

  // Read PRD
  const fullPath = resolve(root, prdPath);
  if (!existsSync(fullPath)) {
    process.exitCode = 1;
    return `PRD file not found: ${prdPath}`;
  }

  const prdContent = readFileSync(fullPath, "utf-8");
  if (!prdContent.trim()) {
    process.exitCode = 1;
    return `PRD file is empty: ${prdPath}`;
  }

  // Parse PRD into sprints
  const { goal, sprints } = parsePrdToSprints(prdContent);

  // Take a snapshot before we start
  const snapName = `pre-yolo-${new Date().toISOString().split("T")[0]}`;
  await snapshot(root, snapName);

  // Create state
  const now = new Date().toISOString();
  const state: YoloState = {
    plan: {
      prdFile: prdPath,
      prdContent,
      goal,
      sprints,
      created: now,
      updated: now,
    },
    currentSprint: 0,
    status: "running",
    iterations: 0,
    maxIterationsPerSprint: 3,
    snapshotBefore: snapName,
  };

  // Mark first sprint as active
  state.plan.sprints[0].status = "active";
  state.plan.sprints[0].started = now;

  saveState(root, state);

  // Journal the start
  await journal(root, `YOLO mode started: "${goal}" — ${sprints.length} sprint(s) from ${prdPath}`);

  return generateMasterPrompt(state);
}

export async function yoloStatus(root: string): Promise<string> {
  const state = loadState(root);
  if (!state) {
    return "No active yolo session. Run 'lazy yolo <prd-file>' to start.";
  }

  const { plan, currentSprint, status } = state;
  const total = plan.sprints.length;
  const done = plan.sprints.filter(s => s.status === "done").length;
  const current = plan.sprints[currentSprint];

  const lines: string[] = [];
  lines.push(`\n  YOLO Mode — ${status.toUpperCase()}`);
  lines.push("─".repeat(55));
  lines.push(`  Goal: ${plan.goal}`);
  lines.push(`  Progress: ${done}/${total} sprints done`);

  if (current && status === "running") {
    lines.push(`\n  Current: Sprint ${currentSprint + 1} — ${current.title}`);
    lines.push(`  Tasks:`);
    for (const t of current.tasks) {
      lines.push(`    - ${t}`);
    }
    if (current.validation) {
      lines.push(`\n  Last validation: ${current.validation.pass ? "✓ PASSED" : "✗ FAILED"}`);
    }
  }

  if (status === "completed") {
    lines.push(`\n  All sprints completed!`);
  }

  // Show all sprints overview
  lines.push(`\n  Sprint Overview:`);
  for (let i = 0; i < plan.sprints.length; i++) {
    const s = plan.sprints[i];
    const icon = s.status === "done" ? "✓" : s.status === "active" ? ">" : s.status === "failed" ? "✗" : " ";
    const marker = i === currentSprint && status === "running" ? " ◄" : "";
    lines.push(`    ${icon} Sprint ${i + 1}: ${s.title} (${s.status})${marker}`);
  }

  return lines.join("\n");
}

export async function yoloAdvance(root: string, notes?: string): Promise<string> {
  const state = loadState(root);
  if (!state) {
    return "No active yolo session.";
  }

  if (state.status !== "running") {
    return `Yolo mode is ${state.status}. Cannot advance.`;
  }

  const current = state.plan.sprints[state.currentSprint];
  if (!current) {
    return "No current sprint to advance.";
  }

  // Run validation
  const validation = await runValidation(root);

  current.validation = {
    pass: validation.pass,
    output: validation.output.slice(0, 2000),
    notes: notes ?? "",
  };

  state.iterations++;

  if (!validation.pass) {
    // Validation failed — check retry budget
    const sprintIterations = state.iterations;
    if (sprintIterations > state.maxIterationsPerSprint) {
      current.status = "failed";
      state.status = "paused";
      saveState(root, state);
      await journal(root, `YOLO sprint "${current.title}" failed after ${sprintIterations} attempts`);
      return `Sprint "${current.title}" failed validation after ${sprintIterations} attempts.\n\n` +
        `Validation output:\n${validation.output}\n\n` +
        `Yolo mode paused. Fix the issues manually, then run 'lazy yolo resume' or 'lazy yolo reset'.`;
    }

    saveState(root, state);
    return `Sprint "${current.title}" failed validation (attempt ${state.iterations}/${state.maxIterationsPerSprint}).\n\n` +
      `Validation output:\n${validation.output}\n\n` +
      `Fix the issues and call lazy_yolo_advance again.`;
  }

  // Validation passed — advance
  const now = new Date().toISOString();
  current.status = "done";
  current.completed = now;

  await journal(root, `YOLO sprint "${current.title}" completed. ${notes ?? ""}`);

  // Check if all done
  const nextIdx = state.currentSprint + 1;
  if (nextIdx >= state.plan.sprints.length) {
    state.status = "completed";
    saveState(root, state);
    await snapshot(root, "post-yolo");
    await journal(root, `YOLO mode completed! All ${state.plan.sprints.length} sprints done.`);

    const done = state.plan.sprints.filter(s => s.status === "done").length;
    return `\n  YOLO MODE COMPLETE!\n` +
      `─${"─".repeat(54)}\n` +
      `  Goal: ${state.plan.goal}\n` +
      `  Sprints: ${done}/${state.plan.sprints.length} done\n\n` +
      `  All sprints completed. Do a final 'lazy check' and commit your work.`;
  }

  // Advance to next sprint
  state.currentSprint = nextIdx;
  state.iterations = 0;
  const next = state.plan.sprints[nextIdx];
  next.status = "active";
  next.started = now;

  saveState(root, state);

  return `Sprint "${current.title}" completed!\n\n` +
    `  Next: Sprint ${nextIdx + 1} — ${next.title}\n` +
    `  Tasks:\n${next.tasks.map(t => `    - ${t}`).join("\n")}\n\n` +
    `  Gather context with lazy_gather and start implementing.`;
}

export async function yoloReset(root: string): Promise<void> {
  const state = loadState(root);
  if (!state) {
    console.log("No active yolo session.");
    return;
  }

  const { writeFileSync } = await import("fs");
  const { lazyPath } = await import("./store.js");
  writeFileSync(lazyPath(root, YOLO_FILE), "null\n", "utf-8");
  console.log(`Yolo session cleared. Goal was: "${state.plan.goal}"`);
  await journal(root, `YOLO mode reset. Previous goal: "${state.plan.goal}"`);
}
