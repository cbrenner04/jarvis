import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getExternalWorktreePath } from "../execution/external-worktree.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { listRunsDirect, mockWriteLoopInput, startRunDirect } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import {
  createRunControlHandlers,
  type OwnershipKey,
  type PromoteQueuedRunDeps,
  promoteQueuedRunImpl,
  WorktreeOwnershipRegistry,
} from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let stateStore: StateStore;
let handlers: Handlers;
let fakeExecutor: FakeWriteLoopExecutor;
let memoryHeadroom: boolean;

async function flushBackgroundRuns(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function startRunDirectExpectingId(handlers: Handlers, input: WriteLoopInput): Promise<string> {
  const runId = await startRunDirect(handlers, input);
  expect(runId).toBeDefined();
  if (runId === undefined) throw new Error("expected startRunDirect to return a runId");
  return runId;
}

function startHandlers(settleDelayMs: number): void {
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs,
  });
}

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-state-queue-promotion-${process.pid}-${Date.now()}.db`));
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

function createUnitStore(): { store: StateStore; dbPath: string } {
  const dbPath = join(tmpdir(), `jarvis-state-queue-promotion-unit-${process.pid}-${Date.now()}-${Math.random()}.db`);
  return { store: openStateStore(dbPath), dbPath };
}

function createFakeSpawnWriteLoop(registry: WorktreeOwnershipRegistry) {
  const calls: Array<{ key: OwnershipKey; runId: string; worktreePath: string }> = [];
  const spawnWriteLoop = (key: OwnershipKey, runId: string, worktreePath: string): void => {
    calls.push({ key, runId, worktreePath });
    registry.claim(key, { runId, worktreePath });
  };
  return { spawnWriteLoop, calls };
}

function queueRun(store: StateStore, input: WriteLoopInput): string {
  return store.createRun({
    project: input.worktree.projectName,
    specRef: input.worktree.baseRef,
    worktreePath: getExternalWorktreePath(input.worktree),
    branch: input.worktree.branchName,
    specPath: input.specPath,
    status: "queued",
    queuedInput: input,
  });
}

function createPromotionHarness(
  overrides: Partial<Pick<PromoteQueuedRunDeps, "checkMemoryHeadroom" | "settleDelayMs">> = {},
) {
  const { store, dbPath } = createUnitStore();
  const registry = new WorktreeOwnershipRegistry();
  const { spawnWriteLoop, calls } = createFakeSpawnWriteLoop(registry);
  const deps: PromoteQueuedRunDeps = {
    store,
    registry,
    checkMemoryHeadroom: () => true,
    settleDelayMs: () => 0,
    settleState: { suppressedUntil: 0 },
    spawnWriteLoop,
    ...overrides,
  };
  return {
    store,
    registry,
    calls,
    deps,
    promote: (bypassSettleDelay?: boolean) => promoteQueuedRunImpl(deps, bypassSettleDelay),
    cleanup: (): void => {
      store.close();
      rmSync(dbPath, { force: true });
    },
  };
}

test("promoteQueuedRunImpl promotes the oldest queued run before a younger one", () => {
  const { store, calls, promote, cleanup } = createPromotionHarness();
  try {
    const runIdA = queueRun(store, mockWriteLoopInput({ projectName: "project-a" }));
    const runIdB = queueRun(store, mockWriteLoopInput({ projectName: "project-b" }));

    promote();

    expect(store.loadRun(runIdA)?.status).toBe("in-progress");
    expect(store.loadRun(runIdB)?.status).toBe("queued");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.runId).toBe(runIdA);
  } finally {
    cleanup();
  }
});

test("promoteQueuedRunImpl leaves a queued run queued while memory stays below the watermark", () => {
  const { store, calls, promote, cleanup } = createPromotionHarness({ checkMemoryHeadroom: () => false });
  try {
    const runId = queueRun(store, mockWriteLoopInput({ projectName: "project-a" }));

    promote();

    expect(store.loadRun(runId)?.status).toBe("queued");
    expect(calls).toHaveLength(0);
  } finally {
    cleanup();
  }
});

test("promoteQueuedRunImpl skips a queued run whose key is claimed in favor of the next-oldest eligible run", () => {
  const { store, registry, calls, promote, cleanup } = createPromotionHarness();
  try {
    const liveInput = mockWriteLoopInput({ projectName: "project-live" });
    const liveKey: OwnershipKey = { project: liveInput.worktree.projectName, branch: liveInput.worktree.branchName };
    registry.claim(liveKey, { runId: "live-run", worktreePath: getExternalWorktreePath(liveInput.worktree) });

    const blockedQueuedId = queueRun(store, liveInput);
    const eligibleQueuedId = queueRun(store, mockWriteLoopInput({ projectName: "project-eligible" }));

    promote();

    expect(store.loadRun(eligibleQueuedId)?.status).toBe("in-progress");
    expect(store.loadRun(blockedQueuedId)?.status).toBe("queued");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.runId).toBe(eligibleQueuedId);
  } finally {
    cleanup();
  }
});

test("promoteQueuedRunImpl withholds promotion while the settle delay is active", () => {
  const { store, calls, deps, promote, cleanup } = createPromotionHarness({ settleDelayMs: () => 100_000 });
  try {
    const runIdA = queueRun(store, mockWriteLoopInput({ projectName: "project-settle-a" }));
    const runIdB = queueRun(store, mockWriteLoopInput({ projectName: "project-settle-b" }));

    promote();
    expect(store.loadRun(runIdA)?.status).toBe("in-progress");
    expect(deps.settleState.suppressedUntil).toBeGreaterThan(Date.now());

    promote();
    expect(store.loadRun(runIdB)?.status).toBe("queued");
    expect(calls).toHaveLength(1);
  } finally {
    cleanup();
  }
});

test("promoting one queued run does not touch an already-running run when headroom later reports insufficient", async () => {
  startHandlers(100_000);

  const runningId = await startRunDirectExpectingId(handlers, mockWriteLoopInput({ projectName: "project-running" }));

  memoryHeadroom = false;
  const queuedId = await startRunDirectExpectingId(handlers, mockWriteLoopInput({ projectName: "project-queued" }));
  expect(stateStore.loadRun(queuedId)?.status).toBe("queued");

  memoryHeadroom = true;
  // A start on a distinct, unrelated key admits directly and triggers the post-admit
  // promotion check; project-running is never touched by it.
  await startRunDirect(handlers, mockWriteLoopInput({ projectName: "project-trigger" }));
  await flushBackgroundRuns();

  expect(stateStore.loadRun(queuedId)?.status).toBe("in-progress");
  expect(stateStore.loadRun(runningId)?.status).toBe("in-progress");

  // Memory now drops below the watermark again; project-running's status must never
  // change as a side effect of headroom checks — there is no preemption.
  memoryHeadroom = false;
  await flushBackgroundRuns();
  expect(stateStore.loadRun(runningId)?.status).toBe("in-progress");
});

test("a start that queues because memory is briefly tight is promoted immediately once memory has already recovered", async () => {
  let calls = 0;
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    // Reports no headroom for the initial admission check, then recovered for the
    // immediate recheck performed right after the row is persisted.
    hasMemoryHeadroom: () => {
      calls += 1;
      return calls > 1;
    },
    settleDelayMs: 0,
  });

  const runId = await startRunDirectExpectingId(handlers, mockWriteLoopInput({ projectName: "project-recovering" }));
  await flushBackgroundRuns();

  expect(stateStore.loadRun(runId)?.status).toBe("in-progress");
});

test("a run reaching a paused status frees its key for promotion of an eligible queued run", async () => {
  startHandlers(0);

  const pausedKey = mockWriteLoopInput({ projectName: "project-pausing" });
  const pausingRunId = await startRunDirectExpectingId(handlers, pausedKey);

  memoryHeadroom = false;
  const queuedId = await startRunDirectExpectingId(handlers, mockWriteLoopInput({ projectName: "project-queued-2" }));
  expect(stateStore.loadRun(queuedId)?.status).toBe("queued");

  memoryHeadroom = true;
  stateStore.setRunStatus(pausingRunId, "paused");
  fakeExecutor.settleFirst();
  await flushBackgroundRuns();

  expect(stateStore.loadRun(queuedId)?.status).toBe("in-progress");
});

test("list reports a promoted run as in-progress and live", async () => {
  startHandlers(0);

  memoryHeadroom = false;
  const queuedId = await startRunDirect(handlers, mockWriteLoopInput({ projectName: "project-list" }));

  memoryHeadroom = true;
  await startRunDirect(handlers, mockWriteLoopInput({ projectName: "project-trigger-list" }));
  await flushBackgroundRuns();

  const runs = await listRunsDirect(handlers);
  const row = runs?.find((candidate) => candidate.runId === queuedId);
  expect(row?.status).toBe("in-progress");
  expect(row?.isLive).toBe(true);
});
