import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { emitWorkBoundaryRecorded, type WorkBoundaryRecordedRecord } from "./work-boundary-telemetry.ts";

const stamp = { runId: "run-1", attemptId: "attempt-1", outcomeKind: "done", runStatus: "in-progress" } as const;
const commit = { commitSha: "abc", filesChanged: 2 };

function freshSinkPath(): string {
  const { jarvisRoot } = createJarvisHome();
  return join(jarvisRoot, "telemetry.jsonl");
}

function readRows(sinkPath: string): WorkBoundaryRecordedRecord[] {
  return readFileSync(sinkPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WorkBoundaryRecordedRecord);
}

describe("emitWorkBoundaryRecorded", () => {
  test("no telemetry context writes nothing", () => {
    const sinkPath = freshSinkPath();
    expect(emitWorkBoundaryRecorded(undefined, stamp, commit)).toBeUndefined();
    expect(existsSync(sinkPath)).toBe(false);
  });

  test("injected clock stamps ts and mtime and drives the roll month", () => {
    const sinkPath = freshSinkPath();
    const march = Date.UTC(2025, 2, 10, 12);
    mkdirSync(join(sinkPath, ".."), { recursive: true });
    writeFileSync(sinkPath, `${JSON.stringify({ legacy: true })}\n`, "utf8");
    utimesSync(sinkPath, march / 1000, march / 1000);
    const april = Date.UTC(2025, 3, 2, 12);
    expect(emitWorkBoundaryRecorded({ sinkPath, clock: () => new Date(april) }, stamp, commit)).toBeUndefined();
    expect(existsSync(join(sinkPath, "..", "telemetry", "2025-03.jsonl.gz"))).toBe(true);
    const rows = readRows(sinkPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      schema_version: 1,
      record_kind: "work_boundary_recorded",
      ts: new Date(april).toISOString(),
      run_id: "run-1",
      attempt_id: "attempt-1",
      outcome_kind: "done",
      run_status: "in-progress",
      commit_sha: "abc",
      files_changed: 2,
    });
    expect(statSync(sinkPath).mtimeMs).toBe(april);
  });

  test("absent clock falls back to real time for ts and mtime", () => {
    const sinkPath = freshSinkPath();
    const before = Date.now();
    expect(emitWorkBoundaryRecorded({ sinkPath }, stamp, commit)).toBeUndefined();
    const after = Date.now();
    const rows = readRows(sinkPath);
    expect(rows).toHaveLength(1);
    const tsMs = Date.parse(rows[0]?.ts ?? "");
    expect(tsMs).toBeGreaterThanOrEqual(before);
    expect(tsMs).toBeLessThanOrEqual(after);
    const mtimeMs = statSync(sinkPath).mtimeMs;
    expect(mtimeMs).toBeGreaterThanOrEqual(before - 1000);
    expect(mtimeMs).toBeLessThanOrEqual(after + 1000);
  });

  test("append failure returns an error message instead of throwing", () => {
    const { jarvisRoot } = createJarvisHome();
    mkdirSync(jarvisRoot, { recursive: true });
    const blocker = join(jarvisRoot, "blocker");
    writeFileSync(blocker, "", "utf8");
    const message = emitWorkBoundaryRecorded({ sinkPath: join(blocker, "telemetry.jsonl") }, stamp, commit);
    expect(typeof message).toBe("string");
    expect(message).not.toBe("");
  });
});
