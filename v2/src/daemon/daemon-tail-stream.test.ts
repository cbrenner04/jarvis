import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTailStreamHandler } from "./daemon.ts";
import { connectIpcClient } from "../ipc/client.ts";
import { type IpcServer, startIpcServer } from "../ipc/server.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { canUseUnixSockets } from "../testing/unix-socket.ts";

const SOCKET_PATH = join(tmpdir(), `jarvis-daemon-tail-test-${process.pid}.sock`);
const LOGS_PATH = join(tmpdir(), `jarvis-daemon-tail-logs-${process.pid}.jsonl`);
const socketTest = test.skipIf(!canUseUnixSockets());

let stateStore: StateStore;
let server: IpcServer;
let onFollow: ((signal?: AbortSignal) => void) | undefined;
let followCalled: boolean;

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

async function expectTailClosesWithoutData(streamId: string, payload: Record<string, unknown>): Promise<void> {
  const client = await connectIpcClient(SOCKET_PATH);
  client.send({ kind: "stream-open", streamId, payload });

  const frame = await client.nextFrame();
  expect(frame.kind).toBe("stream-end");
  if (frame.kind === "stream-end") {
    expect(frame.streamId).toBe(streamId);
  }

  client.close();
  expect(followCalled).toBe(false);
}

beforeEach(async () => {
  if (!canUseUnixSockets()) {
    return;
  }
  onFollow = undefined;
  followCalled = false;
  rmSync(SOCKET_PATH, { force: true });
  rmSync(LOGS_PATH, { force: true });
  stateStore = openStateStore(join(tmpdir(), `jarvis-tail-state-${process.pid}-${Date.now()}.db`));

  const baseReader = openLogReader(LOGS_PATH);
  const logReader = {
    ...baseReader,
    follow(runId: string, signal?: AbortSignal) {
      followCalled = true;
      onFollow?.(signal);
      return baseReader.follow(runId, signal);
    },
  };
  const tailHandler = createTailStreamHandler({ stateStore, logReader });
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

socketTest("tail stream replays persisted events in seq order for known run", async () => {
  const runId = createRunWithLogs();
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

socketTest("tail stream closes without stream-data for missing runId", () =>
  expectTailClosesWithoutData("tail-missing", {}),
);

socketTest("tail stream closes without stream-data for non-string runId", () =>
  expectTailClosesWithoutData("tail-bad", { runId: 123 }),
);

socketTest("tail stream closes without stream-data for unknown runId", async () => {
  const orphanRunId = "unknown-run";
  const logSink = openLogSink(LOGS_PATH);
  logSink.append(orphanRunId, { kind: "iteration_started", attemptId: "attempt-1" });
  logSink.append(orphanRunId, {
    kind: "boundary_committed",
    attemptId: "attempt-1",
    outcomeKind: "progress",
    runStatus: "in-progress",
  });
  logSink.close();

  await expectTailClosesWithoutData("tail-unknown", { runId: orphanRunId });
});

socketTest("tail stream aborts follow signal on client stream-end", async () => {
  let followSignal: AbortSignal | undefined;
  onFollow = (signal) => {
    followSignal = signal;
  };

  const runId = seedRun();
  const logSink = openLogSink(LOGS_PATH);
  logSink.append(runId, { kind: "iteration_started", attemptId: "attempt-1" });
  logSink.close();

  const client = await connectIpcClient(SOCKET_PATH);
  client.send({ kind: "stream-open", streamId: "tail-abort", payload: { runId } });

  expect((await client.nextFrame()).kind).toBe("stream-data");

  client.send({ kind: "stream-end", streamId: "tail-abort" });
  expect((await client.nextFrame()).kind).toBe("stream-end");
  expect(followSignal?.aborted).toBe(true);

  client.close();
});
