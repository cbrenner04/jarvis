import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import type { LogEvent, LogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import type { BindingAttemptSummary, InvocationFailureKind } from "./invocation-failure.ts";
import { executeWriteLoop, type WriteLoopInput } from "./write-loop.ts";

const { roots } = trackedTempRoots();

/** Test log sink that captures all events. */
class TestLogSink implements LogSink {
  events: Array<{ runId: string; event: LogEvent }> = [];
  shouldThrow = false;

  append(runId: string, event: LogEvent): void {
    if (this.shouldThrow) {
      throw new Error("Simulated append error");
    }
    this.events.push({ runId, event });
  }

  close(): void {
    // no-op
  }

  getEventsForRun(runId: string): LogEvent[] {
    return this.events.filter((e) => e.runId === runId).map((e) => e.event);
  }
}

async function runLoop(args: {
  jarvisRoot: string;
  stateDbPath: string;
  bindings: readonly InvocationBinding[];
  maxIterations?: number;
  artifactPath?: string;
  signal?: AbortSignal;
  branchName?: string;
  baseRef?: string;
  specPath?: string;
  store?: StateStore;
  logSink?: LogSink;
}) {
  // Track the parent directory for cleanup
  roots.push(join(args.jarvisRoot, ".."));
  const store = args.store ?? openStateStore(args.stateDbPath);
  const loopInput: WriteLoopInput = {
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: args.branchName ?? "write-run",
      baseRef: args.baseRef ?? "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    specPath: args.specPath ?? "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: args.artifactPath ?? "proof.txt",
    bindings: args.bindings,
    stateStore: store,
    withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
  };
  if (args.maxIterations !== undefined) {
    loopInput.maxIterations = args.maxIterations;
  }
  if (args.signal !== undefined) {
    loopInput.signal = args.signal;
  }
  if (args.logSink !== undefined) {
    loopInput.logSink = args.logSink;
  }
  try {
    return await executeWriteLoop(loopInput);
  } finally {
    store.close();
  }
}

async function runLoopWithPause(args: {
  jarvisRoot: string;
  stateDbPath: string;
  bindings: readonly InvocationBinding[];
  maxIterations?: number;
  pauseAfterAttempts?: number;
  logSink?: LogSink;
}) {
  // Track the parent directory for cleanup
  roots.push(join(args.jarvisRoot, ".."));
  const store = openStateStore(args.stateDbPath);
  const pauseController = new AbortController();
  let attempts = 0;
  const pausingBindings = args.bindings.map((binding) => ({
    id: binding.id,
    invoke: async (input: Parameters<typeof binding.invoke>[0]) => {
      attempts += 1;
      if (args.pauseAfterAttempts && attempts > args.pauseAfterAttempts) {
        pauseController.abort();
      }
      return binding.invoke(input);
    },
  }));

  const loopInput: WriteLoopInput = {
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: "pause-run",
      baseRef: "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: "proof.txt",
    bindings: pausingBindings,
    stateStore: store,
    pauseSignal: pauseController.signal,
    withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
  };
  if (args.maxIterations !== undefined) {
    loopInput.maxIterations = args.maxIterations;
  }
  if (args.logSink !== undefined) {
    loopInput.logSink = args.logSink;
  }
  try {
    return await executeWriteLoop(loopInput);
  } finally {
    store.close();
  }
}

function loadRunOnce(stateDbPath: string, runId: string) {
  const store = openStateStore(stateDbPath);
  try {
    return store.loadRun(runId);
  } finally {
    store.close();
  }
}

/** Wrap a store so the first completion boundary fails mid-transaction. */
function crashOnceMidBoundary(inner: StateStore): StateStore {
  let crashed = false;
  return {
    createRun: (args) => inner.createRun(args),
    loadRun: (runId) => inner.loadRun(runId),
    findRunByProjectBranch: (args) => inner.findRunByProjectBranch(args),
    recordAttemptStart: (runId) => inner.recordAttemptStart(runId),
    setRunStatus: (runId, status) => inner.setRunStatus(runId, status),
    listRuns: () => inner.listRuns(),
    close: () => inner.close(),
    commitCompletionBoundary: (args) => {
      if (crashed) return inner.commitCompletionBoundary(args);
      crashed = true;
      inner.commitCompletionBoundary({
        ...args,
        beforeRunUpdate: () => {
          throw new Error("crash mid-boundary");
        },
      });
    },
  };
}

/** Bindings that report `progress` n times, then write the artifact and report `done`. */
function progressThenDone(n: number): InvocationBinding[] {
  let calls = 0;
  return [
    {
      id: "agent",
      invoke: async ({ cwd }) => {
        calls += 1;
        if (calls <= n) return { kind: "ok", stdout: "progress", stderr: "" };
        writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" };
      },
    },
  ];
}

describe("write loop", () => {
  test("calls executeWrite repeatedly until terminal", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: progressThenDone(2) });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(3);
    expect(result.resumable).toBe(false);
  });

  test("progress loops again and artifact contract not checked mid-loop", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 3,
    });

    // Progress doesn't check contract, so we loop until budget exhausted
    expect(result.kind).toBe("budget-exhausted");
    expect(result.iterationsConsumed).toBe(3);
  });

  test("done with passing artifact contract ends loop successfully", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(1);
  });

  test("no-work with passing artifact contract ends loop successfully", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["no-work"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(1);
    expect(loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.outcomeKind).toBe("no-work");
  });

  test("done/no-work with failing contract appends blocker and stops", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: false }),
    });

    expect(result.kind).toBe("contract_miss");
    expect(result.iterationsConsumed).toBe(1);

    const spec = readFileSync(join(jarvisRoot, "worktrees", "demo", "write-run", "spec.md"), "utf8");
    expect(spec).toContain("## Blocker");
    expect(spec).toContain("artifact.exists");
  });

  test("blocked stops immediately with distinct outcome", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: simulatedBindings(["blocked"]) });

    expect(result.kind).toBe("blocked");
    expect(result.iterationsConsumed).toBe(1);
    expect(result.resumable).toBe(false);
  });

  test("budget exhausted while progress yields soft-stop outcome", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      maxIterations: 2,
    });

    expect(result.kind).toBe("budget-exhausted");
    expect(result.iterationsConsumed).toBe(2);
    expect(result.resumable).toBe(true);
  });

  test("binding-chain invocation failures report failureKind and bindingAttempts", async () => {
    const cases: Array<{
      branchName: string;
      bindings: readonly InvocationBinding[];
      failureKind: InvocationFailureKind;
      bindingAttempts: BindingAttemptSummary[];
    }> = [
      {
        branchName: "quota-run",
        bindings: simulatedBindings(["quota", "quota"]),
        failureKind: "quota",
        bindingAttempts: [
          { bindingId: "sim.1", resultKind: "quota" },
          { bindingId: "sim.2", resultKind: "quota" },
        ],
      },
      {
        branchName: "model-config-run",
        bindings: simulatedBindings(["quota", "model_config"]),
        failureKind: "model_config",
        bindingAttempts: [
          { bindingId: "sim.1", resultKind: "quota" },
          { bindingId: "sim.2", resultKind: "model_config" },
        ],
      },
      {
        branchName: "error-run",
        bindings: simulatedBindings(["error"]),
        failureKind: "error",
        bindingAttempts: [{ bindingId: "sim.1", resultKind: "error" }],
      },
      {
        branchName: "no-binding-run",
        bindings: [] as InvocationBinding[],
        failureKind: "no_binding" as const,
        bindingAttempts: [],
      },
    ];

    for (const testCase of cases) {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName: testCase.branchName,
        bindings: testCase.bindings,
      });

      expect(result.kind).toBe("invocation_failure");
      expect(result.resumable).toBe(false);
      expect(result.failureKind).toBe(testCase.failureKind);
      expect(result.bindingAttempts).toEqual(testCase.bindingAttempts);
    }
  });

  const invalidTokenBindings: InvocationBinding[] = [
    {
      id: "agent",
      invoke: async () => ({ kind: "ok", stdout: "not a terminal token", stderr: "" }),
    },
  ];

  test("invalid_token omits failureKind and bindingAttempts", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: invalidTokenBindings });

    expect(result.kind).toBe("invocation_failure");
    expect(result.failureKind).toBeUndefined();
    expect(result.bindingAttempts).toBeUndefined();
    expect(loadRunOnce(stateDbPath, result.runId)?.attempts[0]?.outcomeKind).toBe("invalid_token");
  });

  test("complete, blocked, contract_miss, and budget-exhausted omit failure detail", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const complete = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });
    expect(complete.failureKind).toBeUndefined();

    const blocked = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "blocked-run",
      bindings: simulatedBindings(["blocked"]),
    });
    expect(blocked.failureKind).toBeUndefined();

    const contractMiss = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "contract-miss-run",
      bindings: simulatedBindings(["done"]),
    });
    expect(contractMiss.failureKind).toBeUndefined();

    const budget = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "budget-run",
      bindings: simulatedBindings(["progress"]),
      maxIterations: 1,
    });
    expect(budget.failureKind).toBeUndefined();
  });

  test("re-invoking binding-chain invocation_failure returns persisted detail without a new attempt", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["quota", "model_config"]),
    });

    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(second.kind).toBe("invocation_failure");
    expect(second.runId).toBe(first.runId);
    expect(second.failureKind).toBe("model_config");
    expect(second.bindingAttempts).toEqual(first.bindingAttempts);
    expect(loadRunOnce(stateDbPath, first.runId)?.attemptCount).toBe(1);
  });

  test("pre-migration failed run resumes invocation_failure without failure detail", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const store = openStateStore(stateDbPath);
    const runId = store.createRun({
      project: "demo",
      specRef: "HEAD",
      worktreePath: join(jarvisRoot, "worktrees", "demo", "legacy-run"),
      branch: "legacy-run",
      specPath: "spec.md",
    });
    const attemptId = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: "invocation_failure",
    });
    store.close();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "legacy-run",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(result.kind).toBe("invocation_failure");
    expect(result.failureKind).toBeUndefined();
    expect(result.bindingAttempts).toBeUndefined();
  });

  test("invalid_token idempotent re-entry omits failure detail", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: invalidTokenBindings,
      branchName: "invalid-token-run",
    });
    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "invalid-token-run",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(second.kind).toBe("invocation_failure");
    expect(second.failureKind).toBeUndefined();
    expect(second.bindingAttempts).toBeUndefined();
    expect(second.runId).toBe(first.runId);
  });

  test("max iterations per-invocation with default constant", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: simulatedBindings(["progress"]) });

    expect(result.iterationsConsumed).toBe(10); // Default max
    expect(result.kind).toBe("budget-exhausted");
  });

  test("cancellation propagates via AbortSignal", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
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

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings, signal: controller.signal });

    expect(result.kind).toBe("progress");
    expect(result.iterationsConsumed).toBe(2);
    expect(result.resumable).toBe(true);
  });

  test("each iteration persists through state store boundary", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: progressThenDone(2) });

    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run).not.toBeNull();
    expect(run?.attempts.length).toBe(3);
  });

  test("re-invoking an interrupted run re-runs that iteration over the dirty worktree", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const dirtiedMarker = "dirty.txt";
    let firstRunCalls = 0;
    const crashBindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          firstRunCalls += 1;
          writeFileSync(join(cwd, dirtiedMarker), "dirty\n", "utf8");
          throw new Error("simulated crash");
        },
      },
    ];

    await expect(runLoop({ jarvisRoot, stateDbPath, bindings: crashBindings, maxIterations: 1 })).rejects.toThrow(
      "simulated crash",
    );
    expect(firstRunCalls).toBe(1);

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

    const resumed = await runLoop({ jarvisRoot, stateDbPath, bindings: resumeBindings, maxIterations: 1 });

    expect(resumed.kind).toBe("complete");
    expect(resumed.iterationsConsumed).toBe(1);
    expect(resumedCalls).toBe(1);

    const run = loadRunOnce(stateDbPath, resumed.runId);
    expect(run?.attemptCount).toBe(1);
    expect(run?.attempts).toHaveLength(1);
    expect(run?.attempts[0]?.outcomeKind).toBe("done");
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

  test("re-running a boundary that fails mid-transaction retries the same attempt without duplicate history", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
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
    });

    expect(resumed.kind).toBe("complete");
    expect(resumed.iterationsConsumed).toBe(1);
    expect(resumedCalls).toBe(1);

    const run = loadRunOnce(stateDbPath, resumed.runId);
    expect(run?.attemptCount).toBe(1);
    expect(run?.attempts).toHaveLength(1);
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
    expect(events.length).toBe(7); // 3 iteration_started, 3 boundary_committed, 1 loop_finished

    expect(events[0]?.kind).toBe("iteration_started");
    expect(events[1]?.kind).toBe("boundary_committed");
    expect(events[2]?.kind).toBe("iteration_started");
    expect(events[3]?.kind).toBe("boundary_committed");
    expect(events[4]?.kind).toBe("iteration_started");
    expect(events[5]?.kind).toBe("boundary_committed");
    expect(events[6]?.kind).toBe("loop_finished");
    expect(events[6]?.kind === "loop_finished" && events[6].loopOutcomeKind).toBe("complete");
    expect(events[6]?.kind === "loop_finished" && events[6].iterationsConsumed).toBe(3);
  });

  test("terminal boundary_committed and loop_finished payloads match terminalMapping for blocked outcome", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["blocked"]),
      logSink: sink,
    });

    expect(result.kind).toBe("blocked");

    const events = sink.getEventsForRun(result.runId);
    const boundaryEvent = events[1];
    expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.outcomeKind).toBe("blocked");
    expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.runStatus).toBe("blocked");

    const finishedEvent = events[2];
    expect(finishedEvent?.kind === "loop_finished" && finishedEvent.loopOutcomeKind).toBe("blocked");
  });

  test("terminal boundary_committed and loop_finished payloads match terminalMapping for contract_miss outcome", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: false }),
      logSink: sink,
    });

    expect(result.kind).toBe("contract_miss");

    const events = sink.getEventsForRun(result.runId);
    const boundaryEvent = events[1];
    expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.outcomeKind).toBe("contract_miss");
    expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.runStatus).toBe("blocked");

    const finishedEvent = events[2];
    expect(finishedEvent?.kind === "loop_finished" && finishedEvent.loopOutcomeKind).toBe("contract_miss");
  });

  test("terminal boundary_committed and loop_finished payloads match terminalMapping for invocation_failure outcome", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["quota", "quota"]),
      logSink: sink,
    });

    expect(result.kind).toBe("invocation_failure");

    const events = sink.getEventsForRun(result.runId);
    const boundaryEvent = events[1];
    expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.outcomeKind).toBe("invocation_failure");
    expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.runStatus).toBe("failed");

    const finishedEvent = events[2];
    expect(finishedEvent?.kind === "loop_finished" && finishedEvent.loopOutcomeKind).toBe("invocation_failure");
  });

  test("terminal boundary_committed and loop_finished payloads match terminalMapping for no-work outcome", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["no-work"], { artifactPath: "proof.txt", emitArtifact: true }),
      logSink: sink,
    });

    expect(result.kind).toBe("complete");

    const events = sink.getEventsForRun(result.runId);
    const boundaryEvent = events[1];
    expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.outcomeKind).toBe("no-work");

    const finishedEvent = events[2];
    expect(finishedEvent?.kind === "loop_finished" && finishedEvent.loopOutcomeKind).toBe("complete");
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
    // Should be: iteration_started, boundary_committed (progress), iteration_started, boundary_committed (progress), loop_finished
    expect(events.length).toBe(5);

    const lastBoundary = events[3];
    expect(lastBoundary?.kind === "boundary_committed" && lastBoundary.outcomeKind).toBe("progress");
    expect(lastBoundary?.kind === "boundary_committed" && lastBoundary.runStatus).toBe("in-progress");

    const finished = events[4];
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
    expect(firstEventCount).toBe(3); // iteration_started, boundary_committed, loop_finished

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
    // Should have: first run's 3 events + second run's 3 events = 6 total
    expect(allEvents.length).toBe(6);
  });

  test("kill/crash resume re-run emits a fresh iteration_started for the interrupted attempt", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const dirtiedMarker = "dirty.txt";
    let _firstRunCalls = 0;
    const crashBindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          _firstRunCalls += 1;
          writeFileSync(join(cwd, dirtiedMarker), "dirty\n", "utf8");
          throw new Error("simulated crash");
        },
      },
    ];

    await expect(
      runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: crashBindings,
        maxIterations: 1,
        logSink: sink,
      }),
    ).rejects.toThrow("simulated crash");

    let resumedCalls = 0;
    const resumeBindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          resumedCalls += 1;
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
    expect(resumedCalls).toBe(1);

    const events = sink.getEventsForRun(resumed.runId);
    // Should have: iteration_started (from first crash), iteration_started (from retry), boundary_committed, loop_finished
    expect(events.length).toBe(4);
    expect(events[0]?.kind).toBe("iteration_started");
    expect(events[1]?.kind).toBe("iteration_started");
    expect(events[2]?.kind).toBe("boundary_committed");
    expect(events[3]?.kind).toBe("loop_finished");

    // Verify same attemptId across the crash and resume
    const firstAttemptId = events[0]?.kind === "iteration_started" ? events[0].attemptId : undefined;
    const resumedAttemptId = events[1]?.kind === "iteration_started" ? events[1].attemptId : undefined;
    expect(firstAttemptId).toBeDefined();
    expect(resumedAttemptId).toBeDefined();
    expect(resumedAttemptId).toBe(firstAttemptId);
  });

  test("mid-boundary rollback emits iteration_started, no boundary_committed on failed attempt, retry with same attemptId, then success", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    let _firstInvocationCalls = 0;
    const completeBindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          _firstInvocationCalls += 1;
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

    let _resumedCalls = 0;
    const resumed = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "agent",
          invoke: async () => {
            _resumedCalls += 1;
            return { kind: "ok", stdout: "done", stderr: "" };
          },
        },
      ],
      maxIterations: 1,
      logSink: sink,
    });

    expect(resumed.kind).toBe("complete");

    const events = sink.getEventsForRun(resumed.runId);
    // Should have: iteration_started (failed), iteration_started (retry with same attemptId), boundary_committed (success), loop_finished
    expect(events.length).toBe(4);
    expect(events[0]?.kind).toBe("iteration_started");
    expect(events[1]?.kind).toBe("iteration_started");
    expect(events[2]?.kind).toBe("boundary_committed");
    expect(events[3]?.kind).toBe("loop_finished");

    // Verify same attemptId on both iteration_started events
    const firstAttemptId = events[0]?.kind === "iteration_started" ? events[0].attemptId : undefined;
    const retryAttemptId = events[1]?.kind === "iteration_started" ? events[1].attemptId : undefined;
    expect(firstAttemptId).toBeDefined();
    expect(retryAttemptId).toBeDefined();
    expect(retryAttemptId).toBe(firstAttemptId);
  });

  test("abort/cancellation emits paired iteration_started / boundary_committed for each completed iteration plus loop_finished", async () => {
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

    const events = sink.getEventsForRun(result.runId);
    // Should have: iteration_started, boundary_committed (completed), iteration_started (aborted, no boundary), loop_finished
    expect(events.length).toBe(4);
    expect(events[0]?.kind).toBe("iteration_started");
    expect(events[1]?.kind).toBe("boundary_committed");
    expect(events[2]?.kind).toBe("iteration_started");
    expect(events[3]?.kind).toBe("loop_finished");
    expect(events[3]?.kind === "loop_finished" && events[3].loopOutcomeKind).toBe("progress");
    expect(events[3]?.kind === "loop_finished" && events[3].iterationsConsumed).toBe(2);
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

  test("omitting the log sink leaves loop behavior unchanged", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: progressThenDone(2),
    });

    expect(result.kind).toBe("complete");
    expect(result.iterationsConsumed).toBe(3);
    expect(result.resumable).toBe(false);
  });

  test("pause at iteration boundary lets the in-flight step finish and commit its boundary", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const dirtiedMarker = "paused.txt";
    let attempts = 0;
    const bindings: InvocationBinding[] = [
      {
        id: "agent",
        invoke: async ({ cwd }) => {
          attempts += 1;
          writeFileSync(join(cwd, dirtiedMarker), `attempt-${attempts}\n`, "utf8");
          return { kind: "ok", stdout: "progress", stderr: "" };
        },
      },
    ];

    const result = await runLoopWithPause({
      jarvisRoot,
      stateDbPath,
      bindings,
      pauseAfterAttempts: 2,
      maxIterations: 10,
    });

    expect(result.kind).toBe("paused");
    expect(result.iterationsConsumed).toBe(3);
    expect(result.resumable).toBe(true);

    // Verify the second attempt completed and persisted
    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run?.status).toBe("paused");
    expect(run?.attemptCount).toBe(3); // Three completed attempts
    const lastAttempt = run?.attempts[run.attempts.length - 1];
    expect(lastAttempt?.status).toBe("completed");
    expect(lastAttempt?.outcomeKind).toBe("progress");

    // Verify the marker was written
    const markerPath = join(jarvisRoot, "worktrees", "demo", "pause-run", dirtiedMarker);
    expect(existsSync(markerPath)).toBe(true);
    expect(readFileSync(markerPath, "utf8")).toBe("attempt-3\n");
  });

  test("paused run outcome kind is distinct from budget-exhausted", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoopWithPause({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      pauseAfterAttempts: 1,
      maxIterations: 10,
      logSink: sink,
    });

    expect(result.kind).toBe("paused");

    const events = sink.getEventsForRun(result.runId);
    const finishedEvent = events[events.length - 1];
    expect(finishedEvent?.kind === "loop_finished" && finishedEvent.loopOutcomeKind).toBe("paused");
    expect(finishedEvent?.kind === "loop_finished" && finishedEvent.resumable).toBe(true);
  });

  test("resuming a paused run starts a fresh attempt and continues", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    // First run: pause after 1 attempt
    const pauseResult = await runLoopWithPause({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["progress"]),
      pauseAfterAttempts: 1,
      maxIterations: 10,
    });

    expect(pauseResult.kind).toBe("paused");
    expect(pauseResult.iterationsConsumed).toBe(2);

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

  test("abort signal path unchanged: aborts stop the loop without committing the in-flight boundary", async () => {
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

    // Verify the first attempt's boundary was committed, but not the aborted one
    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run?.attempts).toHaveLength(2);
    expect(run?.attempts[0]?.status).toBe("completed");
    expect(run?.attempts[1]?.status).toBe("in-progress"); // Aborted mid-step, boundary not committed

    const events = sink.getEventsForRun(result.runId);
    const finishedEvent = events[events.length - 1];
    expect(finishedEvent?.kind === "loop_finished" && finishedEvent.loopOutcomeKind).toBe("progress");
  });
});
