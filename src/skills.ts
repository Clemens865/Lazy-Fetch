import { existsSync, readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { writeLazyJson, readLazyJson } from "./store.js";

// --- Types ---

interface Skill {
  name: string;
  description: string;
  source: "global" | "project" | "plugin";
  pluginName?: string;
  category?: string;
  argumentHint?: string;
}

// Category mapping — maps skill keywords to lazy-fetch workflow categories
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "ui-design": ["ui", "design", "frontend", "component", "page", "layout", "css", "visual", "aesthetic"],
  "research": ["research", "scout", "discover", "explore", "landscape", "domain", "api", "database"],
  "debugging": ["debug", "investigate", "error", "fix", "root cause", "diagnose"],
  "planning": ["prd", "plan", "requirements", "roadmap", "spec", "architect"],
  "testing": ["test", "qa", "validate", "check", "verify"],
  "code-quality": ["review", "refactor", "simplify", "optimize", "quality", "lint"],
  "automation": ["loop", "automate", "schedule", "recurring", "batch"],
  "security": ["security", "audit", "vulnerability", "scan"],
};

function categorize(name: string, description: string): string {
  const text = `${name} ${description}`.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) return category;
  }
  return "general";
}

// --- Discovery ---

function parseSkillFile(filePath: string): { description: string; argumentHint?: string } | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    // Parse YAML frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;

    const fm = fmMatch[1];
    const descMatch = fm.match(/description:\s*"?([^"\n]+)"?/);
    const argMatch = fm.match(/argument-hint:\s*"?([^"\n]+)"?/);

    // Skip hidden skills
    if (fm.includes('hide-from-slash-command-tool: "true"')) return null;

    if (!descMatch) return null;
    return {
      description: descMatch[1].trim(),
      argumentHint: argMatch ? argMatch[1].trim() : undefined,
    };
  } catch {
    return null;
  }
}

function discoverGlobalSkills(): Skill[] {
  const skills: Skill[] = [];
  const dir = join(homedir(), ".claude", "commands");
  if (!existsSync(dir)) return skills;

  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const parsed = parseSkillFile(join(dir, file));
      if (!parsed) continue;

      const name = basename(file, ".md");
      skills.push({
        name,
        description: parsed.description,
        source: "global",
        argumentHint: parsed.argumentHint,
        category: categorize(name, parsed.description),
      });
    }
  } catch {}
  return skills;
}

function discoverProjectSkills(root: string): Skill[] {
  const skills: Skill[] = [];
  const dir = join(root, ".claude", "commands");
  if (!existsSync(dir)) return skills;

  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const parsed = parseSkillFile(join(dir, file));
      if (!parsed) continue;

      const name = basename(file, ".md");
      // Skip lazy-fetch's own commands
      const lazyCommands = new Set([
        "read", "plan", "status", "done", "check", "gather", "context",
        "remember", "recall", "journal", "snapshot", "blueprint", "yolo",
        "init", "next",
      ]);
      if (lazyCommands.has(name)) continue;

      skills.push({
        name,
        description: parsed.description,
        source: "project",
        argumentHint: parsed.argumentHint,
        category: categorize(name, parsed.description),
      });
    }
  } catch {}
  return skills;
}

function discoverPluginSkills(): Skill[] {
  const skills: Skill[] = [];
  const cacheDir = join(homedir(), ".claude", "plugins", "cache");
  if (!existsSync(cacheDir)) return skills;

  try {
    // Structure: cache/<registry>/<plugin-name>/<hash>/commands/*.md
    for (const registry of readdirSync(cacheDir)) {
      const registryDir = join(cacheDir, registry);
      if (!existsSync(registryDir)) continue;

      try {
        for (const plugin of readdirSync(registryDir)) {
          const pluginDir = join(registryDir, plugin);
          // Find latest version (sort by dir name, take last)
          try {
            const versions = readdirSync(pluginDir).sort();
            const latest = versions[versions.length - 1];
            if (!latest) continue;

            const commandsDir = join(pluginDir, latest, "commands");
            if (!existsSync(commandsDir)) continue;

            for (const file of readdirSync(commandsDir)) {
              if (!file.endsWith(".md")) continue;
              const parsed = parseSkillFile(join(commandsDir, file));
              if (!parsed) continue;

              const name = basename(file, ".md");
              skills.push({
                name: `${plugin}:${name}`,
                description: parsed.description,
                source: "plugin",
                pluginName: plugin,
                argumentHint: parsed.argumentHint,
                category: categorize(`${plugin} ${name}`, parsed.description),
              });
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return skills;
}

// --- Public API ---

export function discoverSkills(root: string): Skill[] {
  const all = [
    ...discoverGlobalSkills(),
    ...discoverProjectSkills(root),
    ...discoverPluginSkills(),
  ];

  // Deduplicate by name (project overrides global, latest plugin wins)
  const seen = new Map<string, Skill>();
  for (const skill of all) {
    const key = skill.name.split(":").pop() ?? skill.name;
    const existing = seen.get(key);
    if (!existing || skill.source === "project") {
      seen.set(key, skill);
    }
  }

  return [...seen.values()];
}

/** Store discovered skills in memory for use by planner/yolo */
export async function scanSkills(root: string): Promise<void> {
  const skills = discoverSkills(root);

  if (skills.length === 0) {
    console.log("  No additional skills found.");
    return;
  }

  // Group by category
  const byCategory = new Map<string, Skill[]>();
  for (const skill of skills) {
    const cat = skill.category ?? "general";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(skill);
  }

  console.log(`\n  Skills discovered: ${skills.length}`);
  for (const [category, catSkills] of byCategory) {
    console.log(`\n  ${category}:`);
    for (const s of catSkills) {
      const prefix = s.source === "plugin" ? `/${s.name}` : `/${s.name}`;
      console.log(`    ${prefix} — ${s.description}`);
    }
  }

  // Store in memory as structured data
  writeLazyJson(root, skills, "context", "skills.json");

  // Also store a summary in memory.json for planner/yolo awareness
  const mem = readLazyJson<Record<string, { value: string; stored: string; updated: string }>>(root, {}, "memory.json");
  const now = new Date().toISOString();

  const summaryParts: string[] = [];
  for (const [category, catSkills] of byCategory) {
    summaryParts.push(`${category}: ${catSkills.map(s => s.name).join(", ")}`);
  }
  mem["available-skills"] = { value: summaryParts.join("; "), stored: now, updated: now };
  writeLazyJson(root, mem, "memory.json");
}

/** Get skill recommendations for a task description */
export function recommendSkills(root: string, task: string): Skill[] {
  const skills = readLazyJson<Skill[]>(root, [], "context", "skills.json");
  if (skills.length === 0) return [];

  const t = task.toLowerCase();
  const matches: Skill[] = [];

  for (const skill of skills) {
    const desc = skill.description.toLowerCase();
    const name = skill.name.toLowerCase();

    // Check if task words match skill description or category keywords
    const category = skill.category ?? "general";
    const keywords = CATEGORY_KEYWORDS[category] ?? [];

    if (keywords.some(kw => t.includes(kw)) || t.includes(name.split(":").pop() ?? "")) {
      matches.push(skill);
    }
  }

  return matches;
}

/** Format skills for inclusion in prompts */
export function formatSkillsForPrompt(root: string): string {
  const skills = readLazyJson<Skill[]>(root, [], "context", "skills.json");
  if (skills.length === 0) return "";

  const lines: string[] = [];
  lines.push("\n## Available Skills (Claude Code slash commands)\n");
  lines.push("These skills are installed and can be invoked with `/skill-name`. Use them when they match the task:\n");

  const byCategory = new Map<string, Skill[]>();
  for (const skill of skills) {
    const cat = skill.category ?? "general";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(skill);
  }

  for (const [category, catSkills] of byCategory) {
    lines.push(`### ${category}`);
    for (const s of catSkills) {
      const cmd = `/${s.name}${s.argumentHint ? ` ${s.argumentHint}` : ""}`;
      lines.push(`- **\`${cmd}\`** — ${s.description}`);
    }
    lines.push("");
  }

  lines.push("**When to use skills vs lazy-fetch tools:**");
  lines.push("- Skills are specialized — use them when the task matches their domain exactly");
  lines.push("- Lazy-fetch tools are the coordination layer — use them for planning, tracking, validation");
  lines.push("- Best pattern: lazy-fetch orchestrates (plan, contract, check) while skills do specialized work (design, research, debugging)");

  return lines.join("\n");
}

// --- CLI command ---

export async function skillsCmd(root: string): Promise<void> {
  console.log("\n  Skill Discovery");
  console.log("─".repeat(55));

  await scanSkills(root);

  console.log("\n" + "─".repeat(55));
  console.log("  Skills stored in .lazy/context/skills.json");
  console.log("  Planner and yolo mode will use them automatically.");
}
