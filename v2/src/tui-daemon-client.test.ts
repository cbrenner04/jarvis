import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcClient } from "./ipc/client.ts";
import { connectIpcClient } from "./ipc/client.ts";
import { type IpcServer, startIpcServer } from "./ipc/server.ts";
import type { IpcFrame } from "./ipc/types.ts";
import { simulatedBindings } from "./testing/bindings.ts";
import { canUseUnixSockets, socketProbeErrored } from "./testing/unix-socket.ts";
import { connectTuiDaemon, TuiDaemonConnectionError, TuiDaemonRpcError } from "./tui-daemon-client.ts";
import type { WriteLoopInput } from "./write-loop.ts";

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
  let index = 0;
  return {
    send(frame: unknown): void {
      sent.push(frame);
    },
    async nextFrame(): Promise<IpcFrame> {
      const frame = frames[index];
      if (frame === undefined) {
        throw new Error("connection closed");
      }
      index += 1;
      return frame;
    },
    close(): void {},
  };
}

let server: IpcServer;

beforeEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  rmSync(UNREACHABLE_SOCKET_PATH, { force: true });
  server = await startIpcServer(SOCKET_PATH);
});

afterEach(async () => {
  if (!canUseUnixSockets() || !server) {
    return;
  }
  await server.close();
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
      ],
      sent,
    );
  };

  await withFixedUuids([HEALTH_REQUEST_ID, STATUS_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      socketPath: "/tmp/injected.sock",
      connectIpcClient: fakeConnect,
    });

    await expect(client.health()).resolves.toEqual({ ok: true });
    await expect(client.status()).resolves.toEqual({ state: "running" });
    client.close();
  });

  expect(connectCalls).toBe(1);
  expect(sent).toEqual([
    { kind: "request", id: HEALTH_REQUEST_ID, method: "health" },
    { kind: "request", id: STATUS_REQUEST_ID, method: "status" },
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
  await withFixedUuids([HEALTH_REQUEST_ID, STATUS_REQUEST_ID], async () => {
    const client = await connectTuiDaemon({
      connectIpcClient: async () => {
        connectCalls += 1;
        return makeClient([
          { kind: "response", id: HEALTH_REQUEST_ID, result: { ok: true } },
          { kind: "response", id: STATUS_REQUEST_ID, result: { state: "running" } },
        ]);
      },
    });

    await expect(client.health()).resolves.toEqual({ ok: true });
    await expect(client.status()).resolves.toEqual({ state: "running" });
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
