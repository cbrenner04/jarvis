import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcServer, RpcHandler } from "../ipc/server.ts";
import type { LogReader } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { listRunsDirect } from "../testing/run-control.ts";
import { createRunControlHandlers, startDaemonRuntime } from "./daemon.ts";
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

test("a cached owner row reporting isLive: false still lists as isLive: true through the stable handler", async () => {
  const runId = seedInProgressRun("local-project", "local-branch");
  const owner = ownerRowFixture(runId, { isLive: false });
  const handlers = handlersWithOwnerRow((id) => (id === runId ? owner : undefined));

  const runs = await listRunsDirect(handlers);
  const matching = runs?.filter((row) => row.runId === runId) ?? [];

  expect(matching).toHaveLength(1);
  expect(matching[0]?.isLive).toBe(true);
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

function fakeReader(): LogReader {
  return { tail: () => [], async *follow() {} };
}

test("an unreachable predecessor socket at startup never blocks list or an unrelated handler from starting", async () => {
  const runId = seedInProgressRun("local-project", "local-branch");
  let boundHandlers: Record<string, RpcHandler> | undefined;
  const fakeServer = async (socketPath: string, handlers?: Record<string, RpcHandler>): Promise<IpcServer> => {
    boundHandlers = handlers;
    return { socketPath, close: async () => undefined };
  };

  // Nothing has ever listened at this path: the ownership directory's poll to it fails exactly
  // like a real unreachable predecessor. A naive implementation that awaits directory setup
  // synchronously during startup and lets a connect failure propagate would reject here instead
  // of resolving.
  const unreachablePredecessorSocketPath = join(
    tmpdir(),
    `jarvis-unreachable-predecessor-${process.pid}-${Date.now()}.sock`,
  );

  const runtime = await startDaemonRuntime("/fake/public.sock", stateStore, fakeReader(), {
    openLogSink: () => ({ append: () => undefined, close: () => undefined }),
    startIpcServer: fakeServer,
    enumerateOtherDaemonSockets: () => [],
    predecessorSocketPath: unreachablePredecessorSocketPath,
  });

  expect(boundHandlers?.list).toBeDefined();
  expect(boundHandlers?.health).toBeDefined();

  const listResponse = await boundHandlers?.list?.(
    { kind: "request", id: "l1", method: "list" },
    new AbortController().signal,
  );
  expect(listResponse?.kind).toBe("response");
  const runs =
    listResponse?.kind === "response" ? (listResponse.result as { runs?: DaemonListRunRow[] })?.runs : undefined;
  expect(runs?.some((row) => row.runId === runId)).toBe(true);

  const healthResponse = await boundHandlers?.health?.(
    { kind: "request", id: "h1", method: "health" },
    new AbortController().signal,
  );
  expect(healthResponse).toEqual({ kind: "response", result: { ok: true } });

  await runtime.close();
});
