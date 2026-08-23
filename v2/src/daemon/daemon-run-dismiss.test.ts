import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunStatus, StateStore, WorkflowSnapshot } from "../persistence/state-store.ts";
import { openStateStore } from "../persistence/state-store.ts";
import {
  flushBackgroundRuns,
  listRunsDirect,
  loadRunOrThrow,
  mockWriteLoopInput,
  startRunDirect,
  workflowSnapshot,
} from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
import type { DaemonListRunRow } from "./daemon-wire.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;
type DismissalResult = { kind: "response"; result: unknown } | { kind: "error"; code: string; message: string };

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

async function dismissDirect(h: Handlers, runId?: string): Promise<DismissalResult> {
  return h.dismiss(
    requestFrame("d", "dismiss", runId === undefined ? {} : { runId }),
    new AbortController().signal,
  ) as Promise<DismissalResult>;
}

async function undismissDirect(h: Handlers, runId?: string): Promise<DismissalResult> {
  return h.undismiss(
    requestFrame("u", "undismiss", runId === undefined ? {} : { runId }),
    new AbortController().signal,
  ) as Promise<DismissalResult>;
}

let dbPath: string;
let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let handlers: Handlers;

function seedRun(
  store: StateStore,
  overrides: {
    status?: RunStatus;
    createdAt?: number;
    project?: string;
    branch?: string;
    stepId?: string;
    workflowSnapshot?: WorkflowSnapshot;
  } = {},
): string {
  const runId = store.createRun({
    project: overrides.project ?? "proj",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: overrides.branch ?? "br",
    specPath: "/tmp/spec.md",
    status: overrides.status ?? "completed",
    ...(overrides.stepId !== undefined ? { stepId: overrides.stepId } : {}),
    ...(overrides.workflowSnapshot !== undefined ? { workflowSnapshot: overrides.workflowSnapshot } : {}),
  });
  if (overrides.createdAt !== undefined) {
    const db = new Database(dbPath);
    db.prepare("UPDATE runs SET created_at = ? WHERE id = ?").run(overrides.createdAt, runId);
    db.close();
  }
  return runId;
}

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-run-dismiss-${process.pid}-${Date.now()}-${Math.random()}.db`);
  stateStore = openStateStore(dbPath);
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
  await flushBackgroundRuns();
  try {
    stateStore.close();
  } catch {
    // already closed
  }
});

test("dismissed runs drop out of the default list", async () => {
  const runA = seedRun(stateStore, { status: "completed" });
  const runB = seedRun(stateStore, { status: "completed" });

  const dismissResponse = await dismissDirect(handlers, runA);
  expect(dismissResponse).toEqual({ kind: "response", result: { kind: "applied", runId: runA, status: "completed" } });

  // @mutate v2/src/daemon/daemon.ts "includeDismissed || (run.dismissedAt ?? null) === null" -> "true"
  const runs = await listRunsDirect(handlers);
  const ids = runs?.map((row) => row.runId);
  expect(ids).toContain(runB);
  expect(ids).not.toContain(runA);
});

test("includeDismissed returns dismissed runs with dismissedAt set", async () => {
  const runA = seedRun(stateStore, { status: "completed" });
  const runB = seedRun(stateStore, { status: "completed" });
  await dismissDirect(handlers, runA);

  const defaultRuns = await listRunsDirect(handlers);
  const bRowDefault = defaultRuns?.find((row) => row.runId === runB);
  if (!bRowDefault) throw new Error("expected the non-dismissed sibling in the default listing");

  // @mutate v2/src/daemon/daemon.ts "listParams?.includeDismissed === true" -> "false"
  const includeDismissedRuns = await listRunsDirect(handlers, { includeDismissed: true });
  const aRow = includeDismissedRuns?.find((row) => row.runId === runA);
  const bRow = includeDismissedRuns?.find((row) => row.runId === runB);
  if (!aRow || !bRow) throw new Error("expected both runs in the includeDismissed listing");
  expect(aRow.dismissedAt).toEqual(expect.any(Number));
  expect(bRow.dismissedAt).toBeNull();
  expect(bRow).toEqual(bRowDefault);
});

test("includeDismissed reads strict === true, a truthy non-boolean value does not opt in", async () => {
  const runA = seedRun(stateStore, { status: "completed" });
  await dismissDirect(handlers, runA);

  const response = await handlers.list(
    requestFrame("l", "list", { includeDismissed: "true" }),
    new AbortController().signal,
  );
  expect(response.kind).toBe("response");
  const ids = (response as { result: { runs: DaemonListRunRow[] } }).result.runs.map((row) => row.runId);
  expect(ids).not.toContain(runA);
});

test("undismiss returns applied with status and restores the default listing", async () => {
  const runId = seedRun(stateStore, { status: "completed" });
  await dismissDirect(handlers, runId);

  const response = await undismissDirect(handlers, runId);
  expect(response).toEqual({ kind: "response", result: { kind: "applied", runId, status: "completed" } });

  const runs = await listRunsDirect(handlers);
  const restored = runs?.find((row) => row.runId === runId);
  if (!restored) throw new Error("expected the undismissed run back in the default listing");
  expect(restored.dismissedAt).toBeNull();
});

test("undismiss on a never-dismissed run also returns applied and leaves dismissed_at null", async () => {
  const runId = seedRun(stateStore, { status: "completed" });

  const response = await undismissDirect(handlers, runId);
  expect(response).toEqual({ kind: "response", result: { kind: "applied", runId, status: "completed" } });
  expect(stateStore.loadRun(runId)?.dismissedAt).toBeNull();
});

test("a repeat dismiss stays applied and leaves the original dismissedAt unchanged", async () => {
  const runId = seedRun(stateStore, { status: "completed" });

  const first = await dismissDirect(handlers, runId);
  expect(first).toEqual({ kind: "response", result: { kind: "applied", runId, status: "completed" } });
  const firstDismissedAt = stateStore.loadRun(runId)?.dismissedAt;

  const second = await dismissDirect(handlers, runId);
  expect(second).toEqual({ kind: "response", result: { kind: "applied", runId, status: "completed" } });

  const runs = await listRunsDirect(handlers, { includeDismissed: true });
  const found = runs?.find((row) => row.runId === runId);
  expect(found?.dismissedAt).toBe(firstDismissedAt);
});

test("a dismissed run does not consume a terminal retention slot", async () => {
  const terminalIds: string[] = [];
  for (let index = 0; index < 51; index++) {
    terminalIds.push(seedRun(stateStore, { status: "completed", createdAt: index }));
  }
  // Index 0 is the oldest and normally falls outside the 50-newest window.
  const evictedId = terminalIds[0] as string;
  // Dismiss one of the 50 newest runs (index 25).
  const dismissedId = terminalIds[25] as string;
  await dismissDirect(handlers, dismissedId);

  // @mutate v2/src/daemon/daemon.ts "applyRetention(store.listRuns().filter(isNotDismissed))" -> "applyRetention(store.listRuns()).filter(isNotDismissed)"
  const runs = await listRunsDirect(handlers);
  expect(runs).toHaveLength(50);
  const ids = runs?.map((row) => row.runId);
  expect(ids).not.toContain(dismissedId);
  expect(ids).toContain(evictedId);
});

test("includeDismissed alone does not bypass terminal retention", async () => {
  for (let index = 0; index < 55; index++) {
    seedRun(stateStore, { status: "completed", createdAt: index });
  }

  // @mutate v2/src/daemon/daemon.ts "listRpcRequestIsFiltered(listParams)" -> "listRpcRequestIsFiltered(listParams) || includeDismissed"
  const runs = await listRunsDirect(handlers, { includeDismissed: true });
  expect(runs).toHaveLength(50);
});

test("a dismissed run is still returned by a filtered list when includeDismissed is set, and omitted without it", async () => {
  const runId = stateStore.createRun({
    project: "proj",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "br",
    specPath: "/tmp/target-spec.md",
    status: "completed",
  });
  await dismissDirect(handlers, runId);

  const withoutOptIn = await listRunsDirect(handlers, { specPath: "/tmp/target-spec.md" });
  expect(withoutOptIn?.map((row) => row.runId)).not.toContain(runId);

  const withOptIn = await listRunsDirect(handlers, { specPath: "/tmp/target-spec.md", includeDismissed: true });
  expect(withOptIn?.map((row) => row.runId)).toContain(runId);
});

test("an unknown run id is refused on dismiss and undismiss", async () => {
  const realRunId = seedRun(stateStore, { status: "completed" });

  // @mutate v2/src/daemon/daemon.ts "if (dismissal.kind === \"refused\") {" -> "if (false) {"
  const dismissResponse = await dismissDirect(handlers, "no-such-run");
  expect(dismissResponse).toEqual({
    kind: "response",
    result: { kind: "refused", runId: "no-such-run", reason: "run_not_found" },
  });

  const undismissResponse = await undismissDirect(handlers, "no-such-run");
  expect(undismissResponse).toEqual({
    kind: "response",
    result: { kind: "refused", runId: "no-such-run", reason: "run_not_found" },
  });

  const runs = await listRunsDirect(handlers);
  expect(runs?.map((row) => row.runId)).toContain(realRunId);
});

test("a missing runId is refused invalid_params on dismiss and undismiss", async () => {
  // @mutate v2/src/daemon/daemon.ts "if (runId.length === 0) {" -> "if (false) {"
  const dismissResponse = await dismissDirect(handlers);
  expect(dismissResponse).toEqual({ kind: "error", code: "invalid_params", message: "runId required" });

  const undismissResponse = await undismissDirect(handlers);
  expect(undismissResponse).toEqual({ kind: "error", code: "invalid_params", message: "runId required" });
});

test("a dismissed sibling step run does not change a surviving entry row's projection", async () => {
  const snapshot: WorkflowSnapshot = workflowSnapshot("wf-dismiss-sibling", [
    { stepId: "step-1", role: "implement" },
    { stepId: "step-2", role: "review" },
  ]);
  const step1Id = seedRun(stateStore, {
    status: "completed",
    project: "wf-sibling",
    branch: "wf-sibling-br",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });
  const step1Attempt = stateStore.recordAttemptStart(step1Id);
  stateStore.commitCompletionBoundary({ attemptId: step1Attempt, runStatus: "completed", outcomeKind: "done" });

  const step2Id = seedRun(stateStore, {
    status: "completed",
    project: "wf-sibling",
    branch: "wf-sibling-br",
    stepId: "step-2",
    workflowSnapshot: snapshot,
  });
  const step2Attempt = stateStore.recordAttemptStart(step2Id);
  stateStore.commitCompletionBoundary({ attemptId: step2Attempt, runStatus: "blocked", outcomeKind: "blocked" });

  const before = await listRunsDirect(handlers);
  const step1RowBefore = before?.find((row) => row.runId === step1Id);
  if (!step1RowBefore) throw new Error("expected the entry row listed before dismissal");

  await dismissDirect(handlers, step2Id);

  // @mutate v2/src/daemon/daemon.ts "indexListedRuns([...indexInputRuns.values()])" -> "indexListedRuns(projectedRuns)"
  const after = await listRunsDirect(handlers);
  const step1RowAfter = after?.find((row) => row.runId === step1Id);
  if (!step1RowAfter) throw new Error("expected the entry row still listed after dismissing its sibling");

  expect(after?.map((row) => row.runId)).not.toContain(step2Id);
  expect(step1RowAfter.workflow).toEqual(step1RowBefore.workflow);
  expect(step1RowAfter.status).toEqual(step1RowBefore.status);
});

test("dismissing a mid-flight run changes only dismissed_at and lets it settle to terminal", async () => {
  const runId = await startRunDirect(
    handlers,
    mockWriteLoopInput({ projectName: "mid-flight-dismiss", branchName: "mid-flight-dismiss" }),
  );
  if (!runId) throw new Error("expected an admitted run id");

  const beforeRun = loadRunOrThrow(stateStore, runId);
  expect(beforeRun.status).toBe("in-progress");

  const dismissResponse = await dismissDirect(handlers, runId);
  expect(dismissResponse).toEqual({ kind: "response", result: { kind: "applied", runId, status: "in-progress" } });

  const afterDismiss = loadRunOrThrow(stateStore, runId);
  expect(afterDismiss.status).toBe(beforeRun.status);
  expect(afterDismiss.attemptCount).toBe(beforeRun.attemptCount);
  expect(afterDismiss.worktreePath).toBe(beforeRun.worktreePath);
  expect(afterDismiss.dismissedAt).toEqual(expect.any(Number));

  const defaultRuns = await listRunsDirect(handlers);
  expect(defaultRuns?.map((row) => row.runId)).not.toContain(runId);

  const includeDismissedRuns = await listRunsDirect(handlers, { includeDismissed: true });
  const liveRow = includeDismissedRuns?.find((row) => row.runId === runId);
  expect(liveRow?.isLive).toBe(true);

  fakeExecutor.settleAll();
  await flushBackgroundRuns();
  const attemptId = stateStore.recordAttemptStart(runId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "completed", outcomeKind: "done" });

  const settledRun = loadRunOrThrow(stateStore, runId);
  expect(settledRun.status).toBe("completed");
  expect(settledRun.dismissedAt).toEqual(expect.any(Number));
});
