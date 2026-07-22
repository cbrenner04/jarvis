import { describe, expect, test } from "bun:test";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { invokeReviewRole, reviewRoleFailureKind } from "./review-role-invocation.ts";

function hungBinding(id: string, agent: string, model: string): InvocationBinding {
  return {
    id,
    metadata: { agent, model },
    invoke: ({ signal }) =>
      new Promise((resolve) =>
        signal?.addEventListener("abort", () => resolve({ kind: "error", exitCode: 1, stderr: "aborted" }), {
          once: true,
        }),
      ),
  };
}

function emittingBinding(id: string, agent: string, model: string, delayMs: number): InvocationBinding {
  return {
    id,
    metadata: { agent, model },
    invoke: async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      return { kind: "ok", stdout: "done", stderr: "" };
    },
  };
}

function stalledBinding(id: string, agent: string, model: string): InvocationBinding {
  return {
    id,
    metadata: { agent, model },
    invoke: async () => ({ kind: "stall", stderr: "no output" }),
  };
}

describe("invokeReviewRole", () => {
  test("classifies a role-timer abort as timeout with attribution", async () => {
    const boundMs = 5;
    const execution = await invokeReviewRole({ cwd: "/fake", roleTimeoutMs: boundMs }, "critic", "inspect", [
      hungBinding("critic.hung", "claude", "opus"),
    ]);
    expect(reviewRoleFailureKind(execution)).toBe("timeout");
    expect(execution.roleTimeout).toEqual({
      role: "critic",
      agent: "claude",
      model: "opus",
      boundMs,
    });
  });

  test("keeps caller-signal abort as error without timeout attribution", async () => {
    const caller = new AbortController();
    const hung = hungBinding("critic.hung", "claude", "opus");
    const invokePromise = invokeReviewRole(
      { cwd: "/fake", roleTimeoutMs: 5_000, signal: caller.signal },
      "critic",
      "inspect",
      [hung],
    );
    caller.abort();
    const execution = await invokePromise;
    expect(reviewRoleFailureKind(execution)).toBe("error");
    expect(execution.roleTimeout).toBeUndefined();
  });

  test("keeps a genuine agent error without timeout attribution", async () => {
    const binding: InvocationBinding = {
      id: "critic.fail",
      metadata: { agent: "claude", model: "opus" },
      invoke: async () => ({ kind: "error", exitCode: 1, stderr: "failed" }),
    };
    const execution = await invokeReviewRole({ cwd: "/fake", roleTimeoutMs: 5_000 }, "critic", "inspect", [binding]);
    expect(reviewRoleFailureKind(execution)).toBe("error");
    expect(execution.roleTimeout).toBeUndefined();
  });

  test("accepts a binding that keeps emitting output past the idle bound and runs to completion", async () => {
    const idleBoundMs = 30;
    const execution = await invokeReviewRole(
      { cwd: "/fake", roleTimeoutMs: 5_000, idleOutputMs: idleBoundMs },
      "critic",
      "inspect",
      [emittingBinding("critic.emit", "claude", "opus", 5)],
    );
    expect(reviewRoleFailureKind(execution)).toBeNull();
    expect(execution.final?.result.kind).toBe("ok");
    expect(execution.roleTimeout).toBeUndefined();
    expect(execution.idleTimeout).toBeUndefined();
  });

  test("classifies a binding that returns stall as idle timeout", async () => {
    const idleBoundMs = 50;
    const execution = await invokeReviewRole(
      { cwd: "/fake", roleTimeoutMs: 5_000, idleOutputMs: idleBoundMs },
      "critic",
      "inspect",
      [stalledBinding("critic.stalled", "claude", "opus")],
    );
    expect(reviewRoleFailureKind(execution)).toBe("stall");
    expect(execution.final?.result.kind).toBe("stall");
    expect(execution.idleTimeout).toEqual({
      role: "critic",
      agent: "claude",
      model: "opus",
      boundMs: idleBoundMs,
    });
    expect(execution.roleTimeout).toBeUndefined();
  });

  test("distinguishes idle stall from wall-clock timeout", async () => {
    const idleBoundMs = 5_000;
    const roleTimeoutMs = 50;
    const execution = await invokeReviewRole(
      { cwd: "/fake", roleTimeoutMs, idleOutputMs: idleBoundMs },
      "critic",
      "inspect",
      [hungBinding("critic.hung", "claude", "opus")],
    );
    expect(reviewRoleFailureKind(execution)).toBe("timeout");
    expect(execution.roleTimeout).toBeDefined();
    expect(execution.idleTimeout).toBeUndefined();
  });

  function capturingBinding(capture: (idleOutputMs: number | undefined) => void): InvocationBinding {
    return {
      id: "test.capture",
      metadata: { agent: "claude", model: "opus" },
      invoke: async ({ idleOutputMs }) => {
        capture(idleOutputMs);
        return { kind: "ok", stdout: "done", stderr: "" };
      },
    };
  }

  test("passes idleOutputMs to executeWithQuotaFallback invocation", async () => {
    const idleBoundMs = 100;
    let capturedIdleOutputMs: number | undefined;
    await invokeReviewRole({ cwd: "/fake", roleTimeoutMs: 5_000, idleOutputMs: idleBoundMs }, "critic", "inspect", [
      capturingBinding((v) => (capturedIdleOutputMs = v)),
    ]);
    expect(capturedIdleOutputMs).toBe(idleBoundMs);
  });

  test("receives default idle budget when not specified", async () => {
    let capturedIdleOutputMs: number | undefined;
    await invokeReviewRole({ cwd: "/fake", roleTimeoutMs: 5_000 }, "critic", "inspect", [
      capturingBinding((v) => (capturedIdleOutputMs = v)),
    ]);
    expect(capturedIdleOutputMs).toBe(90_000);
  });
});
