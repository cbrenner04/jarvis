import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { InvocationBinding, InvocationCompletedRecord } from "../../../shared/invocation/execute.ts";
import type { LogEvent, LogSink } from "../persistence/log-stream.ts";
import { type OutcomeKind, openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { stubAgentModelConfig } from "../testing/cli-test-helpers.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import type { BindingAttemptSummary, InvocationFailureKind } from "./invocation-failure.ts";
import { renderAttribution } from "./pr-attribution.ts";
import { gateFailureOutput, initGateScopeWorktree } from "./ready-finalize.test.ts";
import {
  deriveGateAllowedPaths,
  ReadyFlipError,
  ReadyGateError,
  RuntimeSmokeFailedError,
  SurvivingMutationError,
} from "./ready-finalize.ts";
import type { SmokePass } from "./runtime-smoke-verifier.ts";
import type { StepRunResult } from "./step-runner.ts";
import type { WorkBoundaryRecordedRecord } from "./work-boundary-telemetry.ts";
import { executeWrite as realExecuteWrite, type WriteExecuteInput } from "./write.ts";
import {
  appendRuntimeSmokeOutcome,
  compareRepoPathsByUtf8Bytes,
  enumerateRepairCompletionCandidates,
  escapeRepoPathForEvidence,
  executeWriteLoop,
  findFirstRepairFenceViolation,
  persistRetainedFinalizationCheckpoint,
  resolveIterationSettlementKind,
  runMutationRepairIteration,
  shouldFailTerminalCompletionForDirtyWorktree,
  type WallSegmentSchedule,
  type WriteLoopInput,
  type WriteLoopOutcomeKind,
} from "./write-loop.ts";

const { roots } = trackedTempRoots();

function loopTelemetry(sinkPath: string): NonNullable<WriteLoopInput["telemetry"]> {
  return {
    sinkPath,
    operatorSessionId: "session-1",
    workflow: "write",
    role: "implement",
  };
}

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

/**
 * A `schedule` seam that never auto-fires; the test drives `fire()` explicitly. Tracks every
 * registration so repeated `bumpWallSegment` cancel/reschedule calls (not just the first
 * registration) are each independently cancellable and observable.
 */
function createManualWallSchedule(): {
  schedule: WallSegmentSchedule;
  waitForSchedule: () => Promise<void>;
  fire: () => void;
  registrationCount: () => number;
  cancelledCount: () => number;
} {
  type Registration = { fire: () => void; cancelled: boolean };
  const registrations: Registration[] = [];
  let notifyRegistered: (() => void) | undefined;

  const schedule: WallSegmentSchedule = (fire) => {
    const registration: Registration = { fire, cancelled: false };
    registrations.push(registration);
    notifyRegistered?.();
    return { cancel: () => (registration.cancelled = true) };
  };

  const waitForSchedule = () =>
    registrations.length > 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          notifyRegistered = resolve;
        });

  return {
    schedule,
    waitForSchedule,
    fire: () => {
      const latest = registrations[registrations.length - 1];
      if (latest !== undefined && !latest.cancelled) latest.fire();
    },
    registrationCount: () => registrations.length,
    cancelledCount: () => registrations.filter((r) => r.cancelled).length,
  };
}

function createHeldInvocation() {
  let signal: AbortSignal | undefined;
  let resolveStarted: (() => void) | undefined;
  let releaseProcess: (() => void) | undefined;
  let processSettled = false;
  let invocationSettled = false;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const process = new Promise<void>((resolve) => {
    releaseProcess = resolve;
  });

  return {
    started,
    invoke(invocationSignal: AbortSignal | undefined) {
      signal = invocationSignal;
      resolveStarted?.();
      return process
        .then(() => {
          processSettled = true;
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        })
        .finally(() => {
          invocationSettled = true;
        });
    },
    release: () => releaseProcess?.(),
    get signal() {
      return signal;
    },
    get processSettled() {
      return processSettled;
    },
    get invocationSettled() {
      return invocationSettled;
    },
  };
}

/**
 * Drives one iteration to settlement via the injected schedule seam: no bare setTimeout races the
 * watchdog. "abort-first" calls abort(), flushes its microtask settlement, then fires the watchdog
 * synchronously. "watchdog-first" fires the watchdog synchronously, then calls abort().
 */
async function runAbortWatchdogOrdering(args: {
  jarvisRoot: string;
  stateStore: StateStore;
  order: "abort-first" | "watchdog-first";
  branchName: string;
  invertPrecedence?: boolean;
}) {
  const controller = new AbortController();
  const manual = createManualWallSchedule();
  const resultPromise = executeWriteLoop({
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: args.branchName,
      baseRef: "HEAD",
      jarvisRoot: args.jarvisRoot,
    },
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: "proof.txt",
    bindings: simulatedBindings(["done"]),
    stateStore: args.stateStore,
    withExternalWorktree: createFakeWithExternalWorktree(args.jarvisRoot),
    sessionsDir: join(args.jarvisRoot, "sessions"),
    signal: controller.signal,
    iterationTimeoutMs: 1_000_000,
    schedule: manual.schedule,
    ...(args.invertPrecedence !== undefined ? { invertAbortWatchdogPrecedenceForTest: args.invertPrecedence } : {}),
  });
  await manual.waitForSchedule();
  if (args.order === "abort-first") {
    controller.abort();
    // Abort settles via a single `queueMicrotask` hop (write-loop.ts `resolveAbort`); two
    // microtask flushes guarantee that settlement is observable before the watchdog fires.
    await Promise.resolve();
    await Promise.resolve();
    manual.fire();
  } else {
    manual.fire();
    controller.abort();
  }
  return resultPromise;
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
  telemetry?: WriteLoopInput["telemetry"];
  completionCommitter?: WriteLoopInput["completionCommitter"];
  completionPublisher?: WriteLoopInput["completionPublisher"];
  readyFinalizer?: WriteLoopInput["readyFinalizer"];
  invertReadyGateRepairFenceForTest?: boolean;
  invertReadyGateRepairSidecarFenceForTest?: boolean;
  bypassPersistedReadyGateRepairFenceForTest?: boolean;
  stepId?: string;
  workflowSnapshot?: WriteLoopInput["workflowSnapshot"];
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
    sessionsDir: join(args.jarvisRoot, "sessions"),
    ...(args.maxIterations !== undefined ? { maxIterations: args.maxIterations } : {}),
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    ...(args.logSink !== undefined ? { logSink: args.logSink } : {}),
    ...(args.telemetry !== undefined ? { telemetry: args.telemetry } : {}),
    ...(args.completionCommitter !== undefined ? { completionCommitter: args.completionCommitter } : {}),
    ...(args.completionPublisher !== undefined ? { completionPublisher: args.completionPublisher } : {}),
    ...(args.readyFinalizer !== undefined ? { readyFinalizer: args.readyFinalizer } : {}),
    ...(args.invertReadyGateRepairFenceForTest !== undefined
      ? { invertReadyGateRepairFenceForTest: args.invertReadyGateRepairFenceForTest }
      : {}),
    ...(args.invertReadyGateRepairSidecarFenceForTest !== undefined
      ? { invertReadyGateRepairSidecarFenceForTest: args.invertReadyGateRepairSidecarFenceForTest }
      : {}),
    ...(args.bypassPersistedReadyGateRepairFenceForTest !== undefined
      ? { bypassPersistedReadyGateRepairFenceForTest: args.bypassPersistedReadyGateRepairFenceForTest }
      : {}),
    ...(args.stepId !== undefined ? { stepId: args.stepId } : {}),
    ...(args.workflowSnapshot !== undefined ? { workflowSnapshot: args.workflowSnapshot } : {}),
  };
  try {
    return await executeWriteLoop(loopInput);
  } finally {
    store.close();
  }
}

function writeSpecIndex(jarvisRoot: string, branchName: string, content: string): void {
  const specDir = join(jarvisRoot, "worktrees", "demo", branchName, "spec");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "index.md"), content, "utf8");
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
    sessionsDir: join(args.jarvisRoot, "sessions"),
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

function loadTelemetryRows(path: string): InvocationCompletedRecord[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as InvocationCompletedRecord);
}

function loadWorkBoundaryRows(path: string): WorkBoundaryRecordedRecord[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as WorkBoundaryRecordedRecord)
    .filter((row) => row.record_kind === "work_boundary_recorded");
}

/** Wrap a store so the first completion boundary fails mid-transaction. */
function crashOnceMidBoundary(inner: StateStore): StateStore {
  let crashed = false;
  return {
    createRun: (args) => inner.createRun(args),
    setCreationTitle: (runId, title) => inner.setCreationTitle(runId, title),
    setRunSpecPath: (runId, specPath) => inner.setRunSpecPath(runId, specPath),
    setPrEvidence: (runId, prNumber, prUrl) => inner.setPrEvidence(runId, prNumber, prUrl),
    setReadyGateRepairFence: (runId, fence) => inner.setReadyGateRepairFence(runId, fence),
    setRetainedFinalizationCheckpoint: (runId, checkpoint) =>
      inner.setRetainedFinalizationCheckpoint(runId, checkpoint),
    loadRun: (runId) => inner.loadRun(runId),
    findRunByProjectBranch: (args) => inner.findRunByProjectBranch(args),
    findReviewMutationLineageRows: (args) => inner.findReviewMutationLineageRows(args),
    findRunsByInvocationId: (invocationId) => inner.findRunsByInvocationId(invocationId),
    createPipeline: (args) => inner.createPipeline(args),
    createPipelineStageBranch: (args) => inner.createPipelineStageBranch(args),
    loadPipeline: (pipelineId) => inner.loadPipeline(pipelineId),
    listPipelines: () => inner.listPipelines(),
    updateStage: (args) => inner.updateStage(args),
    commitApprovalBoundary: (args) => inner.commitApprovalBoundary(args),
    commitApprovalDecision: (args) => inner.commitApprovalDecision(args),
    claimPipelineContinuation: (args) => inner.claimPipelineContinuation(args),
    reopenFailedPipeline: (args) => inner.reopenFailedPipeline(args),
    commitTerminalPublicationFailure: (args) => inner.commitTerminalPublicationFailure(args),
    commitTerminalPublicationSuccess: (args) => inner.commitTerminalPublicationSuccess(args),
    recordAttemptStart: (runId) => inner.recordAttemptStart(runId),
    setRunStatus: (runId, status) => inner.setRunStatus(runId, status),
    commitGuardedKill: (runId) => inner.commitGuardedKill(runId),
    beginRunReconciliation: () => inner.beginRunReconciliation(),
    finishRunReconciliation: (runId) => inner.finishRunReconciliation(runId),
    reconcilePipelines: () => inner.reconcilePipelines(),
    listRuns: () => inner.listRuns(),
    hasQueuedRun: (args) => inner.hasQueuedRun(args),
    listQueuedRuns: () => inner.listQueuedRuns(),
    isClosed: () => inner.isClosed(),
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
  beforeEach(() => {
    mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
  });

  afterEach(() => {
    mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
  });

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

  test("contract_miss appends contract_miss_detail to the observability log", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const missOutput = "claimed done without artifact";

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          invoke: async () => ({ kind: "ok", stdout: `${missOutput}\ndone`, stderr: "" }),
        },
      ],
      logSink: sink,
    });

    expect(result.kind).toBe("contract_miss");
    const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
    expect(events).toContain("contract_miss_detail");
    const detail = sink.getEventsForRun(result.runId).find((event) => event.kind === "contract_miss_detail");
    expect(detail).toMatchObject({
      kind: "contract_miss_detail",
      failedContractId: "artifact.exists",
      responseText: `${missOutput}\ndone`,
    });
  });

  test("contract_miss after token reprompt logs reprompt stdout in contract_miss_detail", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    let invocations = 0;
    const firstBody = "still working without a terminal token";
    const repromptBody = "done";

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          invoke: async () => {
            invocations += 1;
            return {
              kind: "ok",
              stdout: invocations === 1 ? firstBody : repromptBody,
              stderr: "",
            };
          },
        },
      ],
      logSink: sink,
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("contract_miss");
    const detail = sink.getEventsForRun(result.runId).find((event) => event.kind === "contract_miss_detail");
    expect(detail).toMatchObject({
      kind: "contract_miss_detail",
      responseText: repromptBody,
    });
    expect(detail && "responseText" in detail ? detail.responseText : "").not.toBe(firstBody);
  });

  test("contract_miss_detail truncates long invocation output like invalid_token_detail", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const longText = "a".repeat(600);

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "contract-miss-long-output",
      bindings: [
        {
          id: "sim.1",
          invoke: async () => ({ kind: "ok", stdout: `${longText}\ndone`, stderr: "" }),
        },
      ],
      logSink: sink,
    });

    expect(result.kind).toBe("contract_miss");
    const detail = sink.getEventsForRun(result.runId).find((event) => event.kind === "contract_miss_detail");
    const responseText = detail && "responseText" in detail ? detail.responseText : undefined;
    expect(responseText).toMatch(/^a+…$/);
    expect(responseText?.length).toBeLessThanOrEqual(501);
  });

  test("blocked with blocker text stops immediately with distinct outcome", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          invoke: async ({ cwd }) => {
            appendFileSync(join(cwd, "spec.md"), "\n## Blocker\n\nstuck\n", "utf8");
            return { kind: "ok", stdout: "blocked", stderr: "" };
          },
        },
      ],
    });

    expect(result.kind).toBe("blocked");
    expect(result.iterationsConsumed).toBe(1);
    expect(result.resumable).toBe(false);
  });

  test("blocked without blocker text triggers blocker re-prompt then missing_blocker", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    let invocations = 0;

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          invoke: async () => {
            invocations += 1;
            return {
              kind: "ok",
              stdout: invocations === 1 ? "blocked" : "still no blocker file",
              stderr: "",
            };
          },
        },
      ],
      logSink: sink,
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("invocation_failure");
    expect(result.resumable).toBe(true);
    expect(result.runStatus).toBe("paused");
    expect(result.outcomeKind).toBe("missing_blocker");
    const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
    expect(events).toContain("blocker_reprompt");
    expect(events).not.toContain("token_reprompt");
    expect(events).toContain("missing_blocker_detail");
    const detail = sink.getEventsForRun(result.runId).find((event) => event.kind === "missing_blocker_detail");
    expect(detail).toMatchObject({
      kind: "missing_blocker_detail",
      responseText: "still no blocker file",
    });
  });

  test("blocked reprompt that writes blocker text terminates as blocked", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    let invocations = 0;

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          invoke: async ({ cwd }) => {
            invocations += 1;
            if (invocations === 1) {
              return { kind: "ok", stdout: "blocked", stderr: "" };
            }
            appendFileSync(join(cwd, "spec.md"), "\n## Blocker\n\nexplained\n", "utf8");
            return { kind: "ok", stdout: "wrote blocker", stderr: "" };
          },
        },
      ],
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("blocked");
    expect(result.runStatus).toBe("blocked");
    expect(result.outcomeKind).toBe("blocked");
  });

  test("blocked outcome persists blocker text detail in run log", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    let invocations = 0;

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          invoke: async ({ cwd }) => {
            invocations += 1;
            appendFileSync(join(cwd, "spec.md"), "\n## Blocker\n\nWaiting for external API approval\n", "utf8");
            return { kind: "ok", stdout: "blocked", stderr: "" };
          },
        },
      ],
      logSink: sink,
    });

    expect(invocations).toBe(1);
    expect(result.kind).toBe("blocked");
    expect(result.runStatus).toBe("blocked");
    const events = sink.getEventsForRun(result.runId).map((event: LogEvent) => event.kind);
    expect(events).toContain("blocker_text_detail");
    const detail = sink.getEventsForRun(result.runId).find((event: LogEvent) => event.kind === "blocker_text_detail");
    expect(detail).toMatchObject({
      kind: "blocker_text_detail",
      blockerText: "Waiting for external API approval",
    });
  });

  test("blocked outcome truncates very long blocker text in log", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();
    const longText = "a".repeat(600);
    let invocations = 0;

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "sim.1",
          invoke: async ({ cwd }) => {
            invocations += 1;
            appendFileSync(join(cwd, "spec.md"), `\n## Blocker\n\n${longText}\n`, "utf8");
            return { kind: "ok", stdout: "blocked", stderr: "" };
          },
        },
      ],
      logSink: sink,
    });

    expect(invocations).toBe(1);
    expect(result.kind).toBe("blocked");
    const detail = sink.getEventsForRun(result.runId).find((event: LogEvent) => event.kind === "blocker_text_detail");
    const blockerText = detail && "blockerText" in detail ? detail.blockerText : undefined;
    expect(blockerText).toMatch(/^a+…$/);
    expect(blockerText?.length).toBeLessThanOrEqual(501);
  });

  test("blocked with pre-existing harness blocker and no new text is rejected", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const worktreePath = join(jarvisRoot, "worktrees", "demo", "stale-blocker-run");
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n\n## Blocker\n\nfrom contract_miss\n", "utf8");
    let invocations = 0;

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "stale-blocker-run",
      bindings: [
        {
          id: "sim.1",
          invoke: async () => {
            invocations += 1;
            return { kind: "ok", stdout: "blocked", stderr: "" };
          },
        },
      ],
    });

    expect(invocations).toBe(2);
    expect(result.kind).toBe("invocation_failure");
    expect(result.outcomeKind).toBe("missing_blocker");
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
    expect(result.resumable).toBe(true);
    expect(result.failureKind).toBeUndefined();
    expect(result.bindingAttempts).toBeUndefined();
    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run?.status).toBe("paused");
    expect(run?.attempts[0]?.outcomeKind).toBe("invalid_token");
  });

  test("invalid_token appends invalid_token_detail to the observability log", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: invalidTokenBindings, logSink: sink });
    const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
    expect(events).toContain("invalid_token_detail");
    const detail = sink.getEventsForRun(result.runId).find((event) => event.kind === "invalid_token_detail");
    expect(detail).toMatchObject({
      kind: "invalid_token_detail",
      tokenText: "not a terminal token",
    });
  });

  test("token_reprompt precedes invalid_token_detail on a second miss", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({ jarvisRoot, stateDbPath, bindings: invalidTokenBindings, logSink: sink });
    const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
    const repromptIndex = events.indexOf("token_reprompt");
    const detailIndex = events.indexOf("invalid_token_detail");
    expect(repromptIndex).toBeGreaterThanOrEqual(0);
    expect(detailIndex).toBeGreaterThan(repromptIndex);

    const reprompt = sink.getEventsForRun(result.runId).find((event) => event.kind === "token_reprompt");
    expect(reprompt).toMatchObject({
      kind: "token_reprompt",
      responseText: "not a terminal token",
    });
  });

  test("no token_reprompt event when the first response carries a token", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const sink = new TestLogSink();

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      logSink: sink,
    });

    expect(result.kind).toBe("complete");
    const events = sink.getEventsForRun(result.runId).map((event) => event.kind);
    expect(events).not.toContain("token_reprompt");
  });

  test("write-loop telemetry appends one row per binding attempt with shared run and attempt context", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const telemetryPath = join(jarvisRoot, "telemetry.jsonl");
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["quota", "done"], { artifactPath: "proof.txt", emitArtifact: true }),
      telemetry: loopTelemetry(telemetryPath),
    });

    expect(result.kind).toBe("complete");
    const rows = loadTelemetryRows(telemetryPath);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.run_id))).toEqual(new Set([result.runId]));
    expect(new Set(rows.map((row) => row.attempt_id)).size).toBe(1);
    expect(rows.map((row) => row.invocation_id)).toHaveLength(2);
    expect(new Set(rows.map((row) => row.invocation_id)).size).toBe(2);
    expect(rows.map((row) => row.exit_kind)).toEqual(["quota", "ok"]);
    expect(rows.every((row) => row.step_id === null)).toBe(true);
  });

  test("telemetry row records usage and cost from ok result", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const telemetryPath = join(jarvisRoot, "telemetry.jsonl");
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [
        {
          id: "claude-with-cost",
          metadata: { agent: "claude", model: "sonnet" },
          invoke: async ({ cwd }) => {
            writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
            return {
              kind: "ok" as const,
              stdout: "done",
              stderr: "",
              usage_source: "agent" as const,
              usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 25000,
              },
              cost_usd: 0.15,
              cost_source: "agent" as const,
            };
          },
        },
      ],
      telemetry: loopTelemetry(telemetryPath),
    });

    expect(result.kind).toBe("complete");
    const rows = loadTelemetryRows(telemetryPath);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.exit_kind).toBe("ok");
    expect(row?.usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 25000,
    });
    expect(row?.usage_source).toBe("agent");
    expect(row?.cost_usd).toBe(0.15);
    expect(row?.cost_source).toBe("agent");
  });

  test("operator-session-only telemetry (no sinkPath/workflow/role) completes a real run without emitting telemetry", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      telemetry: { operatorSessionId: "session-only" },
    });

    expect(result.kind).toBe("complete");
  });

  describe("work_boundary_recorded telemetry", () => {
    const completionHooks = {
      completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 2 }),
      completionPublisher: async () => ({}),
      readyFinalizer: async () => {},
    };

    test("appends one row when a completion commit succeeds", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryPath = join(jarvisRoot, "boundary-telemetry.jsonl");
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        telemetry: { sinkPath: telemetryPath, operatorSessionId: "session-1" },
        ...completionHooks,
      });

      expect(result.kind).toBe("complete");
      expect(result.commitSha).toBe("commit-abc");
      const rows = loadWorkBoundaryRows(telemetryPath);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        schema_version: 1,
        record_kind: "work_boundary_recorded",
        run_id: result.runId,
        attempt_id: result.attemptId,
        outcome_kind: "done",
        run_status: "completed",
        commit_sha: "commit-abc",
        files_changed: 2,
      });
      expect(rows[0]).not.toHaveProperty("invocation_id");
    });

    test("appends none when no telemetry block is attached", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryPath = join(jarvisRoot, "boundary-telemetry.jsonl");
      await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        ...completionHooks,
      });

      expect(loadWorkBoundaryRows(telemetryPath)).toHaveLength(0);
    });

    test("appends none when the completion commit produces no sha", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryPath = join(jarvisRoot, "boundary-telemetry.jsonl");
      await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        telemetry: { sinkPath: telemetryPath, operatorSessionId: "session-1" },
        completionCommitter: async () => ({}),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(loadWorkBoundaryRows(telemetryPath)).toHaveLength(0);
    });

    test("resume-republish appends a row with the same join keys and files_changed", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryPath = join(jarvisRoot, "boundary-telemetry.jsonl");
      const branchName = "resume-boundary";
      const publish = { commitSha: "commit-1", filesChanged: 3 };

      const first = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        telemetry: { sinkPath: telemetryPath, operatorSessionId: "session-1" },
        completionCommitter: async () => publish,
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(first.kind).toBe("complete");
      mkdirSync(join(jarvisRoot, "worktrees", "demo", branchName, ".git"), { recursive: true });

      const retry = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: [],
        telemetry: { sinkPath: telemetryPath, operatorSessionId: "session-1" },
        completionCommitter: async () => publish,
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(retry.kind).toBe("complete");

      const rows = loadWorkBoundaryRows(telemetryPath);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0]?.attempt_id).toBe(rows[1]?.attempt_id);
      expect(rows[0]?.outcome_kind).toBe(rows[1]?.outcome_kind);
      expect(rows[0]?.run_status).toBe(rows[1]?.run_status);
      expect(rows[0]?.files_changed).toBe(rows[1]?.files_changed);
    });

    test("append failure leaves boundary control flow and persistence unchanged", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const telemetryDir = join(jarvisRoot, "boundary-telemetry-dir");
      mkdirSync(telemetryDir, { recursive: true });
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        telemetry: { sinkPath: telemetryDir, operatorSessionId: "session-1" },
        ...completionHooks,
      });

      expect(result.kind).toBe("complete");
      expect(result.commitSha).toBe("commit-abc");
      expect(result.boundaryTelemetryFailure).toBeDefined();
      const run = loadRunOnce(stateDbPath, result.runId);
      expect(run?.status).toBe("completed");
      expect(run?.attempts[0]?.outcomeKind).toBe("done");
    });
  });

  describe("ready finalization", () => {
    const completionHooks = {
      completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
      completionPublisher: async () => ({}),
    };

    test.each([
      { terminal: "completed", expectedKind: "complete", expectedResumable: false },
      { terminal: "failed", expectedKind: "ready_gate_failed", expectedResumable: true },
      { terminal: "killed", expectedKind: "progress", expectedResumable: true },
    ] as const)("joins a held ready repair before $terminal becomes durable", async ({
      terminal,
      expectedKind,
      expectedResumable,
    }) => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const controller = new AbortController();
      let runId: string | undefined;
      let calls = 0;
      const repair = createHeldInvocation();
      let gateCalls = 0;

      const bindings: InvocationBinding[] = [
        {
          id: "held-repair",
          metadata: { agent: "codex", model: "test" },
          invoke: ({ cwd, signal }) => {
            calls += 1;
            if (calls === 1) {
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return Promise.resolve({ kind: "ok", stdout: "done", stderr: "" });
            }
            return repair.invoke(signal);
          },
        },
      ];

      try {
        const resultPromise = executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: `repair-settlement-${terminal}`,
            baseRef: "HEAD",
            jarvisRoot,
          },
          specPath: "spec.md",
          stepRules: "Return exactly one terminal token.",
          expectedArtifactPath: "proof.txt",
          bindings,
          stateStore: store,
          withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
          sessionsDir: join(jarvisRoot, "sessions"),
          signal: controller.signal,
          maxIterations: 2,
          quiescenceTimeoutMs: 1,
          completionCommitter: completionHooks.completionCommitter,
          completionPublisher: completionHooks.completionPublisher,
          readyFinalizer: async () => {
            gateCalls += 1;
            if (terminal !== "completed" || gateCalls === 1) {
              throw new ReadyGateError("bun run ready", 1, "red");
            }
          },
          onRunCreated: (id) => {
            runId = id;
          },
        });

        await repair.started;
        expect(runId).toBeDefined();
        expect(store.loadRun(runId as string)?.status).toBe("in-progress");

        if (terminal === "killed") {
          controller.abort();
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
          expect(repair.signal?.aborted).toBe(true);
          expect(store.loadRun(runId as string)?.status).toBe("in-progress");
        }

        repair.release();
        const result = await resultPromise;
        if (terminal === "killed") {
          expect(store.loadRun(runId as string)?.status).toBe("in-progress");
          store.commitGuardedKill(runId as string);
        }

        expect(result).toMatchObject({ kind: expectedKind, resumable: expectedResumable });
        expect(store.loadRun(runId as string)?.status).toBe(terminal);
        expect(repair.signal?.aborted).toBe(true);
        expect(repair.processSettled).toBe(true);
        expect(repair.invocationSettled).toBe(true);
      } finally {
        repair.release();
        store.close();
      }
    });

    test.each([
      { label: "abort propagation", invert: { invertRepairAbortPropagationForTest: true } },
      { label: "invocation join", invert: { invertRepairJoinForTest: true } },
      { label: "terminal ordering", invert: { invertRepairTerminalBeforeJoinForTest: true } },
    ])("inverting repair $label breaks held-repair settlement for killed", async ({ invert }) => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const controller = new AbortController();
      let runId: string | undefined;
      let calls = 0;
      const repair = createHeldInvocation();

      try {
        void executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: "repair-settlement-invert-killed",
            baseRef: "HEAD",
            jarvisRoot,
          },
          specPath: "spec.md",
          stepRules: "Return exactly one terminal token.",
          expectedArtifactPath: "proof.txt",
          bindings: [
            {
              id: "held-repair",
              metadata: { agent: "codex", model: "test" },
              invoke: ({ cwd, signal }) => {
                calls += 1;
                if (calls === 1) {
                  writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                  return Promise.resolve({ kind: "ok", stdout: "done", stderr: "" });
                }
                return repair.invoke(signal);
              },
            },
          ],
          stateStore: store,
          withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
          sessionsDir: join(jarvisRoot, "sessions"),
          signal: controller.signal,
          maxIterations: 2,
          quiescenceTimeoutMs: 1,
          completionCommitter: completionHooks.completionCommitter,
          completionPublisher: completionHooks.completionPublisher,
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, "red");
          },
          onRunCreated: (id) => {
            runId = id;
          },
          ...invert,
        });

        await repair.started;
        if (invert.invertRepairTerminalBeforeJoinForTest) {
          expect(store.loadRun(runId as string)?.status).toBe("failed");
        } else {
          controller.abort();
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
          if (invert.invertRepairAbortPropagationForTest) {
            expect(repair.signal?.aborted).toBe(false);
          } else {
            expect(repair.invocationSettled).toBe(false);
            expect(store.loadRun(runId as string)?.status).toBe("in-progress");
          }
        }
      } finally {
        repair.release();
        controller.abort();
        store.close();
      }
    });

    test("mutation repair ignores bounded quiescence and joins a non-cooperative invocation", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const branchName = "mutation-repair-join";
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(worktreePath, { recursive: true });
      writeFileSync(join(worktreePath, "spec.md"), "# Spec\n", "utf8");
      const runId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch: branchName,
        specPath: "spec.md",
      });
      const repair = createHeldInvocation();
      const binding: InvocationBinding = {
        id: "held-mutation-repair",
        metadata: { agent: "codex", model: "test" },
        invoke: ({ signal }) => repair.invoke(signal),
      };

      try {
        const outcomePromise = runMutationRepairIteration(
          {
            worktree: {
              projectRoot: "/fake",
              projectName: "demo",
              branchName,
              baseRef: "HEAD",
              jarvisRoot,
            },
            specPath: "spec.md",
            expectedArtifactPath: "spec.md",
            stepRules: "repair",
            bindings: [binding],
            stateStore: store,
            withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
            sessionsDir: join(jarvisRoot, "sessions"),
            iterationTimeoutMs: 1,
            quiescenceTimeoutMs: 1,
          },
          store,
          { kind: "complete", runId, iterationsConsumed: 0, resumable: false, completionAgent: "codex" },
          new SurvivingMutationError("operator-flip: === → !==", "src/guard.ts", 17),
          1,
        );

        await repair.started;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        expect(repair.signal?.aborted).toBe(true);
        expect(store.loadRun(runId)?.status).toBe("in-progress");
        expect(repair.processSettled).toBe(false);
        expect(repair.invocationSettled).toBe(false);

        repair.release();
        expect(await outcomePromise).toBe("unsettled");
        expect(repair.processSettled).toBe(true);
        expect(repair.invocationSettled).toBe(true);
        expect(store.loadRun(runId)?.status).toBe("in-progress");
      } finally {
        repair.release();
        store.close();
      }
    });

    test("resumed publication joins its repair before restoring failed", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const branchName = "resumed-repair-settlement";
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(join(worktreePath, ".git"), { recursive: true });
      writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
      const runId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch: branchName,
        specPath: "spec.md",
      });
      const attemptId = store.recordAttemptStart(runId);
      store.commitCompletionBoundary({
        attemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex",
      });
      const repair = createHeldInvocation();

      try {
        const resultPromise = executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName,
            baseRef: "HEAD",
            jarvisRoot,
          },
          specPath: "spec.md",
          stepRules: "repair",
          expectedArtifactPath: "proof.txt",
          bindings: [
            {
              id: "held-resume-repair",
              metadata: { agent: "codex", model: "test" },
              invoke: ({ signal }) => repair.invoke(signal),
            },
          ],
          stateStore: store,
          withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
          sessionsDir: join(jarvisRoot, "sessions"),
          maxIterations: 1,
          completionCommitter: completionHooks.completionCommitter,
          completionPublisher: completionHooks.completionPublisher,
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, "red");
          },
        });

        await repair.started;
        expect(store.loadRun(runId)?.status).toBe("in-progress");
        repair.release();
        expect(await resultPromise).toMatchObject({ kind: "ready_gate_failed", resumable: true });
        expect(store.loadRun(runId)?.status).toBe("failed");
        expect(repair.signal?.aborted).toBe(true);
        expect(repair.processSettled).toBe(true);
        expect(repair.invocationSettled).toBe(true);
      } finally {
        repair.release();
        store.close();
      }
    });

    test("runs ready finalization only after publication succeeds", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const calls: string[] = [];
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: completionHooks.completionCommitter,
        completionPublisher: async () => {
          calls.push("publish");
          return {};
        },
        readyFinalizer: async () => {
          calls.push("finalize");
        },
      });

      expect(result.kind).toBe("complete");
      expect(calls).toEqual(["publish", "finalize"]);
    });

    test("returns retryable ready_gate_failed when the gate fails and does not call the flip", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        ...completionHooks,
        readyFinalizer: async () => {
          throw new ReadyGateError("bun run ready", 1, "tests failed");
        },
      });

      expect(result.kind).toBe("ready_gate_failed");
      expect(result.resumable).toBe(true);
      expect(result.readyGateError).toContain("ready gate failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "ready_gate_failed",
        resumable: true,
      });
    });

    test("repairs a red ready gate through a write iteration", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      let gateCalls = 0;
      const prompts: string[] = [];
      const forceDistinctFlags: boolean[] = [];
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: [
          {
            id: "sim.1",
            metadata: { agent: "sim-agent-1", model: "sim-model-1" },
            invoke: async ({ prompt, cwd }) => {
              prompts.push(prompt);
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" } as const;
            },
          },
        ],
        logSink,
        completionCommitter: async (input) => {
          forceDistinctFlags.push(input.forceDistinctCommit === true);
          return completionHooks.completionCommitter();
        },
        completionPublisher: completionHooks.completionPublisher,
        readyFinalizer: async () => {
          gateCalls += 1;
          if (gateCalls === 1) throw new ReadyGateError("bun run ready", 1, "tests failed");
        },
      });

      expect(result.kind).toBe("complete");
      expect(gateCalls).toBe(2);
      expect(forceDistinctFlags.filter(Boolean).length).toBeGreaterThanOrEqual(2);
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain("Command: bun run ready");
      expect(prompts[1]).toContain("Exit code: 1");
      expect(prompts[1]).toContain("tests failed");
      expect(logSink.getEventsForRun(result.runId)).toContainEqual({
        kind: "ready_gate_repair",
        attempt: 1,
        gateExitCode: 1,
      });
    });

    test("caps red-gate repairs at three attempts", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      let gateCalls = 0;
      let invocations = 0;
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: [
          {
            id: "sim.1",
            metadata: { agent: "sim-agent-1", model: "sim-model-1" },
            invoke: async ({ cwd }) => {
              invocations += 1;
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" } as const;
            },
          },
        ],
        logSink,
        ...completionHooks,
        readyFinalizer: async () => {
          gateCalls += 1;
          throw new ReadyGateError("bun run ready", 2, `failure ${gateCalls}`);
        },
      });

      expect(result.kind).toBe("ready_gate_failed");
      expect(result.resumable).toBe(true);
      expect(invocations).toBe(4);
      expect(gateCalls).toBe(4);
      const events = logSink.getEventsForRun(result.runId);
      expect(events.filter((event) => event.kind === "iteration_started")).toHaveLength(4);
      expect(events.filter((event) => event.kind === "ready_gate_repair")).toHaveLength(3);
    });

    test("returns ready_gate_failed when the repair budget is exhausted", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      let invocations = 0;
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        maxIterations: 2,
        bindings: [
          {
            id: "sim.1",
            metadata: { agent: "sim-agent-1", model: "sim-model-1" },
            invoke: async ({ cwd }) => {
              invocations += 1;
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              return { kind: "ok", stdout: "done", stderr: "" } as const;
            },
          },
        ],
        ...completionHooks,
        readyFinalizer: async () => {
          throw new ReadyGateError("bun run ready", 1, "still red");
        },
      });

      expect(result.kind).toBe("ready_gate_failed");
      expect(result.iterationsConsumed).toBe(2);
      expect(invocations).toBe(2);
    });

    test("stops repair when the agent returns blocked", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      let gateCalls = 0;
      let invocations = 0;
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: [
          {
            id: "sim.1",
            metadata: { agent: "sim-agent-1", model: "sim-model-1" },
            invoke: async ({ cwd }) => {
              invocations += 1;
              writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
              if (invocations === 2) {
                appendFileSync(join(cwd, "spec.md"), "\n## Blocker\n\nstuck\n", "utf8");
                return { kind: "ok", stdout: "blocked", stderr: "" } as const;
              }
              return { kind: "ok", stdout: "done", stderr: "" } as const;
            },
          },
        ],
        ...completionHooks,
        readyFinalizer: async () => {
          gateCalls += 1;
          throw new ReadyGateError("bun run ready", 1, "red");
        },
      });

      expect(result.kind).toBe("ready_gate_failed");
      expect(result.iterationsConsumed).toBe(2);
      expect(gateCalls).toBe(1);
      expect(invocations).toBe(2);
    });

    describe("untouched-path gate settlement", () => {
      test("settles ready_gate_out_of_scope without repair while in-scope failures enter bounded repair", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "gate-out-of-scope";
        const outOfScopeBranch = `${branchName}-oos`;
        const { baseRef: outOfScopeBaseRef } = initGateScopeWorktree(jarvisRoot, outOfScopeBranch);
        const logSink = new TestLogSink();
        let inScopeGateCalls = 0;

        const outOfScope = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName: outOfScopeBranch,
          baseRef: outOfScopeBaseRef,
          logSink,
          bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
          ...completionHooks,
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, gateFailureOutput("v2/src/untouched.test.ts"));
          },
        });

        expect(outOfScope.kind).toBe("ready_gate_out_of_scope");
        expect(outOfScope.resumable).toBe(true);
        expect(outOfScope.iterationsConsumed).toBe(1);
        expect(logSink.getEventsForRun(outOfScope.runId).filter((event) => event.kind === "ready_gate_repair")).toEqual(
          [],
        );
        expect(logSink.getEventsForRun(outOfScope.runId).at(-1)).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "ready_gate_out_of_scope",
          iterationsConsumed: 1,
          resumable: true,
        });

        const inScopeBranch = `${branchName}-in-scope`;
        const { baseRef: inScopeBaseRef } = initGateScopeWorktree(jarvisRoot, inScopeBranch);
        const inScope = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName: inScopeBranch,
          baseRef: inScopeBaseRef,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          logSink,
          completionCommitter: completionHooks.completionCommitter,
          completionPublisher: completionHooks.completionPublisher,
          readyFinalizer: async () => {
            inScopeGateCalls += 1;
            if (inScopeGateCalls === 1) {
              throw new ReadyGateError("bun run ready", 1, gateFailureOutput("proof.txt"));
            }
          },
        });

        expect(inScope.kind).toBe("complete");
        expect(inScopeGateCalls).toBe(2);
        expect(logSink.getEventsForRun(inScope.runId).filter((event) => event.kind === "ready_gate_repair")).toEqual([
          { kind: "ready_gate_repair", attempt: 1, gateExitCode: 1 },
        ]);
      });

      test("repairs once on an in-scope gate then settles ready_gate_out_of_scope on a later untouched gate", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "gate-repair-then-out-of-scope";
        const { baseRef } = initGateScopeWorktree(jarvisRoot, branchName);
        const logSink = new TestLogSink();
        let gateCalls = 0;
        let invocations = 0;

        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          logSink,
          completionCommitter: completionHooks.completionCommitter,
          completionPublisher: completionHooks.completionPublisher,
          readyFinalizer: async () => {
            gateCalls += 1;
            if (gateCalls === 1) {
              throw new ReadyGateError("bun run ready", 1, gateFailureOutput("proof.txt"));
            }
            throw new ReadyGateError("bun run ready", 1, gateFailureOutput("v2/src/untouched.test.ts"));
          },
        });

        expect(result.kind).toBe("ready_gate_out_of_scope");
        expect(result.resumable).toBe(true);
        expect(gateCalls).toBe(2);
        expect(invocations).toBe(2);
        expect(result.iterationsConsumed).toBe(2);
        const events = logSink.getEventsForRun(result.runId);
        expect(events.filter((event) => event.kind === "ready_gate_repair")).toEqual([
          { kind: "ready_gate_repair", attempt: 1, gateExitCode: 1 },
        ]);
        expect(events.at(-1)).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "ready_gate_out_of_scope",
          iterationsConsumed: 2,
          resumable: true,
        });
      });

      test("never invokes repair for a fully attributed untouched-path gate", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "gate-out-of-scope-no-repair";
        const { baseRef } = initGateScopeWorktree(jarvisRoot, branchName);
        const logSink = new TestLogSink();
        let invocations = 0;

        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          logSink,
          ...completionHooks,
          readyFinalizer: async () => {
            throw new ReadyGateError("bun run ready", 1, gateFailureOutput("v2/src/untouched.test.ts"));
          },
        });

        expect(result.kind).toBe("ready_gate_out_of_scope");
        expect(invocations).toBe(1);
        expect(logSink.getEventsForRun(result.runId).some((event) => event.kind === "ready_gate_repair")).toBe(false);
        expect(
          logSink.getEventsForRun(result.runId).filter((event) => event.kind === "iteration_started"),
        ).toHaveLength(1);
      });
    });

    describe("ready-gate repair fence", () => {
      function initRepairFenceWorktree(
        jarvisRoot: string,
        branchName: string,
        options?: { harnessSidecars?: boolean },
      ): { worktreePath: string; baseRef: string } {
        const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
        mkdirSync(join(worktreePath, "v2", "src"), { recursive: true });
        execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
        writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
        writeFileSync(join(worktreePath, "README.md"), "seed\n", "utf8");
        if (options?.harnessSidecars !== true) {
          writeFileSync(join(worktreePath, "v2/src/untouched.test.ts"), "export {}\n", "utf8");
          writeFileSync(join(worktreePath, ".gitignore"), ".reused\n", "utf8");
        }
        execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
        const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
        writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
        if (options?.harnessSidecars === true) {
          writeFileSync(join(worktreePath, ".jarvis-intent-review-verdict.md"), "verdict\n", "utf8");
          writeFileSync(join(worktreePath, ".jarvis-intent-review-verdict.md.owner"), "owner\n", "utf8");
          execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
        } else {
          execFileSync("git", ["-C", worktreePath, "add", "proof.txt"], { stdio: "pipe" });
        }
        execFileSync("git", ["-C", worktreePath, "commit", "-m", "iteration"], { stdio: "pipe" });
        return { worktreePath, baseRef };
      }

      async function runRepairFenceLoop(args: {
        jarvisRoot: string;
        stateDbPath: string;
        branchName: string;
        baseRef: string;
        repairEdit: (cwd: string, invocations: number) => void;
        invertReadyGateRepairFenceForTest?: boolean;
        invertReadyGateRepairSidecarFenceForTest?: boolean;
        stepId?: string;
        workflowSnapshot?: WriteLoopInput["workflowSnapshot"];
      }) {
        let gateCalls = 0;
        let invocations = 0;
        let publishCalls = 0;
        const result = await runLoop({
          jarvisRoot: args.jarvisRoot,
          stateDbPath: args.stateDbPath,
          branchName: args.branchName,
          baseRef: args.baseRef,
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                if (invocations === 1) {
                  writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                } else {
                  args.repairEdit(cwd, invocations);
                }
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => {
            publishCalls += 1;
            return {};
          },
          readyFinalizer: async () => {
            gateCalls += 1;
            if (gateCalls === 1) {
              throw new ReadyGateError("bun run ready", 1, gateFailureOutput("proof.txt"));
            }
          },
          ...(args.invertReadyGateRepairFenceForTest !== undefined
            ? { invertReadyGateRepairFenceForTest: args.invertReadyGateRepairFenceForTest }
            : {}),
          ...(args.invertReadyGateRepairSidecarFenceForTest !== undefined
            ? { invertReadyGateRepairSidecarFenceForTest: args.invertReadyGateRepairSidecarFenceForTest }
            : {}),
          ...(args.stepId !== undefined ? { stepId: args.stepId } : {}),
          ...(args.workflowSnapshot !== undefined ? { workflowSnapshot: args.workflowSnapshot } : {}),
        });
        return { result, gateCalls, invocations, publishCalls };
      }

      function touchUntouchedRepairEdit(cwd: string) {
        writeFileSync(join(cwd, "v2/src/untouched.test.ts"), "changed\n", "utf8");
      }

      async function seedFailedRepairFence(args: {
        jarvisRoot: string;
        stateDbPath: string;
        branchName: string;
        stepId?: string;
        workflowSnapshot?: WriteLoopInput["workflowSnapshot"];
      }) {
        const { baseRef } = initRepairFenceWorktree(args.jarvisRoot, args.branchName);
        const first = await runRepairFenceLoop({
          ...args,
          baseRef,
          repairEdit: touchUntouchedRepairEdit,
        });
        expect(first.result.kind).toBe("completion_commit_failed");
        return { baseRef, first };
      }

      test("rejects ready-gate repairs outside the run diff and spec tree", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-outside";
        const { baseRef } = initRepairFenceWorktree(jarvisRoot, branchName);

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          repairEdit: touchUntouchedRepairEdit,
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(fenced.publishCalls).toBe(1);
        expect(fenced.gateCalls).toBe(1);

        const unfenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName: `${branchName}-invert`,
          baseRef: initRepairFenceWorktree(jarvisRoot, `${branchName}-invert`).baseRef,
          repairEdit: touchUntouchedRepairEdit,
          invertReadyGateRepairFenceForTest: true,
        });
        expect(unfenced.result.kind).toBe("complete");
      });

      function stageHarnessSidecarRepairEdit(cwd: string) {
        writeFileSync(join(cwd, ".jarvis-intent-review-verdict.md"), "modified verdict\n", "utf8");
        writeFileSync(join(cwd, ".jarvis-intent-review-verdict.md.owner"), "modified owner\n", "utf8");
      }

      test("rejects ready-gate repairs that would publish harness sidecars", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-harness-sidecars";
        const { worktreePath, baseRef } = initRepairFenceWorktree(jarvisRoot, branchName, {
          harnessSidecars: true,
        });

        const allowed = await deriveGateAllowedPaths(
          { worktreePath, baseRef, specPath: "spec.md" },
          { gitUntracked: async () => "\0" },
        );
        expect(allowed?.has(".jarvis-intent-review-verdict.md")).toBe(true);
        expect(allowed?.has(".jarvis-intent-review-verdict.md.owner")).toBe(true);

        const fenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          repairEdit: stageHarnessSidecarRepairEdit,
        });

        expect(fenced.result.kind).toBe("completion_commit_failed");
        expect(fenced.result.completionCommitError).toContain("Ready-gate repair stages harness sidecar:");
        expect(fenced.result.completionCommitError).toContain(".jarvis-intent-review-verdict.md");
        expect(fenced.publishCalls).toBe(1);
        expect(fenced.gateCalls).toBe(1);

        const dirty = execFileSync("git", ["-C", worktreePath, "diff", "--name-only", "HEAD"], {
          encoding: "utf8",
          stdio: "pipe",
        })
          .split("\n")
          .filter(Boolean);
        expect(dirty.some((path) => basename(path).startsWith(".jarvis-"))).toBe(true);

        const unfenced = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName: `${branchName}-invert`,
          baseRef: initRepairFenceWorktree(jarvisRoot, `${branchName}-invert`, { harnessSidecars: true }).baseRef,
          repairEdit: stageHarnessSidecarRepairEdit,
          invertReadyGateRepairSidecarFenceForTest: true,
        });
        expect(unfenced.result.kind).toBe("complete");
      });

      test("repair candidate contract covers staged change kinds and excludes unstaged metadata", async () => {
        const parent = mkdtempSync(join(tmpdir(), "repair-fence-candidates-"));
        roots.push(parent);
        const root = join(parent, "main");
        const submoduleRepo = join(parent, "submodule-repo");
        mkdirSync(root, { recursive: true });
        mkdirSync(submoduleRepo, { recursive: true });
        execFileSync("git", ["init"], { cwd: submoduleRepo, stdio: "pipe" });
        execFileSync("git", ["-C", submoduleRepo, "config", "user.email", "test@example.com"], { stdio: "pipe" });
        execFileSync("git", ["-C", submoduleRepo, "config", "user.name", "Test User"], { stdio: "pipe" });
        writeFileSync(join(submoduleRepo, "README.md"), "submodule\n", "utf8");
        execFileSync("git", ["-C", submoduleRepo, "add", "README.md"], { stdio: "pipe" });
        execFileSync("git", ["-C", submoduleRepo, "commit", "-m", "submodule seed"], { stdio: "pipe" });

        execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });
        execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"], { stdio: "pipe" });
        execFileSync("git", ["-C", root, "config", "user.name", "Test User"], { stdio: "pipe" });
        writeFileSync(join(root, "tracked.txt"), "keep\n", "utf8");
        writeFileSync(join(root, "delete-me.txt"), "gone\n", "utf8");
        writeFileSync(join(root, "rename-old.txt"), "rename\n", "utf8");
        writeFileSync(join(root, "link-target.txt"), "target\n", "utf8");
        writeFileSync(join(root, ".gitignore"), "ignored-tracked.txt\n", "utf8");
        writeFileSync(join(root, "ignored-tracked.txt"), "was ignored\n", "utf8");
        execFileSync(
          "git",
          ["-c", "protocol.file.allow=always", "-C", root, "submodule", "add", submoduleRepo, "libs/mod"],
          { stdio: "pipe" },
        );
        execFileSync("git", ["-C", root, "add", "-A"], { stdio: "pipe" });
        execFileSync("git", ["-C", root, "commit", "-m", "seed"], { stdio: "pipe" });

        writeFileSync(join(root, "added.txt"), "new\n", "utf8");
        writeFileSync(join(root, "tracked.txt"), "changed\n", "utf8");
        unlinkSync(join(root, "delete-me.txt"));
        execFileSync("git", ["-C", root, "mv", "rename-old.txt", "rename-new.txt"], { stdio: "pipe" });
        writeFileSync(join(root, "ignored-tracked.txt"), "tracked ignored change\n", "utf8");
        const unusualName = "weird\u0001name.txt";
        writeFileSync(join(root, unusualName), "odd\n", "utf8");
        unlinkSync(join(root, "link-target.txt"));
        symlinkSync("tracked.txt", join(root, "link-target.txt"));
        writeFileSync(join(root, "libs/mod/README.md"), "submodule changed\n", "utf8");
        execFileSync("git", ["-C", join(root, "libs/mod"), "config", "user.email", "test@example.com"], {
          stdio: "pipe",
        });
        execFileSync("git", ["-C", join(root, "libs/mod"), "config", "user.name", "Test User"], { stdio: "pipe" });
        execFileSync("git", ["-C", join(root, "libs/mod"), "add", "README.md"], { stdio: "pipe" });
        execFileSync("git", ["-C", join(root, "libs/mod"), "commit", "-m", "submodule change"], { stdio: "pipe" });
        execFileSync("git", ["-C", root, "add", "libs/mod"], { stdio: "pipe" });
        writeFileSync(join(root, ".git", "COMMIT_EDITMSG"), "metadata\n", "utf8");

        const candidates = await enumerateRepairCompletionCandidates(root);
        expect(candidates).toBeDefined();
        expect(candidates).toEqual(
          expect.arrayContaining([
            "added.txt",
            "tracked.txt",
            "delete-me.txt",
            "rename-old.txt",
            "rename-new.txt",
            unusualName,
            "link-target.txt",
            "libs/mod",
          ]),
        );
        expect(candidates).not.toEqual(expect.arrayContaining([".git/COMMIT_EDITMSG"]));

        const allowed = new Set(["added.txt", "tracked.txt", "outside.txt"]);
        expect(findFirstRepairFenceViolation(["z/outside.txt", "a/outside.txt"], allowed)).toBe("a/outside.txt");
        expect(findFirstRepairFenceViolation(["b/outside.txt", "a/outside.txt"], allowed)).toBe("a/outside.txt");
        expect(escapeRepoPathForEvidence("a\nb")).toBe("a\\nb");
        expect(compareRepoPathsByUtf8Bytes("b", "a")).toBeGreaterThan(0);
      });

      test("completes repair limited to an existing run-diff path", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-run-diff";
        const { baseRef } = initGateScopeWorktree(jarvisRoot, branchName);

        const { result, gateCalls } = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          repairEdit: (cwd) => {
            writeFileSync(join(cwd, "proof.txt"), "fixed\n", "utf8");
          },
        });

        expect(result.kind).toBe("complete");
        expect(gateCalls).toBe(2);

        const reopened = openStateStore(stateDbPath);
        const persisted = reopened.loadRun(result.runId);
        expect(persisted?.readyGateRepairFence?.outcomeKind).toBe("frozen");
        expect(persisted?.readyGateRepairFence?.offendingPath).toBeUndefined();
        reopened.close();

        const withoutRunDiff = await deriveGateAllowedPaths(
          { worktreePath: join(jarvisRoot, "worktrees", "demo", branchName), baseRef, specPath: "spec.md" },
          { gitUntracked: async () => "\0", gitDiffNameStatus: async () => "\0" },
        );
        const violation = findFirstRepairFenceViolation(["proof.txt"], withoutRunDiff ?? new Set());
        expect(violation).toBe("proof.txt");
      });

      test("completes repair limited to the resolved spec tree", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-spec-tree";
        const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
        mkdirSync(join(worktreePath, "spec"), { recursive: true });
        execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
        writeFileSync(join(worktreePath, "spec/index.md"), "- [ ] work\n", "utf8");
        writeFileSync(join(worktreePath, "spec/01-task.md"), "- [ ] task\n", "utf8");
        writeFileSync(join(worktreePath, "README.md"), "seed\n", "utf8");
        execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
        const baseRef = execFileSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
        writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
        execFileSync("git", ["-C", worktreePath, "add", "proof.txt"], { stdio: "pipe" });
        execFileSync("git", ["-C", worktreePath, "commit", "-m", "iteration"], { stdio: "pipe" });

        const withoutSpecTree = await deriveGateAllowedPaths(
          { worktreePath, baseRef, specPath: "spec/index.md" },
          { gitUntracked: async () => "\0", listSpecTreePaths: async () => [] },
        );
        expect(findFirstRepairFenceViolation(["spec/01-task.md"], withoutSpecTree ?? new Set())).toBe(
          "spec/01-task.md",
        );

        let gateCalls = 0;
        let invocations = 0;
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          specPath: "spec/index.md",
          bindings: [
            {
              id: "sim.1",
              metadata: { agent: "sim-agent-1", model: "sim-model-1" },
              invoke: async ({ cwd }) => {
                invocations += 1;
                if (invocations === 1) {
                  writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
                } else {
                  writeFileSync(join(cwd, "spec/01-task.md"), "- [x] task\n", "utf8");
                }
                return { kind: "ok", stdout: "done", stderr: "" } as const;
              },
            },
          ],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {
            gateCalls += 1;
            if (gateCalls === 1) {
              throw new ReadyGateError("bun run ready", 1, gateFailureOutput("spec/01-task.md"));
            }
          },
        });

        expect(result.kind).toBe("complete");
        expect(gateCalls).toBe(2);
      });

      const RESUME_WORKFLOW_SNAPSHOT: WriteLoopInput["workflowSnapshot"] = {
        invocationId: "repair-fence-resume",
        steps: [
          {
            stepId: "implement",
            role: "implement",
            stepRules: "Return exactly one terminal token.",
            expectedArtifactPath: "proof.txt",
            agents: ["sim-agent-1"],
            agentModelConfig: stubAgentModelConfig(["sim"]),
          },
        ],
      };

      test("completed-run retry after restart retains frozen allowset and rejects dirty path", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-retry";
        const { baseRef, first } = await seedFailedRepairFence({ jarvisRoot, stateDbPath, branchName });
        expect(first.publishCalls).toBe(1);

        const reopened = openStateStore(stateDbPath);
        const persisted = reopened.loadRun(first.result.runId);
        expect(persisted?.readyGateRepairFence?.allowedPaths).toEqual(expect.arrayContaining(["proof.txt"]));
        expect(persisted?.readyGateRepairFence?.offendingPath).toBe("v2/src/untouched.test.ts");
        expect(persisted?.readyGateRepairFence?.outcomeKind).toBe("completion_commit_failed");
        reopened.close();

        let publishCalls = 0;
        const retry = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => {
            publishCalls += 1;
            return {};
          },
          readyFinalizer: async () => {},
        });
        expect(retry.kind).toBe("completion_commit_failed");
        expect(retry.runId).toBe(first.result.runId);
        expect(retry.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(publishCalls).toBe(0);
      });

      test("completed-run retry rejects staged harness sidecars through the persisted fence", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-sidecar-retry";
        const { baseRef } = initRepairFenceWorktree(jarvisRoot, branchName, { harnessSidecars: true });

        const first = await runRepairFenceLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          repairEdit: stageHarnessSidecarRepairEdit,
        });
        expect(first.result.kind).toBe("completion_commit_failed");

        let publishCalls = 0;
        const retry = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => {
            publishCalls += 1;
            return {};
          },
          readyFinalizer: async () => {},
        });
        expect(retry.kind).toBe("completion_commit_failed");
        expect(retry.runId).toBe(first.result.runId);
        expect(retry.completionCommitError).toContain("Ready-gate repair stages harness sidecar:");
        expect(retry.completionCommitError).toContain(".jarvis-intent-review-verdict.md");
        expect(publishCalls).toBe(0);
      });

      test("jarvis run resume cannot commit rejected path after restart", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-resume";
        const { baseRef, first } = await seedFailedRepairFence({
          jarvisRoot,
          stateDbPath,
          branchName,
          stepId: "implement",
          workflowSnapshot: RESUME_WORKFLOW_SNAPSHOT,
        });

        let publishCalls = 0;
        const resumed = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          stepId: "implement",
          workflowSnapshot: RESUME_WORKFLOW_SNAPSHOT,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => {
            publishCalls += 1;
            return {};
          },
          readyFinalizer: async () => {},
        });
        expect(resumed.kind).toBe("completion_commit_failed");
        expect(resumed.runId).toBe(first.result.runId);
        expect(resumed.completionCommitError).toContain("v2/src/untouched.test.ts");
        expect(publishCalls).toBe(0);
      });

      test("recovery regressions fail when persisted-fence validation is bypassed", async () => {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const branchName = "repair-fence-bypass";
        const { baseRef, first } = await seedFailedRepairFence({ jarvisRoot, stateDbPath, branchName });

        const fenced = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
        });
        expect(fenced.kind).toBe("completion_commit_failed");

        const bypassed = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: async () => ({ commitSha: "commit-retry", filesChanged: 1 }),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
          bypassPersistedReadyGateRepairFenceForTest: true,
        });
        expect(bypassed.kind).toBe("complete");

        const corruptStore = openStateStore(stateDbPath);
        corruptStore.setReadyGateRepairFence(first.result.runId, {
          allowedPaths: "not-an-array" as unknown as string[],
          outcomeKind: "completion_commit_failed",
        });
        const corruptRun = corruptStore.loadRun(first.result.runId);
        corruptStore.close();
        expect(corruptRun?.readyGateRepairFenceCorrupt).toBe(true);

        const corruptRetry = await runLoop({
          jarvisRoot,
          stateDbPath,
          branchName,
          baseRef,
          bindings: [],
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
        });
        expect(corruptRetry.kind).toBe("completion_commit_failed");
        expect(corruptRetry.completionCommitError).toContain("could not reconstruct persisted allowset");
      });
    });

    test("returns retryable ready_flip_failed when publication succeeded but flip fails without repair", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        ...completionHooks,
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });

      expect(result.kind).toBe("ready_flip_failed");
      expect(result.readyFlipError).toContain("gh pr ready failed");
    });

    test("surfaces PR number when flip failure occurs after successful publication", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({ prNumber: 99 }),
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });

      expect(result.kind).toBe("ready_flip_failed");
      expect(result.readyFlipPrNumber).toBe(99);
      expect(result.readyFlipError).toContain("gh pr ready failed");
    });

    test("omits PR number when flip failure occurs but publication returned no PR", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });

      expect(result.kind).toBe("ready_flip_failed");
      expect(result.readyFlipPrNumber).toBeUndefined();
      expect(result.readyFlipError).toContain("gh pr ready failed");
    });

    test("returns retryable completion_commit_failed when pushed without PR evidence", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
        completionPublisher: async () => ({ pushSha: "abc123def456" }),
        readyFinalizer: async () => {
          throw new Error("should not finalize when PR evidence is missing");
        },
      });

      expect(result.kind).toBe("completion_commit_failed");
      expect(result.resumable).toBe(true);
      expect(result.completionCommitError).toContain("PR evidence");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "completion_commit_failed",
        resumable: true,
      });
    });

    test("completed published run's terminal loop_finished record carries PR evidence", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
        completionPublisher: async () => ({ prNumber: 42, prUrl: "https://github.com/owner/repo/pull/42" }),
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(result.prNumber).toBe(42);
      expect(result.prUrl).toBe("https://github.com/owner/repo/pull/42");

      const loopFinished = logSink.getEventsForRun(result.runId).at(-1);
      expect(loopFinished?.kind).toBe("loop_finished");
      if (loopFinished?.kind === "loop_finished") {
        expect(loopFinished.prNumber).toBe(42);
        expect(loopFinished.prUrl).toBe("https://github.com/owner/repo/pull/42");
      }

      const storedRun = loadRunOnce(stateDbPath, result.runId);
      expect(storedRun?.prNumber).toBe(42);
      expect(storedRun?.prUrl).toBe("https://github.com/owner/repo/pull/42");
    });

    test("records successful observed runtime smoke separately from not-runnable evidence", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        ...completionHooks,
        readyFinalizer: async () => ({ runtimeSmokeOutcome: { kind: "observed-clean" } }),
      });

      expect(result.kind).toBe("complete");
      expect(logSink.getEventsForRun(result.runId)).toContainEqual({
        kind: "runtime_smoke_outcome",
        outcome: "observed-clean",
      });
    });

    test("records successful runtime smoke evidence when the ready flip fails", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const outcome = { kind: "observed-clean" } as const;
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        ...completionHooks,
        readyFinalizer: async () => {
          throw new ReadyFlipError(new Error("gh pr ready failed"), outcome);
        },
      });

      expect(result.kind).toBe("ready_flip_failed");
      expect(logSink.getEventsForRun(result.runId)).toContainEqual({
        kind: "runtime_smoke_outcome",
        outcome: "observed-clean",
      });
    });

    test("rejects an empty discovery reason before it reaches the durable log", () => {
      const logSink = new TestLogSink();
      const invalidOutcome = {
        kind: "not-runnable",
        inspectedPaths: ["v2/src/execution/write-loop.ts"],
        discoveryReason: "",
      } as unknown as SmokePass;

      expect(() => appendRuntimeSmokeOutcome(logSink, "run-1", invalidOutcome)).toThrow(
        "Runtime smoke discovery reason must be non-empty",
      );
      expect(logSink.getEventsForRun("run-1")).toEqual([]);
    });

    test("does not record runtime smoke evidence when successful publication has no outcome", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        ...completionHooks,
        readyFinalizer: async () => ({}),
      });

      expect(result.kind).toBe("complete");
      expect(logSink.getEventsForRun(result.runId).filter((event) => event.kind === "runtime_smoke_outcome")).toEqual(
        [],
      );
    });

    test("completed-run resume replays publication after a prior publication failure", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const branchName = "resume-publication";
      const publish = { commitSha: "commit-1", filesChanged: 2 };
      let publishCalls = 0;

      const first = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => publish,
        completionPublisher: async () => {
          publishCalls += 1;
          throw new Error("push failed");
        },
        readyFinalizer: async () => {
          throw new Error("should not finalize before publication succeeds");
        },
      });
      expect(first.kind).toBe("completion_commit_failed");
      expect(first.resumable).toBe(true);
      expect(publishCalls).toBe(1);

      mkdirSync(join(jarvisRoot, "worktrees", "demo", branchName, ".git"), { recursive: true });

      const retry = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName,
        bindings: [],
        completionCommitter: async () => publish,
        completionPublisher: async () => {
          publishCalls += 1;
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(retry.kind).toBe("complete");
      expect(retry.runId).toBe(first.runId);
      expect(publishCalls).toBe(2);
    });

    test("returns surviving_mutation_failed when mutation verification detects an uncovered changed guard", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new SurvivingMutationError("operator-flip: === → !==", "src/test.ts", 42);
        },
      });

      expect(result.kind).toBe("surviving_mutation_failed");
      expect(result.resumable).toBe(true);
      expect(result.survivingMutation).toBe("operator-flip: === → !==");
      expect(result.survivingMutationSourceFile).toBe("src/test.ts");
      expect(result.survivingMutationSourceLine).toBe(42);
      expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "surviving_mutation_failed",
        resumable: true,
        survivingMutation: "operator-flip: === → !==",
        survivingMutationSourceFile: "src/test.ts",
        survivingMutationSourceLine: 42,
      });
    });

    test("returns runtime_smoke_failed when runtime smoke verification fails", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      const logSink = new TestLogSink();
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new RuntimeSmokeFailedError("bun run v2/src/cli.ts --help", "error: command failed");
        },
      });

      expect(result.kind).toBe("runtime_smoke_failed");
      expect(result.resumable).toBe(false);
      expect(result.runtimeSmokeCommand).toBe("bun run v2/src/cli.ts --help");
      expect(result.runtimeSmokeObservation).toBe("error: command failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "runtime_smoke_failed",
        resumable: false,
      });
    });

    test("every finalization exit restores a terminal durable status, never leaving the tail marker", async () => {
      // Publication marks the row `in-progress` for the finalization tail. A row left there is
      // non-live forever and hangs `run wait`, which follows the log for non-terminal rows.
      const cases = [
        {
          kind: "ready_flip_failed",
          status: "completed",
          finalizer: async () => {
            throw new Error("gh pr ready failed");
          },
        },
        {
          kind: "runtime_smoke_failed",
          status: "completed",
          finalizer: async () => {
            throw new RuntimeSmokeFailedError("bun run v2/src/cli.ts --help", "error: command failed");
          },
        },
      ] as const;

      for (const { kind, status, finalizer } of cases) {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        const result = await runLoop({
          jarvisRoot,
          stateDbPath,
          bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
          completionCommitter: async () => ({ commitSha: "commit-abc", filesChanged: 1 }),
          completionPublisher: async () => ({ prNumber: 7 }),
          readyFinalizer: finalizer,
        });

        expect(result.kind).toBe(kind);
        expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe(status);
      }
    });
  });

  test("publishes index and spec-path titles, with named failure for unreadable indexes", async () => {
    const cases: Array<{
      branchName: string;
      specPath: string;
      index?: string | undefined;
      title?: string | undefined;
      unreadable?: boolean;
      failure?: boolean;
    }> = [
      { branchName: "index-title", specPath: "spec/index.md", index: "#  Index title  \n", title: "Index title" },
      { branchName: "sibling-title", specPath: "spec/01-write.md", index: "# Sibling title\n", title: "01-write.md" },
      { branchName: "missing-title", specPath: "spec/index.md", index: undefined, title: undefined, failure: true },
      {
        branchName: "unreadable-title",
        specPath: "spec/index.md",
        index: undefined,
        unreadable: true,
        title: undefined,
        failure: true,
      },
      { branchName: "malformed-title", specPath: "spec/index.md", index: "#\n", title: "spec" },
      { branchName: "blank-title", specPath: "spec/index.md", index: "# \n", title: "spec" },
      { branchName: "whitespace-title", specPath: "spec/index.md", index: "# \t \n", title: "spec" },
    ];

    for (const testCase of cases) {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      if (testCase.index !== undefined) writeSpecIndex(jarvisRoot, testCase.branchName, testCase.index);
      if (testCase.unreadable)
        mkdirSync(join(jarvisRoot, "worktrees", "demo", testCase.branchName, "spec", "index.md"), { recursive: true });
      const titles: unknown[] = [];
      const result = await runLoop({
        jarvisRoot,
        stateDbPath,
        branchName: testCase.branchName,
        specPath: testCase.specPath,
        bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe(testCase.failure ? "completion_commit_failed" : "complete");
      expect(titles).toEqual(testCase.failure ? [] : [testCase.title]);
    }
  });

  test("retains a resolved direct-write title when completed publication retries", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const branchName = "write-title-retry";
    writeSpecIndex(jarvisRoot, branchName, "# Durable title\n");

    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      specPath: "spec/index.md",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      completionCommitter: async () => ({ commitSha: "commit-1" }),
      completionPublisher: async () => {
        throw new Error("publish failed");
      },
    });
    expect(first.kind).toBe("completion_commit_failed");

    rmSync(join(jarvisRoot, "worktrees", "demo", branchName, "spec", "index.md"));
    mkdirSync(join(jarvisRoot, "worktrees", "demo", branchName, ".git"), { recursive: true });
    const titles: unknown[] = [];
    const retried = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      specPath: "spec/index.md",
      bindings: [],
      completionCommitter: async () => ({ commitSha: "commit-1" }),
      completionPublisher: async (input) => {
        titles.push(input.creationTitle);
        return {};
      },
      readyFinalizer: async () => {},
    });

    expect(retried.kind).toBe("complete");
    expect(titles).toEqual(["Durable title"]);
  });

  test("persists the final completion binding for a completed-run retry", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["quota", "done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(first.completionAgent).toBe("sim-agent-2");
    expect(loadRunOnce(stateDbPath, first.runId)?.attempts.at(-1)?.completionAgent).toBe("sim-agent-2");

    const retry = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: [],
    });
    expect(retry.completionAgent).toBe("sim-agent-2");
  });

  test("telemetry append failure leaves state-store and log contracts unchanged while surfacing failure detail", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const logSink = new TestLogSink();
    const telemetryDir = join(jarvisRoot, "telemetry-dir");
    mkdirSync(telemetryDir, { recursive: true });
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
      logSink,
      telemetry: loopTelemetry(telemetryDir),
    });

    expect(result.kind).toBe("complete");
    const run = loadRunOnce(stateDbPath, result.runId);
    expect(run?.status).toBe("completed");
    expect(logSink.getEventsForRun(result.runId).map((event) => event.kind)).toEqual([
      "iteration_started",
      "iteration_commit",
      "boundary_committed",
      "loop_finished",
    ]);
    if (run?.attempts[0]) {
      expect(run.attempts[0].outcomeKind).toBe("done");
    }
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
      bindings: simulatedBindings(["blocked"], { emitBlocker: true }),
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

  test("invalid_token resume starts a fresh attempt over the existing worktree", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();

    const first = await runLoop({
      jarvisRoot,
      stateDbPath,
      bindings: invalidTokenBindings,
      branchName: "invalid-token-run",
    });
    expect(first.resumable).toBe(true);

    const second = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName: "invalid-token-run",
      bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    });

    expect(second.kind).toBe("complete");
    expect(second.resumable).toBe(false);
    expect(second.runId).toBe(first.runId);
    expect(loadRunOnce(stateDbPath, second.runId)?.attempts).toHaveLength(2);
  });

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
    expect(timedOut).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 1, resumable: false });
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
      expect(result).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 1, resumable: false });
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

      expect(result).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 1, resumable: false });
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

      expect(result).toMatchObject({ kind: "iteration_timeout", iterationsConsumed: 2, resumable: false });
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
          resumable: false,
        });
      }
    } finally {
      store.close();
      mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
    }
  });

  test("abort-vs-watchdog precedence predicate: both truth directions, no real-timer wait", () => {
    expect(resolveIterationSettlementKind("abort", false)).toBe("aborted");
    expect(resolveIterationSettlementKind("watchdog", false)).toBe("timed_out");
    expect(resolveIterationSettlementKind("abort", true)).toBe("timed_out");
    expect(resolveIterationSettlementKind("watchdog", true)).toBe("aborted");
  });

  test("abort-vs-watchdog guard inversion: watchdog-first flips to progress when precedence is inverted", async () => {
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
      const result = await runAbortWatchdogOrdering({
        jarvisRoot,
        stateStore: store,
        order: "watchdog-first",
        branchName: "inverted-watchdog-first",
        invertPrecedence: true,
      });

      // With correct precedence this ordering settles "iteration_timeout" (see the case above).
      // Inverted, it wrongly settles "progress" — proving the settlement-kind mapping
      // (resolveIterationSettlementKind's role->kind assignment) is load-bearing. This does not
      // cover race-ordering regressions (e.g. a dropped watchdogSettled latch, abort settling
      // synchronously, or reordered Promise.race operands) — those stay invisible to this guard.
      expect(result).toMatchObject({ kind: "progress", resumable: true });
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

  describe("coverage advisory on implement write completion", () => {
    function completingWriteStub(worktreePath: string): Awaited<ReturnType<typeof realExecuteWrite>> {
      return {
        worktreePath,
        worktreeReused: false,
        lock: { kind: "acquired" },
        result: {
          kind: "complete",
          token: "done",
          invocation: { attempts: [], final: null, telemetryFailures: [] },
        },
      };
    }

    test("runs advisory with uncovered sites and logs response before terminal boundary", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const logSink = new TestLogSink();

      const advisoryResponses: string[] = [];
      const advisoryCalls: string[] = [];
      const stubResult = completingWriteStub(join(jarvisRoot, "worktrees", "demo", "advisory-run"));

      mock.module("./write.ts", () => ({
        executeWrite: async () => stubResult,
      }));

      mock.module("./uncovered-changed-lines.ts", () => ({
        reportUncoveredChangedLines: async () => {
          advisoryCalls.push("coverage-reporter");
          return {
            uncoveredSites: [
              { file: "v2/src/foo.ts", line: 10 },
              { file: "v2/src/bar.ts", line: 20 },
            ],
            reportText: "Uncovered changed lines (execution count is zero):\nv2/src/bar.ts:20\nv2/src/foo.ts:10",
          };
        },
      }));

      mock.module("../../../shared/invocation/execute.ts", () => ({
        executeWithQuotaFallback: async (input: {
          prompt?: string;
          cwd?: string;
          bindings?: unknown;
          signal?: AbortSignal;
          idleOutputMs?: number;
          telemetry?: unknown;
          sessionLog?: unknown;
        }) => {
          advisoryResponses.push(input.prompt ?? "");
          return {
            attempts: [],
            final: { result: { kind: "ok", stdout: "Coverage noted.\n" }, binding: { id: "b1", metadata: {} } },
            telemetryFailures: [],
          };
        },
      }));

      try {
        const result = await executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: "advisory-run",
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
          logSink,
          promptId: "patch.prompt.body",
        });

        expect(result.kind).toBe("complete");
        expect(advisoryCalls).toHaveLength(1);
        expect(advisoryResponses).toHaveLength(1);

        const events = logSink.getEventsForRun(result.runId);
        const advisoryEvent = events.find((e) => e.kind === "coverage_advisory");
        expect(advisoryEvent).toBeDefined();
        if (advisoryEvent?.kind === "coverage_advisory") {
          expect(advisoryEvent.responseText).toBe("Coverage noted.");
        }

        const boundaryEvent = events.find((e) => e.kind === "boundary_committed");
        expect(boundaryEvent).toBeDefined();

        // Verify advisory comes before boundary
        const advisoryIndex = events.findIndex((e) => e.kind === "coverage_advisory");
        const boundaryIndex = events.findIndex((e) => e.kind === "boundary_committed");
        expect(advisoryIndex).toBeGreaterThanOrEqual(0);
        expect(boundaryIndex).toBeGreaterThanOrEqual(0);
        expect(advisoryIndex).toBeLessThan(boundaryIndex);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
        mock.module("./uncovered-changed-lines.ts", () => ({}));
        mock.module("../../../shared/invocation/execute.ts", () => ({}));
      }
    });

    test("does not increment iterationsConsumed when advisory runs", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);

      const stubResult = completingWriteStub(join(jarvisRoot, "worktrees", "demo", "iter-count-run"));

      mock.module("./write.ts", () => ({
        executeWrite: async () => stubResult,
      }));

      mock.module("./uncovered-changed-lines.ts", () => ({
        reportUncoveredChangedLines: async () => ({
          uncoveredSites: [{ file: "v2/src/foo.ts", line: 10 }],
          reportText: "Uncovered: v2/src/foo.ts:10",
        }),
      }));

      mock.module("../../../shared/invocation/execute.ts", () => ({
        executeWithQuotaFallback: async () => ({
          attempts: [],
          final: { result: { kind: "ok", stdout: "Noted.\n" }, binding: { id: "b1", metadata: {} } },
          telemetryFailures: [],
        }),
      }));

      try {
        const result = await executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: "iter-count-run",
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
          promptId: "patch.prompt.body",
        });

        expect(result.kind).toBe("complete");
        expect(result.iterationsConsumed).toBe(1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
        mock.module("./uncovered-changed-lines.ts", () => ({}));
        mock.module("../../../shared/invocation/execute.ts", () => ({}));
      }
    });

    test("skips advisory when no uncovered sites", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const logSink = new TestLogSink();

      const advisoryInvoked = { called: false };

      const stubResult = completingWriteStub(join(jarvisRoot, "worktrees", "demo", "no-uncovered-run"));

      mock.module("./write.ts", () => ({
        executeWrite: async () => stubResult,
      }));

      mock.module("./uncovered-changed-lines.ts", () => ({
        reportUncoveredChangedLines: async () => {
          advisoryInvoked.called = true;
          return { uncoveredSites: [], reportText: "" };
        },
      }));

      try {
        const result = await executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: "no-uncovered-run",
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
          logSink,
          promptId: "patch.prompt.body",
        });

        expect(result.kind).toBe("complete");
        expect(advisoryInvoked.called).toBe(true);

        const events = logSink.getEventsForRun(result.runId);
        const advisoryEvent = events.find((e) => e.kind === "coverage_advisory");
        expect(advisoryEvent).toBeUndefined();
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
        mock.module("./uncovered-changed-lines.ts", () => ({}));
      }
    });

    test("skips advisory for non-implement prompts", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const store = openStateStore(stateDbPath);
      const logSink = new TestLogSink();

      const reporterCalled = { called: false };

      const stubResult = completingWriteStub(join(jarvisRoot, "worktrees", "demo", "non-patch-run"));

      mock.module("./write.ts", () => ({
        executeWrite: async () => stubResult,
      }));

      mock.module("./uncovered-changed-lines.ts", () => ({
        reportUncoveredChangedLines: async () => {
          reporterCalled.called = true;
          return {
            uncoveredSites: [{ file: "v2/src/foo.ts", line: 10 }],
            reportText: "Uncovered: v2/src/foo.ts:10",
          };
        },
      }));

      try {
        const result = await executeWriteLoop({
          worktree: {
            projectRoot: "/fake",
            projectName: "demo",
            branchName: "non-patch-run",
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
          logSink,
          promptId: "write.execute",
        });

        expect(result.kind).toBe("complete");
        expect(reporterCalled.called).toBe(false);

        const events = logSink.getEventsForRun(result.runId);
        const advisoryEvent = events.find((e) => e.kind === "coverage_advisory");
        expect(advisoryEvent).toBeUndefined();
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
        mock.module("./uncovered-changed-lines.ts", () => ({}));
      }
    });

    test("coverage-advisory prompt carries report text and states deliver-only", async () => {
      const { loadPromptRegistry } = await import("../../../shared/prompts/registry.ts");
      const { renderArtifactTemplate } = await import("../../../shared/prompts/render.ts");

      const registry = loadPromptRegistry();
      const artifact = registry.getById("write.coverage-advisory");

      expect(artifact).toBeDefined();
      expect(artifact.metadata.placeholders).toContainEqual({
        name: "COVERAGE_REPORT",
        type: "string",
        required: true,
      });

      const testReport = "Uncovered changed lines (execution count is zero):\nv2/src/foo.ts:10\n\nNote: ...";
      const rendered = renderArtifactTemplate(artifact, { COVERAGE_REPORT: testReport });

      expect(rendered).toContain(testReport);
      expect(rendered).toContain("deliver-only");
    });
  });

  describe("per-iteration git commit on progress", () => {
    const progressInvocation = {
      attempts: [] as const,
      final: {
        result: { kind: "ok" as const, stdout: "progress", stderr: "" },
        binding: {
          id: "sim.1",
          metadata: { agent: "Test Agent", model: "sim-model" },
        },
      },
      telemetryFailures: [] as const,
    };

    function gitIn(worktreePath: string, args: readonly string[]): string {
      return execFileSync("git", ["-C", worktreePath, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
    }

    function initGitWorktree(jarvisRoot: string, branchName: string): string {
      const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
      mkdirSync(worktreePath, { recursive: true });
      execFileSync("git", ["init", worktreePath], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.email", "test@example.com"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "config", "user.name", "Test User"], { stdio: "pipe" });
      writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n", "utf8");
      writeFileSync(join(worktreePath, "README.md"), "seed\n", "utf8");
      execFileSync("git", ["-C", worktreePath, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktreePath, "commit", "-m", "seed"], { stdio: "pipe" });
      return worktreePath;
    }

    function progressWrite(worktreePath: string) {
      return {
        worktreePath,
        worktreeReused: false as const,
        lock: { kind: "acquired" as const },
        result: { kind: "progress" as const, token: "progress" as const, invocation: progressInvocation },
      };
    }

    function completeWrite(worktreePath: string) {
      return {
        worktreePath,
        worktreeReused: false as const,
        lock: { kind: "acquired" as const },
        result: { kind: "complete" as const, token: "done" as const, invocation: progressInvocation },
      };
    }

    function iterLoopInput(
      jarvisRoot: string,
      branchName: string,
      store: StateStore,
      extra: Partial<WriteLoopInput> = {},
    ): WriteLoopInput {
      return {
        worktree: { projectRoot: "/fake", projectName: "demo", branchName, baseRef: "HEAD", jarvisRoot },
        specPath: "spec.md",
        stepRules: "Return progress.",
        expectedArtifactPath: "proof.txt",
        bindings: simulatedBindings(["progress"]),
        stateStore: store,
        withExternalWorktree: createFakeWithExternalWorktree(jarvisRoot),
        sessionsDir: join(jarvisRoot, "sessions"),
        completionCommitter: createCompletionCommitter(),
        maxIterations: 5,
        ...extra,
      };
    }

    test("terminal completion adds a third sha after two iteration commits and attribution lists all", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-terminal-boundary";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      writeFileSync(join(worktreePath, "subspec.md"), "- [ ] task\n", "utf8");
      const store = openStateStore(stateDbPath);
      const seedBase = gitIn(worktreePath, ["rev-parse", "HEAD"]);
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls <= 2) {
            writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
            return progressWrite(worktreePath);
          }
          return completeWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            stepRules: "Return progress or done.",
            expectedArtifactPath: "subspec.md",
            bindings: simulatedBindings(["progress", "progress", "done"]),
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );

        expect(result.kind).toBe("complete");
        const terminalSha = gitIn(worktreePath, ["rev-parse", "HEAD"]);
        const iterTwoSha = gitIn(worktreePath, ["rev-parse", "HEAD~1"]);
        const iterOneSha = gitIn(worktreePath, ["rev-parse", "HEAD~2"]);
        expect(new Set([terminalSha, iterTwoSha, iterOneSha]).size).toBe(3);
        expect(terminalSha).not.toBe(iterTwoSha);

        const footer = await renderAttribution({ cwd: worktreePath, base: seedBase });
        expect(footer).toContain(iterOneSha.slice(0, 7));
        expect(footer).toContain(iterTwoSha.slice(0, 7));
        expect(footer).toContain(terminalSha.slice(0, 7));
        expect(footer).toContain("Test Agent");
        expect(footer).toContain("Written by");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("publish-resume uses forceDistinctCommit after iteration commits on a clean tree", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-publish-resume-distinct";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      writeFileSync(join(worktreePath, "subspec.md"), "- [ ] task\n", "utf8");
      const store = openStateStore(stateDbPath);
      let calls = 0;
      let publishAttempts = 0;
      const forceDistinctFlags: boolean[] = [];

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls <= 2) {
            writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
            return progressWrite(worktreePath);
          }
          writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      const trackingCommitter: WriteLoopInput["completionCommitter"] = async (input) => {
        forceDistinctFlags.push(input.forceDistinctCommit === true);
        return createCompletionCommitter()(input);
      };

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const first = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            stepRules: "Return progress or done.",
            expectedArtifactPath: "subspec.md",
            bindings: simulatedBindings(["progress", "progress", "done"]),
            completionCommitter: trackingCommitter,
            completionPublisher: async () => {
              publishAttempts += 1;
              if (publishAttempts === 1) throw new Error("publish failed");
              return {};
            },
            readyFinalizer: async () => {},
          }),
        );
        expect(first.kind).toBe("completion_commit_failed");
        // 2 progress checkpoints + the completing iteration's own checkpoint + the terminal
        // forceDistinctCommit commit, before publication throws.
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 4);

        const resumed = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: [],
            completionCommitter: trackingCommitter,
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );
        expect(resumed.kind).toBe("complete");
        expect(forceDistinctFlags.filter(Boolean).length).toBeGreaterThanOrEqual(2);
        expect(forceDistinctFlags.at(-1)).toBe(true);
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 5);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("dirty worktree after iteration commits fails terminal completion and names paths", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-dirty-terminal";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      writeFileSync(join(worktreePath, "subspec.md"), "- [ ] task\n", "utf8");
      const store = openStateStore(stateDbPath);
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls <= 2) {
            writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
            return progressWrite(worktreePath);
          }
          writeFileSync(join(worktreePath, "left-dirty.txt"), "uncommitted\n");
          return completeWrite(worktreePath);
        },
      }));

      try {
        // Progress iterations checkpoint normally; the completing iteration's own checkpoint
        // and the terminal forceDistinctCommit call both no-op, simulating a committer that
        // cannot capture the completing iteration's worktree state either time.
        let commitCalls = 0;
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            stepRules: "Return progress or done.",
            expectedArtifactPath: "subspec.md",
            bindings: simulatedBindings(["progress", "progress", "done"]),
            completionCommitter: async (input) => {
              commitCalls += 1;
              if (commitCalls > 2) return {};
              return createCompletionCommitter()(input);
            },
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );

        expect(result.kind).toBe("completion_commit_failed");
        expect(result.completionCommitError).toContain("left-dirty.txt");
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(3);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("shouldFailTerminalCompletionForDirtyWorktree rejects complete when dirty after no-op committer (inverted guard would complete)", () => {
      expect(shouldFailTerminalCompletionForDirtyWorktree(undefined, ["left-dirty.txt"])).toBe(true);
      expect(shouldFailTerminalCompletionForDirtyWorktree("sha", ["left-dirty.txt"])).toBe(false);
      expect(shouldFailTerminalCompletionForDirtyWorktree(undefined, [])).toBe(false);
      const invertedIgnoresDirty = false;
      expect(shouldFailTerminalCompletionForDirtyWorktree(undefined, ["left-dirty.txt"])).not.toBe(
        invertedIgnoresDirty,
      );
    });

    test("commits once per changed progress iteration with Jarvis-Agent and Spec lines", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-commit-run";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      writeFileSync(join(worktreePath, "subspec.md"), "- [ ] task\n", "utf8");
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls <= 2) {
            writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
            return progressWrite(worktreePath);
          }
          writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            stepRules: "Return progress or done.",
            expectedArtifactPath: "subspec.md",
            bindings: simulatedBindings(["progress", "progress", "done"]),
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
            logSink: sink,
          }),
        );

        expect(result.kind).toBe("complete");
        // 2 progress checkpoints + the completing iteration's own checkpoint + the distinct
        // terminal completion commit.
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 4);
        for (const rev of ["HEAD~1", "HEAD~2"]) {
          const message = gitIn(worktreePath, ["log", "-1", "--format=%B", rev]);
          expect(message).toContain("Jarvis-Agent: Test Agent");
          expect(message).toContain("Spec: subspec.md");
        }
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("skips git commit when progress materializes no diff vs HEAD", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-no-diff";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          return progressWrite(worktreePath);
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const result = await executeWriteLoop(iterLoopInput(jarvisRoot, branchName, store, { maxIterations: 1 }));

        expect(result.kind).toBe("budget-exhausted");
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount);
        expect(calls).toBe(1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("a workflow step (publishCompletion: false) commits progress iterations and leaves commits after a mid-run failure", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-workflow-step-mid-run-failure";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      let calls = 0;
      let publisherCalled = false;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls <= 2) {
            writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
            return progressWrite(worktreePath);
          }
          return {
            worktreePath,
            worktreeReused: false as const,
            lock: { kind: "acquired" as const },
            result: {
              kind: "invocation_failure" as const,
              failureKind: "error" as const,
              invocation: progressInvocation,
            },
          };
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["progress", "progress", "error"]),
            publishCompletion: false,
            completionPublisher: async () => {
              publisherCalled = true;
              return {};
            },
          }),
        );

        expect(result.kind).toBe("invocation_failure");
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 2);
        expect(publisherCalled).toBe(false);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("a no-change iteration following a committing iteration reports skipped, not the prior sha", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-no-change-after-commit";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls === 1) writeFileSync(join(worktreePath, "iter-1.txt"), "x\n");
          return progressWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, { maxIterations: 2, logSink: sink }),
        );

        expect(result.kind).toBe("budget-exhausted");
        const commitEvents = sink.getEventsForRun(result.runId).filter((event) => event.kind === "iteration_commit");
        expect(commitEvents).toHaveLength(2);
        expect(commitEvents[0]?.kind === "iteration_commit" && "commitSha" in commitEvents[0]).toBe(true);
        expect(commitEvents[1]).toMatchObject({ kind: "iteration_commit", skipReason: "no_file_changes" });
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("iteration_commit event distinguishes committed, no_file_changes, and no_git skips", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));

      // no_git: no .git directory under the worktree, using the git: false + localPath shape
      // production no-commit intent steps use.
      const noGitBranch = "iter-no-git";
      const noGitWorktreePath = join(jarvisRoot, "no-commit-intent-stage");
      mkdirSync(noGitWorktreePath, { recursive: true });
      const noGitStore = openStateStore(stateDbPath);
      const noGitSink = new TestLogSink();
      mock.module("./write.ts", () => ({
        executeWrite: async () => progressWrite(noGitWorktreePath),
      }));
      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, noGitBranch, noGitStore, {
            maxIterations: 1,
            logSink: noGitSink,
            worktree: {
              projectRoot: "/fake",
              projectName: "demo",
              branchName: noGitBranch,
              baseRef: "HEAD",
              git: false,
              localPath: noGitWorktreePath,
            },
            withExternalWorktree: async (_args, run) => ({
              worktree: { path: noGitWorktreePath, reused: false },
              lock: { kind: "acquired" },
              value: await run({ path: noGitWorktreePath, reused: false }),
            }),
          }),
        );
        const events = noGitSink.getEventsForRun(result.runId).filter((event) => event.kind === "iteration_commit");
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ kind: "iteration_commit", skipReason: "no_git" });
      } finally {
        noGitStore.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }

      // committed vs no_file_changes: real git worktree, first iteration changes a file, second doesn't.
      const branchName = "iter-commit-vs-no-change";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      let calls = 0;
      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          if (calls === 1) writeFileSync(join(worktreePath, "iter-1.txt"), "x\n");
          return progressWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, { maxIterations: 2, logSink: sink }),
        );
        const events = sink.getEventsForRun(result.runId).filter((event) => event.kind === "iteration_commit");
        expect(events).toHaveLength(2);
        expect(events[0]?.kind === "iteration_commit" && "commitSha" in events[0]).toBe(true);
        expect(events[1]).toMatchObject({ kind: "iteration_commit", skipReason: "no_file_changes" });
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("keeps iteration commit when aborted before the next iteration starts", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-abort-between";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const abort = new AbortController();
      let calls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          calls += 1;
          writeFileSync(join(worktreePath, `iter-${calls}.txt`), "x\n");
          if (calls === 1) {
            queueMicrotask(() => abort.abort());
            return progressWrite(worktreePath);
          }
          return new Promise<never>(() => undefined);
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["progress", "progress"]),
            signal: abort.signal,
          }),
        );

        expect(result).toMatchObject({ kind: "progress", resumable: true, iterationsConsumed: 1 });
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 1);
        expect(calls).toBe(1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("commits progress before post-settle abort short-circuit", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-abort-post-settle";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const abort = new AbortController();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "iter-1.txt"), "x\n");
          abort.abort();
          return progressWrite(worktreePath);
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const result = await executeWriteLoop(iterLoopInput(jarvisRoot, branchName, store, { signal: abort.signal }));

        expect(result).toMatchObject({ kind: "progress", resumable: true, iterationsConsumed: 1 });
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("stops failed when iteration commit throws on progress", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-commit-fail";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      let commitCalls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "iter-1.txt"), "x\n");
          return progressWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["progress", "progress"]),
            logSink: sink,
            completionCommitter: async () => {
              commitCalls += 1;
              throw new Error("iteration commit blew up");
            },
          }),
        );

        expect(result.kind).toBe("iteration_commit_failed");
        expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("failed");
        expect(commitCalls).toBe(1);
        expect(sink.getEventsForRun(result.runId).filter((event) => event.kind === "iteration_started")).toHaveLength(
          1,
        );
        expect(sink.getEventsForRun(result.runId).filter((event) => event.kind === "boundary_committed")).toHaveLength(
          0,
        );
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("single-iteration done without progress emits iteration_commit", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-single-done";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const initialCount = Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]));
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["done"]),
            logSink: sink,
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );

        expect(result.kind).toBe("complete");
        expect(sink.getEventsForRun(result.runId).map((event) => event.kind)).toEqual([
          "iteration_started",
          "iteration_commit",
          "boundary_committed",
          "loop_finished",
        ]);

        // The checkpoint commit (capturing proof.txt) is distinct from the terminal completion commit.
        const checkpointSha = gitIn(worktreePath, ["rev-parse", "HEAD~1"]);
        const terminalSha = gitIn(worktreePath, ["rev-parse", "HEAD"]);
        expect(checkpointSha).not.toBe(terminalSha);
        expect(result.commitSha).toBe(terminalSha);
        expect(Number(gitIn(worktreePath, ["rev-list", "--count", "HEAD"]))).toBe(initialCount + 2);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("settled result classes checkpoint before their boundary", async () => {
      const checkpointCaseInvocation = {
        attempts: [],
        final: {
          result: { kind: "ok" as const, stdout: "response", stderr: "" },
          binding: {
            id: "sim.1",
            metadata: { agent: "Test Agent", model: "sim-model" },
            invoke: async () => ({ kind: "ok" as const, stdout: "response", stderr: "" }),
          },
        },
        telemetryFailures: [],
      };
      const cases: Array<{ label: string; result: StepRunResult; expectedOutcomeKind: OutcomeKind }> = [
        {
          label: "no-work",
          result: { kind: "complete", token: "no-work", invocation: checkpointCaseInvocation },
          expectedOutcomeKind: "no-work",
        },
        {
          label: "blocked",
          result: { kind: "blocked", token: "blocked", invocation: checkpointCaseInvocation },
          expectedOutcomeKind: "blocked",
        },
        {
          label: "invalid_token",
          result: {
            kind: "invalid_token",
            tokenText: "prose without a terminal token",
            invocation: checkpointCaseInvocation,
          },
          expectedOutcomeKind: "invalid_token",
        },
        {
          label: "missing_blocker",
          result: {
            kind: "missing_blocker",
            token: "blocked",
            responseText: "no blocker text here",
            invocation: checkpointCaseInvocation,
          },
          expectedOutcomeKind: "missing_blocker",
        },
        {
          label: "invocation_failure",
          result: { kind: "invocation_failure", failureKind: "error", invocation: checkpointCaseInvocation },
          expectedOutcomeKind: "invocation_failure",
        },
        {
          label: "idle_output_timeout",
          result: { kind: "stall", invocation: checkpointCaseInvocation },
          expectedOutcomeKind: "idle_output_timeout",
        },
      ];

      for (const testCase of cases) {
        const { jarvisRoot, stateDbPath } = createJarvisHome();
        roots.push(join(jarvisRoot, ".."));
        const branchName = `settled-checkpoint-${testCase.label}`;
        const worktreePath = initGitWorktree(jarvisRoot, branchName);
        const store = openStateStore(stateDbPath);
        const sink = new TestLogSink();

        mock.module("./write.ts", () => ({
          executeWrite: async () => {
            writeFileSync(join(worktreePath, `${testCase.label}.txt`), "x\n", "utf8");
            return {
              worktreePath,
              worktreeReused: false as const,
              lock: { kind: "acquired" as const },
              result: testCase.result,
            };
          },
        }));

        try {
          const result = await executeWriteLoop(iterLoopInput(jarvisRoot, branchName, store, { logSink: sink }));

          const events = sink.getEventsForRun(result.runId);
          const commitIndex = events.findIndex((event) => event.kind === "iteration_commit");
          const boundaryIndex = events.findIndex((event) => event.kind === "boundary_committed");
          expect(commitIndex).toBeGreaterThanOrEqual(0);
          expect(boundaryIndex).toBeGreaterThan(commitIndex);

          const boundaryEvent = events.find((event) => event.kind === "boundary_committed");
          expect(boundaryEvent?.kind === "boundary_committed" && boundaryEvent.outcomeKind).toBe(
            testCase.expectedOutcomeKind,
          );
        } finally {
          store.close();
          mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
        }
      }
    });

    test("contract-miss blocker is included in its settled checkpoint", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-contract-miss-checkpoint";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "agent-edit.txt"), "edit\n", "utf8");
          return {
            worktreePath,
            worktreeReused: false as const,
            lock: { kind: "acquired" as const },
            result: {
              kind: "contract_miss" as const,
              token: "done" as const,
              failedContractId: "artifact.expected",
              failureReason: "expected artifact missing",
              invocation: progressInvocation,
            },
          };
        },
      }));

      try {
        const result = await executeWriteLoop(iterLoopInput(jarvisRoot, branchName, store, { logSink: sink }));

        expect(result.kind).toBe("contract_miss");
        const events = sink.getEventsForRun(result.runId);
        const commitIndex = events.findIndex((event) => event.kind === "iteration_commit");
        const boundaryIndex = events.findIndex((event) => event.kind === "boundary_committed");
        expect(commitIndex).toBeGreaterThanOrEqual(0);
        expect(boundaryIndex).toBeGreaterThan(commitIndex);

        const commitEvent = events.find((event) => event.kind === "iteration_commit");
        const checkpointSha =
          commitEvent?.kind === "iteration_commit" && "commitSha" in commitEvent ? commitEvent.commitSha : undefined;
        expect(checkpointSha).toBeDefined();

        const specAtCheckpoint = gitIn(worktreePath, ["show", `${checkpointSha}:spec.md`]);
        expect(specAtCheckpoint).toContain("## Blocker");
        const treeAtCheckpoint = gitIn(worktreePath, ["ls-tree", "--name-only", checkpointSha as string]);
        expect(treeAtCheckpoint.split("\n")).toContain("agent-edit.txt");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("settled checkpoint failure supersedes terminal boundary and publication", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "iter-checkpoint-failure-supersedes";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      let publishCalls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["done"]),
            logSink: sink,
            completionCommitter: async () => {
              throw new Error("checkpoint commit blew up");
            },
            completionPublisher: async () => {
              publishCalls += 1;
              return {};
            },
            readyFinalizer: async () => {},
          }),
        );

        expect(result.kind).toBe("iteration_commit_failed");
        expect(result.resumable).toBe(true);
        expect(publishCalls).toBe(0);
        const failedRun = loadRunOnce(stateDbPath, result.runId);
        expect(failedRun?.status).toBe("failed");
        expect(failedRun?.attempts.at(-1)?.status).toBe("in-progress");
        expect(sink.getEventsForRun(result.runId).filter((event) => event.kind === "boundary_committed")).toHaveLength(
          0,
        );

        let resumedCalls = 0;
        mock.module("./write.ts", () => ({
          executeWrite: async () => {
            resumedCalls += 1;
            return completeWrite(worktreePath);
          },
        }));
        const resumed = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["done"]),
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );
        expect(resumed.kind).toBe("complete");
        expect(resumedCalls).toBe(1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("deadline-killed gate (exit 124) skips repair and emits ready_gate_timeout", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "deadline-gate-124";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          return completeWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {
              const { ReadyGateError } = await import("./ready-finalize.ts");
              throw new ReadyGateError("bun run ready", 124, "timeout\n", true);
            },
          }),
        );

        expect(result.kind).toBe("ready_gate_failed");
        expect(result.resumable).toBe(true);

        const events = sink.getEventsForRun(result.runId);
        const repairEvents = events.filter((event) => event.kind === "ready_gate_repair");
        expect(repairEvents).toHaveLength(0);

        const timeoutEvents = events.filter((event) => event.kind === "ready_gate_timeout");
        expect(timeoutEvents).toHaveLength(1);
        if (timeoutEvents[0]?.kind === "ready_gate_timeout") {
          expect(timeoutEvents[0].gateExitCode).toBe(124);
        }
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("deadline-killed gate (marker in output) skips repair and emits ready_gate_timeout", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "deadline-gate-marker";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          return completeWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {
              const { ReadyGateError } = await import("./ready-finalize.ts");
              throw new ReadyGateError(
                "bun run ready",
                1,
                "ready: deadline exceeded after 600000ms; killing child tree\n",
                true,
              );
            },
          }),
        );

        expect(result.kind).toBe("ready_gate_failed");
        expect(result.resumable).toBe(true);

        const events = sink.getEventsForRun(result.runId);
        const repairEvents = events.filter((event) => event.kind === "ready_gate_repair");
        expect(repairEvents).toHaveLength(0);

        const timeoutEvents = events.filter((event) => event.kind === "ready_gate_timeout");
        expect(timeoutEvents).toHaveLength(1);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("non-timeout gate failure still enters repair path", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "genuine-gate-failure";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          return completeWrite(worktreePath);
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {
              const { ReadyGateError } = await import("./ready-finalize.ts");
              throw new ReadyGateError("bun run ready", 1, "tests failed\n", false);
            },
          }),
        );

        expect(result.kind).toBe("ready_gate_failed");

        const events = sink.getEventsForRun(result.runId);
        const repairEvents = events.filter((event) => event.kind === "ready_gate_repair");
        expect(repairEvents.length).toBeGreaterThan(0);

        const timeoutEvents = events.filter((event) => event.kind === "ready_gate_timeout");
        expect(timeoutEvents).toHaveLength(0);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    /**
     * A kill mirrors the daemon's real sequencing: `commitGuardedKill` persists the killed status
     * durably before `abortController.abort()` fires, so a checkpoint failure racing the abort can
     * see that status already recorded and preserve it (`kill checkpoint failure preserves killed
     * state` proves nothing otherwise). Driven synchronously right after `executeWriteLoop` is
     * called (not awaited yet): the loop's synchronous prefix — `prepareRun`, `onRunCreated`, and
     * the first binding invocation up to its own first `await` — has already run by then, so the
     * write is already on disk and `runId` is already captured.
     */
    function killAfterDispatch(
      store: StateStore,
      controller: AbortController,
      getRunId: () => string | undefined,
    ): void {
      const runId = getRunId();
      if (runId === undefined) throw new Error("runId not captured before kill");
      store.commitGuardedKill(runId);
      controller.abort();
    }

    /** Resolves only once the executionController's abort signal fires, after a real macrotask
     * hop — so it never wins a same-tick race against the awaitIteration `abort` promise. */
    function resolveOnAbort<T>(input: WriteExecuteInput, value: T): Promise<T> {
      return new Promise((resolve) => {
        input.signal?.addEventListener("abort", () => setTimeout(() => resolve(value), 5), { once: true });
      });
    }

    test("a non-progress result that settles before abort still checkpoints", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "settle-before-abort";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const controller = new AbortController();

      // Resolves on its own, never touching `input.signal`: this write has already settled by
      // the time the abort fires, unlike the kill/watchdog tests below which race the abort.
      mock.module("./write.ts", () => ({
        executeWrite: async () => {
          writeFileSync(join(worktreePath, "settle-before-abort.txt"), "settled-before-abort\n", "utf8");
          return completeWrite(worktreePath);
        },
      }));

      try {
        const resultPromise = executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, { signal: controller.signal }),
        );
        controller.abort();
        const result = await resultPromise;

        expect(result.kind).toBe("progress");
        expect(result.resumable).toBe(true);

        expect(gitIn(worktreePath, ["show", "HEAD:settle-before-abort.txt"])).toBe("settled-before-abort");
        expect(gitIn(worktreePath, ["status", "--porcelain"])).toBe("");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("mid-iteration kill commits agent edits before settle", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "kill-mid-iteration";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const controller = new AbortController();
      let runId: string | undefined;

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "kill-proof.txt"), "killed-work\n", "utf8");
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const resultPromise = executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            signal: controller.signal,
            onRunCreated: (id) => {
              runId = id;
            },
          }),
        );
        killAfterDispatch(store, controller, () => runId);
        const result = await resultPromise;

        expect(result.kind).toBe("progress");
        expect(result.resumable).toBe(true);
        expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("killed");

        expect(gitIn(worktreePath, ["show", "HEAD:kill-proof.txt"])).toBe("killed-work");
        expect(gitIn(worktreePath, ["status", "--porcelain"])).toBe("");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("iteration watchdog checkpoints quiesced agent edits before timeout settlement", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "watchdog-checkpoint";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "watchdog-proof.txt"), "watchdog-work\n", "utf8");
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            iterationTimeoutMs: 15,
          }),
        );

        expect(result.kind).toBe("iteration_timeout");
        expect(result.resumable).toBe(false);
        expect(gitIn(worktreePath, ["show", "HEAD:watchdog-proof.txt"])).toBe("watchdog-work");
        expect(gitIn(worktreePath, ["status", "--porcelain"])).toBe("");

        const events = sink.getEventsForRun(result.runId);
        const commitIndex = events.findIndex((event) => event.kind === "iteration_commit");
        const boundaryIndex = events.findIndex(
          (event) => event.kind === "boundary_committed" && event.outcomeKind === "iteration_timeout",
        );
        expect(commitIndex).toBeGreaterThanOrEqual(0);
        expect(boundaryIndex).toBeGreaterThan(commitIndex);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("kill checkpoint precedes loop settlement", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "kill-precedes-settlement";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const controller = new AbortController();
      let runId: string | undefined;

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "kill-order-proof.txt"), "x\n", "utf8");
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const resultPromise = executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            signal: controller.signal,
            logSink: sink,
            onRunCreated: (id) => {
              runId = id;
            },
          }),
        );
        killAfterDispatch(store, controller, () => runId);
        const result = await resultPromise;

        expect(result.kind).toBe("progress");

        const events = sink.getEventsForRun(result.runId);
        const commitIndex = events.findIndex((event) => event.kind === "iteration_commit");
        const finishedIndex = events.findIndex((event) => event.kind === "loop_finished");
        expect(commitIndex).toBeGreaterThanOrEqual(0);
        expect(finishedIndex).toBeGreaterThan(commitIndex);

        expect(loadRunOnce(stateDbPath, result.runId)?.status).toBe("killed");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("interrupted fallback checkpoint attributes the active binding", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "kill-fallback-attribution";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const controller = new AbortController();
      let runId: string | undefined;

      const primaryBinding = { id: "primary", metadata: { agent: "Primary Agent", model: "primary-model" } };
      const fallbackBinding = { id: "fallback", metadata: { agent: "Fallback Agent", model: "fallback-model" } };

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "fallback-proof.txt"), "fallback-work\n", "utf8");
          return resolveOnAbort(input, {
            worktreePath,
            worktreeReused: false as const,
            lock: { kind: "acquired" as const },
            result: {
              kind: "progress" as const,
              token: "progress" as const,
              invocation: {
                attempts: [
                  { binding: primaryBinding, result: { kind: "quota" as const, stderr: "quota" } },
                  { binding: fallbackBinding, result: { kind: "ok" as const, stdout: "progress", stderr: "" } },
                ],
                final: { binding: fallbackBinding, result: { kind: "ok" as const, stdout: "progress", stderr: "" } },
                telemetryFailures: [],
              },
            },
          });
        },
      }));

      try {
        const resultPromise = executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            signal: controller.signal,
            onRunCreated: (id) => {
              runId = id;
            },
          }),
        );
        killAfterDispatch(store, controller, () => runId);
        const result = await resultPromise;

        expect(result.kind).toBe("progress");
        const checkpointSha = gitIn(worktreePath, ["rev-parse", "HEAD"]);
        const message = gitIn(worktreePath, ["log", "-1", "--format=%B", checkpointSha]);
        expect(message).toContain("Jarvis-Agent: Fallback Agent");
        expect(message).not.toContain("Jarvis-Agent: Primary Agent");
        expect(gitIn(worktreePath, ["show", `${checkpointSha}:fallback-proof.txt`])).toBe("fallback-work");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("watchdog checkpoint failure supersedes timeout boundary", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "watchdog-checkpoint-fail";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      let publishCalls = 0;

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "watchdog-fail-proof.txt"), "x\n", "utf8");
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            logSink: sink,
            iterationTimeoutMs: 15,
            completionCommitter: async () => {
              throw new Error("checkpoint blew up");
            },
            completionPublisher: async () => {
              publishCalls += 1;
              return {};
            },
            readyFinalizer: async () => {},
          }),
        );

        expect(result.kind).toBe("iteration_commit_failed");
        expect(result.resumable).toBe(true);
        expect(publishCalls).toBe(0);

        const events = sink.getEventsForRun(result.runId);
        expect(events.some((event) => event.kind === "boundary_committed")).toBe(false);
        expect(
          events.some((event) => event.kind === "loop_finished" && event.loopOutcomeKind === "iteration_timeout"),
        ).toBe(false);

        const failedRun = loadRunOnce(stateDbPath, result.runId);
        expect(failedRun?.status).toBe("failed");
        expect(failedRun?.attempts.at(-1)?.status).toBe("in-progress");

        mock.module("./write.ts", () => ({
          executeWrite: async () => {
            writeFileSync(join(worktreePath, "proof.txt"), "ok\n", "utf8");
            return completeWrite(worktreePath);
          },
        }));

        const resumed = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: simulatedBindings(["done"]),
            completionCommitter: createCompletionCommitter(),
            completionPublisher: async () => ({}),
            readyFinalizer: async () => {},
          }),
        );
        expect(resumed.kind).toBe("complete");
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("kill checkpoint failure preserves killed state", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "kill-checkpoint-fail";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const controller = new AbortController();
      let runId: string | undefined;

      mock.module("./write.ts", () => ({
        executeWrite: (input: WriteExecuteInput) => {
          writeFileSync(join(worktreePath, "kill-fail-proof.txt"), "x\n", "utf8");
          return resolveOnAbort(input, progressWrite(worktreePath));
        },
      }));

      try {
        const resultPromise = executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            signal: controller.signal,
            logSink: sink,
            onRunCreated: (id) => {
              runId = id;
            },
            completionCommitter: async () => {
              throw new Error("checkpoint after kill blew up");
            },
          }),
        );
        killAfterDispatch(store, controller, () => runId);
        const result = await resultPromise;

        expect(result.kind).toBe("progress");
        expect(result.resumable).toBe(true);

        const run = loadRunOnce(stateDbPath, result.runId);
        expect(run?.status).toBe("killed");
        expect(run?.attempts.at(-1)?.status).toBe("in-progress");

        const events = sink.getEventsForRun(result.runId);
        expect(events.some((event) => event.kind === "boundary_committed")).toBe(false);
        expect(events.some((event) => event.kind === "iteration_commit")).toBe(false);
        const diagnostic = events.find(
          (event) =>
            event.kind === "run_execution_failed" && event.message?.includes("checkpoint after kill failed") === true,
        );
        expect(diagnostic).toBeDefined();
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("quiescence wait is bounded when the invocation never quiesces", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "quiescence-bound";
      initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();
      const controller = new AbortController();

      // Ignores `signal` entirely: never settles, mirroring an invocation that ignores its
      // AbortSignal, the case the durability floor explicitly excludes.
      mock.module("./write.ts", () => ({
        executeWrite: () => new Promise<never>(() => undefined),
      }));

      try {
        const resultPromise = executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            signal: controller.signal,
            logSink: sink,
            quiescenceTimeoutMs: 20,
          }),
        );
        controller.abort();
        const result = await resultPromise;

        expect(result.kind).toBe("progress");
        expect(result.resumable).toBe(true);

        const events = sink.getEventsForRun(result.runId);
        expect(events.some((event) => event.kind === "iteration_commit")).toBe(false);
        expect(events.some((event) => event.kind === "boundary_committed")).toBe(false);
        expect(events.some((event) => event.kind === "loop_finished")).toBe(true);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });

    test("invocation_failure with no binding skips the checkpoint and preserves detail", async () => {
      const { jarvisRoot, stateDbPath } = createJarvisHome();
      roots.push(join(jarvisRoot, ".."));
      const branchName = "no-binding-checkpoint-skip";
      const worktreePath = initGitWorktree(jarvisRoot, branchName);
      const store = openStateStore(stateDbPath);
      const sink = new TestLogSink();

      mock.module("./write.ts", () => ({
        executeWrite: async () => ({
          worktreePath,
          worktreeReused: false as const,
          lock: { kind: "acquired" as const },
          result: {
            kind: "invocation_failure" as const,
            failureKind: "no_binding" as const,
            invocation: { attempts: [], final: null, telemetryFailures: [] },
          },
        }),
      }));

      try {
        const result = await executeWriteLoop(
          iterLoopInput(jarvisRoot, branchName, store, {
            bindings: [],
            logSink: sink,
          }),
        );

        expect(result.kind).toBe("invocation_failure");
        expect(result.resumable).toBe(false);
        expect(result.failureKind).toBe("no_binding");
        expect(result.bindingAttempts).toEqual([]);

        const events = sink.getEventsForRun(result.runId);
        const commitEvent = events.find((event) => event.kind === "iteration_commit");
        expect(commitEvent?.kind === "iteration_commit" && "skipReason" in commitEvent && commitEvent.skipReason).toBe(
          "no_binding",
        );
        expect(events.some((event) => event.kind === "boundary_committed")).toBe(true);
      } finally {
        store.close();
        mock.module("./write.ts", () => ({ executeWrite: realExecuteWrite }));
      }
    });
  });
});

describe("persistRetainedFinalizationCheckpoint", () => {
  test("returns false without a done attempt and does not persist", () => {
    const stateDbPath = join(tmpdir(), `jarvis-checkpoint-${process.pid}-${Date.now()}.db`);
    const store = openStateStore(stateDbPath);
    try {
      const runId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath: "/tmp/wt",
        branch: "branch",
        specPath: "spec.md",
      });
      const persisted = persistRetainedFinalizationCheckpoint(store, runId, {
        runId,
        kind: "ready_gate_failed",
        iterationsConsumed: 4,
        resumable: true,
        completionAgent: "agent-1",
      });
      expect(persisted).toBe(false);
      expect(store.loadRun(runId)?.retainedFinalizationCheckpoint ?? null).toBeNull();
    } finally {
      store.close();
      rmSync(stateDbPath, { force: true });
    }
  });
});
