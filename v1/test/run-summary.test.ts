import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INTAKE_SUGGESTION_URL, planSummary, promptSummary, runSummary } from "../src/run-summary.ts";

function writeTelemetry(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-run-summary-"));
  const path = join(dir, "runs.jsonl");
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
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
        configured_model: "claude-haiku-4-5-20251001",
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
      exitReason: "criteria-complete (exit code 0)",
      iterations: 1,
      durationMs: 83_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("run summary");
    expect(summary).toContain("iterations: 1");
    expect(summary).toContain("attempts: 1");
    expect(summary).toContain("claude (claude-haiku-4-5-20251001) (1 iteration(s))");
    expect(summary).toContain("$0.42");
    expect(summary).toContain("cache_r");
    expect(summary).toContain("cache_w");
  });

  test("mixed meaningful cost sources create notes", () => {
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
      exitReason: "criteria-complete (exit code 0)",
      iterations: 2,
      durationMs: 2_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("notes:");
    expect(summary).toContain("codex mixes cost sources: agent, computed.");
  });

  test("quota attempts are excluded with a grouped note", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 100,
        kind: "quota",
        exit_reason: "quota-fallback",
      },
      {
        ts: "2026-05-16T10:00:02.000Z",
        namespace: "p:spec",
        agent: "codex",
        iteration: 1,
        duration_ms: 900,
        kind: "ok",
        exit_reason: "criteria-complete",
        usage_source: "agent",
        usage: {
          input_tokens: 800,
          output_tokens: 200,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.12,
        cost_source: "agent",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-complete (exit code 0)",
      iterations: 1,
      durationMs: 2_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("attempts: 2");
    expect(summary).not.toContain("claude (");
    expect(summary).toContain("codex (1 iteration(s))");
    expect(summary).toContain("1 quota attempt(s) under claude were excluded from usage totals.");
  });

  test("completed-spec duplicate row must not double-count usage", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 100,
        kind: "ok",
        exit_reason: "criteria-complete",
        usage_source: "agent",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 1,
        cost_source: "agent",
      },
      {
        ts: "2026-05-16T10:00:02.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 0,
        kind: "ok",
        exit_reason: "completed-spec",
        record_role: "run_terminal",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-complete (exit code 0)",
      iterations: 1,
      durationMs: 2_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("$1.00");
    expect(summary).toContain("100");
    expect(summary).toContain("50");
    expect(summary).toContain("claude (1 iteration(s))");
  });

  test("available cost plus unavailable usage does not emit mixed-sources note", () => {
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
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.01,
        cost_source: "agent",
      },
      {
        ts: "2026-05-16T10:00:02.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 2,
        duration_ms: 500,
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
      exitReason: "no-progress (exit code 4)",
      iterations: 2,
      durationMs: 2_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).not.toContain("mixes cost sources");
    expect(summary).toContain("no usage data (usage_source=unavailable)");
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
      exitReason: "no-progress (exit code 4)",
      iterations: 1,
      durationMs: 1_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("1 iteration(s) under cursor had no usage data (usage_source=unavailable).");
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
      exitReason: "no-progress (exit code 4)",
      iterations: 2,
      durationMs: 2_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("$0.50");
    expect(summary).toContain("1 iteration(s) had null cost and were excluded from total cost.");
  });

  test("shows computed dominance when telemetry records computed-only cost", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:spec",
        agent: "codex",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        configured_model: "gpt-5.3-codex",
        usage_source: "agent",
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 1.75,
        cost_source: "computed",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "no-progress (exit code 4)",
      iterations: 1,
      durationMs: 2_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("codex (gpt-5.3-codex) (1 iteration(s))");
    expect(summary).toContain("$1.75");
    expect(summary).toMatch(/\bcomputed\b/);
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
      exitReason: "no-progress (exit code 4)",
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
      exitReason: "no-progress (exit code 4)",
      iterations: 1,
      durationMs: 2_000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("$0.50");
    expect(summary).not.toContain("$9.99");
  });

  test("handles missing telemetry file gracefully", () => {
    expect(
      runSummary({
        telemetryPath: "/nonexistent/runs.jsonl",
        namespace: "p:x",
        startTs: "2026-05-17T01:02:03.000Z",
        exitReason: "error",
        iterations: 0,
        durationMs: 123,
        specPath: "spec/x/index.md",
      }),
    ).toContain("attempts: 0");
  });

  test("no-telemetry branch includes numeric exit code in reason", () => {
    const summary = runSummary({
      telemetryPath: "/nonexistent/runs.jsonl",
      namespace: "p:x",
      startTs: "2026-05-17T01:02:03.000Z",
      exitReason: "quota-exhausted (exit code 2)",
      iterations: 0,
      durationMs: 123,
      specPath: "spec/x/index.md",
    });

    expect(summary).toContain("exit reason: quota-exhausted (exit code 2)");
  });

  test("patch summary ignores plan-mode rows in the same JSONL file", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 100,
        kind: "ok",
        exit_reason: "criteria-progress",
        mode: "plan",
        plan_phase: "draft",
        usage_source: "agent",
        usage: {
          input_tokens: 99999,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 99,
        cost_source: "agent",
      },
      {
        ts: "2026-05-16T10:00:02.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 100,
        kind: "ok",
        exit_reason: "criteria-progress",
        mode: "patch",
        usage_source: "agent",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.02,
        cost_source: "agent",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-complete (exit code 0)",
      iterations: 1,
      durationMs: 2000,
      specPath: "spec/foo/index.md",
    });
    expect(summary).toContain("$0.02");
    expect(summary).not.toContain("$99");
    expect(summary).toContain("attempts: 1");
  });

  test("plan summary uses phase attempts and attempt labels", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "plan:k:n",
        agent: "codex",
        iteration: 1,
        duration_ms: 100,
        kind: "ok",
        exit_reason: "plan-draft-ok",
        mode: "plan",
        plan_phase: "draft",
        configured_model: "gpt-5.3-codex",
        usage_source: "agent",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.05,
        cost_source: "computed",
      },
    ]);
    const summary = planSummary({
      telemetryPath,
      namespace: "plan:k:n",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "complete",
      durationMs: 500,
      specPath: "spec/foo/index.md",
    });
    expect(summary).toContain("plan summary");
    expect(summary).toContain("phase attempts: 1");
    expect(summary).not.toContain("iterations:");
    expect(summary).toContain("(1 attempt(s))");
    expect(summary).not.toContain("iteration(s))");
  });

  test("plan summary ignores patch-mode rows", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "plan:k:n",
        agent: "claude",
        iteration: 1,
        duration_ms: 50,
        kind: "ok",
        exit_reason: "criteria-progress",
        mode: "patch",
        usage_source: "agent",
        usage: {
          input_tokens: 500,
          output_tokens: 500,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 9,
        cost_source: "agent",
      },
      {
        ts: "2026-05-16T10:00:02.000Z",
        namespace: "plan:k:n",
        agent: "codex",
        iteration: 1,
        duration_ms: 50,
        kind: "ok",
        exit_reason: "plan-draft-ok",
        mode: "plan",
        plan_phase: "draft",
        usage_source: "agent",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.02,
        cost_source: "agent",
      },
    ]);
    const summary = planSummary({
      telemetryPath,
      namespace: "plan:k:n",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "complete",
      durationMs: 100,
      specPath: "spec/foo/index.md",
    });
    expect(summary).toContain("$0.02");
    expect(summary).not.toContain("$9");
  });

  test("plan summary on failure does not cite runbook", () => {
    const summary = planSummary({
      telemetryPath: "/nonexistent/runs.jsonl",
      namespace: "plan:x",
      startTs: "2026-05-17T01:02:03.000Z",
      exitReason: "error",
      durationMs: 123,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("exit reason: error");
    expect(summary).not.toContain("see runbook:");
  });

  test("patch summary shows review attempts separately", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        mode: "patch",
        usage_source: "agent",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.05,
        cost_source: "agent",
      },
      {
        ts: "2026-05-16T10:00:02.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 500,
        kind: "ok",
        exit_reason: "ok",
        mode: "patch",
        patch_phase: "review",
        usage_source: "agent",
        usage: {
          input_tokens: 50,
          output_tokens: 25,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.02,
        cost_source: "agent",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-complete (exit code 0)",
      iterations: 1,
      durationMs: 2000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("iterations: 1");
    expect(summary).toContain("attempts: 1");
    expect(summary).toContain("review attempts: 1");
    expect(summary).toContain("$0.07");
  });

  test("patch summary excludes shrink from implementation attempts", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        mode: "patch",
        usage_source: "agent",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.05,
        cost_source: "agent",
      },
      {
        ts: "2026-05-16T10:00:02.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 500,
        kind: "ok",
        exit_reason: "ok",
        mode: "patch",
        patch_phase: "shrink",
        usage_source: "agent",
        usage: {
          input_tokens: 50,
          output_tokens: 25,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.02,
        cost_source: "agent",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-complete (exit code 0)",
      iterations: 1,
      durationMs: 2000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("iterations: 1");
    expect(summary).toContain("attempts: 1");
    expect(summary).not.toContain("shrink attempts");
    expect(summary).toContain("$0.07");
  });

  function patchSummaryNoTelemetry(exitReason: string): string {
    return runSummary({
      telemetryPath: "/nonexistent/runs.jsonl",
      namespace: "p:x",
      startTs: "2026-05-17T01:02:03.000Z",
      exitReason,
      iterations: 0,
      durationMs: 123,
      specPath: "spec/x/index.md",
    });
  }

  test.each([
    ["ready-gate-failed (exit code 10)", "Recovery by exit reason"],
    ["timeout (exit code 8)", "Resume-first guidance"],
    ["sigint (exit code 130)", "Resume-first guidance"],
    ["worktree-locked (exit code 9)", "Resume-first guidance"],
    ["error (exit code 1)", "Recovery by exit reason"],
    ["quota-exhausted", "Recovery by exit reason"],
    ["agent-error", "Recovery by exit reason"],
    ["max-iterations", "Recovery by exit reason"],
    ["dirty-worktree", "Recovery by exit reason"],
    ["blocked", "Recovery by exit reason"],
    ["review-incomplete", "Recovery by exit reason"],
    ["exit-99 (exit code 99)", "Recovery by exit reason"],
  ])("patch no-telemetry summary on %s cites runbook", (exitReason, section) => {
    const summary = patchSummaryNoTelemetry(exitReason);
    expect(summary).toContain(`exit reason: ${exitReason}`);
    expect(summary).toContain(`see runbook: OPERATOR_RUNBOOK.md › ${section}`);
  });

  test("patch no-telemetry summary on criteria-complete prints no runbook pointer", () => {
    const summary = patchSummaryNoTelemetry("criteria-complete (exit code 0)");
    expect(summary).toContain("exit reason: criteria-complete (exit code 0)");
    expect(summary).not.toContain("see runbook:");
  });

  test("patch summary with telemetry on error cites Recovery by exit reason", () => {
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
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.05,
        cost_source: "agent",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "no-progress (exit code 4)",
      iterations: 1,
      durationMs: 1000,
      specPath: "spec/foo/index.md",
    });

    expect(summary).toContain("exit reason: no-progress (exit code 4)");
    expect(summary).toContain("see runbook: OPERATOR_RUNBOOK.md › Recovery by exit reason");
  });
});

describe("promptSummary", () => {
  test("single-agent happy path with all fields", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "prompt:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "success",
        configured_model: "claude-haiku-4-5-20251001",
        mode: "prompt",
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
    const summary = promptSummary({
      telemetryPath,
      namespace: "prompt:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "success",
      durationMs: 83_000,
    });

    expect(summary).toContain("prompt summary");
    expect(summary).not.toContain("spec:");
    expect(summary).not.toContain("iterations:");
    expect(summary).not.toContain("phase attempts:");
    expect(summary).toContain("claude (claude-haiku-4-5-20251001) (1 attempt(s))");
    expect(summary).toContain("$0.42");
    expect(summary).toContain("cache_r");
    expect(summary).toContain("cache_w");
  });

  test("prompt summary on failure does not cite runbook", () => {
    const summary = promptSummary({
      telemetryPath: "/nonexistent/runs.jsonl",
      namespace: "prompt:x",
      startTs: "2026-05-17T01:02:03.000Z",
      exitReason: "error",
      durationMs: 123,
    });

    expect(summary).toContain("exit reason: error");
    expect(summary).not.toContain("see runbook:");
  });

  test("prompt summary ignores patch-mode rows", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "prompt:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        mode: "patch",
        usage_source: "agent",
        usage: {
          input_tokens: 500,
          output_tokens: 500,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 9,
        cost_source: "agent",
      },
      {
        ts: "2026-05-16T10:00:02.000Z",
        namespace: "prompt:spec",
        agent: "codex",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "success",
        mode: "prompt",
        usage_source: "agent",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.02,
        cost_source: "agent",
      },
    ]);
    const summary = promptSummary({
      telemetryPath,
      namespace: "prompt:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "success",
      durationMs: 2000,
    });
    expect(summary).toContain("$0.02");
    expect(summary).not.toContain("$9");
  });

  test("prompt summary ignores plan-mode rows", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "prompt:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 100,
        kind: "ok",
        exit_reason: "plan-draft-ok",
        mode: "plan",
        plan_phase: "draft",
        usage_source: "agent",
        usage: {
          input_tokens: 99999,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 99,
        cost_source: "agent",
      },
      {
        ts: "2026-05-16T10:00:02.000Z",
        namespace: "prompt:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 100,
        kind: "ok",
        exit_reason: "success",
        mode: "prompt",
        usage_source: "agent",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        cost_usd: 0.02,
        cost_source: "agent",
      },
    ]);
    const summary = promptSummary({
      telemetryPath,
      namespace: "prompt:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "success",
      durationMs: 2000,
    });
    expect(summary).toContain("$0.02");
    expect(summary).not.toContain("$99");
  });

  test("handles missing telemetry file gracefully", () => {
    expect(
      promptSummary({
        telemetryPath: "/nonexistent/runs.jsonl",
        namespace: "prompt:x",
        startTs: "2026-05-17T01:02:03.000Z",
        exitReason: "error",
        durationMs: 123,
      }),
    ).toContain("prompt summary");
  });

  test("no-telemetry branch includes numeric exit code in reason", () => {
    const summary = promptSummary({
      telemetryPath: "/nonexistent/runs.jsonl",
      namespace: "prompt:x",
      startTs: "2026-05-17T01:02:03.000Z",
      exitReason: "error (exit code 1)",
      durationMs: 123,
    });

    expect(summary).toContain("exit reason: error (exit code 1)");
    expect(summary).not.toContain("spec:");
    expect(summary).not.toContain("iterations:");
    expect(summary).not.toContain("phase attempts:");
  });
});

describe("recordMatchesMode three-way matching", () => {
  test("patch mode matches only patch records", () => {
    const patchRecord = { mode: "patch" };
    const promptRecord = { mode: "prompt" };
    const planRecord = { mode: "plan" };

    const telemetryPath = writeTelemetry([patchRecord, promptRecord, planRecord]);
    const runSummaryText = runSummary({
      telemetryPath,
      namespace: "test",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "test",
      iterations: 1,
      durationMs: 1000,
      specPath: "spec/test.md",
    });

    expect(runSummaryText).toContain("run summary");
  });

  test("prompt mode matches only prompt records", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "p:test",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "success",
        mode: "prompt",
        usage_source: "agent",
        usage: { input_tokens: 10, output_tokens: 5 },
        cost_usd: 0.01,
        cost_source: "agent",
      },
    ]);
    const summary = promptSummary({
      telemetryPath,
      namespace: "p:test",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "success",
      durationMs: 1000,
    });

    expect(summary).toContain("prompt summary");
    expect(summary).toContain("claude");
  });
});

describe("intake nudge", () => {
  function assertNudgeLastLineOnce(summary: string) {
    const lines = summary.trimEnd().split("\n");
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toMatch(/Hit a harness gap\?/);
    expect(lastLine).toContain(INTAKE_SUGGESTION_URL);
    const count = (summary.match(new RegExp(INTAKE_SUGGESTION_URL, "g")) || []).length;
    expect(count).toBe(1);
  }

  test("runSummary includes nudge once as last line", () => {
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
        cost_usd: 0.1,
        cost_source: "agent",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-progress",
      iterations: 1,
      durationMs: 1000,
      specPath: "spec/foo/index.md",
    });

    assertNudgeLastLineOnce(summary);
  });

  test("runSummary with no-telemetry includes nudge once as last line", () => {
    const summary = runSummary({
      telemetryPath: "/nonexistent/runs.jsonl",
      namespace: "p:x",
      startTs: "2026-05-17T01:02:03.000Z",
      exitReason: "error",
      iterations: 0,
      durationMs: 123,
      specPath: "spec/x/index.md",
    });

    assertNudgeLastLineOnce(summary);
  });

  test("planSummary includes nudge once as last line", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "plan:k:n",
        agent: "claude",
        iteration: 1,
        duration_ms: 100,
        kind: "ok",
        exit_reason: "plan-draft-ok",
        mode: "plan",
        plan_phase: "draft",
        usage_source: "agent",
        cost_usd: 0.05,
        cost_source: "agent",
      },
    ]);
    const summary = planSummary({
      telemetryPath,
      namespace: "plan:k:n",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "complete",
      durationMs: 500,
      specPath: "spec/foo/index.md",
    });

    assertNudgeLastLineOnce(summary);
  });

  test("planSummary with no-telemetry includes nudge once as last line", () => {
    const summary = planSummary({
      telemetryPath: null,
      namespace: "plan:k:n",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "error",
      durationMs: 500,
      specPath: "spec/foo/index.md",
    });

    assertNudgeLastLineOnce(summary);
  });

  test("promptSummary includes nudge once as last line", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T10:00:01.000Z",
        namespace: "prompt:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "success",
        mode: "prompt",
        usage_source: "agent",
        cost_usd: 0.1,
        cost_source: "agent",
      },
    ]);
    const summary = promptSummary({
      telemetryPath,
      namespace: "prompt:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "success",
      durationMs: 1000,
    });

    assertNudgeLastLineOnce(summary);
  });

  test("promptSummary with no-telemetry includes nudge once as last line", () => {
    const summary = promptSummary({
      telemetryPath: null,
      namespace: "prompt:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "error",
      durationMs: 500,
    });

    assertNudgeLastLineOnce(summary);
  });

  test("constant value matches URL in all doc files", () => {
    const docsToCheck = [
      { path: "README.md", name: "README.md" },
      { path: "AGENTS.md", name: "AGENTS.md" },
      { path: "CLAUDE.md", name: "CLAUDE.md" },
      { path: "v1/docs/operator-runbook.md", name: "operator-runbook.md" },
    ];

    for (const doc of docsToCheck) {
      const content = readFileSync(doc.path, "utf8");
      expect(content).toContain(INTAKE_SUGGESTION_URL);
    }
  });

  test("zero-records render includes nudge once as last line", () => {
    const telemetryPath = writeTelemetry([
      {
        ts: "2026-05-16T09:59:00.000Z",
        namespace: "p:spec",
        agent: "claude",
        iteration: 1,
        duration_ms: 1000,
        kind: "ok",
        exit_reason: "criteria-progress",
        usage_source: "agent",
        cost_usd: 0.1,
        cost_source: "agent",
      },
    ]);
    const summary = runSummary({
      telemetryPath,
      namespace: "p:spec",
      startTs: "2026-05-16T10:00:00.000Z",
      exitReason: "criteria-progress",
      iterations: 0,
      durationMs: 1000,
      specPath: "spec/foo/index.md",
    });

    assertNudgeLastLineOnce(summary);
  });

  test("help output contains no intake URL", async () => {
    const cliModule = await import("../src/cli.ts");
    const parsed = cliModule.parseArgs(["help"]);
    expect(parsed.kind).toBe("help");

    const outputLines: string[] = [];
    const result = cliModule.run(["help"], {
      io: {
        stdout: (s: string) => outputLines.push(s),
        stderr: () => {},
      },
    });
    expect(result).toBe(0);
    const output = outputLines.join("");
    expect(output).not.toContain(INTAKE_SUGGESTION_URL);
  });

  test("prompt command does not use summary functions", async () => {
    const cliModule = await import("../src/cli.ts");
    const parsed = cliModule.parseArgs(["prompt", "describe this file"]);
    expect(parsed.kind).toBe("prompt");
  });
});
