import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { isRecord } from "../../../shared/is-record.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  networkSubprocessOptions,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { classifyNeverLandedLane, listDirtyWorktreePathsForStaleReset } from "../commands/cleanup.ts";
import {
  maybeResetStaleWorkspace,
  probeMaybeResetStaleWorkspace,
  STALE_RESET_WORKFLOWS,
} from "../commands/stale-reset-workspace.ts";
import type { WorkflowStartResetFlags } from "../commands/workflow-start-preparation.ts";
import { stampWorkflowStepsWithMachineConfig } from "../commands/workflow-step-config-stamp.ts";
import { bindHarnessReadyFlipEvidenceLookup, type LanePrOutcome } from "../execution/completion-publisher.ts";
import { getExternalWorktreePath } from "../execution/external-worktree.ts";
import type { PipelineDefinition, PipelineStage, PipelineTerminalAction } from "../execution/pipeline-definition.ts";
import { normalizePublicationFailure, type PublicationFailure } from "../execution/publication-retry.ts";
import {
  createDefaultSupersedeGh,
  executeTerminalPublication,
  type SupersedeGh,
  TerminalPublicationError,
  type TerminalPublicationInput,
  type TerminalPublicationResult,
} from "../execution/terminal-publication.ts";
import { formatTerminalSupersedeSettlementComment } from "../execution/terminal-supersede-settlement.ts";
import { storeVerifierProcessGroupRecorder } from "../execution/verifier-process-groups.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { IpcClient } from "../ipc/client.ts";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import {
  type ApprovalDecision,
  type ApprovalRefusalReason,
  DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  isOwnerAlive,
  loadPipelineContext,
  type OwnerLivenessProbe,
  type Pipeline,
  type PipelineContext,
  type PipelineReopenRefusalReason,
  type PipelineStageRecord,
  type PipelineSupersedeFailure,
  type Run,
  type StateStore,
} from "../persistence/state-store.ts";
import {
  buildFanOutLaneChain,
  type FanOutLaneChain,
  type LaneChainGate,
  type LaneProgress,
  laneChainFromArtifact,
  laneChainGate,
  laneChainSuccessors,
  persistLaneChain,
  readLaneReadyIntent,
} from "./pipeline-lane-chain.ts";
import {
  adoptAndSettlePipelineStage,
  adoptPipelineStageUnderAdmission,
  dispatchPipelineStage,
  type PipelineStageArtifact,
  type PipelineWorkflowDispatch,
  type PipelineWorkflowWait,
  settlementLinkedEntryRunId,
  shouldStopForInFlightStageRow,
  stageArtifactKey,
} from "./pipeline-stage-dispatch.ts";
import { buildStageFailureRecord } from "./pipeline-stage-failure-record.ts";
import {
  isFanOutStageResolution,
  noopStaleResetPreflight,
  type PipelineStageResolutionResult,
  resolveStageWorkflowSteps,
  type StaleResetPreflight,
  singleStageResolutionSteps,
} from "./pipeline-stage-resolve.ts";
import { capturingStaleReset } from "./pipeline-workflow-preparation.ts";
import { settleOrphanedRunningStages } from "./stage-settlement-owner.ts";

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

/** Default bound on a losing branch's wait for a peer's fan-out claim (`advanceFanOutStageResolution`). */
const DEFAULT_PEER_CLAIM_TIMEOUT_MS = 600_000;

export type PipelineExecutionDeps = {
  store: StateStore;
  dispatch: PipelineWorkflowDispatch;
  wait: PipelineWorkflowWait;
  context: PipelineContext;
  resolveStage?: typeof resolveStageWorkflowSteps;
  loadLogRecords?: (entryRunId: string) => PersistedRecord[];
  /** True while this daemon still drives the entry run's invocation; stage settlement never judges a live run from its rows. */
  isEntryRunLive?: (entryRunId: string) => boolean;
  executeTerminalPublication?: (input: TerminalPublicationInput) => Promise<TerminalPublicationResult>;
  supersedeGh?: SupersedeGh;
  /** Git runner for the chained-lane rebase after a predecessor merge; falls back to the stale-reset runner, then the real one. */
  subprocessRunner?: AsyncSubprocessRunner;
  /** Bound on a losing branch's wait for a peer's fan-out claim (see `awaitBoundedPeerClaim`). */
  peerClaimTimeoutMs?: number;
  /**
   * Shared stale-reset preflight injection for pipeline workflow-stage re-dispatch.
   * `connectClient` opens an `IpcClient` against the daemon's own socket on demand.
   * Undefined skips the preflight entirely (e.g. in tests that don't exercise it).
   */
  staleResetPreflight?: { cliDeps: CliDeps; io: Io; connectClient: () => Promise<IpcClient> };
  reopenedStageReset?: ReopenedStageReset;
  attemptFailedImplementPipelineResume?: (
    pipeline: Pipeline & { stages: PipelineStageRecord[] },
    pipelineId: string,
    branchScope: string | undefined,
    resumePublicationOptions?: { allowLanePrRepublish?: true },
  ) => Promise<ResumePipelineOutcome | undefined>;
};

type ReopenedStageReset = {
  stageId: string;
  branchKey: string;
  flags: WorkflowStartResetFlags;
};

const REOPENED_STAGE_RESET_MARKER = "pipeline_reopened_stage_reset";

type ReopenedStageResetMarker = ReopenedStageReset & { code: typeof REOPENED_STAGE_RESET_MARKER };

function isReopenedStageResetMarker(detail: unknown): detail is ReopenedStageResetMarker {
  if (detail === null || typeof detail !== "object") return false;
  const marker = detail as Partial<ReopenedStageResetMarker>;
  return (
    marker.code === REOPENED_STAGE_RESET_MARKER &&
    typeof marker.stageId === "string" &&
    typeof marker.branchKey === "string" &&
    marker.flags !== null &&
    typeof marker.flags === "object" &&
    typeof marker.flags.skipDirtyWorktreeGate === "boolean" &&
    typeof marker.flags.skipLandedCriteriaGate === "boolean"
  );
}

function persistedReopenedStageReset(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): ReopenedStageReset | undefined {
  for (const record of pipeline.stages) {
    if (record.status !== "pending" || !isReopenedStageResetMarker(record.failureDetail)) continue;
    return record.failureDetail;
  }
  return undefined;
}

function persistReopenedStageReset(store: StateStore, pipelineId: string, reset: ReopenedStageReset): void {
  store.updateStage({
    pipelineId,
    stageId: reset.stageId,
    branchKey: reset.branchKey,
    patch: { failureDetail: { code: REOPENED_STAGE_RESET_MARKER, ...reset } },
  });
}

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

/** Branch-scoped resume admission refusal reasons; each outcome also carries the requested `branchKey`. */
export type PipelineBranchResumeRefusalReason =
  | "branch_not_found"
  | "branch_awaiting_approval"
  | "branch_rejected"
  | "branch_not_resumable";

export type PipelineResumeRefusalReason =
  | PipelineContinuationRefusalReason
  | PipelineReopenRefusalReason
  | "pipeline_dismissed"
  | "pipeline_terminal_succeeded"
  | "pipeline_terminal_rejected"
  | "pipeline_interrupted_running_stage"
  | "pipeline_not_resumable"
  | "branch_resume_required"
  | PipelineBranchResumeRefusalReason;

/** Run-resume admission refusal surfaced through `pipeline resume` without mapping to pipeline reasons. */
export type PipelineRunResumeRefusalReason =
  | "terminal_run"
  | "resume_unsupported"
  | "owner_alive"
  | "claim_lost"
  | "worktree_claimed"
  | "run_owner_conflict"
  | "unknown_run";

export type ResumePipelineOutcome =
  | { kind: "resumed"; pipelineId: string }
  | { kind: "dispatch_refused"; pipelineId: string; message: string }
  | {
      kind: "refused";
      pipelineId: string;
      reason: Exclude<
        PipelineResumeRefusalReason,
        PipelineBranchResumeRefusalReason | "pipeline_interrupted_running_stage"
      >;
      branchKeys?: string[];
    }
  | {
      kind: "refused";
      pipelineId: string;
      reason: "pipeline_interrupted_running_stage";
      state: "interrupted";
      stageId: string;
      runId?: string;
    }
  | {
      kind: "refused";
      pipelineId: string;
      reason: PipelineBranchResumeRefusalReason | PipelineReopenRefusalReason;
      branchKey: string;
      stageId?: string;
      status?: string;
    }
  | {
      kind: "refused";
      pipelineId: string;
      reason: PipelineRunResumeRefusalReason;
      message?: string;
    };

/** True when a pipeline row carries complete admission context for restart continuation. `null` is absent; incomplete JSON is distinguishable via `loadPipelineContext`. */
export function persistedContextLoadPermitsContinuation(context: PipelineContext | null): boolean {
  return context !== null && loadPipelineContext(context).ok;
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

/** True when derived state refuses resume without a reopened failed or interrupted continuation. */
export function resumeDeferredRefusalApplies(
  derivedState: PipelineDerivedState,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): boolean {
  if (derivedState === "running") return true;
  if (derivedState === "interrupted") return pipeline.stages.some((stage) => stage.status === "running");
  return derivedState === "pending" && !isReopenedFailedContinuation(pipeline);
}

/** True when derived `pending` reflects an already-reopened failed continuation. */
export function resumeReopenedPendingContinuation(
  derivedState: PipelineDerivedState,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): boolean {
  return derivedState === "pending" && isReopenedFailedContinuation(pipeline);
}

function isApprovedGatePendingSuccessor(
  prior: { stage: PipelineStage; record: PipelineStageRecord } | undefined,
  stage: PipelineStage,
  record: PipelineStageRecord,
): boolean {
  return (
    stage.kind === "workflow" &&
    record.status === "pending" &&
    prior !== undefined &&
    prior.stage.kind === "approval" &&
    prior.record.status === "approved"
  );
}

/** True when the first unsatisfied stage on a lane is a pending workflow immediately after an approved gate. */
function firstUnsatisfiedIsApprovedGatePendingSuccessor(
  ordered: ReadonlyArray<{ stage: PipelineStage; record: PipelineStageRecord }>,
): boolean {
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index];
    if (entry === undefined) continue;
    const { stage, record } = entry;
    if (isAuthoredStageSatisfied(stage, record)) continue;
    return isApprovedGatePendingSuccessor(index > 0 ? ordered[index - 1] : undefined, stage, record);
  }
  return false;
}

/** Branch key for the first lane whose next unsatisfied stage is a pending workflow after an approved gate. */
function approvedGatePendingStrandBranchKey(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): string | undefined {
  const split = findFanOutSplit(pipeline);
  if (split !== null) {
    for (const branchKey of split.branchKeys) {
      if (
        firstUnsatisfiedIsApprovedGatePendingSuccessor(suffixStagesForBranch(pipeline, split.splitPosition, branchKey))
      ) {
        return branchKey;
      }
    }
    return undefined;
  }
  if (
    firstUnsatisfiedIsApprovedGatePendingSuccessor(
      authoredStagesInPositionOrder(pipeline).filter(
        (entry) => entry.record.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
      ),
    )
  ) {
    return DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
  }
  return undefined;
}

/** True when unscoped resume may continue an approved-gate pending successor without reopen. */
export function resumeApprovedGatePendingStrandApplies(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): boolean {
  return approvedGatePendingStrandBranchKey(pipeline) !== undefined;
}

function normalizeContinuationBranchKey(branchKey?: string): string | undefined {
  return branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY ? undefined : branchKey;
}

/**
 * Restart-safe production continuation: load persisted admission context, claim one live
 * owner, and resume the ordered loop without caller-supplied admission input.
 */
export async function continuePipeline(
  pipelineId: string,
  deps: Omit<PipelineExecutionDeps, "context"> & { context?: PipelineContext },
  continuationBranchKey?: string,
): Promise<ContinuePipelineOutcome> {
  continuationBranchKey = normalizeContinuationBranchKey(continuationBranchKey);
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

  const persistedReset = persistedReopenedStageReset(pipeline);
  const reopenedStageReset = deps.reopenedStageReset ?? persistedReset;
  const persistedBranchScope =
    reopenedStageReset?.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY ? undefined : reopenedStageReset?.branchKey;
  const effectiveContinuationBranchKey = continuationBranchKey ?? persistedBranchScope;

  await runPipeline(
    pipelineId,
    {
      store,
      dispatch,
      wait,
      context,
      resolveStage,
      ...(deps.executeTerminalPublication !== undefined
        ? { executeTerminalPublication: deps.executeTerminalPublication }
        : {}),
      ...(deps.staleResetPreflight !== undefined ? { staleResetPreflight: deps.staleResetPreflight } : {}),
      ...(reopenedStageReset !== undefined ? { reopenedStageReset } : {}),
      ...(deps.loadLogRecords !== undefined ? { loadLogRecords: deps.loadLogRecords } : {}),
    },
    effectiveContinuationBranchKey,
  );
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

type BranchScopedResumeRefusalDetail =
  | { reason: "branch_not_found" }
  | { reason: "branch_awaiting_approval"; stageId: string }
  | { reason: "branch_rejected"; stageId: string }
  | { reason: "branch_not_resumable"; status: string; stageId?: string };

/** Sentinel `findBranchAdmissionBoundary` return when the named branch never appears alongside a `default` sibling. */
const BRANCH_ADMISSION_BOUNDARY_NOT_FOUND = -1;

/**
 * The lowest durable position carrying both a `default` row and a `branchKey` row — the
 * fan-out point a named branch diverges from. Mirrors `reopenFailedPipeline`'s own boundary
 * derivation so admission and reopen agree on one boundary.
 */
function findBranchAdmissionBoundary(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  branchKey: string,
): number {
  const positions = [...new Set(pipeline.stages.map((stage) => stage.position))].sort((a, b) => a - b);
  for (const position of positions) {
    const hasDefault = pipeline.stages.some(
      (stage) => stage.position === position && stage.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
    );
    const hasNamed = pipeline.stages.some((stage) => stage.position === position && stage.branchKey === branchKey);
    if (hasDefault && hasNamed) return position;
  }
  return BRANCH_ADMISSION_BOUNDARY_NOT_FOUND;
}

/** True when the named branch carries its own row at every authored position from `boundary` through the last. */
function branchSuffixRowsPresent(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  boundary: number,
  branchKey: string,
): boolean {
  const lastPosition = pipeline.definition.stages.length - 1;
  for (let position = boundary; position <= lastPosition; position += 1) {
    const stage = pipeline.definition.stages[position];
    if (stage === undefined) continue;
    if (findStageRecord(pipeline.stages, stage.stageId, branchKey) === undefined) return false;
  }
  return true;
}

type BranchResumeReopenKind = "failed" | "interrupted" | "approved_gate" | "provisional_skip";

type BranchSuffixScanResult =
  | { kind: "admissible"; reopenKind: BranchResumeReopenKind }
  | { kind: "gate_awaiting"; stageId: string }
  | { kind: "gate_rejected"; stageId: string }
  | { kind: "not_resumable"; status: string; stageId?: string };

/** Scan a named branch's own suffix in order for its first blocking gate, replayable failure, or in-progress row. */
function scanBranchSuffixForAdmission(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  boundary: number,
  branchKey: string,
): BranchSuffixScanResult {
  const ordered = suffixStagesForBranch(pipeline, boundary - 1, branchKey);
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index];
    if (entry === undefined) continue;
    const { stage, record } = entry;
    if (record.status === "failed" || record.status === "interrupted") {
      return { kind: "admissible", reopenKind: record.status };
    }
    if (stage.kind === "approval" && record.status === "awaiting") {
      return { kind: "gate_awaiting", stageId: stage.stageId };
    }
    if (stage.kind === "approval" && record.status === "rejected") {
      return { kind: "gate_rejected", stageId: stage.stageId };
    }
    if (!isAuthoredStageSatisfied(stage, record)) {
      const prior = index > 0 ? ordered[index - 1] : undefined;
      if (isApprovedGatePendingSuccessor(prior, stage, record)) {
        return { kind: "admissible", reopenKind: "approved_gate" };
      }
      if (record.status === "skipped" && record.skipProvenance === "provisional") {
        return { kind: "admissible", reopenKind: "provisional_skip" };
      }
      return { kind: "not_resumable", status: record.status, stageId: stage.stageId };
    }
  }
  return { kind: "not_resumable", status: "succeeded" };
}

/**
 * Branch-local resume admission, independent of aggregate `derivePipelineState`: absent branch
 * (unknown key, empty/whitespace key, no fan-out split, or a scan-boundary gap) refuses
 * `branch_not_found`; a reachable undecided or rejected approval gate on the named branch
 * refuses `branch_awaiting_approval`/`branch_rejected`; otherwise a missing replayable `failed`
 * row refuses `branch_not_resumable`.
 */
function resolveBranchResumeAdmission(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  branchKey: string,
): { kind: "ok"; reopenKind: BranchResumeReopenKind } | { kind: "refused"; detail: BranchScopedResumeRefusalDetail } {
  if (branchKey.trim() === "") return { kind: "refused", detail: { reason: "branch_not_found" } };
  if (findFanOutSplit(pipeline) === null) return { kind: "refused", detail: { reason: "branch_not_found" } };

  const boundary = findBranchAdmissionBoundary(pipeline, branchKey);
  if (boundary === BRANCH_ADMISSION_BOUNDARY_NOT_FOUND) {
    return { kind: "refused", detail: { reason: "branch_not_found" } };
  }
  if (!branchSuffixRowsPresent(pipeline, boundary, branchKey)) {
    return { kind: "refused", detail: { reason: "branch_not_found" } };
  }

  const scan = scanBranchSuffixForAdmission(pipeline, boundary, branchKey);
  if (scan.kind === "gate_awaiting") {
    return { kind: "refused", detail: { reason: "branch_awaiting_approval", stageId: scan.stageId } };
  }
  if (scan.kind === "gate_rejected") {
    return { kind: "refused", detail: { reason: "branch_rejected", stageId: scan.stageId } };
  }
  if (scan.kind === "not_resumable") {
    return {
      kind: "refused",
      detail: {
        reason: "branch_not_resumable",
        status: scan.status,
        ...(scan.stageId === undefined ? {} : { stageId: scan.stageId }),
      },
    };
  }
  return { kind: "ok", reopenKind: scan.reopenKind };
}

function branchListableForFailedPlanResume(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  branchKey: string,
): boolean {
  const admission = resolveBranchResumeAdmission(pipeline, branchKey);
  if (admission.kind !== "ok" || admission.reopenKind !== "failed") return false;

  const boundary = findBranchAdmissionBoundary(pipeline, branchKey);
  if (boundary === BRANCH_ADMISSION_BOUNDARY_NOT_FOUND) return false;

  for (const { stage, record } of suffixStagesForBranch(pipeline, boundary - 1, branchKey)) {
    if (record.status === "failed" && stage.kind === "workflow") {
      return stage.workflow === "plan";
    }
  }
  return false;
}

function listBranchResumeRequiredKeys(pipeline: Pipeline & { stages: PipelineStageRecord[] }): string[] {
  const split = findFanOutSplit(pipeline);
  if (split === null) return [];
  return split.branchKeys.filter((branchKey) => branchListableForFailedPlanResume(pipeline, branchKey));
}

export function findFailedStageForReopen(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  branchScope: string | undefined,
  status: "failed" | "interrupted" = "failed",
): PipelineStageRecord | undefined {
  return pipeline.stages.find((record) => {
    const stage = pipeline.definition.stages[record.position];
    return (
      record.status === status &&
      stage?.kind === "workflow" &&
      (branchScope === undefined || record.branchKey === branchScope)
    );
  });
}

function buildReopenedStageReset(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  failedStage: PipelineStageRecord | undefined,
  options: { resetDespiteDirty?: boolean; resetDespiteLandedCriteria?: boolean },
): ReopenedStageReset | undefined {
  if (failedStage === undefined) return undefined;
  const failedWorkflow = pipeline.definition.stages[failedStage.position];
  if (failedWorkflow?.kind !== "workflow") return undefined;
  return {
    stageId: failedStage.stageId,
    branchKey: failedStage.branchKey,
    flags: {
      skipDirtyWorktreeGate: options.resetDespiteDirty === true,
      skipLandedCriteriaGate: options.resetDespiteLandedCriteria === true,
    },
  };
}

export function buildPrefixStageArtifactsForResumeProbe(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  targetIndex: number,
  branchKey: string,
): Map<string, PipelineStageArtifact> {
  const artifacts = new Map<string, PipelineStageArtifact>();
  for (const stage of pipeline.definition.stages.slice(0, Math.max(0, targetIndex))) {
    const record = findStageRecord(pipeline.stages, stage.stageId, branchKey);
    const rawArtifact = record?.artifact;
    if (
      rawArtifact !== undefined &&
      rawArtifact !== null &&
      typeof rawArtifact === "object" &&
      typeof (rawArtifact as PipelineStageArtifact).entryRunId === "string" &&
      typeof (rawArtifact as PipelineStageArtifact).specPath === "string"
    ) {
      artifacts.set(stageArtifactKey(stage.stageId, branchKey), rawArtifact as PipelineStageArtifact);
    }
  }
  return artifacts;
}

type ResumeRedispatchWorkflowTarget = {
  stage: Extract<PipelineStage, { kind: "workflow" }>;
  index: number;
  branchKey: string;
};

function findResumeRedispatchInBranchSuffix(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: NonNullable<ReturnType<typeof findFanOutSplit>>,
  branchKey: string,
): ResumeRedispatchWorkflowTarget | undefined {
  const definition = pipeline.definition;
  const start = split.splitPosition + 1;
  for (const [offset, stage] of definition.stages.slice(start).entries()) {
    const index = start + offset;
    const record = findStageRecord(pipeline.stages, stage.stageId, branchKey);
    if (record === undefined) continue;
    if (record.status === "failed" || record.status === "skipped") return undefined;
    if (isAuthoredStageSatisfied(stage, record)) continue;
    if (!branchSuffixPredecessorsSatisfied(pipeline, record, split)) return undefined;
    if (stage.kind !== "workflow" || record.status !== "pending") return undefined;
    return { stage, index, branchKey };
  }
  return undefined;
}

function findResumeRedispatchBeforeSplit(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  toIndex: number,
): ResumeRedispatchWorkflowTarget | undefined {
  const definition = pipeline.definition;
  for (const [index, stage] of definition.stages.slice(0, Math.max(0, toIndex + 1)).entries()) {
    const record = findStageRecord(pipeline.stages, stage.stageId, DEFAULT_PIPELINE_STAGE_BRANCH_KEY);
    if (record === undefined) continue;
    if (isAuthoredStageSatisfied(stage, record)) continue;
    if (stage.kind !== "workflow" || record.status !== "pending") return undefined;
    return { stage, index, branchKey: DEFAULT_PIPELINE_STAGE_BRANCH_KEY };
  }
  return undefined;
}

function findResumeRedispatchWorkflowTarget(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  continuationBranchKey?: string,
): ResumeRedispatchWorkflowTarget | undefined {
  const definition = pipeline.definition;
  const split = findFanOutSplit(pipeline);
  const normalizedBranch = continuationBranchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;

  if (split !== null && continuationBranchKey !== undefined) {
    return findResumeRedispatchInBranchSuffix(pipeline, split, normalizedBranch);
  }

  const toIndex = split?.splitPosition ?? definition.stages.length - 1;
  return findResumeRedispatchBeforeSplit(pipeline, toIndex);
}

function preflightRefusalMessage(message: string): string {
  return message.endsWith("\n") ? message : `${message}\n`;
}

async function probePlanWorkflowStaleReset(
  injection: NonNullable<AdvanceWorkflowStageArgs["staleResetPreflight"]>,
  resolvedSteps: readonly AnyWorkflowStep[],
  resetFlags: WorkflowStartResetFlags,
  captureIo: Io,
  client: IpcClient,
): Promise<{ refused: true; message: string } | undefined> {
  const runner = injection.cliDeps.subprocessRunner ?? realAsyncSubprocessRunner;
  const dirtyGate = await resolveFailedPlanDirtyGate(resolvedSteps, resetFlags, runner);
  if (!dirtyGate.ok) return { refused: true, message: preflightRefusalMessage(dirtyGate.message) };
  let planResetFlags = dirtyGate.flags;
  const writeStep = resolvedSteps.find((step) => step.behavior === "write");
  const worktreePath = writeStepWorktreePath(resolvedSteps);
  const worktree = writeStep?.behavior === "write" ? writeStep.worktree : undefined;
  if (
    worktreePath !== undefined &&
    existsSync(worktreePath) &&
    worktree?.projectRoot !== undefined &&
    worktree.branchName !== undefined &&
    worktree.baseRef !== undefined
  ) {
    const classification = await classifyNeverLandedLane(
      worktree.projectRoot,
      worktree.branchName,
      worktree.baseRef,
      runner,
    );
    if (classification.kind === "never-landed") {
      planResetFlags = { ...dirtyGate.flags, disposableLane: true };
    }
  }
  return await probeMaybeResetStaleWorkspace(
    "plan",
    { ok: true, steps: [...resolvedSteps] },
    injection.cliDeps,
    captureIo,
    planResetFlags,
    client,
  );
}

async function probeWorkflowStageRedispatchPreflight(
  args: AdvanceWorkflowStageArgs,
  resolvedSteps: readonly AnyWorkflowStep[],
  branchKey: string,
  _runStaleResetPreflight: StaleResetPreflight,
): Promise<{ refused: true; message: string } | undefined> {
  const preflightCapture = { message: "" };
  const blocker = planOperatorBlockerNeedsGitChecks(args, resolvedSteps, branchKey)
    ? await refuseReopenedPlanOperatorBlockerWithGit(args, resolvedSteps, preflightCapture, branchKey, true)
    : refuseReopenedPlanOperatorBlockerLocal(args, resolvedSteps, preflightCapture, branchKey, true);
  if (!blocker.ok) return { refused: true, message: preflightRefusalMessage(blocker.message) };

  const injection = args.staleResetPreflight;
  if (injection === undefined || !STALE_RESET_WORKFLOWS.has(args.stage.workflow)) return undefined;
  const writeStep = resolvedSteps.find((step) => step.behavior === "write");
  const worktree = writeStep?.behavior === "write" ? writeStep.worktree : undefined;
  if (!(worktree?.git !== false && worktree?.projectRoot && worktree.projectName && worktree.branchName)) {
    return undefined;
  }

  let client: IpcClient;
  try {
    client = await injection.connectClient();
  } catch {
    return undefined;
  }
  try {
    const resetFlags = reopenedStageResetFlags(args, branchKey);
    const captureIo: Io = {
      stdout: injection.io.stdout,
      stderr: (text: string) => {
        preflightCapture.message += text;
      },
    };
    if (args.stage.workflow === "plan" && resetFlags !== undefined) {
      return await probePlanWorkflowStaleReset(injection, resolvedSteps, resetFlags, captureIo, client);
    }
    const parsedFlags: WorkflowStartResetFlags = resetFlags ?? {
      skipDirtyWorktreeGate: false,
      skipLandedCriteriaGate: false,
    };
    return await probeMaybeResetStaleWorkspace(
      args.stage.workflow,
      { ok: true, steps: [...resolvedSteps] },
      injection.cliDeps,
      captureIo,
      parsedFlags,
      client,
    );
  } finally {
    client.close();
  }
}

export async function probePipelineResumeRedispatchRefusal(
  pipelineId: string,
  deps: Omit<PipelineExecutionDeps, "context"> & { context?: PipelineContext; reopenedStageReset?: ReopenedStageReset },
  options: {
    continuationBranchKey?: string;
    reopenedStageReset?: ReopenedStageReset;
  },
): Promise<{ refused: true; message: string } | undefined> {
  if (deps.staleResetPreflight === undefined) return undefined;
  const pipeline = deps.store.loadPipeline(pipelineId);
  if (pipeline?.context === null) return undefined;
  const loadedContext = pipeline?.context === undefined ? null : loadPipelineContext(pipeline.context);
  if (pipeline === null || loadedContext === null || !loadedContext.ok) return undefined;

  const target = findResumeRedispatchWorkflowTarget(pipeline, options.continuationBranchKey);
  if (target === undefined) return undefined;

  const split = findFanOutSplit(pipeline);
  const stageArtifacts =
    split !== null && options.continuationBranchKey !== undefined
      ? buildBranchStageArtifacts(pipeline, split, target.branchKey, target.index)
      : buildPrefixStageArtifactsForResumeProbe(pipeline, target.index, target.branchKey);
  const resolveStage = deps.resolveStage ?? resolveStageWorkflowSteps;
  const reopenedStageReset = options.reopenedStageReset ?? deps.reopenedStageReset;
  const resolution = await resolveStage(pipeline.definition, target.index, loadedContext.context, stageArtifacts, {
    loadRun: (runId) => {
      const entryRun = deps.store.loadRun(runId);
      return entryRun === null ? null : { worktreePath: entryRun.worktreePath, branch: entryRun.branch };
    },
    branchKey: target.branchKey,
    ...(split !== null && options.continuationBranchKey !== undefined ? { splitPosition: split.splitPosition } : {}),
  });
  if (!resolution.ok || isFanOutStageResolution(resolution)) return undefined;

  const resolvedSteps = singleStageResolutionSteps(resolution);
  const args: AdvanceWorkflowStageArgs = {
    pipelineId,
    definition: pipeline.definition,
    stage: target.stage,
    index: target.index,
    branchKey: target.branchKey,
    split,
    context: loadedContext.context,
    stageArtifacts,
    store: deps.store,
    dispatch: async () => ({ ok: false, code: "probe", message: "probe" }),
    wait: async () => "completed",
    resolveStage,
    dispatchClaims: new Map(),
    peerClaimTimeoutMs: DEFAULT_PEER_CLAIM_TIMEOUT_MS,
    staleResetPreflight: deps.staleResetPreflight,
    reopenedStageReset,
  };
  return probeWorkflowStageRedispatchPreflight(
    args,
    resolvedSteps,
    target.branchKey,
    resolution.runStaleResetPreflight ?? noopStaleResetPreflight,
  );
}

function resolvedStepsForBranchProbe(
  resolution: Extract<PipelineStageResolutionResult, { ok: true }>,
  split: ReturnType<typeof findFanOutSplit>,
  branchKey: string,
): { steps: AnyWorkflowStep[]; runStaleResetPreflight: StaleResetPreflight } | undefined {
  if (isFanOutStageResolution(resolution)) {
    if (split === null) return undefined;
    const branchIndex = split.branchKeys.indexOf(branchKey);
    if (branchIndex < 0) return undefined;
    const branchResult = resolution.results[branchIndex];
    if (branchResult === undefined) return undefined;
    return {
      steps: branchResult.steps,
      runStaleResetPreflight: branchResult.runStaleResetPreflight ?? noopStaleResetPreflight,
    };
  }
  return {
    steps: singleStageResolutionSteps(resolution),
    runStaleResetPreflight: resolution.runStaleResetPreflight ?? noopStaleResetPreflight,
  };
}

function findRecoveryRedispatchWorkflowTarget(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  recoveryTarget: { stageId: string; branchKey: string },
): { stage: Extract<PipelineStage, { kind: "workflow" }>; index: number; branchKey: string } | undefined {
  const record = findStageRecord(pipeline.stages, recoveryTarget.stageId, recoveryTarget.branchKey);
  if (record === undefined) return undefined;
  const stage = pipeline.definition.stages[record.position];
  if (stage?.kind !== "workflow" || record.status !== "failed") return undefined;
  return { stage, index: record.position, branchKey: recoveryTarget.branchKey };
}

export async function probePipelineRecoverRedispatchRefusal(
  pipelineId: string,
  recoveryTarget: { stageId: string; branchKey: string },
  deps: Omit<PipelineExecutionDeps, "context"> & { context?: PipelineContext },
  options: { resetDespiteDirty?: boolean; resetDespiteLandedCriteria?: boolean },
): Promise<{ refused: true; message: string } | undefined> {
  if (deps.staleResetPreflight === undefined) return undefined;
  const pipeline = deps.store.loadPipeline(pipelineId);
  if (pipeline?.context === null) return undefined;
  const loadedContext = pipeline?.context === undefined ? null : loadPipelineContext(pipeline.context);
  if (pipeline === null || loadedContext === null || !loadedContext.ok) return undefined;

  const target = findRecoveryRedispatchWorkflowTarget(pipeline, recoveryTarget);
  if (target === undefined) return undefined;

  const failedRecord = findStageRecord(pipeline.stages, recoveryTarget.stageId, recoveryTarget.branchKey);
  const reopenedStageReset = buildReopenedStageReset(pipeline, failedRecord, options);

  const split = findFanOutSplit(pipeline);
  const stageArtifacts =
    split !== null
      ? buildBranchStageArtifacts(pipeline, split, target.branchKey, target.index)
      : buildPrefixStageArtifactsForResumeProbe(pipeline, target.index, target.branchKey);
  const resolveStage = deps.resolveStage ?? resolveStageWorkflowSteps;
  const resolution = await resolveStage(pipeline.definition, target.index, loadedContext.context, stageArtifacts, {
    loadRun: (runId) => {
      const entryRun = deps.store.loadRun(runId);
      return entryRun === null ? null : { worktreePath: entryRun.worktreePath, branch: entryRun.branch };
    },
    branchKey: target.branchKey,
    ...(split !== null ? { splitPosition: split.splitPosition } : {}),
  });
  if (!resolution.ok) return undefined;
  const resolved = resolvedStepsForBranchProbe(resolution, split, target.branchKey);
  if (resolved === undefined) return undefined;

  const args: AdvanceWorkflowStageArgs = {
    pipelineId,
    definition: pipeline.definition,
    stage: target.stage,
    index: target.index,
    branchKey: target.branchKey,
    split,
    context: loadedContext.context,
    stageArtifacts,
    store: deps.store,
    dispatch: async () => ({ ok: false, code: "probe", message: "probe" }),
    wait: async () => "completed",
    resolveStage,
    dispatchClaims: new Map(),
    peerClaimTimeoutMs: DEFAULT_PEER_CLAIM_TIMEOUT_MS,
    staleResetPreflight: deps.staleResetPreflight,
    reopenedStageReset,
  };
  return probeWorkflowStageRedispatchPreflight(args, resolved.steps, target.branchKey, resolved.runStaleResetPreflight);
}

/**
 * Stage-scoped resume: reopen a failed continuation when needed, claim awaiting pipelines
 * without dispatch, or continue a reopened failed stage — never restart or silently succeed
 * terminal pipelines. Optional `options.branchKey` scopes admission to one named fan-out
 * branch, bypassing aggregate `derivePipelineState` admission entirely; omission and
 * `branchKey: "default"` retain the unscoped whole-pipeline path above.
 * @pinned-bypass: branch-scoped resume must not reopen or mis-scope sibling branches via aggregate derivation.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: resume admission coordinates whole-pipeline vs branch-scoped continuation, failed-plan-lane stale-reset policy with the two reset-override flags, and terminal-vs-dispatch branching in one entry point; splitting would fragment the admission decision.
export async function resumePipeline(
  pipelineId: string,
  deps: Omit<PipelineExecutionDeps, "context"> & { context?: PipelineContext },
  options: {
    detachContinuation?: boolean;
    branchKey?: string;
    resetDespiteDirty?: boolean;
    resetDespiteLandedCriteria?: boolean;
    allowLanePrRepublish?: boolean;
  } = {},
): Promise<ResumePipelineOutcome> {
  const { store } = deps;
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) {
    return { kind: "refused", pipelineId, reason: "pipeline_not_found" };
  }

  const branchScope = normalizeContinuationBranchKey(options.branchKey);
  const resumePublicationOptions =
    options.allowLanePrRepublish === true ? ({ allowLanePrRepublish: true } as const) : undefined;

  let branchAdmission: Extract<ReturnType<typeof resolveBranchResumeAdmission>, { kind: "ok" }> | undefined;
  if (branchScope !== undefined) {
    const admission = resolveBranchResumeAdmission(pipeline, branchScope);
    if (admission.kind === "refused") {
      return { kind: "refused", pipelineId, branchKey: branchScope, ...admission.detail };
    }
    branchAdmission = admission;
  }
  const reopensInterrupted =
    branchAdmission?.reopenKind === "interrupted" ||
    (branchAdmission === undefined &&
      derivePipelineState(pipeline) === "interrupted" &&
      !pipeline.stages.some((stage) => stage.status === "running"));
  if (pipeline.dismissedAt !== null && reopensInterrupted) {
    return { kind: "refused", pipelineId, reason: "pipeline_dismissed" };
  }

  const continueAfterAdmission = async (
    continuationBranchKey?: string,
    continuationReopenedStageReset?: ReopenedStageReset,
  ): Promise<ResumePipelineOutcome> => {
    const probeDeps =
      continuationReopenedStageReset === undefined
        ? deps
        : { ...deps, reopenedStageReset: continuationReopenedStageReset };
    const probeContinuationKey = continuationBranchKey ?? branchScope;
    const dispatchRefusal = await probePipelineResumeRedispatchRefusal(pipelineId, probeDeps, {
      ...(probeContinuationKey !== undefined ? { continuationBranchKey: probeContinuationKey } : {}),
      ...(continuationReopenedStageReset !== undefined ? { reopenedStageReset: continuationReopenedStageReset } : {}),
    });
    if (dispatchRefusal !== undefined) {
      return { kind: "dispatch_refused", pipelineId, message: dispatchRefusal.message };
    }
    const dispatchContinuation = async (): Promise<ResumePipelineOutcome> => {
      const continuation = await continuePipeline(
        pipelineId,
        continuationReopenedStageReset === undefined
          ? deps
          : { ...deps, reopenedStageReset: continuationReopenedStageReset },
        continuationBranchKey ?? branchScope,
      );
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

  if (branchScope !== undefined && branchAdmission !== undefined) {
    const admission = branchAdmission;
    const resetStatus =
      admission.reopenKind === "failed" || admission.reopenKind === "interrupted" ? admission.reopenKind : undefined;
    const reopenedStageReset =
      resetStatus !== undefined
        ? buildReopenedStageReset(pipeline, findFailedStageForReopen(pipeline, branchScope, resetStatus), options)
        : undefined;
    if (resetStatus !== undefined) {
      if (resetStatus === "failed") {
        const inPlace = await deps.attemptFailedImplementPipelineResume?.(
          pipeline,
          pipelineId,
          branchScope,
          resumePublicationOptions,
        );
        if (inPlace !== undefined) return inPlace;
      }
      const reopen =
        resetStatus === "failed"
          ? store.reopenFailedPipeline({ pipelineId, branchKey: branchScope })
          : store.reopenInterruptedPipeline({ pipelineId, branchKey: branchScope });
      if (reopen.kind === "refused") {
        return { kind: "refused", pipelineId, branchKey: branchScope, reason: reopen.reason };
      }
      if (reopenedStageReset !== undefined) persistReopenedStageReset(store, pipelineId, reopenedStageReset);
    } else if (admission.reopenKind === "provisional_skip") {
      const reopen = store.reopenProvisionalSkippedStages({ pipelineId, branchKey: branchScope });
      if (reopen.kind !== "applied") {
        return { kind: "refused", pipelineId, branchKey: branchScope, reason: reopen.reason };
      }
    }
    return await continueAfterAdmission(undefined, reopenedStageReset);
  }

  // Settlement precondition: a stage whose entry run this daemon no longer drives settles from
  // its durable rows here, so resume sees the row it would otherwise have to redrive by hand.
  // Settlement is skipped for an `interrupted` pipeline, so a refusal below leaves its rows byte-identical.
  const settledEntryRuns =
    derivePipelineState(pipeline) === "interrupted"
      ? []
      : await settleOrphanedRunningStages(
          { store, isEntryRunLive: deps.isEntryRunLive ?? (() => false), loadLogRecords: deps.loadLogRecords },
          pipelineId,
        );
  skipSuffixOfSettledFailures(store, settledEntryRuns, pipelineId);
  // Every read below must see the post-settlement rows, not the snapshot loaded before it.
  const current = (settledEntryRuns.length > 0 ? store.loadPipeline(pipelineId) : null) ?? pipeline;
  const derivedState = derivePipelineState(current);

  const terminalReason = resumeTerminalRefusalReason(derivedState);
  if (terminalReason) {
    return { kind: "refused", pipelineId, reason: terminalReason };
  }
  if (settledEntryRuns.length > 0 && !current.stages.some((stage) => stage.status === "running")) {
    // Settling the wedged stage from its durable rows *is* this resume's work. Continuation carries
    // it forward where there is something to carry — a pending successor, or the terminal
    // publication a fully-satisfied pipeline still owes. A stage this settled `failed` stops here
    // instead of being reopened: discarding a failure the operator has not yet seen is their call to
    // make with a second resume, not this one's.
    return await continueAfterAdmission();
  }
  if (derivedState === "running") {
    return { kind: "refused", pipelineId, reason: "pipeline_not_resumable" };
  }
  if (derivedState === "interrupted") {
    const runningStage = current.stages.find((stage) => stage.status === "running");
    if (runningStage !== undefined) {
      return {
        kind: "refused",
        pipelineId,
        reason: "pipeline_interrupted_running_stage",
        state: derivedState,
        stageId: runningStage.stageId,
        ...(runningStage.workflowInvocationId === null ? {} : { runId: runningStage.workflowInvocationId }),
      };
    }
  }
  if (derivedState === "interrupted" && !current.stages.some((stage) => stage.status === "running")) {
    const reopenedStageReset = buildReopenedStageReset(
      current,
      findFailedStageForReopen(current, undefined, "interrupted"),
      options,
    );
    const reopen = store.reopenInterruptedPipeline({ pipelineId });
    if (reopen.kind === "refused") {
      return { kind: "refused", pipelineId, reason: reopen.reason };
    }
    if (reopenedStageReset !== undefined) persistReopenedStageReset(store, pipelineId, reopenedStageReset);
    return await continueAfterAdmission(undefined, reopenedStageReset);
  }
  const approvedGateBranchKey = approvedGatePendingStrandBranchKey(current);
  if (!resumeAwaitingClaimsOnly(derivedState) && approvedGateBranchKey !== undefined) {
    const continuationBranchKey =
      approvedGateBranchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY ? undefined : approvedGateBranchKey;
    return await continueAfterAdmission(continuationBranchKey, undefined);
  }
  if (resumeDeferredRefusalApplies(derivedState, current)) {
    return { kind: "refused", pipelineId, reason: "pipeline_not_resumable" };
  }

  if (resumeAwaitingClaimsOnly(derivedState)) {
    const branchKeys = listBranchResumeRequiredKeys(current);
    if (branchKeys.length > 0) {
      return { kind: "refused", pipelineId, reason: "branch_resume_required", branchKeys };
    }
    if (current.context === null) {
      return { kind: "refused", pipelineId, reason: "missing_context" };
    }
    if (!persistedContextLoadPermitsContinuation(current.context)) {
      return { kind: "refused", pipelineId, reason: "pipeline_not_resumable" };
    }
    const claim = store.claimPipelineContinuation({
      pipelineId,
      priorOwnerIdentity: current.ownerIdentity,
    });
    if (claim.kind === "refused") {
      return { kind: "refused", pipelineId, reason: "claim_refused" };
    }
    return { kind: "resumed", pipelineId };
  }

  if (resumeFailedRequiresReopen(derivedState)) {
    const inPlace = await deps.attemptFailedImplementPipelineResume?.(
      current,
      pipelineId,
      undefined,
      resumePublicationOptions,
    );
    if (inPlace !== undefined) return inPlace;
    const reopenedStageReset = buildReopenedStageReset(current, findFailedStageForReopen(current, undefined), options);
    const reopen = store.reopenFailedPipeline({ pipelineId });
    if (reopen.kind === "refused") {
      return { kind: "refused", pipelineId, reason: reopen.reason };
    }
    if (reopenedStageReset !== undefined) persistReopenedStageReset(store, pipelineId, reopenedStageReset);
    return await continueAfterAdmission(undefined, reopenedStageReset);
  }

  if (resumeReopenedPendingContinuation(derivedState, current)) {
    return await continueAfterAdmission();
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
    void continuePipeline(pipelineId, deps, normalizeContinuationBranchKey(branchKey)).catch((err: unknown) => {
      console.error(`Pipeline ${pipelineId} continuation after approval failed:`, err);
    });
  }
  if (outcome.kind === "applied" && decision === "rejected") {
    settleSeveredLanesAfterDecision(deps.store, pipelineId);
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

/** True when a reconciled or active pipeline with persisted context has a dispatchable workflow stage or pending settlement. */
export function isPipelineContinuable(pipeline: Pipeline & { stages: PipelineStageRecord[] }): boolean {
  if (pipeline.status !== "active" && pipeline.status !== "interrupted") return false;
  if (!persistedContextLoadPermitsContinuation(pipeline.context)) return false;
  if (isPipelineSettlementPending(pipeline)) return true;

  const derivedState = derivePipelineState(pipeline);
  if (derivedState !== "pending") return false;

  return approvalOutcomePermitsActivation(pipeline) && reopenedFailurePermitsActivation(pipeline);
}

/** True when the pipeline row carries a durable terminal-publication failure. */
export function hasPipelineTerminalPublicationFailure(pipeline: Pick<Pipeline, "terminalPublicationFailure">): boolean {
  return pipeline.terminalPublicationFailure !== null;
}

export function narrowPipelineStageArtifact(artifact: unknown): PipelineStageArtifact | undefined {
  return artifact !== null &&
    typeof artifact === "object" &&
    typeof (artifact as PipelineStageArtifact).entryRunId === "string" &&
    typeof (artifact as PipelineStageArtifact).specPath === "string"
    ? (artifact as PipelineStageArtifact)
    : undefined;
}

/** First succeeded stage row carrying durable `artifact.lanePrOutcome`. */
export function pipelineSettledLanePrOutcome(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): LanePrOutcome | undefined {
  for (const stage of pipeline.stages) {
    if (stage.status !== "succeeded") continue;
    const artifact = narrowPipelineStageArtifact(stage.artifact);
    if (artifact?.lanePrOutcome !== undefined) return artifact.lanePrOutcome;
  }
  return undefined;
}

export function terminalPublicationFailureForcesPipelineFailed(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
): boolean {
  return hasPipelineTerminalPublicationFailure(pipeline) && pipelineSettledLanePrOutcome(pipeline) === undefined;
}

function areAuthoredStagesSatisfiedForSettlement(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit | null,
): boolean {
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

type StageTerminalPublication = { succeededAt: number } | { failure: PublicationFailure };

function stageTerminalPublicationFromArtifact(artifact: unknown): StageTerminalPublication | null {
  if (!isRecord(artifact)) return null;
  const stamp = artifact.terminalPublication;
  if (!isRecord(stamp)) return null;
  if (typeof stamp.succeededAt === "number") return { succeededAt: stamp.succeededAt };
  if (
    isRecord(stamp.failure) &&
    typeof stamp.failure.operation === "string" &&
    typeof stamp.failure.message === "string"
  ) {
    return { failure: stamp.failure as PublicationFailure };
  }
  return null;
}

function finalSucceededWorkflowStageForBranch(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  splitPosition: number,
  branchKey: string,
): PipelineStageRecord | undefined {
  for (let position = pipeline.definition.stages.length - 1; position > splitPosition; position -= 1) {
    const stage = pipeline.definition.stages[position];
    if (stage?.kind !== "workflow") continue;
    const record = pipeline.stages.find(
      (row) => row.position === position && row.stageId === stage.stageId && row.branchKey === branchKey,
    );
    if (record?.status === "succeeded") return record;
  }
  return undefined;
}

function isFanOutLaneSuffixSatisfiedForPublication(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  branchKey: string,
): boolean {
  for (const { stage, record } of suffixStagesForBranch(pipeline, split.splitPosition, branchKey)) {
    if (!isAuthoredStageSatisfied(stage, record)) return false;
  }
  return true;
}

function fanOutLaneOwesTerminalPublication(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  branchKey: string,
): boolean {
  if (!isFanOutLaneSuffixSatisfiedForPublication(pipeline, split, branchKey)) return false;
  const stage = finalSucceededWorkflowStageForBranch(pipeline, split.splitPosition, branchKey);
  if (stage === undefined) return false;
  return stageTerminalPublicationFromArtifact(stage.artifact) === null;
}

/** True when every authored stage is satisfied but terminal publication has not succeeded. */
export function isPipelineSettlementPending(pipeline: Pipeline & { stages: PipelineStageRecord[] }): boolean {
  if (pipeline.definition.terminalAction === undefined) return false;
  if (pipeline.terminalPublicationSucceededAt !== null) return false;
  const split = findFanOutSplit(pipeline);
  if (split !== null) {
    if (!areAuthoredStagesSatisfiedForSettlement(pipeline, split)) return false;
    return split.branchKeys.some((branchKey) => fanOutLaneOwesTerminalPublication(pipeline, split, branchKey));
  }
  if (pipeline.terminalPublicationFailure !== null) return false;
  return areAuthoredStagesSatisfiedForSettlement(pipeline, null);
}

type ResolvedTerminalPublicationInput =
  | { ok: true; input: TerminalPublicationInput }
  | { ok: false; failure: PublicationFailure; prNumber?: number; prUrl?: string };

type TerminalWorkflowStage = { stage: Extract<PipelineStage, { kind: "workflow" }>; record: PipelineStageRecord };

function resolveFanOutLaneTerminalStage(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  terminalAction: PipelineTerminalAction,
  branchKey: string | undefined,
): { ok: true; stage: TerminalWorkflowStage } | { ok: false; failure: PublicationFailure } {
  if (branchKey === undefined) {
    return {
      ok: false,
      failure: { operation: terminalAction, message: "fan-out terminal publication requires branchKey" },
    };
  }
  const record = finalSucceededWorkflowStageForBranch(pipeline, split.splitPosition, branchKey);
  if (record === undefined) {
    return {
      ok: false,
      failure: {
        operation: terminalAction,
        message: `no succeeded workflow stage artifact available for branch "${branchKey}"`,
      },
    };
  }
  const stage = pipeline.definition.stages[record.position];
  if (stage?.kind !== "workflow") {
    return {
      ok: false,
      failure: { operation: terminalAction, message: `stage at position ${record.position} is not a workflow stage` },
    };
  }
  return { ok: true, stage: { stage, record } };
}

function resolveTerminalPublicationInput(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  store: StateStore,
  branchKey?: string,
): ResolvedTerminalPublicationInput {
  const terminalAction = pipeline.definition.terminalAction;
  if (terminalAction === undefined) {
    return { ok: false, failure: { operation: "terminal-publication", message: "pipeline has no terminal action" } };
  }

  const split = findFanOutSplit(pipeline);
  let lastStage: TerminalWorkflowStage | undefined;
  if (split !== null) {
    const lane = resolveFanOutLaneTerminalStage(pipeline, split, terminalAction, branchKey);
    if (!lane.ok) return lane;
    lastStage = lane.stage;
  } else {
    for (const entry of authoredStagesInPositionOrder(pipeline)) {
      if (entry.stage.kind === "workflow" && entry.record.status === "succeeded") {
        lastStage = { stage: entry.stage, record: entry.record };
      }
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

  const findHarnessReadyFlipEvidenceInLineage = bindHarnessReadyFlipEvidenceLookup(store, entryRun.id);

  return {
    ok: true,
    input: {
      terminalAction,
      worktreePath: entryRun.worktreePath,
      branch: entryRun.branch,
      baseRef: entryRun.specRef,
      verifierProcessGroups: storeVerifierProcessGroupRecorder(store, entryRun.id),
      recordHarnessReadyFlipEvidence: (args) => store.recordHarnessReadyFlipEvidence({ runId: entryRun.id, ...args }),
      ...(findHarnessReadyFlipEvidenceInLineage !== undefined ? { findHarnessReadyFlipEvidenceInLineage } : {}),
      ...terminalReadyCommand(entryRun),
      ...(artifact.prNumber !== undefined ? { prNumber: artifact.prNumber } : {}),
      ...(artifact.prUrl !== undefined ? { prUrl: artifact.prUrl } : {}),
    },
  };
}

/** Project `readyCommand` stamped on the entry run's workflow snapshot (same source implement's ready gate reads). */
function terminalReadyCommand(entryRun: Run): { readyCommand?: string } {
  const readyCommand = entryRun.workflowSnapshot?.steps.find((step) => step.readyCommand !== undefined)?.readyCommand;
  return readyCommand !== undefined ? { readyCommand } : {};
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
        ...(args.branchKey !== undefined ? { branchKey: args.branchKey } : {}),
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
  branchKey?: string,
): boolean {
  try {
    store.commitTerminalPublicationSuccess(branchKey !== undefined ? { pipelineId, branchKey } : { pipelineId });
    return true;
  } catch (error) {
    commitTerminalPublicationFailureSafely(store, {
      pipelineId,
      terminalAction,
      failure: normalizePublicationFailure(terminalAction, error),
      ...(branchKey !== undefined ? { branchKey } : {}),
    });
    return false;
  }
}

function stageArtifactPrNumber(record: PipelineStageRecord): number | undefined {
  const raw = record.artifact;
  return raw !== null && typeof raw === "object" && typeof (raw as PipelineStageArtifact).prNumber === "number"
    ? (raw as PipelineStageArtifact).prNumber
    : undefined;
}

/** Succeeded workflow-stage PRs on `branchKey` with `afterPosition < position < beforePosition`. */
function supersedeCandidatesInRange(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  range: { branchKey: string; afterPosition: number; beforePosition: number; excludedPrNumbers: ReadonlySet<number> },
): Array<{ stageId: string; prNumber: number }> {
  const seen = new Set<number>(range.excludedPrNumbers);
  const candidates: Array<{ stageId: string; prNumber: number }> = [];
  for (const { stage, record } of authoredStagesInPositionOrder(pipeline)) {
    if (record.branchKey !== range.branchKey || stage.kind !== "workflow" || record.status !== "succeeded") continue;
    if (record.position <= range.afterPosition || record.position >= range.beforePosition) continue;
    const prNumber = stageArtifactPrNumber(record);
    if (prNumber === undefined || seen.has(prNumber)) continue;
    seen.add(prNumber);
    candidates.push({ stageId: stage.stageId, prNumber });
  }
  return candidates;
}

function supersedePrecedingStageCandidates(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  terminalPrNumber: number,
  branchKey: string | undefined,
): Array<{ stageId: string; prNumber: number }> {
  const split = findFanOutSplit(pipeline);
  if (split === null) {
    let terminalPosition: number | undefined;
    for (const { stage, record } of authoredStagesInPositionOrder(pipeline)) {
      if (record.branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY) continue;
      if (stage.kind !== "workflow") continue;
      if (record.status === "succeeded") terminalPosition = record.position;
    }
    if (terminalPosition === undefined) return [];
    return supersedeCandidatesInRange(pipeline, {
      branchKey: DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
      afterPosition: -1,
      beforePosition: terminalPosition,
      excludedPrNumbers: new Set([terminalPrNumber]),
    });
  }
  if (branchKey === undefined) return [];
  const laneFinal = finalSucceededWorkflowStageForBranch(pipeline, split.splitPosition, branchKey);
  if (laneFinal === undefined) return [];
  const laneTerminalPrNumbers = new Set<number>([terminalPrNumber]);
  for (const key of split.branchKeys) {
    const final = finalSucceededWorkflowStageForBranch(pipeline, split.splitPosition, key);
    const prNumber = final === undefined ? undefined : stageArtifactPrNumber(final);
    if (prNumber !== undefined) laneTerminalPrNumbers.add(prNumber);
  }
  const laneCandidates = supersedeCandidatesInRange(pipeline, {
    branchKey,
    afterPosition: split.splitPosition,
    beforePosition: laneFinal.position,
    excludedPrNumbers: laneTerminalPrNumbers,
  });
  // The shared prefix (intent) PR closes only once every lane's terminal publication succeeded.
  if (pipeline.terminalPublicationSucceededAt === null) return laneCandidates;
  return [
    ...laneCandidates,
    ...supersedeCandidatesInRange(pipeline, {
      branchKey: DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
      afterPosition: -1,
      beforePosition: split.splitPosition + 1,
      excludedPrNumbers: new Set([...laneTerminalPrNumbers, ...laneCandidates.map((c) => c.prNumber)]),
    }),
  ];
}

function supersedeFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function settleSupersededPrecedingStagePrs(
  args: {
    pipelineId: string;
    pipeline: Pipeline & { stages: PipelineStageRecord[] };
    terminalAction: PipelineTerminalAction;
    worktreePath: string;
    terminalPrNumber: number;
    branchKey: string | undefined;
  },
  deps: Pick<PipelineExecutionDeps, "store" | "supersedeGh">,
): Promise<void> {
  if (args.pipeline.definition.supersede !== "close") return;
  if (args.terminalAction !== "ready" && args.terminalAction !== "merge") return;

  const candidates = supersedePrecedingStageCandidates(args.pipeline, args.terminalPrNumber, args.branchKey);
  if (candidates.length === 0) return;

  const supersedeGh = deps.supersedeGh ?? createDefaultSupersedeGh();
  const failures: PipelineSupersedeFailure[] = [];

  for (const candidate of candidates) {
    const body = formatTerminalSupersedeSettlementComment({
      terminalPrNumber: args.terminalPrNumber,
      pipelineId: args.pipelineId,
      stageId: candidate.stageId,
    });
    let state: string;
    try {
      ({ state } = await supersedeGh.prState(args.worktreePath, candidate.prNumber));
    } catch (error) {
      failures.push({ prNumber: candidate.prNumber, message: supersedeFailureMessage(error) });
      continue;
    }
    if (state !== "OPEN") continue;

    try {
      await supersedeGh.comment(args.worktreePath, candidate.prNumber, body);
    } catch (error) {
      failures.push({ prNumber: candidate.prNumber, message: supersedeFailureMessage(error) });
      continue;
    }

    try {
      await supersedeGh.close(args.worktreePath, candidate.prNumber);
    } catch (error) {
      failures.push({ prNumber: candidate.prNumber, message: supersedeFailureMessage(error) });
    }
  }

  if (failures.length > 0) {
    deps.store.appendSupersedeFailures({ pipelineId: args.pipelineId, failures });
  }
}

type TerminalSettlementDeps = Pick<
  PipelineExecutionDeps,
  "store" | "executeTerminalPublication" | "supersedeGh" | "subprocessRunner" | "staleResetPreflight"
>;

/** A dependent lane publishes only after its predecessor's merge is rebased out of the publishing branch (never the plan branch about to be superseded). */
async function rebaseLaneBeforePublication(
  pipelineId: string,
  deps: TerminalSettlementDeps,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  branchKey: string | undefined,
): Promise<ChainedLaneRebase> {
  const split = branchKey === undefined ? null : findFanOutSplit(pipeline);
  if (split === null || branchKey === undefined) return { ok: true, merged: false };
  const predecessor = chainPredecessorOf(persistedFanOutLaneChain(pipeline, split), branchKey);
  const final = finalSucceededWorkflowStageForBranch(pipeline, split.splitPosition, branchKey);
  if (predecessor === undefined || final === undefined) return { ok: true, merged: false };
  const git = chainedLaneGitDeps(deps);
  return rebaseLaneAfterPredecessorMerge(git, pipelineId, pipeline, split, branchKey, predecessor, {
    onlyStageId: final.stageId,
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: terminal-publication settlement fans over terminalAction, PR evidence, and retarget cases
async function settleOneLaneTerminalPublication(
  pipelineId: string,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  terminalAction: PipelineTerminalAction,
  branchKey: string | undefined,
  deps: TerminalSettlementDeps,
): Promise<void> {
  const { store } = deps;
  const resolved = resolveTerminalPublicationInput(pipeline, store, branchKey);
  if (!resolved.ok) {
    commitTerminalPublicationFailureSafely(store, {
      pipelineId,
      terminalAction,
      failure: resolved.failure,
      ...(resolved.prNumber !== undefined ? { prNumber: resolved.prNumber } : {}),
      ...(resolved.prUrl !== undefined ? { prUrl: resolved.prUrl } : {}),
      ...(branchKey !== undefined ? { branchKey } : {}),
    });
    return;
  }

  const stacked = await rebaseLaneBeforePublication(pipelineId, deps, pipeline, branchKey);
  if (!stacked.ok) {
    commitTerminalPublicationFailureSafely(store, {
      pipelineId,
      terminalAction,
      failure: { operation: terminalAction, message: stacked.message },
      ...(resolved.input.prNumber !== undefined ? { prNumber: resolved.input.prNumber } : {}),
      ...(resolved.input.prUrl !== undefined ? { prUrl: resolved.input.prUrl } : {}),
      ...(branchKey !== undefined ? { branchKey } : {}),
    });
    return;
  }

  const execute = deps.executeTerminalPublication ?? executeTerminalPublication;
  try {
    const publicationResult = await execute(resolved.input);
    const committed = commitTerminalPublicationSuccessSafely(store, pipelineId, terminalAction, branchKey);
    const settled = committed && branchKey !== undefined ? store.loadPipeline(pipelineId) : pipeline;
    if (committed && settled) {
      const terminalPrNumber = publicationResult.prNumber ?? resolved.input.prNumber;
      if (terminalPrNumber !== undefined) {
        await settleSupersededPrecedingStagePrs(
          {
            pipelineId,
            pipeline: settled,
            terminalAction,
            worktreePath: resolved.input.worktreePath,
            terminalPrNumber,
            branchKey,
          },
          deps,
        );
      }
    }
  } catch (error) {
    if (error instanceof TerminalPublicationError) {
      commitTerminalPublicationFailureSafely(store, {
        pipelineId,
        terminalAction: error.terminalAction,
        failure: error.failure,
        ...(error.prNumber !== undefined ? { prNumber: error.prNumber } : {}),
        ...(error.prUrl !== undefined ? { prUrl: error.prUrl } : {}),
        ...(branchKey !== undefined ? { branchKey } : {}),
      });
      return;
    }
    commitTerminalPublicationFailureSafely(store, {
      pipelineId,
      terminalAction,
      failure: normalizePublicationFailure(terminalAction, error),
      ...(resolved.input.prNumber !== undefined ? { prNumber: resolved.input.prNumber } : {}),
      ...(resolved.input.prUrl !== undefined ? { prUrl: resolved.input.prUrl } : {}),
      ...(branchKey !== undefined ? { branchKey } : {}),
    });
  }
}

function settlementContextFailureMessage(context: Pipeline["context"]): string | null {
  if (persistedContextLoadPermitsContinuation(context)) return null;
  if (context === null) return "missing pipeline admission context";
  const loadedContext = loadPipelineContext(context);
  return `pipeline-context-loader: ${loadedContext.ok ? "invalid pipeline admission context" : loadedContext.error.errors.join("; ")}`;
}

/**
 * Settles terminal publication. Linear pipelines settle once; fan-out pipelines settle each lane
 * that owes a stamp (`scopeBranchKey` limits the pass to one lane, from that lane's suffix walk).
 */
async function settlePipelineTerminalPublication(
  pipelineId: string,
  deps: TerminalSettlementDeps,
  scopeBranchKey?: string,
): Promise<void> {
  const { store } = deps;
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) return;
  const terminalAction = pipeline.definition.terminalAction;
  if (!terminalAction) return;

  const split = findFanOutSplit(pipeline);
  if (split === null) {
    if (!isPipelineSettlementPending(pipeline)) return;
    const message = settlementContextFailureMessage(pipeline.context);
    if (message !== null) {
      commitTerminalPublicationFailureSafely(store, {
        pipelineId,
        terminalAction,
        failure: { operation: terminalAction, message },
      });
      return;
    }
    await settleOneLaneTerminalPublication(pipelineId, pipeline, terminalAction, undefined, deps);
    return;
  }

  const branchKeys =
    scopeBranchKey !== undefined ? [scopeBranchKey] : [...split.branchKeys].sort((a, b) => a.localeCompare(b));
  for (const branchKey of branchKeys) {
    const fresh = store.loadPipeline(pipelineId);
    if (!fresh || fresh.terminalPublicationSucceededAt !== null) return;
    if (!fanOutLaneOwesTerminalPublication(fresh, split, branchKey)) continue;
    const message = settlementContextFailureMessage(fresh.context);
    if (message !== null) {
      commitTerminalPublicationFailureSafely(store, {
        pipelineId,
        terminalAction,
        failure: { operation: terminalAction, message },
        branchKey,
      });
      continue;
    }
    await settleOneLaneTerminalPublication(pipelineId, fresh, terminalAction, branchKey, deps);
  }
}

/**
 * Daemon-start sweep: settle every `running` stage whose linked entry run this daemon does not
 * drive (durable rows are the truth), then continue every continuable pipeline with no live
 * owner. Settlement and continuation are one path — no redrive predicate decides differently.
 */
export async function recoverContinuablePipelines(
  store: StateStore,
  pipelineDeps: Omit<PipelineExecutionDeps, "context">,
  isOwnerAliveProbe: OwnerLivenessProbe = isOwnerAlive,
  reconciledEntryRunIds: ReadonlySet<string> = new Set(),
): Promise<{ continued: number }> {
  // A run this same startup reconciled and handed to `recoverReconciledRuns` is being resumed right
  // now, and resumption does not register it as live anywhere the sweep can see: its durable row
  // still reads the terminal status reconciliation wrote. Settling from that row would fail the
  // stage — and skip its suffix — out from under a run that is actively working, and nothing would
  // re-settle it afterwards, because settlement only ever matches a `running` stage row.
  const isEntryRunLive = (entryRunId: string): boolean =>
    reconciledEntryRunIds.has(entryRunId) || (pipelineDeps.isEntryRunLive?.(entryRunId) ?? false);
  skipSuffixOfSettledFailures(
    store,
    await settleOrphanedRunningStages(
      { store, isEntryRunLive, loadLogRecords: pipelineDeps.loadLogRecords },
      undefined,
      isOwnerAliveProbe,
    ),
  );
  let continued = 0;
  const processed = new Set<string>();
  for (const pipeline of store.listPipelines()) {
    if (!isPipelineContinuable(pipeline)) continue;
    const owner = pipeline.ownerIdentity;
    if (owner !== null && (await isOwnerAliveProbe(owner))) continue;
    const outcome = await continuePipeline(pipeline.id, pipelineDeps);
    processed.add(pipeline.id);
    if (outcome.kind === "continued") continued += 1;
  }
  // Settled chained lanes: same ownership gate as continuation, never a pipeline just continued above.
  for (const pipeline of store.listPipelines()) {
    if (pipeline.status !== "active" || pipeline.dismissedAt !== null || processed.has(pipeline.id)) continue;
    const owner = pipeline.ownerIdentity;
    if (owner !== null && (await isOwnerAliveProbe(owner))) continue;
    await rebaseCompletedDependentLanes(pipeline.id, pipelineDeps);
  }
  return { continued };
}

export function findStageRecord(
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

export type FanOutPlanResultEntry = {
  steps: AnyWorkflowStep[];
  runStaleResetPreflight?: StaleResetPreflight;
  preflightCapture?: { message: string };
};

export type FanOutPlanResultBinding = { ok: true; result: FanOutPlanResultEntry } | { ok: false; error: string };

function availableFanOutDownstreamInputs(paths: readonly string[]): string {
  return paths.length === 0 ? "(none)" : paths.join(", ");
}

function fanOutPlanBindingError(
  lane: string,
  downstreamInput: string | undefined,
  detail: string,
  downstreamInputs: readonly string[],
): string {
  const inputLabel = downstreamInput === undefined ? "downstream input (none)" : `downstream input ${downstreamInput}`;
  return `pipeline-stage-resolve: plan lane "${lane}" ${detail} for ${inputLabel}; available downstream inputs: ${availableFanOutDownstreamInputs(downstreamInputs)}`;
}

/** Pair fan-out `{ results }` entries with intent downstream inputs by derived branch key. */
export function fanOutPlanResultForBranch(
  downstreamInputs: readonly string[],
  results: readonly FanOutPlanResultEntry[],
  branchKey: string,
): FanOutPlanResultBinding {
  const matchingPath = downstreamInputs.find((path) => branchKeyFromDownstreamInput(path) === branchKey);
  if (matchingPath === undefined) {
    return {
      ok: false,
      error: fanOutPlanBindingError(branchKey, undefined, "has no matching downstream input", downstreamInputs),
    };
  }

  const resultByBranchKey = new Map<string, FanOutPlanResultEntry>();
  for (let index = 0; index < downstreamInputs.length; index += 1) {
    const path = downstreamInputs[index];
    if (path === undefined || index >= results.length) continue;
    resultByBranchKey.set(branchKeyFromDownstreamInput(path), results[index]!);
  }

  const result = resultByBranchKey.get(branchKey);
  if (result === undefined) {
    return {
      ok: false,
      error: fanOutPlanBindingError(branchKey, matchingPath, "has no paired fan-out result", downstreamInputs),
    };
  }

  return { ok: true, result };
}

type FanOutSplit = {
  splitPosition: number;
  branchKeys: string[];
};

type SplittingPipelineStageArtifact = PipelineStageArtifact & {
  downstreamInputs: string[];
};

function isSplittingArtifact(artifact: PipelineStageArtifact): artifact is SplittingPipelineStageArtifact {
  return (artifact.downstreamInputs?.length ?? 0) >= 2;
}

export function findFanOutSplit(pipeline: Pipeline & { stages: PipelineStageRecord[] }): FanOutSplit | null {
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
          branchKeys: typed.downstreamInputs.map(branchKeyFromDownstreamInput),
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

function defaultBranchPredecessorsSatisfied(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  record: PipelineStageRecord,
): boolean {
  for (const pred of pipeline.stages) {
    if (pred.position >= record.position) continue;
    if (pred.branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY) continue;
    const predStage = pipeline.definition.stages[pred.position];
    if (predStage === undefined) continue;
    if (!isAuthoredStageSatisfied(predStage, pred)) return false;
  }
  return true;
}

function preSplitPredecessorsSatisfied(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  splitPosition: number,
): boolean {
  for (let index = 0; index <= splitPosition; index += 1) {
    const predStage = pipeline.definition.stages[index];
    if (predStage === undefined) continue;
    const predRecord = findStageRecord(pipeline.stages, predStage.stageId);
    if (!isAuthoredStageSatisfied(predStage, predRecord)) return false;
  }
  return true;
}

function branchSuffixPredecessorsBeforeRecordSatisfied(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  record: PipelineStageRecord,
  splitPosition: number,
): boolean {
  for (const { stage, record: pred } of suffixStagesForBranch(pipeline, splitPosition, record.branchKey)) {
    if (pred.position >= record.position) continue;
    if (!isAuthoredStageSatisfied(stage, pred)) return false;
  }
  return true;
}

export function branchSuffixPredecessorsSatisfied(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  record: PipelineStageRecord,
  split: FanOutSplit | null,
): boolean {
  if (split === null || record.position <= split.splitPosition) {
    return defaultBranchPredecessorsSatisfied(pipeline, record);
  }
  if (!preSplitPredecessorsSatisfied(pipeline, split.splitPosition)) return false;
  return branchSuffixPredecessorsBeforeRecordSatisfied(pipeline, record, split.splitPosition);
}

export function fanOutBranchSuffixTerminallySettled(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  branchKey: string,
): boolean {
  for (const { stage, record } of suffixStagesForBranch(pipeline, split.splitPosition, branchKey)) {
    if (stage.kind === "approval" && record.status === "rejected") return true;
    if (record.status === "failed") return true;
  }
  return false;
}

export function fanOutLaneProgress(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  branchKey: string,
): LaneProgress {
  let complete = true;
  let ended = false;
  for (const { stage, record } of suffixStagesForBranch(pipeline, split.splitPosition, branchKey)) {
    if (!isAuthoredStageSatisfied(stage, record)) complete = false;
    // A provisional skip awaits its failed predecessor's reopen; only a terminal skip ends the lane.
    if (record.status === "failed" && !isChainedLaneRebaseRefusal(record.failureDetail)) ended = true;
    if (record.status === "rejected") ended = true;
    if (record.status === "skipped" && record.skipProvenance === "terminal") ended = true;
  }
  if (complete) return "complete";
  return ended ? "dead" : "open";
}

function fanOutLaneGate(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  chain: FanOutLaneChain,
  branchKey: string,
): LaneChainGate {
  return laneChainGate(chain, branchKey, (lane) => fanOutLaneProgress(pipeline, split, lane));
}

/** Branch of the predecessor lane's final succeeded workflow stage — the ref a chained lane forks from. */
function fanOutLaneForkRef(
  store: StateStore,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  predecessor: string,
): string | undefined {
  const record = finalSucceededWorkflowStageForBranch(pipeline, split.splitPosition, predecessor);
  const entryRunId = narrowPipelineStageArtifact(record?.artifact)?.entryRunId;
  const branch = entryRunId === undefined ? undefined : store.loadRun(entryRunId)?.branch;
  return branch ? branch : undefined;
}

/** Git and `gh` seams for the chained-lane rebase; production defaults when a dep is absent. */
type ChainedLaneGitDeps = { store: StateStore; runner: AsyncSubprocessRunner; supersedeGh: SupersedeGh };

function chainedLaneGitDeps(deps: {
  store: StateStore;
  subprocessRunner?: AsyncSubprocessRunner | undefined;
  supersedeGh?: SupersedeGh | undefined;
  staleResetPreflight?: PipelineExecutionDeps["staleResetPreflight"] | undefined;
}): ChainedLaneGitDeps {
  return {
    store: deps.store,
    runner: deps.subprocessRunner ?? deps.staleResetPreflight?.cliDeps.subprocessRunner ?? realAsyncSubprocessRunner,
    supersedeGh: deps.supersedeGh ?? createDefaultSupersedeGh(),
  };
}

/** Marker on a chained-lane rebase refusal's `failureDetail`: the lane is recoverable, not dead. */
const CHAINED_LANE_REBASE_REFUSAL = "chained_lane_rebase_refused";

/** True for a `failed` row written by a chained-lane rebase refusal — retryable via `pipeline resume`, never severing successors. */
export function isChainedLaneRebaseRefusal(failureDetail: unknown): boolean {
  return isRecord(failureDetail) && failureDetail.code === CHAINED_LANE_REBASE_REFUSAL;
}

type ChainedLaneRefusalReason =
  | "tip_unresolved"
  | "merge_probe_failed"
  | "ancestry_check_failed"
  | "dirty_worktree"
  | "remote_missing"
  | "fetch_failed"
  | "remote_diverged"
  | "base_fetch_failed"
  | "rebase_conflict"
  | "push_rejected";
type ChainedLaneRefusal = { ok: false; reason: ChainedLaneRefusalReason; message: string };
/** `forkRef` is the recorded predecessor tip SHA for an unmerged predecessor's next dependent dispatch. */
type ChainedLaneRebase =
  | { ok: true; merged: false; forkRef?: string }
  | { ok: true; merged: true }
  | ChainedLaneRefusal;

/** The project checkout the pipeline was admitted from: repo-wide git (`rev-parse`, base fetch) and `gh` run there. */
function pipelineProjectCwd(pipeline: Pipeline): string | undefined {
  const loaded = loadPipelineContext(pipeline.context);
  return loaded.ok ? loaded.context.cwd : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The predecessor's final succeeded workflow stage, its entry run, the recorded fork SHA, and its PR. */
type ChainPredecessorTip = {
  record: PipelineStageRecord;
  artifact: PipelineStageArtifact;
  run: Run;
  sha?: string;
  prNumber?: number;
};

function chainPredecessorTip(
  store: StateStore,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  predecessor: string,
): ChainPredecessorTip | undefined {
  const record = finalSucceededWorkflowStageForBranch(pipeline, split.splitPosition, predecessor);
  const artifact = narrowPipelineStageArtifact(record?.artifact);
  const run = artifact === undefined ? null : store.loadRun(artifact.entryRunId);
  if (record === undefined || artifact === undefined || run === null || !run.branch) return undefined;
  return {
    record,
    artifact,
    run,
    ...(artifact.forkTipSha !== undefined ? { sha: artifact.forkTipSha } : {}),
    ...(artifact.prNumber !== undefined ? { prNumber: artifact.prNumber } : {}),
  };
}

/**
 * The SHA every dependent dispatch forks from and every rebase replays past. Read once from the
 * branch while it exists (the name is mutable and gone once cleanup retires the lane) and persisted
 * on the predecessor's stage artifact (`forkTipSha`). Needed only while the predecessor is unmerged
 * and a dependent stage is about to fork from it.
 */
async function recordPredecessorForkSha(
  git: ChainedLaneGitDeps,
  pipelineId: string,
  tip: ChainPredecessorTip,
  predecessor: string,
  cwd: string,
): Promise<string | ChainedLaneRefusal> {
  if (tip.sha !== undefined) return tip.sha;
  let sha: string;
  try {
    sha = (await git.runner.runAsync("git", ["rev-parse", "--verify", `${tip.run.branch}^{commit}`], cwd)).trim();
  } catch (error) {
    return {
      ok: false,
      reason: "tip_unresolved",
      message: `predecessor lane "${predecessor}" is unmerged and its tip ${tip.run.branch} cannot be resolved in ${cwd}: ${errorText(error)}`,
    };
  }
  git.store.updateStage({
    pipelineId,
    stageId: tip.record.stageId,
    branchKey: predecessor,
    patch: { artifact: { ...tip.artifact, forkTipSha: sha } },
  });
  return sha;
}

/** Durable `rebasedAfterPredecessorMerge` stamp on a lane stage artifact. */
type PredecessorRebaseStamp = { predecessor: string; predecessorTip: string; at: number };

function laneRebaseStamp(artifact: PipelineStageArtifact | undefined): PredecessorRebaseStamp | undefined {
  const stamp = artifact?.rebasedAfterPredecessorMerge;
  return isRecord(stamp) && typeof stamp.predecessor === "string" ? (stamp as PredecessorRebaseStamp) : undefined;
}

/** A succeeded workflow-stage branch of a lane not yet stamped past the predecessor merge. */
type LaneBranch = {
  stageId: string;
  artifact: PipelineStageArtifact;
  worktreePath: string;
  branch: string;
  baseRef: string;
};

function unrebasedLaneBranches(
  store: StateStore,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  lane: string,
  onlyStageId?: string,
): { branches: LaneBranch[]; stamped: boolean } {
  const branches: LaneBranch[] = [];
  let stamped = false;
  for (const { stage, record } of suffixStagesForBranch(pipeline, split.splitPosition, lane)) {
    if (stage.kind !== "workflow" || record.status !== "succeeded") continue;
    const artifact = narrowPipelineStageArtifact(record.artifact);
    if (artifact === undefined) continue;
    if (laneRebaseStamp(artifact) !== undefined) {
      stamped = true;
      continue;
    }
    if (onlyStageId !== undefined && stage.stageId !== onlyStageId) continue;
    const run = store.loadRun(artifact.entryRunId);
    if (run === null || !run.worktreePath || !run.branch) continue;
    branches.push({
      stageId: stage.stageId,
      artifact,
      worktreePath: run.worktreePath,
      branch: run.branch,
      baseRef: run.specRef,
    });
  }
  return { branches, stamped };
}

function stampLaneBranch(
  store: StateStore,
  pipelineId: string,
  lane: string,
  branch: LaneBranch,
  predecessor: string,
  predecessorTip: string,
): void {
  const stamp: PredecessorRebaseStamp = { predecessor, predecessorTip, at: Date.now() };
  store.updateStage({
    pipelineId,
    stageId: branch.stageId,
    branchKey: lane,
    patch: { artifact: { ...branch.artifact, rebasedAfterPredecessorMerge: stamp } },
  });
}

/**
 * Whether the predecessor's implement PR merged: a lane branch already stamped, lane settlement
 * recorded the PR merged, a `merge` terminal action stamped success, or — the one `gh` probe, run
 * from the project checkout at a dependent dispatch, a dependent publication, or daemon start — the
 * recorded PR reads `MERGED`. No recorded PR means not merged; a probe error is a refusal.
 */
async function chainPredecessorMerged(
  git: ChainedLaneGitDeps,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  tip: ChainPredecessorTip,
  predecessor: string,
  cwd: string,
  stamped: boolean,
): Promise<boolean | ChainedLaneRefusal> {
  if (stamped || tip.artifact.lanePrOutcome?.kind === "lane_pr_merged") return true;
  const stamp = stageTerminalPublicationFromArtifact(tip.record.artifact);
  if (pipeline.definition.terminalAction === "merge" && stamp !== null && "succeededAt" in stamp) return true;
  if (tip.prNumber === undefined) return false;
  try {
    return (await git.supersedeGh.prState(cwd, tip.prNumber)).state === "MERGED";
  } catch (error) {
    return {
      ok: false,
      reason: "merge_probe_failed",
      message: `predecessor lane "${predecessor}" merge state unknown: gh pr view #${tip.prNumber} in ${cwd} failed: ${errorText(error)}`,
    };
  }
}

type LaneBranchRebase = { ok: true } | { ok: false; reason: ChainedLaneRefusalReason; detail: string };

function isRemoteRefMissing(error: unknown): boolean {
  const text = error instanceof AsyncSubprocessError ? `${error.message}\n${error.stderr}` : errorText(error);
  return /couldn't find remote ref|remote ref does not exist/i.test(text);
}

/** Local HEAD must equal the fetched remote tip before the branch is rewritten; that tip is the push lease. */
async function fetchedRemoteTipMatchingHead(
  runner: AsyncSubprocessRunner,
  lane: LaneBranch,
): Promise<{ ok: true; remoteTip: string } | { ok: false; reason: ChainedLaneRefusalReason; detail: string }> {
  const cwd = lane.worktreePath;
  let remoteTip: string;
  try {
    await runner.runAsync("git", ["fetch", "origin", lane.branch], cwd, networkSubprocessOptions());
    remoteTip = (await runner.runAsync("git", ["rev-parse", "FETCH_HEAD"], cwd)).trim();
  } catch (error) {
    if (isRemoteRefMissing(error)) {
      return {
        ok: false,
        reason: "remote_missing",
        detail: `origin/${lane.branch} does not exist (never pushed, or deleted on merge)`,
      };
    }
    return { ok: false, reason: "fetch_failed", detail: `git fetch origin ${lane.branch} failed: ${errorText(error)}` };
  }
  const head = (await runner.runAsync("git", ["rev-parse", "HEAD"], cwd)).trim();
  if (head !== remoteTip) {
    return {
      ok: false,
      reason: "remote_diverged",
      detail: `origin/${lane.branch} is at ${remoteTip.slice(0, 12)} but local HEAD is at ${head.slice(0, 12)}; reconcile them by hand before the harness rebases`,
    };
  }
  return { ok: true, remoteTip };
}

/** `git merge-base --is-ancestor`: only exit 1 means not stacked; anything else is a refusal. */
async function branchStacksOnTip(
  runner: AsyncSubprocessRunner,
  lane: LaneBranch,
  tipRef: string,
): Promise<boolean | { ok: false; reason: "ancestry_check_failed"; detail: string }> {
  try {
    await runner.runAsync("git", ["merge-base", "--is-ancestor", tipRef, "HEAD"], lane.worktreePath);
    return true;
  } catch (error) {
    if (error instanceof AsyncSubprocessError && error.status === 1) return false;
    return {
      ok: false,
      reason: "ancestry_check_failed",
      detail: `git merge-base --is-ancestor ${tipRef} HEAD failed: ${errorText(error)}`,
    };
  }
}

/**
 * Rebase one lane worktree past the merged predecessor: a branch no longer stacked on the tip is
 * left alone; a dirty tree, a missing remote, and a remote that diverged from local HEAD each refuse
 * before anything is rewritten; then `git rebase --onto origin/<base> <tip>` (aborted on conflict, so
 * no partial rebase remains) and a lease push against the fetched remote tip.
 */
async function rebaseLaneBranch(
  runner: AsyncSubprocessRunner,
  lane: LaneBranch,
  tipRef: string,
  fetchBase: (baseRef: string) => Promise<LaneBranchRebase>,
): Promise<LaneBranchRebase> {
  const cwd = lane.worktreePath;
  const stacked = await branchStacksOnTip(runner, lane, tipRef);
  if (stacked !== true) return stacked === false ? { ok: true } : stacked;
  const dirty = await listDirtyWorktreePathsForStaleReset(cwd, runner);
  if (dirty.status !== "clean") {
    const detail = dirty.status === "dirty" ? `dirty paths: ${dirty.paths.join(", ") || "(unlisted)"}` : dirty.status;
    return { ok: false, reason: "dirty_worktree", detail: `worktree is not clean (${detail})` };
  }
  const remote = await fetchedRemoteTipMatchingHead(runner, lane);
  if (!remote.ok) return remote;
  const base = await fetchBase(lane.baseRef);
  if (!base.ok) return base;
  try {
    await runner.runAsync("git", ["rebase", "--onto", `origin/${lane.baseRef}`, tipRef], cwd);
  } catch (error) {
    await runner.runAsync("git", ["rebase", "--abort"], cwd).catch(() => undefined);
    return {
      ok: false,
      reason: "rebase_conflict",
      detail: `git rebase --onto origin/${lane.baseRef} ${tipRef.slice(0, 12)} conflicted and was aborted: ${errorText(error)}`,
    };
  }
  try {
    await runner.runAsync(
      "git",
      [
        "push",
        `--force-with-lease=refs/heads/${lane.branch}:${remote.remoteTip}`,
        "origin",
        `HEAD:refs/heads/${lane.branch}`,
      ],
      cwd,
      networkSubprocessOptions(),
    );
  } catch (error) {
    return {
      ok: false,
      reason: "push_rejected",
      detail: `lease push rejected after the local rebase: ${errorText(error)}`,
    };
  }
  return { ok: true };
}

/** `git fetch origin <base>` in the project checkout, once per distinct base per lane pass, only once a stacked branch needs it. */
function baseFetcher(runner: AsyncSubprocessRunner, cwd: string): (baseRef: string) => Promise<LaneBranchRebase> {
  const fetched = new Map<string, Promise<LaneBranchRebase>>();
  return (baseRef) => {
    let pending = fetched.get(baseRef);
    if (pending === undefined) {
      pending = runner
        .runAsync("git", ["fetch", "origin", baseRef], cwd, networkSubprocessOptions())
        .then((): LaneBranchRebase => ({ ok: true }))
        .catch(
          (error: unknown): LaneBranchRebase => ({
            ok: false,
            reason: "base_fetch_failed",
            detail: `git fetch origin ${baseRef} in ${cwd} failed: ${errorText(error)}`,
          }),
        );
      fetched.set(baseRef, pending);
    }
    return pending;
  };
}

type LaneRebaseScope = {
  /** Restrict to one stage's branch (publication: the publishing branch; sweep: the final one). */
  onlyStageId?: string;
  /** Resolve (and record) the predecessor fork SHA when unmerged: a dependent stage is about to fork. */
  forFork?: boolean;
  /** Sweep over a settled lane: a missing remote (deleted on merge) is stamped and skipped, not refused. */
  sweep?: boolean;
};

/**
 * Once the predecessor lane's implement PR merged, rebase the lane's not-yet-stamped succeeded
 * branches onto the default base so they stop carrying the predecessor's squash-merged commits;
 * each rebased row is stamped `rebasedAfterPredecessorMerge` so later passes short-circuit.
 * Unmerged with `forFork`: returns the recorded tip SHA to fork from. Any step failure refuses,
 * naming the predecessor.
 */
async function rebaseLaneAfterPredecessorMerge(
  git: ChainedLaneGitDeps,
  pipelineId: string,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  lane: string,
  predecessor: string,
  scope: LaneRebaseScope = {},
): Promise<ChainedLaneRebase> {
  const cwd = pipelineProjectCwd(pipeline);
  if (cwd === undefined) return { ok: true, merged: false };
  // Sibling walks admit the same lane concurrently (its own suffix task and its predecessor's
  // release); a rebase must never run twice on one worktree, so passes for a lane queue up and
  // each later one re-reads the rows its predecessor stamped.
  return serializedPerLane(`${pipelineId}:${lane}`, async () => {
    const fresh = git.store.loadPipeline(pipelineId) ?? pipeline;
    return rebaseLaneBranchesNow(git, pipelineId, fresh, split, lane, predecessor, cwd, scope);
  });
}

const laneRebaseQueue = new Map<string, Promise<unknown>>();

async function serializedPerLane<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prior = laneRebaseQueue.get(key) ?? Promise.resolve();
  const next = prior.then(task, task);
  laneRebaseQueue.set(key, next);
  try {
    return await next;
  } finally {
    if (laneRebaseQueue.get(key) === next) laneRebaseQueue.delete(key);
  }
}

async function rebaseLaneBranchesNow(
  git: ChainedLaneGitDeps,
  pipelineId: string,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  lane: string,
  predecessor: string,
  cwd: string,
  scope: LaneRebaseScope,
): Promise<ChainedLaneRebase> {
  const tip = chainPredecessorTip(git.store, pipeline, split, predecessor);
  if (tip === undefined) return { ok: true, merged: false };
  const { branches, stamped } = unrebasedLaneBranches(git.store, pipeline, split, lane, scope.onlyStageId);
  const merged = await chainPredecessorMerged(git, pipeline, tip, predecessor, cwd, stamped);
  if (merged !== true && merged !== false) return merged;
  if (!merged) {
    if (scope.forFork !== true) return { ok: true, merged: false };
    const sha = await recordPredecessorForkSha(git, pipelineId, tip, predecessor, cwd);
    return typeof sha === "string" ? { ok: true, merged: false, forkRef: sha } : sha;
  }
  // Rows dispatched before the SHA was recorded replay from the branch name; a retired name refuses by ancestry check.
  const tipRef = tip.sha ?? tip.run.branch;
  const pr = tip.prNumber === undefined ? "" : ` (#${tip.prNumber})`;
  const fetchBase = baseFetcher(git.runner, cwd);
  for (const branch of branches) {
    const result = await rebaseLaneBranch(git.runner, branch, tipRef, fetchBase);
    if (!result.ok && !(scope.sweep === true && result.reason === "remote_missing")) {
      return {
        ok: false,
        reason: result.reason,
        message: `predecessor lane "${predecessor}" merged${pr}; lane "${lane}" branch "${branch.branch}" (${branch.stageId}) in ${branch.worktreePath}: ${result.detail}`,
      };
    }
    stampLaneBranch(git.store, pipelineId, lane, branch, predecessor, tipRef);
  }
  return { ok: true, merged: true };
}

function withLaneForkRef(steps: AnyWorkflowStep[], forkRef: string | undefined): AnyWorkflowStep[] {
  if (forkRef === undefined) return steps;
  return steps.map((step) =>
    step.behavior === "write" ? ({ ...step, worktree: { ...step.worktree, forkRef } } as AnyWorkflowStep) : step,
  );
}

function splitStageRecord(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  splitPosition: number,
): PipelineStageRecord | undefined {
  return pipeline.stages.find(
    (record) => record.position === splitPosition && record.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
  );
}

/** Lane chain persisted at split admission; `undefined` keeps every lane concurrent (pre-chain splits). */
function persistedFanOutLaneChain(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
): FanOutLaneChain | undefined {
  return laneChainFromArtifact(splitStageRecord(pipeline, split.splitPosition)?.artifact);
}

/** Compute the lane chain from the split's ready-intents and persist it on the split artifact. */
function persistFanOutLaneChain(
  store: StateStore,
  pipelineId: string,
  definition: PipelineDefinition,
  splitPosition: number,
  downstreamInputs: readonly string[],
): void {
  const pipeline = store.loadPipeline(pipelineId);
  const record = pipeline ? splitStageRecord(pipeline, splitPosition) : undefined;
  const artifact = narrowPipelineStageArtifact(record?.artifact);
  const stageId = definition.stages[splitPosition]?.stageId;
  if (artifact === undefined || stageId === undefined) return;
  const worktreePath = store.loadRun(artifact.entryRunId)?.worktreePath ?? "";
  const chain = buildFanOutLaneChain(
    downstreamInputs.map(branchKeyFromDownstreamInput),
    downstreamInputs.map((path) => readLaneReadyIntent(worktreePath, path)),
  );
  store.updateStage({ pipelineId, stageId, patch: { artifact: { ...artifact, laneChain: persistLaneChain(chain) } } });
}

type ChainedLaneAdmission =
  | { kind: "stop" }
  | { kind: "dispatch"; forkRef?: string }
  | { kind: "refuse"; message: string };

/**
 * Hold a lane until its chain predecessor completes, settle it `skipped` once severed, else fork from
 * the recorded predecessor tip SHA — or, once the predecessor's PR merged, rebase the lane's open
 * branches and fork from the default base instead. A rebase refusal fails only the admitted stage, retryably.
 */
async function admitChainedLane(
  git: ChainedLaneGitDeps,
  pipelineId: string,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  chain: FanOutLaneChain,
  branchKey: string,
): Promise<ChainedLaneAdmission> {
  const { store } = git;
  const gate = fanOutLaneGate(pipeline, split, chain, branchKey);
  if (gate.kind === "held") return { kind: "stop" };
  if (gate.kind === "severed") {
    settleSeveredChainLanes(store, pipelineId, split, chain);
    return { kind: "stop" };
  }
  if (gate.predecessor === undefined) return { kind: "dispatch" };
  const rebase = await rebaseLaneAfterPredecessorMerge(git, pipelineId, pipeline, split, branchKey, gate.predecessor, {
    forFork: true,
  });
  if (!rebase.ok) return { kind: "refuse", message: rebase.message };
  if (rebase.merged) return { kind: "dispatch" };
  const forkRef = rebase.forkRef ?? fanOutLaneForkRef(store, pipeline, split, gate.predecessor);
  return forkRef === undefined ? { kind: "dispatch" } : { kind: "dispatch", forkRef };
}

/** Fail the admitted stage with the retryable rebase-refusal marker: the lane reopens via `pipeline resume`; successors stay held, not severed. */
function refuseChainedLaneStage(
  store: StateStore,
  pipelineId: string,
  stageId: string,
  branchKey: string,
  stageRecords: readonly PipelineStageRecord[],
  skipFromPosition: number,
  message: string,
): StageStepOutcome {
  store.updateStage({
    pipelineId,
    stageId,
    branchKey,
    patch: {
      status: "failed",
      endedAt: Date.now(),
      failureDetail: {
        ...buildStageFailureRecord("chained lane rebases onto its merged predecessor", message, true),
        code: CHAINED_LANE_REBASE_REFUSAL,
      },
    },
  });
  skipRemainingStages(store, pipelineId, stageRecords, skipFromPosition, branchKey);
  return "stop";
}

/** Chain predecessor of a dependent lane, or `undefined` for independent and head lanes. */
function chainPredecessorOf(chain: FanOutLaneChain | undefined, branchKey: string): string | undefined {
  const index = chain === undefined ? -1 : chain.dependent.indexOf(branchKey);
  return index > 0 ? chain?.dependent[index - 1] : undefined;
}

/** A complete lane's own published PR is no longer open (merged or closed): nothing to rebase, never a force push. */
async function laneOwnPrSettled(git: ChainedLaneGitDeps, final: PipelineStageRecord, cwd: string): Promise<boolean> {
  const artifact = narrowPipelineStageArtifact(final.artifact);
  if (artifact?.lanePrOutcome !== undefined) return true;
  if (artifact?.prNumber === undefined) return false;
  try {
    return (await git.supersedeGh.prState(cwd, artifact.prNumber)).state !== "OPEN";
  } catch {
    return false;
  }
}

/**
 * Daemon-start sweep: a complete dependent lane whose published branch still stacks on a predecessor
 * that merged while no dispatch or publication of the lane could observe it (a `ready` lane the
 * operator merged later) is rebased and lease-pushed here. A lane whose own PR already merged or
 * closed, or whose remote branch is gone, is stamped and left alone. Other refusals are not recorded:
 * the lane is settled, and the next daemon start retries until the branch is rebased or hand-rebased.
 */
async function rebaseCompletedDependentLanes(pipelineId: string, deps: TerminalSettlementDeps): Promise<void> {
  const pipeline = deps.store.loadPipeline(pipelineId);
  const split = pipeline ? findFanOutSplit(pipeline) : null;
  const chain = pipeline && split !== null ? persistedFanOutLaneChain(pipeline, split) : undefined;
  const cwd = pipeline ? pipelineProjectCwd(pipeline) : undefined;
  if (!pipeline || split === null || chain === undefined || cwd === undefined) return;
  const git = chainedLaneGitDeps(deps);
  for (const lane of chain.dependent) {
    const predecessor = chainPredecessorOf(chain, lane);
    if (predecessor === undefined || fanOutLaneProgress(pipeline, split, lane) !== "complete") continue;
    const final = finalSucceededWorkflowStageForBranch(pipeline, split.splitPosition, lane);
    const artifact = narrowPipelineStageArtifact(final?.artifact);
    if (final === undefined || artifact === undefined || laneRebaseStamp(artifact) !== undefined) continue;
    const { branches } = unrebasedLaneBranches(git.store, pipeline, split, lane, final.stageId);
    const branch = branches[0];
    if (branch === undefined) continue;
    if (await laneOwnPrSettled(git, final, cwd)) {
      stampLaneBranch(git.store, pipelineId, lane, branch, predecessor, "lane-pr-settled");
      continue;
    }
    const fresh = deps.store.loadPipeline(pipelineId) ?? pipeline;
    await rebaseLaneAfterPredecessorMerge(git, pipelineId, fresh, split, lane, predecessor, {
      onlyStageId: final.stageId,
      sweep: true,
    });
  }
}

/** Terminally skip every open row of a dependent lane whose chain predecessor failed or was rejected. */
function settleSeveredChainLanes(
  store: StateStore,
  pipelineId: string,
  split: FanOutSplit,
  chain: FanOutLaneChain,
): void {
  for (const lane of chain.dependent) {
    const pipeline = store.loadPipeline(pipelineId);
    if (!pipeline) return;
    const gate = fanOutLaneGate(pipeline, split, chain, lane);
    if (gate.kind !== "severed") continue;
    const failureDetail = buildStageFailureRecord(
      "chained predecessor lane completes",
      `predecessor lane "${gate.predecessor}" failed or was rejected; lane "${lane}" chains off it`,
      false,
    );
    for (const { record } of suffixStagesForBranch(pipeline, split.splitPosition, lane)) {
      if (record.status !== "pending" && record.status !== "awaiting") continue;
      store.updateStage({
        pipelineId,
        stageId: record.stageId,
        branchKey: lane,
        patch: { status: "skipped", skipProvenance: "terminal", endedAt: Date.now(), failureDetail },
        requiredStatus: record.status,
      });
    }
  }
}

/** A rejected gate may kill a chain predecessor: sever its dependent successors now. */
function settleSeveredLanesAfterDecision(store: StateStore, pipelineId: string): void {
  const pipeline = store.loadPipeline(pipelineId);
  const split = pipeline ? findFanOutSplit(pipeline) : null;
  const chain = pipeline && split !== null ? persistedFanOutLaneChain(pipeline, split) : undefined;
  if (split === null || chain === undefined) return;
  settleSeveredChainLanes(store, pipelineId, split, chain);
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

  // The chain is decided once, before any lane row exists: a split already admitted without it
  // (or re-read later from changed ready-intents) never re-sequences in flight.
  const admittedRows = store.loadPipeline(pipelineId)?.stages ?? [];
  if (!admittedRows.some((record) => record.position > splitPosition && seen.has(record.branchKey))) {
    persistFanOutLaneChain(store, pipelineId, definition, splitPosition, downstreamInputs);
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
        patch: { status: "skipped", skipProvenance: "terminal", endedAt: Date.now() },
      });
    }
  }
  return { ok: true, branchKeys };
}

export function buildBranchStageArtifacts(
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
    carryForwardArtifact(artifacts, stage.stageId, recordBranchKey, record?.artifact);
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
    patch: {
      status: "failed",
      endedAt: Date.now(),
      failureDetail: buildStageFailureRecord("approval boundary write settles a decidable status", message, true),
    },
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
    // Only an undispatched row is skippable. In the in-loop failure path the suffix is always
    // `pending`, but settlement-driven skipping can meet a row another settlement already
    // terminalized, and overwriting a `failed` row with `skipped` would erase its failureDetail.
    if (record.status !== "pending") continue;
    // biome-ignore format: mutation checkpoint requires this exact single-line writer
    store.updateStage({ pipelineId, stageId: record.stageId, branchKey, patch: { status: "skipped", skipProvenance: "provisional", endedAt: Date.now() } });
  }
}

/**
 * A stage this settlement just failed ends its branch: its suffix is skipped, exactly as an
 * in-loop stage failure does. Without this the suffix stays `pending`, so the pipeline derives
 * `failed` while `reopenFailedPipeline` refuses it as a malformed continuation.
 */
export function skipSuffixOfSettledFailures(
  store: StateStore,
  settledEntryRunIds: readonly string[],
  pipelineId?: string,
): void {
  if (settledEntryRunIds.length === 0) return;
  const settled = new Set(settledEntryRunIds);
  const pipelines =
    pipelineId === undefined
      ? store.listPipelines()
      : [store.loadPipeline(pipelineId)].filter((entry) => entry !== null);
  for (const pipeline of pipelines) {
    for (const record of pipeline.stages) {
      if (record.status !== "failed") continue;
      if (record.workflowInvocationId === null || !settled.has(record.workflowInvocationId)) continue;
      skipRemainingStages(store, pipeline.id, pipeline.stages, record.position + 1, record.branchKey);
    }
  }
}

function carryForwardArtifact(
  stageArtifacts: Map<string, PipelineStageArtifact>,
  stageId: string,
  branchKey: string,
  artifact: unknown,
): void {
  if (
    artifact !== null &&
    typeof artifact === "object" &&
    typeof (artifact as PipelineStageArtifact).entryRunId === "string" &&
    typeof (artifact as PipelineStageArtifact).specPath === "string"
  ) {
    stageArtifacts.set(stageArtifactKey(stageId, branchKey), artifact as PipelineStageArtifact);
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
    return admitFanOutBranches(store, pipelineId, definition, index, typed.downstreamInputs);
  }
  return null;
}

type StageStepOutcome = "continue" | "stop";

/**
 * Scoped to a single `runPipeline` call — never durable, never shared across separate
 * continuations. Two kinds of entry share this one map, distinguished by key shape:
 *  - stage-admission claims, keyed by bare `stageId`: whichever concurrently-running sibling
 *    branch first reaches a shared fan-out stage's resolution claims it and admits + dispatches
 *    every branch; every other branch racing to the same stage awaits the claim instead of
 *    re-admitting or re-dispatching.
 *  - row-settlement claims, keyed by `stageArtifactKey(stageId, branchKey)`: whichever caller
 *    first adopts a `running` row's live linked entry run claims it, so a branch's own walk and
 *    a peer's fan-out dispatch loop can never both call `wait()` and write a terminal patch for
 *    the same row.
 * In both cases the check-and-set is synchronous (no `await` between `get` and `set`), so exactly
 * one caller wins regardless of scheduling order.
 */
type PipelineDispatchClaims = Map<string, Promise<void>>;

/** An in-flight peer's claim to await, or a fresh claim this caller now owns and must release. */
type DispatchClaim = { existing: Promise<void> } | { release: () => void };

/** First-caller-wins claim acquisition: synchronous check-and-set, so exactly one caller gets `release`. */
function acquireDispatchClaim(claims: PipelineDispatchClaims, claimKey: string): DispatchClaim {
  const existingClaim = claims.get(claimKey);
  if (existingClaim !== undefined) return { existing: existingClaim };
  let releaseClaim!: () => void;
  claims.set(
    claimKey,
    new Promise<void>((resolve) => {
      releaseClaim = resolve;
    }),
  );
  return { release: releaseClaim };
}

/** Run `perform` under the first-caller-wins claim for `claimKey`; later callers await it instead of repeating the work. */
async function withDispatchClaim(
  claims: PipelineDispatchClaims,
  claimKey: string,
  perform: () => Promise<void>,
): Promise<void> {
  const claim = acquireDispatchClaim(claims, claimKey);
  if ("existing" in claim) {
    await claim.existing;
    return;
  }
  try {
    await perform();
  } finally {
    claim.release();
  }
}

type AdvanceWorkflowStageArgs = {
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
  dispatchClaims: PipelineDispatchClaims;
  peerClaimTimeoutMs: number;
  loadLogRecords?: (entryRunId: string) => PersistedRecord[];
  isEntryRunLive?: PipelineExecutionDeps["isEntryRunLive"];
  staleResetPreflight?: PipelineExecutionDeps["staleResetPreflight"];
  reopenedStageReset?: PipelineExecutionDeps["reopenedStageReset"];
  subprocessRunner?: AsyncSubprocessRunner;
  supersedeGh?: SupersedeGh;
  /** Fan-out lane chain for this pipeline invocation; absent before the split is admitted. */
  laneChain?: FanOutLaneChain;
};

function reopenedStageResetFlags(
  args: AdvanceWorkflowStageArgs,
  branchKey = args.branchKey,
): WorkflowStartResetFlags | undefined {
  const reset = args.reopenedStageReset;
  if (reset?.stageId !== args.stage.stageId || reset.branchKey !== branchKey) return undefined;
  return reset.flags;
}

const PLAN_HARNESS_DRAFT_DIR = ".jarvis-plan-stage";

function isHarnessDraftDirtPath(path: string): boolean {
  return path === PLAN_HARNESS_DRAFT_DIR || path.startsWith(`${PLAN_HARNESS_DRAFT_DIR}/`);
}

function writeStepWorktreePath(steps: readonly AnyWorkflowStep[]): string | undefined {
  const writeStep = steps.find((step) => step.behavior === "write");
  if (writeStep?.behavior !== "write" || writeStep.worktree?.git === false) return undefined;
  return getExternalWorktreePath(writeStep.worktree);
}

/** Failed-plan redraft must not dispatch until shared stale-reset preparation completes. */
function failedPlanRedraftRequiresStaleReset(
  stage: Extract<PipelineStage, { kind: "workflow" }>,
  resetFlags: WorkflowStartResetFlags | undefined,
): boolean {
  return stage.workflow === "plan" && resetFlags !== undefined;
}

type FailedPlanWorktreeDisposition = "retired-and-rematerialized from base" | "reused existing worktree";

type StaleResetWorkspaceOutcome = "reset" | "no-op" | "continue";

function failedPlanWorktreeDisposition(outcome: StaleResetWorkspaceOutcome): FailedPlanWorktreeDisposition {
  return outcome === "reset" ? "retired-and-rematerialized from base" : "reused existing worktree";
}

function emitFailedPlanResumeWorktreeDisposition(
  injection: PipelineExecutionDeps["staleResetPreflight"],
  disposition: FailedPlanWorktreeDisposition,
): void {
  injection?.io.stderr(`failed plan resume worktree disposition: ${disposition}\n`);
}

async function runPlanStageStaleResetPreflight(
  steps: readonly AnyWorkflowStep[],
  deps: CliDeps,
  io: Io,
  flags: WorkflowStartResetFlags,
  client: IpcClient,
  outcome: { status?: StaleResetWorkspaceOutcome },
): Promise<number | undefined> {
  const writeStep = steps.find((step) => step.behavior === "write");
  const worktree = writeStep?.behavior === "write" ? writeStep.worktree : undefined;
  const worktreePath = writeStepWorktreePath(steps);
  let resetFlags = flags;
  if (
    worktreePath !== undefined &&
    existsSync(worktreePath) &&
    worktree?.projectRoot !== undefined &&
    worktree.branchName !== undefined &&
    worktree.baseRef !== undefined
  ) {
    const runner = deps.subprocessRunner ?? realAsyncSubprocessRunner;
    const classification = await classifyNeverLandedLane(
      worktree.projectRoot,
      worktree.branchName,
      worktree.baseRef,
      runner,
    );
    if (classification.kind === "inconclusive") {
      // A failed probe is not proof of an empty lane: preserve the worktree and refuse before any reset.
      io.stderr(`${inconclusiveNeverLandedRefusal(classification.reason)}\n`);
      return 1;
    }
    if (classification.kind === "never-landed") {
      resetFlags = { ...flags, disposableLane: true };
    }
  }
  return maybeResetStaleWorkspace(
    "plan",
    { ok: true, steps: [...steps] },
    deps,
    io,
    resetFlags,
    client,
    undefined,
    (status) => {
      outcome.status = status;
    },
  );
}

export async function resolveFailedPlanDirtyGate(
  steps: readonly AnyWorkflowStep[],
  baseFlags: WorkflowStartResetFlags,
  runner = realAsyncSubprocessRunner,
): Promise<{ ok: true; flags: WorkflowStartResetFlags } | { ok: false; message: string }> {
  if (baseFlags.skipDirtyWorktreeGate) return { ok: true, flags: baseFlags };
  if (baseFlags.skipLandedCriteriaGate) {
    return { ok: true, flags: { ...baseFlags, skipDirtyWorktreeGate: true } };
  }
  const worktreePath = writeStepWorktreePath(steps);
  if (worktreePath === undefined || !existsSync(worktreePath)) return { ok: true, flags: baseFlags };
  const dirtyList = await listDirtyWorktreePathsForStaleReset(worktreePath, runner);
  if (dirtyList.status === "clean" || dirtyList.status === "not-git-repository") {
    return { ok: true, flags: baseFlags };
  }
  if (dirtyList.status === "error") {
    const detail = `could not list worktree changes (${dirtyList.message})`;
    return { ok: false, message: `Error: Cannot redraft failed plan stage: ${detail}` };
  }
  const operatorPaths = dirtyList.paths.filter((path) => !isHarnessDraftDirtPath(path));
  // Operator dirt is not auto-cleared: leave the dirty gate armed so shared stale-reset preflight
  // refuses and names the paths, preserving its documented landed-criteria-before-dirty ordering.
  if (operatorPaths.length > 0) return { ok: true, flags: baseFlags };
  return { ok: true, flags: { ...baseFlags, skipDirtyWorktreeGate: true } };
}

function stagedPlanIntentPath(steps: readonly AnyWorkflowStep[]): string | undefined {
  const worktreePath = writeStepWorktreePath(steps);
  if (worktreePath === undefined) return undefined;
  return resolve(worktreePath, PLAN_HARNESS_DRAFT_DIR, "intent.md");
}

function appendStagedPlanIntentPath(message: string, intentPath: string): string {
  return `${message}: ${intentPath}`;
}

const PLAN_STAGE_INTENT_REL = ".jarvis-plan-stage/intent.md";

function operatorBlockerMessageInIntentContent(content: string, intentPath: string): string | undefined {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const reservedMarker = "Artifact contract check failed:";
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== "## Blocker") continue;
    let end = lines.length;
    for (let next = index + 1; next < lines.length; next += 1) {
      if (/^##\s/.test(lines[next] ?? "")) {
        end = next;
        break;
      }
    }
    if (
      !lines
        .slice(index + 1, end)
        .join("\n")
        .trim()
        .startsWith(reservedMarker)
    ) {
      return appendStagedPlanIntentPath(
        "operator blocker: staged plan carries an operator-authored ## Blocker",
        intentPath,
      );
    }
    index = end - 1;
  }
  return undefined;
}

async function operatorBlockerCommittedOnBase(
  projectRoot: string,
  baseRef: string,
  intentPath: string,
  runner: AsyncSubprocessRunner,
): Promise<string | undefined> {
  try {
    const content = await runner.runAsync("git", ["show", `${baseRef}:${PLAN_STAGE_INTENT_REL}`], projectRoot);
    return operatorBlockerMessageInIntentContent(content, intentPath);
  } catch {
    return undefined;
  }
}

function stagedPlanOperatorBlocker(steps: readonly AnyWorkflowStep[]): string | undefined {
  const intentPath = stagedPlanIntentPath(steps);
  if (intentPath === undefined || !existsSync(intentPath)) return undefined;
  return operatorBlockerMessageInIntentContent(readFileSync(intentPath, "utf8"), intentPath);
}

/** Refusal for a failed-plan lane whose never-landed classification could not be established. */
export function inconclusiveNeverLandedRefusal(reason: string): string {
  return `Error: Cannot redraft failed plan stage: never-landed classification is inconclusive (${reason}); the lane is preserved. Re-run \`jarvis pipeline resume\` where \`gh\` is reachable (outside the agent sandbox), or hand-finish with \`jarvis cleanup --abandon <branch>\` after confirming no open PR.`;
}

function refusePlanOperatorBlockerMessage(
  blocker: string,
  args: AdvanceWorkflowStageArgs,
  capture: { message: string },
  probeOnly = false,
): { ok: false; message: string } {
  const message = `Error: Cannot redraft failed plan stage: ${blocker}`;
  capture.message += `${message}\n`;
  if (!probeOnly) args.staleResetPreflight?.io.stderr(`${message}\n`);
  return { ok: false, message };
}

function refuseReopenedPlanOperatorBlockerLocal(
  args: AdvanceWorkflowStageArgs,
  steps: readonly AnyWorkflowStep[],
  capture: { message: string },
  branchKey = args.branchKey,
  probeOnly = false,
): { ok: true } | { ok: false; message: string } {
  if (args.stage.workflow !== "plan" || reopenedStageResetFlags(args, branchKey) === undefined) return { ok: true };
  const blocker = stagedPlanOperatorBlocker(steps);
  if (blocker === undefined) return { ok: true };
  return refusePlanOperatorBlockerMessage(blocker, args, capture, probeOnly);
}

function planOperatorBlockerNeedsGitChecks(
  args: AdvanceWorkflowStageArgs,
  steps: readonly AnyWorkflowStep[],
  branchKey = args.branchKey,
): boolean {
  if (args.stage.workflow !== "plan" || reopenedStageResetFlags(args, branchKey) === undefined) return false;
  const writeStep = steps.find((step) => step.behavior === "write");
  const worktree = writeStep?.behavior === "write" ? writeStep.worktree : undefined;
  const worktreePath = writeStepWorktreePath(steps);
  return (
    worktreePath !== undefined &&
    existsSync(worktreePath) &&
    worktree?.projectRoot !== undefined &&
    worktree.branchName !== undefined &&
    worktree.baseRef !== undefined
  );
}

async function refuseReopenedPlanOperatorBlockerWithGit(
  args: AdvanceWorkflowStageArgs,
  steps: readonly AnyWorkflowStep[],
  capture: { message: string },
  _branchKey = args.branchKey,
  probeOnly = false,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const writeStep = steps.find((step) => step.behavior === "write");
  const worktree = writeStep?.behavior === "write" ? writeStep.worktree : undefined;
  const runner = args.staleResetPreflight?.cliDeps.subprocessRunner ?? realAsyncSubprocessRunner;
  const intentPath = stagedPlanIntentPath(steps);
  const worktreePath = writeStepWorktreePath(steps);

  if (
    worktreePath !== undefined &&
    existsSync(worktreePath) &&
    worktree?.projectRoot !== undefined &&
    worktree.baseRef !== undefined &&
    intentPath !== undefined
  ) {
    const baseBlocker = await operatorBlockerCommittedOnBase(
      worktree.projectRoot,
      worktree.baseRef,
      intentPath,
      runner,
    );
    if (baseBlocker !== undefined) {
      return refusePlanOperatorBlockerMessage(baseBlocker, args, capture, probeOnly);
    }
  }

  const blocker = stagedPlanOperatorBlocker(steps);
  if (blocker === undefined) return { ok: true };

  if (worktree?.projectRoot !== undefined && worktree.branchName !== undefined && worktree.baseRef !== undefined) {
    const classification = await classifyNeverLandedLane(
      worktree.projectRoot,
      worktree.branchName,
      worktree.baseRef,
      runner,
    );
    if (classification.kind === "never-landed") return { ok: true };
    if (classification.kind === "inconclusive") {
      // Keep the operator blocker armed on an unproven lane; name the probe failure, not the blocker.
      const message = inconclusiveNeverLandedRefusal(classification.reason);
      capture.message += `${message}\n`;
      if (!probeOnly) args.staleResetPreflight?.io.stderr(`${message}\n`);
      return { ok: false, message };
    }
  }

  return refusePlanOperatorBlockerMessage(blocker, args, capture, probeOnly);
}

export function stampPipelineDispatchSteps(
  steps: readonly AnyWorkflowStep[],
  configPath: string | undefined,
): AnyWorkflowStep[] {
  if (configPath === undefined) {
    throw new Error("Pipeline admission context is missing required 'configPath'");
  }
  return stampWorkflowStepsWithMachineConfig(steps, configPath);
}

function failWorkflowStageAt(
  store: StateStore,
  pipelineId: string,
  stageId: string,
  branchKey: string,
  stageRecords: readonly PipelineStageRecord[],
  skipFromPosition: number,
  message: string,
  retryable: boolean,
): StageStepOutcome {
  store.updateStage({
    pipelineId,
    stageId,
    branchKey,
    patch: {
      status: "failed",
      endedAt: Date.now(),
      failureDetail: buildStageFailureRecord("workflow stage resolves and dispatches", message, retryable),
    },
  });
  skipRemainingStages(store, pipelineId, stageRecords, skipFromPosition, branchKey);
  return "stop";
}

function hasPendingDefaultWorkflowStage(pipeline: Pipeline & { stages: PipelineStageRecord[] }): boolean {
  for (const { stage, record } of authoredStagesInPositionOrder(pipeline)) {
    if (record.branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY) continue;
    if (stage.kind === "workflow" && record.status === "pending") return true;
  }
  return false;
}

function failFirstPendingWorkflowStageOnContextError(
  store: StateStore,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  message: string,
): void {
  for (const { stage, record } of authoredStagesInPositionOrder(pipeline)) {
    if (record.branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY) continue;
    if (stage.kind !== "workflow" || record.status !== "pending") continue;
    failWorkflowStageAt(
      store,
      pipeline.id,
      stage.stageId,
      record.branchKey,
      pipeline.stages,
      record.position + 1,
      message,
      false,
    );
    return;
  }
}

function handlePersistedContextLoadFailure(
  store: StateStore,
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  message: string,
): void {
  if (hasPendingDefaultWorkflowStage(pipeline)) {
    failFirstPendingWorkflowStageOnContextError(store, pipeline, message);
    return;
  }
  if (!isPipelineSettlementPending(pipeline)) return;
  const terminalAction = pipeline.definition.terminalAction;
  if (!terminalAction) return;
  const split = findFanOutSplit(pipeline);
  if (split === null) {
    commitTerminalPublicationFailureSafely(store, {
      pipelineId: pipeline.id,
      terminalAction,
      failure: { operation: terminalAction, message },
    });
    return;
  }
  // Fan-out settlement stays pending until every lane is stamped, so stamp each owing lane.
  for (const branchKey of split.branchKeys) {
    if (!fanOutLaneOwesTerminalPublication(pipeline, split, branchKey)) continue;
    commitTerminalPublicationFailureSafely(store, {
      pipelineId: pipeline.id,
      terminalAction,
      failure: { operation: terminalAction, message },
      branchKey,
    });
  }
}

function handleSucceededWorkflowStage(args: {
  store: StateStore;
  pipelineId: string;
  definition: PipelineDefinition;
  stage: Extract<PipelineStage, { kind: "workflow" }>;
  index: number;
  branchKey: string;
  stageRecords: readonly PipelineStageRecord[];
  stageArtifacts: Map<string, PipelineStageArtifact>;
  artifact: unknown;
}): StageStepOutcome {
  carryForwardArtifact(args.stageArtifacts, args.stage.stageId, args.branchKey, args.artifact);
  const admission = maybeAdmitFanOutBranches(
    args.store,
    args.pipelineId,
    args.definition,
    args.index,
    args.branchKey,
    args.artifact,
  );
  if (admission !== null && !admission.ok) {
    return failWorkflowStageAt(
      args.store,
      args.pipelineId,
      args.stage.stageId,
      args.branchKey,
      args.stageRecords,
      args.index + 1,
      admission.error,
      false,
    );
  }
  return "continue";
}

function finishDispatchedWorkflowStage(args: {
  store: StateStore;
  pipelineId: string;
  definition: PipelineDefinition;
  stage: Extract<PipelineStage, { kind: "workflow" }>;
  index: number;
  branchKey: string;
  stageArtifacts: Map<string, PipelineStageArtifact>;
}): StageStepOutcome {
  const settled = args.store.loadPipeline(args.pipelineId);
  const settledRecords = settled?.stages ?? [];
  const settledRecord = settled ? findStageRecord(settledRecords, args.stage.stageId, args.branchKey) : undefined;
  if (settledRecord?.status !== "succeeded") {
    if (shouldStopForInFlightStageRow(args.store, settledRecord)) {
      return "stop";
    }
    skipRemainingStages(args.store, args.pipelineId, settledRecords, args.index + 1, args.branchKey);
    return "stop";
  }
  return handleSucceededWorkflowStage({
    store: args.store,
    pipelineId: args.pipelineId,
    definition: args.definition,
    stage: args.stage,
    index: args.index,
    branchKey: args.branchKey,
    stageRecords: settledRecords,
    stageArtifacts: args.stageArtifacts,
    artifact: settledRecord.artifact,
  });
}

function intentDownstreamInputsForFanOut(
  definition: PipelineDefinition,
  splitPosition: number,
  stageRecords: readonly PipelineStageRecord[],
): readonly string[] | undefined {
  const intentStage = definition.stages[splitPosition];
  if (intentStage === undefined) return undefined;
  const intentRecord = findStageRecord(stageRecords, intentStage.stageId, DEFAULT_PIPELINE_STAGE_BRANCH_KEY);
  const intentArtifact =
    intentRecord?.artifact !== null && typeof intentRecord?.artifact === "object"
      ? (intentRecord.artifact as PipelineStageArtifact)
      : undefined;
  return intentArtifact?.downstreamInputs;
}

/** Admit and dispatch every sibling branch for a shared fan-out stage resolution. Runs once per stage per pipeline invocation — the caller holds the claim for `stage.stageId`. */
async function performFanOutStageResolution(
  args: AdvanceWorkflowStageArgs,
  resolution: Extract<PipelineStageResolutionResult, { ok: true }> & { results: Array<{ steps: AnyWorkflowStep[] }> },
  stageRecords: readonly PipelineStageRecord[],
): Promise<StageStepOutcome> {
  const { pipelineId, definition, stage, index, branchKey, split, store } = args;
  const splitPosition = split?.splitPosition ?? index - 1;
  const downstreamInputs = intentDownstreamInputsForFanOut(definition, splitPosition, stageRecords);
  if (downstreamInputs === undefined || downstreamInputs.length < 2) {
    return failWorkflowStageAt(
      store,
      pipelineId,
      stage.stageId,
      branchKey,
      stageRecords,
      index + 1,
      "pipeline-stage-resolve: fan-out resolution missing downstreamInputs",
      false,
    );
  }

  const admission = admitFanOutBranches(store, pipelineId, definition, splitPosition, downstreamInputs);
  if (!admission.ok) {
    return failWorkflowStageAt(
      store,
      pipelineId,
      stage.stageId,
      branchKey,
      stageRecords,
      index + 1,
      admission.error,
      false,
    );
  }

  const pipeline = store.loadPipeline(pipelineId);
  const admittedSplit = pipeline ? findFanOutSplit(pipeline) : null;
  const laneChain = pipeline && admittedSplit !== null ? persistedFanOutLaneChain(pipeline, admittedSplit) : undefined;
  const currentBranchFailed = await advanceFanOutBranches(args, {
    branchKeys: admission.branchKeys,
    downstreamInputs,
    pipeline,
    loadedStages: pipeline?.stages ?? [],
    splitPosition,
    results: resolution.results,
    ...(pipeline && laneChain !== undefined && admittedSplit !== null
      ? {
          laneAdmission: (lane: string) =>
            admitChainedLane(
              chainedLaneGitDeps(args),
              pipelineId,
              store.loadPipeline(pipelineId) ?? pipeline,
              admittedSplit,
              laneChain,
              lane,
            ),
        }
      : {}),
  });
  return currentBranchFailed ? "stop" : "continue";
}

/**
 * Race a peer's in-flight claim against a real timer, never a busy-wait: the timer keeps the
 * event loop free to service other timers and I/O while suspended, and a peer that never
 * releases its claim rejects with a named timeout error instead of hanging forever.
 */
async function awaitBoundedPeerClaim(claim: Promise<void>, claimKey: string, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      claim,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `pipeline-stage-resolve: timed out after ${timeoutMs}ms waiting for a peer branch to settle fan-out stage "${claimKey}"`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Settle a losing branch's own row once its bounded wait on a peer's claim expires. A peer that
 * already dispatched and settled this row (the common case — the claimant dispatches every
 * admitted branch, this row included) is carried forward as a normal success; only a row the
 * peer never touched settles the named timeout failure.
 */
function settlePeerClaimTimeout(args: AdvanceWorkflowStageArgs, message: string): StageStepOutcome {
  const { store, pipelineId, definition, stage, index, branchKey, stageArtifacts } = args;
  const settled = store.loadPipeline(pipelineId);
  const settledRecords = settled?.stages ?? [];
  const settledRecord = settled ? findStageRecord(settledRecords, stage.stageId, branchKey) : undefined;
  if (settledRecord?.status === "succeeded") {
    return handleSucceededWorkflowStage({
      store,
      pipelineId,
      definition,
      stage,
      index,
      branchKey,
      stageRecords: settledRecords,
      stageArtifacts,
      artifact: settledRecord.artifact,
    });
  }
  return failWorkflowStageAt(store, pipelineId, stage.stageId, branchKey, settledRecords, index + 1, message, true);
}

/**
 * Every sibling branch's own suffix walk resolves the same shared fan-out stage (the fan-out
 * decision lives on the intent artifact, not the calling branchKey) — so concurrently-dispatched
 * siblings all reach here for the same `stage.stageId`. The first caller claims it via a
 * synchronous check-and-set on `dispatchClaims` (no `await` between the two, so exactly one
 * caller wins regardless of scheduling) and performs admission + dispatch for every branch. Any
 * later caller awaits that claim — a real `await` on the claimant's own promise, never a
 * busy-wait, and bounded by `peerClaimTimeoutMs` — then re-reads its own row to decide
 * continue/stop; it never re-admits or re-dispatches.
 */
async function advanceFanOutStageResolution(
  args: AdvanceWorkflowStageArgs,
  resolution: Extract<PipelineStageResolutionResult, { ok: true }> & { results: Array<{ steps: AnyWorkflowStep[] }> },
  stageRecords: readonly PipelineStageRecord[],
): Promise<StageStepOutcome> {
  const { pipelineId, definition, stage, index, branchKey, store, stageArtifacts, dispatchClaims, peerClaimTimeoutMs } =
    args;
  const claimKey = stage.stageId;
  const claim = acquireDispatchClaim(dispatchClaims, claimKey);
  if ("existing" in claim) {
    try {
      await awaitBoundedPeerClaim(claim.existing, claimKey, peerClaimTimeoutMs);
    } catch (error) {
      return settlePeerClaimTimeout(args, error instanceof Error ? error.message : String(error));
    }
    return finishDispatchedWorkflowStage({ store, pipelineId, definition, stage, index, branchKey, stageArtifacts });
  }

  try {
    return await performFanOutStageResolution(args, resolution, stageRecords);
  } finally {
    claim.release();
  }
}

/**
 * Walk every admitted fan-out branch; report whether the caller's own branch failed. A lane whose
 * snapshot row is already `succeeded` retries `reopenProvisionalSkippedStages` before skipping it, so
 * a reopen lost to a crash between a prior pass's success write and its own reopen call — or a success
 * written by any other path — self-heals on this pass instead of staying stranded forever.
 */
async function advanceFanOutBranches(
  args: AdvanceWorkflowStageArgs,
  opts: {
    branchKeys: readonly string[];
    downstreamInputs: readonly string[];
    pipeline: (Pipeline & { stages: PipelineStageRecord[] }) | null;
    loadedStages: readonly PipelineStageRecord[];
    splitPosition: number;
    results: readonly FanOutPlanResultEntry[];
    laneAdmission?: (branchKey: string) => Promise<ChainedLaneAdmission>;
  },
): Promise<boolean> {
  const { stage, branchKey, store, pipelineId, index } = args;
  type BoundLane = {
    targetBranchKey: string;
    targetRecord: PipelineStageRecord | undefined;
    branchResult: FanOutPlanResultEntry;
  };
  const bindingFailures: Array<{ targetBranchKey: string; error: string }> = [];
  const boundLanes: BoundLane[] = [];

  for (const targetBranchKey of opts.branchKeys) {
    const targetRecord = findStageRecord(opts.loadedStages, stage.stageId, targetBranchKey);
    if (targetRecord?.status === "succeeded") {
      // A crash between a prior pass's success write and its reopen call (or a success written by
      // some other path) must not strand the successor: retry the reopen on every pass that observes
      // this row already `succeeded`, not only the pass that settles it.
      store.reopenProvisionalSkippedStages({ pipelineId, branchKey: targetBranchKey });
      continue;
    }
    const binding = fanOutPlanResultForBranch(opts.downstreamInputs, opts.results, targetBranchKey);
    if (!binding.ok) {
      bindingFailures.push({ targetBranchKey, error: binding.error });
      continue;
    }
    boundLanes.push({ targetBranchKey, targetRecord, branchResult: binding.result });
  }

  if (bindingFailures.length > 0) {
    for (const failure of bindingFailures) {
      failWorkflowStageAt(
        store,
        pipelineId,
        stage.stageId,
        failure.targetBranchKey,
        opts.loadedStages,
        index + 1,
        failure.error,
        false,
      );
    }
    return bindingFailures.some((failure) => failure.targetBranchKey === branchKey);
  }

  const branchDispatchTasks = boundLanes.map(
    ({ targetBranchKey, targetRecord, branchResult }) =>
      async (): Promise<boolean> => {
        const acted = await runFanOutBranchAction(args, {
          targetBranchKey,
          targetRecord,
          pipeline: opts.pipeline,
          splitPosition: opts.splitPosition,
          steps: branchResult.steps,
          ...(opts.laneAdmission !== undefined ? { laneAdmission: opts.laneAdmission } : {}),
          ...(branchResult.runStaleResetPreflight !== undefined
            ? { runStaleResetPreflight: branchResult.runStaleResetPreflight }
            : {}),
          ...(branchResult.preflightCapture !== undefined ? { preflightCapture: branchResult.preflightCapture } : {}),
        });
        if (acted === "skip") return false;
        return settleFanOutBranch(args, targetBranchKey) && targetBranchKey === branchKey;
      },
  );
  const branchOutcomes = await runConcurrently(branchDispatchTasks);
  return branchOutcomes.some(Boolean);
}

/**
 * Adopt a branch's live linked entry run, or dispatch it when it has none. Returns `"skip"` when the
 * branch is not actionable this pass — a `running` row without live linkage, unsatisfied branch-suffix
 * predecessors, or no resolved steps.
 */
async function runFanOutBranchAction(
  args: AdvanceWorkflowStageArgs,
  opts: {
    targetBranchKey: string;
    targetRecord: PipelineStageRecord | undefined;
    pipeline: (Pipeline & { stages: PipelineStageRecord[] }) | null;
    splitPosition: number;
    steps: AnyWorkflowStep[] | undefined;
    runStaleResetPreflight?: StaleResetPreflight;
    preflightCapture?: { message: string };
    laneAdmission?: (branchKey: string) => Promise<ChainedLaneAdmission>;
  },
): Promise<"acted" | "skip"> {
  const { pipelineId, stage, index, split, store, dispatch, wait, loadLogRecords, isEntryRunLive, dispatchClaims } =
    args;
  const { targetBranchKey, targetRecord, pipeline } = opts;
  const stageTarget = { pipelineId, stageId: stage.stageId, branchKey: targetBranchKey };
  const stageRecords = store.loadPipeline(pipelineId)?.stages ?? [];

  const linkedEntryRun = settlementLinkedEntryRunId(store, targetRecord);
  if (linkedEntryRun !== undefined) {
    await adoptPipelineStageUnderAdmission({
      store,
      stageTarget,
      adopt: () =>
        withDispatchClaim(dispatchClaims, stageArtifactKey(stage.stageId, targetBranchKey), () =>
          adoptAndSettlePipelineStage({
            store,
            stageTarget,
            entryRunId: linkedEntryRun,
            wait,
            ...(loadLogRecords !== undefined ? { loadLogRecords } : {}),
            ...(isEntryRunLive !== undefined ? { isEntryRunLive } : {}),
          }),
        ),
    });
    return "acted";
  }
  if (targetRecord?.status === "running") return "acted";
  if (
    pipeline !== null &&
    targetRecord !== undefined &&
    !branchSuffixPredecessorsSatisfied(pipeline, targetRecord, split)
  ) {
    return "skip";
  }
  if (opts.steps === undefined) return "skip";
  const chainAdmission = (await opts.laneAdmission?.(targetBranchKey)) ?? { kind: "dispatch" };
  if (chainAdmission.kind === "stop") return "skip";
  if (chainAdmission.kind === "refuse") {
    refuseChainedLaneStage(
      store,
      pipelineId,
      stage.stageId,
      targetBranchKey,
      stageRecords,
      index + 1,
      chainAdmission.message,
    );
    return "acted";
  }
  const steps = withLaneForkRef(opts.steps, chainAdmission.forkRef);
  const preflightCapture = opts.preflightCapture ?? { message: "" };
  const blocker = planOperatorBlockerNeedsGitChecks(args, steps, targetBranchKey)
    ? await refuseReopenedPlanOperatorBlockerWithGit(args, steps, preflightCapture, targetBranchKey)
    : refuseReopenedPlanOperatorBlockerLocal(args, steps, preflightCapture, targetBranchKey);
  if (!blocker.ok) {
    failWorkflowStageAt(
      store,
      pipelineId,
      stage.stageId,
      targetBranchKey,
      stageRecords,
      index + 1,
      blocker.message,
      false,
    );
    return "acted";
  }
  const staleReset =
    args.staleResetPreflight === undefined
      ? { ok: true as const, disposition: undefined }
      : await runFailedPlanAwareStaleResetPreflight(
          args,
          steps,
          targetBranchKey,
          opts.runStaleResetPreflight ?? noopStaleResetPreflight,
          preflightCapture,
        );
  if (!staleReset.ok) {
    failWorkflowStageAt(
      store,
      pipelineId,
      stage.stageId,
      targetBranchKey,
      stageRecords,
      index + 1,
      staleReset.message,
      false,
    );
    return "acted";
  }
  if (staleReset.disposition !== undefined) {
    emitFailedPlanResumeWorktreeDisposition(args.staleResetPreflight, staleReset.disposition);
  }
  await dispatchPipelineStage({
    ...stageTarget,
    steps,
    dispatch,
    wait,
    store,
    ...(loadLogRecords !== undefined ? { loadLogRecords } : {}),
    ...(isEntryRunLive !== undefined ? { isEntryRunLive } : {}),
  });
  return "acted";
}

/**
 * Record one settled fan-out branch and report whether it failed. A branch still `running` against a
 * live entry run is left alone — its own settlement owns the terminal write — so later stages are not
 * skipped out from under it. The `succeeded` arm mutates: it reopens any provisional skips left on this
 * branch's suffix, so a successor skipped by an earlier non-`succeeded` settlement of this same stage
 * isn't stranded. `advanceFanOutBranches` repeats this same reopen call on every later pass that
 * observes the row already `succeeded`, so a reopen lost to a crash right after this write still lands.
 * Reopened rows dispatch only on the execution loop's next pass.
 */
function settleFanOutBranch(args: AdvanceWorkflowStageArgs, targetBranchKey: string): boolean {
  const { pipelineId, stage, index, stageArtifacts, store } = args;
  const settledRecord = findStageRecord(store.loadPipeline(pipelineId)?.stages ?? [], stage.stageId, targetBranchKey);
  if (settledRecord?.status === "succeeded") {
    carryForwardArtifact(stageArtifacts, stage.stageId, targetBranchKey, settledRecord.artifact);
    // `pipeline_not_found` is unreachable: settledRecord was just loaded from this same pipeline.
    store.reopenProvisionalSkippedStages({ pipelineId, branchKey: targetBranchKey });
    return false;
  }
  if (settledRecord?.status === "running" && settlementLinkedEntryRunId(store, settledRecord) !== undefined) {
    return true;
  }
  skipRemainingStages(store, pipelineId, store.loadPipeline(pipelineId)?.stages ?? [], index + 1, targetBranchKey);
  return true;
}

/** Adopt a `running` stage's live linked entry run and settle it without re-dispatching steps. */
async function adoptRunningWorkflowStage(
  args: AdvanceWorkflowStageArgs,
  entryRunId: string,
): Promise<StageStepOutcome> {
  const {
    pipelineId,
    definition,
    stage,
    index,
    branchKey,
    stageArtifacts,
    store,
    wait,
    loadLogRecords,
    isEntryRunLive,
    dispatchClaims,
  } = args;
  const stageTarget = { pipelineId, stageId: stage.stageId, branchKey };
  await adoptPipelineStageUnderAdmission({
    store,
    stageTarget,
    adopt: () =>
      withDispatchClaim(dispatchClaims, stageArtifactKey(stage.stageId, branchKey), () =>
        adoptAndSettlePipelineStage({
          store,
          stageTarget,
          entryRunId,
          wait,
          ...(loadLogRecords !== undefined ? { loadLogRecords } : {}),
          ...(isEntryRunLive !== undefined ? { isEntryRunLive } : {}),
        }),
      ),
  });
  return finishDispatchedWorkflowStage({
    store,
    pipelineId,
    definition,
    stage,
    index,
    branchKey,
    stageArtifacts,
  });
}

async function runSharedStaleResetPreflight(
  runStaleResetPreflight: StaleResetPreflight,
  injection: PipelineExecutionDeps["staleResetPreflight"],
  captured: { message: string },
  failClosed = false,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (injection === undefined) return { ok: true };
  let client: IpcClient;
  try {
    client = await injection.connectClient();
  } catch (error) {
    const connectMessage = `could not open daemon control socket: ${
      error instanceof Error ? error.message : String(error)
    }`;
    injection.io.stderr(`pipeline stale-reset preflight skipped: ${connectMessage}\n`);
    return failClosed ? { ok: false, message: captured.message.trim() || connectMessage } : { ok: true };
  }
  let exitCode: number | undefined;
  try {
    exitCode = await runStaleResetPreflight(client);
  } finally {
    client.close();
  }
  if (exitCode !== undefined) {
    return { ok: false, message: captured.message.trim() || "Stale workspace reset failed" };
  }
  return { ok: true };
}

async function runFailedPlanAwareStaleResetPreflight(
  args: AdvanceWorkflowStageArgs,
  steps: readonly AnyWorkflowStep[],
  branchKey: string,
  basePreflight: StaleResetPreflight,
  preflightCapture: { message: string },
): Promise<{ ok: true; disposition?: FailedPlanWorktreeDisposition } | { ok: false; message: string }> {
  const injection = args.staleResetPreflight;
  if (injection === undefined) return { ok: true };
  const resetFlags = reopenedStageResetFlags(args, branchKey);
  if (args.stage.workflow !== "plan" || resetFlags === undefined) {
    const result = await runSharedStaleResetPreflight(
      basePreflight,
      injection,
      preflightCapture,
      failedPlanRedraftRequiresStaleReset(args.stage, resetFlags),
    );
    return result.ok ? { ok: true } : result;
  }
  const runner = injection.cliDeps.subprocessRunner ?? realAsyncSubprocessRunner;
  const dirtyGate = await resolveFailedPlanDirtyGate(steps, resetFlags, runner);
  if (!dirtyGate.ok) {
    injection.io.stderr(`${dirtyGate.message}\n`);
    return dirtyGate;
  }
  const outcomeCapture: { status?: StaleResetWorkspaceOutcome } = {};
  const preflightIo: Io = {
    stdout: injection.io.stdout,
    stderr: (text: string) => {
      preflightCapture.message += text;
      injection.io.stderr(text);
    },
  };
  const staleResetRunner = async (client: IpcClient) =>
    runPlanStageStaleResetPreflight(steps, injection.cliDeps, preflightIo, dirtyGate.flags, client, outcomeCapture);
  const result = await runSharedStaleResetPreflight(
    staleResetRunner,
    injection,
    preflightCapture,
    failedPlanRedraftRequiresStaleReset(args.stage, resetFlags),
  );
  if (!result.ok) return result;
  const disposition =
    outcomeCapture.status === undefined ? undefined : failedPlanWorktreeDisposition(outcomeCapture.status);
  return disposition === undefined ? { ok: true } : { ok: true, disposition };
}

/**
 * Resolve and dispatch (or carry forward) one workflow stage. Re-reads the stage's row first,
 * so an already-`running`/settled stage is never re-dispatched — this guards a second loop
 * instance for the same pipeline, though the daemon only ever starts one per `pipeline_start`
 * call. A resolution failure or a dispatched stage settling non-`succeeded` writes `skipped`
 * to every later stage and stops the loop; no dispatch reaches them.
 */
/**
 * Chained fan-out lane admission for one branch workflow stage: hold until the chain predecessor
 * completes, settle the lane `skipped` once it is severed, else fork from the predecessor branch.
 */
async function admitChainedLaneStage(
  args: AdvanceWorkflowStageArgs,
  current: (Pipeline & { stages: PipelineStageRecord[] }) | null,
): Promise<ChainedLaneAdmission> {
  const { split, branchKey, laneChain, pipelineId } = args;
  if (split === null || laneChain === undefined || current === null) return { kind: "dispatch" };
  if (branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY) return { kind: "dispatch" };
  return admitChainedLane(chainedLaneGitDeps(args), pipelineId, current, split, laneChain, branchKey);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: linear stage-advance orchestration; the intent-stage stale-reset preflight adds one guarded branch and extracting it would fragment the single dispatch flow
async function advanceWorkflowStage(args: AdvanceWorkflowStageArgs): Promise<StageStepOutcome> {
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
    loadLogRecords,
    isEntryRunLive,
  } = args;

  try {
    const current = store.loadPipeline(pipelineId);
    const stageRecords = current?.stages ?? [];
    const record = current ? findStageRecord(stageRecords, stage.stageId, branchKey) : undefined;

    if (record?.status === "succeeded") {
      return handleSucceededWorkflowStage({
        store,
        pipelineId,
        definition,
        stage,
        index,
        branchKey,
        stageRecords,
        stageArtifacts,
        artifact: record.artifact,
      });
    }
    if (record?.status === "running") {
      const entryRunId = settlementLinkedEntryRunId(store, record);
      if (entryRunId === undefined) return "stop";
      return await adoptRunningWorkflowStage(args, entryRunId);
    }
    if (record?.status === "failed") return "stop";
    if (record?.status === "skipped") return "continue";

    const chainAdmission = await admitChainedLaneStage(args, current);
    if (chainAdmission.kind === "stop") return "stop";
    if (chainAdmission.kind === "refuse") {
      return refuseChainedLaneStage(
        store,
        pipelineId,
        stage.stageId,
        branchKey,
        stageRecords,
        index + 1,
        chainAdmission.message,
      );
    }

    const preflightCapture = { message: "" };
    const resetFlags = reopenedStageResetFlags(args);
    const staleResetForResolve =
      args.staleResetPreflight === undefined
        ? undefined
        : capturingStaleReset(
            {
              deps: args.staleResetPreflight.cliDeps,
              io: args.staleResetPreflight.io,
              ...(resetFlags !== undefined ? { flags: resetFlags } : {}),
            },
            preflightCapture,
          );
    const resolution = await resolveStage(definition, index, context, stageArtifacts, {
      loadRun: (runId) => {
        const entryRun = store.loadRun(runId);
        return entryRun === null ? null : { worktreePath: entryRun.worktreePath, branch: entryRun.branch };
      },
      branchKey,
      ...(split !== null ? { splitPosition: split.splitPosition } : {}),
      ...(staleResetForResolve !== undefined ? { staleReset: staleResetForResolve } : {}),
    });
    if (!resolution.ok) {
      return failWorkflowStageAt(
        store,
        pipelineId,
        stage.stageId,
        branchKey,
        stageRecords,
        index + 1,
        resolution.error,
        false,
      );
    }

    if (isFanOutStageResolution(resolution)) {
      return advanceFanOutStageResolution(args, resolution, stageRecords);
    }

    const resolvedSteps = withLaneForkRef(singleStageResolutionSteps(resolution), chainAdmission.forkRef);
    const blocker = planOperatorBlockerNeedsGitChecks(args, resolvedSteps, branchKey)
      ? await refuseReopenedPlanOperatorBlockerWithGit(args, resolvedSteps, preflightCapture, branchKey)
      : refuseReopenedPlanOperatorBlockerLocal(args, resolvedSteps, preflightCapture, branchKey);
    if (!blocker.ok) {
      return failWorkflowStageAt(
        store,
        pipelineId,
        stage.stageId,
        branchKey,
        stageRecords,
        index + 1,
        blocker.message,
        false,
      );
    }
    const staleReset =
      args.staleResetPreflight === undefined
        ? { ok: true as const, disposition: undefined }
        : await runFailedPlanAwareStaleResetPreflight(
            args,
            resolvedSteps,
            branchKey,
            resolution.runStaleResetPreflight ?? noopStaleResetPreflight,
            preflightCapture,
          );
    if (!staleReset.ok) {
      return failWorkflowStageAt(
        store,
        pipelineId,
        stage.stageId,
        branchKey,
        stageRecords,
        index + 1,
        staleReset.message,
        false,
      );
    }
    if (staleReset.disposition !== undefined) {
      emitFailedPlanResumeWorktreeDisposition(args.staleResetPreflight, staleReset.disposition);
    }

    await dispatchPipelineStage({
      pipelineId,
      stageId: stage.stageId,
      branchKey,
      steps: resolvedSteps,
      dispatch,
      wait,
      store,
      ...(loadLogRecords !== undefined ? { loadLogRecords } : {}),
      ...(isEntryRunLive !== undefined ? { isEntryRunLive } : {}),
    });
    return finishDispatchedWorkflowStage({
      store,
      pipelineId,
      definition,
      stage,
      index,
      branchKey,
      stageArtifacts,
    });
  } catch (error) {
    const afterThrow = store.loadPipeline(pipelineId);
    const afterThrowRecords = afterThrow?.stages ?? [];
    const afterThrowRecord = afterThrow ? findStageRecord(afterThrowRecords, stage.stageId, branchKey) : undefined;
    if (afterThrowRecord?.status === "running" && settlementLinkedEntryRunId(store, afterThrowRecord) !== undefined) {
      return "stop";
    }
    try {
      store.updateStage({
        pipelineId,
        stageId: stage.stageId,
        branchKey,
        patch: {
          status: "failed",
          endedAt: Date.now(),
          failureDetail: buildStageFailureRecord("stage execution completes without an unexpected throw", error, true),
        },
      });
    } catch {
      // The store itself is unreachable; nothing further can be recorded.
    }
    skipRemainingStages(store, pipelineId, afterThrowRecords, index + 1, branchKey);
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
  const detail = buildStageFailureRecord("pipeline stage advance completes without an unexpected throw", error, true);
  for (const stageRecord of pipeline.stages) {
    const authored = definition.stages[stageRecord.position];
    if (authored?.kind !== "workflow") continue;
    const record = findStageRecord(pipeline.stages, stageRecord.stageId, stageRecord.branchKey);
    if (record?.status !== "pending" && record?.status !== "running") continue;
    if (record?.status === "running" && settlementLinkedEntryRunId(store, record) !== undefined) {
      continue;
    }
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

/**
 * Run lazy dispatch thunks concurrently, returning each settled value in call order. Every
 * task completes before this resolves — a rejection from one does not stop or detach the
 * others — and rejections are aggregated into one thrown error rather than surfacing only the
 * first, so a sibling branch's failure can never leave another branch's walk running past
 * settlement.
 */
async function runConcurrently<T>(tasks: ReadonlyArray<() => Promise<T>>): Promise<T[]> {
  const settled = await Promise.allSettled(tasks.map((task) => task()));
  const rejections = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  if (rejections.length > 0) {
    throw new AggregateError(
      rejections.map((entry) => entry.reason as unknown),
      `${rejections.length} of ${tasks.length} concurrent dispatch task(s) failed`,
    );
  }
  return settled.map((entry) => (entry as PromiseFulfilledResult<T>).value);
}

type RunAuthoredStagesArgs = {
  pipelineId: string;
  deps: PipelineExecutionDeps;
  split: FanOutSplit | null;
  branchKey: string;
  fromIndex: number;
  toIndex: number;
  dispatchClaims: PipelineDispatchClaims;
  sharedStageArtifacts?: Map<string, PipelineStageArtifact>;
  laneChain?: FanOutLaneChain;
};

/** Walk one stage range, then — for a fan-out lane — release the chained lanes its settlement unblocks. */
async function runAuthoredStages(args: RunAuthoredStagesArgs): Promise<void> {
  await walkAuthoredStages(args);
  await releaseChainedSuccessorLanes(args);
}

/** A lane that just settled severs dead-predecessor successors and walks each successor it opened. */
async function releaseChainedSuccessorLanes(args: RunAuthoredStagesArgs): Promise<void> {
  const { pipelineId, deps, split, branchKey, laneChain } = args;
  if (split === null || laneChain === undefined || branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY) return;
  settleSeveredChainLanes(deps.store, pipelineId, split, laneChain);
  for (const successor of laneChainSuccessors(laneChain, branchKey)) {
    const pipeline = deps.store.loadPipeline(pipelineId);
    if (!pipeline || fanOutLaneGate(pipeline, split, laneChain, successor).kind !== "open") continue;
    if (fanOutLaneProgress(pipeline, split, successor) !== "open") continue;
    await runAuthoredStages({ ...args, branchKey: successor });
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential authored-stage loop; the intent-stage stale-reset preflight adds one guarded branch and extracting it would fragment the loop body
async function walkAuthoredStages(args: RunAuthoredStagesArgs): Promise<void> {
  const { pipelineId, deps, split, branchKey, fromIndex, toIndex, dispatchClaims, sharedStageArtifacts, laneChain } =
    args;
  const { store, dispatch, wait, context } = deps;
  const resolveStage = deps.resolveStage ?? resolveStageWorkflowSteps;
  const peerClaimTimeoutMs = deps.peerClaimTimeoutMs ?? DEFAULT_PEER_CLAIM_TIMEOUT_MS;
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) return;
  const definition = pipeline.definition;

  for (let index = fromIndex; index <= toIndex; index += 1) {
    const stage = definition.stages[index];
    if (stage === undefined) continue;
    const stageRecord = findStageRecord(pipeline.stages, stage.stageId, branchKey);
    if (stageRecord === undefined) continue;
    if (
      branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY &&
      (stageRecord.status === "failed" || stageRecord.status === "skipped")
    ) {
      return;
    }

    const stageArtifacts =
      sharedStageArtifacts ??
      (split !== null ? buildBranchStageArtifacts(pipeline, split, branchKey, index) : new Map());

    const outcome =
      stage.kind === "approval"
        ? advanceApprovalStage({ pipelineId, stageRecord, store })
        : await advanceWorkflowStage({
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
            dispatchClaims,
            peerClaimTimeoutMs,
            ...(deps.loadLogRecords !== undefined ? { loadLogRecords: deps.loadLogRecords } : {}),
            ...(deps.isEntryRunLive !== undefined ? { isEntryRunLive: deps.isEntryRunLive } : {}),
            ...(deps.staleResetPreflight !== undefined ? { staleResetPreflight: deps.staleResetPreflight } : {}),
            ...(deps.reopenedStageReset !== undefined ? { reopenedStageReset: deps.reopenedStageReset } : {}),
            ...(deps.subprocessRunner !== undefined ? { subprocessRunner: deps.subprocessRunner } : {}),
            ...(deps.supersedeGh !== undefined ? { supersedeGh: deps.supersedeGh } : {}),
            ...(laneChain !== undefined ? { laneChain } : {}),
          });
    if (outcome === "stop") return;
    pipeline.stages = store.loadPipeline(pipelineId)?.stages ?? pipeline.stages;
  }

  if (split !== null && branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY) {
    await settlePipelineTerminalPublication(pipelineId, deps, branchKey);
  }
}

/**
 * Walk a pipeline's authored stages in order, resolving and dispatching each workflow stage
 * only once the immediately preceding workflow stage's row reads `succeeded`. An approval
 * stage records or honors its durable status (`pending` → `awaiting`, block at `awaiting`,
 * continue past `approved`, stop at `rejected`) with no dispatch to later stages.
 */
export async function runPipeline(
  pipelineId: string,
  deps: PipelineExecutionDeps,
  continuationBranchKey?: string,
): Promise<void> {
  continuationBranchKey = normalizeContinuationBranchKey(continuationBranchKey);
  const { store } = deps;
  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) return;

  if (pipeline.context === null) {
    handlePersistedContextLoadFailure(store, pipeline, "pipeline-context-loader: missing pipeline admission context");
    return;
  }
  const loadedContext = loadPipelineContext(pipeline.context);
  if (!loadedContext.ok) {
    handlePersistedContextLoadFailure(
      store,
      pipeline,
      `pipeline-context-loader: ${loadedContext.error.errors.join("; ")}`,
    );
    return;
  }

  const definition = pipeline.definition;
  const executionDeps: PipelineExecutionDeps = { ...deps, context: loadedContext.context };
  const stageArtifacts = new Map<string, PipelineStageArtifact>();
  const dispatchClaims: PipelineDispatchClaims = new Map();

  try {
    const initialSplit = findFanOutSplit(pipeline);
    if (continuationBranchKey === undefined) {
      await runAuthoredStages({
        pipelineId,
        deps: executionDeps,
        split: initialSplit,
        branchKey: DEFAULT_PIPELINE_STAGE_BRANCH_KEY,
        fromIndex: 0,
        toIndex: initialSplit?.splitPosition ?? definition.stages.length - 1,
        dispatchClaims,
        sharedStageArtifacts: stageArtifacts,
      });
    }
    const activePipeline = store.loadPipeline(pipelineId) ?? pipeline;
    const activeSplit = findFanOutSplit(activePipeline) ?? initialSplit;
    if (activeSplit !== null) {
      const lastIndex = definition.stages.length - 1;
      const laneChain = persistedFanOutLaneChain(activePipeline, activeSplit);
      if (laneChain !== undefined) settleSeveredChainLanes(store, pipelineId, activeSplit, laneChain);
      const suffixBranchKeys = continuationBranchKey !== undefined ? [continuationBranchKey] : activeSplit.branchKeys;
      const suffixDispatchTasks = suffixBranchKeys.map(
        (branchKey) => () =>
          runAuthoredStages({
            pipelineId,
            deps: executionDeps,
            split: activeSplit,
            branchKey,
            fromIndex: activeSplit.splitPosition + 1,
            toIndex: lastIndex,
            dispatchClaims,
            ...(laneChain !== undefined ? { laneChain } : {}),
          }),
      );
      await runConcurrently(suffixDispatchTasks);
    }

    await settlePipelineTerminalPublication(pipelineId, executionDeps);
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

function deriveFanOutPrefixState(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
): PipelineDerivedState | null {
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
  return null;
}

type FanOutBranchSuffixAggregation = {
  anyRejected: boolean;
  anyFailed: boolean;
  anyRunning: boolean;
  anyActionableAwaiting: boolean;
  anyActionablePending: boolean;
  branchComplete: boolean;
};

type FanOutSuffixAggregation = Omit<FanOutBranchSuffixAggregation, "branchComplete"> & {
  allBranchesComplete: boolean;
};

type FanOutBranchSuffixTallies = {
  anyRejected: boolean;
  anyFailed: boolean;
  anyRunning: boolean;
  branchComplete: boolean;
};

function tallyFanOutBranchSuffixStatuses(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  branchKey: string,
): FanOutBranchSuffixTallies {
  let anyRejected = false;
  let anyFailed = false;
  let anyRunning = false;
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
    if (!isAuthoredStageSatisfied(stage, record)) branchComplete = false;
  }

  return { anyRejected, anyFailed, anyRunning, branchComplete };
}

/** First reachable unsatisfied suffix stage: is it an actionable awaiting gate or an actionable pending stage? */
function scanFirstActionableFanOutSuffixStage(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  branchKey: string,
): { anyActionableAwaiting: boolean; anyActionablePending: boolean } {
  for (const { stage, record } of suffixStagesForBranch(pipeline, split.splitPosition, branchKey)) {
    if (record.status === "skipped") continue;
    if (isAuthoredStageSatisfied(stage, record)) continue;
    if (!branchSuffixPredecessorsSatisfied(pipeline, record, split)) break;
    if (stage.kind === "approval" && (record.status === "awaiting" || record.status === "pending")) {
      return { anyActionableAwaiting: true, anyActionablePending: false };
    }
    if (record.status === "pending") {
      return { anyActionableAwaiting: false, anyActionablePending: true };
    }
    break;
  }
  return { anyActionableAwaiting: false, anyActionablePending: false };
}

function aggregateFanOutBranchSuffix(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
  branchKey: string,
): FanOutBranchSuffixAggregation {
  const { anyRejected, anyFailed, anyRunning, branchComplete } = tallyFanOutBranchSuffixStatuses(
    pipeline,
    split,
    branchKey,
  );
  let anyActionableAwaiting = false;
  let anyActionablePending = false;

  if (!(anyRejected || anyFailed)) {
    const actionable = scanFirstActionableFanOutSuffixStage(pipeline, split, branchKey);
    anyActionableAwaiting = actionable.anyActionableAwaiting;
    anyActionablePending = actionable.anyActionablePending;
  }

  return {
    anyRejected,
    anyFailed,
    anyRunning,
    anyActionableAwaiting,
    anyActionablePending,
    branchComplete,
  };
}

function aggregateFanOutSuffixBranches(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
): FanOutSuffixAggregation {
  let anyRejected = false;
  let anyFailed = false;
  let anyRunning = false;
  let anyActionableAwaiting = false;
  let anyActionablePending = false;
  let allBranchesComplete = true;

  for (const branchKey of split.branchKeys) {
    const branch = aggregateFanOutBranchSuffix(pipeline, split, branchKey);
    if (branch.anyRejected) anyRejected = true;
    if (branch.anyFailed) anyFailed = true;
    if (branch.anyRunning) anyRunning = true;
    if (branch.anyActionableAwaiting) anyActionableAwaiting = true;
    if (branch.anyActionablePending) anyActionablePending = true;
    if (!branch.branchComplete) allBranchesComplete = false;
  }

  return {
    anyRejected,
    anyFailed,
    anyRunning,
    anyActionableAwaiting,
    anyActionablePending,
    allBranchesComplete,
  };
}

function deriveFanOutSuffixState(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  aggregation: FanOutSuffixAggregation,
): PipelineDerivedState {
  if (aggregation.anyRunning) return "running";
  if (aggregation.anyActionableAwaiting) return "awaiting-approval";
  if (aggregation.anyActionablePending) return "pending";
  if (aggregation.anyRejected) return "rejected";
  if (aggregation.anyFailed) return "failed";
  if (!aggregation.allBranchesComplete) return "pending";
  if (isPipelineSettlementPending(pipeline)) return "running";
  if (terminalPublicationFailureForcesPipelineFailed(pipeline)) return "failed";
  return "succeeded";
}

/**
 * Fan-out suffix state: settlement-first aggregation on actionable signals — live `running`,
 * reachable `awaiting-approval`/`pending`, then terminal `rejected`/`failed` only after every
 * branch has settled (rejected-before-failed at full settlement). Prefix stages use the linear
 * walk (`interrupted`, `rejected`, `failed`, `running`, `awaiting-approval`/`pending`).
 */
function deriveFanOutPipelineState(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  split: FanOutSplit,
): PipelineDerivedState {
  const prefixState = deriveFanOutPrefixState(pipeline, split);
  if (prefixState !== null) return prefixState;
  return deriveFanOutSuffixState(pipeline, aggregateFanOutSuffixBranches(pipeline, split));
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
  if (terminalPublicationFailureForcesPipelineFailed(pipeline)) return "failed";
  return "succeeded";
}
