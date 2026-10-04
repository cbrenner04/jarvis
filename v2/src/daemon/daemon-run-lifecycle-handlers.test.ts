import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OperatorFailureRecord } from "../shared/operator-failure-record.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { IntentFinalizationResumeDeps } from "../execution/workflow-runner-resume.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type RunStatus, type StateStore, type WorkflowSnapshot } from "../persistence/state-store.ts";
import {
  flushBackgroundRuns,
  loadRunOrThrow,
  mockWriteLoopInput,
  workflowSnapshot,
  workflowWriteStep,
} from "../testing/run-control.ts";
import { DEFAULT_AGENT_MODEL_CONFIG } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import type { WriteLoopBindingSourceDeps } from "./daemon.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";
import { deriveOperatorIncidents } from "./operator-incidents.ts";

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let memoryHeadroom: boolean;
let profileHome: string;
let writeLoopBindingSourceDeps: WriteLoopBindingSourceDeps;
let previousJarvisHome: string | undefined;

beforeEach(() => {
  profileHome = trackedMkdtempSync(join(tmpdir(), `jarvis-lifecycle-profile-${process.pid}-`));
  const machinesDir = join(profileHome, "machines");
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string) => ({ rungs: [{ adapterModel, priceKey: adapterModel }] });
  writeFileSync(
    join(machinesDir, "lifecycle-test.json"),
    JSON.stringify({
      models: {
        codex: {
          plan: rung("plan"),
          implement: rung("codex-fast"),
          shrink: rung("shrink"),
          adversary: rung("adv"),
          critic: rung("crit"),
          advocate: rung("advoc"),
          adjudicator: rung("adj"),
          actuator: rung("act"),
          routing: rung("act"),
        },
        cursor: {
          plan: rung("plan"),
          implement: rung("cursor-fast"),
          shrink: rung("shrink"),
          adversary: rung("adv"),
          critic: rung("crit"),
          advocate: rung("advoc"),
          adjudicator: rung("adj"),
          actuator: rung("act"),
          routing: rung("act"),
        },
      },
    }),
  );
  writeFileSync(
    join(profileHome, "config.json"),
    JSON.stringify({ machineProfile: "lifecycle-test", agents: ["codex", "cursor"] }),
  );
  previousJarvisHome = process.env.JARVIS_HOME;
  process.env.JARVIS_HOME = profileHome;
  writeLoopBindingSourceDeps = { machineConfigPath: join(profileHome, "config.json"), machinesDir };
  stateStore = openStateStore(join(tmpdir(), `jarvis-lifecycle-${process.pid}-${Date.now()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();
  memoryHeadroom = true;
});

afterEach(async () => {
  fakeExecutor.abortAll();
  await flushBackgroundRuns();
  if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
  else process.env.JARVIS_HOME = previousJarvisHome;
  rmSync(profileHome, { recursive: true, force: true });
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

function pausedImplementRun(
  overrides: Partial<{ project: string; branch: string; worktreePath: string; specPath: string }> = {},
): string {
  const branch = overrides.branch ?? "test-branch";
  const project = overrides.project ?? branch;
  return stateStore.createRun({
    project,
    specRef: "main",
    worktreePath: overrides.worktreePath ?? "/tmp/wt",
    branch,
    specPath: overrides.specPath ?? "/tmp/spec.md",
    stepId: "implement",
    status: "paused",
    workflowSnapshot: {
      invocationId: `inv-${branch}`,
      steps: [
        {
          stepId: "implement",
          role: "implement",
          stepRules: "test rules",
          expectedArtifactPath: "/tmp/artifact",
          agents: ["codex"],
          agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
        },
      ],
    },
  });
}

function lifecycleHandlers() {
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
  });
  return { ctx, handlers };
}

test("start rejects direct write input without workflow steps", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const refused = await handlers.start(
    { kind: "request", id: "s1", method: "start", params: { input: mockWriteLoopInput() } },
    signal,
  );
  expect(refused).toEqual({
    kind: "error",
    code: "invalid_params",
    message: "Direct write start via input is not supported; provide workflow steps",
  });
});

test("start requires workflow steps and delegates when they are present", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const missing = await handlers.start({ kind: "request", id: "s2", method: "start", params: {} }, signal);
  expect(missing).toEqual({ kind: "error", code: "invalid_params", message: "steps required" });
  // Mutation checkpoint: flipping the steps guard would route a stepped request into "steps required".
  const delegated = await handlers.start(
    { kind: "request", id: "s3", method: "start", params: { steps: [workflowWriteStep()] } },
    signal,
  );
  expect(delegated).toEqual({ kind: "error", code: "invalid_params", message: "steps unsupported in test" });
});

test("resume admits a second project while another run is active", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const firstRunId = pausedImplementRun({ branch: "branch-a", project: "project-a" });
  const first = await handlers.resume(
    { kind: "request", id: "r1", method: "resume", params: { runId: firstRunId } },
    signal,
  );
  expect(first.kind).toBe("response");

  const secondRunId = pausedImplementRun({ branch: "branch-b", project: "project-b" });
  const second = await handlers.resume(
    { kind: "request", id: "r2", method: "resume", params: { runId: secondRunId } },
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
  const runId = pausedImplementRun({ branch: "list-live", project: "list-live" });
  const resumed = await handlers.resume({ kind: "request", id: "r1", method: "resume", params: { runId } }, signal);
  expect(resumed.kind).toBe("response");
  await flushBackgroundRuns();

  const listed = await handlers.list({ kind: "request", id: "l1", method: "list" }, signal);
  expect(listed.kind).toBe("response");
  if (listed.kind !== "response") return;

  const runs = (listed.result as { runs: Array<{ runId: string; isLive: boolean; status: string }> }).runs;
  const row = runs.find((candidate) => candidate.runId === runId);
  expect(row).toMatchObject({ status: "in-progress", isLive: true });
});

test("resume admits a paused workflow implement run", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const branchName = "workflow-resume-guard";
  const runId = pausedImplementRun({ branch: branchName, project: branchName });

  const resumed = await handlers.resume({ kind: "request", id: "r1", method: "resume", params: { runId } }, signal);
  expect(resumed).toEqual({ kind: "response", result: { ok: true } });
});

test("resume rejects allowLanePrRepublish false without changing the run row", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const runId = pausedImplementRun({ branch: "republish-guard", project: "republish-guard" });
  const before = loadRunOrThrow(stateStore, runId);

  const refused = await handlers.resume(
    { kind: "request", id: "r1", method: "resume", params: { runId, allowLanePrRepublish: false } },
    signal,
  );
  expect(refused).toEqual({
    kind: "error",
    code: "invalid_params",
    message: "allowLanePrRepublish must be true when present",
  });
  expect(loadRunOrThrow(stateStore, runId)).toEqual(before);
  expect(fakeExecutor.pendingCount()).toBe(0);
});

test.each([
  { rpcAllowLanePrRepublish: undefined, expectedOnWriteLoopInput: undefined },
  { rpcAllowLanePrRepublish: true, expectedOnWriteLoopInput: true },
] as const)("paused write-loop resume sets allowLanePrRepublish on spawnWriteLoop input only when RPC opts in (rpc=$rpcAllowLanePrRepublish)", async ({
  rpcAllowLanePrRepublish,
  expectedOnWriteLoopInput,
}) => {
  const resumedInputs: WriteLoopInput[] = [];
  const localFake = createFakeWriteLoopExecutor((input) => resumedInputs.push(input));
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
  const branchName = `paused-republish-${String(rpcAllowLanePrRepublish)}`;
  const runId = pausedImplementRun({ branch: branchName, project: branchName });

  const resumed = await handlers.resume(
    {
      kind: "request",
      id: "r1",
      method: "resume",
      params: {
        runId,
        ...(rpcAllowLanePrRepublish === true ? { allowLanePrRepublish: true } : {}),
      },
    },
    signal,
  );
  expect(resumed).toEqual({ kind: "response", result: { ok: true } });
  await flushBackgroundRuns();
  expect(resumedInputs).toHaveLength(1);
  expect(resumedInputs[0]?.allowLanePrRepublish).toBe(expectedOnWriteLoopInput);
  localFake.abortAll();
});

test.each([
  { resumePublicationOptions: undefined, expectedOnTailDeps: undefined },
  { resumePublicationOptions: { allowLanePrRepublish: true }, expectedOnTailDeps: true },
] as const)("resumeFinalizationOnly sets allowLanePrRepublish on tail deps only when publication options opt in (optIn=$expectedOnTailDeps)", async ({
  resumePublicationOptions,
  expectedOnTailDeps,
}) => {
  const { handlers } = lifecycleHandlers();
  const branch = `finalization-republish-${String(expectedOnTailDeps)}`;
  const runId = settledInvocationRun(`inv-finalization-republish-${String(expectedOnTailDeps)}`, branch);
  let capturedDeps: IntentFinalizationResumeDeps | undefined;
  const resumeFinalizationWithPublicationOptions = handlers.resumeFinalizationOnly as (
    run: ReturnType<typeof loadRunOrThrow>,
    key: { project: string; branch: string },
    execute: (deps: IntentFinalizationResumeDeps) => Promise<{ ok: true } | { ok: false; message: string }>,
    failureAsResponse?: boolean,
    reopenStage?: unknown,
    publicationOptions?: { allowLanePrRepublish?: true },
  ) => ReturnType<typeof handlers.resumeFinalizationOnly>;
  const outcome = await resumeFinalizationWithPublicationOptions(
    loadRunOrThrow(stateStore, runId),
    { project: "republish", branch },
    async (deps) => {
      capturedDeps = deps;
      return { ok: true };
    },
    false,
    undefined,
    resumePublicationOptions,
  );
  expect(outcome).toEqual({ kind: "response", result: { ok: true } });
  expect(capturedDeps?.allowLanePrRepublish).toBe(expectedOnTailDeps);
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
          routing: rung("act"),
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

    // The resumed loop settling the invocation writes a settled marker, so the settle notifies.
    commitReviewBoundary(runId, "completed");
    localFake.settleAll();
    await flushBackgroundRuns();
    expect(stateStore.readWorkflowInvocationSettledMarker(runId)?.cause).toBe("completed");
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
          routing: rung("act"),
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

test("resume hidden ~shrink replays preShrinkHead from durable log", async () => {
  const resumedInputs: WriteLoopInput[] = [];
  const localFake = createFakeWriteLoopExecutor((input) => resumedInputs.push(input));
  const logsPath = join(tmpdir(), `jarvis-hidden-shrink-pre-head-${process.pid}-${Date.now()}.jsonl`);
  const logSink = openLogSink(logsPath);
  const preShrinkHead = "abc123deadbeef";
  const profileHome = trackedMkdtempSync(join(tmpdir(), "jarvis-hidden-shrink-pre-head-profile-"));
  const machinesDir = join(profileHome, "machines");
  const machineProfile = "hidden-shrink-pre-head-profile";
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
          routing: rung("act"),
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
    const branchName = "hidden-shrink-pre-head-resume";
    const runId = stateStore.createRun({
      project: branchName,
      specRef: "main",
      worktreePath: "/tmp/wt",
      branch: branchName,
      specPath: "/tmp/spec.md",
      status: "paused",
      stepId: "implement~shrink",
      workflowSnapshot: {
        invocationId: "hidden-shrink-pre-head",
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
    logSink.append(runId, { kind: "pre_shrink_head", head: preShrinkHead });
    logSink.append(runId, {
      kind: "loop_finished",
      loopOutcomeKind: "paused",
      iterationsConsumed: 1,
      resumable: true,
    });
    logSink.close();

    const ctx = createRunControlHandlerContext({
      stateStore,
      logReader: openLogReader(logsPath),
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

    const resumed = await handlers.resume({ kind: "request", id: "r1", method: "resume", params: { runId } }, signal);
    expect(resumed).toEqual({ kind: "response", result: { ok: true } });
    expect(resumedInputs).toHaveLength(1);
    expect(resumedInputs[0]?.bindingResolution?.role).toBe("shrink");
    expect(resumedInputs[0]?.preShrinkHead).toBe(preShrinkHead);
  } finally {
    localFake.abortAll();
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
    rmSync(profileHome, { recursive: true, force: true });
    rmSync(logsPath, { force: true });
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
          routing: rung("act"),
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
  settleStagesAfterResume?: (runId: string) => void;
  resumedRunId?: string;
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
    resumeLinkedWorkflowStart: (
      steps,
      workflowSnapshot,
      admitRun,
      rollbackRunAdmission,
      settleStagesAfterResume,
      _options,
      resumedRunId,
    ) => {
      captured.push({
        steps,
        workflowSnapshot,
        ...(admitRun !== undefined ? { admitRun } : {}),
        ...(rollbackRunAdmission !== undefined ? { rollbackRunAdmission } : {}),
        ...(settleStagesAfterResume !== undefined ? { settleStagesAfterResume } : {}),
        ...(resumedRunId !== undefined ? { resumedRunId } : {}),
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
    expect(captured[0]?.settleStagesAfterResume).toBeDefined();
    expect(captured[0]?.resumedRunId).toBe(runId);
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
    expect(captured[0]?.resumedRunId).toBe(runId);
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
    expect(captured[0]?.resumedRunId).toBe(runId);
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

test("list and wait project lanePrOutcome when terminal run row is loaded", async () => {
  const logsPath = join(tmpdir(), `jarvis-lifecycle-lane-pr-${process.pid}-${Date.now()}.jsonl`);
  const logSink = openLogSink(logsPath);
  try {
    const closedNumber = 88;
    const runId = stateStore.createRun({
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/test-project",
      branch: `lane-pr-${crypto.randomUUID()}`,
      specPath: "/tmp/test-project/spec.md",
    });
    stateStore.commitTerminalRunSettlement({
      runId,
      status: "completed",
      terminalCause: "complete",
      prNumber: closedNumber,
    });
    logSink.append(runId, {
      kind: "loop_finished",
      loopOutcomeKind: "complete",
      iterationsConsumed: 1,
      resumable: false,
      lanePrOutcome: { kind: "lane_pr_closed", prNumber: closedNumber },
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
    const expectedLane = { kind: "lane_pr_closed", prNumber: closedNumber };

    const waited = await handlers.wait({ kind: "request", id: "w-lane", method: "wait", params: { runId } }, signal);
    expect(waited.kind).toBe("response");
    if (waited.kind !== "response") return;
    expect(waited.result).toMatchObject({
      runStatus: "completed",
      loopOutcomeKind: "complete",
      lanePrOutcome: expectedLane,
    });

    const listed = await handlers.list({ kind: "request", id: "l-lane", method: "list" }, signal);
    if (listed.kind !== "response") throw new Error("list failed");
    const row = (listed.result as { runs: Array<Record<string, unknown>> }).runs.find(
      (candidate) => candidate.runId === runId,
    );
    // Mutation checkpoint: flipping `fullRun === undefined` on buildRunListRow lanePrOutcome guard must turn this RED.
    expect(row).toMatchObject({ status: "completed", lanePrOutcome: expectedLane });
  } finally {
    rmSync(logsPath, { force: true });
  }
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
      reviewFeedbackAddressedItemIds: ["thread-owned-addressed"],
      reviewFeedbackDeclinedItemIds: ["comment-owned-declined"],
      reviewFeedbackUnaddressedItemIds: ["thread-owned-unaddressed"],
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
      reviewFeedbackAddressedItemIds: ["thread-owned-addressed"],
      reviewFeedbackDeclinedItemIds: ["comment-owned-declined"],
      reviewFeedbackUnaddressedItemIds: ["thread-owned-unaddressed"],
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

const priorLaneSteps = [
  { stepId: "implement", role: "implement" },
  { stepId: "implement-review", role: "", durable: true },
];
const priorLaneBase = {
  project: "test-project",
  specRef: "main",
  worktreePath: "/tmp/test-project",
  branch: "prior-lane-successor",
  specPath: "/tmp/test-project/spec.md",
};

/** One prior invocation: a completed entry row plus a review row with `reviewStatus`, on `branch`. */
function createPriorLaneInvocation(invocationId: string, reviewStatus: RunStatus, branch = priorLaneBase.branch): void {
  const snapshot = workflowSnapshot(invocationId, priorLaneSteps);
  const base = { ...priorLaneBase, branch, workflowSnapshot: snapshot };
  stateStore.createRun({ ...base, stepId: "implement", status: "completed" });
  stateStore.createRun({ ...base, stepId: "implement-review", status: reviewStatus });
}

/** Current invocation: entry settled complete with zero attempts and no review row. */
function createCleanEntryMissingReview(): string {
  const entryRunId = stateStore.createRun({
    ...priorLaneBase,
    stepId: "implement",
    workflowSnapshot: workflowSnapshot("inv-current-lane", priorLaneSteps),
  });
  stateStore.commitTerminalRunSettlement({ runId: entryRunId, status: "completed", terminalCause: "complete" });
  return entryRunId;
}

/** Runs `create` with `Date.now()` pinned to `ms`, so row `createdAt` order is deterministic. */
function createdAtMs<T>(ms: number, create: () => T): T {
  setSystemTime(new Date(ms));
  try {
    return create();
  } finally {
    setSystemTime();
  }
}

async function waitedEntryRunStatus(entryRunId: string): Promise<unknown> {
  const { handlers } = lifecycleHandlers();
  const waited = await handlers.wait(
    { kind: "request", id: "w1", method: "wait", params: { runId: entryRunId } },
    new AbortController().signal,
  );
  if (waited.kind !== "response") throw new Error("wait failed");
  return (waited.result as { runStatus: unknown }).runStatus;
}

test("workflow entry wait rolls up completed when an earlier same-lane invocation completed the missing durable successor", async () => {
  createdAtMs(1_000, () => createPriorLaneInvocation("inv-prior-lane", "completed"));
  expect(await waitedEntryRunStatus(createdAtMs(3_000, createCleanEntryMissingReview))).toBe("completed");
});

test("workflow entry wait rolls up killed when the latest prior same-lane successor row was killed", async () => {
  createdAtMs(1_000, () => createPriorLaneInvocation("inv-prior-a", "completed"));
  createdAtMs(2_000, () => createPriorLaneInvocation("inv-prior-b", "killed"));
  expect(await waitedEntryRunStatus(createdAtMs(3_000, createCleanEntryMissingReview))).toBe("killed");
});

test("workflow entry wait ignores a completed successor on a different branch", async () => {
  createdAtMs(1_000, () => createPriorLaneInvocation("inv-other-branch", "completed", "other-branch"));
  expect(await waitedEntryRunStatus(createdAtMs(3_000, createCleanEntryMissingReview))).toBe("killed");
});

test("workflow entry wait ignores a same-lane invocation created after the entry", async () => {
  const entryRunId = createdAtMs(1_000, createCleanEntryMissingReview);
  createdAtMs(3_000, () => createPriorLaneInvocation("inv-later-lane", "completed"));
  expect(await waitedEntryRunStatus(entryRunId)).toBe("killed");
});

test("kill releases workflow write ownership", async () => {
  const { ctx, handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const runId = pausedImplementRun({ branch: "pause-kill", project: "pause-kill" });
  const resumed = await handlers.resume({ kind: "request", id: "r1", method: "resume", params: { runId } }, signal);
  expect(resumed.kind).toBe("response");

  const killed = await handlers.kill(
    { kind: "request", id: "k1", method: "kill", params: { runId, force: true } },
    signal,
  );
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

test("a resumed finalization settlement continues after its reopened stage succeeds", async () => {
  const runId = stateStore.createRun({
    project: "republish",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "stage-continue",
    specPath: "/tmp/spec.md",
    status: "failed",
    stepId: "step-1",
    workflowSnapshot: workflowSnapshot("inv-stage-continue", [{ stepId: "step-1", role: "implement" }]),
  });
  stateStore.commitTerminalRunSettlement({ runId, status: "failed", terminalCause: "invocation_failure" });
  const pipelineId = stateStore.createPipeline({
    definition: {
      name: "stage-continue",
      stages: [
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "none" },
        { stageId: "gate", kind: "approval" },
      ],
    },
  });
  stateStore.updateStage({
    pipelineId,
    stageId: "implement",
    patch: { status: "failed", workflowInvocationId: runId, failureDetail: { message: "stale" } },
  });
  stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "skipped", skipProvenance: "terminal" } });
  const continuations: Array<{ pipelineId: string; branchKey: string }> = [];
  const ctx = createRunControlHandlerContext({
    stateStore,
    logReader: { tail: () => [], async *follow() {} },
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "unused" }),
    continuePipelineAfterSettlement: async (continuedPipelineId, branchKey) => {
      continuations.push({ pipelineId: continuedPipelineId, branchKey });
    },
  });

  const outcome = await handlers.resumeFinalizationOnly(
    loadRunOrThrow(stateStore, runId),
    { project: "republish", branch: "stage-continue" },
    async () => {
      const attemptId = stateStore.recordAttemptStart(runId);
      stateStore.commitCompletionBoundary({
        attemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex",
      });
      return { ok: true };
    },
  );

  expect(outcome).toMatchObject({ kind: "response" });
  expect(stateStore.loadPipeline(pipelineId)?.stages).toMatchObject([
    { stageId: "implement", status: "succeeded" },
    { stageId: "gate", status: "pending" },
  ]);
  expect(continuations).toEqual([{ pipelineId, branchKey: "default" }]);
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

test("a successful republication re-settles the marker completed with a fresh settle", async () => {
  const { handlers } = lifecycleHandlers();
  const runId = settledInvocationRun("inv-republish-ok", "republish-ok");
  await handlers.resumeFinalizationOnly(
    loadRunOrThrow(stateStore, runId),
    { project: "republish", branch: "republish-ok" },
    async () => commitReviewBoundary(runId, "completed"),
  );
  const marker = stateStore.readWorkflowInvocationSettledMarker(runId);
  expect(marker?.cause).toBe("completed");
  expect(marker?.settledAt).toBeGreaterThan(1);
});

test("a failed republication of a markerless invocation writes a failed marker", async () => {
  const { handlers } = lifecycleHandlers();
  const runId = settledInvocationRun("inv-republish-markerless", "republish-markerless", false);
  await handlers.resumeFinalizationOnly(
    loadRunOrThrow(stateStore, runId),
    { project: "republish", branch: "republish-markerless" },
    async () => ({ ok: false, message: "publish refused" }),
    true,
  );
  expect(stateStore.readWorkflowInvocationSettledMarker(runId)?.cause).toBe("failed");
});

/** Linked-implement invocation as dispatched: no step-0 row, `~link-0` is the entry; the review row failed. */
function failedLinkedInvocation(invocationId: string, branch: string): { entryRunId: string; reviewRunId: string } {
  const snapshot = workflowSnapshot(invocationId, [
    { stepId: "implement", role: "implement" },
    { stepId: "implement-review", role: "review" },
  ]);
  const row = (stepId: string, status: RunStatus, createdAtMs: number): string => {
    setSystemTime(new Date(createdAtMs));
    return stateStore.createRun({
      project: "resume-notify",
      specRef: "main",
      worktreePath: "/tmp/wt",
      branch,
      specPath: "/tmp/spec.md",
      status,
      stepId,
      workflowSnapshot: snapshot,
    });
  };
  const base = Date.now() - 10_000;
  const entryRunId = row("implement~link-0", "completed", base);
  row("implement~shrink", "completed", base + 1_000);
  const reviewRunId = row("implement-review", "failed", base + 2_000);
  setSystemTime();
  stateStore.commitTerminalRunSettlement({
    runId: reviewRunId,
    status: "failed",
    terminalCause: "surviving_mutation_failed",
  });
  stateStore.writeWorkflowInvocationSettledMarker(entryRunId, "failed", base + 3_000);
  stateStore.tryRecordNotificationDelivery({
    incidentId: `run:${entryRunId}`,
    transition: `terminal:failed:${base + 3_000}`,
    deliveredAt: base + 3_000,
  });
  return { entryRunId, reviewRunId };
}

function commitReviewBoundary(runId: string, runStatus: "completed" | "failed"): { ok: true } {
  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary(
    runStatus === "completed"
      ? { attemptId, runStatus, outcomeKind: "done", completionAgent: "codex" }
      : {
          attemptId,
          runStatus,
          outcomeKind: "invocation_failure",
          invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message: "repair exhausted" },
        },
  );
  return { ok: true };
}

for (const runStatus of ["completed", "failed"] as const) {
  test(`resuming a failed non-entry row that settles ${runStatus} notifies the invocation again`, async () => {
    const { handlers } = lifecycleHandlers();
    const { entryRunId, reviewRunId } = failedLinkedInvocation(`inv-resume-${runStatus}`, `resume-${runStatus}`);
    await handlers.resumeFinalizationOnly(
      loadRunOrThrow(stateStore, reviewRunId),
      { project: "resume-notify", branch: `resume-${runStatus}` },
      async () => commitReviewBoundary(reviewRunId, runStatus),
    );
    const incidents = deriveOperatorIncidents(stateStore).filter((incident) => incident.runId === entryRunId);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ kind: "run-ad-hoc-terminal", cause: runStatus });
  });

  test(`resuming a failed non-entry row of a failed pipeline stage that settles ${runStatus} re-settles and re-notifies the stage`, async () => {
    const { handlers } = lifecycleHandlers();
    const { entryRunId, reviewRunId } = failedLinkedInvocation(`inv-stage-${runStatus}`, `stage-${runStatus}`);
    const pipelineId = stateStore.createPipeline({
      definition: {
        name: `stage-${runStatus}`,
        stages: [
          { stageId: "implement", kind: "workflow", workflow: "implement", review: "none" },
          { stageId: "gate", kind: "approval" },
        ],
      },
    });
    const failedAt = Date.now() - 1_000;
    stateStore.updateStage({
      pipelineId,
      stageId: "implement",
      patch: { status: "failed", workflowInvocationId: entryRunId, startedAt: failedAt - 100, endedAt: failedAt },
    });
    stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "skipped", skipProvenance: "terminal" } });
    // The first failure already notified (a linear pipeline's only lane failing is `pipeline-terminal`).
    for (const { incidentId, transition } of deriveOperatorIncidents(stateStore)) {
      stateStore.tryRecordNotificationDelivery({ incidentId, transition, deliveredAt: failedAt });
    }

    await handlers.resumeFinalizationOnly(
      loadRunOrThrow(stateStore, reviewRunId),
      { project: "resume-notify", branch: `stage-${runStatus}` },
      async () => commitReviewBoundary(reviewRunId, runStatus),
    );

    const stage = stateStore.loadPipeline(pipelineId)?.stages.find((row) => row.stageId === "implement");
    expect(stage?.status).toBe(runStatus === "completed" ? "succeeded" : "failed");
    expect(stage?.endedAt).toBeGreaterThan(failedAt);
    const stageIncidents = deriveOperatorIncidents(stateStore).filter((incident) => incident.pipelineId === pipelineId);
    expect(stageIncidents.map((incident) => incident.kind)).toContain(
      runStatus === "completed" ? "stage-succeeded" : "pipeline-terminal",
    );
  });
}

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
  // A refused admission settles the tail without starting execute; fail instead of awaiting `started` forever.
  expect(await Promise.race([started.then(() => "started"), tail.then(() => "tail-settled")])).toBe("started");
  const killed = handlers.kill(
    { kind: "request", id: "k1", method: "kill", params: { runId } },
    new AbortController().signal,
  );
  await tail;
  await killed;
  expect(stateStore.readWorkflowInvocationSettledMarker(runId)).toEqual({ cause: "completed", settledAt: 1 });
});

test("wait projects a completed row's stale publication cause as complete unless the terminal record is run_execution_failed", async () => {
  const signal = new AbortController().signal;
  const cases = [
    {
      event: {
        kind: "loop_finished",
        loopOutcomeKind: "ready_flip_failed",
        iterationsConsumed: 2,
        resumable: false,
      },
      expected: "complete",
    },
    { event: { kind: "run_execution_failed", message: "boom" }, expected: undefined },
  ] as const;
  for (const { event, expected } of cases) {
    const runId = stateStore.createRun({
      project: "test-project",
      specRef: "main",
      worktreePath: "/tmp/wt",
      branch: `stale-${event.kind}`,
      specPath: "/tmp/wt/spec.md",
    });
    stateStore.commitTerminalRunSettlement({ runId, status: "completed", terminalCause: "ready_flip_failed" });
    const ctx = createRunControlHandlerContext({
      stateStore,
      logReader: {
        tail: () => [{ runId, seq: 1, ts: new Date().toISOString(), event }],
        async *follow() {},
      },
      writeLoopExecutor: fakeExecutor.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => memoryHeadroom,
      settleDelayMs: 0,
    });
    const handlers = createRunLifecycleHandlers(ctx, {
      handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "unsupported" }),
    });

    const waited = await handlers.wait(
      { kind: "request", id: `w-${event.kind}`, method: "wait", params: { runId } },
      signal,
    );
    if (waited.kind !== "response") throw new Error("wait failed");
    const result = waited.result as { runStatus: string; loopOutcomeKind?: string };
    expect(result.runStatus).toBe("completed");
    expect(result.loopOutcomeKind).toBe(expected);
  }
});

test("run resume admitted while a pipeline-scoped resume awaits admission reopens without the pipeline scope", async () => {
  const pausedRun = (branch: string): string =>
    pausedImplementRun({ branch, project: branch, worktreePath: `/tmp/${branch}` });
  const pipelineRunId = pausedRun("pipeline-scoped-resume");
  const plainRunId = pausedRun("plain-run-resume");
  let releasePipelineAdmission = (): void => {};
  const pipelineAdmissionGate = new Promise<void>((resolve) => {
    releasePipelineAdmission = resolve;
  });
  let signalPipelineAdmissionEntered = (): void => {};
  const pipelineAdmissionEntered = new Promise<void>((resolve) => {
    signalPipelineAdmissionEntered = resolve;
  });
  const reopenScopes = new Map<string, unknown>();
  const target = stateStore;
  const gatedStore = new Proxy(target, {
    get(obj, prop) {
      if (prop === "admitRunForResume") {
        return async (runId: string) => {
          if (runId === pipelineRunId) {
            signalPipelineAdmissionEntered();
            await pipelineAdmissionGate;
          }
          return obj.admitRunForResume(runId);
        };
      }
      if (prop === "reopenFailedStagesForResume") {
        return (entryRunId: string, reopenStage?: unknown) => {
          reopenScopes.set(entryRunId, reopenStage);
          return obj.reopenFailedStagesForResume(entryRunId, reopenStage as never);
        };
      }
      const value = Reflect.get(obj, prop, obj);
      return typeof value === "function" ? value.bind(obj) : value;
    },
  });
  const ctx = createRunControlHandlerContext({
    stateStore: gatedStore,
    logReader: { tail: () => [], async *follow() {} },
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
    writeLoopBindingSourceDeps,
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "steps unsupported in test" }),
  });
  const pipelineScope = { pipelineId: "pipeline-1", stageId: "implement", branchKey: "default" };
  const pipelineResume = handlers.resumeRunForPipeline(pipelineRunId, pipelineScope);
  await pipelineAdmissionEntered;

  const plain = await handlers.resume(
    { kind: "request", id: "r1", method: "resume", params: { runId: plainRunId } },
    new AbortController().signal,
  );
  expect(plain).toEqual({ kind: "response", result: { ok: true } });
  expect(reopenScopes.has(plainRunId)).toBe(true);
  expect(reopenScopes.get(plainRunId)).toBeUndefined();

  releasePipelineAdmission();
  expect(await pipelineResume).toEqual({ kind: "ok" });
  expect(reopenScopes.get(pipelineRunId)).toEqual(pipelineScope);
});

test("resumeRunForPipeline refuses an unknown run id", async () => {
  const { handlers } = lifecycleHandlers();
  const outcome = await handlers.resumeRunForPipeline("missing-run-id", {
    pipelineId: "pipeline-1",
    stageId: "stage-1",
    branchKey: "main",
  });
  expect(outcome).toEqual({
    kind: "refused",
    reason: "unknown_run",
    message: "Run missing-run-id not found",
  });
});

test("resumeRunForPipeline resolves terminal log records from logReader for run-resume admission", async () => {
  const worktreePath = trackedMkdtempSync(join(tmpdir(), "lifecycle-pipeline-resume-admission-"));
  mkdirSync(worktreePath, { recursive: true });
  const branch = "pipeline-resume/admission-log";
  const logsPath = join(tmpdir(), `lifecycle-pipeline-resume-admission-log-${process.pid}-${Date.now()}.jsonl`);
  const logSink = openLogSink(logsPath);
  try {
    const runId = stateStore.createRun({
      project: "demo",
      specRef: "main",
      worktreePath,
      branch,
      specPath: join(worktreePath, "spec.md"),
      status: "failed",
      stepId: "implement",
      workflowSnapshot: {
        invocationId: "pipeline-resume-admission-log",
        steps: [
          {
            stepId: "implement",
            role: "implement",
            stepRules: "rules",
            expectedArtifactPath: "out.md",
            agents: ["codex"],
            agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
          },
        ],
      },
    });
    const attemptId = stateStore.recordAttemptStart(runId);
    stateStore.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: "idle_output_timeout",
      terminalCause: "idle_output_timeout",
    });
    logSink.append(runId, {
      kind: "loop_finished",
      loopOutcomeKind: "idle_output_timeout",
      iterationsConsumed: 1,
      resumable: true,
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

    const outcome = await handlers.resumeRunForPipeline(runId, {
      pipelineId: "pipeline-1",
      stageId: "stage-1",
      branchKey: branch,
    });
    expect(outcome).toMatchObject({
      kind: "refused",
      reason: "resume_unsupported",
    });
  } finally {
    fakeExecutor.abortAll();
    rmSync(worktreePath, { recursive: true, force: true });
  }
});

test("resumeRunForPipeline returns terminal_run when run-resume admission is terminal, without reconstructing the write loop", async () => {
  const worktreePath = trackedMkdtempSync(join(tmpdir(), "lifecycle-pipeline-resume-terminal-admission-"));
  mkdirSync(worktreePath, { recursive: true });
  const branch = "pipeline-resume/terminal-admission";
  try {
    const runId = stateStore.createRun({
      project: "demo",
      specRef: "main",
      worktreePath,
      branch,
      specPath: join(worktreePath, "spec.md"),
      status: "failed",
      stepId: "implement",
      workflowSnapshot: {
        invocationId: "pipeline-resume-terminal-admission",
        steps: [
          {
            stepId: "implement",
            role: "implement",
            stepRules: "rules",
            expectedArtifactPath: "out.md",
            agents: ["codex"],
            agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
          },
        ],
      },
    });
    const { handlers } = lifecycleHandlers();
    const outcome = await handlers.resumeRunForPipeline(runId, {
      pipelineId: "pipeline-1",
      stageId: "stage-1",
      branchKey: branch,
    });
    expect(outcome).toMatchObject({ kind: "refused", reason: "terminal_run" });
    expect(fakeExecutor.pendingCount()).toBe(0);
  } finally {
    fakeExecutor.abortAll();
    rmSync(worktreePath, { recursive: true, force: true });
  }
});

test("resumeRunForPipeline routes a failed gate_invocation_refused implement~link-N row through resumeLinkedWorkflowStart", async () => {
  const worktreePath = trackedMkdtempSync(join(tmpdir(), "lifecycle-pipeline-resume-linked-"));
  writeTwoLinkIndexFixture(worktreePath);
  const runId = stateStore.createRun({
    project: "demo",
    specRef: "main",
    worktreePath,
    branch: "linked-route/pipeline-resume",
    specPath: "index.md",
    stepId: "implement~link-0",
    workflowSnapshot: linkedWorkflowRunSnapshot("linked-pipeline-resume"),
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
    const outcome = await handlers.resumeRunForPipeline(runId, {
      pipelineId: "pipeline-linked",
      stageId: "implement",
      branchKey: "default",
    });
    expect(outcome).toEqual({ kind: "ok" });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.workflowSnapshot.invocationId).toBe("linked-pipeline-resume");
    expect(fakeExecutor.pendingCount()).toBe(0);
  } finally {
    profile.cleanup();
    rmSync(worktreePath, { recursive: true, force: true });
  }
});

test("resumeRunForPipeline maps resumeReconstructedRun errors to refused outcomes", async () => {
  const worktreePath = trackedMkdtempSync(join(tmpdir(), "lifecycle-pipeline-resume-reconstruct-error-"));
  mkdirSync(worktreePath, { recursive: true });
  const branch = "pipeline-resume/reconstruct-error";
  const _input = mockWriteLoopInput({
    projectName: "demo",
    branchName: branch,
    localPath: worktreePath,
    projectRoot: worktreePath,
  });
  const profile = setUpLinkedResumeMachineProfile();
  try {
    const ctx = createRunControlHandlerContext({
      stateStore,
      logReader: { tail: () => [], async *follow() {} },
      writeLoopExecutor: fakeExecutor.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => memoryHeadroom,
      settleDelayMs: 0,
      writeLoopBindingSourceDeps: profile.writeLoopBindingSourceDeps,
    });
    const handlers = createRunLifecycleHandlers(ctx, {
      handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "steps unsupported in test" }),
    });
    const signal = new AbortController().signal;
    const liveRunId = stateStore.createRun({
      project: "demo",
      specRef: "main",
      worktreePath,
      branch,
      specPath: join(worktreePath, "spec.md"),
      stepId: "implement",
      status: "paused",
      workflowSnapshot: linkedWorkflowRunSnapshot(branch),
    });
    const claimed = await handlers.resume(
      { kind: "request", id: "claim", method: "resume", params: { runId: liveRunId } },
      signal,
    );
    expect(claimed.kind).toBe("response");

    const runId = stateStore.createRun({
      project: "demo",
      specRef: "main",
      worktreePath,
      branch,
      specPath: join(worktreePath, "spec.md"),
      stepId: "implement",
      status: "paused",
      workflowSnapshot: linkedWorkflowRunSnapshot(`${branch}-sibling`),
    });

    const outcome = await handlers.resumeRunForPipeline(runId, {
      pipelineId: "pipeline-1",
      stageId: "stage-1",
      branchKey: branch,
    });
    expect(outcome).toMatchObject({ kind: "refused", reason: "worktree_claimed" });
    expect(fakeExecutor.pendingCount()).toBe(1);
  } finally {
    profile.cleanup();
    fakeExecutor.abortAll();
    rmSync(worktreePath, { recursive: true, force: true });
  }
});

const IMPLEMENT_RESUME_PIPELINE: PipelineDefinition = {
  name: "implement-resume-lifecycle",
  stages: [
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

function seedGateRefusedImplementShrink(
  store: StateStore,
  invocationId: string,
): { pipelineId: string; entryRunId: string; shrinkRunId: string } {
  const snapshot: WorkflowSnapshot = {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "rules",
        expectedArtifactPath: "spec.md",
        agents: ["claude"],
        agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
        durable: true,
      },
    ],
  };
  const entryRunId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/implement-resume-entry",
    branch: "feature/implement",
    specPath: "spec/feature/index.md",
    stepId: "implement",
    status: "completed",
    workflowSnapshot: snapshot,
  });
  const shrinkRunId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: "/tmp/implement-resume-entry",
    branch: "feature/implement",
    specPath: "spec/feature/index.md",
    stepId: "implement~shrink",
    workflowSnapshot: snapshot,
  });
  const attemptId = store.recordAttemptStart(shrinkRunId);
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "gate_invocation_refused",
    terminalCause: "gate_invocation_refused",
    gateRefusalRecoveryState: { cause: "ceiling_headroom", gateCommand: "bun run test:v2", slotRedriveCount: 0 },
  });
  const pipelineId = store.createPipeline({
    definition: IMPLEMENT_RESUME_PIPELINE,
    context: { cwd: "/tmp", configPath: "/tmp/cfg", seed: "s" },
  });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    patch: { status: "failed", workflowInvocationId: entryRunId },
  });
  return { pipelineId, entryRunId, shrinkRunId };
}

test("attemptFailedImplementPipelineResume does not tail logs when logReader is unset", async () => {
  const { pipelineId } = seedGateRefusedImplementShrink(stateStore, "inv-lifecycle-no-log-reader");
  const pipeline = stateStore.loadPipeline(pipelineId);
  if (!pipeline) throw new Error("pipeline missing");
  const ctx = createRunControlHandlerContext({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
    writeLoopBindingSourceDeps,
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "steps unsupported in test" }),
  });
  const outcome = await handlers.attemptFailedImplementPipelineResume(pipeline, pipelineId, undefined);
  expect(outcome).toMatchObject({
    kind: "refused",
    pipelineId,
    reason: "resume_unsupported",
    message: expect.stringMatching(/.+/),
  });
});

test("attemptFailedImplementPipelineResume tails cause-run logs through logReader when configured", async () => {
  const tailCalls: string[] = [];
  const { pipelineId, shrinkRunId } = seedGateRefusedImplementShrink(stateStore, "inv-lifecycle-log-reader");
  const pipeline = stateStore.loadPipeline(pipelineId);
  if (!pipeline) throw new Error("pipeline missing");
  const ctx = createRunControlHandlerContext({
    stateStore,
    logReader: {
      tail: (runId) => {
        tailCalls.push(runId);
        return [];
      },
      async *follow() {},
    },
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
    writeLoopBindingSourceDeps,
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "steps unsupported in test" }),
  });
  await handlers.attemptFailedImplementPipelineResume(pipeline, pipelineId, undefined);
  expect(tailCalls).toContain(shrinkRunId);
});
