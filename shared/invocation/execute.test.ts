import { describe, expect, test } from "bun:test";
import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationCompletedRecord,
  type InvocationResult,
  type InvocationTelemetrySink,
} from "./execute.ts";

function binding(id: string, result: InvocationResult): InvocationBinding {
  return {
    id,
    metadata: {
      agent: `${id}-agent`,
      model: `${id}-model`,
    },
    invoke: async () => result,
  };
}

function telemetryArgs(sink: InvocationTelemetrySink) {
  return {
    sink,
    operatorSessionId: "session-1",
    runId: "run-1",
    attemptId: "attempt-1",
    project: "demo",
    workflow: "write",
    stepId: "step-1",
    role: "implement",
    worktreePath: "/tmp/worktree",
    branch: "demo-branch",
    specRef: "HEAD",
    invocationIds: ["inv-1", "inv-2", "inv-3"],
  } as const;
}

describe("shared invocation fallback", () => {
  test("advances only on quota and preserves binding order", async () => {
    const calls: string[] = [];
    const bindings: InvocationBinding[] = [
      {
        id: "first",
        invoke: async () => {
          calls.push("first");
          return { kind: "quota", stderr: "quota" };
        },
      },
      {
        id: "second",
        invoke: async () => {
          calls.push("second");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      bindings,
    });

    expect(calls).toEqual(["first", "second"]);
    expect(result.final?.binding.id).toBe("second");
    expect(result.final?.result.kind).toBe("ok");
  });

  test("stops immediately on non-quota failure", async () => {
    const calls: string[] = [];
    const bindings: InvocationBinding[] = [
      {
        id: "first",
        invoke: async () => {
          calls.push("first");
          return { kind: "error", exitCode: 1, stderr: "hard" };
        },
      },
      {
        id: "second",
        invoke: async () => {
          calls.push("second");
          return { kind: "ok", stdout: "should-not-run", stderr: "" };
        },
      },
    ];

    const result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      bindings,
    });

    expect(calls).toEqual(["first"]);
    expect(result.final?.binding.id).toBe("first");
    expect(result.final?.result.kind).toBe("error");
  });

  test("returns null final when no bindings are configured", async () => {
    const result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      bindings: [] as InvocationBinding<InvocationResult>[],
    });

    expect(result.final).toBeNull();
    expect(result.attempts).toHaveLength(0);
    expect(result.telemetryFailures).toEqual([]);
  });

  test("appends one invocation_completed row per binding attempt in order", async () => {
    const rows: InvocationCompletedRecord[] = [];
    const result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      bindings: [
        binding("first", { kind: "quota", stderr: "quota" }),
        binding("second", { kind: "ok", stdout: "done", stderr: "" }),
      ],
      telemetry: telemetryArgs({
        append(record) {
          rows.push(record);
        },
      }),
    });

    expect(result.final?.invocationId).toBe("inv-2");
    expect(rows.map((row) => row.invocation_id)).toEqual(["inv-1", "inv-2"]);
    expect(rows.map((row) => row.binding_index)).toEqual([0, 1]);
    expect(rows.map((row) => row.exit_kind)).toEqual(["quota", "ok"]);
    expect(rows.every((row) => row.run_id === "run-1" && row.attempt_id === "attempt-1")).toBe(true);
    expect(rows[0]?.usage).toEqual({
      input_tokens: null,
      output_tokens: null,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    });
    expect(rows[0]?.cost_usd).toBeNull();
    expect(rows[0]?.cost_source).toBe("unavailable");
    expect(result.telemetryFailures).toEqual([]);
  });

  test("telemetry is a no-op when no context is provided", async () => {
    const result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      bindings: [binding("only", { kind: "ok", stdout: "done", stderr: "" })],
    });

    expect(result.attempts[0]?.invocationId).toBeUndefined();
    expect(result.telemetryFailures).toEqual([]);
  });

  test("telemetry append failure is surfaced without changing fallback outcome", async () => {
    const result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      bindings: [
        binding("first", { kind: "quota", stderr: "quota" }),
        binding("second", { kind: "ok", stdout: "done", stderr: "" }),
      ],
      telemetry: telemetryArgs({
        append() {
          throw new Error("disk full");
        },
      }),
    });

    expect(result.final?.binding.id).toBe("second");
    expect(result.final?.result.kind).toBe("ok");
    expect(result.telemetryFailures).toEqual([
      { invocationId: "inv-1", bindingId: "first", message: "disk full" },
      { invocationId: "inv-2", bindingId: "second", message: "disk full" },
    ]);
  });

  test("quota exhaustion still appends one row per attempted binding", async () => {
    const rows: InvocationCompletedRecord[] = [];
    const result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      bindings: [
        binding("first", { kind: "quota", stderr: "quota" }),
        binding("second", { kind: "quota", stderr: "quota" }),
      ],
      telemetry: telemetryArgs({
        append(record) {
          rows.push(record);
        },
      }),
    });

    expect(result.final?.result.kind).toBe("quota");
    expect(rows.map((row) => row.binding_id)).toEqual(["first", "second"]);
    expect(rows.map((row) => row.invocation_id)).toEqual(["inv-1", "inv-2"]);
  });
});
