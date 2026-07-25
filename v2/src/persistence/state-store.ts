import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { InvocationFailureDetail } from "../execution/invocation-failure.ts";
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
  agents?: readonly string[];
  agentModelConfig?: AgentModelConfig;
  iterationTimeoutMs?: number;
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
  | "invalid_token"
  | "missing_blocker";

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
  creationTitle?: string | null;
  stepId?: string | null;
  workflowSnapshot?: WorkflowSnapshot | null;
  queuedInput?: WriteLoopInput | null;
  prNumber?: number | null;
  prUrl?: string | null;
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

  /** Record the confirmed PR number and URL after successful publication. */
  setPrEvidence(runId: string, prNumber: number, prUrl: string): void;

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

  /** All runs whose `workflowSnapshot.invocationId` matches the given id. */
  findRunsByInvocationId(invocationId: string): Run[];

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
  attempt_count AS attemptCount, worktree_path AS worktreePath, branch, spec_path AS specPath, step_id AS stepId,
  workflow_snapshot AS workflowSnapshotJson, queued_input AS queuedInputJson, creation_title AS creationTitle,
  pr_number AS prNumber, pr_url AS prUrl`;

const ATTEMPT_COLUMNS = `id, run_id AS runId, attempt_number AS attemptNumber, started_at AS startedAt, status,
  outcome_kind AS outcomeKind, completed_at AS completedAt, invocation_failure_detail AS invocationFailureDetailJson,
  completion_agent AS completionAgent`;

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
] as const;

const ORPHAN_STATUSES = "'queued', 'in-progress', 'paused', 'budget-soft-stopped'";

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
    db.exec(migration.up);
    db.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(migration.id, Date.now());
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

type RunRow = Run & { workflowSnapshotJson: string | null; queuedInputJson: string | null };

function mapRunRow(row: RunRow): Run {
  const { workflowSnapshotJson, queuedInputJson, ...run } = row;
  return {
    ...run,
    workflowSnapshot: workflowSnapshotJson === null ? null : (JSON.parse(workflowSnapshotJson) as WorkflowSnapshot),
    queuedInput: queuedInputJson === null ? null : (JSON.parse(queuedInputJson) as WriteLoopInput),
  };
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

  setPrEvidence(runId: string, prNumber: number, prUrl: string): void {
    this.db.prepare("UPDATE runs SET pr_number = ?, pr_url = ? WHERE id = ?").run(prNumber, prUrl, runId);
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

  findRunsByInvocationId(invocationId: string): Run[] {
    return (
      this.db
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM runs WHERE workflow_snapshot IS NOT NULL AND json_extract(workflow_snapshot, '$.invocationId') = ? ORDER BY created_at ASC`,
        )
        .all(invocationId) as RunRow[]
    ).map(mapRunRow);
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
        args.outcomeKind === "invocation_failure" && args.invocationFailureDetail !== undefined
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
        this.db
          .prepare(
            `UPDATE runs SET status = ?, reconciliation_pending = 1 WHERE id = ? AND status IN (${ORPHAN_STATUSES})`,
          )
          .run(isReviewDebate ? "interrupted" : "killed", candidate.id);
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
