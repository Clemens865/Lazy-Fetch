import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "fs";
import { dirname, join, resolve, basename } from "path";
import { homedir } from "os";

export interface WorktreeHandle {
  path: string;
  branch: string;
  baseBranch: string;
  canonicalRepoPath: string;
  adopted: boolean;
}

export interface WorktreeCleanupResult {
  worktreeRemoved: boolean;
  branchDeleted: boolean;
  directoryClean: boolean;
  warnings: string[];
}

function git(repo: string, args: string[]): string {
  return execSync(`git ${args.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`, {
    cwd: repo,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function tryGit(repo: string, args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(repo, args) };
  } catch (err: any) {
    return { ok: false, out: ((err.stdout || "") + (err.stderr || "")).trim() || (err.message || "") };
  }
}

function getCanonicalRepoPath(root: string): string {
  // git rev-parse --show-toplevel resolves to the *worktree* top, not the canonical repo.
  // For the canonical (main) repo we want the common git dir's parent.
  const commonDir = git(root, ["rev-parse", "--git-common-dir"]);
  const absoluteCommon = resolve(root, commonDir);
  // common-dir is usually ".../<repo>/.git"; canonical repo path is its parent.
  return basename(absoluteCommon) === ".git" ? dirname(absoluteCommon) : absoluteCommon;
}

function getCurrentBranch(repo: string): string {
  const r = tryGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.ok && r.out !== "HEAD" ? r.out : "main";
}

/**
 * Verify a directory at `expectedPath` is actually a worktree of `expectedRepo`.
 * Reads the worktree's `.git` file, parses its `gitdir:` pointer, and confirms the
 * pointed-to common dir lives inside `expectedRepo`. Without this guard, two clones
 * of the same remote could silently share a worktree directory. (Archon footgun.)
 */
function verifyWorktreeOwnership(expectedPath: string, expectedRepo: string): boolean {
  const dotGit = join(expectedPath, ".git");
  if (!existsSync(dotGit)) return false;
  let content: string;
  try {
    const st = statSync(dotGit);
    if (st.isDirectory()) return false; // a real .git dir is not a worktree
    content = readFileSync(dotGit, "utf-8").trim();
  } catch {
    return false;
  }
  const m = content.match(/^gitdir:\s*(.+)$/);
  if (!m) return false;
  const gitdirAbs = resolve(expectedPath, m[1].trim());
  // gitdirAbs is typically "<canonical>/.git/worktrees/<name>" — walk up to canonical repo.
  // Find the segment ".git/worktrees/" and slice before it.
  const idx = gitdirAbs.indexOf(`${"/"}.git${"/"}worktrees${"/"}`);
  if (idx < 0) return false;
  const claimedRepo = gitdirAbs.slice(0, idx);
  return resolve(claimedRepo) === resolve(expectedRepo);
}

export function getWorktreeBaseDir(): string {
  return join(homedir(), ".lazy", "worktrees");
}

export function planWorktreePath(canonicalRepoPath: string, blueprint: string, runId: string): string {
  const repoSlug = basename(canonicalRepoPath);
  return join(getWorktreeBaseDir(), repoSlug, `${blueprint}-${runId}`);
}

export function planBranchName(blueprint: string, runId: string): string {
  return `lazy/bp-${blueprint}-${runId}`;
}

/**
 * Create a worktree for a blueprint run. Idempotent: if a worktree already exists
 * at the expected path AND its gitdir verifies against the canonical repo, adopt it.
 */
export function createWorktree(root: string, blueprint: string, runId: string): WorktreeHandle {
  // Confirm `root` is a git repo at all.
  const probe = tryGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!probe.ok || probe.out !== "true") {
    throw new Error(`Cannot isolate: ${root} is not inside a git work tree`);
  }

  const canonicalRepoPath = getCanonicalRepoPath(root);
  const baseBranch = getCurrentBranch(canonicalRepoPath);
  const wtPath = planWorktreePath(canonicalRepoPath, blueprint, runId);
  const branch = planBranchName(blueprint, runId);

  mkdirSync(dirname(wtPath), { recursive: true });

  // Adopt path: existing worktree, verified ownership.
  if (existsSync(wtPath)) {
    if (verifyWorktreeOwnership(wtPath, canonicalRepoPath)) {
      return { path: wtPath, branch, baseBranch, canonicalRepoPath, adopted: true };
    }
    throw new Error(
      `Worktree path ${wtPath} exists but does not belong to ${canonicalRepoPath}. Refusing to adopt.`
    );
  }

  // Fresh create. If the branch already exists (from a prior aborted run), reuse it
  // rather than failing — `git worktree add <path> <branch>` will check it out.
  const branchExists = tryGit(canonicalRepoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
  const addArgs = branchExists
    ? ["worktree", "add", wtPath, branch]
    : ["worktree", "add", "-b", branch, wtPath, baseBranch];

  const add = tryGit(canonicalRepoPath, addArgs);
  if (!add.ok) {
    throw new Error(`git worktree add failed: ${add.out}`);
  }

  return { path: wtPath, branch, baseBranch, canonicalRepoPath, adopted: false };
}

/**
 * Tear down a worktree. Best-effort: collects warnings rather than throwing so a
 * failure here never masks the real blueprint result.
 *
 * Critical: pass `canonicalRepoPath` from the persisted run record. If the worktree
 * directory is already gone and we don't know the canonical repo, branch cleanup is
 * silently skipped — there's no back-reference to recover from. (Archon footgun.)
 */
export function destroyWorktree(
  handle: Pick<WorktreeHandle, "path" | "branch" | "canonicalRepoPath">,
  opts: { deleteBranch?: boolean; force?: boolean } = {}
): WorktreeCleanupResult {
  const result: WorktreeCleanupResult = {
    worktreeRemoved: false,
    branchDeleted: false,
    directoryClean: false,
    warnings: [],
  };
  const { path: wtPath, branch, canonicalRepoPath } = handle;

  // 1. git worktree remove
  if (existsSync(canonicalRepoPath)) {
    const removeArgs = ["worktree", "remove"];
    if (opts.force) removeArgs.push("--force");
    removeArgs.push(wtPath);
    const r = tryGit(canonicalRepoPath, removeArgs);
    if (r.ok) {
      result.worktreeRemoved = true;
    } else if (/not a working tree|No such file/i.test(r.out)) {
      result.worktreeRemoved = true; // already gone
    } else {
      result.warnings.push(`worktree remove: ${r.out}`);
    }
    // Always prune so stale admin entries don't accumulate.
    tryGit(canonicalRepoPath, ["worktree", "prune"]);
  } else {
    result.warnings.push(`canonical repo missing at ${canonicalRepoPath}; skipped worktree remove`);
  }

  // 2. Belt-and-suspenders rm -rf (git leaves untracked files behind).
  if (existsSync(wtPath)) {
    try {
      rmSync(wtPath, { recursive: true, force: true });
      result.directoryClean = true;
    } catch (err: any) {
      result.warnings.push(`rm -rf ${wtPath}: ${err.message}`);
    }
  } else {
    result.directoryClean = true;
  }

  // 3. Optional branch deletion.
  if (opts.deleteBranch && existsSync(canonicalRepoPath)) {
    const r = tryGit(canonicalRepoPath, ["branch", "-D", branch]);
    if (r.ok) {
      result.branchDeleted = true;
    } else if (/not found|no such branch/i.test(r.out)) {
      result.branchDeleted = true;
    } else {
      result.warnings.push(`branch -D ${branch}: ${r.out}`);
    }
  }

  return result;
}
