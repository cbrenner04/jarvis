import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopInput, WriteLoopOutcomeKind } from "../execution/write-loop.ts";
import type { IpcFrame } from "../ipc/types.ts";
import type { LogReader, LoopFinishedEvent } from "../persistence/log-stream.ts";
import { openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, startRunDirect } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import {
  createRunControlHandlers,
  resetWriteLoopBindingSourceDepsForTests,
  setWriteLoopBindingSourceDepsForTests,
} from "./daemon.ts";
import {
  composeRunOperatorError,
  isResumeAdmitted,
  type TerminalLogRecord,
  terminalResumeRefusalMessage,
} from "./run-operator-error.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let stateStore: StateStore;
let starts: WriteLoopInput[];
let fakeExecutor: FakeWriteLoopExecutor;
let handlers: Handlers;
let dbPath: string;
let profileHome: string;
let machinesDir: string;
let previousJarvisHome: string | undefined;
const MACHINE_PROFILE = "resume-binding-profile";

function rung(adapterModel: string): { rungs: Array<{ adapterModel: string; priceKey: string }> } {
  return { rungs: [{ adapterModel, priceKey: adapterModel }] };
}

function agentRoleBundle(implementRungs: string[]) {
  return {
    plan: rung("plan"),
    implement: { rungs: implementRungs.map((adapterModel) => ({ adapterModel, priceKey: adapterModel })) },
    shrink: rung("shrink"),
    adversary: rung("adv"),
    critic: rung("crit"),
    advocate: rung("advoc"),
    adjudicator: rung("adj"),
    actuator: rung("act"),
  };
}

function defaultResumeProfileModels(implementRungs: string[]): AgentModelConfig {
  return {
    codex: agentRoleBundle(implementRungs),
    cursor: agentRoleBundle(["cursor-fast"]),
  };
}

function writeResumeProfile(implementRungs: string[]): void {
  writeFileSync(
    join(machinesDir, `${MACHINE_PROFILE}.json`),
    JSON.stringify({ models: defaultResumeProfileModels(implementRungs) }),
    "utf-8",
  );
}

function installResumeProfile(implementRungs: string[]): void {
  mkdirSync(machinesDir, { recursive: true });
  writeResumeProfile(implementRungs);
  writeFileSync(
    join(profileHome, "config.json"),
    JSON.stringify({ machineProfile: MACHINE_PROFILE, agents: ["codex"] }),
    "utf-8",
  );
  setWriteLoopBindingSourceDepsForTests({
    machineConfigPath: join(profileHome, "config.json"),
    machinesDir,
  });
}

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-state-resume-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(dbPath);
  starts = [];
  fakeExecutor = createFakeWriteLoopExecutor((input) => {
    starts.push(input);
  });
  profileHome = mkdtempSync(join(tmpdir(), "jarvis-resume-profile-home-"));
  machinesDir = join(profileHome, "machines");
  previousJarvisHome = process.env.JARVIS_HOME;
  process.env.JARVIS_HOME = profileHome;
  installResumeProfile(["codex-fast", "codex-deep"]);
  handlers = createHandlers();
});

afterEach(async () => {
  fakeExecutor.abortAll();
  await flushBackgroundRuns();
  resetWriteLoopBindingSourceDepsForTests();
  if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
  else process.env.JARVIS_HOME = previousJarvisHome;
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
  rmSync(dbPath, { force: true });
  rmSync(profileHome, { recursive: true, force: true });
});

function createHandlers(logReader?: LogReader): Handlers {
  return createRunControlHandlers({
    stateStore,
    ...(logReader !== undefined ? { logReader } : {}),
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
}

function loopFinishedLogReader(runId: string, event: Omit<LoopFinishedEvent, "kind">): LogReader {
  return {
    tail: () => [
      {
        runId,
        seq: 1,
        ts: "2026-01-01T00:00:00.000Z",
        event: { kind: "loop_finished", ...event },
      },
    ],
    async *follow() {},
  };
}

function runExecutionFailedLogReader(runId: string, message: string): LogReader {
  return {
    tail: () => [
      {
        runId,
        seq: 1,
        ts: "2026-01-01T00:00:00.000Z",
        event: { kind: "run_execution_failed", message },
      },
    ],
    async *follow() {},
  };
}

const AGENT_MODEL_CONFIG: AgentModelConfig = {
  codex: {
    implement: {
      rungs: [
        { adapterModel: "codex-fast", priceKey: "codex-fast" },
        { adapterModel: "codex-deep", priceKey: "codex-deep" },
      ],
    },
  },
  cursor: {
    implement: {
      rungs: [{ adapterModel: "cursor-fast", priceKey: "cursor-fast" }],
    },
  },
};

function resumeFrame(runId: string): IpcFrame & { kind: "request" } {
  return {
    kind: "request",
    id: "r1",
    method: "resume",
    params: { runId },
  };
}

async function resumeDirect(h: Handlers, runId: string) {
  return h.resume(resumeFrame(runId), new AbortController().signal);
}

function createWorkflowRun(overrides: {
  invocationId: string;
  role?: string;
  agents?: readonly string[];
  iterationTimeoutMs?: number;
  iterationCeilingMs?: number;
  stepRules?: string;
}): string {
  return stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
    stepId: "step-1",
    workflowSnapshot: {
      invocationId: overrides.invocationId,
      steps: [
        {
          stepId: "step-1",
          role: overrides.role ?? "implement",
          stepRules: overrides.stepRules ?? "resume rules",
          expectedArtifactPath: "/tmp/test-project/artifact",
          agents: overrides.agents ?? ["codex"],
          agentModelConfig: AGENT_MODEL_CONFIG,
          ...(overrides.iterationTimeoutMs !== undefined ? { iterationTimeoutMs: overrides.iterationTimeoutMs } : {}),
          ...(overrides.iterationCeilingMs !== undefined ? { iterationCeilingMs: overrides.iterationCeilingMs } : {}),
        },
      ],
    },
  });
}

test("resume rejects unknown run ID", async () => {
  const response = await resumeDirect(handlers, "unknown-id");
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("unknown_run");
  }
});

test("resume rejects terminal run status", async () => {
  const runId = await startRunDirect(handlers);
  if (!runId) return;

  fakeExecutor.settleAll();
  await flushBackgroundRuns();
  stateStore.setRunStatus(runId, "completed");

  const response = await resumeDirect(handlers, runId);
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("terminal_run");
    expect(response.message).toContain("Cannot resume a completed run");
    expect(response.message).toContain("inspect jarvis run log");
  }
});

test("resume refusal on ready_flip_failed names manual PR-flip recovery", async () => {
  const runId = createWorkflowRun({ invocationId: "ready-flip-terminal" });
  stateStore.setRunStatus(runId, "completed");
  const logReader = loopFinishedLogReader(runId, {
    loopOutcomeKind: "ready_flip_failed",
    iterationsConsumed: 1,
    resumable: false,
  });

  const response = await resumeDirect(createHandlers(logReader), runId);
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("terminal_run");
    expect(response.message).toContain("gh pr view");
    expect(response.message).toContain("isDraft");
  }
});

test("resume refusal on agent_blocked names spec inspection recovery", async () => {
  const runId = createWorkflowRun({ invocationId: "agent-blocked-terminal" });
  stateStore.setRunStatus(runId, "blocked");
  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({
    attemptId,
    runStatus: "blocked",
    outcomeKind: "blocked",
  });

  const response = await resumeDirect(handlers, runId);
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("terminal_run");
    expect(response.message).toContain("inspect the spec");
  }
});

test("resume retries a completed run after a resumable publication failure", async () => {
  const runId = createWorkflowRun({ invocationId: "publication-retry" });
  stateStore.setRunStatus(runId, "completed");
  const logReader = loopFinishedLogReader(runId, {
    loopOutcomeKind: "completion_commit_failed",
    iterationsConsumed: 1,
    resumable: true,
  });
  const localHandlers = createHandlers(logReader);

  expect((await resumeDirect(localHandlers, runId)).kind).toBe("response");
  expect(fakeExecutor.pendingCount()).toBe(1);
});

test("resume retries a failed run after surviving mutation verification", async () => {
  const runId = createWorkflowRun({ invocationId: "surviving-mutation-retry" });
  stateStore.setRunStatus(runId, "failed");
  const logReader = loopFinishedLogReader(runId, {
    loopOutcomeKind: "surviving_mutation_failed",
    iterationsConsumed: 3,
    resumable: true,
    survivingMutation: "operator-flip: === → !==",
    survivingMutationSourceFile: "src/guard.ts",
    survivingMutationSourceLine: 17,
  });
  const localHandlers = createHandlers(logReader);

  expect((await resumeDirect(localHandlers, runId)).kind).toBe("response");
  expect(fakeExecutor.pendingCount()).toBe(1);
});

test("resume on an ad-hoc paused run returns resume_unsupported without invoking the executor", async () => {
  const pausedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  const response = await resumeDirect(handlers, pausedRunId);

  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("resume_unsupported");
  }

  expect(starts).toHaveLength(0);
  expect(stateStore.loadRun(pausedRunId)?.status).toBe("paused");
});

test("resume on a workflow paused run respawns with resolved bindings", async () => {
  const pausedRunId = createWorkflowRun({
    invocationId: "workflow-1",
    agents: ["codex", "cursor"],
    iterationTimeoutMs: 123,
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  const response = await resumeDirect(handlers, pausedRunId);

  expect(response).toEqual({ kind: "response", result: { ok: true } });
  expect(starts).toHaveLength(1);
  expect(starts[0]?.bindings.map((binding) => binding.id)).toEqual([
    "codex/codex-fast/codex-fast",
    "codex/codex-deep/codex-deep",
    "cursor/cursor-fast/cursor-fast",
  ]);
  expect(starts[0]?.stepRules).toBe("resume rules");
  expect(starts[0]?.stepId).toBe("step-1");
  expect(starts[0]?.iterationTimeoutMs).toBe(123);
});

test("resume resolves iterationCeilingMs when snapshot step has wall segment only", async () => {
  const isolatedHome = mkdtempSync(join(tmpdir(), "jarvis-resume-ceiling-"));
  const isolatedMachines = join(isolatedHome, "machines");
  const previousHome = process.env.JARVIS_HOME;
  process.env.JARVIS_HOME = isolatedHome;
  mkdirSync(isolatedMachines, { recursive: true });
  writeFileSync(
    join(isolatedMachines, `${MACHINE_PROFILE}.json`),
    JSON.stringify({ models: defaultResumeProfileModels(["codex-fast", "codex-deep"]) }),
  );
  writeFileSync(
    join(isolatedHome, "config.json"),
    JSON.stringify({ machineProfile: MACHINE_PROFILE, agents: ["codex"], iterationCeilingMs: 2_222_222 }),
  );
  setWriteLoopBindingSourceDepsForTests({
    machineConfigPath: join(isolatedHome, "config.json"),
    machinesDir: isolatedMachines,
  });

  try {
    const pausedRunId = createWorkflowRun({
      invocationId: "legacy-wall-only",
      iterationTimeoutMs: 123,
    });
    stateStore.setRunStatus(pausedRunId, "paused");

    const response = await resumeDirect(handlers, pausedRunId);

    expect(response).toEqual({ kind: "response", result: { ok: true } });
    expect(starts[0]?.iterationTimeoutMs).toBe(123);
    expect(starts[0]?.iterationCeilingMs).toBe(2_222_222);
  } finally {
    if (previousHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousHome;
    rmSync(isolatedHome, { recursive: true, force: true });
  }
});

test("resume keeps persisted iterationCeilingMs on snapshot steps", async () => {
  const isolatedHome = mkdtempSync(join(tmpdir(), "jarvis-resume-ceiling-persisted-"));
  const isolatedMachines = join(isolatedHome, "machines");
  const previousHome = process.env.JARVIS_HOME;
  process.env.JARVIS_HOME = isolatedHome;
  mkdirSync(isolatedMachines, { recursive: true });
  writeFileSync(
    join(isolatedMachines, `${MACHINE_PROFILE}.json`),
    JSON.stringify({ models: defaultResumeProfileModels(["codex-fast", "codex-deep"]) }),
  );
  writeFileSync(
    join(isolatedHome, "config.json"),
    JSON.stringify({ machineProfile: MACHINE_PROFILE, agents: ["codex"], iterationCeilingMs: 9_999_999 }),
  );
  setWriteLoopBindingSourceDepsForTests({
    machineConfigPath: join(isolatedHome, "config.json"),
    machinesDir: isolatedMachines,
  });

  try {
    const pausedRunId = createWorkflowRun({
      invocationId: "both-bounds",
      iterationTimeoutMs: 123,
      iterationCeilingMs: 456,
    });
    stateStore.setRunStatus(pausedRunId, "paused");

    const response = await resumeDirect(handlers, pausedRunId);

    expect(response).toEqual({ kind: "response", result: { ok: true } });
    expect(starts[0]?.iterationCeilingMs).toBe(456);
  } finally {
    if (previousHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousHome;
    rmSync(isolatedHome, { recursive: true, force: true });
  }
});

test("resume re-resolves write bindings from the current machine profile after a rung edit", async () => {
  const runId = createWorkflowRun({
    invocationId: "workflow-rung-edit",
    agents: ["codex"],
  });
  stateStore.setRunStatus(runId, "killed");

  writeResumeProfile(["codex-new-rung"]);

  const response = await resumeDirect(handlers, runId);

  expect(response).toEqual({ kind: "response", result: { ok: true } });
  expect(starts[0]?.bindings.map((binding) => binding.id)).toEqual(["codex/codex-new-rung/codex-new-rung"]);
});

test("resume on a killed workflow write run uses the persisted step contract", async () => {
  const runId = createWorkflowRun({
    invocationId: "workflow-killed",
    stepRules: "persisted rules",
    iterationTimeoutMs: 456,
  });
  stateStore.setRunStatus(runId, "killed");

  const response = await resumeDirect(handlers, runId);

  expect(response).toEqual({ kind: "response", result: { ok: true } });
  expect(starts).toHaveLength(1);
  expect(starts[0]).toMatchObject({
    stepRules: "persisted rules",
    expectedArtifactPath: "/tmp/test-project/artifact",
    stepId: "step-1",
    iterationTimeoutMs: 456,
    workflowSnapshot: {
      invocationId: "workflow-killed",
    },
  });
  expect(starts[0]?.bindings.map((binding) => binding.id)).toEqual([
    "codex/codex-fast/codex-fast",
    "codex/codex-deep/codex-deep",
  ]);
});

test("resume on a workflow paused run with an empty agents list returns resume_unsupported", async () => {
  const pausedRunId = createWorkflowRun({ invocationId: "workflow-1", agents: [] });
  stateStore.setRunStatus(pausedRunId, "paused");

  const response = await resumeDirect(handlers, pausedRunId);

  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("resume_unsupported");
  }
  expect(starts).toHaveLength(0);
});

test("resume on a workflow paused run with a non-executable role returns a controlled error", async () => {
  const pausedRunId = createWorkflowRun({ invocationId: "workflow-1", role: "review" });
  stateStore.setRunStatus(pausedRunId, "paused");

  const response = await resumeDirect(handlers, pausedRunId);

  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("resume_unsupported");
  }
  expect(starts).toHaveLength(0);
  expect(stateStore.loadRun(pausedRunId)?.status).toBe("paused");
});

test("resume rejects an unsupported paused run before checking another in-flight run", async () => {
  await startRunDirect(handlers);

  const pausedRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/other-worktree",
    branch: "other-branch",
    specPath: "/tmp/test-project/spec.md",
  });
  stateStore.setRunStatus(pausedRunId, "paused");

  const response = await resumeDirect(handlers, pausedRunId);
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("resume_unsupported");
  }
});

test("resume rejects worktree_claimed when the (project, branch) is already live", async () => {
  await startRunDirect(handlers);

  const pausedRunId = createWorkflowRun({ invocationId: "claimed-resume" });
  stateStore.setRunStatus(pausedRunId, "paused");

  const response = await resumeDirect(handlers, pausedRunId);
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("worktree_claimed");
  }
});

test("resume retries a failed run after a landing failure", async () => {
  const runId = createWorkflowRun({ invocationId: "landing-failure-retry" });
  stateStore.setRunStatus(runId, "failed");
  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: "landing failed" },
  });
  const logReader = loopFinishedLogReader(runId, {
    loopOutcomeKind: "invocation_failure",
    iterationsConsumed: 0,
    resumable: true,
  });
  const localHandlers = createHandlers(logReader);

  expect((await resumeDirect(localHandlers, runId)).kind).toBe("response");
  expect(fakeExecutor.pendingCount()).toBe(1);
});

test("resume admits ready_gate_failed when repair attempt ended blocked", async () => {
  const runId = createWorkflowRun({ invocationId: "ready-gate-blocked-repair" });
  stateStore.setRunStatus(runId, "failed");
  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "blocked",
  });
  const logReader = loopFinishedLogReader(runId, {
    loopOutcomeKind: "ready_gate_failed",
    iterationsConsumed: 1,
    resumable: true,
  });
  const localHandlers = createHandlers(logReader);
  expect((await resumeDirect(localHandlers, runId)).kind).toBe("response");
  expect(fakeExecutor.pendingCount()).toBe(1);
});

test("resume rejects terminal run status without landing failure", async () => {
  const runId = createWorkflowRun({ invocationId: "no-landing-failure" });
  stateStore.setRunStatus(runId, "failed");
  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message: "some error" },
  });
  const logReader = loopFinishedLogReader(runId, {
    loopOutcomeKind: "invocation_failure",
    iterationsConsumed: 0,
    resumable: true,
  });
  const localHandlers = createHandlers(logReader);

  const response = await resumeDirect(localHandlers, runId);
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("terminal_run");
  }
});

test("resume after post-boundary store lock timeout keeps committed write boundary", async () => {
  const runId = createWorkflowRun({ invocationId: "store-lock-resume" });
  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "completed", outcomeKind: "done" });
  stateStore.setRunStatus(runId, "failed");
  const logReader = runExecutionFailedLogReader(runId, "database is locked");
  const localHandlers = createHandlers(logReader);
  expect((await resumeDirect(localHandlers, runId)).kind).toBe("response");
  expect(fakeExecutor.pendingCount()).toBe(1);
  fakeExecutor.settleAll();
  await flushBackgroundRuns();
  expect(stateStore.loadRun(runId)?.attempts.some((attempt) => attempt.outcomeKind === "done")).toBe(true);
});

// Guard: every reason that composes nextAction: "resume" is admitted by resume.
test.each([
  { invocationId: "paused", status: "paused" as const, logOutcome: undefined },
  { invocationId: "budget-soft-stopped", status: "budget-soft-stopped" as const, logOutcome: undefined },
  { invocationId: "killed", status: "killed" as const, logOutcome: undefined },
  {
    invocationId: "iteration-commit-failed",
    status: "failed" as const,
    logOutcome: "iteration_commit_failed" as const,
  },
  {
    invocationId: "completion-commit-failed",
    status: "completed" as const,
    logOutcome: "completion_commit_failed" as const,
  },
  { invocationId: "ready-gate-failed", status: "completed" as const, logOutcome: "ready_gate_failed" as const },
  {
    invocationId: "surviving-mutation",
    status: "failed" as const,
    logOutcome: "surviving_mutation_failed" as const,
    withLog: true,
  },
  {
    invocationId: "landing-failed",
    status: "failed" as const,
    logOutcome: "invocation_failure" as const,
    withLanding: true,
  },
  { invocationId: "invalid-token", status: "failed" as const, logOutcome: undefined, withInvalidToken: true },
  { invocationId: "missing-blocker", status: "blocked" as const, logOutcome: undefined, withMissingBlocker: true },
  {
    invocationId: "store-lock-timeout",
    status: "failed" as const,
    logOutcome: undefined,
    withStoreLockFailure: true,
  },
] as const)("resume admits $invocationId reason (composes nextAction: resume)", async (config) => {
  const runId = createWorkflowRun({ invocationId: config.invocationId });
  stateStore.setRunStatus(runId, config.status);

  let logReader: LogReader | undefined;
  if (config.withLanding) {
    const attemptId = stateStore.recordAttemptStart(runId);
    stateStore.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: "invocation_failure",
      invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: "landing failed" },
    });
    logReader = loopFinishedLogReader(runId, {
      loopOutcomeKind: "invocation_failure",
      iterationsConsumed: 1,
      resumable: true,
    });
  } else if (config.withInvalidToken) {
    const attemptId = stateStore.recordAttemptStart(runId);
    stateStore.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: "invalid_token",
    });
  } else if (config.withMissingBlocker) {
    const attemptId = stateStore.recordAttemptStart(runId);
    stateStore.commitCompletionBoundary({
      attemptId,
      runStatus: "blocked",
      outcomeKind: "missing_blocker",
    });
  } else if ("withStoreLockFailure" in config && config.withStoreLockFailure) {
    const attemptId = stateStore.recordAttemptStart(runId);
    stateStore.commitCompletionBoundary({
      attemptId,
      runStatus: "completed",
      outcomeKind: "done",
    });
    logReader = runExecutionFailedLogReader(runId, "database is locked");
  } else if (config.logOutcome !== undefined) {
    const loopEvent: Omit<LoopFinishedEvent, "kind"> & {
      survivingMutation?: string;
      survivingMutationSourceFile?: string;
      survivingMutationSourceLine?: number;
    } = {
      loopOutcomeKind: config.logOutcome,
      iterationsConsumed: 1,
      resumable: true,
    };
    if (config.withLog && config.logOutcome === "surviving_mutation_failed") {
      loopEvent.survivingMutation = "op";
      loopEvent.survivingMutationSourceFile = "src/test.ts";
      loopEvent.survivingMutationSourceLine = 1;
    }
    logReader = loopFinishedLogReader(runId, loopEvent as Omit<LoopFinishedEvent, "kind">);
  }

  const run = stateStore.loadRun(runId);
  expect(run).toBeDefined();
  if (run) {
    // Verify that composeRunOperatorError produces nextAction: "resume"
    const terminalRecord = logReader
      ? logReader.tail(runId).find((r) => r.event.kind === "loop_finished" || r.event.kind === "run_execution_failed")
      : undefined;
    const error = composeRunOperatorError(run, terminalRecord as TerminalLogRecord | undefined);
    expect(error?.nextAction).toBe("resume");

    // Verify that resume does not refuse terminal_run
    const localHandlers = createHandlers(logReader);
    const response = await resumeDirect(localHandlers, runId);
    expect(response.kind).not.toBe("error");
    if (response.kind === "error") {
      expect(response.code).not.toBe("terminal_run");
    }
  }
});

/** Mirrors `WRITE_LOOP_OUTCOME_KINDS` in `v2/src/execution/write-loop.ts`. */
const WRITE_LOOP_OUTCOME_KINDS = [
  "complete",
  "progress",
  "blocked",
  "contract_miss",
  "invocation_failure",
  "iteration_timeout",
  "budget-exhausted",
  "paused",
  "completion_commit_failed",
  "iteration_commit_failed",
  "ready_gate_failed",
  "ready_flip_failed",
  "surviving_mutation_failed",
  "runtime_smoke_failed",
] as const satisfies readonly WriteLoopOutcomeKind[];

type ResumableAgreementCase = {
  loopOutcomeKind: WriteLoopOutcomeKind;
  status: RunStatus;
  prepare?: (runId: string) => void;
  loopExtra?: Omit<LoopFinishedEvent, "kind" | "loopOutcomeKind" | "iterationsConsumed" | "resumable">;
};

function durableStatusesForLoopOutcome(loopOutcomeKind: WriteLoopOutcomeKind): RunStatus[] {
  switch (loopOutcomeKind) {
    case "budget-exhausted":
      return ["budget-soft-stopped", "failed"];
    case "paused":
      return ["paused", "failed"];
    case "ready_gate_failed":
      return ["completed", "failed"];
    default:
      return [defaultStatusForLoopOutcome(loopOutcomeKind)];
  }
}

function defaultStatusForLoopOutcome(loopOutcomeKind: WriteLoopOutcomeKind): RunStatus {
  switch (loopOutcomeKind) {
    case "complete":
    case "completion_commit_failed":
    case "ready_flip_failed":
      return "completed";
    case "blocked":
    case "contract_miss":
      return "blocked";
    case "budget-exhausted":
      return "budget-soft-stopped";
    case "paused":
      return "paused";
    default:
      return "failed";
  }
}

const RESUMABLE_AGREEMENT_CASES: ResumableAgreementCase[] = WRITE_LOOP_OUTCOME_KINDS.flatMap((loopOutcomeKind) =>
  durableStatusesForLoopOutcome(loopOutcomeKind).map((status) => ({
    loopOutcomeKind,
    status,
    ...(loopOutcomeKind === "ready_gate_failed" && status === "failed"
      ? {
          prepare: (runId: string) => {
            const attemptId = stateStore.recordAttemptStart(runId);
            stateStore.commitCompletionBoundary({
              attemptId,
              runStatus: "failed",
              outcomeKind: "blocked",
            });
          },
        }
      : {}),
    ...(loopOutcomeKind === "surviving_mutation_failed"
      ? {
          loopExtra: {
            survivingMutation: "op",
            survivingMutationSourceFile: "src/guard.ts",
            survivingMutationSourceLine: 1,
          },
        }
      : {}),
  })),
);

async function waitResumable(h: Handlers, runId: string): Promise<boolean | undefined> {
  const frame = await h.wait(
    { kind: "request", id: "wait-agreement", method: "wait", params: { runId } },
    new AbortController().signal,
  );
  expect(frame.kind).toBe("response");
  if (frame.kind !== "response") throw new Error("not a response");
  return (frame.result as { resumable?: boolean }).resumable;
}

async function listResumable(h: Handlers, runId: string): Promise<boolean | undefined> {
  const frame = await h.list({ kind: "request", id: "list-agreement", method: "list" }, new AbortController().signal);
  expect(frame.kind).toBe("response");
  if (frame.kind !== "response") throw new Error("not a response");
  const runs = (frame.result as { runs: Array<{ runId: string; resumable?: boolean }> }).runs;
  return runs.find((row) => row.runId === runId)?.resumable;
}

function resumeRefusedTerminal(response: Awaited<ReturnType<Handlers["resume"]>>): boolean {
  return response.kind === "error" && response.code === "terminal_run";
}

test.each(
  RESUMABLE_AGREEMENT_CASES,
)("wait and list resumable agrees with resume admission ($loopOutcomeKind on $status)", async ({
  loopOutcomeKind,
  status,
  prepare,
  loopExtra,
}) => {
  const runId = createWorkflowRun({ invocationId: `agreement-${loopOutcomeKind}-${status}` });
  stateStore.setRunStatus(runId, status);
  prepare?.(runId);
  const logReader = loopFinishedLogReader(runId, {
    loopOutcomeKind,
    iterationsConsumed: 1,
    resumable: true,
    ...loopExtra,
  });
  const localHandlers = createHandlers(logReader);
  const run = stateStore.loadRun(runId);
  expect(run).toBeDefined();
  if (!run) return;
  const terminalRecord = logReader.tail(runId)[0] as TerminalLogRecord;
  const admitted = isResumeAdmitted(run, terminalRecord);

  const waitRow = await waitResumable(localHandlers, runId);
  const listRow = await listResumable(localHandlers, runId);
  expect(waitRow).toBe(admitted);
  expect(listRow).toBe(admitted);

  const resumeResponse = await resumeDirect(localHandlers, runId);
  if (admitted) {
    expect(resumeRefusedTerminal(resumeResponse)).toBe(false);
  } else {
    expect(resumeRefusedTerminal(resumeResponse)).toBe(true);
  }
});

test("terminal resume refusal message guard inversion", () => {
  const pausedRunId = createWorkflowRun({ invocationId: "refusal-guard-paused" });
  stateStore.setRunStatus(pausedRunId, "paused");
  const run = stateStore.loadRun(pausedRunId);
  expect(run).toBeDefined();
  if (!run) return;
  expect(isResumeAdmitted(run)).toBe(true);
  expect(terminalResumeRefusalMessage(run)).toBeUndefined();
});

test("resumable admission projection guard inversion", () => {
  for (const loopOutcomeKind of ["paused", "budget-exhausted"] as const) {
    const runId = createWorkflowRun({ invocationId: `stale-${loopOutcomeKind}` });
    stateStore.setRunStatus(runId, "failed");
    const logReader = loopFinishedLogReader(runId, {
      loopOutcomeKind,
      iterationsConsumed: 1,
      resumable: true,
    });
    const run = stateStore.loadRun(runId);
    expect(run).toBeDefined();
    if (!run) continue;
    const terminalRecord = logReader.tail(runId)[0] as TerminalLogRecord;
    expect(isResumeAdmitted(run, terminalRecord)).toBe(false);
    expect(terminalRecord.event.kind === "loop_finished" && terminalRecord.event.resumable).toBe(true);
  }
});

test("failed row with stale paused or budget-exhausted loop_finished reports resumable false on wait and list", async () => {
  for (const loopOutcomeKind of ["paused", "budget-exhausted"] as const) {
    const runId = createWorkflowRun({ invocationId: `stale-row-${loopOutcomeKind}` });
    stateStore.setRunStatus(runId, "failed");
    const logReader = loopFinishedLogReader(runId, {
      loopOutcomeKind,
      iterationsConsumed: 1,
      resumable: true,
    });
    const localHandlers = createHandlers(logReader);
    expect(await waitResumable(localHandlers, runId)).toBe(false);
    expect(await listResumable(localHandlers, runId)).toBe(false);
  }
});

test("wait and list resumable agrees for non-entry workflow step row", async () => {
  const invocationId = "agreement-non-entry-step";
  const workflowSnapshot = {
    invocationId,
    steps: [
      {
        stepId: "step-1",
        role: "implement",
        stepRules: "resume rules",
        expectedArtifactPath: "/tmp/test-project/artifact",
        agents: ["codex"] as const,
        agentModelConfig: AGENT_MODEL_CONFIG,
      },
      {
        stepId: "step-2",
        role: "implement",
        stepRules: "resume rules",
        expectedArtifactPath: "/tmp/test-project/artifact-2",
        agents: ["codex"] as const,
        agentModelConfig: AGENT_MODEL_CONFIG,
      },
    ],
  };
  const baseRun = {
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project-worktree",
    branch: "test-branch",
    specPath: "/tmp/test-project/spec.md",
    workflowSnapshot,
  };
  const entryRunId = stateStore.createRun({ ...baseRun, stepId: "step-1" });
  const step2RunId = stateStore.createRun({ ...baseRun, stepId: "step-2" });
  stateStore.setRunStatus(entryRunId, "completed");
  stateStore.setRunStatus(step2RunId, "failed");
  const attemptId = stateStore.recordAttemptStart(step2RunId);
  stateStore.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "blocked",
  });
  const logReader = loopFinishedLogReader(step2RunId, {
    loopOutcomeKind: "ready_gate_failed",
    iterationsConsumed: 1,
    resumable: true,
  });
  const localHandlers = createHandlers(logReader);
  const run = stateStore.loadRun(step2RunId);
  expect(run).toBeDefined();
  if (!run) return;
  const terminalRecord = logReader.tail(step2RunId)[0] as TerminalLogRecord;
  const admitted = isResumeAdmitted(run, terminalRecord);
  expect(await waitResumable(localHandlers, step2RunId)).toBe(admitted);
  expect(await listResumable(localHandlers, step2RunId)).toBe(admitted);
});

/**
 * Fixture for a reviewed-intent finalization: a durable write step row (carrying `durableDir` as
 * its own `specPath`) plus its sibling review-behavior row — the only two rows daemon resume needs
 * to reconstruct {@link resolveIntentFinalizationResumeContext}'s context.
 */
function createIntentFinalizationRuns(overrides: {
  invocationId: string;
  worktreePath: string;
  branch: string;
  durableDir: string;
}): { writeRunId: string; reviewRunId: string } {
  const workflowSnapshot = {
    invocationId: overrides.invocationId,
    creationTitle: "intent: example",
    steps: [
      {
        stepId: "intent",
        role: "plan",
        durable: true,
        stepRules: "intent rules",
        expectedArtifactPath: ".jarvis-intent-stage",
        agents: ["codex"],
        agentModelConfig: AGENT_MODEL_CONFIG,
      },
      { stepId: "review", role: "", durable: true, behavior: "review" as const },
    ],
  };
  const base = {
    project: "test-project",
    specRef: "main",
    worktreePath: overrides.worktreePath,
    branch: overrides.branch,
    workflowSnapshot,
  };
  const writeRunId = stateStore.createRun({ ...base, specPath: overrides.durableDir, stepId: "intent" });
  stateStore.setRunStatus(writeRunId, "completed");
  const reviewRunId = stateStore.createRun({ ...base, specPath: ".jarvis-intent-stage", stepId: "review" });
  return { writeRunId, reviewRunId };
}

function failReviewRunAtLanding(runId: string): void {
  stateStore.setRunStatus(runId, "failed");
  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: "landing failed" },
  });
}

function landingFailedLogReader(runId: string): LogReader {
  return loopFinishedLogReader(runId, {
    loopOutcomeKind: "invocation_failure",
    iterationsConsumed: 0,
    resumable: true,
  });
}

async function listRow(h: Handlers, runId: string): Promise<{ error?: { reason?: string; nextAction?: string } }> {
  const frame = await h.list({ kind: "request", id: "list-intent", method: "list" }, new AbortController().signal);
  expect(frame.kind).toBe("response");
  if (frame.kind !== "response") throw new Error("not a response");
  const runs = (frame.result as { runs: Array<{ runId: string; error?: { reason?: string; nextAction?: string } }> })
    .runs;
  const row = runs.find((candidate) => candidate.runId === runId);
  if (!row) throw new Error(`row ${runId} not found`);
  return row;
}

test("admits a populated-stage intent finalization landing_failed row instead of unsupported_resume_context", async () => {
  const worktreePath = mkdtempSync(join(tmpdir(), "daemon-intent-finalize-"));
  try {
    mkdirSync(join(worktreePath, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(join(worktreePath, ".jarvis-intent-stage", "example.md"), "content\n", "utf8");
    mkdirSync(join(worktreePath, "ready-intents"), { recursive: true });

    const { reviewRunId } = createIntentFinalizationRuns({
      invocationId: "intent-finalize-admission",
      worktreePath,
      branch: "intent/example",
      durableDir: "ready-intents",
    });
    failReviewRunAtLanding(reviewRunId);
    const localHandlers = createHandlers(landingFailedLogReader(reviewRunId));

    const row = await listRow(localHandlers, reviewRunId);
    expect(row.error?.reason).toBe("landing_failed");
    expect(row.error?.nextAction).toBe("resume");
    expect(await listResumable(localHandlers, reviewRunId)).toBe(true);

    const response = await resumeDirect(localHandlers, reviewRunId);
    if (response.kind === "error") {
      expect(response.code).not.toBe("resume_unsupported");
      expect(response.code).not.toBe("terminal_run");
    }
  } finally {
    rmSync(worktreePath, { recursive: true, force: true });
  }
});

test("rejects unsupported_resume_context for the same row when the stage is empty (admission-gate inversion)", async () => {
  const worktreePath = mkdtempSync(join(tmpdir(), "daemon-intent-finalize-empty-"));
  try {
    // No `.jarvis-intent-stage/` created: inverts the populated-stage precondition the gate requires.
    mkdirSync(join(worktreePath, "ready-intents"), { recursive: true });

    const { reviewRunId } = createIntentFinalizationRuns({
      invocationId: "intent-finalize-empty-stage",
      worktreePath,
      branch: "intent/empty",
      durableDir: "ready-intents",
    });
    failReviewRunAtLanding(reviewRunId);
    const localHandlers = createHandlers(landingFailedLogReader(reviewRunId));

    const row = await listRow(localHandlers, reviewRunId);
    expect(row.error?.reason).toBe("unsupported_resume_context");
    expect(row.error?.nextAction).toBe("stop");

    const response = await resumeDirect(localHandlers, reviewRunId);
    expect(response.kind).toBe("error");
    if (response.kind === "error") {
      expect(response.code).toBe("resume_unsupported");
    }
  } finally {
    rmSync(worktreePath, { recursive: true, force: true });
  }
});

test("resumes a populated-stage intent finalization end to end: landing_failed projects resumable, completed after republication", async () => {
  const worktreePath = mkdtempSync(join(tmpdir(), "daemon-intent-finalize-e2e-"));
  try {
    mkdirSync(join(worktreePath, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(
      join(worktreePath, ".jarvis-intent-stage", "example.md"),
      "---\nname: example\n---\n\n## Prerequisites\n",
      "utf8",
    );
    mkdirSync(join(worktreePath, "ready-intents"), { recursive: true });

    const { reviewRunId } = createIntentFinalizationRuns({
      invocationId: "intent-finalize-e2e",
      worktreePath,
      branch: "intent/e2e",
      durableDir: "ready-intents",
    });
    failReviewRunAtLanding(reviewRunId);
    const logReader = landingFailedLogReader(reviewRunId);
    const localHandlers = createRunControlHandlers({
      stateStore,
      logReader,
      writeLoopExecutor: fakeExecutor.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      settleDelayMs: 0,
      intentFinalizationResumeDeps: {
        completionCommitter: async () => ({ commitSha: "deadbeef", filesChanged: 1 }),
        completionPublisher: async () => ({ pushSha: "deadbeef", prNumber: 7, prUrl: "https://example.test/pr/7" }),
        readyFinalizer: async () => undefined,
      },
    });

    expect(await waitResumable(localHandlers, reviewRunId)).toBe(true);
    expect(await listResumable(localHandlers, reviewRunId)).toBe(true);

    const response = await resumeDirect(localHandlers, reviewRunId);
    expect(response.kind).toBe("response");

    const settled = stateStore.loadRun(reviewRunId);
    expect(settled?.status).toBe("completed");
    expect(fakeExecutor.pendingCount()).toBe(0);
  } finally {
    rmSync(worktreePath, { recursive: true, force: true });
  }
});
