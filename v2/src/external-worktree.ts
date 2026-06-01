import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  acquireLock,
  releaseLock,
  type WorktreeLock,
} from "../../shared/worktree-lock.ts";

export type { WorktreeLock };

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

/**
 * Acquire the lock with shared stale/busy semantics, surfacing a busy holder as
 * a thrown {@link WorktreeBusyError} (the external materialization contract
 * refuses rather than queues).
 */
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
