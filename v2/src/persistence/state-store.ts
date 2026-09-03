import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isRecord } from "../../../shared/is-record.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { InvocationFailureDetail } from "../execution/invocation-failure.ts";
import type { PipelineDefinition, PipelineTerminalAction } from "../execution/pipeline-definition.ts";
import type { PublicationFailure } from "../execution/publication-retry.ts";
import { isWriteLoopOutcomeKind, type WriteLoopInput, type WriteLoopOutcomeKind } from "../execution/write-loop.ts";
import { ORCHESTRATION_STORE_PATH } from "../paths.ts";
import { stageArtifactFromEntryRun, stageFailureDetailFromEntryRun } from "./pipeline-stage-settlement.ts";
import { rollupWorkflowRunStatus } from "./workflow-run-status-rollup.ts";

/** Timeout for the state store to wait when the database is locked (busy_timeout in ms). Must exceed the longest single store transaction. */
export const STATE_STORE_BUSY_TIMEOUT_MS = 5000;

export const RUN_STATUSES = [
  "in-progress",
  "completed",
  "blocked",
  "budget-soft-stopped",
  "paused",
  "failed",
  "interrupted",
  "killed",
  "queued",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

const runStatusSet = new Set<string>(RUN_STATUSES);

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && runStatusSet.has(value);
}

/** Statuses that end a run row; `paused` is excluded (resumable). */
export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  "completed",
  "failed",
  "blocked",
  "interrupted",
  "killed",
]);

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

const BOUNDARY_TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set(["completed", "blocked", "failed", "interrupted"]);

/** Statuses a committed completion boundary can leave permanently; `paused` and `killed` are excluded. */
export function isBoundaryTerminalRunStatus(status: RunStatus): boolean {
  return BOUNDARY_TERMINAL_STATUSES.has(status);
}

/**
 * Authored workflow-step identity retained on workflow-backed runs. Write-step
 * config (`stepRules`, `expectedArtifactPath`, `agents`, `agentModelConfig`) is
 * carried here too so resume can rebuild that step's `WriteLoopInput`
 * without a live reference to the authoring `WorkflowStep`.
 */
export type WorkflowSnapshotStep = {
  stepId: string;
  role: string;
  /** Whether this step owns a durable run row; absent means durable for legacy snapshots. */
  durable?: boolean;
  /** Identifies a review behavior. */
  behavior?: "review-debate" | "review";
  stepRules?: string;
  expectedArtifactPath?: string;
  promptId?: string;
  promptPlaceholders?: Record<string, string>;
  agents?: readonly string[];
  agentModelConfig?: AgentModelConfig;
  iterationTimeoutMs?: number;
  iterationCeilingMs?: number;
  idleOutputMs?: number;
  fixCommand?: string;
  readyCommand?: string;
  /** Preserves external-plan boundaries for recovery and finalization. */
  externalPlanSpec?: true;
  /** Authoritative external routing root for an admitted plan. */
  specReadRoot?: string;
};

/** Durable workflow invocation snapshot shared by every step run in that workflow. */
export type WorkflowSnapshot = {
  invocationId: string;
  steps: WorkflowSnapshotStep[];
  /** Caller-supplied title retained for completion publication retries. */
  creationTitle?: string;
  /** Resolved implement review count; present only on implement workflow snapshots. */
  reviewPasses?: number;
  /** Resolved implement review behavior; present only on implement workflow snapshots. */
  reviewBehavior?: "debate" | "light";
};

export type AttemptStatus = "in-progress" | "completed";

/** Outcome classification for an attempt. */
export type OutcomeKind =
  | "done"
  | "no-work"
  | "progress"
  | "blocked"
  | "contract_miss"
  | "invocation_failure"
  | "iteration_timeout"
  | "idle_output_timeout"
  | "invalid_token"
  | "missing_blocker"
  | "landing_failed"
  | "surviving_mutation_failed";

/** Durable ready-gate repair fence provenance persisted across process restart and resume. */
export type ReadyGateRepairFenceProvenance = {
  allowedPaths: readonly string[];
  /** True when the originating write step was intent/plan markdown-only. */
  markdownOnly?: boolean;
  markdownOutputRoots?: readonly string[];
  offendingPath?: string;
  outcomeKind: "frozen" | "completion_commit_failed";
};

/** Publication tail checkpoint retained when repair-budget exhaustion demotes a completed write row. */
export type RetainedFinalizationCheckpoint = {
  completionAttemptId: string;
  completionAgent: string;
  prNumber?: number;
  prUrl?: string;
};

/** A durable run record. */
export type Run = {
  id: string;
  project: string;
  specRef: string;
  createdAt: number;
  status: RunStatus;
  attemptCount: number;
  worktreePath: string;
  branch: string;
  specPath: string;
  downstreamInputs?: readonly string[] | null;
  creationTitle?: string | null;
  stepId?: string | null;
  workflowSnapshot?: WorkflowSnapshot | null;
  queuedInput?: WriteLoopInput | null;
  prNumber?: number | null;
  prUrl?: string | null;
  reconciledAt?: number | null;
  /** Unix epoch ms stamped by terminal status writes outside a completion boundary (`setRunStatus`, `commitGuardedKill`, `commitTerminalRunSettlement`); cleared when `setRunStatus` writes a non-terminal status. */
  finishedAt?: number | null;
  /** Process group id of the run's in-flight ready-gate test tree; null when no gate is in flight. */
  readyGatePgid?: number | null;
  readyGateRepairFence?: ReadyGateRepairFenceProvenance | null;
  /** True when a non-null fence column could not be parsed into a valid allowset. */
  readyGateRepairFenceCorrupt?: boolean;
  retainedFinalizationCheckpoint?: RetainedFinalizationCheckpoint | null;
  /** True when a non-null checkpoint column could not be parsed. */
  retainedFinalizationCheckpointCorrupt?: boolean;
  /** Unix epoch ms when an operator dismissed this run from display; `null`/absent when not dismissed. */
  dismissedAt?: number | null;
  /** Durable terminal settlement cause aligned with log `loopOutcomeKind`; `null` when unset or pre-migration. */
  terminalCause?: WriteLoopOutcomeKind | null;
  /** Durable terminal settlement failure detail; `null` when unset, cleared, corrupt, or pre-migration. */
  terminalFailureDetail?: InvocationFailureDetail | null;
  /** True when a non-null `terminal_failure_detail` column could not be parsed. */
  terminalFailureDetailCorrupt?: boolean;
};

export type PipelineStatus = "active" | "interrupted";

/** Immutable pipeline admission context persisted as a JSON snapshot on the pipeline row. `cwd` and `configPath` are required on admission; optional `seed` and `seedPath` are not required by the store; admission sets at most one; dual-populated or ambiguous rows load as stored. */
export type PipelineContext = {
  cwd: string;
  configPath: string;
  targetDir?: string;
  projectRegistry?: Record<string, { root: string; origin?: string }>;
  seed?: string;
  seedPath?: string;
};

export type PipelineContextLoaderError = {
  kind: "pipeline-context-loader";
  errors: readonly string[];
};

export type LoadPipelineContextResult =
  | { ok: true; context: PipelineContext }
  | { ok: false; error: PipelineContextLoaderError };

/** Validate persisted pipeline context JSON at consumption boundaries; opaque `mapPipelineRow` parse does not run this. */
export function loadPipelineContext(value: unknown): LoadPipelineContextResult {
  if (!isRecord(value)) {
    return { ok: false, error: { kind: "pipeline-context-loader", errors: ["expected object"] } };
  }

  const errors: string[] = [];
  if (typeof value.cwd !== "string" || value.cwd === "") errors.push("missing required field: cwd");
  if (typeof value.configPath !== "string" || value.configPath === "") {
    errors.push("missing required field: configPath");
  }
  if (errors.length > 0) {
    return { ok: false, error: { kind: "pipeline-context-loader", errors } };
  }

  const context: PipelineContext = { cwd: value.cwd as string, configPath: value.configPath as string };
  for (const key of ["targetDir", "seed", "seedPath"] as const) {
    const field = value[key];
    if (field === undefined) continue;
    if (typeof field !== "string") {
      return { ok: false, error: { kind: "pipeline-context-loader", errors: [`${key} must be a string`] } };
    }
    context[key] = field;
  }
  if (value.projectRegistry !== undefined) {
    if (!isRecord(value.projectRegistry)) {
      return { ok: false, error: { kind: "pipeline-context-loader", errors: ["projectRegistry must be an object"] } };
    }
    context.projectRegistry = value.projectRegistry as Record<string, { root: string; origin?: string }>;
  }

  return { ok: true, context };
}

/** Durable terminal-publication failure recorded on the pipeline row after stage success. */
export type PipelineTerminalPublicationFailure = {
  terminalAction: PipelineTerminalAction;
  failure: PublicationFailure;
  prNumber?: number;
  prUrl?: string;
};

/** A durable admitted pipeline record: identity, source name, ownership, and immutable admitted-definition snapshot. */
export type Pipeline = {
  id: string;
  name: string;
  createdAt: number;
  ownerIdentity: string | null;
  status: PipelineStatus;
  definition: PipelineDefinition;
  /** Immutable admission context; `null` for pre-migration rows and admissions that omitted context. */
  context: PipelineContext | null;
  /** Nullable durable terminal-publication failure; `null` when unset or pre-migration. */
  terminalPublicationFailure: PipelineTerminalPublicationFailure | null;
  /** Unix epoch ms when terminal publication succeeded; `null` until settled. */
  terminalPublicationSucceededAt: number | null;
  /** Unix epoch ms when an operator dismissed this pipeline from display; `null` when not dismissed. */
  dismissedAt: number | null;
};

export type ApprovalDecision = "approved" | "rejected";

export type ApprovalRefusalReason =
  | "stage_not_found"
  | "not_approval_stage"
  | "status_not_pending"
  | "status_not_awaiting"
  | "invalid_decision";

export type ApprovalOperationOutcome =
  | { kind: "applied"; stageRecordId: string }
  | { kind: "refused"; stageRecordId: string; reason: ApprovalRefusalReason };

export type PipelineContinuationRefusalReason = "pipeline_not_found" | "not_active" | "stale_owner" | "claim_lost";

export type PipelineContinuationOutcome =
  | { kind: "applied"; pipelineId: string }
  | { kind: "refused"; pipelineId: string; reason: PipelineContinuationRefusalReason };

export type PipelineDismissalRefusalReason = "pipeline_not_found";

export type PipelineDismissalOutcome =
  | { kind: "applied"; pipelineId: string }
  | { kind: "refused"; pipelineId: string; reason: PipelineDismissalRefusalReason };

export type RunDismissalRefusalReason = "run_not_found";

export type RunDismissalOutcome =
  | { kind: "applied"; runId: string }
  | { kind: "refused"; runId: string; reason: RunDismissalRefusalReason };

type TerminalRunSettlementEvidence = {
  terminalCause?: WriteLoopOutcomeKind | null;
  prNumber?: number | null;
  prUrl?: string | null;
  terminalFailureDetail?: InvocationFailureDetail | null;
};

type CommitTerminalRunSettlementInput = TerminalRunSettlementEvidence & {
  runId: string;
  status: RunStatus;
  beforeSecondWrite?: () => void;
};

type CommitCompletionBoundaryInput = {
  attemptId: string;
  runStatus: RunStatus;
  outcomeKind: OutcomeKind;
  invocationFailureDetail?: InvocationFailureDetail;
  completionAgent?: string;
  completionReviewPass?: number;
  beforeRunUpdate?: () => void;
} & TerminalRunSettlementEvidence;

export type PipelineReopenRefusalReason =
  | "pipeline_not_found"
  | "no_failed_stage"
  | "multiple_failed_stages"
  | "malformed_continuation"
  | "reopen_lost";

export type PipelineReopenOutcome =
  | { kind: "applied"; stageRecordId: string }
  | { kind: "refused"; pipelineId: string; reason: PipelineReopenRefusalReason };

export type PipelineStageAdmissionLoadOutcome = { kind: "absent" } | { kind: "present"; holderIdentity: string };

export type PipelineStageAdmissionClaimOutcome = { kind: "applied" } | { kind: "refused"; reason: "claim_lost" };

export type PipelineStageAdmissionReleaseOutcome = { kind: "applied" } | { kind: "refused"; reason: "stale_holder" };

/** True when the authored stage at `stageId` is `kind: "approval"`. */
export function isApprovalAuthoredStage(stageId: string, definition: PipelineDefinition): boolean {
  const authored = definition.stages.find((stage) => stage.stageId === stageId);
  return authored?.kind === "approval";
}

/** True when a boundary write may transition an approval row from `pending` to `awaiting`. */
export function approvalBoundaryAllowsStatus(status: string): boolean {
  return status === "pending";
}

/** True when a decision write may transition an approval row from `awaiting` to `approved` or `rejected`. */
export function approvalDecisionAllowsStatus(status: string): boolean {
  return status === "awaiting";
}

/** True when a stage before the failed continuation may remain untouched during reopen. */
export function reopenPredecessorAllowsStatus(status: string): boolean {
  return status === "succeeded" || status === "approved";
}

/** True when a stage after the failed continuation may be reopened in place. */
export function reopenSuffixAllowsStatus(status: string): boolean {
  return status === "skipped";
}

export type FailedPipelineReopenShape =
  | { kind: "valid"; failedStageRecordId: string; suffixStageRecordIds: readonly string[] }
  | {
      kind: "invalid";
      reason: Exclude<PipelineReopenRefusalReason, "pipeline_not_found" | "reopen_lost">;
    };

function comparePipelineStageBranchOrder(a: PipelineStageRecord, b: PipelineStageRecord): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY && b.branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY) {
    return -1;
  }
  if (b.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY && a.branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY) {
    return 1;
  }
  return a.branchKey.localeCompare(b.branchKey);
}

/** Stage rows that participate in reopen shape analysis for one failed branch row. */
function reopenStagesForFailedBranch(
  stages: readonly PipelineStageRecord[],
  failedStage: PipelineStageRecord,
): PipelineStageRecord[] {
  if (failedStage.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY) {
    return [...stages];
  }
  return stages
    .filter(
      (stage) =>
        stage.branchKey === failedStage.branchKey ||
        (stage.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY && stage.position < failedStage.position),
    )
    .sort(comparePipelineStageBranchOrder);
}

function analyzeFailedPipelineReopenShapeOnStages(stages: readonly PipelineStageRecord[]): FailedPipelineReopenShape {
  const failed = stages.filter((stage) => stage.status === "failed");
  if (failed.length === 0) {
    return { kind: "invalid", reason: "no_failed_stage" };
  }
  if (failed.length > 1) {
    return { kind: "invalid", reason: "multiple_failed_stages" };
  }

  const failedStage = failed[0];
  if (failedStage === undefined) {
    return { kind: "invalid", reason: "no_failed_stage" };
  }
  const failedIndex = stages.findIndex((stage) => stage.id === failedStage.id);

  for (let index = 0; index < failedIndex; index += 1) {
    if (!reopenPredecessorAllowsStatus(stages[index]?.status ?? "")) {
      return { kind: "invalid", reason: "malformed_continuation" };
    }
  }

  const suffixStageRecordIds: string[] = [];
  for (let index = failedIndex + 1; index < stages.length; index += 1) {
    const stage = stages[index];
    if (!stage || !reopenSuffixAllowsStatus(stage.status)) {
      return { kind: "invalid", reason: "malformed_continuation" };
    }
    suffixStageRecordIds.push(stage.id);
  }

  return { kind: "valid", failedStageRecordId: failedStage.id, suffixStageRecordIds };
}

/**
 * Locate the lowest durable position carrying both a `default` row and a
 * `branchKey` row — the fan-out point a named branch diverges from. `null`
 * when the branch never appears alongside a `default` sibling, or the pair
 * at that position is duplicated or `stageId`-misaligned.
 */
function namedBranchContinuationBoundary(
  stagesByPosition: ReadonlyMap<number, readonly PipelineStageRecord[]>,
  positions: readonly number[],
  branchKey: string,
): number | null {
  for (const position of positions) {
    const rows = stagesByPosition.get(position) ?? [];
    const defaultRows = rows.filter((stage) => stage.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY);
    const namedRows = rows.filter((stage) => stage.branchKey === branchKey);
    if (defaultRows.length === 0 || namedRows.length === 0) continue;
    if (defaultRows.length > 1 || namedRows.length > 1) return null;
    const defaultRow = defaultRows[0];
    const namedRow = namedRows[0];
    if (!defaultRow || !namedRow || defaultRow.stageId !== namedRow.stageId) return null;
    return position;
  }
  return null;
}

/**
 * The shared `default` prefix strictly before the fan-out boundary plus the
 * named branch's own row at the boundary and every later durable position, in
 * position order; excludes every `default` row at or after the boundary and
 * every sibling branch row. `null` when the named branch is absent, a
 * selected row is missing or duplicated, the boundary pair is
 * `stageId`-misaligned, or the named continuation is incomplete through the
 * last durable position.
 */
function selectNamedBranchContinuationStages(
  stages: readonly PipelineStageRecord[],
  branchKey: string,
): PipelineStageRecord[] | null {
  const stagesByPosition = new Map<number, PipelineStageRecord[]>();
  for (const stage of stages) {
    const rows = stagesByPosition.get(stage.position);
    if (rows) {
      rows.push(stage);
    } else {
      stagesByPosition.set(stage.position, [stage]);
    }
  }
  const positions = [...stagesByPosition.keys()].sort((a, b) => a - b);

  const boundaryPosition = namedBranchContinuationBoundary(stagesByPosition, positions, branchKey);
  if (boundaryPosition === null) return null;

  const continuation: PipelineStageRecord[] = [];
  for (const position of positions) {
    const rows = stagesByPosition.get(position) ?? [];
    if (position < boundaryPosition) {
      const defaultRows = rows.filter((stage) => stage.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY);
      if (defaultRows.length !== 1) return null;
      const row = defaultRows[0];
      if (!row) return null;
      continuation.push(row);
    } else {
      const namedRows = rows.filter((stage) => stage.branchKey === branchKey);
      if (namedRows.length !== 1) return null;
      const row = namedRows[0];
      if (!row) return null;
      continuation.push(row);
    }
  }
  return continuation;
}

/** Shape analysis for one named branch's continuation, scoped by `selectNamedBranchContinuationStages`. */
function analyzeNamedBranchReopenShape(
  stages: readonly PipelineStageRecord[],
  branchKey: string,
): FailedPipelineReopenShape {
  const continuation = selectNamedBranchContinuationStages(stages, branchKey);
  if (continuation === null) {
    return { kind: "invalid", reason: "malformed_continuation" };
  }
  return analyzeFailedPipelineReopenShapeOnStages(continuation);
}

/**
 * Detect whether ordered stage rows match the in-place failed-continuation
 * reopen shape. Omitted `branchKey` and `"default"` analyze the whole
 * pipeline (unchanged); a named `branchKey` scopes analysis to that branch's
 * shared prefix plus its own continuation via `selectNamedBranchContinuationStages`.
 */
export function analyzeFailedPipelineReopenShape(
  stages: readonly PipelineStageRecord[],
  branchKey?: string,
): FailedPipelineReopenShape {
  if (branchKey !== undefined && branchKey !== DEFAULT_PIPELINE_STAGE_BRANCH_KEY) {
    return analyzeNamedBranchReopenShape(stages, branchKey);
  }
  const failed = stages.filter((stage) => stage.status === "failed");
  if (failed.length === 0) {
    return { kind: "invalid", reason: "no_failed_stage" };
  }
  if (failed.length > 1) {
    return { kind: "invalid", reason: "multiple_failed_stages" };
  }

  const failedStage = failed[0];
  if (failedStage === undefined) {
    return { kind: "invalid", reason: "no_failed_stage" };
  }

  const relevantStages = reopenStagesForFailedBranch(stages, failedStage);
  return analyzeFailedPipelineReopenShapeOnStages(relevantStages);
}

export const DEFAULT_PIPELINE_STAGE_BRANCH_KEY = "default";

export const PIPELINE_STAGE_BRANCH_KEY_TIE_ORDER_SQL = `(branch_key = '${DEFAULT_PIPELINE_STAGE_BRANCH_KEY}') DESC, branch_key ASC`;

/** A durable stage record belonging to an admitted pipeline. */
export type PipelineStageRecord = {
  id: string;
  pipelineId: string;
  stageId: string;
  branchKey: string;
  position: number;
  status: string;
  workflowInvocationId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  artifact: unknown | null;
  failureDetail: unknown | null;
  /** Unix epoch ms of the approval decision; `null` until decided. */
  decidedAt: number | null;
};

/**
 * A targeted patch to one stage's durable lifecycle fields. Omitted fields are
 * unchanged; an explicit `null` clears a nullable field. `status`, when
 * present, is a non-null string. Empty patches are rejected by `updateStage`.
 */
export type StageLifecyclePatch = {
  status?: string;
  workflowInvocationId?: string | null;
  startedAt?: number | null;
  endedAt?: number | null;
  artifact?: unknown;
  failureDetail?: unknown;
};

/** A durable attempt record linked to a run. */
export type Attempt = {
  id: string;
  runId: string;
  attemptNumber: number;
  startedAt: number;
  status: AttemptStatus;
  outcomeKind: OutcomeKind | null;
  completedAt: number | null;
  invocationFailureDetail: InvocationFailureDetail | null;
  completionAgent?: string | null;
  /** Reached review-cycle pass whose actuator produced the tracked mutation, when this attempt
   * settled a review/review-debate step; absent for every other attempt kind. */
  completionReviewPass?: number | null;
};

/** Repository-style durable state API, keyed by IDs; no generic SQL surface. */
export interface StateStore {
  /** Insert a run (zero attempts, status defaults to `in-progress`); returns its ID. */
  createRun(args: {
    project: string;
    specRef: string;
    worktreePath: string;
    branch: string;
    specPath: string;
    creationTitle?: string;
    stepId?: string;
    workflowSnapshot?: WorkflowSnapshot;
    status?: RunStatus;
    queuedInput?: WriteLoopInput;
  }): string;

  /** Retain the title resolved at the publication boundary for retries. */
  setCreationTitle(runId: string, title: string): void;

  /** Update the worktree-relative handoff path recorded on a run row after intent landing. */
  setRunSpecPath(runId: string, specPath: string): void;

  /** Record per-file pipeline handoff inputs after multi-file intent landing. */
  setRunDownstreamInputs(runId: string, downstreamInputs: readonly string[]): void;

  /** Clear per-file pipeline handoff inputs after single-file intent landing. */
  clearRunDownstreamInputs(runId: string): void;

  /** Record the confirmed PR number and URL after successful publication. */
  setPrEvidence(runId: string, prNumber: number, prUrl: string): void;

  /** Record or clear (`null`) the process group id of the run's in-flight ready-gate test tree. */
  setReadyGatePgid(runId: string, pgid: number | null): void;

  /**
   * Every run row carrying a non-null `ready_gate_pgid`, classified by whether its
   * `owner_identity` names a still-live process (`isOwnerAlive`). Null owners are
   * not live. Backs daemon startup's orphan ready-gate group sweep.
   */
  listReadyGateSweepCandidates(): Promise<ReadonlyArray<{ runId: string; readyGatePgid: number; ownerLive: boolean }>>;

  /** Persist ready-gate repair fence provenance for restart-safe recovery. */
  setReadyGateRepairFence(runId: string, fence: ReadyGateRepairFenceProvenance): void;

  /** Persist the publication-tail checkpoint for gate-only finalization resume. */
  setRetainedFinalizationCheckpoint(runId: string, checkpoint: RetainedFinalizationCheckpoint): void;

  /** Whether a non-terminal `queued` run exists for `(project, branch)`. */
  hasQueuedRun(args: { project: string; branch: string }): boolean;

  /** All `queued` runs, oldest first (`created_at ASC`), for FIFO promotion. */
  listQueuedRuns(): Run[];

  /** Load a run and its attempt history for resume; null when unknown. */
  loadRun(runId: string): (Run & { attempts: Attempt[] }) | null;

  /** Load runs with attempt history for a deduped ID set; unknown IDs are omitted. */
  loadRunsByIds(runIds: readonly string[]): Array<Run & { attempts: Attempt[] }>;

  /** Most recent run for the `(project, branch, stepId)` resume key; null when none. */
  findRunByProjectBranch(args: {
    project: string;
    branch: string;
    stepId: string | null;
  }): (Run & { attempts: Attempt[] }) | null;

  /** Review-mutation candidates for one worktree, newest first across all step IDs. */
  findReviewMutationLineageRows(args: { project: string; branch: string }): Run[];

  /** All runs whose `workflowSnapshot.invocationId` matches the given id. */
  findRunsByInvocationId(invocationId: string): Run[];

  /** All runs whose `workflowSnapshot.invocationId` is in the given set; creation order per invocation. */
  findRunsByInvocationIds(invocationIds: readonly string[]): Run[];

  /**
   * Admit an already-validated pipeline definition: one pipeline row plus one
   * `pending` stage row per authored stage, in a single transaction. Returns
   * the generated pipeline ID. `beforeStageInsert` is a test seam to force a
   * mid-transaction failure after a given authored-stage index.
   */
  createPipeline(args: {
    definition: PipelineDefinition;
    context?: PipelineContext;
    beforeStageInsert?: (stageIndex: number) => void;
  }): string;

  /** Load an admitted pipeline and its stages, ordered by position then branch key; null when unknown. */
  loadPipeline(pipelineId: string): (Pipeline & { stages: PipelineStageRecord[] }) | null;

  /** Every admitted pipeline with its stages ordered by position then branch key; pipeline order is unspecified. */
  listPipelines(): Array<Pipeline & { stages: PipelineStageRecord[] }>;

  /** Admit an additional branch row for one authored stage; returns the new row's durable `id`. */
  createPipelineStageBranch(args: { pipelineId: string; stageId: string; branchKey: string }): string;

  /** Apply a targeted lifecycle patch keyed by `(pipelineId, stageId, branchKey)`; omitted `branchKey` defaults to `"default"`. */
  updateStage(args: { pipelineId: string; stageId: string; branchKey?: string; patch: StageLifecyclePatch }): void;

  settleLinkedStagesFromEntryRun(entryRunId: string): void;

  /**
   * Conditionally mark one `kind: "approval"` row `pending` → `awaiting` by durable
   * `PipelineStageRecord.id`. Returns an explicit applied or refused outcome.
   */
  commitApprovalBoundary(args: { stageRecordId: string }): ApprovalOperationOutcome;

  /**
   * Conditionally decide one `kind: "approval"` row `awaiting` → `approved` or
   * `rejected` by durable `PipelineStageRecord.id`. First writer wins; duplicates
   * and races are refused without mutation.
   */
  commitApprovalDecision(args: { stageRecordId: string; decision: ApprovalDecision }): ApprovalOperationOutcome;

  /**
   * Atomically claim an `active` or reconciled-`interrupted` pipeline for continuation by
   * the current process, restoring `status = 'active'`. Succeeds only when
   * `priorOwnerIdentity` matches the durable row; first writer wins under concurrent claims.
   */
  claimPipelineContinuation(args: {
    pipelineId: string;
    priorOwnerIdentity: string | null;
  }): PipelineContinuationOutcome;

  claimPipelineStageAdmission(args: {
    pipelineId: string;
    stageId: string;
    branchKey?: string;
  }): PipelineStageAdmissionClaimOutcome;

  releasePipelineStageAdmission(args: {
    pipelineId: string;
    stageId: string;
    branchKey?: string;
  }): PipelineStageAdmissionReleaseOutcome;

  loadPipelineStageAdmission(args: {
    pipelineId: string;
    stageId: string;
    branchKey?: string;
  }): PipelineStageAdmissionLoadOutcome;

  /**
   * Atomically reopen one failed continuation row and its contiguous skipped suffix
   * in place as `pending`, clearing only prior-attempt lifecycle payloads. Optional
   * `branchKey` scopes analysis and reopen to one named fan-out branch; omission and
   * `branchKey: "default"` retain whole-pipeline analysis. Returns the durable
   * `PipelineStageRecord.id` of the failed row on application.
   */
  reopenFailedPipeline(args: { pipelineId: string; branchKey?: string }): PipelineReopenOutcome;

  /**
   * Atomically record a terminal-publication failure on the pipeline row without mutating
   * stage rows. Idempotent when a failure or success marker is already present.
   */
  commitTerminalPublicationFailure(args: {
    pipelineId: string;
    terminalAction: PipelineTerminalAction;
    failure: PublicationFailure;
    prNumber?: number;
    prUrl?: string;
  }): void;

  /** Atomically record terminal-publication success on the pipeline row. Idempotent when already set. */
  commitTerminalPublicationSuccess(args: { pipelineId: string }): void;

  /**
   * Mark a pipeline dismissed from display. Preserves the first dismissal timestamp on
   * repeat calls; refuses on an unknown pipeline id. Does not touch stage rows or lifecycle.
   */
  dismissPipeline(args: { pipelineId: string }): PipelineDismissalOutcome;

  /**
   * Clear a pipeline's dismissal, restoring default display. A no-op success when the
   * pipeline was never dismissed; refuses on an unknown pipeline id.
   */
  undismissPipeline(args: { pipelineId: string }): PipelineDismissalOutcome;

  /** Insert an `in-progress` attempt row; returns its ID. */
  recordAttemptStart(runId: string): string;

  /**
   * Atomically persist attempt completion, its outcome classification, and the
   * run checkpoint (attempt_count + status). Idempotent: re-committing an
   * already-finished boundary is a no-op. `beforeRunUpdate` is a test seam to
   * force a mid-transaction failure.
   */
  commitCompletionBoundary(args: CommitCompletionBoundaryInput): void;

  /** Persist a run status update outside a completion boundary. */
  setRunStatus(runId: string, status: RunStatus): void;

  /** Set `killed` unless the row is already boundary-terminal (`completed`, `blocked`, `failed`). */
  commitGuardedKill(runId: string): void;

  /** Terminal status, finish metadata, and optional evidence in one transaction; `beforeSecondWrite` is a test seam. */
  commitTerminalRunSettlement(args: CommitTerminalRunSettlementInput): void;

  /**
   * Mark a run dismissed from display. Preserves the first dismissal timestamp on
   * repeat calls; refuses on an unknown run id. Does not touch attempt rows or lifecycle.
   */
  dismissRun(runId: string): RunDismissalOutcome;

  /**
   * Clear a run's dismissal, restoring default display. A no-op success when the
   * run was never dismissed; refuses on an unknown run id.
   */
  undismissRun(runId: string): RunDismissalOutcome;

  /**
   * Whether a forced kill may settle `runId`'s owner: admits when `owner_identity` is
   * `NULL`, matches the current process, or names a dead prior process; refuses a
   * different still-live owner. Backs daemon `kill`'s force path — a second internal
   * consumer of `owner_identity` alongside {@link beginRunReconciliation}.
   */
  forceKillOwnerAdmits(runId: string): Promise<boolean>;

  /** Admit dead-owner orphan rows and return every row still owing reconciliation history. */
  beginRunReconciliation(): Promise<string[]>;

  /** Mark a persisted reconciliation event as complete. */
  finishRunReconciliation(runId: string): void;

  /**
   * Settle pipelines whose recorded owner is a dead prior incarnation or `NULL`:
   * marks the pipeline `interrupted` and each of its active (non-`pending`,
   * non-terminal) stages `interrupted` with an end timestamp, one transaction
   * per sweep. A pipeline owned by the current process, or by another live
   * process, is untouched. Idempotent: an already-`interrupted` pipeline is
   * never a candidate. Returns the settled pipeline IDs.
   */
  reconcilePipelines(): Promise<string[]>;

  /** List all runs (durable rows only, no in-memory liveness). */
  listRuns(): Run[];

  /**
   * Runs whose `status` is in `statuses` and that are incident candidates: non-terminal rows
   * regardless of `finished_at`; terminal rows only when `finished_at` is null or `>= sinceMs`.
   */
  listIncidentCandidateRuns(args: { statuses: readonly RunStatus[]; sinceMs: number }): Run[];

  /**
   * Pipelines that are incident candidates per SQL lifecycle rules (non-terminal stage signals,
   * settlement-pending publication, fan-out branch signals, or recent otherwise-terminal settlement).
   * Each match returns once with all stage rows, same shape as `listPipelines` elements.
   */
  listIncidentCandidatePipelines(args: { sinceMs: number }): Array<Pipeline & { stages: PipelineStageRecord[] }>;

  /** Whether `(incidentId, transition)` has been delivered. */
  hasNotificationDelivery(args: { incidentId: string; transition: string }): boolean;

  /** Delivery-ledger rows for the given incident IDs; one sweep-level consult per derivation pass. */
  listNotificationDeliveriesForIncidentIds(
    incidentIds: readonly string[],
  ): ReadonlyArray<{ incidentId: string; transition: string }>;

  /**
   * Record a delivered notification when absent; returns whether this caller won the insert.
   * First writer among concurrent sweepers delivers.
   */
  tryRecordNotificationDelivery(args: { incidentId: string; transition: string; deliveredAt: number }): boolean;

  /** Undo a claim so a failed sink spawn can retry on the next sweep. */
  releaseNotificationDelivery(args: { incidentId: string; transition: string }): void;

  /** True once {@link close} has run — deferred daemon work must check this rather than race a closed DB. */
  isClosed(): boolean;

  close(): void;
}

// Baselined schema for fresh stores (post-030 on-disk shape). Pre-squash stores upgrade once via
// `BASELINE_SQUASH_MIGRATION_ID` in `applySchemaMigrations`.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    spec_ref TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    worktree_path TEXT NOT NULL,
    branch TEXT NOT NULL,
    spec_path TEXT NOT NULL,
    step_id TEXT,
    workflow_snapshot TEXT,
    queued_input TEXT,
    creation_title TEXT,
    reconciliation_pending INTEGER NOT NULL DEFAULT 0,
    owner_identity TEXT,
    pr_number INTEGER,
    pr_url TEXT,
    reconciled_at INTEGER,
    ready_gate_repair_fence TEXT,
    retained_finalization_checkpoint TEXT,
    downstream_inputs TEXT,
    finished_at INTEGER,
    ready_gate_pgid INTEGER,
    dismissed_at INTEGER,
    terminal_cause TEXT,
    terminal_failure_detail TEXT
  );
  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    outcome_kind TEXT,
    completed_at INTEGER,
    invocation_failure_detail TEXT,
    completion_agent TEXT,
    completion_review_pass INTEGER,
    FOREIGN KEY (run_id) REFERENCES runs(id)
  );
  CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    definition TEXT NOT NULL,
    owner_identity TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    context TEXT,
    terminal_publication_failure TEXT,
    terminal_publication_succeeded_at INTEGER,
    dismissed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS pipeline_stages (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    stage_id TEXT NOT NULL,
    branch_key TEXT NOT NULL DEFAULT '${DEFAULT_PIPELINE_STAGE_BRANCH_KEY}',
    position INTEGER NOT NULL,
    status TEXT NOT NULL,
    workflow_invocation_id TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    artifact TEXT,
    failure_detail TEXT,
    decided_at INTEGER,
    UNIQUE (pipeline_id, stage_id, branch_key)
  );
  CREATE TABLE IF NOT EXISTS pipeline_stage_admission (
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
    stage_id TEXT NOT NULL,
    branch_key TEXT NOT NULL,
    holder_identity TEXT NOT NULL,
    PRIMARY KEY (pipeline_id, stage_id, branch_key)
  );
  CREATE TABLE IF NOT EXISTS operator_notification_deliveries (
    incident_id TEXT NOT NULL,
    transition TEXT NOT NULL,
    delivered_at INTEGER NOT NULL,
    PRIMARY KEY (incident_id, transition)
  );
`;

const RUN_COLUMNS = `id, project, spec_ref AS specRef, created_at AS createdAt, status,
  attempt_count AS attemptCount, worktree_path AS worktreePath, branch, spec_path AS specPath,
  downstream_inputs AS downstreamInputsJson, step_id AS stepId,
  workflow_snapshot AS workflowSnapshotJson, queued_input AS queuedInputJson, creation_title AS creationTitle,
  pr_number AS prNumber, pr_url AS prUrl, reconciled_at AS reconciledAt, finished_at AS finishedAt,
  ready_gate_pgid AS readyGatePgid,
  ready_gate_repair_fence AS readyGateRepairFenceJson,
  retained_finalization_checkpoint AS retainedFinalizationCheckpointJson,
  dismissed_at AS dismissedAt,
  terminal_cause AS terminalCause,
  terminal_failure_detail AS terminalFailureDetailJson`;

const ATTEMPT_COLUMNS = `id, run_id AS runId, attempt_number AS attemptNumber, started_at AS startedAt, status,
  outcome_kind AS outcomeKind, completed_at AS completedAt, invocation_failure_detail AS invocationFailureDetailJson,
  completion_agent AS completionAgent, completion_review_pass AS completionReviewPass`;

const PIPELINE_COLUMNS = `id, name, created_at AS createdAt, owner_identity AS ownerIdentity, status, definition AS definitionJson, context AS contextJson, terminal_publication_failure AS terminalPublicationFailureJson, terminal_publication_succeeded_at AS terminalPublicationSucceededAt, dismissed_at AS dismissedAt`;

const STAGE_COLUMNS = `id, pipeline_id AS pipelineId, stage_id AS stageId, branch_key AS branchKey, position, status,
  workflow_invocation_id AS workflowInvocationId, started_at AS startedAt, ended_at AS endedAt,
  artifact AS artifactJson, failure_detail AS failureDetailJson, decided_at AS decidedAt`;

const INSERT_PIPELINE_STAGE_SQL = `
  INSERT INTO pipeline_stages (
    id, pipeline_id, stage_id, branch_key, position, status, workflow_invocation_id, started_at, ended_at, artifact, failure_detail
  )
  VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, NULL)
`;

const BASELINE_SQUASH_MIGRATION_ID = "031-baseline-squash";

function tableExists(db: Database, name: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return row !== undefined && row !== null;
}

function tableHasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function addColumnIfMissing(db: Database, table: string, column: string, definition: string): void {
  if (!tableHasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function upgradePipelineStagesBranchKey(db: Database): void {
  if (!tableExists(db, "pipeline_stages") || tableHasColumn(db, "pipeline_stages", "branch_key")) {
    return;
  }
  db.exec(`
    ALTER TABLE pipeline_stages ADD COLUMN branch_key TEXT NOT NULL DEFAULT '${DEFAULT_PIPELINE_STAGE_BRANCH_KEY}';
    CREATE TABLE pipeline_stages_new (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
      stage_id TEXT NOT NULL,
      branch_key TEXT NOT NULL DEFAULT '${DEFAULT_PIPELINE_STAGE_BRANCH_KEY}',
      position INTEGER NOT NULL,
      status TEXT NOT NULL,
      workflow_invocation_id TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      artifact TEXT,
      failure_detail TEXT,
      UNIQUE (pipeline_id, stage_id, branch_key)
    );
    INSERT INTO pipeline_stages_new (
      id, pipeline_id, stage_id, branch_key, position, status,
      workflow_invocation_id, started_at, ended_at, artifact, failure_detail
    )
    SELECT
      id, pipeline_id, stage_id, branch_key, position, status,
      workflow_invocation_id, started_at, ended_at, artifact, failure_detail
    FROM pipeline_stages;
    DROP TABLE pipeline_stages;
    ALTER TABLE pipeline_stages_new RENAME TO pipeline_stages;
  `);
}

function upgradeFromLegacyEra(db: Database): void {
  addColumnIfMissing(db, "attempts", "invocation_failure_detail", "TEXT");
  addColumnIfMissing(db, "attempts", "completion_agent", "TEXT");
  addColumnIfMissing(db, "attempts", "completion_review_pass", "INTEGER");
  addColumnIfMissing(db, "runs", "step_id", "TEXT");
  addColumnIfMissing(db, "runs", "workflow_snapshot", "TEXT");
  addColumnIfMissing(db, "runs", "queued_input", "TEXT");
  addColumnIfMissing(db, "runs", "creation_title", "TEXT");
  addColumnIfMissing(db, "runs", "reconciliation_pending", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "runs", "owner_identity", "TEXT");
  addColumnIfMissing(db, "runs", "pr_number", "INTEGER");
  addColumnIfMissing(db, "runs", "pr_url", "TEXT");
  addColumnIfMissing(db, "runs", "reconciled_at", "INTEGER");
  addColumnIfMissing(db, "runs", "ready_gate_repair_fence", "TEXT");
  addColumnIfMissing(db, "runs", "retained_finalization_checkpoint", "TEXT");
  addColumnIfMissing(db, "runs", "downstream_inputs", "TEXT");
  addColumnIfMissing(db, "runs", "finished_at", "INTEGER");
  addColumnIfMissing(db, "runs", "ready_gate_pgid", "INTEGER");
  addColumnIfMissing(db, "runs", "dismissed_at", "INTEGER");
  addColumnIfMissing(db, "runs", "terminal_cause", "TEXT");
  addColumnIfMissing(db, "runs", "terminal_failure_detail", "TEXT");
  if (!tableExists(db, "pipelines")) {
    db.exec(`
      CREATE TABLE pipelines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        definition TEXT NOT NULL
      );
      CREATE TABLE pipeline_stages (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
        stage_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        status TEXT NOT NULL,
        workflow_invocation_id TEXT,
        started_at INTEGER,
        ended_at INTEGER,
        artifact TEXT,
        failure_detail TEXT,
        UNIQUE (pipeline_id, stage_id),
        UNIQUE (pipeline_id, position)
      );
    `);
  }
  addColumnIfMissing(db, "pipelines", "owner_identity", "TEXT");
  addColumnIfMissing(db, "pipelines", "status", "TEXT NOT NULL DEFAULT 'active'");
  addColumnIfMissing(db, "pipelines", "context", "TEXT");
  addColumnIfMissing(db, "pipelines", "terminal_publication_failure", "TEXT");
  addColumnIfMissing(db, "pipelines", "terminal_publication_succeeded_at", "INTEGER");
  addColumnIfMissing(db, "pipelines", "dismissed_at", "INTEGER");
  upgradePipelineStagesBranchKey(db);
  addColumnIfMissing(db, "pipeline_stages", "decided_at", "INTEGER");
  if (!tableExists(db, "pipeline_stage_admission")) {
    db.exec(`
      CREATE TABLE pipeline_stage_admission (
        pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
        stage_id TEXT NOT NULL,
        branch_key TEXT NOT NULL,
        holder_identity TEXT NOT NULL,
        PRIMARY KEY (pipeline_id, stage_id, branch_key)
      );
    `);
  }
  if (!tableExists(db, "operator_notification_deliveries")) {
    db.exec(`
      CREATE TABLE operator_notification_deliveries (
        incident_id TEXT NOT NULL,
        transition TEXT NOT NULL,
        delivered_at INTEGER NOT NULL,
        PRIMARY KEY (incident_id, transition)
      );
    `);
  }
}

function hasLegacyEraMigrations(db: Database): boolean {
  const row = db.prepare("SELECT 1 FROM _migrations WHERE id != ? LIMIT 1").get(BASELINE_SQUASH_MIGRATION_ID);
  return row !== undefined && row !== null;
}

function applySchemaMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  const squashApplied = db.prepare("SELECT 1 FROM _migrations WHERE id = ?").get(BASELINE_SQUASH_MIGRATION_ID);
  if (squashApplied) return;

  if (hasLegacyEraMigrations(db)) {
    db.exec("BEGIN");
    try {
      upgradeFromLegacyEra(db);
      db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(
        BASELINE_SQUASH_MIGRATION_ID,
        Date.now(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return;
  }

  db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(BASELINE_SQUASH_MIGRATION_ID, Date.now());
}

const ORPHAN_STATUSES = "'queued', 'in-progress', 'paused', 'budget-soft-stopped'";

/** Run-column finish timestamp when no in-progress attempt carries reconciliation time. */
export function orphanSettlementReconciledAt(inProgressAttemptId: string | undefined, finishAt: number): number | null {
  return inProgressAttemptId === undefined ? finishAt : null;
}

/** Whether settlement should stamp attempt `completed_at` after a guarded run update. */
export function orphanSettlementShouldStampAttempt(
  runUpdateApplied: boolean,
  inProgressAttemptId: string | undefined,
): inProgressAttemptId is string {
  return runUpdateApplied && inProgressAttemptId !== undefined;
}

/** Stage statuses restart reconciliation leaves untouched; anything else is active. */
const RECONCILIATION_STABLE_STAGE_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "succeeded",
  "failed",
  "interrupted",
  "awaiting",
  "approved",
  "rejected",
  "skipped",
]);

const NON_ACTIVE_STAGE_STATUSES = [...RECONCILIATION_STABLE_STAGE_STATUSES].map((status) => `'${status}'`).join(", ");

/** Stage statuses that end candidacy for otherwise-terminal pipeline settlement-age filtering. */
const INCIDENT_CANDIDATE_STABLE_STAGE_STATUSES_SQL =
  "'succeeded','failed','interrupted','skipped','approved','rejected'";

const INCIDENT_CANDIDATE_FAN_OUT_ACTIVE_STAGE_STATUSES_SQL = "'pending','awaiting','running'";

const TERMINAL_RUN_STATUSES_SQL = [...TERMINAL_RUN_STATUSES].map((status) => `'${status}'`).join(", ");

const INCIDENT_CANDIDATE_PIPELINE_WHERE = `
  EXISTS (
    SELECT 1 FROM pipeline_stages ps
    WHERE ps.pipeline_id = p.id
      AND ps.status NOT IN (${INCIDENT_CANDIDATE_STABLE_STAGE_STATUSES_SQL})
  )
  OR (
    json_extract(p.definition, '$.terminalAction') IS NOT NULL
    AND p.terminal_publication_succeeded_at IS NULL
    AND p.terminal_publication_failure IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM pipeline_stages ps
      WHERE ps.pipeline_id = p.id
        AND ps.branch_key = '${DEFAULT_PIPELINE_STAGE_BRANCH_KEY}'
        AND ps.status NOT IN (${INCIDENT_CANDIDATE_STABLE_STAGE_STATUSES_SQL})
    )
  )
  OR EXISTS (
    SELECT 1 FROM pipeline_stages ps
    WHERE ps.pipeline_id = p.id
      AND ps.branch_key != '${DEFAULT_PIPELINE_STAGE_BRANCH_KEY}'
      AND ps.status IN (${INCIDENT_CANDIDATE_FAN_OUT_ACTIVE_STAGE_STATUSES_SQL})
  )
  OR (
    NOT EXISTS (
      SELECT 1 FROM pipeline_stages ps
      WHERE ps.pipeline_id = p.id
        AND ps.status NOT IN (${INCIDENT_CANDIDATE_STABLE_STAGE_STATUSES_SQL})
    )
    AND NOT (
      json_extract(p.definition, '$.terminalAction') IS NOT NULL
      AND p.terminal_publication_succeeded_at IS NULL
      AND p.terminal_publication_failure IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM pipeline_stages ps
        WHERE ps.pipeline_id = p.id
          AND ps.branch_key = '${DEFAULT_PIPELINE_STAGE_BRANCH_KEY}'
          AND ps.status NOT IN (${INCIDENT_CANDIDATE_STABLE_STAGE_STATUSES_SQL})
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM pipeline_stages ps
      WHERE ps.pipeline_id = p.id
        AND ps.branch_key != '${DEFAULT_PIPELINE_STAGE_BRANCH_KEY}'
        AND ps.status IN (${INCIDENT_CANDIDATE_FAN_OUT_ACTIVE_STAGE_STATUSES_SQL})
    )
    AND COALESCE(
      (SELECT MAX(COALESCE(ps.ended_at, ps.decided_at)) FROM pipeline_stages ps WHERE ps.pipeline_id = p.id),
      p.terminal_publication_succeeded_at,
      p.created_at
    ) >= ?
  )
`;

/** True when `reconcilePipelines` leaves a stage row untouched. */
export function reconciliationStableStageStatus(status: string): boolean {
  return RECONCILIATION_STABLE_STAGE_STATUSES.has(status);
}

/** Stage statuses that end a stage run; `updateStage` stamps `ended_at` on these. Decided-approval statuses (`approved`, `rejected`) end a gate decision, not a stage run, and are excluded. */
const TERMINAL_STAGE_STATUSES: ReadonlySet<string> = new Set(["succeeded", "failed", "interrupted", "skipped"]);

/** True when `status` is a terminal stage-run outcome. */
export function isTerminalStageStatus(status: string): boolean {
  return TERMINAL_STAGE_STATUSES.has(status);
}

/**
 * Derives `endedAt` for a stage lifecycle patch: a patch whose `status` is terminal and whose
 * `endedAt` is not already a number lands `endedAt = now`, overriding an explicit `null`.
 * Non-terminal and decided-approval statuses are unaffected; `startedAt` is never synthesized.
 */
export function stageLifecyclePatchWithTerminalFinish(patch: StageLifecyclePatch, now: number): StageLifecyclePatch {
  if (patch.status === undefined || !isTerminalStageStatus(patch.status)) return patch;
  if (typeof patch.endedAt === "number") return patch;
  return { ...patch, endedAt: now };
}

/** Probes whether the process recorded as a run's owner is still alive. */
export type OwnerLivenessProbe = (identity: string) => Promise<boolean>;

/** Bounds the `ps` probe so a hung or missing `ps` can't block module init indefinitely. */
const PS_PROBE_TIMEOUT_MS = 2000;

async function readProcessStartEpoch(pid: number): Promise<number | null> {
  try {
    const stdout = await realAsyncSubprocessRunner.runAsync("ps", ["-o", "lstart=", "-p", String(pid)], process.cwd(), {
      timeoutMs: PS_PROBE_TIMEOUT_MS,
    });
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    const epoch = Date.parse(trimmed);
    return Number.isNaN(epoch) ? null : epoch;
  } catch {
    return null;
  }
}

async function computeCurrentOwnerIdentity(): Promise<string> {
  const epoch = await readProcessStartEpoch(process.pid);
  return `${process.pid}:${epoch ?? 0}`;
}

/** This process's `<pid>:<start-epoch>` identity, captured once at module init. */
export const CURRENT_OWNER_IDENTITY = await computeCurrentOwnerIdentity();

/**
 * Default liveness probe: a recorded owner is alive iff its pid exists and that
 * pid's start epoch matches the recorded one. An existing pid whose epoch can't
 * be read is treated as alive (skip the row rather than risk killing a live run).
 */
export async function isOwnerAlive(
  identity: string,
  readStartEpoch: (pid: number) => Promise<number | null> = readProcessStartEpoch,
): Promise<boolean> {
  const [pidPart, epochPart] = identity.split(":");
  const pid = Number(pidPart);
  if (!Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    // ESRCH confirms the pid doesn't exist. Any other failure (e.g. EPERM, meaning the pid
    // exists but we can't signal it) is not confirmation of death, so treat as alive.
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    return true;
  }
  const currentEpoch = await readStartEpoch(pid);
  if (currentEpoch === null) return true;
  return currentEpoch === Number(epochPart);
}

function mapAttemptRow(row: Attempt & { invocationFailureDetailJson: string | null }): Attempt {
  const { invocationFailureDetailJson, ...attempt } = row;
  return {
    ...attempt,
    invocationFailureDetail:
      invocationFailureDetailJson === null
        ? null
        : (JSON.parse(invocationFailureDetailJson) as InvocationFailureDetail),
  };
}

type RunRow = Omit<
  Run,
  | "workflowSnapshot"
  | "queuedInput"
  | "readyGateRepairFence"
  | "readyGateRepairFenceCorrupt"
  | "retainedFinalizationCheckpoint"
  | "retainedFinalizationCheckpointCorrupt"
  | "downstreamInputs"
  | "terminalFailureDetail"
  | "terminalFailureDetailCorrupt"
> & {
  workflowSnapshotJson: string | null;
  queuedInputJson: string | null;
  readyGateRepairFenceJson: string | null;
  retainedFinalizationCheckpointJson: string | null;
  downstreamInputsJson: string | null;
  terminalFailureDetailJson: string | null;
};

function parseReadyGateRepairFenceProvenance(json: string | null): ReadyGateRepairFenceProvenance | null | "invalid" {
  if (json === null) return null;
  try {
    const parsed = JSON.parse(json) as ReadyGateRepairFenceProvenance;
    if (!Array.isArray(parsed.allowedPaths)) return "invalid";
    if (parsed.markdownOnly !== undefined && parsed.markdownOnly !== true) {
      return "invalid";
    }
    if (
      parsed.markdownOutputRoots !== undefined &&
      (!Array.isArray(parsed.markdownOutputRoots) ||
        parsed.markdownOutputRoots.length === 0 ||
        parsed.markdownOutputRoots.some((root) => typeof root !== "string"))
    ) {
      return "invalid";
    }
    if (parsed.outcomeKind !== "frozen" && parsed.outcomeKind !== "completion_commit_failed") {
      return "invalid";
    }
    return parsed;
  } catch {
    return "invalid";
  }
}

function parseTerminalFailureDetail(json: string | null): InvocationFailureDetail | null | "invalid" {
  if (json === null) return null;
  try {
    const parsed = JSON.parse(json) as InvocationFailureDetail;
    if (typeof parsed.failureKind !== "string" || !Array.isArray(parsed.bindingAttempts)) {
      return "invalid";
    }
    return parsed;
  } catch {
    return "invalid";
  }
}

function parseRetainedFinalizationCheckpoint(json: string | null): RetainedFinalizationCheckpoint | null | "invalid" {
  if (json === null) return null;
  try {
    const parsed = JSON.parse(json) as RetainedFinalizationCheckpoint;
    if (typeof parsed.completionAttemptId !== "string" || typeof parsed.completionAgent !== "string") {
      return "invalid";
    }
    return parsed;
  } catch {
    return "invalid";
  }
}

function mapRunRow(row: RunRow): Run {
  const {
    workflowSnapshotJson,
    queuedInputJson,
    readyGateRepairFenceJson,
    retainedFinalizationCheckpointJson,
    downstreamInputsJson,
    terminalFailureDetailJson,
    ...run
  } = row;
  const parsedFence = parseReadyGateRepairFenceProvenance(readyGateRepairFenceJson);
  const parsedCheckpoint = parseRetainedFinalizationCheckpoint(retainedFinalizationCheckpointJson);
  const parsedTerminalFailureDetail = parseTerminalFailureDetail(terminalFailureDetailJson);
  let downstreamInputs: readonly string[] | null | undefined;
  if (downstreamInputsJson !== null) {
    try {
      const parsed = JSON.parse(downstreamInputsJson) as unknown;
      downstreamInputs = Array.isArray(parsed) ? (parsed as string[]) : null;
    } catch {
      downstreamInputs = null;
    }
  }
  return {
    ...run,
    ...(downstreamInputs !== undefined ? { downstreamInputs } : {}),
    workflowSnapshot: workflowSnapshotJson === null ? null : (JSON.parse(workflowSnapshotJson) as WorkflowSnapshot),
    queuedInput: queuedInputJson === null ? null : (JSON.parse(queuedInputJson) as WriteLoopInput),
    readyGateRepairFence: parsedFence === "invalid" || parsedFence === null ? null : parsedFence,
    ...(parsedFence === "invalid" ? { readyGateRepairFenceCorrupt: true } : {}),
    retainedFinalizationCheckpoint:
      parsedCheckpoint === "invalid" || parsedCheckpoint === null ? null : parsedCheckpoint,
    ...(parsedCheckpoint === "invalid" ? { retainedFinalizationCheckpointCorrupt: true } : {}),
    terminalFailureDetail:
      parsedTerminalFailureDetail === "invalid" || parsedTerminalFailureDetail === null
        ? null
        : parsedTerminalFailureDetail,
    ...(parsedTerminalFailureDetail === "invalid" ? { terminalFailureDetailCorrupt: true } : {}),
  };
}

type PipelineRow = Omit<Pipeline, "definition" | "context" | "terminalPublicationFailure"> & {
  definitionJson: string;
  contextJson: string | null;
  terminalPublicationFailureJson: string | null;
};

function mapPipelineRow(row: PipelineRow): Pipeline {
  const { definitionJson, contextJson, terminalPublicationFailureJson, ...pipeline } = row;
  return {
    ...pipeline,
    definition: JSON.parse(definitionJson) as PipelineDefinition,
    context: contextJson === null ? null : (JSON.parse(contextJson) as PipelineContext),
    terminalPublicationFailure:
      terminalPublicationFailureJson === null
        ? null
        : (JSON.parse(terminalPublicationFailureJson) as PipelineTerminalPublicationFailure),
    terminalPublicationSucceededAt: pipeline.terminalPublicationSucceededAt ?? null,
    dismissedAt: pipeline.dismissedAt ?? null,
  };
}

type StageRow = Omit<PipelineStageRecord, "artifact" | "failureDetail"> & {
  artifactJson: string | null;
  failureDetailJson: string | null;
};

function mapStageRow(row: StageRow): PipelineStageRecord {
  const { artifactJson, failureDetailJson, ...stage } = row;
  return {
    ...stage,
    artifact: artifactJson === null ? null : (JSON.parse(artifactJson) as unknown),
    failureDetail: failureDetailJson === null ? null : (JSON.parse(failureDetailJson) as unknown),
  };
}

class PipelineReopenLostError extends Error {
  constructor() {
    super("pipeline reopen lost concurrent claim");
    this.name = "PipelineReopenLostError";
  }
}

class StateStoreImpl implements StateStore {
  private db: Database;
  private currentIdentity: string;
  private isOwnerAliveProbe: OwnerLivenessProbe;

  constructor(dbPath: string, overrides?: { currentIdentity?: string; isOwnerAlive?: OwnerLivenessProbe }) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA);
    this.db.exec(`PRAGMA busy_timeout=${STATE_STORE_BUSY_TIMEOUT_MS}`);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA foreign_keys=ON");
    applySchemaMigrations(this.db);
    this.currentIdentity = overrides?.currentIdentity ?? CURRENT_OWNER_IDENTITY;
    this.isOwnerAliveProbe = overrides?.isOwnerAlive ?? isOwnerAlive;
  }

  createRun(args: {
    project: string;
    specRef: string;
    worktreePath: string;
    branch: string;
    specPath: string;
    creationTitle?: string;
    stepId?: string;
    workflowSnapshot?: WorkflowSnapshot;
    status?: RunStatus;
    queuedInput?: WriteLoopInput;
  }): string {
    const id = crypto.randomUUID();
    const workflowSnapshotJson = args.workflowSnapshot === undefined ? null : JSON.stringify(args.workflowSnapshot);
    const queuedInputJson = args.queuedInput === undefined ? null : JSON.stringify(args.queuedInput);
    this.db
      .prepare(`
        INSERT INTO runs (
          id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path, step_id, workflow_snapshot, queued_input, creation_title, owner_identity
        )
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        args.project,
        args.specRef,
        Date.now(),
        args.status ?? "in-progress",
        args.worktreePath,
        args.branch,
        args.specPath,
        args.stepId ?? null,
        workflowSnapshotJson,
        queuedInputJson,
        args.creationTitle ?? null,
        this.currentIdentity,
      );
    return id;
  }

  setCreationTitle(runId: string, title: string): void {
    this.db.prepare("UPDATE runs SET creation_title = ? WHERE id = ?").run(title, runId);
  }

  setRunSpecPath(runId: string, specPath: string): void {
    this.db.prepare("UPDATE runs SET spec_path = ? WHERE id = ?").run(specPath, runId);
  }

  setRunDownstreamInputs(runId: string, downstreamInputs: readonly string[]): void {
    this.db.prepare("UPDATE runs SET downstream_inputs = ? WHERE id = ?").run(JSON.stringify(downstreamInputs), runId);
  }

  clearRunDownstreamInputs(runId: string): void {
    this.db.prepare("UPDATE runs SET downstream_inputs = NULL WHERE id = ?").run(runId);
  }

  setPrEvidence(runId: string, prNumber: number, prUrl: string): void {
    this.db.prepare("UPDATE runs SET pr_number = ?, pr_url = ? WHERE id = ?").run(prNumber, prUrl, runId);
  }

  setReadyGatePgid(runId: string, pgid: number | null): void {
    if (pgid === null) {
      this.db.prepare("UPDATE runs SET ready_gate_pgid = NULL WHERE id = ?").run(runId);
    }
    if (pgid !== null) {
      this.db.prepare("UPDATE runs SET ready_gate_pgid = ? WHERE id = ?").run(pgid, runId);
    }
  }

  async listReadyGateSweepCandidates(): Promise<
    ReadonlyArray<{ runId: string; readyGatePgid: number; ownerLive: boolean }>
  > {
    const candidates = this.db
      .prepare(
        "SELECT id, owner_identity AS ownerIdentity, ready_gate_pgid AS readyGatePgid FROM runs WHERE ready_gate_pgid IS NOT NULL",
      )
      .all() as Array<{ id: string; ownerIdentity: string | null; readyGatePgid: number }>;

    const aliveByIdentity = new Map<string, boolean>();
    const result: Array<{ runId: string; readyGatePgid: number; ownerLive: boolean }> = [];
    for (const candidate of candidates) {
      let ownerLive = false;
      if (candidate.ownerIdentity !== null) {
        let alive = aliveByIdentity.get(candidate.ownerIdentity);
        if (alive === undefined) {
          alive = await this.isOwnerAliveProbe(candidate.ownerIdentity);
          aliveByIdentity.set(candidate.ownerIdentity, alive);
        }
        ownerLive = alive;
      }
      result.push({ runId: candidate.id, readyGatePgid: candidate.readyGatePgid, ownerLive });
    }
    return result;
  }

  setReadyGateRepairFence(runId: string, fence: ReadyGateRepairFenceProvenance): void {
    this.db.prepare("UPDATE runs SET ready_gate_repair_fence = ? WHERE id = ?").run(JSON.stringify(fence), runId);
  }

  setRetainedFinalizationCheckpoint(runId: string, checkpoint: RetainedFinalizationCheckpoint): void {
    this.db
      .prepare("UPDATE runs SET retained_finalization_checkpoint = ? WHERE id = ?")
      .run(JSON.stringify(checkpoint), runId);
  }

  loadRun(runId: string): (Run & { attempts: Attempt[] }) | null {
    const runRow = this.db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`).get(runId) as RunRow | null;
    const run = runRow === null ? null : mapRunRow(runRow);
    if (!run) return null;

    const attempts = (
      this.db
        .prepare(`SELECT ${ATTEMPT_COLUMNS} FROM attempts WHERE run_id = ? ORDER BY attempt_number ASC`)
        .all(runId) as Array<Attempt & { invocationFailureDetailJson: string | null }>
    ).map(mapAttemptRow);

    return { ...run, attempts };
  }

  loadRunsByIds(runIds: readonly string[]): Array<Run & { attempts: Attempt[] }> {
    if (runIds.length === 0) return [];

    const uniqueIds = [...new Set(runIds)];
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const runRows = this.db
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id IN (${placeholders})`)
      .all(...uniqueIds) as RunRow[];
    if (runRows.length === 0) return [];

    const foundIds = runRows.map((row) => row.id);
    const attemptPlaceholders = foundIds.map(() => "?").join(", ");
    const attemptRows = this.db
      .prepare(
        `SELECT ${ATTEMPT_COLUMNS} FROM attempts WHERE run_id IN (${attemptPlaceholders}) ORDER BY attempt_number ASC`,
      )
      .all(...foundIds) as Array<Attempt & { invocationFailureDetailJson: string | null }>;

    const attemptsByRunId = new Map<string, Attempt[]>();
    for (const row of attemptRows) {
      const attempt = mapAttemptRow(row);
      const existing = attemptsByRunId.get(attempt.runId);
      if (existing) {
        existing.push(attempt);
      } else {
        attemptsByRunId.set(attempt.runId, [attempt]);
      }
    }

    return runRows.map((row) => {
      const run = mapRunRow(row);
      return { ...run, attempts: attemptsByRunId.get(run.id) ?? [] };
    });
  }

  findRunByProjectBranch(args: {
    project: string;
    branch: string;
    stepId: string | null;
  }): (Run & { attempts: Attempt[] }) | null {
    let query: string;
    let params: (string | null)[];

    if (args.stepId !== null) {
      query =
        "SELECT id FROM runs WHERE project = ? AND branch = ? AND step_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1";
      params = [args.project, args.branch, args.stepId];
    } else {
      query =
        "SELECT id FROM runs WHERE project = ? AND branch = ? AND step_id IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1";
      params = [args.project, args.branch];
    }

    const row = this.db.prepare(query).get(...params) as { id: string } | null;
    return row === null ? null : this.loadRun(row.id);
  }

  findReviewMutationLineageRows(args: { project: string; branch: string }): Run[] {
    return (
      this.db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM runs WHERE project = ? AND branch = ? ORDER BY created_at DESC, rowid DESC`,
        )
        .all(args.project, args.branch) as RunRow[]
    ).map(mapRunRow);
  }

  findRunsByInvocationId(invocationId: string): Run[] {
    return (
      this.db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM runs WHERE workflow_snapshot IS NOT NULL AND json_extract(workflow_snapshot, '$.invocationId') = ? ORDER BY created_at ASC`,
        )
        .all(invocationId) as RunRow[]
    ).map(mapRunRow);
  }

  findRunsByInvocationIds(invocationIds: readonly string[]): Run[] {
    if (invocationIds.length === 0) return [];

    const uniqueIds = [...new Set(invocationIds)];
    const placeholders = uniqueIds.map(() => "?").join(", ");
    return (
      this.db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM runs WHERE workflow_snapshot IS NOT NULL AND json_extract(workflow_snapshot, '$.invocationId') IN (${placeholders}) ORDER BY created_at ASC`,
        )
        .all(...uniqueIds) as RunRow[]
    ).map(mapRunRow);
  }

  createPipeline(args: {
    definition: PipelineDefinition;
    context?: PipelineContext;
    beforeStageInsert?: (stageIndex: number) => void;
  }): string {
    const pipelineId = crypto.randomUUID();
    const definitionJson = JSON.stringify(args.definition);
    const contextJson = args.context === undefined ? null : JSON.stringify(args.context);

    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO pipelines (id, name, created_at, owner_identity, status, definition, context) VALUES (?, ?, ?, ?, 'active', ?, ?)",
        )
        .run(pipelineId, args.definition.name, Date.now(), this.currentIdentity, definitionJson, contextJson);

      args.definition.stages.forEach((stage, index) => {
        args.beforeStageInsert?.(index);
        this.db
          .prepare(INSERT_PIPELINE_STAGE_SQL)
          .run(crypto.randomUUID(), pipelineId, stage.stageId, DEFAULT_PIPELINE_STAGE_BRANCH_KEY, index);
      });
    })();

    return pipelineId;
  }

  loadPipeline(pipelineId: string): (Pipeline & { stages: PipelineStageRecord[] }) | null {
    const pipelineRow = this.db
      .prepare(`SELECT ${PIPELINE_COLUMNS} FROM pipelines WHERE id = ?`)
      .get(pipelineId) as PipelineRow | null;
    if (pipelineRow === null) return null;

    return { ...mapPipelineRow(pipelineRow), stages: this.loadPipelineStages(pipelineId) };
  }

  listPipelines(): Array<Pipeline & { stages: PipelineStageRecord[] }> {
    const pipelines = this.db.prepare(`SELECT ${PIPELINE_COLUMNS} FROM pipelines`).all() as PipelineRow[];
    return pipelines.map((pipelineRow) => ({
      ...mapPipelineRow(pipelineRow),
      stages: this.loadPipelineStages(pipelineRow.id),
    }));
  }

  private loadPipelineStages(pipelineId: string): PipelineStageRecord[] {
    return (
      this.db
        .prepare(
          `SELECT ${STAGE_COLUMNS} FROM pipeline_stages WHERE pipeline_id = ? ORDER BY position ASC, ${PIPELINE_STAGE_BRANCH_KEY_TIE_ORDER_SQL}`,
        )
        .all(pipelineId) as StageRow[]
    ).map(mapStageRow);
  }

  createPipelineStageBranch(args: { pipelineId: string; stageId: string; branchKey: string }): string {
    if (this.db.prepare("SELECT 1 FROM pipelines WHERE id = ?").get(args.pipelineId) === null) {
      throw new Error(`Pipeline ${args.pipelineId} not found`);
    }

    const defaultSibling = this.db
      .prepare("SELECT position FROM pipeline_stages WHERE pipeline_id = ? AND stage_id = ? AND branch_key = ?")
      .get(args.pipelineId, args.stageId, DEFAULT_PIPELINE_STAGE_BRANCH_KEY) as { position: number } | null;
    if (defaultSibling === null) {
      throw new Error(`Stage ${args.stageId} not found in pipeline ${args.pipelineId}`);
    }

    const id = crypto.randomUUID();
    try {
      this.db
        .prepare(INSERT_PIPELINE_STAGE_SQL)
        .run(id, args.pipelineId, args.stageId, args.branchKey, defaultSibling.position);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new Error(
          `Branch ${args.branchKey} already exists for stage ${args.stageId} in pipeline ${args.pipelineId}`,
        );
      }
      throw error;
    }
    return id;
  }

  commitApprovalBoundary(args: { stageRecordId: string }): ApprovalOperationOutcome {
    return this.commitApprovalTransition({
      stageRecordId: args.stageRecordId,
      requiredStatus: "pending",
      refusalReason: "status_not_pending",
      nextStatus: "awaiting",
      decidedAt: null,
    });
  }

  commitApprovalDecision(args: { stageRecordId: string; decision: ApprovalDecision }): ApprovalOperationOutcome {
    if (args.decision !== "approved" && args.decision !== "rejected") {
      return { kind: "refused", stageRecordId: args.stageRecordId, reason: "invalid_decision" };
    }
    return this.commitApprovalTransition({
      stageRecordId: args.stageRecordId,
      requiredStatus: "awaiting",
      refusalReason: "status_not_awaiting",
      nextStatus: args.decision,
      decidedAt: Date.now(),
    });
  }

  claimPipelineContinuation(args: {
    pipelineId: string;
    priorOwnerIdentity: string | null;
  }): PipelineContinuationOutcome {
    const pipeline = this.loadPipeline(args.pipelineId);
    if (pipeline === null) {
      return { kind: "refused", pipelineId: args.pipelineId, reason: "pipeline_not_found" };
    }
    if (pipeline.status !== "active" && pipeline.status !== "interrupted") {
      return { kind: "refused", pipelineId: args.pipelineId, reason: "not_active" };
    }
    if (pipeline.ownerIdentity !== args.priorOwnerIdentity) {
      return { kind: "refused", pipelineId: args.pipelineId, reason: "stale_owner" };
    }
    if (pipeline.ownerIdentity === this.currentIdentity && pipeline.status === "active") {
      return { kind: "applied", pipelineId: args.pipelineId };
    }

    const result =
      args.priorOwnerIdentity === null
        ? this.db
            .prepare(
              `UPDATE pipelines SET owner_identity = ?, status = 'active'
               WHERE id = ? AND status IN ('active', 'interrupted') AND owner_identity IS NULL`,
            )
            .run(this.currentIdentity, args.pipelineId)
        : this.db
            .prepare(
              `UPDATE pipelines SET owner_identity = ?, status = 'active'
               WHERE id = ? AND status IN ('active', 'interrupted') AND owner_identity = ?`,
            )
            .run(this.currentIdentity, args.pipelineId, args.priorOwnerIdentity);
    if (result.changes === 0) {
      return { kind: "refused", pipelineId: args.pipelineId, reason: "claim_lost" };
    }
    return { kind: "applied", pipelineId: args.pipelineId };
  }

  claimPipelineStageAdmission(args: {
    pipelineId: string;
    stageId: string;
    branchKey?: string;
  }): PipelineStageAdmissionClaimOutcome {
    const branchKey = args.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
    try {
      this.db
        .prepare(
          `INSERT INTO pipeline_stage_admission (pipeline_id, stage_id, branch_key, holder_identity)
           VALUES (?, ?, ?, ?)`,
        )
        .run(args.pipelineId, args.stageId, branchKey, this.currentIdentity);
      return { kind: "applied" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "SQLITE_CONSTRAINT_PRIMARYKEY") {
        throw error;
      }
      return { kind: "refused", reason: "claim_lost" };
    }
  }

  releasePipelineStageAdmission(args: {
    pipelineId: string;
    stageId: string;
    branchKey?: string;
  }): PipelineStageAdmissionReleaseOutcome {
    const branchKey = args.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
    const holder = this.pipelineStageAdmissionHolder(args.pipelineId, args.stageId, branchKey);
    if (holder === null) return { kind: "applied" };
    if (holder !== this.currentIdentity) return { kind: "refused", reason: "stale_holder" };
    this.db
      .prepare(
        `DELETE FROM pipeline_stage_admission
         WHERE pipeline_id = ? AND stage_id = ? AND branch_key = ? AND holder_identity = ?`,
      )
      .run(args.pipelineId, args.stageId, branchKey, this.currentIdentity);
    return { kind: "applied" };
  }

  loadPipelineStageAdmission(args: {
    pipelineId: string;
    stageId: string;
    branchKey?: string;
  }): PipelineStageAdmissionLoadOutcome {
    const branchKey = args.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
    const holder = this.pipelineStageAdmissionHolder(args.pipelineId, args.stageId, branchKey);
    if (holder === null) return { kind: "absent" };
    return { kind: "present", holderIdentity: holder };
  }

  private pipelineStageAdmissionHolder(pipelineId: string, stageId: string, branchKey: string): string | null {
    const row = this.db
      .prepare(
        `SELECT holder_identity AS holderIdentity
         FROM pipeline_stage_admission
         WHERE pipeline_id = ? AND stage_id = ? AND branch_key = ?`,
      )
      .get(pipelineId, stageId, branchKey) as { holderIdentity: string } | undefined;
    return row?.holderIdentity ?? null;
  }

  reopenFailedPipeline(args: { pipelineId: string; branchKey?: string }): PipelineReopenOutcome {
    const pipeline = this.loadPipeline(args.pipelineId);
    if (pipeline === null) {
      return { kind: "refused", pipelineId: args.pipelineId, reason: "pipeline_not_found" };
    }

    const branchKey = args.branchKey;
    const shape = analyzeFailedPipelineReopenShape(pipeline.stages, branchKey);
    if (shape.kind === "invalid") {
      return { kind: "refused", pipelineId: args.pipelineId, reason: shape.reason };
    }

    try {
      return this.db.transaction((): PipelineReopenOutcome => {
        const freshStages = this.loadPipelineStages(args.pipelineId);
        const freshShape = analyzeFailedPipelineReopenShape(freshStages, branchKey);
        if (freshShape.kind === "invalid") {
          return { kind: "refused", pipelineId: args.pipelineId, reason: freshShape.reason };
        }

        const reopenLifecycle = this.db.prepare(`
        UPDATE pipeline_stages
        SET status = 'pending',
            workflow_invocation_id = NULL,
            started_at = NULL,
            ended_at = NULL,
            artifact = NULL,
            decided_at = NULL,
            failure_detail = NULL
        WHERE id = ? AND status = ?
      `);

        const failedResult = reopenLifecycle.run(freshShape.failedStageRecordId, "failed");
        if (failedResult.changes === 0) {
          return { kind: "refused", pipelineId: args.pipelineId, reason: "reopen_lost" };
        }

        for (const suffixStageRecordId of freshShape.suffixStageRecordIds) {
          const suffixResult = reopenLifecycle.run(suffixStageRecordId, "skipped");
          if (suffixResult.changes === 0) {
            throw new PipelineReopenLostError();
          }
        }

        return { kind: "applied", stageRecordId: freshShape.failedStageRecordId };
      })();
    } catch (error) {
      if (error instanceof PipelineReopenLostError) {
        return { kind: "refused", pipelineId: args.pipelineId, reason: "reopen_lost" };
      }
      throw error;
    }
  }

  commitTerminalPublicationFailure(args: {
    pipelineId: string;
    terminalAction: PipelineTerminalAction;
    failure: PublicationFailure;
    prNumber?: number;
    prUrl?: string;
  }): void {
    const payload: PipelineTerminalPublicationFailure = {
      terminalAction: args.terminalAction,
      failure: args.failure,
      ...(args.prNumber !== undefined ? { prNumber: args.prNumber } : {}),
      ...(args.prUrl !== undefined ? { prUrl: args.prUrl } : {}),
    };
    this.db
      .prepare(
        `UPDATE pipelines
         SET terminal_publication_failure = ?
         WHERE id = ?
           AND terminal_publication_failure IS NULL
           AND terminal_publication_succeeded_at IS NULL`,
      )
      .run(JSON.stringify(payload), args.pipelineId);
  }

  commitTerminalPublicationSuccess(args: { pipelineId: string }): void {
    this.db
      .prepare(
        `UPDATE pipelines
         SET terminal_publication_succeeded_at = ?
         WHERE id = ?
           AND terminal_publication_succeeded_at IS NULL
           AND terminal_publication_failure IS NULL`,
      )
      .run(Date.now(), args.pipelineId);
  }

  private pipelineRowExists(pipelineId: string): boolean {
    return this.db.prepare("SELECT 1 FROM pipelines WHERE id = ?").get(pipelineId) !== null;
  }

  dismissPipeline(args: { pipelineId: string }): PipelineDismissalOutcome {
    if (!this.pipelineRowExists(args.pipelineId)) {
      return { kind: "refused", pipelineId: args.pipelineId, reason: "pipeline_not_found" };
    }
    const dismissedAt = Date.now();
    this.db
      .prepare("UPDATE pipelines SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL")
      .run(dismissedAt, args.pipelineId);
    return { kind: "applied", pipelineId: args.pipelineId };
  }

  undismissPipeline(args: { pipelineId: string }): PipelineDismissalOutcome {
    if (!this.pipelineRowExists(args.pipelineId)) {
      return { kind: "refused", pipelineId: args.pipelineId, reason: "pipeline_not_found" };
    }
    this.db.prepare("UPDATE pipelines SET dismissed_at = NULL WHERE id = ?").run(args.pipelineId);
    return { kind: "applied", pipelineId: args.pipelineId };
  }

  private commitApprovalTransition(args: {
    stageRecordId: string;
    requiredStatus: string;
    refusalReason: Extract<ApprovalRefusalReason, "status_not_pending" | "status_not_awaiting">;
    nextStatus: string;
    decidedAt: number | null;
  }): ApprovalOperationOutcome {
    const stage = this.loadStageById(args.stageRecordId);
    if (stage === null) {
      return { kind: "refused", stageRecordId: args.stageRecordId, reason: "stage_not_found" };
    }

    const pipelineRow = this.db
      .prepare(`SELECT ${PIPELINE_COLUMNS} FROM pipelines WHERE id = ?`)
      .get(stage.pipelineId) as PipelineRow | null;
    if (pipelineRow === null || !isApprovalAuthoredStage(stage.stageId, mapPipelineRow(pipelineRow).definition)) {
      return { kind: "refused", stageRecordId: args.stageRecordId, reason: "not_approval_stage" };
    }

    if (stage.status !== args.requiredStatus) {
      return { kind: "refused", stageRecordId: args.stageRecordId, reason: args.refusalReason };
    }

    const result = this.db
      .prepare(`UPDATE pipeline_stages SET status = ?, decided_at = ? WHERE id = ? AND status = ?`)
      .run(args.nextStatus, args.decidedAt, args.stageRecordId, args.requiredStatus);
    if (result.changes === 0) {
      return { kind: "refused", stageRecordId: args.stageRecordId, reason: args.refusalReason };
    }

    return { kind: "applied", stageRecordId: args.stageRecordId };
  }

  private loadStageById(stageRecordId: string): PipelineStageRecord | null {
    const row = this.db
      .prepare(`SELECT ${STAGE_COLUMNS} FROM pipeline_stages WHERE id = ?`)
      .get(stageRecordId) as StageRow | null;
    return row === null ? null : mapStageRow(row);
  }

  updateStage(args: { pipelineId: string; stageId: string; branchKey?: string; patch: StageLifecyclePatch }): void {
    const branchKey = args.branchKey ?? DEFAULT_PIPELINE_STAGE_BRANCH_KEY;
    const patch = stageLifecyclePatchWithTerminalFinish(args.patch, Date.now());
    const keys = (Object.keys(patch) as (keyof StageLifecyclePatch)[]).filter((key) => patch[key] !== undefined);
    if (keys.length === 0) {
      throw new Error("Stage lifecycle patch must include at least one field");
    }

    const columnByField: Record<keyof StageLifecyclePatch, string> = {
      status: "status",
      workflowInvocationId: "workflow_invocation_id",
      startedAt: "started_at",
      endedAt: "ended_at",
      artifact: "artifact",
      failureDetail: "failure_detail",
    };

    const setClauses: string[] = [];
    const params: SQLQueryBindings[] = [];
    for (const key of keys) {
      const rawValue = patch[key];
      const value =
        (key === "artifact" || key === "failureDetail") && rawValue !== null ? JSON.stringify(rawValue) : rawValue;
      setClauses.push(`${columnByField[key]} = ?`);
      params.push(value as SQLQueryBindings);
    }
    params.push(args.pipelineId, args.stageId, branchKey);

    const result = this.db
      .prepare(
        `UPDATE pipeline_stages SET ${setClauses.join(", ")} WHERE pipeline_id = ? AND stage_id = ? AND branch_key = ?`,
      )
      .run(...params);
    if (result.changes === 0) {
      throw new Error(`Stage ${args.stageId} (branch ${branchKey}) not found in pipeline ${args.pipelineId}`);
    }
  }

  settleLinkedStagesFromEntryRun(entryRunId: string): void {
    this.db.transaction(() => {
      const entryRun = this.loadRun(entryRunId);
      if (entryRun === null) return;

      const workflowSnapshot = entryRun.workflowSnapshot ?? null;
      const siblingRuns = workflowSnapshot === null ? [] : this.findRunsByInvocationId(workflowSnapshot.invocationId);
      const rollupStatus = rollupWorkflowRunStatus({
        entryRun,
        workflowSnapshot,
        siblingRuns,
        isLive: false,
      });
      if (!isTerminalRunStatus(rollupStatus)) return;

      const stages = this.db
        .prepare(`SELECT ${STAGE_COLUMNS} FROM pipeline_stages WHERE workflow_invocation_id = ? AND status = 'running'`)
        .all(entryRunId) as StageRow[];
      const endedAt = Date.now();
      for (const stageRow of stages) {
        const stage = mapStageRow(stageRow);
        if (rollupStatus !== "completed") {
          this.settleRunningStage(stage.id, "failed", endedAt, undefined, stageFailureDetailFromEntryRun(entryRun));
          continue;
        }

        const pipeline = this.loadPipeline(stage.pipelineId);
        const requiresPrEvidence =
          pipeline !== null && this.terminalPublicationStageRequiresPrEvidence(pipeline.definition, stage.stageId);
        const missingPrEvidence = requiresPrEvidence && (entryRun.prNumber == null || entryRun.prUrl == null);
        if (entryRun.specPath.length === 0 || missingPrEvidence) {
          this.settleRunningStage(
            stage.id,
            "failed",
            endedAt,
            undefined,
            entryRun.specPath.length === 0
              ? {
                  message: `pipeline-stage-dispatch: entry run ${entryRunId} completed without a recorded spec path`,
                }
              : {
                  code: "completion_publication_missing_pr_evidence",
                  message: `completion publication left no confirmed PR evidence on linked entry run ${entryRunId}`,
                },
          );
          continue;
        }

        this.settleRunningStage(stage.id, "succeeded", endedAt, stageArtifactFromEntryRun(entryRunId, entryRun), null);
      }
    })();
  }

  private terminalPublicationStageRequiresPrEvidence(definition: PipelineDefinition, stageId: string): boolean {
    if (definition.terminalAction !== "ready" && definition.terminalAction !== "merge") return false;
    for (let index = definition.stages.length - 1; index >= 0; index -= 1) {
      const stage = definition.stages[index];
      if (stage?.kind !== "workflow") continue;
      return stage.stageId === stageId;
    }
    return false;
  }

  private settleRunningStage(
    stageRecordId: string,
    status: "succeeded" | "failed",
    endedAt: number,
    artifact: unknown | undefined,
    failureDetail: unknown,
  ): void {
    this.db
      .prepare(
        `UPDATE pipeline_stages SET status = ?, ended_at = ?, artifact = COALESCE(?, artifact), failure_detail = ? WHERE id = ? AND status = 'running'`,
      )
      .run(
        status,
        endedAt,
        artifact === undefined ? null : JSON.stringify(artifact),
        failureDetail === null ? null : JSON.stringify(failureDetail),
        stageRecordId,
      );
  }

  recordAttemptStart(runId: string): string {
    if (this.db.prepare("SELECT 1 FROM runs WHERE id = ?").get(runId) === null) {
      throw new Error(`Run ${runId} not found`);
    }

    const { total } = this.db.prepare("SELECT COUNT(*) AS total FROM attempts WHERE run_id = ?").get(runId) as {
      total: number;
    };
    const attemptId = crypto.randomUUID();
    this.db
      .prepare(
        "INSERT INTO attempts (id, run_id, attempt_number, started_at, status) VALUES (?, ?, ?, ?, 'in-progress')",
      )
      .run(attemptId, runId, total + 1, Date.now());
    return attemptId;
  }

  commitCompletionBoundary(args: CommitCompletionBoundaryInput): void {
    this.db.transaction(() => {
      const attempt = this.db
        .prepare("SELECT run_id AS runId, outcome_kind AS outcomeKind FROM attempts WHERE id = ?")
        .get(args.attemptId) as { runId: string; outcomeKind: OutcomeKind | null } | null;
      if (!attempt) throw new Error(`Attempt ${args.attemptId} not found`);
      if (attempt.outcomeKind !== null) return; // already committed: idempotent no-op

      const detailJson =
        (args.outcomeKind === "invocation_failure" || args.outcomeKind === "idle_output_timeout") &&
        args.invocationFailureDetail !== undefined
          ? JSON.stringify(args.invocationFailureDetail)
          : null;

      this.db
        .prepare(
          "UPDATE attempts SET status = 'completed', outcome_kind = ?, completed_at = ?, invocation_failure_detail = ?, completion_agent = ?, completion_review_pass = ? WHERE id = ?",
        )
        .run(
          args.outcomeKind,
          Date.now(),
          detailJson,
          args.completionAgent?.trim() || null,
          args.completionReviewPass ?? null,
          args.attemptId,
        );

      args.beforeRunUpdate?.();

      const settlementEvidence = this.extractTerminalSettlementEvidence(args);
      if (isTerminalRunStatus(args.runStatus) && settlementEvidence !== undefined) {
        this.validateTerminalCause(settlementEvidence.terminalCause);
        const finishedAt = Date.now();
        this.db
          .prepare("UPDATE runs SET attempt_count = attempt_count + 1, status = ?, finished_at = ? WHERE id = ?")
          .run(args.runStatus, finishedAt, attempt.runId);
        this.writeTerminalSettlementEvidence(attempt.runId, settlementEvidence);
        return;
      }

      this.db
        .prepare("UPDATE runs SET attempt_count = attempt_count + 1, status = ? WHERE id = ?")
        .run(args.runStatus, attempt.runId);
    })();
  }

  setRunStatus(runId: string, status: RunStatus): void {
    const finishedAt = isTerminalRunStatus(status) ? Date.now() : null;
    this.db.prepare("UPDATE runs SET status = ?, finished_at = ? WHERE id = ?").run(status, finishedAt, runId);
  }

  commitGuardedKill(runId: string): void {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: RunStatus } | null;
      if (!row) throw new Error(`Run ${runId} not found`);
      if (isBoundaryTerminalRunStatus(row.status)) return;
      const finishedAt = Date.now();
      this.db.prepare("UPDATE runs SET status = 'killed', finished_at = ? WHERE id = ?").run(finishedAt, runId);
    })();
  }

  commitTerminalRunSettlement(args: CommitTerminalRunSettlementInput): void {
    if (!isTerminalRunStatus(args.status)) {
      throw new Error(`Terminal run settlement requires a terminal status: ${args.status}`);
    }
    this.validateTerminalCause(args.terminalCause);

    const applySettlement = () => {
      if (!this.runRowExists(args.runId)) throw new Error(`Run ${args.runId} not found`);

      const finishedAt = Date.now();
      this.db
        .prepare("UPDATE runs SET status = ?, finished_at = ? WHERE id = ?")
        .run(args.status, finishedAt, args.runId);

      this.writeTerminalSettlementEvidence(args.runId, args);
    };

    this.db.transaction(applySettlement)();
  }

  private extractTerminalSettlementEvidence(
    args: TerminalRunSettlementEvidence,
  ): TerminalRunSettlementEvidence | undefined {
    if (
      args.terminalCause === undefined &&
      args.prNumber === undefined &&
      args.prUrl === undefined &&
      args.terminalFailureDetail === undefined
    ) {
      return undefined;
    }
    return {
      ...(args.terminalCause !== undefined ? { terminalCause: args.terminalCause } : {}),
      ...(args.prNumber !== undefined ? { prNumber: args.prNumber } : {}),
      ...(args.prUrl !== undefined ? { prUrl: args.prUrl } : {}),
      ...(args.terminalFailureDetail !== undefined ? { terminalFailureDetail: args.terminalFailureDetail } : {}),
    };
  }

  private validateTerminalCause(terminalCause: WriteLoopOutcomeKind | null | undefined): void {
    if (terminalCause !== undefined && terminalCause !== null && !isWriteLoopOutcomeKind(terminalCause)) {
      throw new Error(`Invalid terminal cause: ${String(terminalCause)}`);
    }
  }

  private writeTerminalSettlementEvidence(
    runId: string,
    args: TerminalRunSettlementEvidence & { beforeSecondWrite?: () => void },
  ): void {
    args.beforeSecondWrite?.();

    const evidenceSets: string[] = [];
    const evidenceValues: SQLQueryBindings[] = [];
    for (const [column, value] of [
      ["terminal_cause", args.terminalCause],
      ["pr_number", args.prNumber],
      ["pr_url", args.prUrl],
      [
        "terminal_failure_detail",
        args.terminalFailureDetail === undefined
          ? undefined
          : args.terminalFailureDetail === null
            ? null
            : JSON.stringify(args.terminalFailureDetail),
      ],
    ] as const) {
      if (value !== undefined) {
        evidenceSets.push(`${column} = ?`);
        evidenceValues.push(value);
      }
    }
    if (evidenceSets.length === 0) evidenceSets.push("finished_at = finished_at");
    this.db.prepare(`UPDATE runs SET ${evidenceSets.join(", ")} WHERE id = ?`).run(...evidenceValues, runId);
  }

  private runRowExists(runId: string): boolean {
    return this.db.prepare("SELECT 1 FROM runs WHERE id = ?").get(runId) !== null;
  }

  dismissRun(runId: string): RunDismissalOutcome {
    if (!this.runRowExists(runId)) {
      return { kind: "refused", runId, reason: "run_not_found" };
    }
    const dismissedAt = Date.now();
    this.db.prepare("UPDATE runs SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL").run(dismissedAt, runId);
    return { kind: "applied", runId };
  }

  undismissRun(runId: string): RunDismissalOutcome {
    if (!this.runRowExists(runId)) {
      return { kind: "refused", runId, reason: "run_not_found" };
    }
    this.db.prepare("UPDATE runs SET dismissed_at = NULL WHERE id = ?").run(runId);
    return { kind: "applied", runId };
  }

  async forceKillOwnerAdmits(runId: string): Promise<boolean> {
    const row = this.db.prepare("SELECT owner_identity AS ownerIdentity FROM runs WHERE id = ?").get(runId) as {
      ownerIdentity: string | null;
    } | null;
    if (!row || row.ownerIdentity === null || row.ownerIdentity === this.currentIdentity) return true;
    return !(await this.isOwnerAliveProbe(row.ownerIdentity));
  }

  async beginRunReconciliation(): Promise<string[]> {
    const candidates = this.db
      .prepare(
        `SELECT id, owner_identity AS ownerIdentity FROM runs WHERE status IN (${ORPHAN_STATUSES}) AND reconciliation_pending = 0`,
      )
      .all() as Array<{
      id: string;
      ownerIdentity: string | null;
    }>;

    const orphaned: typeof candidates = [];
    const aliveByIdentity = new Map<string, boolean>();
    for (const candidate of candidates) {
      if (candidate.ownerIdentity === null) {
        orphaned.push(candidate);
        continue;
      }
      if (candidate.ownerIdentity === this.currentIdentity) continue;
      let alive = aliveByIdentity.get(candidate.ownerIdentity);
      if (alive === undefined) {
        alive = await this.isOwnerAliveProbe(candidate.ownerIdentity);
        aliveByIdentity.set(candidate.ownerIdentity, alive);
      }
      if (!alive) orphaned.push(candidate);
    }

    return this.db.transaction(() => {
      for (const candidate of orphaned) {
        const finishAt = Date.now();
        const inProgressAttemptId = (
          this.db
            .prepare(
              "SELECT id FROM attempts WHERE run_id = ? AND status = 'in-progress' ORDER BY attempt_number DESC LIMIT 1",
            )
            .get(candidate.id) as { id: string } | null
        )?.id;
        const runUpdate = this.db
          .prepare(
            `UPDATE runs SET reconciliation_pending = 1, reconciled_at = ? WHERE id = ? AND status IN (${ORPHAN_STATUSES}) AND reconciliation_pending = 0`,
          )
          .run(orphanSettlementReconciledAt(inProgressAttemptId, finishAt), candidate.id);
        if (runUpdate.changes === 0) continue;
        if (orphanSettlementShouldStampAttempt(true, inProgressAttemptId)) {
          this.db.prepare("UPDATE attempts SET completed_at = ? WHERE id = ?").run(finishAt, inProgressAttemptId);
        }
      }
      return (
        this.db
          .prepare("SELECT id FROM runs WHERE reconciliation_pending = 1 ORDER BY created_at DESC, rowid DESC")
          .all() as Array<{
          id: string;
        }>
      ).map((run) => run.id);
    })();
  }

  finishRunReconciliation(runId: string): void {
    this.db.prepare("UPDATE runs SET reconciliation_pending = 0 WHERE id = ?").run(runId);
  }

  async reconcilePipelines(): Promise<string[]> {
    const candidates = this.db
      .prepare("SELECT id, owner_identity AS ownerIdentity FROM pipelines WHERE status = 'active'")
      .all() as Array<{ id: string; ownerIdentity: string | null }>;

    const orphaned: typeof candidates = [];
    const aliveByIdentity = new Map<string, boolean>();
    for (const candidate of candidates) {
      if (candidate.ownerIdentity === null) {
        orphaned.push(candidate);
        continue;
      }
      if (candidate.ownerIdentity === this.currentIdentity) continue;
      let alive = aliveByIdentity.get(candidate.ownerIdentity);
      if (alive === undefined) {
        alive = await this.isOwnerAliveProbe(candidate.ownerIdentity);
        aliveByIdentity.set(candidate.ownerIdentity, alive);
      }
      if (!alive) orphaned.push(candidate);
    }

    return this.db.transaction(() => {
      const settled: string[] = [];
      const endedAt = Date.now();
      for (const candidate of orphaned) {
        const result = this.db
          .prepare("UPDATE pipelines SET status = 'interrupted' WHERE id = ? AND status = 'active'")
          .run(candidate.id);
        if (result.changes === 0) continue;
        this.db
          .prepare(
            `UPDATE pipeline_stages SET status = 'interrupted', ended_at = ?
             WHERE pipeline_id = ? AND status NOT IN (${NON_ACTIVE_STAGE_STATUSES})`,
          )
          .run(endedAt, candidate.id);
        settled.push(candidate.id);
      }
      return settled;
    })();
  }

  listRuns(): Run[] {
    return (
      this.db.prepare(`SELECT ${RUN_COLUMNS} FROM runs ORDER BY created_at DESC, rowid DESC`).all() as RunRow[]
    ).map(mapRunRow);
  }

  listIncidentCandidateRuns(args: { statuses: readonly RunStatus[]; sinceMs: number }): Run[] {
    if (args.statuses.length === 0) return [];
    const statusPlaceholders = args.statuses.map(() => "?").join(", ");
    return (
      this.db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM runs
           WHERE status IN (${statusPlaceholders})
             AND (
               status NOT IN (${TERMINAL_RUN_STATUSES_SQL})
               OR finished_at IS NULL
               OR finished_at >= ?
             )
           ORDER BY created_at DESC, rowid DESC`,
        )
        .all(...args.statuses, args.sinceMs) as RunRow[]
    ).map(mapRunRow);
  }

  listIncidentCandidatePipelines(args: { sinceMs: number }): Array<Pipeline & { stages: PipelineStageRecord[] }> {
    const pipelines = this.db
      .prepare(`SELECT ${PIPELINE_COLUMNS} FROM pipelines p WHERE ${INCIDENT_CANDIDATE_PIPELINE_WHERE}`)
      .all(args.sinceMs) as PipelineRow[];
    return pipelines.map((pipelineRow) => ({
      ...mapPipelineRow(pipelineRow),
      stages: this.loadPipelineStages(pipelineRow.id),
    }));
  }

  hasQueuedRun(args: { project: string; branch: string }): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM runs WHERE project = ? AND branch = ? AND status = 'queued' LIMIT 1")
      .get(args.project, args.branch);
    return row !== null;
  }

  listQueuedRuns(): Run[] {
    return (
      this.db
        .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE status = 'queued' ORDER BY created_at ASC`)
        .all() as RunRow[]
    ).map(mapRunRow);
  }

  hasNotificationDelivery(args: { incidentId: string; transition: string }): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM operator_notification_deliveries WHERE incident_id = ? AND transition = ? LIMIT 1")
      .get(args.incidentId, args.transition);
    return row !== null;
  }

  listNotificationDeliveriesForIncidentIds(
    incidentIds: readonly string[],
  ): ReadonlyArray<{ incidentId: string; transition: string }> {
    if (incidentIds.length === 0) return [];
    const placeholders = incidentIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT incident_id AS incidentId, transition FROM operator_notification_deliveries WHERE incident_id IN (${placeholders})`,
      )
      .all(...incidentIds) as Array<{ incidentId: string; transition: string }>;
  }

  tryRecordNotificationDelivery(args: { incidentId: string; transition: string; deliveredAt: number }): boolean {
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO operator_notification_deliveries (incident_id, transition, delivered_at) VALUES (?, ?, ?)",
      )
      .run(args.incidentId, args.transition, args.deliveredAt);
    return result.changes > 0;
  }

  releaseNotificationDelivery(args: { incidentId: string; transition: string }): void {
    this.db
      .prepare("DELETE FROM operator_notification_deliveries WHERE incident_id = ? AND transition = ?")
      .run(args.incidentId, args.transition);
  }

  private closed = false;

  isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    this.closed = true;
    this.db.close();
  }
}

/** Open or create the state store; default path `~/.jarvis/state/v2.sqlite`. */
export function openStateStore(
  storePath?: string,
  overrides?: { currentIdentity?: string; isOwnerAlive?: OwnerLivenessProbe },
): StateStore {
  return new StateStoreImpl(storePath ?? ORCHESTRATION_STORE_PATH, overrides);
}
