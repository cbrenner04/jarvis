import type { WaitRunCompletionResult } from "./daemon.ts";
import type { DaemonListRunRow } from "./daemon-wire.ts";
import type { ConnectTuiDaemonOptions, TuiDaemonClient } from "./tui-daemon-client.ts";
import type { InkRender } from "./tui-ink-feedback.tsx";

/** Operator-visible non-monitor feedback states. */
export type TuiViewState = { kind: "rpc-error"; code: string; message: string } | { kind: "unavailable" };

/** Outcome-panel state for the selected run. */
export type TuiWaitState =
  | { kind: "none" }
  | { kind: "pending"; runId: string }
  | { kind: "ready"; runId: string; result: WaitRunCompletionResult }
  | { kind: "error"; runId: string };

/** Operator-visible monitor snapshot. */
export type TuiMonitorState = {
  runs: readonly DaemonListRunRow[];
  selectedRunId: string | null;
  waitState: TuiWaitState;
  /** Session-local steering feedback; cleared on selection change. */
  steeringFeedback: string | null;
};

/** Injectable selection, steering, and quit controls exposed to the monitor host. */
export type TuiMonitorControls = {
  /** Change selection to the given run when present in the current list. */
  selectRun(runId: string): void;
  /** Pause the selected run via daemon `pause`. */
  pauseSelected(): void;
  /** Resume the selected run via daemon `resume`. */
  resumeSelected(): void;
  /** Kill the selected run via daemon `kill`. */
  killSelected(): void;
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
