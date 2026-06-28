import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type RunStatus = "in-progress" | "completed" | "blocked" | "budget-soft-stopped" | "paused" | "failed";

export type AttemptStatus = "in-progress" | "completed";

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

/** Repository-style durable state API, keyed by IDs; no generic SQL surface. */
export interface StateStore {
  /** Insert a run (`in-progress`, zero attempts); returns its ID. */
  createRun(args: { project: string; specRef: string; worktreePath: string; branch: string; specPath: string }): string;

  /** Load a run and its attempt history for resume; null when unknown. */
  loadRun(runId: string): (Run & { attempts: Attempt[] }) | null;

  /** Most recent run for the `(project, branch)` resume key; null when none. */
  findRunByProjectBranch(args: { project: string; branch: string }): (Run & { attempts: Attempt[] }) | null;

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
    beforeRunUpdate?: () => void;
  }): void;

  /** Persist a run status update outside a completion boundary. */
  setRunStatus(runId: string, status: RunStatus): void;

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
  attempt_count AS attemptCount, worktree_path AS worktreePath, branch, spec_path AS specPath`;

const ATTEMPT_COLUMNS = `id, run_id AS runId, attempt_number AS attemptNumber, started_at AS startedAt, status,
  outcome_kind AS outcomeKind`;

class StateStoreImpl implements StateStore {
  private db: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA);
  }

  createRun(args: {
    project: string;
    specRef: string;
    worktreePath: string;
    branch: string;
    specPath: string;
  }): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(`
        INSERT INTO runs (id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path)
        VALUES (?, ?, ?, ?, 'in-progress', 0, ?, ?, ?)
      `)
      .run(id, args.project, args.specRef, Date.now(), args.worktreePath, args.branch, args.specPath);
    return id;
  }

  loadRun(runId: string): (Run & { attempts: Attempt[] }) | null {
    const run = this.db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`).get(runId) as Run | null;
    if (!run) return null;

    const attempts = this.db
      .prepare(`SELECT ${ATTEMPT_COLUMNS} FROM attempts WHERE run_id = ? ORDER BY attempt_number ASC`)
      .all(runId) as Attempt[];

    return { ...run, attempts };
  }

  findRunByProjectBranch(args: { project: string; branch: string }): (Run & { attempts: Attempt[] }) | null {
    const row = this.db
      .prepare("SELECT id FROM runs WHERE project = ? AND branch = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(args.project, args.branch) as { id: string } | null;
    return row === null ? null : this.loadRun(row.id);
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
    beforeRunUpdate?: () => void;
  }): void {
    this.db.transaction(() => {
      const attempt = this.db
        .prepare("SELECT run_id AS runId, outcome_kind AS outcomeKind FROM attempts WHERE id = ?")
        .get(args.attemptId) as { runId: string; outcomeKind: OutcomeKind | null } | null;
      if (!attempt) throw new Error(`Attempt ${args.attemptId} not found`);
      if (attempt.outcomeKind !== null) return; // already committed: idempotent no-op

      this.db
        .prepare("UPDATE attempts SET status = 'completed', outcome_kind = ?, completed_at = ? WHERE id = ?")
        .run(args.outcomeKind, Date.now(), args.attemptId);

      args.beforeRunUpdate?.();

      this.db
        .prepare("UPDATE runs SET attempt_count = attempt_count + 1, status = ? WHERE id = ?")
        .run(args.runStatus, attempt.runId);
    })();
  }

  setRunStatus(runId: string, status: RunStatus): void {
    this.db.prepare("UPDATE runs SET status = ? WHERE id = ?").run(status, runId);
  }

  close(): void {
    this.db.close();
  }
}

/** Open or create the state store; default path `~/.jarvis/state/v2.sqlite`. */
export function openStateStore(storePath?: string): StateStore {
  return new StateStoreImpl(storePath ?? join(homedir(), ".jarvis", "state", "v2.sqlite"));
}
