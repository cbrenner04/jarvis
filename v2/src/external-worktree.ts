import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";

/** `.jarvis.lock` payload shared with v1 lock semantics. */
export type WorktreeLock = {
  pid: number;
  started_at: string;
  host: string;
};

/** Caller-supplied naming and git inputs for external worktree materialization. */
export type ExternalWorktreeInput = {
  projectRoot: string;
  projectName: string;
  branchName: string;
  baseRef: string;
  jarvisRoot?: string;
};

/** Materialized external worktree metadata. */
export type ExternalWorktree = {
  path: string;
  reused: boolean;
};

/** Lock acquisition classification reused for reporting and tests. */
export type LockStatus =
  | { kind: "acquired" }
  | { kind: "recovered"; stalePid: number };

/** Busy lock error preserving the existing lock payload. */
export class WorktreeBusyError extends Error {
  existingLock: WorktreeLock;

  constructor(existingLock: WorktreeLock) {
    super(
      `worktree is in use by process ${existingLock.pid} (started at ${existingLock.started_at})`,
    );
    this.name = "WorktreeBusyError";
    this.existingLock = existingLock;
  }
}

/** Result envelope returned from the lock-scoped worktree operation. */
export type WithExternalWorktreeResult<T> = {
  worktree: ExternalWorktree;
  lock: LockStatus;
  value: T;
};

/** Resolve the external worktree path under `~/.jarvis/worktrees/<project>/<branch>/`. */
export function getExternalWorktreePath(args: ExternalWorktreeInput): string {
  const jarvisRoot = args.jarvisRoot ?? join(homedir(), ".jarvis");
  return join(jarvisRoot, "worktrees", args.projectName, args.branchName);
}

/** Return the lock path for an external worktree root. */
export function getExternalWorktreeLockPath(worktreeDir: string): string {
  return join(worktreeDir, ".jarvis.lock");
}

/**
 * Acquire lock, materialize/reuse external worktree, run the callback, then
 * always release lock.
 */
export async function withExternalWorktree<T>(
  args: ExternalWorktreeInput,
  run: (worktree: ExternalWorktree) => Promise<T> | T,
): Promise<WithExternalWorktreeResult<T>> {
  const worktree = ensureExternalWorktree(args);
  const lock = acquireExternalWorktreeLock(worktree.path);
  try {
    const value = await run(worktree);
    return { worktree, lock, value };
  } finally {
    releaseExternalWorktreeLock(worktree.path);
  }
}

/** Ensure a named external worktree exists and return its path. */
export function ensureExternalWorktree(
  args: ExternalWorktreeInput,
): ExternalWorktree {
  const worktreePath = getExternalWorktreePath(args);
  if (existsSync(worktreePath)) {
    return { path: worktreePath, reused: true };
  }

  mkdirSync(dirname(worktreePath), { recursive: true });

  const branchExists = branchExistsLocal(args.projectRoot, args.branchName);
  const branchExistsRemote = branchExistsOnOrigin(
    args.projectRoot,
    args.branchName,
  );

  if (branchExists || branchExistsRemote) {
    if (!branchExists && branchExistsRemote) {
      execFileSync(
        "git",
        ["branch", args.branchName, `origin/${args.branchName}`],
        {
          cwd: args.projectRoot,
          stdio: "pipe",
        },
      );
    }
    execFileSync(
      "git",
      ["worktree", "add", "--checkout", worktreePath, args.branchName],
      {
        cwd: args.projectRoot,
        stdio: "pipe",
      },
    );
    return { path: worktreePath, reused: false };
  }

  execFileSync("git", ["branch", args.branchName, args.baseRef], {
    cwd: args.projectRoot,
    stdio: "pipe",
  });
  execFileSync("git", ["worktree", "add", worktreePath, args.branchName], {
    cwd: args.projectRoot,
    stdio: "pipe",
  });
  return { path: worktreePath, reused: false };
}

/** Return true when a process id is currently alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Acquire `.jarvis.lock` with v1-compatible stale/busy semantics. */
export function acquireExternalWorktreeLock(worktreeDir: string): LockStatus {
  const lockPath = getExternalWorktreeLockPath(worktreeDir);
  ensureLockExcluded(worktreeDir);

  if (existsSync(lockPath)) {
    let existingLock: WorktreeLock | null = null;
    try {
      existingLock = JSON.parse(readFileSync(lockPath, "utf8")) as WorktreeLock;
    } catch {
      unlinkSync(lockPath);
    }

    if (existingLock !== null) {
      if (isProcessAlive(existingLock.pid)) {
        throw new WorktreeBusyError(existingLock);
      }
      const stalePid = existingLock.pid;
      unlinkSync(lockPath);
      writeLock(lockPath);
      return { kind: "recovered", stalePid };
    }
  }

  writeLock(lockPath);
  return { kind: "acquired" };
}

/** Best-effort lock-file cleanup. */
export function releaseExternalWorktreeLock(worktreeDir: string): void {
  const lockPath = getExternalWorktreeLockPath(worktreeDir);
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
  } catch {
    // File may not exist yet.
  }

  const hasEntry = existing
    .split("\n")
    .some((line) => line.trim() === ".jarvis.lock");
  if (hasEntry) return;

  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
  const addition = `${needsLeadingNewline ? "\n" : ""}.jarvis.lock\n`;
  try {
    writeFileSync(excludePath, existing + addition, "utf8");
  } catch {
    // Best-effort.
  }
}

function branchExistsLocal(projectRoot: string, branchName: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", branchName], {
      cwd: projectRoot,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function branchExistsOnOrigin(
  projectRoot: string,
  branchName: string,
): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", `origin/${branchName}`], {
      cwd: projectRoot,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}
