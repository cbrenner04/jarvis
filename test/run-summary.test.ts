import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSummary } from "../src/run-summary.ts";

function writeTelemetry(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-run-summary-"));
  const path = join(dir, "runs.jsonl");
  writeFileSync(
    path,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
  return path;
}

describe("runSummary", () => {
  test("single-agent happy path with all fields", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 200,
        },
        usage_source: "agent",
        cost_usd: 0.42,
        cost_source: "agent",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-complete",
      iterations: 1,
      durationMs: 83_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("run summary");
    expect(summary).toContain("claude (1 iters)");
    expect(summary).toContain("$0.42");
    expect(summary).toContain("cache_r");
    expect(summary).toContain("cache_w");
  });

  test("mixed cost sources create notes", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:spec",
        agent: "codex",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        usage_source: "agent",
        cost_usd: 0.1,
        cost_source: "computed",
      },
      {
        ts: "2026-05-16T10:00:02.000Z",
        namespace: "p:spec",
        agent: "codex",
        iteration: 2,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        usage_source: "agent",
        cost_usd: 0.2,
        cost_source: "agent",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-complete",
      iterations: 2,
      durationMs: 2_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("notes:");
    expect(summary).toContain("codex mixes cost sources: computed, agent.");
  });

  test("unavailable usage is listed per agent", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:spec",
        agent: "cursor",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        usage_source: "unavailable",
        cost_usd: null,
        cost_source: "no-usage",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-progress",
      iterations: 1,
      durationMs: 1_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain(
      "1 iteration(s) under cursor had no usage data (usage_source=unavailable).",
    );
  });

  test("null cost adds a total-cost exclusion note", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        usage_source: "agent",
        cost_usd: 0.5,
        cost_source: "agent",
      },
      {
        ts: "2026-05-16T10:00:02.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 2,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        usage_source: "agent",
        cost_usd: null,
        cost_source: "no-price",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-progress",
      iterations: 2,
      durationMs: 2_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("$0.50");
    expect(summary).toContain(
      "1 iteration(s) had null cost and were excluded from total cost.",
    );
  });

  test("cache columns are omitted when always zero", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        usage_source: "agent",
        cost_usd: 0.1,
        cost_source: "computed",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-progress",
      iterations: 1,
      durationMs: 2_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).not.toContain("cache_r");
    expect(summary).not.toContain("cache_w");
  });

  test("startTs filtering excludes earlier same-namespace records", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T09:59:59.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        usage_source: "agent",
        cost_usd: 9.99,
        cost_source: "agent",
      },
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 2,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        usage_source: "agent",
        cost_usd: 0.5,
        cost_source: "agent",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-progress",
      iterations: 1,
      durationMs: 2_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("$0.50");
    expect(summary).not.toContain("$9.99");
  });
});
