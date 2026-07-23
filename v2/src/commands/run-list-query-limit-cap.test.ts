import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { listRunsDirect } from "../testing/run-control.ts";
import { createRunControlHandlers } from "../daemon/daemon.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let dbPath: string;
let stateStore: StateStore;
let handlers: Handlers;

function seedRun(
  store: StateStore,
  overrides: {
    status?: "completed" | "paused" | "in-progress" | "queued" | "failed" | "blocked" | "budget-soft-stopped";
    createdAt?: number;
    project?: string;
    branch?: string;
  } = {},
): string {
  const runId = store.createRun({
    project: overrides.project ?? "proj",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: overrides.branch ?? "br",
    specPath: "/tmp/spec.md",
    status: overrides.status ?? "completed",
  });
  if (overrides.createdAt !== undefined) {
    const db = new Database(dbPath);
    db.prepare("UPDATE runs SET created_at = ? WHERE id = ?").run(overrides.createdAt, runId);
    db.close();
  }
  return runId;
}

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-limit-${process.pid}-${Date.now()}.db`);
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

test("filtered query with --limit returns at most N newest matching rows", async () => {
  for (let i = 0; i < 300; i++) {
    seedRun(stateStore, { status: "completed", createdAt: i });
  }

  const runs = await listRunsDirect(handlers, { sinceMs: 50, limit: 100 });
  expect(runs).toHaveLength(100);
  const createdAts = runs?.map((r) => {
    const run = stateStore.loadRun(r.runId);
    return run?.createdAt ?? 0;
  }) ?? [];
  const maxCreatedAt = Math.max(...createdAts);
  for (const createdAt of createdAts) {
    expect(createdAt).toBeGreaterThanOrEqual(maxCreatedAt - 99);
  }
});

test("filtered query without --limit applies default 200 cap", async () => {
  for (let i = 0; i < 300; i++) {
    seedRun(stateStore, { status: "completed", createdAt: i });
  }

  const runs = await listRunsDirect(handlers, { sinceMs: 50 });
  expect(runs).toHaveLength(200);
});

test("bare list without filter uses retainListedRuns policy", async () => {
  const nonTerminalIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    nonTerminalIds.push(seedRun(stateStore, { status: "paused", createdAt: i, project: `non-term-${i}` }));
  }

  for (let i = 0; i < 55; i++) {
    seedRun(stateStore, { status: "completed", createdAt: 1000 + i });
  }

  const runs = await listRunsDirect(handlers);
  expect(runs).toHaveLength(60);
  for (const id of nonTerminalIds) {
    expect(runs?.some((r) => r.runId === id)).toBe(true);
  }
  const terminalRuns = runs?.filter((r) => r.status === "completed") ?? [];
  expect(terminalRuns).toHaveLength(50);
});

test("bare --limit alone does not apply default cap", async () => {
  for (let i = 0; i < 10; i++) {
    seedRun(stateStore, { status: "paused", createdAt: i, project: `non-term-${i}` });
  }

  for (let i = 0; i < 55; i++) {
    seedRun(stateStore, { status: "completed", createdAt: 1000 + i });
  }

  const runs = await listRunsDirect(handlers, { limit: 30 });
  expect(runs).toHaveLength(60);
  const terminalRuns = runs?.filter((r) => r.status === "completed") ?? [];
  expect(terminalRuns).toHaveLength(50);
});

test("filtered query with explicit limit smaller than default cap", async () => {
  for (let i = 0; i < 250; i++) {
    seedRun(stateStore, { status: "completed", createdAt: i });
  }

  const runs = await listRunsDirect(handlers, { sinceMs: 0, limit: 50 });
  expect(runs).toHaveLength(50);
});

test("filtered query with explicit limit larger than default cap", async () => {
  for (let i = 0; i < 300; i++) {
    seedRun(stateStore, { status: "completed", createdAt: i });
  }

  const runs = await listRunsDirect(handlers, { sinceMs: 0, limit: 250 });
  expect(runs).toHaveLength(250);
});

test("filtered query returns newest matching rows first", async () => {
  for (let i = 0; i < 300; i++) {
    seedRun(stateStore, { status: "completed", createdAt: i });
  }

  const runs = await listRunsDirect(handlers, { sinceMs: 0, limit: 50 });
  const createdAts = runs?.map((r) => {
    const run = stateStore.loadRun(r.runId);
    return run?.createdAt ?? 0;
  }) ?? [];
  const sorted = [...createdAts].sort((a, b) => b - a);
  expect(createdAts).toEqual(sorted);
});
