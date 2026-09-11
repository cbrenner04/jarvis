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

async function dismissParams(h: Handlers, params: Record<string, unknown>): Promise<DismissalResult> {
  return h.dismiss(requestFrame("d", "dismiss", params), new AbortController().signal) as Promise<DismissalResult>;
}

async function undismissParams(h: Handlers, params: Record<string, unknown>): Promise<DismissalResult> {
  return h.undismiss(requestFrame("u", "undismiss", params), new AbortController().signal) as Promise<DismissalResult>;
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

test("dismiss { project } dismisses matched-project and invocation-linked terminal rows, leaving nonterminal rows and activeRuns untouched", async () => {
  const snapshot = workflowSnapshot("inv-bulk-rpc", [
    { stepId: "entry", role: "implement" },
    { stepId: "sibling", role: "review" },
  ]);
  const entryRun = seedRun(stateStore, {
    status: "completed",
    project: "bulk-proj",
    stepId: "entry",
    workflowSnapshot: snapshot,
  });
  // Same invocation, different project: dismissed via invocation expansion, not project match.
  const crossProjectSibling = seedRun(stateStore, {
    status: "failed",
    project: "other-proj",
    branch: "sibling-br",
    stepId: "sibling",
    workflowSnapshot: snapshot,
  });
  const standaloneTerminal = seedRun(stateStore, {
    status: "blocked",
    project: "bulk-proj",
    branch: "standalone",
  });
  const nonTerminalSameInvocation = seedRun(stateStore, {
    status: "in-progress",
    project: "bulk-proj",
    branch: "sibling-live-br",
    stepId: "sibling-live",
    workflowSnapshot: workflowSnapshot("inv-bulk-rpc-live", [{ stepId: "sibling-live", role: "implement" }]),
  });
  const otherProjectTerminal = seedRun(stateStore, { status: "completed", project: "other-proj", branch: "op" });
  const liveRunId = await startRunDirect(
    handlers,
    mockWriteLoopInput({ projectName: "bulk-proj", branchName: "bulk-proj-live" }),
  );
  if (!liveRunId) throw new Error("expected an admitted live run id");

  const response = await dismissParams(handlers, { project: "bulk-proj" });
  expect(response).toEqual({ kind: "response", result: { kind: "applied", dismissedCount: 3 } });

  expect(loadRunOrThrow(stateStore, entryRun).dismissedAt).toEqual(expect.any(Number));
  expect(loadRunOrThrow(stateStore, crossProjectSibling).dismissedAt).toEqual(expect.any(Number));
  expect(loadRunOrThrow(stateStore, standaloneTerminal).dismissedAt).toEqual(expect.any(Number));

  expect(loadRunOrThrow(stateStore, nonTerminalSameInvocation).dismissedAt).toBeNull();
  expect(loadRunOrThrow(stateStore, otherProjectTerminal).dismissedAt).toBeNull();
  expect(loadRunOrThrow(stateStore, liveRunId).dismissedAt).toBeNull();

  const runs = await listRunsDirect(handlers);
  const ids = runs?.map((row) => row.runId);
  expect(ids).toContain(nonTerminalSameInvocation);
  const liveRow = runs?.find((row) => row.runId === liveRunId);
  expect(liveRow?.isLive).toBe(true);

  fakeExecutor.settleAll();
  await flushBackgroundRuns();
  const attemptId = stateStore.recordAttemptStart(liveRunId);
  stateStore.commitCompletionBoundary({ attemptId, runStatus: "completed", outcomeKind: "done" });
});

test("dismiss { project } returns the store-reported dismissedCount beyond default list retention", async () => {
  const terminalIds: string[] = [];
  for (let index = 0; index < 55; index++) {
    terminalIds.push(
      seedRun(stateStore, { project: "retention-proj", branch: `br-${index}`, status: "completed", createdAt: index }),
    );
  }

  const response = await dismissParams(handlers, { project: "retention-proj" });
  expect(response).toEqual({ kind: "response", result: { kind: "applied", dismissedCount: 55 } });

  for (const runId of terminalIds) {
    expect(loadRunOrThrow(stateStore, runId).dismissedAt).toEqual(expect.any(Number));
  }
});

test("dismiss { project } with no matching undismissed terminal rows returns applied dismissedCount 0 and mutates nothing", async () => {
  const runId = seedRun(stateStore, { status: "completed", project: "some-proj" });

  const response = await dismissParams(handlers, { project: "no-match-proj" });
  expect(response).toEqual({ kind: "response", result: { kind: "applied", dismissedCount: 0 } });
  expect(loadRunOrThrow(stateStore, runId).dismissedAt).toBeNull();
});

test("dismiss carrying both runId and project refuses invalid_params and mutates nothing", async () => {
  const runId = seedRun(stateStore, { status: "completed", project: "conflict-proj" });

  const response = await dismissParams(handlers, { runId, project: "conflict-proj" });
  expect(response).toEqual({
    kind: "error",
    code: "invalid_params",
    message: "Provide exactly one of runId or project",
  });
  expect(loadRunOrThrow(stateStore, runId).dismissedAt).toBeNull();
});

test("dismiss carrying neither selector, and an empty project, each refuse invalid_params", async () => {
  const neither = await dismissParams(handlers, {});
  expect(neither).toEqual({ kind: "error", code: "invalid_params", message: "runId required" });

  const emptyProject = await dismissParams(handlers, { project: "" });
  expect(emptyProject).toEqual({ kind: "error", code: "invalid_params", message: "project required" });
});

test("undismiss { project } refuses invalid_params and mutates nothing", async () => {
  const runId = seedRun(stateStore, { status: "completed", project: "undismiss-proj" });
  await dismissDirect(handlers, runId);
  const dismissedAt = loadRunOrThrow(stateStore, runId).dismissedAt;

  const response = await undismissParams(handlers, { project: "undismiss-proj" });
  expect(response).toEqual({
    kind: "error",
    code: "invalid_params",
    message: "undismiss does not accept a project selector",
  });
  expect(loadRunOrThrow(stateStore, runId).dismissedAt).toBe(dismissedAt);
});
