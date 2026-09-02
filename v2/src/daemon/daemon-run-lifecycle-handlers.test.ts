import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, mockWriteLoopInput } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let memoryHeadroom: boolean;

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-lifecycle-${process.pid}-${Date.now()}.db`));
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

function lifecycleHandlers() {
  const ctx = createRunControlHandlerContext({
    stateStore,
    logReader: { tail: () => [], async *follow() {} },
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    settleDelayMs: 0,
  });
  const handlers = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: () => ({ kind: "error", code: "invalid_params", message: "steps unsupported in test" }),
  });
  return { ctx, handlers };
}

test("start admits a second project while another run is active", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const input = mockWriteLoopInput();

  const first = await handlers.start({ kind: "request", id: "s1", method: "start", params: { input } }, signal);
  expect(first.kind).toBe("response");

  const second = await handlers.start(
    {
      kind: "request",
      id: "s2",
      method: "start",
      params: { input: mockWriteLoopInput({ projectName: "other-project", branchName: "other-branch" }) },
    },
    signal,
  );
  expect(second.kind).toBe("response");
});

test("list projects live in-progress runs", async () => {
  const { handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const started = await handlers.start(
    { kind: "request", id: "s1", method: "start", params: { input: mockWriteLoopInput() } },
    signal,
  );
  expect(started.kind).toBe("response");
  if (started.kind !== "response") return;

  const listed = await handlers.list({ kind: "request", id: "l1", method: "list" }, signal);
  expect(listed.kind).toBe("response");
  if (listed.kind !== "response") return;

  const runs = (listed.result as { runs: Array<{ runId: string; isLive: boolean; status: string }> }).runs;
  const row = runs.find((candidate) => candidate.runId === (started.result as { runId: string }).runId);
  expect(row).toMatchObject({ status: "in-progress", isLive: true });
});

test("pause and kill release write-loop ownership", async () => {
  const { ctx, handlers } = lifecycleHandlers();
  const signal = new AbortController().signal;
  const input = mockWriteLoopInput({ projectName: "pause-kill", branchName: "pause-kill" });
  const started = await handlers.start({ kind: "request", id: "s1", method: "start", params: { input } }, signal);
  expect(started.kind).toBe("response");
  if (started.kind !== "response") return;
  const runId = (started.result as { runId: string }).runId;

  const paused = await handlers.pause({ kind: "request", id: "p1", method: "pause", params: { runId } }, signal);
  expect(paused).toEqual({ kind: "response", result: { ok: true } });
  expect(fakeExecutor.isPauseSignalTriggered()).toBe(true);

  const killed = await handlers.kill({ kind: "request", id: "k1", method: "kill", params: { runId } }, signal);
  expect(killed).toEqual({ kind: "response", result: { ok: true } });
  await flushBackgroundRuns();

  expect(ctx.registry.isClaimed({ project: "pause-kill", branch: "pause-kill" })).toBe(false);
});
