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
import {
  setInvertListRpcRequestIsFilteredForTest,
} from "./run-list-rpc.ts";
import { setInvertListStatusValidationForTest } from "./run.ts";

const LIST_REQUEST_ID = "00000000-0000-4000-8000-000000000020";
const STREAM_ID = "00000000-0000-4000-8000-000000000021";
const RUN_LOG_OWNER_LIST_ID = "00000000-0000-4000-8000-000000000022";
const OPERATOR_SESSION_ID = "00000000-0000-4000-8000-000000000023";

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
    specPath?: string;
  } = {},
): string {
  const runId = store.createRun({
    project: overrides.project ?? "proj",
    specRef: "main",
    worktreePath: "/tmp/wt",
    branch: overrides.branch ?? "br",
    specPath: overrides.specPath ?? "/tmp/spec.md",
    status: overrides.status ?? "completed",
  });
  if (overrides.createdAt !== undefined) {
    const db = new Database(dbPath);
    db.prepare("UPDATE runs SET created_at = ? WHERE id = ?").run(overrides.createdAt, runId);
    db.close();
  }
  return runId;
}

function seedBeyondRetentionWindow(store: StateStore, overrides: Parameters<typeof seedRun>[1] = {}): string {
  for (let index = 0; index < 55; index++) {
    seedRun(store, { status: "completed", createdAt: NOW_MS - ONE_HOUR_MS - index, ...overrides });
  }
  return seedRun(store, {
    status: "completed",
    createdAt: NOW_MS - 36 * ONE_HOUR_MS,
    ...overrides,
  });
}

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-list-dim-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(dbPath);
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: async () => {},
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    settleDelayMs: 0,
  });
  setInvertListRpcRequestIsFilteredForTest(false);
  setInvertListStatusValidationForTest(false);
});

afterEach(() => {
  setInvertListRpcRequestIsFilteredForTest(false);
  setInvertListStatusValidationForTest(false);
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

test("dimension filters match durable store columns exactly", async () => {
  const failedAlpha = seedRun(stateStore, {
    project: "alpha",
    branch: "b1",
    specPath: "/a/spec.md",
    status: "failed",
  });
  seedRun(stateStore, { project: "beta", branch: "b1", specPath: "/a/spec.md", status: "failed" });
  const alphaOtherBranch = seedRun(stateStore, {
    project: "alpha",
    branch: "b2",
    specPath: "/a/spec.md",
    status: "failed",
  });
  const alphaOtherSpec = seedRun(stateStore, {
    project: "alpha",
    branch: "b1",
    specPath: "/b/spec.md",
    status: "failed",
  });
  const completedAlpha = seedRun(stateStore, {
    project: "alpha",
    branch: "b1",
    specPath: "/a/spec.md",
    status: "completed",
  });

  const byProject = await listRunsDirect(handlers, { project: "alpha" });
  expect(new Set(byProject?.map((row) => row.runId))).toEqual(
    new Set([failedAlpha, alphaOtherBranch, alphaOtherSpec, completedAlpha]),
  );

  const byBranch = await listRunsDirect(handlers, { branch: "b2" });
  expect(byBranch?.map((row) => row.runId)).toEqual([alphaOtherBranch]);

  const bySpec = await listRunsDirect(handlers, { specPath: "/b/spec.md" });
  expect(bySpec?.map((row) => row.runId)).toEqual([alphaOtherSpec]);

  const byStatus = await listRunsDirect(handlers, { status: "completed" });
  expect(byStatus?.map((row) => row.runId)).toEqual([completedAlpha]);
});

test("conjunctive dimension filters and composition with sinceMs", async () => {
  const recentMatch = seedRun(stateStore, {
    project: "keep",
    branch: "feature",
    createdAt: NOW_MS - 2 * ONE_HOUR_MS,
    status: "completed",
  });
  seedRun(stateStore, {
    project: "keep",
    branch: "other",
    createdAt: NOW_MS - 2 * ONE_HOUR_MS,
    status: "completed",
  });
  seedRun(stateStore, {
    project: "drop",
    branch: "feature",
    createdAt: NOW_MS - 2 * ONE_HOUR_MS,
    status: "completed",
  });
  const olderMatch = seedRun(stateStore, {
    project: "keep",
    branch: "feature",
    createdAt: NOW_MS - 48 * ONE_HOUR_MS,
    status: "completed",
  });

  const conjunctive = await listRunsDirect(handlers, { project: "keep", branch: "feature" });
  expect(new Set(conjunctive?.map((row) => row.runId))).toEqual(new Set([recentMatch, olderMatch]));

  const withSince = await listRunsDirect(handlers, {
    project: "keep",
    branch: "feature",
    sinceMs: NOW_MS - 24 * ONE_HOUR_MS,
  });
  expect(withSince?.map((row) => row.runId)).toEqual([recentMatch]);
});

test("dimension-only filtered query bypasses terminal retention", async () => {
  const historicalId = seedBeyondRetentionWindow(stateStore, { project: "history-proj" });

  const defaultRuns = await listRunsDirect(handlers);
  expect(defaultRuns?.some((row) => row.runId === historicalId)).toBe(false);

  const filtered = await listRunsDirect(handlers, { project: "history-proj" });
  expect(filtered?.some((row) => row.runId === historicalId)).toBe(true);
});

test("run list CLI passes dimension RPC params", async () => {
  const cap = captureIo();
  const sent: unknown[] = [];
  const code = await withFixedUuid(LIST_REQUEST_ID, () =>
    main(
      ["run", "list", "--project", "demo", "--branch", "main", "--spec", "/x/spec.md", "--status", "completed"],
      cap.io,
      {
        connectIpcClient: async () =>
          makeIpcClient([{ kind: "response", id: LIST_REQUEST_ID, result: { runs: [] } }], { sent }),
      },
    ),
  );
  expect(code).toBe(0);
  expect(sent).toEqual([
    {
      kind: "request",
      id: LIST_REQUEST_ID,
      method: "list",
      params: {
        project: "demo",
        branch: "main",
        specPath: "/x/spec.md",
        status: "completed",
      },
    },
  ]);
});

test("invalid --status exits 1 with invalid_status and skips list RPC", async () => {
  const cap = captureIo();
  const sent: unknown[] = [];
  const code = await main(["run", "list", "--status", "in-progress"], cap.io, {
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
  expect(cap.read().stderr).toBe("invalid_status: invalid value\n");
  expect(cap.read().stdout).toBe("");
  expect(sent).toEqual([]);
});

test("invalid_status guard inversion accepts non-terminal status", async () => {
  setInvertListStatusValidationForTest(true);
  const cap = captureIo();
  const sent: unknown[] = [];
  const code = await withFixedUuid(LIST_REQUEST_ID, () =>
    main(["run", "list", "--status", "in-progress"], cap.io, {
      connectIpcClient: async () =>
        makeIpcClient([{ kind: "response", id: LIST_REQUEST_ID, result: { runs: [] } }], { sent }),
    }),
  );
  expect(code).toBe(0);
  expect(sent).toEqual([
    { kind: "request", id: LIST_REQUEST_ID, method: "list", params: { status: "in-progress" } },
  ]);
});

test("listRpcRequestIsFiltered guard inversion keeps retention on dimension-only queries", async () => {
  const historicalId = seedBeyondRetentionWindow(stateStore, { project: "history-proj" });
  setInvertListRpcRequestIsFilteredForTest(true);
  const filtered = await listRunsDirect(handlers, { project: "history-proj" });
  expect(filtered?.some((row) => row.runId === historicalId)).toBe(false);
});

test("run log stream-open and tui log tail-open accept dimension-listed runs beyond retention", async () => {
  const historicalId = seedBeyondRetentionWindow(stateStore, { project: "history-proj" });

  const filtered = await listRunsDirect(handlers, { project: "history-proj" });
  expect(filtered?.some((row) => row.runId === historicalId)).toBe(true);

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
      connectIpcClient: async () => makeIpcClient([{ kind: "stream-end", streamId: STREAM_ID }], { sent }),
    });
    const iter = tail.records()[Symbol.asyncIterator]();
    await iter.next();
    expect(sent).toEqual([{ kind: "stream-open", streamId: STREAM_ID, payload: { runId: historicalId, afterSeq: 0 } }]);
    tail.close();
  });

  const cap = captureIo();
  const sent: unknown[] = [];
  let connectCount = 0;
  const code = await withFixedUuid([OPERATOR_SESSION_ID, RUN_LOG_OWNER_LIST_ID, STREAM_ID], () =>
    main(["run", "log", historicalId], cap.io, {
      socketDiscovery: async () => [],
      connectIpcClient: async () => {
        connectCount += 1;
        if (connectCount === 1) {
          return makeIpcClient([
            {
              kind: "response",
              id: RUN_LOG_OWNER_LIST_ID,
              result: {
                runs: [
                  {
                    runId: historicalId,
                    project: "history-proj",
                    branch: "br",
                    status: "completed",
                    isLive: false,
                  },
                ],
              },
            },
          ]);
        }
        return makeIpcClient([{ kind: "stream-end", streamId: STREAM_ID }], { sent });
      },
    }),
  );

  expect(code).toBe(0);
  expect(sent).toEqual([{ kind: "stream-open", streamId: STREAM_ID, payload: { runId: historicalId, afterSeq: 0 } }]);
});
