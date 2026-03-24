#!/usr/bin/env node

import { plan, status, update, check, add, read, resetPlan } from "./process.js";
import { remember, recall, journal, snapshot } from "./persist.js";
import { context, gather, watch, claudemd } from "./context.js";
import { blueprintRun, blueprintList, blueprintShow } from "./blueprint.js";
import { findLazyRoot, ensureLazyDir } from "./store.js";

const HELP = `
lazy — CLI companion for Claude Code
       minimum effort, maximum result.

  The Loop (read → plan → implement → validate → document):
    lazy read                  Get up to date — git, plan, memory
    lazy plan <goal>           Break a goal into phased steps
    lazy add <task> [phase]    Add a task to the current plan
    lazy status                Where are we? What's next?
    lazy update <task> <status>  Mark progress (todo|active|done|stuck)
    lazy check                 Validate — tests, lint, types, plan progress

  Context:
    lazy context               Repo map with symbol index
    lazy context <query>       Find files, content, and symbols
    lazy gather <task>         Pre-hydrate context for a Claude Code session
    lazy watch                 Learn which files matter from git history
    lazy claudemd              Generate context file for Claude Code

  Blueprints:
    lazy bp list               Show available blueprints
    lazy bp show <name>        Show blueprint steps
    lazy bp run <name> <input> Execute a blueprint

  Persist:
    lazy remember <key> <val>  Store a fact across sessions
    lazy recall [key]          Retrieve stored knowledge
    lazy journal [entry]       Append to / read decision log
    lazy snapshot [name]       Save current project state

  Other:
    lazy init                  Initialize .lazy/ in current project
    lazy help                  Show this help
`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP.trim());
    return;
  }

  if (cmd === "init") {
    const dir = ensureLazyDir(process.cwd());
    console.log(`Initialized .lazy/ at ${dir}`);
    return;
  }

  const root = findLazyRoot(process.cwd()) ?? process.cwd();

  switch (cmd) {
    // The Loop
    case "read":
      await read(root);
      break;
    case "plan":
      if (args[0] === "--reset") { await resetPlan(root); break; }
      await plan(root, args.join(" "));
      break;
    case "add":
      await add(root, args.slice(0, -1).join(" ") || args[0], args.length > 1 ? args[args.length - 1] : undefined);
      break;
    case "status":
      await status(root);
      break;
    case "update":
      await update(root, args[0], args[1]);
      break;
    case "check":
      await check(root);
      break;

    // Context
    case "context":
      await context(root, args.join(" ") || undefined);
      break;
    case "gather":
      await gather(root, args.join(" "));
      break;
    case "watch":
      await watch(root);
      break;
    case "claudemd":
      await claudemd(root);
      break;

    // Blueprints
    case "bp":
    case "blueprint": {
      const [sub, ...bpArgs] = args;
      if (!sub || sub === "list") {
        console.log(await blueprintList(root));
      } else if (sub === "show") {
        console.log(await blueprintShow(root, bpArgs[0]));
      } else if (sub === "run") {
        console.log(await blueprintRun(root, bpArgs[0], bpArgs.slice(1).join(" ")));
      } else {
        // Shorthand: lazy bp fix-bug "the description"
        console.log(await blueprintRun(root, sub, bpArgs.join(" ")));
      }
      break;
    }

    // Persist
    case "remember":
      await remember(root, args[0], args.slice(1).join(" "));
      break;
    case "recall":
      await recall(root, args[0]);
      break;
    case "journal":
      await journal(root, args.length ? args.join(" ") : undefined);
      break;
    case "snapshot":
      await snapshot(root, args[0]);
      break;

    default:
      console.error(`Unknown command: ${cmd}\nRun 'lazy help' for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
