import type { PersistedRecord } from "../persistence/log-stream.ts";
import type { LinkedStageSettlement, LinkedStageTarget } from "../persistence/pipeline-stage-settlement.ts";
import { isTerminalRunStatus, type StateStore } from "../persistence/state-store.ts";
import { composeRunOperatorError, findTerminalLogRecord } from "./run-operator-error.ts";

/**
 * The daemon's one settlement owner for pipeline stages linked to workflow entry runs. Truth is
 * the durable run rows (`StateStore.settleLinkedStagesFromEntryRun`); the only in-memory input is
 * liveness — an invocation this process is still driving must not be judged from its rows. Called
 * after a workflow's terminal event, on adoption after its wait, on resume, and at daemon start.
 */
type StageSettlementDeps = {
  store: StateStore;
  /** True while this daemon still drives the entry run's workflow invocation. */
  isEntryRunLive: (entryRunId: string) => boolean;
  loadLogRecords?: ((entryRunId: string) => PersistedRecord[]) | undefined;
};

function publicationBaseRetargetFromLogRecords(
  records: readonly PersistedRecord[],
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

/** Log-derived operator failure detail for a failed entry run; undefined leaves the durable-row projection in charge. */
function failureDetailFromLogs(
  store: StateStore,
  entryRunId: string,
  loadLogRecords: ((entryRunId: string) => PersistedRecord[]) | undefined,
): unknown {
  if (loadLogRecords === undefined) return undefined;
  const entryRun = store.loadRun(entryRunId);
  if (entryRun === null) return undefined;
  const logRecords = loadLogRecords(entryRunId);
  return composeRunOperatorError(entryRun, findTerminalLogRecord(logRecords), logRecords);
}

/** Settle every `running` stage linked to `entryRunId` (or only `stageTargets`) from its durable rows. */
export function settleStagesForEntryRun(
  deps: StageSettlementDeps,
  entryRunId: string,
  stageTargets?: readonly LinkedStageTarget[],
): LinkedStageSettlement | { kind: "live" } {
  if (deps.isEntryRunLive(entryRunId)) return { kind: "live" };
  // The run's own durable row is the second liveness witness, and the load-bearing one whenever the
  // in-memory probe cannot see the invocation (another daemon's, or a caller with no probe). A
  // workflow that has not yet written its step rows rolls up `killed` — a durable step with no row
  // is an interrupted workflow — so settling on the rollup alone would fail a stage whose run is
  // still in-progress. A genuinely dead run reaches a terminal row through restart reconciliation,
  // and settles then.
  const entryRun = deps.store.loadRun(entryRunId);
  if (entryRun !== null && !isTerminalRunStatus(entryRun.status)) return { kind: "live" };
  const logRecords = deps.loadLogRecords?.(entryRunId) ?? [];
  const publicationBaseRetarget = publicationBaseRetargetFromLogRecords(logRecords);
  const failureDetail = failureDetailFromLogs(deps.store, entryRunId, deps.loadLogRecords);
  return deps.store.settleLinkedStagesFromEntryRun(entryRunId, {
    ...(stageTargets !== undefined ? { stageTargets } : {}),
    ...(publicationBaseRetarget !== undefined ? { publicationBaseRetarget } : {}),
    ...(failureDetail !== undefined ? { failureDetail } : {}),
  });
}

/**
 * Settle every `running` stage whose linked entry run is not live — the daemon-start sweep, and
 * the precondition `pipeline_resume` runs before deriving state. Returns the settled entry run ids.
 */
export function settleOrphanedRunningStages(deps: StageSettlementDeps, pipelineId?: string): string[] {
  const pipelines =
    pipelineId === undefined
      ? deps.store.listPipelines()
      : [deps.store.loadPipeline(pipelineId)].filter((pipeline) => pipeline !== null);
  const settled = new Set<string>();
  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      if (stage.status !== "running" || stage.workflowInvocationId === null) continue;
      const entryRunId = stage.workflowInvocationId;
      if (settled.has(entryRunId)) continue;
      const outcome = settleStagesForEntryRun(deps, entryRunId);
      if (outcome.kind === "settled") settled.add(entryRunId);
    }
  }
  return [...settled];
}
