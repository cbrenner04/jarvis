import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
  type Stats,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { errorMessage } from "../../../shared/error-message.ts";
import {
  addWorktree,
  branchExistsOnOriginAsync,
  createBranch,
  getCurrentBranchAsync,
  gitCommonDir,
  isInsideWorkTree,
  listWorktrees,
  pruneWorktrees,
  resolveRef,
} from "../../../shared/git.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { acquireLock, releaseLock, type WorktreeLock } from "../../../shared/worktree-lock.ts";
import { jarvisHome, managedWorktreePath } from "../paths.ts";
import { throwIfAborted } from "./throw-if-aborted.ts";

export { isNotGitRepositoryDiagnostic } from "../../../shared/git.ts";

export const MATERIALIZED_NODE_MODULES_PATH = "node_modules";

export function isMaterializedNodeModulesPath(worktreePath: string, path: string): boolean {
  if (path !== MATERIALIZED_NODE_MODULES_PATH) return false;
  // biome-ignore format: Preserve the mutation-checkpoint anchor.
  return lstatSync(join(worktreePath, MATERIALIZED_NODE_MODULES_PATH), { throwIfNoEntry: false })?.isSymbolicLink() === true;
}

/** Naming and git inputs for materialization. */
export type ExternalWorktreeInput = {
  projectRoot: string;
  projectName: string;
  branchName: string;
  baseRef: string;
  /** Ref a new branch is created from when it differs from `baseRef` (chained fan-out lanes); `baseRef` stays the publication base. */
  forkRef?: string;
  jarvisRoot?: string;
  git?: boolean;
  localPath?: string;
  /**
   * Opt-in on the `git === false` + `localPath` branch: when `true`, materialize a
   * `.git`-less readable checkout of `projectRoot` content at `baseRef` into `localPath`
   * before the callback. Absent/false preserves the `mkdirSync`-only empty-stage behavior.
   */
  materializeReadCheckout?: boolean;
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

/** Raised when a fresh managed worktree could not be created and validated. */
export class WorktreeMaterializationError extends Error {
  readonly worktreePath: string;
  override readonly cause: unknown;

  constructor(worktreePath: string, cause: unknown) {
    const reason = errorMessage(cause);
    super(`Failed to materialize worktree ${worktreePath}: ${reason}`);
    this.name = "WorktreeMaterializationError";
    this.worktreePath = worktreePath;
    this.cause = cause;
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
  if (args.localPath !== undefined) return args.localPath;
  const jarvisRoot = args.jarvisRoot ?? jarvisHome();
  return managedWorktreePath(jarvisRoot, args.projectName, args.branchName);
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
  signal?: AbortSignal,
): Promise<WithExternalWorktreeResult<T>> {
  throwIfAborted(signal);
  if (args.git === false && args.localPath !== undefined) {
    mkdirSync(args.localPath, { recursive: true });
    if (args.materializeReadCheckout === true) {
      await materializeReadCheckout(args.projectRoot, args.baseRef, args.localPath, runner, signal);
    }
    return {
      worktree: { path: args.localPath, reused: true },
      lock: { kind: "acquired" },
      value: await run({ path: args.localPath, reused: true }),
    };
  }
  const lockRoot = ensureExternalWorktreeLockRoot(args);
  const lock = acquireExternalWorktreeLock(lockRoot);
  try {
    const worktree = await ensureExternalWorktree(args, runner, signal);
    throwIfAborted(signal);
    const value = await run(worktree);
    return { worktree, lock, value };
  } finally {
    // Mutation checkpoint: releasing the lock before `run` instead of in `finally` must turn
    // the external-worktree lock-hold regression RED.
    releaseExternalWorktreeLock(lockRoot);
  }
}

/**
 * Extract a `.git`-less readable content checkout of `projectRoot` at `baseRef` into
 * `destPath` via `git archive | tar -x`. The tree has no `.git`/HEAD; it is a disposable
 * readable copy for agent cwd, with no link back to the source repo. `destPath` is cleaned
 * before extraction so prior-run debris never survives into the fresh checkout. The base ref
 * is resolved to a local tree-ish first, degrading a non-local base to the local `HEAD` rather
 * than surfacing a raw `git archive` failure.
 */
async function materializeReadCheckout(
  projectRoot: string,
  baseRef: string,
  destPath: string,
  runner: AsyncSubprocessRunner,
  signal: AbortSignal | undefined,
): Promise<void> {
  rmSync(destPath, { recursive: true, force: true });
  mkdirSync(destPath, { recursive: true });
  const archiveRef = await resolveLocalArchiveRef(projectRoot, baseRef, runner, signal);
  const command = `git archive --format=tar ${shellQuote(archiveRef)} | tar -x -C ${shellQuote(destPath)}`;
  await runner.runAsync("sh", ["-c", command], projectRoot, { signal });
  throwIfAborted(signal);
}

/**
 * Resolve `baseRef` to a tree-ish that exists in the local `projectRoot`. GitHub's default-branch
 * name (or the `"main"` fallback) is not guaranteed to exist as a local ref; when it does not,
 * fall back to the local `HEAD` so extraction always runs against a present tree-ish. An
 * inconclusive probe (not a repository, abort) rejects rather than degrading.
 */
async function resolveLocalArchiveRef(
  projectRoot: string,
  baseRef: string,
  runner: AsyncSubprocessRunner,
  signal: AbortSignal | undefined,
): Promise<string> {
  const resolution = await resolveRef(projectRoot, `${baseRef}^{tree}`, runner, { signal });
  return resolution.status === "resolved" ? baseRef : "HEAD";
}

/** Single-quote a path for safe interpolation into a `sh -c` pipeline. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
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
  const jarvisRoot = args.jarvisRoot ?? jarvisHome();
  const lockRoot = join(jarvisRoot, "worktree-locks", args.projectName, args.branchName);
  mkdirSync(lockRoot, { recursive: true });
  return lockRoot;
}

async function ensureExternalWorktree(
  args: ExternalWorktreeInput,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  signal?: AbortSignal,
): Promise<ExternalWorktree> {
  const worktreePath = getExternalWorktreePath(args);
  const worktreeState = await classifyGitWorktree(worktreePath, runner, signal);
  if (worktreeState === "worktree") {
    throwIfAborted(signal);
    await assertReusableWorktreeMatches(args, worktreePath, runner, signal);
    throwIfAborted(signal);
    reconcileNodeModulesLink(args.projectRoot, worktreePath);
    return { path: worktreePath, reused: true };
  }
  throwIfAborted(signal);
  if (worktreeState === "unknown") {
    throw new Error(`could not validate existing path as a git worktree: ${worktreePath}`);
  }
  if (existsSync(worktreePath)) {
    if (await isRegisteredWorktreePath(args.projectRoot, worktreePath, runner, signal)) {
      throw new Error(`existing path is registered as a git worktree: ${worktreePath}`);
    }
    rmSync(worktreePath, { recursive: true, force: true });
  }

  try {
    mkdirSync(dirname(worktreePath), { recursive: true });
    await pruneWorktrees(args.projectRoot, runner, { signal });
    throwIfAborted(signal);
    await ensureBranch(args, runner, signal);
    throwIfAborted(signal);
    await addWorktree(args.projectRoot, { path: worktreePath, branch: args.branchName }, runner, { signal });
    throwIfAborted(signal);
    if ((await classifyGitWorktree(worktreePath, runner, signal)) !== "worktree") {
      throw new Error(`created path is not a git worktree: ${worktreePath}`);
    }
    await assertReusableWorktreeMatches(args, worktreePath, runner, signal);
    throwIfAborted(signal);
    reconcileNodeModulesLink(args.projectRoot, worktreePath);
    return { path: worktreePath, reused: false };
  } catch (error) {
    throw error instanceof WorktreeMaterializationError ? error : new WorktreeMaterializationError(worktreePath, error);
  }
}

/**
 * Make `branchName` exist locally with explicit start-point precedence: an origin head wins
 * (`origin/<branch>`), else `forkRef`, else `baseRef`. The branch is not pre-checked locally:
 * `createBranch` resolves `exists` when it already does, and the start point only matters for a
 * fresh branch. An inconclusive origin probe (timeout) rejects rather than branching from base.
 */
async function ensureBranch(
  args: ExternalWorktreeInput,
  runner: AsyncSubprocessRunner,
  signal: AbortSignal | undefined,
): Promise<void> {
  const onOrigin = await branchExistsOnOriginAsync(args.projectRoot, args.branchName, runner, { signal });
  throwIfAborted(signal);
  const startPoint = onOrigin ? `origin/${args.branchName}` : (args.forkRef ?? args.baseRef);
  await createBranch(args.projectRoot, args.branchName, startPoint, runner, { signal });
}

function fsEntryType(stat: Stats): string {
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "special entry";
}

/** True when `link` resolves to `target`; a dangling link resolves to nothing. */
function linkResolvesTo(link: string, target: string): boolean {
  try {
    return realpathSync(link) === realpathSync(target);
  } catch {
    return false;
  }
}

/**
 * Ensure the worktree's `node_modules` is a symlink to the project's while that is a directory:
 * keep a correct link, replace a wrong-target or dangling one, create when absent, and refuse
 * (without removing) any non-symlink collision.
 */
function reconcileNodeModulesLink(projectRoot: string, worktreePath: string): void {
  const projectNodeModules = join(projectRoot, MATERIALIZED_NODE_MODULES_PATH);
  if (!statSync(projectNodeModules, { throwIfNoEntry: false })?.isDirectory()) return;
  const linkPath = join(worktreePath, MATERIALIZED_NODE_MODULES_PATH);
  try {
    const current = lstatSync(linkPath, { throwIfNoEntry: false });
    if (current !== undefined) {
      if (!current.isSymbolicLink()) {
        throw new WorktreeMaterializationError(
          worktreePath,
          new Error(
            `${linkPath} is a ${fsEntryType(current)}, not a symlink to ${projectNodeModules}; remove it or ignore ${MATERIALIZED_NODE_MODULES_PATH} without a trailing slash`,
          ),
        );
      }
      if (linkResolvesTo(linkPath, projectNodeModules)) return;
      unlinkSync(linkPath);
    }
    symlinkSync(projectNodeModules, linkPath, "dir");
  } catch (error) {
    throw error instanceof WorktreeMaterializationError ? error : new WorktreeMaterializationError(worktreePath, error);
  }
}

type GitWorktreeState = "not-worktree" | "worktree" | "unknown";

/** `unknown` is an inconclusive probe (anything but git's not-a-repository diagnostic): never reclaim on it. */
async function classifyGitWorktree(
  worktreePath: string,
  runner: AsyncSubprocessRunner,
  signal: AbortSignal | undefined,
): Promise<GitWorktreeState> {
  if (!existsSync(worktreePath)) return "not-worktree";
  try {
    return (await isInsideWorkTree(worktreePath, runner, { signal })) ? "worktree" : "not-worktree";
  } catch {
    return "unknown";
  }
}

async function isRegisteredWorktreePath(
  projectRoot: string,
  worktreePath: string,
  runner: AsyncSubprocessRunner,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const entries = await listWorktrees(projectRoot, runner, { signal });
  return entries.some((entry) => resolve(entry.path) === resolve(worktreePath));
}

async function assertReusableWorktreeMatches(
  args: ExternalWorktreeInput,
  worktreePath: string,
  runner: AsyncSubprocessRunner,
  signal: AbortSignal | undefined,
): Promise<void> {
  const expectedRepo = await gitCommonDir(args.projectRoot, runner, { signal });
  const actualRepo = await gitCommonDir(worktreePath, runner, { signal });
  if (expectedRepo !== actualRepo) {
    throw new Error(`existing worktree ${worktreePath} belongs to a different repository`);
  }

  const currentBranch = await getCurrentBranchAsync(worktreePath, runner, { signal });
  if (currentBranch !== args.branchName) {
    throw new Error(`existing worktree ${worktreePath} is on branch ${currentBranch}, expected ${args.branchName}`);
  }
}
