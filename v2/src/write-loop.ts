import { appendFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { type ExternalWorktreeInput, getExternalWorktreePath } from "./external-worktree.ts";
import { openStateStore, type StateStore } from "./state-store.ts";
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

/**
 * Execute a resumable write loop: repeatedly call executeWrite until work is
 * done, blocked, or budget runs out, persisting run + per-iteration attempt
 * rows through the state store.
 */
export async function executeWriteLoop(args: WriteLoopInput): Promise<WriteLoopResult> {
  const store = args.stateStore ?? openStateStore();
  const maxIterations = args.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  try {
    // Compute the external worktree path upfront.
    const worktreeInput: ExternalWorktreeInput & { jarvisRoot?: string } = {
      projectRoot: args.worktree.projectRoot,
      projectName: args.worktree.projectName,
      branchName: args.worktree.branchName,
      baseRef: args.worktree.baseRef,
    };
    if (args.worktree.jarvisRoot !== undefined) {
      worktreeInput.jarvisRoot = args.worktree.jarvisRoot;
    }
    const worktreePath = getExternalWorktreePath(worktreeInput as ExternalWorktreeInput);

    // Create or resume: try to find an existing run by identity, or create a new one.
    let runId: string;
    let lastAttempt: { attemptId: string; isInterrupted: boolean } | null = null;

    const existingRun = store.findRunByProjectBranch({
      project: args.projectId,
      branch: args.branch,
    });

    if (existingRun) {
      // Resume: load the existing run.
      runId = existingRun.id;
      const lastAttemptRecord = existingRun.attempts[existingRun.attempts.length - 1];
      if (lastAttemptRecord !== undefined) {
        // An attempt is interrupted if its status is "in-progress" (no committed boundary yet).
        const isInterrupted = lastAttemptRecord.status === "in-progress";
        if (isInterrupted) {
          lastAttempt = { attemptId: lastAttemptRecord.id, isInterrupted: true };
        }
      }
      if (lastAttempt === null) {
        const resumed = resumeCommittedRun(existingRun);
        if (resumed !== null) {
          return resumed;
        }
      }
    } else {
      // New run: create it.
      runId = store.createRun({
        project: args.projectId,
        specRef: args.specRef,
        worktreePath,
        branch: args.branch,
        specPath: args.specPath,
      });
    }

    let iterationsConsumed = 0;
    let resumedAttemptId: string | null = null;

    // If resuming an interrupted attempt, reuse its ID; otherwise create a new one.
    if (lastAttempt?.isInterrupted) {
      resumedAttemptId = lastAttempt.attemptId;
    }
    store.setRunStatus(runId, "in-progress");

    // Loop until terminal outcome or budget exhausted.
    while (iterationsConsumed < maxIterations) {
      // Check abort before starting iteration.
      if (args.signal?.aborted) {
        return {
          kind: "progress",
          runId,
          iterationsConsumed,
          resumable: true,
        };
      }

      // Record attempt start, or reuse the resumed attempt ID.
      const attemptId = resumedAttemptId ?? store.recordAttemptStart(runId);
      // Clear the resumed ID after first use.
      resumedAttemptId = null;

      // Execute one write pass.
      const executeWriteArgs: WriteExecuteInput = {
        worktree: args.worktree,
        specPath: args.specPath,
        stepRules: args.stepRules,
        expectedArtifactPath: args.expectedArtifactPath,
        bindings: args.bindings,
      };
      if (args.signal !== undefined) {
        executeWriteArgs.signal = args.signal;
      }
      const writeResult = await executeWrite(executeWriteArgs);

      iterationsConsumed += 1;

      // Classify the result.
      const result = writeResult.result;

      if (result.kind === "progress") {
        // Progress: loop again, consuming one of N.
        store.commitCompletionBoundary({
          attemptId,
          status: "completed",
          runStatus: "in-progress",
          outcomeKind: "progress",
        });
        continue;
      }

      if (result.kind === "blocked") {
        // Blocked: stop immediately, terminal blocked outcome.
        store.commitCompletionBoundary({
          attemptId,
          status: "completed",
          runStatus: "blocked",
          outcomeKind: "blocked",
        });
        return {
          kind: "blocked",
          runId,
          iterationsConsumed,
          resumable: false,
        };
      }

      if (result.kind === "invocation_failure") {
        // Invocation failure: terminal stop.
        store.commitCompletionBoundary({
          attemptId,
          status: "completed",
          runStatus: "failed",
          outcomeKind: "invocation_failure",
        });
        return {
          kind: "invocation_failure",
          runId,
          iterationsConsumed,
          resumable: false,
        };
      }

      // done / no-work / contract_miss: check artifact contract.
      if (result.kind === "contract_miss") {
        // Contract miss: append blocker to spec and stop.
        const specPathAbsolute = isAbsolute(args.specPath) ? args.specPath : join(worktreePath, args.specPath);
        appendBlockerToSpec(specPathAbsolute, result.failedContractId);
        store.commitCompletionBoundary({
          attemptId,
          status: "completed",
          runStatus: "blocked",
          outcomeKind: "contract_miss",
        });
        return {
          kind: "contract_miss",
          runId,
          iterationsConsumed,
          resumable: false,
        };
      }

      // complete: terminal success.
      if (result.kind === "complete") {
        store.commitCompletionBoundary({
          attemptId,
          status: "completed",
          runStatus: "completed",
          outcomeKind: result.token,
        });
        return {
          kind: "complete",
          runId,
          iterationsConsumed,
          resumable: false,
        };
      }

      // Unexpected token (invalid_token).
      store.commitCompletionBoundary({
        attemptId,
        status: "completed",
        runStatus: "failed",
        outcomeKind: "invocation_failure",
      });
      return {
        kind: "invocation_failure",
        runId,
        iterationsConsumed,
        resumable: false,
      };
    }

    // Budget exhausted while still progress: soft-stop (resumable).
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

function resumeCommittedRun(
  run: ReturnType<StateStore["loadRun"]> extends infer T ? NonNullable<T> : never,
): WriteLoopResult | null {
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

/**
 * Append a "## Blocker" section to the spec file.
 */
function appendBlockerToSpec(specPath: string, failedContractId: string): void {
  const blocker = `\n## Blocker\n\nArtifact contract check failed: ${failedContractId}\n`;
  appendFileSync(specPath, blocker, "utf8");
}
