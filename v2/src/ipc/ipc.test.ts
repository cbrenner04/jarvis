import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTailStreamHandler } from "../daemon/daemon.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { canUseUnixSockets, socketProbeErrored } from "../testing/unix-socket.ts";
import { connectIpcClient } from "./client.ts";
import { encodeFrame } from "./codec.ts";
import { type IpcServer, startIpcServer } from "./server.ts";

if (socketProbeErrored) {
  process.stderr.write("skip: IPC tests require socket support in /tmp\n");
}

const SOCKET_PATH = join(tmpdir(), `jarvis-ipc-test-${process.pid}.sock`);
const socketTest = test.skipIf(!canUseUnixSockets());

let server: IpcServer;

beforeEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  server = await startIpcServer(SOCKET_PATH);
});

afterEach(async () => {
  if (!canUseUnixSockets() || !server) {
    return;
  }
  await server.close();
  rmSync(SOCKET_PATH, { force: true });
});

function request(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, ...(params !== undefined ? { params } : {}) };
}

async function connectRaw() {
  const socket = connect(SOCKET_PATH);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  return socket;
}

function untilClose(socket: ReturnType<typeof connect>): Promise<void> {
  return new Promise((resolve) => socket.once("close", () => resolve()));
}

socketTest("health RPC round-trips", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  client.send(request("h1", "health"));
  const frame = await client.nextFrame();
  expect(frame).toEqual({ kind: "response", id: "h1", result: { ok: true } });
  client.close();
});

socketTest("status RPC reports daemon-host liveness", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  client.send(request("s1", "status"));
  const frame = await client.nextFrame();
  expect(frame).toEqual({ kind: "response", id: "s1", result: { state: "running" } });
  client.close();
});

socketTest("unknown method returns correlated error", async () => {
  const client = await connectIpcClient(SOCKET_PATH);
  client.send(request("e1", "nope"));
  const frame = await client.nextFrame();
  expect(frame.kind).toBe("error");
  if (frame.kind !== "error") return;
  expect(frame.id).toBe("e1");
  expect(frame.code).toBe("unknown_method");
  expect(frame.message).toContain("nope");
  client.close();
});

socketTest("serves multiple simultaneous client connections", async () => {
  const [a, b] = await Promise.all([connectIpcClient(SOCKET_PATH), connectIpcClient(SOCKET_PATH)]);
  a.send(request("a1", "health"));
  b.send(request("b1", "status"));
  const [aFrame, bFrame] = await Promise.all([a.nextFrame(), b.nextFrame()]);
  expect(aFrame).toEqual({ kind: "response", id: "a1", result: { ok: true } });
  expect(bFrame).toEqual({ kind: "response", id: "b1", result: { state: "running" } });
  a.close();
  b.close();
});

socketTest("oversized length closes the connection", async () => {
  const socket = await connectRaw();
  const header = Buffer.alloc(4);
  header.writeUInt32BE(16 * 1024 * 1024 + 1, 0);
  socket.write(header);
  await untilClose(socket);
});

socketTest("truncated body closes the connection", async () => {
  const socket = await connectRaw();
  const header = Buffer.alloc(4);
  header.writeUInt32BE(32, 0);
  socket.write(header);
  socket.write(Buffer.from('{"kind":"request"'));
  socket.end();
  await untilClose(socket);
});

socketTest("invalid JSON closes the connection", async () => {
  const socket = await connectRaw();
  const body = Buffer.from("{not-json", "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
  await untilClose(socket);
});

socketTest("missing kind closes the connection", async () => {
  const socket = await connectRaw();
  socket.write(encodeFrame({ id: "x" }));
  await untilClose(socket);
});

socketTest("invalid kind closes the connection", async () => {
  const socket = await connectRaw();
  socket.write(encodeFrame({ kind: "wat", id: "x" }));
  await untilClose(socket);
});

socketTest("nextFrame() with no timeoutMs falls back to the client's default timeout", async () => {
  const client = await connectIpcClient(SOCKET_PATH, { defaultTimeoutMs: 50 });
  await expect(client.nextFrame()).rejects.toThrow("timed out waiting for frame");
  client.close();
});

socketTest("server stays up after a malformed client disconnects", async () => {
  const bad = await connectRaw();
  bad.write(encodeFrame({ kind: "nope" }));
  await untilClose(bad);

  const client = await connectIpcClient(SOCKET_PATH);
  client.send(request("ok", "health"));
  expect(await client.nextFrame()).toEqual({ kind: "response", id: "ok", result: { ok: true } });
  client.close();
});

// Tail-log stream tests
const LOGS_PATH = join(tmpdir(), `jarvis-ipc-test-logs-${process.pid}.jsonl`);

function seedRun(stateStore: StateStore): string {
  return stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
  });
}

function appendSampleEvents(logSink: ReturnType<typeof openLogSink>, runId: string): void {
  logSink.append(runId, { kind: "iteration_started", attemptId: "attempt-1" });
  logSink.append(runId, {
    kind: "boundary_committed",
    attemptId: "attempt-1",
    outcomeKind: "progress",
    runStatus: "in-progress",
  });
}

function createRunWithLogs(stateStore: StateStore): string {
  const runId = seedRun(stateStore);
  const logSink = openLogSink(LOGS_PATH);
  appendSampleEvents(logSink, runId);
  logSink.close();
  return runId;
}

function wrapLogReaderWithFollowSpy(onFollow?: (signal?: AbortSignal) => void) {
  let followCalled = false;
  const baseReader = openLogReader(LOGS_PATH);
  const logReader = {
    ...baseReader,
    follow(runId: string, signal?: AbortSignal) {
      followCalled = true;
      onFollow?.(signal);
      return baseReader.follow(runId, signal);
    },
  };
  return {
    logReader,
    get followCalled() {
      return followCalled;
    },
  };
}

async function withTailTest(fn: (stateStore: StateStore) => Promise<void>): Promise<void> {
  rmSync(LOGS_PATH, { force: true });
  const stateStore = openStateStore(join(tmpdir(), `jarvis-ipc-tail-state-${process.pid}-${Date.now()}.db`));
  try {
    await fn(stateStore);
  } finally {
    stateStore.close();
    rmSync(LOGS_PATH, { force: true });
  }
}

async function startTailServer(
  stateStore: StateStore,
  logReader: ReturnType<typeof openLogReader>,
): Promise<IpcServer> {
  rmSync(SOCKET_PATH, { force: true });
  return startIpcServer(SOCKET_PATH, undefined, createTailStreamHandler({ stateStore, logReader }));
}

async function withTailServer(
  stateStore: StateStore,
  logReader: ReturnType<typeof openLogReader>,
  fn: () => Promise<void>,
): Promise<void> {
  const tailServer = await startTailServer(stateStore, logReader);
  try {
    await fn();
  } finally {
    try {
      await tailServer.close();
    } catch {
      // server may have already stopped
    }
  }
}

socketTest("tail-log stream replays persisted events in seq order", async () => {
  await withTailTest(async (stateStore) => {
    const runId = createRunWithLogs(stateStore);
    await withTailServer(stateStore, openLogReader(LOGS_PATH), async () => {
      const client = await connectIpcClient(SOCKET_PATH);
      client.send({ kind: "stream-open", streamId: "tail1", payload: { runId } });

      const frame1 = await client.nextFrame();
      expect(frame1.kind).toBe("stream-data");
      if (frame1.kind === "stream-data") {
        const record = JSON.parse(frame1.payload || "{}");
        expect(record.seq).toBe(1);
        expect(record.event.kind).toBe("iteration_started");
      }

      const frame2 = await client.nextFrame();
      expect(frame2.kind).toBe("stream-data");
      if (frame2.kind === "stream-data") {
        const record = JSON.parse(frame2.payload || "{}");
        expect(record.seq).toBe(2);
        expect(record.event.kind).toBe("boundary_committed");
      }

      client.send({ kind: "stream-end", streamId: "tail1" });
      client.close();
    });
  });
});

socketTest("tail-log stream rejects unknown run ID", async () => {
  await withTailTest(async (stateStore) => {
    const orphanRunId = "unknown-run";
    const logSink = openLogSink(LOGS_PATH);
    appendSampleEvents(logSink, orphanRunId);
    logSink.close();

    const followSpy = wrapLogReaderWithFollowSpy();
    await withTailServer(stateStore, followSpy.logReader, async () => {
      const client = await connectIpcClient(SOCKET_PATH);
      client.send({ kind: "stream-open", streamId: "tail2", payload: { runId: orphanRunId } });

      const frame = await client.nextFrame();
      expect(frame.kind).toBe("stream-end");
      if (frame.kind === "stream-end") {
        expect(frame.streamId).toBe("tail2");
      }

      client.close();
      expect(followSpy.followCalled).toBe(false);
    });
  });
});

socketTest("tail-log stream closes on client stream-end", async () => {
  await withTailTest(async (stateStore) => {
    const runId = seedRun(stateStore);
    const logSink = openLogSink(LOGS_PATH);
    logSink.append(runId, { kind: "iteration_started", attemptId: "attempt-1" });
    logSink.close();

    let followSignal: AbortSignal | undefined;
    const followSpy = wrapLogReaderWithFollowSpy((signal) => {
      followSignal = signal;
    });
    await withTailServer(stateStore, followSpy.logReader, async () => {
      const client = await connectIpcClient(SOCKET_PATH);
      client.send({ kind: "stream-open", streamId: "tail3", payload: { runId } });

      const frame1 = await client.nextFrame();
      expect(frame1.kind).toBe("stream-data");

      client.send({ kind: "stream-end", streamId: "tail3" });
      const endFrame = await client.nextFrame();
      expect(endFrame.kind).toBe("stream-end");

      client.close();
      expect(followSignal?.aborted).toBe(true);
    });
  });
});
