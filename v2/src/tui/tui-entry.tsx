import { basename } from "node:path";
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
  monitorTerminalFilterNowMs,
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

function createIntervalScheduler(intervalMs = TUI_REFRESH_INTERVAL_MS): TuiRefreshScheduler {
  return {
    start(onTick) {
      const timer = setInterval(onTick, intervalMs);
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

function keyedSocketDigest(socketPath: string): string {
  const match = /^daemon-([0-9a-fA-F]{16})\.sock$/.exec(basename(socketPath));
  if (match === null) return "unknown";
  return match[1]!.toLowerCase();
}

function emptyMonitorState(
  invocationIdentity: Pick<TuiMonitorState, "machineProfile" | "keyedSocketDigest">,
): TuiMonitorState {
  return {
    runs: [],
    selectedNodeId: null,
    waitState: { kind: "none" },
    steeringFeedback: null,
    expandedPipelineNodeIds: [],
    refreshIntervalLabel: tuiRefreshIntervalLabel(),
    commandBuffer: "",
    commandCursor: 0,
    focus: "tree",
    lastCommandResult: null,
    lastRpcError: null,
    ...invocationIdentity,
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

function pipelineNodesForState(state: TuiMonitorState, displayNowMs: number) {
  const snapshots = mergePipelineSnapshots(state.pipelineSnapshotsBySocketPath);
  return buildMonitorPipelineTreeJoin(snapshots, state.runs, {
    filterNowMs: monitorTerminalFilterNowMs(state, displayNowMs),
  }).pipelineNodes;
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

function refreshRpcFeedback(error: unknown | undefined): string | null {
  if (error === undefined) return null;
  if (error instanceof RpcError || error instanceof RpcConnectionError) return steeringFeedbackFromError(error);
  if (error instanceof Error) return `daemon_error: ${(error as Error).message}`;
  return `daemon_error: ${String(error)}`;
}

/** Connect, prove liveness, and enter the interactive run monitor until quit. */
export async function runTuiEntry(deps: RunTuiEntryDeps): Promise<number> {
  const invocationIdentity = {
    machineProfile: deps.machineProfile,
    keyedSocketDigest: keyedSocketDigest(deps.socketPath),
  };
  const nowMsFn = deps.nowMs ?? (() => Date.now());
  const connectFn = deps.connectTuiDaemon ?? connectTuiDaemon;
  const refreshScheduler = deps.refreshScheduler ?? createIntervalScheduler();
  const displayTickScheduler = deps.displayTickScheduler ?? createIntervalScheduler();
  const discoverFn = deps.socketDiscovery ?? discoverLiveDaemonSockets;
  const terminalSizeFn = deps.terminalSize ?? processTerminalSize;

  const clients: Map<string, TuiDaemonClient> = new Map();
  const clientSocketPaths = new Map<TuiDaemonClient, string>();
  const reconnectedSocketPaths = new Set<string>();
  const lastGoodListBySocketPath = new Map<string, DaemonListResult>();
  let runOwners: Map<string, TuiDaemonClient> = new Map();
  let session: TuiMonitorSession | undefined;
  let refreshHandle: { close(): void } | undefined;
  let displayTickHandle: { close(): void } | undefined;
  let currentState: TuiMonitorState = emptyMonitorState(invocationIdentity);
  let activeWaitToken = 0;
  const waitOwners = new Map<string, TuiDaemonClient>();
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
    currentState = withMeasuredTerminal(
      withLeftPaneTreeScrollFollow({ ...state, ...invocationIdentity }, nowMsFn()),
      terminalSizeFn,
    );
    syncMonitor();
  };

  const startWaitForRun = (runId: string): void => {
    const waitToken = activeWaitToken;
    const owner = getOwner(runId);
    if (!owner) return;
    waitOwners.set(runId, owner);

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

  const updateConnections = async (): Promise<unknown | undefined> => {
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
        const selectedRunId = selectedRunIdFromState(currentState);
        if (selectedRunId !== null && getOwner(selectedRunId) === client) {
          selectedRunOwnerDropped = true;
        }
        // Owners are rebuilt from this refresh's successful lists below, so a
        // dropped client's entries cannot outlive this cycle.
      }
    }

    const selectedNodeId = currentState.selectedNodeId;
    const clearSelection =
      selectedNodeId !== null &&
      !monitorSelectableNodeIds(
        withMeasuredTerminal(
          {
            ...currentState,
            pipelineSnapshotsBySocketPath: currentState.pipelineSnapshotsBySocketPath ?? {},
          },
          terminalSizeFn,
        ),
        nowMsFn(),
      ).includes(selectedNodeId);

    if (selectedRunOwnerDropped) {
      activeWaitToken += 1;
      setState({
        ...currentState,
        waitState: { kind: "none" },
      });
    } else if (clearSelection) {
      activeWaitToken += 1;
      setState({ ...currentState, selectedNodeId: null, waitState: { kind: "none" }, steeringFeedback: null });
    }

    // Add clients for newly discovered sockets
    let latestError: unknown;
    for (const socketPath of allSockets) {
      if (!clients.has(socketPath)) {
        try {
          const client = await connectFn({ socketPath });
          clients.set(socketPath, client);
          clientSocketPaths.set(client, socketPath);
          if (lastGoodListBySocketPath.has(socketPath)) reconnectedSocketPaths.add(socketPath);
        } catch (error) {
          latestError = error;
          // Retry on next tick rather than blacklist; daemon mid-startup fails first probe.
        }
      }
    }
    return latestError;
  };

  const refreshRuns = async (initial = false, admissionError?: unknown): Promise<void> => {
    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }

    refreshInFlight = true;
    try {
      do {
        refreshQueued = false;
        let refreshError: unknown = initial ? admissionError : undefined;

        // Rediscover live sockets and update connections
        if (!initial) {
          try {
            refreshError = await updateConnections();
          } catch (error) {
            refreshError = error;
            // Rediscovery failure leaves the current connection set intact for that tick.
          }
        }

        const pipelineSnapshotsBySocketPath: Record<string, PipelineListResult> = {
          ...(currentState.pipelineSnapshotsBySocketPath ?? {}),
        };

        const liveListResults: Array<[TuiDaemonClient, DaemonListResult]> = [];
        let allClientsFailed = true;
        let firstError: unknown;
        let selectedRunOwnerLost = false;
        for (const [socketPath, client] of [...clients.entries()]) {
          try {
            const result = await client.list();
            lastGoodListBySocketPath.set(socketPath, result);
            liveListResults.push([client, result]);
            allClientsFailed = false;
          } catch (error) {
            refreshError = error;
            if (socketPath === deps.socketPath) {
              client.close();
              clients.delete(socketPath);
              const selectedRunId = selectedRunIdFromState(currentState);
              if (selectedRunId !== null && getOwner(selectedRunId) === client) {
                selectedRunOwnerLost = true;
                activeWaitToken += 1;
                runOwners = new Map([...runOwners].filter(([, owner]) => owner !== client));
              }
              if (!firstError) firstError = error;
              continue;
            }
            if (!firstError) firstError = error;
          }

          try {
            pipelineSnapshotsBySocketPath[socketPath] = await client.pipelineList();
          } catch (error) {
            refreshError = error;
            // Retain last-good per-daemon snapshot on observation failure.
          }
        }

        if (initial && allClientsFailed) throw firstError;

        const retainedListResults: Array<[string, DaemonListResult]> = [...lastGoodListBySocketPath.entries()];
        const { rows: mergedRuns } = mergeRunLists(retainedListResults);
        const { owners } = mergeRunLists(liveListResults);
        runOwners = owners;
        const actionableRunIds = [...owners.keys()];

        if (initial) {
          const refreshNowMs = nowMsFn();
          const draftState = withMeasuredTerminal(
            {
              runs: mergedRuns,
              selectedNodeId: null,
              waitState: { kind: "none" },
              steeringFeedback: null,
              expandedPipelineNodeIds: [],
              commandBuffer: "",
              commandCursor: 0,
              focus: "tree",
              lastCommandResult: null,
              lastRpcError: refreshRpcFeedback(refreshError),
              actionableRunIds,
              ...invocationIdentity,
              pipelineSnapshotsBySocketPath,
              terminalWindowNowMs: refreshNowMs,
            },
            terminalSizeFn,
          );
          const nodeId = firstSelectableNodeId(draftState, refreshNowMs);
          const runId = nodeId !== null && mergedRuns.some((run) => run.runId === nodeId) ? nodeId : null;
          currentState = {
            ...draftState,
            selectedNodeId: nodeId,
            waitState: buildWaitStateForSelection(runId),
          };
          return;
        }

        const selectedNodeId = currentState.selectedNodeId;
        const refreshNowMs = nowMsFn();
        if (
          selectedNodeId !== null &&
          !monitorSelectableNodeIds(
            {
              ...currentState,
              runs: mergedRuns,
              pipelineSnapshotsBySocketPath,
              terminalWindowNowMs: refreshNowMs,
            },
            refreshNowMs,
          ).includes(selectedNodeId)
        ) {
          setState({
            ...currentState,
            runs: mergedRuns,
            selectedNodeId: null,
            waitState: { kind: "none" },
            steeringFeedback: null,
            expandedPipelineNodeIds: currentState.expandedPipelineNodeIds ?? [],
            lastRpcError: refreshRpcFeedback(refreshError),
            actionableRunIds,
            pipelineSnapshotsBySocketPath,
            terminalWindowNowMs: refreshNowMs,
          });
          activeWaitToken += 1;
          continue;
        }

        setState({
          ...currentState,
          runs: mergedRuns,
          ...(selectedRunOwnerLost ? { waitState: { kind: "none" } } : {}),
          lastRpcError: refreshRpcFeedback(refreshError),
          actionableRunIds,
          pipelineSnapshotsBySocketPath,
          terminalWindowNowMs: refreshNowMs,
        });
        const selectedRunId = selectedRunIdFromState(currentState);
        const selectedOwner = selectedRunId === null ? undefined : owners.get(selectedRunId);
        const selectedOwnerSocket = selectedOwner === undefined ? undefined : clientSocketPaths.get(selectedOwner);
        if (
          selectedRunId !== null &&
          selectedOwner !== undefined &&
          (waitOwners.get(selectedRunId) !== selectedOwner ||
            (selectedOwnerSocket !== undefined && reconnectedSocketPaths.has(selectedOwnerSocket)))
        ) {
          activeWaitToken += 1;
          if (selectedOwnerSocket !== undefined) reconnectedSocketPaths.delete(selectedOwnerSocket);
          setState({ ...currentState, waitState: buildWaitStateForSelection(selectedRunId) });
          startWaitForRun(selectedRunId);
        }
      } while (refreshQueued);
    } finally {
      refreshInFlight = false;
    }
  };

  try {
    const admissionError = await updateConnections();

    if (clients.size === 0) {
      await presentFeedback({ kind: "unavailable" }, deps);
      return 1;
    }

    // Prove liveness on all connected clients.
    const healthChecks = Array.from(clients.values()).map((client) => client.health());
    const statusChecks = Array.from(clients.values()).map((client) => client.status());
    await Promise.all([...healthChecks, ...statusChecks]);

    await refreshRuns(true, admissionError);

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

    // Mutation checkpoint: calling refreshRuns or list/pipeline_list from this display-tick callback must turn display-tick/no-RPC RED.
    displayTickHandle = displayTickScheduler.start(() => {
      syncMonitor();
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
    displayTickHandle?.close();
    session?.close();
    for (const client of clients.values()) {
      client.close();
    }
  }
}
