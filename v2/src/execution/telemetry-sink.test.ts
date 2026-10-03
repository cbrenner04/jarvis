import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { InvocationCompletedRecord } from "../../../shared/invocation/execute.ts";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { unrestrictedInvocationConfinement } from "../testing/bindings.ts";
import { appendTelemetryJsonlLine, buildJsonlSink } from "./telemetry-sink.ts";
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
    ...unrestrictedInvocationConfinement,
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
    const { clock } = mutableClock(june);
    const sink = buildJsonlSink(sinkPath, { clock });
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
    const row = JSON.parse(current.trim()) as { record_kind: string; ts: string };
    expect(row.record_kind).toBe("work_boundary_recorded");
    expect(row.ts).toBe(new Date(june).toISOString());
  });

  function seedCurrentFile(content: string, mtimeMs: number): void {
    mkdirSync(jarvisRoot, { recursive: true });
    writeFileSync(sinkPath, content, "utf8");
    utimesSync(sinkPath, mtimeMs / 1000, mtimeMs / 1000);
  }

  function gunzipText(path: string): string {
    return gunzipSync(readFileSync(path)).toString("utf8");
  }

  test("interleaved rollers: a loser whose staging rename hits ENOENT keeps the closed month intact", () => {
    isolateSink();
    const mayRows = `${JSON.stringify({ month: "may" })}\n`;
    seedCurrentFile(mayRows, utcMs(2026, 5, 20));
    const { clock } = mutableClock(utcMs(2026, 6, 2));
    let interleaved = false;
    // B passed its month check; A rolls and appends in between; B's staging rename then loses.
    const loserRename = (from: string, to: string): void => {
      if (!interleaved && from === sinkPath) {
        interleaved = true;
        appendTelemetryJsonlLine(sinkPath, '{"writer":"A"}', { clock });
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      renameSync(from, to);
    };
    appendTelemetryJsonlLine(sinkPath, '{"writer":"B"}', { clock, renameSync: loserRename });
    expect(interleaved).toBe(true);
    expect(gunzipText(join(jarvisRoot, "telemetry", "2026-05.jsonl.gz"))).toBe(mayRows);
    expect(readdirSync(join(jarvisRoot, "telemetry")).filter((n) => !n.startsWith("."))).toEqual(["2026-05.jsonl.gz"]);
    expect(readFileSync(sinkPath, "utf8")).toBe('{"writer":"A"}\n{"writer":"B"}\n');
  });

  test("a loser whose current file is renamed away before its stat still appends its line", () => {
    isolateSink();
    const mayRows = `${JSON.stringify({ month: "may" })}\n`;
    seedCurrentFile(mayRows, utcMs(2026, 5, 20));
    const { clock } = mutableClock(utcMs(2026, 6, 2));
    // Winner B (a live process) stages the current file between loser A's existence check and its stat.
    const winnerStaged = `${sinkPath}.rolling-${process.ppid}-winner`;
    let raced = false;
    const racingStat = (path: string): { mtimeMs: number } => {
      if (!raced && path === sinkPath) {
        raced = true;
        renameSync(sinkPath, winnerStaged);
      }
      return statSync(path);
    };
    appendTelemetryJsonlLine(sinkPath, '{"writer":"A"}', { clock, statSync: racingStat });
    expect(raced).toBe(true);
    expect(readFileSync(sinkPath, "utf8")).toBe('{"writer":"A"}\n');
    expect(readFileSync(winnerStaged, "utf8")).toBe(mayRows);
  });

  test("a roll never overwrites an existing month archive", () => {
    isolateSink();
    const telemetryDir = join(jarvisRoot, "telemetry");
    mkdirSync(telemetryDir, { recursive: true });
    const existing = `${JSON.stringify({ earlier: true })}\n`;
    writeFileSync(join(telemetryDir, "2026-05.jsonl.gz"), gzipSync(existing));
    const later = `${JSON.stringify({ later: true })}\n`;
    seedCurrentFile(later, utcMs(2026, 5, 30));
    const { clock } = mutableClock(utcMs(2026, 6, 1));
    appendTelemetryJsonlLine(sinkPath, '{"june":1}', { clock });
    expect(gunzipText(join(telemetryDir, "2026-05.jsonl.gz"))).toBe(existing);
    expect(gunzipText(join(telemetryDir, "2026-05.1.jsonl.gz"))).toBe(later);
    expect(readFileSync(sinkPath, "utf8")).toBe('{"june":1}\n');
  });

  test("a staging file orphaned by a crashed roller is recovered into the archive", () => {
    isolateSink();
    mkdirSync(jarvisRoot, { recursive: true });
    const orphan = `${sinkPath}.rolling-999999999-deadbeef`;
    const aprilRows = `${JSON.stringify({ month: "april" })}\n`;
    writeFileSync(orphan, aprilRows, "utf8");
    const april = utcMs(2026, 4, 28);
    utimesSync(orphan, april / 1000, april / 1000);
    const { clock } = mutableClock(utcMs(2026, 6, 3));
    appendTelemetryJsonlLine(sinkPath, '{"june":1}', { clock });
    expect(existsSync(orphan)).toBe(false);
    expect(gunzipText(join(jarvisRoot, "telemetry", "2026-04.jsonl.gz"))).toBe(aprilRows);
    expect(readdirSync(jarvisRoot).filter((n) => n.includes(".rolling-"))).toEqual([]);
    expect(readFileSync(sinkPath, "utf8")).toBe('{"june":1}\n');
  });

  test("appendTelemetryJsonlLine keeps a caller-supplied trailing newline single", () => {
    isolateSink();
    const { clock } = mutableClock(utcMs(2026, 6, 1));
    appendTelemetryJsonlLine(sinkPath, '{"a":1}\n', { clock });
    appendTelemetryJsonlLine(sinkPath, '{"b":2}', { clock });
    expect(readFileSync(sinkPath, "utf8")).toBe('{"a":1}\n{"b":2}\n');
  });

  test("appendTelemetryJsonlLine without a clock stamps real time and does not roll", () => {
    isolateSink();
    const before = Date.now();
    appendTelemetryJsonlLine(sinkPath, '{"a":1}');
    appendTelemetryJsonlLine(sinkPath, '{"b":2}');
    const after = Date.now();
    expect(existsSync(join(jarvisRoot, "telemetry"))).toBe(false);
    const mtimeMs = statSync(sinkPath).mtimeMs;
    expect(mtimeMs).toBeGreaterThanOrEqual(before - 1000);
    expect(mtimeMs).toBeLessThanOrEqual(after + 1000);
  });
});
