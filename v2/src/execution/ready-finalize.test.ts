import { describe, expect, it } from "bun:test";
import { AsyncSubprocessError, type AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { createReadyFinalizer, ReadyGateError } from "./ready-finalize.ts";

describe("createReadyFinalizer", () => {
  const input = { worktreePath: "/tmp/worktree", branch: "feature-branch", baseRef: "main" };
  const noopDelay = async () => {};

  it("runs the ready gate then flips the draft PR on green", async () => {
    const calls: string[] = [];
    const finalizer = createReadyFinalizer({
      runReadyGate: async (worktreePath, baseRef) => {
        calls.push(`gate:${worktreePath}@${baseRef}`);
      },
      ghReadyFlip: async (branch, worktreePath) => {
        calls.push(`flip:${branch}@${worktreePath}`);
      },
    });

    await finalizer(input);

    expect(calls).toEqual(["gate:/tmp/worktree@main", "flip:feature-branch@/tmp/worktree"]);
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

  it("carries the ready gate command, exit code, and combined output", async () => {
    const finalizer = createReadyFinalizer({
      asyncSubprocessRunner: {
        async runAsync() {
          throw new AsyncSubprocessError("ready failed", 1, "stdout failure\n", "stderr failure\n", undefined);
        },
      },
    });

    await expect(finalizer(input)).rejects.toEqual(
      new ReadyGateError("bun run ready", 1, "stdout failure\nstderr failure\n"),
    );
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
      "gh pr ready: Connection reset by peer; exit=unknown; retrying (attempt 2/3)",
      "gh pr ready: Connection reset by peer; exit=unknown; retrying (attempt 3/3)",
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

  it("overrides inherited JARVIS_READY_TIER=fast with full in the gate's child env", async () => {
    const originalEnv = process.env.JARVIS_READY_TIER;
    try {
      process.env.JARVIS_READY_TIER = "fast";

      const calls: Array<{ env: NodeJS.ProcessEnv | undefined }> = [];
      const mockRunner: AsyncSubprocessRunner = {
        async runAsync(cmd, _args, _cwd, options) {
          if (cmd === "bun") {
            calls.push({ env: options?.env });
          }
          return "";
        },
      };

      const finalizer = createReadyFinalizer({
        asyncSubprocessRunner: mockRunner,
        ghReadyFlip: async () => {},
      });

      await finalizer(input);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.env?.JARVIS_READY_TIER).toBe("full");
    } finally {
      if (originalEnv === undefined) {
        delete process.env.JARVIS_READY_TIER;
      } else {
        process.env.JARVIS_READY_TIER = originalEnv;
      }
    }
  });

  it("scopes JARVIS_READY_TEST_SCOPE to v2 test scripts when only v2/** changed", async () => {
    const calls: Array<{ env: NodeJS.ProcessEnv | undefined }> = [];
    const mockRunner: AsyncSubprocessRunner = {
      async runAsync(cmd, args, _cwd, options) {
        if (cmd === "git") {
          if (args?.[0] === "diff") return "v2/src/execution/ready-finalize.ts\nv2/src/execution/write-loop.ts";
          if (args?.[0] === "ls-files") return "";
        }
        calls.push({ env: options?.env });
        return "";
      },
    };

    const finalizer = createReadyFinalizer({
      asyncSubprocessRunner: mockRunner,
      ghReadyFlip: async () => {},
    });

    await finalizer(input);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.env?.JARVIS_READY_TIER).toBe("full");
    expect(calls[0]?.env?.JARVIS_READY_TEST_SCOPE).toBe("test:v2 test:integration:v2");
  });

  it("falls back to JARVIS_READY_TEST_SCOPE=full when diff fails", async () => {
    const calls: Array<{ env: NodeJS.ProcessEnv | undefined }> = [];
    const mockRunner: AsyncSubprocessRunner = {
      async runAsync(cmd, _args, _cwd, options) {
        if (cmd === "git") {
          throw new Error("unable to resolve base ref");
        }
        calls.push({ env: options?.env });
        return "";
      },
    };

    const finalizer = createReadyFinalizer({
      asyncSubprocessRunner: mockRunner,
      ghReadyFlip: async () => {},
    });

    await finalizer(input);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.env?.JARVIS_READY_TIER).toBe("full");
    expect(calls[0]?.env?.JARVIS_READY_TEST_SCOPE).toBe("full");
  });
});
