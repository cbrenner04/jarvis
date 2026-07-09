import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTailStreamHandler } from "../daemon/daemon.ts";
import { connectIpcClient, type IpcClient } from "../ipc/client.ts";
import { type IpcServer, startIpcServer } from "../ipc/server.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { DAEMON_SOCKET_PATH } from "../paths.ts";
import { openLogReader, openLogSink, type PersistedRecord } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";
import { TuiDaemonConnectionError } from "./tui-daemon-errors.ts";
import { connectTuiLogTail } from "./tui-log-tail-client.ts";

const SOCKET_PATH = join(tmpdir(), `jarvis-tui-log-tail-${process.pid}.sock`);
const UNREACHABLE_SOCKET_PATH = join(tmpdir(), `jarvis-tui-log-tail-missing-${process.pid}.sock`);
const LOGS_PATH = join(tmpdir(), `jarvis-tui-log-tail-logs-${process.pid}.jsonl`);
const STREAM_ID = "00000000-0000-4000-8000-000000000001";
const socketTest = test.skipIf(!canUseUnixSockets());

function withFixedStreamId<T>(fn: () => Promise<T>): Promise<T> {
  const originalRandomUuid = crypto.randomUUID;
  crypto.randomUUID = () => STREAM_ID as `${string}-${string}-${string}-${string}-${string}`;
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
      if (index < frames.length) {
        const frame = frames[index];
        index += 1;
        if (frame === undefined) {
          throw new Error("connection closed");
        }
        return frame;
      }
      throw new Error("connection closed");
    },
    close(): void {},
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

function logRecord(seq: number, eventKind: PersistedRecord["event"]["kind"]): PersistedRecord {
  return {
    runId: "run-123",
    seq,
    ts: `2026-06-28T03:27:0${seq}.000Z`,
    event:
      eventKind === "iteration_started"
        ? { kind: "iteration_started", attemptId: `attempt-${seq}` }
        : eventKind === "boundary_committed"
          ? {
              kind: "boundary_committed",
              attemptId: `attempt-${seq}`,
              outcomeKind: "progress",
              runStatus: "in-progress",
            }
          : {
              kind: "loop_finished",
              loopOutcomeKind: "complete",
              iterationsConsumed: 1,
              resumable: false,
            },
  };
}

async function collectRecords(tail: Awaited<ReturnType<typeof connectTuiLogTail>>): Promise<PersistedRecord[]> {
  const records: PersistedRecord[] = [];
  for await (const record of tail.records()) {
    records.push(record);
  }
  return records;
}

let stateStore: StateStore;
let server: IpcServer;

function seedRun(): string {
  return stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
  });
}

function createRunWithLogs(): string {
  const runId = seedRun();
  const logSink = openLogSink(LOGS_PATH);
  logSink.append(runId, { kind: "iteration_started", attemptId: "attempt-1" });
  logSink.append(runId, {
    kind: "boundary_committed",
    attemptId: "attempt-1",
    outcomeKind: "progress",
    runStatus: "in-progress",
  });
  logSink.close();
  return runId;
}

beforeEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  rmSync(SOCKET_PATH, { force: true });
  rmSync(LOGS_PATH, { force: true });
  stateStore = openStateStore(join(tmpdir(), `jarvis-tui-log-tail-state-${process.pid}-${Date.now()}.db`));
  const tailHandler = createTailStreamHandler({ stateStore, logReader: openLogReader(LOGS_PATH) });
  server = await startIpcServer(SOCKET_PATH, undefined, tailHandler);
});

afterEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  try {
    await server.close();
  } catch {
    // server may have already stopped
  }
  rmSync(SOCKET_PATH, { force: true });
  rmSync(LOGS_PATH, { force: true });
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

test("uses injected connectIpcClient instead of production transport", async () => {
  const sent: unknown[] = [];
  let connectCalls = 0;
  const records = [logRecord(1, "iteration_started")];
  const fakeConnect = async (socketPath: string): Promise<IpcClient> => {
    connectCalls += 1;
    expect(socketPath).toBe("/tmp/injected.sock");
    return makeClient(
      [
        { kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(records[0]) },
        { kind: "stream-end", streamId: STREAM_ID },
      ],
      sent,
    );
  };

  await withFixedStreamId(async () => {
    const tail = await connectTuiLogTail("run-123", {
      socketPath: "/tmp/injected.sock",
      connectIpcClient: fakeConnect,
    });
    await expect(collectRecords(tail)).resolves.toEqual(records);
    tail.close();
  });

  expect(connectCalls).toBe(1);
  expect(sent).toEqual([
    { kind: "stream-open", streamId: STREAM_ID, payload: { runId: "run-123" } },
    { kind: "stream-end", streamId: STREAM_ID },
  ]);
});

test("defaults socket path to ~/.jarvis/daemon.sock when omitted", async () => {
  let seenPath: string | undefined;
  await withFixedStreamId(async () => {
    const tail = await connectTuiLogTail("run-123", {
      connectIpcClient: async (socketPath) => {
        seenPath = socketPath;
        return makeClient([{ kind: "stream-end", streamId: STREAM_ID }]);
      },
    });
    await collectRecords(tail);
    tail.close();
  });
  expect(seenPath).toBe(DAEMON_SOCKET_PATH);
});

test("replays then follows records in server stream-data arrival order until benign stream-end", async () => {
  const sent: unknown[] = [];
  const records = [
    logRecord(1, "iteration_started"),
    logRecord(2, "boundary_committed"),
    logRecord(3, "loop_finished"),
  ];
  const { client, push } = createDeferredClient(sent);

  const tail = await connectTuiLogTail("run-123", {
    connectIpcClient: async () => client,
  });

  const pending = withFixedStreamId(() => collectRecords(tail));
  push({ kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(records[0]) });
  push({ kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(records[1]) });
  push({ kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(records[2]) });
  push({ kind: "stream-end", streamId: STREAM_ID });

  await expect(pending).resolves.toEqual(records);
  expect(sent).toEqual([{ kind: "stream-open", streamId: STREAM_ID, payload: { runId: "run-123" } }]);
  tail.close();
});

test("benign stream-end without prior stream-data yields no records", async () => {
  const tail = await connectTuiLogTail("run-missing", {
    connectIpcClient: async () => makeClient([{ kind: "stream-end", streamId: STREAM_ID }]),
  });

  await withFixedStreamId(async () => {
    await expect(collectRecords(tail)).resolves.toEqual([]);
  });
  tail.close();
});

test("error-payload stream-end rejects with TuiDaemonConnectionError", async () => {
  const tail = await connectTuiLogTail("run-123", {
    connectIpcClient: async () =>
      makeClient([
        {
          kind: "stream-end",
          streamId: STREAM_ID,
          payload: { error: "follow failed" },
        },
      ]),
  });

  await withFixedStreamId(async () => {
    await expect(collectRecords(tail)).rejects.toBeInstanceOf(TuiDaemonConnectionError);
  });
  tail.close();
});

test("malformed stream-data payload rejects with TuiDaemonConnectionError", async () => {
  const tail = await connectTuiLogTail("run-123", {
    connectIpcClient: async () => makeClient([{ kind: "stream-data", streamId: STREAM_ID, payload: "{not-json" }]),
  });

  await withFixedStreamId(async () => {
    await expect(collectRecords(tail)).rejects.toBeInstanceOf(TuiDaemonConnectionError);
  });
  tail.close();
});

test.each([
  ["missing runId", JSON.stringify({ event: { kind: "iteration_started" } })],
  ["non-string runId", JSON.stringify({ runId: 123, event: { kind: "iteration_started" } })],
  ["missing event", JSON.stringify({ runId: "run-123" })],
])("stream-data payload with %s rejects with TuiDaemonConnectionError", async (_label, payload) => {
  const tail = await connectTuiLogTail("run-123", {
    connectIpcClient: async () => makeClient([{ kind: "stream-data", streamId: STREAM_ID, payload }]),
  });

  await withFixedStreamId(async () => {
    await expect(collectRecords(tail)).rejects.toBeInstanceOf(TuiDaemonConnectionError);
  });
  tail.close();
});

test("connection loss during records iteration rejects with TuiDaemonConnectionError", async () => {
  const { client, push } = createDeferredClient();
  const tail = await connectTuiLogTail("run-123", {
    connectIpcClient: async () => client,
  });

  const pending = withFixedStreamId(async () => collectRecords(tail));
  push({ kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(logRecord(1, "iteration_started")) });
  client.close();

  await expect(pending).rejects.toBeInstanceOf(TuiDaemonConnectionError);
  tail.close();
});

test("close sends stream-end for the opened stream id", async () => {
  const sent: unknown[] = [];
  const { client, push } = createDeferredClient(sent);

  const tail = await connectTuiLogTail("run-123", {
    connectIpcClient: async () => client,
  });

  await withFixedStreamId(async () => {
    const iter = tail.records()[Symbol.asyncIterator]();
    const pending = iter.next();
    push({ kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(logRecord(1, "iteration_started")) });
    await pending;
    tail.close();
    expect(sent).toEqual([
      { kind: "stream-open", streamId: STREAM_ID, payload: { runId: "run-123" } },
      { kind: "stream-end", streamId: STREAM_ID },
    ]);
  });
});

test("rejects unreachable socket with TuiDaemonConnectionError before stream-open", async () => {
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
    connectTuiLogTail("run-123", { socketPath: UNREACHABLE_SOCKET_PATH, connectIpcClient: trackingConnect }),
  ).rejects.toBeInstanceOf(TuiDaemonConnectionError);
  expect(sent).toEqual([]);
});

socketTest("replays fixture records through production IPC tail framing", async () => {
  const runId = createRunWithLogs();
  const tail = await connectTuiLogTail(runId, { socketPath: SOCKET_PATH, connectIpcClient });

  const iter = tail.records()[Symbol.asyncIterator]();
  const first = await iter.next();
  const second = await iter.next();

  expect(first.done).toBe(false);
  expect(first.value?.seq).toBe(1);
  expect(first.value?.event.kind).toBe("iteration_started");
  expect(second.done).toBe(false);
  expect(second.value?.seq).toBe(2);
  expect(second.value?.event.kind).toBe("boundary_committed");

  tail.close();
});
