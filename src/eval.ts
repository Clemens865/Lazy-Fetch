import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { readLazyFile, writeLazyFile, readLazyJson, appendLazyFile } from "./store.js";

// --- Types ---

interface Criterion {
  id: number;
  description: string;
  testType: "api" | "ui" | "unit" | "manual";
  status?: "pass" | "fail" | "skip";
  notes?: string;
}

interface Contract {
  title: string;
  created: string;
  criteria: Criterion[];
  threshold: number; // 0-1, default 0.8
}

interface EvalResult {
  contract: Contract;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  grade: number; // 0-1
  pass: boolean;
  details: string;
}

// --- Contract Generation ---

/**
 * Generate a sprint contract — testable success criteria for a set of tasks.
 * Returns a prompt for Claude to fill in, plus a skeleton contract.
 */
export async function generateContract(
  root: string,
  title: string,
  tasks: string[],
  sprintIndex?: number
): Promise<string> {
  const now = new Date().toISOString();
  const num = sprintIndex !== undefined ? String(sprintIndex + 1).padStart(2, "0") : "00";

  // Detect project type for test suggestions
  const mem = readLazyJson<Record<string, { value: string }>>(root, {}, "memory.json");
  const stack = mem["stack"]?.value ?? "";
  const hasUI = /react|next|vue|svelte|angular/i.test(stack);
  const hasAPI = /express|fastapi|hono|trpc|api/i.test(stack) || existsSync(join(root, "src", "app", "api"));

  // Build the contract skeleton
  const criteria: Criterion[] = [];
  let id = 1;

  for (const task of tasks) {
    // Infer test type from task description
    const t = task.toLowerCase();
    let testType: Criterion["testType"] = "manual";
    if (/api|endpoint|route|server|backend|database|query/.test(t)) testType = "api";
    else if (/ui|page|form|button|component|render|display|layout|style|design/.test(t)) testType = "ui";
    else if (/test|validate|check|unit|integration/.test(t)) testType = "unit";

    criteria.push({ id: id++, description: task, testType });
  }

  // Add implicit criteria based on project type
  if (hasUI && criteria.some(c => c.testType === "ui")) {
    criteria.push({
      id: id++,
      description: "All new pages render without console errors",
      testType: "ui",
    });
    criteria.push({
      id: id++,
      description: "UI is responsive and visually consistent with existing design",
      testType: "ui",
    });
  }

  if (hasAPI && criteria.some(c => c.testType === "api")) {
    criteria.push({
      id: id++,
      description: "API endpoints return correct status codes and response shapes",
      testType: "api",
    });
    criteria.push({
      id: id++,
      description: "Error cases return appropriate error responses (400/401/404/500)",
      testType: "api",
    });
  }

  const contract: Contract = {
    title,
    created: now,
    criteria,
    threshold: 0.8,
  };

  // Save contract
  const filename = `sprint-${num}-${slug(title)}.json`;
  writeLazyFile(root, JSON.stringify(contract, null, 2) + "\n", "contracts", filename);

  // Also write a readable markdown version
  const mdLines: string[] = [];
  mdLines.push(`# Sprint Contract: ${title}`);
  mdLines.push(`\n_Created: ${now}_`);
  mdLines.push(`_Threshold: ${Math.round(contract.threshold * 100)}% criteria must pass_\n`);
  mdLines.push(`## Success Criteria\n`);

  for (const c of criteria) {
    const tag = c.testType === "api" ? "[API]" : c.testType === "ui" ? "[UI]" : c.testType === "unit" ? "[TEST]" : "[MANUAL]";
    mdLines.push(`${c.id}. ${tag} ${c.description}`);
  }

  mdLines.push(`\n## How to Verify\n`);

  const apiCriteria = criteria.filter(c => c.testType === "api");
  const uiCriteria = criteria.filter(c => c.testType === "ui");

  if (apiCriteria.length > 0) {
    mdLines.push(`### API Criteria`);
    mdLines.push(`Test each endpoint with curl or fetch. Verify status codes, response shapes, and error handling.\n`);
  }
  if (uiCriteria.length > 0) {
    mdLines.push(`### UI Criteria`);
    mdLines.push(`Use Playwright or browser to navigate to each page. Check rendering, interactions, and console errors.`);
    mdLines.push(`Capture screenshots with \`lazy doc screenshot <url>\` for the record.\n`);
  }

  const mdFilename = `sprint-${num}-${slug(title)}.md`;
  writeLazyFile(root, mdLines.join("\n") + "\n", "contracts", mdFilename);

  // Build the evaluation prompt
  const prompt = buildEvalPrompt(contract, stack);

  // Return summary + prompt
  const lines: string[] = [];
  lines.push(`\n  Sprint Contract: ${title}`);
  lines.push("─".repeat(55));
  lines.push(`  Criteria: ${criteria.length}`);
  lines.push(`  Threshold: ${Math.round(contract.threshold * 100)}%\n`);

  for (const c of criteria) {
    const tag = c.testType === "api" ? "[API]" : c.testType === "ui" ? "[UI]" : c.testType === "unit" ? "[TEST]" : "[MANUAL]";
    lines.push(`  ${c.id}. ${tag} ${c.description}`);
  }

  lines.push(`\n  Contract saved to .lazy/contracts/${mdFilename}`);
  lines.push(`\n  After implementing, run 'lazy eval' to grade against this contract.`);

  return lines.join("\n");
}

// --- Evaluation ---

/**
 * Evaluate the current work against the active contract.
 * Returns a prompt for Claude to execute the evaluation and report results.
 */
export async function evaluate(root: string, contractName?: string): Promise<string> {
  // Find the active contract
  const contract = loadContract(root, contractName);
  if (!contract) {
    return "No active contract found. Run 'lazy contract <title>' to create one, or specify a contract name.";
  }

  // Build eval prompt
  const mem = readLazyJson<Record<string, { value: string }>>(root, {}, "memory.json");
  const stack = mem["stack"]?.value ?? "";
  const prompt = buildEvalPrompt(contract, stack);

  const lines: string[] = [];
  lines.push(`\n  Evaluating: ${contract.title}`);
  lines.push("─".repeat(55));
  lines.push(`  Criteria: ${contract.criteria.length}`);
  lines.push(`  Threshold: ${Math.round(contract.threshold * 100)}%\n`);
  lines.push(`  Follow the evaluation instructions below.\n`);
  lines.push("─".repeat(55));
  lines.push(prompt);

  return lines.join("\n");
}

/**
 * Record evaluation results for a contract.
 */
export async function evalRecord(
  root: string,
  results: { id: number; pass: boolean; notes?: string }[]
): Promise<string> {
  const contract = loadContract(root);
  if (!contract) {
    return "No active contract found.";
  }

  // Apply results (validate IDs exist)
  const validIds = new Set(contract.criteria.map(c => c.id));
  const unknownIds = results.filter(r => !validIds.has(r.id)).map(r => r.id);
  if (unknownIds.length > 0) {
    return `Unknown criterion IDs: ${unknownIds.join(", ")}. Valid IDs: ${[...validIds].join(", ")}`;
  }

  for (const r of results) {
    const criterion = contract.criteria.find(c => c.id === r.id);
    if (criterion) {
      criterion.status = r.pass ? "pass" : "fail";
      criterion.notes = r.notes;
    }
  }

  const passed = contract.criteria.filter(c => c.status === "pass").length;
  const failed = contract.criteria.filter(c => c.status === "fail").length;
  const skipped = contract.criteria.filter(c => c.status === "skip" || !c.status).length;
  const total = contract.criteria.length;
  const grade = total > 0 ? passed / total : 0;
  const overallPass = grade >= contract.threshold;

  // Save updated contract
  const filename = findContractFile(root);
  if (filename) {
    writeLazyFile(root, JSON.stringify(contract, null, 2) + "\n", "contracts", filename);
  }

  // Log to validation doc
  try {
    const { appendValidationLog } = await import("./doc.js");
    const summary = contract.criteria.map(c => {
      const icon = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "?";
      return `${icon} ${c.id}. ${c.description}${c.notes ? ` — ${c.notes}` : ""}`;
    }).join("\n");
    appendValidationLog(root, `Contract Eval: ${contract.title}`, summary);
  } catch {}

  // Build result output
  const lines: string[] = [];
  lines.push(`\n  Evaluation Results: ${contract.title}`);
  lines.push("─".repeat(55));

  for (const c of contract.criteria) {
    const icon = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "?";
    lines.push(`  ${icon} ${c.id}. ${c.description}`);
    if (c.notes) lines.push(`     ${c.notes}`);
  }

  lines.push("\n" + "─".repeat(55));
  lines.push(`  Grade: ${passed}/${total} (${Math.round(grade * 100)}%) — threshold ${Math.round(contract.threshold * 100)}%`);
  lines.push(`  Result: ${overallPass ? "PASS" : "FAIL"}`);

  if (!overallPass) {
    const failures = contract.criteria.filter(c => c.status === "fail");
    lines.push(`\n  Fix these ${failures.length} issue(s) and run 'lazy eval' again:`);
    for (const f of failures) {
      lines.push(`    ${f.id}. ${f.description}${f.notes ? ` — ${f.notes}` : ""}`);
    }
  }

  return lines.join("\n");
}

/**
 * Quick gate check for yolo — returns pass/fail based on contract evaluation results.
 */
export async function evalGate(root: string): Promise<{ pass: boolean; output: string; grade: number }> {
  const contract = loadContract(root);
  if (!contract) {
    // No contract = pass (contracts are optional)
    return { pass: true, output: "No contract — skipping evaluation gate", grade: 1 };
  }

  // Check if all criteria have been evaluated
  const evaluated = contract.criteria.filter(c => c.status === "pass" || c.status === "fail");
  if (evaluated.length === 0) {
    // Contract exists but not evaluated — block advancement
    return { pass: false, output: `Contract "${contract.title}" has ${contract.criteria.length} criteria but none evaluated yet. Run lazy_eval first.`, grade: 0 };
  }

  const passed = contract.criteria.filter(c => c.status === "pass").length;
  const total = contract.criteria.length;
  const grade = total > 0 ? passed / total : 0;
  const overallPass = grade >= contract.threshold;

  const summary = `Contract: ${passed}/${total} criteria (${Math.round(grade * 100)}%), threshold ${Math.round(contract.threshold * 100)}%`;

  return { pass: overallPass, output: summary, grade };
}

// --- Helpers ---

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

function loadContract(root: string, name?: string): Contract | null {
  const filename = name ? `${name}.json` : findContractFile(root);
  if (!filename) return null;
  const raw = readLazyFile(root, "contracts", filename);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function findContractFile(root: string): string | null {
  try {
    const contractDir = join(root, ".lazy", "contracts");
    if (!existsSync(contractDir)) return null;
    const files = readdirSync(contractDir)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse(); // Most recent first
    return files[0] ?? null;
  } catch {
    return null;
  }
}

function buildEvalPrompt(contract: Contract, stack: string): string {
  const hasUI = contract.criteria.some(c => c.testType === "ui");
  const hasAPI = contract.criteria.some(c => c.testType === "api");

  const lines: string[] = [];
  lines.push(`# Evaluation Instructions`);
  lines.push(``);
  lines.push(`You are a **skeptical QA tester**. Your job is to verify each criterion below by actually testing the implementation — not by reading code.`);
  lines.push(``);
  lines.push(`**Rules:**`);
  lines.push(`- Do NOT assume something works because the code looks correct`);
  lines.push(`- Actually run, click, call, or test each criterion`);
  lines.push(`- Be specific about what failed and why`);
  lines.push(`- A criterion only passes if it demonstrably works end-to-end`);
  lines.push(`- When in doubt, mark as FAIL with notes explaining what you observed`);
  lines.push(``);

  if (hasAPI) {
    lines.push(`## API Testing`);
    lines.push(`For each API criterion: make actual HTTP requests (curl, fetch, or test framework). Verify status codes, response bodies, and error cases.`);
    lines.push(``);
  }

  if (hasUI) {
    lines.push(`## UI Testing`);
    lines.push(`For each UI criterion: navigate to the page in a browser or use Playwright. Check that elements render, interactions work, and there are no console errors.`);
    lines.push(`Capture screenshots with \`lazy_doc_screenshot\` for evidence.`);
    lines.push(``);
  }

  lines.push(`## Criteria to Evaluate\n`);

  for (const c of contract.criteria) {
    const tag = c.testType === "api" ? "[API]" : c.testType === "ui" ? "[UI]" : c.testType === "unit" ? "[TEST]" : "[MANUAL]";
    lines.push(`### ${c.id}. ${tag} ${c.description}`);

    if (c.testType === "api") {
      lines.push(`→ Make the actual HTTP request. Check status code and response shape.`);
    } else if (c.testType === "ui") {
      lines.push(`→ Navigate to the page. Verify the element renders and interaction works.`);
    } else if (c.testType === "unit") {
      lines.push(`→ Run the relevant test suite. Verify it passes.`);
    } else {
      lines.push(`→ Verify manually by inspecting the implementation.`);
    }
    lines.push(``);
  }

  lines.push(`## Reporting Results`);
  lines.push(``);
  lines.push(`After testing all criteria, call \`lazy_eval_record\` with an array of results:`);
  lines.push(`\`\`\``);
  lines.push(`[`);
  for (const c of contract.criteria) {
    lines.push(`  { "id": ${c.id}, "pass": true/false, "notes": "what you observed" },`);
  }
  lines.push(`]`);
  lines.push(`\`\`\``);
  lines.push(``);
  lines.push(`Be honest. A failing grade with specific feedback is more valuable than a false pass.`);

  return lines.join("\n");
}

// --- CLI command ---

export async function contractCmd(root: string, args: string[]): Promise<void> {
  const title = args.join(" ");
  if (!title.trim()) {
    // Show existing contracts
    try {
      const contractDir = join(root, ".lazy", "contracts");
      if (!existsSync(contractDir)) {
        console.log("No contracts yet. Run 'lazy contract <title>' to create one.");
        return;
      }
      const files = readdirSync(contractDir).filter(f => f.endsWith(".md")).sort();
      if (files.length === 0) {
        console.log("No contracts yet. Run 'lazy contract <title>' to create one.");
        return;
      }
      console.log("\n  Contracts:");
      console.log("─".repeat(55));
      for (const f of files) {
        console.log(`  ${f}`);
      }
    } catch {
      console.log("No contracts yet.");
    }
    return;
  }

  // Check if there are tasks from the current plan to use
  const plan = readLazyJson<{ tasks: { title: string; status: string }[] } | null>(root, null, "plan.json");
  const tasks = plan?.tasks
    .filter(t => t.status === "todo" || t.status === "active")
    .map(t => t.title) ?? [title];

  console.log(await generateContract(root, title, tasks));
}

export async function evalCmd(root: string, args: string[]): Promise<void> {
  const contractName = args[0] || undefined;
  console.log(await evaluate(root, contractName));
}
