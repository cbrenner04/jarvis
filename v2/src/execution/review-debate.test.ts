import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationBinding, InvocationCompletedRecord } from "../../../shared/invocation/execute.ts";
import { executeReviewDebate, type ReviewDebateInput } from "./review-debate.ts";

function okBinding(id: string, stdout: string, calls: string[]): InvocationBinding {
  return {
    id,
    metadata: { agent: `agent-${id}`, model: `model-${id}` },
    invoke: async () => {
      calls.push(id);
      return { kind: "ok", stdout, stderr: "" };
    },
  };
}

function quotaBinding(id: string, calls: string[]): InvocationBinding {
  return {
    id,
    metadata: { agent: `agent-${id}`, model: `model-${id}` },
    invoke: async () => {
      calls.push(id);
      return { kind: "quota", stderr: "quota" };
    },
  };
}

function baseInput(opts: {
  calls: string[];
  verdictPath: string;
  adjudicatorVerdict: string;
  maxCycles: number;
  overrides?: Partial<ReviewDebateInput["bindings"]>;
}): ReviewDebateInput {
  const { calls } = opts;
  return {
    cwd: "/fake",
    prompts: { adversary: "find issues", advocate: "argue merits", adjudicator: "settle it" },
    bindings: {
      adversary: [okBinding("adversary.1", "adversary-output", calls)],
      advocate: [okBinding("advocate.1", "advocate-output", calls)],
      adjudicator: [okBinding("adjudicator.1", opts.adjudicatorVerdict, calls)],
      actuator: [okBinding("actuator.1", "actuator-output", calls)],
      ...opts.overrides,
    },
    verdictPath: opts.verdictPath,
    maxCycles: opts.maxCycles,
  };
}

describe("executeReviewDebate", () => {
  test("runs full debate order per cycle", async () => {
    const calls: string[] = [];
    const verdictPath = join(mkdtempSync(join(tmpdir(), "review-debate-")), "verdict.md");
    const result = await executeReviewDebate(
      baseInput({ calls, verdictPath, adjudicatorVerdict: "apply this fix", maxCycles: 1 }),
    );

    expect(calls).toEqual(["adversary.1", "advocate.1", "adjudicator.1", "actuator.1"]);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toMatchObject({ kind: "completed", verdict: "apply this fix", actuatorRan: true });
    rmSync(verdictPath, { force: true });
  });

  test("overwrites verdict file each cycle", async () => {
    const calls: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "review-debate-"));
    const verdictPath = join(dir, "verdict.md");
    let cycleIndex = 0;
    const adjudicatorInvoke = async () => {
      cycleIndex += 1;
      return { kind: "ok" as const, stdout: `verdict-${cycleIndex}`, stderr: "" };
    };

    const input = baseInput({ calls, verdictPath, adjudicatorVerdict: "unused", maxCycles: 2 });
    input.bindings.adjudicator = [
      { id: "adjudicator.1", metadata: { agent: "a", model: "m" }, invoke: adjudicatorInvoke },
    ];

    const result = await executeReviewDebate(input);

    expect(result.cycles).toHaveLength(2);
    expect(readFileSync(verdictPath, "utf8")).toBe("verdict-2");
    rmSync(dir, { recursive: true, force: true });
  });

  test("empty verdict skips the actuator and stops the loop", async () => {
    const calls: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "review-debate-"));
    const verdictPath = join(dir, "verdict.md");
    const input = baseInput({ calls, verdictPath, adjudicatorVerdict: "   ", maxCycles: 3 });

    const result = await executeReviewDebate(input);

    expect(calls).toEqual(["adversary.1", "advocate.1", "adjudicator.1"]);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toMatchObject({ kind: "completed", verdict: "   ", actuatorRan: false });
    rmSync(dir, { recursive: true, force: true });
  });

  test("non-empty verdict invokes the actuator", async () => {
    const calls: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "review-debate-"));
    const verdictPath = join(dir, "verdict.md");
    const input = baseInput({ calls, verdictPath, adjudicatorVerdict: "fix the bug", maxCycles: 1 });

    const result = await executeReviewDebate(input);

    expect(calls).toContain("actuator.1");
    expect(result.cycles[0]).toMatchObject({ actuatorRan: true });
    rmSync(dir, { recursive: true, force: true });
  });

  test("stops after maxCycles", async () => {
    const calls: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "review-debate-"));
    const verdictPath = join(dir, "verdict.md");
    const input = baseInput({ calls, verdictPath, adjudicatorVerdict: "fix it", maxCycles: 3 });

    const result = await executeReviewDebate(input);

    expect(result.cycles).toHaveLength(3);
    expect(calls.filter((c) => c === "adjudicator.1")).toHaveLength(3);
    rmSync(dir, { recursive: true, force: true });
  });

  test("maxCycles <= 0 runs zero cycles", async () => {
    const calls: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "review-debate-"));
    const verdictPath = join(dir, "verdict.md");
    const input = baseInput({ calls, verdictPath, adjudicatorVerdict: "fix it", maxCycles: 0 });

    const result = await executeReviewDebate(input);

    expect(result.cycles).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(existsSync(verdictPath)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("early empty verdict stops before maxCycles", async () => {
    const calls: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "review-debate-"));
    const verdictPath = join(dir, "verdict.md");
    let cycleIndex = 0;
    const input = baseInput({ calls, verdictPath, adjudicatorVerdict: "unused", maxCycles: 4 });
    input.bindings.adjudicator = [
      {
        id: "adjudicator.1",
        metadata: { agent: "a", model: "m" },
        invoke: async () => {
          cycleIndex += 1;
          calls.push("adjudicator.1");
          return { kind: "ok" as const, stdout: cycleIndex === 1 ? "" : "later verdict", stderr: "" };
        },
      },
    ];

    const result = await executeReviewDebate(input);

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toMatchObject({ kind: "completed", verdict: "", actuatorRan: false });
    expect(calls).toEqual(["adversary.1", "advocate.1", "adjudicator.1"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a role's final:null aborts the cycle immediately as a failure outcome", async () => {
    const calls: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "review-debate-"));
    const verdictPath = join(dir, "verdict.md");
    const input = baseInput({ calls, verdictPath, adjudicatorVerdict: "fix it", maxCycles: 2 });
    // no bindings configured for advocate: executeWithQuotaFallback resolves final: null
    input.bindings.advocate = [];

    const result = await executeReviewDebate(input);

    expect(calls).toEqual(["adversary.1"]);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toMatchObject({
      kind: "role_failed",
      failedRole: "advocate",
      failureKind: "no_binding",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  test("a quota-exhausted role also aborts the cycle as a failure outcome", async () => {
    const calls: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "review-debate-"));
    const verdictPath = join(dir, "verdict.md");
    const input = baseInput({ calls, verdictPath, adjudicatorVerdict: "fix it", maxCycles: 1 });
    input.bindings.adjudicator = [quotaBinding("adjudicator.1", calls)];

    const result = await executeReviewDebate(input);

    expect(calls).toEqual(["adversary.1", "advocate.1", "adjudicator.1"]);
    expect(result.cycles[0]).toMatchObject({ kind: "role_failed", failedRole: "adjudicator", failureKind: "quota" });
    rmSync(dir, { recursive: true, force: true });
  });

  test("onRoleStart fires with each role in order, across a second cycle", async () => {
    const calls: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "review-debate-"));
    const verdictPath = join(dir, "verdict.md");
    const input = baseInput({ calls, verdictPath, adjudicatorVerdict: "fix it", maxCycles: 2 });
    const roleStarts: string[] = [];
    input.onRoleStart = (role) => roleStarts.push(role);

    const result = await executeReviewDebate(input);

    expect(result.cycles).toHaveLength(2);
    expect(roleStarts).toEqual([
      "adversary",
      "advocate",
      "adjudicator",
      "actuator",
      "adversary",
      "advocate",
      "adjudicator",
      "actuator",
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("emits one invocation_completed row per binding subprocess with role set to the debate role", async () => {
    const calls: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), "review-debate-"));
    const verdictPath = join(dir, "verdict.md");
    const rows: InvocationCompletedRecord[] = [];

    const input = baseInput({ calls, verdictPath, adjudicatorVerdict: "fix it", maxCycles: 1 });
    input.telemetry = {
      sink: {
        append: (record) => {
          rows.push(record);
        },
      },
      operatorSessionId: "session-1",
      runId: "run-1",
      attemptId: "attempt-1",
      project: "demo",
      workflow: "review-debate",
      stepId: "step-1",
      worktreePath: "/fake",
      branch: "branch-1",
      specRef: "HEAD",
    };

    await executeReviewDebate(input);

    expect(rows).toHaveLength(4);
    const roles = rows.map((r) => r.role);
    expect(roles).toEqual(["adversary", "advocate", "adjudicator", "actuator"]);
    const bindingIds = rows.map((r) => r.binding_id);
    expect(bindingIds).toEqual(["adversary.1", "advocate.1", "adjudicator.1", "actuator.1"]);
    const invocationIds = new Set(rows.map((r) => r.invocation_id));
    expect(invocationIds.size).toBe(4);
    for (const row of rows) {
      expect(row.run_id).toBe("run-1");
      expect(row.attempt_id).toBe("attempt-1");
    }
    rmSync(dir, { recursive: true, force: true });
  });
});

test("a hung adversary is aborted at the role wall clock", async () => {
  const hung: InvocationBinding = {
    id: "adversary.hung",
    metadata: { agent: "adversary", model: "hung" },
    invoke: ({ signal }) =>
      new Promise((resolve) =>
        signal?.addEventListener("abort", () => resolve({ kind: "error", exitCode: 1, stderr: "aborted" }), {
          once: true,
        }),
      ),
  };
  const calls: string[] = [];
  const result = await executeReviewDebate({
    ...baseInput({
      calls,
      verdictPath: join(mkdtempSync(join(tmpdir(), "review-debate-")), "verdict.md"),
      adjudicatorVerdict: "verdict",
      maxCycles: 1,
      overrides: { adversary: [hung] },
    }),
    roleTimeoutMs: 5,
  });
  expect(result).toMatchObject({ cycles: [{ kind: "role_failed", failedRole: "adversary" }] });
});

test("stamps pass metadata onto serializable object profile contexts", async () => {
  const contexts: unknown[] = [];
  const calls: string[] = [];
  const verdictPath = join(mkdtempSync(join(tmpdir(), "review-debate-")), "verdict.md");
  const input = baseInput({ calls, verdictPath, adjudicatorVerdict: "apply this fix", maxCycles: 2 });
  const result = await executeReviewDebate({
    ...input,
    profile: {
      domain: "implement",
      promptIds: { critic: "patch.prompt.review.critic", actuator: "patch.prompt.review-actuator" },
      render: {
        critic: () => "inspect",
        actuator: () => "apply",
        debateRole: (role: string, context: unknown) => {
          if (role === "adversary") contexts.push(context);
          return role;
        },
      },
      verdict: { source: "adjudicator", empty: "stop", persist: "stdout" },
      boundaries: {
        light: { critic: "read-only", actuator: "write" },
        debate: { critic: "read-only", actuator: "write" },
      },
    },
    profileContext: { specPath: "index.md", totalPasses: 2 },
  });
  expect(result.cycles).toHaveLength(2);
  expect(contexts).toEqual([
    { specPath: "index.md", totalPasses: 2, passNumber: 1 },
    { specPath: "index.md", totalPasses: 2, passNumber: 2, priorCycleVerdict: "apply this fix" },
  ]);
});
