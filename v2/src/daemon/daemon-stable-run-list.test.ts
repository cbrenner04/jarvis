import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { listRunsDirect } from "../testing/run-control.ts";
import { createRunControlHandlers } from "./daemon.ts";
import type { DaemonListRunRow } from "./daemon-wire.ts";

type Handlers = ReturnType<typeof createRunControlHandlers>;

let stateStore: StateStore;

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-stable-list-${process.pid}-${Date.now()}.db`));
});

afterEach(() => {
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

function seedInProgressRun(project: string, branch: string): string {
  return stateStore.createRun({
    project,
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch,
    specPath: "/tmp/spec.md",
    status: "in-progress",
  });
}

/** A fully-formed owner row, standing in for a predecessor's `list_owned` response. */
function ownerRowFixture(runId: string, overrides: Partial<DaemonListRunRow> = {}): DaemonListRunRow {
  return {
    runId,
    project: "owner-project",
    branch: "owner-branch",
    status: "in-progress",
    isLive: true,
    createdAt: 1,
    dismissedAt: null,
    prNumber: 4242,
    ...overrides,
  };
}

function handlersWithOwnerRow(ownerRow: (runId: string) => DaemonListRunRow | undefined): Handlers {
  return createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
    ownerRow,
  });
}

test("a direct predecessor's differing live run appears exactly once with the owner's fields and isLive: true", async () => {
  const runId = seedInProgressRun("local-project", "local-branch");
  const owner = ownerRowFixture(runId);
  const handlers = handlersWithOwnerRow((id) => (id === runId ? owner : undefined));

  const runs = await listRunsDirect(handlers);
  const matching = runs?.filter((row) => row.runId === runId) ?? [];

  expect(matching).toHaveLength(1);
  expect(matching[0]?.isLive).toBe(true);
  expect(matching[0]?.prNumber).toBe(4242);
  expect(matching[0]?.project).toBe("owner-project");
});

test("a filtered list request selects or excludes a run using its local durable fields, not the differing owner row", async () => {
  const runId = seedInProgressRun("local-project", "local-branch");
  const owner = ownerRowFixture(runId, { project: "owner-project" });
  const handlers = handlersWithOwnerRow((id) => (id === runId ? owner : undefined));

  const selected = await listRunsDirect(handlers, { project: "local-project" });
  expect(selected?.some((row) => row.runId === runId)).toBe(true);

  const excluded = await listRunsDirect(handlers, { project: "owner-project" });
  expect(excluded?.some((row) => row.runId === runId)).toBe(false);
});

test("a run id present in the ownership directory but absent from local durable candidates is dropped, not appended", async () => {
  const orphanRunId = "owner-only-run-not-in-local-store";
  const handlers = handlersWithOwnerRow((id) => (id === orphanRunId ? ownerRowFixture(orphanRunId) : undefined));

  const runs = await listRunsDirect(handlers);
  expect(runs?.some((row) => row.runId === orphanRunId)).toBe(false);
});
