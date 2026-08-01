import type { DaemonListResult } from "../daemon/daemon-wire.ts";
import { discoverLiveDaemonSockets } from "../daemon/live-daemon-socket-discovery.ts";
import { mergeRunLists } from "../daemon/merge-run-lists.ts";
import { RpcConnectionError, RpcError } from "../ipc/rpc-errors.ts";
import { connectTuiDaemon, type PipelineListResult, type TuiDaemonClient } from "./tui-daemon-client.ts";
import { showTuiInkFeedback } from "./tui-ink-feedback.tsx";
import { openInkMonitor } from "./tui-ink-monitor.tsx";
import {
  firstSelectableNodeId,
  mergePipelineSnapshots,
  monitorSelectableNodeIds,
  withLeftPaneTreeScrollFollow,
} from "./tui-monitor-lines.ts";
import { buildMonitorPipelineTreeJoin, isExpandablePipelineNodeId } from "./tui-monitor-pipeline-tree.ts";
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

export { TUI_REFRESH_INTERVAL_MS };

export function tuiRefreshIntervalLabel(intervalMs = TUI_REFRESH_INTERVAL_MS): string {
  if (intervalMs % 1_000 === 0) return `${intervalMs / 1_000}s`;
  return `${intervalMs}ms`;
}

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
  return openInkMonitor(state, controls, deps.inkRender, deps.nowMs);
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

function selectedRunIdFromState(state: TuiMonitorState): string | null {
  const nodeId = state.selectedNodeId;
  if (nodeId === null) return null;
  return state.runs.some((run) => run.runId === nodeId) ? nodeId : null;
}

function emptyMonitorState(): TuiMonitorState {
  return {
    runs: [],
    selectedNodeId: null,
    waitState: { kind: "none" },
    steeringFeedback: null,
    expandedPipelineNodeIds: [],
    refreshIntervalLabel: tuiRefreshIntervalLabel(),
    pipelineSnapshotsBySocketPath: {},
  };
}

function processTerminalSize(): { columns?: number; rows?: number } {
  const stdout = process.stdout;
  return { columns: stdout.columns, rows: stdout.rows };
}

function withMeasuredTerminal(
  state: TuiMonitorState,
  terminalSize: () => { columns?: number; rows?: number } = processTerminalSize,
): TuiMonitorState {
  const stdout = terminalSize();
  const next: TuiMonitorState = { ...state };
  if (stdout.columns !== undefined) next.terminalColumns = stdout.columns;
  if (stdout.rows !== undefined) next.terminalRows = stdout.rows;
  return next;
}

function monitorShellState(
  state: TuiMonitorState,
  terminalSize: () => { columns?: number; rows?: number } = processTerminalSize,
): TuiMonitorState {
  return withMeasuredTerminal(
    {
      ...state,
      refreshIntervalLabel: state.refreshIntervalLabel ?? tuiRefreshIntervalLabel(),
    },
    terminalSize,
  );
}

function pipelineNodesForState(state: TuiMonitorState, nowMs: number) {
  const snapshots = mergePipelineSnapshots(state.pipelineSnapshotsBySocketPath);
  return buildMonitorPipelineTreeJoin(snapshots, state.runs, { nowMs }).pipelineNodes;
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
  const nowMsFn = deps.nowMs ?? (() => Date.now());
  const connectFn = deps.connectTuiDaemon ?? connectTuiDaemon;
  const refreshScheduler = deps.refreshScheduler ?? createRefreshScheduler();
  const discoverFn = deps.socketDiscovery ?? discoverLiveDaemonSockets;
  const terminalSizeFn = deps.terminalSize ?? processTerminalSize;

  const clients: Map<string, TuiDaemonClient> = new Map();
  let runOwners: Map<string, TuiDaemonClient> = new Map();
  let session: TuiMonitorSession | undefined;
  let refreshHandle: { close(): void } | undefined;
  let currentState: TuiMonitorState = emptyMonitorState();
  let activeWaitToken = 0;
  let refreshInFlight = false;
  let refreshQueued = false;
  const lastReadyByRunId = new Map<string, Extract<TuiWaitState, { kind: "ready" }>>();
  let resolveQuit!: () => void;
  const quitPromise = new Promise<void>((resolve) => {
    resolveQuit = resolve;
  });

  const syncMonitor = (): void => {
    void Promise.resolve(session?.update(monitorShellState(currentState, terminalSizeFn)));
  };

  const getOwner = (runId: string): TuiDaemonClient | undefined => runOwners.get(runId);

  const setState = (state: TuiMonitorState): void => {
    currentState = withMeasuredTerminal(withLeftPaneTreeScrollFollow(state, nowMsFn()), terminalSizeFn);
    syncMonitor();
  };

  const startWaitForRun = (runId: string): void => {
    const waitToken = activeWaitToken;
    const owner = getOwner(runId);
    if (!owner) return;

    void (async () => {
      try {
        const result = await owner.wait(runId);
        if (waitToken !== activeWaitToken || selectedRunIdFromState(currentState) !== runId) return;
        const readyState = { kind: "ready" as const, runId, result };
        lastReadyByRunId.set(runId, readyState);
        setState({
          ...currentState,
          waitState: readyState,
        });
      } catch {
        if (waitToken !== activeWaitToken || selectedRunIdFromState(currentState) !== runId) return;
        const lastReady = lastReadyByRunId.get(runId);
        setState({
          ...currentState,
          waitState: lastReady ?? { kind: "error", runId },
        });
      }
    })();
  };

  const setSelection = (nodeId: string | null): void => {
    activeWaitToken += 1;
    const runId = nodeId !== null && currentState.runs.some((run) => run.runId === nodeId) ? nodeId : null;
    setState({
      ...currentState,
      selectedNodeId: nodeId,
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
    const runId = selectedRunIdFromState(currentState);
    if (currentState.selectedNodeId === null) {
      setState({ ...currentState, steeringFeedback: "no run selected" });
      return;
    }
    if (runId === null) return;

    const owner = getOwner(runId);
    if (!owner) {
      setState({ ...currentState, steeringFeedback: "no run selected" });
      return;
    }

    void (async () => {
      try {
        await perform(runId, owner);
        if (selectedRunIdFromState(currentState) !== runId) return;
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
        if (selectedRunIdFromState(currentState) !== runId) return;
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
    let snapshotsChanged = false;
    let selectedRunOwnerDropped = false;
    for (const socketPath of currentSockets) {
      if (!allSockets.has(socketPath)) {
        const client = clients.get(socketPath);
        client?.close();
        clients.delete(socketPath);

        if (currentState.pipelineSnapshotsBySocketPath?.[socketPath] !== undefined) {
          snapshotsChanged = true;
        }

        const selectedRunId = selectedRunIdFromState(currentState);
        if (selectedRunId !== null && getOwner(selectedRunId) === client) {
          selectedRunOwnerDropped = true;
        }
      }
    }

    const nextSnapshots = snapshotsChanged
      ? Object.fromEntries(
          Object.entries(currentState.pipelineSnapshotsBySocketPath ?? {}).filter(([path]) => clients.has(path)),
        )
      : currentState.pipelineSnapshotsBySocketPath;

    const selectedNodeId = currentState.selectedNodeId;
    const selectedRunId = selectedRunIdFromState(currentState);
    const clearSelection =
      selectedRunOwnerDropped ||
      (selectedNodeId !== null &&
        ((selectedRunId !== null && getOwner(selectedRunId) === undefined) ||
          !monitorSelectableNodeIds(
            withMeasuredTerminal(
              {
                ...currentState,
                pipelineSnapshotsBySocketPath: nextSnapshots ?? currentState.pipelineSnapshotsBySocketPath ?? {},
              },
              terminalSizeFn,
            ),
            nowMsFn(),
          ).includes(selectedNodeId)));

    if (clearSelection) {
      activeWaitToken += 1;
      setState({
        ...currentState,
        selectedNodeId: null,
        waitState: { kind: "none" },
        steeringFeedback: null,
        ...(snapshotsChanged && nextSnapshots !== undefined ? { pipelineSnapshotsBySocketPath: nextSnapshots } : {}),
      });
    } else if (snapshotsChanged && nextSnapshots !== undefined) {
      setState({ ...currentState, pipelineSnapshotsBySocketPath: nextSnapshots });
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

        let pipelineSnapshotsBySocketPath: Record<string, PipelineListResult> = {
          ...(currentState.pipelineSnapshotsBySocketPath ?? {}),
        };

        const listResults: Array<[TuiDaemonClient, DaemonListResult | undefined]> = [];
        let allClientsFailed = true;
        let firstError: unknown;
        for (const [socketPath, client] of [...clients.entries()]) {
          try {
            listResults.push([client, await client.list()]);
            allClientsFailed = false;
          } catch (error) {
            if (socketPath === deps.socketPath) {
              client.close();
              clients.delete(socketPath);
              listResults.push([client, undefined]);
              if (!firstError) firstError = error;
              continue;
            }
            listResults.push([client, undefined]);
            if (!firstError) firstError = error;
          }

          try {
            pipelineSnapshotsBySocketPath[socketPath] = await client.pipelineList();
          } catch {
            // Retain last-good per-daemon snapshot on observation failure.
          }
        }
        pipelineSnapshotsBySocketPath = Object.fromEntries(
          Object.entries(pipelineSnapshotsBySocketPath).filter(([path]) => clients.has(path)),
        );

        if (initial && allClientsFailed) throw firstError;

        const { rows: mergedRuns, owners } = mergeRunLists(listResults);
        runOwners = owners;

        if (initial) {
          const draftState = withMeasuredTerminal(
            {
              runs: mergedRuns,
              selectedNodeId: null,
              waitState: { kind: "none" },
              steeringFeedback: null,
              expandedPipelineNodeIds: [],
              pipelineSnapshotsBySocketPath,
            },
            terminalSizeFn,
          );
          const nodeId = firstSelectableNodeId(draftState, nowMsFn());
          const runId = nodeId !== null && mergedRuns.some((run) => run.runId === nodeId) ? nodeId : null;
          currentState = {
            ...draftState,
            selectedNodeId: nodeId,
            waitState: buildWaitStateForSelection(runId),
          };
          return;
        }

        const selectedNodeId = currentState.selectedNodeId;
        if (
          selectedNodeId !== null &&
          !monitorSelectableNodeIds(
            { ...currentState, runs: mergedRuns, pipelineSnapshotsBySocketPath },
            nowMsFn(),
          ).includes(selectedNodeId)
        ) {
          setState({
            runs: mergedRuns,
            selectedNodeId: null,
            waitState: { kind: "none" },
            steeringFeedback: null,
            expandedPipelineNodeIds: currentState.expandedPipelineNodeIds ?? [],
            pipelineSnapshotsBySocketPath,
          });
          activeWaitToken += 1;
          continue;
        }

        setState({
          ...currentState,
          runs: mergedRuns,
          pipelineSnapshotsBySocketPath,
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

    if (currentState.selectedNodeId !== null) {
      setSelection(currentState.selectedNodeId);
    }

    session = await openMonitor(
      monitorShellState(currentState, terminalSizeFn),
      {
        selectNode(nodeId) {
          if (!monitorSelectableNodeIds(currentState, nowMsFn()).includes(nodeId)) return;
          if (currentState.selectedNodeId === nodeId) return;
          setSelection(nodeId);
        },
        selectNextRun() {
          const nowMs = nowMsFn();
          let state = currentState;
          let ids = monitorSelectableNodeIds(state, nowMs);
          const selectedNodeId = state.selectedNodeId;
          if (ids.length === 0) return;
          if (
            selectedNodeId !== null &&
            isExpandablePipelineNodeId(pipelineNodesForState(state, nowMs), selectedNodeId) &&
            !(state.expandedPipelineNodeIds ?? []).includes(selectedNodeId)
          ) {
            state = { ...state, expandedPipelineNodeIds: [...(state.expandedPipelineNodeIds ?? []), selectedNodeId] };
            ids = monitorSelectableNodeIds(state, nowMs);
            setState({ ...state, steeringFeedback: null });
          }
          const activeId = state.selectedNodeId;
          const selectedIndex = activeId === null ? -1 : ids.indexOf(activeId);
          if (selectedIndex < 0) {
            // Mutation checkpoint: reintroducing `ids[0]` fallthrough when `indexOf` is `-1` in selectNextRun/selectPreviousRun turns reversible-walk pin RED.
            if (activeId !== null) {
              setState(state);
              return;
            }
            const next = ids[0];
            if (next !== undefined) setSelection(next);
            return;
          }
          // Mutation checkpoint: reintroducing `ids[0]` (and backward fallthrough) in selectNextRun/selectPreviousRun turns first-painted-pipeline descend pin RED.
          const next = ids[Math.min(selectedIndex + 1, ids.length - 1)];
          if (next !== undefined && next !== activeId) setSelection(next);
        },
        selectPreviousRun() {
          const ids = monitorSelectableNodeIds(currentState, nowMsFn());
          if (ids.length === 0) return;
          const selectedNodeId = currentState.selectedNodeId;
          const selectedIndex = selectedNodeId === null ? -1 : ids.indexOf(selectedNodeId);
          if (selectedIndex < 0) {
            if (selectedNodeId !== null) {
              setState(currentState);
              return;
            }
            const previous = ids[ids.length - 1];
            if (previous !== undefined) setSelection(previous);
            return;
          }
          const previous = ids[Math.max(selectedIndex - 1, 0)];
          if (previous !== undefined && previous !== selectedNodeId) setSelection(previous);
        },
        toggleSelectedWorkflowExpansion() {
          const selectedNodeId = currentState.selectedNodeId;
          if (selectedNodeId === null) return;
          // Mutation checkpoint: short-circuiting this guard before the toggle body must turn pipeline/stage expansion RED.
          if (!isExpandablePipelineNodeId(pipelineNodesForState(currentState, nowMsFn()), selectedNodeId)) return;

          const expanded = new Set(currentState.expandedPipelineNodeIds ?? []);
          if (expanded.has(selectedNodeId)) {
            expanded.delete(selectedNodeId);
          } else {
            expanded.add(selectedNodeId);
          }
          setState({
            ...currentState,
            expandedPipelineNodeIds: [...expanded],
            steeringFeedback: null,
          });
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
