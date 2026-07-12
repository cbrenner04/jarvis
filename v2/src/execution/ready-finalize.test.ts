import { describe, expect, it } from "bun:test";
import { createReadyFinalizer } from "./ready-finalize.ts";

describe("createReadyFinalizer", () => {
  const input = { worktreePath: "/tmp/worktree", branch: "feature-branch" };
  const noopDelay = async () => {};

  it("runs the ready gate then flips the draft PR on green", async () => {
    const calls: string[] = [];
    const finalizer = createReadyFinalizer({
      runReadyGate: async (worktreePath) => {
        calls.push(`gate:${worktreePath}`);
      },
      ghReadyFlip: async (branch, worktreePath) => {
        calls.push(`flip:${branch}@${worktreePath}`);
      },
    });

    await finalizer(input);

    expect(calls).toEqual(["gate:/tmp/worktree", "flip:feature-branch@/tmp/worktree"]);
  });

  it("leaves the PR draft and does not flip when the ready gate fails", async () => {
    let flipCalls = 0;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {
        throw new Error("ready gate failed (exit 1): tests failed");
      },
      ghReadyFlip: async () => {
        flipCalls += 1;
      },
    });

    await expect(finalizer(input)).rejects.toThrow("ready gate failed");
    expect(flipCalls).toBe(0);
  });

  it("retries transient gh pr ready errors up to 3 attempts", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const notices: string[] = [];

    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      ghReadyFlip: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("Connection reset by peer");
        }
      },
      delay: async (ms) => {
        delays.push(ms);
      },
      retryNotice: (message) => {
        notices.push(message);
      },
    });

    await finalizer(input);

    expect(attempts).toBe(3);
    expect(delays).toEqual([1000, 1000]);
    expect(notices).toEqual([
      "gh pr ready: transient network error; retrying (attempt 2/3)",
      "gh pr ready: transient network error; retrying (attempt 3/3)",
    ]);
  });

  it("treats already ready stderr as success without retry", async () => {
    let attempts = 0;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      ghReadyFlip: async () => {
        attempts += 1;
        throw new Error("error: pull request is already ready for review");
      },
      delay: noopDelay,
      retryNotice: () => {
        throw new Error("should not retry");
      },
    });

    await finalizer(input);

    expect(attempts).toBe(1);
  });

  it("treats not a draft stderr as success without retry", async () => {
    let attempts = 0;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      ghReadyFlip: async () => {
        attempts += 1;
        throw new Error("error: this pull request is not a draft");
      },
      delay: noopDelay,
      retryNotice: () => {
        throw new Error("should not retry");
      },
    });

    await finalizer(input);

    expect(attempts).toBe(1);
  });

  it("treats an empty exit-0 gh pr ready response as success", async () => {
    let attempts = 0;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      ghReadyFlip: async () => {
        attempts += 1;
      },
    });

    await finalizer(input);

    expect(attempts).toBe(1);
  });

  it("throws after 3 failed gh pr ready attempts", async () => {
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      ghReadyFlip: async () => {
        throw new Error("Connection timeout");
      },
      delay: noopDelay,
    });

    await expect(finalizer(input)).rejects.toThrow("Connection timeout");
  });
});
