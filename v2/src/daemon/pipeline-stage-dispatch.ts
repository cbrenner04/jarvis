import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import {
  DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  isTerminalRunStatus,
  type PipelineStageAdmission,
  type RunStatus,
  type StateStore,
} from "../persistence/state-store.ts";
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
  downstreamInputs?: string[];
  prNumber?: number;
  prUrl?: string;
};

export type PipelineStageTarget = {
  pipelineId: string;
  stageId: string;
  branchKey?: string;
};

function stageTargetKey(target: PipelineStageTarget): PipelineStageAdmission {
  return {
    pipelineId: target.pipelineId,
    stageId: target.stageId,
    branchKey: target.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  };
}

function stageStoreTarget(target: PipelineStageTarget): {
  pipelineId: string;
  stageId: string;
  branchKey?: string;
} {
  return {
    pipelineId: target.pipelineId,
    stageId: target.stageId,
    ...(target.branchKey !== undefined ? { branchKey: target.branchKey } : {}),
  };
}

/** True when the entry run row exists and has not reached a terminal status. */
export function isLiveEntryRun(store: StateStore, entryRunId: string): boolean {
  const run = store.loadRun(entryRunId);
  return run !== null && !isTerminalRunStatus(run.status);
}

/** Best-effort failure write-back for an unexpected throw/rejection before entry-run admission. */
function settleUnexpectedThrow(
  store: StateStore,
  target: PipelineStageTarget,
  error: unknown,
): void {
  try {
    store.updateStage({
      ...stageStoreTarget(target),
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

function writeRunningStageLinkage(store: StateStore, target: PipelineStageTarget, entryRunId: string): void {
  store.updateStage({
    ...stageStoreTarget(target),
    patch: {
      status: "running",
      startedAt: Date.now(),
      workflowInvocationId: entryRunId,
    },
  });
  store.clearPipelineStageAdmission(entryRunId);
}

/** Record terminal outcome from a linked entry run after admission. */
export async function settlePipelineStageFromEntryRun(args: {
  store: StateStore;
  stageTarget: PipelineStageTarget;
  entryRunId: string;
  invocationId?: string;
  wait: PipelineWorkflowWait;
}): Promise<void> {
  const { store, stageTarget, entryRunId, invocationId, wait } = args;
  const rollupStatus = await wait(entryRunId);

  if (rollupStatus === "completed") {
    const entryRun = store.loadRun(entryRunId);
    if (entryRun?.specPath === undefined) {
      store.updateStage({
        ...stageStoreTarget(stageTarget),
        patch: {
          status: "failed",
          endedAt: Date.now(),
          failureDetail: {
            message: `pipeline-stage-dispatch: entry run ${entryRunId} completed without a recorded spec path`,
          },
        },
      });
      return;
    }
    const artifact: PipelineStageArtifact = {
      entryRunId,
      ...(invocationId !== undefined ? { invocationId } : {}),
      specPath: entryRun.specPath,
      ...(entryRun.downstreamInputs?.length ? { downstreamInputs: [...entryRun.downstreamInputs] } : {}),
      ...(entryRun.prNumber != null ? { prNumber: entryRun.prNumber } : {}),
      ...(entryRun.prUrl != null ? { prUrl: entryRun.prUrl } : {}),
    };
    store.updateStage({
      ...stageStoreTarget(stageTarget),
      patch: { status: "succeeded", endedAt: Date.now(), artifact },
    });
    return;
  }

  const entryRun = store.loadRun(entryRunId);
  const composed = entryRun ? composeRunOperatorError(entryRun) : undefined;
  const failureDetail = composed ?? { reason: "harness_failure", retryable: false, nextAction: "stop" as const };
  store.updateStage({
    ...stageStoreTarget(stageTarget),
    patch: { status: "failed", endedAt: Date.now(), failureDetail },
  });
}

/** Link a live admitted entry run and settle it without re-dispatching workflow steps. */
export async function adoptAndSettlePipelineStage(args: {
  store: StateStore;
  stageTarget: PipelineStageTarget;
  entryRunId: string;
  invocationId?: string;
  wait: PipelineWorkflowWait;
}): Promise<void> {
  const { store, stageTarget, entryRunId, invocationId, wait } = args;
  if (!isLiveEntryRun(store, entryRunId)) return;
  const pipeline = store.loadPipeline(stageTarget.pipelineId);
  const record = pipeline?.stages.find(
    (stage) =>
      stage.stageId === stageTarget.stageId &&
      stage.branchKey === (stageTarget.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY),
  );
  if (record?.workflowInvocationId !== entryRunId || record.status !== "running") {
    writeRunningStageLinkage(store, stageTarget, entryRunId);
  }
  await settlePipelineStageFromEntryRun({ store, stageTarget, entryRunId, invocationId, wait });
}

/** Dispatch one resolved stage's steps, link it before settlement, then record its terminal outcome. */
export async function dispatchPipelineStage(args: {
  pipelineId: string;
  stageId: string;
  branchKey?: string;
  steps: AnyWorkflowStep[];
  dispatch: PipelineWorkflowDispatch;
  wait: PipelineWorkflowWait;
  store: StateStore;
}): Promise<void> {
  const { pipelineId, stageId, branchKey, steps, dispatch, wait, store } = args;
  const stageTarget = { pipelineId, stageId, ...(branchKey !== undefined ? { branchKey } : {}) };
  let admittedEntryRunId: string | undefined;

  try {
    const dispatched = await dispatch(steps);
    if (!dispatched.ok) {
      store.updateStage({
        ...stageStoreTarget(stageTarget),
        patch: {
          status: "failed",
          endedAt: Date.now(),
          failureDetail: { code: dispatched.code, message: dispatched.message },
        },
      });
      return;
    }

    admittedEntryRunId = dispatched.entryRunId;
    store.setPipelineStageAdmission(dispatched.entryRunId, stageTargetKey(stageTarget));
    writeRunningStageLinkage(store, stageTarget, dispatched.entryRunId);
    await settlePipelineStageFromEntryRun({
      store,
      stageTarget,
      entryRunId: dispatched.entryRunId,
      ...(dispatched.invocationId !== undefined ? { invocationId: dispatched.invocationId } : {}),
      wait,
    });
  } catch (error) {
    if (admittedEntryRunId !== undefined && isLiveEntryRun(store, admittedEntryRunId)) {
      return;
    }
    settleUnexpectedThrow(store, stageTarget, error);
  }
}
