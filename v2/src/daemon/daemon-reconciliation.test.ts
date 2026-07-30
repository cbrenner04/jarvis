import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { IpcServer, RpcHandler } from "../ipc/server.ts";
import type { LogEvent, LogReader, LogSink, PersistedRecord } from "../persistence/log-stream.ts";
import {
  type OwnerLivenessProbe,
  openStateStore,
  type RunStatus,
  type StateStore,
} from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import {
  createRunControlHandlers,
  reconcileOrphanedRuns,
  recoverReconciledRuns,
  resetWriteLoopBindingSourceDepsForTests,
  setWriteLoopBindingSourceDepsForTests,
  startDaemonRuntime,
} from "./daemon.ts";

const dbPath = join(tmpdir(), `jarvis-reconciliation-${process.pid}.sqlite`);
const orphanedStatuses: readonly RunStatus[] = ["queued", "in-progress", "paused", "budget-soft-stopped"];
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
  removeOrchestrationStore(dbPath);
  seedStore = openStateStore(dbPath, { currentIdentity: PRIOR_IDENTITY });
});

afterEach(() => {
  seedStore.close();
  removeOrchestrationStore(dbPath);
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

test("reconciles an orphaned review-debate row to interrupted and retains its workflow snapshot", async () => {
  const runId = seedStore.createRun({
    project: "project",
    specRef: "main",
    worktreePath: "/tmp/worktree-debate",
    branch: "branch-debate",
    specPath: "/tmp/verdict.md",
    stepId: "review-debate",
    workflowSnapshot: {
      invocationId: "workflow-debate",
      steps: [{ stepId: "review-debate", role: "", behavior: "review-debate", durable: true }],
    },
  });
  const attemptId = seedStore.recordAttemptStart(runId);
  const events: Array<{ runId: string; event: LogEvent }> = [];
  const sweepStore = openSweepStore(async () => false);

  await reconcileOrphanedRuns(sweepStore, {
    append: (id, event) => events.push({ runId: id, event }),
    close: () => undefined,
  });

  expect(sweepStore.loadRun(runId)).toMatchObject({
    status: "interrupted",
    attempts: [{ id: attemptId, status: "in-progress" }],
    workflowSnapshot: { steps: [{ stepId: "review-debate", behavior: "review-debate", durable: true }] },
  });
  expect(events).toEqual([
    { runId, event: { kind: "run_reconciled", runStatus: "interrupted", reason: "daemon_restart" } },
  ]);
  sweepStore.close();
});

test("dedupes run_reconciled per settled status, so a stale killed event does not suppress an interrupted append", async () => {
  const runId = seedStore.createRun({
    project: "project",
    specRef: "main",
    worktreePath: "/tmp/worktree-debate-stale",
    branch: "branch-debate-stale",
    specPath: "/tmp/verdict.md",
    stepId: "review-debate",
    workflowSnapshot: {
      invocationId: "workflow-debate-stale",
      steps: [{ stepId: "review-debate", role: "", behavior: "review-debate", durable: true }],
    },
  });

  // A prior incarnation persisted a run_reconciled for a *different* settled status. The dedupe
  // guard must match on status: this row settles to "interrupted", so its event is still owed.
  const staleRecords: PersistedRecord[] = [
    {
      runId,
      seq: 1,
      ts: "earlier",
      event: { kind: "run_reconciled", runStatus: "killed", reason: "daemon_restart" },
    },
  ];
  const staleReader: LogReader = { tail: () => staleRecords, async *follow() {} };
  const events: Array<{ runId: string; event: LogEvent }> = [];
  const sweepStore = openSweepStore(async () => false);

  await reconcileOrphanedRuns(
    sweepStore,
    { append: (id, event) => events.push({ runId: id, event }), close: () => undefined },
    staleReader,
  );

  expect(sweepStore.loadRun(runId)?.status).toBe("interrupted");
  expect(events).toEqual([
    { runId, event: { kind: "run_reconciled", runStatus: "interrupted", reason: "daemon_restart" } },
  ]);
  sweepStore.close();
});

test("suppresses a duplicate run_reconciled when one already matches the settled status", async () => {
  const runId = seedStore.createRun({
    project: "project",
    specRef: "main",
    worktreePath: "/tmp/worktree-debate-dupe",
    branch: "branch-debate-dupe",
    specPath: "/tmp/verdict.md",
    stepId: "review-debate",
    workflowSnapshot: {
      invocationId: "workflow-debate-dupe",
      steps: [{ stepId: "review-debate", role: "", behavior: "review-debate", durable: true }],
    },
  });

  const matchingRecords: PersistedRecord[] = [
    {
      runId,
      seq: 1,
      ts: "earlier",
      event: { kind: "run_reconciled", runStatus: "interrupted", reason: "daemon_restart" },
    },
  ];
  const matchingReader: LogReader = { tail: () => matchingRecords, async *follow() {} };
  const events: Array<{ runId: string; event: LogEvent }> = [];
  const sweepStore = openSweepStore(async () => false);

  await reconcileOrphanedRuns(
    sweepStore,
    { append: (id, event) => events.push({ runId: id, event }), close: () => undefined },
    matchingReader,
  );

  expect(sweepStore.loadRun(runId)?.status).toBe("interrupted");
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

function seedPipeline(store: StateStore, stageStatuses: string[]): string {
  const pipelineId = store.createPipeline({
    definition: {
      name: "restart-pipeline",
      stages: stageStatuses.map((_, index) => ({ stageId: `stage-${index}`, kind: "approval" })),
    },
  });
  stageStatuses.forEach((status, index) => {
    if (status === "pending") return;
    store.updateStage({ pipelineId, stageId: `stage-${index}`, patch: { status } });
  });
  return pipelineId;
}

async function startDaemonRuntimeForPipelineTest(store: StateStore) {
  const reader: LogReader = { tail: () => [], async *follow() {} };
  return startDaemonRuntime("/fake/socket", store, reader, {
    openLogSink: () => ({ append: () => undefined, close: () => undefined }),
    startIpcServer: async () => ({ close: async () => undefined }) as IpcServer,
  });
}

test("starting the daemon runtime settles a pipeline owned by a dead prior incarnation: pipeline and active stage interrupted, completed stage preserved, later stage undispatched", async () => {
  const pipelineId = seedPipeline(seedStore, ["succeeded", "in-progress", "pending"]);
  const before = seedStore.loadPipeline(pipelineId);
  if (!before) throw new Error("Pipeline should exist");
  const succeededBefore = before.stages.find((stage) => stage.stageId === "stage-0");
  const pendingBefore = before.stages.find((stage) => stage.stageId === "stage-2");

  const sweepStore = openSweepStore(async (identity) => identity !== PRIOR_IDENTITY);
  const runtime = await startDaemonRuntimeForPipelineTest(sweepStore);
  try {
    const after = sweepStore.loadPipeline(pipelineId);
    if (!after) throw new Error("Pipeline should exist");
    expect(after.status).toBe("interrupted");
    expect(after.stages.find((stage) => stage.stageId === "stage-0")).toEqual(succeededBefore);
    const active = after.stages.find((stage) => stage.stageId === "stage-1");
    expect(active?.status).toBe("interrupted");
    expect(active?.endedAt).not.toBeNull();
    expect(after.stages.find((stage) => stage.stageId === "stage-2")).toEqual(pendingBefore);
  } finally {
    await runtime.close();
    sweepStore.close();
  }
});

test("a pipeline owned by a still-live process is unchanged across daemon startup", async () => {
  const pipelineId = seedPipeline(seedStore, ["in-progress"]);
  const before = seedStore.loadPipeline(pipelineId);

  const sweepStore = openSweepStore(async (identity) => identity === PRIOR_IDENTITY);
  const runtime = await startDaemonRuntimeForPipelineTest(sweepStore);
  try {
    expect(sweepStore.loadPipeline(pipelineId)).toEqual(before);
  } finally {
    await runtime.close();
    sweepStore.close();
  }
});

test("startup settles every dead-owner pipeline in one sweep, leaving a live-owner pipeline untouched", async () => {
  const firstOrphanId = seedPipeline(seedStore, ["in-progress"]);
  const secondOrphanId = seedPipeline(seedStore, ["succeeded", "in-progress"]);
  const liveOwnerId = seedPipeline(seedStore, ["in-progress"]);
  const raw = new Database(dbPath);
  try {
    raw.prepare("UPDATE pipelines SET owner_identity = ? WHERE id = ?").run("33333:3000000", liveOwnerId);
  } finally {
    raw.close();
  }
  const liveBefore = seedStore.loadPipeline(liveOwnerId);

  const sweepStore = openSweepStore(async (identity) => identity === "33333:3000000");
  const runtime = await startDaemonRuntimeForPipelineTest(sweepStore);
  try {
    expect(sweepStore.loadPipeline(firstOrphanId)?.status).toBe("interrupted");
    expect(sweepStore.loadPipeline(secondOrphanId)?.status).toBe("interrupted");
    expect(sweepStore.loadPipeline(liveOwnerId)).toEqual(liveBefore);
  } finally {
    await runtime.close();
    sweepStore.close();
  }
});

test("starting the daemon runtime a second time over an already-interrupted pipeline leaves it unchanged", async () => {
  const pipelineId = seedPipeline(seedStore, ["in-progress"]);

  const firstSweepStore = openSweepStore(async () => false);
  const firstRuntime = await startDaemonRuntimeForPipelineTest(firstSweepStore);
  const afterFirst = firstSweepStore.loadPipeline(pipelineId);
  await firstRuntime.close();
  firstSweepStore.close();
  expect(afterFirst?.status).toBe("interrupted");

  const secondSweepStore = openSweepStore(async () => false);
  const secondRuntime = await startDaemonRuntimeForPipelineTest(secondSweepStore);
  try {
    expect(secondSweepStore.loadPipeline(pipelineId)).toEqual(afterFirst);
  } finally {
    await secondRuntime.close();
    secondSweepStore.close();
  }
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
    listPipelines: () => [],
    reconcilePipelines: async () => {
      order.push("pipelines");
      return [];
    },
  } as unknown as StateStore;

  const runtime = await startDaemonRuntime("/fake/socket", reconciledStore, reader, {
    openLogSink: () => sink,
    startIpcServer,
    recoverReconciledRuns: async (runIds) => {
      expect(runIds).toEqual(["run-1"]);
      const response = await health?.(
        { kind: "request", id: "health", method: "health" },
        new AbortController().signal,
      );
      expect(response).toEqual({ kind: "response", result: { ok: true } });
      const pending = await status?.({ kind: "request", id: "status", method: "status" }, new AbortController().signal);
      expect(pending).toMatchObject({
        kind: "response",
        result: { state: "running", recovery: { pending: true, reconciled: 1, resumed: 0 } },
      });
      order.push("recovery");
      return { resumed: 1 };
    },
  });
  try {
    expect(order).toEqual(["state", "log", "finished", "ipc", "pipelines", "recovery"]);
    const complete = await status?.({ kind: "request", id: "status", method: "status" }, new AbortController().signal);
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
      {
        store: {
          beginRunReconciliation: async () => [],
          listPipelines: () => [],
          reconcilePipelines: () => {
            throw new Error("pipeline state unavailable");
          },
        } as unknown as StateStore,
        sink,
        message: "pipeline state unavailable",
        ipcOpens: true,
      },
    ] as const) {
      let opened = false;
      await expect(
        startDaemonRuntime("/fake/socket", failure.store, reader, {
          openLogSink: () => failure.sink,
          startIpcServer: async () => {
            opened = true;
            return server;
          },
        }),
      ).rejects.toThrow(failure.message);
      expect(opened).toBe("ipcOpens" in failure ? failure.ipcOpens : false);
    }
  } finally {
    await runtime.close();
  }
});

test("daemon status reports the boot revision and digest on every call", async () => {
  let status: RpcHandler | undefined;
  const reader: LogReader = { tail: () => [], async *follow() {} };

  const runtime = await startDaemonRuntime("/fake/socket", seedStore, reader, {
    openLogSink: () => ({ append: () => undefined, close: () => undefined }),
    startIpcServer: async (_socketPath, handlers) => {
      status = handlers?.status;
      return { close: async () => undefined } as IpcServer;
    },
  });

  try {
    if (status === undefined) throw new Error("status handler was not registered");
    const signal = new AbortController().signal;
    const initial = await status({ kind: "request", id: "initial", method: "status" }, signal);
    expect(initial.kind).toBe("response");
    const initialResult = (
      initial as { kind: "response"; result: { loadedRevision: string; loadedExecutableDigest: string } }
    ).result;
    expect(typeof initialResult.loadedRevision).toBe("string");

    const again = await status({ kind: "request", id: "again", method: "status" }, signal);
    expect(again).toMatchObject({
      kind: "response",
      result: {
        loadedRevision: initialResult.loadedRevision,
        loadedExecutableDigest: initialResult.loadedExecutableDigest,
      },
    });
  } finally {
    await runtime.close();
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

test("recoverReconciledRuns auto-resume re-resolves write bindings from the edited machine profile", async () => {
  const profileHome = mkdtempSync(join(tmpdir(), "jarvis-reconcile-profile-"));
  const machinesDir = join(profileHome, "machines");
  const machineProfile = "reconcile-binding-profile";
  const previousHome = process.env.JARVIS_HOME;
  process.env.JARVIS_HOME = profileHome;

  const rung = (adapterModel: string) => ({ rungs: [{ adapterModel, priceKey: adapterModel }] });
  const codexBundle = (implementModels: string[]) => ({
    plan: rung("plan"),
    implement: { rungs: implementModels.map((adapterModel) => ({ adapterModel, priceKey: adapterModel })) },
    shrink: rung("shrink"),
    adversary: rung("adv"),
    critic: rung("crit"),
    advocate: rung("advoc"),
    adjudicator: rung("adj"),
    actuator: rung("act"),
  });
  const writeProfile = (implementModels: string[]) => {
    mkdirSync(machinesDir, { recursive: true });
    writeFileSync(
      join(machinesDir, `${machineProfile}.json`),
      JSON.stringify({ models: { codex: codexBundle(implementModels) } }),
    );
    writeFileSync(join(profileHome, "config.json"), JSON.stringify({ machineProfile, agents: ["codex"] }));
    setWriteLoopBindingSourceDepsForTests({
      machineConfigPath: join(profileHome, "config.json"),
      machinesDir,
    });
  };

  const snapshotConfig: AgentModelConfig = {
    codex: { implement: { rungs: [{ adapterModel: "snapshot-only-model", priceKey: "snapshot-only-model" }] } },
  };
  const recoveryDb = join(tmpdir(), `jarvis-reconcile-binding-${process.pid}-${Date.now()}.db`);
  removeOrchestrationStore(recoveryDb);
  const store = openStateStore(recoveryDb);
  const admitted: string[] = [];
  const fakeExecutor = createFakeWriteLoopExecutor((input) => {
    admitted.push(input.bindings[0]?.id ?? "");
  });
  const handlers = createRunControlHandlers({
    stateStore: store,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
  });

  try {
    writeProfile(["recovery-old-model"]);
    const runId = store.createRun({
      project: "project",
      specRef: "main",
      worktreePath: "/tmp/recovery-worktree",
      branch: "recovery-branch",
      specPath: "/tmp/recovery-spec.md",
      stepId: "step-1",
      workflowSnapshot: {
        invocationId: "recovery-workflow",
        steps: [
          {
            stepId: "step-1",
            role: "implement",
            stepRules: "rules",
            expectedArtifactPath: "/tmp/artifact",
            agents: ["codex"],
            agentModelConfig: snapshotConfig,
          },
        ],
      },
    });
    store.setRunStatus(runId, "killed");

    writeProfile(["recovery-new-model"]);

    const recovery = await recoverReconciledRuns(
      [runId],
      store,
      { append: () => undefined, close: () => undefined },
      handlers.resume,
    );

    expect(recovery).toEqual({ resumed: 1 });
    expect(admitted).toEqual(["codex/recovery-new-model/recovery-new-model"]);
  } finally {
    fakeExecutor.abortAll();
    resetWriteLoopBindingSourceDepsForTests();
    store.close();
    removeOrchestrationStore(recoveryDb);
    if (previousHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousHome;
    rmSync(profileHome, { recursive: true, force: true });
  }
});
