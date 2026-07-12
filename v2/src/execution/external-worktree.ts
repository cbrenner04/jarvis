import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { branchExistsLocalAsync, branchExistsOnOriginAsync, getCurrentBranchAsync } from "../../../shared/git.ts";
import { realAsyncSubprocessRunner, type AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { acquireLock, releaseLock, type WorktreeLock } from "../../../shared/worktree-lock.ts";

/** Naming and git inputs for materialization. */
export type ExternalWorktreeInput = {
  projectRoot: string;
  projectName: string;
  branchName: string;
  baseRef: string;
  jarvisRoot?: string;
  git?: boolean;
  localPath?: string;
};

export type ExternalWorktree = {
  path: string;
  reused: boolean;
};

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
  if (args.git === false && args.localPath !== undefined) return args.localPath;
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
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<WithExternalWorktreeResult<T>> {
  if (args.git === false && args.localPath !== undefined) {
    mkdirSync(args.localPath, { recursive: true });
    return {
      worktree: { path: args.localPath, reused: true },
      lock: { kind: "acquired" },
      value: await run({ path: args.localPath, reused: true }),
    };
  }
  const lockRoot = ensureExternalWorktreeLockRoot(args);
  const lock = acquireExternalWorktreeLock(lockRoot);
  try {
    const worktree = await ensureExternalWorktree(args, runner);
    const value = await run(worktree);
    return { worktree, lock, value };
  } finally {
    releaseExternalWorktreeLock(lockRoot);
  }
}

/** Acquire the lock; a live holder throws {@link WorktreeBusyError} (refuse, don't queue). */
function acquireExternalWorktreeLock(lockDir: string): LockStatus {
  const acquisition = acquireLock(getExternalWorktreeLockPath(lockDir));
  if (acquisition.kind === "busy") {
    throw new WorktreeBusyError(acquisition.existingLock);
  }
  return acquisition;
}

/** Best-effort lock-file cleanup. */
function releaseExternalWorktreeLock(lockDir: string): void {
  releaseLock(getExternalWorktreeLockPath(lockDir));
}

function ensureExternalWorktreeLockRoot(args: ExternalWorktreeInput): string {
  const jarvisRoot = args.jarvisRoot ?? join(homedir(), ".jarvis");
  const lockRoot = join(jarvisRoot, "worktree-locks", args.projectName, args.branchName);
  mkdirSync(lockRoot, { recursive: true });
  return lockRoot;
}

async function ensureExternalWorktree(
  args: ExternalWorktreeInput,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<ExternalWorktree> {
  const worktreePath = getExternalWorktreePath(args);
  if (await isValidGitWorktree(worktreePath, runner)) {
    await assertReusableWorktreeMatches(args, worktreePath, runner);
    return { path: worktreePath, reused: true };
  }
  if (existsSync(worktreePath)) {
    throw new Error(`existing path is not a git worktree: ${worktreePath}`);
  }

  mkdirSync(dirname(worktreePath), { recursive: true });
  await pruneMissingWorktrees(args.projectRoot, runner);

  const branchExists = await branchExistsLocalAsync(args.projectRoot, args.branchName, runner);
  const branchExistsRemote = await branchExistsOnOriginAsync(args.projectRoot, args.branchName, runner);

  if (branchExists || branchExistsRemote) {
    if (!branchExists && branchExistsRemote) {
      await runner.runAsync("git", ["branch", args.branchName, `origin/${args.branchName}`], args.projectRoot);
    }
    await runner.runAsync("git", ["worktree", "add", "--checkout", worktreePath, args.branchName], args.projectRoot);
    return { path: worktreePath, reused: false };
  }

  await runner.runAsync("git", ["branch", args.branchName, args.baseRef], args.projectRoot);
  await runner.runAsync("git", ["worktree", "add", worktreePath, args.branchName], args.projectRoot);
  return { path: worktreePath, reused: false };
}

async function isValidGitWorktree(worktreePath: string, runner: AsyncSubprocessRunner): Promise<boolean> {
  if (!existsSync(worktreePath)) return false;
  try {
    return (await runner.runAsync("git", ["rev-parse", "--is-inside-work-tree"], worktreePath)).trim() === "true";
  } catch {
    return false;
  }
}

async function assertReusableWorktreeMatches(
  args: ExternalWorktreeInput,
  worktreePath: string,
  runner: AsyncSubprocessRunner,
): Promise<void> {
  const expectedRepo = await gitCommonDir(args.projectRoot, runner);
  const actualRepo = await gitCommonDir(worktreePath, runner);
  if (expectedRepo !== actualRepo) {
    throw new Error(`existing worktree ${worktreePath} belongs to a different repository`);
  }

  const currentBranch = await getCurrentBranchAsync(worktreePath, runner);
  if (currentBranch !== args.branchName) {
    throw new Error(`existing worktree ${worktreePath} is on branch ${currentBranch}, expected ${args.branchName}`);
  }
}

async function gitCommonDir(cwd: string, runner: AsyncSubprocessRunner): Promise<string> {
  return resolve((await runner.runAsync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd)).trim());
}

async function pruneMissingWorktrees(projectRoot: string, runner: AsyncSubprocessRunner): Promise<void> {
  await runner.runAsync("git", ["worktree", "prune"], projectRoot);
}
