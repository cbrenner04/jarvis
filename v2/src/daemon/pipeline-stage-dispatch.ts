import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import {
  DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  isTerminalRunStatus,
  type PipelineStageRecord,
  type RunStatus,
  type StateStore,
} from "../persistence/state-store.ts";
import { settleStagesForEntryRun } from "./stage-settlement-owner.ts";

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

export type { PipelineStageArtifact } from "../persistence/pipeline-stage-settlement.ts";
export { stageArtifactFromEntryRun } from "../persistence/pipeline-stage-settlement.ts";

/** Composite key for in-memory stage artifact maps: prefix stages use `default`, suffix stages use the branch key. */
export function stageArtifactKey(stageId: string, branchKey: string = DEFAULT_PIPELINE_STAGE_BRANCH_KEY): string {
  return `${stageId}:${branchKey}`;
}

type PipelineStageTarget = {
  pipelineId: string;
  stageId: string;
  branchKey?: string;
};

/** True when the entry run row exists and has not reached a terminal status. */
function isLiveEntryRun(store: StateStore, entryRunId: string): boolean {
  const run = store.loadRun(entryRunId);
  return run !== null && !isTerminalRunStatus(run.status);
}

/** Linked entry run when a `running` stage row still needs adopt/settlement (live or pending re-settlement). */
export function settlementLinkedEntryRunId(
  _store: StateStore,
  record: PipelineStageRecord | undefined,
): string | undefined {
  if (record?.status !== "running") return undefined;
  const entryRunId = record.workflowInvocationId;
  return entryRunId ?? undefined;
}

/** True when a post-dispatch stage row is still in flight and must not be terminalized. */
export function shouldStopForInFlightStageRow(store: StateStore, record: PipelineStageRecord | undefined): boolean {
  if (record?.status === "pending") return true;
  return settlementLinkedEntryRunId(store, record) !== undefined;
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

/** Link a live admitted entry run and settle it without re-dispatching workflow steps. */
export async function adoptAndSettlePipelineStage(args: {
  store: StateStore;
  stageTarget: PipelineStageTarget;
  entryRunId: string;
  invocationId?: string;
  wait: PipelineWorkflowWait;
  loadLogRecords?: (entryRunId: string) => PersistedRecord[];
  isEntryRunLive?: (entryRunId: string) => boolean;
}): Promise<void> {
  const { store, stageTarget, entryRunId, wait, loadLogRecords, isEntryRunLive } = args;
  const pipeline = store.loadPipeline(stageTarget.pipelineId);
  const record = pipeline?.stages.find(
    (stage) =>
      stage.stageId === stageTarget.stageId &&
      stage.branchKey === (stageTarget.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY),
  );
  const linkedRunning = record?.workflowInvocationId === entryRunId && record.status === "running";
  if (!isLiveEntryRun(store, entryRunId) && !linkedRunning) return;
  if (!linkedRunning) {
    writeRunningStageLinkage(store, stageTarget, entryRunId);
  }
  await wait(entryRunId);
  settleAfterWait(store, stageTarget, entryRunId, loadLogRecords, isEntryRunLive);
}

/**
 * Post-wait settlement: the wait primitive resolves when the daemon stops driving the invocation,
 * so its durable rows are the truth. A row still non-terminal here stays `running` with no marker;
 * the settlement owner settles it on the run's terminal event or at daemon start.
 */
function settleAfterWait(
  store: StateStore,
  stageTarget: PipelineStageTarget,
  entryRunId: string,
  loadLogRecords: ((entryRunId: string) => PersistedRecord[]) | undefined,
  isEntryRunLive: ((entryRunId: string) => boolean) | undefined,
): void {
  settleStagesForEntryRun({ store, isEntryRunLive: isEntryRunLive ?? (() => false), loadLogRecords }, entryRunId, [
    {
      pipelineId: stageTarget.pipelineId,
      stageId: stageTarget.stageId,
      branchKey: stageTarget.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
    },
  ]);
}

function rereadPipelineStageAndEntryRun(store: StateStore, stageTarget: PipelineStageTarget): void {
  const branchKey = stageTarget.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
  const pipeline = store.loadPipeline(stageTarget.pipelineId);
  const record = pipeline?.stages.find(
    (stage) => stage.stageId === stageTarget.stageId && stage.branchKey === branchKey,
  );
  const entryRunId = settlementLinkedEntryRunId(store, record);
  if (entryRunId === undefined) return;
  store.loadRun(entryRunId);
}

/** Hold durable admission while an existing linked entry run is adopted and settled. */
export async function adoptPipelineStageUnderAdmission(args: {
  store: StateStore;
  stageTarget: PipelineStageTarget;
  adopt: () => Promise<void>;
}): Promise<void> {
  const { store, stageTarget, adopt } = args;
  const branchKey = stageTarget.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
  const admission = store.claimPipelineStageAdmission({
    pipelineId: stageTarget.pipelineId,
    stageId: stageTarget.stageId,
    branchKey,
  });
  if (admission.kind === "refused") {
    rereadPipelineStageAndEntryRun(store, stageTarget);
    return;
  }
  try {
    await adopt();
  } finally {
    store.releasePipelineStageAdmission({
      pipelineId: stageTarget.pipelineId,
      stageId: stageTarget.stageId,
      branchKey,
    });
  }
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
  isEntryRunLive?: (entryRunId: string) => boolean;
}): Promise<void> {
  const { pipelineId, stageId, branchKey, steps, dispatch, wait, store, loadLogRecords, isEntryRunLive } = args;
  const stageTarget = { pipelineId, stageId, ...(branchKey !== undefined ? { branchKey } : {}) };
  const resolvedBranchKey = branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
  let admittedEntryRunId: string | undefined;

  const claim = store.claimPipelineStageAdmission({
    pipelineId,
    stageId,
    branchKey: resolvedBranchKey,
  });
  if (claim.kind === "refused") {
    rereadPipelineStageAndEntryRun(store, stageTarget);
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
    await wait(dispatched.entryRunId);
    settleAfterWait(store, stageTarget, dispatched.entryRunId, loadLogRecords, isEntryRunLive);
  } catch (error) {
    // A throw after admission leaves the linked `running` row for the settlement owner (terminal
    // event or daemon start); only a pre-admission throw is a dispatch failure.
    if (admittedEntryRunId !== undefined && isLiveEntryRun(store, admittedEntryRunId)) return;
    settleUnexpectedThrow(store, stageTarget, error);
  } finally {
    store.releasePipelineStageAdmission({ pipelineId, stageId, branchKey: resolvedBranchKey });
  }
}
