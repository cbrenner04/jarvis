import {
  type ConnectTuiDaemonOptions,
  connectTuiDaemon,
  TUI_DAEMON_SOCKET_DISPLAY,
  type TuiDaemonClient,
  TuiDaemonConnectionError,
  type TuiDaemonHealthResult,
  type TuiDaemonStatusResult,
} from "./tui-daemon-client.ts";
import type { InkRender } from "./tui-ink-feedback.tsx";

export { TUI_DAEMON_SOCKET_DISPLAY };

/** Operator-visible TUI connect scaffold state. */
export type TuiViewState =
  | { kind: "connected"; health: TuiDaemonHealthResult; status: TuiDaemonStatusResult }
  | { kind: "unavailable" };

/** Injectable view host for tests and alternate renderers. */
export type TuiViewHost = {
  /**
   * Record or render operator-visible connect feedback.
   * @param state Connected liveness proof or unavailable-daemon state.
   */
  show(state: TuiViewState): void | Promise<void>;
};

export type { InkRender };

/** Dependencies for {@link runTuiEntry}. */
export type RunTuiEntryDeps = {
  /** Unix socket path; production default is `~/.jarvis/daemon.sock`. */
  socketPath?: string;
  /** Injectable 00 client seam; defaults to {@link connectTuiDaemon}. */
  connectTuiDaemon?: (options?: ConnectTuiDaemonOptions) => Promise<TuiDaemonClient>;
  /** When set, skips ink and records state (tests). */
  viewHost?: TuiViewHost;
  /** Injectable ink render; defaults to production `render`. */
  inkRender?: InkRender;
};

async function showWithInk(state: TuiViewState, inkRender?: InkRender): Promise<void> {
  const { showTuiInkFeedback } = await import("./tui-ink-feedback.tsx");
  await showTuiInkFeedback(state, inkRender);
}

async function present(state: TuiViewState, deps: RunTuiEntryDeps): Promise<void> {
  if (deps.viewHost !== undefined) {
    await deps.viewHost.show(state);
    return;
  }
  await showWithInk(state, deps.inkRender);
}

/**
 * Connect to the daemon, prove IPC liveness, render ink feedback, and exit.
 *
 * @param deps Optional socket path, 00 client, view host, and ink render seams.
 * @returns `0` when `health` and IPC `status` succeed; `1` when the socket is unreachable.
 * @throws Re-throws non-connection errors from the 00 client.
 */
export async function runTuiEntry(deps?: RunTuiEntryDeps): Promise<number> {
  const resolved = deps ?? {};
  const connectFn = resolved.connectTuiDaemon ?? connectTuiDaemon;
  const connectOptions = resolved.socketPath !== undefined ? { socketPath: resolved.socketPath } : undefined;

  let client: TuiDaemonClient | undefined;
  try {
    client = await connectFn(connectOptions);
    const health = await client.health();
    const status = await client.status();
    await present({ kind: "connected", health, status }, resolved);
    return 0;
  } catch (error) {
    if (error instanceof TuiDaemonConnectionError) {
      await present({ kind: "unavailable" }, resolved);
      return 1;
    }
    throw error;
  } finally {
    client?.close();
  }
}
