import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LogEvent, openLogReader, openLogSink, type PersistedRecord } from "./log-stream.ts";

/** Short poll interval for tests, well below any per-test timeout. */
const TEST_POLL_MS = 15;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("log-stream", () => {
  let tempDir: string;
  let storagePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "log-stream-test-"));
    storagePath = join(tempDir, "log-stream.jsonl");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("contract_miss_detail is assignable on LogEvent", () => {
    const event: LogEvent = {
      kind: "contract_miss_detail",
      attemptId: "attempt-1",
      failedContractId: "artifact.exists",
      responseText: "agent output",
      failureReason: "plan.draft.shape",
    };
    expect(event.kind).toBe("contract_miss_detail");
    expect(event.attemptId).toBe("attempt-1");
    expect(event.failedContractId).toBe("artifact.exists");
    expect(event.responseText).toBe("agent output");
    expect(event.failureReason).toBe("plan.draft.shape");
  });

  it("persists structured records with round-trip kind and payload fields", () => {
    const sink = openLogSink(storagePath);
    const reader = openLogReader(storagePath);

    const iterationEvent: LogEvent = { kind: "iteration_started", attemptId: "attempt-1" };
    sink.append("run-1", iterationEvent);

    const boundaryEvent: LogEvent = {
      kind: "boundary_committed",
      attemptId: "attempt-1",
      outcomeKind: "progress",
      runStatus: "in-progress",
    };
    sink.append("run-1", boundaryEvent);

    const loopEvent: LogEvent = {
      kind: "loop_finished",
      loopOutcomeKind: "complete",
      iterationsConsumed: 3,
      resumable: false,
    };
    sink.append("run-1", loopEvent);

    sink.close();

    const records = reader.tail("run-1");
    expect(records.length).toBe(3);

    // Check iteration_started
    const rec1 = records[0];
    expect(rec1).toBeDefined();
    if (rec1) {
      expect(rec1.event.kind).toBe("iteration_started");
      if (rec1.event.kind === "iteration_started") {
        expect(rec1.event.attemptId).toBe("attempt-1");
      }
    }

    // Check boundary_committed
    const rec2 = records[1];
    expect(rec2).toBeDefined();
    if (rec2) {
      expect(rec2.event.kind).toBe("boundary_committed");
      if (rec2.event.kind === "boundary_committed") {
        expect(rec2.event.attemptId).toBe("attempt-1");
        expect(rec2.event.outcomeKind).toBe("progress");
        expect(rec2.event.runStatus).toBe("in-progress");
      }
    }

    // Check loop_finished
    const rec3 = records[2];
    expect(rec3).toBeDefined();
    if (rec3) {
      expect(rec3.event.kind).toBe("loop_finished");
      if (rec3.event.kind === "loop_finished") {
        expect(rec3.event.loopOutcomeKind).toBe("complete");
        expect(rec3.event.iterationsConsumed).toBe(3);
        expect(rec3.event.resumable).toBe(false);
      }
    }
  });

  it("tail returns only the specified run's events in ascending seq order starting at 1", () => {
    const sink = openLogSink(storagePath);
    const reader = openLogReader(storagePath);

    // Interleave events from two runs
    sink.append("run-1", { kind: "iteration_started", attemptId: "a1" });
    sink.append("run-2", { kind: "iteration_started", attemptId: "b1" });
    sink.append("run-1", { kind: "iteration_started", attemptId: "a2" });
    sink.append("run-2", { kind: "iteration_started", attemptId: "b2" });
    sink.append("run-1", { kind: "iteration_started", attemptId: "a3" });

    sink.close();

    const run1Records = reader.tail("run-1");
    const run2Records = reader.tail("run-2");

    expect(run1Records.length).toBe(3);
    expect(run2Records.length).toBe(2);

    // Check run-1 sequences
    const r1_0 = run1Records[0];
    const r1_1 = run1Records[1];
    const r1_2 = run1Records[2];
    expect(r1_0?.seq).toBe(1);
    expect(r1_1?.seq).toBe(2);
    expect(r1_2?.seq).toBe(3);

    // Check run-2 sequences
    const r2_0 = run2Records[0];
    const r2_1 = run2Records[1];
    expect(r2_0?.seq).toBe(1);
    expect(r2_1?.seq).toBe(2);

    // Verify payloads
    if (r1_0?.event.kind === "iteration_started") {
      expect(r1_0.event.attemptId).toBe("a1");
    }
    if (r1_1?.event.kind === "iteration_started") {
      expect(r1_1.event.attemptId).toBe("a2");
    }
    if (r1_2?.event.kind === "iteration_started") {
      expect(r1_2.event.attemptId).toBe("a3");
    }
  });

  it("follow yields existing events from seq 1, then new appends in order", async () => {
    const sink = openLogSink(storagePath);
    const reader = openLogReader(storagePath, TEST_POLL_MS);

    // Append some initial events
    sink.append("run-1", { kind: "iteration_started", attemptId: "a1" });
    sink.append("run-1", { kind: "iteration_started", attemptId: "a2" });

    sink.close();

    // Start following
    const events: PersistedRecord[] = [];

    const followPromise = (async () => {
      for await (const event of reader.follow("run-1")) {
        events.push(event);
        if (events.length >= 4) {
          break;
        }
      }
    })();

    // Let the initial replay and first poll scan complete before appending new records
    await delay(TEST_POLL_MS * 2);

    // Append new events from a new sink (separate writer on shared storage)
    const sink2 = openLogSink(storagePath);
    sink2.append("run-1", { kind: "iteration_started", attemptId: "a3" });
    sink2.append("run-1", { kind: "iteration_started", attemptId: "a4" });
    sink2.close();

    await followPromise;

    expect(events.length).toBe(4);
    const e0 = events[0];
    const e1 = events[1];
    const e2 = events[2];
    const e3 = events[3];
    expect(e0?.seq).toBe(1);
    expect(e1?.seq).toBe(2);
    expect(e2?.seq).toBe(3);
    expect(e3?.seq).toBe(4);

    if (e0?.event.kind === "iteration_started") {
      expect(e0.event.attemptId).toBe("a1");
    }
    if (e3?.event.kind === "iteration_started") {
      expect(e3.event.attemptId).toBe("a4");
    }
  });

  it("follow stops without error when AbortSignal aborts", async () => {
    const sink = openLogSink(storagePath);
    const reader = openLogReader(storagePath, TEST_POLL_MS);

    sink.append("run-1", { kind: "iteration_started", attemptId: "a1" });
    sink.close();

    const controller = new AbortController();
    const events: PersistedRecord[] = [];

    const followPromise = (async () => {
      for await (const event of reader.follow("run-1", controller.signal)) {
        events.push(event);
      }
    })();

    // Let follow replay the existing event and enter its poll wait
    await delay(TEST_POLL_MS * 2);

    // Abort the signal
    controller.abort();

    // Follow should complete without throwing
    await followPromise;

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("tail and follow on unknown runId yield empty stream without error", async () => {
    const sink = openLogSink(storagePath);
    const reader = openLogReader(storagePath, TEST_POLL_MS);

    sink.append("run-1", { kind: "iteration_started", attemptId: "a1" });
    sink.close();

    const tailRecords = reader.tail("unknown-run");
    expect(tailRecords).toEqual([]);

    const followEvents: PersistedRecord[] = [];
    const controller = new AbortController();

    const followPromise = (async () => {
      for await (const event of reader.follow("unknown-run", controller.signal)) {
        followEvents.push(event);
      }
    })();

    // Let follow finish replay (empty) and enter its poll wait
    await delay(TEST_POLL_MS * 2);

    controller.abort();

    await followPromise;

    expect(followEvents).toEqual([]);
  });

  it("follow after sink close still replays persisted events", async () => {
    const sink = openLogSink(storagePath);

    // Append and close
    sink.append("run-1", { kind: "iteration_started", attemptId: "a1" });
    sink.append("run-1", { kind: "iteration_started", attemptId: "a2" });
    sink.close();

    // Open reader and follow after sink is closed
    const reader = openLogReader(storagePath);
    const events: PersistedRecord[] = [];
    const controller = new AbortController();

    const followPromise = (async () => {
      for await (const event of reader.follow("run-1", controller.signal)) {
        events.push(event);
        if (events.length >= 2) {
          break;
        }
      }
    })();

    await followPromise;

    expect(events.length).toBe(2);
    const ev0 = events[0];
    const ev1 = events[1];
    expect(ev0?.seq).toBe(1);
    expect(ev1?.seq).toBe(2);
  });

  it("all records carry ISO-8601 timestamps", () => {
    const sink = openLogSink(storagePath);
    const reader = openLogReader(storagePath);

    sink.append("run-1", { kind: "iteration_started", attemptId: "a1" });
    sink.close();

    const records = reader.tail("run-1");
    expect(records.length).toBe(1);

    const rec = records[0];
    expect(rec).toBeDefined();
    if (rec) {
      const ts = rec.ts;
      // Verify ISO-8601 format
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      expect(isoRegex.test(ts)).toBe(true);

      // Verify it parses as a valid date
      const date = new Date(ts);
      expect(Number.isNaN(date.getTime())).toBe(false);
    }
  });

  it("append throws when called on closed sink", () => {
    const sink = openLogSink(storagePath);
    sink.close();

    expect(() => {
      sink.append("run-1", { kind: "iteration_started", attemptId: "a1" });
    }).toThrow();
  });

  it("idempotent close is safe", () => {
    const sink = openLogSink(storagePath);
    sink.append("run-1", { kind: "iteration_started", attemptId: "a1" });

    // Multiple closes should not throw
    sink.close();
    sink.close();
    sink.close();

    const reader = openLogReader(storagePath);
    const records = reader.tail("run-1");
    expect(records.length).toBe(1);
  });

  it("concurrent sinks on the same path allocate distinct monotonic seq for one run", () => {
    const sinkA = openLogSink(storagePath);
    const sinkB = openLogSink(storagePath);

    sinkA.append("run-1", { kind: "iteration_started", attemptId: "a1" });
    sinkB.append("run-1", { kind: "iteration_started", attemptId: "a2" });
    sinkA.append("run-1", { kind: "iteration_started", attemptId: "a3" });
    sinkB.append("run-1", { kind: "iteration_started", attemptId: "a4" });

    sinkA.close();
    sinkB.close();

    const reader = openLogReader(storagePath);
    const records = reader.tail("run-1");
    expect(records.map((record) => record.seq)).toEqual([1, 2, 3, 4]);
  });

  it("concurrent sinks keep per-run seq independent when runs are interleaved", () => {
    const sinkA = openLogSink(storagePath);
    const sinkB = openLogSink(storagePath);

    sinkA.append("run-1", { kind: "iteration_started", attemptId: "a1" });
    sinkB.append("run-2", { kind: "iteration_started", attemptId: "b1" });
    sinkA.append("run-1", { kind: "iteration_started", attemptId: "a2" });
    sinkB.append("run-2", { kind: "iteration_started", attemptId: "b2" });

    sinkA.close();
    sinkB.close();

    const reader = openLogReader(storagePath);
    expect(reader.tail("run-1").map((record) => record.seq)).toEqual([1, 2]);
    expect(reader.tail("run-2").map((record) => record.seq)).toEqual([1, 2]);
  });

  it("append succeeds when the trailing line is truncated", () => {
    const valid = JSON.stringify({
      runId: "run-1",
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      event: { kind: "iteration_started", attemptId: "a1" },
    });
    writeFileSync(storagePath, `${valid}\n{"runId":"run-1","seq":\n`, "utf-8");

    const sink = openLogSink(storagePath);
    expect(() => {
      sink.append("run-1", { kind: "iteration_started", attemptId: "a2" });
    }).not.toThrow();
    sink.close();

    const lastLine = readFileSync(storagePath, "utf-8").trim().split("\n").at(-1);
    expect(lastLine).toBeDefined();
    const record = JSON.parse(lastLine as string) as PersistedRecord;
    expect(record.seq).toBe(2);
  });

  it("tail skips a truncated trailing line instead of throwing", () => {
    const valid = JSON.stringify({
      runId: "run-1",
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      event: { kind: "iteration_started", attemptId: "a1" },
    });
    writeFileSync(storagePath, `${valid}\n{"runId":"run-1","seq":\n`, "utf-8");

    const reader = openLogReader(storagePath);
    expect(() => reader.tail("run-1")).not.toThrow();
    expect(reader.tail("run-1").map((record) => record.seq)).toEqual([1]);
  });

  it("persists ready_gate_out_of_scope loop_finished evidence with round-trip fields", () => {
    const sink = openLogSink(storagePath);
    const reader = openLogReader(storagePath);
    const outsidePath = "v2/src/untouched.test.ts";
    const detail = `ready gate failing paths lie outside the run's touched set: ${outsidePath}`;

    sink.append("run-1", {
      kind: "loop_finished",
      loopOutcomeKind: "ready_gate_out_of_scope",
      iterationsConsumed: 1,
      resumable: true,
      readyGateOutsidePaths: [outsidePath],
      readyGateOutOfScopeDetail: detail,
    });
    sink.close();

    const record = reader.tail("run-1").at(-1);
    expect(record?.event).toMatchObject({
      kind: "loop_finished",
      loopOutcomeKind: "ready_gate_out_of_scope",
      readyGateOutsidePaths: [outsidePath],
      readyGateOutOfScopeDetail: detail,
    });
  });

  it("persists completion_commit_failed error detail exactly", () => {
    const sink = openLogSink(storagePath);
    const reader = openLogReader(storagePath);
    const completionCommitError = "completion commit returned no commit SHA";
    const event: LogEvent = {
      kind: "loop_finished",
      loopOutcomeKind: "completion_commit_failed",
      iterationsConsumed: 2,
      resumable: false,
      completionCommitError,
    };

    sink.append("run-1", event);
    sink.close();

    const record = reader.tail("run-1").at(-1);
    expect(record?.event.kind).toBe("loop_finished");
    if (record?.event.kind === "loop_finished" && "completionCommitError" in record.event) {
      expect(record.event.completionCommitError).toBe(completionCommitError);
    }
  });

  it("limits completion commit error detail to completion_commit_failed", () => {
    const event: LogEvent = {
      kind: "loop_finished",
      loopOutcomeKind: "completion_commit_failed",
      iterationsConsumed: 2,
      resumable: true,
      completionCommitError: "completion commit returned no commit SHA",
      publicationFailure: { operation: "git push", message: "remote rejected update" },
    };
    expect(event.publicationFailure?.message).toBe("remote rejected update");

    const invalid: LogEvent = {
      kind: "loop_finished",
      loopOutcomeKind: "complete",
      iterationsConsumed: 2,
      resumable: false,
      // @ts-expect-error completionCommitError is valid only for completion_commit_failed.
      completionCommitError: "completion commit returned no commit SHA",
    };
    void invalid;
  });

  it("tails pre-field loop_finished records without completion commit error detail", () => {
    const record = {
      runId: "run-1",
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      event: {
        kind: "loop_finished",
        loopOutcomeKind: "completion_commit_failed",
        iterationsConsumed: 1,
        resumable: false,
      },
    };
    writeFileSync(storagePath, `${JSON.stringify(record)}\n`, "utf-8");

    const persisted = openLogReader(storagePath).tail("run-1").at(-1);
    expect(persisted?.event.kind).toBe("loop_finished");
    if (persisted?.event.kind === "loop_finished") {
      expect("completionCommitError" in persisted.event).toBe(false);
    }
  });

  it("follow waiter observes loop_finished appended by a second sink", async () => {
    const sinkA = openLogSink(storagePath);
    const reader = openLogReader(storagePath, TEST_POLL_MS);

    sinkA.append("run-1", { kind: "iteration_started", attemptId: "a1" });

    const subscribeSeq = reader.tail("run-1").at(-1)?.seq ?? 0;
    const controller = new AbortController();
    let terminal: PersistedRecord | undefined;

    const waitPromise = (async () => {
      for await (const record of reader.follow("run-1", controller.signal)) {
        if (record.seq <= subscribeSeq) continue;
        if (record.event.kind === "loop_finished" || record.event.kind === "run_execution_failed") {
          terminal = record;
          return;
        }
      }
    })();

    await delay(TEST_POLL_MS * 2);

    const sinkB = openLogSink(storagePath);
    sinkB.append("run-1", {
      kind: "loop_finished",
      loopOutcomeKind: "complete",
      iterationsConsumed: 1,
      resumable: false,
    });
    sinkB.close();
    sinkA.close();

    await waitPromise;

    expect(terminal?.seq).toBe(2);
    expect(terminal?.event.kind).toBe("loop_finished");
  });
});
