import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { InvocationFailureDetail } from "../execution/invocation-failure.ts";
import type { PipelineDefinition, PipelineTerminalAction } from "../execution/pipeline-definition.ts";
import type { PublicationFailure } from "../execution/publication-retry.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { jarvisHome } from "../paths.ts";

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
  | "landing_failed";

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
  readyGateRepairFence?: ReadyGateRepairFenceProvenance | null;
  /** True when a non-null fence column could not be parsed into a valid allowset. */
  readyGateRepairFenceCorrupt?: boolean;
  retainedFinalizationCheckpoint?: RetainedFinalizationCheckpoint | null;
  /** True when a non-null checkpoint column could not be parsed. */
  retainedFinalizationCheckpointCorrupt?: boolean;
};

export type PipelineStatus = "active" | "interrupted";

/** Immutable pipeline admission context persisted as a JSON snapshot on the pipeline row. Optional `seed` and `seedPath` are not required by the store; admission sets at most one; dual-populated or ambiguous rows load as stored. */
export type PipelineContext = {
  cwd: string;
  configPath?: string;
  targetDir?: string;
  projectRegistry?: Record<string, { root: string; origin?: string }>;
  seed?: string;
  seedPath?: string;
};

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

/** Detect whether ordered stage rows match the in-place failed-continuation reopen shape. */
export function analyzeFailedPipelineReopenShape(stages: readonly PipelineStageRecord[]): FailedPipelineReopenShape {
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
   * in place as `pending`, clearing only prior-attempt lifecycle payloads. Returns
   * the durable `PipelineStageRecord.id` of the failed row on application.
   */
  reopenFailedPipeline(args: { pipelineId: string }): PipelineReopenOutcome;

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

  /** Insert an `in-progress` attempt row; returns its ID. */
  recordAttemptStart(runId: string): string;

  /**
   * Atomically persist attempt completion, its outcome classification, and the
   * run checkpoint (attempt_count + status). Idempotent: re-committing an
   * already-finished boundary is a no-op. `beforeRunUpdate` is a test seam to
   * force a mid-transaction failure.
   */
  commitCompletionBoundary(args: {
    attemptId: string;
    runStatus: RunStatus;
    outcomeKind: OutcomeKind;
    invocationFailureDetail?: InvocationFailureDetail;
    completionAgent?: string;
    beforeRunUpdate?: () => void;
  }): void;

  /** Persist a run status update outside a completion boundary. */
  setRunStatus(runId: string, status: RunStatus): void;

  /** Set `killed` unless the row is already boundary-terminal (`completed`, `blocked`, `failed`). */
  commitGuardedKill(runId: string): void;

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

  /** True once {@link close} has run — deferred daemon work must check this rather than race a closed DB. */
  isClosed(): boolean;

  close(): void;
}

// Bootstrap is idempotent (IF NOT EXISTS). Schema changes are forward-only:
// append migration statements when the first incompatible change lands.
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
    spec_path TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    outcome_kind TEXT,
    completed_at INTEGER,
    FOREIGN KEY (run_id) REFERENCES runs(id)
  );
`;

const RUN_COLUMNS = `id, project, spec_ref AS specRef, created_at AS createdAt, status,
  attempt_count AS attemptCount, worktree_path AS worktreePath, branch, spec_path AS specPath,
  downstream_inputs AS downstreamInputsJson, step_id AS stepId,
  workflow_snapshot AS workflowSnapshotJson, queued_input AS queuedInputJson, creation_title AS creationTitle,
  pr_number AS prNumber, pr_url AS prUrl, reconciled_at AS reconciledAt,
  ready_gate_repair_fence AS readyGateRepairFenceJson,
  retained_finalization_checkpoint AS retainedFinalizationCheckpointJson`;

const ATTEMPT_COLUMNS = `id, run_id AS runId, attempt_number AS attemptNumber, started_at AS startedAt, status,
  outcome_kind AS outcomeKind, completed_at AS completedAt, invocation_failure_detail AS invocationFailureDetailJson,
  completion_agent AS completionAgent`;

const PIPELINE_COLUMNS = `id, name, created_at AS createdAt, owner_identity AS ownerIdentity, status, definition AS definitionJson, context AS contextJson, terminal_publication_failure AS terminalPublicationFailureJson, terminal_publication_succeeded_at AS terminalPublicationSucceededAt`;

const STAGE_COLUMNS = `id, pipeline_id AS pipelineId, stage_id AS stageId, branch_key AS branchKey, position, status,
  workflow_invocation_id AS workflowInvocationId, started_at AS startedAt, ended_at AS endedAt,
  artifact AS artifactJson, failure_detail AS failureDetailJson`;

const INSERT_PIPELINE_STAGE_SQL = `
  INSERT INTO pipeline_stages (
    id, pipeline_id, stage_id, branch_key, position, status, workflow_invocation_id, started_at, ended_at, artifact, failure_detail
  )
  VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, NULL)
`;

const SCHEMA_MIGRATIONS = [
  {
    id: "004-invocation-failure-detail",
    up: "ALTER TABLE attempts ADD COLUMN invocation_failure_detail TEXT",
  },
  {
    id: "005-run-step-id",
    up: "ALTER TABLE runs ADD COLUMN step_id TEXT",
  },
  {
    id: "006-run-workflow-snapshot",
    up: "ALTER TABLE runs ADD COLUMN workflow_snapshot TEXT",
  },
  {
    id: "007-run-queued-input",
    up: "ALTER TABLE runs ADD COLUMN queued_input TEXT",
  },
  {
    id: "008-attempt-completion-agent",
    up: "ALTER TABLE attempts ADD COLUMN completion_agent TEXT",
  },
  {
    id: "009-run-creation-title",
    up: "ALTER TABLE runs ADD COLUMN creation_title TEXT",
  },
  {
    id: "010-run-reconciliation-pending",
    up: "ALTER TABLE runs ADD COLUMN reconciliation_pending INTEGER NOT NULL DEFAULT 0",
  },
  {
    id: "011-run-owner-identity",
    up: "ALTER TABLE runs ADD COLUMN owner_identity TEXT",
  },
  {
    id: "012-run-pr-evidence",
    up: `ALTER TABLE runs ADD COLUMN pr_number INTEGER;
        ALTER TABLE runs ADD COLUMN pr_url TEXT;`,
  },
  {
    id: "013-pipelines-and-stages",
    up: `
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
    `,
  },
  {
    id: "014-pipeline-owner-identity-and-status",
    up: `ALTER TABLE pipelines ADD COLUMN owner_identity TEXT;
        ALTER TABLE pipelines ADD COLUMN status TEXT NOT NULL DEFAULT 'active';`,
  },
  {
    id: "015-pipeline-context",
    up: "ALTER TABLE pipelines ADD COLUMN context TEXT",
  },
  {
    id: "016-run-reconciled-at",
    up: "ALTER TABLE runs ADD COLUMN reconciled_at INTEGER",
  },
  {
    id: "017-run-ready-gate-repair-fence",
    up: "ALTER TABLE runs ADD COLUMN ready_gate_repair_fence TEXT",
  },
  {
    id: "018-pipeline-terminal-publication",
    up: `ALTER TABLE pipelines ADD COLUMN terminal_publication_failure TEXT;
        ALTER TABLE pipelines ADD COLUMN terminal_publication_succeeded_at INTEGER`,
  },
  {
    id: "019-run-retained-finalization-checkpoint",
    up: "ALTER TABLE runs ADD COLUMN retained_finalization_checkpoint TEXT",
  },
  {
    id: "020-pipeline-stage-branch-key",
    up: `
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
    `,
  },
  {
    id: "021-run-downstream-inputs",
    up: "ALTER TABLE runs ADD COLUMN downstream_inputs TEXT",
  },
  {
    id: "022-pipeline-stage-admission",
    up: `
      CREATE TABLE pipeline_stage_admission (
        pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
        stage_id TEXT NOT NULL,
        branch_key TEXT NOT NULL,
        holder_identity TEXT NOT NULL,
        PRIMARY KEY (pipeline_id, stage_id, branch_key)
      );
    `,
  },
] as const;

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

/** True when `reconcilePipelines` leaves a stage row untouched. */
export function reconciliationStableStageStatus(status: string): boolean {
  return RECONCILIATION_STABLE_STAGE_STATUSES.has(status);
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

function applySchemaMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  for (const migration of SCHEMA_MIGRATIONS) {
    const exists = db.prepare("SELECT 1 FROM _migrations WHERE id = ?").get(migration.id);
    if (exists) continue;
    // One transaction per migration: a table-rebuild migration (drop + rename) that is
    // interrupted partway would otherwise destroy its table and leave the store unopenable,
    // because the earlier CREATE is already stamped and will not re-run.
    db.exec("BEGIN");
    try {
      db.exec(migration.up);
      db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(migration.id, Date.now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
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
> & {
  workflowSnapshotJson: string | null;
  queuedInputJson: string | null;
  readyGateRepairFenceJson: string | null;
  retainedFinalizationCheckpointJson: string | null;
  downstreamInputsJson: string | null;
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
    ...run
  } = row;
  const parsedFence = parseReadyGateRepairFenceProvenance(readyGateRepairFenceJson);
  const parsedCheckpoint = parseRetainedFinalizationCheckpoint(retainedFinalizationCheckpointJson);
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

  reopenFailedPipeline(args: { pipelineId: string }): PipelineReopenOutcome {
    const pipeline = this.loadPipeline(args.pipelineId);
    if (pipeline === null) {
      return { kind: "refused", pipelineId: args.pipelineId, reason: "pipeline_not_found" };
    }

    const shape = analyzeFailedPipelineReopenShape(pipeline.stages);
    if (shape.kind === "invalid") {
      return { kind: "refused", pipelineId: args.pipelineId, reason: shape.reason };
    }

    try {
      return this.db.transaction((): PipelineReopenOutcome => {
        const freshStages = this.loadPipelineStages(args.pipelineId);
        const freshShape = analyzeFailedPipelineReopenShape(freshStages);
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

  private commitApprovalTransition(args: {
    stageRecordId: string;
    requiredStatus: string;
    refusalReason: Extract<ApprovalRefusalReason, "status_not_pending" | "status_not_awaiting">;
    nextStatus: string;
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
      .prepare(`UPDATE pipeline_stages SET status = ? WHERE id = ? AND status = ?`)
      .run(args.nextStatus, args.stageRecordId, args.requiredStatus);
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
    const patch = args.patch;
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

  commitCompletionBoundary(args: {
    attemptId: string;
    runStatus: RunStatus;
    outcomeKind: OutcomeKind;
    invocationFailureDetail?: InvocationFailureDetail;
    completionAgent?: string;
    beforeRunUpdate?: () => void;
  }): void {
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
          "UPDATE attempts SET status = 'completed', outcome_kind = ?, completed_at = ?, invocation_failure_detail = ?, completion_agent = ? WHERE id = ?",
        )
        .run(args.outcomeKind, Date.now(), detailJson, args.completionAgent?.trim() || null, args.attemptId);

      args.beforeRunUpdate?.();

      this.db
        .prepare("UPDATE runs SET attempt_count = attempt_count + 1, status = ? WHERE id = ?")
        .run(args.runStatus, attempt.runId);
    })();
  }

  setRunStatus(runId: string, status: RunStatus): void {
    this.db.prepare("UPDATE runs SET status = ? WHERE id = ?").run(status, runId);
  }

  commitGuardedKill(runId: string): void {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: RunStatus } | null;
      if (!row) throw new Error(`Run ${runId} not found`);
      if (isBoundaryTerminalRunStatus(row.status)) return;
      this.db.prepare("UPDATE runs SET status = 'killed' WHERE id = ?").run(runId);
    })();
  }

  async beginRunReconciliation(): Promise<string[]> {
    const candidates = this.db
      .prepare(
        `SELECT id, owner_identity AS ownerIdentity, step_id AS stepId, workflow_snapshot AS workflowSnapshotJson FROM runs WHERE status IN (${ORPHAN_STATUSES})`,
      )
      .all() as Array<{
      id: string;
      ownerIdentity: string | null;
      stepId: string | null;
      workflowSnapshotJson: string | null;
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
        const snapshot =
          candidate.workflowSnapshotJson === null
            ? undefined
            : (JSON.parse(candidate.workflowSnapshotJson) as WorkflowSnapshot);
        const isReviewDebate = snapshot?.steps.some(
          (step) => step.stepId === candidate.stepId && step.behavior === "review-debate",
        );
        const terminalStatus = isReviewDebate ? "interrupted" : "killed";
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
            `UPDATE runs SET status = ?, reconciliation_pending = 1, reconciled_at = ? WHERE id = ? AND status IN (${ORPHAN_STATUSES})`,
          )
          .run(terminalStatus, orphanSettlementReconciledAt(inProgressAttemptId, finishAt), candidate.id);
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
  return new StateStoreImpl(storePath ?? join(jarvisHome(), "state", "v2.sqlite"), overrides);
}
