import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcServer, RpcHandler } from "../ipc/server.ts";
import type { LogReader, LogSink } from "../persistence/log-stream.ts";
import {
  type OwnerLivenessProbe,
  openStateStore,
  type RunStatus,
  type StateStore,
} from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk";
import { startDaemonRuntime, sweepOrphanReadyGateGroups } from "./daemon.ts";

const dbPath = join(tmpdir(), `jarvis-ready-gate-sweep-${process.pid}.sqlite`);

const PRIOR_IDENTITY = "11111:1000000";
const CURRENT_IDENTITY = "22222:2000000";

let seedStore: StateStore;
let originalKill: typeof process.kill;

function openSweepStore(isOwnerAlive: OwnerLivenessProbe): StateStore {
  return openStateStore(dbPath, { currentIdentity: CURRENT_IDENTITY, isOwnerAlive });
}

function createRun(store: StateStore, status: RunStatus = "killed"): string {
  return store.createRun({
    project: "project",
    specRef: "main",
    worktreePath: "/tmp/worktree",
    branch: "branch",
    specPath: "/tmp/spec.md",
    status,
    workflowSnapshot: { invocationId: "workflow", steps: [{ stepId: "step", role: "implement" }] },
  });
}

beforeEach(() => {
  removeOrchestrationStore(dbPath);
  seedStore = openStateStore(dbPath, { currentIdentity: PRIOR_IDENTITY });
  originalKill = process.kill;
});

afterEach(() => {
  process.kill = originalKill;
  seedStore.close();
  removeOrchestrationStore(dbPath);
});

test("sweeps a ready-gate pgid when the owning run owner is dead", async () => {
  const runId = createRun(seedStore);
  const pgid = 424242;
  seedStore.setReadyGatePgid(runId, pgid);
  const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  process.kill = ((pid, signal) => {
    kills.push({ pid: pid as number, signal: signal as NodeJS.Signals });
    return true;
  }) as typeof process.kill;

  const sweepStore = openSweepStore(async (identity) => identity !== PRIOR_IDENTITY);
  await sweepOrphanReadyGateGroups(sweepStore);

  expect(kills).toEqual([{ pid: -pgid, signal: "SIGTERM" }]);
  expect(sweepStore.loadRun(runId)?.readyGatePgid ?? null).toBeNull();
  sweepStore.close();
});

test("leaves a ready-gate pgid alone when the owning run owner is live", async () => {
  const runId = createRun(seedStore);
  const pgid = 535353;
  seedStore.setReadyGatePgid(runId, pgid);
  let killCalls = 0;
  process.kill = (() => {
    killCalls += 1;
    return true;
  }) as typeof process.kill;

  const sweepStore = openSweepStore(async (identity) => identity === PRIOR_IDENTITY);
  await sweepOrphanReadyGateGroups(sweepStore);

  expect(killCalls).toBe(0);
  expect(sweepStore.loadRun(runId)?.readyGatePgid).toBe(pgid);
  sweepStore.close();
});

test("clears a stale ready-gate pgid when the process group is already gone", async () => {
  const runId = createRun(seedStore);
  seedStore.setReadyGatePgid(runId, 9_999_999);

  const sweepStore = openSweepStore(async () => false);
  await expect(sweepOrphanReadyGateGroups(sweepStore)).resolves.toBeUndefined();
  expect(sweepStore.loadRun(runId)?.readyGatePgid ?? null).toBeNull();
  sweepStore.close();
});

test("startup sweeps ready-gate pgids before opening IPC and sweep failures prevent it", async () => {
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
    listReadyGateSweepCandidates: async () => {
      order.push("gate-sweep");
      return [];
    },
    listPipelines: () => [],
    listRuns: () => [],
    listIncidentCandidatePipelines: () => [],
    listIncidentCandidateRuns: () => [],
    loadRunsByIds: () => [],
    findRunsByInvocationIds: () => [],
    isClosed: () => false,
    hasNotificationDelivery: () => false,
    listNotificationDeliveriesForIncidentIds: () => [],
    tryRecordNotificationDelivery: () => true,
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
    expect(order).toEqual(["state", "log", "finished", "gate-sweep", "ipc", "pipelines", "recovery"]);

    for (const failure of [
      {
        store: {
          beginRunReconciliation: async () => [],
          listReadyGateSweepCandidates: () => {
            throw new Error("gate sweep unavailable");
          },
        } as unknown as StateStore,
        message: "gate sweep unavailable",
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
          listReadyGateSweepCandidates: () => {
            throw new Error("gate sweep unavailable");
          },
        } as unknown as StateStore,
        message: "gate sweep unavailable",
      },
    ] as const) {
      let opened = false;
      await expect(
        startDaemonRuntime("/fake/socket", failure.store, reader, {
          openLogSink: () => sink,
          startIpcServer: async () => {
            opened = true;
            return server;
          },
        }),
      ).rejects.toThrow(failure.message);
      expect(opened).toBe(false);
    }
  } finally {
    await runtime.close();
  }
});
