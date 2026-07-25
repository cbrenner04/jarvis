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
      exhaustedRoleTimeout: true,
      bindingAttempts: [{ bindingId: "critic.hung", resultKind: "timeout", agent: "claude", model: "opus" }],
    });
  });

  test("names every rung in bindingAttempts when a two-rung list exhausts on timeout", async () => {
    const boundMs = 5;
    const first = hungBinding("critic.rung1", "claude", "opus");
    const second = hungBinding("critic.rung2", "claude", "sonnet");
    const execution = await invokeReviewRole({ cwd: "/fake", roleTimeoutMs: boundMs }, "critic", "inspect", [
      first,
      second,
    ]);
    expect(reviewRoleFailureKind(execution)).toBe("timeout");
    expect(execution.roleTimeout?.exhaustedRoleTimeout).toBe(true);
    expect(execution.roleTimeout?.bindingAttempts).toEqual([
      { bindingId: "critic.rung1", resultKind: "timeout", agent: "claude", model: "opus" },
      { bindingId: "critic.rung2", resultKind: "timeout", agent: "claude", model: "sonnet" },
    ]);
  });

  test("names the single rung in bindingAttempts when a single-binding list exhausts on timeout", async () => {
    const boundMs = 5;
    const execution = await invokeReviewRole({ cwd: "/fake", roleTimeoutMs: boundMs }, "critic", "inspect", [
      hungBinding("critic.solo", "claude", "opus"),
    ]);
    expect(reviewRoleFailureKind(execution)).toBe("timeout");
    expect(execution.roleTimeout?.exhaustedRoleTimeout).toBe(true);
    expect(execution.roleTimeout?.bindingAttempts).toEqual([
      { bindingId: "critic.solo", resultKind: "timeout", agent: "claude", model: "opus" },
    ]);
  });

  test("keeps caller-signal abort as error without timeout attribution and does not advance", async () => {
    const caller = new AbortController();
    const hung = hungBinding("critic.hung", "claude", "opus");
    let nextInvoked = 0;
    const next: InvocationBinding = {
      id: "critic.next",
      metadata: { agent: "claude", model: "sonnet" },
      invoke: async () => {
        nextInvoked += 1;
        return { kind: "ok", stdout: "done", stderr: "" };
      },
    };
    const invokePromise = invokeReviewRole(
      { cwd: "/fake", roleTimeoutMs: 5_000, signal: caller.signal },
      "critic",
      "inspect",
      [hung, next],
    );
    caller.abort();
    const execution = await invokePromise;
    expect(reviewRoleFailureKind(execution)).toBe("error");
    expect(execution.roleTimeout).toBeUndefined();
    expect(nextInvoked).toBe(0);
    expect(execution.attempts).toHaveLength(1);
  });

  test("keeps mixed quota-then-timeout exhaustion as non-exhausted with real resultKind per rung", async () => {
    const boundMs = 20;
    const quotaBinding: InvocationBinding = {
      id: "critic.quota",
      metadata: { agent: "claude", model: "opus" },
      invoke: async () => ({ kind: "quota", stderr: "quota exceeded" }),
    };
    const hungRung2 = hungBinding("critic.rung2", "claude", "sonnet");
    const execution = await invokeReviewRole({ cwd: "/fake", roleTimeoutMs: boundMs }, "critic", "inspect", [
      quotaBinding,
      hungRung2,
    ]);
    expect(reviewRoleFailureKind(execution)).toBe("timeout");
    expect(execution.roleTimeout?.exhaustedRoleTimeout).toBe(false);
    expect(execution.roleTimeout?.bindingAttempts).toEqual([
      { bindingId: "critic.quota", resultKind: "quota", agent: "claude", model: "opus" },
      { bindingId: "critic.rung2", resultKind: "timeout", agent: "claude", model: "sonnet" },
    ]);
  });

  test("lets a late success win over a concurrently-firing timer without escalating", async () => {
    const boundMs = 5;
    let nextInvoked = 0;
    const raceBinding = emittingBinding("critic.race", "claude", "opus", boundMs * 4);
    const next: InvocationBinding = {
      id: "critic.next",
      metadata: { agent: "claude", model: "sonnet" },
      invoke: async () => {
        nextInvoked += 1;
        return { kind: "ok", stdout: "done", stderr: "" };
      },
    };
    const execution = await invokeReviewRole({ cwd: "/fake", roleTimeoutMs: boundMs }, "critic", "inspect", [
      raceBinding,
      next,
    ]);
    expect(reviewRoleFailureKind(execution)).toBeNull();
    expect(execution.final?.result.kind).toBe("ok");
    expect(execution.roleTimeout).toBeUndefined();
    expect(nextInvoked).toBe(0);
    expect(execution.attempts).toHaveLength(1);
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

  test("escalates through a second binding when the first times out", async () => {
    const boundMs = 5;
    const first = hungBinding("critic.hung", "claude", "opus");
    const second = emittingBinding("critic.emit", "claude", "sonnet", 1);
    const execution = await invokeReviewRole({ cwd: "/fake", roleTimeoutMs: boundMs }, "critic", "inspect", [
      first,
      second,
    ]);
    expect(reviewRoleFailureKind(execution)).toBeNull();
    expect(execution.final?.result.kind).toBe("ok");
    expect(execution.attempts).toHaveLength(2);
    expect(execution.attempts[0]?.binding).toBe(first);
    expect(execution.attempts[1]?.binding).toBe(second);
    expect(execution.roleTimeout).toBeUndefined();
  });

  test("carries quota advancement across a single invokeReviewRole call without a timeout", async () => {
    let secondInvoked = 0;
    const quotaBinding: InvocationBinding = {
      id: "critic.quota",
      metadata: { agent: "claude", model: "opus" },
      invoke: async () => ({ kind: "quota", stderr: "quota exceeded" }),
    };
    const okBinding: InvocationBinding = {
      id: "critic.ok",
      metadata: { agent: "claude", model: "sonnet" },
      invoke: async () => {
        secondInvoked += 1;
        return { kind: "ok", stdout: "done", stderr: "" };
      },
    };
    const execution = await invokeReviewRole({ cwd: "/fake", roleTimeoutMs: 5_000 }, "critic", "inspect", [
      quotaBinding,
      okBinding,
    ]);
    expect(reviewRoleFailureKind(execution)).toBeNull();
    expect(execution.final?.result.kind).toBe("ok");
    expect(secondInvoked).toBe(1);
    expect(execution.attempts).toHaveLength(2);
  });

  test("stops after success on the first binding without invoking the second", async () => {
    let secondInvoked = 0;
    const okBinding: InvocationBinding = {
      id: "critic.ok",
      metadata: { agent: "claude", model: "opus" },
      invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }),
    };
    const unreachedBinding: InvocationBinding = {
      id: "critic.unreached",
      metadata: { agent: "claude", model: "sonnet" },
      invoke: async () => {
        secondInvoked += 1;
        return { kind: "ok", stdout: "done", stderr: "" };
      },
    };
    const execution = await invokeReviewRole({ cwd: "/fake", roleTimeoutMs: 5_000 }, "critic", "inspect", [
      okBinding,
      unreachedBinding,
    ]);
    expect(reviewRoleFailureKind(execution)).toBeNull();
    expect(secondInvoked).toBe(0);
    expect(execution.attempts).toHaveLength(1);
  });
});
