import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

export type WorktreeLock = {
  pid: number;
  started_at: string;
  host: string;
};

export function getWorktreeLockPath(worktreeDir: string): string {
  return join(worktreeDir, ".jarvis.lock");
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
): { kind: "acquired" } | { kind: "busy"; existingLock: WorktreeLock } | { kind: "recovered"; stalepid: number } {
  const lockPath = getWorktreeLockPath(worktreeDir);

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
      writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
      return { kind: "recovered", stalepid };
    }
  }

  const lock: WorktreeLock = {
    pid: process.pid,
    started_at: new Date().toISOString(),
    host: hostname(),
  };
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
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
