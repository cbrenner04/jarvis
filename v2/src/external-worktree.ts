import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { branchExistsLocal, branchExistsOnOrigin, getCurrentBranch } from "../../shared/git.ts";
import { acquireLock, releaseLock, type WorktreeLock } from "../../shared/worktree-lock.ts";

export type { WorktreeLock };

/** Naming and git inputs for materialization. */
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

/** Lock acquisition outcome. */
export type LockStatus = { kind: "acquired" } | { kind: "recovered"; stalepid: number };

/** Raised when the lock is held by a live process. */
export class WorktreeBusyError extends Error {
  existingLock: WorktreeLock;

  constructor(existingLock: WorktreeLock) {
    super(`worktree is in use by process ${existingLock.pid} (started at ${existingLock.started_at})`);
    this.name = "WorktreeBusyError";
    this.existingLock = existingLock;
  }
}

/** Result of a lock-scoped worktree operation. */
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
 * `.jarvis.lock` path in `lockDir`. Locks live in a dedicated
 * `~/.jarvis/worktree-locks/` tree so a run can serialize on the branch before
 * its worktree exists.
 */
export function getExternalWorktreeLockPath(lockDir: string): string {
  return join(lockDir, ".jarvis.lock");
}

/** Lock, materialize/reuse the worktree, run the callback, always release. */
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
export function ensureExternalWorktree(args: ExternalWorktreeInput): ExternalWorktree {
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
  const branchExistsRemote = branchExistsOnOrigin(args.projectRoot, args.branchName);

  if (branchExists || branchExistsRemote) {
    if (!branchExists && branchExistsRemote) {
      execFileSync("git", ["branch", args.branchName, `origin/${args.branchName}`], {
        cwd: args.projectRoot,
        stdio: "pipe",
      });
    }
    execFileSync("git", ["worktree", "add", "--checkout", worktreePath, args.branchName], {
      cwd: args.projectRoot,
      stdio: "pipe",
    });
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

/** Acquire the lock; a live holder throws {@link WorktreeBusyError} (refuse, don't queue). */
export function acquireExternalWorktreeLock(lockDir: string): LockStatus {
  const acquisition = acquireLock(getExternalWorktreeLockPath(lockDir));
  if (acquisition.kind === "busy") {
    throw new WorktreeBusyError(acquisition.existingLock);
  }
  return acquisition;
}

/** Best-effort lock-file cleanup. */
export function releaseExternalWorktreeLock(lockDir: string): void {
  releaseLock(getExternalWorktreeLockPath(lockDir));
}

function ensureExternalWorktreeLockRoot(args: ExternalWorktreeInput): string {
  const jarvisRoot = args.jarvisRoot ?? join(homedir(), ".jarvis");
  const lockRoot = join(jarvisRoot, "worktree-locks", args.projectName, args.branchName);
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

function assertReusableWorktreeMatches(args: ExternalWorktreeInput, worktreePath: string): void {
  const expectedRepo = gitCommonDir(args.projectRoot);
  const actualRepo = gitCommonDir(worktreePath);
  if (expectedRepo !== actualRepo) {
    throw new Error(`existing worktree ${worktreePath} belongs to a different repository`);
  }

  const currentBranch = getCurrentBranch(worktreePath);
  if (currentBranch !== args.branchName) {
    throw new Error(`existing worktree ${worktreePath} is on branch ${currentBranch}, expected ${args.branchName}`);
  }
}

function gitCommonDir(cwd: string): string {
  return resolve(
    execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim(),
  );
}
