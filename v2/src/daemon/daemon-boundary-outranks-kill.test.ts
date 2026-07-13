import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { listRunsDirect, startRunDirect } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

async function killDirect(h: Handlers, runId: string) {
  return h.kill({ kind: "request", id: "k1", method: "kill", params: { runId } }, new AbortController().signal);
}

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let handlers: Handlers;

function loadRunOrThrow(store: StateStore, runId: string) {
  const run = store.loadRun(runId);
  if (!run) throw new Error(`missing run ${runId}`);
  return run;
}

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-boundary-kill-${process.pid}-${Date.now()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
});

afterEach(async () => {
  fakeExecutor.abortAll();
  await new Promise<void>((resolve) => setImmediate(resolve));
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

test("kill preserves boundary-terminal status on an active run but still aborts", async () => {
  const runId = await startRunDirect(handlers);
  if (!runId) return;

  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "blocked", outcomeKind: "blocked" });

  const killResponse = await killDirect(handlers, runId);
  expect(killResponse.kind).toBe("response");
  expect(fakeExecutor.isAbortSignalTriggered()).toBe(true);
  expect(loadRunOrThrow(stateStore, runId).status).toBe("blocked");

  const runs = await listRunsDirect(handlers);
  expect(runs?.find((row) => row.runId === runId)?.status).toBe("blocked");
});

test("kill still sets killed when the committed boundary is in-progress", async () => {
  const runId = await startRunDirect(handlers);
  if (!runId) return;

  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "in-progress", outcomeKind: "progress" });

  const killResponse = await killDirect(handlers, runId);
  expect(killResponse.kind).toBe("response");
  expect(loadRunOrThrow(stateStore, runId).status).toBe("killed");
});

test("kill still sets killed on a paused run", async () => {
  const runId = await startRunDirect(handlers);
  if (!runId) return;

  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "paused", outcomeKind: "invalid_token" });

  const killResponse = await killDirect(handlers, runId);
  expect(killResponse.kind).toBe("response");
  expect(loadRunOrThrow(stateStore, runId).status).toBe("killed");
});
