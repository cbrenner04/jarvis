import { basename } from "node:path";
import type { PipelineDefinition, PipelineStage, PipelineTerminalAction } from "../execution/pipeline-definition.ts";
import { normalizePublicationFailure, type PublicationFailure } from "../execution/publication-retry.ts";
import {
  executeTerminalPublication,
  TerminalPublicationError,
  type TerminalPublicationInput,
  type TerminalPublicationResult,
} from "../execution/terminal-publication.ts";
import {
  type ApprovalDecision,
  type ApprovalRefusalReason,
  DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  isOwnerAlive,
  type OwnerLivenessProbe,
  type Pipeline,
  type PipelineContext,
  type PipelineReopenRefusalReason,
  type PipelineStageRecord,
  type StateStore,
} from "../persistence/state-store.ts";
import type { PipelineStageArtifact } from "./pipeline-stage-dispatch.ts";
import {
  dispatchPipelineStage,
  type PipelineWorkflowDispatch,
  type PipelineWorkflowWait,
} from "./pipeline-stage-dispatch.ts";
import {
  isFanOutStageResolution,
  resolveStageWorkflowSteps,
  singleStageResolutionSteps,
} from "./pipeline-stage-resolve.ts";

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
  executeTerminalPublication?: (input: TerminalPublicationInput) => Promise<TerminalPublicationResult>;
};

export type PipelineContinuationRefusalReason = "pipeline_not_found" | "missing_context" | "claim_refused";

export type ContinuePipelineOutcome =
  | { kind: "continued"; pipelineId: string }
  | { kind: "refused"; pipelineId: string; reason: PipelineContinuationRefusalReason };

export type PipelineApprovalDecisionRefusalReason =
  | ApprovalRefusalReason
  | "pipeline_not_found"
  | "branch_key_required";

export type PipelineFailureDetail = {
  branchKeys: string[];
  message: string;
};

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

let invertResumeFailedRequiresReopenForTest = false;

export function setInvertResumeFailedRequiresReopenForTest(value: boolean): void {
  invertResumeFailedRequiresReopenForTest = value;
}

/** True when derived state requires `reopenFailedPipeline` before continuation. */
export function resumeFailedRequiresReopen(derivedState: PipelineDerivedState): boolean {
  const requires = derivedState === "failed";
  return invertResumeFailedRequiresReopenForTest ? !requires : requires;
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

  await runPipeline(pipelineId, {
    store,
    dispatch,
    wait,
    context,
    resolveStage,
    ...(deps.executeTerminalPublication !== undefined
      ? { executeTerminalPublication: deps.executeTerminalPublication }
      : {}),
  });
  return { kind: "continued", pipelineId };
}

/** True when derived `pending` reflects an in-place failed-continuation reopen, not fresh or approval-gated work. */
export function isReopenedFailedContinuation(pipeline: Pipeline & { stages: PipelineStageRecord[] }): boolean {
  if (!reopenedFailurePermitsActivation(pipeline)) return false;
  const ordered = authoredStagesInPositionOrder(pipeline);
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index];
    if (entry === undefined) continue;
    const { stage, record } = entry;
    if (isAuthoredStageSatisfied(stage, record)) continue;
    if (stage.kind !== "workflow" || record.status !== "pending") return false;
    const priorEntry = index > 0 ? ordered[index - 1] : undefined;
    if (priorEntry !== undefined && priorEntry.stage.kind === "approval") return false;
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
  branchKey?: string;
  decision: ApprovalDecision;
}): PipelineApprovalDecisionOutcome {
  const pipeline = args.store.loadPipeline(args.pipelineId);
  if (!pipeline) {
    return { kind: "refused", pipelineId: args.pipelineId, stageId: args.stageId, reason: "pipeline_not_found" };
  }

  const fanOutBranchKeys = [
    ...new Set(
      pipeline.stages
        .filter(
          (record) =>
            record.stageId === args.stageId &&
            record.status !== "skipped" &&
            record.branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
        )
        .map((record) => record.branchKey),
    ),
  ];
  if (fanOutBranchKeys.length > 1 && args.branchKey === undefined) {
    return { kind: "refused", pipelineId: args.pipelineId, stageId: args.stageId, reason: "branch_key_required" };
  }

  const branchKey = args.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
  const stageRecord = findStageRecord(pipeline.stages, args.stageId, branchKey);
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
  branchKey?: string,
): PipelineApprovalDecisionOutcome {
  const outcome = commitPipelineApprovalDecision({
    store: deps.store,
    pipelineId,
    stageId,
    ...(branchKey !== undefined ? { branchKey } : {}),
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

function fanOutBranchHasContinuableWork(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  branchKey: string,
): boolean {
  for (let index = 0; index <= split.splitPosition; index += 1) {
    const stage = pipeline.definition.stages[index];
    if (stage === undefined) continue;
    const record = findStageRecord(pipeline.stages, stage.stageId, DEFAULT_PIPELINE_STAGE_BRANCH_KEY);
    if (!isAuthoredStageSatisfied(stage, record)) return false;
  }

  for (const { stage, record } of suffixStagesForBranch(pipeline, split.splitPosition, branchKey)) {
    if (stage.kind === "approval" && record.status === "rejected") return false;
    if (record.status === "failed") return false;
    if (stage.kind === "approval" && approvalOutcomeBlocksActivation(record.status)) return false;
    if (!isAuthoredStageSatisfied(stage, record)) return true;
  }
  return false;
}

function fanOutApprovalPermitsActivation(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
): boolean {
  for (const branchKey of split.branchKeys) {
    if (!fanOutBranchHasContinuableWork(pipeline, split, branchKey)) continue;
    for (const { stage, record } of suffixStagesForBranch(pipeline, split.splitPosition, branchKey)) {
      if (stage.kind === "approval" && approvalOutcomeBlocksActivation(record.status)) return false;
    }
    return true;
  }
  return true;
}

/** True when a reconciled or active pipeline with persisted context has a dispatchable workflow stage or pending settlement. */
export function isPipelineContinuable(pipeline: Pipeline & { stages: PipelineStageRecord[] }): boolean {
  if (pipeline.status !== "active" && pipeline.status !== "interrupted") return false;
  if (pipeline.context === null) return false;
  if (isPipelineSettlementPending(pipeline)) return true;

  const split = findFanOutSplit(pipeline);
  if (split !== null) {
    const hasContinuableBranch = split.branchKeys.some((branchKey) =>
      fanOutBranchHasContinuableWork(pipeline, split, branchKey),
    );
    if (hasContinuableBranch) {
      return fanOutApprovalPermitsActivation(pipeline, split);
    }
  }

  return (
    derivePipelineState(pipeline) === "pending" &&
    approvalOutcomePermitsActivation(pipeline) &&
    reopenedFailurePermitsActivation(pipeline)
  );
}

let invertPipelineTerminalPublicationFailureGuardForTest = false;

export function setInvertPipelineTerminalPublicationFailureGuardForTest(value: boolean): void {
  invertPipelineTerminalPublicationFailureGuardForTest = value;
}

/** True when the pipeline row carries a durable terminal-publication failure. */
export function hasPipelineTerminalPublicationFailure(pipeline: Pick<Pipeline, "terminalPublicationFailure">): boolean {
  if (invertPipelineTerminalPublicationFailureGuardForTest) return false;
  return pipeline.terminalPublicationFailure !== null;
}

/** True when every authored stage is satisfied but terminal publication has not succeeded. */
export function isPipelineSettlementPending(pipeline: Pipeline & { stages: PipelineStageRecord[] }): boolean {
  if (pipeline.definition.terminalAction === undefined) return false;
  if (pipeline.terminalPublicationSucceededAt !== null) return false;
  if (pipeline.terminalPublicationFailure !== null) return false;

  const split = findFanOutSplit(pipeline);
  if (split !== null) {
    for (let index = 0; index <= split.splitPosition; index += 1) {
      const stage = pipeline.definition.stages[index];
      if (stage === undefined) continue;
      const record = findStageRecord(pipeline.stages, stage.stageId, DEFAULT_PIPELINE_STAGE_BRANCH_KEY);
      if (!isAuthoredStageSatisfied(stage, record)) return false;
    }
    for (const branchKey of split.branchKeys) {
      for (const { stage, record } of suffixStagesForBranch(pipeline, split.splitPosition, branchKey)) {
        if (!isAuthoredStageSatisfied(stage, record)) return false;
      }
    }
    return true;
  }

  for (const { stage, record } of authoredStagesInPositionOrder(pipeline)) {
    if (record.branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY) continue;
    if (!isAuthoredStageSatisfied(stage, record)) return false;
  }
  return true;
}

type ResolvedTerminalPublicationInput =
  | { ok: true; input: TerminalPublicationInput }
  | { ok: false; failure: PublicationFailure; prNumber?: number; prUrl?: string };

function resolveTerminalPublicationInput(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  store: StateStore,
): ResolvedTerminalPublicationInput {
  const terminalAction = pipeline.definition.terminalAction;
  if (terminalAction === undefined) {
    return { ok: false, failure: { operation: "terminal-publication", message: "pipeline has no terminal action" } };
  }

  if (findFanOutSplit(pipeline) !== null) {
    return {
      ok: false,
      failure: {
        operation: terminalAction,
        message: "multi-branch terminal publication is not defined for fan-out pipelines",
      },
    };
  }

  let lastStage: { stage: Extract<PipelineStage, { kind: "workflow" }>; record: PipelineStageRecord } | undefined;
  for (const entry of authoredStagesInPositionOrder(pipeline)) {
    if (entry.stage.kind === "workflow" && entry.record.status === "succeeded") {
      lastStage = { stage: entry.stage, record: entry.record };
    }
  }
  if (lastStage === undefined) {
    return {
      ok: false,
      failure: { operation: terminalAction, message: "no succeeded workflow stage artifact available" },
    };
  }

  const rawArtifact = lastStage.record.artifact;
  const artifact =
    rawArtifact !== null &&
    typeof rawArtifact === "object" &&
    typeof (rawArtifact as PipelineStageArtifact).entryRunId === "string" &&
    typeof (rawArtifact as PipelineStageArtifact).specPath === "string"
      ? (rawArtifact as PipelineStageArtifact)
      : undefined;
  if (artifact === undefined) {
    return {
      ok: false,
      failure: {
        operation: terminalAction,
        message: `stage "${lastStage.stage.stageId}" is missing a valid workflow artifact`,
      },
    };
  }

  const entryRun = store.loadRun(artifact.entryRunId);
  if (entryRun === null) {
    return {
      ok: false,
      failure: {
        operation: terminalAction,
        message: `entry run ${artifact.entryRunId} not found for terminal publication`,
      },
      ...(artifact.prNumber !== undefined ? { prNumber: artifact.prNumber } : {}),
      ...(artifact.prUrl !== undefined ? { prUrl: artifact.prUrl } : {}),
    };
  }

  return {
    ok: true,
    input: {
      terminalAction,
      worktreePath: entryRun.worktreePath,
      branch: entryRun.branch,
      baseRef: entryRun.specRef,
      ...(artifact.prNumber !== undefined ? { prNumber: artifact.prNumber } : {}),
      ...(artifact.prUrl !== undefined ? { prUrl: artifact.prUrl } : {}),
    },
  };
}

function commitTerminalPublicationFailureSafely(
  store: StateStore,
  args: Parameters<StateStore["commitTerminalPublicationFailure"]>[0],
): void {
  try {
    store.commitTerminalPublicationFailure(args);
  } catch {
    try {
      store.commitTerminalPublicationFailure({
        pipelineId: args.pipelineId,
        terminalAction: args.terminalAction,
        failure: {
          operation: args.terminalAction,
          message: "terminal publication failure commit failed",
        },
      });
    } catch {
      // store unavailable — settlement cannot record further
    }
  }
}

function commitTerminalPublicationSuccessSafely(
  store: StateStore,
  pipelineId: string,
  terminalAction: PipelineTerminalAction,
): void {
  try {
    store.commitTerminalPublicationSuccess({ pipelineId });
  } catch (error) {
    commitTerminalPublicationFailureSafely(store, {
      pipelineId,
      terminalAction,
      failure: normalizePublicationFailure(terminalAction, error),
    });
  }
}

async function settlePipelineTerminalPublication(
  pipelineId: string,
  deps: Pick<PipelineExecutionDeps, "store" | "executeTerminalPublication">,
): Promise<void> {
  const { store } = deps;
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline || !isPipelineSettlementPending(pipeline)) return;

  const terminalAction = pipeline.definition.terminalAction;
  if (!terminalAction) return;

  if (pipeline.context === null) {
    commitTerminalPublicationFailureSafely(store, {
      pipelineId,
      terminalAction,
      failure: {
        operation: terminalAction,
        message: "missing pipeline admission context",
      },
    });
    return;
  }

  const resolved = resolveTerminalPublicationInput(pipeline, store);
  if (!resolved.ok) {
    commitTerminalPublicationFailureSafely(store, {
      pipelineId,
      terminalAction,
      failure: resolved.failure,
      ...(resolved.prNumber !== undefined ? { prNumber: resolved.prNumber } : {}),
      ...(resolved.prUrl !== undefined ? { prUrl: resolved.prUrl } : {}),
    });
    return;
  }

  const execute = deps.executeTerminalPublication ?? executeTerminalPublication;
  try {
    await execute(resolved.input);
    commitTerminalPublicationSuccessSafely(store, pipelineId, terminalAction);
  } catch (error) {
    if (error instanceof TerminalPublicationError) {
      commitTerminalPublicationFailureSafely(store, {
        pipelineId,
        terminalAction: error.terminalAction,
        failure: error.failure,
        ...(error.prNumber !== undefined ? { prNumber: error.prNumber } : {}),
        ...(error.prUrl !== undefined ? { prUrl: error.prUrl } : {}),
      });
      return;
    }
    commitTerminalPublicationFailureSafely(store, {
      pipelineId,
      terminalAction,
      failure: normalizePublicationFailure(terminalAction, error),
      ...(resolved.input.prNumber !== undefined ? { prNumber: resolved.input.prNumber } : {}),
      ...(resolved.input.prUrl !== undefined ? { prUrl: resolved.input.prUrl } : {}),
    });
  }
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

function findStageRecord(
  stages: readonly PipelineStageRecord[],
  stageId: string,
  branchKey: string = DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
): PipelineStageRecord | undefined {
  return stages.find((record) => record.stageId === stageId && record.branchKey === branchKey);
}

export function branchKeyFromDownstreamInput(path: string): string {
  const base = basename(path);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

type FanOutSplit = {
  splitPosition: number;
  branchKeys: string[];
};

function isSplittingArtifact(artifact: PipelineStageArtifact): boolean {
  return (artifact.downstreamInputs?.length ?? 0) >= 2;
}

function findFanOutSplit(pipeline: Pipeline & { stages: PipelineStageRecord[] }): FanOutSplit | null {
  for (const { stage, record } of authoredStagesInPositionOrder(pipeline)) {
    if (stage.kind !== "workflow") continue;
    if (record.branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY || record.status !== "succeeded") continue;
    const artifact = record.artifact;
    if (
      artifact !== null &&
      typeof artifact === "object" &&
      typeof (artifact as PipelineStageArtifact).entryRunId === "string" &&
      typeof (artifact as PipelineStageArtifact).specPath === "string"
    ) {
      const typed = artifact as PipelineStageArtifact;
      if (isSplittingArtifact(typed)) {
        return {
          splitPosition: record.position,
          branchKeys: typed.downstreamInputs!.map(branchKeyFromDownstreamInput),
        };
      }
    }
  }
  return null;
}

function suffixStagesForBranch(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  splitPosition: number,
  branchKey: string,
): Array<{ stage: PipelineStage; record: PipelineStageRecord }> {
  const ordered: Array<{ stage: PipelineStage; record: PipelineStageRecord }> = [];
  for (const { stage, record } of authoredStagesInPositionOrder(pipeline)) {
    if (record.position <= splitPosition) continue;
    if (record.branchKey !== branchKey) continue;
    ordered.push({ stage, record });
  }
  return ordered;
}

type AdmitFanOutBranchesResult = { ok: true; branchKeys: string[] } | { ok: false; error: string };

function admitFanOutBranches(
  store: StateStore,
  pipelineId: string,
  definition: PipelineDefinition,
  splitPosition: number,
  downstreamInputs: readonly string[],
): AdmitFanOutBranchesResult {
  const branchKeys = downstreamInputs.map(branchKeyFromDownstreamInput);
  const seen = new Set<string>();
  for (const branchKey of branchKeys) {
    if (seen.has(branchKey)) {
      return { ok: false, error: `duplicate branchKey "${branchKey}" from downstreamInputs` };
    }
    seen.add(branchKey);
  }

  for (let position = splitPosition + 1; position < definition.stages.length; position += 1) {
    const stage = definition.stages[position];
    if (stage === undefined) continue;
    const stageRecords = store.loadPipeline(pipelineId)?.stages ?? [];
    for (const branchKey of branchKeys) {
      if (findStageRecord(stageRecords, stage.stageId, branchKey) !== undefined) continue;
      store.createPipelineStageBranch({ pipelineId, stageId: stage.stageId, branchKey });
    }
    const defaultRecord = findStageRecord(store.loadPipeline(pipelineId)?.stages ?? [], stage.stageId);
    if (defaultRecord?.status === "pending") {
      store.updateStage({
        pipelineId,
        stageId: stage.stageId,
        branchKey: DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
        patch: { status: "skipped" },
      });
    }
  }
  return { ok: true, branchKeys };
}

function buildBranchStageArtifacts(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  branchKey: string,
  stageIndex: number,
): Map<string, PipelineStageArtifact> {
  const artifacts = new Map<string, PipelineStageArtifact>();
  for (let index = 0; index < stageIndex; index += 1) {
    const stage = pipeline.definition.stages[index];
    if (stage?.kind !== "workflow") continue;
    const recordBranchKey = index <= split.splitPosition ? DEFAULT_PIPELINE_STAGE_BRANCH_KEY : branchKey;
    const record = findStageRecord(pipeline.stages, stage.stageId, recordBranchKey);
    carryForwardArtifact(artifacts, stage.stageId, record?.artifact);
  }
  return artifacts;
}

/** Aggregate failure detail naming failed or rejected fan-out branch keys. */
export function derivePipelineFailureDetail(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): PipelineFailureDetail | null {
  const split = findFanOutSplit(pipeline);
  if (split === null) return null;

  const rejectedKeys: string[] = [];
  const failedKeys: string[] = [];
  for (const branchKey of split.branchKeys) {
    for (const { stage, record } of suffixStagesForBranch(pipeline, split.splitPosition, branchKey)) {
      if (stage.kind === "approval" && record.status === "rejected") {
        rejectedKeys.push(branchKey);
        break;
      }
      if (stage.kind === "workflow" && record.status === "failed") {
        failedKeys.push(branchKey);
        break;
      }
    }
  }

  if (rejectedKeys.length > 0) {
    return { branchKeys: rejectedKeys, message: `rejected branches: ${rejectedKeys.join(", ")}` };
  }
  if (failedKeys.length > 0) {
    return { branchKeys: failedKeys, message: `failed branches: ${failedKeys.join(", ")}` };
  }
  return null;
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

function settleApprovalBoundaryFailure(
  store: StateStore,
  pipelineId: string,
  stageId: string,
  branchKey: string,
  message: string,
): void {
  store.updateStage({
    pipelineId,
    stageId,
    branchKey,
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
    if (status === "skipped") return "continue";
    if (approvalGatePermitsProgress(status)) return "continue";
    if (approvalGateBlocksProgress(status) || approvalGateSettlesRejected(status)) return "stop";
    settleApprovalBoundaryFailure(
      store,
      pipelineId,
      stageRecord.stageId,
      stageRecord.branchKey,
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
      stageRecord.branchKey,
      `approval boundary refused with unexpected status: ${status}`,
    );
    return "stop";
  }
  return applyStatus(status);
}

/** Write `skipped` to every stage row from `fromPosition` onward within one branch. */
function skipRemainingStages(
  store: StateStore,
  pipelineId: string,
  stageRecords: readonly PipelineStageRecord[],
  fromPosition: number,
  branchKey: string = DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
): void {
  for (const record of stageRecords) {
    if (record.position < fromPosition) continue;
    if (record.branchKey !== branchKey) continue;
    store.updateStage({ pipelineId, stageId: record.stageId, branchKey, patch: { status: "skipped" } });
  }
}

function carryForwardArtifact(
  stageArtifacts: Map<string, PipelineStageArtifact>,
  stageId: string,
  artifact: unknown,
): void {
  if (
    artifact !== null &&
    typeof artifact === "object" &&
    typeof (artifact as PipelineStageArtifact).entryRunId === "string" &&
    typeof (artifact as PipelineStageArtifact).specPath === "string"
  ) {
    stageArtifacts.set(stageId, artifact as PipelineStageArtifact);
  }
}

function maybeAdmitFanOutBranches(
  store: StateStore,
  pipelineId: string,
  definition: PipelineDefinition,
  index: number,
  branchKey: string,
  artifact: unknown,
): AdmitFanOutBranchesResult | null {
  if (branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY) return null;
  if (artifact === null || typeof artifact !== "object") return null;
  const typed = artifact as PipelineStageArtifact;
  if (isSplittingArtifact(typed)) {
    return admitFanOutBranches(store, pipelineId, definition, index, typed.downstreamInputs!);
  }
  return null;
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
  branchKey: string;
  split: FanOutSplit | null;
  context: PipelineExecutionDeps["context"];
  stageArtifacts: Map<string, PipelineStageArtifact>;
  store: StateStore;
  dispatch: PipelineWorkflowDispatch;
  wait: PipelineWorkflowWait;
  resolveStage: NonNullable<PipelineExecutionDeps["resolveStage"]>;
}): Promise<StageStepOutcome> {
  const {
    pipelineId,
    definition,
    stage,
    index,
    branchKey,
    split,
    context,
    stageArtifacts,
    store,
    dispatch,
    wait,
    resolveStage,
  } = args;

  try {
    const current = store.loadPipeline(pipelineId);
    const stageRecords = current?.stages ?? [];
    const record = current ? findStageRecord(stageRecords, stage.stageId, branchKey) : undefined;

    if (record?.status === "succeeded") {
      carryForwardArtifact(stageArtifacts, stage.stageId, record.artifact);
      const admission = maybeAdmitFanOutBranches(store, pipelineId, definition, index, branchKey, record.artifact);
      if (admission !== null && !admission.ok) {
        store.updateStage({
          pipelineId,
          stageId: stage.stageId,
          branchKey,
          patch: { status: "failed", endedAt: Date.now(), failureDetail: { message: admission.error } },
        });
        skipRemainingStages(store, pipelineId, stageRecords, index + 1, branchKey);
        return "stop";
      }
      return "continue";
    }
    if (record?.status === "running" || record?.status === "failed") {
      return "stop";
    }
    if (record?.status === "skipped") {
      return "continue";
    }

    const resolution = await resolveStage(definition, index, context, stageArtifacts, {
      loadRun: (runId) => {
        const entryRun = store.loadRun(runId);
        return entryRun === null ? null : { worktreePath: entryRun.worktreePath, branch: entryRun.branch };
      },
    });
    if (!resolution.ok) {
      store.updateStage({
        pipelineId,
        stageId: stage.stageId,
        branchKey,
        patch: { status: "failed", endedAt: Date.now(), failureDetail: { message: resolution.error } },
      });
      skipRemainingStages(store, pipelineId, stageRecords, index + 1, branchKey);
      return "stop";
    }

    if (isFanOutStageResolution(resolution)) {
      const splitPosition = split?.splitPosition ?? index - 1;
      const intentStage = definition.stages[splitPosition];
      const intentRecord =
        intentStage !== undefined
          ? findStageRecord(stageRecords, intentStage.stageId, DEFAULT_PIPELINE_STAGE_BRANCH_KEY)
          : undefined;
      const intentArtifact =
        intentRecord?.artifact !== null && typeof intentRecord?.artifact === "object"
          ? (intentRecord.artifact as PipelineStageArtifact)
          : undefined;
      const downstreamInputs = intentArtifact?.downstreamInputs;
      if (downstreamInputs === undefined || downstreamInputs.length < 2) {
        store.updateStage({
          pipelineId,
          stageId: stage.stageId,
          branchKey,
          patch: {
            status: "failed",
            endedAt: Date.now(),
            failureDetail: { message: "pipeline-stage-resolve: fan-out resolution missing downstreamInputs" },
          },
        });
        skipRemainingStages(store, pipelineId, stageRecords, index + 1, branchKey);
        return "stop";
      }

      const admission = admitFanOutBranches(store, pipelineId, definition, splitPosition, downstreamInputs);
      if (!admission.ok) {
        store.updateStage({
          pipelineId,
          stageId: stage.stageId,
          branchKey,
          patch: { status: "failed", endedAt: Date.now(), failureDetail: { message: admission.error } },
        });
        skipRemainingStages(store, pipelineId, stageRecords, index + 1, branchKey);
        return "stop";
      }
      const branchKeys = admission.branchKeys;
      let currentBranchFailed = false;
      for (let branchIndex = 0; branchIndex < branchKeys.length; branchIndex += 1) {
        const targetBranchKey = branchKeys[branchIndex]!;
        const targetRecord = findStageRecord(store.loadPipeline(pipelineId)?.stages ?? [], stage.stageId, targetBranchKey);
        if (targetRecord?.status === "succeeded") continue;
        const steps = resolution.results[branchIndex]?.steps;
        if (steps === undefined) continue;
        await dispatchPipelineStage({
          pipelineId,
          stageId: stage.stageId,
          branchKey: targetBranchKey,
          steps,
          dispatch,
          wait,
          store,
        });
        const settledRecord = findStageRecord(store.loadPipeline(pipelineId)?.stages ?? [], stage.stageId, targetBranchKey);
        if (settledRecord?.status !== "succeeded") {
          skipRemainingStages(store, pipelineId, store.loadPipeline(pipelineId)?.stages ?? [], index + 1, targetBranchKey);
          if (targetBranchKey === branchKey) currentBranchFailed = true;
        } else {
          carryForwardArtifact(stageArtifacts, stage.stageId, settledRecord.artifact);
        }
      }
      return currentBranchFailed ? "stop" : "continue";
    }

    await dispatchPipelineStage({
      pipelineId,
      stageId: stage.stageId,
      branchKey,
      steps: singleStageResolutionSteps(resolution),
      dispatch,
      wait,
      store,
    });

    const settled = store.loadPipeline(pipelineId);
    const settledRecords = settled?.stages ?? [];
    const settledRecord = settled ? findStageRecord(settledRecords, stage.stageId, branchKey) : undefined;
    if (settledRecord?.status !== "succeeded") {
      skipRemainingStages(store, pipelineId, settledRecords, index + 1, branchKey);
      return "stop";
    }

    carryForwardArtifact(stageArtifacts, stage.stageId, settledRecord.artifact);
    const admission = maybeAdmitFanOutBranches(
      store,
      pipelineId,
      definition,
      index,
      branchKey,
      settledRecord.artifact,
    );
    if (admission !== null && !admission.ok) {
      store.updateStage({
        pipelineId,
        stageId: stage.stageId,
        branchKey,
        patch: { status: "failed", endedAt: Date.now(), failureDetail: { message: admission.error } },
      });
      skipRemainingStages(store, pipelineId, settledRecords, index + 1, branchKey);
      return "stop";
    }
    return "continue";
  } catch (error) {
    try {
      store.updateStage({
        pipelineId,
        stageId: stage.stageId,
        branchKey,
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
    skipRemainingStages(store, pipelineId, afterFailure?.stages ?? [], index + 1, branchKey);
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
    const record = findStageRecord(pipeline.stages, stageRecord.stageId, stageRecord.branchKey);
    if (record?.status !== "pending" && record?.status !== "running") continue;
    try {
      store.updateStage({
        pipelineId,
        stageId: stageRecord.stageId,
        branchKey: stageRecord.branchKey,
        patch: { status: "failed", endedAt: Date.now(), failureDetail: detail },
      });
      skipRemainingStages(store, pipelineId, pipeline.stages, stageRecord.position + 1, stageRecord.branchKey);
    } catch {
      // The store itself is unreachable; nothing further can be recorded.
    }
    return;
  }
}

async function runAuthoredStages(args: {
  pipelineId: string;
  deps: PipelineExecutionDeps;
  split: FanOutSplit | null;
  branchKey: string;
  fromIndex: number;
  toIndex: number;
  sharedStageArtifacts?: Map<string, PipelineStageArtifact>;
}): Promise<void> {
  const { pipelineId, deps, split, branchKey, fromIndex, toIndex, sharedStageArtifacts } = args;
  const { store, dispatch, wait, context } = deps;
  const resolveStage = deps.resolveStage ?? resolveStageWorkflowSteps;
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) return;
  const definition = pipeline.definition;

  for (let index = fromIndex; index <= toIndex; index += 1) {
    const stage = definition.stages[index];
    if (stage === undefined) continue;
    const stageRecord = findStageRecord(pipeline.stages, stage.stageId, branchKey);
    if (stageRecord === undefined) continue;
    if (branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY && (stageRecord.status === "failed" || stageRecord.status === "skipped")) {
      return;
    }

    const stageArtifacts =
      sharedStageArtifacts ??
      (split !== null ? buildBranchStageArtifacts(pipeline, split, branchKey, index) : new Map());

    if (stage.kind === "approval") {
      const outcome = advanceApprovalStage({ pipelineId, stageRecord, store });
      if (outcome === "stop") return;
      pipeline.stages = store.loadPipeline(pipelineId)?.stages ?? pipeline.stages;
      continue;
    }

    const outcome = await advanceWorkflowStage({
      pipelineId,
      definition,
      stage,
      index,
      branchKey,
      split,
      context,
      stageArtifacts,
      store,
      dispatch,
      wait,
      resolveStage,
    });
    if (outcome === "stop") return;
    pipeline.stages = store.loadPipeline(pipelineId)?.stages ?? pipeline.stages;
  }
}

/**
 * Walk a pipeline's authored stages in order, resolving and dispatching each workflow stage
 * only once the immediately preceding workflow stage's row reads `succeeded`. An approval
 * stage records or honors its durable status (`pending` → `awaiting`, block at `awaiting`,
 * continue past `approved`, stop at `rejected`) with no dispatch to later stages.
 */
export async function runPipeline(pipelineId: string, deps: PipelineExecutionDeps): Promise<void> {
  const { store } = deps;
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) return;

  const definition = pipeline.definition;
  const stageArtifacts = new Map<string, PipelineStageArtifact>();

  try {
    const initialSplit = findFanOutSplit(pipeline);
    await runAuthoredStages({
      pipelineId,
      deps,
      split: initialSplit,
      branchKey: DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
      fromIndex: 0,
      toIndex: initialSplit?.splitPosition ?? definition.stages.length - 1,
      sharedStageArtifacts: stageArtifacts,
    });
    const activeSplit = findFanOutSplit(store.loadPipeline(pipelineId) ?? pipeline) ?? initialSplit;
    if (activeSplit !== null) {
      const lastIndex = definition.stages.length - 1;
      for (const branchKey of activeSplit.branchKeys) {
        await runAuthoredStages({
          pipelineId,
          deps,
          split: activeSplit,
          branchKey,
          fromIndex: activeSplit.splitPosition + 1,
          toIndex: lastIndex,
        });
      }
    }

    await settlePipelineTerminalPublication(pipelineId, deps);
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
 * `interrupted` (stage rows only), `rejected`, `failed`, `running` (workflow stage rows),
 * authored-order walk for `awaiting-approval`/`pending`, settling `running` when every
 * authored stage is satisfied but terminal publication has not succeeded, `failed` when a
 * durable `terminalPublicationFailure` is present, else `succeeded`. Pipeline-level
 * `interrupted` is a reconciliation marker and does not mask preserved stage evidence.
 * `skipped` rows are never satisfied and are never reached because `failed` always precedes them.
 */
function deriveFanOutPipelineState(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
): PipelineDerivedState {
  for (let index = 0; index <= split.splitPosition; index += 1) {
    const stage = pipeline.definition.stages[index];
    if (stage === undefined) continue;
    const record = findStageRecord(pipeline.stages, stage.stageId, DEFAULT_PIPELINE_STAGE_BRANCH_KEY);
    if (stage.kind === "approval" && record?.status === "rejected") return "rejected";
    if (record?.status === "failed") return "failed";
    if (stage.kind === "workflow" && record?.status === "running") return "running";
    if (!isAuthoredStageSatisfied(stage, record)) {
      return stage.kind === "approval" ? "awaiting-approval" : "pending";
    }
  }

  let anyRejected = false;
  let anyFailed = false;
  let anyRunning = false;
  let anyAwaiting = false;
  let anyPending = false;
  let allBranchesComplete = true;

  for (const branchKey of split.branchKeys) {
    let branchComplete = true;
    for (const { stage, record } of suffixStagesForBranch(pipeline, split.splitPosition, branchKey)) {
      if (stage.kind === "approval" && record.status === "rejected") {
        anyRejected = true;
        branchComplete = false;
      }
      if (record.status === "failed") {
        anyFailed = true;
        branchComplete = false;
      }
      if (stage.kind === "workflow" && record.status === "running") anyRunning = true;
      if (!isAuthoredStageSatisfied(stage, record)) {
        branchComplete = false;
        if (stage.kind === "approval" && record.status === "awaiting") anyAwaiting = true;
        else if (record.status === "pending") anyPending = true;
      }
    }
    if (!branchComplete) allBranchesComplete = false;
  }

  if (anyRejected) return "rejected";
  if (anyFailed) return "failed";
  if (anyRunning) return "running";
  if (anyAwaiting) return "awaiting-approval";
  if (anyPending) return "pending";
  if (!allBranchesComplete) return "pending";
  if (isPipelineSettlementPending(pipeline)) return "running";
  if (hasPipelineTerminalPublicationFailure(pipeline)) return "failed";
  return "succeeded";
}

export function derivePipelineState(pipeline: Pipeline & { stages: PipelineStageRecord[] }): PipelineDerivedState {
  const { stages: stageRecords } = pipeline;

  if (stageRecords.some((record) => record.status === "interrupted")) {
    return "interrupted";
  }

  const split = findFanOutSplit(pipeline);
  if (split !== null) {
    return deriveFanOutPipelineState(pipeline, split);
  }

  const ordered = authoredStagesInPositionOrder(pipeline).filter(
    (entry) => entry.record.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  );
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
  if (isPipelineSettlementPending(pipeline)) return "running";
  if (hasPipelineTerminalPublicationFailure(pipeline)) return "failed";
  return "succeeded";
}
