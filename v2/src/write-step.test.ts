import { describe, expect, test } from "bun:test";
import { createWritePrompt, runWriteStep } from "./write-step.ts";

describe("createWritePrompt", () => {
  test("renders the shared write prompt artifact", () => {
    const prompt = createWritePrompt("Ship the feature.");

    expect(prompt).toContain("Complete exactly this write step:");
    expect(prompt).toContain("Ship the feature.");
  });
});

describe("runWriteStep", () => {
  test("maps done and checks contract", async () => {
    let contractToken: "done" | "no-work" | undefined;
    const result = await runWriteStep(
      { task: "Do work." },
      {
        acquireWorktree: async () => ({ path: "/tmp/worktree", release: () => {} }),
        invoke: async () => ({ kind: "ok", stdout: "done\n", stderr: "" }),
        invocationCount: 1,
        checkOutputContract: async ({ token }) => {
          contractToken = token;
          return { ok: true };
        },
      },
    );

    expect(contractToken).toBe("done");
    expect(result).toEqual({ kind: "done", worktreePath: "/tmp/worktree" });
  });

  test("returns progress without contract check", async () => {
    let checked = false;
    const result = await runWriteStep(
      { task: "Do work." },
      {
        acquireWorktree: async () => ({ path: "/tmp/worktree", release: () => {} }),
        invoke: async () => ({ kind: "ok", stdout: "progress\n", stderr: "" }),
        invocationCount: 1,
        checkOutputContract: async () => {
          checked = true;
          return { ok: true };
        },
      },
    );

    expect(checked).toBe(false);
    expect(result).toEqual({ kind: "progress", worktreePath: "/tmp/worktree" });
  });

  test("passes abort signal through acquisition and invocation", async () => {
    const signal = new AbortController().signal;
    let acquireSignal: AbortSignal | undefined;
    let invokeSignal: AbortSignal | undefined;

    await runWriteStep(
      { task: "Do work.", signal },
      {
        acquireWorktree: async (s) => {
          acquireSignal = s;
          return { path: "/tmp/worktree", release: () => {} };
        },
        invoke: async (_prompt, args) => {
          invokeSignal = args.signal;
          return { kind: "ok", stdout: "progress\n", stderr: "" };
        },
        invocationCount: 1,
        checkOutputContract: async () => ({ ok: true }),
      },
    );

    expect(acquireSignal).toBe(signal);
    expect(invokeSignal).toBe(signal);
  });

  test("retries only on quota and returns first non-quota result", async () => {
    const seen: number[] = [];
    const result = await runWriteStep(
      { task: "Do work." },
      {
        acquireWorktree: async () => ({ path: "/tmp/worktree", release: () => {} }),
        invoke: async (_prompt, args) => {
          seen.push(args.invocationIndex);
          if (args.invocationIndex === 0) return { kind: "quota", stderr: "limit hit" };
          return { kind: "ok", stdout: "no-work\n", stderr: "" };
        },
        invocationCount: 3,
        checkOutputContract: async () => ({ ok: true }),
      },
    );

    expect(seen).toEqual([0, 1]);
    expect(result).toEqual({ kind: "no-work", worktreePath: "/tmp/worktree" });
  });

  test("returns hard error when all invocations are quota-classified", async () => {
    const result = await runWriteStep(
      { task: "Do work." },
      {
        acquireWorktree: async () => ({ path: "/tmp/worktree", release: () => {} }),
        invoke: async () => ({ kind: "quota", stderr: "limit hit" }),
        invocationCount: 2,
        checkOutputContract: async () => ({ ok: true }),
      },
    );

    expect(result).toEqual({ kind: "error", message: "all agents quota-exhausted" });
  });

  test("contract miss after terminal token returns hard error", async () => {
    const result = await runWriteStep(
      { task: "Do work." },
      {
        acquireWorktree: async () => ({ path: "/tmp/worktree", release: () => {} }),
        invoke: async () => ({ kind: "ok", stdout: "done\n", stderr: "" }),
        invocationCount: 1,
        checkOutputContract: async () => ({ ok: false, reason: "expected file not found" }),
      },
    );

    expect(result).toEqual({ kind: "error", message: "expected file not found" });
  });

  test("blocked stops immediately with blocker outcome", async () => {
    let checked = false;
    const result = await runWriteStep(
      { task: "Do work." },
      {
        acquireWorktree: async () => ({ path: "/tmp/worktree", release: () => {} }),
        invoke: async () => ({ kind: "ok", stdout: "blocked\n", stderr: "need approval" }),
        invocationCount: 2,
        checkOutputContract: async () => {
          checked = true;
          return { ok: true };
        },
      },
    );

    expect(checked).toBe(false);
    expect(result).toEqual({
      kind: "blocked",
      reason: "need approval",
      worktreePath: "/tmp/worktree",
    });
  });
});
