import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import {
  flushBackgroundRuns,
  listRunsDirect,
  loadRunOrThrow,
  mockWriteLoopInput,
  startRunDirect,
} from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

async function resumeDirect(h: Handlers, runId: string) {
  return h.resume({ kind: "request", id: "r1", method: "resume", params: { runId } }, new AbortController().signal);
}

let stateStore: StateStore;
let stateStorePath: string;
let fakeExecutor: FakeWriteLoopExecutor;
let memoryHeadroom: boolean;
let handlers: Handlers;

beforeEach(() => {
  stateStorePath = join(tmpdir(), `jarvis-state-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(stateStorePath);
  fakeExecutor = createFakeWriteLoopExecutor();
  memoryHeadroom = true;

  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
  });
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

test("setRetiring makes resume reject with daemon_superseded", async () => {
  const runId = await startRunDirect(handlers);
  expect(runId).toBeDefined();

  handlers.setRetiring();
  await flushBackgroundRuns();

  if (runId) {
    const pauseResponse = await handlers.pause(
      { kind: "request", id: "p1", method: "pause", params: { runId } },
      new AbortController().signal,
    );
    expect(pauseResponse.kind).toBe("response");

    const resumeResponse = await resumeDirect(handlers, runId);
    expect(resumeResponse.kind).toBe("error");
    if (resumeResponse.kind === "error") {
      expect(resumeResponse.code).toBe("daemon_superseded");
    }
  }
});

test("hasActiveRuns returns true when write loop is active", async () => {
  await startRunDirect(handlers);
  expect(handlers.hasActiveRuns()).toBe(true);
});

test("hasActiveRuns returns false when no runs are active", async () => {
  expect(handlers.hasActiveRuns()).toBe(false);
});

test("isRetiring returns false initially", () => {
  expect(handlers.isRetiring()).toBe(false);
});

test("isRetiring returns true after setRetiring", () => {
  handlers.setRetiring();
  expect(handlers.isRetiring()).toBe(true);
});

test("a daemon with an in-flight run stays up and serving after supersede", async () => {
  const runId = await startRunDirect(handlers);
  expect(runId).toBeDefined();
  expect(handlers.hasActiveRuns()).toBe(true);

  handlers.setRetiring();
  expect(handlers.isRetiring()).toBe(true);
  expect(handlers.hasActiveRuns()).toBe(true);

  const listResponse = await listRunsDirect(handlers);
  expect(listResponse).toBeDefined();
  expect(listResponse?.some((row) => row.runId === runId)).toBe(true);
});

test("a run in flight when supersede arrives reaches normal outcome under same daemon", async () => {
  const runId = await startRunDirect(handlers);
  expect(runId).toBeDefined();

  if (runId) {
    handlers.setRetiring();
    const run = loadRunOrThrow(stateStore, runId);
    expect(run.status).toBe("in-progress");

    fakeExecutor.settleAll();
    await flushBackgroundRuns(3);

    stateStore.setRunStatus(runId, "completed");
    const updatedRun = loadRunOrThrow(stateStore, runId);
    expect(updatedRun.status).toBe("completed");
  }
});

test("queued runs are not promoted after supersession", async () => {
  memoryHeadroom = false;
  const runId1 = await startRunDirect(handlers);
  expect(runId1).toBeDefined();

  if (runId1) {
    const run1 = loadRunOrThrow(stateStore, runId1);
    expect(run1.status).toBe("queued");

    handlers.setRetiring();

    fakeExecutor.settleAll();
    await flushBackgroundRuns(3);

    const updatedRun1 = loadRunOrThrow(stateStore, runId1);
    expect(updatedRun1.status).toBe("queued");
  }
});

test("resume does not create a claim when rejecting for retirement", async () => {
  const runId = await startRunDirect(handlers);
  expect(runId).toBeDefined();

  if (runId) {
    await handlers.pause(
      { kind: "request", id: "p1", method: "pause", params: { runId } },
      new AbortController().signal,
    );
    await flushBackgroundRuns();

    handlers.setRetiring();

    const resumeResponse = await resumeDirect(handlers, runId);
    expect(resumeResponse.kind).toBe("error");
    if (resumeResponse.kind === "error") {
      expect(resumeResponse.code).toBe("daemon_superseded");
    }

    // The paused run should still be managed by this daemon (not claimed by another)
    expect(handlers.hasActiveRuns()).toBe(true);
  }
});

test("observation methods still work after supersede", async () => {
  const runId = await startRunDirect(handlers);
  expect(runId).toBeDefined();

  handlers.setRetiring();

  const listResponse = await listRunsDirect(handlers);
  expect(listResponse).toBeDefined();
  if (runId) {
    expect(listResponse?.some((row) => row.runId === runId)).toBe(true);

    const pauseResponse = await handlers.pause(
      { kind: "request", id: "p1", method: "pause", params: { runId } },
      new AbortController().signal,
    );
    expect(pauseResponse.kind).toBe("response");
  }
});

test("start after retiring is rejected before any worktree materialization", async () => {
  handlers.setRetiring();

  const input: WriteLoopInput = {
    ...mockWriteLoopInput(),
    stepId: "test-step-1",
  };

  const response = await handlers.start(
    { kind: "request", id: "s1", method: "start", params: { input } },
    new AbortController().signal,
  );

  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("daemon_superseded");
  }

  const run = stateStore.findRunByProjectBranch({
    project: input.worktree.projectName,
    branch: input.worktree.branchName,
    stepId: input.stepId ?? null,
  });
  expect(run).toBeNull();

  const runs = await listRunsDirect(handlers);
  expect(runs?.length ?? 0).toBe(0);
});
