import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { emitWorkBoundaryRecorded, type WorkBoundaryRecordedRecord } from "./work-boundary-telemetry.ts";

describe("work-boundary-telemetry", () => {
  let previousJarvisHome: string | undefined;

  afterEach(() => {
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
  });

  test("emitWorkBoundaryRecorded forwards injected clock into the boundary row timestamp", () => {
    previousJarvisHome = process.env.JARVIS_HOME;
    const { jarvisRoot } = createJarvisHome();
    process.env.JARVIS_HOME = jarvisRoot;
    const sinkPath = join(jarvisRoot, "telemetry.jsonl");
    const fixedMs = Date.UTC(2020, 1, 15, 8, 30, 0, 0);
    const error = emitWorkBoundaryRecorded(
      { sinkPath, clock: () => new Date(fixedMs) },
      {
        runId: "run-1",
        attemptId: "attempt-1",
        outcomeKind: "done",
        runStatus: "completed",
      },
      { commitSha: "abc123", filesChanged: 2 },
    );
    expect(error).toBeUndefined();
    const line = JSON.parse(readFileSync(sinkPath, "utf8").trim()) as WorkBoundaryRecordedRecord;
    expect(line.ts).toBe(new Date(fixedMs).toISOString());
    expect(line.record_kind).toBe("work_boundary_recorded");
  });
});
