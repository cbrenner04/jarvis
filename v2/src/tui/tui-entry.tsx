import type { DaemonListResult, DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { discoverLiveDaemonSockets } from "../daemon/live-daemon-socket-discovery.ts";
import { mergeRunLists } from "../daemon/run-list-merge.ts";
import { RpcConnectionError, RpcError } from "../ipc/rpc-errors.ts";
import { connectTuiDaemon, type TuiDaemonClient } from "./tui-daemon-client.ts";
import { showTuiInkFeedback } from "./tui-ink-feedback.tsx";
import { openInkMonitor } from "./tui-ink-monitor.tsx";
import { firstSelectableRunId, orderSelectableRuns } from "./tui-monitor-lines.ts";
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

function buildWaitStateForSelection(runId: string | null): TuiWaitState {
  return runId === null ? { kind: "none" } : { kind: "pending", runId };
}

function entryErrorFeedback(error: unknown): TuiViewState {
  if (error instanceof RpcError) {
    return { kind: "rpc-error", code: error.code, message: error.message };
  }
  if (error instanceof RpcConnectionError) {
    return { kind: "rpc-error", code: "daemon_error", message: error.message };
  }
  throw error;
}

function steeringFeedbackFromError(error: unknown): string {
  const feedback = entryErrorFeedback(error);
  if (feedback.kind !== "rpc-error") throw new Error("unreachable");
  return `${feedback.code}: ${feedback.message}`;
}

/** Connect, prove liveness, and enter the interactive run monitor until quit. */
export async function runTuiEntry(deps: RunTuiEntryDeps): Promise<number> {
  const connectFn = deps.connectTuiDaemon ?? connectTuiDaemon;
  const refreshScheduler = deps.refreshScheduler ?? createRefreshScheduler();
  const discoverFn = deps.socketDiscovery ?? discoverLiveDaemonSockets;

  const clients: Map<string, TuiDaemonClient> = new Map();
  let runOwners: Map<string, TuiDaemonClient> = new Map();
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

  const getOwner = (runId: string): TuiDaemonClient | undefined => runOwners.get(runId);

  const setState = (state: TuiMonitorState): void => {
    currentState = state;
    syncMonitor();
  };

  const mergeAndTrackOwners = (
    listResults: Array<[TuiDaemonClient, DaemonListResult | undefined]>,
  ): DaemonListRunRow[] => {
    const { runs, owners } = mergeRunLists(listResults.map(([client, result]) => [client, result?.runs]));
    runOwners = owners;
    return runs;
  };

  const startWaitForRun = (runId: string): void => {
    const waitToken = activeWaitToken;
    const owner = getOwner(runId);
    if (!owner) return;

    void (async () => {
      try {
        const result = await owner.wait(runId);
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

  const runAction = (
    perform: (runId: string, owner: TuiDaemonClient) => Promise<unknown>,
    rewaitOnSuccess: boolean,
  ): void => {
    const runId = currentState.selectedRunId;
    if (runId === null) {
      setState({ ...currentState, steeringFeedback: "no run selected" });
      return;
    }

    const owner = getOwner(runId);
    if (!owner) {
      setState({ ...currentState, steeringFeedback: "no run selected" });
      return;
    }

    void (async () => {
      try {
        await perform(runId, owner);
        if (currentState.selectedRunId !== runId) return;
        if (rewaitOnSuccess) {
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

  const runSteeringAction = (method: "pause" | "resume" | "kill", rewaitOnSuccess = false): void =>
    runAction((runId, owner) => owner[method](runId), rewaitOnSuccess);

  const updateConnections = async (): Promise<void> => {
    const sockets = await discoverFn();
    const allSockets = new Set(sockets);
    // Include invoking socket when: discovery returns no sockets (solo fallback), already listed, or already connected
    if (sockets.length === 0 || sockets.includes(deps.socketPath) || clients.has(deps.socketPath)) {
      allSockets.add(deps.socketPath);
    }

    // Close clients for sockets no longer live
    const currentSockets = new Set(clients.keys());
    let selectedRunOwnerDropped = false;
    for (const socketPath of currentSockets) {
      if (!allSockets.has(socketPath)) {
        const client = clients.get(socketPath);
        client?.close();
        clients.delete(socketPath);

        // Track if the dropped connection owned the selected run
        if (currentState.selectedRunId !== null && getOwner(currentState.selectedRunId) === client) {
          selectedRunOwnerDropped = true;
        }
      }
    }

    // Clear selection if the owning daemon was dropped
    if (selectedRunOwnerDropped) {
      activeWaitToken += 1;
      setState({
        ...currentState,
        selectedRunId: null,
        waitState: { kind: "none" },
        steeringFeedback: null,
      });
    }

    // Add clients for newly discovered sockets
    for (const socketPath of allSockets) {
      if (!clients.has(socketPath)) {
        try {
          clients.set(socketPath, await connectFn({ socketPath }));
        } catch {
          // Retry on next tick rather than blacklist; daemon mid-startup fails first probe.
        }
      }
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

        // Rediscover live sockets and update connections
        if (!initial) {
          try {
            await updateConnections();
          } catch {
            // Rediscovery failure leaves the current connection set intact for that tick.
          }
        }

        const listResults: Array<[TuiDaemonClient, DaemonListResult | undefined]> = [];
        let allClientsFailed = true;
        let firstError: unknown;
        for (const [socketPath, client] of clients.entries()) {
          try {
            listResults.push([client, await client.list()]);
            allClientsFailed = false;
          } catch (error) {
            // Evict invoking-socket client on list failure; skip others for this tick
            if (socketPath === deps.socketPath) {
              client.close();
              clients.delete(socketPath);
            }
            listResults.push([client, undefined]);
            if (!firstError) firstError = error;
          }
        }

        if (initial && allClientsFailed) throw firstError;

        const runs = mergeAndTrackOwners(listResults);

        if (initial) {
          const runId = firstSelectableRunId(runs);
          currentState = {
            runs,
            selectedRunId: runId,
            waitState: buildWaitStateForSelection(runId),
            steeringFeedback: null,
          };
          return;
        }

        const selectedRunId = currentState.selectedRunId;
        if (selectedRunId !== null && !orderSelectableRuns(runs).some((run) => run.runId === selectedRunId)) {
          setState({ runs, selectedRunId: null, waitState: { kind: "none" }, steeringFeedback: null });
          activeWaitToken += 1;
          continue;
        }

        setState({
          ...currentState,
          runs,
        });
      } while (refreshQueued);
    } finally {
      refreshInFlight = false;
    }
  };

  try {
    await updateConnections();

    if (clients.size === 0) {
      await presentFeedback({ kind: "unavailable" }, deps);
      return 1;
    }

    // Prove liveness on all connected clients.
    const healthChecks = Array.from(clients.values()).map((client) => client.health());
    const statusChecks = Array.from(clients.values()).map((client) => client.status());
    await Promise.all([...healthChecks, ...statusChecks]);

    await refreshRuns(true);

    if (currentState.selectedRunId !== null) {
      setSelection(currentState.selectedRunId);
    }

    session = await openMonitor(
      currentState,
      {
        selectRun(runId) {
          if (!orderSelectableRuns(currentState.runs).some((run) => run.runId === runId)) return;
          if (currentState.selectedRunId === runId) return;
          setSelection(runId);
        },
        selectNextRun() {
          const rows = orderSelectableRuns(currentState.runs);
          if (rows.length === 0) return;
          const selectedIndex = rows.findIndex((run) => run.runId === currentState.selectedRunId);
          const next = rows[selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, rows.length - 1)];
          if (next !== undefined && next.runId !== currentState.selectedRunId) setSelection(next.runId);
        },
        selectPreviousRun() {
          const rows = orderSelectableRuns(currentState.runs);
          if (rows.length === 0) return;
          const selectedIndex = rows.findIndex((run) => run.runId === currentState.selectedRunId);
          const previous = rows[selectedIndex < 0 ? rows.length - 1 : Math.max(selectedIndex - 1, 0)];
          if (previous !== undefined && previous.runId !== currentState.selectedRunId) setSelection(previous.runId);
        },
        pauseSelected() {
          runSteeringAction("pause");
        },
        resumeSelected() {
          runSteeringAction("resume", true);
        },
        killSelected() {
          runSteeringAction("kill");
        },
        quit() {
          resolveQuit();
        },
      },
      deps,
    );

    refreshHandle = refreshScheduler.start(() => {
      void refreshRuns(false).catch(() => {});
    });

    await Promise.race([quitPromise, session.waitUntilExit()]);
    return 0;
  } catch (error) {
    if (error instanceof RpcError || error instanceof RpcConnectionError) {
      await presentFeedback(entryErrorFeedback(error), deps);
      return 1;
    }
    throw error;
  } finally {
    refreshHandle?.close();
    session?.close();
    for (const client of clients.values()) {
      client.close();
    }
  }
}
