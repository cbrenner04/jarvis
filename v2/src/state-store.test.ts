import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getDefaultPhase1StateStorePath,
  openPhase1StateStore,
  Phase1StateStoreError,
} from "./state-store.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-v2-store-"));
  tempDirs.push(dir);
  return join(dir, "nested", "state", "v2.sqlite");
}

describe("phase1 state store bootstrap", () => {
  test("opens with default path contract helper", () => {
    expect(getDefaultPhase1StateStorePath()).toContain(
      ".jarvis/state/v2.sqlite",
    );
  });

  test("fresh bootstrap creates parent directories and schema", () => {
    const dbPath = makeTempDbPath();

    const store = openPhase1StateStore({ path: dbPath });
    store.close();

    expect(existsSync(dbPath)).toBe(true);

    const db = new Database(dbPath, { strict: true });
    try {
      db.exec("PRAGMA foreign_keys = ON;");

      const tables = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => row.name);

      expect(tables).toEqual([
        "runs",
        "schema_migrations",
        "step_attempts",
        "step_outcomes",
      ]);

      const triggerNames = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
        )
        .all()
        .map((row) => row.name);
      expect(triggerNames).toEqual([
        "step_attempts_ordinal_monotonic",
        "step_outcomes_requires_completed_attempt",
      ]);
    } finally {
      db.close();
    }
  });

  test("reopen on current schema is no-op for durable data", () => {
    const dbPath = makeTempDbPath();

    const first = openPhase1StateStore({ path: dbPath });
    first.close();

    const db = new Database(dbPath, { strict: true });
    db.exec("PRAGMA foreign_keys = ON;");
    try {
      db.exec(`
        INSERT INTO runs(run_id, workflow_name, status, next_step_id, created_at, updated_at)
        VALUES('run-1', 'wf', 'running', 'step-2', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      `);
      db.exec(`
        INSERT INTO step_attempts(attempt_id, run_id, step_id, attempt_ordinal, status, started_at, finished_at)
        VALUES('attempt-1', 'run-1', 'step-1', 1, 'succeeded', '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z')
      `);
      db.exec(`
        INSERT INTO step_outcomes(outcome_id, attempt_id, outcome_kind, created_at)
        VALUES('outcome-1', 'attempt-1', 'done', '2026-01-01T00:01:00.000Z')
      `);

      expect(
        db
          .query<{ count: number }, []>(
            "SELECT COUNT(*) AS count FROM schema_migrations",
          )
          .get()?.count,
      ).toBe(1);
    } finally {
      db.close();
    }

    const bytesBefore = readFileSync(dbPath);

    const reopened = openPhase1StateStore({ path: dbPath });
    reopened.close();

    const verify = new Database(dbPath, { strict: true });
    verify.exec("PRAGMA foreign_keys = ON;");
    try {
      expect(
        verify
          .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM runs")
          .get()?.count,
      ).toBe(1);
      expect(
        verify
          .query<{ count: number }, []>(
            "SELECT COUNT(*) AS count FROM step_attempts",
          )
          .get()?.count,
      ).toBe(1);
      expect(
        verify
          .query<{ count: number }, []>(
            "SELECT COUNT(*) AS count FROM step_outcomes",
          )
          .get()?.count,
      ).toBe(1);
      expect(
        verify
          .query<{ count: number }, []>(
            "SELECT COUNT(*) AS count FROM schema_migrations",
          )
          .get()?.count,
      ).toBe(1);
    } finally {
      verify.close();
    }

    const bytesAfter = readFileSync(dbPath);
    expect(bytesAfter.equals(bytesBefore)).toBe(true);
  });
});

describe("phase1 state store repository api", () => {
  test("createRun returns durable run snapshot", () => {
    const store = openPhase1StateStore({ path: makeTempDbPath() });
    try {
      const snapshot = store.createRun({
        runId: "run-1",
        workflowName: "wf",
        nextStepId: "step-1",
        status: "running",
        specPath: "/tmp/spec.md",
        worktreePath: "/tmp/worktree",
        branchName: "feature/x",
        createdAt: "2026-01-02T03:04:05.000Z",
      });

      expect(snapshot).toEqual({
        runId: "run-1",
        workflowName: "wf",
        status: "running",
        nextStepId: "step-1",
        specPath: "/tmp/spec.md",
        worktreePath: "/tmp/worktree",
        branchName: "feature/x",
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2026-01-02T03:04:05.000Z",
      });

      expect(() =>
        store.createRun({
          runId: "run-1",
          workflowName: "wf",
          nextStepId: "step-1",
          status: "running",
          specPath: null,
          worktreePath: null,
          branchName: null,
        }),
      ).toThrowError(Phase1StateStoreError);
    } finally {
      store.close();
    }
  });

  test("recordStepStart allocates monotonic attempt ordinals", () => {
    const store = openPhase1StateStore({ path: makeTempDbPath() });
    try {
      store.createRun({
        runId: "run-1",
        workflowName: "wf",
        nextStepId: "step-a",
        status: "running",
        specPath: null,
        worktreePath: null,
        branchName: null,
      });

      const first = store.recordStepStart({
        runId: "run-1",
        stepId: "step-a",
        startedAt: "2026-01-01T00:00:00.000Z",
      });
      const second = store.recordStepStart({
        runId: "run-1",
        stepId: "step-a",
        startedAt: "2026-01-01T00:01:00.000Z",
      });

      expect(first.attemptOrdinal).toBe(1);
      expect(second.attemptOrdinal).toBe(2);
      expect(first.stepId).toBe("step-a");
      expect(second.status).toBe("started");
    } finally {
      store.close();
    }
  });

  test("commitStepBoundary atomically finalizes attempt and advances checkpoint", () => {
    const store = openPhase1StateStore({ path: makeTempDbPath() });
    try {
      store.createRun({
        runId: "run-1",
        workflowName: "wf",
        nextStepId: "step-a",
        status: "running",
        specPath: null,
        worktreePath: null,
        branchName: null,
      });

      const started = store.recordStepStart({
        runId: "run-1",
        stepId: "step-a",
      });

      const boundary = store.commitStepBoundary({
        runId: "run-1",
        stepId: "step-a",
        attemptId: started.attemptId,
        nextStepId: "step-b",
        runStatus: "running",
        outcomeKind: "done",
        outcomeDetail: "ok",
        finishedAt: "2026-01-01T00:02:00.000Z",
      });

      expect(boundary.stepId).toBe("step-a");
      expect(boundary.nextStepId).toBe("step-b");
      expect(boundary.attemptStatus).toBe("succeeded");
      expect(boundary.outcomeKind).toBe("done");

      const history = store.listStepHistory("run-1");
      expect(history).toHaveLength(1);
      expect(history[0]?.attemptStatus).toBe("succeeded");
      expect(history[0]?.outcomeKind).toBe("done");

      const resume = store.loadRunForResume("run-1");
      expect(resume.kind).toBe("start-next-boundary");
      if (resume.kind === "start-next-boundary") {
        expect(resume.stepId).toBe("step-b");
      }
    } finally {
      store.close();
    }
  });

  test("loadRunForResume returns replay and terminal branches", () => {
    const store = openPhase1StateStore({ path: makeTempDbPath() });
    try {
      store.createRun({
        runId: "run-1",
        workflowName: "wf",
        nextStepId: "step-a",
        status: "running",
        specPath: null,
        worktreePath: null,
        branchName: null,
      });

      const started = store.recordStepStart({
        runId: "run-1",
        stepId: "step-a",
      });
      const replay = store.loadRunForResume("run-1");
      expect(replay.kind).toBe("replay-last-boundary");
      if (replay.kind === "replay-last-boundary") {
        expect(replay.attempt.attemptId).toBe(started.attemptId);
      }

      store.commitStepBoundary({
        runId: "run-1",
        stepId: "step-a",
        attemptId: started.attemptId,
        nextStepId: null,
        runStatus: "completed",
        outcomeKind: "done",
        outcomeDetail: null,
      });

      const terminal = store.loadRunForResume("run-1");
      expect(terminal.kind).toBe("run-terminal");
      if (terminal.kind === "run-terminal") {
        expect(terminal.run.status).toBe("completed");
      }
    } finally {
      store.close();
    }
  });

  test("listStepHistory is deterministic and typed", () => {
    const store = openPhase1StateStore({ path: makeTempDbPath() });
    try {
      store.createRun({
        runId: "run-1",
        workflowName: "wf",
        nextStepId: "step-a",
        status: "running",
        specPath: null,
        worktreePath: null,
        branchName: null,
      });

      const a1 = store.recordStepStart({
        runId: "run-1",
        stepId: "step-a",
        startedAt: "2026-01-01T00:00:00.000Z",
      });
      store.commitStepBoundary({
        runId: "run-1",
        stepId: "step-a",
        attemptId: a1.attemptId,
        nextStepId: "step-b",
        runStatus: "running",
        outcomeKind: "done",
        outcomeDetail: null,
        finishedAt: "2026-01-01T00:01:00.000Z",
      });

      const b1 = store.recordStepStart({
        runId: "run-1",
        stepId: "step-b",
        startedAt: "2026-01-01T00:02:00.000Z",
      });
      store.commitStepBoundary({
        runId: "run-1",
        stepId: "step-b",
        attemptId: b1.attemptId,
        nextStepId: null,
        runStatus: "completed",
        outcomeKind: "no-work",
        outcomeDetail: "already done",
        finishedAt: "2026-01-01T00:03:00.000Z",
      });

      const history = store.listStepHistory("run-1");
      expect(
        history.map((entry) => `${entry.stepId}:${entry.attemptOrdinal}`),
      ).toEqual(["step-a:1", "step-b:1"]);
      expect(history[0]?.outcomeKind).toBe("done");
      expect(history[1]?.outcomeKind).toBe("no-work");
    } finally {
      store.close();
    }
  });

  test("named errors are thrown for contract failures", () => {
    const store = openPhase1StateStore({ path: makeTempDbPath() });
    try {
      expect(() => store.loadRunForResume("missing")).toThrowError(
        Phase1StateStoreError,
      );

      store.createRun({
        runId: "run-1",
        workflowName: "wf",
        nextStepId: "step-a",
        status: "running",
        specPath: null,
        worktreePath: null,
        branchName: null,
      });

      expect(() =>
        store.recordStepStart({ runId: "run-1", stepId: "wrong-step" }),
      ).toThrowError(Phase1StateStoreError);

      const started = store.recordStepStart({
        runId: "run-1",
        stepId: "step-a",
      });

      expect(() =>
        store.commitStepBoundary({
          runId: "run-1",
          stepId: "step-a",
          attemptId: "missing",
          nextStepId: null,
          runStatus: "completed",
          outcomeKind: "done",
          outcomeDetail: null,
        }),
      ).toThrowError(Phase1StateStoreError);

      expect(() =>
        store.commitStepBoundary({
          runId: "run-1",
          stepId: "step-a",
          attemptId: started.attemptId,
          nextStepId: "not-the-next",
          runStatus: "running",
          outcomeKind: "done",
          outcomeDetail: null,
        }),
      ).not.toThrow();

      expect(() =>
        store.commitStepBoundary({
          runId: "run-1",
          stepId: "step-a",
          attemptId: started.attemptId,
          nextStepId: null,
          runStatus: "completed",
          outcomeKind: "done",
          outcomeDetail: null,
        }),
      ).toThrowError(Phase1StateStoreError);

      const storeError = (() => {
        try {
          store.createRun({
            runId: "run-2",
            workflowName: "wf",
            nextStepId: null,
            status: "paused",
            specPath: null,
            worktreePath: null,
            branchName: null,
          });
          store.loadRunForResume("run-2");
          return null;
        } catch (error) {
          return error;
        }
      })();
      expect(storeError).toBeInstanceOf(Phase1StateStoreError);
      expect((storeError as Phase1StateStoreError).code).toBe(
        "INVALID_BOUNDARY_TARGET",
      );
    } finally {
      store.close();
    }
  });

  test("duplicate committed boundary returns durable snapshot in-process", () => {
    const store = openPhase1StateStore({ path: makeTempDbPath() });
    try {
      store.createRun({
        runId: "run-1",
        workflowName: "wf",
        nextStepId: "step-a",
        status: "running",
        specPath: null,
        worktreePath: null,
        branchName: null,
      });
      const started = store.recordStepStart({
        runId: "run-1",
        stepId: "step-a",
      });

      const first = store.commitStepBoundary({
        runId: "run-1",
        stepId: "step-a",
        attemptId: started.attemptId,
        nextStepId: "step-b",
        runStatus: "running",
        outcomeKind: "done",
        outcomeDetail: null,
      });
      const second = store.commitStepBoundary({
        runId: "run-1",
        stepId: "step-a",
        attemptId: started.attemptId,
        nextStepId: "step-b",
        runStatus: "running",
        outcomeKind: "done",
        outcomeDetail: "ignored on idempotent replay",
      });

      expect(second).toEqual(first);
      const history = store.listStepHistory("run-1");
      expect(history).toHaveLength(1);
      expect(history[0]?.outcomeId).toBe(first.outcomeId);
      expect(history[0]?.outcomeKind).toBe("done");
      const resume = store.loadRunForResume("run-1");
      expect(resume.kind).toBe("start-next-boundary");
      if (resume.kind === "start-next-boundary") {
        expect(resume.stepId).toBe("step-b");
      }
    } finally {
      store.close();
    }
  });

  test("duplicate committed boundary returns durable snapshot after reopen", () => {
    const dbPath = makeTempDbPath();
    const firstStore = openPhase1StateStore({ path: dbPath });
    let attemptId = "";
    let firstOutcomeId = "";
    try {
      firstStore.createRun({
        runId: "run-1",
        workflowName: "wf",
        nextStepId: "step-a",
        status: "running",
        specPath: null,
        worktreePath: null,
        branchName: null,
      });
      const started = firstStore.recordStepStart({
        runId: "run-1",
        stepId: "step-a",
      });
      attemptId = started.attemptId;
      const first = firstStore.commitStepBoundary({
        runId: "run-1",
        stepId: "step-a",
        attemptId,
        nextStepId: "step-b",
        runStatus: "running",
        outcomeKind: "done",
        outcomeDetail: null,
      });
      firstOutcomeId = first.outcomeId;
    } finally {
      firstStore.close();
    }

    const reopened = openPhase1StateStore({ path: dbPath });
    try {
      const duplicate = reopened.commitStepBoundary({
        runId: "run-1",
        stepId: "step-a",
        attemptId,
        nextStepId: "step-b",
        runStatus: "running",
        outcomeKind: "done",
        outcomeDetail: null,
      });
      expect(duplicate.outcomeId).toBe(firstOutcomeId);

      const history = reopened.listStepHistory("run-1");
      expect(history).toHaveLength(1);
      expect(history[0]?.outcomeId).toBe(firstOutcomeId);
    } finally {
      reopened.close();
    }
  });
});
