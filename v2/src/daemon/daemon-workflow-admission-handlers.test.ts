import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteWorkflowStep } from "../execution/workflow-runner.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, mockWriteLoopInput } from "../testing/run-control.ts";
import { doneWithArtifactBindingFactory, writeStepFixtures } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { WorktreeOwnershipRegistry } from "./daemon.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";
import { createImplementRecoverHandler, createWorkflowStartAdmission } from "./daemon-workflow-admission-handlers.ts";

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
    // @mutate v2/src/daemon/daemon-workflow-admission-handlers.ts "!REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS.has(outcomeKind)" -> "REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS.has(outcomeKind)"
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
  // @mutate v2/src/daemon/daemon-workflow-admission-handlers.ts "status === \"paused\"" -> "status !== \"paused\""
  expect(stateStore.loadRun(pausedRunId as string)?.status).toBe("paused");
});

test("implement.recover refuses worktree_claimed without dispatch", async () => {
  const fixture = createRecoveryFixture({ outcomeKind: "surviving_mutation_failed", claimed: true });
  try {
    const frame = await fixture.implementRecover(
      requestFrame("recover", "implement.recover", { project: "demo", branch: "recover", specPath: "spec.md" }),
      new AbortController().signal,
    );
    // @mutate v2/src/daemon/daemon-workflow-admission-handlers.ts "if (claimError) return claimError;" -> "if (!claimError) return claimError;"
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
