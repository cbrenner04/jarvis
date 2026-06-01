import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";

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
  | { kind: "recovered"; stalepid: number };

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

/**
 * Return the `.jarvis.lock` path inside a lock directory.
 *
 * Locks live in a dedicated tree (`~/.jarvis/worktree-locks/...`) so a run can
 * serialize on the branch before its worktree exists.
 */
export function getExternalWorktreeLockPath(lockDir: string): string {
  return join(lockDir, ".jarvis.lock");
}

/**
 * Acquire lock, materialize/reuse external worktree, run the callback, then
 * always release lock.
 */
export async function withExternalWorktree<T>(
  args: ExternalWorktreeInput,
  run: (worktree: ExternalWorktree) => Promise<T> | T,
): Promise<WithExternalWorktreeResult<T>> {
  const lockRoot = ensureExternalWorktreeLockRoot(args);
  const lock = acquireExternalWorktreeLock(lockRoot);
  try {
    const worktree = ensureExternalWorktree(args);
    const value = await run(worktree);
    return { worktree, lock, value };
  } finally {
    releaseExternalWorktreeLock(lockRoot);
  }
}

/** Ensure a named external worktree exists and return its path. */
export function ensureExternalWorktree(
  args: ExternalWorktreeInput,
): ExternalWorktree {
  const worktreePath = getExternalWorktreePath(args);
  if (isValidGitWorktree(worktreePath)) {
    assertReusableWorktreeMatches(args, worktreePath);
    return { path: worktreePath, reused: true };
  }
  if (existsSync(worktreePath)) {
    throw new Error(`existing path is not a git worktree: ${worktreePath}`);
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
export function acquireExternalWorktreeLock(lockDir: string): LockStatus {
  const lockPath = getExternalWorktreeLockPath(lockDir);

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
export function releaseExternalWorktreeLock(lockDir: string): void {
  const lockPath = getExternalWorktreeLockPath(lockDir);
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

function ensureExternalWorktreeLockRoot(args: ExternalWorktreeInput): string {
  const jarvisRoot = args.jarvisRoot ?? join(homedir(), ".jarvis");
  const lockRoot = join(
    jarvisRoot,
    "worktree-locks",
    args.projectName,
    args.branchName,
  );
  mkdirSync(lockRoot, { recursive: true });
  return lockRoot;
}

function isValidGitWorktree(worktreePath: string): boolean {
  if (!existsSync(worktreePath)) return false;
  try {
    const output = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return output === "true";
  } catch {
    return false;
  }
}

function assertReusableWorktreeMatches(
  args: ExternalWorktreeInput,
  worktreePath: string,
): void {
  const expectedRepo = gitCommonDir(args.projectRoot);
  const actualRepo = gitCommonDir(worktreePath);
  if (expectedRepo !== actualRepo) {
    throw new Error(
      `existing worktree ${worktreePath} belongs to a different repository`,
    );
  }

  const currentBranch = gitCurrentBranch(worktreePath);
  if (currentBranch !== args.branchName) {
    throw new Error(
      `existing worktree ${worktreePath} is on branch ${currentBranch}, expected ${args.branchName}`,
    );
  }
}

function gitCommonDir(cwd: string): string {
  return resolve(
    execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim(),
  );
}

function gitCurrentBranch(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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
