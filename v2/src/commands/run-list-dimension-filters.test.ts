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
  listRpcRequestIsFiltered,
  setInvertListRpcRequestIsFilteredForTest,
} from "./run-list-rpc.ts";
import { setInvertInvalidStatusGuardForTest } from "./run.ts";

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
  setInvertInvalidStatusGuardForTest(false);
});

afterEach(() => {
  setInvertListRpcRequestIsFilteredForTest(false);
  setInvertInvalidStatusGuardForTest(false);
  try {
    stateStore.close();
  } catch {
    // store may be closed
  }
});

test("dimension filters match durable store columns exactly", async () => {
  const projectId = seedRun(stateStore, { project: "alpha", branch: "b1", specPath: "/a/spec.md", status: "failed" });
  seedRun(stateStore, { project: "beta", branch: "b2", specPath: "/b/spec.md", status: "completed" });

  const byProject = await listRunsDirect(handlers, { project: "alpha" });
  expect(byProject?.map((row) => row.runId)).toEqual([projectId]);

  const byBranch = await listRunsDirect(handlers, { branch: "b1" });
  expect(byBranch?.map((row) => row.runId)).toEqual([projectId]);

  const bySpec = await listRunsDirect(handlers, { specPath: "/a/spec.md" });
  expect(bySpec?.map((row) => row.runId)).toEqual([projectId]);

  const byStatus = await listRunsDirect(handlers, { status: "failed" });
  expect(byStatus?.map((row) => row.runId)).toEqual([projectId]);
});

test("dimension filters compose conjunctively and with sinceMs", async () => {
  const matchId = seedRun(stateStore, {
    project: "keep",
    branch: "main",
    createdAt: NOW_MS - ONE_HOUR_MS,
    status: "completed",
  });
  seedRun(stateStore, {
    project: "keep",
    branch: "other",
    createdAt: NOW_MS - ONE_HOUR_MS,
    status: "completed",
  });
  seedRun(stateStore, {
    project: "drop",
    branch: "main",
    createdAt: NOW_MS - ONE_HOUR_MS,
    status: "completed",
  });
  seedRun(stateStore, {
    project: "keep",
    branch: "main",
    createdAt: NOW_MS - 72 * ONE_HOUR_MS,
    status: "completed",
  });

  const runs = await listRunsDirect(handlers, {
    project: "keep",
    branch: "main",
    sinceMs: NOW_MS - TWO_DAYS_MS,
  });
  expect(runs?.map((row) => row.runId)).toEqual([matchId]);
});

test("dimension-only filtered query bypasses terminal retention", async () => {
  const historicalId = seedBeyondRetentionWindow(stateStore, { project: "hist-proj" });

  const defaultRuns = await listRunsDirect(handlers);
  expect(defaultRuns?.some((row) => row.runId === historicalId)).toBe(false);

  const filtered = await listRunsDirect(handlers, { project: "hist-proj" });
  expect(filtered?.some((row) => row.runId === historicalId)).toBe(true);
});

test("run list CLI passes dimension RPC params", async () => {
  const { code, sent } = await runListCli([
    "run",
    "list",
    "--project",
    "p",
    "--branch",
    "main",
    "--spec",
    "/x.md",
    "--status",
    "completed",
    "--since",
    "1h",
    "--limit",
    "5",
  ], { now: () => NOW_MS });
  expect(code).toBe(0);
  expect(sent).toEqual([
    {
      kind: "request",
      id: LIST_REQUEST_ID,
      method: "list",
      params: {
        project: "p",
        branch: "main",
        specPath: "/x.md",
        status: "completed",
        sinceMs: NOW_MS - ONE_HOUR_MS,
        limit: 5,
      },
    },
  ]);
});

async function expectListCliRejectsBeforeRpc(
  argv: string[],
  expectedStderr: string,
): Promise<void> {
  const cap = captureIo();
  const sent: unknown[] = [];
  const code = await main(argv, cap.io, {
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
  expect(cap.read().stderr).toBe(expectedStderr);
  expect(cap.read().stdout).toBe("");
  expect(sent).toEqual([]);
}

test("invalid --status exits 1 with invalid_status and skips list RPC", async () => {
  await expectListCliRejectsBeforeRpc(
    ["run", "list", "--status", "in-progress"],
    "invalid_status: invalid value\n",
  );
});

test("repeat --status exits 1 with invalid_status and skips list RPC", async () => {
  await expectListCliRejectsBeforeRpc(
    ["run", "list", "--status", "completed", "--status", "failed"],
    "invalid_status: invalid value\n",
  );
});

test("empty --project exits 1 with invalid_project and skips list RPC", async () => {
  await expectListCliRejectsBeforeRpc(["run", "list", "--project", ""], "invalid_project: invalid value\n");
});

test("empty --branch exits 1 with invalid_branch and skips list RPC", async () => {
  await expectListCliRejectsBeforeRpc(["run", "list", "--branch", ""], "invalid_branch: invalid value\n");
});

test("empty --spec exits 1 with invalid_spec and skips list RPC", async () => {
  await expectListCliRejectsBeforeRpc(["run", "list", "--spec", ""], "invalid_spec: invalid value\n");
});

test("invalid status guard inversion accepts non-terminal status", async () => {
  setInvertInvalidStatusGuardForTest(true);
  const { code, sent } = await runListCli(["run", "list", "--status", "in-progress"]);
  expect(code).toBe(0);
  expect(sent).toEqual([
    {
      kind: "request",
      id: LIST_REQUEST_ID,
      method: "list",
      params: { status: "in-progress" },
    },
  ]);
});

test("listRpcRequestIsFiltered guard inversion drops dimension-only retention bypass", async () => {
  const historicalId = seedBeyondRetentionWindow(stateStore, { project: "hist-proj" });
  setInvertListRpcRequestIsFilteredForTest(true);

  const filtered = await listRunsDirect(handlers, { project: "hist-proj" });
  expect(filtered?.some((row) => row.runId === historicalId)).toBe(false);
  expect(listRpcRequestIsFiltered({ project: "hist-proj" })).toBe(false);
});

test("run log stream-open and tui log tail-open accept dimension-listed runs beyond retention", async () => {
  const historicalId = seedBeyondRetentionWindow(stateStore, { project: "hist-proj" });

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
                    project: "hist-proj",
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
