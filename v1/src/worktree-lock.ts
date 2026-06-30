import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { acquireLock, isProcessAlive, releaseLock, type WorktreeLock } from "../../shared/worktree-lock.ts";

export { isProcessAlive, type WorktreeLock };

export function getWorktreeLockPath(worktreeDir: string): string {
  return join(worktreeDir, ".jarvis.lock");
}

/**
 * Ensure `.jarvis.lock` is listed in the worktree's per-worktree
 * `info/exclude` so `git add -A` (run from within the worktree during
 * subspec/WIP commits) never stages the lock file. The lock file's
 * physical location is the worktree root, but `.gitignore` patterns from
 * the main checkout (e.g. `.worktree/*`) do not apply inside the linked
 * worktree, so we add an exclusion that's local to this worktree's
 * gitdir and never committed.
 *
 * Best-effort: failures here are not fatal. The next subspec commit
 * would just stage the lock as before; correctness of the lock itself
 * is unaffected.
 */
function ensureLockExcluded(worktreeDir: string): void {
  let excludePath: string;
  try {
    const out = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: worktreeDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!out) return;
    excludePath = out.startsWith("/") ? out : join(worktreeDir, out);
  } catch {
    return;
  }

  try {
    mkdirSync(dirname(excludePath), { recursive: true });
  } catch {
    return;
  }

  let existing = "";
  try {
    existing = readFileSync(excludePath, "utf8");
  } catch {
    // file may not exist yet; treat as empty
  }

  const lines = existing.split("\n");
  const hasEntry = lines.some((line) => line.trim() === ".jarvis.lock");
  if (hasEntry) return;

  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
  const addition = `${needsLeadingNewline ? "\n" : ""}.jarvis.lock\n`;
  try {
    writeFileSync(excludePath, existing + addition, "utf8");
  } catch {
    // best-effort
  }
}

/**
 * Acquire `.jarvis.lock` for a worktree. The lock lives inside the worktree
 * root, so we also ensure it is excluded from `git add -A`. Lock semantics are
 * the shared path-based core; only the in-worktree location is v1-specific.
 */
export function acquireWorktreeLock(
  worktreeDir: string,
): { kind: "acquired" } | { kind: "busy"; existingLock: WorktreeLock } | { kind: "recovered"; stalepid: number } {
  ensureLockExcluded(worktreeDir);
  return acquireLock(getWorktreeLockPath(worktreeDir));
}

export function releaseWorktreeLock(worktreeDir: string): void {
  releaseLock(getWorktreeLockPath(worktreeDir));
}

export function readLiveWorktreeLock(worktreePath: string): WorktreeLock | null {
  const lockPath = getWorktreeLockPath(worktreePath);
  if (!existsSync(lockPath)) {
    return null;
  }
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as WorktreeLock;
    return isProcessAlive(lock.pid) ? lock : null;
  } catch {
    return null;
  }
}
