import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlanTelemetryWriter } from "../src/modes/plan/plan-telemetry.ts";
import { planSummary } from "../src/run-summary.ts";
import type { PlanTelemetryPhase } from "../src/telemetry.ts";

describe("plan telemetry + planSummary", () => {
  test("records every live plan phase", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-tel-phases-"));
    try {
      const telemetryPath = join(dir, "runs.jsonl");
      const writer = createPlanTelemetryWriter({ telemetryPath, namespace: "plan:proj:phases" });
      const phases = ["draft", "review"] as const satisfies readonly PlanTelemetryPhase[];
      const record = (phase: PlanTelemetryPhase) =>
        writer.recordAgentAttempt({
          phase,
          agentCli: "claude",
          configuredModel: "haiku",
          durationMs: 1,
          result: { kind: "ok", stdout: "", stderr: "" },
        });

      phases.forEach(record);
      // @ts-expect-error name-only is a retired producer phase
      const _retiredPhase: PlanTelemetryPhase = "name-only";
      const retainedCompatibilityPhases = ["intent", "refine"] as const satisfies readonly PlanTelemetryPhase[];

      const rows = readFileSync(telemetryPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { plan_phase: string; exit_reason: string });
      expect(rows.map(({ plan_phase, exit_reason }) => [plan_phase, exit_reason])).toEqual([
        ["draft", "plan-draft-ok"],
        ["review", "plan-review-ok"],
      ]);
      expect(retainedCompatibilityPhases).toEqual(["intent", "refine"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects non-emitter phases before writing telemetry", () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-plan-tel-retired-"));
    try {
      const telemetryPath = join(dir, "runs.jsonl");
      const writer = createPlanTelemetryWriter({ telemetryPath, namespace: "plan:proj:retired" });

      for (const phase of ["intent", "refine", "name-only"]) {
        expect(() =>
          writer.recordAgentAttempt({
            phase: phase as PlanTelemetryPhase,
            agentCli: "claude",
            configuredModel: "haiku",
            durationMs: 1,
            result: { kind: "ok", stdout: "", stderr: "" },
          }),
        ).toThrow("invalid plan telemetry phase");
      }
      expect(existsSync(telemetryPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
