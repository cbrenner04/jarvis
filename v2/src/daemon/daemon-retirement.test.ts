import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLogReader } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, mockWriteLoopInput, startRunDirect } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

async function resumeDirect(h: Handlers, runId: string) {
  return h.resume({ kind: "request", id: "r1", method: "resume", params: { runId } }, new AbortController().signal);
}

async function startWriteLoopDirect(h: Handlers) {
  return h.start(
    { kind: "request", id: "s1", method: "start", params: { input: mockWriteLoopInput() } },
    new AbortController().signal,
  );
}

let stateStore: StateStore;
let stateStorePath: string;
let logsPath: string;
let fakeExecutor: FakeWriteLoopExecutor;
let retiring: boolean;
let retiredAndIdleCalled: boolean;
let handlers: Handlers;

beforeEach(() => {
  stateStorePath = join(tmpdir(), `jarvis-state-${process.pid}-${Date.now()}.db`);
  logsPath = join(tmpdir(), `jarvis-logs-${process.pid}-${Date.now()}.jsonl`);
  stateStore = openStateStore(stateStorePath);
  fakeExecutor = createFakeWriteLoopExecutor();
  retiring = false;
  retiredAndIdleCalled = false;

  handlers = createRunControlHandlers({
    stateStore,
    logReader: openLogReader(logsPath),
    logsPath,
    operatorSessionId: "test-session",
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
    isRetiring: () => retiring,
    onRetiredAndIdle: () => {
      retiredAndIdleCalled = true;
    },
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

test("start write-loop rejects daemon_superseded when retiring", async () => {
  retiring = true;

  const response = await startWriteLoopDirect(handlers);
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("daemon_superseded");
  }
});

test("start workflow rejects daemon_superseded when retiring", async () => {
  retiring = true;

  const response = await handlers.start(
    {
      kind: "request",
      id: "s1",
      method: "start",
      params: {
        steps: [
          {
            stepId: "step-0",
            behavior: "write" as const,
            role: "implement" as const,
            worktree: { projectName: "test", branchName: "test", baseRef: "main", projectRoot: "/tmp" },
          },
        ],
      },
    },
    new AbortController().signal,
  );
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("daemon_superseded");
  }
});

test("resume rejects daemon_superseded when retiring", async () => {
  const runId = await startRunDirect(handlers);
  expect(runId).toBeDefined();
  if (!runId) return;

  retiring = true;

  const response = await resumeDirect(handlers, runId);
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("daemon_superseded");
  }
});

test("list still answers after retiring", async () => {
  await startRunDirect(handlers);
  retiring = true;

  const response = await handlers.list({ kind: "request", id: "l1", method: "list" }, new AbortController().signal);
  expect(response.kind).toBe("response");
});

test("pause still answers after retiring", async () => {
  const runId = await startRunDirect(handlers);
  expect(runId).toBeDefined();
  if (!runId) return;

  retiring = true;

  const response = await handlers.pause(
    { kind: "request", id: "p1", method: "pause", params: { runId } },
    new AbortController().signal,
  );
  expect(response.kind).toBe("response");
});

test("daemon is idle after supersede when no runs in flight", async () => {
  retiring = true;
  expect(handlers.getIsIdle()).toBe(true);
});

test("daemon is not idle when run is in flight", async () => {
  await startRunDirect(handlers);
  expect(handlers.getIsIdle()).toBe(false);
});

test("onRetiredAndIdle is called when daemon becomes idle while retiring", async () => {
  await startRunDirect(handlers);
  expect(handlers.getIsIdle()).toBe(false);

  retiring = true;

  // Settle the pending run to make daemon idle
  fakeExecutor.settleFirst();
  await flushBackgroundRuns();

  expect(retiredAndIdleCalled).toBe(true);
});

test("start creates no durable run row when retiring", async () => {
  retiring = true;

  const response = await startWriteLoopDirect(handlers);
  expect(response.kind).toBe("error");

  // Verify no run row was created
  const allRuns = stateStore.listRuns();
  expect(allRuns.length).toBe(0);
});

test("start creates no worktree claim when retiring", async () => {
  retiring = true;

  const response = await startWriteLoopDirect(handlers);
  expect(response.kind).toBe("error");

  // Daemon should still be idle with no claims
  expect(handlers.getIsIdle()).toBe(true);
});

test("run continues when supersede arrives mid-flight", async () => {
  await startRunDirect(handlers);
  expect(handlers.getIsIdle()).toBe(false);

  retiring = true;
  expect(retiredAndIdleCalled).toBe(false);

  // Run should still settle normally
  fakeExecutor.settleFirst();
  await flushBackgroundRuns();

  // After settling, daemon becomes idle and onRetiredAndIdle is called
  expect(handlers.getIsIdle()).toBe(true);
  expect(retiredAndIdleCalled).toBe(true);
});
