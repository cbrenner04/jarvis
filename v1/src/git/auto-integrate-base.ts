import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type SyncTransientRetryOptions, withSyncTransientRetry } from "../gh.ts";
import { getCurrentHeadSha, type RunReadyAndCommitOpts, runReadyAndCommit } from "../ready-gate.ts";
import { pushCurrent } from "../worktree.ts";
import { writeReadyFlipBlocked } from "./base-current.ts";

export type AutoIntegrateBaseResult = "integrated" | "blocked";

export type AutoIntegrateBaseOpts = {
  branch: string;
  cwd: string;
  baseRefName: string;
  agentLabel: string;
  timeoutMs: number;
  readyCommand?: string;
  fixCommand?: string;
  stderr?: (s: string) => void;
  warn?: (message: string) => void;
  /** Test seam: read porcelain output. */
  readPorcelain?: (cwd: string) => string;
  /** Test seam: read HEAD sha. */
  getHeadSha?: (cwd: string) => string;
  /** Test seam: merge `origin/<base>` into HEAD. Throws on conflict. */
  mergeOriginBase?: (baseRefName: string, cwd: string) => void;
  /** Test seam: abort an in-progress merge. */
  abortMerge?: (cwd: string) => void;
  /** Test seam: hard-reset to a sha. */
  resetHard?: (sha: string, cwd: string) => void;
  /** Test seam: whether a merge is in progress. */
  isMergeInProgress?: (cwd: string) => boolean;
  /** Test seam: run the post-merge `full` ready gate. */
  runFullGate?: (opts: RunReadyAndCommitOpts) => void;
  /** Test seam: push the current branch. */
  pushCurrentFn?: (cwd: string) => void;
  /** Test seam: `gh pr ready`. */
  ghPrReady?: (branch: string, cwd: string) => void;
  ghPrReadyRetryOpts?: Partial<SyncTransientRetryOptions>;
  runFix?: RunReadyAndCommitOpts["runFix"];
  runReady?: RunReadyAndCommitOpts["runReady"];
  commitPreReadyFix?: RunReadyAndCommitOpts["commitPreReadyFix"];
  commitPostVerification?: RunReadyAndCommitOpts["commitPostVerification"];
  refreshRecordedGreenResult?: (headSha: string) => void;
};

function readPorcelainDefault(cwd: string): string {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function isMergeInProgressDefault(cwd: string): boolean {
  return existsSync(join(cwd, ".git", "MERGE_HEAD"));
}

function mergeOriginBaseDefault(baseRefName: string, cwd: string): void {
  execFileSync("git", ["merge", "--no-edit", `origin/${baseRefName}`], {
    cwd,
    env: process.env,
    stdio: "pipe",
  });
}

function abortMergeDefault(cwd: string): void {
  execFileSync("git", ["merge", "--abort"], {
    cwd,
    env: process.env,
    stdio: "pipe",
  });
}

function resetHardDefault(sha: string, cwd: string): void {
  execFileSync("git", ["reset", "--hard", sha], {
    cwd,
    env: process.env,
    stdio: "pipe",
  });
}

function restorePreMergeHead(opts: {
  cwd: string;
  preMergeHead: string;
  abortMerge: (cwd: string) => void;
  resetHard: (sha: string, cwd: string) => void;
  isMergeInProgress: (cwd: string) => boolean;
}): void {
  if (opts.isMergeInProgress(opts.cwd)) {
    opts.abortMerge(opts.cwd);
    return;
  }
  opts.resetHard(opts.preMergeHead, opts.cwd);
}

function isMergeConflict(err: unknown): boolean {
  const exitCode = (err as NodeJS.ErrnoException & { status?: number }).status;
  return exitCode !== undefined && exitCode !== 0;
}

/**
 * Conflict-free behind-base integration at enabled finalize sites: merge
 * `origin/<base>`, run a post-merge `full` gate, push, then `gh pr ready`.
 * On dirty porcelain, merge conflict, or gate failure: block ready flip and
 * restore the pre-merge tree when applicable.
 */
export function tryAutoIntegrateBase(opts: AutoIntegrateBaseOpts): AutoIntegrateBaseResult {
  const stderr = opts.stderr ?? process.stderr.write.bind(process.stderr);
  const warn = opts.warn ?? ((message: string) => stderr(`warning: ${message}\n`));
  const readPorcelain = opts.readPorcelain ?? readPorcelainDefault;
  const getHeadSha = opts.getHeadSha ?? getCurrentHeadSha;
  const mergeOriginBase = opts.mergeOriginBase ?? mergeOriginBaseDefault;
  const abortMerge = opts.abortMerge ?? abortMergeDefault;
  const resetHard = opts.resetHard ?? resetHardDefault;
  const isMergeInProgress = opts.isMergeInProgress ?? isMergeInProgressDefault;
  const pushCurrentFn = opts.pushCurrentFn ?? ((cwd: string) => pushCurrent({ cwd, firstPush: false }));
  const runFullGate =
    opts.runFullGate ??
    ((gateOpts: RunReadyAndCommitOpts) => {
      runReadyAndCommit(gateOpts);
    });

  if (readPorcelain(opts.cwd) !== "") {
    writeReadyFlipBlocked(stderr, opts.branch, opts.baseRefName);
    return "blocked";
  }

  const preMergeHead = getHeadSha(opts.cwd);

  try {
    mergeOriginBase(opts.baseRefName, opts.cwd);
  } catch (err) {
    if (isMergeConflict(err)) {
      try {
        abortMerge(opts.cwd);
      } catch {
        // best-effort
      }
      writeReadyFlipBlocked(stderr, opts.branch, opts.baseRefName);
      return "blocked";
    }
    throw err;
  }

  try {
    runFullGate({
      cwd: opts.cwd,
      tier: "full",
      agentLabel: opts.agentLabel,
      timeoutMs: opts.timeoutMs,
      ...(opts.readyCommand !== undefined ? { readyCommand: opts.readyCommand } : {}),
      ...(opts.fixCommand !== undefined ? { fixCommand: opts.fixCommand } : {}),
      ...(opts.runFix !== undefined ? { runFix: opts.runFix } : {}),
      ...(opts.runReady !== undefined ? { runReady: opts.runReady } : {}),
      ...(opts.commitPreReadyFix !== undefined ? { commitPreReadyFix: opts.commitPreReadyFix } : {}),
      ...(opts.commitPostVerification !== undefined ? { commitPostVerification: opts.commitPostVerification } : {}),
    });
  } catch {
    restorePreMergeHead({
      cwd: opts.cwd,
      preMergeHead,
      abortMerge,
      resetHard,
      isMergeInProgress,
    });
    writeReadyFlipBlocked(stderr, opts.branch, opts.baseRefName);
    return "blocked";
  }

  try {
    pushCurrentFn(opts.cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`failed to push after base integration: ${message}`);
    writeReadyFlipBlocked(stderr, opts.branch, opts.baseRefName);
    return "blocked";
  }

  const ghPrReadyFn =
    opts.ghPrReady ??
    ((readyBranch: string, cwd: string) => {
      withSyncTransientRetry(
        () => {
          execFileSync("gh", ["pr", "ready", readyBranch], {
            cwd,
            env: process.env,
            stdio: "pipe",
          });
        },
        { op: "gh pr ready", isPrReady: true, ...opts.ghPrReadyRetryOpts },
      );
    });

  try {
    ghPrReadyFn(opts.branch, opts.cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warn(`failed to mark PR ready after base integration: ${message}`);
    return "blocked";
  }

  if (opts.refreshRecordedGreenResult !== undefined) {
    opts.refreshRecordedGreenResult(getHeadSha(opts.cwd));
  }

  return "integrated";
}
