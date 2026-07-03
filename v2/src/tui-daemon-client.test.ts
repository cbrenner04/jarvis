import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createRunControlHandlers } from "./daemon.ts";
import type { IpcClient } from "./ipc/client.ts";
import { connectIpcClient } from "./ipc/client.ts";
import { type IpcServer, startIpcServer } from "./ipc/server.ts";
import type { IpcFrame } from "./ipc/types.ts";
import { type LogSink, openLogReader, openLogSink } from "./persistence/log-stream.ts";
import { openStateStore, type StateStore } from "./persistence/state-store.ts";
import { simulatedBindings } from "./testing/bindings.ts";
import { canUseUnixSockets, socketProbeErrored } from "./testing/unix-socket.ts";
import { connectTuiDaemon } from "./tui-daemon-client.ts";
import { TuiDaemonConnectionError, TuiDaemonRpcError } from "./tui-daemon-errors.ts";
import type { WriteLoopInput } from "./execution/write-loop.ts";

const START_INPUT: WriteLoopInput = {
  worktree: {
    projectRoot: "/tmp/repo",
    projectName: "demo",
    branchName: "write-run",
    baseRef: "HEAD",
  },
  specPath: "spec.md",
  stepRules: "Return exactly one terminal token: done|no-work|blocked|progress.",
  expectedArtifactPath: "proof.txt",
  bindings: simulatedBindings(["done"]),
};

if (socketProbeErrored) {
  process.stderr.write("skip: TUI daemon client socket tests require socket support in /tmp\n");
}

const SOCKET_PATH = join(tmpdir(), `jarvis-tui-daemon-client-${process.pid}.sock`);
const UNREACHABLE_SOCKET_PATH = join(tmpdir(), `jarvis-tui-daemon-client-missing-${process.pid}.sock`);
const DEFAULT_SOCKET_PATH = join(homedir(), ".jarvis", "daemon.sock");
const socketTest = test.skipIf(!canUseUnixSockets());

const HEALTH_REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const STATUS_REQUEST_ID = "00000000-0000-4000-8000-000000000002";
const START_REQUEST_ID = "00000000-0000-4000-8000-000000000003";
const LIST_REQUEST_ID = "00000000-0000-4000-8000-000000000004";
const WAIT_REQUEST_ID = "00000000-0000-4000-8000-000000000005";
const PAUSE_REQUEST_ID = "00000000-0000-4000-8000-000000000008";
const RESUME_REQUEST_ID = "00000000-0000-4000-8000-000000000009";
const KILL_REQUEST_ID = "00000000-0000-4000-8000-00000000000a";

type PendingExecutorRun = {
  signal: AbortSignal;
  release: () => void;
};

function withFixedUuids<T>(ids: string[], fn: () => Promise<T>): Promise<T> {
  const queue = [...ids];
  const originalRandomUuid = crypto.randomUUID;
  crypto.randomUUID = () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("no more fixed UUIDs");
    return next as `${string}-${string}-${string}-${string}-${string}`;
  };
  return fn().finally(() => {
    crypto.randomUUID = originalRandomUuid;
  });
}

function makeClient(frames: IpcFrame[], sent: unknown[] = []): IpcClient {
  const queue = [...frames];
  let sentCount = 0;
  let deliveredCount = 0;
  let waiter:
    | {
        resolve: (frame: IpcFrame) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  let closed = false;
  return {
    send(frame: unknown): void {
      sent.push(frame);
      sentCount += 1;
      if (waiter && deliveredCount < sentCount) {
        const next = queue.shift();
        if (next !== undefined) {
          deliveredCount += 1;
          const pending = waiter;
          waiter = undefined;
          pending.resolve(next);
        }
      }
    },
    async nextFrame(): Promise<IpcFrame> {
      if (deliveredCount < sentCount) {
        const frame = queue.shift();
        if (frame === undefined) {
          throw new Error("connection closed");
        }
        deliveredCount += 1;
        return frame;
      }
      if (closed) {
        throw new Error("connection closed");
      }
      return new Promise<IpcFrame>((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
    close(): void {
      closed = true;
      waiter?.reject(new Error("connection closed"));
      waiter = undefined;
    },
  };
}

function createDeferredClient(sent: unknown[] = []) {
  const queue: IpcFrame[] = [];
  let waiter:
    | {
        resolve: (frame: IpcFrame) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  let closed = false;

  const push = (frame: IpcFrame): void => {
    if (closed) return;
    if (waiter) {
      const pending = waiter;
      waiter = undefined;
      pending.resolve(frame);
      return;
    }
    queue.push(frame);
  };

  const client: IpcClient = {
    send(frame: unknown): void {
      sent.push(frame);
    },
    async nextFrame(): Promise<IpcFrame> {
      const frame = queue.shift();
      if (frame) return frame;
      if (closed) throw new Error("connection closed");
      return new Promise<IpcFrame>((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
    close(): void {
      closed = true;
      waiter?.reject(new Error("connection closed"));
      waiter = undefined;
    },
  };

  return { client, push };
}

function createFakeWriteLoopExecutor() {
  const pending: PendingExecutorRun[] = [];

  return {
    executor: async (_input: WriteLoopInput, signal: AbortSignal): Promise<void> => {
      await new Promise<void>((resolve) => {
        pending.push({ signal, release: resolve });
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    settleAll(): void {
      while (pending.length > 0) {
        pending.shift()?.release();
      }
    },
  };
}

function input(): WriteLoopInput {
  return {
    worktree: {
      projectRoot: "/tmp/test-project",
      projectName: "test-project",
      branchName: "test-branch",
      baseRef: "main",
    },
    specPath: "/tmp/test-project/spec.md",
    stepRules: "test rules",
    expectedArtifactPath: "/tmp/test-project/artifact",
    bindings: [],
  };
}

async function flushBackgroundRuns(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function expectRunId(frame: IpcFrame): string {
  expect(frame.kind).toBe("response");
  if (frame.kind !== "response") throw new Error("expected response");
  const runId = (frame.result as { runId?: unknown }).runId;
  expect(typeof runId).toBe("string");
  return runId as string;
}

function finishLoop(runId: string, stateStore: StateStore, logSink: LogSink, iterationsConsumed = 1): void {
  stateStore.setRunStatus(runId, "completed");
  logSink.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: "complete",
    iterationsConsumed,
    resumable: false,
  });
}

let server: IpcServer;
let stateStore: StateStore;
let logSink: LogSink;
let fakeExecutor: ReturnType<typeof createFakeWriteLoopExecutor>;
let logsPath: string;

beforeEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  rmSync(UNREACHABLE_SOCKET_PATH, { force: true });
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  stateStore = openStateStore(join(tmpdir(), `jarvis-tui-daemon-state-${unique}.db`));
  logsPath = join(tmpdir(), `jarvis-tui-daemon-logs-${unique}.jsonl`);
  logSink = openLogSink(logsPath);
  fakeExecutor = createFakeWriteLoopExecutor();
  server = await startIpcServer(
    SOCKET_PATH,
    createRunControlHandlers({
      stateStore,
      logReader: openLogReader(logsPath),
      writeLoopExecutor: fakeExecutor.executor,
      failureReporter: () => undefined,
    }),
  );
});

afterEach(async () => {
  if (!canUseUnixSockets() || !server) {
    return;
  }
  fakeExecutor.settleAll();
  await flushBackgroundRuns();
  await server.close();
  logSink.close();
  stateStore.close();
  rmSync(SOCKET_PATH, { force: true });
  rmSync(UNREACHABLE_SOCKET_PATH, { force: true });
});

test("uses injected connectIpcClient instead of production transport", async () => {
  const sent: unknown[] = [];
  let connectCalls = 0;
  const fakeConnect = async (socketPath: string): Promise<IpcClient> => {
    connectCalls += 1;
    expect(socketPath).toBe("/tmp/injected.sock");
    return makeClient(
      [
        { kind: "response", id: HEALTH_REQUEST_ID, result: { ok: true } },
        { kind: "response", id: STATUS_REQUEST_ID, result: { state: "running" } },
        {
          kind: "response",
          id: LIST_REQUEST_ID,
          result: {
            runs: [{ runId: "run-1", project: "demo", branch: "main", status: "completed", isLive: false }],
          },
        },
        { kind: "response", id: WAIT_REQUEST_ID, result: { runStatus: "completed" } },
      ],
      sent,
    );
  };

  await withFixedUuids([HEALTH_REQUEST_ID, STATUS_REQUEST_ID, LIST_REQUEST_ID, WAIT_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      socketPath: "/tmp/injected.sock",
      connectIpcClient: fakeConnect,
    });

    await expect(client.health()).resolves.toEqual({ ok: true });
    await expect(client.status()).resolves.toEqual({ state: "running" });
    await expect(client.list()).resolves.toEqual({
      runs: [{ runId: "run-1", project: "demo", branch: "main", status: "completed", isLive: false }],
    });
    await expect(client.wait("run-1")).resolves.toEqual({ runStatus: "completed" });
    client.close();
  });

  expect(connectCalls).toBe(1);
  expect(sent).toEqual([
    { kind: "request", id: HEALTH_REQUEST_ID, method: "health" },
    { kind: "request", id: STATUS_REQUEST_ID, method: "status" },
    { kind: "request", id: LIST_REQUEST_ID, method: "list" },
    { kind: "request", id: WAIT_REQUEST_ID, method: "wait", params: { runId: "run-1" } },
  ]);
});

test("defaults socket path to ~/.jarvis/daemon.sock when omitted", async () => {
  let seenPath: string | undefined;
  await withFixedUuids([HEALTH_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async (socketPath) => {
        seenPath = socketPath;
        return makeClient([{ kind: "response", id: HEALTH_REQUEST_ID, result: { ok: true } }]);
      },
    });
    await client.health();
    client.close();
  });
  expect(seenPath).toBe(DEFAULT_SOCKET_PATH);
});

test("health then status reuse one connection without reconnecting", async () => {
  let connectCalls = 0;
  await withFixedUuids([HEALTH_REQUEST_ID, STATUS_REQUEST_ID, LIST_REQUEST_ID, WAIT_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () => {
        connectCalls += 1;
        return makeClient([
          { kind: "response", id: HEALTH_REQUEST_ID, result: { ok: true } },
          { kind: "response", id: STATUS_REQUEST_ID, result: { state: "running" } },
          { kind: "response", id: LIST_REQUEST_ID, result: { runs: [] } },
          { kind: "response", id: WAIT_REQUEST_ID, result: { runStatus: "completed" } },
        ]);
      },
    });

    await expect(client.health()).resolves.toEqual({ ok: true });
    await expect(client.status()).resolves.toEqual({ state: "running" });
    await expect(client.list()).resolves.toEqual({ runs: [] });
    await expect(client.wait("run-1")).resolves.toEqual({ runStatus: "completed" });
    client.close();
  });

  expect(connectCalls).toBe(1);
});

test("rejects correlated health error frames as TuiDaemonRpcError", async () => {
  await withFixedUuids([HEALTH_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient([{ kind: "error", id: HEALTH_REQUEST_ID, code: "unhealthy", message: "daemon not ready" }]),
    });

    await expect(client.health()).rejects.toMatchObject({
      name: "TuiDaemonRpcError",
      code: "unhealthy",
      message: "daemon not ready",
    });
    client.close();
  });
});

test("rejects correlated status error frames as TuiDaemonRpcError", async () => {
  await withFixedUuids([STATUS_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient([{ kind: "error", id: STATUS_REQUEST_ID, code: "status_unavailable", message: "no status" }]),
    });

    await expect(client.status()).rejects.toBeInstanceOf(TuiDaemonRpcError);
    client.close();
  });
});

test("list sends one correlated IPC list request and returns parsed runs", async () => {
  const sent: unknown[] = [];
  await withFixedUuids([LIST_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient(
          [
            {
              kind: "response",
              id: LIST_REQUEST_ID,
              result: {
                runs: [{ runId: "run-123", project: "demo", branch: "feature", status: "completed", isLive: false }],
              },
            },
          ],
          sent,
        ),
    });

    await expect(client.list()).resolves.toEqual({
      runs: [{ runId: "run-123", project: "demo", branch: "feature", status: "completed", isLive: false }],
    });
    expect(sent).toEqual([{ kind: "request", id: LIST_REQUEST_ID, method: "list" }]);
    client.close();
  });
});

test("wait sends one correlated IPC wait request and returns only present optional fields", async () => {
  const sent: unknown[] = [];
  await withFixedUuids([WAIT_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient(
          [
            {
              kind: "response",
              id: WAIT_REQUEST_ID,
              result: { runStatus: "completed", loopOutcomeKind: "complete", iterationsConsumed: 2 },
            },
          ],
          sent,
        ),
    });

    await expect(client.wait("run-123")).resolves.toEqual({
      runStatus: "completed",
      loopOutcomeKind: "complete",
      iterationsConsumed: 2,
    });
    expect(sent).toEqual([{ kind: "request", id: WAIT_REQUEST_ID, method: "wait", params: { runId: "run-123" } }]);
    client.close();
  });
});

test("list succeeds while wait is unresolved on the same client", async () => {
  const sent: unknown[] = [];
  const deferred = createDeferredClient(sent);

  await withFixedUuids([WAIT_REQUEST_ID, LIST_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({ connectIpcClient: async () => deferred.client });
    const waitPromise = client.wait("run-123");
    const listPromise = client.list();

    deferred.push({
      kind: "response",
      id: LIST_REQUEST_ID,
      result: {
        runs: [{ runId: "run-123", project: "demo", branch: "feature", status: "in-progress", isLive: true }],
      },
    });

    await expect(listPromise).resolves.toEqual({
      runs: [{ runId: "run-123", project: "demo", branch: "feature", status: "in-progress", isLive: true }],
    });

    let settled = false;
    void waitPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    deferred.push({ kind: "response", id: WAIT_REQUEST_ID, result: { runStatus: "completed" } });
    await expect(waitPromise).resolves.toEqual({ runStatus: "completed" });
    expect(sent).toEqual([
      { kind: "request", id: WAIT_REQUEST_ID, method: "wait", params: { runId: "run-123" } },
      { kind: "request", id: LIST_REQUEST_ID, method: "list" },
    ]);
    client.close();
  });
});

test("wait stays pending until its correlated reply arrives", async () => {
  const deferred = createDeferredClient();

  await withFixedUuids([WAIT_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({ connectIpcClient: async () => deferred.client });
    const waitPromise = client.wait("run-123");

    let settled = false;
    void waitPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    deferred.push({ kind: "response", id: WAIT_REQUEST_ID, result: { runStatus: "completed", resumable: false } });
    await expect(waitPromise).resolves.toEqual({ runStatus: "completed", resumable: false });
    client.close();
  });
});

test("late correlated wait replies do not resolve an abandoned promise", async () => {
  const deferred = createDeferredClient();

  await withFixedUuids([WAIT_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({ connectIpcClient: async () => deferred.client });
    let resolved = false;
    const waitPromise = client.wait("run-123").then(
      () => {
        resolved = true;
      },
      () => undefined,
    );

    client.close();
    deferred.push({ kind: "response", id: WAIT_REQUEST_ID, result: { runStatus: "completed" } });
    await waitPromise;
    expect(resolved).toBe(false);
  });
});

test("replacing wait abandons the prior pending request without resolving it", async () => {
  const WAIT_FIRST_ID = "00000000-0000-4000-8000-000000000006";
  const WAIT_SECOND_ID = "00000000-0000-4000-8000-000000000007";
  const deferred = createDeferredClient();

  await withFixedUuids([WAIT_FIRST_ID, WAIT_SECOND_ID], async () => {
    const client = await connectTuiDaemon({ connectIpcClient: async () => deferred.client });
    const abandoned = client.wait("run-a");
    const replacement = client.wait("run-b");

    deferred.push({
      kind: "response",
      id: WAIT_FIRST_ID,
      result: { runStatus: "completed", loopOutcomeKind: "complete", iterationsConsumed: 9 },
    });
    await expect(
      Promise.race([abandoned.then(() => "resolved" as const), Promise.resolve("pending" as const)]),
    ).resolves.toBe("pending");

    deferred.push({ kind: "response", id: WAIT_SECOND_ID, result: { runStatus: "blocked" } });
    await expect(replacement).resolves.toEqual({ runStatus: "blocked" });
    client.close();
  });
});

test("list and wait correlated error frames reject as TuiDaemonRpcError", async () => {
  await withFixedUuids([LIST_REQUEST_ID, WAIT_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient([
          { kind: "error", id: LIST_REQUEST_ID, code: "internal_error", message: "list failed" },
          { kind: "error", id: WAIT_REQUEST_ID, code: "unknown_run", message: "missing run" },
        ]),
    });

    await expect(client.list()).rejects.toBeInstanceOf(TuiDaemonRpcError);
    await expect(client.wait("run-404")).rejects.toMatchObject({ code: "unknown_run" });
    client.close();
  });
});

test("list and wait malformed success payloads reject as TuiDaemonConnectionError", async () => {
  await withFixedUuids([LIST_REQUEST_ID, WAIT_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient([
          { kind: "response", id: LIST_REQUEST_ID, result: { runs: [{ runId: "run-1", project: "demo" }] } },
          { kind: "response", id: WAIT_REQUEST_ID, result: { loopOutcomeKind: "complete" } },
        ]),
    });

    await expect(client.list()).rejects.toBeInstanceOf(TuiDaemonConnectionError);
    await expect(client.wait("run-1")).rejects.toBeInstanceOf(TuiDaemonConnectionError);
    client.close();
  });
});

test("rejects malformed RPC replies with TuiDaemonConnectionError", async () => {
  await withFixedUuids([HEALTH_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () => makeClient([{ kind: "stream-open", streamId: "s1" } as IpcFrame]),
    });

    await expect(client.health()).rejects.toBeInstanceOf(TuiDaemonConnectionError);
    client.close();
  });
});

test("rejects non-correlated RPC replies with TuiDaemonConnectionError", async () => {
  await withFixedUuids([HEALTH_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () => makeClient([{ kind: "response", id: "other-id", result: { ok: true } }]),
    });

    await expect(client.health()).rejects.toBeInstanceOf(TuiDaemonConnectionError);
    client.close();
  });
});

socketTest("health round-trips over a test IPC server", async () => {
  const client = await connectTuiDaemon({ socketPath: SOCKET_PATH, connectIpcClient });
  await expect(client.health()).resolves.toEqual({ ok: true });
  client.close();
});

socketTest("status round-trips over a test IPC server", async () => {
  const client = await connectTuiDaemon({ socketPath: SOCKET_PATH, connectIpcClient });
  await expect(client.status()).resolves.toEqual({ state: "running" });
  client.close();
});

socketTest("list round-trips over a test IPC server", async () => {
  const ipc = await connectIpcClient(SOCKET_PATH);
  ipc.send({ kind: "request", id: "start", method: "start", params: { input: input() } });
  const startFrame = await ipc.nextFrame();
  const runId = expectRunId(startFrame);
  const client = await connectTuiDaemon({ socketPath: SOCKET_PATH, connectIpcClient });

  await expect(client.list()).resolves.toEqual({
    runs: [{ runId, project: "test-project", branch: "test-branch", status: "in-progress", isLive: true }],
  });
  client.close();
  ipc.close();
});

socketTest("wait round-trips over a test IPC server", async () => {
  const ipc = await connectIpcClient(SOCKET_PATH);
  ipc.send({ kind: "request", id: "start", method: "start", params: { input: input() } });
  const runId = expectRunId(await ipc.nextFrame());

  const client = await connectTuiDaemon({ socketPath: SOCKET_PATH, connectIpcClient });
  const pending = client.wait(runId);
  await Promise.resolve();
  finishLoop(runId, stateStore, logSink, 3);
  fakeExecutor.settleAll();
  await flushBackgroundRuns();

  await expect(pending).resolves.toEqual({
    runStatus: "completed",
    loopOutcomeKind: "complete",
    iterationsConsumed: 3,
    resumable: false,
  });
  client.close();
  ipc.close();
});

socketTest("list succeeds while wait is pending on the same socket connection", async () => {
  const ipc = await connectIpcClient(SOCKET_PATH);
  ipc.send({ kind: "request", id: "start", method: "start", params: { input: input() } });
  const runId = expectRunId(await ipc.nextFrame());

  const client = await connectTuiDaemon({ socketPath: SOCKET_PATH, connectIpcClient });
  const pendingWait = client.wait(runId);
  await Promise.resolve();

  await expect(client.list()).resolves.toEqual({
    runs: [{ runId, project: "test-project", branch: "test-branch", status: "in-progress", isLive: true }],
  });

  finishLoop(runId, stateStore, logSink);
  fakeExecutor.settleAll();
  await flushBackgroundRuns();
  await expect(pendingWait).resolves.toEqual({
    runStatus: "completed",
    loopOutcomeKind: "complete",
    iterationsConsumed: 1,
    resumable: false,
  });
  client.close();
  ipc.close();
});

socketTest("rejects unreachable socket with TuiDaemonConnectionError and sends no RPCs", async () => {
  const sent: unknown[] = [];
  const trackingConnect = async (socketPath: string): Promise<IpcClient> => {
    const ipc = await connectIpcClient(socketPath);
    const originalSend = ipc.send.bind(ipc);
    return {
      ...ipc,
      send(frame: unknown): void {
        sent.push(frame);
        originalSend(frame);
      },
    };
  };

  await expect(
    connectTuiDaemon({ socketPath: UNREACHABLE_SOCKET_PATH, connectIpcClient: trackingConnect }),
  ).rejects.toBeInstanceOf(TuiDaemonConnectionError);
  expect(sent).toEqual([]);
});

test("start sends one correlated IPC start request and returns runId", async () => {
  const sent: unknown[] = [];
  await withFixedUuids([START_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient([{ kind: "response", id: START_REQUEST_ID, result: { runId: "run-999" } }], sent),
    });

    await expect(client.start(START_INPUT)).resolves.toEqual({ runId: "run-999" });
    expect(sent).toEqual([
      {
        kind: "request",
        id: START_REQUEST_ID,
        method: "start",
        params: { input: START_INPUT },
      },
    ]);
    client.close();
  });
});

test("start rejects run_in_progress as TuiDaemonRpcError", async () => {
  await withFixedUuids([START_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient([
          {
            kind: "error",
            id: START_REQUEST_ID,
            code: "run_in_progress",
            message: "A run is already in progress; at most one in-flight run globally",
          },
        ]),
    });

    await expect(client.start(START_INPUT)).rejects.toMatchObject({
      name: "TuiDaemonRpcError",
      code: "run_in_progress",
    });
    client.close();
  });
});

test("start rejects worktree_claimed as TuiDaemonRpcError", async () => {
  await withFixedUuids([START_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient([
          {
            kind: "error",
            id: START_REQUEST_ID,
            code: "worktree_claimed",
            message: "Run already active for project/branch",
          },
        ]),
    });

    await expect(client.start(START_INPUT)).rejects.toMatchObject({
      code: "worktree_claimed",
    });
    client.close();
  });
});

test("start rejects generic daemon error frames as TuiDaemonRpcError", async () => {
  await withFixedUuids([START_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient([
          {
            kind: "error",
            id: START_REQUEST_ID,
            code: "invalid_params",
            message: "missing input",
          },
        ]),
    });

    await expect(client.start(START_INPUT)).rejects.toBeInstanceOf(TuiDaemonRpcError);
    client.close();
  });
});

test.each([
  ["pause", PAUSE_REQUEST_ID] as const,
  ["resume", RESUME_REQUEST_ID] as const,
  ["kill", KILL_REQUEST_ID] as const,
])("%s sends one correlated IPC request and returns ok", async (method, requestId) => {
  const sent: unknown[] = [];
  await withFixedUuids([requestId], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () => makeClient([{ kind: "response", id: requestId, result: { ok: true } }], sent),
    });

    await expect(client[method]("run-123")).resolves.toEqual({ ok: true });
    expect(sent).toEqual([{ kind: "request", id: requestId, method, params: { runId: "run-123" } }]);
    client.close();
  });
});

test("steering RPCs succeed while wait is unresolved on the same client", async () => {
  const sent: unknown[] = [];
  const deferred = createDeferredClient(sent);

  await withFixedUuids([WAIT_REQUEST_ID, PAUSE_REQUEST_ID, RESUME_REQUEST_ID, KILL_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({ connectIpcClient: async () => deferred.client });
    const waitPromise = client.wait("run-123");

    const pausePromise = client.pause("run-123");
    deferred.push({ kind: "response", id: PAUSE_REQUEST_ID, result: { ok: true } });
    await expect(pausePromise).resolves.toEqual({ ok: true });

    const resumePromise = client.resume("run-123");
    deferred.push({ kind: "response", id: RESUME_REQUEST_ID, result: { ok: true } });
    await expect(resumePromise).resolves.toEqual({ ok: true });

    const killPromise = client.kill("run-123");
    deferred.push({ kind: "response", id: KILL_REQUEST_ID, result: { ok: true } });
    await expect(killPromise).resolves.toEqual({ ok: true });

    let settled = false;
    void waitPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    deferred.push({ kind: "response", id: WAIT_REQUEST_ID, result: { runStatus: "completed" } });
    await expect(waitPromise).resolves.toEqual({ runStatus: "completed" });
    expect(sent).toEqual([
      { kind: "request", id: WAIT_REQUEST_ID, method: "wait", params: { runId: "run-123" } },
      { kind: "request", id: PAUSE_REQUEST_ID, method: "pause", params: { runId: "run-123" } },
      { kind: "request", id: RESUME_REQUEST_ID, method: "resume", params: { runId: "run-123" } },
      { kind: "request", id: KILL_REQUEST_ID, method: "kill", params: { runId: "run-123" } },
    ]);
    client.close();
  });
});

test("steering correlated error frames reject as TuiDaemonRpcError", async () => {
  await withFixedUuids([PAUSE_REQUEST_ID, RESUME_REQUEST_ID, KILL_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient([
          { kind: "error", id: PAUSE_REQUEST_ID, code: "unknown_run", message: "missing run" },
          { kind: "error", id: RESUME_REQUEST_ID, code: "terminal_run", message: "Cannot resume a completed run" },
          { kind: "error", id: KILL_REQUEST_ID, code: "unknown_run", message: "missing run" },
        ]),
    });

    await expect(client.pause("run-404")).rejects.toMatchObject({ code: "unknown_run" });
    await expect(client.resume("run-done")).rejects.toMatchObject({ code: "terminal_run" });
    await expect(client.kill("run-404")).rejects.toMatchObject({ code: "unknown_run" });
    client.close();
  });
});

test("pause and kill reject run_not_active as TuiDaemonRpcError", async () => {
  await withFixedUuids([PAUSE_REQUEST_ID, KILL_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient([
          {
            kind: "error",
            id: PAUSE_REQUEST_ID,
            code: "run_not_active",
            message: "Run run-123 is not currently active",
          },
          {
            kind: "error",
            id: KILL_REQUEST_ID,
            code: "run_not_active",
            message: "Run run-123 is not currently active",
          },
        ]),
    });

    await expect(client.pause("run-123")).rejects.toMatchObject({ code: "run_not_active" });
    await expect(client.kill("run-123")).rejects.toMatchObject({ code: "run_not_active" });
    client.close();
  });
});

test("resume rejects run_in_progress as TuiDaemonRpcError", async () => {
  await withFixedUuids([RESUME_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient([
          {
            kind: "error",
            id: RESUME_REQUEST_ID,
            code: "run_in_progress",
            message: "A run is already in progress; at most one in-flight run globally",
          },
        ]),
    });

    await expect(client.resume("run-paused")).rejects.toMatchObject({ code: "run_in_progress" });
    client.close();
  });
});

test("steering malformed success payloads reject as TuiDaemonConnectionError", async () => {
  await withFixedUuids([PAUSE_REQUEST_ID, RESUME_REQUEST_ID, KILL_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () =>
        makeClient([
          { kind: "response", id: PAUSE_REQUEST_ID, result: { ok: false } },
          { kind: "response", id: RESUME_REQUEST_ID, result: {} },
          { kind: "response", id: KILL_REQUEST_ID, result: { state: "running" } },
        ]),
    });

    await expect(client.pause("run-1")).rejects.toBeInstanceOf(TuiDaemonConnectionError);
    await expect(client.resume("run-1")).rejects.toBeInstanceOf(TuiDaemonConnectionError);
    await expect(client.kill("run-1")).rejects.toBeInstanceOf(TuiDaemonConnectionError);
    client.close();
  });
});
