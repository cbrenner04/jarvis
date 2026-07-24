import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunControlHandlers } from "../daemon/daemon.ts";
import type { RunStatus, StateStore } from "../persistence/state-store.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { captureIo, cliMain as main, makeIpcClient } from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { listRunsDirect } from "../testing/run-control.ts";
import {
  FILTERED_LIST_DEFAULT_LIMIT,
  type ListRpcParams,
  listRpcRequestIsFiltered,
  resolveListRpcRequest,
} from "./run-list-rpc.ts";

const LIST_REQUEST_ID = "00000000-0000-4000-8000-000000000020";
const ONE_HOUR_MS = 3_600_000;
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
  const runId = store.createRun({
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

function seedFilteredMatchSet(store: StateStore, count: number): void {
  for (let index = 0; index < count; index++) {
    seedRun(store, { status: "completed", createdAt: NOW_MS - index });
  }
}

async function runListCli(argv: string[], options?: { now?: () => number }) {
  const cap = captureIo();
  const sent: unknown[] = [];
  const code = await withFixedUuid(LIST_REQUEST_ID, () =>
    main(argv, cap.io, {
      ...(options?.now !== undefined ? { now: options.now } : {}),
      connectIpcClient: async () =>
        makeIpcClient([{ kind: "response", id: LIST_REQUEST_ID, result: { runs: [] } }], { sent }),
    }),
  );
  return { code, cap, sent };
}

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-list-limit-${process.pid}-${Date.now()}.db`);
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

test("resolveListRpcRequest and listRpcRequestIsFiltered", () => {
  const cases: Array<[ListRpcParams, ListRpcParams | undefined, boolean]> = [
    [{}, undefined, false],
    [{ sinceMs: 42 }, { sinceMs: 42 }, true],
    [{ limit: 7 }, { limit: 7 }, false],
    [{ sinceMs: 42, limit: 7 }, { sinceMs: 42, limit: 7 }, true],
  ];
  for (const [input, params, filtered] of cases) {
    expect(resolveListRpcRequest(input)).toEqual(params);
    expect(listRpcRequestIsFiltered(params)).toBe(filtered);
  }
  expect(listRpcRequestIsFiltered(undefined)).toBe(false);
});

test("filtered list without limit caps at default newest rows", async () => {
  seedFilteredMatchSet(stateStore, FILTERED_LIST_DEFAULT_LIMIT + 25);
  const runs = await listRunsDirect(handlers, { sinceMs: NOW_MS - ONE_HOUR_MS });
  expect(runs).toHaveLength(FILTERED_LIST_DEFAULT_LIMIT);
});

test("filtered list with limit returns at most N newest matching rows", async () => {
  seedFilteredMatchSet(stateStore, 40);
  const runs = await listRunsDirect(handlers, { sinceMs: NOW_MS - ONE_HOUR_MS, limit: 12 });
  expect(runs).toHaveLength(12);
});

test("bare list RPC limit alone keeps terminal retention, not filtered default cap", async () => {
  for (let index = 0; index < 55; index++) {
    seedRun(stateStore, { status: "completed", createdAt: index });
  }
  const defaultRuns = await listRunsDirect(handlers);
  const limitedRuns = await listRunsDirect(handlers, { limit: 5 });
  expect(limitedRuns?.length).toBe(defaultRuns?.length);
  expect(limitedRuns?.filter((row) => row.status === "completed")).toHaveLength(50);
});

test("run list passes list RPC params for filtered and bare --limit", async () => {
  {
    const { code, sent } = await runListCli(["run", "list", "--since", "1h", "--limit", "15"], {
      now: () => NOW_MS,
    });
    expect(code).toBe(0);
    expect(sent).toEqual([
      {
        kind: "request",
        id: LIST_REQUEST_ID,
        method: "list",
        params: { sinceMs: NOW_MS - ONE_HOUR_MS, limit: 15 },
      },
    ]);
  }
  {
    const { code, sent } = await runListCli(["run", "list", "--limit", "9"]);
    expect(code).toBe(0);
    expect(sent).toEqual([
      {
        kind: "request",
        id: LIST_REQUEST_ID,
        method: "list",
        params: { limit: 9 },
      },
    ]);
  }
});

test("invalid --limit and invalid --since emit distinct errors and skip list RPC", async () => {
  {
    const cap = captureIo();
    const sent: unknown[] = [];
    const code = await main(["run", "list", "--limit", "garbage"], cap.io, {
      connectIpcClient: async () =>
        makeIpcClient(
          [
            {
              kind: "response",
              id: LIST_REQUEST_ID,
              result: {
                runs: [{ runId: "must-not-appear", project: "p", branch: "b", status: "completed", isLive: false }],
              },
            },
          ],
          { sent },
        ),
    });
    expect(code).toBe(1);
    expect(cap.read().stderr).toBe("invalid_limit: invalid value\n");
    expect(cap.read().stdout).toBe("");
    expect(sent).toEqual([]);
  }
  {
    const cap = captureIo();
    const sent: unknown[] = [];
    const code = await main(["run", "list", "--since", "garbage"], cap.io, {
      connectIpcClient: async () => makeIpcClient([], { sent }),
    });
    expect(code).toBe(1);
    expect(cap.read().stderr).toBe("invalid_since: invalid value\n");
    expect(cap.read().stdout).toBe("");
    expect(sent).toEqual([]);
  }
});
