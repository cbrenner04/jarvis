import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { type OutcomeKind, openStateStore, type RunStatus, type StateStore } from "./state-store.ts";
import type { StepRunResult } from "./step-runner.ts";
import { executeWrite, type WriteExecuteInput } from "./write.ts";
import { renderWriteShrinkRules } from "./write-prompt.ts";

/** Classification of a loop outcome. */
export type WriteLoopOutcomeKind =
  | "complete"
  | "progress"
  | "blocked"
  | "contract_miss"
  | "invocation_failure"
  | "budget-exhausted";

/** Result of a write loop invocation. */
export type WriteLoopResult = {
  kind: WriteLoopOutcomeKind;
  runId: string;
  iterationsConsumed: number;
  resumable: boolean;
};

type ShrinkValidator = (args: { worktreePath: string; committedHead: string }) => void;

/** Input for the write loop. Run identity derives from `worktree` (project, branch, base). */
export type WriteLoopInput = WriteExecuteInput & {
  maxIterations?: number;
  stateStore?: StateStore;
  shrinkValidator?: ShrinkValidator;
};

const DEFAULT_MAX_ITERATIONS = 10;
type StoredRun = NonNullable<ReturnType<StateStore["loadRun"]>>;
type PreparedRun =
  | { runId: string; worktreePath: string; resumedAttemptId: string | null; runBaseRef: string }
  | { result: WriteLoopResult };

/**
 * Execute a resumable write loop: repeatedly call executeWrite until work is
 * done, blocked, or budget runs out, persisting run + per-iteration attempt
 * rows through the state store.
 */
export async function executeWriteLoop(args: WriteLoopInput): Promise<WriteLoopResult> {
  const store = args.stateStore ?? openStateStore();
  const maxIterations = args.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const shrinkValidator = args.shrinkValidator ?? validateShrinkResult;

  try {
    const prepared = prepareRun(args, store);
    if ("result" in prepared) return prepared.result;
    const { runId, worktreePath, runBaseRef } = prepared;
    let iterationsConsumed = 0;
    let resumedAttemptId = prepared.resumedAttemptId;

    store.setRunStatus(runId, "in-progress");

    while (iterationsConsumed < maxIterations) {
      if (args.signal?.aborted) {
        return { kind: "progress", runId, iterationsConsumed, resumable: true };
      }

      const attemptId = resumedAttemptId ?? store.recordAttemptStart(runId);
      resumedAttemptId = null;
      const { result } = await executeWrite(args);
      iterationsConsumed += 1;

      if (result.kind === "progress") {
        store.commitCompletionBoundary({ attemptId, runStatus: "in-progress", outcomeKind: "progress" });
        continue;
      }

      if (result.kind === "contract_miss") {
        appendBlockerToSpec(resolveSpecPath(worktreePath, args.specPath), result.failedContractId);
      }

      const terminal = terminalMapping(result);
      store.commitCompletionBoundary({ attemptId, runStatus: terminal.runStatus, outcomeKind: terminal.outcomeKind });
      if (terminal.kind !== "complete") {
        return { kind: terminal.kind, runId, iterationsConsumed, resumable: false };
      }
      return await runShrinkStep({
        args,
        store,
        runId,
        worktreePath,
        runBaseRef,
        iterationsConsumed,
        shrinkValidator,
      });
    }

    store.setRunStatus(runId, "budget-soft-stopped");
    return { kind: "budget-exhausted", runId, iterationsConsumed, resumable: true };
  } finally {
    if (!args.stateStore) {
      store.close();
    }
  }
}

function prepareRun(args: WriteLoopInput, store: StateStore): PreparedRun {
  const worktreePath = getExternalWorktreePath(args.worktree);
  const existingRun = store.findRunByProjectBranch({
    project: args.worktree.projectName,
    branch: args.worktree.branchName,
  });

  if (existingRun === null) {
    const runBaseRef = resolveGitRef(args.worktree.projectRoot, args.worktree.baseRef);
    const runId = store.createRun({
      project: args.worktree.projectName,
      specRef: runBaseRef,
      worktreePath,
      branch: args.worktree.branchName,
      specPath: args.specPath,
    });
    return { runId, worktreePath, resumedAttemptId: null, runBaseRef };
  }

  const lastAttempt = existingRun.attempts[existingRun.attempts.length - 1];
  if (existingRun.status === "completed" && lastAttempt?.status === "in-progress") {
    restoreCommittedHead(existingRun.worktreePath);
    return { result: { kind: "complete", runId: existingRun.id, iterationsConsumed: 0, resumable: false } };
  }
  if (lastAttempt?.status === "in-progress") {
    // Interrupted mid-step: re-run that iteration over the dirty worktree.
    return {
      runId: existingRun.id,
      worktreePath,
      resumedAttemptId: lastAttempt.id,
      runBaseRef: existingRun.specRef,
    };
  }

  const committed = committedResult(existingRun);
  return committed === null
    ? { runId: existingRun.id, worktreePath, resumedAttemptId: null, runBaseRef: existingRun.specRef }
    : { result: committed };
}

function terminalMapping(result: Exclude<StepRunResult, { kind: "progress" }>): {
  kind: WriteLoopOutcomeKind;
  runStatus: RunStatus;
  outcomeKind: OutcomeKind;
} {
  if (result.kind === "complete") return { kind: "complete", runStatus: "completed", outcomeKind: result.token };
  if (result.kind === "blocked") return { kind: "blocked", runStatus: "blocked", outcomeKind: "blocked" };
  if (result.kind === "contract_miss") {
    return { kind: "contract_miss", runStatus: "blocked", outcomeKind: "contract_miss" };
  }
  return { kind: "invocation_failure", runStatus: "failed", outcomeKind: "invocation_failure" };
}

/** Terminal result already committed by a prior invocation, returned idempotently; null when resumable. */
function committedResult(run: StoredRun): WriteLoopResult | null {
  if (run.status === "completed") return { kind: "complete", runId: run.id, iterationsConsumed: 0, resumable: false };
  if (run.status === "failed") {
    return { kind: "invocation_failure", runId: run.id, iterationsConsumed: 0, resumable: false };
  }
  if (run.status === "blocked") {
    const lastOutcome = run.attempts[run.attempts.length - 1]?.outcomeKind;
    return {
      kind: lastOutcome === "contract_miss" ? "contract_miss" : "blocked",
      runId: run.id,
      iterationsConsumed: 0,
      resumable: false,
    };
  }
  return null; // in-progress or budget-soft-stopped: resume
}

function resolveSpecPath(worktreePath: string, specPath: string): string {
  return isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
}

function appendBlockerToSpec(specPath: string, failedContractId: string): void {
  appendFileSync(specPath, `\n## Blocker\n\nArtifact contract check failed: ${failedContractId}\n`, "utf8");
}

async function runShrinkStep(args: {
  args: WriteLoopInput;
  store: StateStore;
  runId: string;
  worktreePath: string;
  runBaseRef: string;
  iterationsConsumed: number;
  shrinkValidator: ShrinkValidator;
}): Promise<WriteLoopResult> {
  commitWorktreeBoundary(args.worktreePath);
  if (isEmptyCommitRange(args.worktreePath, args.runBaseRef)) {
    return { kind: "complete", runId: args.runId, iterationsConsumed: args.iterationsConsumed, resumable: false };
  }

  const committedHead = resolveGitRef(args.worktreePath, "HEAD");
  const shrinkAttemptId = args.store.recordAttemptStart(args.runId);
  const shrinkRules = renderWriteShrinkRules({ baseRef: args.runBaseRef });

  const { result } = await executeWrite({ ...args.args, stepRules: shrinkRules });
  if (result.kind === "complete") {
    try {
      args.shrinkValidator({ worktreePath: args.worktreePath, committedHead });
      args.store.commitCompletionBoundary({
        attemptId: shrinkAttemptId,
        runStatus: "completed",
        outcomeKind: result.token,
      });
      return { kind: "complete", runId: args.runId, iterationsConsumed: args.iterationsConsumed, resumable: false };
    } catch {
      // Discard-on-miss below.
    }
  }

  restoreCommittedHead(args.worktreePath);
  args.store.commitCompletionBoundary({ attemptId: shrinkAttemptId, runStatus: "completed", outcomeKind: "blocked" });
  return { kind: "complete", runId: args.runId, iterationsConsumed: args.iterationsConsumed, resumable: false };
}

function validateShrinkResult(args: { worktreePath: string; committedHead: string }): void {
  assertShrinkKeepsTests(args.worktreePath, args.committedHead);
  execFileSync("bun", ["test"], {
    cwd: args.worktreePath,
    stdio: "pipe",
  });
}

function assertShrinkKeepsTests(worktreePath: string, committedHead: string): void {
  const deleted = execFileSync("git", ["diff", "--name-only", "--diff-filter=D", committedHead, "--"], {
    cwd: worktreePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .filter(isTestFilePath);

  if (deleted.length > 0) {
    throw new Error(`shrink deleted test files: ${deleted.join(", ")}`);
  }
}

function isTestFilePath(path: string): boolean {
  return /(^|\/)__tests__(\/|$)|\.test\.[^/]+$/.test(path);
}

function commitWorktreeBoundary(worktreePath: string): void {
  if (!hasWorktreeChanges(worktreePath)) return;
  execFileSync("git", ["add", "-A"], { cwd: worktreePath, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "jarvis: complete write boundary"], {
    cwd: worktreePath,
    stdio: "pipe",
  });
}

function hasWorktreeChanges(worktreePath: string): boolean {
  const status = execFileSync("git", ["status", "--short"], {
    cwd: worktreePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return status.trim().length > 0;
}

function isEmptyCommitRange(worktreePath: string, baseRef: string): boolean {
  const count = execFileSync("git", ["rev-list", "--count", `${baseRef}..HEAD`], {
    cwd: worktreePath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return count === "0";
}

function restoreCommittedHead(worktreePath: string): void {
  execFileSync("git", ["reset", "--hard", "HEAD"], { cwd: worktreePath, stdio: "pipe" });
  execFileSync("git", ["clean", "-fd"], { cwd: worktreePath, stdio: "pipe" });
}

function resolveGitRef(cwd: string, ref: string): string {
  return execFileSync("git", ["rev-parse", ref], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
