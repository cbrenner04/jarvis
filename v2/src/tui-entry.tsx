import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import type { WaitRunCompletionResult } from "./daemon.ts";
import {
  type ConnectTuiDaemonOptions,
  connectTuiDaemon,
  TUI_DAEMON_SOCKET_DISPLAY,
  type TuiDaemonClient,
  TuiDaemonConnectionError,
  TuiDaemonRpcError,
  type TuiDaemonRunSummary,
} from "./tui-daemon-client.ts";
import type { InkRender } from "./tui-ink-feedback.tsx";

export { TUI_DAEMON_SOCKET_DISPLAY };

/** Operator-visible non-monitor feedback states. */
export type TuiViewState = { kind: "rpc-error"; code: string; message: string } | { kind: "unavailable" };

/** Outcome-panel state for the selected run. */
export type TuiWaitState =
  | { kind: "none" }
  | { kind: "pending"; runId: string }
  | { kind: "ready"; runId: string; result: WaitRunCompletionResult };

/** Operator-visible monitor snapshot. */
export type TuiMonitorState = {
  runs: readonly TuiDaemonRunSummary[];
  selectedRunId: string | null;
  waitState: TuiWaitState;
};

/** Injectable selection and quit controls exposed to the monitor host. */
export type TuiMonitorControls = {
  /** Change selection to the given run when present in the current list. */
  selectRun(runId: string): void;
  /** Exit the monitor. */
  quit(): void;
};

/** Open monitor session returned by a host. */
export type TuiMonitorSession = {
  /** Push a fresh monitor snapshot to the active view. */
  update(state: TuiMonitorState): void | Promise<void>;
  /** Resolve when the operator quits. */
  waitUntilExit(): Promise<void>;
  /** Tear down any view resources; idempotent. */
  close(): void;
};

/** Injectable view host for tests and alternate renderers. */
export type TuiViewHost = {
  /**
   * Record or render operator-visible non-monitor feedback.
   * @param state RPC or unavailable-daemon state.
   */
  show(state: TuiViewState): void | Promise<void>;
  /**
   * Open the interactive monitor from the initial snapshot.
   * @param state Initial run-list and outcome snapshot.
   * @param controls Selection and quit controls owned by the monitor core.
   */
  openMonitor(state: TuiMonitorState, controls: TuiMonitorControls): Promise<TuiMonitorSession>;
};

/** Refresh scheduler seam for periodic daemon `list` polling. */
export type TuiRefreshScheduler = {
  /**
   * Start periodic refresh callbacks.
   * @param onRefresh Callback that performs one refresh tick.
   * @returns Disposable handle for teardown.
   */
  start(onRefresh: () => void): { close(): void };
};

/** Dependencies for {@link runTuiEntry}. */
export type RunTuiEntryDeps = {
  /** Unix socket path; production default is `~/.jarvis/daemon.sock`. */
  socketPath?: string;
  /** Injectable daemon client seam; defaults to {@link connectTuiDaemon}. */
  connectTuiDaemon?: (options?: ConnectTuiDaemonOptions) => Promise<TuiDaemonClient>;
  /** Injectable monitor refresh scheduler; defaults to a 1s interval poller. */
  refreshScheduler?: TuiRefreshScheduler;
  /** When set, skips production ink rendering. */
  viewHost?: TuiViewHost;
  /** Injectable ink render; defaults to production `render`. */
  inkRender?: InkRender;
};

const TUI_REFRESH_INTERVAL_MS = 1_000;

function presentFeedback(state: TuiViewState, deps: RunTuiEntryDeps): Promise<void> {
  if (deps.viewHost !== undefined) {
    return Promise.resolve(deps.viewHost.show(state));
  }
  return showTuiInkFeedback(state, deps.inkRender);
}

async function openMonitor(
  state: TuiMonitorState,
  controls: TuiMonitorControls,
  deps: RunTuiEntryDeps,
): Promise<TuiMonitorSession> {
  if (deps.viewHost !== undefined) {
    return deps.viewHost.openMonitor(state, controls);
  }
  return openInkMonitor(state, controls, deps.inkRender);
}

function createRefreshScheduler(intervalMs = TUI_REFRESH_INTERVAL_MS): TuiRefreshScheduler {
  return {
    start(onRefresh) {
      const timer = setInterval(onRefresh, intervalMs);
      return {
        close() {
          clearInterval(timer);
        },
      };
    },
  };
}

function firstRunId(runs: readonly TuiDaemonRunSummary[]): string | null {
  return runs[0]?.runId ?? null;
}

function buildWaitStateForSelection(runId: string | null): TuiWaitState {
  return runId === null ? { kind: "none" } : { kind: "pending", runId };
}

async function showTuiInkFeedback(state: TuiViewState, inkRender?: InkRender): Promise<void> {
  let renderFn: InkRender;
  let Text: (props: { children?: ReactNode }) => ReactElement;

  if (inkRender !== undefined) {
    renderFn = inkRender;
    Text = ({ children }) => createElement(Fragment, null, children);
  } else {
    const ink = await import("ink");
    renderFn = ink.render;
    Text = ({ children }) => createElement(ink.Text, null, children);
  }

  const element =
    state.kind === "rpc-error"
      ? createElement(Text, null, `${state.code}: ${state.message}`)
      : createElement(
          Text,
          null,
          `Daemon unavailable at ${TUI_DAEMON_SOCKET_DISPLAY}. Start with: jarvis daemon start`,
        );

  const instance = renderFn(element);
  await instance.waitUntilRenderFlush();
  instance.unmount();
}

async function openInkMonitor(
  initialState: TuiMonitorState,
  controls: TuiMonitorControls,
  inkRender?: InkRender,
): Promise<TuiMonitorSession> {
  let renderFn: InkRender;
  let Box: ((props: { children?: ReactNode; flexDirection?: "column" | "row" }) => ReactElement) | undefined;
  let Text: (props: { children?: ReactNode }) => ReactElement;
  let useInput:
    | ((
        inputHandler: (
          input: string,
          key: { ctrl?: boolean; upArrow?: boolean; downArrow?: boolean; return?: boolean },
        ) => void,
      ) => void)
    | undefined;

  if (inkRender !== undefined) {
    renderFn = inkRender;
    Text = ({ children }) => createElement(Fragment, null, children);
  } else {
    const ink = await import("ink");
    renderFn = ink.render;
    Box = ink.Box as typeof Box;
    Text = ({ children }) => createElement(ink.Text, null, children);
    useInput = ink.useInput;
  }

  const MonitorView = ({ state }: { state: TuiMonitorState }): ReactElement => {
    useInput?.((input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        controls.quit();
      }
    });

    const selected = state.selectedRunId;
    const waitState = state.waitState;
    const outcomeLines =
      selected === null
        ? ["No run selected."]
        : waitState.kind === "pending"
          ? [`Waiting for ${waitState.runId}...`]
          : waitState.kind === "ready"
            ? [
                `runStatus: ${waitState.result.runStatus}`,
                ...(waitState.result.loopOutcomeKind !== undefined
                  ? [`loopOutcomeKind: ${waitState.result.loopOutcomeKind}`]
                  : []),
                ...(waitState.result.iterationsConsumed !== undefined
                  ? [`iterationsConsumed: ${waitState.result.iterationsConsumed}`]
                  : []),
                ...(waitState.result.resumable !== undefined ? [`resumable: ${waitState.result.resumable}`] : []),
              ]
            : ["No outcome yet."];

    const lines: ReactElement[] = [];
    lines.push(createElement(Text, { key: "title" }, "jarvis tui"));
    if (state.runs.length === 0) {
      lines.push(createElement(Text, { key: "empty" }, "No runs."));
    } else {
      lines.push(createElement(Text, { key: "header" }, "runId project branch status liveness"));
      for (const run of state.runs) {
        const marker = run.runId === selected ? ">" : " ";
        lines.push(
          createElement(
            Text,
            { key: run.runId },
            `${marker} ${run.runId} ${run.project} ${run.branch} ${run.status} ${run.isLive ? "live" : "not-live"}`,
          ),
        );
      }
    }
    lines.push(createElement(Text, { key: "outcome-title" }, "Outcome"));
    for (const [index, line] of outcomeLines.entries()) {
      lines.push(createElement(Text, { key: `outcome-${index}` }, line));
    }
    lines.push(createElement(Text, { key: "quit" }, "Press q or Ctrl-C to quit."));

    if (Box !== undefined) {
      return createElement(Box, { flexDirection: "column" }, ...lines);
    }
    return createElement(Fragment, null, ...lines);
  };

  let currentState = initialState;
  const instance = renderFn(createElement(MonitorView, { state: currentState }));

  return {
    update(state) {
      currentState = state;
      instance.rerender(createElement(MonitorView, { state: currentState }));
    },
    async waitUntilExit() {
      await new Promise<void>(() => {});
    },
    close() {
      instance.unmount();
    },
  };
}

/** Connect, prove liveness, and enter the interactive run monitor until quit. */
export async function runTuiEntry(deps?: RunTuiEntryDeps): Promise<number> {
  const resolved = deps ?? {};
  const connectFn = resolved.connectTuiDaemon ?? connectTuiDaemon;
  const refreshScheduler = resolved.refreshScheduler ?? createRefreshScheduler();
  const connectOptions = resolved.socketPath !== undefined ? { socketPath: resolved.socketPath } : undefined;

  let client: TuiDaemonClient | undefined;
  let session: TuiMonitorSession | undefined;
  let refreshHandle: { close(): void } | undefined;
  let currentState: TuiMonitorState = { runs: [], selectedRunId: null, waitState: { kind: "none" } };
  let activeWaitToken = 0;
  let refreshInFlight = false;
  let refreshQueued = false;
  let resolveQuit!: () => void;
  const quitPromise = new Promise<void>((resolve) => {
    resolveQuit = resolve;
  });

  const syncMonitor = (): void => {
    void Promise.resolve(session?.update(currentState));
  };

  const setState = (state: TuiMonitorState): void => {
    currentState = state;
    syncMonitor();
  };

  const setSelection = (runId: string | null): void => {
    activeWaitToken += 1;
    setState({
      ...currentState,
      selectedRunId: runId,
      waitState: buildWaitStateForSelection(runId),
    });
    if (runId !== null) {
      const waitToken = activeWaitToken;
      void (async () => {
        try {
          const result = await client?.wait(runId);
          if (result === undefined) return;
          if (waitToken !== activeWaitToken || currentState.selectedRunId !== runId) return;
          setState({
            ...currentState,
            waitState: { kind: "ready", runId, result },
          });
        } catch {
          if (waitToken !== activeWaitToken) return;
        }
      })();
    }
  };

  const refreshRuns = async (initial = false): Promise<void> => {
    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }

    refreshInFlight = true;
    try {
      do {
        refreshQueued = false;
        const list = await client?.list();
        if (list === undefined) return;

        if (initial) {
          const runId = firstRunId(list.runs);
          currentState = {
            runs: list.runs,
            selectedRunId: runId,
            waitState: buildWaitStateForSelection(runId),
          };
          return;
        }

        const selectedRunId = currentState.selectedRunId;
        if (selectedRunId !== null && !list.runs.some((run) => run.runId === selectedRunId)) {
          setState({ runs: list.runs, selectedRunId: null, waitState: { kind: "none" } });
          activeWaitToken += 1;
          continue;
        }

        setState({
          ...currentState,
          runs: list.runs,
        });
      } while (refreshQueued);
    } finally {
      refreshInFlight = false;
    }
  };

  try {
    client = await connectFn(connectOptions);
    await client.health();
    await client.status();
    await refreshRuns(true);

    if (currentState.selectedRunId !== null) {
      setSelection(currentState.selectedRunId);
    }

    session = await openMonitor(
      currentState,
      {
        selectRun(runId) {
          if (!currentState.runs.some((run) => run.runId === runId) || currentState.selectedRunId === runId) return;
          setSelection(runId);
        },
        quit() {
          resolveQuit();
        },
      },
      resolved,
    );

    refreshHandle = refreshScheduler.start(() => {
      void refreshRuns(false).catch(() => {});
    });

    await Promise.race([quitPromise, session.waitUntilExit()]);
    return 0;
  } catch (error) {
    if (error instanceof TuiDaemonConnectionError) {
      await presentFeedback({ kind: "unavailable" }, resolved);
      return 1;
    }
    if (error instanceof TuiDaemonRpcError) {
      await presentFeedback({ kind: "rpc-error", code: error.code, message: error.message }, resolved);
      return 1;
    }
    throw error;
  } finally {
    refreshHandle?.close();
    session?.close();
    client?.close();
  }
}
