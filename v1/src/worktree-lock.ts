import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

export type WorktreeLock = {
  pid: number;
  started_at: string;
  host: string;
};

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
    const out = execFileSync(
      "git",
      ["rev-parse", "--git-path", "info/exclude"],
      { cwd: worktreeDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
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

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireWorktreeLock(
  worktreeDir: string,
):
  | { kind: "acquired" }
  | { kind: "busy"; existingLock: WorktreeLock }
  | { kind: "recovered"; stalepid: number } {
  const lockPath = getWorktreeLockPath(worktreeDir);
  ensureLockExcluded(worktreeDir);

  if (existsSync(lockPath)) {
    let existingLock: WorktreeLock | null = null;
    try {
      const raw = readFileSync(lockPath, "utf8");
      existingLock = JSON.parse(raw);
    } catch {
      unlinkSync(lockPath);
      // Fall through to create new lock
    }

    if (existingLock !== null) {
      if (isProcessAlive(existingLock.pid)) {
        return { kind: "busy", existingLock };
      }
      const stalepid = existingLock.pid;
      unlinkSync(lockPath);
      // Fall through to create new lock and return recovered
      const lock: WorktreeLock = {
        pid: process.pid,
        started_at: new Date().toISOString(),
        host: hostname(),
      };
      writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
      return { kind: "recovered", stalepid };
    }
  }

  const lock: WorktreeLock = {
    pid: process.pid,
    started_at: new Date().toISOString(),
    host: hostname(),
  };
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return { kind: "acquired" };
}

export function releaseWorktreeLock(worktreeDir: string): void {
  const lockPath = getWorktreeLockPath(worktreeDir);
  if (existsSync(lockPath)) {
    try {
      unlinkSync(lockPath);
    } catch {
      // Best-effort cleanup
    }
  }
}
