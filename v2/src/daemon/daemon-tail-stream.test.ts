import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamHandler } from "../ipc/server.ts";
import { type LogReader, openLogReader, openLogSink, type PersistedRecord } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { createTailStreamHandler, parseTailStreamParams, streamRunLogRecords } from "./daemon.ts";

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
  const { onData, closes, handlerPromise } = callTailHandler("tail-abort", { runId, follow: true }, controller.signal);

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
    { runId, afterSeq: 10, follow: true },
    controller.signal,
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 50));

  controller.abort();
  await handlerPromise;
  expect(closes.count).toBe(1);
  expect(followCalled).toBe(true);
});

test("streamRunLogRecords closes after replay for a non-follow in-progress run", async () => {
  const runId = seedRun();
  const records: PersistedRecord[] = [
    { runId, seq: 1, ts: "2026-01-01T00:00:00.000Z", event: { kind: "iteration_started", attemptId: "attempt-1" } },
    { runId, seq: 2, ts: "2026-01-01T00:00:01.000Z", event: { kind: "iteration_started", attemptId: "attempt-2" } },
  ];
  const neverFollowingReader: LogReader = {
    tail: () => records,
    follow: () => new Promise<never>(() => {}) as unknown as AsyncIterable<PersistedRecord>,
  } as unknown as LogReader;

  const onData: PersistedRecord[] = [];
  const controller = new AbortController();

  const timeout = new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 200));
  const run = streamRunLogRecords(
    { stateStore, logReader: neverFollowingReader },
    runId,
    0,
    false,
    (record) => onData.push(record),
    controller.signal,
  ).then(() => "returned" as const);

  const outcome = await Promise.race([run, timeout]);

  expect(outcome).toBe("returned");
  expect(onData).toEqual(records);
});

test("parseTailStreamParams follow field", () => {
  expect(parseTailStreamParams({ runId: "r1" })).toEqual({ runId: "r1", afterSeq: 0, follow: false });
  expect(parseTailStreamParams({ runId: "r1", follow: false })).toEqual({ runId: "r1", afterSeq: 0, follow: false });
  expect(parseTailStreamParams({ runId: "r1", follow: true })).toEqual({ runId: "r1", afterSeq: 0, follow: true });
  expect(parseTailStreamParams({ runId: "r1", follow: "true" })).toEqual({ runId: "r1", afterSeq: 0, follow: false });
  expect(parseTailStreamParams(JSON.stringify({ runId: "r1", follow: true }))).toEqual({
    runId: "r1",
    afterSeq: 0,
    follow: true,
  });
});

test("tail stream closes immediately for a terminal run even with follow: true", async () => {
  const runId = createRunWithLogs();
  stateStore.setRunStatus(runId, "failed");

  const { onData, closes, handlerPromise } = callTailHandler(
    "tail-terminal-follow",
    { runId, follow: true },
    new AbortController().signal,
  );
  await handlerPromise;

  expect(onData).toHaveLength(2);
  expect(closes.count).toBe(1);
  expect(followCalled).toBe(false);
});

test("tail stream enters follow loop for an in-progress run with follow: true", async () => {
  const runId = createRunWithLogs();

  const controller = new AbortController();
  const { closes, handlerPromise } = callTailHandler(
    "tail-inprogress-follow",
    { runId, follow: true },
    controller.signal,
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 50));

  controller.abort();
  await handlerPromise;
  expect(closes.count).toBe(1);
  expect(followCalled).toBe(true);
});

test("follow closes once the run settles", async () => {
  const runId = seedRun();
  const followRecord: PersistedRecord = {
    runId,
    seq: 1,
    ts: "2026-01-01T00:00:00.000Z",
    event: { kind: "iteration_started", attemptId: "attempt-1" },
  };

  let loadRunCalls = 0;
  const fakeStateStore = {
    loadRun: () => {
      loadRunCalls++;
      const status = loadRunCalls <= 2 ? "in-progress" : "completed";
      return { id: runId, status } as unknown as ReturnType<StateStore["loadRun"]>;
    },
  } as unknown as StateStore;

  const fakeLogReader: LogReader = {
    tail: () => [],
    follow: async function* () {
      yield followRecord;
      await new Promise<never>(() => {});
    },
  } as unknown as LogReader;

  const onData: PersistedRecord[] = [];
  const controller = new AbortController();

  const timeout = new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 200));
  const run = streamRunLogRecords(
    { stateStore: fakeStateStore, logReader: fakeLogReader },
    runId,
    0,
    true,
    (record) => onData.push(record),
    controller.signal,
  ).then(() => "returned" as const);

  const outcome = await Promise.race([run, timeout]);

  expect(outcome).toBe("returned");
  expect(onData).toEqual([followRecord]);
});

test("follow drains a record that lands only after the run is found already terminal by the first re-read", async () => {
  const runId = "run-drain-pre-loop";
  const replayRecord: PersistedRecord = {
    runId,
    seq: 1,
    ts: "2026-01-01T00:00:00.000Z",
    event: { kind: "iteration_started", attemptId: "attempt-1" },
  };
  // Models `workflow-runner.ts` committing `runStatus: "completed"` before appending
  // `loop_finished`: the record is absent from `tail()` at replay time and only shows up on
  // a later re-read, once the run is already terminal.
  const terminalRecord: PersistedRecord = {
    runId,
    seq: 2,
    ts: "2026-01-01T00:00:02.000Z",
    event: { kind: "loop_finished", loopOutcomeKind: "complete", iterationsConsumed: 3, resumable: false },
  };

  let loadRunCalls = 0;
  const fakeStateStore = {
    loadRun: () => {
      loadRunCalls++;
      const status = loadRunCalls === 1 ? "in-progress" : "completed";
      return { id: runId, status } as unknown as ReturnType<StateStore["loadRun"]>;
    },
  } as unknown as StateStore;

  let tailCalls = 0;
  let followCalledHere = false;
  const fakeLogReader: LogReader = {
    tail: () => {
      tailCalls++;
      return tailCalls === 1 ? [replayRecord] : [replayRecord, terminalRecord];
    },
    follow: () => {
      followCalledHere = true;
      return new Promise<never>(() => {}) as unknown as AsyncIterable<PersistedRecord>;
    },
  } as unknown as LogReader;

  const onData: PersistedRecord[] = [];
  const controller = new AbortController();

  await streamRunLogRecords(
    { stateStore: fakeStateStore, logReader: fakeLogReader },
    runId,
    0,
    true,
    (record) => onData.push(record),
    controller.signal,
  );

  expect(onData).toEqual([replayRecord, terminalRecord]);
  expect(followCalledHere).toBe(false);
});

test("follow closes when the run settles without a further record ever appended", async () => {
  const runId = "run-empty-tick";
  let loadRunCalls = 0;
  const fakeStateStore = {
    loadRun: () => {
      loadRunCalls++;
      const status = loadRunCalls <= 2 ? "in-progress" : "completed";
      return { id: runId, status } as unknown as ReturnType<StateStore["loadRun"]>;
    },
  } as unknown as StateStore;

  const fakeLogReader: LogReader = {
    tail: () => [],
    // Never yields — models a killed run that appends no further record after settling.
    follow: async function* (_runId: string, signal?: AbortSignal) {
      while (!signal?.aborted) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
    },
  } as unknown as LogReader;

  const onData: PersistedRecord[] = [];
  const controller = new AbortController();

  const timeout = new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 300));
  const run = streamRunLogRecords(
    { stateStore: fakeStateStore, logReader: fakeLogReader, followStatusPollMs: 20 },
    runId,
    0,
    true,
    (record) => onData.push(record),
    controller.signal,
  ).then(() => "returned" as const);

  const outcome = await Promise.race([run, timeout]);

  expect(outcome).toBe("returned");
  expect(onData).toEqual([]);
});
