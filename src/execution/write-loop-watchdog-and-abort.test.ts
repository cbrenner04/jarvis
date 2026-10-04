import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import { openStateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createFakeWithExternalWorktree, createJarvisHome } from "../testing/write-fixtures.ts";
import { executeWrite as realExecuteWrite, type WriteExecuteInput } from "./write.ts";
import {
  CLEAN_MARKDOWNLINT_RUNNER,
  createManualWallSchedule,
  expectCapturedTimersUnrefd,
  loadRunOnce,
  registerWriteLoopExecuteWriteMockHooks,
  roots,
  runAbortWatchdogOrdering,
  TestLogSink,
  withSetTimeoutCapture,
} from "./write-loop.test-support.ts";
import { executeWriteLoop as invokeWriteLoop, type WriteLoopInput } from "./write-loop.ts";

function executeWriteLoop(input: WriteLoopInput): ReturnType<typeof invokeWriteLoop> {
  return invokeWriteLoop({
    ...input,
    stagedMarkdownLintRunner: input.stagedMarkdownLintRunner ?? CLEAN_MARKDOWNLINT_RUNNER,
  });
}

describe("write loop", () => {
  registerWriteLoopExecuteWriteMockHooks();

  test("executeWrite throw terminates as invocation_failure with run_execution_failed", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const sink = new TestLogSink();
    const throwMessage = "ENOENT: spec-guidance missing";
    mock.module("./write.ts", () => ({
      executeWrite: async () => {
        throw new Error(throwMessage);
      },
    }));

    try {
      const result = await executeWriteLoop({
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "throw-run",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        logSink: sink,
      });

      expect(result).toMatchObject({
        kind: "invocation_failure",
        failureKind: "error",
        bindingAttempts: [],
        resumable: false,
        iterationsConsumed: 1,
      });

      const run = loadRunOnce(stateDbPath, result.runId);
      expect(run?.status).toBe("failed");
      expect(run?.attempts).toHaveLength(1);
      expect(run?.attempts[0]?.status).toBe("completed");
      expect(run?.attempts[0]?.outcomeKind).toBe("invocation_failure");
      expect(run?.attempts[0]?.invocationFailureDetail).toEqual({ failureKind: "error", bindingAttempts: [] });

      const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
      expect(events).toEqual(["iteration_started", "boundary_committed", "run_execution_failed"]);
      const failed = sink.getEventsForRun(result.runId).find((event) => event.kind === "run_execution_failed");
      expect(failed).toMatchObject({ kind: "run_execution_failed", message: throwMessage });
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test("progress output resets the iteration wall so a slow emitter completes", async () => {
    const wallMs = 35;
    const runMs = wallMs * 2 + 25;
    const ceilingMs = runMs + 200;

    async function runWithWallReset(resetIterationWallOnOutput: boolean | undefined, branchName: string) {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      mock.module("./write.ts", () => ({
        executeWrite: async (input: WriteExecuteInput) => {
          const start = Date.now();
          while (Date.now() - start < runMs) {
            input.onInvocationOutputProgress?.();
            await new Promise<void>((resolve) => setTimeout(resolve, 8));
            if (input.signal?.aborted) {
              throw new Error("aborted");
            }
          }
          return {
            worktreePath: join(jarvisRoot, "worktrees", "demo", branchName),
            worktreeReused: false,
            lock: { kind: "acquired" as const },
            result: {
              kind: "complete" as const,
              token: "done" as const,
              invocation: { attempts: [], final: null, telemetryFailures: [] },
            },
          };
        },
      }));

      try {
        return await executeWriteLoop({
          worktree: { projectRoot: "/fake", projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
          specPath: "spec.md",
          stepRules: "Return exactly one terminal token.",
          expectedArtifactPath: "proof.txt",
          bindings: simulatedBindings(["done"]),
          stateStore: store,
          withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
          sessionsDir: join(jarvisRoot, "sessions"),
          iterationTimeoutMs: wallMs,
          iterationCeilingMs: ceilingMs,
          ...(resetIterationWallOnOutput !== undefined ? { resetIterationWallOnOutput } : {}),
        });
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    }

    const completed = await runWithWallReset(true, "wall-reset-complete");
    expect(completed).toMatchObject({ kind: "complete", iterationsConsumed: 1 });

    const timedOut = await runWithWallReset(false, "wall-reset-stall");
    expect(timedOut).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 1, resumable: true });
  });

  test("progress output cancels the prior wall-segment schedule and registers a new one via the injected seam", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const manual = createManualWallSchedule();
    let emitProgress: (() => void) | undefined;
    let resolveWrite: (() => void) | undefined;

    mock.module("./write.ts", () => ({
      executeWrite: (input: WriteExecuteInput) => {
        emitProgress = () => input.onInvocationOutputProgress?.();
        return new Promise((resolve) => {
          resolveWrite = () =>
            resolve({
              worktreePath: join(jarvisRoot, "worktrees", "demo", "bump-seam"),
              worktreeReused: false,
              lock: { kind: "acquired" as const },
              result: {
                kind: "complete" as const,
                token: "done" as const,
                invocation: { attempts: [], final: null, telemetryFailures: [] },
              },
            });
        });
      },
    }));

    try {
      const resultPromise = executeWriteLoop({
        worktree: { projectRoot: "/fake", projectName: "demo", branchName: "bump-seam", baseRef: "HEAD", jarvisRoot },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        iterationTimeoutMs: 1_000_000,
        schedule: manual.schedule,
      });

      await manual.waitForSchedule();
      expect(manual.registrationCount()).toBe(1);
      expect(manual.cancelledCount()).toBe(0);

      // bumpWallSegment runs synchronously off onInvocationOutputProgress: no await needed
      // between emitting progress and observing the cancel + re-registration through the seam.
      emitProgress?.();
      expect(manual.registrationCount()).toBe(2);
      expect(manual.cancelledCount()).toBe(1);

      resolveWrite?.();
      const result = await resultPromise;
      expect(result).toMatchObject({ kind: "complete" });
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  describe.serial("armed watchdog timer unref hygiene", () => {
    test("armed wall-segment watchdog timer is unref'd after early iteration settle", async () => {
      const wallMs = 60_000;
      const branchName = "unref-wall";
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);

      mock.module("./write.ts", () => ({
        executeWrite: async () => ({
          worktreePath: join(jarvisRoot, "worktrees", "demo", branchName),
          worktreeReused: false,
          lock: { kind: "acquired" as const },
          result: {
            kind: "complete" as const,
            token: "done" as const,
            invocation: { attempts: [], final: null, telemetryFailures: [] },
          },
        }),
      }));

      try {
        const { result, captured } = await withSetTimeoutCapture(wallMs, () =>
          executeWriteLoop({
            worktree: { projectRoot: "/fake", projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
            specPath: "spec.md",
            stepRules: "Return exactly one terminal token.",
            expectedArtifactPath: "proof.txt",
            bindings: simulatedBindings(["done"]),
            stateStore: store,
            withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
            sessionsDir: join(jarvisRoot, "sessions"),
            iterationTimeoutMs: wallMs,
            maxIterations: 1,
          }),
        );
        expect(result.kind).not.toBe("iteration_timeout");
        expectCapturedTimersUnrefd(captured);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("armed iteration ceiling watchdog timer is unref'd after early iteration settle", async () => {
      const wallMs = 60_000;
      const ceilingMs = 120_000;
      const branchName = "unref-ceiling";
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);

      mock.module("./write.ts", () => ({
        executeWrite: async () => ({
          worktreePath: join(jarvisRoot, "worktrees", "demo", branchName),
          worktreeReused: false,
          lock: { kind: "acquired" as const },
          result: {
            kind: "complete" as const,
            token: "done" as const,
            invocation: { attempts: [], final: null, telemetryFailures: [] },
          },
        }),
      }));

      try {
        const { result, captured } = await withSetTimeoutCapture(ceilingMs, () =>
          executeWriteLoop({
            worktree: {
              projectRoot: "/fake",
              projectName: "demo",
              branchName,
              baseRef: "HEAD",
              jarvisRoot,
            },
            specPath: "spec.md",
            stepRules: "Return exactly one terminal token.",
            expectedArtifactPath: "proof.txt",
            bindings: simulatedBindings(["done"]),
            stateStore: store,
            withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
            sessionsDir: join(jarvisRoot, "sessions"),
            iterationTimeoutMs: wallMs,
            iterationCeilingMs: ceilingMs,
            maxIterations: 1,
          }),
        );
        expect(result.kind).not.toBe("iteration_timeout");
        expectCapturedTimersUnrefd(captured);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });
  });

  test("continuous output cannot extend an iteration past the hard ceiling", async () => {
    const wallMs = 25;
    const ceilingMs = 70;
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const startedAt = Date.now();

    mock.module("./write.ts", () => ({
      executeWrite: async (input: WriteExecuteInput) => {
        while (!input.signal?.aborted) {
          input.onInvocationOutputProgress?.();
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
        }
        throw new Error("aborted");
      },
    }));

    try {
      const result = await executeWriteLoop({
        worktree: { projectRoot: "/fake", projectName: "demo", branchName: "ceiling-run", baseRef: "HEAD", jarvisRoot },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        iterationTimeoutMs: wallMs,
        iterationCeilingMs: ceilingMs,
      });

      const elapsed = Date.now() - startedAt;
      expect(result).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 1, resumable: true });
      expect(elapsed).toBeGreaterThanOrEqual(ceilingMs - 15);
      expect(elapsed).toBeLessThan(ceilingMs + 150);
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test("stalled executeWrite terminates the started attempt as iteration_timeout", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const sink = new TestLogSink();
    mock.module("./write.ts", () => ({
      executeWrite: (input: WriteExecuteInput) =>
        new Promise<never>((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    }));

    try {
      const result = await executeWriteLoop({
        worktree: { projectRoot: "/fake", projectName: "demo", branchName: "timeout-run", baseRef: "HEAD", jarvisRoot },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        logSink: sink,
        iterationTimeoutMs: 10,
      });

      expect(result).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 1, resumable: true });
      const run = loadRunOnce(stateDbPath, result.runId);
      expect(run?.status).toBe("failed");
      expect(run?.attempts[0]?.outcomeKind).toBe("iteration_timeout");
      expect(sink.getEventsForRun(result.runId).map((event) => event.kind)).toEqual([
        "iteration_started",
        "boundary_committed",
        "loop_finished",
      ]);
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test("gives each iteration a fresh timeout and quiesces the second iteration's execution before finalizing", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const sink = new TestLogSink();
    let calls = 0;
    mock.module("./write.ts", () => ({
      executeWrite: (input: WriteExecuteInput) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            worktreePath: input.worktree.projectRoot,
            worktreeReused: false,
            lock: { kind: "acquired" as const },
            result: {
              kind: "progress" as const,
              token: "progress" as const,
              invocation: { attempts: [], final: null, telemetryFailures: [] },
            },
          });
        }
        // Second iteration's invocation only quiesces (rejects) once the watchdog aborts it —
        // proving the timeout boundary waits for that quiescence rather than moving on early.
        return new Promise<never>((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    }));

    try {
      const result = await executeWriteLoop({
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "fresh-timeout",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["progress"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        logSink: sink,
        iterationTimeoutMs: 25,
      });

      expect(result).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 2, resumable: true });
      expect(calls).toBe(2);
      expect(sink.getEventsForRun(result.runId).filter((event) => event.kind === "loop_finished")).toHaveLength(1);
      expect(loadRunOnce(stateDbPath, result.runId)?.attempts.map((attempt) => attempt.outcomeKind)).toEqual([
        "progress",
        "iteration_timeout",
      ]);
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test("lets an observed abort win before the watchdog, but not after it", async () => {
    // Mutation checkpoint: flip `resolveIterationSettlementKind` precedence mapping; does not cover
    // dropped watchdog latch, synchronous abort settlement, or reordered `Promise.race` operands.
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    mock.module("./write.ts", () => ({
      executeWrite: (input: WriteExecuteInput) =>
        new Promise<never>((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    }));

    try {
      for (let i = 0; i < 50; i++) {
        const early = await runAbortWatchdogOrdering({
          jarvisRoot,
          stateStore: store,
          order: "abort-first",
          branchName: `abort-first-${i}`,
        });
        // Iteration index and subcase label ride along in the compared object so a failure at
        // iteration 37 reports which subcase and iteration mismatched, not an anonymous object diff.
        expect({ iteration: i, subcase: "early", ...early }).toMatchObject({
          iteration: i,
          subcase: "early",
          kind: "progress",
          resumable: true,
        });

        const late = await runAbortWatchdogOrdering({
          jarvisRoot,
          stateStore: store,
          order: "watchdog-first",
          branchName: `timeout-first-${i}`,
        });
        expect({ iteration: i, subcase: "late", ...late }).toMatchObject({
          iteration: i,
          subcase: "late",
          kind: "iteration_timeout",
          resumable: true,
        });
      }
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test("executeWrite throw while aborted terminates as progress", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const controller = new AbortController();
    mock.module("./write.ts", () => ({
      executeWrite: async () => {
        controller.abort();
        throw new Error("pre-spawn failure");
      },
    }));

    try {
      const result = await executeWriteLoop({
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "throw-abort-run",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["progress"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        signal: controller.signal,
      });

      expect(result).toMatchObject({ kind: "progress", resumable: true, iterationsConsumed: 0 });
      expect(loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.status).toBe("in-progress");
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test("promptId and promptPlaceholders forward through to executeWrite", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    const store = openStateStore(stateDbPath);
    const captured: WriteExecuteInput[] = [];
    const stubResult: Awaited<ReturnType<typeof realExecuteWrite>> = {
      worktreePath: join(jarvisRoot, "worktrees", "demo", "prompt-id-run"),
      worktreeReused: false,
      lock: { kind: "acquired" },
      result: {
        kind: "complete",
        token: "done",
        invocation: { attempts: [], final: null, telemetryFailures: [] },
      },
    };
    mock.module("./write.ts", () => ({
      executeWrite: async (input: WriteExecuteInput) => {
        captured.push(input);
        return stubResult;
      },
    }));

    try {
      const loopInput: WriteLoopInput = {
        worktree: {
          projectRoot: "/fake",
          projectName: "demo",
          branchName: "prompt-id-run",
          baseRef: "HEAD",
          jarvisRoot,
        },
        specPath: "spec.md",
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        promptId: "custom.prompt",
        promptPlaceholders: { FOO: "bar" },
      };

      const result = await executeWriteLoop(loopInput);

      expect(result.kind).toBe("complete");
      expect(captured).toHaveLength(1);
      expect(captured[0]?.promptId).toBe("custom.prompt");
      expect(captured[0]?.promptPlaceholders).toEqual({ FOO: "bar" });
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });
});
