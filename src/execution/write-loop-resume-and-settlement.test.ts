import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LogEvent } from "../persistence/log-stream.ts";
import { type OutcomeKind, openStateStore, type RunStatus } from "../persistence/state-store.ts";
import type { InvocationBinding } from "../shared/invocation/execute.ts";
import {
  REVIEW_FEEDBACK_RESPONSE_SIDECAR,
  REVIEW_FEEDBACK_WRITE_PROMPT_ID,
} from "../shared/prompts/review-feedback-write.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { resolvePrReviewInputArtifactPath } from "./pr-review-input-capture.ts";
import {
  crashOnceMidBoundary,
  loadRunOnce,
  progressThenDone,
  registerWriteLoopExecuteWriteMockHooks,
  runLoop,
  TestLogSink,
} from "./write-loop.test-support.ts";
import type { WriteLoopOutcomeKind } from "./write-loop.ts";

describe("write loop", () => {
  registerWriteLoopExecuteWriteMockHooks();

  test("max iterations per-invocation with default constant", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: simulatedBindings(["progress"]) });

    expect(result.iterationsConsumed).toBe(10); // Default max
    expect(result.kind).toBe("budget-exhausted");
  });

  test("each iteration persists through state store boundary", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: progressThenDone(2) });

    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run).not.toBeNull();
    expect(run?.attempts.length).toBe(3);
  });

  test("re-invoking an interrupted run re-runs that iteration over the dirty worktree, emitting a fresh iteration_started for the interrupted attempt", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const dirtiedMarker = "dirty.txt";
    const controller = new AbortController();
    const interruptBindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd, signal }) => {
          writeFileSync(join(cwd, dirtiedMarker), "dirty\n", "utf8");
          while (!signal?.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          return { kind: "ok", stdout: "progress", stderr: "" };
        },
      },
    ];

    const abortTimer = setTimeout(() => controller.abort(), 20);
    const interrupted = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: interruptBindings,
      maxIterations: 1,
      signal: controller.signal,
      logSink: sink,
    });
    clearTimeout(abortTimer);
    expect(interrupted.kind).toBe("progress");
    expect(interrupted.iterationsConsumed).toBe(1);
    expect(interrupted.resumable).toBe(true);

    let resumedCalls = 0;
    const resumeBindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          resumedCalls += 1;
          expect(readFileSync(join(cwd, dirtiedMarker), "utf8")).toBe("dirty\n");
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    const resumed = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: resumeBindings,
      maxIterations: 1,
      logSink: sink,
    });

    expect(resumed.kind).toBe("complete");
    expect(resumed.iterationsConsumed).toBe(1);
    expect(resumedCalls).toBe(1);

    const run = loadRunOnce(stateDbPath, resumed.runId);
    expect(run?.attemptCount).toBe(1);
    expect(run?.attempts).toHaveLength(1);
    expect(run?.attempts[0]?.outcomeKind).toBe("done");

    const events = sink.getEventsForRun(resumed.runId);
    // The interrupted attempt's quiesced progress result checkpoints (no_git skip, no worktree
    // git dir in this fixture) before its own loop_finished, same as the resumed attempt's.
    expect(events.length).toBe(7);
    expect(events[0]?.kind).toBe("iteration_started");
    expect(events[1]?.kind).toBe("iteration_commit");
    expect(events[2]?.kind).toBe("loop_finished");
    expect(events[3]?.kind).toBe("iteration_started");
    expect(events[4]?.kind).toBe("iteration_commit");
    expect(events[5]?.kind).toBe("boundary_committed");
    expect(events[6]?.kind).toBe("loop_finished");

    const firstAttemptId = events[0]?.kind === "iteration_started" ? events[0].attemptId : undefined;
    const resumedAttemptId = events[3]?.kind === "iteration_started" ? events[3].attemptId : undefined;
    expect(firstAttemptId).toBeDefined();
    expect(resumedAttemptId).toBeDefined();
    expect(resumedAttemptId).toBe(firstAttemptId);
  });

  test("a budget-soft-stopped run resumes with a fresh per-invocation budget", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });

    expect(first.kind).toBe("budget-exhausted");

    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      maxIterations: 1,
    });

    expect(second.kind).toBe("complete");
    expect(second.iterationsConsumed).toBe(1);

    const run = loadRunOnce(stateDbPath, second.runId);
    expect(run?.status).toBe("completed");
    expect(run?.attemptCount).toBe(2);
  });

  test("a different baseRef, specPath, and worktree on the same project and branch still resumes the same run", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });

    expect(first.kind).toBe("budget-exhausted");

    const run = loadRunOnce(stateDbPath, first.runId);
    if (!run) throw new Error("Run should exist");
    rmSync(run.worktreePath, { recursive: true, force: true });

    const resumed = await runLoop({
      jarvisRoot,
      stateDbPath,
      baseRef: "main",
      specPath: "renamed-spec.md",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      maxIterations: 1,
    });

    expect(resumed.kind).toBe("complete");
    expect(resumed.runId).toBe(first.runId);
  });

  test("a different branch creates a fresh run", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });

    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "other-write-run",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      maxIterations: 1,
    });

    expect(first.runId).not.toBe(second.runId);
  });

  test("re-running a boundary that fails mid-transaction retries the same attempt without duplicate history, emitting matching events", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    let firstInvocationCalls = 0;
    const completeBindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          firstInvocationCalls += 1;
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      },
    ];

    await expect(
      runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: completeBindings,
        store: crashOnceMidBoundary(openStateStore(stateDbPath)),
        maxIterations: 1,
        logSink: sink,
      }),
    ).rejects.toThrow("crash mid-boundary");
    expect(firstInvocationCalls).toBe(1);

    let resumedCalls = 0;
    const resumed = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            resumedCalls += 1;
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      maxIterations: 1,
      logSink: sink,
    });

    expect(resumed.kind).toBe("complete");
    expect(resumed.iterationsConsumed).toBe(1);
    expect(resumedCalls).toBe(1);

    const run = loadRunOnce(stateDbPath, resumed.runId);
    expect(run?.attemptCount).toBe(1);
    expect(run?.attempts).toHaveLength(1);

    const events = sink.getEventsForRun(resumed.runId);
    // Should have: iteration_started (failed), iteration_commit (failed run's checkpoint),
    // iteration_started (retry with same attemptId), iteration_commit, boundary_committed (success), loop_finished
    expect(events.length).toBe(6);
    expect(events[0]?.kind).toBe("iteration_started");
    expect(events[1]?.kind).toBe("iteration_commit");
    expect(events[2]?.kind).toBe("iteration_started");
    expect(events[3]?.kind).toBe("iteration_commit");
    expect(events[4]?.kind).toBe("boundary_committed");
    expect(events[5]?.kind).toBe("loop_finished");

    const firstAttemptId = events[0]?.kind === "iteration_started" ? events[0].attemptId : undefined;
    const retryAttemptId = events[2]?.kind === "iteration_started" ? events[2].attemptId : undefined;
    expect(firstAttemptId).toBeDefined();
    expect(retryAttemptId).toBeDefined();
    expect(retryAttemptId).toBe(firstAttemptId);
  });

  test("resume rebuilds a missing worktree from the branch", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });

    expect(first.kind).toBe("budget-exhausted");

    const worktreePath = join(jarvisRoot, "worktrees", "demo", "write-run");
    rmSync(worktreePath, { recursive: true, force: true });
    expect(existsSync(worktreePath)).toBe(false);

    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      maxIterations: 1,
    });

    expect(second.kind).toBe("complete");
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("multi-iteration loop run produces iteration_started and boundary_committed pairs, ending with loop_finished", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: progressThenDone(2),
      logSink: sink,
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(3);

    const events = sink.getEventsForRun(result.runId);
    // 3 iteration_started, 3 iteration_commit (every settled iteration checkpoints), 3 boundary_committed, 1 loop_finished
    expect(events.length).toBe(10);

    expect(events[0]?.kind).toBe("iteration_started");
    expect(events[1]?.kind).toBe("iteration_commit");
    expect(events[2]?.kind).toBe("boundary_committed");
    expect(events[3]?.kind).toBe("iteration_started");
    expect(events[4]?.kind).toBe("iteration_commit");
    expect(events[5]?.kind).toBe("boundary_committed");
    expect(events[6]?.kind).toBe("iteration_started");
    expect(events[7]?.kind).toBe("iteration_commit");
    expect(events[8]?.kind).toBe("boundary_committed");
    expect(events[9]?.kind).toBe("loop_finished");
    expect(events[9]?.kind === "loop_finished" && events[9].loopOutcomeKind).toBe("complete");
    expect(events[9]?.kind === "loop_finished" && events[9].iterationsConsumed).toBe(3);
  });

  test("terminal loop_finished merges review-feedback item ids only for the review-feedback write prompt", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const defaultSink = new TestLogSink();
    const defaultResult = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "write-run-default",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      logSink: defaultSink,
      completionCommitter: async () => ({ commitSha: "commit-default" }),
      completionPublisher: async () => ({}),
      readyFinalizer: async () => {},
    });
    expect(defaultResult.kind).toBe("complete");
    const defaultFinished = defaultSink
      .getEventsForRun(defaultResult.runId)
      .findLast((event) => event.kind === "loop_finished");
    expect(defaultFinished?.kind).toBe("loop_finished");
    expect(defaultFinished).not.toHaveProperty("reviewFeedbackAddressedItemIds");

    const reviewThreadId = "write-loop-review-thread";
    const laneWorktreePath = join(jarvisRoot, "worktrees", "demo", "write-run-review");
    mkdirSync(laneWorktreePath, { recursive: true });
    writeFileSync(
      resolvePrReviewInputArtifactPath(laneWorktreePath),
      `${JSON.stringify({
        captureVersion: 1,
        prNumber: 1,
        threads: [{ threadId: reviewThreadId, outdated: false, comments: [] }],
        topLevelComments: [],
        reviewBodies: [],
      })}\n`,
      "utf8",
    );

    const reviewSink = new TestLogSink();
    const reviewResult = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "write-run-review",
      promptId: REVIEW_FEEDBACK_WRITE_PROMPT_ID,
      specPath: REVIEW_FEEDBACK_RESPONSE_SIDECAR,
      artifactPath: REVIEW_FEEDBACK_RESPONSE_SIDECAR,
      promptPlaceholders: { LANE_KIND: "plan", ENTRY_SPEC_PATH: "spec/plan/index.md" },
      bindings: [
        {
          id: "review-feedback",
          metadata: { agent: "test-agent", model: "test" },
          invoke: async ({ cwd }) => {
            writeFileSync(join(cwd, REVIEW_FEEDBACK_RESPONSE_SIDECAR), `- ${reviewThreadId}: addressed\n`, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      logSink: reviewSink,
      completionCommitter: async () => ({ commitSha: "commit-review" }),
      completionPublisher: async () => ({}),
      readyFinalizer: async () => {},
    });
    expect(reviewResult.kind).toBe("complete");
    const reviewFinished = reviewSink
      .getEventsForRun(reviewResult.runId)
      .findLast((event) => event.kind === "loop_finished");
    expect(reviewFinished?.kind).toBe("loop_finished");
    if (reviewFinished?.kind !== "loop_finished") throw new Error("expected terminal loop_finished");
    expect(reviewFinished.reviewFeedbackAddressedItemIds).toEqual([reviewThreadId]);
    expect(reviewFinished.reviewFeedbackUnaddressedItemIds).toEqual([]);
  });

  test("terminal boundary_committed and loop_finished payloads match terminalMapping for each outcome", async () => {
    const cases: Array<{
      label: string;
      bindings: readonly InvocationBinding[];
      expectedResultKind: WriteLoopOutcomeKind;
      expectedBoundaryOutcomeKind: OutcomeKind;
      expectedBoundaryRunStatus?: RunStatus;
      expectedFinishedOutcomeKind: WriteLoopOutcomeKind;
    }> = [
      {
        label: "blocked",
        bindings: simulatedBindings(["blocked"], { emitBlocker: true }),
        expectedResultKind: "blocked",
        expectedBoundaryOutcomeKind: "blocked",
        expectedBoundaryRunStatus: "blocked",
        expectedFinishedOutcomeKind: "blocked",
      },
      {
        label: "contract_miss",
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: false }),
        expectedResultKind: "contract_miss",
        expectedBoundaryOutcomeKind: "contract_miss",
        expectedBoundaryRunStatus: "blocked",
        expectedFinishedOutcomeKind: "contract_miss",
      },
      {
        label: "invocation_failure",
        bindings: simulatedBindings(["quota", "quota"]),
        expectedResultKind: "invocation_failure",
        expectedBoundaryOutcomeKind: "invocation_failure",
        expectedBoundaryRunStatus: "failed",
        expectedFinishedOutcomeKind: "invocation_failure",
      },
      {
        label: "no-work",
        bindings: simulatedBindings(["no-work"], { artifactPath: "proof.txt", emitArtifact: true }),
        expectedResultKind: "complete",
        expectedBoundaryOutcomeKind: "no-work",
        expectedFinishedOutcomeKind: "complete",
      },
    ];

    for (const testCase of cases) {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const sink = new TestLogSink();

      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: testCase.bindings,
        logSink: sink,
      });

      expect(result.kind).toBe(testCase.expectedResultKind);

      const events = sink.getEventsForRun(result.runId);
      const boundaryEvent = events[2];
      expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.outcomeKind).toBe(
        testCase.expectedBoundaryOutcomeKind,
      );
      if (testCase.expectedBoundaryRunStatus) {
        expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.runStatus).toBe(
          testCase.expectedBoundaryRunStatus,
        );
      }

      const finishedEvent = events.find((e: LogEvent) => e.kind === "loop_finished");
      expect(finishedEvent?.kind === "loop_finished" && finishedEvent.loopOutcomeKind).toBe(
        testCase.expectedFinishedOutcomeKind,
      );
    }
  });

  test("budget soft-stop emits no terminal boundary_committed; last boundary has progress outcome", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 2,
      logSink: sink,
    });

    expect(result.kind).toBe("budget-exhausted");

    const events = sink.getEventsForRun(result.runId);
    // Should be: iteration_started, iteration_commit, boundary_committed (progress),
    // iteration_started, iteration_commit, boundary_committed (progress), loop_finished
    expect(events.length).toBe(7);

    const lastBoundary = events[5];
    expect(lastBoundary?.kind === "boundary_committed" && lastBoundary.outcomeKind).toBe("progress");
    expect(lastBoundary?.kind === "boundary_committed" && lastBoundary.runStatus).toBe("in-progress");

    const finished = events[6];
    expect(finished?.kind === "loop_finished" && finished.loopOutcomeKind).toBe("budget-exhausted");
    expect(finished?.kind === "loop_finished" && finished.resumable).toBe(true);
    expect(finished?.kind === "loop_finished" && finished.iterationsConsumed).toBe(2);
  });

  test("a second invocation on a budget-soft-stopped run appends new events to the existing stream", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
      logSink: sink,
    });

    expect(first.kind).toBe("budget-exhausted");
    const firstEventCount = sink.getEventsForRun(first.runId).length;
    expect(firstEventCount).toBe(4); // iteration_started, iteration_commit, boundary_committed, loop_finished

    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      maxIterations: 1,
      logSink: sink,
    });

    expect(second.kind).toBe("complete");
    expect(second.runId).toBe(first.runId);

    const allEvents = sink.getEventsForRun(second.runId);
    expect(allEvents.length).toBeGreaterThan(firstEventCount);
    // Should have: first run's 4 events + second run's 4 events (iteration_started, iteration_commit,
    // boundary_committed, loop_finished) = 8 total
    expect(allEvents.length).toBe(8);
  });

  test("abort/cancellation stops the loop without committing the in-flight boundary, emitting matching events and state", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const controller = new AbortController();
    let calls = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "track",
        invoke: async () => {
          calls += 1;
          if (calls > 1) controller.abort();
          return { kind: "ok", stdout: "progress", stderr: "" };
        },
      },
    ];

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings,
      signal: controller.signal,
      logSink: sink,
    });

    expect(result.kind).toBe("progress");
    expect(result.iterationsConsumed).toBe(2);
    expect(result.resumable).toBe(true);

    const events = sink.getEventsForRun(result.runId);
    // Should have: iteration_started, iteration_commit, boundary_committed (completed),
    // iteration_started (aborted), iteration_commit (quiesced progress result, no_git skip),
    // loop_finished
    expect(events.length).toBe(6);
    expect(events[0]?.kind).toBe("iteration_started");
    expect(events[1]?.kind).toBe("iteration_commit");
    expect(events[2]?.kind).toBe("boundary_committed");
    expect(events[3]?.kind).toBe("iteration_started");
    expect(events[4]?.kind).toBe("iteration_commit");
    expect(events[5]?.kind).toBe("loop_finished");
    expect(events[5]?.kind === "loop_finished" && events[5].loopOutcomeKind).toBe("progress");
    expect(events[5]?.kind === "loop_finished" && events[5].iterationsConsumed).toBe(2);

    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run?.attempts).toHaveLength(2);
    expect(run?.attempts[0]?.status).toBe("completed");
    expect(run?.attempts[1]?.status).toBe("in-progress");
  });

  test("re-invoking a run whose terminal boundary is already committed returns prior outcome without appending log events", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      logSink: sink,
    });

    expect(first.kind).toBe("complete");
    const _firstEventCount = sink.getEventsForRun(first.runId).length;

    const sink2 = new TestLogSink();
    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      logSink: sink2,
    });

    expect(second.kind).toBe("complete");
    expect(second.runId).toBe(first.runId);

    const secondRunEvents = sink2.getEventsForRun(second.runId);
    expect(secondRunEvents.length).toBe(0); // No events appended on idempotent re-entry
  });

  test("a throwing log sink causes executeWriteLoop to reject", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    sink.shouldThrow = true;

    await expect(
      runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["progress"]),
        logSink: sink,
      }),
    ).rejects.toThrow("Simulated append error");
  });

  test("resuming a paused run starts a fresh attempt and continues", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    // First run: two progress attempts, then the harness parks the row paused.
    const pauseResult = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "pause-run",
      bindings: simulatedBindings(["progress"]),
      maxIterations: 2,
    });
    expect(pauseResult.iterationsConsumed).toBe(2);
    const pausingStore = openStateStore(stateDbPath);
    pausingStore.setRunStatus(pauseResult.runId, "paused");
    pausingStore.close();

    // Verify paused status
    let run = loadRunOnce(stateDbPath, pauseResult.runId);
    expect(run?.status).toBe("paused");
    expect(run?.attemptCount).toBe(2);
    expect(run?.branch).toBe("pause-run");

    // Resume the run with a completing binding on the same branch
    const resumeResult = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "pause-run",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      maxIterations: 1,
    });

    expect(resumeResult.kind).toBe("complete");
    expect(resumeResult.iterationsConsumed).toBe(1); // Fresh attempt
    expect(resumeResult.runId).toBe(pauseResult.runId);

    // Verify a new attempt was created
    run = loadRunOnce(stateDbPath, pauseResult.runId);
    expect(run?.status).toBe("completed");
    expect(run?.attemptCount).toBe(3); // Two paused + one new
    expect(run?.attempts).toHaveLength(3);
    expect(run?.attempts[2]?.outcomeKind).toBe("done");
  });
});
