import { appendFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { getExternalWorktreePath } from "./external-worktree.ts";
import type { LogSink } from "./log-stream.ts";
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

/** Input for the write loop. Run identity derives from `worktree` (project, branch, base). */
export type WriteLoopInput = WriteExecuteInput & {
  maxIterations?: number;
  stateStore?: StateStore;
  logSink?: LogSink;
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
    if ("result" in prepared) {
      // Idempotent re-entry: return prior result with no log events
      return prepared.result;
    }
    const { runId, worktreePath } = prepared;
    let iterationsConsumed = 0;
    let resumedAttemptId = prepared.resumedAttemptId;

    store.setRunStatus(runId, "in-progress");

    while (iterationsConsumed < maxIterations) {
      if (args.signal?.aborted) {
        const result = { kind: "progress" as const, runId, iterationsConsumed, resumable: true };
        args.logSink?.append(runId, {
          kind: "loop_finished",
          loopOutcomeKind: "progress",
          iterationsConsumed,
          resumable: true,
        });
        return result;
      }

      const attemptId = resumedAttemptId ?? store.recordAttemptStart(runId);
      resumedAttemptId = null;

      // Emit iteration_started before executeWrite
      args.logSink?.append(runId, { kind: "iteration_started", attemptId });

      const writeArgs: Parameters<typeof executeWrite>[0] = {
        worktree: args.worktree,
        specPath: args.specPath,
        stepRules: args.stepRules,
        expectedArtifactPath: args.expectedArtifactPath,
        bindings: args.bindings,
        ...(args.signal && { signal: args.signal }),
        ...(args.withExternalWorktree && { withExternalWorktree: args.withExternalWorktree }),
      };
      const { result } = await executeWrite(writeArgs);
      iterationsConsumed += 1;

      if (result.kind === "progress") {
        store.commitCompletionBoundary({ attemptId, runStatus: "in-progress", outcomeKind: "progress" });
        args.logSink?.append(runId, {
          kind: "boundary_committed",
          attemptId,
          outcomeKind: "progress",
          runStatus: "in-progress",
        });
        continue;
      }

      if (result.kind === "contract_miss") {
        appendBlockerToSpec(resolveSpecPath(worktreePath, args.specPath), result.failedContractId);
      }

      const terminal = terminalMapping(result);
      store.commitCompletionBoundary({ attemptId, runStatus: terminal.runStatus, outcomeKind: terminal.outcomeKind });
      args.logSink?.append(runId, {
        kind: "boundary_committed",
        attemptId,
        outcomeKind: terminal.outcomeKind,
        runStatus: terminal.runStatus,
      });

      const loopResult = { kind: terminal.kind, runId, iterationsConsumed, resumable: false };
      args.logSink?.append(runId, {
        kind: "loop_finished",
        loopOutcomeKind: terminal.kind,
        iterationsConsumed,
        resumable: false,
      });
      return loopResult;
    }

    store.setRunStatus(runId, "budget-soft-stopped");
    args.logSink?.append(runId, {
      kind: "loop_finished",
      loopOutcomeKind: "budget-exhausted",
      iterationsConsumed,
      resumable: true,
    });
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
    const runId = store.createRun({
      project: args.worktree.projectName,
      specRef: args.worktree.baseRef,
      worktreePath,
      branch: args.worktree.branchName,
      specPath: args.specPath,
    });
    return { runId, worktreePath, resumedAttemptId: null };
  }

  const lastAttempt = existingRun.attempts[existingRun.attempts.length - 1];
  if (lastAttempt?.status === "in-progress") {
    // Interrupted mid-step: re-run that iteration over the dirty worktree.
    return { runId: existingRun.id, worktreePath, resumedAttemptId: lastAttempt.id };
  }

  const committed = committedResult(existingRun);
  return committed === null ? { runId: existingRun.id, worktreePath, resumedAttemptId: null } : { result: committed };
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
