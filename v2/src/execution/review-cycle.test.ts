import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { executeReviewCycle, type ReviewCycleInput } from "./review-cycle.ts";

function binding(id: string, stdout: string, calls: string[], kind: "ok" | "quota" = "ok"): InvocationBinding {
  return {
    id,
    metadata: { agent: id, model: id },
    invoke: async ({ prompt }) => {
      calls.push(`${id}:${prompt}`);
      return kind === "quota" ? { kind: "quota" as const, stderr: "quota" } : { kind: "ok" as const, stdout, stderr: "" };
    },
  };
}

function input(path: string, calls: string[], verdict = "fix it", maxCycles = 1): ReviewCycleInput {
  return {
    cwd: "/fake",
    prompt: "inspect",
    bindings: { critic: [binding("critic.1", verdict, calls)], actuator: [binding("actuator.1", "done", calls)] },
    verdictPath: path,
    maxCycles,
  };
}

function dir(): string {
  return mkdtempSync(join(tmpdir(), "review-cycle-"));
}

describe("executeReviewCycle", () => {
  test("hands the verbatim non-empty verdict to the actuator and persists it", async () => {
    const calls: string[] = [];
    const path = join(dir(), "verdict.md");
    const result = await executeReviewCycle(input(path, calls, " fix it\n"));
    expect(calls).toEqual(["critic.1:inspect", "actuator.1: fix it\n"]);
    expect(readFileSync(path, "utf8")).toBe(" fix it\n");
    expect(result).toMatchObject({ kind: "complete", cycles: [{ actuatorRan: true }] });
  });

  test("stops on an empty verdict", async () => {
    const calls: string[] = [];
    const path = join(dir(), "verdict.md");
    const result = await executeReviewCycle(input(path, calls, "  \n", 3));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ kind: "complete", cycles: [{ verdict: "  \n", actuatorRan: false }] });
  });

  test("validates bounds before side effects", async () => {
    const calls: string[] = [];
    const path = join(dir(), "verdict.md");
    for (const maxCycles of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(executeReviewCycle(input(path, calls, "fix", maxCycles))).rejects.toBeInstanceOf(RangeError);
    }
    await expect(executeReviewCycle(input(path, calls, "fix", 0))).resolves.toEqual({ kind: "complete", cycles: [] });
    expect(calls).toHaveLength(0);
    expect(existsSync(path)).toBe(false);
  });

  test("invalidates stale verdict before a critic failure", async () => {
    const calls: string[] = [];
    const path = join(dir(), "verdict.md");
    writeFileSync(path, "stale", "utf8");
    const args = input(path, calls);
    args.bindings.critic = [
      { id: "critic.1", invoke: async () => ({ kind: "error" as const, exitCode: 1, stderr: "failed" }) },
    ];
    const result = await executeReviewCycle(args);
    expect(readFileSync(path, "utf8")).toBe("");
    expect(result).toMatchObject({ kind: "invocation_failure", failedRole: "critic", cycles: [{ failedRole: "critic" }] });
  });

  test("maps critic abort to its terminal error and counts the cycle", async () => {
    const calls: string[] = [];
    const path = join(dir(), "verdict.md");
    const args = input(path, calls, "fix", 2);
    args.bindings.critic = [{ id: "critic.1", invoke: async () => ({ kind: "error" as const, exitCode: -1, stderr: "aborted" }) }];
    const result = await executeReviewCycle(args);
    expect(result).toMatchObject({ kind: "invocation_failure", failedRole: "critic", failureKind: "error" });
    expect(result.cycles).toHaveLength(1);
  });

  test("reports a verdict write failure without running the actuator", async () => {
    const calls: string[] = [];
    const parent = dir();
    const path = join(parent, "verdict.md");
    const args = input(path, calls);
    args.bindings.critic = [
      {
        id: "critic.1",
        invoke: async () => {
          rmSync(parent, { recursive: true, force: true });
          return { kind: "ok" as const, stdout: "fix", stderr: "" };
        },
      },
    ];
    const result = await executeReviewCycle(args);
    expect(result).toMatchObject({ kind: "invocation_failure", failureKind: "error", cycles: [{ kind: "invocation_failure" }] });
    expect(calls).toEqual([]);
  });

  test("falls through quota independently for critic and actuator", async () => {
    const calls: string[] = [];
    const path = join(dir(), "verdict.md");
    const args = input(path, calls);
    args.bindings = {
      critic: [binding("critic.1", "", calls, "quota"), binding("critic.2", "fix", calls)],
      actuator: [binding("actuator.1", "", calls, "quota"), binding("actuator.2", "done", calls)],
    };
    await executeReviewCycle(args);
    expect(calls.map((call) => call.split(":")[0])).toEqual(["critic.1", "critic.2", "actuator.1", "actuator.2"]);
  });

  test("maps actuator abort to its terminal error and stops later work", async () => {
    const calls: string[] = [];
    const path = join(dir(), "verdict.md");
    const args = input(path, calls, "fix", 3);
    args.bindings.actuator = [{ id: "actuator.1", invoke: async () => ({ kind: "error" as const, exitCode: -1, stderr: "aborted" }) }];
    const result = await executeReviewCycle(args);
    expect(result).toMatchObject({ kind: "invocation_failure", failedRole: "actuator", cycles: [{ kind: "role_failed", failedRole: "actuator", failureKind: "error" }] });
    expect(result.cycles).toHaveLength(1);
  });

  test("reports verdict I/O failure without a cycle when invalidation fails", async () => {
    const calls: string[] = [];
    const result = await executeReviewCycle(input(join(dir(), "missing", "verdict.md"), calls));
    expect(result).toEqual({ kind: "invocation_failure", failureKind: "error", cycles: [] });
    expect(calls).toHaveLength(0);
  });
});
