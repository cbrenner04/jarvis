import type { AgentModelConfig } from "../config/agent-model-config.ts";

/** Status values for a run. */
export const RUN_STATUSES = [
  "in-progress",
  "completed",
  "blocked",
  "budget-soft-stopped",
  "paused",
  "failed",
  "killed",
  "awaiting-human",
  "revising",
  "queued",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

const runStatusSet = new Set<string>(RUN_STATUSES);

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && runStatusSet.has(value);
}

/** A human step's configured repeat-and-revise target. */
export type OnReviseConfig = {
  repeatStepId: string;
  maxRevisions: number;
};

/**
 * Authored workflow-step identity retained on workflow-backed runs. Write-step
 * config (`stepRules`, `expectedArtifactPath`, `agents`, `agentModelConfig`) is
 * carried here too so a later `revise` can rebuild that step's `WriteLoopInput`
 * without a live reference to the authoring `WorkflowStep`.
 */
export type WorkflowSnapshotStep = {
  stepId: string;
  role: string;
  /** Marks a `review-debate` step; absent for `write`/`human` steps. */
  behavior?: "review-debate";
  onRevise?: OnReviseConfig;
  stepRules?: string;
  expectedArtifactPath?: string;
  agents?: readonly string[];
  agentModelConfig?: AgentModelConfig;
};

/** Durable workflow invocation snapshot shared by every step run in that workflow. */
export type WorkflowSnapshot = {
  invocationId: string;
  steps: WorkflowSnapshotStep[];
};

/** Terminal status of an attempt. */
export type AttemptStatus = "in-progress" | "completed" | "blocked" | "budget-soft-stopped";

/** Outcome classification for an attempt. */
export type OutcomeKind =
  | "done"
  | "no-work"
  | "progress"
  | "blocked"
  | "contract_miss"
  | "invocation_failure"
  | "invalid_token";

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
  stepId?: string | null;
  workflowSnapshot?: WorkflowSnapshot | null;
};

/** A durable attempt record linked to a run. */
export type Attempt = {
  id: string;
  runId: string;
  attemptNumber: number;
  startedAt: number;
  status: AttemptStatus;
  outcomeKind: OutcomeKind | null;
};

/** A durable outcome record for an attempt. */
export type Outcome = {
  id: string;
  attemptId: string;
  kind: OutcomeKind;
  completedAt: number;
};

/** State store API. */
export interface StateStore {
  /**
   * Create a new run and return its ID.
   * @param project Project identifier
   * @param specRef Reference to the spec/target (branch, commit, etc)
   * @param worktreePath Path to the worktree
   * @param branch Git branch name
   * @param specPath Path to the spec within the worktree
   * @param stepId Optional step identifier for multi-step workflows
   * @param workflowSnapshot Optional authored workflow metadata for workflow-backed runs
   */
  createRun(args: {
    project: string;
    specRef: string;
    worktreePath: string;
    branch: string;
    specPath: string;
    stepId?: string;
    workflowSnapshot?: WorkflowSnapshot;
  }): string;

  /**
   * Load a run and its attempt history for resume.
   * @param runId The run ID to load
   */
  loadRun(runId: string): (Run & { attempts: Attempt[] }) | null;

  /**
   * Find a run by its identity (project, branch, stepId).
   * Returns the most recent matching run, or null if none found.
   * Resume key: (project, branch, stepId). stepId omitted (null) for single-step workflows.
   */
  findRunByProjectBranch(args: {
    project: string;
    branch: string;
    stepId?: string;
  }): (Run & { attempts: Attempt[] }) | null;

  /**
   * Record the start of a new attempt for a run.
   * @param runId The run ID
   * @returns The attempt ID
   */
  recordAttemptStart(runId: string): string;

  /**
   * Commit a completion boundary atomically: persist attempt completion + outcome + checkpoint/attempt-count advance.
   * This is idempotent: re-committing an already-finished boundary rolls back to no-op.
   * @param attemptId The attempt ID to complete
   * @param status Terminal status of the attempt
   * @param runStatus Status to persist onto the run at the same boundary
   * @param outcomeKind Outcome classification
   */
  commitCompletionBoundary(args: {
    attemptId: string;
    status: AttemptStatus;
    runStatus: RunStatus;
    outcomeKind: OutcomeKind;
    beforeRunUpdate?: () => void;
  }): void;

  /** Persist a run status update outside a completion boundary. */
  setRunStatus(runId: string, status: RunStatus): void;

  close(): void;
}
