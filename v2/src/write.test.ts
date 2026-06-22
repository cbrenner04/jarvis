import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import type { ExternalWorktree, WithExternalWorktreeResult } from "./external-worktree.ts";
import { executeWrite } from "./write.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0, roots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createFakeWithExternalWorktree() {
  return async function fakeWithExternalWorktree<T>(
    args: { branchName: string; projectName: string; jarvisRoot?: string },
    run: (worktree: ExternalWorktree) => Promise<T> | T,
  ): Promise<WithExternalWorktreeResult<T>> {
    const jarvisRoot = args.jarvisRoot ?? join(tmpdir(), "jarvis-fake");
    const worktreePath = join(jarvisRoot, "worktrees", args.projectName, args.branchName);
    mkdirSync(worktreePath, { recursive: true });
    roots.push(join(jarvisRoot, ".."));
    writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
    const value = await run({ path: worktreePath, reused: false });
    return {
      worktree: { path: worktreePath, reused: false },
      lock: { kind: "acquired" },
      value,
    };
  };
}

function setupRepo(): { jarvisRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "jarvis-v2-write-"));
  roots.push(root);
  const jarvisRoot = join(root, "jarvis-home");
  return { jarvisRoot };
}

function runWrite(args: { jarvisRoot: string; bindings: readonly InvocationBinding[]; artifactPath?: string }) {
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
    withExternalWorktree: createFakeWithExternalWorktree(),
  });
}

describe("write behavior", () => {
  test("happy path: done plus artifact contract pass returns complete", async () => {
    const { jarvisRoot } = setupRepo();
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
    const { jarvisRoot } = setupRepo();
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
    const { jarvisRoot } = setupRepo();
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
    const { jarvisRoot } = setupRepo();
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
    const { jarvisRoot } = setupRepo();
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
