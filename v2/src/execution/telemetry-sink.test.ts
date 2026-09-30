import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { InvocationCompletedRecord } from "../../../shared/invocation/execute.ts";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { buildJsonlSink } from "./telemetry-sink.ts";
import { emitWorkBoundaryRecorded } from "./work-boundary-telemetry.ts";

function utcMs(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d, 12, 0, 0, 0);
}

function mutableClock(initialMs: number): { clock: () => Date; set: (ms: number) => void } {
  let ms = initialMs;
  return {
    clock: () => new Date(ms),
    set: (next) => {
      ms = next;
    },
  };
}

function stubInvocationRow(ts: string): InvocationCompletedRecord {
  return {
    schema_version: 1,
    record_kind: "invocation_completed",
    ts,
    operator_session_id: "op",
    run_id: "run",
    attempt_id: "attempt",
    invocation_id: "invocation",
    project: "p",
    workflow: "w",
    step_id: "step",
    role: "implement",
    agent: "claude",
    model: "m",
    binding_id: "binding",
    binding_index: 0,
    duration_ms: 1,
    worktree_path: "/wt",
    branch: "b",
    spec_ref: "spec",
    usage: {
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    },
    usage_source: "unavailable",
    cost_usd: null,
    cost_source: "unavailable",
    warnings: [],
    exit_kind: "ok",
    exit_reason: null,
  };
}

describe("telemetry-sink monthly roll", () => {
  let previousJarvisHome: string | undefined;
  let jarvisRoot: string;
  let sinkPath: string;

  afterEach(() => {
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
  });

  function isolateSink(): void {
    previousJarvisHome = process.env.JARVIS_HOME;
    ({ jarvisRoot } = createJarvisHome());
    process.env.JARVIS_HOME = jarvisRoot;
    sinkPath = join(jarvisRoot, "telemetry.jsonl");
  }

  test("monthly telemetry same UTC month appends without re-roll", () => {
    isolateSink();
    const june1 = utcMs(2026, 6, 1);
    const june15 = utcMs(2026, 6, 15);
    const { clock, set } = mutableClock(june1);
    const sink = buildJsonlSink(sinkPath, { clock });
    sink.append(stubInvocationRow("t1"));
    set(june15);
    sink.append(stubInvocationRow("t2"));
    expect(existsSync(join(jarvisRoot, "telemetry"))).toBe(false);
    expect(statSync(sinkPath).mtimeMs).toBe(june15);
    expect(readFileSync(sinkPath, "utf8").split("\n").filter(Boolean)).toHaveLength(2);
  });

  test("monthly telemetry roll on UTC boundary", () => {
    isolateSink();
    const may = utcMs(2026, 5, 20);
    const june = utcMs(2026, 6, 3);
    const { clock, set } = mutableClock(may);
    const sink = buildJsonlSink(sinkPath, { clock });
    sink.append(stubInvocationRow("may-row"));
    const preRollPlain = readFileSync(sinkPath, "utf8");
    set(june);
    sink.append(stubInvocationRow("june-row"));
    const archivePath = join(jarvisRoot, "telemetry", "2026-05.jsonl.gz");
    expect(existsSync(archivePath)).toBe(true);
    expect(gunzipSync(readFileSync(archivePath)).toString("utf8")).toBe(preRollPlain);
    expect(readFileSync(sinkPath, "utf8")).toBe(`${JSON.stringify(stubInvocationRow("june-row"))}\n`);
  });

  test("monthly telemetry roll after writer restart", () => {
    isolateSink();
    mkdirSync(jarvisRoot, { recursive: true });
    writeFileSync(sinkPath, `${JSON.stringify({ legacy: true })}\n`, "utf8");
    const april = utcMs(2026, 4, 10);
    utimesSync(sinkPath, april / 1000, april / 1000);
    const june = utcMs(2026, 6, 1);
    const sink = buildJsonlSink(sinkPath, { clock: fixedClock(june) });
    sink.append(stubInvocationRow("after-restart"));
    expect(existsSync(join(jarvisRoot, "telemetry", "2026-04.jsonl.gz"))).toBe(true);
    expect(readFileSync(sinkPath, "utf8").includes("after-restart")).toBe(true);
  });

  test("monthly telemetry skipped months produce no archive", () => {
    isolateSink();
    const jan = utcMs(2026, 1, 5);
    const mar = utcMs(2026, 3, 2);
    const { clock, set } = mutableClock(jan);
    const sink = buildJsonlSink(sinkPath, { clock });
    sink.append(stubInvocationRow("jan"));
    set(mar);
    sink.append(stubInvocationRow("mar"));
    expect(existsSync(join(jarvisRoot, "telemetry", "2026-01.jsonl.gz"))).toBe(true);
    expect(existsSync(join(jarvisRoot, "telemetry", "2026-02.jsonl.gz"))).toBe(false);
  });

  test("work boundary and invocation sinks share monthly roll", () => {
    isolateSink();
    const may = utcMs(2026, 5, 8);
    const june = utcMs(2026, 6, 9);
    const { clock, set } = mutableClock(may);
    const sink = buildJsonlSink(sinkPath, { clock });
    sink.append(stubInvocationRow("invocation-may"));
    set(june);
    const boundaryError = emitWorkBoundaryRecorded(
      { sinkPath, clock },
      {
        runId: "run-1",
        attemptId: "attempt-1",
        outcomeKind: "done",
        runStatus: "in-progress",
      },
      { commitSha: "abc", filesChanged: 1 },
    );
    expect(boundaryError).toBeUndefined();
    expect(existsSync(join(jarvisRoot, "telemetry", "2026-05.jsonl.gz"))).toBe(true);
    const current = readFileSync(sinkPath, "utf8");
    expect(current.includes("invocation-may")).toBe(false);
    expect(current.includes("work_boundary_recorded")).toBe(true);
  });
});

function fixedClock(ms: number): () => Date {
  return () => new Date(ms);
}
