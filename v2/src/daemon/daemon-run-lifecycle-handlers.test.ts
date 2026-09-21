import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OperatorFailureRecord } from "../../../shared/operator-failure-record.ts";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore, type WorkflowSnapshot } from "../persistence/state-store.ts";
import { flushBackgroundRuns, loadRunOrThrow, mockWriteLoopInput, workflowSnapshot } from "../testing/run-control.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import type { WriteLoopBindingSourceDeps } from "./daemon.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let memoryHeadroom: boolean;

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-lifecycle-${process.pid}-${Date.now()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();
  memoryHeadroom = true;
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

function lifecycleHandlers() {
  const ctx = createRunControlHandlerContext({
    stateStore,
    logReader: { tail: () => [], async *follow() {} },
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "steps unsupported in test" }),
  });
  return { ctx, handlers };
}

test("start admits a second project while another run is active", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const input = mockWriteLoopInput();

  const first = await handlers.start({ kind: "request", id: "s1", method: "start", params: { input } }, signal);
  expect(first.kind).toBe("response");

  const second = await handlers.start(
    {
      kind: "request",
      id: "s2",
      method: "start",
      params: { input: mockWriteLoopInput({ projectName: "other-project", branchName: "other-branch" }) },
    },
    signal,
  );
  expect(second.kind).toBe("response");
});

test("list always retains non-terminal runs regardless of terminal retention bound", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  for (let index = 0; index < 60; index++) {
    stateStore.createRun({
      project: `exempt-${index}`,
      specRef: "main",
      worktreePath: "/tmp/wt",
      branch: `exempt-${index}`,
      specPath: "/tmp/spec.md",
      status: "paused",
    });
  }
  for (let index = 0; index < 50; index++) {
    stateStore.createRun({
      project: "terminal",
      specRef: "main",
      worktreePath: "/tmp/wt",
      branch: `terminal-${index}`,
      specPath: "/tmp/spec.md",
      status: "completed",
    });
  }

  const listed = await handlers.list({ kind: "request", id: "l1", method: "list" }, signal);
  expect(listed.kind).toBe("response");
  if (listed.kind !== "response") return;

  const runs = (listed.result as { runs: unknown[] }).runs;
  expect(runs).toHaveLength(110);
});

test("list retains aged-out terminal workflow steps when a live sibling shares the invocation", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const snapshot = workflowSnapshot("wf-retain", [
    { stepId: "step-1", role: "implement" },
    { stepId: "step-2", role: "review" },
  ]);
  const agedTerminalStepId = stateStore.createRun({
    project: "wf",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "wf-br",
    specPath: "/tmp/spec.md",
    status: "completed",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });
  for (let index = 0; index < 55; index++) {
    stateStore.createRun({
      project: "noise",
      specRef: "main",
      worktreePath: "/tmp/wt",
      branch: `noise-${index}`,
      specPath: "/tmp/spec.md",
      status: "completed",
    });
  }
  const liveStepId = stateStore.createRun({
    project: "wf",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "wf-br",
    specPath: "/tmp/spec.md",
    status: "paused",
    stepId: "step-2",
    workflowSnapshot: snapshot,
  });

  const listed = await handlers.list({ kind: "request", id: "l1", method: "list" }, signal);
  expect(listed.kind).toBe("response");
  if (listed.kind !== "response") return;

  const runIds = new Set((listed.result as { runs: Array<{ runId: string }> }).runs.map((row) => row.runId));
  expect(runIds.has(liveStepId)).toBe(true);
  expect(runIds.has(agedTerminalStepId)).toBe(true);
});

test("list retains aged-out terminal workflow steps when a kept terminal sibling shares the invocation", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const snapshot = workflowSnapshot("wf-retain-terminal", [
    { stepId: "step-1", role: "implement" },
    { stepId: "step-2", role: "review" },
  ]);
  const agedTerminalStepId = stateStore.createRun({
    project: "wf",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "wf-br",
    specPath: "/tmp/spec.md",
    status: "completed",
    stepId: "step-2",
    workflowSnapshot: snapshot,
  });
  for (let index = 0; index < 55; index++) {
    stateStore.createRun({
      project: "noise",
      specRef: "main",
      worktreePath: "/tmp/wt",
      branch: `noise-${index}`,
      specPath: "/tmp/spec.md",
      status: "completed",
    });
  }
  const keptTerminalStepId = stateStore.createRun({
    project: "wf",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "wf-br",
    specPath: "/tmp/spec.md",
    status: "completed",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });

  const listed = await handlers.list({ kind: "request", id: "l1", method: "list" }, signal);
  expect(listed.kind).toBe("response");
  if (listed.kind !== "response") return;

  const runIds = new Set((listed.result as { runs: Array<{ runId: string }> }).runs.map((row) => row.runId));
  expect(runIds.has(keptTerminalStepId)).toBe(true);
  expect(runIds.has(agedTerminalStepId)).toBe(true);
});

test("list projects live in-progress runs", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const started = await handlers.start(
    { kind: "request", id: "s1", method: "start", params: { input: mockWriteLoopInput() } },
    signal,
  );
  expect(started.kind).toBe("response");
  if (started.kind !== "response") return;

  const listed = await handlers.list({ kind: "request", id: "l1", method: "list" }, signal);
  expect(listed.kind).toBe("response");
  if (listed.kind !== "response") return;

  const runs = (listed.result as { runs: Array<{ runId: string; isLive: boolean; status: string }> }).runs;
  const row = runs.find((candidate) => candidate.runId === (started.result as { runId: string }).runId);
  expect(row).toMatchObject({ status: "in-progress", isLive: true });
});

test("spawnWriteLoop keeps paused runs settled when the executor unwinds on pause", async () => {
  const runRef: { runId?: string } = {};
  const pauseThrowExecutor = async (
    _input: import("../execution/write-loop.ts").WriteLoopInput,
    signal: AbortSignal,
    pauseSignal: AbortSignal,
  ): Promise<void> => {
    await new Promise<void>((_resolve, reject) => {
      pauseSignal.addEventListener(
        "abort",
        () => {
          if (runRef.runId !== undefined) stateStore.setRunStatus(runRef.runId, "paused");
          reject(new Error("pause unwind"));
        },
        { once: true },
      );
      signal.addEventListener("abort", () => reject(new Error("kill unwind")), { once: true });
    });
  };

  const ctx = createRunControlHandlerContext({
    stateStore,
    logReader: { tail: () => [], async *follow() {} },
    writeLoopExecutor: pauseThrowExecutor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "steps unsupported in test" }),
  });

  const signal = new AbortController().signal;
  const input = mockWriteLoopInput({ projectName: "pause-settled", branchName: "pause-settled" });
  const started = await handlers.start({ kind: "request", id: "s1", method: "start", params: { input } }, signal);
  expect(started.kind).toBe("response");
  if (started.kind !== "response") return;
  runRef.runId = (started.result as { runId: string }).runId;

  const paused = await handlers.pause(
    { kind: "request", id: "p1", method: "pause", params: { runId: runRef.runId } },
    signal,
  );
  expect(paused).toEqual({ kind: "response", result: { ok: true } });
  await flushBackgroundRuns();

  expect(loadRunOrThrow(stateStore, runRef.runId).status).toBe("paused");
});

test("resume admits a paused direct write run with durable queuedInput", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const branchName = "direct-resume-guard";
  const runId = stateStore.createRun({
    project: branchName,
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: branchName,
    specPath: "/tmp/spec.md",
    status: "paused",
    queuedInput: mockWriteLoopInput({ projectName: branchName, branchName }),
  });

  const resumed = await handlers.resume({ kind: "request", id: "r1", method: "resume", params: { runId } }, signal);
  expect(resumed).toEqual({ kind: "response", result: { ok: true } });
});

test("resume admits a paused workflow write step with exact snapshot stepId", async () => {
  const resumedInputs: WriteLoopInput[] = [];
  const localFake = createFakeWriteLoopExecutor((input) => resumedInputs.push(input));
  const profileHome = trackedMkdtempSync(join(tmpdir(), "jarvis-exact-step-profile-"));
  const machinesDir = join(profileHome, "machines");
  const machineProfile = "exact-step-profile";
  const previousJarvisHome = process.env.JARVIS_HOME;
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string) => ({ rungs: [{ adapterModel, priceKey: adapterModel }] });
  writeFileSync(
    join(machinesDir, `${machineProfile}.json`),
    JSON.stringify({
      models: {
        claude: {
          plan: rung("plan"),
          implement: rung("M1"),
          shrink: rung("S1"),
          adversary: rung("adv"),
          critic: rung("crit"),
          advocate: rung("advoc"),
          adjudicator: rung("adj"),
          actuator: rung("act"),
        },
      },
    }),
  );
  writeFileSync(join(profileHome, "config.json"), JSON.stringify({ machineProfile, agents: ["claude"] }));
  process.env.JARVIS_HOME = profileHome;
  const writeLoopBindingSourceDeps: WriteLoopBindingSourceDeps = {
    machineConfigPath: join(profileHome, "config.json"),
    machinesDir,
  };
  try {
    const ctx = createRunControlHandlerContext({
      stateStore,
      logReader: { tail: () => [], async *follow() {} },
      writeLoopExecutor: localFake.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => memoryHeadroom,
      settleDelayMs: 0,
      writeLoopBindingSourceDeps,
    });
    const handlers = createRunLifecycleHandlers(ctx, {
      handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "steps unsupported in test" }),
    });
    const signal = new AbortController().signal;
    const branchName = "workflow-exact-step-resume";
    const runId = stateStore.createRun({
      project: branchName,
      specRef: "main",
      worktreePath: "/tmp/wt",
      branch: branchName,
      specPath: "/tmp/spec.md",
      status: "paused",
      stepId: "implement",
      workflowSnapshot: {
        invocationId: "exact-step",
        steps: [
          {
            stepId: "implement",
            role: "implement",
            stepRules: "implement rules",
            expectedArtifactPath: "/tmp/artifact",
            agents: ["claude"],
            agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
          },
        ],
      },
    });

    const resumed = await handlers.resume({ kind: "request", id: "r1", method: "resume", params: { runId } }, signal);
    expect(resumed).toEqual({ kind: "response", result: { ok: true } });
    expect(resumedInputs).toHaveLength(1);
    expect(resumedInputs[0]?.stepId).toBe("implement");
  } finally {
    localFake.abortAll();
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
    rmSync(profileHome, { recursive: true, force: true });
  }
});

test("resume maps hidden ~shrink stepId to shrink role via snapshot base step", async () => {
  const resumedInputs: WriteLoopInput[] = [];
  const localFake = createFakeWriteLoopExecutor((input) => resumedInputs.push(input));
  const profileHome = trackedMkdtempSync(join(tmpdir(), "jarvis-hidden-shrink-profile-"));
  const machinesDir = join(profileHome, "machines");
  const machineProfile = "hidden-shrink-profile";
  const previousJarvisHome = process.env.JARVIS_HOME;
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string) => ({ rungs: [{ adapterModel, priceKey: adapterModel }] });
  writeFileSync(
    join(machinesDir, `${machineProfile}.json`),
    JSON.stringify({
      models: {
        claude: {
          plan: rung("plan"),
          implement: rung("M1"),
          shrink: rung("S1"),
          adversary: rung("adv"),
          critic: rung("crit"),
          advocate: rung("advoc"),
          adjudicator: rung("adj"),
          actuator: rung("act"),
        },
      },
    }),
  );
  writeFileSync(join(profileHome, "config.json"), JSON.stringify({ machineProfile, agents: ["claude"] }));
  process.env.JARVIS_HOME = profileHome;
  const writeLoopBindingSourceDeps: WriteLoopBindingSourceDeps = {
    machineConfigPath: join(profileHome, "config.json"),
    machinesDir,
  };
  try {
    const ctx = createRunControlHandlerContext({
      stateStore,
      logReader: { tail: () => [], async *follow() {} },
      writeLoopExecutor: localFake.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => memoryHeadroom,
      settleDelayMs: 0,
      writeLoopBindingSourceDeps,
    });
    const handlers = createRunLifecycleHandlers(ctx, {
      handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "steps unsupported in test" }),
    });
    const signal = new AbortController().signal;
    const branchName = "hidden-shrink-resume";
    const runId = stateStore.createRun({
      project: branchName,
      specRef: "main",
      worktreePath: "/tmp/wt",
      branch: branchName,
      specPath: "/tmp/spec.md",
      status: "paused",
      stepId: "implement~shrink",
      workflowSnapshot: {
        invocationId: "hidden-shrink",
        steps: [
          {
            stepId: "implement",
            role: "implement",
            stepRules: "shrink rules",
            expectedArtifactPath: "/tmp/artifact",
            agents: ["claude"],
            agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
          },
        ],
      },
    });

    const resumed = await handlers.resume({ kind: "request", id: "r1", method: "resume", params: { runId } }, signal);
    expect(resumed).toEqual({ kind: "response", result: { ok: true } });
    expect(resumedInputs).toHaveLength(1);
    expect(resumedInputs[0]?.bindingResolution?.role).toBe("shrink");
  } finally {
    localFake.abortAll();
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
    rmSync(profileHome, { recursive: true, force: true });
  }
});

function writeTwoLinkIndexFixture(worktreePath: string): void {
  writeFileSync(join(worktreePath, "index.md"), "- [ ] [One](./one.md)\n- [ ] [Two](./two.md)\n", "utf8");
  writeFileSync(join(worktreePath, "one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] One\n", "utf8");
  writeFileSync(join(worktreePath, "two.md"), "# Two\n\n## Acceptance criteria\n\n- [ ] Two\n", "utf8");
}

function linkedWorkflowRunSnapshot(invocationId: string): WorkflowSnapshot {
  return {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "implement rules",
        expectedArtifactPath: "index.md",
        agents: ["claude"],
        agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
      },
      { stepId: "implement-review", role: "", behavior: "review-debate" },
    ],
    reviewPasses: 1,
    reviewBehavior: "debate",
  };
}

/** Machine profile fixture for admission's own reconstructability check, which resolves write-loop bindings. */
function setUpLinkedResumeMachineProfile(): {
  writeLoopBindingSourceDeps: WriteLoopBindingSourceDeps;
  cleanup: () => void;
} {
  const profileHome = trackedMkdtempSync(join(tmpdir(), "jarvis-linked-resume-profile-"));
  const machinesDir = join(profileHome, "machines");
  const machineProfile = "linked-resume-profile";
  const previousJarvisHome = process.env.JARVIS_HOME;
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string) => ({ rungs: [{ adapterModel, priceKey: adapterModel }] });
  writeFileSync(
    join(machinesDir, `${machineProfile}.json`),
    JSON.stringify({
      models: {
        claude: {
          plan: rung("plan"),
          implement: rung("M1"),
          shrink: rung("S1"),
          adversary: rung("adv"),
          critic: rung("crit"),
          advocate: rung("advoc"),
          adjudicator: rung("adj"),
          actuator: rung("act"),
        },
      },
    }),
  );
  writeFileSync(join(profileHome, "config.json"), JSON.stringify({ machineProfile, agents: ["claude"] }));
  process.env.JARVIS_HOME = profileHome;
  return {
    writeLoopBindingSourceDeps: { machineConfigPath: join(profileHome, "config.json"), machinesDir },
    cleanup: () => {
      if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
      else process.env.JARVIS_HOME = previousJarvisHome;
      rmSync(profileHome, { recursive: true, force: true });
    },
  };
}

type CapturedLinkedResume = {
  steps: AnyWorkflowStep[];
  workflowSnapshot: WorkflowSnapshot;
  admitRun?: () => Promise<{ kind: "error"; code: string; message: string } | undefined>;
  rollbackRunAdmission?: () => void;
};

function capturingLinkedWorkflowHandlers(writeLoopBindingSourceDeps: WriteLoopBindingSourceDeps): {
  ctx: ReturnType<typeof createRunControlHandlerContext>;
  handlers: ReturnType<typeof createRunLifecycleHandlers>;
  captured: CapturedLinkedResume[];
} {
  const captured: CapturedLinkedResume[] = [];
  const ctx = createRunControlHandlerContext({
    stateStore,
    logReader: { tail: () => [], async *follow() {} },
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
    writeLoopBindingSourceDeps,
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "steps unsupported in test" }),
    resumeLinkedWorkflowStart: (steps, workflowSnapshot, admitRun, rollbackRunAdmission) => {
      captured.push({
        steps,
        workflowSnapshot,
        ...(admitRun !== undefined ? { admitRun } : {}),
        ...(rollbackRunAdmission !== undefined ? { rollbackRunAdmission } : {}),
      });
      return { kind: "response", result: { runId: "fake-entry-run" } };
    },
  });
  return { ctx, handlers, captured };
}

test("resume routes a failed gate_invocation_refused implement~link-N row to resumeLinkedWorkflowStart, not the bare write loop", async () => {
  const worktreePath = trackedMkdtempSync(join(tmpdir(), "lifecycle-linked-resume-failed-"));
  writeTwoLinkIndexFixture(worktreePath);
  const runId = stateStore.createRun({
    project: "demo",
    specRef: "main",
    worktreePath,
    branch: "linked-route/failed",
    specPath: "index.md",
    stepId: "implement~link-0",
    workflowSnapshot: linkedWorkflowRunSnapshot("linked-route-failed"),
  });
  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "gate_invocation_refused",
    terminalCause: "gate_invocation_refused",
  });
  stateStore.setRunStatus(runId, "failed");

  const profile = setUpLinkedResumeMachineProfile();
  try {
    const { handlers, captured } = capturingLinkedWorkflowHandlers(profile.writeLoopBindingSourceDeps);
    const response = await handlers.resume(
      { kind: "request", id: "r1", method: "resume", params: { runId } },
      new AbortController().signal,
    );

    expect(response).toEqual({ kind: "response", result: { runId: "fake-entry-run" } });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.workflowSnapshot.invocationId).toBe("linked-route-failed");
    expect(captured[0]?.steps).toHaveLength(2);
    expect(captured[0]?.steps[0]).toMatchObject({
      behavior: "write",
      stepId: "implement",
      linkedIndexRouting: true,
      expectedArtifactPath: "index.md",
    });
    expect(captured[0]?.steps[1]).toMatchObject({
      behavior: "review-debate",
      stepId: "implement-review",
      maxCycles: 1,
    });
    // The bare write loop (`spawnWriteLoop`/`writeLoopExecutor`) never runs for this row.
    expect(fakeExecutor.pendingCount()).toBe(0);
    // A workflow start that fails after the admission applied restores the prior terminal status.
    expect(await captured[0]?.admitRun?.()).toBeUndefined();
    expect(stateStore.loadRun(runId)?.status).toBe("in-progress");
    captured[0]?.rollbackRunAdmission?.();
    expect(stateStore.loadRun(runId)?.status).toBe("failed");
  } finally {
    profile.cleanup();
    rmSync(worktreePath, { recursive: true, force: true });
  }
});

test("slot re-drive routes a slot-refused implement~link-N row through resumeLinkedWorkflowStart and counts it", async () => {
  const worktreePath = trackedMkdtempSync(join(tmpdir(), "lifecycle-linked-redrive-"));
  writeTwoLinkIndexFixture(worktreePath);
  const runId = stateStore.createRun({
    project: "demo",
    specRef: "main",
    worktreePath,
    branch: "linked-route/redrive",
    specPath: "index.md",
    stepId: "implement~link-0",
    workflowSnapshot: linkedWorkflowRunSnapshot("linked-route-redrive"),
  });
  stateStore.commitCompletionBoundary({
    attemptId: stateStore.recordAttemptStart(runId),
    runStatus: "failed",
    outcomeKind: "gate_invocation_refused",
    terminalCause: "gate_invocation_refused",
    gateRefusalRecoveryState: { cause: "slot_contention", gateCommand: "bun run test:v2", slotRedriveCount: 0 },
  });

  const profile = setUpLinkedResumeMachineProfile();
  try {
    const { ctx, captured } = capturingLinkedWorkflowHandlers(profile.writeLoopBindingSourceDeps);
    ctx.slotRedrive.enqueue(runId);
    await flushBackgroundRuns(3);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.steps[0]).toMatchObject({ stepId: "implement", linkedIndexRouting: true });
    expect(stateStore.loadRun(runId)?.gateRefusalRecoveryState).toMatchObject({ slotRedriveCount: 1 });
    ctx.slotRedrive.stop();
  } finally {
    profile.cleanup();
    rmSync(worktreePath, { recursive: true, force: true });
  }
});

test("resume routes a paused implement~link-N row to resumeLinkedWorkflowStart the same way as a failed one", async () => {
  const worktreePath = trackedMkdtempSync(join(tmpdir(), "lifecycle-linked-resume-paused-"));
  writeTwoLinkIndexFixture(worktreePath);
  const runId = stateStore.createRun({
    project: "demo",
    specRef: "main",
    worktreePath,
    branch: "linked-route/paused",
    specPath: "index.md",
    stepId: "implement~link-0",
    workflowSnapshot: linkedWorkflowRunSnapshot("linked-route-paused"),
  });
  stateStore.setRunStatus(runId, "paused");

  const profile = setUpLinkedResumeMachineProfile();
  try {
    const { handlers, captured } = capturingLinkedWorkflowHandlers(profile.writeLoopBindingSourceDeps);
    const response = await handlers.resume(
      { kind: "request", id: "r1", method: "resume", params: { runId } },
      new AbortController().signal,
    );

    expect(response).toEqual({ kind: "response", result: { runId: "fake-entry-run" } });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.steps[0]).toMatchObject({ stepId: "implement", linkedIndexRouting: true });
    expect(fakeExecutor.pendingCount()).toBe(0);
    // The linked route hands the workflow start a resume admission for this row, applied before any spawn.
    expect(stateStore.loadRun(runId)?.status).toBe("paused");
    expect(await captured[0]?.admitRun?.()).toBeUndefined();
    expect(stateStore.loadRun(runId)?.status).toBe("in-progress");
  } finally {
    profile.cleanup();
    rmSync(worktreePath, { recursive: true, force: true });
  }
});

test("resume refuses resume_unsupported for a linked row whose pinned index entry can no longer be resolved, without calling resumeLinkedWorkflowStart", async () => {
  const worktreePath = trackedMkdtempSync(join(tmpdir(), "lifecycle-linked-resume-malformed-"));
  // A single-entry index: the persisted `implement~link-1` row's pinned index position no longer exists.
  writeFileSync(join(worktreePath, "index.md"), "- [ ] [One](./one.md)\n", "utf8");
  writeFileSync(join(worktreePath, "one.md"), "# One\n\n## Acceptance criteria\n\n- [ ] One\n", "utf8");
  const runId = stateStore.createRun({
    project: "demo",
    specRef: "main",
    worktreePath,
    branch: "linked-route/malformed",
    specPath: "index.md",
    stepId: "implement~link-1",
    workflowSnapshot: linkedWorkflowRunSnapshot("linked-route-malformed"),
  });
  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "gate_invocation_refused",
    terminalCause: "gate_invocation_refused",
  });
  stateStore.setRunStatus(runId, "failed");

  const profile = setUpLinkedResumeMachineProfile();
  try {
    const { handlers, captured } = capturingLinkedWorkflowHandlers(profile.writeLoopBindingSourceDeps);
    const response = await handlers.resume(
      { kind: "request", id: "r1", method: "resume", params: { runId } },
      new AbortController().signal,
    );

    expect(response).toMatchObject({ kind: "error", code: "resume_unsupported" });
    if (response.kind === "error") {
      expect(response.message).toContain("re-run the spec");
    }
    expect(captured).toHaveLength(0);
    expect(fakeExecutor.pendingCount()).toBe(0);
  } finally {
    profile.cleanup();
    rmSync(worktreePath, { recursive: true, force: true });
  }
});

test("resume does not route a non-linked write row to resumeLinkedWorkflowStart", async () => {
  const runId = stateStore.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "non-linked-resume",
    specPath: "/tmp/spec.md",
    status: "paused",
    stepId: "implement",
    workflowSnapshot: {
      invocationId: "non-linked",
      steps: [
        {
          stepId: "implement",
          role: "implement",
          stepRules: "implement rules",
          expectedArtifactPath: "/tmp/artifact",
          agents: ["claude"],
          agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
        },
      ],
    },
  });

  const profile = setUpLinkedResumeMachineProfile();
  try {
    const { handlers, captured } = capturingLinkedWorkflowHandlers(profile.writeLoopBindingSourceDeps);
    const response = await handlers.resume(
      { kind: "request", id: "r1", method: "resume", params: { runId } },
      new AbortController().signal,
    );

    expect(response).toEqual({ kind: "response", result: { ok: true } });
    expect(captured).toHaveLength(0);
  } finally {
    profile.cleanup();
  }
});

test("list and wait project a stored operator failure record only when one exists", async () => {
  const record: OperatorFailureRecord = {
    expectation: "ready gate passes",
    observation: "ready gate exited 1",
    nearMiss: "typecheck passed",
    retryable: true,
    referencedPaths: [{ path: "spec.md", origin: "operator-repository" }],
  };
  const settle = (operatorFailureRecord?: OperatorFailureRecord) => {
    const runId = stateStore.createRun({
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/test-project",
      branch: `failure-${crypto.randomUUID()}`,
      specPath: "/tmp/test-project/spec.md",
    });
    stateStore.commitTerminalRunSettlement({
      runId,
      status: "failed",
      terminalCause: "ready_gate_failed",
      ...(operatorFailureRecord === undefined ? {} : { operatorFailureRecord }),
    });
    return runId;
  };
  const recordedRunId = settle(record);
  const absentRunId = settle();
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;

  const listed = await handlers.list({ kind: "request", id: "l1", method: "list" }, signal);
  if (listed.kind !== "response") throw new Error("list failed");
  const rows = (listed.result as { runs: Array<{ runId: string }> }).runs;
  expect(rows.find((row) => row.runId === recordedRunId)).toMatchObject({ failure: record });
  expect(rows.find((row) => row.runId === absentRunId)).not.toHaveProperty("failure");

  const recorded = await handlers.wait(
    { kind: "request", id: "w1", method: "wait", params: { runId: recordedRunId } },
    signal,
  );
  const absent = await handlers.wait(
    { kind: "request", id: "w2", method: "wait", params: { runId: absentRunId } },
    signal,
  );
  if (recorded.kind !== "response" || absent.kind !== "response") throw new Error("wait failed");
  expect(recorded.result).toMatchObject({ failure: record });
  expect(absent.result).not.toHaveProperty("failure");
});

test("workflow entry wait reports non_terminating_mutation_failed owned by a durable review step", async () => {
  const logsPath = join(tmpdir(), `jarvis-lifecycle-non-terminating-${process.pid}-${Date.now()}.jsonl`);
  const logSink = openLogSink(logsPath);
  try {
    const invocationId = "inv-entry-review-non-terminating-mutation";
    const workflowSnapshot = {
      invocationId,
      steps: [
        {
          stepId: "implement",
          role: "implement",
          stepRules: "implement rules",
          expectedArtifactPath: "/tmp/artifact",
          agents: ["codex"],
        },
        { stepId: "implement-review", role: "", durable: true, behavior: "review" as const },
      ],
    };
    const base = {
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/test-project",
      branch: "entry-review-non-terminating-mutation",
      specPath: "/tmp/test-project/spec.md",
      workflowSnapshot,
    };
    const entryRunId = stateStore.createRun({ ...base, stepId: "implement" });
    stateStore.setRunStatus(entryRunId, "completed");
    const reviewRunId = stateStore.createRun({ ...base, stepId: "implement-review" });
    stateStore.setRunStatus(reviewRunId, "failed");
    logSink.append(reviewRunId, {
      kind: "loop_finished",
      loopOutcomeKind: "non_terminating_mutation_failed",
      iterationsConsumed: 2,
      resumable: true,
      nonTerminatingMutation: "operator-flip: !== → ===",
      nonTerminatingMutationSourceFile: "src/guard.ts",
      nonTerminatingMutationSourceLine: 42,
    });
    logSink.close();

    const ctx = createRunControlHandlerContext({
      stateStore,
      logReader: openLogReader(logsPath),
      writeLoopExecutor: fakeExecutor.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => memoryHeadroom,
      settleDelayMs: 0,
    });
    const handlers = createRunLifecycleHandlers(ctx, {
      handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "steps unsupported in test" }),
    });
    const signal = new AbortController().signal;

    const waited = await handlers.wait(
      { kind: "request", id: "w1", method: "wait", params: { runId: entryRunId } },
      signal,
    );
    expect(waited.kind).toBe("response");
    if (waited.kind !== "response") return;

    expect(waited.result).toMatchObject({
      runStatus: "failed",
      loopOutcomeKind: "non_terminating_mutation_failed",
      iterationsConsumed: 2,
      error: {
        reason: "non_terminating_mutation_failed",
        nonTerminatingMutation: "operator-flip: !== → ===",
        nonTerminatingMutationSourceFile: "src/guard.ts",
        nonTerminatingMutationSourceLine: 42,
      },
    });
  } finally {
    rmSync(logsPath, { force: true });
  }
});

test("pause and kill release write-loop ownership", async () => {
  const { ctx, handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const input = mockWriteLoopInput({ projectName: "pause-kill", branchName: "pause-kill" });
  const started = await handlers.start({ kind: "request", id: "s1", method: "start", params: { input } }, signal);
  expect(started.kind).toBe("response");
  if (started.kind !== "response") return;
  const runId = (started.result as { runId: string }).runId;

  const paused = await handlers.pause({ kind: "request", id: "p1", method: "pause", params: { runId } }, signal);
  expect(paused).toEqual({ kind: "response", result: { ok: true } });
  expect(fakeExecutor.isPauseSignalTriggered()).toBe(true);

  const killed = await handlers.kill({ kind: "request", id: "k1", method: "kill", params: { runId } }, signal);
  expect(killed).toMatchObject({ kind: "response", result: { ok: true, status: "killed" } });
  await flushBackgroundRuns();

  expect(ctx.registry.isClaimed({ project: "pause-kill", branch: "pause-kill" })).toBe(false);
});

function settledInvocationRun(invocationId: string, branch: string, withMarker = true): string {
  const runId = stateStore.createRun({
    project: "republish",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch,
    specPath: "/tmp/spec.md",
    status: "completed",
    stepId: "step-1",
    workflowSnapshot: workflowSnapshot(invocationId, [{ stepId: "step-1", role: "implement" }]),
  });
  if (withMarker) stateStore.writeWorkflowInvocationSettledMarker(runId, "completed", 1);
  return runId;
}

test("a thrown republication tail rewrites the settled marker to failed", async () => {
  const { handlers } = lifecycleHandlers();
  const runId = settledInvocationRun("inv-republish-throw", "republish-throw");
  const outcome = await handlers.resumeFinalizationOnly(
    loadRunOrThrow(stateStore, runId),
    { project: "republish", branch: "republish-throw" },
    async () => {
      throw new Error("publish boom");
    },
  );
  expect(outcome).toMatchObject({ kind: "error", code: "internal_error" });
  expect(stateStore.readWorkflowInvocationSettledMarker(runId)?.cause).toBe("failed");
});

test("a resume whose tail fails restores the failed stage the admission reopened", async () => {
  const { handlers } = lifecycleHandlers();
  const runId = stateStore.createRun({
    project: "republish",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "stage-restore",
    specPath: "/tmp/spec.md",
    status: "failed",
    stepId: "step-1",
    workflowSnapshot: workflowSnapshot("inv-stage-restore", [{ stepId: "step-1", role: "implement" }]),
  });
  stateStore.commitTerminalRunSettlement({ runId, status: "failed", terminalCause: "invocation_failure" });
  const pipelineId = stateStore.createPipeline({
    definition: {
      name: "stage-restore",
      stages: [
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "none" },
        { stageId: "gate", kind: "approval" },
      ],
    },
  });
  const detail = { message: "tail boom" };
  stateStore.updateStage({
    pipelineId,
    stageId: "implement",
    patch: { status: "failed", workflowInvocationId: runId, startedAt: 100, endedAt: 200, failureDetail: detail },
  });
  stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "skipped", skipProvenance: "terminal" } });
  const stages = () => stateStore.loadPipeline(pipelineId)?.stages;

  const outcome = await handlers.resumeFinalizationOnly(
    loadRunOrThrow(stateStore, runId),
    { project: "republish", branch: "stage-restore" },
    async () => {
      expect(stages()?.map((stage) => stage.status)).toEqual(["running", "pending"]);
      return { ok: false, message: "tail failed" };
    },
  );

  expect(outcome).toMatchObject({ kind: "error", code: "internal_error" });
  expect(stages()).toMatchObject([
    { stageId: "implement", status: "failed", endedAt: 200, failureDetail: detail },
    { stageId: "gate", status: "skipped", skipProvenance: "terminal" },
  ]);
});

test("a republication tail returning a failure as a response rewrites the settled marker to failed", async () => {
  const { handlers } = lifecycleHandlers();
  const runId = settledInvocationRun("inv-republish-response", "republish-response");
  const outcome = await handlers.resumeFinalizationOnly(
    loadRunOrThrow(stateStore, runId),
    { project: "republish", branch: "republish-response" },
    async () => ({ ok: false, message: "publish refused" }),
    true,
  );
  expect(outcome).toMatchObject({ kind: "response", result: { ok: false } });
  expect(stateStore.readWorkflowInvocationSettledMarker(runId)?.cause).toBe("failed");
});

test("a republication tail returning a failure as an error rewrites the settled marker to failed", async () => {
  const { handlers } = lifecycleHandlers();
  const runId = settledInvocationRun("inv-republish-error", "republish-error");
  const outcome = await handlers.resumeFinalizationOnly(
    loadRunOrThrow(stateStore, runId),
    { project: "republish", branch: "republish-error" },
    async () => ({ ok: false, message: "publish refused" }),
  );
  expect(outcome).toMatchObject({ kind: "error", code: "internal_error" });
  expect(stateStore.readWorkflowInvocationSettledMarker(runId)?.cause).toBe("failed");
});

test("a successful republication leaves the settled marker untouched", async () => {
  const { handlers } = lifecycleHandlers();
  const runId = settledInvocationRun("inv-republish-ok", "republish-ok");
  await handlers.resumeFinalizationOnly(
    loadRunOrThrow(stateStore, runId),
    { project: "republish", branch: "republish-ok" },
    async () => ({ ok: true }),
  );
  expect(stateStore.readWorkflowInvocationSettledMarker(runId)).toEqual({ cause: "completed", settledAt: 1 });
});

test("a failed republication of a markerless invocation writes no marker", async () => {
  const { handlers } = lifecycleHandlers();
  const runId = settledInvocationRun("inv-republish-markerless", "republish-markerless", false);
  await handlers.resumeFinalizationOnly(
    loadRunOrThrow(stateStore, runId),
    { project: "republish", branch: "republish-markerless" },
    async () => ({ ok: false, message: "publish refused" }),
    true,
  );
  expect(stateStore.readWorkflowInvocationSettledMarker(runId)).toBeNull();
});

test("a republication tail aborted by run kill leaves the settled marker completed", async () => {
  const { handlers } = lifecycleHandlers();
  const runId = settledInvocationRun("inv-republish-kill", "republish-kill");
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const tail = handlers.resumeFinalizationOnly(
    loadRunOrThrow(stateStore, runId),
    { project: "republish", branch: "republish-kill" },
    (deps) =>
      new Promise((_resolve, reject) => {
        deps.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        markStarted();
      }),
  );
  await started;
  const killed = handlers.kill(
    { kind: "request", id: "k1", method: "kill", params: { runId } },
    new AbortController().signal,
  );
  await tail;
  await killed;
  expect(stateStore.readWorkflowInvocationSettledMarker(runId)).toEqual({ cause: "completed", settledAt: 1 });
});
