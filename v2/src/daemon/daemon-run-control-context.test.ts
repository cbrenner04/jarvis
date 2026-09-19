import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireGateInvocationLease } from "../execution/write-loop.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, mockWriteLoopInput } from "../testing/run-control.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";

test("reportReviewProgress accumulates multiple steps per invocation", () => {
  const stateStorePath = join(tmpdir(), `jarvis-context-review-${process.pid}-${Date.now()}.db`);
  const stateStore: StateStore = openStateStore(stateStorePath);
  try {
    const ctx = createRunControlHandlerContext({
      stateStore,
      writeLoopExecutor: async () => undefined,
      failureReporter: () => undefined,
    });
    const invocationId = "inv-1";
    ctx.reportReviewProgress(invocationId, "step-a", { status: "in_progress", role: "adversary" });
    ctx.reportReviewProgress(invocationId, "step-b", { status: "in_progress", role: "advocate" });
    const steps = ctx.reviewDebateProgressByInvocation.get(invocationId);
    expect(steps?.get("step-a")).toEqual({ status: "in_progress", role: "adversary" });
    expect(steps?.get("step-b")).toEqual({ status: "in_progress", role: "advocate" });
  } finally {
    stateStore.close();
  }
});

test("clearLiveReviewProgress removes in_progress steps and retains terminal steps", () => {
  const stateStorePath = join(tmpdir(), `jarvis-context-clear-${process.pid}-${Date.now()}.db`);
  const stateStore: StateStore = openStateStore(stateStorePath);
  try {
    const ctx = createRunControlHandlerContext({
      stateStore,
      writeLoopExecutor: async () => undefined,
      failureReporter: () => undefined,
    });
    const invocationId = "inv-clear";
    ctx.reportReviewProgress(invocationId, "step-live", { status: "in_progress", role: "adversary" });
    ctx.reportReviewProgress(invocationId, "step-done", {
      status: "completed",
      role: "advocate",
      terminalOutcome: "complete",
      attemptCount: 1,
    });
    ctx.clearLiveReviewProgress(invocationId);
    const steps = ctx.reviewDebateProgressByInvocation.get(invocationId);
    expect(steps?.has("step-live")).toBe(false);
    expect(steps?.get("step-done")).toEqual({
      status: "completed",
      role: "advocate",
      terminalOutcome: "complete",
      attemptCount: 1,
    });
  } finally {
    stateStore.close();
  }
});

test("clearLiveReviewProgress is no-op for unknown invocation", () => {
  const stateStorePath = join(tmpdir(), `jarvis-context-clear-unknown-${process.pid}-${Date.now()}.db`);
  const stateStore: StateStore = openStateStore(stateStorePath);
  try {
    const ctx = createRunControlHandlerContext({
      stateStore,
      writeLoopExecutor: async () => undefined,
      failureReporter: () => undefined,
    });
    ctx.clearLiveReviewProgress("unknown-invocation");
    expect(ctx.reviewDebateProgressByInvocation.size).toBe(0);
  } finally {
    stateStore.close();
  }
});

test("createRunControlHandlerContext exposes activeRuns without activeRunForHandler", () => {
  const stateStorePath = join(tmpdir(), `jarvis-context-${process.pid}-${Date.now()}.db`);
  const stateStore: StateStore = openStateStore(stateStorePath);
  try {
    const ctx = createRunControlHandlerContext({
      stateStore,
      writeLoopExecutor: async () => undefined,
      failureReporter: () => undefined,
    });
    expect(ctx.activeRuns).toBeInstanceOf(Map);
    expect(ctx.activeRuns.size).toBe(0);
  } finally {
    stateStore.close();
  }
});

/** Seeds a slot-refused lane, holds then releases the gate, and returns the run ids the coordinator re-drove. */
async function redrivenRunIds(resolvePredecessorOwner?: (runId: string) => Promise<boolean>): Promise<string[]> {
  const stateStorePath = join(tmpdir(), `jarvis-context-redrive-${process.pid}-${Date.now()}-${Math.random()}.db`);
  const stateStore: StateStore = openStateStore(stateStorePath);
  const holder = acquireGateInvocationLease();
  try {
    if (holder === undefined) throw new Error("gate lease unexpectedly unavailable");
    const runId = stateStore.createRun({
      project: "ctx",
      specRef: "main",
      worktreePath: "/tmp/ctx-redrive",
      branch: "ctx-redrive",
      specPath: "/tmp/ctx-redrive-spec.md",
      queuedInput: mockWriteLoopInput({ branchName: "ctx-redrive", projectName: "ctx" }),
    });
    stateStore.commitCompletionBoundary({
      attemptId: stateStore.recordAttemptStart(runId),
      runStatus: "failed",
      outcomeKind: "gate_invocation_refused",
      terminalCause: "gate_invocation_refused",
      gateRefusalRecoveryState: { cause: "slot_contention", gateCommand: "bun run test:v2", slotRedriveCount: 0 },
    });
    const ctx = createRunControlHandlerContext({
      stateStore,
      writeLoopExecutor: async () => undefined,
      failureReporter: () => undefined,
      ...(resolvePredecessorOwner !== undefined ? { resolvePredecessorOwner } : {}),
    });
    const redriven: string[] = [];
    ctx.slotRedrive.bindResume((id) => {
      redriven.push(id);
      return { kind: "response", result: { ok: true } };
    });
    ctx.slotRedrive.enqueue(runId);
    holder.release();
    await flushBackgroundRuns(3);
    ctx.slotRedrive.stop();
    return redriven;
  } finally {
    holder?.release();
    stateStore.close();
  }
}

test("the context wires resolvePredecessorOwner into the slot re-drive coordinator", async () => {
  expect(await redrivenRunIds(async () => true)).toEqual([]);
  expect(await redrivenRunIds(async () => false)).toHaveLength(1);
  expect(await redrivenRunIds()).toHaveLength(1);
});
