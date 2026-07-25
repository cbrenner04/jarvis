import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { WRITE_LOOP_OUTCOME_KINDS, type WriteLoopInput, type WriteLoopOutcomeKind } from "../execution/write-loop.ts";
import type { IpcFrame } from "../ipc/types.ts";
import type { LogReader, LoopFinishedEvent } from "../persistence/log-stream.ts";
import { openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, startRunDirect } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
import {
  composeRunOperatorError,
  isResumeAdmitted,
  terminalResumeRefusalMessage,
  type TerminalLogRecord,
} from "./run-operator-error.ts";

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
    expect(response.message).toBe("Cannot resume a completed run");
  }
});

test("resume refusal on a ready_flip_failed row names the documented manual PR-flip fix", async () => {
  const runId = createWorkflowRun({ invocationId: "ready-flip-failed-refusal" });
  stateStore.setRunStatus(runId, "completed");
  const logReader = loopFinishedLogReader(runId, {
    loopOutcomeKind: "ready_flip_failed",
    iterationsConsumed: 1,
    resumable: false,
  });
  const localHandlers = createHandlers(logReader);

  const response = await resumeDirect(localHandlers, runId);
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("terminal_run");
    expect(response.message).toContain("gh pr view");
    expect(response.message).not.toBe("Cannot resume a completed run");
  }
});

test("inverting terminal resume refusal guard emits refusal on admitted rows", () => {
  const runId = createWorkflowRun({ invocationId: "refusal-guard-inversion" });
  stateStore.setRunStatus(runId, "paused");
  const run = stateStore.loadRun(runId);
  expect(run).toBeDefined();
  if (!run) return;

  expect(terminalResumeRefusalMessage(run)).toBeUndefined();

  const invertedRefusal = (loaded: typeof run, terminal?: TerminalLogRecord) =>
    isResumeAdmitted(loaded, terminal) ? (terminalResumeRefusalMessage(loaded, terminal) ?? "refused") : undefined;
  expect(invertedRefusal(run)).toBeDefined();
});

test("resume refusal on a blocked row names its documented recovery", async () => {
  const runId = createWorkflowRun({ invocationId: "agent-blocked-refusal" });
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
    expect(response.message).toContain("resolve the blocker and re-run the spec");
    expect(response.message).not.toBe("Cannot resume a blocked run");
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
  const previousHome = process.env.JARVIS_HOME;
  process.env.JARVIS_HOME = isolatedHome;
  writeFileSync(join(isolatedHome, "config.json"), JSON.stringify({ iterationCeilingMs: 2_222_222 }));

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
  const previousHome = process.env.JARVIS_HOME;
  process.env.JARVIS_HOME = isolatedHome;
  writeFileSync(join(isolatedHome, "config.json"), JSON.stringify({ iterationCeilingMs: 9_999_999 }));

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

test("resume admits a failed row whose last committed attempt is blocked but terminal loop_finished is resumable ready_gate_failed", async () => {
  const runId = createWorkflowRun({ invocationId: "ready-gate-failed-after-blocked-repair" });
  stateStore.setRunStatus(runId, "failed");
  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({
    attemptId,
    runStatus: "blocked",
    outcomeKind: "blocked",
  });
  stateStore.setRunStatus(runId, "failed");
  const logReader = loopFinishedLogReader(runId, {
    loopOutcomeKind: "ready_gate_failed",
    iterationsConsumed: 1,
    resumable: true,
  });
  const localHandlers = createHandlers(logReader);

  const response = await resumeDirect(localHandlers, runId);
  expect(response.kind).not.toBe("error");
  if (response.kind === "error") {
    expect(response.code).not.toBe("terminal_run");
  }
});

async function waitDirect(h: Handlers, runId: string) {
  return h.wait({ kind: "request", id: "w1", method: "wait", params: { runId } }, new AbortController().signal);
}

async function listDirect(h: Handlers) {
  return h.list({ kind: "request", id: "l1", method: "list" }, new AbortController().signal);
}

function rowResumable(result: { resumable?: boolean } | undefined): boolean {
  return result?.resumable === true;
}

type ResumeRpcOutcome = "ok" | "terminal_run" | "resume_unsupported" | "other";

function classifyResumeResponse(response: Awaited<ReturnType<typeof resumeDirect>>): ResumeRpcOutcome {
  if (response.kind === "response") return "ok";
  if (response.kind === "error") {
    if (response.code === "terminal_run") return "terminal_run";
    if (response.code === "resume_unsupported") return "resume_unsupported";
  }
  return "other";
}

function assertWaitListResumeAgreement(
  advertisedResumable: boolean,
  resumeOutcome: ResumeRpcOutcome,
  label: string,
): void {
  if (advertisedResumable) {
    expect(resumeOutcome, `${label}: advertised resumable but resume refused terminal_run`).not.toBe("terminal_run");
    expect(resumeOutcome, `${label}: advertised resumable but resume_unsupported`).toBe("ok");
  }
  if (resumeOutcome === "ok") {
    expect(advertisedResumable, `${label}: resume ok but row not resumable`).toBe(true);
  }
  if (resumeOutcome === "terminal_run" || resumeOutcome === "resume_unsupported") {
    expect(advertisedResumable, `${label}: resume refused but row advertised resumable`).toBe(false);
  }
}

/** Durable statuses each terminal `loopOutcomeKind` can settle a row on. */
const KIND_STATUSES: Partial<Record<WriteLoopOutcomeKind, RunStatus[]>> = {
  complete: ["completed"],
  blocked: ["blocked"],
  contract_miss: ["failed"],
  invocation_failure: ["failed"],
  iteration_timeout: ["failed"],
  "budget-exhausted": ["budget-soft-stopped", "failed"],
  paused: ["paused", "failed"],
  completion_commit_failed: ["completed", "failed"],
  iteration_commit_failed: ["failed"],
  ready_gate_failed: ["completed", "failed"],
  ready_flip_failed: ["completed"],
  surviving_mutation_failed: ["failed"],
  runtime_smoke_failed: ["failed"],
};

test("wait/list-advertised resumable agrees with resume admission across every terminal loopOutcomeKind x durable status", async () => {
  for (const kind of WRITE_LOOP_OUTCOME_KINDS) {
    if (kind === "progress") continue; // non-terminal: never a wait/list terminal record
    const statuses = KIND_STATUSES[kind];
    expect(statuses, `no durable-status table entry for terminal kind ${kind}`).toBeDefined();
    if (!statuses) continue;

    for (const status of statuses) {
      for (const logResumable of [true, false]) {
        const runId = createWorkflowRun({ invocationId: `agreement-${kind}-${status}-${String(logResumable)}` });
        stateStore.setRunStatus(runId, status);
        const logReader = loopFinishedLogReader(runId, {
          loopOutcomeKind: kind,
          iterationsConsumed: 1,
          resumable: logResumable,
        });
        const localHandlers = createHandlers(logReader);

        const waitResponse = await waitDirect(localHandlers, runId);
        expect(waitResponse.kind).toBe("response");
        const waitResult =
          waitResponse.kind === "response" ? (waitResponse.result as { resumable?: boolean }) : undefined;

        const listResponse = await listDirect(localHandlers);
        expect(listResponse.kind).toBe("response");
        const listRow =
          listResponse.kind === "response"
            ? (listResponse.result as { runs: Array<{ runId: string; resumable?: boolean }> }).runs.find(
                (row) => row.runId === runId,
              )
            : undefined;
        expect(listRow, `list missing run ${runId}`).toBeDefined();

        const waitAdvertised = rowResumable(waitResult);
        const listAdvertised = rowResumable(listRow);
        expect(listAdvertised, `wait/list resumable mismatch for ${runId}`).toBe(waitAdvertised);

        const resumeOutcome = classifyResumeResponse(await resumeDirect(localHandlers, runId));

        const label = `kind=${kind} status=${status} logResumable=${String(logResumable)}`;
        assertWaitListResumeAgreement(waitAdvertised, resumeOutcome, label);
        assertWaitListResumeAgreement(listAdvertised, resumeOutcome, `${label} list`);
        // Stale demoted rows: a `failed` row whose terminal `loop_finished` still self-reports
        // `resumable: true` for `paused` or `budget-exhausted` must not advertise resumable.
        if (status === "failed" && (kind === "paused" || kind === "budget-exhausted") && logResumable) {
          expect(waitAdvertised, `${label}: stale demoted row must not advertise resumable`).toBe(false);
        }
      }
    }
  }
});

test("inverting resumable projection to admission-only breaks wait/list vs resume agreement", async () => {
  const runId = createWorkflowRun({ invocationId: "projection-guard-inversion", agents: [] });
  stateStore.setRunStatus(runId, "failed");
  const logReader = loopFinishedLogReader(runId, {
    loopOutcomeKind: "ready_gate_failed",
    iterationsConsumed: 1,
    resumable: true,
  });
  const run = stateStore.loadRun(runId);
  expect(run).toBeDefined();
  if (!run) return;
  const terminal = logReader.tail(runId)[0] as TerminalLogRecord;
  const admissionOnlyResumable = isResumeAdmitted(run, terminal);
  expect(admissionOnlyResumable).toBe(true);

  const localHandlers = createHandlers(logReader);
  const waitResponse = await waitDirect(localHandlers, runId);
  expect(waitResponse.kind).toBe("response");
  const projectedResumable =
    waitResponse.kind === "response" ? rowResumable(waitResponse.result as { resumable?: boolean }) : false;
  expect(projectedResumable).toBe(false);

  const resumeOutcome = classifyResumeResponse(await resumeDirect(localHandlers, runId));
  expect(resumeOutcome).toBe("resume_unsupported");
  expect(() => assertWaitListResumeAgreement(admissionOnlyResumable, resumeOutcome, "inverted-projection")).toThrow();
});
