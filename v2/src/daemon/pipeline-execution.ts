import type { PipelineDefinition, PipelineStage } from "../execution/pipeline-definition.ts";
import {
  type ApprovalDecision,
  type ApprovalRefusalReason,
  isOwnerAlive,
  type OwnerLivenessProbe,
  type Pipeline,
  type PipelineContext,
  type PipelineReopenRefusalReason,
  type PipelineStageRecord,
  type StateStore,
} from "../persistence/state-store.ts";
import {
  dispatchPipelineStage,
  type PipelineWorkflowDispatch,
  type PipelineWorkflowWait,
} from "./pipeline-stage-dispatch.ts";
import { resolveStageWorkflowSteps } from "./pipeline-stage-resolve.ts";

export type PipelineDerivedState =
  | "succeeded"
  | "failed"
  | "rejected"
  | "interrupted"
  | "awaiting-approval"
  | "running"
  | "pending";

const TERMINAL_PIPELINE_STATES: ReadonlySet<PipelineDerivedState> = new Set([
  "succeeded",
  "failed",
  "rejected",
  "interrupted",
]);

export function isPipelineTerminal(state: PipelineDerivedState): boolean {
  return TERMINAL_PIPELINE_STATES.has(state);
}

export type PipelineExecutionDeps = {
  store: StateStore;
  dispatch: PipelineWorkflowDispatch;
  wait: PipelineWorkflowWait;
  context: PipelineContext;
  resolveStage?: typeof resolveStageWorkflowSteps;
};

export type PipelineContinuationRefusalReason = "pipeline_not_found" | "missing_context" | "claim_refused";

export type ContinuePipelineOutcome =
  | { kind: "continued"; pipelineId: string }
  | { kind: "refused"; pipelineId: string; reason: PipelineContinuationRefusalReason };

export type PipelineApprovalDecisionRefusalReason = ApprovalRefusalReason | "pipeline_not_found";

export type PipelineApprovalDecisionOutcome =
  | { kind: "applied"; pipelineId: string; stageId: string; decision: ApprovalDecision }
  | { kind: "refused"; pipelineId: string; stageId: string; reason: PipelineApprovalDecisionRefusalReason };

export type PipelineResumeRefusalReason =
  | PipelineContinuationRefusalReason
  | PipelineReopenRefusalReason
  | "pipeline_terminal_succeeded"
  | "pipeline_terminal_rejected"
  | "pipeline_not_resumable";

export type ResumePipelineOutcome =
  | { kind: "resumed"; pipelineId: string }
  | { kind: "refused"; pipelineId: string; reason: PipelineResumeRefusalReason };

/** True when a pipeline row carries the admission context required for restart continuation. */
export function persistedContextLoadPermitsContinuation(context: PipelineContext | null): boolean {
  return context !== null;
}

/** Terminal derived states that refuse resume without stage dispatch. */
export function resumeTerminalRefusalReason(
  derivedState: PipelineDerivedState,
): "pipeline_terminal_succeeded" | "pipeline_terminal_rejected" | null {
  if (derivedState === "succeeded") return "pipeline_terminal_succeeded";
  if (derivedState === "rejected") return "pipeline_terminal_rejected";
  return null;
}

/** True when derived state is awaiting-approval (claim only, never `continuePipeline`). */
export function resumeAwaitingClaimsOnly(derivedState: PipelineDerivedState): boolean {
  return derivedState === "awaiting-approval";
}

/** True when derived state requires `reopenFailedPipeline` before continuation. */
export function resumeFailedRequiresReopen(derivedState: PipelineDerivedState): boolean {
  return derivedState === "failed";
}

/** True when derived state refuses resume without a reopened failed continuation. */
export function resumeDeferredRefusalApplies(
  derivedState: PipelineDerivedState,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): boolean {
  if (derivedState === "running" || derivedState === "interrupted") return true;
  return derivedState === "pending" && !isReopenedFailedContinuation(pipeline);
}

/** True when derived `pending` reflects an already-reopened failed continuation. */
export function resumeReopenedPendingContinuation(
  derivedState: PipelineDerivedState,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): boolean {
  return derivedState === "pending" && isReopenedFailedContinuation(pipeline);
}

/**
 * Restart-safe production continuation: load persisted admission context, claim one live
 * owner, and resume the ordered loop without caller-supplied admission input.
 */
export async function continuePipeline(
  pipelineId: string,
  deps: Omit<PipelineExecutionDeps, "context"> & { context?: PipelineContext },
): Promise<ContinuePipelineOutcome> {
  const { store, dispatch, wait } = deps;
  const resolveStage = deps.resolveStage ?? resolveStageWorkflowSteps;

  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) {
    return { kind: "refused", pipelineId, reason: "pipeline_not_found" };
  }

  const context = pipeline.context;
  if (context === null) {
    return { kind: "refused", pipelineId, reason: "missing_context" };
  }

  const claim = store.claimPipelineContinuation({
    pipelineId,
    priorOwnerIdentity: pipeline.ownerIdentity,
  });
  if (claim.kind === "refused") {
    return { kind: "refused", pipelineId, reason: "claim_refused" };
  }

  await runPipeline(pipelineId, { store, dispatch, wait, context, resolveStage });
  return { kind: "continued", pipelineId };
}

/** True when derived `pending` reflects an in-place failed-continuation reopen, not fresh or approval-gated work. */
export function isReopenedFailedContinuation(pipeline: Pipeline & { stages: PipelineStageRecord[] }): boolean {
  if (!reopenedFailurePermitsActivation(pipeline)) return false;
  const ordered = authoredStagesInPositionOrder(pipeline);
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index];
    if (!entry) continue;
    const { stage, record } = entry;
    if (isAuthoredStageSatisfied(stage, record)) continue;
    if (stage.kind !== "workflow" || record.status !== "pending") return false;
    const priorEntry = index > 0 ? ordered[index - 1] : undefined;
    if (priorEntry?.stage.kind === "approval") return false;
    return ordered
      .slice(0, index)
      .some(
        ({ stage: priorStage, record: priorRecord }) =>
          priorStage.kind === "workflow" && priorRecord.status === "succeeded",
      );
  }
  return false;
}

/**
 * Stage-scoped resume: reopen a failed continuation when needed, claim awaiting pipelines
 * without dispatch, or continue a reopened failed stage — never restart or silently succeed
 * terminal pipelines.
 */
export async function resumePipeline(
  pipelineId: string,
  deps: Omit<PipelineExecutionDeps, "context"> & { context?: PipelineContext },
  options: { detachContinuation?: boolean } = {},
): Promise<ResumePipelineOutcome> {
  const { store } = deps;
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) {
    return { kind: "refused", pipelineId, reason: "pipeline_not_found" };
  }

  const derivedState = derivePipelineState(pipeline);

  const terminalReason = resumeTerminalRefusalReason(derivedState);
  if (terminalReason) {
    return { kind: "refused", pipelineId, reason: terminalReason };
  }
  if (resumeDeferredRefusalApplies(derivedState, pipeline)) {
    return { kind: "refused", pipelineId, reason: "pipeline_not_resumable" };
  }

  if (resumeAwaitingClaimsOnly(derivedState)) {
    if (pipeline.context === null) {
      return { kind: "refused", pipelineId, reason: "missing_context" };
    }
    const claim = store.claimPipelineContinuation({
      pipelineId,
      priorOwnerIdentity: pipeline.ownerIdentity,
    });
    if (claim.kind === "refused") {
      return { kind: "refused", pipelineId, reason: "claim_refused" };
    }
    return { kind: "resumed", pipelineId };
  }

  const continueAfterAdmission = (): ResumePipelineOutcome | Promise<ResumePipelineOutcome> => {
    const dispatchContinuation = async (): Promise<ResumePipelineOutcome> => {
      const continuation = await continuePipeline(pipelineId, deps);
      return continuation.kind === "refused"
        ? { kind: "refused", pipelineId, reason: continuation.reason }
        : { kind: "resumed", pipelineId };
    };
    if (options.detachContinuation) {
      void dispatchContinuation().catch((err: unknown) => {
        console.error(`Pipeline ${pipelineId} continuation after resume failed:`, err);
      });
      return { kind: "resumed", pipelineId };
    }
    return dispatchContinuation();
  };

  if (resumeFailedRequiresReopen(derivedState)) {
    const reopen = store.reopenFailedPipeline({ pipelineId });
    if (reopen.kind === "refused") {
      return { kind: "refused", pipelineId, reason: reopen.reason };
    }
    return continueAfterAdmission();
  }

  if (resumeReopenedPendingContinuation(derivedState, pipeline)) {
    return continueAfterAdmission();
  }

  return { kind: "refused", pipelineId, reason: "pipeline_not_resumable" };
}

/**
 * Resolve `{ pipelineId, stageId }` to one durable approval row and admit `approved` or
 * `rejected` through `commitApprovalDecision`. Refused decisions change no other row.
 */
export function commitPipelineApprovalDecision(args: {
  store: StateStore;
  pipelineId: string;
  stageId: string;
  decision: ApprovalDecision;
}): PipelineApprovalDecisionOutcome {
  const pipeline = args.store.loadPipeline(args.pipelineId);
  if (!pipeline) {
    return { kind: "refused", pipelineId: args.pipelineId, stageId: args.stageId, reason: "pipeline_not_found" };
  }

  const stageRecord = findStageRecord(pipeline.stages, args.stageId);
  if (!stageRecord) {
    return { kind: "refused", pipelineId: args.pipelineId, stageId: args.stageId, reason: "stage_not_found" };
  }

  const outcome = args.store.commitApprovalDecision({ stageRecordId: stageRecord.id, decision: args.decision });
  if (outcome.kind === "refused") {
    return { kind: "refused", pipelineId: args.pipelineId, stageId: args.stageId, reason: outcome.reason };
  }
  return {
    kind: "applied",
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    decision: args.decision,
  };
}

/** Admit one approval decision; when `approved` applies, detach `continuePipeline` from persisted context. */
export function applyPipelineApprovalDecision(
  pipelineId: string,
  stageId: string,
  decision: ApprovalDecision,
  deps: Omit<PipelineExecutionDeps, "context">,
): PipelineApprovalDecisionOutcome {
  const outcome = commitPipelineApprovalDecision({
    store: deps.store,
    pipelineId,
    stageId,
    decision,
  });
  if (outcome.kind === "applied" && decision === "approved") {
    void continuePipeline(pipelineId, deps).catch((err: unknown) => {
      console.error(`Pipeline ${pipelineId} continuation after approval failed:`, err);
    });
  }
  return outcome;
}

/** True when a reached approval row blocks daemon activation. */
export function approvalOutcomeBlocksActivation(status: string): boolean {
  return status === "awaiting" || status === "rejected";
}

/** True when no awaiting or rejected approval row blocks activation. */
export function approvalOutcomePermitsActivation(pipeline: Pipeline & { stages: PipelineStageRecord[] }): boolean {
  for (const { stage, record } of authoredStagesInPositionOrder(pipeline)) {
    if (stage.kind === "approval" && approvalOutcomeBlocksActivation(record.status)) return false;
  }
  return true;
}

/** True when no failed stage row remains — reopen must be applied before activation. */
export function reopenedFailurePermitsActivation(pipeline: Pipeline & { stages: PipelineStageRecord[] }): boolean {
  return !pipeline.stages.some((record) => record.status === "failed");
}

/** True when a reconciled or active pipeline with persisted context has a dispatchable workflow stage. */
export function isPipelineContinuable(pipeline: Pipeline & { stages: PipelineStageRecord[] }): boolean {
  return (
    (pipeline.status === "active" || pipeline.status === "interrupted") &&
    pipeline.context !== null &&
    derivePipelineState(pipeline) === "pending" &&
    approvalOutcomePermitsActivation(pipeline) &&
    reopenedFailurePermitsActivation(pipeline)
  );
}

export async function recoverContinuablePipelines(
  store: StateStore,
  pipelineDeps: Omit<PipelineExecutionDeps, "context">,
  isOwnerAliveProbe: OwnerLivenessProbe = isOwnerAlive,
): Promise<{ continued: number }> {
  let continued = 0;
  for (const pipeline of store.listPipelines()) {
    if (!isPipelineContinuable(pipeline)) continue;
    const owner = pipeline.ownerIdentity;
    if (owner !== null && (await isOwnerAliveProbe(owner))) continue;
    const outcome = await continuePipeline(pipeline.id, pipelineDeps);
    if (outcome.kind === "continued") continued += 1;
  }
  return { continued };
}

function extractArtifactSpecPath(artifact: unknown): string | undefined {
  if (artifact !== null && typeof artifact === "object" && "specPath" in artifact) {
    const specPath = (artifact as { specPath?: unknown }).specPath;
    if (typeof specPath === "string") return specPath;
  }
  return undefined;
}

function findStageRecord(stages: readonly PipelineStageRecord[], stageId: string): PipelineStageRecord | undefined {
  return stages.find((record) => record.stageId === stageId);
}

function findStageRecordById(
  stages: readonly PipelineStageRecord[],
  stageRecordId: string,
): PipelineStageRecord | undefined {
  return stages.find((record) => record.id === stageRecordId);
}

/** True when a reached approval row blocks ordered progression until decided. */
export function approvalGateBlocksProgress(status: string): boolean {
  return status === "awaiting";
}

/** True when a reached approval row permits the eligible next stage. */
export function approvalGatePermitsProgress(status: string): boolean {
  return status === "approved";
}

/** True when a reached approval row deterministically settles the pipeline rejected. */
export function approvalGateSettlesRejected(status: string): boolean {
  return status === "rejected";
}

function isDecidedApprovalStatus(status: string): boolean {
  return (
    approvalGateBlocksProgress(status) || approvalGatePermitsProgress(status) || approvalGateSettlesRejected(status)
  );
}

type ApprovalAdvanceOutcome = "continue" | "stop";

function settleApprovalBoundaryFailure(store: StateStore, pipelineId: string, stageId: string, message: string): void {
  store.updateStage({
    pipelineId,
    stageId,
    patch: { status: "failed", endedAt: Date.now(), failureDetail: { message } },
  });
}

/**
 * Record or honor a reached approval boundary. Persists `pending` → `awaiting` before
 * returning when predecessors succeeded; blocks at `awaiting`, continues past `approved`,
 * and stops at `rejected`. A refused boundary write reloads only the addressed row.
 */
function advanceApprovalStage(args: {
  pipelineId: string;
  stageRecord: PipelineStageRecord;
  store: StateStore;
}): ApprovalAdvanceOutcome {
  const { pipelineId, stageRecord, store } = args;

  const applyStatus = (status: string): ApprovalAdvanceOutcome => {
    if (approvalGatePermitsProgress(status)) return "continue";
    if (approvalGateBlocksProgress(status) || approvalGateSettlesRejected(status)) return "stop";
    settleApprovalBoundaryFailure(
      store,
      pipelineId,
      stageRecord.stageId,
      `approval boundary refused with unexpected status: ${status}`,
    );
    return "stop";
  };

  if (stageRecord.status !== "pending") {
    return applyStatus(stageRecord.status);
  }

  const outcome = store.commitApprovalBoundary({ stageRecordId: stageRecord.id });
  if (outcome.kind === "applied") return "stop";

  const reloaded = store.loadPipeline(pipelineId);
  const row = reloaded ? findStageRecordById(reloaded.stages, stageRecord.id) : undefined;
  const status = row?.status ?? stageRecord.status;
  if (!isDecidedApprovalStatus(status)) {
    settleApprovalBoundaryFailure(
      store,
      pipelineId,
      stageRecord.stageId,
      `approval boundary refused with unexpected status: ${status}`,
    );
    return "stop";
  }
  return applyStatus(status);
}

/** Write `skipped` to every stage row from `fromPosition` onward — dispatched to none of them. */
function skipRemainingStages(
  store: StateStore,
  pipelineId: string,
  stageRecords: readonly PipelineStageRecord[],
  fromPosition: number,
): void {
  for (const record of stageRecords) {
    if (record.position < fromPosition) continue;
    store.updateStage({ pipelineId, stageId: record.stageId, patch: { status: "skipped" } });
  }
}

function carryForwardArtifact(artifactSpecPaths: Map<string, string>, stageId: string, artifact: unknown): void {
  const specPath = extractArtifactSpecPath(artifact);
  if (specPath !== undefined) artifactSpecPaths.set(stageId, specPath);
}

type StageStepOutcome = "continue" | "stop";

/**
 * Resolve and dispatch (or carry forward) one workflow stage. Re-reads the stage's row first,
 * so an already-`running`/settled stage is never re-dispatched — this guards a second loop
 * instance for the same pipeline, though the daemon only ever starts one per `pipeline_start`
 * call. A resolution failure or a dispatched stage settling non-`succeeded` writes `skipped`
 * to every later stage and stops the loop; no dispatch reaches them.
 */
async function advanceWorkflowStage(args: {
  pipelineId: string;
  definition: PipelineDefinition;
  stage: Extract<PipelineStage, { kind: "workflow" }>;
  index: number;
  context: PipelineExecutionDeps["context"];
  artifactSpecPaths: Map<string, string>;
  store: StateStore;
  dispatch: PipelineWorkflowDispatch;
  wait: PipelineWorkflowWait;
  resolveStage: NonNullable<PipelineExecutionDeps["resolveStage"]>;
}): Promise<StageStepOutcome> {
  const { pipelineId, definition, stage, index, context, artifactSpecPaths, store, dispatch, wait, resolveStage } =
    args;

  try {
    const current = store.loadPipeline(pipelineId);
    const stageRecords = current?.stages ?? [];
    const record = current ? findStageRecord(stageRecords, stage.stageId) : undefined;

    if (record?.status === "succeeded") {
      carryForwardArtifact(artifactSpecPaths, stage.stageId, record.artifact);
      return "continue";
    }
    if (record?.status === "running" || record?.status === "failed" || record?.status === "skipped") {
      return "stop";
    }

    const resolution = await resolveStage(definition, index, context, artifactSpecPaths);
    if (!resolution.ok) {
      store.updateStage({
        pipelineId,
        stageId: stage.stageId,
        patch: { status: "failed", endedAt: Date.now(), failureDetail: { message: resolution.error } },
      });
      skipRemainingStages(store, pipelineId, stageRecords, index + 1);
      return "stop";
    }

    await dispatchPipelineStage({ pipelineId, stageId: stage.stageId, steps: resolution.steps, dispatch, wait, store });

    const settled = store.loadPipeline(pipelineId);
    const settledRecords = settled?.stages ?? [];
    const settledRecord = settled ? findStageRecord(settledRecords, stage.stageId) : undefined;
    if (settledRecord?.status !== "succeeded") {
      skipRemainingStages(store, pipelineId, settledRecords, index + 1);
      return "stop";
    }

    carryForwardArtifact(artifactSpecPaths, stage.stageId, settledRecord.artifact);
    return "continue";
  } catch (error) {
    try {
      store.updateStage({
        pipelineId,
        stageId: stage.stageId,
        patch: {
          status: "failed",
          endedAt: Date.now(),
          failureDetail: { message: error instanceof Error ? error.message : String(error) },
        },
      });
    } catch {
      // The store itself is unreachable; nothing further can be recorded.
    }
    const afterFailure = store.loadPipeline(pipelineId);
    skipRemainingStages(store, pipelineId, afterFailure?.stages ?? [], index + 1);
    return "stop";
  }
}

function failStrandedPipelineStage(
  store: StateStore,
  pipelineId: string,
  definition: PipelineDefinition,
  error: unknown,
): void {
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) return;
  const detail = { message: error instanceof Error ? error.message : String(error) };
  for (const stageRecord of pipeline.stages) {
    const authored = definition.stages[stageRecord.position];
    if (authored?.kind !== "workflow") continue;
    const record = findStageRecord(pipeline.stages, stageRecord.stageId);
    if (record?.status !== "pending" && record?.status !== "running") continue;
    try {
      store.updateStage({
        pipelineId,
        stageId: stageRecord.stageId,
        patch: { status: "failed", endedAt: Date.now(), failureDetail: detail },
      });
      skipRemainingStages(store, pipelineId, pipeline.stages, stageRecord.position + 1);
    } catch {
      // The store itself is unreachable; nothing further can be recorded.
    }
    return;
  }
}

/**
 * Walk a pipeline's authored stages in order, resolving and dispatching each workflow stage
 * only once the immediately preceding workflow stage's row reads `succeeded`. An approval
 * stage records or honors its durable status (`pending` → `awaiting`, block at `awaiting`,
 * continue past `approved`, stop at `rejected`) with no dispatch to later stages.
 */
export async function runPipeline(pipelineId: string, deps: PipelineExecutionDeps): Promise<void> {
  const { store, dispatch, wait, context } = deps;
  const resolveStage = deps.resolveStage ?? resolveStageWorkflowSteps;
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) return;

  const definition = pipeline.definition;
  const artifactSpecPaths = new Map<string, string>();

  try {
    // Walk the durable stage rows (ordered by their stored `position`) rather than the authored
    // definition array, so the loop's ordering cannot drift from what `loadPipeline` reports.
    for (const stageRecord of pipeline.stages) {
      const index = stageRecord.position;
      const stage = definition.stages[index];
      if (stage === undefined) continue;
      if (stage.kind === "approval") {
        const outcome = advanceApprovalStage({ pipelineId, stageRecord, store });
        if (outcome === "stop") return;
        continue;
      }

      const outcome = await advanceWorkflowStage({
        pipelineId,
        definition,
        stage,
        index,
        context,
        artifactSpecPaths,
        store,
        dispatch,
        wait,
        resolveStage,
      });
      if (outcome === "stop") return;
    }
  } catch (error) {
    failStrandedPipelineStage(store, pipelineId, definition, error);
  }
}

export function isAuthoredStageSatisfied(stage: PipelineStage, record: PipelineStageRecord | undefined): boolean {
  if (record === undefined) return false;
  if (stage.kind === "workflow") return record.status === "succeeded";
  return record.status === "approved";
}

/** Authored stages in durable `position` order — same walk `runPipeline` and `loadPipeline` use. */
export function authoredStagesInPositionOrder(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): Array<{ stage: PipelineStage; record: PipelineStageRecord }> {
  const ordered: Array<{ stage: PipelineStage; record: PipelineStageRecord }> = [];
  for (const record of pipeline.stages) {
    const stage = pipeline.definition.stages[record.position];
    if (stage === undefined) continue;
    ordered.push({ stage, record });
  }
  return ordered;
}

/**
 * Derive a pipeline's overall state from durable pipeline and stage rows — first match wins:
 * `interrupted` (stage rows only), `rejected`, `failed`, `running`, then an authored-order
 * walk for `awaiting-approval`/`pending`, else `succeeded`. Pipeline-level `interrupted` is a
 * reconciliation marker and does not mask preserved stage evidence. `skipped` rows are never
 * satisfied and are never reached because `failed` always precedes them.
 */
export function derivePipelineState(pipeline: Pipeline & { stages: PipelineStageRecord[] }): PipelineDerivedState {
  const { stages: stageRecords } = pipeline;

  if (stageRecords.some((record) => record.status === "interrupted")) {
    return "interrupted";
  }

  const ordered = authoredStagesInPositionOrder(pipeline);
  for (const { stage, record } of ordered) {
    if (stage.kind === "approval" && record.status === "rejected") return "rejected";
  }
  for (const { record } of ordered) {
    if (record.status === "failed") return "failed";
  }
  for (const { stage, record } of ordered) {
    if (stage.kind === "workflow" && record.status === "running") return "running";
  }
  for (const { stage, record } of ordered) {
    if (!isAuthoredStageSatisfied(stage, record)) {
      return stage.kind === "approval" ? "awaiting-approval" : "pending";
    }
  }
  return "succeeded";
}
