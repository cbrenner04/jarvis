import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcServer, RpcHandler } from "../ipc/server.ts";
import type { LogEvent, LogReader, LogSink, PersistedRecord } from "../persistence/log-stream.ts";
import {
  type OwnerLivenessProbe,
  openStateStore,
  type RunStatus,
  type StateStore,
} from "../persistence/state-store.ts";
import { reconcileOrphanedRuns, recoverReconciledRuns, startDaemon } from "./daemon.ts";

const dbPath = join(tmpdir(), `jarvis-reconciliation-${process.pid}.sqlite`);
const orphanedStatuses: readonly RunStatus[] = [
  "queued",
  "in-progress",
  "paused",
  "budget-soft-stopped",
  "awaiting-human",
  "revising",
];
const terminalStatuses: readonly RunStatus[] = ["completed", "blocked", "failed", "killed"];

// Simulated identity of a prior daemon incarnation that admitted the seeded runs.
const PRIOR_IDENTITY = "11111:1000000";
// Identity of the process performing the sweep.
const CURRENT_IDENTITY = "22222:2000000";

let seedStore: StateStore;

function openSweepStore(isOwnerAlive: OwnerLivenessProbe): StateStore {
  return openStateStore(dbPath, { currentIdentity: CURRENT_IDENTITY, isOwnerAlive });
}

function createRun(store: StateStore, status: RunStatus): string {
  return store.createRun({
    project: "project",
    specRef: "main",
    worktreePath: `/tmp/worktree-${status}`,
    branch: `branch-${status}`,
    specPath: `/tmp/spec-${status}.md`,
    status,
    workflowSnapshot: { invocationId: `workflow-${status}`, steps: [{ stepId: "step", role: "implement" }] },
    ...(status === "queued"
      ? {
          queuedInput: {
            worktree: { projectRoot: "/tmp/queued", projectName: "project", branchName: "queued", baseRef: "main" },
            specPath: "spec.md",
            stepRules: "",
            expectedArtifactPath: "",
            bindings: [],
          },
        }
      : {}),
  });
}

beforeEach(() => {
  rmSync(dbPath, { force: true });
  seedStore = openStateStore(dbPath, { currentIdentity: PRIOR_IDENTITY });
});

afterEach(() => {
  seedStore.close();
  rmSync(dbPath, { force: true });
});

test("reconciles every orphaned status after a forced daemon stop, retaining durable run metadata", async () => {
  const runIds = orphanedStatuses.map((status) => createRun(seedStore, status));
  const attemptIds = runIds.map((runId) => seedStore.recordAttemptStart(runId));
  const events: Array<{ runId: string; event: LogEvent }> = [];
  const sink: LogSink = { append: (runId, event) => events.push({ runId, event }), close: () => undefined };

  const sweepStore = openSweepStore(async (identity) => identity !== PRIOR_IDENTITY);
  await reconcileOrphanedRuns(sweepStore, sink);

  for (const runId of runIds) {
    const run = sweepStore.loadRun(runId);
    expect(run?.status).toBe("killed");
    expect(run?.worktreePath).toBe(`/tmp/worktree-${orphanedStatuses[runIds.indexOf(runId)]}`);
    expect(run?.branch).toBe(`branch-${orphanedStatuses[runIds.indexOf(runId)]}`);
    expect(run?.workflowSnapshot?.steps).toEqual([{ stepId: "step", role: "implement" }]);
    expect(run?.attempts[0]?.id).toBe(attemptIds[runIds.indexOf(runId)]);
  }
  expect(events.sort((a, b) => a.runId.localeCompare(b.runId))).toEqual(
    runIds
      .map((runId) => ({
        runId,
        event: { kind: "run_reconciled" as const, runStatus: "killed" as const, reason: "daemon_restart" as const },
      }))
      .sort((a, b) => a.runId.localeCompare(b.runId)),
  );
  expect(sweepStore.loadRun(runIds[0] as string)?.queuedInput?.worktree.projectRoot).toBe("/tmp/queued");
  sweepStore.close();
});

test("leaves terminal statuses unchanged without reconciliation events", async () => {
  const runIds = terminalStatuses.map((status) => createRun(seedStore, status));
  const events: Array<{ runId: string; event: LogEvent }> = [];

  const sweepStore = openSweepStore(async () => false);
  await reconcileOrphanedRuns(sweepStore, {
    append: (runId, event) => events.push({ runId, event }),
    close: () => undefined,
  });

  expect(runIds.map((runId) => sweepStore.loadRun(runId)?.status)).toEqual([...terminalStatuses]);
  expect(events).toEqual([]);
  sweepStore.close();
});

test("leaves a non-terminal run owned by a live different process untouched, with no reconciliation event", async () => {
  const runId = createRun(seedStore, "in-progress");
  const events: Array<{ runId: string; event: LogEvent }> = [];

  const sweepStore = openSweepStore(async (identity) => identity === PRIOR_IDENTITY);
  await reconcileOrphanedRuns(sweepStore, {
    append: (id, event) => events.push({ runId: id, event }),
    close: () => undefined,
  });

  expect(sweepStore.loadRun(runId)?.status).toBe("in-progress");
  expect(events).toEqual([]);
  sweepStore.close();
});

test("never reconciles a run owned by the current process's own sweep", async () => {
  const ownStore = openStateStore(dbPath, { currentIdentity: CURRENT_IDENTITY });
  const runId = createRun(ownStore, "in-progress");
  ownStore.close();
  const events: Array<{ runId: string; event: LogEvent }> = [];

  const sweepStore = openSweepStore(async () => false);
  await reconcileOrphanedRuns(sweepStore, {
    append: (id, event) => events.push({ runId: id, event }),
    close: () => undefined,
  });

  expect(sweepStore.loadRun(runId)?.status).toBe("in-progress");
  expect(events).toEqual([]);
  sweepStore.close();
});

test("a non-terminal run with no recorded owner (pre-migration row) is killed", async () => {
  const raw = new Database(dbPath);
  const runId = crypto.randomUUID();
  raw
    .prepare(
      `INSERT INTO runs (id, project, spec_ref, created_at, status, attempt_count, worktree_path, branch, spec_path)
       VALUES (?, 'project', 'main', ?, 'in-progress', 0, '/tmp/worktree-legacy', 'branch-legacy', '/tmp/spec-legacy.md')`,
    )
    .run(runId, Date.now());
  raw.close();
  const events: Array<{ runId: string; event: LogEvent }> = [];

  const sweepStore = openSweepStore(async () => true);
  await reconcileOrphanedRuns(sweepStore, {
    append: (id, event) => events.push({ runId: id, event }),
    close: () => undefined,
  });

  expect(sweepStore.loadRun(runId)?.status).toBe("killed");
  expect(events).toEqual([{ runId, event: { kind: "run_reconciled", runStatus: "killed", reason: "daemon_restart" } }]);
  sweepStore.close();
});

test("propagates reconciliation errors", async () => {
  createRun(seedStore, "in-progress");
  const sink: LogSink = {
    append: () => {
      throw new Error("log unavailable");
    },
    close: () => undefined,
  };

  const sweepStore = openSweepStore(async () => false);
  await expect(reconcileOrphanedRuns(sweepStore, sink)).rejects.toThrow("log unavailable");
  sweepStore.close();
});

test("propagates durable-state reconciliation errors", async () => {
  const failingStore = {
    beginRunReconciliation: () => {
      throw new Error("state unavailable");
    },
  } as unknown as StateStore;
  const sink: LogSink = { append: () => undefined, close: () => undefined };

  await expect(reconcileOrphanedRuns(failingStore, sink)).rejects.toThrow("state unavailable");
});

test("retries an event left pending by a failed log append exactly once", async () => {
  const runId = createRun(seedStore, "in-progress");
  const records: PersistedRecord[] = [];
  const reader: LogReader = {
    tail: () => records,
    async *follow() {},
  };

  const sweepStore = openSweepStore(async () => false);

  await expect(
    reconcileOrphanedRuns(
      sweepStore,
      {
        append: () => {
          throw new Error("log unavailable");
        },
        close: () => undefined,
      },
      reader,
    ),
  ).rejects.toThrow("log unavailable");
  expect(sweepStore.loadRun(runId)?.status).toBe("killed");

  await reconcileOrphanedRuns(
    sweepStore,
    {
      append: (id, event) => records.push({ runId: id, seq: records.length + 1, ts: "now", event }),
      close: () => undefined,
    },
    reader,
  );
  await expect(
    reconcileOrphanedRuns(
      sweepStore,
      {
        append: () => {
          throw new Error("duplicate append");
        },
        close: () => undefined,
      },
      reader,
    ),
  ).resolves.toEqual([]);

  expect(records).toEqual([
    { runId, seq: 1, ts: "now", event: { kind: "run_reconciled", runStatus: "killed", reason: "daemon_restart" } },
  ]);
  sweepStore.close();
});

test("clears pending on a boundary-terminal row without appending run_reconciled", async () => {
  const runId = createRun(seedStore, "in-progress");
  const raw = new Database(dbPath);
  raw.prepare("UPDATE runs SET status = 'blocked', reconciliation_pending = 1 WHERE id = ?").run(runId);
  raw.close();
  const events: Array<{ runId: string; event: LogEvent }> = [];

  const sweepStore = openSweepStore(async () => false);
  await reconcileOrphanedRuns(sweepStore, {
    append: (id, event) => events.push({ runId: id, event }),
    close: () => undefined,
  });

  expect(sweepStore.loadRun(runId)?.status).toBe("blocked");
  const pending = new Database(dbPath)
    .prepare("SELECT reconciliation_pending AS pending FROM runs WHERE id = ?")
    .get(runId) as { pending: number };
  expect(pending.pending).toBe(0);
  expect(events).toEqual([]);
  sweepStore.close();
});

test("startup reconciles before opening IPC and reconciliation failures prevent it", async () => {
  const order: string[] = [];
  const reader: LogReader = { tail: () => [], async *follow() {} };
  const sink: LogSink = { append: () => order.push("log"), close: () => undefined };
  const server = { close: async () => undefined } as IpcServer;
  let health: RpcHandler | undefined;
  let status: RpcHandler | undefined;
  const startIpcServer = async (_socketPath: string, handlers?: Record<string, RpcHandler>) => {
    order.push("ipc");
    health = handlers?.health;
    status = handlers?.status;
    return server;
  };
  const reconciledStore = {
    beginRunReconciliation: async () => {
      order.push("state");
      return ["run-1"];
    },
    loadRun: (runId: string) =>
      runId === "run-1"
        ? {
            id: runId,
            project: "p",
            specRef: "main",
            createdAt: 0,
            status: "killed" as const,
            attemptCount: 0,
            worktreePath: "/tmp",
            branch: "b",
            specPath: "spec.md",
            attempts: [],
          }
        : null,
    finishRunReconciliation: () => order.push("finished"),
  } as unknown as StateStore;

  await startDaemon("/fake/socket", reconciledStore, reader, {
    openLogSink: () => sink,
    startIpcServer,
    recoverReconciledRuns: async (runIds) => {
      expect(runIds).toEqual(["run-1"]);
      const response = await health?.(
        { kind: "request", id: "health", method: "health" },
        new AbortController().signal,
      );
      expect(response).toEqual({ kind: "response", result: { ok: true } });
      const pending = await status?.(
        { kind: "request", id: "status", method: "status" },
        new AbortController().signal,
      );
      expect(pending).toMatchObject({
        kind: "response",
        result: { state: "running", recovery: { pending: true, reconciled: 1, resumed: 0 } },
      });
      order.push("recovery");
      return { resumed: 1 };
    },
  });
  expect(order).toEqual(["state", "log", "finished", "ipc", "recovery"]);
  const complete = await status?.(
    { kind: "request", id: "status", method: "status" },
    new AbortController().signal,
  );
  expect(complete).toMatchObject({
    kind: "response",
    result: { state: "running", recovery: { pending: false, reconciled: 1, resumed: 1 } },
  });

  for (const failure of [
    {
      store: {
        beginRunReconciliation: () => {
          throw new Error("state unavailable");
        },
      } as unknown as StateStore,
      sink,
      message: "state unavailable",
    },
    {
      store: {
        beginRunReconciliation: async () => ["run-1"],
        loadRun: () => ({
          id: "run-1",
          project: "p",
          specRef: "main",
          createdAt: 0,
          status: "killed" as const,
          attemptCount: 0,
          worktreePath: "/tmp",
          branch: "b",
          specPath: "spec.md",
          attempts: [],
        }),
        finishRunReconciliation: () => undefined,
      } as unknown as StateStore,
      sink: {
        append: () => {
          throw new Error("log unavailable");
        },
        close: () => undefined,
      } as LogSink,
      message: "log unavailable",
    },
  ]) {
    let opened = false;
    await expect(
      startDaemon("/fake/socket", failure.store, reader, {
        openLogSink: () => failure.sink,
        startIpcServer: async () => {
          opened = true;
          return server;
        },
      }),
    ).rejects.toThrow(failure.message);
    expect(opened).toBe(false);
  }
});

test("automatic recovery records success, isolates admission failures, and preserves unsupported orphans", async () => {
  const successId = createRun(seedStore, "in-progress");
  const failedId = createRun(seedStore, "in-progress");
  const unsupportedId = createRun(seedStore, "in-progress");
  seedStore.setRunStatus(successId, "killed");
  seedStore.setRunStatus(failedId, "killed");
  seedStore.setRunStatus(unsupportedId, "killed");
  const events: Array<{ runId: string; event: LogEvent }> = [];
  const admissions: string[] = [];

  const recovery = await recoverReconciledRuns(
    [successId, failedId, unsupportedId],
    seedStore,
    { append: (runId, event) => events.push({ runId, event }), close: () => undefined },
    async (frame) => {
      const runId = (frame.params as { runId: string }).runId;
      admissions.push(runId);
      if (runId === successId) return { kind: "response", result: { ok: true } };
      if (runId === failedId) return { kind: "error", code: "worktree_claimed", message: "worktree still claimed" };
      return { kind: "error", code: "resume_unsupported", message: "run has no matching workflow snapshot step" };
    },
  );

  expect(recovery).toEqual({ resumed: 1 });
  expect(admissions).toEqual([successId, failedId, unsupportedId]);
  expect(seedStore.loadRun(successId)?.status).toBe("killed");
  expect(seedStore.loadRun(failedId)?.status).toBe("failed");
  expect(seedStore.loadRun(unsupportedId)?.status).toBe("killed");
  expect(events).toEqual([
    { runId: successId, event: { kind: "run_recovery", outcome: "resumed" } },
    {
      runId: failedId,
      event: {
        kind: "run_recovery",
        outcome: "failed",
        message: "Automatic restart recovery admission failed: worktree still claimed",
      },
    },
  ]);
});
