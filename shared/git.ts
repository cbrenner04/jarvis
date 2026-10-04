import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
  AsyncSubprocessError,
  type AsyncSubprocessOptions,
  type AsyncSubprocessRunner,
  isSubprocessTimeout,
  networkSubprocessOptions,
  realAsyncSubprocessRunner,
  realSubprocessRunner,
  type SubprocessRunner,
} from "./subprocess.ts";

export type GitPathStatus =
  | "unmodified"
  | "modified"
  | "type-changed"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "unmerged"
  | "untracked"
  | "ignored";

type GitStatusEntryBase = {
  stagedStatus: GitPathStatus;
  worktreeStatus: GitPathStatus;
  currentPath: string;
};

export type GitStatusEntry =
  | (GitStatusEntryBase & { kind: "ordinary" })
  | (GitStatusEntryBase & { kind: "rename" | "copy"; originalPath: string });

type GitStatusCode = " " | "M" | "T" | "A" | "D" | "R" | "C" | "U" | "?" | "!";

function statusFromCode(code: string): GitPathStatus {
  const statuses: Record<GitStatusCode, GitPathStatus> = {
    " ": "unmodified",
    M: "modified",
    T: "type-changed",
    A: "added",
    D: "deleted",
    R: "renamed",
    C: "copied",
    U: "unmerged",
    "?": "untracked",
    "!": "ignored",
  };
  const status = statuses[code as GitStatusCode];
  if (status === undefined)
    throw new Error(`Malformed git status inventory: invalid status code ${JSON.stringify(code)}`);
  return status;
}

function twoPathKind(stagedCode: string, worktreeCode: string): "rename" | "copy" | undefined {
  if (stagedCode === "R" || worktreeCode === "R") return "rename";
  if (stagedCode === "C" || worktreeCode === "C") return "copy";
  return undefined;
}

/** Rejects malformed porcelain framing rather than returning ambiguous paths. */
export async function getGitStatusInventory(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<GitStatusEntry[]> {
  const output = await runner.runAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd);
  if (output.length === 0) return [];
  if (!output.endsWith("\0")) throw new Error("Malformed git status inventory: missing terminal NUL");

  const fields = output.slice(0, -1).split("\0");
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index] ?? "";
    if (record.length < 4 || record[2] !== " ") throw new Error("Malformed git status inventory: truncated record");
    const stagedCode = record[0] ?? "";
    const worktreeCode = record[1] ?? "";
    const base: GitStatusEntryBase = {
      stagedStatus: statusFromCode(stagedCode),
      worktreeStatus: statusFromCode(worktreeCode),
      currentPath: record.slice(3),
    };
    const kind = twoPathKind(stagedCode, worktreeCode);
    if (kind === undefined) {
      entries.push({ ...base, kind: "ordinary" });
      continue;
    }
    index += 1;
    const originalPath = fields[index];
    if (originalPath === undefined || originalPath.length === 0) {
      throw new Error("Malformed git status inventory: missing rename or copy origin");
    }
    entries.push({ ...base, kind, originalPath });
  }
  return entries;
}

/** Resolve GitHub's default branch, falling back to `main` when unavailable. */
export async function getBaseBranch(
  cwd?: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string> {
  try {
    const branch = (
      await runner.runAsync(
        "gh",
        ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
        cwd ?? "",
        networkSubprocessOptions(),
      )
    ).trim();
    return branch.length > 0 ? branch : "main";
  } catch {
    return "main";
  }
}

/** True when `branchName` resolves to a local ref in `projectRoot`. */
export function branchExistsLocal(
  projectRoot: string,
  branchName: string,
  runner: SubprocessRunner = realSubprocessRunner,
): boolean {
  try {
    runner.run("git", ["rev-parse", "--verify", branchName], projectRoot);
    return true;
  } catch {
    return false;
  }
}

function originHeadListedInLsRemote(output: string, branchName: string): boolean {
  const want = `refs/heads/${branchName}`;
  for (const line of output.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const tab = trimmed.indexOf("\t");
    if (tab === -1) continue;
    if (trimmed.slice(tab + 1) === want) return true;
  }
  return false;
}

/**
 * True when `origin` has branch `branchName` per `git ls-remote --heads`. Fails closed
 * (false) when `ls-remote` errors or returns no matching head; a local remote-tracking
 * ref alone does not count.
 */
export function branchExistsOnOrigin(
  projectRoot: string,
  branchName: string,
  runner: SubprocessRunner = realSubprocessRunner,
): boolean {
  try {
    const output = runner.run("git", ["ls-remote", "--heads", "origin", branchName], projectRoot);
    return originHeadListedInLsRemote(output, branchName);
  } catch {
    return false;
  }
}

/** The checked-out branch name (`rev-parse --abbrev-ref HEAD`) at `cwd`. */
export function getCurrentBranch(cwd: string, runner: SubprocessRunner = realSubprocessRunner): string {
  return runner.run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd).trim();
}

/** True when `git status --porcelain` at `cwd` reports any uncommitted changes. */
export function isWorktreeDirty(cwd: string, runner: SubprocessRunner = realSubprocessRunner): boolean {
  return runner.run("git", ["status", "--porcelain"], cwd).trim().length > 0;
}

/** True when `cwd` is inside a git working tree; false for plain (git-disabled) directories. */
export function isGitRepo(cwd: string, runner: SubprocessRunner = realSubprocessRunner): boolean {
  try {
    runner.run("git", ["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

/** Async version: True when `branchName` resolves to a local ref in `projectRoot`. */
export async function branchExistsLocalAsync(
  projectRoot: string,
  branchName: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<boolean> {
  try {
    await runner.runAsync("git", ["rev-parse", "--verify", branchName], projectRoot);
    return true;
  } catch {
    return false;
  }
}

/** True when `origin/<branchName>` resolves locally (may be stale vs `ls-remote`). */
export function originTrackingRefResolves(
  projectRoot: string,
  branchName: string,
  runner: SubprocessRunner = realSubprocessRunner,
): boolean {
  try {
    runner.run("git", ["rev-parse", "--verify", `origin/${branchName}`], projectRoot);
    return true;
  } catch {
    return false;
  }
}

/** True when `origin/<branchName>` resolves locally (may be stale vs `ls-remote`). */
export async function originTrackingRefResolvesAsync(
  projectRoot: string,
  branchName: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<boolean> {
  try {
    await runner.runAsync("git", ["rev-parse", "--verify", `origin/${branchName}`], projectRoot);
    return true;
  } catch {
    return false;
  }
}

/** Async version: True when `origin` lists `branchName` per `git ls-remote --heads`. Throws on timeout (inconclusive). */
export async function branchExistsOnOriginAsync(
  projectRoot: string,
  branchName: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<boolean> {
  try {
    const output = await runner.runAsync(
      "git",
      ["ls-remote", "--heads", "origin", branchName],
      projectRoot,
      networkSubprocessOptions({ signal: options.signal }),
    );
    return originHeadListedInLsRemote(output, branchName);
  } catch (error) {
    // A timeout is inconclusive, not absence: callers must not treat a hung origin as "no branch".
    if (isSubprocessTimeout(error)) throw error;
    return false;
  }
}

/** Async version: The checked-out branch name at `cwd`. */
export async function getCurrentBranchAsync(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string> {
  return (await runner.runAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd, runOptions(options))).trim();
}

/** Async version: True when `git status --porcelain` at `cwd` reports any uncommitted changes. */
export async function isWorktreeDirtyAsync(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<boolean> {
  return (await runner.runAsync("git", ["status", "--porcelain"], cwd)).trim().length > 0;
}

/** Async version: True when `cwd` is inside a git working tree; false for plain (git-disabled) directories. */
export async function isGitRepoAsync(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<boolean> {
  try {
    await runner.runAsync("git", ["rev-parse", "--is-inside-work-tree"], cwd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The full HEAD commit hash at `cwd` asynchronously. */
export async function getCurrentHeadAsync(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string> {
  return (await runner.runAsync("git", ["rev-parse", "HEAD"], cwd)).trim();
}

// ---------------------------------------------------------------------------
// Git operations boundary. Jarvis-owned code constructs no Git commands outside this
// file: callers pass semantic arguments and get typed results or a `GitOperationError`.
// Queries (merge-base, diff*, listWorktrees, resolveRef, isInsideWorkTree) are stateless; mutations
// (addWorktree, removeWorktree, pruneWorktrees, createBranch, deleteBranch, updateRef,
// deleteRef, pushBranch) are stateful and document their idempotency below.
// ---------------------------------------------------------------------------

export type GitOperation =
  | "merge-base"
  | "merge-tree"
  | "diff"
  | "worktree-add"
  | "worktree-remove"
  | "worktree-list"
  | "worktree-prune"
  | "branch-create"
  | "branch-delete"
  | "ref-query"
  | "update-ref"
  | "push"
  | "remote-url"
  | "git-dir"
  | "work-tree-query";

/**
 * Why an operation failed. `timeout`, `network`, and `lock` (ref lock-file contention with
 * another git process) are retryable; everything else is fatal for the attempt (`aborted`
 * is the caller's own cancellation). `precondition` names a documented precondition the
 * caller must satisfy first (unmerged branch, dirty or locked worktree, stale `oldOid`);
 * `too-large` is output over the operation's buffer bound; `failed` is any other non-zero exit.
 */
export type GitFailureReason =
  | "timeout"
  | "aborted"
  | "network"
  | "lock"
  | "auth"
  | "rejected"
  | "no-merge-base"
  | "path-exists"
  | "branch-in-use"
  | "precondition"
  | "too-large"
  | "failed";

const RETRYABLE_REASONS: ReadonlySet<GitFailureReason> = new Set(["timeout", "network", "lock"]);

export class GitOperationError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly operation: GitOperation,
    readonly reason: GitFailureReason,
    message: string,
    readonly stderr: string,
    readonly status: number | undefined,
    options?: { cause?: unknown },
  ) {
    super(`git ${operation} ${reason}: ${message}`, options);
    this.name = "GitOperationError";
    this.retryable = RETRYABLE_REASONS.has(reason);
  }
}

/** True when `error` is a `GitOperationError` worth retrying (timeout or network). */
export function isRetryableGitError(error: unknown): boolean {
  return error instanceof GitOperationError && error.retryable;
}

type Failure = { message: string; stderr: string; status: number | undefined; timeout: boolean; tooLarge: boolean };

const MAX_BUFFER_CODE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

/** Normalizes an async (`AsyncSubprocessError`) or sync (`execFileSync`-shaped) rejection. */
function failureOf(error: unknown): Failure {
  if (error instanceof AsyncSubprocessError) {
    return {
      message: error.message,
      stderr: error.stderr,
      status: error.status,
      timeout: isSubprocessTimeout(error),
      tooLarge: error.code === MAX_BUFFER_CODE,
    };
  }
  const shaped = error as { stderr?: unknown; status?: unknown; code?: unknown } | null;
  const stderr = shaped?.stderr;
  return {
    message: error instanceof Error ? error.message : String(error),
    stderr:
      typeof stderr === "string" ? stderr : stderr instanceof Uint8Array ? Buffer.from(stderr).toString("utf8") : "",
    status: typeof shaped?.status === "number" ? shaped.status : undefined,
    timeout: shaped?.code === "ETIMEDOUT",
    tooLarge: shaped?.code === MAX_BUFFER_CODE,
  };
}

type ReasonRule = readonly [RegExp, GitFailureReason];
type OperationOptions = { signal?: AbortSignal | undefined };

/** Maps a runner rejection to `GitOperationError`: timeout/abort first, then `rules` against stderr+message, else `failed`. */
function gitError(
  operation: GitOperation,
  error: unknown,
  rules: readonly ReasonRule[],
  options: OperationOptions,
): GitOperationError {
  const failure = failureOf(error);
  const text = `${failure.message}\n${failure.stderr}`;
  const reason: GitFailureReason = failure.timeout
    ? "timeout"
    : options.signal?.aborted
      ? "aborted"
      : failure.tooLarge
        ? "too-large"
        : (rules.find(([pattern]) => pattern.test(text))?.[1] ?? "failed");
  const detail = failure.stderr.trim().split("\n")[0] || failure.message;
  return new GitOperationError(operation, reason, detail, failure.stderr, failure.status, { cause: error });
}

/** True when the rejection matches one of `patterns` (stderr or message). */
function failureMatches(error: unknown, pattern: RegExp): boolean {
  const failure = failureOf(error);
  return !failure.timeout && pattern.test(`${failure.message}\n${failure.stderr}`);
}

function runOptions(options: OperationOptions, extra: AsyncSubprocessOptions = {}): AsyncSubprocessOptions {
  return options.signal !== undefined ? { ...extra, signal: options.signal } : extra;
}

/** Ref lock-file contention with a concurrent git process: transient, retry after it exits. */
const LOCK_RULE: ReasonRule = [
  /Unable to create '.*\.lock': File exists|could not lock|cannot lock ref '[^']*': (?!is at)/,
  "lock",
];

/** Same filesystem location, through symlinks (macOS `/tmp` → `/private/tmp`) when both exist. */
function samePath(a: string, b: string): boolean {
  const canonical = (path: string) => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  return canonical(a) === canonical(b);
}

// --- diff --------------------------------------------------------------------

/** Two-dot diff bounds. For `base...head` semantics resolve `mergeBase` first and pass it as `from`. */
export type DiffRange = { from: string; to: string };

const OID_PATTERN = /^[0-9a-f]{40,64}$/;

/**
 * Stdout bound for diff output (64 MiB; the runner's default is Node's 1 MiB). Larger output
 * rejects with reason `too-large`: callers wanting a bounded excerpt use `diffStat` /
 * `diffNameOnly` instead of the unified patch.
 */
export const DIFF_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * `git merge-base a b` as a full OID. Rejects with operation `merge-base`: reason
 * `no-merge-base` when the histories share no ancestor (exit 1, silent), `failed` when a
 * ref does not resolve — distinct from any `diff` failure so callers can tell them apart.
 */
export async function mergeBase(
  cwd: string,
  a: string,
  b: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string> {
  let output: string;
  try {
    output = await runner.runAsync("git", ["merge-base", a, b], cwd, runOptions(options));
  } catch (error) {
    const failure = failureOf(error);
    const silentExitOne = failure.status === 1 && !failure.timeout && failure.stderr.trim() === "";
    throw silentExitOne
      ? new GitOperationError("merge-base", "no-merge-base", `${a} and ${b} share no ancestor`, "", 1, { cause: error })
      : gitError("merge-base", error, [], options);
  }
  const oid = output.trim();
  if (!OID_PATTERN.test(oid)) {
    throw new GitOperationError("merge-base", "failed", `unexpected merge-base output ${JSON.stringify(oid)}`, "", 0);
  }
  return oid;
}

/** Soft boolean matching `git merge-base --is-ancestor` (exit 1 → false; stdio ignored). */
export async function isAncestor(
  cwd: string,
  ancestor: string,
  descendant: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<boolean> {
  try {
    await runner.runAsync(
      "git",
      ["merge-base", "--is-ancestor", ancestor, descendant],
      cwd,
      runOptions(options, { stdio: "ignore" }),
    );
    return true;
  } catch {
    return false;
  }
}

/** First-line tree OID from `git merge-tree --write-tree base head`. */
export async function mergeTreeWriteTree(
  cwd: string,
  baseRef: string,
  headRef: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string> {
  let output: string;
  try {
    output = await runner.runAsync("git", ["merge-tree", "--write-tree", baseRef, headRef], cwd, runOptions(options));
  } catch (error) {
    throw gitError("merge-tree", error, [], options);
  }
  const oid = output.split("\n")[0]?.trim() ?? "";
  if (!OID_PATTERN.test(oid)) {
    throw new GitOperationError("merge-tree", "failed", `unexpected merge-tree output ${JSON.stringify(oid)}`, "", 0);
  }
  return oid;
}

async function runDiff(
  cwd: string,
  args: string[],
  runner: AsyncSubprocessRunner,
  options: OperationOptions,
): Promise<string> {
  try {
    return await runner.runAsync("git", ["diff", ...args], cwd, runOptions(options, { maxBuffer: DIFF_MAX_BUFFER }));
  } catch (error) {
    throw gitError("diff", error, [], options);
  }
}

/** `git diff --stat from to`, trimmed; empty string when nothing changed. */
export async function diffStat(
  cwd: string,
  range: DiffRange,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string> {
  return (await runDiff(cwd, ["--stat", range.from, range.to], runner, options)).trim();
}

function sortedNonemptyDiffPaths(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Changed paths between `from` and `to`, sorted by code unit (deterministic across runs). */
export async function diffNameOnly(
  cwd: string,
  range: DiffRange,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string[]> {
  return sortedNonemptyDiffPaths(await runDiff(cwd, ["--name-only", range.from, range.to], runner, options));
}

/** Changed paths for a single revision range token (e.g. `base..head` or `base...head`). */
export async function diffNameOnlyRevision(
  cwd: string,
  revision: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string[]> {
  return sortedNonemptyDiffPaths(await runDiff(cwd, ["--name-only", revision], runner, options));
}

/** Unmerged paths in the index/worktree (`git diff --name-only --diff-filter=U`). */
export async function unmergedPathNames(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string[]> {
  const output = await runDiff(cwd, ["--name-only", "--diff-filter=U"], runner, options);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Stateful worktree rewrite: run `runArgs`, then on failure list unmerged paths and best-effort
 * `abortArgs` (abort failure does not change the returned conflict paths).
 */
async function abortableWorktreeRewrite(
  cwd: string,
  runArgs: string[],
  abortArgs: string[],
  runner: AsyncSubprocessRunner,
  options: OperationOptions,
): Promise<string[] | undefined> {
  try {
    await runner.runAsync("git", runArgs, cwd, runOptions(options));
    return undefined;
  } catch {
    let conflictPaths: string[];
    try {
      conflictPaths = await unmergedPathNames(cwd, runner, options);
    } catch {
      conflictPaths = [];
    }
    try {
      await runner.runAsync("git", abortArgs, cwd, runOptions(options));
    } catch {
      // best effort — conflictPaths were captured before abort
    }
    return conflictPaths;
  }
}

/** `git rebase <onto>` in `cwd`; `undefined` on success, conflicting paths after abort on failure. */
export async function abortableWorktreeRebase(
  cwd: string,
  onto: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string[] | undefined> {
  return abortableWorktreeRewrite(cwd, ["rebase", onto], ["rebase", "--abort"], runner, options);
}

/** `git merge --no-edit <ref>` in `cwd`; `undefined` on success, conflicting paths after abort on failure. */
export async function abortableWorktreeMergeNoEdit(
  cwd: string,
  ref: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string[] | undefined> {
  return abortableWorktreeRewrite(cwd, ["merge", "--no-edit", ref], ["merge", "--abort"], runner, options);
}

/** Raw unified diff between `from` and `to` (not trimmed: the trailing newline is part of the patch). */
export async function diffUnified(
  cwd: string,
  range: DiffRange,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string> {
  return runDiff(cwd, [range.from, range.to], runner, options);
}

export type BranchDiff = { mergeBase: string; stat: string; changedPaths: string[]; unified: string };

/**
 * Review-context diff of `headRef` against its merge-base with `baseRef`: stat summary,
 * sorted changed paths, and the unified patch. A merge-base failure surfaces as the
 * `merge-base` operation; later failures as `diff`.
 */
export async function branchDiff(
  cwd: string,
  baseRef: string,
  headRef = "HEAD",
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<BranchDiff> {
  const base = await mergeBase(cwd, baseRef, headRef, runner, options);
  const range: DiffRange = { from: base, to: headRef };
  const [stat, changedPaths, unified] = await Promise.all([
    diffStat(cwd, range, runner, options),
    diffNameOnly(cwd, range, runner, options),
    diffUnified(cwd, range, runner, options),
  ]);
  return { mergeBase: base, stat, changedPaths, unified };
}

// --- worktrees ---------------------------------------------------------------

export type WorktreeEntry = {
  path: string;
  /** Full HEAD OID; absent for a bare entry. */
  head?: string;
  /** Short branch name (`refs/heads/` stripped); absent when detached or bare. */
  branch?: string;
  detached: boolean;
  bare: boolean;
  /** Lock reason, or `""` when locked without one. */
  locked?: string;
  /** Prunable reason as git reports it. */
  prunable?: string;
};

function applyWorktreeAttribute(entry: WorktreeEntry, line: string): void {
  const space = line.indexOf(" ");
  const key = space === -1 ? line : line.slice(0, space);
  const value = space === -1 ? "" : line.slice(space + 1);
  if (key === "HEAD") entry.head = value;
  else if (key === "branch") entry.branch = value.startsWith("refs/heads/") ? value.slice("refs/heads/".length) : value;
  else if (key === "detached") entry.detached = true;
  else if (key === "bare") entry.bare = true;
  else if (key === "locked") entry.locked = value;
  else if (key === "prunable") entry.prunable = value;
}

/** One porcelain block (`worktree <path>` then attribute lines); undefined for a blank block. */
function parseWorktreeBlock(block: string): WorktreeEntry | undefined {
  const lines = block.split("\n").filter((line) => line.length > 0);
  const first = lines[0];
  if (first === undefined) return undefined;
  if (!first.startsWith("worktree ")) throw new Error(`Malformed worktree listing: ${JSON.stringify(first)}`);
  const entry: WorktreeEntry = { path: first.slice("worktree ".length), detached: false, bare: false };
  for (const line of lines.slice(1)) applyWorktreeAttribute(entry, line);
  return entry;
}

/** Parses `git worktree list --porcelain`; rejects a block that does not start with `worktree <path>`. */
function parseWorktreePorcelain(output: string): WorktreeEntry[] {
  return output
    .split(/\n\n+/)
    .map(parseWorktreeBlock)
    .filter((entry): entry is WorktreeEntry => entry !== undefined);
}

/** Registered worktrees of the repository containing `cwd`, main worktree first (git's order). */
export async function listWorktrees(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<WorktreeEntry[]> {
  try {
    return parseWorktreePorcelain(
      await runner.runAsync("git", ["worktree", "list", "--porcelain"], cwd, runOptions(options)),
    );
  } catch (error) {
    throw gitError("worktree-list", error, [], options);
  }
}

export type WorktreeAddResult = { status: "added" } | { status: "already-registered" };

const WORKTREE_ADD_RULES: readonly ReasonRule[] = [
  [/already exists/, "path-exists"],
  [/is already (?:used by|checked out)/, "branch-in-use"],
];

/**
 * `git worktree add <path> <branch>` for an existing local branch. Idempotent for the
 * exact (path, branch) pair: when git refuses because the path or branch is taken and the
 * listing shows `path` (compared through symlinks) already registered on `branch`, resolves
 * `already-registered`. Any other refusal rejects with `path-exists`, `branch-in-use`, or
 * `failed`; a listing failure during that check rethrows the original add classification.
 */
export async function addWorktree(
  cwd: string,
  target: { path: string; branch: string },
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<WorktreeAddResult> {
  try {
    await runner.runAsync("git", ["worktree", "add", target.path, target.branch], cwd, runOptions(options));
    return { status: "added" };
  } catch (error) {
    const failure = gitError("worktree-add", error, WORKTREE_ADD_RULES, options);
    if (failure.reason !== "path-exists" && failure.reason !== "branch-in-use") throw failure;
    let entries: WorktreeEntry[];
    try {
      entries = await listWorktrees(cwd, runner, options);
    } catch {
      throw failure;
    }
    if (entries.some((entry) => entry.branch === target.branch && samePath(entry.path, target.path))) {
      return { status: "already-registered" };
    }
    throw failure;
  }
}

export type WorktreeRemoveResult = { status: "removed" } | { status: "absent" };

const WORKTREE_REMOVE_RULES: readonly ReasonRule[] = [
  [/contains modified or untracked files/, "precondition"],
  [/locked working tree/, "precondition"],
];

/**
 * `git worktree remove [--force --force] <path>`. Idempotent: an unregistered path resolves
 * `absent`; a registered path whose directory is already gone resolves `removed`. A dirty
 * or locked worktree rejects with `precondition` unless `force` is set (passed twice: git
 * needs the second `--force` to override a lock).
 */
export async function removeWorktree(
  cwd: string,
  path: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions & { force?: boolean } = {},
): Promise<WorktreeRemoveResult> {
  const args = options.force ? ["worktree", "remove", "--force", "--force", path] : ["worktree", "remove", path];
  try {
    await runner.runAsync("git", args, cwd, runOptions(options));
    return { status: "removed" };
  } catch (error) {
    if (failureMatches(error, /is not a working tree/)) return { status: "absent" };
    throw gitError("worktree-remove", error, WORKTREE_REMOVE_RULES, options);
  }
}

/** `git worktree prune`: drops registrations whose directories are gone. Idempotent; nothing to prune is success. */
export async function pruneWorktrees(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<void> {
  try {
    await runner.runAsync("git", ["worktree", "prune"], cwd, runOptions(options));
  } catch (error) {
    throw gitError("worktree-prune", error, [], options);
  }
}

// --- branches, refs, push ----------------------------------------------------

export type BranchCreateResult = { status: "created" } | { status: "exists" };

/**
 * `git branch <name> <startPoint>`. Resolves `exists` when the branch already exists
 * (wherever it points: callers needing a specific tip compare with `resolveRef`).
 */
export async function createBranch(
  cwd: string,
  name: string,
  startPoint: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<BranchCreateResult> {
  try {
    await runner.runAsync("git", ["branch", name, startPoint], cwd, runOptions(options));
    return { status: "created" };
  } catch (error) {
    if (failureMatches(error, /already exists/)) return { status: "exists" };
    throw gitError("branch-create", error, [LOCK_RULE], options);
  }
}

export type BranchDeleteResult = { status: "deleted" } | { status: "absent" };

/**
 * `git branch -d|-D <name>`. Idempotent: a missing branch resolves `absent`. Without
 * `force`, an unmerged branch rejects with `precondition`; a branch checked out in any
 * worktree rejects with `branch-in-use` even under `force` (remove the worktree first).
 */
export async function deleteBranch(
  cwd: string,
  name: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions & { force?: boolean } = {},
): Promise<BranchDeleteResult> {
  try {
    await runner.runAsync("git", ["branch", options.force ? "-D" : "-d", name], cwd, runOptions(options));
    return { status: "deleted" };
  } catch (error) {
    if (failureMatches(error, /not found/)) return { status: "absent" };
    throw gitError(
      "branch-delete",
      error,
      [[/not fully merged/, "precondition"], [/checked out at/, "branch-in-use"], LOCK_RULE],
      options,
    );
  }
}

export type RefResolution = { status: "resolved"; oid: string } | { status: "absent" };

/**
 * `git rev-parse --verify --quiet <ref>` (unpeeled: a ref to any object resolves). `absent` only on git's silent exit 1;
 * any other failure (not a repository, timeout, abort) is inconclusive and rejects with
 * operation `ref-query`, so a hung or broken query is never mistaken for a missing ref.
 */
export async function resolveRef(
  cwd: string,
  ref: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<RefResolution> {
  try {
    const oid = (
      await runner.runAsync("git", ["rev-parse", "--verify", "--quiet", ref], cwd, runOptions(options))
    ).trim();
    return { status: "resolved", oid };
  } catch (error) {
    const failure = failureOf(error);
    if (failure.status === 1 && !failure.timeout && failure.stderr.trim() === "") return { status: "absent" };
    throw gitError("ref-query", error, [], options);
  }
}

const ABSENT_REF_PATH_PATTERN =
  /not a valid object name|does not exist in|not a valid tree|path .* does not exist|bad revision|ambiguous argument/i;

/** True when git rejected a ref:path or tree read because the object or path is missing. */
function absentRefPathFailure(error: unknown): boolean {
  const failure = failureOf(error);
  if (failure.timeout || failure.tooLarge) return false;
  const text = `${failure.message}\n${failure.stderr}`;
  return failure.status === 128 || (failure.status === 1 && ABSENT_REF_PATH_PATTERN.test(text));
}

export type TreeChildAtRef = {
  mode: string;
  type: "blob" | "tree" | "commit";
  oid: string;
  name: string;
};

function parseLsTreeZEntries(output: string): TreeChildAtRef[] {
  const entries: TreeChildAtRef[] = [];
  for (const entry of output.split("\0")) {
    if (entry.length === 0) continue;
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const meta = entry.slice(0, tab).split(" ");
    const mode = meta[0];
    const type = meta[1];
    const oid = meta[2];
    if (mode === undefined || type === undefined || oid === undefined) continue;
    if (type !== "blob" && type !== "tree" && type !== "commit") continue;
    entries.push({ mode, type, oid, name: entry.slice(tab + 1) });
  }
  return entries;
}

/** Non-recursive `git ls-tree` at `ref:treePath`; `undefined` when that tree is absent. */
export async function listTreeChildrenAtRef(
  cwd: string,
  ref: string,
  treePath: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<TreeChildAtRef[] | undefined> {
  const object = treePath.length === 0 ? ref : `${ref}:${treePath}`;
  try {
    const output = await runner.runAsync("git", ["ls-tree", "-z", object], cwd, runOptions(options));
    return parseLsTreeZEntries(output);
  } catch (error) {
    if (absentRefPathFailure(error)) return undefined;
    throw gitError("ref-query", error, [], options);
  }
}

/** Recursive `git ls-tree --name-only` under `prefix` at `ref`; `undefined` when unreadable. */
export async function listRecursivePathsAtRef(
  cwd: string,
  ref: string,
  prefix: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string[] | undefined> {
  try {
    const output = await runner.runAsync(
      "git",
      ["ls-tree", "-r", "-z", "--name-only", ref, "--", prefix],
      cwd,
      runOptions(options),
    );
    return output.split("\0").filter((line) => line.length > 0);
  } catch (error) {
    if (absentRefPathFailure(error)) return undefined;
    throw gitError("ref-query", error, [], options);
  }
}

/** `git show ref:path` as UTF-8 text; `undefined` when the blob is absent. */
export async function readBlobAtRef(
  cwd: string,
  ref: string,
  path: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string | undefined> {
  try {
    return await runner.runAsync("git", ["show", `${ref}:${path}`], cwd, runOptions(options));
  } catch (error) {
    if (absentRefPathFailure(error)) return undefined;
    throw gitError("ref-query", error, [], options);
  }
}

/** `git rev-list --count base..head` as a non-negative integer. */
export async function countCommitsBetween(
  cwd: string,
  baseRef: string,
  headRef: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<number> {
  try {
    const output = await runner.runAsync(
      "git",
      ["rev-list", "--count", `${baseRef}..${headRef}`],
      cwd,
      runOptions(options),
    );
    return Number.parseInt(output.trim(), 10);
  } catch (error) {
    throw gitError("ref-query", error, [], options);
  }
}

/** `git log base..head -p --format=%H -- path` for path-scoped patch history (tick-backing). */
export async function logPatchForPathInRange(
  cwd: string,
  baseRef: string,
  headRef: string,
  path: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string> {
  try {
    return await runner.runAsync(
      "git",
      ["log", `${baseRef}..${headRef}`, "-p", "--format=%H", "--", path],
      cwd,
      runOptions(options, { maxBuffer: DIFF_MAX_BUFFER }),
    );
  } catch (error) {
    throw gitError("ref-query", error, [], options);
  }
}

export type LocalBranchHead = { branch: string; oid: string };

/** Local `refs/heads/*` short names with tip OIDs. */
export async function listLocalBranchHeads(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<LocalBranchHead[]> {
  let output: string;
  try {
    output = await runner.runAsync(
      "git",
      ["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/"],
      cwd,
      runOptions(options),
    );
  } catch (error) {
    throw gitError("ref-query", error, [], options);
  }
  const heads: LocalBranchHead[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const space = trimmed.lastIndexOf(" ");
    if (space <= 0) continue;
    heads.push({ branch: trimmed.slice(0, space), oid: trimmed.slice(space + 1) });
  }
  return heads;
}

/**
 * `git update-ref <ref> <newOid> [<oldOid>]`. Stateful; with `oldOid` it is a
 * compare-and-swap that rejects `precondition` when the ref moved. Lock-file contention
 * with another git process is the retryable `lock`.
 */
export async function updateRef(
  cwd: string,
  ref: string,
  newOid: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions & { oldOid?: string } = {},
): Promise<void> {
  const args = options.oldOid === undefined ? ["update-ref", ref, newOid] : ["update-ref", ref, newOid, options.oldOid];
  try {
    await runner.runAsync("git", args, cwd, runOptions(options));
  } catch (error) {
    throw gitError("update-ref", error, [[/is at .* but expected/, "precondition"], LOCK_RULE], options);
  }
}

export type RefDeleteResult = { status: "deleted" } | { status: "absent" };

/**
 * `git update-ref -d <ref>` after a `resolveRef` check, so the caller learns whether
 * anything was deleted (git itself exits 0 for a missing ref). Idempotent.
 */
export async function deleteRef(
  cwd: string,
  ref: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<RefDeleteResult> {
  if ((await resolveRef(cwd, ref, runner, options)).status === "absent") return { status: "absent" };
  try {
    await runner.runAsync("git", ["update-ref", "-d", ref], cwd, runOptions(options));
    return { status: "deleted" };
  } catch (error) {
    throw gitError("update-ref", error, [LOCK_RULE], options);
  }
}

export type PushResult = { status: "pushed" } | { status: "already-absent" };

// Order matters: a GitHub HTTPS 401/403 also says "unable to access", so auth is tested first.
const PUSH_RULES: readonly ReasonRule[] = [
  [
    /Authentication failed|Permission (?:to .* )?denied|could not read Username|returned error: 40[13]|HTTP 40[13]/i,
    "auth",
  ],
  [/Could not resolve host|Connection (?:timed out|refused|reset)|unable to access|early EOF|RPC failed/i, "network"],
  [/\[rejected\]|failed to push some refs|non-fast-forward/i, "rejected"],
];

/**
 * `git push [-u] <remote> <branch>` or `git push <remote> --delete <branch>`, bounded by
 * the network timeout and non-interactive env. Retryable: `timeout`, `network`. Fatal:
 * `auth`, `rejected` (non-fast-forward: the caller must reconcile, never force), `failed`.
 * Deleting a branch the remote no longer has resolves `already-absent` (idempotent).
 */
export async function pushBranch(
  cwd: string,
  target: {
    branch: string;
    remote?: string;
    setUpstream?: boolean;
    delete?: boolean;
    forceWithLease?: string;
  },
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<PushResult> {
  const remote = target.remote ?? "origin";
  const args = target.delete
    ? ["push", remote, "--delete", target.branch]
    : target.forceWithLease !== undefined
      ? ["push", `--force-with-lease=${target.forceWithLease}`, remote, target.branch]
      : ["push", ...(target.setUpstream ? ["-u"] : []), remote, target.branch];
  try {
    await runner.runAsync("git", args, cwd, networkSubprocessOptions({ signal: options.signal }));
    return { status: "pushed" };
  } catch (error) {
    if (target.delete && failureMatches(error, /remote ref does not exist/i)) return { status: "already-absent" };
    throw gitError("push", error, PUSH_RULES, options);
  }
}

/** `git ls-remote <remote> <ref>`; `undefined` when the ref is absent (empty output). */
export async function lsRemoteRef(
  cwd: string,
  remote: string,
  ref: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string | undefined> {
  try {
    const output = (
      await runner.runAsync(
        "git",
        ["ls-remote", remote, ref],
        cwd,
        networkSubprocessOptions({ signal: options.signal }),
      )
    ).trim();
    const tip = output.split(/\s+/)[0];
    return tip !== undefined && tip.length > 0 ? tip : undefined;
  } catch (error) {
    throw gitError("ref-query", error, PUSH_RULES, options);
  }
}

export type RemoteUrlResult = { status: "resolved"; url: string } | { status: "absent" };

/** `git remote get-url <name>`; `absent` when the remote is missing or git reports no URL. */
export async function remoteUrl(
  cwd: string,
  remote: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<RemoteUrlResult> {
  try {
    const url = (await runner.runAsync("git", ["remote", "get-url", remote], cwd, runOptions(options))).trim();
    return url.length > 0 ? { status: "resolved", url } : { status: "absent" };
  } catch (error) {
    if (failureMatches(error, /No such remote/i)) return { status: "absent" };
    throw gitError("remote-url", error, [], options);
  }
}

// --- repository paths --------------------------------------------------------

/**
 * Absolute per-worktree git dir (`rev-parse --absolute-git-dir`): `<repo>/.git` for the main
 * worktree, `<repo>/.git/worktrees/<name>` for a linked one. Synchronous for root scripts;
 * throws `GitOperationError` (`git-dir`) outside a repository.
 */
export function gitDir(cwd: string, runner: SubprocessRunner = realSubprocessRunner): string {
  try {
    return runner.run("git", ["rev-parse", "--absolute-git-dir"], cwd).trim();
  } catch (error) {
    throw gitError("git-dir", error, [], {});
  }
}

/** Absolute common git dir shared by every worktree of the repository containing `cwd`. */
export async function gitCommonDir(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<string> {
  try {
    const output = await runner.runAsync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      cwd,
      runOptions(options),
    );
    return resolve(output.trim());
  } catch (error) {
    throw gitError("git-dir", error, [], options);
  }
}

/** True when git's diagnostic says the path is not a usable repo; git >=2.56 reports broken gitfiles differently. */
export function isNotGitRepositoryDiagnostic(text: string): boolean {
  return text.includes("not a git repository") || text.includes("gitfile does not point to a valid repository");
}

/**
 * `git rev-parse --is-inside-work-tree` at `cwd`: `true` inside a working tree, `false` when git
 * reports no repository there (including a broken gitfile) or answers `false` (inside `.git`).
 * A timeout or the caller's abort is inconclusive even when stderr carries that diagnostic. Any
 * other failure is inconclusive and rejects with operation `work-tree-query`, unlike the soft
 * `isGitRepoAsync`, so callers never mistake a broken probe for a plain directory.
 */
export async function isInsideWorkTree(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  options: OperationOptions = {},
): Promise<boolean> {
  try {
    const output = await runner.runAsync("git", ["rev-parse", "--is-inside-work-tree"], cwd, runOptions(options));
    return output.trim() === "true";
  } catch (error) {
    const failure = failureOf(error);
    const conclusive = !failure.timeout && options.signal?.aborted !== true;
    if (conclusive && isNotGitRepositoryDiagnostic(`${failure.message}\n${failure.stderr}`)) return false;
    throw gitError("work-tree-query", error, [], options);
  }
}
