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

describe("invokeReviewRole", () => {
  test("classifies a role-timer abort as timeout with attribution", async () => {
    const boundMs = 5;
    const execution = await invokeReviewRole(
      { cwd: "/fake", roleTimeoutMs: boundMs },
      "critic",
      "inspect",
      [hungBinding("critic.hung", "claude", "opus")],
    );
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
});
