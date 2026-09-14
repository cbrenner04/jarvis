// Real-socket coverage for outgoing-generation drain observation and self-exit.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client";
import { type IpcServer, startIpcServer } from "../ipc/server";
import type { ResponseFrame } from "../ipc/types";
import { openStateStore, type StateStore } from "../persistence/state-store";
import { withHandoffIdentity } from "../testing/handoff-identity";
import {
  flushBackgroundRuns,
  listRuns,
  loadRunOrThrow,
  mockWriteLoopInput,
  startRun,
  toIpcHandlers,
} from "../testing/run-control";
import { createTestDaemonLifecycle } from "../testing/test-daemon-lifecycle";
import { canUseUnixSockets } from "../testing/unix-socket";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor";
import {
  createChangeoverHandler,
  createRunControlHandlers,
  shouldShutdownNow,
  startDaemonRuntime,
  startDrainExitLoop,
} from "./daemon";
import type { DaemonListRunRow } from "./daemon-wire";

const socketTest = test.skipIf(!canUseUnixSockets());
const testDaemons = createTestDaemonLifecycle();
const healthHandler = () => ({ kind: "response" as const, result: { ok: true } });

async function health(socketPath: string): Promise<unknown> {
  const client = await connectIpcClient(socketPath);
  try {
    client.send({ kind: "request", id: socketPath, method: "health" });
    const frame = await client.nextFrame();
    expect(frame.kind).toBe("response");
    return (frame as ResponseFrame).result;
  } finally {
    client.close();
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, boundMs: number, stepMs = 20): Promise<boolean> {
  const deadline = Date.now() + boundMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

/** Seeds an in-progress run standing in for a draining predecessor's owned work. */
function seedPredecessorRun(store: StateStore): string {
  return store.createRun({
    project: "predecessor-project",
    specRef: "spec-ref",
    worktreePath: "/tmp/predecessor-worktree",
    branch: "predecessor-branch",
    specPath: "/tmp/predecessor-worktree/spec.md",
    status: "in-progress",
  });
}

/** A fully-formed owner row for `runId`, standing in for a predecessor's `list_owned` response. */
function predecessorOwnerRowFixture(runId: string, overrides: Partial<DaemonListRunRow> = {}): DaemonListRunRow {
  return {
    runId,
    project: "predecessor-project",
    branch: "predecessor-branch",
    status: "in-progress",
    isLive: true,
    createdAt: 1,
    dismissedAt: null,
    ...overrides,
  };
}

/** `list` over a connection closed afterwards: a leaked client holds the daemon's `close()` in its socket drain. */
async function listRunsAt(socketPath: string): Promise<DaemonListRunRow[] | undefined> {
  const client = await connectIpcClient(socketPath);
  try {
    return await listRuns(client);
  } finally {
    client.close();
  }
}

/** Whether `socketPath`'s `list` currently reports `runId` as live; `false` on any RPC failure. */
async function isRunLiveAt(socketPath: string, runId: string): Promise<boolean> {
  try {
    const client = await connectIpcClient(socketPath);
    try {
      const rows = await listRuns(client);
      return rows?.find((row) => row.runId === runId)?.isLive === true;
    } finally {
      client.close();
    }
  } catch {
    return false;
  }
}

describe("outgoing-generation drain and exit (real sockets)", () => {
  socketTest(
    "upgrading while project A's run is in flight leaves project B's in-flight run uninterrupted and steerable to its normal outcome",
    async () => {
      const tempHome = mkdtempSync(join(tmpdir(), "jarvis-drain-multi-project-"));
      const originalJarvisHome = process.env.JARVIS_HOME;
      const publicSocketPath = join(tempHome, "daemon.sock");
      const incumbentPrivate = join(tempHome, "daemon-incumbent-test.sock");
      const successorPrivate = join(tempHome, "daemon-successor-test.sock");
      const dbPath = join(tempHome, "state", "v2.sqlite");
      mkdirSync(join(tempHome, "state"), { recursive: true });

      const incumbentStore = openStateStore(dbPath);
      const fakeExecutor = createFakeWriteLoopExecutor();
      const incumbentHandlers = createRunControlHandlers({
        stateStore: incumbentStore,
        writeLoopExecutor: fakeExecutor.executor,
        failureReporter: () => {},
        hasMemoryHeadroom: () => true,
        settleDelayMs: 0,
      });
      const ipcHandlers = toIpcHandlers(incumbentHandlers);

      let incumbentPublicServer: IpcServer;
      const changeoverHandler = createChangeoverHandler({
        getPrivateSocketPath: () => incumbentPrivate,
        setRetiring: incumbentHandlers.setRetiring,
        closePublicServer: () => incumbentPublicServer.close(),
      });
      const handoff = withHandoffIdentity(changeoverHandler);
      const incumbentPrivateServer = await startIpcServer(incumbentPrivate, {
        health: healthHandler,
        handoff_commit: handoff.handoff_commit,
        ...ipcHandlers,
      });
      incumbentPublicServer = await startIpcServer(publicSocketPath, {
        health: healthHandler,
        changeover: handoff.changeover,
        ...ipcHandlers,
      });

      try {
        const clientA = await connectIpcClient(incumbentPrivate);
        const runIdA = await startRun(
          clientA,
          mockWriteLoopInput({ projectName: "project-a", branchName: "branch-a" }),
        );
        clientA.close();

        const clientB = await connectIpcClient(incumbentPrivate);
        const runIdB = await startRun(
          clientB,
          mockWriteLoopInput({ projectName: "project-b", branchName: "branch-b" }),
        );
        clientB.close();
        if (typeof runIdA !== "string" || typeof runIdB !== "string") {
          throw new Error("expected both runs to admit");
        }

        process.env.JARVIS_HOME = tempHome;
        const successor = await testDaemons.start(publicSocketPath, {
          privateSocketPath: successorPrivate,
          readinessTimeoutMs: 15_000,
        });
        expect(successor.socketPath).toBe(publicSocketPath);
        expect(await health(publicSocketPath)).toEqual({ ok: true });

        // Project A's own run triggered the upgrade; project B's unrelated in-flight run is
        // uninterrupted by it — the pre-fix keyed-only addressing has no address a caller
        // consults for it once a new digest-keyed daemon exists.
        const listClient = await connectIpcClient(incumbentPrivate);
        const rows = await listRuns(listClient);
        expect(rows?.find((row) => row.runId === runIdA)?.isLive).toBe(true);
        expect(rows?.find((row) => row.runId === runIdB)?.isLive).toBe(true);
        listClient.close();

        // Project B's run still reaches its normal outcome, undisturbed by the successor now
        // holding the public address.
        fakeExecutor.settleAll();
        await flushBackgroundRuns(3);
        incumbentStore.setRunStatus(runIdB, "completed");
        expect(loadRunOrThrow(incumbentStore, runIdB).status).toBe("completed");
      } finally {
        fakeExecutor.abortAll();
        await incumbentPrivateServer.close();
        await incumbentPublicServer.close();
        incumbentStore.close();
        if (originalJarvisHome !== undefined) {
          process.env.JARVIS_HOME = originalJarvisHome;
        } else {
          delete process.env.JARVIS_HOME;
        }
        rmSync(tempHome, { recursive: true, force: true });
      }
    },
    30_000,
  );

  socketTest(
    "an outgoing generation exits once its last admitted run settles, leaving no public socket file or PID ownership behind",
    async () => {
      const tempHome = mkdtempSync(join(tmpdir(), "jarvis-drain-exit-"));
      const originalJarvisHome = process.env.JARVIS_HOME;
      const publicSocketPath = join(tempHome, "daemon.sock");
      const outgoingPrivate = join(tempHome, "daemon-outgoing-test.sock");
      const successorPrivate = join(tempHome, "daemon-successor-test.sock");
      const pidPath = join(tempHome, "daemon.pid");
      const dbPath = join(tempHome, "state", "v2.sqlite");
      mkdirSync(join(tempHome, "state"), { recursive: true });

      const outgoingStore = openStateStore(dbPath);
      const fakeExecutor = createFakeWriteLoopExecutor();
      const outgoingHandlers = createRunControlHandlers({
        stateStore: outgoingStore,
        writeLoopExecutor: fakeExecutor.executor,
        failureReporter: () => {},
        hasMemoryHeadroom: () => true,
        settleDelayMs: 0,
      });
      const ipcHandlers = toIpcHandlers(outgoingHandlers);

      let outgoingPublicServer: IpcServer;
      const changeoverHandler = createChangeoverHandler({
        getPrivateSocketPath: () => outgoingPrivate,
        setRetiring: outgoingHandlers.setRetiring,
        closePublicServer: () => outgoingPublicServer.close(),
      });
      const handoff = withHandoffIdentity(changeoverHandler);
      const outgoingPrivateServer = await startIpcServer(outgoingPrivate, {
        health: healthHandler,
        handoff_commit: handoff.handoff_commit,
        ...ipcHandlers,
      });
      outgoingPublicServer = await startIpcServer(publicSocketPath, {
        health: healthHandler,
        changeover: handoff.changeover,
        ...ipcHandlers,
      });

      const exitCodes: number[] = [];
      const drainExitLoop = startDrainExitLoop({
        shouldShutdown: () => shouldShutdownNow(false, outgoingHandlers.isRetiring(), outgoingHandlers.hasActiveRuns()),
        close: () => outgoingPrivateServer.close(),
        processExit: (code) => {
          exitCodes.push(code);
        },
        intervalMs: 20,
      });

      try {
        const client = await connectIpcClient(outgoingPrivate);
        const runId = await startRun(client);
        client.close();
        if (typeof runId !== "string") throw new Error("expected the run to admit");
        expect(outgoingHandlers.hasActiveRuns()).toBe(true);

        process.env.JARVIS_HOME = tempHome;
        const successor = await testDaemons.start(publicSocketPath, {
          privateSocketPath: successorPrivate,
          pidPath,
          readinessTimeoutMs: 15_000,
        });

        // The successor's own `list` reports the still-in-flight predecessor-held run as live —
        // drain observation over the handoff channel, not silence.
        expect(await waitFor(() => isRunLiveAt(publicSocketPath, runId), 3_000)).toBe(true);

        // Retiring with one admitted run still active: must not exit yet.
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(exitCodes).toEqual([]);
        expect(existsSync(outgoingPrivate)).toBe(true);

        fakeExecutor.settleAll();
        await flushBackgroundRuns(3);

        expect(await waitFor(() => exitCodes.length > 0, 5_000)).toBe(true);
        expect(exitCodes).toEqual([0]);

        // Clean self-shutdown: its own private endpoint is unbound.
        expect(existsSync(outgoingPrivate)).toBe(false);

        // The public artifacts belong to the successor, untouched by the outgoing generation's exit.
        expect(Number(readFileSync(pidPath, "utf-8").trim())).toBe(successor.pid);
        expect(await health(publicSocketPath)).toEqual({ ok: true });

        // The successor stops reporting the run live once the predecessor has actually drained.
        expect(await waitFor(async () => !(await isRunLiveAt(publicSocketPath, runId)), 3_000)).toBe(true);
      } finally {
        drainExitLoop.stop();
        fakeExecutor.abortAll();
        try {
          await outgoingPrivateServer.close();
        } catch {
          // already closed by the drain-exit loop
        }
        try {
          await outgoingPublicServer.close();
        } catch {
          // already closed by changeover
        }
        outgoingStore.close();
        if (originalJarvisHome !== undefined) {
          process.env.JARVIS_HOME = originalJarvisHome;
        } else {
          delete process.env.JARVIS_HOME;
        }
        rmSync(tempHome, { recursive: true, force: true });
      }
    },
    30_000,
  );

  socketTest(
    "a daemon started with a predecessorSocketPath wires drain observation into its own list",
    async () => {
      const socketPath = join(tmpdir(), `jarvis-drain-wiring-${process.pid}-${Date.now()}.sock`);
      const dbPath = join(tmpdir(), `jarvis-drain-wiring-${process.pid}-${Date.now()}.sqlite`);
      rmSync(socketPath, { force: true });
      rmSync(dbPath, { force: true });

      const store = openStateStore(dbPath);
      const runId = store.createRun({
        project: "predecessor-project",
        specRef: "spec-ref",
        worktreePath: "/tmp/predecessor-worktree",
        branch: "predecessor-branch",
        specPath: "/tmp/predecessor-worktree/spec.md",
        status: "in-progress",
      });

      let stopCalls = 0;
      const daemon = await startDaemonRuntime(socketPath, store, undefined, {
        predecessorSocketPath: "irrelevant-for-this-seam.sock",
        observePredecessorDrain: () => ({
          liveRunIds: () => new Set([runId]),
          stop: () => {
            stopCalls += 1;
          },
        }),
      });

      try {
        const rows = await listRunsAt(socketPath);
        expect(rows?.find((row) => row.runId === runId)?.isLive).toBe(true);
      } finally {
        await daemon.close();
        expect(stopCalls).toBeGreaterThan(0);
        store.close();
        rmSync(socketPath, { force: true });
        rmSync(dbPath, { force: true });
      }
    },
    15_000,
  );

  socketTest(
    "the stable list handler substitutes the outgoing owner's row, exactly once, over its own reprojection",
    async () => {
      const socketPath = join(tmpdir(), `jarvis-owner-merge-${process.pid}-${Date.now()}.sock`);
      const dbPath = join(tmpdir(), `jarvis-owner-merge-${process.pid}-${Date.now()}.sqlite`);
      rmSync(socketPath, { force: true });
      rmSync(dbPath, { force: true });

      const store = openStateStore(dbPath);
      const runId = seedPredecessorRun(store);
      const ownerRow = predecessorOwnerRowFixture(runId, { prNumber: 4242 });

      let stopCalls = 0;
      const daemon = await startDaemonRuntime(socketPath, store, undefined, {
        predecessorSocketPath: "irrelevant-for-this-seam.sock",
        observeRunOwnership: () => ({
          ownerRow: (id) => (id === runId ? ownerRow : undefined),
          resolveOwner: async (id) => id === runId,
          resolveOwnerForKey: async () => false,
          stop: () => {
            stopCalls += 1;
          },
        }),
      });

      try {
        const rows = await listRunsAt(socketPath);
        const matching = rows?.filter((row) => row.runId === runId) ?? [];
        // The daemon's own local reprojection has no PR data for this run; only the substituted
        // owner row does. This fails against the pre-fix per-daemon projection.
        expect(matching).toHaveLength(1);
        expect(matching[0]?.isLive).toBe(true);
        expect(matching[0]?.prNumber).toBe(4242);
      } finally {
        await daemon.close();
        expect(stopCalls).toBeGreaterThan(0);
        store.close();
        rmSync(socketPath, { force: true });
        rmSync(dbPath, { force: true });
      }
    },
    15_000,
  );

  socketTest(
    "an idle retiring generation exits without waiting on its own predecessor's ownership directory",
    async () => {
      const socketPath = join(tmpdir(), `jarvis-exit-independent-of-ownership-${process.pid}-${Date.now()}.sock`);
      const dbPath = join(tmpdir(), `jarvis-exit-independent-of-ownership-${process.pid}-${Date.now()}.sqlite`);
      rmSync(socketPath, { force: true });
      rmSync(dbPath, { force: true });

      const store = openStateStore(dbPath);
      const runId = seedPredecessorRun(store);
      const ownerRow = predecessorOwnerRowFixture(runId);

      const exitCodes: number[] = [];
      // Standing in for the real `process.exit`, which would kill the test runner; the cast
      // matches the seam's `never` return type without actually terminating anything.
      const processExit = ((code: number) => {
        exitCodes.push(code);
      }) as unknown as (code: number) => never;
      await startDaemonRuntime(socketPath, store, undefined, {
        predecessorSocketPath: "irrelevant-for-this-seam.sock",
        // Never drains on its own: this generation's own predecessor keeps reporting the run
        // live for the whole test, so an exit condition wrongly gated on that directory going
        // empty would never fire.
        observeRunOwnership: () => ({
          ownerRow: (id) => (id === runId ? ownerRow : undefined),
          resolveOwner: async (id) => id === runId,
          resolveOwnerForKey: async () => false,
          stop: () => undefined,
        }),
        processExit,
      });

      try {
        // The ownership directory is populated and merging through `list` — proof it never
        // empties on its own during this test.
        const rows = await listRunsAt(socketPath);
        expect(rows?.find((row) => row.runId === runId)?.isLive).toBe(true);

        const supersedeClient = await connectIpcClient(socketPath);
        supersedeClient.send({ kind: "request", id: "s1", method: "supersede" });
        await supersedeClient.nextFrame();
        supersedeClient.close();

        // No active run of its own: it exits promptly despite its predecessor's ownership
        // directory still reporting a live row above.
        expect(await waitFor(() => exitCodes.length > 0, 3_000)).toBe(true);
        expect(exitCodes).toEqual([0]);
      } finally {
        store.close();
        rmSync(socketPath, { force: true });
        rmSync(dbPath, { force: true });
      }
    },
    15_000,
  );

  socketTest(
    "against a real predecessor, the successor's stable list returns the owner's live run exactly once through the ownership directory alone, and loses it once the predecessor exits",
    async () => {
      const predSocketPath = join(tmpdir(), `jarvis-owner-drain-pred-${process.pid}-${Date.now()}.sock`);
      const predPrivateSocketPath = join(tmpdir(), `jarvis-owner-drain-pred-private-${process.pid}-${Date.now()}.sock`);
      const succSocketPath = join(tmpdir(), `jarvis-owner-drain-succ-${process.pid}-${Date.now()}.sock`);
      const dbPath = join(tmpdir(), `jarvis-owner-drain-${process.pid}-${Date.now()}.sqlite`);
      for (const path of [predSocketPath, predPrivateSocketPath, succSocketPath, dbPath]) {
        rmSync(path, { force: true });
      }

      // The run store is shared across daemon generations under one JARVIS_HOME
      // (`v2/docs/daemon-host.md`); one store instance stands in for that here.
      const store = openStateStore(dbPath);
      const fakeExecutor = createFakeWriteLoopExecutor();

      // The advisory `unionLiveRunIds` path (`observePredecessorDrain`) is neutralized on the
      // successor: it always reports an empty live set. Any `isLive: true` this test observes
      // can therefore only have come from the ownership directory's real `list_owned` poll of
      // the predecessor below, not from the advisory union — telling the two paths apart, since
      // `isLive` alone reads the same through either one.
      const neverLiveAdvisory = () => ({ liveRunIds: () => new Set<string>(), stop: () => undefined });

      const predecessor = await startDaemonRuntime(predSocketPath, store, undefined, {
        privateSocketPath: predPrivateSocketPath,
        writeLoopExecutor: fakeExecutor.executor,
        hasMemoryHeadroom: () => true,
      });
      const successor = await startDaemonRuntime(succSocketPath, store, undefined, {
        predecessorSocketPath: predPrivateSocketPath,
        observePredecessorDrain: neverLiveAdvisory,
      });

      try {
        const predClient = await connectIpcClient(predPrivateSocketPath);
        const runId = await startRun(predClient, mockWriteLoopInput());
        predClient.close();
        if (typeof runId !== "string") throw new Error("expected the run to admit on the predecessor");

        // Genuinely live in the predecessor's own `activeRuns` — real `list_owned` data, not a
        // stubbed directory.
        expect(await waitFor(() => isRunLiveAt(succSocketPath, runId), 3_000)).toBe(true);

        const listClient = await connectIpcClient(succSocketPath);
        const rows = await listRuns(listClient);
        listClient.close();
        const matching = rows?.filter((row) => row.runId === runId) ?? [];
        expect(matching).toHaveLength(1);
        expect(matching[0]?.isLive).toBe(true);

        await predecessor.close();

        // Once the predecessor is gone, the ownership directory's poll to it fails and clears —
        // the owner-only data (and, with advisory neutralized, the only source of `isLive` here)
        // is gone with it.
        expect(await waitFor(async () => !(await isRunLiveAt(succSocketPath, runId)), 3_000)).toBe(true);

        // `list` — and an unrelated handler — keep resolving normally; neither depends on the
        // drained predecessor staying reachable.
        const afterListClient = await connectIpcClient(succSocketPath);
        const afterRows = await listRuns(afterListClient);
        afterListClient.close();
        expect(afterRows?.some((row) => row.runId === runId)).toBe(true);
        expect(await health(succSocketPath)).toEqual({ ok: true });
      } finally {
        fakeExecutor.abortAll();
        await successor.close();
        store.close();
        for (const path of [predSocketPath, predPrivateSocketPath, succSocketPath, dbPath]) {
          rmSync(path, { force: true });
        }
      }
    },
    15_000,
  );
});
