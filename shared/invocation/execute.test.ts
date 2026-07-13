import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationCompletedRecord,
  type InvocationResult,
  type InvocationTelemetrySink,
} from "./execute.ts";
import { openSessionLog, type SessionLog, type SessionLogTag } from "./session-log.ts";

let scratchDir: string;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "jarvis-execute-session-log-"));
});

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

function fakeSessionLog(): { log: SessionLog; lines: { tag: SessionLogTag; text: string }[] } {
  const lines: { tag: SessionLogTag; text: string }[] = [];
  return {
    lines,
    log: {
      append(tag, text) {
        if (text === "") return;
        lines.push({ tag, text });
      },
      close() {},
    },
  };
}

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

  test("writes harness and outbound before invoke, then inbound_stdout/inbound_stderr on ok", async () => {
    const { log, lines } = fakeSessionLog();
    const seenAtInvoke: { tag: SessionLogTag; text: string }[] = [];

    await executeWithQuotaFallback({
      prompt: "the prompt",
      cwd: "/tmp",
      sessionLog: log,
      bindings: [
        {
          id: "only",
          metadata: { agent: "claude", model: "sonnet" },
          invoke: async () => {
            seenAtInvoke.push(...lines);
            return { kind: "ok", stdout: "out-line", stderr: "err-line" };
          },
        },
      ],
    });

    expect(seenAtInvoke.map((l) => l.tag)).toEqual(["harness", "outbound"]);
    expect(
      seenAtInvoke.some((l) => l.text.includes("only") && l.text.includes("claude") && l.text.includes("sonnet")),
    ).toBe(true);
    expect(seenAtInvoke.some((l) => l.text === "the prompt")).toBe(true);
    expect(lines.filter((l) => l.tag === "inbound_stdout").map((l) => l.text)).toEqual(["out-line"]);
    expect(lines.filter((l) => l.tag === "inbound_stderr").map((l) => l.text)).toEqual(["err-line"]);
  });

  test("writes non-ok stderr under inbound_stderr and logs each fallback binding attempt", async () => {
    const { log, lines } = fakeSessionLog();

    await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      sessionLog: log,
      bindings: [
        binding("first", { kind: "quota", stderr: "quota-diagnostic" }),
        binding("second", { kind: "ok", stdout: "done", stderr: "" }),
      ],
    });

    expect(lines.filter((l) => l.tag === "harness")).toHaveLength(2);
    expect(lines.filter((l) => l.tag === "outbound")).toHaveLength(2);
    expect(lines.filter((l) => l.tag === "inbound_stderr").map((l) => l.text)).toEqual(["quota-diagnostic"]);
  });

  test("a throwing session log does not fail the invocation", async () => {
    const throwingLog: SessionLog = {
      append() {
        throw new Error("disk full");
      },
      close() {},
    };

    const result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      sessionLog: throwingLog,
      bindings: [binding("only", { kind: "ok", stdout: "done", stderr: "" })],
    });

    expect(result.final?.result.kind).toBe("ok");
  });

  test("an unwritable sessions dir does not change the invocation result", async () => {
    const blockerPath = join(scratchDir, "blocker");
    writeFileSync(blockerPath, "not a directory");
    const sessionsDir = join(blockerPath, "sessions");
    const log = openSessionLog("write", "unwritable", { sessionsDir });

    const result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      sessionLog: log,
      bindings: [binding("only", { kind: "ok", stdout: "done", stderr: "" })],
    });

    expect(result.final?.result.kind).toBe("ok");
    log.close();
  });

  test("ok result with usage and cost records those exact values and sources", async () => {
    const rows: InvocationCompletedRecord[] = [];
    const _result = await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      bindings: [
        {
          id: "claude-binding",
          metadata: { agent: "claude", model: "sonnet" },
          invoke: async () => ({
            kind: "ok" as const,
            stdout: "response",
            stderr: "",
            usage_source: "agent" as const,
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 25000,
            },
            cost_usd: 0.15,
            cost_source: "agent" as const,
          }),
        },
      ],
      telemetry: telemetryArgs({
        append(record) {
          rows.push(record);
        },
      }),
    });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 25000,
    });
    expect(row?.usage_source).toBe("agent");
    expect(row?.cost_usd).toBe(0.15);
    expect(row?.cost_source).toBe("agent");
  });

  test("model_config and error results write stderr under inbound_stderr", async () => {
    const modelLog = fakeSessionLog();
    await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      sessionLog: modelLog.log,
      bindings: [binding("model", { kind: "model_config", stderr: "bad model" })],
    });
    expect(modelLog.lines.filter((l) => l.tag === "inbound_stderr").map((l) => l.text)).toEqual(["bad model"]);

    const errorLog = fakeSessionLog();
    await executeWithQuotaFallback({
      prompt: "p",
      cwd: "/tmp",
      sessionLog: errorLog.log,
      bindings: [binding("err", { kind: "error", exitCode: 1, stderr: "spawn failed" })],
    });
    expect(errorLog.lines.filter((l) => l.tag === "inbound_stderr").map((l) => l.text)).toEqual(["spawn failed"]);
  });
});
