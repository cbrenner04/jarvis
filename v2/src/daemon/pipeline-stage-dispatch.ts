import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import {
  DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  isTerminalRunStatus,
  type PipelineStageRecord,
  type RunStatus,
  type StateStore,
} from "../persistence/state-store.ts";
import { composeRunOperatorError, findTerminalLogRecord } from "./run-operator-error.ts";

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

/** Composite key for in-memory stage artifact maps: prefix stages use `default`, suffix stages use the branch key. */
export function stageArtifactKey(stageId: string, branchKey: string = DEFAULT_PIPELINE_STAGE_BRANCH_KEY): string {
  return `${stageId}:${branchKey}`;
}

export type PipelineStageTarget = {
  pipelineId: string;
  stageId: string;
  branchKey?: string;
};

/** True when the entry run row exists and has not reached a terminal status. */
export function isLiveEntryRun(store: StateStore, entryRunId: string): boolean {
  const run = store.loadRun(entryRunId);
  return run !== null && !isTerminalRunStatus(run.status);
}

/** True when a post-dispatch stage row is still in flight and must not be terminalized. */
export function shouldStopForInFlightStageRow(
  store: StateStore,
  record: PipelineStageRecord | undefined,
): boolean {
  if (record?.status === "pending") return true;
  if (record?.status === "running") {
    const entryRunId = record.workflowInvocationId;
    if (entryRunId != null && isLiveEntryRun(store, entryRunId)) return true;
  }
  return false;
}

/** Best-effort failure write-back for an unexpected throw/rejection before entry-run admission. */
function settleUnexpectedThrow(store: StateStore, target: PipelineStageTarget, error: unknown): void {
  try {
    store.updateStage({
      ...target,
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
    ...target,
    patch: {
      status: "running",
      startedAt: Date.now(),
      workflowInvocationId: entryRunId,
    },
  });
}

function stageArtifactFromEntryRun(
  entryRunId: string,
  entryRun: NonNullable<ReturnType<StateStore["loadRun"]>>,
  invocationId?: string,
): PipelineStageArtifact {
  return {
    entryRunId,
    ...(invocationId !== undefined ? { invocationId } : {}),
    specPath: entryRun.specPath!,
    ...(entryRun.downstreamInputs?.length ? { downstreamInputs: [...entryRun.downstreamInputs] } : {}),
    ...(entryRun.prNumber != null ? { prNumber: entryRun.prNumber } : {}),
    ...(entryRun.prUrl != null ? { prUrl: entryRun.prUrl } : {}),
  };
}

function failureDetailForEntryRun(
  store: StateStore,
  entryRunId: string,
  loadLogRecords?: (entryRunId: string) => PersistedRecord[],
): unknown {
  const entryRun = store.loadRun(entryRunId);
  const logRecords = loadLogRecords?.(entryRunId) ?? [];
  const terminalRecord = findTerminalLogRecord(logRecords);
  const composed = entryRun ? composeRunOperatorError(entryRun, terminalRecord, logRecords) : undefined;
  return composed ?? { reason: "harness_failure", retryable: false, nextAction: "stop" as const };
}

function applyEntryRunSettlement(args: {
  store: StateStore;
  stageTarget: PipelineStageTarget;
  entryRunId: string;
  invocationId?: string;
  rollupStatus: RunStatus;
  loadLogRecords?: (entryRunId: string) => PersistedRecord[];
}): void {
  const { store, stageTarget, entryRunId, invocationId, rollupStatus, loadLogRecords } = args;
  if (rollupStatus === "completed") {
    const entryRun = store.loadRun(entryRunId);
    if (entryRun?.specPath === undefined) {
      store.updateStage({
        ...stageTarget,
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
    store.updateStage({
      ...stageTarget,
      patch: {
        status: "succeeded",
        endedAt: Date.now(),
        artifact: stageArtifactFromEntryRun(entryRunId, entryRun, invocationId),
      },
    });
    return;
  }
  store.updateStage({
    ...stageTarget,
    patch: {
      status: "failed",
      endedAt: Date.now(),
      failureDetail: failureDetailForEntryRun(store, entryRunId, loadLogRecords),
    },
  });
}

async function settlePipelineStageFromEntryRun(args: {
  store: StateStore;
  stageTarget: PipelineStageTarget;
  entryRunId: string;
  invocationId?: string;
  wait: PipelineWorkflowWait;
  loadLogRecords?: (entryRunId: string) => PersistedRecord[];
}): Promise<void> {
  const { store, stageTarget, entryRunId, invocationId, wait, loadLogRecords } = args;
  const rollupStatus = await wait(entryRunId);
  applyEntryRunSettlement({
    store,
    stageTarget,
    entryRunId,
    rollupStatus,
    ...(invocationId !== undefined ? { invocationId } : {}),
    ...(loadLogRecords !== undefined ? { loadLogRecords } : {}),
  });
}

/** Link a live admitted entry run and settle it without re-dispatching workflow steps. */
export async function adoptAndSettlePipelineStage(args: {
  store: StateStore;
  stageTarget: PipelineStageTarget;
  entryRunId: string;
  invocationId?: string;
  wait: PipelineWorkflowWait;
  loadLogRecords?: (entryRunId: string) => PersistedRecord[];
}): Promise<void> {
  const { store, stageTarget, entryRunId, invocationId, wait, loadLogRecords } = args;
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
  await settlePipelineStageFromEntryRun({
    store,
    stageTarget,
    entryRunId,
    ...(invocationId !== undefined ? { invocationId } : {}),
    wait,
    ...(loadLogRecords !== undefined ? { loadLogRecords } : {}),
  });
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
  loadLogRecords?: (entryRunId: string) => PersistedRecord[];
}): Promise<void> {
  const { pipelineId, stageId, branchKey, steps, dispatch, wait, store, loadLogRecords } = args;
  const stageTarget = { pipelineId, stageId, ...(branchKey !== undefined ? { branchKey } : {}) };
  const resolvedBranchKey = branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
  let admittedEntryRunId: string | undefined;

  const claim = store.claimPipelineStageAdmission({
    pipelineId,
    stageId,
    branchKey: resolvedBranchKey,
  });
  if (claim.kind === "refused") {
    const pipeline = store.loadPipeline(pipelineId);
    const record = pipeline?.stages.find((stage) => stage.stageId === stageId && stage.branchKey === resolvedBranchKey);
    const linkedEntryRunId = record?.workflowInvocationId;
    if (record?.status === "running" && linkedEntryRunId != null && isLiveEntryRun(store, linkedEntryRunId)) {
      await adoptAndSettlePipelineStage({
        store,
        stageTarget,
        entryRunId: linkedEntryRunId,
        wait,
        ...(loadLogRecords !== undefined ? { loadLogRecords } : {}),
      });
    }
    // @mutate pipeline-execution.test.ts "two concurrent continuations dispatch a given stage row exactly once"
    return;
  }

  try {
    const dispatched = await dispatch(steps);
    if (!dispatched.ok) {
      store.updateStage({
        ...stageTarget,
        patch: {
          status: "failed",
          endedAt: Date.now(),
          failureDetail: { code: dispatched.code, message: dispatched.message },
        },
      });
      return;
    }

    admittedEntryRunId = dispatched.entryRunId;
    writeRunningStageLinkage(store, stageTarget, dispatched.entryRunId);
    const rollupStatus = await wait(dispatched.entryRunId);
    applyEntryRunSettlement({
      store,
      stageTarget,
      entryRunId: dispatched.entryRunId,
      rollupStatus,
      ...(dispatched.invocationId !== undefined ? { invocationId: dispatched.invocationId } : {}),
      ...(loadLogRecords !== undefined ? { loadLogRecords } : {}),
    });
  } catch (error) {
    if (admittedEntryRunId !== undefined && isLiveEntryRun(store, admittedEntryRunId)) {
      return;
    }
    settleUnexpectedThrow(store, stageTarget, error);
  } finally {
    store.releasePipelineStageAdmission({ pipelineId, stageId, branchKey: resolvedBranchKey });
  }
}
