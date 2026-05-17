import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planSummary } from "../src/run-summary.ts";
import { createPlanTelemetryWriter } from "../src/modes/plan/plan-telemetry.ts";

describe("plan telemetry + planSummary", () => {
  test("records hard-error then ok and surfaces error attempt note", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-tel-sum-"));
    try {
      const telemetryPath = join(dir, "runs.jsonl");
      const writer = createPlanTelemetryWriter({
        telemetryPath,
        namespace: "plan:proj:tmp-abc",
      });
      writer.recordAgentAttempt({
        phase: "draft",
        agentCli: "claude",
        configuredModel: "haiku",
        durationMs: 12,
        result: {
          kind: "error",
          exitCode: 1,
          stderr: "boom",
        },
      });
      writer.recordAgentAttempt({
        phase: "draft",
        agentCli: "codex",
        configuredModel: "gpt-5.3-codex",
        durationMs: 34,
        result: {
          kind: "ok",
          stdout: "",
          stderr: "",
          usage_source: "agent",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          cost_usd: 0.03,
          cost_source: "computed",
        },
      });
      const summary = planSummary({
        telemetryPath,
        namespace: "plan:proj:tmp-abc",
        startTs: "2026-05-16T09:00:00.000Z",
        exitReason: "complete",
        durationMs: 4000,
        specPath: "spec/my-plan/index.md",
      });
      expect(summary).toContain("phase attempts: 2");
      expect(summary).toContain("failed agent attempt(s) under claude");
      expect(summary).toContain("(1 attempt(s))");
      expect(summary).toContain("codex");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
