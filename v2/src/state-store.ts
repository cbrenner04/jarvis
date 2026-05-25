import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const DEFAULT_STATE_STORE_PATH = join(homedir(), ".jarvis", "state", "v2.sqlite");

const MIGRATIONS: ReadonlyArray<{ version: number; sql: readonly string[] }> = [
  {
    version: 1,
    sql: [
      `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        next_step_id TEXT,
        spec_path TEXT,
        worktree_path TEXT,
        branch_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS step_attempts (
        attempt_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        attempt_ordinal INTEGER NOT NULL CHECK (attempt_ordinal > 0),
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
        UNIQUE(run_id, step_id, attempt_ordinal)
      )
      `,
      `
      CREATE TRIGGER IF NOT EXISTS step_attempts_ordinal_monotonic
      BEFORE INSERT ON step_attempts
      FOR EACH ROW
      WHEN NEW.attempt_ordinal != (
        COALESCE(
          (
            SELECT MAX(existing.attempt_ordinal)
            FROM step_attempts AS existing
            WHERE existing.run_id = NEW.run_id
              AND existing.step_id = NEW.step_id
          ),
          0
        ) + 1
      )
      BEGIN
        SELECT RAISE(ABORT, 'attempt_ordinal must be contiguous per run_id + step_id');
      END
      `,
      `
      CREATE TABLE IF NOT EXISTS step_outcomes (
        outcome_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL UNIQUE,
        outcome_kind TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(attempt_id) REFERENCES step_attempts(attempt_id) ON DELETE CASCADE
      )
      `,
      `
      CREATE TRIGGER IF NOT EXISTS step_outcomes_requires_completed_attempt
      BEFORE INSERT ON step_outcomes
      FOR EACH ROW
      WHEN NOT EXISTS (
        SELECT 1
        FROM step_attempts AS attempt
        WHERE attempt.attempt_id = NEW.attempt_id
          AND attempt.finished_at IS NOT NULL
      )
      BEGIN
        SELECT RAISE(ABORT, 'outcome requires a completed attempt');
      END
      `,
    ],
  },
];

/** Options for opening the Phase 1 state store database. */
export type OpenPhase1StateStoreOptions = {
  /**
   * Optional absolute or relative sqlite path. Omit to use the default
   * `~/.jarvis/state/v2.sqlite` location.
   */
  path?: string;
};

/** Enumerates caller-meaningful state-store contract failures. */
export type Phase1StateStoreErrorCode =
  | "RUN_ALREADY_EXISTS"
  | "RUN_NOT_FOUND"
  | "ATTEMPT_NOT_FOUND"
  | "ATTEMPT_IDENTITY_MISMATCH"
  | "ATTEMPT_ALREADY_FINISHED"
  | "OUTCOME_ALREADY_RECORDED"
  | "INVALID_BOUNDARY_TARGET";

/**
 * Named Phase 1 store-contract error for caller-meaningful invariants.
 *
 * SQLite/driver failures still throw as-is for non-contract faults.
 */
export class Phase1StateStoreError extends Error {
  /** Stable machine-readable contract error code. */
  readonly code: Phase1StateStoreErrorCode;

  /** Constructs a contract error with a stable code and readable message. */
  constructor(code: Phase1StateStoreErrorCode, message: string) {
    super(message);
    this.name = "Phase1StateStoreError";
    this.code = code;
  }
}

/** Durable run status used by Phase 1 orchestration snapshots. */
export type RunStatus =
  | "running"
  | "paused"
  | "awaiting-human"
  | "blocked"
  | "completed"
  | "killed"
  | "failed";

/** Attempt lifecycle status persisted in `step_attempts`. */
export type AttemptStatus = "started" | "succeeded" | "failed" | "blocked";

/** Closed outcome classification persisted in `step_outcomes`. */
export type StepOutcomeKind = "progress" | "done" | "no-work" | "blocked";

/**
 * Input contract for creating a run row and its initial checkpoint pointers.
 */
export type CreateRunInput = {
  runId: string;
  workflowName: string;
  nextStepId: string | null;
  status: RunStatus;
  specPath: string | null;
  worktreePath: string | null;
  branchName: string | null;
  createdAt?: string;
};

/** Durable run snapshot returned by write/read repository paths. */
export type RunSnapshot = {
  runId: string;
  workflowName: string;
  status: RunStatus;
  nextStepId: string | null;
  specPath: string | null;
  worktreePath: string | null;
  branchName: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Input contract for opening one new step attempt on a run checkpoint. */
export type RecordStepStartInput = {
  runId: string;
  stepId: string;
  startedAt?: string;
};

/** Durable attempt snapshot returned for `recordStepStart`. */
export type StepAttemptSnapshot = {
  attemptId: string;
  runId: string;
  stepId: string;
  attemptOrdinal: number;
  status: AttemptStatus;
  startedAt: string;
  finishedAt: string | null;
};

/**
 * Input contract for committing one step-boundary effect against one attempt.
 */
export type CommitStepBoundaryInput = {
  runId: string;
  stepId: string;
  attemptId: string;
  nextStepId: string | null;
  runStatus: RunStatus;
  outcomeKind: StepOutcomeKind;
  outcomeDetail: string | null;
  attemptStatus?: AttemptStatus;
  finishedAt?: string;
};

/** Durable checkpoint/outcome snapshot returned by boundary commit. */
export type StepBoundarySnapshot = {
  runId: string;
  stepId: string;
  attemptId: string;
  attemptOrdinal: number;
  finishedAt: string;
  attemptStatus: AttemptStatus;
  nextStepId: string | null;
  runStatus: RunStatus;
  outcomeId: string;
  outcomeKind: StepOutcomeKind;
};

/** One history row combining attempt and optional boundary outcome. */
export type StepHistoryEntry = {
  runId: string;
  stepId: string;
  attemptId: string;
  attemptOrdinal: number;
  attemptStatus: AttemptStatus;
  startedAt: string;
  finishedAt: string | null;
  outcomeId: string | null;
  outcomeKind: StepOutcomeKind | null;
  outcomeDetail: string | null;
  outcomeCreatedAt: string | null;
};

/**
 * Run-level resume snapshot branch for a terminal run with no next boundary.
 */
export type RunTerminalResumeSnapshot = {
  kind: "run-terminal";
  run: RunSnapshot;
};

/**
 * Resume snapshot branch when no attempt exists for the current checkpoint.
 */
export type StartNextBoundaryResumeSnapshot = {
  kind: "start-next-boundary";
  run: RunSnapshot;
  stepId: string;
};

/**
 * Resume snapshot branch when the checkpoint step has an uncommitted attempt.
 */
export type ReplayLastBoundaryResumeSnapshot = {
  kind: "replay-last-boundary";
  run: RunSnapshot;
  stepId: string;
  attempt: StepAttemptSnapshot;
};

/**
 * Phase 1 recovery snapshot union used by callers to resume deterministically.
 */
export type RunResumeSnapshot =
  | RunTerminalResumeSnapshot
  | StartNextBoundaryResumeSnapshot
  | ReplayLastBoundaryResumeSnapshot;

/**
 * Public Phase 1 repository API. This is the full supported contract surface.
 */
export type Phase1StateStore = {
  /** Absolute sqlite path backing this store handle. */
  readonly path: string;

  /**
   * Persists a new run checkpoint/work-pointer row.
   * Throws `Phase1StateStoreError` with `RUN_ALREADY_EXISTS` when runId exists.
   */
  createRun: (input: CreateRunInput) => RunSnapshot;

  /**
   * Records one new attempt start for a run+step pair.
   * Throws `Phase1StateStoreError` with `RUN_NOT_FOUND` for unknown `runId`.
   */
  recordStepStart: (input: RecordStepStartInput) => StepAttemptSnapshot;

  /**
   * Commits one atomic step boundary: attempt terminal state + outcome + checkpoint.
   * Throws `Phase1StateStoreError` for identity mismatches, duplicates, or invalid target.
   */
  commitStepBoundary: (input: CommitStepBoundaryInput) => StepBoundarySnapshot;

  /**
   * Loads the typed Phase 1 recovery snapshot for one run.
   * Throws `Phase1StateStoreError` with `RUN_NOT_FOUND` for unknown `runId`.
   */
  loadRunForResume: (runId: string) => RunResumeSnapshot;

  /**
   * Lists deterministic attempt/outcome history for one run.
   * Throws `Phase1StateStoreError` with `RUN_NOT_FOUND` for unknown `runId`.
   */
  listStepHistory: (runId: string) => StepHistoryEntry[];

  /**
   * Closes the underlying sqlite connection; store methods are unusable after close.
   */
  close: () => void;
};

/** Returns the default Phase 1 SQLite state-store path. */
export function getDefaultPhase1StateStorePath(): string {
  return DEFAULT_STATE_STORE_PATH;
}

/**
 * Opens the Phase 1 SQLite state store and applies idempotent migrations.
 *
 * This construction boundary hides raw sqlite handles and migration internals.
 */
export function openPhase1StateStore(
  options: OpenPhase1StateStoreOptions = {},
): Phase1StateStore {
  const dbPath = resolve(options.path ?? DEFAULT_STATE_STORE_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath, { create: true, strict: true });
  db.exec("PRAGMA foreign_keys = ON;");
  applyMigrations(db);

  return {
    path: dbPath,
    createRun: (input) => createRun(db, input),
    recordStepStart: (input) => recordStepStart(db, input),
    commitStepBoundary: (input) => commitStepBoundary(db, input),
    loadRunForResume: (runId) => loadRunForResume(db, runId),
    listStepHistory: (runId) => listStepHistory(db, runId),
    close: () => db.close(),
  };
}

type RunRow = {
  run_id: string;
  workflow_name: string;
  status: string;
  next_step_id: string | null;
  spec_path: string | null;
  worktree_path: string | null;
  branch_name: string | null;
  created_at: string;
  updated_at: string;
};

type AttemptRow = {
  attempt_id: string;
  run_id: string;
  step_id: string;
  attempt_ordinal: number;
  status: string;
  started_at: string;
  finished_at: string | null;
};

type HistoryRow = {
  run_id: string;
  step_id: string;
  attempt_id: string;
  attempt_ordinal: number;
  attempt_status: string;
  started_at: string;
  finished_at: string | null;
  outcome_id: string | null;
  outcome_kind: string | null;
  outcome_detail: string | null;
  outcome_created_at: string | null;
};

function createRun(db: Database, input: CreateRunInput): RunSnapshot {
  const now = input.createdAt ?? new Date().toISOString();
  const row: RunRow = {
    run_id: input.runId,
    workflow_name: input.workflowName,
    status: input.status,
    next_step_id: input.nextStepId,
    spec_path: input.specPath,
    worktree_path: input.worktreePath,
    branch_name: input.branchName,
    created_at: now,
    updated_at: now,
  };

  try {
    db.query(
      `
      INSERT INTO runs(run_id, workflow_name, status, next_step_id, spec_path, worktree_path, branch_name, created_at, updated_at)
      VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      `,
    ).run(
      row.run_id,
      row.workflow_name,
      row.status,
      row.next_step_id,
      row.spec_path,
      row.worktree_path,
      row.branch_name,
      row.created_at,
      row.updated_at,
    );
  } catch (error) {
    if (isSqliteConstraint(error)) {
      throw new Phase1StateStoreError(
        "RUN_ALREADY_EXISTS",
        `runId '${input.runId}' already exists`,
      );
    }
    throw error;
  }

  return mapRunRow(row);
}

function recordStepStart(db: Database, input: RecordStepStartInput): StepAttemptSnapshot {
  const run = getRunRowOrThrow(db, input.runId);
  if (run.status !== "running" || run.next_step_id !== input.stepId) {
    throw new Phase1StateStoreError(
      "INVALID_BOUNDARY_TARGET",
      `step start target '${input.stepId}' does not match run checkpoint '${run.next_step_id}'`,
    );
  }

  const startedAt = input.startedAt ?? new Date().toISOString();
  const attemptId = crypto.randomUUID();

  db.exec("BEGIN IMMEDIATE;");
  try {
    const maxOrdinal =
      db
        .query<{ max_ordinal: number | null }, [string, string]>(
          `
          SELECT MAX(attempt_ordinal) AS max_ordinal
          FROM step_attempts
          WHERE run_id = ?1 AND step_id = ?2
          `,
        )
        .get(input.runId, input.stepId)?.max_ordinal ?? 0;

    const attemptOrdinal = maxOrdinal + 1;

    db.query(
      `
      INSERT INTO step_attempts(attempt_id, run_id, step_id, attempt_ordinal, status, started_at, finished_at)
      VALUES(?1, ?2, ?3, ?4, ?5, ?6, NULL)
      `,
    ).run(attemptId, input.runId, input.stepId, attemptOrdinal, "started", startedAt);

    db.exec("COMMIT;");

    return {
      attemptId,
      runId: input.runId,
      stepId: input.stepId,
      attemptOrdinal,
      status: "started",
      startedAt,
      finishedAt: null,
    };
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function commitStepBoundary(db: Database, input: CommitStepBoundaryInput): StepBoundarySnapshot {
  const finishedAt = input.finishedAt ?? new Date().toISOString();
  const attemptStatus = input.attemptStatus ?? toAttemptStatus(input.outcomeKind);

  db.exec("BEGIN IMMEDIATE;");
  try {
    const run = getRunRowOrThrow(db, input.runId);

    if (run.status !== "running") {
      throw new Phase1StateStoreError(
        "INVALID_BOUNDARY_TARGET",
        `run '${input.runId}' is not running`,
      );
    }
    if (run.next_step_id !== input.stepId) {
      throw new Phase1StateStoreError(
        "INVALID_BOUNDARY_TARGET",
        `boundary step '${input.stepId}' does not match run checkpoint '${run.next_step_id}'`,
      );
    }

    const attempt = db
      .query<AttemptRow, [string]>(
        `
        SELECT attempt_id, run_id, step_id, attempt_ordinal, status, started_at, finished_at
        FROM step_attempts
        WHERE attempt_id = ?1
        `,
      )
      .get(input.attemptId);

    if (!attempt) {
      throw new Phase1StateStoreError(
        "ATTEMPT_NOT_FOUND",
        `attemptId '${input.attemptId}' does not exist`,
      );
    }

    if (attempt.run_id !== input.runId || attempt.step_id !== input.stepId) {
      throw new Phase1StateStoreError(
        "ATTEMPT_IDENTITY_MISMATCH",
        `attemptId '${input.attemptId}' does not belong to run '${input.runId}' step '${input.stepId}'`,
      );
    }

    if (attempt.finished_at !== null) {
      throw new Phase1StateStoreError(
        "ATTEMPT_ALREADY_FINISHED",
        `attemptId '${input.attemptId}' is already finished`,
      );
    }

    const existingOutcome = db
      .query<{ outcome_id: string }, [string]>(
        "SELECT outcome_id FROM step_outcomes WHERE attempt_id = ?1",
      )
      .get(input.attemptId);

    if (existingOutcome) {
      throw new Phase1StateStoreError(
        "OUTCOME_ALREADY_RECORDED",
        `attemptId '${input.attemptId}' already has outcome '${existingOutcome.outcome_id}'`,
      );
    }

    db.query(
      "UPDATE step_attempts SET status = ?1, finished_at = ?2 WHERE attempt_id = ?3",
    ).run(attemptStatus, finishedAt, input.attemptId);

    const outcomeId = crypto.randomUUID();
    db.query(
      `
      INSERT INTO step_outcomes(outcome_id, attempt_id, outcome_kind, detail, created_at)
      VALUES(?1, ?2, ?3, ?4, ?5)
      `,
    ).run(outcomeId, input.attemptId, input.outcomeKind, input.outcomeDetail, finishedAt);

    db.query("UPDATE runs SET status = ?1, next_step_id = ?2, updated_at = ?3 WHERE run_id = ?4").run(
      input.runStatus,
      input.nextStepId,
      finishedAt,
      input.runId,
    );

    db.exec("COMMIT;");

    return {
      runId: input.runId,
      stepId: input.stepId,
      attemptId: input.attemptId,
      attemptOrdinal: attempt.attempt_ordinal,
      finishedAt,
      attemptStatus,
      nextStepId: input.nextStepId,
      runStatus: input.runStatus,
      outcomeId,
      outcomeKind: input.outcomeKind,
    };
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function loadRunForResume(db: Database, runId: string): RunResumeSnapshot {
  const run = getRunRowOrThrow(db, runId);
  const runSnapshot = mapRunRow(run);

  if (runSnapshot.nextStepId === null || runSnapshot.status !== "running") {
    return { kind: "run-terminal", run: runSnapshot };
  }

  const latestAttempt = db
    .query<AttemptRow, [string, string]>(
      `
      SELECT attempt_id, run_id, step_id, attempt_ordinal, status, started_at, finished_at
      FROM step_attempts
      WHERE run_id = ?1 AND step_id = ?2
      ORDER BY attempt_ordinal DESC
      LIMIT 1
      `,
    )
    .get(runId, runSnapshot.nextStepId);

  if (!latestAttempt) {
    return {
      kind: "start-next-boundary",
      run: runSnapshot,
      stepId: runSnapshot.nextStepId,
    };
  }

  const latestOutcome = db
    .query<{ outcome_id: string }, [string]>(
      "SELECT outcome_id FROM step_outcomes WHERE attempt_id = ?1",
    )
    .get(latestAttempt.attempt_id);

  if (latestOutcome) {
    return {
      kind: "start-next-boundary",
      run: runSnapshot,
      stepId: runSnapshot.nextStepId,
    };
  }

  return {
    kind: "replay-last-boundary",
    run: runSnapshot,
    stepId: runSnapshot.nextStepId,
    attempt: mapAttemptRow(latestAttempt),
  };
}

function listStepHistory(db: Database, runId: string): StepHistoryEntry[] {
  getRunRowOrThrow(db, runId);

  return db
    .query<HistoryRow, [string]>(
      `
      SELECT
        attempt.run_id AS run_id,
        attempt.step_id AS step_id,
        attempt.attempt_id AS attempt_id,
        attempt.attempt_ordinal AS attempt_ordinal,
        attempt.status AS attempt_status,
        attempt.started_at AS started_at,
        attempt.finished_at AS finished_at,
        outcome.outcome_id AS outcome_id,
        outcome.outcome_kind AS outcome_kind,
        outcome.detail AS outcome_detail,
        outcome.created_at AS outcome_created_at
      FROM step_attempts AS attempt
      LEFT JOIN step_outcomes AS outcome ON outcome.attempt_id = attempt.attempt_id
      WHERE attempt.run_id = ?1
      ORDER BY attempt.step_id ASC, attempt.attempt_ordinal ASC, attempt.attempt_id ASC
      `,
    )
    .all(runId)
    .map((row) => ({
      runId: row.run_id,
      stepId: row.step_id,
      attemptId: row.attempt_id,
      attemptOrdinal: row.attempt_ordinal,
      attemptStatus: asAttemptStatus(row.attempt_status),
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      outcomeId: row.outcome_id,
      outcomeKind: row.outcome_kind === null ? null : asOutcomeKind(row.outcome_kind),
      outcomeDetail: row.outcome_detail,
      outcomeCreatedAt: row.outcome_created_at,
    }));
}

function getRunRowOrThrow(db: Database, runId: string): RunRow {
  const row = db
    .query<RunRow, [string]>(
      `
      SELECT run_id, workflow_name, status, next_step_id, spec_path, worktree_path, branch_name, created_at, updated_at
      FROM runs
      WHERE run_id = ?1
      `,
    )
    .get(runId);

  if (!row) {
    throw new Phase1StateStoreError("RUN_NOT_FOUND", `runId '${runId}' does not exist`);
  }

  return row;
}

function mapRunRow(row: RunRow): RunSnapshot {
  return {
    runId: row.run_id,
    workflowName: row.workflow_name,
    status: asRunStatus(row.status),
    nextStepId: row.next_step_id,
    specPath: row.spec_path,
    worktreePath: row.worktree_path,
    branchName: row.branch_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAttemptRow(row: AttemptRow): StepAttemptSnapshot {
  return {
    attemptId: row.attempt_id,
    runId: row.run_id,
    stepId: row.step_id,
    attemptOrdinal: row.attempt_ordinal,
    status: asAttemptStatus(row.status),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toAttemptStatus(outcomeKind: StepOutcomeKind): AttemptStatus {
  if (outcomeKind === "done" || outcomeKind === "no-work") {
    return "succeeded";
  }
  if (outcomeKind === "blocked") {
    return "blocked";
  }
  return "failed";
}

function asRunStatus(value: string): RunStatus {
  if (
    value === "running" ||
    value === "paused" ||
    value === "awaiting-human" ||
    value === "blocked" ||
    value === "completed" ||
    value === "killed" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error(`invalid run status '${value}'`);
}

function asAttemptStatus(value: string): AttemptStatus {
  if (value === "started" || value === "succeeded" || value === "failed" || value === "blocked") {
    return value;
  }
  throw new Error(`invalid attempt status '${value}'`);
}

function asOutcomeKind(value: string): StepOutcomeKind {
  if (value === "progress" || value === "done" || value === "no-work" || value === "blocked") {
    return value;
  }
  throw new Error(`invalid outcome kind '${value}'`);
}

function isSqliteConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("constraint");
}

function applyMigrations(db: Database): void {
  db.exec("BEGIN;");
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );

    const getApplied = db.query("SELECT 1 FROM schema_migrations WHERE version = ?1");
    const markApplied = db.query(
      "INSERT INTO schema_migrations(version, applied_at) VALUES(?1, ?2)",
    );

    for (const migration of MIGRATIONS) {
      const alreadyApplied = getApplied.get(migration.version);
      if (alreadyApplied) {
        continue;
      }

      for (const sql of migration.sql) {
        db.exec(sql);
      }

      markApplied.run(migration.version, new Date().toISOString());
    }

    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}
