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
        checkOutputContract: async () => ({ ok: true }),
      },
    );

    expect(acquireSignal).toBe(signal);
    expect(invokeSignal).toBe(signal);
  });
});
