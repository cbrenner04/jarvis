import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";

/** `.jarvis.lock` payload. */
export type WorktreeLock = {
  pid: number;
  started_at: string;
  host: string;
};

/** Outcome of a lock acquisition attempt. */
export type LockAcquisition =
  | { kind: "acquired" }
  | { kind: "busy"; existingLock: WorktreeLock }
  | { kind: "recovered"; stalepid: number };

/** Return true when a process id is currently alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a lock at `lockPath` with busy-vs-stale semantics: a live holder is
 * busy; a dead holder is recovered; an unreadable lock is reclaimed. The lock
 * path is the caller's choice — inside a worktree (v1) or a dedicated tree (v2).
 */
export function acquireLock(lockPath: string): LockAcquisition {
  if (existsSync(lockPath)) {
    let existingLock: WorktreeLock | null = null;
    try {
      existingLock = JSON.parse(readFileSync(lockPath, "utf8")) as WorktreeLock;
    } catch {
      unlinkSync(lockPath);
    }

    if (existingLock !== null) {
      if (isProcessAlive(existingLock.pid)) {
        return { kind: "busy", existingLock };
      }
      const stalepid = existingLock.pid;
      unlinkSync(lockPath);
      writeLock(lockPath);
      return { kind: "recovered", stalepid };
    }
  }

  writeLock(lockPath);
  return { kind: "acquired" };
}

/** Best-effort lock-file cleanup. */
export function releaseLock(lockPath: string): void {
  if (!existsSync(lockPath)) return;
  try {
    unlinkSync(lockPath);
  } catch {
    // Best-effort cleanup.
  }
}

function writeLock(lockPath: string): void {
  const lock: WorktreeLock = {
    pid: process.pid,
    started_at: new Date().toISOString(),
    host: hostname(),
  };
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}
