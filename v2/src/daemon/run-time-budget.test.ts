import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLogReader } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import { flushBackgroundRuns, loadRunOrThrow, mockWriteLoopInput } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";
import { deriveOperatorIncidents } from "./operator-incidents.ts";
import { composeRunOperatorError } from "./run-operator-error.ts";
import {
  armRunTimeout,
  consumedRunBudgetMs,
  RUN_BUDGET_CHECKPOINT_INTERVAL_MS,
  type RunTimeoutTimers,
  remainingRunBudgetMs,
  runTimeoutSettles,
  runTimeoutShouldFire,
  settleRunTimeout,
} from "./run-time-budget.ts";

type FakeTimer = { callback: () => void; ms: number; dueAt: number; interval: boolean; cleared: boolean };

/** Fake monotonic clock + timers: `runDue` fires non-interval timers whose due time has passed. */
function fakeTimers(): RunTimeoutTimers & { clock: { now: number }; timers: FakeTimer[]; runDue: () => void } {
  const clock = { now: 1_000 };
  const timers: FakeTimer[] = [];
  const add = (callback: () => void, ms: number, interval: boolean) => {
    const timer = { callback, ms, dueAt: clock.now + ms, interval, cleared: false };
    timers.push(timer);
    return timer;
  };
  const clear = (handle: unknown) => {
    if (handle !== undefined) (handle as FakeTimer).cleared = true;
  };
  return {
    clock,
    timers,
    now: () => clock.now,
    setTimeout: (callback, ms) => add(callback, ms, false),
    setInterval: (callback, ms) => add(callback, ms, true),
    clearTimeout: clear,
    clearInterval: clear,
    runDue: () => {
      for (const timer of [...timers]) {
        if (timer.interval || timer.cleared || timer.dueAt > clock.now) continue;
        timer.cleared = true;
        timer.callback();
      }
    },
  };
}

const liveTimeouts = (timers: { timers: FakeTimer[] }) => timers.timers.filter((t) => !t.interval && !t.cleared);

const dbPath = join(tmpdir(), `jarvis-run-time-budget-${process.pid}.sqlite`);
const logsPath = join(tmpdir(), `jarvis-run-time-budget-${process.pid}.jsonl`);
let store: StateStore;

beforeEach(() => {
  removeOrchestrationStore(dbPath);
  rmSync(logsPath, { force: true });
  store = openStateStore(dbPath);
});

afterEach(() => {
  store.close();
  removeOrchestrationStore(dbPath);
  rmSync(logsPath, { force: true });
});

test("remaining budget: fresh, resumed, exhausted", () => {
  expect(remainingRunBudgetMs(1_000, 0)).toBe(1_000);
  expect(remainingRunBudgetMs(1_000, 400)).toBe(600);
  expect(remainingRunBudgetMs(1_000, 1_000)).toBe(0);
  expect(consumedRunBudgetMs(400, 5_000, 5_250)).toBe(650);
  expect(consumedRunBudgetMs(400, 5_000, 4_000)).toBe(400);
});

test("runTimeoutShouldFire is false before the remaining budget elapses and true at it", () => {
  expect(runTimeoutShouldFire(1_000, 400, 0, 599)).toBe(false);
  expect(runTimeoutShouldFire(1_000, 400, 0, 600)).toBe(true);
});

test("armRunTimeout arms the remaining budget and accrues only while armed (paused time excluded)", () => {
  const timers = fakeTimers();
  const first = armRunTimeout({
    store,
    budgetKey: "inv-1",
    budgetMs: 1_000,
    runIds: () => [],
    timers,
    onTimeout: () => {},
  });
  expect(liveTimeouts(timers)[0]?.ms).toBe(1_000);
  expect(timers.timers.find((timer) => timer.interval)?.ms).toBe(RUN_BUDGET_CHECKPOINT_INTERVAL_MS);
  timers.clock.now += 300;
  timers.timers.find((timer) => timer.interval)?.callback();
  expect(store.readRunBudgetConsumedMs("inv-1")).toBe(300);
  timers.clock.now += 100;
  first.settle();
  expect(store.readRunBudgetConsumedMs("inv-1")).toBe(400);

  // Paused for a long while: no dispatch armed, no accrual.
  const resumedTimers = fakeTimers();
  resumedTimers.clock.now = timers.clock.now + 50_000;
  let fired = 0;
  const resumed = armRunTimeout({
    store,
    budgetKey: "inv-1",
    budgetMs: 1_000,
    runIds: () => [],
    timers: resumedTimers,
    onTimeout: () => fired++,
  });
  expect(liveTimeouts(resumedTimers)[0]?.ms).toBe(600);
  resumedTimers.clock.now += 600;
  resumedTimers.runDue();
  expect(fired).toBe(1);
  expect(resumed.timedOut()).toBe(true);
  expect(store.readRunBudgetConsumedMs("inv-1")).toBe(1_000);
});

test("an early timer wake reschedules the remainder instead of never firing", () => {
  const timers = fakeTimers();
  let fired = 0;
  armRunTimeout({ store, budgetKey: "inv-early", budgetMs: 1_000, runIds: () => [], timers, onTimeout: () => fired++ });
  const first = liveTimeouts(timers)[0];
  timers.clock.now += 990;
  first?.callback(); // woke 10ms early
  expect(fired).toBe(0);
  expect(liveTimeouts(timers).map((timer) => timer.ms)).toEqual([10]);
  timers.clock.now += 10;
  timers.runDue();
  expect(fired).toBe(1);
});

test("the checkpoint interval fires a spent budget even when the timeout callback is lost", () => {
  const timers = fakeTimers();
  let fired = 0;
  armRunTimeout({ store, budgetKey: "inv-lost", budgetMs: 1_000, runIds: () => [], timers, onTimeout: () => fired++ });
  timers.clock.now += 1_500;
  timers.timers.find((timer) => timer.interval)?.callback();
  expect(fired).toBe(1);
});

test("host sleep (wall clock jumps, monotonic clock does not) consumes no budget", () => {
  setSystemTime(new Date(1_000_000));
  const timers = fakeTimers();
  let fired = 0;
  const armed = armRunTimeout({
    store,
    budgetKey: "inv-sleep",
    budgetMs: 1_000,
    runIds: () => [],
    timers,
    onTimeout: () => fired++,
  });
  timers.clock.now += 200;
  setSystemTime(new Date(1_000_000 + 8 * 3_600_000));
  timers.timers.find((timer) => timer.interval)?.callback();
  expect(fired).toBe(0);
  armed.settle();
  setSystemTime();
  expect(store.readRunBudgetConsumedMs("inv-sleep")).toBe(200);
});

test("timer fire aborts a write-loop dispatch, settles killed/run_timeout resumable, and logs run_timeout", async () => {
  const timers = fakeTimers();
  const executor = createFakeWriteLoopExecutor();
  const ctx = createRunControlHandlerContext({
    stateStore: store,
    logReader: openLogReader(logsPath),
    logsPath,
    writeLoopExecutor: executor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
    runTimeout: { budgetMs: () => 1_000, timers },
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "unsupported" }),
  });
  const started = await handlers.start(
    { kind: "request", id: "s", method: "start", params: { input: mockWriteLoopInput() } },
    new AbortController().signal,
  );
  const runId = (started as { result: { runId: string } }).result.runId;
  expect(executor.isAbortSignalTriggered()).toBe(false);

  timers.clock.now += 1_000;
  timers.runDue();
  expect(executor.isAbortSignalTriggered()).toBe(true);
  await flushBackgroundRuns(3);
  expect(liveTimeouts(timers)).toHaveLength(0); // force-settle bound cleared on dispatch settle

  const run = loadRunOrThrow(store, runId);
  expect(run.status).toBe("killed");
  expect(run.terminalCause).toBe("run_timeout");
  expect(composeRunOperatorError(run)).toMatchObject({ reason: "run_timeout", nextAction: "resume" });
  expect(
    openLogReader(logsPath)
      .tail(runId)
      .map((record) => record.event.kind),
  ).toContain("run_timeout");
  expect(store.readRunBudgetConsumedMs(runId)).toBe(1_000);
});

function pausedRun(): string {
  return store.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
    status: "paused",
    queuedInput: mockWriteLoopInput(),
  });
}

function resumeHandlers(budgetMs: number) {
  const timers = fakeTimers();
  const executor = createFakeWriteLoopExecutor();
  const ctx = createRunControlHandlerContext({
    stateStore: store,
    logReader: { tail: () => [], async *follow() {} },
    writeLoopExecutor: executor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
    runTimeout: { budgetMs: () => budgetMs, timers },
  });
  return {
    timers,
    executor,
    handlers: createRunLifecycleHandlers(ctx, {
      handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "unsupported" }),
    }),
  };
}

test("resume refuses run_timeout_exhausted when the budget is spent", async () => {
  const runId = pausedRun();
  store.writeRunBudgetConsumedMs(runId, 1_000);
  const { handlers } = resumeHandlers(1_000);
  const resumed = await handlers.resume(
    { kind: "request", id: "r", method: "resume", params: { runId } },
    new AbortController().signal,
  );
  expect(resumed).toMatchObject({ kind: "error", code: "run_timeout_exhausted" });
});

test("resume admits when budget remains", async () => {
  const runId = pausedRun();
  store.writeRunBudgetConsumedMs(runId, 999);
  const { handlers, executor } = resumeHandlers(1_000);
  const resumed = await handlers.resume(
    { kind: "request", id: "r", method: "resume", params: { runId } },
    new AbortController().signal,
  );
  expect(resumed).toMatchObject({ kind: "response", result: { ok: true } });
  executor.abortAll();
  await flushBackgroundRuns(2);
});

test("run_timeout settlements raise a distinct run-timeout incident for workflow and direct rows", () => {
  const workflowRunId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "timeout",
    specPath: "spec.md",
    stepId: "implement",
    workflowSnapshot: { invocationId: "inv-timeout", steps: [{ stepId: "implement", role: "implement" }] },
  });
  const directRunId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/wt2",
    branch: "direct",
    specPath: "spec.md",
  });
  store.commitTerminalRunSettlement({ runId: directRunId, status: "killed" });
  settleRunTimeout(store, workflowRunId);
  const plainKill = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/wt3",
    branch: "d3",
    specPath: "s.md",
  });
  settleRunTimeout(store, plainKill);
  const incidents = deriveOperatorIncidents(store);
  expect(incidents).toContainEqual(expect.objectContaining({ runId: workflowRunId, kind: "run-timeout" }));
  expect(incidents).toContainEqual(expect.objectContaining({ runId: plainKill, kind: "run-timeout" }));
  expect(incidents).toContainEqual(expect.objectContaining({ runId: directRunId, kind: "run-ad-hoc-terminal" }));
});

function seedTimedOutEntryRun(invocationId: string): string {
  const runId = store.createRun({
    project: "demo",
    specRef: "HEAD",
    worktreePath: "/tmp/w",
    branch: `b-${invocationId}`,
    specPath: "s.md",
    stepId: "plan",
    workflowSnapshot: { invocationId, steps: [{ stepId: "plan", role: "plan" }] },
  });
  store.commitTerminalRunSettlement({ runId, status: "killed", terminalCause: "run_timeout" });
  return runId;
}

test("a pipeline whose stage entry settled run_timeout notifies with cause run_timeout", () => {
  const pipelineId = store.createPipeline({
    definition: {
      name: "p",
      stages: [
        { stageId: "implement", kind: "workflow" as const, workflow: "implement" as const, review: "none" as const },
        { stageId: "gate", kind: "approval" },
      ],
    },
  });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    patch: {
      status: "failed",
      endedAt: 5,
      workflowInvocationId: seedTimedOutEntryRun("inv-terminal"),
      failureDetail: { message: "timed out" },
    },
  });
  // A lone failed stage ends the pipeline: the terminal incident carries the run_timeout cause.
  expect(deriveOperatorIncidents(store)).toContainEqual(
    expect.objectContaining({ kind: "pipeline-terminal", pipelineId, cause: "run_timeout" }),
  );
  // With the pipeline still active the stage-failed incident carries it.
  const activePipelineId = store.createPipeline({
    definition: {
      name: "q",
      stages: [
        { stageId: "a", kind: "workflow" as const, workflow: "plan" as const, review: "none" as const },
        { stageId: "b", kind: "workflow" as const, workflow: "plan" as const, review: "none" as const },
      ],
    },
  });
  store.updateStage({ pipelineId: activePipelineId, stageId: "b", patch: { status: "running" } });
  store.updateStage({
    pipelineId: activePipelineId,
    stageId: "a",
    patch: {
      status: "failed",
      endedAt: 6,
      workflowInvocationId: seedTimedOutEntryRun("inv-active"),
      failureDetail: { message: "timed out" },
    },
  });
  const active = deriveOperatorIncidents(store).filter((incident) => incident.pipelineId === activePipelineId);
  expect(active.map((incident) => incident.cause)).toContain("run_timeout");
});

test("a dispatch that ignores abort is force-settled run_timeout after the settlement bound", async () => {
  const timers = fakeTimers();
  const ctx = createRunControlHandlerContext({
    stateStore: store,
    logReader: { tail: () => [], async *follow() {} },
    writeLoopExecutor: () => new Promise<void>(() => {}),
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
    runTimeout: { budgetMs: () => 1_000, timers, settlementBoundMs: 5 },
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "unsupported" }),
  });
  const started = await handlers.start(
    { kind: "request", id: "s", method: "start", params: { input: mockWriteLoopInput() } },
    new AbortController().signal,
  );
  const runId = (started as { result: { runId: string } }).result.runId;
  timers.clock.now += 1_000;
  timers.runDue();
  expect(loadRunOrThrow(store, runId).status).toBe("in-progress");
  timers.clock.now += 5;
  timers.runDue();
  expect(loadRunOrThrow(store, runId)).toMatchObject({ status: "killed", terminalCause: "run_timeout" });
});

test("no wired budget arms no timer and never refuses resume", async () => {
  const timers = fakeTimers();
  const armed = armRunTimeout({
    store,
    budgetKey: "inv-none",
    budgetMs: undefined,
    runIds: () => [],
    timers,
    onTimeout: () => {},
  });
  expect(timers.timers).toHaveLength(0);
  armed.settle();
  expect(store.readRunBudgetConsumedMs("inv-none")).toBe(0);

  const runId = pausedRun();
  store.writeRunBudgetConsumedMs(runId, Number.MAX_SAFE_INTEGER);
  const executor = createFakeWriteLoopExecutor();
  const ctx = createRunControlHandlerContext({
    stateStore: store,
    logReader: { tail: () => [], async *follow() {} },
    writeLoopExecutor: executor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "unsupported" }),
  });
  const resumed = await handlers.resume(
    { kind: "request", id: "r", method: "resume", params: { runId } },
    new AbortController().signal,
  );
  expect(resumed).toMatchObject({ kind: "response", result: { ok: true } });
  executor.abortAll();
  await flushBackgroundRuns(2);
});

test("a publication-only finalization resume is neither refused nor charged by an exhausted run budget", async () => {
  const runId = pausedRun();
  store.writeRunBudgetConsumedMs(runId, 5_000);
  const { handlers, timers } = resumeHandlers(1_000);
  const run = loadRunOrThrow(store, runId);
  const outcome = await handlers.resumeFinalizationOnly(run, { project: run.project, branch: run.branch }, async () => {
    timers.clock.now += 250;
    return { ok: true };
  });
  expect(outcome).toMatchObject({ kind: "response", result: { ok: true } });
  expect(store.readRunBudgetConsumedMs(runId)).toBe(5_000);
});

test("runTimeoutSettles: only live rows settle; completed and other terminal rows keep their status", () => {
  expect(runTimeoutSettles({ status: "in-progress" })).toBe(true);
  expect(runTimeoutSettles({ status: "paused" })).toBe(true);
  expect(runTimeoutSettles({ status: "completed" })).toBe(false);
  expect(runTimeoutSettles({ status: "failed" })).toBe(false);
});

test("linked implement timed out during review: completed link-0 stays completed, deferred completion row settles run_timeout", () => {
  const invocationId = "inv-linked";
  const workflowSnapshot = {
    invocationId,
    steps: [
      { stepId: "implement", role: "implement" },
      { stepId: "review", role: "review" },
    ],
  };
  const row = (stepId: string, branch: string) =>
    store.createRun({
      project: "demo",
      specRef: "main",
      worktreePath: `/tmp/${branch}`,
      branch,
      specPath: "spec.md",
      stepId,
      workflowSnapshot,
    });
  const link0 = row("implement~link-0", "linked");
  store.commitCompletionBoundary({
    attemptId: store.recordAttemptStart(link0),
    runStatus: "completed",
    outcomeKind: "done",
  });
  const completionRow = row("implement~link-1", "linked-completion");
  store.recordAttemptStart(completionRow);
  const reviewRow = row("review", "linked-review");
  const timers = fakeTimers();
  const armed = armRunTimeout({
    store,
    budgetKey: invocationId,
    budgetMs: 1_000,
    runIds: () => [link0, completionRow, reviewRow],
    timers,
    onTimeout: () => {},
  });
  timers.clock.now += 1_000;
  timers.runDue();
  armed.settle();
  expect(loadRunOrThrow(store, link0).status).toBe("completed");
  expect(loadRunOrThrow(store, link0).terminalCause ?? null).toBeNull();
  expect(loadRunOrThrow(store, completionRow)).toMatchObject({ status: "killed", terminalCause: "run_timeout" });
});

test("a finalization tail aborted by the run timeout settles run_timeout after unwind, not a plain kill", async () => {
  const runId = pausedRun();
  const { handlers, timers } = resumeHandlers(1_000);
  const run = loadRunOrThrow(store, runId);
  let observedAbort = false;
  const outcome = handlers.resumeFinalizationOnly(run, { project: run.project, branch: run.branch }, async (deps) => {
    timers.clock.now += 1_000;
    timers.runDue();
    observedAbort = deps.signal?.aborted === true;
    expect(loadRunOrThrow(store, runId).status).toBe("paused"); // no settlement before unwind
    throw new Error("aborted");
  });
  await outcome;
  expect(observedAbort).toBe(true);
  expect(loadRunOrThrow(store, runId)).toMatchObject({ status: "killed", terminalCause: "run_timeout" });
});
