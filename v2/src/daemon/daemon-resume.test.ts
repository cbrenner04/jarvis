import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import type { IpcFrame } from "../ipc/types.ts";
import type { LogReader, LoopFinishedEvent } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, startRunDirect } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
import { composeRunOperatorError, type TerminalLogRecord } from "./run-operator-error.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let stateStore: StateStore;
let starts: WriteLoopInput[];
let fakeExecutor: FakeWriteLoopExecutor;
let handlers: Handlers;
let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-state-resume-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(dbPath);
  starts = [];
  fakeExecutor = createFakeWriteLoopExecutor((input) => {
    starts.push(input);
  });
  handlers = createHandlers();
});

afterEach(async () => {
  fakeExecutor.abortAll();
  await flushBackgroundRuns();
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
  rmSync(dbPath, { force: true });
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
    expect(response.message).toBe("Cannot resume a completed run");
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

// Guard: every reason that composes nextAction: "resume" is admitted by resume.
test.each([
  { invocationId: "paused", status: "paused" as const, logOutcome: undefined },
  { invocationId: "budget-soft-stopped", status: "budget-soft-stopped" as const, logOutcome: undefined },
  { invocationId: "killed", status: "killed" as const, logOutcome: undefined },
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
