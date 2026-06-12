import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Status values for a run. */
export type RunStatus = "in-progress" | "interrupted" | "completed" | "blocked" | "budget-soft-stopped" | "failed";

/** Terminal status of an attempt. */
export type AttemptStatus = "in-progress" | "interrupted" | "completed" | "blocked" | "budget-soft-stopped";

/** Outcome classification for an attempt. */
export type OutcomeKind = "done" | "progress" | "blocked" | "contract_miss" | "invocation_failure" | "invalid_token";

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
   * Find a run by its identity (project, specRef, branch, worktreePath).
   * Returns the most recent matching run, or null if none found.
   */
  findRunByIdentity(args: {
    project: string;
    specRef: string;
    branch: string;
    worktreePath: string;
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
  }): void;

  /** Persist a run status update outside a completion boundary. */
  setRunStatus(runId: string, status: RunStatus): void;

  close(): void;
}

type RunRow = {
  id: string;
  project: string;
  spec_ref: string;
  created_at: number;
  status: RunStatus;
  attempt_count: number;
  worktree_path: string;
  branch: string;
  spec_path: string;
};

type AttemptRow = {
  id: string;
  run_id: string;
  attempt_number: number;
  started_at: number;
  status: AttemptStatus;
  outcome_kind: OutcomeKind | null;
};

type RunIdentityRow = { id: string };
type AttemptLookupRow = { run_id: string };

class StateStoreImpl implements StateStore {
  private db: Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.applyMigrations();
  }

  private applyMigrations(): void {
    // Track which migrations have been applied.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);

    // Migration 001: Create runs table.
    this.runMigration("001-create-runs", () => {
      this.db.exec(`
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
        )
      `);
    });

    // Migration 002: Create attempts table.
    this.runMigration("002-create-attempts", () => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS attempts (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          attempt_number INTEGER NOT NULL,
          started_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          FOREIGN KEY (run_id) REFERENCES runs(id)
        )
      `);
    });

    // Migration 003: Create outcomes table.
    this.runMigration("003-create-outcomes", () => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS outcomes (
          id TEXT PRIMARY KEY,
          attempt_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          completed_at INTEGER NOT NULL,
          FOREIGN KEY (attempt_id) REFERENCES attempts(id)
        )
      `);
    });
  }

  private runMigration(id: string, fn: () => void): void {
    const checkStmt = this.db.prepare("SELECT 1 FROM _migrations WHERE id = ?");
    const exists = checkStmt.get(id);
    if (exists) return;

    try {
      fn();
      const insertStmt = this.db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)");
      insertStmt.run(id, Date.now());
    } catch (error) {
      throw new Error(`Migration ${id} failed: ${error}`);
    }
  }

  createRun(args: {
    project: string;
    specRef: string;
    worktreePath: string;
    branch: string;
    specPath: string;
  }): string {
    const id = generateId();
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      args.project,
      args.specRef,
      Date.now(),
      "in-progress",
      0,
      args.worktreePath,
      args.branch,
      args.specPath,
    );
    return id;
  }

  loadRun(runId: string): (Run & { attempts: Attempt[] }) | null {
    const runStmt = this.db.prepare(`
      SELECT id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path
      FROM runs WHERE id = ?
    `);
    const runRow = runStmt.get(runId) as RunRow | null;
    if (!runRow) return null;

    const attemptsStmt = this.db.prepare(`
      SELECT attempts.id, attempts.run_id, attempts.attempt_number, attempts.started_at, attempts.status, outcomes.kind AS outcome_kind
      FROM attempts
      LEFT JOIN outcomes ON outcomes.attempt_id = attempts.id
      WHERE attempts.run_id = ?
      ORDER BY attempt_number ASC
    `);
    const attemptRows = attemptsStmt.all(runId) as AttemptRow[];

    return {
      id: runRow.id,
      project: runRow.project,
      specRef: runRow.spec_ref,
      createdAt: runRow.created_at,
      status: runRow.status,
      attemptCount: runRow.attempt_count,
      worktreePath: runRow.worktree_path,
      branch: runRow.branch,
      specPath: runRow.spec_path,
      attempts: attemptRows.map((row) => ({
        id: row.id,
        runId: row.run_id,
        attemptNumber: row.attempt_number,
        startedAt: row.started_at,
        status: row.status,
        outcomeKind: row.outcome_kind ?? null,
      })),
    };
  }

  findRunByIdentity(args: {
    project: string;
    specRef: string;
    branch: string;
    worktreePath: string;
  }): (Run & { attempts: Attempt[] }) | null {
    const runStmt = this.db.prepare(`
      SELECT id FROM runs
      WHERE project = ? AND spec_ref = ? AND branch = ? AND worktree_path = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const runRow = runStmt.get(args.project, args.specRef, args.branch, args.worktreePath) as RunIdentityRow | null;
    if (!runRow) return null;

    return this.loadRun(runRow.id);
  }

  recordAttemptStart(runId: string): string {
    const run = this.loadRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    const attemptId = generateId();
    const attemptNumber = run.attempts.length + 1;

    const stmt = this.db.prepare(`
      INSERT INTO attempts (id, run_id, attempt_number, started_at, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(attemptId, runId, attemptNumber, Date.now(), "in-progress");
    return attemptId;
  }

  commitCompletionBoundary(args: {
    attemptId: string;
    status: AttemptStatus;
    runStatus: RunStatus;
    outcomeKind: OutcomeKind;
  }): void {
    const attemptStmt = this.db.prepare("SELECT run_id FROM attempts WHERE id = ?");
    const attemptRow = attemptStmt.get(args.attemptId) as AttemptLookupRow | null;
    if (!attemptRow) throw new Error(`Attempt ${args.attemptId} not found`);

    const runId = attemptRow.run_id;
    const run = this.loadRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    // Find this attempt in the run's history
    const attempt = run.attempts.find((a) => a.id === args.attemptId);
    if (!attempt) throw new Error(`Attempt ${args.attemptId} not found in run ${runId}`);

    // Check if outcome already exists (idempotency)
    const outcomeCheckStmt = this.db.prepare("SELECT id FROM outcomes WHERE attempt_id = ?");
    const existingOutcome = outcomeCheckStmt.get(args.attemptId);
    if (existingOutcome) {
      // Already completed, idempotent no-op
      return;
    }

    // Transactional boundary: update attempt status, create outcome, update run attempt_count + status
    this.db.transaction(() => {
      const updateAttemptStmt = this.db.prepare("UPDATE attempts SET status = ? WHERE id = ?");
      updateAttemptStmt.run(args.status, args.attemptId);

      const outcomeId = generateId();
      const createOutcomeStmt = this.db.prepare(`
        INSERT INTO outcomes (id, attempt_id, kind, completed_at)
        VALUES (?, ?, ?, ?)
      `);
      createOutcomeStmt.run(outcomeId, args.attemptId, args.outcomeKind, Date.now());

      const updateRunStmt = this.db.prepare("UPDATE runs SET attempt_count = ?, status = ? WHERE id = ?");
      updateRunStmt.run(run.attemptCount + 1, args.runStatus, runId);
    })();
  }

  setRunStatus(runId: string, status: RunStatus): void {
    const stmt = this.db.prepare("UPDATE runs SET status = ? WHERE id = ?");
    stmt.run(status, runId);
  }

  close(): void {
    this.db.close();
  }
}

/** Open or create the state store at the given path. */
export function openStateStore(storePath?: string): StateStore {
  const path = storePath || join(homedir(), ".jarvis", "state", "v2.sqlite");
  return new StateStoreImpl(path);
}

/** Generate a unique ID (simple UUID v4-like). */
function generateId(): string {
  return crypto.randomUUID();
}
