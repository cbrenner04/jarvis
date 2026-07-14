import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TelemetryRecord } from "../src/telemetry.ts";
import { runSummary } from "../src/run-summary.ts";

function writeTelemetry(records: TelemetryRecord[]): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-zero-output-"));
  const path = join(dir, "runs.jsonl");
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  return path;
}

describe("patch zero-output telemetry", () => {
  test("telemetry record includes zero_agent_output flag when set", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T09:00:00.000Z",
        namespace: "patch:proj:tmp-abc",
        agent: "claude",
        iteration: 1,
        duration_ms: 5000,
        kind: "timeout",
        exit_reason: "watchdog-idle-timeout",
        mode: "patch",
        patch_phase: "implementation",
        zero_agent_output: true,
      },
    ]);

    const summary = runSummary({
      telemetryPath,
      namespace: "patch:proj:tmp-abc",
      startTs: "2026-05-16T09:00:00.000Z",
      exitReason: "watchdog-idle-timeout",
      iterations: 1,
      durationMs: 5000,
      specPath: "spec/my-spec/index.md",
    });

    expect(summary).toContain("produced zero observed output");
    expect(summary).toContain("claude");
    expect(summary).toContain("check agent binding");
  });

  test("telemetry record omits zero_agent_output when output was observed", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T09:00:00.000Z",
        namespace: "patch:proj:tmp-xyz",
        agent: "claude",
        iteration: 1,
        duration_ms: 5000,
        kind: "ok",
        exit_reason: "criteria-progress",
        mode: "patch",
        patch_phase: "implementation",
        last_output_age_ms: 100,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    ]);

    const summary = runSummary({
      telemetryPath,
      namespace: "patch:proj:tmp-xyz",
      startTs: "2026-05-16T09:00:00.000Z",
      exitReason: "criteria-progress",
      iterations: 1,
      durationMs: 5000,
      specPath: "spec/my-spec/index.md",
    });

    expect(summary).not.toContain("zero observed output");
  });

  test("summary surfaces zero-output from multiple agents", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T09:00:00.000Z",
        namespace: "patch:proj:multi",
        agent: "claude",
        iteration: 1,
        duration_ms: 5000,
        kind: "timeout",
        exit_reason: "watchdog-idle-timeout",
        mode: "patch",
        patch_phase: "implementation",
        zero_agent_output: true,
      },
      {
        ts: "2026-05-16T09:05:00.000Z",
        namespace: "patch:proj:multi",
        agent: "cursor",
        iteration: 2,
        duration_ms: 3000,
        kind: "timeout",
        exit_reason: "watchdog-idle-timeout",
        mode: "patch",
        patch_phase: "implementation",
        zero_agent_output: true,
      },
    ]);

    const summary = runSummary({
      telemetryPath,
      namespace: "patch:proj:multi",
      startTs: "2026-05-16T09:00:00.000Z",
      exitReason: "watchdog-idle-timeout",
      iterations: 2,
      durationMs: 8000,
      specPath: "spec/my-spec/index.md",
    });

    expect(summary).toContain("claude");
    expect(summary).toContain("cursor");
    expect(summary).toContain("zero observed output");
  });
});
