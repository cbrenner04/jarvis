/** Status values for a run. */
export const RUN_STATUSES = [
  "in-progress",
  "completed",
  "blocked",
  "budget-soft-stopped",
  "paused",
  "failed",
  "killed",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

const runStatusSet = new Set<string>(RUN_STATUSES);

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && runStatusSet.has(value);
}

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
   */
  createRun(args: { project: string; specRef: string; worktreePath: string; branch: string; specPath: string }): string;

  /**
   * Load a run and its attempt history for resume.
   * @param runId The run ID to load
   */
  loadRun(runId: string): (Run & { attempts: Attempt[] }) | null;

  /**
   * Find a run by its identity (project, branch).
   * Returns the most recent matching run, or null if none found.
   */
  findRunByProjectBranch(args: { project: string; branch: string }): (Run & { attempts: Attempt[] }) | null;

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
