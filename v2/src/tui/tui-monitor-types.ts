import type {
  PipelineStartAdmissionInput,
  PipelineStartAdmissionResult,
} from "../commands/pipeline-start-admission.ts";
import type { WaitRunCompletionResult } from "../daemon/daemon.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { ConnectTuiDaemonOptions, PipelineListResult, TuiDaemonClient } from "./tui-daemon-client.ts";
import type { InkRender } from "./tui-ink-feedback.tsx";
import type { InjectedInkUi } from "./tui-ink-runtime.ts";

/** Detached pipeline-start admission bound at the TUI command entry boundary. */
export type DetachedPipelineStartAdmission = (
  input: PipelineStartAdmissionInput,
) => Promise<PipelineStartAdmissionResult>;

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
  selectedNodeId: string | null;
  waitState: TuiWaitState;
  /** Session-local steering feedback; cleared on selection change. */
  steeringFeedback: string | null;
  /** Pipeline tree nodes expanded in the left-pane tree. */
  expandedPipelineNodeIds?: readonly string[];
  /** Full-flatten index of the first painted left-pane tree row; default `0`. */
  leftPaneTreeScrollOffset?: number;
  /** Session-local left/right divider nudge; not persisted. */
  dividerOffset?: number;
  /** Terminal width for shell layout; defaults when omitted. */
  terminalColumns?: number;
  /** Terminal height for shell layout; defaults when omitted. */
  terminalRows?: number;
  /** Dock refresh label (e.g. `1s`); defaults when omitted. */
  refreshIntervalLabel?: string;
  /** Session-local command text; defaults to empty. */
  commandBuffer?: string;
  /** Grapheme-cluster cursor offset in {@link commandBuffer}; defaults to zero. */
  commandCursor?: number;
  /** Active monitor surface; defaults to the tree. */
  focus?: "tree" | "command";
  /** Retained command feedback; defaults to absent. */
  lastCommandResult?: string | null;
  /** Latest recoverable monitor RPC failure; defaults to absent. */
  lastRpcError?: string | null;
  /** Run ids backed by a currently connected client; retained rows may be absent. */
  actionableRunIds?: readonly string[];
  /** Machine profile resolved for the invoking TUI command. */
  machineProfile?: string;
  /** Digest key of the invoking daemon socket. */
  keyedSocketDigest?: string;
  /** Last-good per-daemon `pipeline_list` snapshots keyed by socket path. */
  pipelineSnapshotsBySocketPath?: Readonly<Record<string, PipelineListResult>>;
  /** Clock snapshot for unattributed terminal retention; updated on daemon refresh only. */
  terminalWindowNowMs?: number;
};

/**
 * Injectable monitor controls exposed to the host.
 * All `*Selected` methods: no selection → inline `no run selected`; daemon and
 * transport failures surface inline without closing the monitor.
 */
export type TuiMonitorControls = {
  focusCommand(): void;
  focusTree(): void;
  insertCommandText(text: string): void;
  moveCommandCursorLeft(): void;
  moveCommandCursorRight(): void;
  deleteCommandBackward(): void;
  deleteCommandForward(): void;
  submitCommand(commandBuffer: string): void;
  /** Detached `pipeline_start` admission using the same seams as `jarvis pipeline start --detach`. */
  admitDetachedPipelineStart(input: PipelineStartAdmissionInput): Promise<PipelineStartAdmissionResult>;
  /** Change selection to the given tree or unattributed row when present in the selectable list. */
  selectNode(nodeId: string): void;
  /** Move to the next selectable row in display order. */
  selectNextRun(): void;
  /** Move to the previous selectable row in display order. */
  selectPreviousRun(): void;
  /** Expand or collapse the selected pipeline or stage tree node. */
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

/** Interval scheduler seam for refresh polling or local display ticks. */
export type TuiRefreshScheduler = {
  /** Start periodic callbacks. */
  start(onTick: () => void): { close(): void };
};

/** Discover live daemon sockets; injectable seam for testing. */
export type SocketDiscovery = () => Promise<string[]>;

/** Dependencies for {@link runTuiEntry}. */
export type RunTuiEntryDeps = {
  /** Unix socket path; required. */
  socketPath: string;
  /** Machine profile resolved before TUI admission. */
  machineProfile: string;
  /** Detached pipeline-start admission bound from the invoking CLI command. */
  admitDetachedPipelineStart: DetachedPipelineStartAdmission;
  /** Injectable daemon client seam; defaults to {@link connectTuiDaemon}. */
  connectTuiDaemon?: (options?: ConnectTuiDaemonOptions) => Promise<TuiDaemonClient>;
  /** Injectable monitor refresh scheduler; defaults to a 1s interval poller. */
  refreshScheduler?: TuiRefreshScheduler;
  /** Injectable display-tick scheduler; defaults to a 1s interval rerender. */
  displayTickScheduler?: TuiRefreshScheduler;
  /** When set, skips production ink rendering. */
  viewHost?: TuiViewHost;
  /** Injectable ink render; defaults to production `render`. */
  inkRender?: InkRender | InjectedInkUi;
  /** Discover live daemon sockets; defaults to {@link discoverLiveDaemonSockets}. */
  socketDiscovery?: SocketDiscovery;
  /** Injectable clock for the terminal live window; defaults to `Date.now`. */
  nowMs?: () => number;
  /** Injectable terminal size; defaults to `process.stdout` columns/rows. */
  terminalSize?: () => { columns?: number; rows?: number };
};
