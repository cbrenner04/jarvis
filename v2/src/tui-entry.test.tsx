import { describe, expect, test } from "bun:test";
import type { WaitRunCompletionResult } from "./daemon.ts";
import type { TuiDaemonClient, TuiDaemonListResult, TuiDaemonRunSummary } from "./tui-daemon-client.ts";
import { TUI_DAEMON_SOCKET_DISPLAY, TuiDaemonConnectionError, TuiDaemonRpcError } from "./tui-daemon-client.ts";
import { runTuiEntry } from "./tui-entry.tsx";
import type {
  RunTuiEntryDeps,
  TuiMonitorControls,
  TuiMonitorSession,
  TuiMonitorState,
  TuiViewHost,
  TuiViewState,
} from "./tui-monitor-types.ts";

const RUN_ALPHA: TuiDaemonRunSummary = {
  runId: "run-alpha",
  project: "demo",
  branch: "alpha",
  status: "in-progress",
  isLive: true,
};

const RUN_BETA: TuiDaemonRunSummary = {
  runId: "run-beta",
  project: "demo",
  branch: "beta",
  status: "completed",
  isLive: false,
};

const RUN_GAMMA: TuiDaemonRunSummary = {
  runId: "run-gamma",
  project: "demo",
  branch: "gamma",
  status: "blocked",
  isLive: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function cloneState(state: TuiMonitorState): TuiMonitorState {
  return structuredClone(state);
}

function createRefreshScheduler() {
  let onRefresh: (() => void) | undefined;
  let closed = false;
  return {
    scheduler: {
      start(callback: () => void) {
        onRefresh = callback;
        return {
          close() {
            closed = true;
          },
        };
      },
    },
    tick() {
      onRefresh?.();
    },
    isClosed() {
      return closed;
    },
  };
}

function createViewHost() {
  const feedbackStates: TuiViewState[] = [];
  const monitorStates: TuiMonitorState[] = [];
  let controls: TuiMonitorControls | undefined;
  let closed = false;
  const exit = deferred<void>();
  const opened = deferred<void>();

  const host: TuiViewHost = {
    show(state) {
      feedbackStates.push(state);
    },
    async openMonitor(state, nextControls): Promise<TuiMonitorSession> {
      controls = nextControls;
      monitorStates.push(cloneState(state));
      opened.resolve();
      return {
        update(nextState) {
          monitorStates.push(cloneState(nextState));
        },
        waitUntilExit() {
          return exit.promise;
        },
        close() {
          closed = true;
        },
      };
    },
  };

  return {
    host,
    feedbackStates,
    monitorStates,
    async waitUntilOpen() {
      await opened.promise;
    },
    selectRun(runId: string) {
      controls?.selectRun(runId);
    },
    quit() {
      controls?.quit();
      exit.resolve();
    },
    isClosed() {
      return closed;
    },
  };
}

type FakeClientOptions = {
  methods?: string[];
  healthError?: TuiDaemonRpcError;
  statusError?: TuiDaemonRpcError;
  listResponses?: TuiDaemonListResult[];
  listError?: Error;
  waitImpl?: (runId: string) => Promise<WaitRunCompletionResult>;
};

function fakeClient(options: FakeClientOptions = {}): TuiDaemonClient {
  const methods = options.methods ?? [];
  let listIndex = 0;

  return {
    async health() {
      methods.push("health");
      if (options.healthError !== undefined) throw options.healthError;
      return { ok: true };
    },
    async status() {
      methods.push("status");
      if (options.statusError !== undefined) throw options.statusError;
      return { state: "running" };
    },
    async list() {
      methods.push("list");
      if (options.listError !== undefined) throw options.listError;
      const response = options.listResponses?.[Math.min(listIndex, (options.listResponses?.length ?? 1) - 1)];
      listIndex += 1;
      return response ?? { runs: [] };
    },
    async start() {
      methods.push("start");
      return { runId: "unused" };
    },
    async wait(runId: string) {
      methods.push(`wait:${runId}`);
      return (options.waitImpl ?? (async () => ({ runStatus: "completed" })))(runId);
    },
    close() {
      methods.push("close");
    },
  };
}

function entryDeps(
  clientOptions: FakeClientOptions = {},
  overrides: Partial<RunTuiEntryDeps> = {},
): { deps: RunTuiEntryDeps; clientOptions: FakeClientOptions } {
  return {
    clientOptions,
    deps: {
      connectTuiDaemon: async () => fakeClient(clientOptions),
      ...overrides,
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("runTuiEntry", () => {
  test("unavailable daemon at connect records unavailable feedback, exits 1, and skips list/wait", async () => {
    const view = createViewHost();
    let attempted = false;

    const code = await runTuiEntry({
      viewHost: view.host,
      connectTuiDaemon: async () => {
        attempted = true;
        throw new TuiDaemonConnectionError("cannot connect");
      },
    });

    expect(code).toBe(1);
    expect(attempted).toBe(true);
    expect(view.feedbackStates).toEqual([{ kind: "unavailable" }]);
    expect(TUI_DAEMON_SOCKET_DISPLAY).toBe("~/.jarvis/daemon.sock");
  });

  test("reachable daemon proves health and status, enters the monitor on one open client, and exits 0 on quit", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host, refreshScheduler: refresh.scheduler },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    view.quit();

    const code = await pending;

    expect(code).toBe(0);
    expect(clientOptions.methods).toEqual(["health", "status", "list", "wait:run-alpha", "close"]);
    expect(view.monitorStates[0]).toMatchObject({
      runs: [RUN_ALPHA],
      selectedRunId: "run-alpha",
      waitState: { kind: "pending", runId: "run-alpha" },
    });
    expect(view.isClosed()).toBe(true);
    expect(refresh.isClosed()).toBe(true);
  });

  test("non-empty launch list selects the first row, waits for it, and exposes run fields", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
        waitImpl: async () => ({ runStatus: "completed", loopOutcomeKind: "complete", resumable: false }),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    view.quit();
    await pending;

    expect(clientOptions.methods).toEqual(["health", "status", "list", "wait:run-alpha", "close"]);
    expect(view.monitorStates[0]?.runs).toEqual([RUN_ALPHA, RUN_BETA]);
    expect(view.monitorStates[0]?.selectedRunId).toBe("run-alpha");
  });

  test("empty launch list shows an explicit empty state, does not select a run, and does not wait", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [] }],
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    view.quit();
    await pending;

    expect(clientOptions.methods).toEqual(["health", "status", "list", "close"]);
    expect(view.monitorStates[0]).toEqual({
      runs: [],
      selectedRunId: null,
      waitState: { kind: "none" },
    });
  });

  test("refresh updates displayed status and liveness without relaunching", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA] }, { runs: [{ ...RUN_ALPHA, status: "completed", isLive: false }] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host, refreshScheduler: refresh.scheduler },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    refresh.tick();
    await flush();
    view.quit();
    await pending;

    expect(view.monitorStates.at(-1)?.runs).toEqual([{ ...RUN_ALPHA, status: "completed", isLive: false }]);
  });

  test("refresh clears selection and abandons a pending wait when the selected run disappears", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const alphaWait = deferred<WaitRunCompletionResult>();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }, { runs: [RUN_BETA] }],
        waitImpl: async () => alphaWait.promise,
      },
      { viewHost: view.host, refreshScheduler: refresh.scheduler },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    refresh.tick();
    await flush();
    alphaWait.resolve({ runStatus: "completed", loopOutcomeKind: "complete" });
    await flush();
    view.quit();
    await pending;

    expect(clientOptions.methods).toEqual(["health", "status", "list", "wait:run-alpha", "list", "close"]);
    expect(view.monitorStates.at(-1)).toEqual({
      runs: [RUN_BETA],
      selectedRunId: null,
      waitState: { kind: "none" },
    });
  });

  test("selecting a quiescent run waits for that run and shows only present optional outcome fields", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
        waitImpl: async (runId) =>
          runId === "run-alpha" ? { runStatus: "completed" } : { runStatus: "blocked", iterationsConsumed: 3 },
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectRun("run-beta");
    await flush();
    view.quit();
    await pending;

    const finalWaitState = view.monitorStates.at(-1)?.waitState;
    expect(clientOptions.methods).toEqual(["health", "status", "list", "wait:run-alpha", "wait:run-beta", "close"]);
    expect(view.monitorStates.at(-1)).toMatchObject({
      selectedRunId: "run-beta",
      waitState: {
        kind: "ready",
        runId: "run-beta",
        result: { runStatus: "blocked", iterationsConsumed: 3 },
      },
    });
    if (finalWaitState?.kind !== "ready") {
      throw new Error("expected ready wait state");
    }
    expect("loopOutcomeKind" in finalWaitState.result).toBe(false);
    expect("resumable" in finalWaitState.result).toBe(false);
  });

  test("deferred wait keeps the outcome panel pending until the boundary reply arrives", async () => {
    const view = createViewHost();
    const alphaWait = deferred<WaitRunCompletionResult>();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => alphaWait.promise,
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "pending", runId: "run-alpha" });

    alphaWait.resolve({ runStatus: "completed", loopOutcomeKind: "complete", resumable: false });
    await flush();
    view.quit();
    await pending;

    expect(view.monitorStates.at(-1)?.waitState).toEqual({
      kind: "ready",
      runId: "run-alpha",
      result: { runStatus: "completed", loopOutcomeKind: "complete", resumable: false },
    });
  });

  test("changing selection while wait is pending abandons the prior wait and starts a fresh one", async () => {
    const view = createViewHost();
    const alphaWait = deferred<WaitRunCompletionResult>();
    const betaWait = deferred<WaitRunCompletionResult>();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
        waitImpl: async (runId) => (runId === "run-alpha" ? alphaWait.promise : betaWait.promise),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectRun("run-beta");
    await flush();
    betaWait.resolve({ runStatus: "completed" });
    await flush();
    view.quit();
    await pending;

    expect(clientOptions.methods).toEqual(["health", "status", "list", "wait:run-alpha", "wait:run-beta", "close"]);
    expect(view.monitorStates.at(-2)?.waitState).toEqual({ kind: "pending", runId: "run-beta" });
    expect(view.monitorStates.at(-1)?.waitState).toEqual({
      kind: "ready",
      runId: "run-beta",
      result: { runStatus: "completed" },
    });
  });

  test("late replies from abandoned waits are ignored", async () => {
    const view = createViewHost();
    const alphaWait = deferred<WaitRunCompletionResult>();
    const betaWait = deferred<WaitRunCompletionResult>();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
        waitImpl: async (runId) => (runId === "run-alpha" ? alphaWait.promise : betaWait.promise),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectRun("run-beta");
    await flush();
    betaWait.resolve({ runStatus: "blocked", loopOutcomeKind: "blocked" });
    await flush();
    alphaWait.resolve({ runStatus: "completed", loopOutcomeKind: "complete" });
    await flush();
    view.quit();
    await pending;

    expect(view.monitorStates.at(-1)?.waitState).toEqual({
      kind: "ready",
      runId: "run-beta",
      result: { runStatus: "blocked", loopOutcomeKind: "blocked" },
    });
  });

  test("initial health and status RPC errors pass through as rpc-error and exit 1", async () => {
    const view = createViewHost();

    const unhealthy = await runTuiEntry({
      viewHost: view.host,
      connectTuiDaemon: async () =>
        fakeClient({
          healthError: new TuiDaemonRpcError("unhealthy", "daemon not ready"),
        }),
    });

    const unavailableStatus = await runTuiEntry({
      viewHost: view.host,
      connectTuiDaemon: async () =>
        fakeClient({
          statusError: new TuiDaemonRpcError("status_unavailable", "no status"),
        }),
    });

    expect(unhealthy).toBe(1);
    expect(unavailableStatus).toBe(1);
    expect(view.feedbackStates).toEqual([
      { kind: "rpc-error", code: "unhealthy", message: "daemon not ready" },
      { kind: "rpc-error", code: "status_unavailable", message: "no status" },
    ]);
  });

  test("post-proof initial list failure shows rpc-error not unavailable feedback", async () => {
    const view = createViewHost();

    const code = await runTuiEntry({
      viewHost: view.host,
      connectTuiDaemon: async () =>
        fakeClient({
          listError: new TuiDaemonConnectionError("malformed RPC reply: invalid list result"),
        }),
    });

    expect(code).toBe(1);
    expect(view.feedbackStates).toEqual([
      {
        kind: "rpc-error",
        code: "daemon_error",
        message: "malformed RPC reply: invalid list result",
      },
    ]);
  });

  test("refresh preserves selection changed while list is in flight", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const refreshList = deferred<TuiDaemonListResult>();
    let listCalls = 0;

    const client: TuiDaemonClient = {
      async health() {
        return { ok: true };
      },
      async status() {
        return { state: "running" };
      },
      async list() {
        listCalls += 1;
        if (listCalls === 1) {
          return { runs: [RUN_ALPHA, RUN_BETA] };
        }
        return refreshList.promise;
      },
      async start() {
        return { runId: "unused" };
      },
      async wait(runId) {
        return runId === "run-alpha" ? { runStatus: "completed" } : { runStatus: "blocked", iterationsConsumed: 3 };
      },
      close() {},
    };

    const pending = runTuiEntry({
      viewHost: view.host,
      refreshScheduler: refresh.scheduler,
      connectTuiDaemon: async () => client,
    });
    await view.waitUntilOpen();
    await flush();

    refresh.tick();
    view.selectRun("run-beta");
    await flush();
    refreshList.resolve({ runs: [RUN_BETA] });
    await flush();

    expect(view.monitorStates.at(-1)).toMatchObject({
      runs: [RUN_BETA],
      selectedRunId: "run-beta",
    });

    view.quit();
    await pending;
  });

  test("wait failure with unchanged selection shows error state not perpetual pending", async () => {
    const view = createViewHost();
    const alphaWait = deferred<WaitRunCompletionResult>();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => alphaWait.promise,
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "pending", runId: "run-alpha" });

    alphaWait.reject(new TuiDaemonRpcError("unknown_run", "run not found"));
    await flush();

    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "error", runId: "run-alpha" });

    view.quit();
    await pending;
  });

  test("the monitor never sends steering RPCs", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA, RUN_BETA, RUN_GAMMA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.selectRun("run-gamma");
    await flush();
    view.quit();
    await pending;

    const methods = clientOptions.methods ?? [];
    expect(methods).toEqual(["health", "status", "list", "wait:run-alpha", "wait:run-gamma", "close"]);
    expect(methods.some((method) => ["start", "pause", "resume", "kill"].includes(method))).toBe(false);
  });
});
