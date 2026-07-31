import type { WaitRunCompletionResult } from "../daemon/daemon.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { ConnectTuiDaemonOptions, TuiDaemonClient } from "./tui-daemon-client.ts";
import type { InkRender } from "./tui-ink-feedback.tsx";
import type { InjectedInkUi } from "./tui-ink-runtime.ts";

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
  /** Workflow invocations whose constituent runs are expanded in the run table. */
  expandedWorkflowInvocationIds: readonly string[];
};

/**
 * Injectable selection, steering, and quit controls exposed to the monitor host.
 * All `*Selected` methods: no selection → inline `no run selected`; daemon and
 * transport failures surface inline without closing the monitor.
 */
export type TuiMonitorControls = {
  /** Change selection to the given run when present in the current list. */
  selectRun(runId: string): void;
  /** Move to the next selectable row in display order. */
  selectNextRun(): void;
  /** Move to the previous selectable row in display order. */
  selectPreviousRun(): void;
  /** Expand or collapse the selected workflow invocation's constituent runs. */
  toggleSelectedWorkflowExpansion(): void;
  /** Signals pause via daemon `pause`. */
  pauseSelected(): void;
  /** Resumes via daemon `resume` and re-issues `wait`, abandoning any prior ready snapshot. */
  resumeSelected(): void;
  /** Signals kill via daemon `kill`. */
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
  /** Record or render operator-visible non-monitor feedback. */
  show(state: TuiViewState): void | Promise<void>;
  /** Open the interactive monitor from the initial snapshot. */
  openMonitor(state: TuiMonitorState, controls: TuiMonitorControls): Promise<TuiMonitorSession>;
};

/** Refresh scheduler seam for periodic daemon `list` polling. */
export type TuiRefreshScheduler = {
  /** Start periodic refresh callbacks. */
  start(onRefresh: () => void): { close(): void };
};

/** Discover live daemon sockets; injectable seam for testing. */
export type SocketDiscovery = () => Promise<string[]>;

/** Dependencies for {@link runTuiEntry}. */
export type RunTuiEntryDeps = {
  /** Unix socket path; required. */
  socketPath: string;
  /** Injectable daemon client seam; defaults to {@link connectTuiDaemon}. */
  connectTuiDaemon?: (options?: ConnectTuiDaemonOptions) => Promise<TuiDaemonClient>;
  /** Injectable monitor refresh scheduler; defaults to a 1s interval poller. */
  refreshScheduler?: TuiRefreshScheduler;
  /** When set, skips production ink rendering. */
  viewHost?: TuiViewHost;
  /** Injectable ink render; defaults to production `render`. */
  inkRender?: InkRender | InjectedInkUi;
  /** Discover live daemon sockets; defaults to {@link discoverLiveDaemonSockets}. */
  socketDiscovery?: SocketDiscovery;
  /** Injectable clock for the terminal live window; defaults to `Date.now`. */
  nowMs?: () => number;
};
