import type { ConnectTuiDaemonOptions, TuiDaemonClient } from "./tui-daemon-client.ts";
import type { InkRender } from "./tui-ink-feedback.tsx";
import type { ConnectTuiLogTailOptions, TuiLogTailClient } from "./tui-log-tail-client.ts";
import type { TuiViewState } from "./tui-monitor-types.ts";

/** Injectable quit control for the log-follow view. */
export type TuiLogFollowControls = {
  /** End the follow session and tear down the tail client. */
  quit(): void;
};

/** Open log-follow session returned by a host. */
export type TuiLogFollowSession = {
  /** Append one rendered line to the active view. */
  appendLine(line: string): void | Promise<void>;
  /** Render operator-visible failure feedback on the active view. */
  showFeedback(state: TuiViewState): void | Promise<void>;
  /** Resolve when the operator quits or the stream ends. */
  waitUntilExit(): Promise<void>;
  /** Tear down view resources; idempotent. */
  close(): void;
};

/** Injectable view host for tests and alternate renderers. */
export type TuiLogFollowViewHost = {
  /**
   * Record or render operator-visible failure feedback.
   * @param state RPC or unavailable-daemon state.
   */
  show(state: TuiViewState): void | Promise<void>;
  /**
   * Open the log-follow view.
   * @param controls Quit control owned by the follow core.
   */
  openLogFollow(controls: TuiLogFollowControls): Promise<TuiLogFollowSession>;
};

/** Discover live daemon sockets; injectable seam for testing. */
export type SocketDiscovery = () => Promise<string[]>;

/** Retry configuration for {@link runTuiLogFollow} mid-stream reconnection. */
export type TuiLogFollowRetryConfig = {
  /** Maximum reconnection attempts after mid-stream transport loss; defaults to 5. */
  maxAttempts?: number;
  /** Delay in milliseconds before first retry, doubling on each attempt up to maxDelay; defaults to 100. */
  initialDelayMs?: number;
  /** Maximum delay between retry attempts; defaults to 2000. */
  maxDelayMs?: number;
};

/** Dependencies for {@link runTuiLogFollow}. */
export type RunTuiLogFollowDeps = {
  /** Unix socket path; required. */
  socketPath: string;
  /** Injectable tail client seam; defaults to {@link connectTuiLogTail}. */
  connectTuiLogTail?: (runId: string, options: ConnectTuiLogTailOptions) => Promise<TuiLogTailClient>;
  /** When set, skips production ink rendering. */
  viewHost?: TuiLogFollowViewHost;
  /** Injectable ink render; defaults to production `render`. */
  inkRender?: InkRender;
  /** Discover live daemon sockets; defaults to {@link discoverLiveDaemonSockets}. */
  socketDiscovery?: SocketDiscovery;
  /** Injectable daemon client seam; defaults to {@link connectTuiDaemon}. */
  connectTuiDaemon?: (options: ConnectTuiDaemonOptions) => Promise<TuiDaemonClient>;
  /** Retry configuration for mid-stream transport loss. */
  tailRetry?: TuiLogFollowRetryConfig;
};
