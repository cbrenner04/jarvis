import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import {
  resolvePrEvidenceAcrossInvocation,
  stageArtifactFromEntryRun,
} from "../persistence/pipeline-stage-settlement.ts";
import {
  DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  isTerminalRunStatus,
  type PipelineStageRecord,
  type RunStatus,
  type StateStore,
} from "../persistence/state-store.ts";
import { rollupWorkflowRunStatus } from "../persistence/workflow-run-status-rollup.ts";
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

export type { PipelineStageArtifact } from "../persistence/pipeline-stage-settlement.ts";
export { stageArtifactFromEntryRun } from "../persistence/pipeline-stage-settlement.ts";

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

function isDeferredSettlementMarker(detail: { code?: string; reason?: string } | null | undefined): boolean {
  return detail?.code === "settlement_deferred" && detail.reason === "entry_run_still_live";
}

function rollupLinkedEntryRunStatus(store: StateStore, entryRunId: string, isLive: boolean): RunStatus | undefined {
  const entryRun = store.loadRun(entryRunId);
  if (entryRun === null) return undefined;
  const workflowSnapshot = entryRun.workflowSnapshot ?? null;
  const siblingRuns = workflowSnapshot !== null ? store.findRunsByInvocationId(workflowSnapshot.invocationId) : [];
  return rollupWorkflowRunStatus({ entryRun, workflowSnapshot, siblingRuns, isLive });
}

function recordDeferredSettlement(
  store: StateStore,
  stageTarget: PipelineStageTarget,
  entryRunId: string,
  rollupStatus: RunStatus,
): void {
  store.updateStage({
    ...stageTarget,
    patch: {
      failureDetail: {
        code: "settlement_deferred",
        reason: "entry_run_still_live",
        entryRunId,
        rollupStatus,
      },
    },
  });
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

/** Linked entry run when a `running` stage row carries a deferred-settlement marker whose entry run is now durably terminal — redrivable by a fresh sweep. */
export function redrivableDeferredSettlementEntryRunId(
  store: StateStore,
  record: PipelineStageRecord | undefined,
): string | undefined {
  if (record?.status !== "running") return undefined;
  if (!isDeferredSettlementMarker(record.failureDetail as { code?: string; reason?: string } | null | undefined)) {
    return undefined;
  }
  const deferredEntryRunId = settlementLinkedEntryRunId(store, record);
  if (deferredEntryRunId === undefined) return undefined;
  if (isLiveEntryRun(store, deferredEntryRunId)) return undefined;
  return deferredEntryRunId;
}

/** Linked entry run when a `running` stage row has no deferred marker and its linked entry run rollup is terminally `failed`. */
export function unsettledTerminalStageEntryRunId(
  store: StateStore,
  record: PipelineStageRecord | undefined,
): string | undefined {
  if (record?.status !== "running") return undefined;
  if (isDeferredSettlementMarker(record.failureDetail as { code?: string; reason?: string } | null | undefined)) {
    return undefined;
  }
  const linkedEntryRunId = settlementLinkedEntryRunId(store, record);
  if (linkedEntryRunId === undefined) return undefined;
  if (isLiveEntryRun(store, linkedEntryRunId)) return undefined;
  const rollupStatus = rollupLinkedEntryRunStatus(store, linkedEntryRunId, false);
  if (rollupStatus !== "failed") return undefined;
  return linkedEntryRunId;
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

function publicationBaseRetargetFromLogRecords(
  records: PersistedRecord[],
): { requestedBase: string; resolvedBase: string } | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record?.event.kind !== "loop_finished") continue;
    const { requestedBase, resolvedBase } = record.event;
    if (typeof requestedBase === "string" && typeof resolvedBase === "string") {
      return { requestedBase, resolvedBase };
    }
  }
  return undefined;
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

function terminalPublicationStageRequiresPrEvidence(store: StateStore, stageTarget: PipelineStageTarget): boolean {
  const pipeline = store.loadPipeline(stageTarget.pipelineId);
  if (pipeline === null) return false;
  const definition = pipeline.definition;
  if (definition === undefined) return false;
  const record = pipeline.stages.find(
    (stage) =>
      stage.stageId === stageTarget.stageId &&
      stage.branchKey === (stageTarget.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY),
  );
  if (!isDeferredSettlementMarker(record?.failureDetail as { code?: string; reason?: string } | null | undefined)) {
    return false;
  }
  const terminalAction = definition.terminalAction;
  if (terminalAction !== "ready" && terminalAction !== "merge") return false;
  for (let index = definition.stages.length - 1; index >= 0; index -= 1) {
    const stage = definition.stages[index];
    if (stage?.kind !== "workflow") continue;
    return stage.stageId === stageTarget.stageId;
  }
  return false;
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
    // Publication dispatches late under its own run id, so the PR is often recorded on a
    // successor row; resolving from the entry row alone fails a stage whose work published fine.
    const invocationRows =
      entryRun?.workflowSnapshot === undefined || entryRun?.workflowSnapshot === null
        ? []
        : store.findRunsByInvocationId(entryRun.workflowSnapshot.invocationId);
    const prEvidence = entryRun === null ? undefined : resolvePrEvidenceAcrossInvocation(entryRun, invocationRows);
    const missingPublicationEvidence =
      entryRun !== null && terminalPublicationStageRequiresPrEvidence(store, stageTarget) && prEvidence === undefined;
    if (entryRun?.specPath === undefined || missingPublicationEvidence) {
      store.updateStage({
        ...stageTarget,
        patch: {
          status: "failed",
          endedAt: Date.now(),
          failureDetail: missingPublicationEvidence
            ? {
                code: "completion_publication_missing_pr_evidence",
                message: `completion publication left no confirmed PR evidence on linked entry run ${entryRunId}`,
              }
            : {
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
        failureDetail: null,
        artifact: stageArtifactFromEntryRun(
          entryRunId,
          entryRun,
          invocationId,
          publicationBaseRetargetFromLogRecords(loadLogRecords?.(entryRunId) ?? []),
          prEvidence,
        ),
      },
    });
    return;
  }
  if (isLiveEntryRun(store, entryRunId)) {
    recordDeferredSettlement(store, stageTarget, entryRunId, rollupStatus);
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
    const linkedEntryRunId = settlementLinkedEntryRunId(store, record);
    if (linkedEntryRunId !== undefined) {
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
      recordDeferredSettlement(
        store,
        stageTarget,
        admittedEntryRunId,
        rollupLinkedEntryRunStatus(store, admittedEntryRunId, true) ?? "in-progress",
      );
      return;
    }
    settleUnexpectedThrow(store, stageTarget, error);
  } finally {
    store.releasePipelineStageAdmission({ pipelineId, stageId, branchKey: resolvedBranchKey });
  }
}
