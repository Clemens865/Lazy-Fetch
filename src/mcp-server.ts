#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { plan, status, update, check, add, read, next, remove, resetPlan } from "./process.js";
import { remember, recall, journal, snapshot } from "./persist.js";
import { context, gather, watch, claudemd } from "./context.js";
import { blueprintRun, blueprintList, blueprintShow } from "./blueprint.js";
import { findLazyRoot, ensureLazyDir } from "./store.js";

// Capture console.log output since MCP uses stdio
function captureOutput(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: any[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: any[]) => lines.push(args.map(String).join(" "));

  return fn()
    .then(() => {
      console.log = originalLog;
      console.error = originalError;
      return lines.join("\n");
    })
    .catch((err) => {
      console.log = originalLog;
      console.error = originalError;
      return `Error: ${err.message}`;
    });
}

function getRoot(): string {
  return findLazyRoot(process.cwd()) ?? process.cwd();
}

const server = new McpServer({
  name: "lazy-fetch",
  version: "0.1.0",
});

// --- The Loop ---

server.tool(
  "lazy_read",
  "Get up to date: git status, plan progress, stored memory. Run this at the start of any session.",
  {},
  async () => {
    const output = await captureOutput(() => read(getRoot()));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_plan",
  "Create a phased plan (read/plan/implement/validate/document) for a goal. Splits comma-separated goals into individual tasks.",
  { goal: z.string().describe("The goal to plan for") },
  async ({ goal }) => {
    const output = await captureOutput(() => plan(getRoot(), goal));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_plan_from_file",
  "Create a plan by importing tasks from a markdown file with bullet points.",
  { file: z.string().describe("Path to markdown file with bullet-point tasks") },
  async ({ file }) => {
    const { planFromFile } = await import("./process.js");
    const output = await captureOutput(() => planFromFile(getRoot(), file));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_add",
  "Add a task to the current plan. Phase is auto-inferred from wording or can be specified.",
  {
    task: z.string().describe("Task title"),
    phase: z.enum(["read", "plan", "implement", "validate", "document"]).optional().describe("Phase (auto-inferred if omitted)"),
  },
  async ({ task, phase }) => {
    const output = await captureOutput(() => add(getRoot(), task, phase));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_status",
  "Show current plan progress grouped by phase, with current phase indicator.",
  {},
  async () => {
    const output = await captureOutput(() => status(getRoot()));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_update",
  "Update a task's status. Shows 'next up' suggestion when marking done.",
  {
    task: z.string().describe("Task name or partial match"),
    status: z.enum(["todo", "active", "done", "stuck"]).describe("New status"),
  },
  async ({ task, status: newStatus }) => {
    const output = await captureOutput(() => update(getRoot(), task, newStatus));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_done",
  "Mark a task as done. Shorthand for update <task> done. Supports name, partial match, or task number.",
  {
    task: z.string().describe("Task name, partial match, or number"),
  },
  async ({ task }) => {
    const output = await captureOutput(() => update(getRoot(), task, "done"));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_stuck",
  "Mark a task as stuck. Shorthand for update <task> stuck. Use when blocked.",
  {
    task: z.string().describe("Task name, partial match, or number"),
  },
  async ({ task }) => {
    const output = await captureOutput(() => update(getRoot(), task, "stuck"));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_check",
  "Run health checks: git status, TypeScript, tests, plan progress. Use after making changes to validate.",
  {},
  async () => {
    const output = await captureOutput(() => check(getRoot()));
    return { content: [{ type: "text", text: output }] };
  }
);

// --- Context ---

server.tool(
  "lazy_context",
  "Show repo map with file tree and symbol index. With a query, searches files, content, and symbols.",
  {
    query: z.string().optional().describe("Search query (searches files, content, and symbols)"),
  },
  async ({ query }) => {
    const output = await captureOutput(() => context(getRoot(), query || undefined));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_gather",
  "Find all relevant files and symbols for a task. Pre-hydrates context by searching file names, content, and the symbol index.",
  {
    task: z.string().describe("Task description to gather context for"),
  },
  async ({ task }) => {
    const output = await captureOutput(() => gather(getRoot(), task));
    return { content: [{ type: "text", text: output }] };
  }
);

// --- Persist ---

server.tool(
  "lazy_remember",
  "Store a fact that persists across sessions. Use for decisions, conventions, architecture choices.",
  {
    key: z.string().describe("Short key (e.g. 'auth', 'db', 'api')"),
    value: z.string().describe("The fact to remember"),
  },
  async ({ key, value }) => {
    const output = await captureOutput(() => remember(getRoot(), key, value));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_recall",
  "Retrieve stored knowledge. Without a key, shows everything. With a key, fuzzy-matches.",
  {
    key: z.string().optional().describe("Key to search for (fuzzy match)"),
  },
  async ({ key }) => {
    const output = await captureOutput(() => recall(getRoot(), key || undefined));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_journal",
  "Append to or read the decision journal. Use to log 'why' decisions, not 'what' was done.",
  {
    entry: z.string().optional().describe("Journal entry to append (omit to read the journal)"),
  },
  async ({ entry }) => {
    const output = await captureOutput(() => journal(getRoot(), entry || undefined));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_snapshot",
  "Save current state (plan + memory) as a named snapshot. Useful before big changes.",
  {
    name: z.string().optional().describe("Snapshot name (defaults to today's date)"),
  },
  async ({ name }) => {
    const output = await captureOutput(() => snapshot(getRoot(), name || undefined));
    return { content: [{ type: "text", text: output }] };
  }
);

// --- Blueprints ---

server.tool(
  "lazy_blueprint_list",
  "List all available blueprints — reusable workflows mixing deterministic and agentic steps.",
  {},
  async () => {
    const output = await blueprintList(getRoot());
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_blueprint_show",
  "Show the steps in a blueprint before running it.",
  {
    name: z.string().describe("Blueprint name (e.g. 'fix-bug', 'add-feature', 'experiment')"),
  },
  async ({ name }) => {
    const output = await blueprintShow(getRoot(), name);
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_blueprint_run",
  "Execute a blueprint. Runs deterministic steps automatically, returns prompts for agentic steps. Available: fix-bug, add-feature, review-code, experiment.",
  {
    name: z.string().describe("Blueprint name"),
    input: z.string().describe("Input for the blueprint (e.g. bug description, feature name)"),
  },
  async ({ name, input }) => {
    const output = await blueprintRun(getRoot(), name, input);
    return { content: [{ type: "text", text: output }] };
  }
);

// --- Missing tools ---

server.tool(
  "lazy_next",
  "Advance to the next task in the plan. Marks the current task done and shows the next one.",
  {},
  async () => {
    const output = await captureOutput(() => next(getRoot()));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_remove",
  "Remove a task from the plan by name or partial match.",
  { task: z.string().describe("Task name or partial match to remove") },
  async ({ task }) => {
    const output = await captureOutput(() => remove(getRoot(), task));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_reset_plan",
  "Reset the entire plan, clearing all tasks and progress.",
  {},
  async () => {
    const output = await captureOutput(() => resetPlan(getRoot()));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_watch",
  "Track file access patterns from recent git history. Learns which files are most active.",
  {},
  async () => {
    const output = await captureOutput(() => watch(getRoot()));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_claudemd",
  "Generate a CONTEXT.md file with project overview, symbols, plan, memory, and hot files.",
  {},
  async () => {
    const output = await captureOutput(() => claudemd(getRoot()));
    return { content: [{ type: "text", text: output }] };
  }
);

// --- Evaluate ---

server.tool(
  "lazy_contract",
  "Generate a sprint contract — testable success criteria for a task or sprint. Creates criteria based on tasks, auto-detects API vs UI test types, adds implicit quality criteria. Use before implementing to define 'done'.",
  {
    title: z.string().describe("Title of the task or sprint to create a contract for"),
    tasks: z.array(z.string()).optional().describe("Specific tasks to generate criteria for (uses plan tasks if omitted)"),
  },
  async ({ title, tasks }) => {
    const { generateContract } = await import("./eval.js");
    const taskList = tasks ?? [title];
    const output = await generateContract(getRoot(), title, taskList);
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_eval",
  "Evaluate work against the active sprint contract. Returns a skeptical QA prompt with testing instructions for each criterion. You must actually test (not just read code) and report results via lazy_eval_record.",
  {
    contract: z.string().optional().describe("Contract name to evaluate against (uses most recent if omitted)"),
  },
  async ({ contract }) => {
    const { evaluate } = await import("./eval.js");
    const output = await evaluate(getRoot(), contract);
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_eval_record",
  "Record evaluation results for the active contract. Call this after testing each criterion. Pass an array of {id, pass, notes} objects.",
  {
    results: z.array(z.object({
      id: z.number().describe("Criterion ID"),
      pass: z.boolean().describe("Whether this criterion passed"),
      notes: z.string().optional().describe("What you observed during testing"),
    })).describe("Array of evaluation results for each criterion"),
  },
  async ({ results }) => {
    const { evalRecord } = await import("./eval.js");
    const output = await evalRecord(getRoot(), results);
    return { content: [{ type: "text", text: output }] };
  }
);

// --- Documentation ---

server.tool(
  "lazy_doc",
  "Show documentation overview: plan doc, validation log, sprint archives, screenshots.",
  {},
  async () => {
    const { doc } = await import("./doc.js");
    const output = await captureOutput(() => doc(getRoot(), []));
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_doc_screenshot",
  "Capture a screenshot of a URL using Playwright. Saves to .lazy/docs/screenshots/. Use for frontend validation.",
  {
    url: z.string().describe("URL to screenshot (e.g., http://localhost:3000)"),
    name: z.string().optional().describe("Optional name for the screenshot file"),
  },
  async ({ url, name }) => {
    const { captureScreenshot } = await import("./doc.js");
    const path = await captureScreenshot(getRoot(), url, name);
    return { content: [{ type: "text", text: `Screenshot saved: ${path}` }] };
  }
);

// --- Security ---

server.tool(
  "lazy_secure",
  "Run a security audit on the codebase. Checks for hardcoded secrets, injection vulnerabilities, auth issues, dependency vulnerabilities, and more. Use --gate for a quick critical+high-only check.",
  {
    gate: z.boolean().optional().describe("Gate mode: only check critical + high, skip dependency audit (faster)"),
  },
  async ({ gate }) => {
    const { secure } = await import("./secure.js");
    const output = await captureOutput(() => secure(getRoot(), gate ?? false));
    return { content: [{ type: "text", text: output }] };
  }
);

// --- Yolo Mode ---

server.tool(
  "lazy_yolo_plan",
  "Expand a one-liner idea into a full PRD and start YOLO mode. Use this when the user describes what they want to build in 1-2 sentences instead of providing a PRD file. Returns a planner prompt — follow its instructions to generate the PRD, save it, then call lazy_yolo_start.",
  {
    idea: z.string().describe("The idea in 1-2 sentences (e.g., 'Build a 2D retro game maker with level editor and sprite tools')"),
  },
  async ({ idea }) => {
    const { yoloPlan } = await import("./yolo.js");
    const output = await yoloPlan(getRoot(), idea);
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_yolo_start",
  "Start YOLO mode from a PRD file. Parses the PRD into sprints and begins autonomous execution. Returns a master prompt with the full sprint plan and execution instructions. If you have a one-liner idea instead of a PRD file, use lazy_yolo_plan first.",
  {
    prd_file: z.string().describe("Path to the PRD markdown file (relative to project root)"),
  },
  async ({ prd_file }) => {
    const { yoloStart } = await import("./yolo.js");
    const output = await yoloStart(getRoot(), prd_file);
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_yolo_status",
  "Check YOLO mode progress: current sprint, tasks, validation results, what to do next.",
  {},
  async () => {
    const { yoloStatus } = await import("./yolo.js");
    const output = await yoloStatus(getRoot());
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_yolo_advance",
  "Validate the current sprint (runs typecheck + tests) and advance to the next one. Call this after completing all tasks in the current sprint.",
  {
    notes: z.string().optional().describe("Brief notes about what was accomplished in this sprint"),
  },
  async ({ notes }) => {
    const { yoloAdvance } = await import("./yolo.js");
    const output = await yoloAdvance(getRoot(), notes);
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_yolo_resume",
  "Resume a paused or failed yolo session. Resets the retry budget for the current sprint.",
  {},
  async () => {
    const { yoloResume } = await import("./yolo.js");
    const output = await yoloResume(getRoot());
    return { content: [{ type: "text", text: output }] };
  }
);

server.tool(
  "lazy_yolo_report",
  "Generate a scorecard for the current or completed yolo run: process quality (first-pass rate, retries, failures), build quality (typecheck, tests), per-sprint breakdown with timing.",
  {},
  async () => {
    const { yoloReport } = await import("./yolo.js");
    const output = await yoloReport(getRoot());
    return { content: [{ type: "text", text: output }] };
  }
);

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP server error: ${err.message}\n`);
  process.exit(1);
});
