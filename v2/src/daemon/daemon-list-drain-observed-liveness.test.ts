// Guard coverage for `listHandler`'s merge of `observeOutgoingLiveRunIds` (`daemon-run-control-context.ts`)
// into its `isLive` computation: a run the outgoing generation still holds — not in this daemon's
// own `activeRuns` — must still report `isLive: true` while the outgoing generation reports it
// live, and stop once drain observation no longer does. Real polling over a private endpoint is
// covered in `daemon-drain-observer.test.ts`; this file covers only the `list` merge.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, listRunsDirect, startRunDirect } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";

let stateStore: StateStore;
let stateStorePath: string;
let outgoingExecutor: FakeWriteLoopExecutor;

beforeEach(() => {
  stateStorePath = join(tmpdir(), `jarvis-state-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(stateStorePath);
  outgoingExecutor = createFakeWriteLoopExecutor();
});

afterEach(async () => {
  outgoingExecutor.abortAll();
  await flushBackgroundRuns();
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

test("list reports a run the outgoing generation still holds as live, and stops once drain observation clears it", async () => {
  const outgoingHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: outgoingExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
  const runId = await startRunDirect(outgoingHandlers);
  expect(runId).toBeDefined();
  if (runId === undefined) throw new Error("run did not admit");

  let observedLiveRunIds = new Set([runId]);
  const incomingHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    observeOutgoingLiveRunIds: () => observedLiveRunIds,
  });

  // Not in the incoming generation's own activeRuns, but reported live by drain observation.
  const heldRows = await listRunsDirect(incomingHandlers);
  expect(heldRows?.find((row) => row.runId === runId)?.isLive).toBe(true);

  // Drain observation stops reporting it once the outgoing generation has drained.
  observedLiveRunIds = new Set();
  const drainedRows = await listRunsDirect(incomingHandlers);
  expect(drainedRows?.find((row) => row.runId === runId)?.isLive).toBe(false);
});

test("list reports isLive: false for a run neither locally active nor observed via drain", async () => {
  const outgoingHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: outgoingExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
  const runId = await startRunDirect(outgoingHandlers);
  expect(runId).toBeDefined();

  const incomingHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
  });

  const rows = await listRunsDirect(incomingHandlers);
  expect(rows?.find((row) => row.runId === runId)?.isLive).toBe(false);
});
