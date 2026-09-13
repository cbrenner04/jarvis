import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { listRunsDirect } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let stateStore: StateStore;
let stateStorePath: string;
let fakeExecutor: FakeWriteLoopExecutor;
let externalLiveRunIds: Set<string>;
let handlers: Handlers;

beforeEach(() => {
  stateStorePath = join(tmpdir(), `jarvis-drain-liveness-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(stateStorePath);
  fakeExecutor = createFakeWriteLoopExecutor();
  externalLiveRunIds = new Set<string>();

  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
    externalLiveRunIds: () => externalLiveRunIds,
  });
});

afterEach(() => {
  fakeExecutor.abortAll();
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

/** A durable in-progress row this daemon never admitted — the shape a predecessor-held run takes. */
function seedPredecessorHeldRun(): string {
  return stateStore.createRun({
    project: "predecessor-project",
    specRef: "spec-ref",
    worktreePath: "/tmp/predecessor-worktree",
    branch: "predecessor-branch",
    specPath: "/tmp/predecessor-worktree/spec.md",
    status: "in-progress",
  });
}

test("list reports a run the predecessor generation still holds as live while it is in externalLiveRunIds", async () => {
  const runId = seedPredecessorHeldRun();
  externalLiveRunIds.add(runId);

  const rows = await listRunsDirect(handlers);
  expect(rows?.find((row) => row.runId === runId)?.isLive).toBe(true);
});

test("list stops reporting a predecessor-held run as live once the predecessor has drained it", async () => {
  const runId = seedPredecessorHeldRun();
  externalLiveRunIds.add(runId);

  const liveRows = await listRunsDirect(handlers);
  expect(liveRows?.find((row) => row.runId === runId)?.isLive).toBe(true);

  // The predecessor has drained: the observer no longer reports this run id.
  externalLiveRunIds.delete(runId);

  const drainedRows = await listRunsDirect(handlers);
  expect(drainedRows?.find((row) => row.runId === runId)?.isLive).toBe(false);
});

test("a run this daemon never held and the observer never reported is not live", async () => {
  const runId = seedPredecessorHeldRun();

  const rows = await listRunsDirect(handlers);
  expect(rows?.find((row) => row.runId === runId)?.isLive).toBe(false);
});
