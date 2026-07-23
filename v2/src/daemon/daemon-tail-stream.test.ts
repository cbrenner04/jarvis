import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamHandler } from "../ipc/server.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { createTailStreamHandler } from "./daemon.ts";

const LOGS_PATH = join(tmpdir(), `jarvis-daemon-tail-logs-${process.pid}.jsonl`);

let stateStore: StateStore;
let onFollow: ((signal?: AbortSignal) => void) | undefined;
let followCalled: boolean;
let tailHandler: StreamHandler;

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

function callTailHandler(
  streamId: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): { onData: unknown[]; closes: { count: number }; handlerPromise: Promise<void> } {
  const onData: unknown[] = [];
  const closes = { count: 0 };
  const handlerPromise = tailHandler(
    streamId,
    payload,
    (record) => onData.push(record),
    () => {
      closes.count++;
    },
    signal,
  );
  return { onData, closes, handlerPromise };
}

async function waitForRecords(onData: unknown[], count: number): Promise<void> {
  while (onData.length < count) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

async function expectTailClosesWithoutData(streamId: string, payload: Record<string, unknown>): Promise<void> {
  const { onData, closes, handlerPromise } = callTailHandler(streamId, payload, new AbortController().signal);
  await handlerPromise;

  expect(onData).toEqual([]);
  expect(closes.count).toBe(1);
  expect(followCalled).toBe(false);
}

beforeEach(() => {
  onFollow = undefined;
  followCalled = false;
  rmSync(LOGS_PATH, { force: true });
  stateStore = openStateStore(join(tmpdir(), `jarvis-tail-state-${process.pid}-${Date.now()}.db`));

  const baseReader = openLogReader(LOGS_PATH);
  const logReader = {
    tail: (runId: string) => baseReader.tail(runId),
    follow(runId: string, signal?: AbortSignal) {
      followCalled = true;
      onFollow?.(signal);
      return baseReader.follow(runId, signal);
    },
  };
  tailHandler = createTailStreamHandler({ stateStore, logReader });
});

afterEach(() => {
  rmSync(LOGS_PATH, { force: true });
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

test("tail stream replays persisted events in seq order for known run", async () => {
  const runId = createRunWithLogs();
  const controller = new AbortController();
  const { onData, closes, handlerPromise } = callTailHandler("tail1", { runId }, controller.signal);

  await waitForRecords(onData, 2);

  const record1 = onData[0] as { seq: number; event: { kind: string } };
  expect(record1.seq).toBe(1);
  expect(record1.event.kind).toBe("iteration_started");

  const record2 = onData[1] as { seq: number; event: { kind: string } };
  expect(record2.seq).toBe(2);
  expect(record2.event.kind).toBe("boundary_committed");

  controller.abort();
  await handlerPromise;
  expect(closes.count).toBe(1);
});

test("tail stream closes without stream-data for missing runId", () => expectTailClosesWithoutData("tail-missing", {}));

test("tail stream closes without stream-data for non-string runId", () =>
  expectTailClosesWithoutData("tail-bad", { runId: 123 }));

test("tail stream closes without stream-data for unknown runId", async () => {
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

test("tail stream closes after replay for a terminal run without entering follow", async () => {
  const runId = createRunWithLogs();
  stateStore.setRunStatus(runId, "failed");

  const { onData, closes, handlerPromise } = callTailHandler("tail-terminal", { runId }, new AbortController().signal);
  await handlerPromise;

  expect(onData).toHaveLength(2);
  expect(closes.count).toBe(1);
  expect(followCalled).toBe(false);
});

test("tail stream aborts follow signal on client stream-end", async () => {
  let followSignal: AbortSignal | undefined;
  onFollow = (signal) => {
    followSignal = signal;
  };

  const runId = seedRun();
  const logSink = openLogSink(LOGS_PATH);
  logSink.append(runId, { kind: "iteration_started", attemptId: "attempt-1" });
  logSink.close();

  const controller = new AbortController();
  const { onData, closes, handlerPromise } = callTailHandler("tail-abort", { runId }, controller.signal);

  await waitForRecords(onData, 1);

  controller.abort();
  await handlerPromise;

  expect(followSignal?.aborted).toBe(true);
  expect(closes.count).toBe(1);
});

test("tail stream with afterSeq skips replayed records and emits only records with seq > afterSeq", async () => {
  const runId = createRunWithLogs();
  const controller = new AbortController();
  const { onData, closes, handlerPromise } = callTailHandler(
    "tail-after-seq",
    { runId, afterSeq: 1 },
    controller.signal,
  );

  await waitForRecords(onData, 1);

  const record = onData[0] as { seq: number; event: { kind: string } };
  expect(record.seq).toBe(2);
  expect(record.event.kind).toBe("boundary_committed");

  controller.abort();
  await handlerPromise;
  expect(closes.count).toBe(1);
});

test("tail stream with afterSeq 0 replays all records (default behavior)", async () => {
  const runId = createRunWithLogs();
  const controller = new AbortController();
  const { onData, closes, handlerPromise } = callTailHandler(
    "tail-after-seq-zero",
    { runId, afterSeq: 0 },
    controller.signal,
  );

  await waitForRecords(onData, 2);

  expect(onData[0]).toEqual(expect.objectContaining({ seq: 1 }));
  expect(onData[1]).toEqual(expect.objectContaining({ seq: 2 }));

  controller.abort();
  await handlerPromise;
  expect(closes.count).toBe(1);
});

test("tail stream without afterSeq replays all records", async () => {
  const runId = createRunWithLogs();
  const controller = new AbortController();
  const { onData, closes, handlerPromise } = callTailHandler("tail-no-after-seq", { runId }, controller.signal);

  await waitForRecords(onData, 2);

  expect(onData[0]).toEqual(expect.objectContaining({ seq: 1 }));
  expect(onData[1]).toEqual(expect.objectContaining({ seq: 2 }));

  controller.abort();
  await handlerPromise;
  expect(closes.count).toBe(1);
});

test("tail stream with non-numeric afterSeq defaults to 0", async () => {
  const runId = createRunWithLogs();
  const controller = new AbortController();
  const { onData, closes, handlerPromise } = callTailHandler(
    "tail-bad-after-seq",
    { runId, afterSeq: "invalid" },
    controller.signal,
  );

  await waitForRecords(onData, 2);

  expect(onData[0]).toEqual(expect.objectContaining({ seq: 1 }));
  expect(onData[1]).toEqual(expect.objectContaining({ seq: 2 }));

  controller.abort();
  await handlerPromise;
  expect(closes.count).toBe(1);
});

test("tail stream with negative afterSeq defaults to 0", async () => {
  const runId = createRunWithLogs();
  const controller = new AbortController();
  const { onData, closes, handlerPromise } = callTailHandler(
    "tail-negative-after-seq",
    { runId, afterSeq: -5 },
    controller.signal,
  );

  await waitForRecords(onData, 2);

  expect(onData[0]).toEqual(expect.objectContaining({ seq: 1 }));
  expect(onData[1]).toEqual(expect.objectContaining({ seq: 2 }));

  controller.abort();
  await handlerPromise;
  expect(closes.count).toBe(1);
});

test("tail stream with afterSeq larger than last replay uses afterSeq for follow subscribe", async () => {
  let _followSignal: AbortSignal | undefined;
  onFollow = (signal) => {
    _followSignal = signal;
  };

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

  const controller = new AbortController();
  const { closes, handlerPromise } = callTailHandler(
    "tail-after-seq-large",
    { runId, afterSeq: 10 },
    controller.signal,
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 50));

  controller.abort();
  await handlerPromise;
  expect(closes.count).toBe(1);
  expect(followCalled).toBe(true);
});
