import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { applyMigrations } from "./state-store-migrations.ts";
import type { Attempt, AttemptStatus, OutcomeKind, Run, RunStatus, StateStore } from "./state-store-types.ts";

export type { Attempt, AttemptStatus, Outcome, OutcomeKind, Run, RunStatus, StateStore } from "./state-store-types.ts";

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

function mapRunRow(row: RunRow): Run {
  return {
    id: row.id,
    project: row.project,
    specRef: row.spec_ref,
    createdAt: row.created_at,
    status: row.status,
    attemptCount: row.attempt_count,
    worktreePath: row.worktree_path,
    branch: row.branch,
    specPath: row.spec_path,
  };
}

function mapAttemptRow(row: AttemptRow): Attempt {
  return {
    id: row.id,
    runId: row.run_id,
    attemptNumber: row.attempt_number,
    startedAt: row.started_at,
    status: row.status,
    outcomeKind: row.outcome_kind ?? null,
  };
}

class StateStoreImpl implements StateStore {
  private db: Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    applyMigrations(this.db);
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

    return { ...mapRunRow(runRow), attempts: attemptRows.map(mapAttemptRow) };
  }

  findRunByProjectBranch(args: { project: string; branch: string }): (Run & { attempts: Attempt[] }) | null {
    const runStmt = this.db.prepare(`
      SELECT id FROM runs
      WHERE project = ? AND branch = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `);
    const runRow = runStmt.get(args.project, args.branch) as RunIdentityRow | null;
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
    beforeRunUpdate?: () => void;
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

      args.beforeRunUpdate?.();

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
