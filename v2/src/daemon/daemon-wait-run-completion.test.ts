import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RpcHandler } from "../ipc/server.ts";
import { type LogSink, openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import {
  createRunControlHandlers,
  projectWorkflowEntryResult,
  resetWriteLoopBindingSourceDepsForTests,
  setWriteLoopBindingSourceDepsForTests,
} from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let stateStore: StateStore;
let logSink: LogSink;
let logsPath: string;
let handlers: Handlers;

const WAIT_COMPLETION_MACHINE_PROFILE = "wait-completion-profile";

function installWaitCompletionMachineProfile(): void {
  const profileHome = mkdtempSync(join(tmpdir(), "jarvis-wait-completion-profile-"));
  const machinesDir = join(profileHome, "machines");
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string, priceKey: string) => ({ rungs: [{ adapterModel, priceKey }] });
  const codexRoles = {
    plan: rung("plan", "plan"),
    implement: rung("M1", "P1"),
    shrink: rung("S1", "S1"),
    adversary: rung("adv", "adv"),
    critic: rung("crit", "crit"),
    advocate: rung("advoc", "advoc"),
    adjudicator: rung("adj", "adj"),
    actuator: rung("act", "act"),
  };
  writeFileSync(
    join(machinesDir, `${WAIT_COMPLETION_MACHINE_PROFILE}.json`),
    JSON.stringify({ models: { codex: codexRoles } }),
  );
  writeFileSync(
    join(profileHome, "config.json"),
    JSON.stringify({ machineProfile: WAIT_COMPLETION_MACHINE_PROFILE, agents: ["codex"] }),
  );
  setWriteLoopBindingSourceDepsForTests({
    machineConfigPath: join(profileHome, "config.json"),
    machinesDir,
  });
}

function createRun(): string {
  return stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: `test-branch-${crypto.randomUUID()}`,
    specPath: "/tmp/test-project/spec.md",
  });
}

function finishLoop(runId: string, status: RunStatus, iterationsConsumed = 1): void {
  stateStore.setRunStatus(runId, status);
  logSink.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: status === "blocked" ? "blocked" : "complete",
    iterationsConsumed,
    resumable: status === "paused" || status === "budget-soft-stopped",
  });
}

function failRun(runId: string): void {
  stateStore.setRunStatus(runId, "failed");
  logSink.append(runId, { kind: "run_execution_failed" });
}

type RpcResult = Awaited<ReturnType<RpcHandler>>;

async function waitDirect(id: string, runId: string, signal = new AbortController().signal): Promise<RpcResult> {
  return handlers.wait({ kind: "request", id, method: "wait", params: { runId } }, signal);
}

async function listDirect(id = "list"): Promise<RpcResult> {
  return handlers.list({ kind: "request", id, method: "list" }, new AbortController().signal);
}

async function expectResponse(frame: RpcResult): Promise<Record<string, unknown>> {
  expect(frame.kind).toBe("response");
  if (frame.kind !== "response") throw new Error("not a response");
  return frame.result as Record<string, unknown>;
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function waitForInProgress(runId: string): Promise<void> {
  await waitFor(() => stateStore.loadRun(runId)?.status === "in-progress");
}

beforeEach(() => {
  installWaitCompletionMachineProfile();
  const unique = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
  stateStore = openStateStore(join(tmpdir(), `jarvis-wait-state-${unique}.db`));
  logsPath = join(tmpdir(), `jarvis-wait-logs-${unique}.jsonl`);
  logSink = openLogSink(logsPath);
  handlers = createRunControlHandlers({
    stateStore,
    logReader: openLogReader(logsPath),
    writeLoopExecutor: async () => undefined,
    failureReporter: () => undefined,
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
});

afterEach(() => {
  resetWriteLoopBindingSourceDepsForTests();
  handlers.close();
  logSink.close();
  stateStore.close();
  rmSync(logsPath, { force: true });
});

test("wait rejects missing and unknown runId before following logs", async () => {
  const missing = await waitDirect("missing", "");
  expect(missing.kind).toBe("error");
  expect(missing.kind === "error" && missing.code).toBe("invalid_params");

  const unknown = await waitDirect("unknown", "nope");
  expect(unknown.kind).toBe("error");
  expect(unknown.kind === "error" && unknown.code).toBe("unknown_run");
});

test("wait returns immediately for quiescent run with last loop_finished payload", async () => {
  const runId = createRun();
  finishLoop(runId, "completed", 3);

  const result = await expectResponse(await waitDirect("wait", runId));

  expect(result).toEqual({
    runStatus: "completed",
    loopOutcomeKind: "complete",
    iterationsConsumed: 3,
    resumable: false,
  });
});

test("workflow entry payload omits absent optional outcome fields", () => {
  const present = projectWorkflowEntryResult(
    { runStatus: "failed", loopOutcomeKind: "surviving_mutation_failed", iterationsConsumed: 3, resumable: true },
    false,
  );
  expect(present).toMatchObject({
    loopOutcomeKind: "surviving_mutation_failed",
    iterationsConsumed: 3,
    resumable: false,
  });

  const absent = projectWorkflowEntryResult({ runStatus: "failed" }, false);
  expect(absent).not.toHaveProperty("loopOutcomeKind");
  expect(absent).not.toHaveProperty("iterationsConsumed");
  expect(absent).not.toHaveProperty("resumable");

  const partial = projectWorkflowEntryResult(
    { runStatus: "failed", loopOutcomeKind: "surviving_mutation_failed" },
    false,
  );
  expect(partial).toMatchObject({ loopOutcomeKind: "surviving_mutation_failed" });
  expect(partial).not.toHaveProperty("iterationsConsumed");
  expect(partial).not.toHaveProperty("resumable");
});

test("wait on resumed in-progress run ignores historical loop_finished and resolves on next edge", async () => {
  const runId = createRun();
  logSink.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: "progress",
    iterationsConsumed: 1,
    resumable: true,
  });
  const pending = waitDirect("wait", runId);

  await waitForInProgress(runId);
  finishLoop(runId, "completed", 2);
  const result = await expectResponse(await pending);

  expect(result).toMatchObject({ runStatus: "completed", iterationsConsumed: 2 });
});

test("two concurrent waits resolve with the same terminal payload", async () => {
  const runId = createRun();
  const first = waitDirect("w1", runId);
  const second = waitDirect("w2", runId);

  await waitForInProgress(runId);
  finishLoop(runId, "blocked", 4);
  const firstResult = await expectResponse(await first);
  const secondResult = await expectResponse(await second);

  expect(firstResult).toEqual(secondResult);
  expect(firstResult).toMatchObject({
    runStatus: "blocked",
    loopOutcomeKind: "blocked",
    iterationsConsumed: 4,
  });
});

test("pending wait does not block other RPCs on the same connection", async () => {
  const runId = createRun();
  const pending = waitDirect("wait", runId);

  const listFrame = await listDirect();
  expect(listFrame.kind).toBe("response");
  expect(listFrame.kind === "response" && (listFrame.result as { runs?: unknown[] }).runs?.length).toBe(1);

  finishLoop(runId, "completed", 1);
  const waitFrame = await pending;
  expect(waitFrame.kind).toBe("response");
});

test("disconnecting one wait client leaves other waiters and durable status alone", async () => {
  const runId = createRun();
  const firstController = new AbortController();
  const firstWait = waitDirect("first", runId, firstController.signal);
  const secondWait = waitDirect("second", runId);

  await waitForInProgress(runId);
  firstController.abort();
  await expect(firstWait).rejects.toThrow();
  expect(stateStore.loadRun(runId)?.status).toBe("in-progress");

  finishLoop(runId, "completed", 1);
  const result = await expectResponse(await secondWait);
  expect(result.runStatus).toBe("completed");
});

test("wait resolves failed run_execution_failed without loop fields", async () => {
  const runId = createRun();
  const pending = waitDirect("wait", runId);

  await waitForInProgress(runId);
  failRun(runId);
  const result = await expectResponse(await pending);

  expect(result).toEqual({
    runStatus: "failed",
    error: { reason: "harness_failure", retryable: false, nextAction: "stop" },
  });
});

test("wait resolve payload includes the same error object as list for the same run", async () => {
  const runId = createRun();
  stateStore.setRunStatus(runId, "killed");

  const listFrame = await listDirect();
  expect(listFrame.kind).toBe("response");
  const listError =
    listFrame.kind === "response"
      ? (listFrame.result as { runs?: Array<{ runId: string; error?: unknown }> }).runs?.find(
          (row) => row.runId === runId,
        )?.error
      : undefined;

  const waitResult = await expectResponse(await waitDirect("wait", runId));
  // Durable status alone (no terminal log signal) resolves the wait.
  expect(waitResult.runStatus).toBe("killed");
  expect(waitResult.error).toEqual(listError);
  expect(waitResult.error).toEqual({
    reason: "unsupported_resume_context",
    retryable: false,
    nextAction: "stop",
  });
});

test("close() rejects an in-flight wait", async () => {
  const runId = createRun();
  const pending = waitDirect("wait", runId);

  await waitForInProgress(runId);
  handlers.close();

  await expect(pending).rejects.toThrow();
  expect(stateStore.loadRun(runId)?.status).toBe("in-progress");
});

test("wait resolves when a second sink appends the terminal event to the same run", async () => {
  const runId = createRun();
  const pending = waitDirect("wait", runId);

  await waitForInProgress(runId);
  const secondSink = openLogSink(logsPath);
  stateStore.setRunStatus(runId, "completed");
  secondSink.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: "complete",
    iterationsConsumed: 2,
    resumable: false,
  });
  secondSink.close();

  const result = await expectResponse(await pending);
  expect(result).toEqual({
    runStatus: "completed",
    loopOutcomeKind: "complete",
    iterationsConsumed: 2,
    resumable: false,
  });
});

test("list and wait preserve failed hidden-shrink publication evidence and resumability", async () => {
  const invocationId = "inv-failed-shrink-publication";
  const workflowSnapshot = {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "retry rules",
        expectedArtifactPath: "/tmp/test-project/artifact",
        agents: ["codex"],
        agentModelConfig: {
          codex: {
            implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
            shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
          },
        },
      },
    ],
  };
  const entryRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "failed-shrink",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement",
    workflowSnapshot,
  });
  const shrinkRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "failed-shrink",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement~shrink",
    workflowSnapshot,
  });
  finishLoop(entryRunId, "completed", 1);
  stateStore.setRunStatus(shrinkRunId, "failed");
  logSink.append(shrinkRunId, {
    kind: "loop_finished",
    loopOutcomeKind: "completion_commit_failed",
    iterationsConsumed: 2,
    resumable: true,
    publicationFailure: {
      operation: "push",
      message: "remote rejected",
      exitCode: 7,
      stdoutTail: "out",
      stderrTail: "err",
    },
  });

  const list = await expectResponse(await listDirect());
  const rows = list.runs as Array<{ runId: string; status: string; error?: unknown }>;
  expect(rows.find((row) => row.runId === entryRunId)?.status).toBe("failed");
  expect(rows.find((row) => row.runId === shrinkRunId)).toMatchObject({
    status: "failed",
    error: {
      reason: "completion_commit_failed",
      nextAction: "resume",
      publicationFailure: { operation: "push", exitCode: 7 },
    },
  });
  expect(await expectResponse(await waitDirect("failed-shrink", shrinkRunId))).toMatchObject({
    runStatus: "failed",
    loopOutcomeKind: "completion_commit_failed",
    resumable: true,
    error: { reason: "completion_commit_failed", nextAction: "resume", publicationFailure: { stderrTail: "err" } },
  });
});

test("list and wait report surviving_mutation_failed as failed, resumable, and mutation-specific", async () => {
  const workflowSnapshot = {
    invocationId: "inv-surviving-mutation",
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "retry rules",
        expectedArtifactPath: "/tmp/test-project/artifact",
        agents: ["codex"],
        agentModelConfig: {
          codex: {
            implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
            shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
          },
        },
      },
    ],
  };
  const runId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "surviving-mutation",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement",
    workflowSnapshot,
  });
  stateStore.setRunStatus(runId, "failed");
  logSink.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: "surviving_mutation_failed",
    iterationsConsumed: 3,
    resumable: true,
    survivingMutation: "operator-flip: === → !==",
    survivingMutationSourceFile: "src/guard.ts",
    survivingMutationSourceLine: 17,
  });

  const list = await expectResponse(await listDirect());
  const row = (list.runs as Array<{ runId: string; status: string; error?: unknown }>).find(
    (candidate) => candidate.runId === runId,
  );
  expect(row).toMatchObject({
    status: "failed",
    error: {
      reason: "surviving_mutation_failed",
      retryable: true,
      nextAction: "resume",
      survivingMutation: "operator-flip: === → !==",
      survivingMutationSourceFile: "src/guard.ts",
      survivingMutationSourceLine: 17,
    },
  });
  expect(await expectResponse(await waitDirect("surviving-mutation", runId))).toMatchObject({
    runStatus: "failed",
    loopOutcomeKind: "surviving_mutation_failed",
    iterationsConsumed: 3,
    resumable: true,
    error: {
      reason: "surviving_mutation_failed",
      retryable: true,
      nextAction: "resume",
      survivingMutation: "operator-flip: === → !==",
      survivingMutationSourceFile: "src/guard.ts",
      survivingMutationSourceLine: 17,
    },
  });
});

test("workflow entry wait and list report surviving_mutation_failed from hidden shrink after implement completes", async () => {
  const invocationId = "inv-entry-surviving-mutation";
  const workflowSnapshot = {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "retry rules",
        expectedArtifactPath: "/tmp/artifact",
        agents: ["codex"],
        agentModelConfig: {
          codex: {
            implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
            shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
          },
        },
      },
    ],
  };
  const entryRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-surviving-mutation",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement",
    workflowSnapshot,
  });
  const shrinkRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-surviving-mutation",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement~shrink",
    workflowSnapshot,
  });
  finishLoop(entryRunId, "completed", 1);
  stateStore.setRunStatus(shrinkRunId, "failed");
  logSink.append(shrinkRunId, {
    kind: "loop_finished",
    loopOutcomeKind: "surviving_mutation_failed",
    iterationsConsumed: 3,
    resumable: true,
    survivingMutation: "operator-flip: === → !==",
    survivingMutationSourceFile: "src/guard.ts",
    survivingMutationSourceLine: 17,
  });

  const expectedError = {
    reason: "surviving_mutation_failed",
    retryable: false,
    nextAction: "stop",
    survivingMutation: "operator-flip: === → !==",
    survivingMutationSourceFile: "src/guard.ts",
    survivingMutationSourceLine: 17,
  };
  const wait = await expectResponse(await waitDirect("entry-surviving-mutation", entryRunId));
  expect(wait).toEqual({
    runStatus: "failed",
    loopOutcomeKind: "surviving_mutation_failed",
    iterationsConsumed: 3,
    resumable: false,
    error: expectedError,
  });

  const list = await expectResponse(await listDirect());
  const entry = (list.runs as Array<{ runId: string; status: string; error?: unknown }>).find(
    (row) => row.runId === entryRunId,
  );
  expect(entry).toEqual(
    expect.objectContaining({
      runId: entryRunId,
      status: "failed",
      loopOutcomeKind: "surviving_mutation_failed",
      iterationsConsumed: 3,
      resumable: false,
      error: expectedError,
    }),
  );
  expect(entry?.error).not.toEqual(expect.objectContaining({ nextAction: "resume" }));
});

test("workflow entry wait and list report surviving_mutation_failed owned by a durable review step", async () => {
  const invocationId = "inv-entry-review-surviving-mutation";
  const workflowSnapshot = {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "retry rules",
        expectedArtifactPath: "/tmp/artifact",
        agents: ["codex"],
      },
      {
        stepId: "implement-review",
        role: "review",
        behavior: "review" as const,
        stepRules: "review rules",
        expectedArtifactPath: "/tmp/artifact",
        agents: ["codex"],
      },
    ],
  };
  const entryRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-review-surviving-mutation",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement",
    workflowSnapshot,
  });
  const reviewRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-review-surviving-mutation",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement-review",
    workflowSnapshot,
  });
  finishLoop(entryRunId, "completed", 1);
  stateStore.setRunStatus(reviewRunId, "failed");
  logSink.append(reviewRunId, {
    kind: "loop_finished",
    loopOutcomeKind: "surviving_mutation_failed",
    iterationsConsumed: 2,
    resumable: true,
    survivingMutation: "operator-flip: === → !==",
    survivingMutationSourceFile: "src/guard.ts",
    survivingMutationSourceLine: 42,
  });

  const expectedError = {
    reason: "surviving_mutation_failed",
    retryable: false,
    nextAction: "stop",
    survivingMutation: "operator-flip: === → !==",
    survivingMutationSourceFile: "src/guard.ts",
    survivingMutationSourceLine: 42,
  };
  const wait = await expectResponse(await waitDirect("entry-review-surviving-mutation", entryRunId));
  expect(wait).toEqual({
    runStatus: "failed",
    loopOutcomeKind: "surviving_mutation_failed",
    iterationsConsumed: 2,
    resumable: false,
    error: expectedError,
  });

  const list = await expectResponse(await listDirect());
  const entry = (list.runs as Array<{ runId: string; status: string; error?: unknown }>).find(
    (row) => row.runId === entryRunId,
  );
  expect(entry).toEqual(
    expect.objectContaining({
      runId: entryRunId,
      status: "failed",
      loopOutcomeKind: "surviving_mutation_failed",
      iterationsConsumed: 2,
      resumable: false,
      error: expectedError,
    }),
  );
});

test("workflow entry owner adoption stays confined to a failed rollup", async () => {
  const invocationId = "inv-entry-non-failed-rollup";
  const workflowSnapshot = {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "retry rules",
        expectedArtifactPath: "/tmp/artifact",
        agents: ["codex"],
      },
      {
        stepId: "implement-review",
        role: "review",
        behavior: "review" as const,
        stepRules: "review rules",
        expectedArtifactPath: "/tmp/artifact",
        agents: ["codex"],
      },
    ],
  };
  const entryRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-non-failed-rollup",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement",
    workflowSnapshot,
  });
  const reviewRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/review-worktree",
    branch: "entry-non-failed-rollup",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement-review",
    workflowSnapshot,
  });
  // An orphaned sibling row (stale, no longer part of the current snapshot's step list) still
  // qualifies as a candidate for the widened owner search, but must not be adopted while the
  // rollup is not `failed`.
  const orphanRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-non-failed-rollup",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement-audit",
    workflowSnapshot,
  });
  finishLoop(entryRunId, "completed", 1);
  stateStore.setRunStatus(reviewRunId, "blocked");
  stateStore.setRunStatus(orphanRunId, "failed");
  logSink.append(orphanRunId, {
    kind: "loop_finished",
    loopOutcomeKind: "surviving_mutation_failed",
    iterationsConsumed: 2,
    resumable: true,
    survivingMutation: "operator-flip: === → !==",
    survivingMutationSourceFile: "src/guard.ts",
    survivingMutationSourceLine: 9,
  });

  const wait = await expectResponse(await waitDirect("entry-non-failed-rollup", entryRunId));
  expect(wait.runStatus).toBe("blocked");
  expect(wait).not.toHaveProperty("survivingMutation");
  expect(wait).toHaveProperty("worktreePath", "/tmp/test-project");
  if (wait.error !== undefined) {
    expect(wait.error).not.toMatchObject({ reason: "surviving_mutation_failed" });
  }

  const list = await expectResponse(await listDirect());
  const entry = (list.runs as Array<{ runId: string; status: string; error?: unknown }>).find(
    (row) => row.runId === entryRunId,
  );
  expect(entry?.status).toBe("blocked");
  if (entry?.error !== undefined) {
    expect(entry.error).not.toMatchObject({ reason: "surviving_mutation_failed" });
  }
});

test("workflow entry owner adoption picks the chronologically last terminal record among multiple candidates", async () => {
  const invocationId = "inv-entry-tie-break";
  const workflowSnapshot = {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "retry rules",
        expectedArtifactPath: "/tmp/artifact",
        agents: ["codex"],
        agentModelConfig: {
          codex: {
            implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
            shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
          },
        },
      },
    ],
  };
  const entryRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-tie-break",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement",
    workflowSnapshot,
  });
  const shrinkRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-tie-break",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement~shrink",
    workflowSnapshot,
  });
  const reviewRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-tie-break",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement-review",
    workflowSnapshot,
  });
  finishLoop(entryRunId, "completed", 1);
  stateStore.setRunStatus(shrinkRunId, "failed");
  logSink.append(shrinkRunId, {
    kind: "loop_finished",
    loopOutcomeKind: "surviving_mutation_failed",
    iterationsConsumed: 2,
    resumable: true,
    survivingMutation: "earlier candidate",
    survivingMutationSourceFile: "src/earlier.ts",
    survivingMutationSourceLine: 1,
  });

  // Force a distinct millisecond boundary so the two terminal records carry different `ts`
  // values without relying on a fixed sleep duration.
  const boundary = Date.now();
  while (Date.now() === boundary) {
    /* busy-wait for the next millisecond */
  }

  stateStore.setRunStatus(reviewRunId, "failed");
  logSink.append(reviewRunId, {
    kind: "loop_finished",
    loopOutcomeKind: "surviving_mutation_failed",
    iterationsConsumed: 3,
    resumable: true,
    survivingMutation: "later candidate",
    survivingMutationSourceFile: "src/later.ts",
    survivingMutationSourceLine: 2,
  });

  const expectedError = {
    reason: "surviving_mutation_failed",
    retryable: false,
    nextAction: "stop",
    survivingMutation: "later candidate",
    survivingMutationSourceFile: "src/later.ts",
    survivingMutationSourceLine: 2,
  };
  const wait = await expectResponse(await waitDirect("entry-tie-break", entryRunId));
  expect(wait).toMatchObject({ runStatus: "failed", error: expectedError });

  const list = await expectResponse(await listDirect());
  const entry = (list.runs as Array<{ runId: string; status: string; error?: unknown }>).find(
    (row) => row.runId === entryRunId,
  );
  expect(entry?.error).toMatchObject(expectedError);
});

test("workflow entry wait and list preserve complete outcome when a durable review row also succeeds", async () => {
  const invocationId = "inv-entry-review-complete";
  const workflowSnapshot = {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "retry rules",
        expectedArtifactPath: "/tmp/artifact",
        agents: ["codex"],
      },
      {
        stepId: "implement-review",
        role: "review",
        behavior: "review" as const,
        stepRules: "review rules",
        expectedArtifactPath: "/tmp/artifact",
        agents: ["codex"],
      },
    ],
  };
  const entryRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-review-complete",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement",
    workflowSnapshot,
  });
  const reviewRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-review-complete",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement-review",
    workflowSnapshot,
  });
  finishLoop(entryRunId, "completed", 1);
  finishLoop(reviewRunId, "completed", 1);

  const wait = await expectResponse(await waitDirect("entry-review-complete", entryRunId));
  expect(wait).toMatchObject({ runStatus: "completed", loopOutcomeKind: "complete" });
  expect(wait).not.toHaveProperty("error");

  const list = await expectResponse(await listDirect());
  const entry = (list.runs as Array<{ runId: string; status: string; error?: unknown }>).find(
    (row) => row.runId === entryRunId,
  );
  expect(entry).toMatchObject({ status: "completed", loopOutcomeKind: "complete" });
  expect(entry?.error).toBeUndefined();
});

test("workflow entry wait and list preserve complete outcome after hidden shrink completes", async () => {
  const invocationId = "inv-entry-complete";
  const workflowSnapshot = {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "retry rules",
        expectedArtifactPath: "/tmp/artifact",
        agents: ["codex"],
      },
    ],
  };
  const entryRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-complete",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement",
    workflowSnapshot,
  });
  const shrinkRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "entry-complete",
    specPath: "/tmp/test-project/spec.md",
    stepId: "implement~shrink",
    workflowSnapshot,
  });
  finishLoop(entryRunId, "completed", 1);
  finishLoop(shrinkRunId, "completed", 2);

  expect(await expectResponse(await waitDirect("entry-complete", entryRunId))).toMatchObject({
    runStatus: "completed",
    loopOutcomeKind: "complete",
  });
  const list = await expectResponse(await listDirect());
  expect((list.runs as Array<{ runId: string; status: string }>).find((row) => row.runId === entryRunId)).toMatchObject(
    {
      status: "completed",
      loopOutcomeKind: "complete",
      iterationsConsumed: 1,
      resumable: false,
    },
  );
});

test("workflow wait returns killed when review step never runs and workflow is not live", async () => {
  const writeStepId = "write-step-killed";
  const reviewStepId = "review-step-killed";
  const invocationId = "inv-workflow-killed";

  // Create entry run with workflow snapshot
  const entryRunId = stateStore.createRun({
    project: "test-project",
    specRef: "main",
    worktreePath: "/tmp/test-project",
    branch: "test-branch-workflow-killed",
    specPath: "/tmp/test-project/spec.md",
    stepId: writeStepId,
    workflowSnapshot: {
      invocationId,
      steps: [
        { stepId: writeStepId, role: "implement" },
        { stepId: reviewStepId, role: "review", behavior: "review" },
      ],
    },
  });

  // Complete write step but don't create review step
  finishLoop(entryRunId, "completed", 1);

  // Wait should resolve with killed status (review step never ran and workflow not live)
  const result = await expectResponse(await waitDirect("wait-killed", entryRunId));
  expect(result.runStatus).toBe("killed");
});
