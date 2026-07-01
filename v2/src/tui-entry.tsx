import type { DaemonListResult, DaemonListRunRow } from "./daemon-wire.ts";
import { connectTuiDaemon, type TuiDaemonClient } from "./tui-daemon-client.ts";
import { TuiDaemonConnectionError, TuiDaemonRpcError } from "./tui-daemon-errors.ts";
import { showTuiInkFeedback } from "./tui-ink-feedback.tsx";
import { openInkMonitor } from "./tui-ink-monitor.tsx";
import type {
  RunTuiEntryDeps,
  TuiMonitorControls,
  TuiMonitorSession,
  TuiMonitorState,
  TuiRefreshScheduler,
  TuiViewState,
  TuiWaitState,
} from "./tui-monitor-types.ts";

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

function firstRunId(runs: readonly DaemonListRunRow[]): string | null {
  return runs[0]?.runId ?? null;
}

function buildWaitStateForSelection(runId: string | null): TuiWaitState {
  return runId === null ? { kind: "none" } : { kind: "pending", runId };
}

function entryErrorFeedback(error: unknown): TuiViewState {
  if (error instanceof TuiDaemonRpcError) {
    return { kind: "rpc-error", code: error.code, message: error.message };
  }
  if (error instanceof TuiDaemonConnectionError) {
    return { kind: "rpc-error", code: "daemon_error", message: error.message };
  }
  throw error;
}

function steeringFeedbackFromError(error: unknown): string {
  if (error instanceof TuiDaemonRpcError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof TuiDaemonConnectionError) {
    return `daemon_error: ${error.message}`;
  }
  throw error;
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
  let currentState: TuiMonitorState = {
    runs: [],
    selectedRunId: null,
    waitState: { kind: "none" },
    steeringFeedback: null,
  };
  let activeWaitToken = 0;
  let refreshInFlight = false;
  let refreshQueued = false;
  const lastReadyByRunId = new Map<string, Extract<TuiWaitState, { kind: "ready" }>>();
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

  const startWaitForRun = (runId: string): void => {
    const waitToken = activeWaitToken;
    void (async () => {
      try {
        const result = await client?.wait(runId);
        if (result === undefined) return;
        if (waitToken !== activeWaitToken || currentState.selectedRunId !== runId) return;
        const readyState = { kind: "ready" as const, runId, result };
        lastReadyByRunId.set(runId, readyState);
        setState({
          ...currentState,
          waitState: readyState,
        });
      } catch {
        if (waitToken !== activeWaitToken || currentState.selectedRunId !== runId) return;
        const lastReady = lastReadyByRunId.get(runId);
        setState({
          ...currentState,
          waitState: lastReady ?? { kind: "error", runId },
        });
      }
    })();
  };

  const setSelection = (runId: string | null): void => {
    activeWaitToken += 1;
    setState({
      ...currentState,
      selectedRunId: runId,
      waitState: buildWaitStateForSelection(runId),
      steeringFeedback: null,
    });
    if (runId !== null) {
      startWaitForRun(runId);
    }
  };

  const runSteeringAction = (
    invoke: (runId: string) => Promise<{ ok: true }>,
    options?: { rewaitOnSuccess?: boolean },
  ): void => {
    const runId = currentState.selectedRunId;
    if (runId === null) {
      setState({ ...currentState, steeringFeedback: "no run selected" });
      return;
    }

    void (async () => {
      try {
        await invoke(runId);
        if (currentState.selectedRunId !== runId) return;
        if (options?.rewaitOnSuccess) {
          activeWaitToken += 1;
          lastReadyByRunId.delete(runId);
          setState({
            ...currentState,
            waitState: buildWaitStateForSelection(runId),
            steeringFeedback: null,
          });
          startWaitForRun(runId);
          return;
        }
        setState({ ...currentState, steeringFeedback: null });
      } catch (error) {
        if (currentState.selectedRunId !== runId) return;
        setState({
          ...currentState,
          steeringFeedback: steeringFeedbackFromError(error),
        });
      }
    })();
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
        let list: DaemonListResult | undefined;
        try {
          list = await client?.list();
        } catch (error) {
          if (initial) throw error;
          return;
        }
        if (list === undefined) return;

        if (initial) {
          const runId = firstRunId(list.runs);
          currentState = {
            runs: list.runs,
            selectedRunId: runId,
            waitState: buildWaitStateForSelection(runId),
            steeringFeedback: null,
          };
          return;
        }

        const selectedRunId = currentState.selectedRunId;
        if (selectedRunId !== null && !list.runs.some((run) => run.runId === selectedRunId)) {
          setState({ runs: list.runs, selectedRunId: null, waitState: { kind: "none" }, steeringFeedback: null });
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
  } catch (error) {
    if (error instanceof TuiDaemonConnectionError) {
      await presentFeedback({ kind: "unavailable" }, resolved);
      return 1;
    }
    throw error;
  }

  try {
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
        pauseSelected() {
          runSteeringAction((id) => client!.pause(id));
        },
        resumeSelected() {
          runSteeringAction((id) => client!.resume(id), { rewaitOnSuccess: true });
        },
        killSelected() {
          runSteeringAction((id) => client!.kill(id));
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
    if (error instanceof TuiDaemonRpcError || error instanceof TuiDaemonConnectionError) {
      await presentFeedback(entryErrorFeedback(error), resolved);
      return 1;
    }
    throw error;
  } finally {
    refreshHandle?.close();
    session?.close();
    client?.close();
  }
}
