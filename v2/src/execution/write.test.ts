import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { executeWrite } from "./write.ts";

const { roots } = trackedTempRoots();

function runWrite(args: { jarvisRoot: string; bindings: readonly InvocationBinding[]; artifactPath?: string }) {
  // Track the parent directory of jarvisRoot for cleanup
  roots.push(join(args.jarvisRoot, ".."));
  return executeWrite({
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: "write-run",
      baseRef: "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: args.artifactPath ?? "proof.txt",
    bindings: args.bindings,
    withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
  });
}

describe("write behavior", () => {
  test("happy path: done plus artifact contract pass returns complete", async () => {
    const { jarvisRoot } = createJarvisHome();
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const result = await runWrite({ jarvisRoot, bindings });
    expect(result.result.kind).toBe("complete");
  });

  test("quota fallback success: second binding completes", async () => {
    const { jarvisRoot } = createJarvisHome();
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
        invoke: async ({ cwd }) => {
          calls.push("second");
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const result = await runWrite({ jarvisRoot, bindings });
    expect(result.result.kind).toBe("complete");
    expect(calls).toEqual(["first", "second"]);
  });

  test("terminal contract miss returns non-success result", async () => {
    const { jarvisRoot } = createJarvisHome();
    const result = await runWrite({
      jarvisRoot,
      bindings: [
        {
          id: "agent",
          invoke: async () => ({ kind: "ok", stdout: "done", stderr: "" }),
        },
      ],
    });

    expect(result.result.kind).toBe("contract_miss");
  });

  test("blocked token returns blocked without contract pass", async () => {
    const { jarvisRoot } = createJarvisHome();
    const result = await runWrite({
      jarvisRoot,
      bindings: [
        {
          id: "agent",
          invoke: async () => ({ kind: "ok", stdout: "blocked", stderr: "" }),
        },
      ],
    });

    expect(result.result.kind).toBe("blocked");
  });

  test("progress token returns non-success without retry", async () => {
    const { jarvisRoot } = createJarvisHome();
    let calls = 0;
    const result = await runWrite({
      jarvisRoot,
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            calls += 1;
            return { kind: "ok", stdout: "progress", stderr: "" };
          },
        },
      ],
    });

    expect(result.result.kind).toBe("progress");
    expect(calls).toBe(1);
  });
});
