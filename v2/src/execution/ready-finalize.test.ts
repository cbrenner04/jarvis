import { describe, expect, it } from "bun:test";
import { AsyncSubprocessError, type AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { verifyDiffDerivedMutations } from "./diff-derived-mutation-verifier.ts";
import { createReadyFinalizer, ReadyGateError, SurvivingMutationError } from "./ready-finalize.ts";
import { nonEmptyDiscoveryReason } from "./runtime-smoke-verifier.ts";

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

  it("returns a successful runtime smoke outcome", async () => {
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      runRuntimeSmokeVerification: async () => ({
        kind: "not-runnable",
        inspectedPaths: ["v2/src/execution/write-loop.ts", "shared/subprocess.ts"],
        discoveryReason: nonEmptyDiscoveryReason("no changed runnable entrypoint found"),
      }),
      ghReadyFlip: async () => {},
    });

    await expect(finalizer(input)).resolves.toEqual({
      runtimeSmokeOutcome: {
        kind: "not-runnable",
        inspectedPaths: ["v2/src/execution/write-loop.ts", "shared/subprocess.ts"],
        discoveryReason: nonEmptyDiscoveryReason("no changed runnable entrypoint found"),
      },
    });
  });

  it("carries a successful runtime smoke outcome when the ready flip fails", async () => {
    const outcome = { kind: "observed-clean" } as const;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      runRuntimeSmokeVerification: async () => outcome,
      ghReadyFlip: async () => {
        throw new Error("gh pr ready failed");
      },
      delay: noopDelay,
    });

    await expect(finalizer(input)).rejects.toEqual(
      expect.objectContaining({
        name: "ReadyFlipError",
        runtimeSmokeOutcome: outcome,
      }),
    );
  });

  it("does not return a runtime smoke outcome when no verifier is configured", async () => {
    const finalizer = createReadyFinalizer({ runReadyGate: async () => {}, ghReadyFlip: async () => {} });

    await expect(finalizer(input)).resolves.toEqual({});
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

  it("stops ready finalization for missing prompt render coverage", async () => {
    let flipCalls = 0;
    let prompt = `---
id: patch.review.critic
behavior: review
kind: step
revision: 1
placeholders: []
---
new output
`;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      runMutationVerification: async () => {
        const result = await verifyDiffDerivedMutations(
          { worktreePath: "/tmp/worktree", runBase: "main" },
          {
            gitDiff: async () => `diff --git a/prompts/patch/review-critic.md b/prompts/patch/review-critic.md
index f424d7da..be281d02 100644
--- a/prompts/patch/review-critic.md
+++ b/prompts/patch/review-critic.md
@@ -1 +1 @@
-old output
+new output
diff --git a/shared/prompts/review-implement.test.ts b/shared/prompts/review-implement.test.ts
index 1234567..abcdefg 100644
--- a/shared/prompts/review-implement.test.ts
+++ b/shared/prompts/review-implement.test.ts
@@ -1 +1 @@
+const output = renderPatchReviewCriticPrompt();
`,
            untrackedFiles: async () => [],
            registeredPromptPaths: async () => ["prompts/patch/review-critic.md"],
            readFile: async () => prompt,
            writeFile: async (_path, content) => {
              prompt = content;
            },
            runScopedTests: async () => true,
          },
        );
        if (result.kind === "surviving-mutation") {
          throw new SurvivingMutationError(result.mutation, result.sourceSite.file, result.sourceSite.line);
        }
      },
      ghReadyFlip: async () => {
        flipCalls += 1;
      },
    });

    await expect(finalizer(input)).rejects.toThrow(
      "Surviving mutation in prompts/patch/review-critic.md:1: missing-render-coverage",
    );
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

  it("rejects required v2 integration scope failure before publisher finalization", async () => {
    let flipCalls = 0;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      runRequiredIntegration: async () => {
        throw new ReadyGateError("bun run test:integration:v2", 1, "integration test failed\n");
      },
      ghReadyFlip: async () => {
        flipCalls += 1;
      },
    });

    const inputWithIntegration = { ...input, requiredIntegrationScope: "test:integration:v2" };
    await expect(finalizer(inputWithIntegration)).rejects.toThrow("ready gate failed");
    expect(flipCalls).toBe(0);
  });

  it("runs required integration scope after ready gate and before flip", async () => {
    const calls: string[] = [];
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {
        calls.push("gate");
      },
      runRequiredIntegration: async () => {
        calls.push("integration");
      },
      ghReadyFlip: async () => {
        calls.push("flip");
      },
    });

    const inputWithIntegration = { ...input, requiredIntegrationScope: "test:integration:v2" };
    await finalizer(inputWithIntegration);

    expect(calls).toEqual(["gate", "integration", "flip"]);
  });

  it("skips required integration scope when not specified", async () => {
    let integrationCalls = 0;
    const finalizer = createReadyFinalizer({
      runReadyGate: async () => {},
      runRequiredIntegration: async () => {
        integrationCalls += 1;
      },
      ghReadyFlip: async () => {},
    });

    await finalizer(input);

    expect(integrationCalls).toBe(0);
  });
});
