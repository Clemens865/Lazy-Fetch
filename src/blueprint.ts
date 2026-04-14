import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, relative } from "path";
import { parse as parseYaml } from "yaml";
import { randomBytes } from "crypto";
import { ensureLazyDir, readLazyJson, writeLazyJson, writeLazyFile } from "./store.js";
import { createWorktree, destroyWorktree, WorktreeHandle } from "./worktree.js";

// --- Types ---

interface BlueprintStep {
  name: string;
  type: "run" | "prompt" | "gate" | "gather" | "remember" | "loop";
  // run / loop / gate: shell command
  command?: string;
  // prompt: instruction for Claude Code
  prompt?: string;
  // gate: condition check
  gate?: {
    on_fail: "retry" | "stop" | "skip";
    max_retries?: number;
  };
  // loop: re-run command until completion signal or cap
  loop?: {
    until?: string;
    until_bash?: string;
    max_iterations: number;
  };
  // gather: task description for context
  task?: string;
  // remember: key-value
  key?: string;
  value?: string;
}

interface Blueprint {
  name: string;
  description: string;
  input?: string; // description of expected input
  isolation?: "worktree" | "none";
  steps: BlueprintStep[];
}

interface BlueprintRun {
  blueprint: string;
  input: string;
  started: string;
  currentStep: number;
  status: "running" | "completed" | "failed" | "waiting";
  stepResults: StepResult[];
  // Persisted so cleanup can run even after the worktree dir disappears.
  worktree?: {
    path: string;
    branch: string;
    canonicalRepoPath: string;
    baseBranch: string;
  };
}

interface StepResult {
  name: string;
  type: string;
  status: "done" | "failed" | "skipped" | "waiting";
  output?: string;
  retries?: number;
}

// --- YAML parsing with validation ---

function parseBlueprint(content: string): Blueprint {
  let raw: any;
  try {
    raw = parseYaml(content);
  } catch (err: any) {
    throw new Error(`Invalid YAML: ${err.message}`);
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("Blueprint must be a YAML object");
  }
  if (!raw.name || typeof raw.name !== "string") {
    throw new Error("Blueprint missing 'name' (string)");
  }
  if (!raw.description || typeof raw.description !== "string") {
    throw new Error("Blueprint missing 'description' (string)");
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new Error("Blueprint must have a non-empty 'steps' array");
  }

  const validTypes = new Set(["run", "prompt", "gate", "gather", "remember", "loop"]);
  const steps: BlueprintStep[] = [];

  for (let i = 0; i < raw.steps.length; i++) {
    const s = raw.steps[i];
    if (!s.name) throw new Error(`Step ${i + 1} missing 'name'`);
    if (!s.type || !validTypes.has(s.type)) {
      throw new Error(`Step "${s.name}" has invalid type "${s.type}". Valid: ${[...validTypes].join(", ")}`);
    }

    const step: BlueprintStep = {
      name: String(s.name),
      type: s.type,
    };

    if (s.command != null) step.command = String(s.command);
    if (s.prompt != null) step.prompt = String(s.prompt);
    if (s.task != null) step.task = String(s.task);
    if (s.key != null) step.key = String(s.key);
    if (s.value != null) step.value = String(s.value);

    if (s.gate && typeof s.gate === "object") {
      step.gate = {
        on_fail: s.gate.on_fail ?? "stop",
        max_retries: s.gate.max_retries != null ? Number(s.gate.max_retries) : undefined,
      };
    }

    if (s.loop != null) {
      if (typeof s.loop !== "object") {
        throw new Error(`Step "${s.name}": 'loop' must be an object`);
      }
      const max = Number(s.loop.max_iterations);
      if (!Number.isInteger(max) || max < 1) {
        throw new Error(`Step "${s.name}": loop.max_iterations must be a positive integer`);
      }
      const until = s.loop.until != null ? String(s.loop.until) : undefined;
      const untilBash = s.loop.until_bash != null ? String(s.loop.until_bash) : undefined;
      if (!until && !untilBash) {
        throw new Error(`Step "${s.name}": loop requires at least one of 'until' or 'until_bash'`);
      }
      step.loop = { until, until_bash: untilBash, max_iterations: max };
    }

    if (step.type === "loop") {
      if (!step.command) {
        throw new Error(`Step "${s.name}": loop step requires a 'command'`);
      }
      if (!step.loop) {
        throw new Error(`Step "${s.name}": loop step requires a 'loop' config`);
      }
      // Archon parity: nested retry on a loop is incoherent — the loop is the retry.
      if (step.gate?.on_fail === "retry" || step.gate?.max_retries != null) {
        throw new Error(`Step "${s.name}": loop steps cannot use gate.retry / gate.max_retries`);
      }
    }

    steps.push(step);
  }

  let isolation: Blueprint["isolation"];
  if (raw.isolation != null) {
    if (raw.isolation !== "worktree" && raw.isolation !== "none") {
      throw new Error(`Blueprint 'isolation' must be 'worktree' or 'none' (got ${JSON.stringify(raw.isolation)})`);
    }
    isolation = raw.isolation;
  }

  return {
    name: raw.name,
    description: raw.description,
    input: raw.input ? String(raw.input) : undefined,
    isolation,
    steps,
  };
}

// --- Template substitution ---

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] ?? `\${${key}}`);
}

// --- Runner ---

function loadBlueprintFile(root: string, nameOrPath: string): Blueprint {
  // Try exact path, then blueprints/, then .lazy/blueprints/
  const candidates = [
    nameOrPath,
    join(root, "blueprints", nameOrPath),
    join(root, "blueprints", `${nameOrPath}.yaml`),
    join(root, ".lazy", "blueprints", nameOrPath),
    join(root, ".lazy", "blueprints", `${nameOrPath}.yaml`),
    join(root, "blueprints", `${nameOrPath}.yml`),
    join(root, ".lazy", "blueprints", `${nameOrPath}.yml`),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      return parseBlueprint(readFileSync(p, "utf-8"));
    }
  }

  throw new Error(`Blueprint not found: ${nameOrPath}\nSearched: ${candidates.join(", ")}`);
}

export interface BlueprintRunOptions {
  isolate?: boolean;
}

export async function blueprintRun(
  root: string,
  nameOrPath: string,
  input: string,
  opts: BlueprintRunOptions = {}
): Promise<string> {
  const bp = loadBlueprintFile(root, nameOrPath);
  const vars: Record<string, string> = { input, name: bp.name };

  ensureLazyDir(root);

  const run: BlueprintRun = {
    blueprint: bp.name,
    input,
    started: new Date().toISOString(),
    currentStep: 0,
    status: "running",
    stepResults: [],
  };

  const output: string[] = [];
  output.push(`\n  Blueprint: ${bp.name}`);
  output.push(`  ${bp.description}`);
  output.push(`  Input: "${input}"`);

  // Decide isolation. Explicit --isolate forces on; front-matter forces on; default off.
  // Note: `??` would mishandle CLI passing `isolate: false`, so use explicit OR.
  const isolate = opts.isolate === true || bp.isolation === "worktree";
  let workRoot = root;
  let worktreeHandle: WorktreeHandle | undefined;
  if (isolate) {
    // Timestamp + random suffix: timestamp is human-readable, suffix prevents
    // collisions when two processes start in the same millisecond.
    const tsSlug = run.started.replace(/[:.]/g, "-").replace(/Z$/, "");
    const runId = `${tsSlug}-${randomBytes(3).toString("hex")}`;
    try {
      worktreeHandle = createWorktree(root, bp.name, runId);
      workRoot = worktreeHandle.path;
      run.worktree = {
        path: worktreeHandle.path,
        branch: worktreeHandle.branch,
        canonicalRepoPath: worktreeHandle.canonicalRepoPath,
        baseBranch: worktreeHandle.baseBranch,
      };
      vars.worktree_path = worktreeHandle.path;
      vars.worktree_branch = worktreeHandle.branch;
      output.push(`  Isolation: worktree`);
      output.push(`    path:   ${worktreeHandle.path}`);
      output.push(`    branch: ${worktreeHandle.branch} (from ${worktreeHandle.baseBranch})`);
      if (worktreeHandle.adopted) output.push(`    (adopted existing worktree)`);
      // Persist the run record up-front so cleanup info exists even on hard crash.
      saveBlueprintRun(root, run);
    } catch (err: any) {
      output.push("─".repeat(55));
      output.push(`  ✗ Failed to create worktree: ${err.message}`);
      run.status = "failed";
      saveBlueprintRun(root, run);
      return output.join("\n");
    }
  }
  output.push("─".repeat(55));

  // The main step loop runs inside try/finally so cleanup fires on any exit path.
  let finalOutput: string | undefined;
  try {
  stepLoop: for (let i = 0; i < bp.steps.length; i++) {
    const step = bp.steps[i];
    run.currentStep = i;

    output.push(`\n  Step ${i + 1}/${bp.steps.length}: ${step.name} (${step.type})`);

    const result: StepResult = { name: step.name, type: step.type, status: "done" };

    switch (step.type) {
      case "run": {
        const cmd = substitute(step.command ?? "", vars);
        output.push(`  $ ${cmd}`);
        const maxRetries = step.gate?.max_retries ?? 0;
        let retries = 0;
        let success = false;

        while (retries <= maxRetries) {
          try {
            const cmdOutput = execSync(cmd, {
              cwd: workRoot,
              encoding: "utf-8",
              timeout: 120000,
              stdio: ["pipe", "pipe", "pipe"],
            });
            const trimmed = cmdOutput.trim();
            if (trimmed) {
              output.push(`  ${trimmed.split("\n").slice(0, 10).join("\n  ")}`);
              vars[`step_${i}_output`] = trimmed;
            }
            output.push(`  ✓ ${step.name}: passed`);
            success = true;
            break;
          } catch (err: any) {
            retries++;
            const errOutput = (err.stdout || err.stderr || err.message).trim();
            vars[`step_${i}_error`] = errOutput;

            if (retries <= maxRetries) {
              output.push(`  ✗ Failed (attempt ${retries}/${maxRetries + 1}), retrying...`);
              result.retries = retries;
            } else if (step.gate?.on_fail === "skip") {
              output.push(`  ⚠ ${step.name}: failed, skipping`);
              result.status = "skipped";
              success = true; // continue execution
            } else if (step.gate?.on_fail === "stop") {
              output.push(`  ✗ ${step.name}: failed, stopping blueprint`);
              result.status = "failed";
              result.output = errOutput;
              run.stepResults.push(result);
              run.status = "failed";
              saveBlueprintRun(root, run);
              output.push(`\n  Blueprint FAILED at step: ${step.name}`);
              finalOutput = output.join("\n");
              break stepLoop;
            } else {
              // retry exhausted
              output.push(`  ✗ ${step.name}: failed after ${retries} retries`);
              result.status = "failed";
              result.output = errOutput;
              run.stepResults.push(result);
              run.status = "failed";
              saveBlueprintRun(root, run);
              output.push(`\n  Blueprint FAILED at step: ${step.name}`);
              finalOutput = output.join("\n");
              break stepLoop;
            }
          }
        }

        if (!success) {
          result.status = "failed";
        }
        break;
      }

      case "prompt": {
        // Agentic step — return the prompt for Claude Code to act on.
        // When isolated, prepend a worktree hint so Claude Code edits the right tree.
        let prompt = substitute(step.prompt ?? "", vars);
        if (worktreeHandle) {
          prompt = `[work inside the isolated worktree at ${worktreeHandle.path} (branch ${worktreeHandle.branch})]\n\n${prompt}`;
        }
        output.push(`  → ${prompt}`);
        result.status = "waiting";
        result.output = prompt;
        vars[`step_${i}_prompt`] = prompt;
        break;
      }

      case "gather": {
        const task = substitute(step.task ?? input, vars);
        output.push(`  Gathering context for: "${task}"`);
        // Import dynamically to avoid circular deps
        const { gather } = await import("./context.js");
        const lines: string[] = [];
        const origLog = console.log;
        console.log = (...args: any[]) => lines.push(args.map(String).join(" "));
        await gather(root, task);
        console.log = origLog;
        const gatherOutput = lines.join("\n");
        output.push(`  ${lines.slice(0, 10).join("\n  ")}`);
        vars[`step_${i}_output`] = gatherOutput;
        break;
      }

      case "remember": {
        const key = substitute(step.key ?? "", vars);
        const value = substitute(step.value ?? "", vars);
        if (key && value) {
          const { remember } = await import("./persist.js");
          await remember(root, key, value);
          output.push(`  Stored: ${key} → ${value}`);
        }
        break;
      }

      case "loop": {
        const loop = step.loop!;
        const maxIter = loop.max_iterations;
        let completed = false;
        let lastOutput = "";
        let iter = 0;

        for (iter = 1; iter <= maxIter; iter++) {
          vars.loop_iteration = String(iter);
          vars.loop_last_output = lastOutput;

          const cmd = substitute(step.command ?? "", vars);
          output.push(`  [iter ${iter}/${maxIter}] $ ${cmd}`);

          let cmdOutput = "";
          try {
            cmdOutput = execSync(cmd, {
              cwd: workRoot,
              encoding: "utf-8",
              timeout: 120000,
              stdio: ["pipe", "pipe", "pipe"],
            }).trim();
          } catch (err: any) {
            cmdOutput = ((err.stdout || "") + (err.stderr || "")).trim() || (err.message || "").trim();
          }
          lastOutput = cmdOutput;
          if (cmdOutput) {
            output.push(`  ${cmdOutput.split("\n").slice(0, 5).join("\n  ")}`);
          }

          // OR-ed completion: substring signal in command output, or until_bash exit 0.
          let signalDone = false;
          if (loop.until && cmdOutput.includes(substitute(loop.until, vars))) {
            signalDone = true;
          }
          let bashDone = false;
          if (loop.until_bash) {
            const checkCmd = substitute(loop.until_bash, vars);
            try {
              execSync(checkCmd, {
                cwd: workRoot,
                encoding: "utf-8",
                timeout: 60000,
                stdio: ["pipe", "pipe", "pipe"],
              });
              bashDone = true;
            } catch {
              bashDone = false;
            }
          }

          if (signalDone || bashDone) {
            completed = true;
            output.push(`  ✓ ${step.name}: completed at iter ${iter}${signalDone ? " (signal)" : ""}${bashDone ? " (bash)" : ""}`);
            break;
          }
        }

        result.retries = iter - 1;
        vars[`step_${i}_output`] = lastOutput;

        if (!completed) {
          const action = step.gate?.on_fail ?? "stop";
          if (action === "skip") {
            output.push(`  ⚠ ${step.name}: cap reached (${maxIter}), skipping`);
            result.status = "skipped";
          } else {
            output.push(`  ✗ ${step.name}: cap reached (${maxIter}), stopping`);
            result.status = "failed";
            result.output = lastOutput;
            run.stepResults.push(result);
            run.status = "failed";
            saveBlueprintRun(root, run);
            output.push(`\n  Blueprint FAILED at step: ${step.name}`);
            finalOutput = output.join("\n");
            break stepLoop;
          }
        }
        break;
      }

      case "gate": {
        const cmd = substitute(step.command ?? "true", vars);
        output.push(`  Checking: ${cmd}`);
        try {
          execSync(cmd, { cwd: workRoot, encoding: "utf-8", timeout: 60000 });
          output.push(`  ✓ Gate passed`);
        } catch {
          const action = step.gate?.on_fail ?? "stop";
          if (action === "skip") {
            output.push(`  ⚠ Gate failed, skipping`);
            result.status = "skipped";
          } else {
            output.push(`  ✗ Gate failed, stopping`);
            result.status = "failed";
            run.stepResults.push(result);
            run.status = "failed";
            saveBlueprintRun(root, run);
            finalOutput = output.join("\n");
            break stepLoop;
          }
        }
        break;
      }
    }

    run.stepResults.push(result);
  }

  if (finalOutput === undefined) {
    run.status = "completed";
    saveBlueprintRun(root, run);
    output.push("\n" + "─".repeat(55));
    output.push(`  Blueprint "${bp.name}" completed.`);

    // Collect all prompt steps for Claude Code to act on
    const prompts = run.stepResults.filter((r) => r.status === "waiting" && r.output);
    if (prompts.length > 0) {
      output.push("\n  Agentic steps for Claude Code:");
      for (const p of prompts) {
        output.push(`    → ${p.output}`);
      }
    }
    finalOutput = output.join("\n");
  }
  } finally {
    if (worktreeHandle) {
      // Default: keep the branch (it carries the work). Force removal so any
      // dirty worktree from a failed run is still torn down.
      const cleanup = destroyWorktree(worktreeHandle, { deleteBranch: false, force: true });
      const cleanupLines: string[] = [];
      cleanupLines.push("\n" + "─".repeat(55));
      cleanupLines.push(`  Worktree cleanup:`);
      cleanupLines.push(`    removed:   ${cleanup.worktreeRemoved}`);
      cleanupLines.push(`    dir clean: ${cleanup.directoryClean}`);
      cleanupLines.push(`    branch kept: ${worktreeHandle.branch}`);
      if (cleanup.warnings.length) {
        for (const w of cleanup.warnings) cleanupLines.push(`    ⚠ ${w}`);
      }
      finalOutput = (finalOutput ?? output.join("\n")) + "\n" + cleanupLines.join("\n");
    }
  }
  return finalOutput!;
}

function saveBlueprintRun(root: string, run: BlueprintRun): void {
  const timestamp = run.started.replace(/[:.]/g, "-").slice(0, 19);
  writeLazyJson(root, run, "runs", `${run.blueprint}-${timestamp}.json`);
}

// --- List available blueprints ---

export async function blueprintList(root: string): Promise<string> {
  const dirs = [
    join(root, "blueprints"),
  ];

  const output: string[] = ["\n  Available blueprints:", "─".repeat(55)];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const file of files) {
      try {
        const bp = parseBlueprint(readFileSync(join(dir, file), "utf-8"));
        const stepTypes = bp.steps.map((s) =>
          s.type === "run" ? "⚙" : s.type === "prompt" ? "🤖" : s.type === "gate" ? "🚦" : s.type === "loop" ? "🔁" : "📎"
        ).join("");
        output.push(`  ${bp.name.padEnd(20)} ${stepTypes}  ${bp.description}`);
      } catch (err: any) {
        output.push(`  ${file.padEnd(20)} (error: ${err.message.slice(0, 50)})`);
      }
    }
  }

  if (output.length === 2) {
    output.push("  No blueprints found in blueprints/");
    output.push("  Create .yaml files there to define workflows.");
  }

  output.push("");
  output.push("  Legend: ⚙ = run  🤖 = prompt  🚦 = gate  🔁 = loop  📎 = other");

  return output.join("\n");
}

// --- Show blueprint details ---

export async function blueprintShow(root: string, nameOrPath: string): Promise<string> {
  const bp = loadBlueprintFile(root, nameOrPath);
  const output: string[] = [];

  output.push(`\n  Blueprint: ${bp.name}`);
  output.push(`  ${bp.description}`);
  if (bp.input) output.push(`  Input: ${bp.input}`);
  output.push("─".repeat(55));

  for (let i = 0; i < bp.steps.length; i++) {
    const s = bp.steps[i];
    const icon = s.type === "run" ? "⚙" : s.type === "prompt" ? "🤖" : s.type === "gate" ? "🚦" : s.type === "loop" ? "🔁" : "📎";
    output.push(`  ${i + 1}. ${icon} ${s.name} (${s.type})`);

    if (s.command) output.push(`     $ ${s.command}`);
    if (s.prompt) output.push(`     → ${s.prompt}`);
    if (s.task) output.push(`     🔍 ${s.task}`);
    if (s.gate) output.push(`     on_fail: ${s.gate.on_fail}${s.gate.max_retries ? `, max_retries: ${s.gate.max_retries}` : ""}`);
    if (s.loop) {
      const conds = [s.loop.until && `until "${s.loop.until}"`, s.loop.until_bash && `until_bash $ ${s.loop.until_bash}`].filter(Boolean).join(" OR ");
      output.push(`     loop: max ${s.loop.max_iterations} — ${conds}`);
    }
  }

  return output.join("\n");
}
