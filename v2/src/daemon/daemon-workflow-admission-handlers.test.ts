import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as nodeChildProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncSubprocessOptions } from "../../../shared/subprocess.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { getExternalWorktreePath } from "../execution/external-worktree.ts";
import type { WriteWorkflowStep } from "../execution/workflow-runner.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore, type WorkflowSnapshot } from "../persistence/state-store.ts";
import { createHoldableAsyncFn } from "../testing/holdable-async-subprocess-runner.ts";
import { flushBackgroundRuns, mockWriteLoopInput } from "../testing/run-control.ts";
import { createFakeWithExternalWorktree, createJarvisHome } from "../testing/write-fixtures.ts";
import {
  createBindingFactory,
  doneWithArtifactBindingFactory,
  neverResolvingBindingFactory,
  writeStepFixtures,
} from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { WorktreeOwnershipRegistry } from "./daemon.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";
import { createImplementRecoverHandler, createWorkflowStartAdmission } from "./daemon-workflow-admission-handlers.ts";
import type { RunTimeoutTimers } from "./run-time-budget.ts";

type FakeTimer = { callback: () => void; ms: number; dueAt: number; interval: boolean; cleared: boolean };

/** Minimal fake monotonic clock + timers so a whole-run timeout fires deterministically. */
function fakeTimers(): RunTimeoutTimers & { clock: { now: number }; runDue: () => void } {
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

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let memoryHeadroom: boolean;
let registry: WorktreeOwnershipRegistry;

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-admission-${process.pid}-${Date.now()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();
  memoryHeadroom = true;
  registry = new WorktreeOwnershipRegistry();
});

afterEach(async () => {
  fakeExecutor.abortAll();
  await flushBackgroundRuns();
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

function workflowAdmission() {
  const ctx = createRunControlHandlerContext({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
    registry,
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const lifecycle = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: workflowStart.handleWorkflowStart,
  });
  const implementRecover = createImplementRecoverHandler(ctx, {
    resumeFinalizationOnly: lifecycle.resumeFinalizationOnly,
  });
  return { ctx, workflowStart, lifecycle, implementRecover };
}

test("check_workflow_start_claim refuses a queued (project, branch)", async () => {
  const { workflowStart, lifecycle } = workflowAdmission();
  memoryHeadroom = false;
  const queued = await lifecycle.start(
    requestFrame("s1", "start", {
      input: mockWriteLoopInput({ projectName: "demo", branchName: "workflow-branch" }),
    }),
    new AbortController().signal,
  );
  expect(queued.kind).toBe("response");

  const response = await workflowStart.check_workflow_start_claim(
    requestFrame("probe-1", "check_workflow_start_claim", { project: "demo", branch: "workflow-branch" }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "error",
    code: "worktree_claimed",
    message: "Worktree already claimed for project=demo, branch=workflow-branch",
  });
});

test("check_workflow_start_claim admits an unclaimed (project, branch)", async () => {
  const { workflowStart } = workflowAdmission();
  const response = await workflowStart.check_workflow_start_claim(
    requestFrame("probe-2", "check_workflow_start_claim", { project: "demo", branch: "fresh-branch" }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { ok: true } });
});

function createRecoveryFixture(args: {
  outcomeKind: "surviving_mutation_failed" | "runtime_smoke_failed";
  claimed?: boolean;
}) {
  const root = mkdtempSync(join(tmpdir(), "jarvis-admission-recovery-"));
  const worktreePath = root;
  const branch = "recover";
  const dbPath = join(root, "state.sqlite");
  const logsPath = join(root, "logs.jsonl");
  writeFileSync(join(root, "spec.md"), "# Spec\n\n## Acceptance criteria\n\n- [x] complete\n", "utf8");
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: root });
  execFileSync("git", ["branch", branch], { cwd: root });

  const store = openStateStore(dbPath);
  const snapshot = {
    invocationId: "ticked-recovery",
    creationTitle: "implement: recovery",
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "rules",
        expectedArtifactPath: "spec.md",
        agents: ["codex"],
        agentModelConfig: {},
      },
      { stepId: "implement-review", role: "", durable: true, behavior: "review" as const },
    ],
  };
  const common = {
    project: "demo",
    specRef: "HEAD",
    worktreePath,
    branch,
    specPath: "spec.md",
    workflowSnapshot: snapshot,
  };
  const writeRunId = store.createRun({ ...common, stepId: "implement" });
  const writeAttemptId = store.recordAttemptStart(writeRunId);
  store.commitCompletionBoundary({
    attemptId: writeAttemptId,
    runStatus: "completed",
    outcomeKind: "done",
    completionAgent: "codex",
  });
  const reviewRunId = store.createRun({ ...common, stepId: "implement-review" });
  const reviewAttemptId = store.recordAttemptStart(reviewRunId);
  store.commitCompletionBoundary({
    attemptId: reviewAttemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: "prior failure" },
  });
  const sink = openLogSink(logsPath);
  sink.append(reviewRunId, {
    kind: "loop_finished",
    loopOutcomeKind: args.outcomeKind,
    iterationsConsumed: 0,
    resumable: true,
  });
  sink.close();

  let ready = 0;
  let publishes = 0;
  const testRegistry = new WorktreeOwnershipRegistry();
  if (args.claimed) testRegistry.claim({ project: "demo", branch }, { runId: "other", worktreePath });
  const ctx = createRunControlHandlerContext({
    stateStore: store,
    logReader: openLogReader(logsPath),
    registry: testRegistry,
    writeLoopExecutor: async () => {},
    failureReporter: () => undefined,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
    intentFinalizationResumeDeps: {
      completionCommitter: async () => ({ commitSha: "deadbeef", filesChanged: 1 }),
      completionPublisher: async () => {
        publishes += 1;
        return { pushSha: "deadbeef", prNumber: 7, prUrl: "https://example.test/pr/7" };
      },
      readyFinalizer: async () => {
        ready += 1;
      },
    },
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const lifecycle = createRunLifecycleHandlers(ctx, { handleWorkflowStart: workflowStart.handleWorkflowStart });
  const implementRecover = createImplementRecoverHandler(ctx, {
    resumeFinalizationOnly: lifecycle.resumeFinalizationOnly,
  });

  return {
    store,
    reviewRunId,
    implementRecover,
    calls: () => ({ ready, publishes }),
    cleanup: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("implement.recover admits a retained surviving_mutation_failed lineage", async () => {
  const fixture = createRecoveryFixture({ outcomeKind: "surviving_mutation_failed" });
  try {
    const frame = await fixture.implementRecover(
      requestFrame("recover", "implement.recover", { project: "demo", branch: "recover", specPath: "spec.md" }),
      new AbortController().signal,
    );
    expect(frame).toMatchObject({
      kind: "response",
      result: { kind: "admitted", ok: true, prUrl: "https://example.test/pr/7" },
    });
    expect(fixture.calls()).toEqual({ ready: 1, publishes: 1 });
    expect(fixture.store.loadRun(fixture.reviewRunId)?.status).toBe("completed");
  } finally {
    fixture.cleanup();
  }
});

test("implement.recover returns not_admitted for excluded outcome kinds", async () => {
  const fixture = createRecoveryFixture({ outcomeKind: "runtime_smoke_failed" });
  try {
    const frame = await fixture.implementRecover(
      requestFrame("recover", "implement.recover", { project: "demo", branch: "recover", specPath: "spec.md" }),
      new AbortController().signal,
    );
    expect(frame).toMatchObject({ kind: "response", result: { kind: "not_admitted" } });
    expect(fixture.calls()).toEqual({ ready: 0, publishes: 0 });
  } finally {
    fixture.cleanup();
  }
});

/** After `createRun` for `stepId`, pin paused settlement so later completion writes stay paused. */
function lockPausedSettlementOnStepCreate(store: StateStore, stepId: string): StateStore {
  const lockedRunIds = new Set<string>();
  const lockedAttemptIds = new Set<string>();
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "createRun") {
        return (...args: Parameters<StateStore["createRun"]>) => {
          const runId = target.createRun(...args);
          if (args[0]?.stepId === stepId) {
            lockedRunIds.add(runId);
            target.setRunStatus(runId, "paused");
          }
          return runId;
        };
      }
      if (prop === "recordAttemptStart") {
        return (...args: Parameters<StateStore["recordAttemptStart"]>) => {
          const [runId] = args;
          const attemptId = target.recordAttemptStart(...args);
          if (lockedRunIds.has(runId)) lockedAttemptIds.add(attemptId);
          return attemptId;
        };
      }
      if (prop === "commitCompletionBoundary") {
        return (...args: Parameters<StateStore["commitCompletionBoundary"]>) => {
          const [boundary] = args;
          if (lockedAttemptIds.has(boundary.attemptId)) {
            return target.commitCompletionBoundary({ ...boundary, runStatus: "paused" });
          }
          return target.commitCompletionBoundary(...args);
        };
      }
      if (prop === "setRunStatus") {
        return (...args: Parameters<StateStore["setRunStatus"]>) => {
          const [runId, nextStatus] = args;
          if (lockedRunIds.has(runId) && nextStatus !== "paused") {
            return;
          }
          return target.setRunStatus(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** Wraps a real store so `recordAttemptStart`'s Nth call (1-indexed) throws. */
function throwOnNthRecordAttemptStart(store: StateStore, n: number): StateStore {
  let calls = 0;
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "recordAttemptStart") {
        return (...args: Parameters<StateStore["recordAttemptStart"]>) => {
          calls += 1;
          if (calls === n) {
            throw new Error("recordAttemptStart boom");
          }
          return target.recordAttemptStart(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function workflowStep(stepId: string, branch: string): WriteWorkflowStep {
  const { createWriteStep } = writeStepFixtures();
  return createWriteStep(stepId, branch, doneWithArtifactBindingFactory, { suppressShrink: true });
}

/** A workflow whose single step ends non-`complete`, plus the console.error lines the daemon wrote. */
async function runWorkflowCapturingStderr(
  branch: string,
  createBinding: NonNullable<WriteWorkflowStep["createBinding"]>,
): Promise<string[]> {
  const lines: string[] = [];
  const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  });
  try {
    const { createWriteStep } = writeStepFixtures();
    const step = createWriteStep("step-1", branch, createBinding, { suppressShrink: true });
    const { lifecycle } = workflowAdmission();
    const response = await lifecycle.start(
      requestFrame("s-verdict", "start", { steps: [step] }),
      new AbortController().signal,
    );
    expect(response.kind).toBe("response");
    // Settle the run before teardown closes the store: a completing step's publication tail is still running.
    const runId = (response as { result: { runId: string } }).result.runId;
    await lifecycle.wait(requestFrame("w-verdict", "wait", { runId }), new AbortController().signal);
    for (let i = 0; i < 10_000 && stateStore.loadRun(runId)?.status === "in-progress"; i++) {
      await flushBackgroundRuns();
    }
    await flushBackgroundRuns(5);
  } finally {
    spy.mockRestore();
  }
  return lines;
}

test("logs the workflow-level verdict when the workflow resolves non-complete", async () => {
  // Before this, the returned WorkflowResult was discarded: a workflow could end non-`complete`
  // with nothing written to the daemon log, so the operator had no record of which step ended it.
  const blockedBinding = createBindingFactory(
    async () => ({ kind: "ok", stdout: "## Blocker\n\nneeds a decision\n\nblocked", stderr: "" }) as const,
  );
  const lines = await runWorkflowCapturingStderr("workflow-verdict-blocked", blockedBinding);

  const verdict = lines.find((line) => line.startsWith("Workflow ended "));
  expect(verdict).toBeDefined();
  expect(verdict).toContain("at step 0 step-1");
});

test("logs no workflow verdict when the workflow completes", async () => {
  // The companion direction: a complete workflow must stay silent here, or every successful run
  // writes a spurious failure line to the daemon log.
  const lines = await runWorkflowCapturingStderr("workflow-verdict-complete", doneWithArtifactBindingFactory);

  expect(lines.filter((line) => line.startsWith("Workflow ended "))).toEqual([]);
});

test("workflow failure does not re-demote a paused step run", async () => {
  const branch = "workflow-paused-settled";
  const logsPath = join(tmpdir(), `jarvis-admission-logs-${process.pid}-${Date.now()}.jsonl`);
  const failingStore = throwOnNthRecordAttemptStart(lockPausedSettlementOnStepCreate(stateStore, "step-1"), 2);
  const ctx = createRunControlHandlerContext({
    stateStore: failingStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
    logsPath,
    logReader: openLogReader(logsPath),
    registry,
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const lifecycle = createRunLifecycleHandlers(ctx, { handleWorkflowStart: workflowStart.handleWorkflowStart });

  const response = await lifecycle.start(
    requestFrame("s1", "start", { steps: [workflowStep("step-1", branch), workflowStep("step-2", branch)] }),
    new AbortController().signal,
  );
  expect(response.kind).toBe("response");
  await flushBackgroundRuns(5);

  const pausedRunId = stateStore.findRunByProjectBranch({ project: "demo", branch, stepId: "step-1" })?.id;
  expect(pausedRunId).toBeTruthy();
  expect(stateStore.loadRun(pausedRunId as string)?.status).toBe("paused");
});

test("implement.recover refuses worktree_claimed without dispatch", async () => {
  const fixture = createRecoveryFixture({ outcomeKind: "surviving_mutation_failed", claimed: true });
  try {
    const frame = await fixture.implementRecover(
      requestFrame("recover", "implement.recover", { project: "demo", branch: "recover", specPath: "spec.md" }),
      new AbortController().signal,
    );
    expect(frame).toMatchObject({
      kind: "error",
      code: "worktree_claimed",
      message: "Worktree already claimed for project=demo, branch=recover",
    });
    expect(fixture.calls()).toEqual({ ready: 0, publishes: 0 });
  } finally {
    fixture.cleanup();
  }
});

test("only the first step-0 run is the entry: shrink rows neither re-point nor leak the workflow promise", async () => {
  // Linked-implement link rows and the hidden shrink row also report step index 0. Treating each as
  // the entry left the real entry's promise registered forever and settled stages for the last row.
  const branch = "workflow-entry-first-row";
  const { createWriteStep } = writeStepFixtures();
  const step = createWriteStep("implement", branch, doneWithArtifactBindingFactory);
  const { ctx, lifecycle } = workflowAdmission();
  const settledFor: string[] = [];
  const settleSpy = spyOn(stateStore, "settleLinkedStagesFromEntryRun").mockImplementation((entryRunId) => {
    settledFor.push(entryRunId);
    return { kind: "no-entry-run" };
  });
  try {
    const response = await lifecycle.start(
      requestFrame("s-entry", "start", { steps: [step] }),
      new AbortController().signal,
    );
    expect(response.kind).toBe("response");
    const runId = (response as { result: { runId: string } }).result.runId;
    const invocationId = stateStore.loadRun(runId)?.workflowSnapshot?.invocationId as string;
    // The workflow's own tracked promise resolves after its terminal `finally` (deregistration + settlement).
    await ctx.workflowPromisesByEntryRunId.get(runId);

    const rows = stateStore.findRunsByInvocationId(invocationId);
    expect(rows.map((row) => row.stepId)).toEqual(["implement", "implement~shrink"]);
    expect(runId).toBe(rows[0]?.id as string);
    expect(rows.filter((row) => ctx.workflowPromisesByEntryRunId.has(row.id))).toEqual([]);
    expect(settledFor).toEqual([runId]);
  } finally {
    settleSpy.mockRestore();
  }
});

test("resumeLinkedWorkflowStart forwards the resumed workflowSnapshot into executeWorkflow instead of minting a fresh one", async () => {
  // If the snapshot argument is dropped, executeWorkflow falls back to buildWorkflowSnapshot,
  // which (with no existing durable row to reuse) mints an invocationId from the step's own
  // `workflowInvocationId` rather than the resumed invocation's id.
  const branch = "resume-forwards-snapshot";
  const { createWriteStep } = writeStepFixtures();
  const step = createWriteStep("step-1", branch, doneWithArtifactBindingFactory, {
    suppressShrink: true,
    workflowInvocationId: "step-own-invocation-id",
  });
  const { workflowStart } = workflowAdmission();
  const snapshot: WorkflowSnapshot = {
    invocationId: "resumed-invocation-id",
    steps: [{ stepId: "step-1", role: "implement", durable: true }],
  };

  const response = await workflowStart.resumeLinkedWorkflowStart([step], snapshot);
  expect(response.kind).toBe("response");
  const runId = (response as { result: { runId: string } }).result.runId;

  expect(stateStore.loadRun(runId)?.workflowSnapshot?.invocationId).toBe("resumed-invocation-id");
});

test("resumeLinkedWorkflowStart returns a refused resume admission before starting the workflow, releasing its claim", async () => {
  const branch = "resume-admission-refused";
  const { createWriteStep } = writeStepFixtures();
  const step = createWriteStep("step-1", branch, doneWithArtifactBindingFactory, {
    suppressShrink: true,
    workflowInvocationId: "step-own-invocation-id",
  });
  const { workflowStart } = workflowAdmission();
  const snapshot: WorkflowSnapshot = {
    invocationId: "resumed-refused-invocation-id",
    steps: [{ stepId: "step-1", role: "implement", durable: true }],
  };
  const refusal = { kind: "error" as const, code: "owner_alive", message: "resume admission refused: owner_alive" };

  const response = await workflowStart.resumeLinkedWorkflowStart([step], snapshot, async () => refusal);

  expect(response).toEqual(refusal);
  expect(stateStore.findRunsByInvocationId("resumed-refused-invocation-id")).toEqual([]);
  expect(stateStore.findRunsByInvocationId("step-own-invocation-id")).toEqual([]);
  expect(registry.get({ project: "demo", branch })).toBeUndefined();
});

test("resumeLinkedWorkflowStart rolls back an applied resume admission when execute fails", async () => {
  const branch = "resume-admission-execute-fails";
  const { createWriteStep } = writeStepFixtures();
  const step = createWriteStep("implement", branch, doneWithArtifactBindingFactory, {
    suppressShrink: true,
    linkedIndexRouting: true,
    withExternalWorktree: async () => {
      throw new Error("materialization boom");
    },
  });
  const { workflowStart } = workflowAdmission();
  const snapshot: WorkflowSnapshot = { invocationId: "resumed-fail-invocation-id", steps: [] };
  let rollbacks = 0;

  const response = await workflowStart.resumeLinkedWorkflowStart(
    [step],
    snapshot,
    async () => undefined,
    () => {
      rollbacks += 1;
    },
  );

  expect(response.kind).toBe("error");
  expect(rollbacks).toBe(1);
  expect(registry.get({ project: "demo", branch })).toBeUndefined();
});

test("resumeLinkedWorkflowStart claims the resumed step's real external worktree path, not an empty placeholder", async () => {
  const branch = "resume-claims-real-worktree";
  const { createWriteStep } = writeStepFixtures();
  const step = createWriteStep("step-1", branch, doneWithArtifactBindingFactory, {
    suppressShrink: true,
    workflowInvocationId: "step-own-invocation-id",
  });
  const { workflowStart } = workflowAdmission();
  const snapshot: WorkflowSnapshot = {
    invocationId: "resumed-invocation-id",
    steps: [{ stepId: "step-1", role: "implement", durable: true }],
  };

  const response = await workflowStart.resumeLinkedWorkflowStart([step], snapshot);
  expect(response.kind).toBe("response");

  const ownership = registry.get({ project: "demo", branch });
  expect(ownership?.worktreePath).toBe(getExternalWorktreePath(step.worktree));
});

test("workflow invocation settled marker: completed", async () => {
  const branch = "settled-marker-completed";
  const { createWriteStep } = writeStepFixtures();
  const step = createWriteStep("step-1", branch, doneWithArtifactBindingFactory, { suppressShrink: true });
  const { ctx, lifecycle } = workflowAdmission();

  const response = await lifecycle.start(
    requestFrame("s-completed", "start", { steps: [step] }),
    new AbortController().signal,
  );
  expect(response.kind).toBe("response");
  const runId = (response as { result: { runId: string } }).result.runId;
  await ctx.workflowPromisesByEntryRunId.get(runId);

  expect(stateStore.readWorkflowInvocationSettledMarker(runId)).toMatchObject({ cause: "completed" });
});

test("workflow invocation settled marker: failed when the workflow resolves non-complete", async () => {
  const branch = "settled-marker-failed-result";
  const blockedBinding = createBindingFactory(
    async () => ({ kind: "ok", stdout: "## Blocker\n\nneeds a decision\n\nblocked", stderr: "" }) as const,
  );
  const { createWriteStep } = writeStepFixtures();
  const step = createWriteStep("step-1", branch, blockedBinding, { suppressShrink: true });
  const { ctx, lifecycle } = workflowAdmission();

  const response = await lifecycle.start(
    requestFrame("s-failed-result", "start", { steps: [step] }),
    new AbortController().signal,
  );
  expect(response.kind).toBe("response");
  const runId = (response as { result: { runId: string } }).result.runId;
  await ctx.workflowPromisesByEntryRunId.get(runId);

  expect(stateStore.readWorkflowInvocationSettledMarker(runId)).toMatchObject({ cause: "failed" });
});

test("workflow invocation settled marker: failed when execute() throws after the entry run exists", async () => {
  const branch = "settled-marker-failed-throw";
  const throwingStore = throwOnNthRecordAttemptStart(stateStore, 1);
  const ctx = createRunControlHandlerContext({
    stateStore: throwingStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
    registry,
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const lifecycle = createRunLifecycleHandlers(ctx, { handleWorkflowStart: workflowStart.handleWorkflowStart });

  const response = await lifecycle.start(
    requestFrame("s-failed-throw", "start", { steps: [workflowStep("step-1", branch)] }),
    new AbortController().signal,
  );
  expect(response.kind).toBe("response");
  const runId = (response as { result: { runId: string } }).result.runId;
  await ctx.workflowPromisesByEntryRunId.get(runId);

  expect(stateStore.readWorkflowInvocationSettledMarker(runId)).toMatchObject({ cause: "failed" });
});

test("workflow invocation settled marker: killed when the run was marked pendingKill before abort", async () => {
  const branch = "settled-marker-killed";
  const { createWriteStep } = writeStepFixtures();
  const step = createWriteStep("step-1", branch, neverResolvingBindingFactory, { suppressShrink: true });
  const { ctx, lifecycle } = workflowAdmission();

  const response = await lifecycle.start(
    requestFrame("s-killed", "start", { steps: [step] }),
    new AbortController().signal,
  );
  expect(response.kind).toBe("response");
  const runId = (response as { result: { runId: string } }).result.runId;
  const settled = ctx.workflowPromisesByEntryRunId.get(runId);
  for (let i = 0; i < 1_000 && ctx.activeRuns.get(runId) === undefined; i++) {
    await flushBackgroundRuns();
  }
  expect(ctx.activeRuns.get(runId)).toBeDefined();

  const killResponse = await lifecycle.kill(requestFrame("k-killed", "kill", { runId }), new AbortController().signal);
  expect(killResponse).toMatchObject({ kind: "response", result: { ok: true } });
  await settled;

  expect(stateStore.readWorkflowInvocationSettledMarker(runId)).toMatchObject({ cause: "killed" });
});

test("workflow invocation settled marker: failed when a run timeout fires (not killed)", async () => {
  const branch = "settled-marker-timeout";
  const timers = fakeTimers();
  const { createWriteStep } = writeStepFixtures();
  const step = createWriteStep("step-1", branch, neverResolvingBindingFactory, { suppressShrink: true });
  const ctx = createRunControlHandlerContext({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
    registry,
    runTimeout: { budgetMs: () => 1_000, timers },
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const lifecycle = createRunLifecycleHandlers(ctx, { handleWorkflowStart: workflowStart.handleWorkflowStart });

  const response = await lifecycle.start(
    requestFrame("s-timeout", "start", { steps: [step] }),
    new AbortController().signal,
  );
  expect(response.kind).toBe("response");
  const runId = (response as { result: { runId: string } }).result.runId;
  const settled = ctx.workflowPromisesByEntryRunId.get(runId);
  for (let i = 0; i < 1_000 && ctx.activeRuns.get(runId) === undefined; i++) {
    await flushBackgroundRuns();
  }
  expect(ctx.activeRuns.get(runId)).toBeDefined();

  timers.clock.now += 1_000;
  timers.runDue();
  await settled;

  expect(stateStore.readWorkflowInvocationSettledMarker(runId)).toMatchObject({ cause: "failed" });
});

/** Fakes every `gh` subcommand the completion-publisher tail issues; git commands pass through to a real repo. */
function fakeGhResponse(args: readonly string[]): string {
  if (args[0] === "pr" && args[1] === "list") return "[]";
  if (args[0] === "pr" && args[1] === "create") return "https://example.test/pull/1";
  if (args[0] === "pr" && args[1] === "view") {
    const jsonIdx = args.indexOf("--json");
    const jsonFields = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;
    if (jsonFields === "number,url,baseRefName") {
      return JSON.stringify({ number: 1, url: "https://example.test/pull/1", baseRefName: "main" });
    }
    return "";
  }
  return "";
}

/** Real git worktree with a real local bare "origin", so push/ls-remote work without touching GitHub. */
function createRealPublishableWorktree(jarvisRoot: string, originPath: string) {
  const base = createFakeWithExternalWorktree(jarvisRoot);
  return async <T>(
    args: { branchName: string; projectName: string; jarvisRoot?: string },
    run: (worktree: { path: string; reused: boolean }) => Promise<T> | T,
  ) =>
    base(args, async (worktree) => {
      execFileSync("git", ["init", "-b", "main", worktree.path], { stdio: "pipe" });
      execFileSync("git", ["-C", worktree.path, "config", "user.email", "test@example.test"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktree.path, "config", "user.name", "Test"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktree.path, "add", "-A"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktree.path, "commit", "-m", "seed"], { stdio: "pipe" });
      execFileSync("git", ["-C", worktree.path, "remote", "add", "origin", originPath], { stdio: "pipe" });
      execFileSync("git", ["-C", worktree.path, "push", "origin", "main"], { stdio: "pipe" });
      return run(worktree);
    });
}

test("workflow invocation settled marker: null while the publication tail is held, completed once released", async () => {
  const branch = "settled-marker-publication-hold";
  const { jarvisRoot } = createJarvisHome();
  const originPath = mkdtempSync(join(tmpdir(), "jarvis-admission-origin-"));
  execFileSync("git", ["init", "--bare", originPath], { stdio: "pipe" });

  const originalRunAsync = realAsyncSubprocessRunner.runAsync.bind(realAsyncSubprocessRunner);
  const innerRunAsync = async (
    cmd: string,
    args: string[],
    cwd: string,
    options?: AsyncSubprocessOptions,
  ): Promise<string> => (cmd === "gh" ? fakeGhResponse(args) : originalRunAsync(cmd, args, cwd, options));
  const holdable = createHoldableAsyncFn(innerRunAsync);
  const runAsyncSpy = spyOn(realAsyncSubprocessRunner, "runAsync").mockImplementation(holdable.fn);
  const fakeGhSpawn = (...spawnArgs: unknown[]): nodeChildProcess.ChildProcess => {
    const [command] = spawnArgs as [string, string[]?];
    if (command !== "gh") {
      throw new Error(`unexpected spawn: ${command}`);
    }
    const child = new EventEmitter() as EventEmitter & {
      stdin: EventEmitter & { write: () => void; end: () => void };
      stderr: EventEmitter;
    };
    child.stdin = new EventEmitter() as EventEmitter & { write: () => void; end: () => void };
    child.stdin.write = () => {};
    child.stdin.end = () => {
      setImmediate(() => child.emit("close", 0));
    };
    child.stderr = new EventEmitter();
    return child as unknown as nodeChildProcess.ChildProcess;
  };
  const spawnSpy = spyOn(nodeChildProcess, "spawn").mockImplementation(
    fakeGhSpawn as unknown as typeof nodeChildProcess.spawn,
  );

  try {
    const { createWriteStep } = writeStepFixtures();
    const step = createWriteStep("step-1", branch, doneWithArtifactBindingFactory, {
      suppressShrink: true,
      withExternalWorktree: createRealPublishableWorktree(jarvisRoot, originPath),
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: branch,
        baseRef: "main",
        jarvisRoot,
      },
    });
    const { ctx, lifecycle } = workflowAdmission();

    const response = await lifecycle.start(
      requestFrame("s-hold", "start", { steps: [step] }),
      new AbortController().signal,
    );
    expect(response.kind).toBe("response");
    const runId = (response as { result: { runId: string } }).result.runId;
    const settled = ctx.workflowPromisesByEntryRunId.get(runId);

    await holdable.whenPending();
    expect(stateStore.readWorkflowInvocationSettledMarker(runId)).toBeNull();

    holdable.release();
    await settled;

    expect(stateStore.readWorkflowInvocationSettledMarker(runId)).toMatchObject({ cause: "completed" });
  } finally {
    runAsyncSpy.mockRestore();
    spawnSpy.mockRestore();
    rmSync(originPath, { recursive: true, force: true });
  }
});
