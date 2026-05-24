import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type BootstrapStateStoreOptions = {
  dbPath?: string;
};

export const RUN_STATUSES = [
  "running",
  "paused",
  "awaiting_human",
  "blocked",
  "completed",
  "killed",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_KINDS = ["implementation", "review", "human"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const ATTEMPT_STATUSES = ["succeeded", "blocked", "killed", "failed"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const OUTCOME_CLASSES = ["progress", "done", "no_work", "blocked", "error"] as const;
export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];

export type StateStore = {
  dbPath: string;
  close: () => void;
};

export type CreateRunInput = {
  runId: string;
  projectId: string;
  workflowName: string;
  specPath: string;
  worktreePath: string;
  branch: string;
  initialStepId: string;
};

export type CreateRunResult = {
  runId: string;
  createdAt: string;
  nextStepId: string;
};

export type RecordStepStartInput = {
  runId: string;
  stepId: string;
  startedAt: string;
};

export type RecordStepStartResult = {
  attemptId: string;
  attemptOrdinal: number;
  startedAt: string;
};

export type CommitStepBoundaryInput = {
  runId: string;
  attemptId: string;
  stepId: string;
  terminalStatus: AttemptStatus;
  outcomeClass: OutcomeClass;
  nextStepId: string | null;
  finishedAt: string;
  blockerReason?: string | null;
  repeatFromStepId?: string | null;
  repeatToStepId?: string | null;
  forceFailAfterAttemptFinish?: boolean;
};

export type CommitStepBoundaryResult = {
  attemptId: string;
  finishedAt: string;
  nextStepId: string | null;
  outcomeId: string;
};

export type LoadRunForResumeInput = {
  runId: string;
};

export type ResumeRun = {
  runId: string;
  projectId: string;
  workflowName: string;
  specPath: string | null;
  worktreePath: string | null;
  branch: string | null;
  createdAt: string;
  nextStepId: string | null;
  runStatus: RunStatus;
};

export type ResumeAttempt = {
  attemptId: string;
  runId: string;
  stepId: string;
  attemptOrdinal: number;
  attemptStatus: AttemptStatus;
  startedAt: string;
  endedAt: string;
};

export type ResumeOutcome = {
  outcomeId: string;
  attemptId: string;
  runId: string;
  stepId: string;
  outcomeClass: OutcomeClass;
  blockerReason: string | null;
  repeatFromStepId: string | null;
  repeatToStepId: string | null;
  recordedAt: string;
};

export type LoadRunForResumeResult = {
  run: ResumeRun;
  latestAttemptsByStep: Record<string, ResumeAttempt>;
  latestOutcomeByAttempt: Record<string, ResumeOutcome>;
};

export type ListStepHistoryInput = {
  runId: string;
  stepId: string;
};

export type ListStepHistoryResult = {
  attempts: Array<
    ResumeAttempt & {
      outcome: ResumeOutcome | null;
    }
  >;
};

type Migration = {
  version: number;
  sql: string;
};

const DEFAULT_DB_PATH = join(process.env.HOME ?? "~", ".jarvis", "state", "v2.sqlite");
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS state_store_bootstrap_marker (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        run_status TEXT NOT NULL CHECK (
          run_status IN ('running', 'paused', 'awaiting_human', 'blocked', 'completed', 'killed', 'failed')
        ),
        started_at TEXT,
        ended_at TEXT,
        next_step_id TEXT,
        worktree_path TEXT,
        branch_name TEXT,
        spec_path TEXT,
        pr_ref TEXT,
        terminal_outcome_class TEXT CHECK (
          terminal_outcome_class IS NULL OR terminal_outcome_class IN ('success', 'blocked', 'killed', 'failed')
        ),
        terminal_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS step_attempts (
        attempt_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        attempt_ordinal INTEGER NOT NULL CHECK (attempt_ordinal >= 1),
        step_kind TEXT NOT NULL CHECK (step_kind IN ('implementation', 'review', 'human')),
        attempt_status TEXT NOT NULL CHECK (attempt_status IN ('succeeded', 'blocked', 'killed', 'failed')),
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(run_id),
        UNIQUE (run_id, step_id, attempt_ordinal)
      );

      CREATE TABLE IF NOT EXISTS step_outcomes (
        outcome_id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        outcome_class TEXT NOT NULL CHECK (outcome_class IN ('progress', 'done', 'no_work', 'blocked', 'error')),
        blocker_reason TEXT,
        repeat_from_step_id TEXT,
        repeat_to_step_id TEXT,
        recorded_at TEXT NOT NULL,
        FOREIGN KEY (attempt_id) REFERENCES step_attempts(attempt_id),
        FOREIGN KEY (run_id) REFERENCES runs(run_id)
      );
    `,
  },
];

const storeDb = new WeakMap<StateStore, Database>();

export function bootstrapStateStore(options?: BootstrapStateStoreOptions): StateStore {
  const dbPath = options?.dbPath ?? DEFAULT_DB_PATH;
  const dir = dirname(dbPath);
  mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath, { create: true, strict: true });

  db.exec(`
    CREATE TABLE IF NOT EXISTS state_store_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedVersions = new Set<number>(
    db
      .query<{ version: number }, []>(
        "SELECT version FROM state_store_migrations ORDER BY version ASC",
      )
      .all()
      .map((row) => row.version),
  );

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    db.transaction(() => {
      db.exec(migration.sql);
      db.query("INSERT INTO state_store_migrations (version) VALUES (?1)").run(migration.version);
    })();
  }

  const store: StateStore = {
    dbPath,
    close: () => db.close(false),
  };
  storeDb.set(store, db);
  return store;
}

function getDb(store: StateStore): Database {
  const db = storeDb.get(store);
  if (!db) {
    throw new Error("state store is not active");
  }
  return db;
}

export function createRun(store: StateStore, input: CreateRunInput): CreateRunResult {
  const db = getDb(store);
  const createdAt = new Date().toISOString();
  db.query(
    `INSERT INTO runs (
      run_id, project_key, workflow_id, target_ref, created_at, run_status, next_step_id, worktree_path, branch_name, spec_path
    ) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?7, ?8, ?9)`,
  ).run(
    input.runId,
    input.projectId,
    input.workflowName,
    input.specPath,
    createdAt,
    input.initialStepId,
    input.worktreePath,
    input.branch,
    input.specPath,
  );
  return { runId: input.runId, createdAt, nextStepId: input.initialStepId };
}

export function recordStepStart(
  store: StateStore,
  input: RecordStepStartInput,
): RecordStepStartResult {
  const db = getDb(store);
  const attemptId = randomUUID();
  const attemptOrdinalRow = db
    .query<{ next_ordinal: number }, [string, string]>(
      "SELECT COALESCE(MAX(attempt_ordinal), 0) + 1 AS next_ordinal FROM step_attempts WHERE run_id = ?1 AND step_id = ?2",
    )
    .get(input.runId, input.stepId);
  const attemptOrdinal = attemptOrdinalRow?.next_ordinal ?? 1;
  db.query(
    `INSERT INTO step_attempts (
      attempt_id, run_id, step_id, attempt_ordinal, step_kind, attempt_status, started_at, ended_at
    ) VALUES (?1, ?2, ?3, ?4, 'implementation', 'succeeded', ?5, ?6)`,
  ).run(attemptId, input.runId, input.stepId, attemptOrdinal, input.startedAt, input.startedAt);
  return { attemptId, attemptOrdinal, startedAt: input.startedAt };
}

export function commitStepBoundary(
  store: StateStore,
  input: CommitStepBoundaryInput,
): CommitStepBoundaryResult {
  const db = getDb(store);
  const outcomeId = randomUUID();
  db.transaction(() => {
    const updated = db
      .query(
        "UPDATE step_attempts SET attempt_status = ?1, ended_at = ?2 WHERE attempt_id = ?3 AND run_id = ?4 AND step_id = ?5",
      )
      .run(input.terminalStatus, input.finishedAt, input.attemptId, input.runId, input.stepId);
    if (updated.changes === 0) {
      throw new Error("attempt not found");
    }
    if (input.forceFailAfterAttemptFinish) {
      throw new Error("forced failure");
    }
    db.query(
      `INSERT INTO step_outcomes (
        outcome_id, attempt_id, run_id, step_id, outcome_class, blocker_reason, repeat_from_step_id, repeat_to_step_id, recorded_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).run(
      outcomeId,
      input.attemptId,
      input.runId,
      input.stepId,
      input.outcomeClass,
      input.blockerReason ?? null,
      input.repeatFromStepId ?? null,
      input.repeatToStepId ?? null,
      input.finishedAt,
    );
    db.query(
      "UPDATE runs SET next_step_id = ?1, run_status = CASE WHEN ?1 IS NULL THEN 'completed' ELSE run_status END WHERE run_id = ?2",
    ).run(input.nextStepId, input.runId);
  })();
  return {
    attemptId: input.attemptId,
    finishedAt: input.finishedAt,
    nextStepId: input.nextStepId,
    outcomeId,
  };
}

export function loadRunForResume(
  store: StateStore,
  input: LoadRunForResumeInput,
): LoadRunForResumeResult {
  const db = getDb(store);
  const run = db
    .query<
      {
        run_id: string;
        project_key: string;
        workflow_id: string;
        spec_path: string | null;
        worktree_path: string | null;
        branch_name: string | null;
        created_at: string;
        next_step_id: string | null;
        run_status: RunStatus;
      },
      [string]
    >(
      `SELECT run_id, project_key, workflow_id, spec_path, worktree_path, branch_name, created_at, next_step_id, run_status
       FROM runs WHERE run_id = ?1`,
    )
    .get(input.runId);
  if (!run) {
    throw new Error(`run not found: ${input.runId}`);
  }
  const attempts = db
    .query<
      {
        attempt_id: string;
        run_id: string;
        step_id: string;
        attempt_ordinal: number;
        attempt_status: AttemptStatus;
        started_at: string;
        ended_at: string;
      },
      [string]
    >(
      `SELECT a.attempt_id, a.run_id, a.step_id, a.attempt_ordinal, a.attempt_status, a.started_at, a.ended_at
       FROM step_attempts a
       INNER JOIN (
         SELECT step_id, MAX(attempt_ordinal) AS max_attempt_ordinal
         FROM step_attempts
         WHERE run_id = ?1
         GROUP BY step_id
       ) latest
       ON latest.step_id = a.step_id AND latest.max_attempt_ordinal = a.attempt_ordinal
       WHERE a.run_id = ?1`,
    )
    .all(input.runId);
  const latestAttemptsByStep: Record<string, ResumeAttempt> = {};
  for (const attempt of attempts) {
    latestAttemptsByStep[attempt.step_id] = {
      attemptId: attempt.attempt_id,
      runId: attempt.run_id,
      stepId: attempt.step_id,
      attemptOrdinal: attempt.attempt_ordinal,
      attemptStatus: attempt.attempt_status,
      startedAt: attempt.started_at,
      endedAt: attempt.ended_at,
    };
  }
  const outcomes = db
    .query<
      {
        outcome_id: string;
        attempt_id: string;
        run_id: string;
        step_id: string;
        outcome_class: OutcomeClass;
        blocker_reason: string | null;
        repeat_from_step_id: string | null;
        repeat_to_step_id: string | null;
        recorded_at: string;
      },
      [string]
    >(
      `SELECT outcome_id, attempt_id, run_id, step_id, outcome_class, blocker_reason, repeat_from_step_id, repeat_to_step_id, recorded_at
       FROM step_outcomes
       WHERE run_id = ?1`,
    )
    .all(input.runId);
  const latestOutcomeByAttempt: Record<string, ResumeOutcome> = {};
  for (const outcome of outcomes) {
    latestOutcomeByAttempt[outcome.attempt_id] = {
      outcomeId: outcome.outcome_id,
      attemptId: outcome.attempt_id,
      runId: outcome.run_id,
      stepId: outcome.step_id,
      outcomeClass: outcome.outcome_class,
      blockerReason: outcome.blocker_reason,
      repeatFromStepId: outcome.repeat_from_step_id,
      repeatToStepId: outcome.repeat_to_step_id,
      recordedAt: outcome.recorded_at,
    };
  }
  return {
    run: {
      runId: run.run_id,
      projectId: run.project_key,
      workflowName: run.workflow_id,
      specPath: run.spec_path,
      worktreePath: run.worktree_path,
      branch: run.branch_name,
      createdAt: run.created_at,
      nextStepId: run.next_step_id,
      runStatus: run.run_status,
    },
    latestAttemptsByStep,
    latestOutcomeByAttempt,
  };
}

export function listStepHistory(
  store: StateStore,
  input: ListStepHistoryInput,
): ListStepHistoryResult {
  const db = getDb(store);
  const rows = db
    .query<
      {
        attempt_id: string;
        run_id: string;
        step_id: string;
        attempt_ordinal: number;
        attempt_status: AttemptStatus;
        started_at: string;
        ended_at: string;
        outcome_id: string | null;
        outcome_class: OutcomeClass | null;
        blocker_reason: string | null;
        repeat_from_step_id: string | null;
        repeat_to_step_id: string | null;
        recorded_at: string | null;
      },
      [string, string]
    >(
      `SELECT
         a.attempt_id, a.run_id, a.step_id, a.attempt_ordinal, a.attempt_status, a.started_at, a.ended_at,
         o.outcome_id, o.outcome_class, o.blocker_reason, o.repeat_from_step_id, o.repeat_to_step_id, o.recorded_at
       FROM step_attempts a
       LEFT JOIN step_outcomes o ON o.attempt_id = a.attempt_id
       WHERE a.run_id = ?1 AND a.step_id = ?2
       ORDER BY a.attempt_ordinal ASC`,
    )
    .all(input.runId, input.stepId);
  return {
    attempts: rows.map((row) => ({
      attemptId: row.attempt_id,
      runId: row.run_id,
      stepId: row.step_id,
      attemptOrdinal: row.attempt_ordinal,
      attemptStatus: row.attempt_status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      outcome: row.outcome_id
        ? {
            outcomeId: row.outcome_id,
            attemptId: row.attempt_id,
            runId: row.run_id,
            stepId: row.step_id,
            outcomeClass: row.outcome_class as OutcomeClass,
            blockerReason: row.blocker_reason,
            repeatFromStepId: row.repeat_from_step_id,
            repeatToStepId: row.repeat_to_step_id,
            recordedAt: row.recorded_at as string,
          }
        : null,
    })),
  };
}
