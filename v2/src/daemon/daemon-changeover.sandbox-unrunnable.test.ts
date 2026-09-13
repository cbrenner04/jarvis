// Real-socket coverage for the handoff changeover protocol at the stable public address.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient } from "../ipc/client";
import { type IpcServer, type RpcHandler, startIpcServer } from "../ipc/server";
import type { IpcFrame, ResponseFrame } from "../ipc/types";
import type { LogReader, LogSink } from "../persistence/log-stream";
import { openStateStore, type StateStore } from "../persistence/state-store";
import { flushBackgroundRuns, loadRunOrThrow, mockWriteLoopInput } from "../testing/run-control";
import { createTestDaemonLifecycle } from "../testing/test-daemon-lifecycle";
import { canUseUnixSockets } from "../testing/unix-socket";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor";
import { fallbackVerdict, isHandoffStillPending, shouldShutdownNow, startDaemonRuntime } from "./daemon";
import {
  DEFAULT_CHANGEOVER_RELEASE_TIMEOUT_MS,
  DEFAULT_DAEMON_READINESS_TIMEOUT_MS,
  HANDOFF_RESOLUTION_TIMEOUT_MS,
} from "./daemon-changeover";
import { DaemonHandoffFailedError, startDaemon } from "./daemon-lifecycle";

const socketTest = test.skipIf(!canUseUnixSockets());
const testDaemons = createTestDaemonLifecycle();

function socketPathFor(name: string): string {
  return join(tmpdir(), `jarvis-handoff-${name}-${process.pid}-${Date.now()}.sock`);
}

async function health(socketPath: string): Promise<unknown> {
  const client = await connectIpcClient(socketPath);
  try {
    client.send({ kind: "request", id: "h", method: "health" });
    const frame = await client.nextFrame();
    expect(frame.kind).toBe("response");
    return (frame as ResponseFrame).result;
  } finally {
    client.close();
  }
}

async function request(socketPath: string, method: string, params?: unknown): Promise<IpcFrame> {
  const client = await connectIpcClient(socketPath);
  try {
    client.send({ kind: "request", id: `${method}-${Date.now()}`, method, params });
    return await client.nextFrame();
  } finally {
    client.close();
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, boundMs: number): Promise<boolean> {
  const deadline = Date.now() + boundMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function answersHealth(socketPath: string): Promise<boolean> {
  try {
    return (await health(socketPath)) !== undefined;
  } catch {
    return false;
  }
}

function fakeReader(): LogReader {
  return { tail: () => [], async *follow() {} };
}

function fakeSink(): LogSink {
  return { append: () => undefined, close: () => undefined };
}

type RuntimeHarness = {
  publicSocketPath: string;
  privateSocketPath: string;
  store: StateStore;
  fakeExecutor: ReturnType<typeof createFakeWriteLoopExecutor>;
  exitCodes: number[];
  publicBindCount: () => number;
  close: () => Promise<void>;
};

async function startIncumbent(
  name: string,
  options: {
    fallbackMs?: number;
    bind?: (socketPath: string, handlers?: Record<string, RpcHandler>) => Promise<IpcServer>;
  } = {},
): Promise<RuntimeHarness> {
  const root = mkdtempSync(join(tmpdir(), `jarvis-handoff-${name}-`));
  const publicSocketPath = join(root, "daemon.sock");
  const privateSocketPath = join(root, "daemon-incumbent.sock");
  const store = openStateStore(join(root, "state.sqlite"));
  const fakeExecutor = createFakeWriteLoopExecutor();
  const exitCodes: number[] = [];
  let publicBindCount = 0;
  const bind = options.bind ?? startIpcServer;
  const runtime = await startDaemonRuntime(publicSocketPath, store, fakeReader(), {
    privateSocketPath,
    openLogSink: () => fakeSink(),
    enumerateOtherDaemonSockets: () => [],
    processExit: (code) => {
      exitCodes.push(code);
      throw new Error(`unexpected process exit ${code}`);
    },
    hasMemoryHeadroom: () => true,
    writeLoopExecutor: async (input, signal, pauseSignal) => {
      await fakeExecutor.executor(input, signal, pauseSignal);
      const run = store.findRunByProjectBranch({
        project: input.worktree.projectName,
        branch: input.worktree.branchName,
        stepId: input.stepId ?? null,
      });
      if (run !== null) store.commitTerminalRunSettlement({ runId: run.id, status: "completed" });
    },
    startIpcServer: async (path, handlers) => {
      if (path === publicSocketPath) publicBindCount += 1;
      return bind(path, handlers);
    },
    ...(options.fallbackMs === undefined ? {} : { handoffFallbackMs: options.fallbackMs }),
  });
  return {
    publicSocketPath,
    privateSocketPath,
    store,
    fakeExecutor,
    exitCodes,
    publicBindCount: () => publicBindCount,
    close: async () => {
      // Stop the runtime (and its drain-exit loop) before aborting runs: aborting first let an
      // idle retiring incumbent drain-exit mid-teardown under load ("unexpected process exit").
      await runtime.close();
      fakeExecutor.abortAll();
      await flushBackgroundRuns(3);
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function beginChangeover(harness: RuntimeHarness): Promise<string> {
  const frame = await request(harness.publicSocketPath, "changeover");
  expect(frame.kind).toBe("response");
  const result = (frame as ResponseFrame).result as { handoffId?: unknown; privateSocketPath?: unknown };
  expect(result.privateSocketPath).toBe(harness.privateSocketPath);
  expect(typeof result.handoffId).toBe("string");
  return result.handoffId as string;
}

async function startWork(socketPath: string, projectName: string): Promise<string> {
  const frame = await request(socketPath, "start", {
    input: mockWriteLoopInput({ projectName, branchName: `${projectName}-branch` }),
  });
  if (frame.kind !== "response") throw new Error(`start failed: ${JSON.stringify(frame)}`);
  return ((frame as ResponseFrame).result as { runId: string }).runId;
}

describe("daemon handoff changeover (real sockets)", () => {
  test("a pending handoff gates idle drain-exit but not explicit shutdown", () => {
    expect(shouldShutdownNow(false, true, false, true)).toBe(false);
    expect(shouldShutdownNow(false, true, false, false)).toBe(true);
    expect(shouldShutdownNow(true, true, false, true)).toBe(true);
  });

  test("isHandoffStillPending is true only for the exact still-pending transaction", () => {
    expect(isHandoffStillPending("h1", "pending", "h1")).toBe(true);
    expect(isHandoffStillPending("h1", "committed", "h1")).toBe(false);
    expect(isHandoffStillPending("h1", "rolled_back", "h1")).toBe(false);
    expect(isHandoffStillPending("h2", "pending", "h1")).toBe(false);
    expect(isHandoffStillPending(undefined, undefined, "h1")).toBe(false);
  });

  test("fallbackVerdict commits only when the public address answers live", () => {
    expect(fallbackVerdict(true)).toBe("commit");
    expect(fallbackVerdict(false)).toBe("rollback");
  });

  socketTest(
    "an incoming generation completes changeover: the outgoing generation refuses admission before releasing, the incoming generation answers after",
    async () => {
      const publicSocketPath = socketPathFor("public");
      const incumbentPrivate = socketPathFor("incumbent-private");
      const successorPrivate = socketPathFor("successor-private");
      rmSync(publicSocketPath, { force: true });
      rmSync(incumbentPrivate, { force: true });
      rmSync(successorPrivate, { force: true });

      const incumbent = await startDaemonRuntime(publicSocketPath, undefined, undefined, {
        privateSocketPath: incumbentPrivate,
      });
      try {
        const metadata = await testDaemons.start(publicSocketPath, {
          privateSocketPath: successorPrivate,
          readinessTimeoutMs: 15_000,
        });
        expect(metadata.socketPath).toBe(publicSocketPath);

        // The outgoing generation is retiring: its own still-live private endpoint refuses new
        // admission — this pre-fix keyed-daemon coexistence model has no such refusal at all.
        const incumbentClient = await connectIpcClient(incumbentPrivate);
        incumbentClient.send({ kind: "request", id: "s1", method: "start", params: { input: mockWriteLoopInput() } });
        const refused = await incumbentClient.nextFrame();
        expect(refused.kind).toBe("error");
        expect((refused as { code?: string }).code).toBe("daemon_superseded");
        incumbentClient.close();

        // The incoming generation now answers on the public address — the address this test
        // fails against under the pre-fix refusal-on-occupied-address behavior, which never
        // reaches this point at all (`testDaemons.start` above would have thrown).
        expect(await health(publicSocketPath)).toEqual({ ok: true });
      } finally {
        await incumbent.close();
        rmSync(publicSocketPath, { force: true });
        rmSync(incumbentPrivate, { force: true });
        rmSync(successorPrivate, { force: true });
      }
    },
    30_000,
  );

  socketTest(
    "the incumbent's drained public release never unlinks the successor's rebound public socket",
    async () => {
      const incumbent = await startIncumbent("release-unlink");
      let successor: IpcServer | undefined;
      try {
        // A live run keeps the committed incumbent draining, as in the observed outage.
        await startWork(incumbent.publicSocketPath, "draining-through-release");
        // A long-lived public client (e.g. a follow stream) holds the incumbent's release in drain.
        const held = await connectIpcClient(incumbent.publicSocketPath);
        const handoffId = await beginChangeover(incumbent);
        expect(await waitFor(() => !existsSync(incumbent.publicSocketPath), 2_000)).toBe(true);
        successor = await startIpcServer(incumbent.publicSocketPath, {
          health: () => ({ kind: "response", result: { successor: true } }),
        });
        held.close();
        const committed = await request(incumbent.privateSocketPath, "handoff_commit", { handoffId });
        expect(committed.kind).toBe("response");
        await flushBackgroundRuns(3);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(existsSync(incumbent.publicSocketPath)).toBe(true);
        expect(await health(incumbent.publicSocketPath)).toEqual({ successor: true });
      } finally {
        await successor?.close();
        await incumbent.close();
      }
    },
    30_000,
  );

  socketTest(
    "an incoming generation whose handoff request goes unanswered fails startup and leaves the incumbent serving",
    async () => {
      const publicSocketPath = socketPathFor("unanswered-public");
      const successorPrivate = socketPathFor("unanswered-successor-private");
      rmSync(publicSocketPath, { force: true });
      rmSync(successorPrivate, { force: true });

      const handlers: Record<string, RpcHandler> = {
        health: () => ({ kind: "response", result: { ok: true } }),
        // Never resolves: simulates a live peer that accepts the connection but never replies.
        changeover: () => new Promise(() => {}),
      };
      const incumbent = await startIpcServer(publicSocketPath, handlers);
      try {
        await expect(
          startDaemon(publicSocketPath, {
            privateSocketPath: successorPrivate,
            changeoverTimeoutMs: 200,
            readinessTimeoutMs: 5_000,
          }),
        ).rejects.toBeInstanceOf(DaemonHandoffFailedError);

        expect(await health(publicSocketPath)).toEqual({ ok: true });
      } finally {
        await incumbent.close();
        rmSync(publicSocketPath, { force: true });
        rmSync(successorPrivate, { force: true });
      }
    },
    15_000,
  );

  socketTest(
    "the changeover reply names the outgoing generation's private endpoint, which answers after the public address is released",
    async () => {
      const publicSocketPath = socketPathFor("reply-public");
      const privateSocketPath = socketPathFor("reply-private");
      rmSync(publicSocketPath, { force: true });
      rmSync(privateSocketPath, { force: true });

      const incumbent = await startDaemonRuntime(publicSocketPath, undefined, undefined, { privateSocketPath });
      try {
        const client = await connectIpcClient(publicSocketPath);
        client.send({ kind: "request", id: "c1", method: "changeover" });
        const frame = await client.nextFrame();
        expect(frame.kind).toBe("response");
        const result = (frame as ResponseFrame).result as { ok: boolean; privateSocketPath: string };
        expect(result.privateSocketPath).toBe(privateSocketPath);
        client.close();

        let released = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            const probe = await connectIpcClient(publicSocketPath);
            probe.close();
          } catch {
            released = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(released).toBe(true);

        expect(await health(privateSocketPath)).toEqual({ ok: true });
      } finally {
        await incumbent.close();
        rmSync(publicSocketPath, { force: true });
        rmSync(privateSocketPath, { force: true });
      }
    },
    15_000,
  );

  socketTest(
    "rollback restores the incumbent public listener and admission without disturbing admitted work",
    async () => {
      const incumbent = await startIncumbent("rollback", { fallbackMs: 5_000 });
      try {
        const admittedRunId = await startWork(incumbent.publicSocketPath, "admitted-before-handoff");
        expect(await waitFor(() => incumbent.fakeExecutor.pendingCount() === 1, 1_000)).toBe(true);

        const handoffId = await beginChangeover(incumbent);
        const refused = await request(incumbent.privateSocketPath, "start", {
          input: mockWriteLoopInput({ projectName: "refused-during-handoff" }),
        });
        expect(refused.kind).toBe("error");
        expect((refused as { code?: string }).code).toBe("daemon_superseded");

        const rollback = await request(incumbent.privateSocketPath, "handoff_rollback", { handoffId });
        expect(rollback.kind).toBe("response");
        expect((rollback as ResponseFrame).result).toEqual({ ok: true, state: "rolled_back" });
        expect(await health(incumbent.publicSocketPath)).toEqual({ ok: true });

        const newRunId = await startWork(incumbent.publicSocketPath, "admitted-after-rollback");
        const duplicates = await Promise.all([
          request(incumbent.privateSocketPath, "handoff_rollback", { handoffId }),
          request(incumbent.privateSocketPath, "handoff_rollback", { handoffId }),
        ]);
        for (const duplicate of duplicates) {
          expect((duplicate as ResponseFrame).result).toEqual({ ok: true, state: "rolled_back" });
        }
        expect(incumbent.publicBindCount()).toBe(2);
        // The one rebound listener admits; a stray second listener would have failed the live-socket guard.
        await startWork(incumbent.publicSocketPath, "admitted-after-duplicate-rollback");

        incumbent.fakeExecutor.settleAll();
        expect(
          await waitFor(
            () =>
              loadRunOrThrow(incumbent.store, admittedRunId).status === "completed" &&
              loadRunOrThrow(incumbent.store, newRunId).status === "completed",
            1_000,
          ),
        ).toBe(true);
      } finally {
        await incumbent.close();
      }
    },
    15_000,
  );

  socketTest(
    "commit leaves the successor public and makes a late rollback inert",
    async () => {
      const incumbent = await startIncumbent("commit", { fallbackMs: 5_000 });
      let successor: IpcServer | undefined;
      try {
        await startWork(incumbent.publicSocketPath, "active-through-commit");
        const handoffId = await beginChangeover(incumbent);
        expect(await waitFor(() => answersHealth(incumbent.publicSocketPath).then((live) => !live), 3_000)).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 100));
        successor = await startIpcServer(incumbent.publicSocketPath, {
          health: () => ({ kind: "response", result: { ok: true } }),
        });

        const committed = await request(incumbent.privateSocketPath, "handoff_commit", { handoffId });
        expect((committed as ResponseFrame).result).toEqual({ ok: true, state: "committed" });
        const duplicate = await request(incumbent.privateSocketPath, "handoff_commit", { handoffId });
        expect((duplicate as ResponseFrame).result).toEqual({ ok: true, state: "committed" });
        const lateRollback = await request(incumbent.privateSocketPath, "handoff_rollback", { handoffId });
        expect((lateRollback as ResponseFrame).result).toEqual({ ok: true, state: "committed" });
        const anotherChangeover = await request(incumbent.privateSocketPath, "changeover");
        expect(anotherChangeover.kind).toBe("error");
        expect((anotherChangeover as { code?: string }).code).toBe("handoff_committed");

        const refused = await request(incumbent.privateSocketPath, "start", {
          input: mockWriteLoopInput({ projectName: "refused-after-commit" }),
        });
        expect(refused.kind).toBe("error");
        expect((refused as { code?: string }).code).toBe("daemon_superseded");
        expect(await health(incumbent.publicSocketPath)).toEqual({ ok: true });
      } finally {
        await successor?.close();
        await incumbent.close();
      }
    },
    15_000,
  );

  socketTest(
    "unknown and stale handoff identities cannot change ownership",
    async () => {
      const incumbent = await startIncumbent("identity", { fallbackMs: 5_000 });
      try {
        const beforeChangeover = await request(incumbent.privateSocketPath, "handoff_commit", { handoffId: "none" });
        expect(beforeChangeover.kind).toBe("error");
        const firstId = await beginChangeover(incumbent);
        const repeatedChangeover = await request(incumbent.privateSocketPath, "changeover");
        expect(((repeatedChangeover as ResponseFrame).result as { handoffId: string }).handoffId).toBe(firstId);
        for (const method of ["handoff_commit", "handoff_rollback"]) {
          const mismatch = await request(incumbent.privateSocketPath, method, { handoffId: "unknown" });
          expect(mismatch.kind).toBe("error");
          expect((mismatch as { code?: string }).code).toBe("handoff_identity_mismatch");
        }
        const missing = await request(incumbent.privateSocketPath, "handoff_rollback");
        expect(missing.kind).toBe("error");
        const blank = await request(incumbent.privateSocketPath, "handoff_rollback", { handoffId: "" });
        expect(blank.kind).toBe("error");
        expect(await answersHealth(incumbent.publicSocketPath)).toBe(false);

        await request(incumbent.privateSocketPath, "handoff_rollback", { handoffId: firstId });
        const secondId = await beginChangeover(incumbent);
        expect(secondId).not.toBe(firstId);
        const stale = await request(incumbent.privateSocketPath, "handoff_rollback", { handoffId: firstId });
        expect(stale.kind).toBe("error");
        expect(await answersHealth(incumbent.publicSocketPath)).toBe(false);
        await request(incumbent.privateSocketPath, "handoff_rollback", { handoffId: secondId });
        expect(await health(incumbent.publicSocketPath)).toEqual({ ok: true });
      } finally {
        await incumbent.close();
      }
    },
    15_000,
  );

  socketTest(
    "an idle incumbent survives while handoff is pending",
    async () => {
      const incumbent = await startIncumbent("idle-pending", { fallbackMs: 2_000 });
      try {
        const handoffId = await beginChangeover(incumbent);
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(incumbent.exitCodes).toEqual([]);
        expect(await health(incumbent.privateSocketPath)).toEqual({ ok: true });
        await request(incumbent.privateSocketPath, "handoff_rollback", { handoffId });
      } finally {
        await incumbent.close();
      }
    },
    15_000,
  );

  socketTest(
    "the default fallback does not roll back a successor still inside its startup budget",
    async () => {
      // Regression: a 5s default fallback rolled back while a slow successor was still within
      // startDaemon's release + readiness budget, letting the incumbent answer the successor's probe.
      const budgetMs =
        DEFAULT_CHANGEOVER_RELEASE_TIMEOUT_MS + DEFAULT_DAEMON_READINESS_TIMEOUT_MS + HANDOFF_RESOLUTION_TIMEOUT_MS;
      const incumbent = await startIncumbent("default-fallback");
      try {
        const handoffId = await beginChangeover(incumbent);
        // Probing continuously past the old 5s deadline: a premature rollback rebinds the public address.
        const rolledBackEarly = await waitFor(() => answersHealth(incumbent.publicSocketPath), 5_500);
        expect(rolledBackEarly).toBe(false);
        expect(incumbent.publicBindCount()).toBe(1);
        expect(budgetMs).toBeGreaterThan(5_500);
        const rollback = await request(incumbent.privateSocketPath, "handoff_rollback", { handoffId });
        expect((rollback as ResponseFrame).result).toEqual({ ok: true, state: "rolled_back" });
      } finally {
        await incumbent.close();
      }
    },
    20_000,
  );

  socketTest(
    "an unanswered handoff rolls back after fallback finds no public daemon",
    async () => {
      const incumbent = await startIncumbent("fallback", { fallbackMs: 100 });
      try {
        await beginChangeover(incumbent);
        expect(await waitFor(() => answersHealth(incumbent.publicSocketPath), 3_000)).toBe(true);
        expect(incumbent.exitCodes).toEqual([]);
        expect(incumbent.publicBindCount()).toBe(2);
        await startWork(incumbent.publicSocketPath, "admitted-after-fallback");
      } finally {
        await incumbent.close();
      }
    },
    15_000,
  );

  socketTest(
    "an unanswered handoff commits after fallback finds a live public daemon",
    async () => {
      // Resolves once the incumbent's public close (including its trailing path unlink) finishes, so the
      // stand-in successor never binds a path the incumbent is still about to unlink under load.
      let markReleased: (() => void) | undefined;
      const released = new Promise<void>((resolve) => {
        markReleased = resolve;
      });
      let decorated = false;
      const incumbent = await startIncumbent("fallback-commit", {
        fallbackMs: 1_000,
        bind: async (path, handlers) => {
          const server = await startIpcServer(path, handlers);
          if (!path.endsWith("daemon.sock") || decorated) return server;
          decorated = true;
          return {
            ...server,
            close: async () => {
              try {
                await server.close();
              } finally {
                markReleased?.();
              }
            },
          };
        },
      });
      let successor: IpcServer | undefined;
      try {
        await startWork(incumbent.publicSocketPath, "active-through-fallback-commit");
        const handoffId = await beginChangeover(incumbent);
        await released;
        successor = await startIpcServer(incumbent.publicSocketPath, {
          health: () => ({ kind: "response", result: { ok: true } }),
        });
        // `changeover` returns the same pending transaction until settled and refuses `handoff_committed`
        // after commit, so it observes the fallback's verdict without a fixed sleep. Stop polling if the
        // incumbent rebinds (rollback): a changeover after rollback would open a new transaction.
        const settledByFallback = async (): Promise<boolean> => {
          if (incumbent.publicBindCount() !== 1) return true;
          const frame = await request(incumbent.privateSocketPath, "changeover");
          return frame.kind === "error" && (frame as { code?: string }).code === "handoff_committed";
        };
        expect(await waitFor(settledByFallback, 10_000)).toBe(true);
        expect(incumbent.publicBindCount()).toBe(1);
        const lateRollback = await request(incumbent.privateSocketPath, "handoff_rollback", { handoffId });
        expect((lateRollback as ResponseFrame).result).toEqual({ ok: true, state: "committed" });
        expect(await health(incumbent.publicSocketPath)).toEqual({ ok: true });
      } finally {
        await successor?.close();
        await incumbent.close();
      }
    },
    15_000,
  );

  socketTest(
    "rollback waits for public release before rebinding",
    async () => {
      let releasePublic: (() => void) | undefined;
      const releaseGate = new Promise<void>((resolve) => {
        releasePublic = resolve;
      });
      let decorated = false;
      const incumbent = await startIncumbent("release-order", {
        fallbackMs: 5_000,
        bind: async (path, handlers) => {
          const server = await startIpcServer(path, handlers);
          if (path.endsWith("daemon.sock") && !decorated) {
            decorated = true;
            return {
              ...server,
              close: async () => {
                await releaseGate;
                await server.close();
              },
            };
          }
          return server;
        },
      });
      try {
        const handoffId = await beginChangeover(incumbent);
        let settled = false;
        const rollback = request(incumbent.privateSocketPath, "handoff_rollback", { handoffId }).then((frame) => {
          settled = true;
          return frame;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(settled).toBe(false);
        expect(incumbent.publicBindCount()).toBe(1);
        const commit = request(incumbent.privateSocketPath, "handoff_commit", { handoffId });
        releasePublic?.();
        expect((await rollback).kind).toBe("response");
        expect(((await commit) as ResponseFrame).result).toEqual({ ok: true, state: "rolled_back" });
        expect(incumbent.publicBindCount()).toBe(2);
      } finally {
        releasePublic?.();
        await incumbent.close();
      }
    },
    15_000,
  );

  socketTest(
    "rollback bind failure stays retiring and surfaces the failure",
    async () => {
      let publicBinds = 0;
      const incumbent = await startIncumbent("rebind-failure", {
        fallbackMs: 5_000,
        bind: async (path, handlers) => {
          if (path.endsWith("daemon.sock")) {
            publicBinds += 1;
            if (publicBinds === 2) throw new Error("rebind failed");
          }
          return startIpcServer(path, handlers);
        },
      });
      try {
        const handoffId = await beginChangeover(incumbent);
        const rollback = await request(incumbent.privateSocketPath, "handoff_rollback", { handoffId });
        expect(rollback.kind).toBe("error");
        expect((rollback as { code?: string }).code).toBe("handoff_rollback_failed");
        expect(await answersHealth(incumbent.publicSocketPath)).toBe(false);
        const refused = await request(incumbent.privateSocketPath, "start", {
          input: mockWriteLoopInput({ projectName: "refused-after-rebind-failure" }),
        });
        expect(refused.kind).toBe("error");
        expect((refused as { code?: string }).code).toBe("daemon_superseded");
      } finally {
        await incumbent.close();
      }
    },
    15_000,
  );

  socketTest(
    "a fallback rollback that fails once still resolves the pending handoff once rebind succeeds",
    async () => {
      let publicBinds = 0;
      const incumbent = await startIncumbent("fallback-retry", {
        fallbackMs: 100,
        bind: async (path, handlers) => {
          if (path.endsWith("daemon.sock")) {
            publicBinds += 1;
            // The first fallback-triggered rebind fails; the pre-fix code never tries again and
            // the pending handoff is stuck forever. A later rebind attempt succeeds.
            if (publicBinds === 2) throw new Error("rebind failed");
          }
          return startIpcServer(path, handlers);
        },
      });
      try {
        await beginChangeover(incumbent);
        expect(await waitFor(() => answersHealth(incumbent.publicSocketPath), 3_000)).toBe(true);
        expect(incumbent.exitCodes).toEqual([]);
        expect(publicBinds).toBeGreaterThanOrEqual(3);
        await startWork(incumbent.publicSocketPath, "admitted-after-fallback-retry");
      } finally {
        await incumbent.close();
      }
    },
    15_000,
  );

  socketTest(
    "rollback after supersede rebinds the public listener but leaves the incumbent non-admitting",
    async () => {
      const incumbent = await startIncumbent("superseded-rollback", { fallbackMs: 5_000 });
      try {
        const superseded = await request(incumbent.privateSocketPath, "supersede");
        expect(superseded.kind).toBe("response");

        const handoffId = await beginChangeover(incumbent);
        const rollback = await request(incumbent.privateSocketPath, "handoff_rollback", { handoffId });
        expect((rollback as ResponseFrame).result).toEqual({ ok: true, state: "rolled_back" });

        // The pre-fix code always reopens admission on rollback, ignoring an earlier supersede.
        expect(await health(incumbent.publicSocketPath)).toEqual({ ok: true });
        const refused = await request(incumbent.publicSocketPath, "start", {
          input: mockWriteLoopInput({ projectName: "refused-after-superseded-rollback" }),
        });
        expect(refused.kind).toBe("error");
        expect((refused as { code?: string }).code).toBe("daemon_superseded");
      } finally {
        await incumbent.close();
      }
    },
    15_000,
  );
});
