import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectIpcClient, type IpcClient } from "../ipc/client.ts";
import { RpcConnectionError } from "../ipc/rpc-errors.ts";
import type { PersistedRecord } from "../persistence/log-stream.ts";
import { makeIpcClient } from "../testing/ipc-client-fake.ts";
import { connectTuiLogTail } from "./tui-log-tail-client.ts";

const UNREACHABLE_SOCKET_PATH = join(tmpdir(), `jarvis-tui-log-tail-missing-${process.pid}.sock`);
const STREAM_ID = "00000000-0000-4000-8000-000000000001";

function withFixedStreamId<T>(fn: () => Promise<T>): Promise<T> {
  const originalRandomUuid = crypto.randomUUID;
  crypto.randomUUID = () => STREAM_ID as `${string}-${string}-${string}-${string}-${string}`;
  return fn().finally(() => {
    crypto.randomUUID = originalRandomUuid;
  });
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

test("uses injected connectIpcClient instead of production transport", async () => {
  const sent: unknown[] = [];
  let connectCalls = 0;
  const records = [logRecord(1, "iteration_started")];
  const fakeConnect = async (socketPath: string): Promise<IpcClient> => {
    connectCalls += 1;
    expect(socketPath).toBe("/tmp/injected.sock");
    return makeIpcClient(
      [
        { kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(records[0]) },
        { kind: "stream-end", streamId: STREAM_ID },
      ],
      { sent },
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
    { kind: "stream-open", streamId: STREAM_ID, payload: { runId: "run-123", afterSeq: 0 } },
    { kind: "stream-end", streamId: STREAM_ID },
  ]);
});

test("requires explicit socket path", async () => {
  let seenPath: string | undefined;
  const testSocketPath = "/tmp/test-socket.sock";
  await withFixedStreamId(async () => {
    const tail = await connectTuiLogTail("run-123", {
      socketPath: testSocketPath,
      connectIpcClient: async (socketPath) => {
        seenPath = socketPath;
        return makeIpcClient([{ kind: "stream-end", streamId: STREAM_ID }]);
      },
    });
    await collectRecords(tail);
    tail.close();
  });
  expect(seenPath).toBe(testSocketPath);
});

test("replays then follows records in server stream-data arrival order until benign stream-end", async () => {
  const sent: unknown[] = [];
  const records = [
    logRecord(1, "iteration_started"),
    logRecord(2, "boundary_committed"),
    logRecord(3, "loop_finished"),
  ];
  const client = makeIpcClient([], { deferred: true, sent });

  const tail = await connectTuiLogTail("run-123", {
    socketPath: "/tmp/test.sock",
    connectIpcClient: async () => client,
  });

  const pending = withFixedStreamId(() => collectRecords(tail));
  client.push({ kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(records[0]) });
  client.push({ kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(records[1]) });
  client.push({ kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(records[2]) });
  client.push({ kind: "stream-end", streamId: STREAM_ID });

  await expect(pending).resolves.toEqual(records);
  expect(sent).toEqual([{ kind: "stream-open", streamId: STREAM_ID, payload: { runId: "run-123", afterSeq: 0 } }]);
  tail.close();
});

test("benign stream-end without prior stream-data yields no records", async () => {
  const tail = await connectTuiLogTail("run-missing", {
    socketPath: "/tmp/test.sock",
    connectIpcClient: async () => makeIpcClient([{ kind: "stream-end", streamId: STREAM_ID }]),
  });

  await withFixedStreamId(async () => {
    await expect(collectRecords(tail)).resolves.toEqual([]);
  });
  tail.close();
});

test("error-payload stream-end rejects with RpcConnectionError", async () => {
  const tail = await connectTuiLogTail("run-123", {
    socketPath: "/tmp/test.sock",
    connectIpcClient: async () =>
      makeIpcClient([
        {
          kind: "stream-end",
          streamId: STREAM_ID,
          payload: { error: "follow failed" },
        },
      ]),
  });

  await withFixedStreamId(async () => {
    await expect(collectRecords(tail)).rejects.toBeInstanceOf(RpcConnectionError);
  });
  tail.close();
});

test("malformed stream-data payload rejects with RpcConnectionError", async () => {
  const tail = await connectTuiLogTail("run-123", {
    socketPath: "/tmp/test.sock",
    connectIpcClient: async () => makeIpcClient([{ kind: "stream-data", streamId: STREAM_ID, payload: "{not-json" }]),
  });

  await withFixedStreamId(async () => {
    await expect(collectRecords(tail)).rejects.toBeInstanceOf(RpcConnectionError);
  });
  tail.close();
});

test.each([
  ["missing runId", JSON.stringify({ event: { kind: "iteration_started" } })],
  ["non-string runId", JSON.stringify({ runId: 123, event: { kind: "iteration_started" } })],
  ["missing event", JSON.stringify({ runId: "run-123" })],
])("stream-data payload with %s rejects with RpcConnectionError", async (_label, payload) => {
  const tail = await connectTuiLogTail("run-123", {
    socketPath: "/tmp/test.sock",
    connectIpcClient: async () => makeIpcClient([{ kind: "stream-data", streamId: STREAM_ID, payload }]),
  });

  await withFixedStreamId(async () => {
    await expect(collectRecords(tail)).rejects.toBeInstanceOf(RpcConnectionError);
  });
  tail.close();
});

test("connection loss during records iteration rejects with RpcConnectionError", async () => {
  const client = makeIpcClient([], { deferred: true });
  const tail = await connectTuiLogTail("run-123", {
    socketPath: "/tmp/test.sock",
    connectIpcClient: async () => client,
  });

  const pending = withFixedStreamId(async () => collectRecords(tail));
  client.push({ kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(logRecord(1, "iteration_started")) });
  client.close();

  await expect(pending).rejects.toBeInstanceOf(RpcConnectionError);
  tail.close();
});

test("close sends stream-end for the opened stream id", async () => {
  const sent: unknown[] = [];
  const client = makeIpcClient([], { deferred: true, sent });

  const tail = await connectTuiLogTail("run-123", {
    socketPath: "/tmp/test.sock",
    connectIpcClient: async () => client,
  });

  await withFixedStreamId(async () => {
    const iter = tail.records()[Symbol.asyncIterator]();
    const pending = iter.next();
    client.push({
      kind: "stream-data",
      streamId: STREAM_ID,
      payload: JSON.stringify(logRecord(1, "iteration_started")),
    });
    await pending;
    tail.close();
    expect(sent).toEqual([
      { kind: "stream-open", streamId: STREAM_ID, payload: { runId: "run-123", afterSeq: 0 } },
      { kind: "stream-end", streamId: STREAM_ID },
    ]);
  });
});

test("rejects unreachable socket with RpcConnectionError before stream-open", async () => {
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
  ).rejects.toBeInstanceOf(RpcConnectionError);
  expect(sent).toEqual([]);
});

test("stream-open includes afterSeq when provided", async () => {
  const sent: unknown[] = [];
  const records = [logRecord(2, "boundary_committed")];
  const fakeConnect = async (): Promise<IpcClient> => {
    return makeIpcClient(
      [
        { kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(records[0]) },
        { kind: "stream-end", streamId: STREAM_ID },
      ],
      { sent },
    );
  };

  await withFixedStreamId(async () => {
    const tail = await connectTuiLogTail("run-123", {
      socketPath: "/tmp/test.sock",
      afterSeq: 1,
      connectIpcClient: fakeConnect,
    });
    await collectRecords(tail);
    tail.close();
  });

  expect(sent).toEqual([
    { kind: "stream-open", streamId: STREAM_ID, payload: { runId: "run-123", afterSeq: 1 } },
    { kind: "stream-end", streamId: STREAM_ID },
  ]);
});

test("stream-open includes afterSeq 0 when not provided", async () => {
  const sent: unknown[] = [];
  const records = [logRecord(1, "iteration_started")];
  const fakeConnect = async (): Promise<IpcClient> => {
    return makeIpcClient(
      [
        { kind: "stream-data", streamId: STREAM_ID, payload: JSON.stringify(records[0]) },
        { kind: "stream-end", streamId: STREAM_ID },
      ],
      { sent },
    );
  };

  await withFixedStreamId(async () => {
    const tail = await connectTuiLogTail("run-123", {
      socketPath: "/tmp/test.sock",
      connectIpcClient: fakeConnect,
    });
    await collectRecords(tail);
    tail.close();
  });

  expect(sent).toEqual([
    { kind: "stream-open", streamId: STREAM_ID, payload: { runId: "run-123", afterSeq: 0 } },
    { kind: "stream-end", streamId: STREAM_ID },
  ]);
});
