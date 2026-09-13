import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { listOwnedRunsDirect, listRunsDirect, mockWriteLoopInput, startRunDirect } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let handlers: Handlers;

beforeEach(() => {
  const stateStorePath = join(tmpdir(), `jarvis-list-owned-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(stateStorePath);
  fakeExecutor = createFakeWriteLoopExecutor();
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
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

async function dismissDirect(h: Handlers, runId: string) {
  return h.dismiss({ kind: "request", id: "d1", method: "dismiss", params: { runId } }, new AbortController().signal);
}

test("list_owned returns every currently-live row, unfiltered by dismissal, unlike the default public list", async () => {
  const runId = await startRunDirect(handlers, mockWriteLoopInput({ projectName: "p1" }));
  if (runId === undefined) throw new Error("run did not start");
  await dismissDirect(handlers, runId);

  const publicRows = await listRunsDirect(handlers);
  expect(publicRows?.find((row) => row.runId === runId)).toBeUndefined();

  const ownedRows = await listOwnedRunsDirect(handlers);
  const ownedRow = ownedRows?.find((row) => row.runId === runId);
  expect(ownedRow?.isLive).toBe(true);
});

test("list_owned ignores request-shaped selection: no project filter and no limit, unlike the public filtered/limited list path", async () => {
  const runA = await startRunDirect(handlers, mockWriteLoopInput({ projectName: "p1" }));
  const runB = await startRunDirect(handlers, mockWriteLoopInput({ projectName: "p2" }));
  if (runA === undefined || runB === undefined) throw new Error("run did not start");

  // The public handler's filtered path (any dimension filter set) caps the response to `limit`.
  const filteredPublicRows = await listRunsDirect(handlers, { project: "p1", limit: 1 });
  expect(filteredPublicRows?.length).toBe(1);

  // `list_owned` takes no params: every currently-live row across every project comes back.
  const ownedRows = await listOwnedRunsDirect(handlers);
  const ownedIds = new Set(ownedRows?.map((row) => row.runId) ?? []);
  expect(ownedIds.has(runA)).toBe(true);
  expect(ownedIds.has(runB)).toBe(true);
});

test("list_owned excludes a run this daemon does not currently hold live", async () => {
  const terminalRunId = stateStore.createRun({
    project: "proj",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "br",
    specPath: "/tmp/spec.md",
    status: "completed",
  });

  const ownedRows = await listOwnedRunsDirect(handlers);
  expect(ownedRows?.find((row) => row.runId === terminalRunId)).toBeUndefined();
});

test("list_owned excludes a durably in-progress row this daemon never admitted into activeRuns", async () => {
  // Both status and activeRuns membership must hold: a row reading "in-progress" that this
  // daemon's own registry never claimed (the shape a predecessor-held run takes) is not "its own".
  const orphanRunId = stateStore.createRun({
    project: "proj",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "br",
    specPath: "/tmp/spec.md",
    status: "in-progress",
  });

  const ownedRows = await listOwnedRunsDirect(handlers);
  expect(ownedRows?.find((row) => row.runId === orphanRunId)).toBeUndefined();
});

test("live_run_ids reports only currently-live run ids, without the list projection", async () => {
  const liveRunId = await startRunDirect(handlers, mockWriteLoopInput({ projectName: "p1" }));
  if (liveRunId === undefined) throw new Error("run did not start");
  const terminalRunId = stateStore.createRun({
    project: "proj",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "br",
    specPath: "/tmp/spec.md",
    status: "completed",
  });

  const response = await handlers.live_run_ids(
    { kind: "request", id: "l1", method: "live_run_ids" },
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { runIds: [liveRunId] } });
  expect(terminalRunId).not.toBe(liveRunId);
});
