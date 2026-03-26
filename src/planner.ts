import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { readLazyJson, writeLazyFile } from "./store.js";

/**
 * Generate a planner prompt that expands a one-liner into a full PRD.
 *
 * The planner is designed based on Anthropic's research on harness design:
 * - Focus on product context and high-level technical design
 * - Avoid granular implementation details (they cascade errors)
 * - Be ambitious about scope
 * - Output structured markdown that parsePrdToSprints can parse
 *
 * Returns a prompt for Claude to execute. Claude generates the PRD,
 * saves it, then starts yolo mode with it.
 */
export function generatePlannerPrompt(root: string, idea: string): string {
  // Gather project context
  const mem = readLazyJson<Record<string, { value: string }>>(root, {}, "memory.json");
  const stack = mem["stack"]?.value ?? "";
  const buildCmd = mem["build-cmd"]?.value ?? "";
  const testCmd = mem["test-cmd"]?.value ?? "";
  const entryPoints = mem["entry-points"]?.value ?? "";
  const existingDocs = mem["docs"]?.value ?? "";

  // Check for existing code
  const hasExistingCode = existsSync(join(root, "src")) ||
    existsSync(join(root, "app")) ||
    existsSync(join(root, "lib")) ||
    existsSync(join(root, "pages"));

  // Detect if there's a README to reference
  let readmeSummary = "";
  try {
    const readme = readFileSync(join(root, "README.md"), "utf-8");
    if (readme.length > 100) {
      readmeSummary = readme.slice(0, 2000);
    }
  } catch {}

  // Build the planner prompt
  const sections: string[] = [];

  sections.push(`# Product Planner — Expand This Idea Into a Full PRD

You are a **senior product architect** designing a production-quality application. Your job is to take a brief idea and expand it into a comprehensive, structured PRD that can drive autonomous implementation.

## The Idea

> ${idea}

## Your Task

Generate a **complete Product Requirements Document** and save it to \`.lazy/generated-prd.md\`.

Then call \`lazy_yolo_start\` with the path \`.lazy/generated-prd.md\` to begin autonomous execution.

---

## PRD Generation Rules

### Scope & Ambition
- **Be ambitious.** The user gave you a one-liner because they trust you to fill in the details. Don't build a toy — build something a real user would want to use.
- Think about what features would make this product **compelling**, not just functional.
- Include features the user didn't ask for but would clearly want (e.g., dark mode, keyboard shortcuts, undo/redo, responsive design, error handling).
- Consider adding **AI-powered features** where they'd genuinely improve the UX.

### Technical Design
- Focus on **product context and high-level technical design**, NOT granular implementation details.
- If you specify too many implementation details upfront and get something wrong, the errors cascade into every downstream sprint. Stay at the feature/architecture level.
- Choose a modern, proven tech stack unless the user specified one.
- Design the data model at a schema level (what entities exist, how they relate), not at the SQL/ORM level.

### Structure
- Organize features into **logical phases** that build on each other.
- Phase 1 should be a working MVP — something usable even if later phases aren't built.
- Each phase should have 3-8 features, each described with clear, testable outcomes.
- Every feature description should start with a verb and be specific enough to verify.

### What NOT to Do
- Don't write implementation code or pseudocode in the PRD
- Don't specify exact file paths or function names
- Don't prescribe specific libraries for every feature (high-level stack is fine)
- Don't write user stories in formal "As a X, I want Y" format — be direct and natural
- Don't over-specify error handling or edge cases — let the implementer handle those`);

  // Add project context if available
  if (stack || hasExistingCode) {
    sections.push(`
## Project Context

This is ${hasExistingCode ? "an existing project" : "a new project"}.`);

    if (stack) {
      sections.push(`**Tech stack:** ${stack}`);
      sections.push(`Design the PRD to work with this stack. Don't fight it — leverage it.`);
    }
    if (buildCmd) sections.push(`**Build:** \`${buildCmd}\``);
    if (testCmd) sections.push(`**Test:** \`${testCmd}\``);
    if (entryPoints) sections.push(`**Entry points:** ${entryPoints}`);
    if (readmeSummary) {
      sections.push(`
**Existing README (first 2000 chars):**
\`\`\`
${readmeSummary}
\`\`\``);
    }
  } else {
    sections.push(`
## Project Context

This is a **new project starting from scratch**. Choose a modern, production-ready tech stack. Consider:
- **Web app?** Next.js + TypeScript + Tailwind CSS + Supabase (or similar)
- **CLI tool?** TypeScript + Node.js (or Rust/Go for performance)
- **API?** FastAPI (Python) or Express/Hono (TypeScript)
- **Mobile?** React Native + Expo

Pick the best fit for the idea. Include the tech stack decision in the PRD.`);
  }

  sections.push(`
## Required PRD Format

Generate the PRD in this exact markdown structure — the sprint parser depends on it:

\`\`\`markdown
# [Product Name] — [Tagline]

[2-3 sentence vision. What is this? Who is it for? Why does it matter?]

## Tech Stack

[Table or list of chosen technologies with brief rationale for each]

## Data Model

[Key entities, their attributes, and relationships — schema level, not SQL]

## Phase 1: [Name] — "[Subtitle]"

### F1. [Feature Name]
- [Specific, testable outcome 1]
- [Specific, testable outcome 2]
- [Specific, testable outcome 3]

### F2. [Feature Name]
- [Specific, testable outcome 1]
- ...

## Phase 2: [Name] — "[Subtitle]"

### F3. [Feature Name]
- ...

## Phase 3: [Name] — "[Subtitle]"

### F4. [Feature Name]
- ...

## Design Direction

[Visual style, color palette, typography, key UI patterns]
[Be specific: "dark mode with electric blue accents" not "modern design"]

## Non-Functional Requirements

[Performance targets, security requirements, accessibility, browser support]
\`\`\`

**Critical:** Each \`## Phase\` heading becomes a yolo sprint. Each \`- bullet point\` under a feature becomes a task. The parser uses \`##\` headings as sprint boundaries. Do not nest deeper than \`###\` for features.

## After Generating

1. Write the PRD to \`.lazy/generated-prd.md\`
2. Call \`lazy_yolo_start\` with path \`generated-prd.md\` (relative to project root — it's inside .lazy/)

Do not ask for confirmation. Generate the PRD and start yolo mode immediately.`);

  return sections.join("\n");
}

/**
 * Check if a string looks like a file path or a one-liner idea.
 */
export function isFilePath(input: string): boolean {
  // Obvious file paths
  if (input.endsWith(".md") || input.endsWith(".txt") || input.endsWith(".markdown")) return true;
  if (input.startsWith("/") || input.startsWith("./") || input.startsWith("../")) return true;
  if (input.includes("/") && !input.includes(" ")) return true;

  // Check if file actually exists
  if (existsSync(input)) return true;

  return false;
}
