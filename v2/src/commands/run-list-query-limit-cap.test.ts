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

const LIST_REQUEST_ID = "00000000-0000-4000-8000-000000000020";
const NOW_MS = 10_000_000_000_000;
const FILTERED_DEFAULT_CAP = 200;

let dbPath: string;
let stateStore: StateStore;
let handlers: ReturnType<typeof createRunControlHandlers>;

async function runListCli(
  argv: string[],
  options: {
    now?: () => number;
    responses?: Array<{ kind: "response"; id: string; result: unknown }>;
  } = {},
): Promise<{ code: number; stderr: string; stdout: string; sent: unknown[] }> {
  const cap = captureIo();
  const sent: unknown[] = [];
  const code = await withFixedUuid(LIST_REQUEST_ID, () =>
    main(["run", "list", ...argv], cap.io, {
      ...(options.now ? { now: options.now } : {}),
      connectIpcClient: async () =>
        makeIpcClient(options.responses ?? [{ kind: "response", id: LIST_REQUEST_ID, result: { runs: [] } }], {
          sent,
        }),
    }),
  );
  const { stderr, stdout } = cap.read();
  return { code, stderr, stdout, sent };
}

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

function seedManyCompleted(store: StateStore, count: number, createdAtBase: number): string[] {
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    ids.push(seedRun(store, { status: "completed", createdAt: createdAtBase - index }));
  }
  return ids;
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

test("filtered list without limit caps at 200 newest matching rows", async () => {
  seedManyCompleted(stateStore, FILTERED_DEFAULT_CAP + 25, NOW_MS);
  const sinceMs = NOW_MS - 1_000_000;
  const runs = await listRunsDirect(handlers, { sinceMs });
  expect(runs?.length).toBe(FILTERED_DEFAULT_CAP);
});

test("filtered list with explicit limit returns newest matching rows", async () => {
  const ids = seedManyCompleted(stateStore, 30, NOW_MS);
  const sinceMs = NOW_MS - 1_000_000;
  const limit = 5;
  const runs = await listRunsDirect(handlers, { sinceMs, limit });
  expect(runs?.length).toBe(limit);
  const expectedNewest = ids.slice(0, limit);
  expect(runs?.map((row) => row.runId)).toEqual(expectedNewest);
});

test("run list --since with --limit passes both fields on list RPC", async () => {
  const { code, sent } = await runListCli(["--since", "1h", "--limit", "12"], { now: () => NOW_MS });
  expect(code).toBe(0);
  expect(sent).toEqual([
    {
      kind: "request",
      id: LIST_REQUEST_ID,
      method: "list",
      params: { sinceMs: NOW_MS - 3_600_000, limit: 12 },
    },
  ]);
});

test("invalid --limit exits 1 with invalid_limit and does not issue list RPC", async () => {
  const { code, stderr, stdout, sent } = await runListCli(["--limit", "garbage"], {
    responses: [
      {
        kind: "response",
        id: LIST_REQUEST_ID,
        result: {
          runs: [{ runId: "must-not-appear", project: "demo", branch: "main", status: "completed", isLive: false }],
        },
      },
    ],
  });
  expect(code).toBe(1);
  expect(stderr).toBe("invalid_limit: invalid value\n");
  expect(stdout).toBe("");
  expect(sent).toEqual([]);
});

test("invalid --since and invalid --limit pin distinct error messages", async () => {
  {
    const { code, stderr, sent } = await runListCli(["--since", "not-a-duration"], { responses: [] });
    expect(code).toBe(1);
    expect(stderr).toBe("invalid_since: invalid value\n");
    expect(sent).toEqual([]);
  }
  {
    const { code, stderr, sent } = await runListCli(["--limit", "0"], { responses: [] });
    expect(code).toBe(1);
    expect(stderr).toBe("invalid_limit: invalid value\n");
    expect(sent).toEqual([]);
  }
});

test("bare --limit alone keeps terminal retention instead of filtered default cap", async () => {
  seedManyCompleted(stateStore, 60, NOW_MS);
  const withLimit = await listRunsDirect(handlers, { limit: 5 });
  const defaultList = await listRunsDirect(handlers);
  expect(withLimit?.length).toBe(defaultList?.length);
  expect(withLimit?.length).toBe(50);
});
