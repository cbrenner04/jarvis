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

function ensureLockExcluded(worktreeDir: string): void {
  let excludePath: string;
  try {
    const out = execFileSync(
      "git",
      ["rev-parse", "--git-path", "info/exclude"],
      {
        cwd: worktreeDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
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
  } catch {}

  const hasEntry = existing
    .split("\n")
    .some((line) => line.trim() === ".jarvis.lock");
  if (hasEntry) return;

  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
  const addition = `${needsLeadingNewline ? "\n" : ""}.jarvis.lock\n`;
  try {
    writeFileSync(excludePath, existing + addition, "utf8");
  } catch {}
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
  | { kind: "recovered"; stalePid: number } {
  const lockPath = getWorktreeLockPath(worktreeDir);
  ensureLockExcluded(worktreeDir);

  if (existsSync(lockPath)) {
    let existingLock: WorktreeLock | null = null;
    try {
      existingLock = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      unlinkSync(lockPath);
    }

    if (existingLock !== null) {
      if (isProcessAlive(existingLock.pid)) {
        return { kind: "busy", existingLock };
      }
      const stalePid = existingLock.pid;
      unlinkSync(lockPath);
      const lock: WorktreeLock = {
        pid: process.pid,
        started_at: new Date().toISOString(),
        host: hostname(),
      };
      writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
      return { kind: "recovered", stalePid };
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
  if (!existsSync(lockPath)) return;
  try {
    unlinkSync(lockPath);
  } catch {}
}
