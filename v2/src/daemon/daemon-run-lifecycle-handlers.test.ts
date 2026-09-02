import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, loadRunOrThrow, mockWriteLoopInput, workflowSnapshot } from "../testing/run-control.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { resetWriteLoopBindingSourceDepsForTests, setWriteLoopBindingSourceDepsForTests } from "./daemon.ts";
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
  // @mutate v2/src/daemon/daemon-run-lifecycle-handlers.ts "if (!isTerminalRunStatus(run.status)) {" -> "if (isTerminalRunStatus(run.status)) {"
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
  // @mutate v2/src/daemon/daemon-run-lifecycle-handlers.ts "if (invocationId !== undefined) keptInvocationIds.add(invocationId);" -> "if (invocationId === undefined) keptInvocationIds.add(invocationId);"
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
  // @mutate v2/src/daemon/daemon-run-lifecycle-handlers.ts "if (invocationId !== undefined) keptInvocationIds.add(invocationId);" -> "if (invocationId === undefined) keptInvocationIds.add(invocationId);"
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
  // @mutate v2/src/daemon/daemon-run-lifecycle-handlers.ts "if (run.status !== \"paused\")" -> "if (run.status === \"paused\")"
  expect(resumed).toEqual({ kind: "response", result: { ok: true } });
});

test("resume admits a paused workflow write step with exact snapshot stepId", async () => {
  const resumedInputs: WriteLoopInput[] = [];
  const localFake = createFakeWriteLoopExecutor((input) => resumedInputs.push(input));
  const profileHome = mkdtempSync(join(tmpdir(), "jarvis-exact-step-profile-"));
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
  setWriteLoopBindingSourceDepsForTests({
    machineConfigPath: join(profileHome, "config.json"),
    machinesDir,
  });
  try {
    const ctx = createRunControlHandlerContext({
      stateStore,
      logReader: { tail: () => [], async *follow() {} },
      writeLoopExecutor: localFake.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => memoryHeadroom,
      settleDelayMs: 0,
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
    // @mutate v2/src/daemon/daemon-run-lifecycle-handlers.ts "candidate.stepId === stepId" -> "candidate.stepId !== stepId"
    expect(resumed).toEqual({ kind: "response", result: { ok: true } });
    expect(resumedInputs).toHaveLength(1);
    expect(resumedInputs[0]?.stepId).toBe("implement");
  } finally {
    localFake.abortAll();
    resetWriteLoopBindingSourceDepsForTests();
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
    rmSync(profileHome, { recursive: true, force: true });
  }
});

test("resume maps hidden ~shrink stepId to shrink role via snapshot base step", async () => {
  const resumedInputs: WriteLoopInput[] = [];
  const localFake = createFakeWriteLoopExecutor((input) => resumedInputs.push(input));
  const profileHome = mkdtempSync(join(tmpdir(), "jarvis-hidden-shrink-profile-"));
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
  setWriteLoopBindingSourceDepsForTests({
    machineConfigPath: join(profileHome, "config.json"),
    machinesDir,
  });
  try {
    const ctx = createRunControlHandlerContext({
      stateStore,
      logReader: { tail: () => [], async *follow() {} },
      writeLoopExecutor: localFake.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => memoryHeadroom,
      settleDelayMs: 0,
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
    // @mutate v2/src/daemon/daemon-run-lifecycle-handlers.ts "stepId?.endsWith(\"~shrink\") === true" -> "stepId?.endsWith(\"~shrink\") !== true"
    expect(resumed).toEqual({ kind: "response", result: { ok: true } });
    expect(resumedInputs).toHaveLength(1);
    expect(resumedInputs[0]?.bindingResolution?.role).toBe("shrink");
  } finally {
    localFake.abortAll();
    resetWriteLoopBindingSourceDepsForTests();
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
    rmSync(profileHome, { recursive: true, force: true });
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
  expect(killed).toEqual({ kind: "response", result: { ok: true } });
  await flushBackgroundRuns();

  expect(ctx.registry.isClaimed({ project: "pause-kill", branch: "pause-kill" })).toBe(false);
});
