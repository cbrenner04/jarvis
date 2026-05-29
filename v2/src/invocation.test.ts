import { describe, expect, test } from "bun:test";
import {
  executeWithQuotaFallback,
  type InvocationBinding,
  type InvocationResult,
} from "../../shared/invocation/execute.ts";

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
  });
});
