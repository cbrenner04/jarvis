import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { RunStatus, StateStore } from "../persistence/state-store.ts";
import { composeRunOperatorError } from "./run-operator-error.ts";

/**
 * Daemon-built closure around `handleWorkflowStart`/`startWorkflowRun`, the only seam a
 * standalone module can reach to dispatch a resolved stage's steps.
 */
export type PipelineWorkflowDispatch = (
  steps: AnyWorkflowStep[],
) => Promise<{ ok: true; entryRunId: string; invocationId?: string } | { ok: false; code: string; message: string }>;

/**
 * Awaits settlement of a dispatched entry run through the daemon's own wait primitive (the
 * mechanism backing the `wait` RPC handler), not the dispatch callback's returned promise,
 * which resolves at run creation rather than at completion.
 */
export type PipelineWorkflowWait = (entryRunId: string) => Promise<RunStatus>;

export type PipelineStageArtifact = {
  entryRunId: string;
  invocationId?: string;
  specPath: string;
  prNumber?: number;
  prUrl?: string;
};

/** Best-effort failure write-back for an unexpected throw/rejection anywhere in dispatch/settlement. */
function settleUnexpectedThrow(store: StateStore, pipelineId: string, stageId: string, error: unknown): void {
  try {
    store.updateStage({
      pipelineId,
      stageId,
      patch: {
        status: "failed",
        endedAt: Date.now(),
        failureDetail: { message: error instanceof Error ? error.message : String(error) },
      },
    });
  } catch {
    // The store itself is unreachable; nothing further can be recorded.
  }
}

/** Dispatch one resolved stage's steps, link it before settlement, then record its terminal outcome. */
export async function dispatchPipelineStage(args: {
  pipelineId: string;
  stageId: string;
  steps: AnyWorkflowStep[];
  dispatch: PipelineWorkflowDispatch;
  wait: PipelineWorkflowWait;
  store: StateStore;
}): Promise<void> {
  const { pipelineId, stageId, steps, dispatch, wait, store } = args;

  try {
    const dispatched = await dispatch(steps);
    if (!dispatched.ok) {
      store.updateStage({
        pipelineId,
        stageId,
        patch: {
          status: "failed",
          endedAt: Date.now(),
          failureDetail: { code: dispatched.code, message: dispatched.message },
        },
      });
      return;
    }

    store.updateStage({
      pipelineId,
      stageId,
      patch: {
        status: "running",
        startedAt: Date.now(),
        workflowInvocationId: dispatched.entryRunId,
      },
    });

    const rollupStatus = await wait(dispatched.entryRunId);

    if (rollupStatus === "completed") {
      const entryRun = store.loadRun(dispatched.entryRunId);
      if (entryRun?.specPath === undefined) {
        store.updateStage({
          pipelineId,
          stageId,
          patch: {
            status: "failed",
            endedAt: Date.now(),
            failureDetail: {
              message: `pipeline-stage-dispatch: entry run ${dispatched.entryRunId} completed without a recorded spec path`,
            },
          },
        });
        return;
      }
      const artifact: PipelineStageArtifact = {
        entryRunId: dispatched.entryRunId,
        ...(dispatched.invocationId !== undefined ? { invocationId: dispatched.invocationId } : {}),
        specPath: entryRun.specPath,
        ...(entryRun.prNumber != null ? { prNumber: entryRun.prNumber } : {}),
        ...(entryRun.prUrl != null ? { prUrl: entryRun.prUrl } : {}),
      };
      store.updateStage({
        pipelineId,
        stageId,
        patch: { status: "succeeded", endedAt: Date.now(), artifact },
      });
      return;
    }

    // Every non-"completed" settlement (failed/blocked/killed/interrupted/anything else the
    // daemon's rollup returns) is a stage failure — no status is left to wedge the stage at
    // `running` while later stages are marked `skipped`.
    const entryRun = store.loadRun(dispatched.entryRunId);
    const composed = entryRun ? composeRunOperatorError(entryRun) : undefined;
    const failureDetail = composed ?? { reason: "harness_failure", retryable: false, nextAction: "stop" as const };
    store.updateStage({
      pipelineId,
      stageId,
      patch: { status: "failed", endedAt: Date.now(), failureDetail },
    });
  } catch (error) {
    settleUnexpectedThrow(store, pipelineId, stageId, error);
  }
}
