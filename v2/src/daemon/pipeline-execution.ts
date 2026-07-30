import type { PipelineDefinition, PipelineStage } from "../execution/pipeline-definition.ts";
import type {
  Pipeline,
  PipelineContinuationClaimOutcome,
  PipelineStageRecord,
  StateStore,
} from "../persistence/state-store.ts";
import {
  dispatchPipelineStage,
  type PipelineWorkflowDispatch,
  type PipelineWorkflowWait,
} from "./pipeline-stage-dispatch.ts";
import { type PipelineContext, resolveStageWorkflowSteps } from "./pipeline-stage-resolve.ts";

export type PipelineDerivedState = "succeeded" | "failed" | "awaiting-approval" | "running" | "pending";

export type ContinueDurablePipelineDeps = Omit<PipelineExecutionDeps, "context"> & {
  /** When false, refuse before loading persisted context (guard-inversion tests). Defaults to true. */
  loadPersistedContext?: boolean;
  /** When false, refuse before claiming continuation ownership (guard-inversion tests). Defaults to true. */
  claimContinuation?: boolean;
};

export type ContinueDurablePipelineResult = {
  claim: PipelineContinuationClaimOutcome;
  run: Promise<void>;
};

export type PipelineActivationEligibility =
  | { eligible: true; reason: "approved-continuation" | "reopened-continuation" }
  | {
      eligible: false;
      reason:
        | "pipeline-not-found"
        | "missing-context"
        | "awaiting-approval"
        | "rejected-approval"
        | "interrupted-stage"
        | "no-continuation";
    };

export type ActivateDurablePipelineDeps = ContinueDurablePipelineDeps & {
  /** When false, skip approval/reopen eligibility before claiming (guard-inversion tests). Defaults to true. */
  checkActivationEligibility?: boolean;
};

export type ActivateDurablePipelineResult = {
  eligibility: PipelineActivationEligibility;
  claim: PipelineContinuationClaimOutcome;
  run: Promise<void>;
};

/**
 * Whether an interrupted pipeline has an approved gate or reopened failure ready for
 * daemon activation. Awaiting and rejected gates, an interrupted workflow stage, and
 * pipelines with no eligible pending continuation are ineligible.
 */
export function analyzePipelineActivationEligibility(
  pipeline: (Pipeline & { stages: PipelineStageRecord[]; context?: PipelineContext | null }) | null,
): PipelineActivationEligibility {
  if (pipeline === null) {
    return { eligible: false, reason: "pipeline-not-found" };
  }
  if (pipeline.context === null || pipeline.context === undefined) {
    return { eligible: false, reason: "missing-context" };
  }

  const byStageId = new Map(pipeline.stages.map((record) => [record.stageId, record]));
  let sawApprovedGate = false;

  for (const stage of pipeline.definition.stages) {
    const status = byStageId.get(stage.stageId)?.status;
    const verdict =
      stage.kind === "workflow" ? workflowStageVerdict(status, sawApprovedGate) : approvalStageVerdict(status);
    if (verdict !== "advance") return verdict;
    if (stage.kind === "approval") sawApprovedGate = true;
  }

  return { eligible: false, reason: "no-continuation" };
}

/** Eligibility contribution of one workflow stage, or `advance` when the walk continues. */
function workflowStageVerdict(
  status: PipelineStageRecord["status"] | undefined,
  sawApprovedGate: boolean,
): PipelineActivationEligibility | "advance" {
  if (status === "succeeded") return "advance";
  if (status === "pending")
    return { eligible: true, reason: sawApprovedGate ? "approved-continuation" : "reopened-continuation" };
  if (status === "interrupted") return { eligible: false, reason: "interrupted-stage" };
  return { eligible: false, reason: "no-continuation" };
}

/** Eligibility contribution of one approval stage, or `advance` when the gate is approved. */
function approvalStageVerdict(
  status: PipelineStageRecord["status"] | undefined,
): PipelineActivationEligibility | "advance" {
  if (status === "approved") return "advance";
  if (status === "awaiting") return { eligible: false, reason: "awaiting-approval" };
  if (status === "rejected") return { eligible: false, reason: "rejected-approval" };
  return { eligible: false, reason: "no-continuation" };
}

function activationClaimRefusal(eligibility: PipelineActivationEligibility): PipelineContinuationClaimOutcome {
  if (!eligibility.eligible) {
    if (eligibility.reason === "pipeline-not-found") {
      return { outcome: "refused", reason: "pipeline-not-found" };
    }
    if (eligibility.reason === "missing-context") {
      return { outcome: "refused", reason: "missing-context" };
    }
  }
  return { outcome: "refused", reason: "claim-refused" };
}

/**
 * Restart-safe activation for an approved gate or reopened failure: verify eligibility,
 * atomically claim one live owner and runnable pipeline state, then resume the ordered loop.
 */
export function activateDurablePipeline(
  pipelineId: string,
  deps: ActivateDurablePipelineDeps,
): ActivateDurablePipelineResult {
  const checkEligibility = deps.checkActivationEligibility ?? true;
  const pipeline = deps.store.loadPipeline(pipelineId);
  const eligibility = analyzePipelineActivationEligibility(pipeline);

  if (checkEligibility && !eligibility.eligible) {
    return {
      eligibility,
      claim: activationClaimRefusal(eligibility),
      run: Promise.resolve(),
    };
  }

  const continuation = continueDurablePipeline(pipelineId, deps);
  return { eligibility, claim: continuation.claim, run: continuation.run };
}

/**
 * Restart-safe production continuation: load persisted admission context, claim one live
 * owner and runnable pipeline state, then resume the ordered loop. Caller-supplied
 * context is intentionally unsupported — resolution input comes from the repository.
 */
export function continueDurablePipeline(
  pipelineId: string,
  deps: ContinueDurablePipelineDeps,
): ContinueDurablePipelineResult {
  const loadPersistedContext = deps.loadPersistedContext ?? true;
  const shouldClaim = deps.claimContinuation ?? true;

  if (!loadPersistedContext) {
    return { claim: { outcome: "refused", reason: "missing-context" }, run: Promise.resolve() };
  }

  const pipeline = deps.store.loadPipeline(pipelineId);
  if (!pipeline) {
    return { claim: { outcome: "refused", reason: "pipeline-not-found" }, run: Promise.resolve() };
  }
  if (pipeline.context === null || pipeline.context === undefined) {
    return { claim: { outcome: "refused", reason: "missing-context" }, run: Promise.resolve() };
  }

  if (!shouldClaim) {
    return { claim: { outcome: "refused", reason: "claim-refused" }, run: Promise.resolve() };
  }

  const claim = deps.store.claimPipelineContinuation(pipelineId);
  if (claim.outcome === "refused") {
    return { claim, run: Promise.resolve() };
  }

  const context = pipeline.context;
  const run = runPipeline(pipelineId, {
    store: deps.store,
    dispatch: deps.dispatch,
    wait: deps.wait,
    context,
    ...(deps.resolveStage !== undefined ? { resolveStage: deps.resolveStage } : {}),
  });
  return { claim, run };
}

export type PipelineExecutionDeps = {
  store: StateStore;
  dispatch: PipelineWorkflowDispatch;
  wait: PipelineWorkflowWait;
  context: PipelineContext;
  resolveStage?: typeof resolveStageWorkflowSteps;
};

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
 * Apply one approval row's durable status during ordered progression. A pending row
 * requests `awaiting` before stopping; a refused boundary write reloads only that row
 * and follows its authoritative meaning.
 */
function advanceApprovalStage(args: {
  store: StateStore;
  pipelineId: string;
  stage: Extract<PipelineStage, { kind: "approval" }>;
  stageRecord: PipelineStageRecord;
  stageRecords: readonly PipelineStageRecord[];
  position: number;
}): StageStepOutcome {
  const { store, pipelineId, stage, stageRecord, stageRecords, position } = args;

  const resolve = (record: PipelineStageRecord): StageStepOutcome => {
    if (record.status === "approved") return "continue";
    if (record.status === "awaiting") return "stop";
    skipRemainingStages(store, pipelineId, stageRecords, position + 1);
    return "stop";
  };

  if (stageRecord.status !== "pending") return resolve(stageRecord);

  if (store.markApprovalAwaiting({ stageRecordId: stageRecord.id, stageId: stage.stageId }).outcome === "applied") {
    return "stop";
  }

  const reloaded = store.loadPipeline(pipelineId);
  const reloadedRecord = reloaded ? findStageRecord(reloaded.stages, stage.stageId) : undefined;
  if (!reloadedRecord) {
    skipRemainingStages(store, pipelineId, stageRecords, position + 1);
    return "stop";
  }
  return resolve(reloadedRecord);
}

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
 * stage records `awaiting` when reached, blocks while awaiting, continues past `approved`,
 * and settles deterministically at `rejected` without later dispatch.
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
    for (const stageOutline of pipeline.stages) {
      const current = store.loadPipeline(pipelineId);
      if (!current) return;
      const stageRecord = findStageRecord(current.stages, stageOutline.stageId);
      if (!stageRecord) return;

      const index = stageRecord.position;
      const stage = definition.stages[index];
      if (stage === undefined) continue;

      if (stage.kind === "approval") {
        if (
          advanceApprovalStage({
            store,
            pipelineId,
            stage,
            stageRecord,
            stageRecords: current.stages,
            position: index,
          }) === "stop"
        ) {
          return;
        }
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

/**
 * Derive a pipeline's overall state from its stage rows: `failed` if any workflow stage row
 * reads `failed`; `running` if any workflow stage row reads `running`; otherwise walk the
 * authored stages in order and stop at the first one that has not passed — an approval row
 * reading `awaiting` yields `awaiting-approval`, `approved` counts as passed, `rejected` yields
 * `failed`, and an undispatched/unsettled workflow stage yields `pending`. `succeeded` requires
 * every stage in the walk to have passed, including an approval gate reached at the very end.
 * `skipped` rows are never read as `failed` — they only distinguish "will never run", and are
 * never reached by the ordered walk because a `failed` row always precedes them.
 */
export function derivePipelineState(pipeline: Pipeline & { stages: PipelineStageRecord[] }): PipelineDerivedState {
  const { stages: stageRecords, definition } = pipeline;
  const byStageId = new Map(stageRecords.map((record) => [record.stageId, record]));
  const workflowStages = definition.stages.filter(
    (stage): stage is Extract<PipelineStage, { kind: "workflow" }> => stage.kind === "workflow",
  );

  if (workflowStages.some((stage) => byStageId.get(stage.stageId)?.status === "failed")) {
    return "failed";
  }
  if (
    definition.stages.some((stage) => stage.kind === "approval" && byStageId.get(stage.stageId)?.status === "rejected")
  ) {
    return "failed";
  }
  if (workflowStages.some((stage) => byStageId.get(stage.stageId)?.status === "running")) {
    return "running";
  }

  for (const stage of definition.stages) {
    const status = byStageId.get(stage.stageId)?.status;
    if (stage.kind === "workflow") {
      if (status === "succeeded") continue;
      return "pending";
    }
    if (status === "approved") continue;
    if (status === "awaiting") return "awaiting-approval";
    if (status === "rejected") return "failed";
    return "pending";
  }

  return "succeeded";
}
