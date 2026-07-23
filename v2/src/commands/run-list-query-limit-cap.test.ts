import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunControlHandlers } from "../daemon/daemon.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { RunStatus, StateStore } from "../persistence/state-store.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { captureIo, cliMain as main, makeIpcClient } from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { listRunsDirect } from "../testing/run-control.ts";

const LIST_REQUEST_ID = "00000000-0000-4000-8000-000000000030";
const NOW_MS = 10_000_000_000_000;

let dbPath: string;
let stateStore: StateStore;
let handlers: ReturnType<typeof createRunControlHandlers>;

function seedRun(
  store: StateStore,
  overrides: {
    status?: RunStatus;
    createdAt?: number;
  } = {},
): string {
  const runId: string = store.createRun({
    project: "proj",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: "br",
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

function seedMultipleRuns(count: number, createdAtOffset = 0): string[] {
  const runIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const runId = seedRun(stateStore, {
      status: "completed",
      createdAt: NOW_MS - i * 1000 - createdAtOffset,
    });
    runIds.push(runId);
  }
  return runIds;
}

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-limit-cap-${process.pid}-${Date.now()}.db`);
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

test("filtered query without --limit defaults to 200 newest runs", async () => {
  const runIds = seedMultipleRuns(300);

  const results = (await listRunsDirect(handlers, { sinceMs: NOW_MS - 500_000 })) as DaemonListRunRow[];
  expect(results.length).toBe(200);
  // Should be newest first
  const first = results[0];
  const last = results[199];
  expect(first?.runId).toBe(runIds.at(0));
  expect(last?.runId).toBe(runIds.at(199));
});

test("filtered query with explicit --limit returns at most N runs", async () => {
  const runIds = seedMultipleRuns(300);

  const results = (await listRunsDirect(handlers, { sinceMs: NOW_MS - 500_000, limit: 50 })) as DaemonListRunRow[];
  expect(results.length).toBe(50);
  const first = results[0];
  const last = results[49];
  expect(first?.runId).toBe(runIds.at(0));
  expect(last?.runId).toBe(runIds.at(49));
});

test("filtered query with --limit larger than results returns all matching runs", async () => {
  const runIds = seedMultipleRuns(30);

  const results = (await listRunsDirect(handlers, { sinceMs: NOW_MS - 500_000, limit: 100 })) as DaemonListRunRow[];
  expect(results.length).toBe(30);
  const first = results[0];
  expect(first?.runId).toBe(runIds.at(0));
});

test("filtered query results are newest-first", async () => {
  const runIds = seedMultipleRuns(10);

  const results = (await listRunsDirect(handlers, { sinceMs: NOW_MS - 50_000, limit: 5 })) as DaemonListRunRow[];
  expect(results.length).toBe(5);
  for (let i = 0; i < 5; i++) {
    const row = results[i];
    expect(row?.runId).toBe(runIds.at(i));
  }
});

test("unfiltered query keeps retainListedRuns policy (no default cap applied)", async () => {
  const runIds = seedMultipleRuns(100);

  const results = (await listRunsDirect(handlers)) as DaemonListRunRow[];
  // Without filter, uses retainListedRuns which keeps 50 terminal runs
  expect(results.length).toBeLessThanOrEqual(100);
  // The first result should be one of the newest runs
  expect(results.some((r) => r.runId === runIds.at(0))).toBe(true);
});

test("bare --limit without filter does not apply default cap", async () => {
  const cap = captureIo();
  const sent: unknown[] = [];

  const code = await withFixedUuid(LIST_REQUEST_ID, () =>
    main(["run", "list", "--limit", "50"], cap.io, {
      connectIpcClient: async () =>
        makeIpcClient([{ kind: "response", id: LIST_REQUEST_ID, result: { runs: [] } }], { sent }),
    }),
  );

  expect(code).toBe(0);
  // Should send request without sinceMs (not a filtered query)
  expect(sent).toEqual([{ kind: "request", id: LIST_REQUEST_ID, method: "list", params: undefined }]);
});

test.each(["invalid", "0", "-5"])("invalid --limit %s exits 1 with invalid_limit before RPC", async (value) => {
  const cap = captureIo();
  const sent: unknown[] = [];
  const code = await main(["run", "list", "--limit", value], cap.io, {
    connectIpcClient: async () => makeIpcClient([], { sent }),
  });
  expect(code).toBe(1);
  expect(cap.read().stderr).toBe("invalid_limit\n");
  expect(sent).toEqual([]);
});

test("invalid --limit with missing value exits 1 with invalid_limit", async () => {
  const cap = captureIo();
  const sent: unknown[] = [];
  const code = await main(["run", "list", "--limit"], cap.io, {
    connectIpcClient: async () => makeIpcClient([], { sent }),
  });
  expect(code).toBe(1);
  expect(cap.read().stderr).toMatch(/invalid_limit|usage:/);
  expect(sent).toEqual([]);
});

test("run list --since with --limit passes both to daemon", async () => {
  const cap = captureIo();
  const sent: unknown[] = [];

  const code = await withFixedUuid(LIST_REQUEST_ID, () =>
    main(["run", "list", "--since", "1d", "--limit", "75"], cap.io, {
      now: () => NOW_MS,
      connectIpcClient: async () =>
        makeIpcClient([{ kind: "response", id: LIST_REQUEST_ID, result: { runs: [] } }], { sent }),
    }),
  );

  expect(code).toBe(0);
  expect(sent).toEqual([
    {
      kind: "request",
      id: LIST_REQUEST_ID,
      method: "list",
      params: {
        sinceMs: NOW_MS - 86_400_000,
        limit: 75,
      },
    },
  ]);
});

test("run list --limit with --since passes both to daemon", async () => {
  const cap = captureIo();
  const sent: unknown[] = [];

  const code = await withFixedUuid(LIST_REQUEST_ID, () =>
    main(["run", "list", "--limit", "100", "--since", "2d"], cap.io, {
      now: () => NOW_MS,
      connectIpcClient: async () =>
        makeIpcClient([{ kind: "response", id: LIST_REQUEST_ID, result: { runs: [] } }], { sent }),
    }),
  );

  expect(code).toBe(0);
  expect(sent).toEqual([
    {
      kind: "request",
      id: LIST_REQUEST_ID,
      method: "list",
      params: {
        sinceMs: NOW_MS - 2 * 86_400_000,
        limit: 100,
      },
    },
  ]);
});

test("duplicate --limit flag exits 1 with usage error", async () => {
  const cap = captureIo();
  const sent: unknown[] = [];
  const code = await main(["run", "list", "--limit", "50", "--limit", "75"], cap.io, {
    connectIpcClient: async () => makeIpcClient([], { sent }),
  });
  expect(code).toBe(1);
  expect(cap.read().stderr).toMatch(/usage:/);
  expect(sent).toEqual([]);
});
