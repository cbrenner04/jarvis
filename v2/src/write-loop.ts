import { appendFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { type ExternalWorktreeInput, getExternalWorktreePath } from "./external-worktree.ts";
import { type OutcomeKind, openStateStore, type RunStatus, type StateStore } from "./state-store.ts";
import type { StepRunResult } from "./step-runner.ts";
import { executeWrite, type WriteExecuteInput } from "./write.ts";

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

/** Input for the write loop. */
export type WriteLoopInput = Omit<WriteExecuteInput, "signal"> & {
  projectId: string;
  specRef: string;
  branch: string;
  maxIterations?: number;
  signal?: AbortSignal;
  stateStore?: StateStore;
};

const DEFAULT_MAX_ITERATIONS = 10;
type StoredRun = NonNullable<ReturnType<StateStore["loadRun"]>>;
type PreparedRun =
  | { runId: string; worktreePath: string; resumedAttemptId: string | null }
  | { result: WriteLoopResult };

/**
 * Execute a resumable write loop: repeatedly call executeWrite until work is
 * done, blocked, or budget runs out, persisting run + per-iteration attempt
 * rows through the state store.
 */
export async function executeWriteLoop(args: WriteLoopInput): Promise<WriteLoopResult> {
  const store = args.stateStore ?? openStateStore();
  const maxIterations = args.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  try {
    const prepared = prepareRun(args, store);
    if ("result" in prepared) return prepared.result;
    const { runId, worktreePath } = prepared;
    let iterationsConsumed = 0;
    let resumedAttemptId = prepared.resumedAttemptId;

    store.setRunStatus(runId, "in-progress");

    while (iterationsConsumed < maxIterations) {
      if (args.signal?.aborted) {
        return {
          kind: "progress",
          runId,
          iterationsConsumed,
          resumable: true,
        };
      }

      const attemptId = resumedAttemptId ?? store.recordAttemptStart(runId);
      resumedAttemptId = null;
      const writeResult = await executeWrite(writeExecuteInput(args));
      iterationsConsumed += 1;

      const outcome = commitAttemptResult({
        store,
        args,
        worktreePath,
        runId,
        attemptId,
        iterationsConsumed,
        result: writeResult.result,
      });
      if (outcome !== null) return outcome;
    }

    store.setRunStatus(runId, "budget-soft-stopped");
    return {
      kind: "budget-exhausted",
      runId,
      iterationsConsumed,
      resumable: true,
    };
  } finally {
    if (!args.stateStore) {
      store.close();
    }
  }
}

function prepareRun(args: WriteLoopInput, store: StateStore): PreparedRun {
  const worktreePath = getExternalWorktreePath(writeLoopWorktreeInput(args));
  const existingRun = store.findRunByProjectBranch({
    project: args.projectId,
    branch: args.branch,
  });

  if (existingRun === null) {
    return {
      runId: createRun(args, store, worktreePath),
      worktreePath,
      resumedAttemptId: null,
    };
  }

  const resumedAttemptId = interruptedAttemptId(existingRun);
  if (resumedAttemptId !== null) {
    return { runId: existingRun.id, worktreePath, resumedAttemptId };
  }

  const result = resumeCommittedRun(existingRun);
  return result === null ? { runId: existingRun.id, worktreePath, resumedAttemptId: null } : { result };
}

function writeLoopWorktreeInput(args: WriteLoopInput): ExternalWorktreeInput {
  return {
    projectRoot: args.worktree.projectRoot,
    projectName: args.worktree.projectName,
    branchName: args.worktree.branchName,
    baseRef: args.worktree.baseRef,
    ...(args.worktree.jarvisRoot !== undefined ? { jarvisRoot: args.worktree.jarvisRoot } : {}),
  };
}

function createRun(args: WriteLoopInput, store: StateStore, worktreePath: string): string {
  return store.createRun({
    project: args.projectId,
    specRef: args.specRef,
    worktreePath,
    branch: args.branch,
    specPath: args.specPath,
  });
}

function interruptedAttemptId(run: StoredRun): string | null {
  const lastAttempt = run.attempts[run.attempts.length - 1];
  return lastAttempt?.status === "in-progress" ? lastAttempt.id : null;
}

function writeExecuteInput(args: WriteLoopInput): WriteExecuteInput {
  return {
    worktree: args.worktree,
    specPath: args.specPath,
    stepRules: args.stepRules,
    expectedArtifactPath: args.expectedArtifactPath,
    bindings: args.bindings,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
  };
}

function commitAttemptResult(args: {
  store: StateStore;
  args: WriteLoopInput;
  worktreePath: string;
  runId: string;
  attemptId: string;
  iterationsConsumed: number;
  result: StepRunResult;
}): WriteLoopResult | null {
  const { result } = args;

  if (result.kind === "progress") {
    args.store.commitCompletionBoundary({
      attemptId: args.attemptId,
      status: "completed",
      runStatus: "in-progress",
      outcomeKind: "progress",
    });
    return null;
  }

  if (result.kind === "contract_miss") {
    appendBlockerToSpec(resolveSpecPath(args.worktreePath, args.args.specPath), result.failedContractId);
  }

  return commitTerminalResult(args, terminalMapping(result));
}

function terminalMapping(result: Exclude<StepRunResult, { kind: "progress" }>): {
  kind: WriteLoopOutcomeKind;
  runStatus: RunStatus;
  outcomeKind: OutcomeKind;
} {
  if (result.kind === "blocked") {
    return { kind: "blocked", runStatus: "blocked", outcomeKind: "blocked" };
  }

  if (result.kind === "contract_miss") {
    return { kind: "contract_miss", runStatus: "blocked", outcomeKind: "contract_miss" };
  }

  if (result.kind === "complete") {
    return { kind: "complete", runStatus: "completed", outcomeKind: result.token };
  }

  return { kind: "invocation_failure", runStatus: "failed", outcomeKind: "invocation_failure" };
}

function commitTerminalResult(
  args: {
    store: StateStore;
    runId: string;
    attemptId: string;
    iterationsConsumed: number;
  },
  mapping: { kind: WriteLoopOutcomeKind; runStatus: RunStatus; outcomeKind: OutcomeKind },
): WriteLoopResult {
  args.store.commitCompletionBoundary({
    attemptId: args.attemptId,
    status: "completed",
    runStatus: mapping.runStatus,
    outcomeKind: mapping.outcomeKind,
  });

  return {
    kind: mapping.kind,
    runId: args.runId,
    iterationsConsumed: args.iterationsConsumed,
    resumable: false,
  };
}

function resumeCommittedRun(run: StoredRun): WriteLoopResult | null {
  if (run.status === "completed") {
    return { kind: "complete", runId: run.id, iterationsConsumed: 0, resumable: false };
  }

  if (run.status === "budget-soft-stopped") {
    return null;
  }

  const lastOutcomeKind = run.attempts[run.attempts.length - 1]?.outcomeKind;
  if (run.status === "blocked") {
    return {
      kind: lastOutcomeKind === "contract_miss" ? "contract_miss" : "blocked",
      runId: run.id,
      iterationsConsumed: 0,
      resumable: false,
    };
  }

  if (run.status === "failed") {
    return { kind: "invocation_failure", runId: run.id, iterationsConsumed: 0, resumable: false };
  }

  return null;
}

function resolveSpecPath(worktreePath: string, specPath: string): string {
  return isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
}

function appendBlockerToSpec(specPath: string, failedContractId: string): void {
  const blocker = `\n## Blocker\n\nArtifact contract check failed: ${failedContractId}\n`;
  appendFileSync(specPath, blocker, "utf8");
}
