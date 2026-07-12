import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowSnapshot } from "../persistence/state-store.ts";
import { openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { listRunsDirect } from "../testing/run-control.ts";
import { createRunControlHandlers } from "./daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let dbPath: string;
let stateStore: StateStore;
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

function workflowSnapshot(invocationId: string, ...steps: Array<{ stepId: string; role: string }>): WorkflowSnapshot {
  return { invocationId, steps };
}

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-retention-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(dbPath);
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
});

afterEach(() => {
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

test("list retains only the 50 newest terminal runs", async () => {
  const terminalIds: string[] = [];
  for (let index = 0; index < 55; index++) {
    terminalIds.push(seedRun(stateStore, { status: "completed", createdAt: index }));
  }

  const runs = await listRunsDirect(handlers);
  const listedTerminalIds = new Set(
    runs?.filter((row) => row.status === "completed").map((row) => row.runId) ?? [],
  );

  expect(listedTerminalIds.size).toBe(50);
  for (let index = 5; index < 55; index++) {
    expect(listedTerminalIds.has(terminalIds[index] as string)).toBe(true);
  }
  for (let index = 0; index < 5; index++) {
    expect(listedTerminalIds.has(terminalIds[index] as string)).toBe(false);
    expect(stateStore.loadRun(terminalIds[index] as string)).not.toBeNull();
  }
});

test("sixty exempt runs plus fifty terminal runs all return from list", async () => {
  for (let index = 0; index < 60; index++) {
    seedRun(stateStore, { status: "paused", createdAt: index, project: `exempt-${index}` });
  }
  for (let index = 0; index < 50; index++) {
    seedRun(stateStore, { status: "completed", createdAt: 100 + index });
  }

  const runs = await listRunsDirect(handlers);
  expect(runs).toHaveLength(110);
});

test("exempt-status runs are always listed and do not consume the terminal bound", async () => {
  const exemptStatuses: RunStatus[] = [
    "in-progress",
    "queued",
    "paused",
    "budget-soft-stopped",
    "awaiting-human",
    "revising",
  ];
  const exemptIds = exemptStatuses.map((status, index) =>
    seedRun(stateStore, { status, createdAt: index, project: `exempt-${status}` }),
  );

  for (let index = 0; index < 50; index++) {
    seedRun(stateStore, { status: "completed", createdAt: 100 + index });
  }

  const runs = await listRunsDirect(handlers);
  expect(runs).toHaveLength(56);
  for (const exemptId of exemptIds) {
    expect(runs?.some((row) => row.runId === exemptId)).toBe(true);
  }
});

test("exempt runs older than every retained terminal run stay listed", async () => {
  const oldExemptId = seedRun(stateStore, { status: "paused", createdAt: 0 });
  for (let index = 1; index <= 55; index++) {
    seedRun(stateStore, { status: "completed", createdAt: index });
  }

  const runs = await listRunsDirect(handlers);
  expect(runs?.some((row) => row.runId === oldExemptId)).toBe(true);
  expect(runs?.filter((row) => row.status === "completed")).toHaveLength(50);
});

test("listed runs stay in global creation order", async () => {
  seedRun(stateStore, { status: "completed", createdAt: 300 });
  seedRun(stateStore, { status: "paused", createdAt: 200 });
  seedRun(stateStore, { status: "failed", createdAt: 100 });

  const runs = await listRunsDirect(handlers);
  expect(runs?.map((row) => row.status)).toEqual(["completed", "paused", "failed"]);
});

test("workflow step runs are retained with a listed invocation", async () => {
  const snapshot = workflowSnapshot("wf-1", { stepId: "step-1", role: "implement" }, { stepId: "step-2", role: "review" });
  const step1Id = seedRun(stateStore, {
    status: "completed",
    createdAt: 1,
    project: "wf",
    branch: "wf-br",
    stepId: "step-1",
    workflowSnapshot: snapshot,
  });
  const step1Attempt = stateStore.recordAttemptStart(step1Id);
  stateStore.commitCompletionBoundary({ attemptId: step1Attempt, runStatus: "completed", outcomeKind: "done" });

  const liveStep2Id = seedRun(stateStore, {
    status: "awaiting-human",
    createdAt: 2,
    project: "wf",
    branch: "wf-br",
    stepId: "step-2",
    workflowSnapshot: snapshot,
  });

  for (let index = 0; index < 60; index++) {
    seedRun(stateStore, { status: "completed", createdAt: 100 + index, project: "noise" });
  }

  const runs = await listRunsDirect(handlers);
  const liveRow = runs?.find((row) => row.runId === liveStep2Id);
  expect(liveRow?.workflow).toEqual({
    steps: [
      { stepId: "step-1", role: "implement", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
      { stepId: "step-2", role: "review", status: "stopped", attemptCount: 0, terminalOutcome: "awaiting-human" },
    ],
  });
  expect(runs?.some((row) => row.runId === step1Id)).toBe(true);
});

test("created_at ties resolve deterministically across repeated list calls", async () => {
  const tiedAt = 42;
  const tiedIds: string[] = [];
  for (let index = 0; index < 55; index++) {
    tiedIds.push(seedRun(stateStore, { status: "completed", createdAt: tiedAt }));
  }

  const first = await listRunsDirect(handlers);
  const second = await listRunsDirect(handlers);
  const firstTerminalIds = first?.filter((row) => row.status === "completed").map((row) => row.runId) ?? [];
  const secondTerminalIds = second?.filter((row) => row.status === "completed").map((row) => row.runId) ?? [];

  expect(firstTerminalIds).toHaveLength(50);
  expect(secondTerminalIds).toEqual(firstTerminalIds);

  const retired = tiedIds.filter((id) => !firstTerminalIds.includes(id));
  expect(retired).toHaveLength(5);
  for (const retiredId of retired) {
    expect(firstTerminalIds.includes(retiredId)).toBe(false);
    expect(secondTerminalIds.includes(retiredId)).toBe(false);
  }
});

test("list loads at most 50 terminal runs when many are retired", async () => {
  for (let index = 0; index < 200; index++) {
    seedRun(stateStore, { status: "completed", createdAt: index });
  }

  let loadRunCalls = 0;
  const originalLoadRun = stateStore.loadRun.bind(stateStore);
  stateStore.loadRun = (runId) => {
    loadRunCalls++;
    return originalLoadRun(runId);
  };

  await listRunsDirect(handlers);
  expect(loadRunCalls).toBe(50);
});
