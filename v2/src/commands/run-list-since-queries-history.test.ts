import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunControlHandlers, createTailStreamHandler } from "../daemon/daemon.ts";
import type { RunStatus, StateStore } from "../persistence/state-store.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { captureIo, cliMain as main, makeIpcClient } from "../testing/cli-test-helpers.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { listRunsDirect } from "../testing/run-control.ts";
import { connectTuiLogTail } from "../tui/tui-log-tail-client.ts";

const LIST_REQUEST_ID = "00000000-0000-4000-8000-000000000020";
const STREAM_ID = "00000000-0000-4000-8000-000000000021";

const ONE_HOUR_MS = 3_600_000;
const TWO_DAYS_MS = 2 * 24 * ONE_HOUR_MS;
const NOW_MS = 10_000_000_000_000;

let dbPath: string;
let stateStore: StateStore;
let handlers: ReturnType<typeof createRunControlHandlers>;

function seedRun(
  store: StateStore,
  overrides: {
    status?: RunStatus;
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

function seedBeyondRetentionWindow(store: StateStore): string {
  for (let index = 0; index < 55; index++) {
    seedRun(store, { status: "completed", createdAt: NOW_MS - ONE_HOUR_MS - index });
  }
  return seedRun(store, { status: "completed", createdAt: NOW_MS - 36 * ONE_HOUR_MS });
}

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-list-since-${process.pid}-${Date.now()}.db`);
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

test("list with sinceMs bypasses terminal retention for older terminal runs", async () => {
  const historicalId = seedBeyondRetentionWindow(stateStore);

  const defaultRuns = await listRunsDirect(handlers);
  expect(defaultRuns?.some((row) => row.runId === historicalId)).toBe(false);

  const sinceRuns = await listRunsDirect(handlers, { sinceMs: NOW_MS - TWO_DAYS_MS });
  expect(sinceRuns?.some((row) => row.runId === historicalId)).toBe(true);
});

test("run list --since 2d passes epoch-ms cutoff to list RPC", async () => {
  const cap = captureIo();
  const sent: unknown[] = [];

  const code = await withFixedUuid(LIST_REQUEST_ID, () =>
    main(["run", "list", "--since", "2d"], cap.io, {
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
      params: { sinceMs: NOW_MS - TWO_DAYS_MS },
    },
  ]);
});

test("invalid --since exits 1 with invalid_since and does not issue list RPC", async () => {
  {
    const cap = captureIo();
    const sent: unknown[] = [];
    const code = await main(["run", "list", "--since", "not-a-duration"], cap.io, {
      connectIpcClient: async () => makeIpcClient([], { sent }),
    });
    expect(code).toBe(1);
    expect(cap.read().stderr).toBe("invalid_since: invalid value\n");
    expect(cap.read().stdout).toBe("");
    expect(sent).toEqual([]);
  }
  {
    const cap = captureIo();
    const sent: unknown[] = [];
    const code = await main(["run", "list", "--since", "garbage"], cap.io, {
      connectIpcClient: async () =>
        makeIpcClient(
          [
            {
              kind: "response",
              id: LIST_REQUEST_ID,
              result: {
                runs: [{ runId: "default-only", project: "demo", branch: "main", status: "completed", isLive: false }],
              },
            },
          ],
          { sent },
        ),
    });
    expect(code).toBe(1);
    expect(cap.read().stdout).toBe("");
    expect(sent).toEqual([]);
  }
});

test("run log stream-open and tui log tail-open accept since-listed runs beyond retention", async () => {
  const historicalId = seedBeyondRetentionWindow(stateStore);

  const sinceRuns = await listRunsDirect(handlers, { sinceMs: NOW_MS - TWO_DAYS_MS });
  expect(sinceRuns?.some((row) => row.runId === historicalId)).toBe(true);

  const tailHandler = createTailStreamHandler({
    stateStore,
    logReader: {
      tail: () => [],
      follow: async function* () {},
    },
  });
  let closed = false;
  await tailHandler(
    STREAM_ID,
    { runId: historicalId },
    () => {},
    () => {
      closed = true;
    },
    new AbortController().signal,
  );
  expect(closed).toBe(true);

  await withFixedUuid(STREAM_ID, async () => {
    const sent: unknown[] = [];
    const tail = await connectTuiLogTail(historicalId, {
      socketPath: "/tmp/jarvis.sock",
      connectIpcClient: async () =>
        makeIpcClient([{ kind: "stream-end", streamId: STREAM_ID }], { sent }),
    });
    const iter = tail.records()[Symbol.asyncIterator]();
    await iter.next();
    expect(sent).toEqual([{ kind: "stream-open", streamId: STREAM_ID, payload: { runId: historicalId } }]);
    tail.close();
  });

  const cap = captureIo();
  const sent: unknown[] = [];
  const code = await withFixedUuid(STREAM_ID, () =>
    main(["run", "log", historicalId], cap.io, {
      connectIpcClient: async () =>
        makeIpcClient([{ kind: "stream-end", streamId: STREAM_ID }], { sent }),
    }),
  );

  expect(code).toBe(0);
  expect(sent).toEqual([{ kind: "stream-open", streamId: STREAM_ID, payload: { runId: historicalId } }]);
});
