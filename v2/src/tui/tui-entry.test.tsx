import { describe, expect, test } from "bun:test";
import type { WaitRunCompletionResult } from "../daemon/daemon.ts";
import type { DaemonListResult, DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { RpcConnectionError, RpcError } from "../ipc/rpc-errors.ts";
import type { TuiDaemonClient } from "./tui-daemon-client.ts";
import { TUI_DAEMON_SOCKET_DISPLAY } from "./tui-daemon-errors.ts";
import { runTuiEntry } from "./tui-entry.tsx";
import { monitorTextLines } from "./tui-monitor-lines.ts";
import type {
  RunTuiEntryDeps,
  TuiMonitorControls,
  TuiMonitorSession,
  TuiMonitorState,
  TuiViewHost,
  TuiViewState,
} from "./tui-monitor-types.ts";

const RUN_ALPHA: DaemonListRunRow = {
  runId: "run-alpha",
  project: "demo",
  branch: "alpha",
  status: "in-progress",
  isLive: true,
};

const RUN_BETA: DaemonListRunRow = {
  runId: "run-beta",
  project: "demo",
  branch: "beta",
  status: "completed",
  isLive: false,
};

const RUN_GAMMA: DaemonListRunRow = {
  runId: "run-gamma",
  project: "demo",
  branch: "gamma",
  status: "blocked",
  isLive: false,
};

const RUN_DELTA: DaemonListRunRow = {
  runId: "run-delta",
  project: "demo",
  branch: "delta",
  status: "awaiting-human",
  isLive: false,
};

const RUN_QUEUED: DaemonListRunRow = {
  runId: "run-queued",
  project: "demo",
  branch: "queued",
  status: "queued",
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

function lastMonitorState(states: TuiMonitorState[]): TuiMonitorState {
  const last = states.at(-1);
  if (last === undefined) throw new Error("expected at least one monitor state");
  return last;
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
    pauseSelected() {
      controls?.pauseSelected();
    },
    resumeSelected() {
      controls?.resumeSelected();
    },
    killSelected() {
      controls?.killSelected();
    },
    approveSelected() {
      controls?.approveSelected();
    },
    reviseSelected(prompt?: string) {
      controls?.reviseSelected(prompt);
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
  healthError?: RpcError;
  statusError?: RpcError;
  listResponses?: DaemonListResult[];
  listError?: Error;
  waitImpl?: (runId: string) => Promise<WaitRunCompletionResult>;
  pauseError?: Error;
  resumeError?: Error;
  killError?: Error;
  pauseImpl?: (runId: string) => Promise<{ ok: true }>;
  resumeImpl?: (runId: string) => Promise<{ ok: true }>;
  killImpl?: (runId: string) => Promise<{ ok: true }>;
  resumeOptionsLog?: { decision?: string; prompt?: string }[];
};

function fakeClient(options: FakeClientOptions = {}): TuiDaemonClient {
  const methods = options.methods ?? [];
  let listIndex = 0;

  const steer =
    (method: "pause" | "kill") =>
    async (runId: string): Promise<{ ok: true }> => {
      methods.push(`${method}:${runId}`);
      const errorKey = `${method}Error` as const;
      if (options[errorKey] !== undefined) throw options[errorKey];
      const impl = options[`${method}Impl` as const];
      return (impl ?? (async () => ({ ok: true as const })))(runId);
    };

  const resume = async (
    runId: string,
    resumeOptions?: { decision?: "approve" | "abort" | "revise"; prompt?: string },
  ): Promise<{ ok: true }> => {
    methods.push(`resume:${runId}`);
    options.resumeOptionsLog?.push(resumeOptions ?? {});
    if (options.resumeError !== undefined) throw options.resumeError;
    return (options.resumeImpl ?? (async () => ({ ok: true as const })))(runId);
  };

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
    pause: steer("pause"),
    resume,
    kill: steer("kill"),
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
        throw new RpcConnectionError("cannot connect");
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
      steeringFeedback: null,
    });
  });

  test("initial selection skips queued runs and picks the first non-queued row", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_QUEUED, RUN_ALPHA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    view.quit();
    await pending;

    expect(clientOptions.methods).toEqual(["health", "status", "list", "wait:run-alpha", "close"]);
    expect(view.monitorStates[0]?.selectedRunId).toBe("run-alpha");
  });

  test("no selection when only queued runs are present", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_QUEUED] }],
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    view.quit();
    await pending;

    expect(clientOptions.methods).toEqual(["health", "status", "list", "close"]);
    expect(view.monitorStates[0]?.selectedRunId).toBeNull();
  });

  test("selectRun is a no-op for a queued run's id", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA, RUN_QUEUED] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    view.selectRun("run-queued");
    await flush();
    view.quit();
    await pending;

    expect(view.monitorStates.at(-1)?.selectedRunId).toBe("run-alpha");
    expect(clientOptions.methods).toEqual(["health", "status", "list", "wait:run-alpha", "close"]);
  });

  test("refresh clears selection when the selected run transitions to queued", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const { deps } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }, { runs: [{ ...RUN_ALPHA, status: "queued", isLive: false }] }],
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

    expect(view.monitorStates.at(-1)?.selectedRunId).toBeNull();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "none" });
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
      steeringFeedback: null,
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
          healthError: new RpcError("unhealthy", "daemon not ready"),
        }),
    });

    const unavailableStatus = await runTuiEntry({
      viewHost: view.host,
      connectTuiDaemon: async () =>
        fakeClient({
          statusError: new RpcError("status_unavailable", "no status"),
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
          listError: new RpcConnectionError("malformed RPC reply: invalid list result"),
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
    const refreshList = deferred<DaemonListResult>();
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
      async pause() {
        return { ok: true };
      },
      async resume() {
        return { ok: true };
      },
      async kill() {
        return { ok: true };
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

    alphaWait.reject(new RpcError("unknown_run", "run not found"));
    await flush();

    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "error", runId: "run-alpha" });

    view.quit();
    await pending;
  });

  test("steering sends pause, resume, and kill for the selected run and keeps the monitor open", async () => {
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
    view.pauseSelected();
    await flush();
    view.resumeSelected();
    await flush();
    view.killSelected();
    await flush();
    view.quit();
    const code = await pending;

    expect(code).toBe(0);
    const methods = clientOptions.methods ?? [];
    expect(methods).toContain("pause:run-gamma");
    expect(methods).toContain("resume:run-gamma");
    expect(methods).toContain("kill:run-gamma");
  });

  test("approveSelected sends resume with decision approve for the selected run", async () => {
    const view = createViewHost();
    const resumeOptionsLog: { decision?: string; prompt?: string }[] = [];
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_DELTA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
        resumeOptionsLog,
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.approveSelected();
    await flush();

    expect(resumeOptionsLog).toEqual([{ decision: "approve" }]);
    view.quit();
    expect(await pending).toBe(0);
  });

  test("reviseSelected sends resume with decision revise and the given prompt, or none for an empty buffer", async () => {
    const view = createViewHost();
    const resumeOptionsLog: { decision?: string; prompt?: string }[] = [];
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_DELTA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
        resumeOptionsLog,
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.reviseSelected("try again");
    await flush();
    view.reviseSelected();
    await flush();

    expect(resumeOptionsLog).toEqual([{ decision: "revise", prompt: "try again" }, { decision: "revise" }]);
    view.quit();
    expect(await pending).toBe(0);
  });

  test("killSelected sends resume with decision abort for an awaiting-human run but plain kill otherwise", async () => {
    const view = createViewHost();
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA, RUN_DELTA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    view.selectRun("run-delta");
    await flush();
    view.killSelected();
    await flush();

    view.selectRun("run-alpha");
    await flush();
    view.killSelected();
    await flush();

    view.quit();
    expect(await pending).toBe(0);
    const methods = clientOptions.methods ?? [];
    expect(methods).toContain("resume:run-delta");
    expect(methods).toContain("kill:run-alpha");
  });

  test("steering RPC errors render inline and keep the monitor open", async () => {
    const cases = [
      { action: "pauseSelected" as const, error: new RpcError("unknown_run", "run not found") },
      { action: "pauseSelected" as const, error: new RpcError("run_not_active", "not active") },
      { action: "killSelected" as const, error: new RpcError("run_not_active", "not active") },
      { action: "resumeSelected" as const, error: new RpcError("terminal_run", "terminal") },
      { action: "resumeSelected" as const, error: new RpcError("unknown_run", "run not found") },
    ];

    for (const { action, error } of cases) {
      const view = createViewHost();
      const errorKey =
        action === "pauseSelected" ? "pauseError" : action === "killSelected" ? "killError" : "resumeError";
      const { deps } = entryDeps(
        {
          listResponses: [{ runs: [RUN_ALPHA] }],
          waitImpl: async () => ({ runStatus: "completed" }),
          [errorKey]: error,
        },
        { viewHost: view.host },
      );

      const pending = runTuiEntry(deps);
      await view.waitUntilOpen();
      await flush();
      view[action]();
      await flush();
      expect(view.monitorStates.at(-1)?.steeringFeedback).toBe(`${error.code}: ${error.message}`);
      view.quit();
      expect(await pending).toBe(0);
    }
  });

  test("steering connection errors render inline as daemon_error and keep the monitor open", async () => {
    const view = createViewHost();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
        killError: new RpcConnectionError("socket closed"),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.killSelected();
    await flush();

    expect(view.monitorStates.at(-1)?.steeringFeedback).toBe("daemon_error: socket closed");

    view.quit();
    expect(await pending).toBe(0);
  });

  test("steering with no selected run is a no-op and shows no run selected", async () => {
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
    await flush();
    view.pauseSelected();
    await flush();

    expect(clientOptions.methods).toEqual(["health", "status", "list"]);
    expect(view.monitorStates.at(-1)?.steeringFeedback).toBe("no run selected");

    view.quit();
    await pending;
  });

  test("steering feedback replaces on the next action and clears on selection change", async () => {
    const view = createViewHost();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA, RUN_BETA] }],
        waitImpl: async () => ({ runStatus: "completed" }),
        pauseError: new RpcError("run_not_active", "not active"),
        killError: new RpcError("unknown_run", "missing"),
      },
      { viewHost: view.host },
    );

    const _pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    view.pauseSelected();
    await flush();
    expect(view.monitorStates.at(-1)?.steeringFeedback).toBe("run_not_active: not active");

    view.killSelected();
    await flush();
    expect(view.monitorStates.at(-1)?.steeringFeedback).toBe("unknown_run: missing");

    view.selectRun("run-beta");
    await flush();
    expect(view.monitorStates.at(-1)?.steeringFeedback).toBeNull();
  });

  test("waitState error display is unchanged by steering feedback", async () => {
    const view = createViewHost();
    const alphaWait = deferred<WaitRunCompletionResult>();
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => alphaWait.promise,
        pauseError: new RpcError("run_not_active", "not active"),
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    alphaWait.reject(new RpcError("unknown_run", "run not found"));
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "error", runId: "run-alpha" });

    view.pauseSelected();
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "error", runId: "run-alpha" });
    expect(view.monitorStates.at(-1)?.steeringFeedback).toBe("run_not_active: not active");

    view.quit();
    await pending;
  });

  test("successful pause and kill do not re-issue wait or mutate waitState", async () => {
    const viewPause = createViewHost();
    const pauseWait = deferred<WaitRunCompletionResult>();
    const { deps: pauseDeps, clientOptions: pauseClient } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => pauseWait.promise,
      },
      { viewHost: viewPause.host },
    );

    const pausePending = runTuiEntry(pauseDeps);
    await viewPause.waitUntilOpen();
    await flush();
    pauseWait.resolve({ runStatus: "completed" });
    await flush();
    expect(viewPause.monitorStates.at(-1)?.waitState?.kind).toBe("ready");
    const readyWaitState = viewPause.monitorStates.at(-1)?.waitState;
    const pauseWaitCount = pauseClient.methods?.filter((method) => method === "wait:run-alpha").length ?? 0;

    viewPause.pauseSelected();
    await flush();

    expect(viewPause.monitorStates.at(-1)?.waitState).toEqual(readyWaitState);
    expect(pauseClient.methods?.filter((method) => method === "wait:run-alpha").length).toBe(pauseWaitCount);
    expect(pauseClient.methods).toContain("pause:run-alpha");
    viewPause.quit();
    await pausePending;

    const viewKill = createViewHost();
    const alphaWait = deferred<WaitRunCompletionResult>();
    const { deps: killDeps, clientOptions: killClient } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => alphaWait.promise,
      },
      { viewHost: viewKill.host },
    );

    const killPending = runTuiEntry(killDeps);
    await viewKill.waitUntilOpen();
    await flush();
    expect(viewKill.monitorStates.at(-1)?.waitState).toEqual({ kind: "pending", runId: "run-alpha" });
    const pendingWaitState = viewKill.monitorStates.at(-1)?.waitState;
    const killWaitCount = killClient.methods?.filter((method) => method === "wait:run-alpha").length ?? 0;

    viewKill.killSelected();
    await flush();

    expect(viewKill.monitorStates.at(-1)?.waitState).toEqual(pendingWaitState);
    expect(killClient.methods?.filter((method) => method === "wait:run-alpha").length).toBe(killWaitCount);
    expect(killClient.methods).toContain("kill:run-alpha");
    viewKill.quit();
    await killPending;
  });

  test("steering on terminal or non-live rows passes through to daemon without client pre-gate", async () => {
    const cases = [
      { row: RUN_BETA, action: "pauseSelected" as const, errorKey: "pauseError" as const },
      { row: RUN_GAMMA, action: "killSelected" as const, errorKey: "killError" as const },
    ];

    for (const { row, action, errorKey } of cases) {
      const view = createViewHost();
      const error = new RpcError("run_not_active", "not active");
      const { deps, clientOptions } = entryDeps(
        {
          methods: [],
          listResponses: [{ runs: [RUN_ALPHA, row] }],
          waitImpl: async () => ({ runStatus: "completed" }),
          [errorKey]: error,
        },
        { viewHost: view.host },
      );

      const pending = runTuiEntry(deps);
      await view.waitUntilOpen();
      await flush();
      view.selectRun(row.runId);
      await flush();
      view[action]();
      await flush();

      const rpcMethod = action === "pauseSelected" ? "pause" : "kill";
      expect(clientOptions.methods).toContain(`${rpcMethod}:${row.runId}`);
      expect(view.monitorStates.at(-1)?.steeringFeedback).toBe(`${error.code}: ${error.message}`);

      view.quit();
      expect(await pending).toBe(0);
    }
  });

  test("workflow step view follows list refresh and selection", async () => {
    const view = createViewHost();
    const refresh = createRefreshScheduler();
    const step1Completed = {
      stepId: "step-1",
      role: "implement",
      status: "completed",
      attemptCount: 1,
      terminalOutcome: "complete",
    } as const;
    const workflowRun: DaemonListRunRow = {
      ...RUN_ALPHA,
      workflow: {
        steps: [
          step1Completed,
          { stepId: "step-2", role: "review", status: "in_progress", attemptCount: 1 },
          { stepId: "step-3", role: "verify", status: "pending", attemptCount: 0 },
        ],
      },
    };
    const advancedWorkflow: DaemonListRunRow = {
      ...workflowRun,
      workflow: {
        steps: [
          step1Completed,
          { stepId: "step-2", role: "review", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
          { stepId: "step-3", role: "verify", status: "in_progress", attemptCount: 1 },
        ],
      },
    };
    const { deps } = entryDeps(
      {
        listResponses: [{ runs: [workflowRun, RUN_BETA] }, { runs: [advancedWorkflow, RUN_BETA] }],
        waitImpl: async () => ({ runStatus: "in-progress" }),
      },
      { viewHost: view.host, refreshScheduler: refresh.scheduler },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();

    let lines = monitorTextLines(lastMonitorState(view.monitorStates));
    expect(lines).toContain("Workflow");
    expect(lines).toContain("> step-2 review in_progress attempts=1");

    refresh.tick();
    await flush();

    const refreshed = lastMonitorState(view.monitorStates);
    expect(refreshed.selectedRunId).toBe("run-alpha");
    lines = monitorTextLines(refreshed);
    expect(lines).toContain("> step-3 verify in_progress attempts=1");

    view.selectRun("run-beta");
    await flush();
    expect(monitorTextLines(lastMonitorState(view.monitorStates))).not.toContain("Workflow");

    view.quit();
    await pending;
  });

  test("successful resume re-issues wait and abandons a prior ready snapshot", async () => {
    const view = createViewHost();
    const waitQueue: Array<ReturnType<typeof deferred<WaitRunCompletionResult>>> = [];
    const { deps, clientOptions } = entryDeps(
      {
        methods: [],
        listResponses: [{ runs: [RUN_ALPHA] }],
        waitImpl: async () => {
          const pending = deferred<WaitRunCompletionResult>();
          waitQueue.push(pending);
          return pending.promise;
        },
      },
      { viewHost: view.host },
    );

    const pending = runTuiEntry(deps);
    await view.waitUntilOpen();
    await flush();
    waitQueue[0]?.resolve({ runStatus: "completed", loopOutcomeKind: "complete" });
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toMatchObject({ kind: "ready", runId: "run-alpha" });

    view.resumeSelected();
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toEqual({ kind: "pending", runId: "run-alpha" });
    expect(clientOptions.methods).toContain("resume:run-alpha");
    expect(clientOptions.methods?.filter((method) => method === "wait:run-alpha").length).toBe(2);

    waitQueue[1]?.resolve({ runStatus: "in-progress" });
    await flush();
    await flush();
    expect(view.monitorStates.at(-1)?.waitState).toMatchObject({
      kind: "ready",
      runId: "run-alpha",
      result: { runStatus: "in-progress" },
    });

    view.quit();
    await pending;
  });
});
