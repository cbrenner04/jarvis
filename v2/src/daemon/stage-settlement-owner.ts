import type { PersistedRecord } from "../persistence/log-stream.ts";
import type { LinkedStageSettlement, LinkedStageTarget } from "../persistence/pipeline-stage-settlement.ts";
import {
  isOwnerAlive,
  isTerminalRunStatus,
  type OwnerLivenessProbe,
  type StateStore,
} from "../persistence/state-store.ts";
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

/**
 * Operator failure detail for a failed run: its stored `OperatorFailureRecord`, else (legacy or corrupt
 * column) the log-composed error; undefined leaves the durable-row projection in charge.
 */
function failureDetailForRun(
  store: StateStore,
  runId: string,
  loadLogRecords: ((runId: string) => PersistedRecord[]) | undefined,
): unknown {
  const run = store.loadRun(runId);
  if (run === null) return undefined;
  if (run.operatorFailureRecord != null) return run.operatorFailureRecord;
  if (loadLogRecords === undefined) return undefined;
  const logRecords = loadLogRecords(runId);
  return composeRunOperatorError(run, findTerminalLogRecord(logRecords), logRecords);
}

/**
 * The entry run of `runId`'s invocation — the row a stage links: the invocation's row whose `stepId`
 * is `workflowSnapshot.steps[0].stepId`. A resumed `<step>~link-N` row resolves to it; a row with no
 * snapshot (or whose entry row is gone) is its own entry run.
 */
export function resolveInvocationEntryRunId(store: StateStore, runId: string): string {
  const snapshot = store.loadRun(runId)?.workflowSnapshot;
  if (snapshot === null || snapshot === undefined) return runId;
  const entryStepId = snapshot.steps[0]?.stepId;
  const entryRun = store.findRunsByInvocationId(snapshot.invocationId).find((row) => row.stepId === entryStepId);
  return entryRun?.id ?? runId;
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
  return deps.store.settleLinkedStagesFromEntryRun(entryRunId, {
    ...(stageTargets !== undefined ? { stageTargets } : {}),
    ...(publicationBaseRetarget !== undefined ? { publicationBaseRetarget } : {}),
    failureDetailForRun: (runId: string) => failureDetailForRun(deps.store, runId, deps.loadLogRecords),
  });
}

/**
 * True when `entryRunId`'s invocation has a non-terminal sibling row (by `workflowSnapshot.invocationId`)
 * owned by a live identity other than the store's own — the completion-publication `~shrink` row still
 * in flight under another daemon, for example. A row with no owner, or owned by this daemon, never
 * blocks: local liveness already decides those. No workflow snapshot means no siblings to check, so the
 * gate is a no-op. `aliveByIdentity` memoizes probe results across the caller's whole pass.
 */
export async function hasLiveForeignOwnerSibling(
  store: StateStore,
  entryRunId: string,
  probe: OwnerLivenessProbe,
  aliveByIdentity: Map<string, boolean>,
): Promise<boolean> {
  const entryRun = store.loadRun(entryRunId);
  const invocationId = entryRun?.workflowSnapshot?.invocationId;
  if (invocationId === undefined) return false;
  const currentIdentity = store.currentOwnerIdentity();
  for (const sibling of store.findRunsByInvocationId(invocationId)) {
    if (isTerminalRunStatus(sibling.status)) continue;
    const owner = sibling.ownerIdentity;
    if (owner == null || owner === currentIdentity) continue;
    let alive = aliveByIdentity.get(owner);
    if (alive === undefined) {
      alive = await probe(owner);
      aliveByIdentity.set(owner, alive);
    }
    if (alive) return true;
  }
  return false;
}

/**
 * Settle every `running` stage whose linked entry run is not live — the daemon-start sweep, and
 * the precondition `pipeline_resume` runs before deriving state. Returns the settled entry run ids.
 * Re-reads each stage's row immediately before applying the foreign-owner gate and settling, rather
 * than trusting the `listPipelines()` snapshot taken at the top: an earlier stage settled in this
 * same pass can change a later stage's state across the `await`.
 */
export async function settleOrphanedRunningStages(
  deps: StageSettlementDeps,
  pipelineId?: string,
  isForeignOwnerAliveProbe: OwnerLivenessProbe = isOwnerAlive,
): Promise<string[]> {
  const pipelines =
    pipelineId === undefined
      ? deps.store.listPipelines()
      : [deps.store.loadPipeline(pipelineId)].filter((pipeline) => pipeline !== null);
  const settled = new Set<string>();
  const aliveByIdentity = new Map<string, boolean>();
  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      if (stage.status !== "running" || stage.workflowInvocationId === null) continue;
      const entryRunId = stage.workflowInvocationId;
      if (settled.has(entryRunId)) continue;
      const currentStage = deps.store
        .loadPipeline(pipeline.id)
        ?.stages.find((row) => row.stageId === stage.stageId && row.branchKey === stage.branchKey);
      if (currentStage?.status !== "running" || currentStage.workflowInvocationId !== entryRunId) continue;
      if (await hasLiveForeignOwnerSibling(deps.store, entryRunId, isForeignOwnerAliveProbe, aliveByIdentity)) {
        continue;
      }
      const outcome = settleStagesForEntryRun(deps, entryRunId);
      if (outcome.kind === "settled") settled.add(entryRunId);
    }
  }
  return [...settled];
}
