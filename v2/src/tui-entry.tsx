import { render, Text } from "ink";
import type { ReactElement } from "react";
import {
  type ConnectTuiDaemonOptions,
  connectTuiDaemon,
  type TuiDaemonClient,
  TuiDaemonConnectionError,
  type TuiDaemonHealthResult,
  type TuiDaemonStatusResult,
} from "./tui-daemon-client.ts";

/** Operator-facing socket path in unavailable-daemon feedback. */
export const TUI_DAEMON_SOCKET_DISPLAY = "~/.jarvis/daemon.sock";

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

/** Injectable ink `render` seam for tests. */
export type InkRender = typeof render;

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

function ConnectedFeedback({
  health,
  status,
}: {
  health: TuiDaemonHealthResult;
  status: TuiDaemonStatusResult;
}): ReactElement {
  return (
    <>
      <Text>Connected to daemon</Text>
      <Text>health: {JSON.stringify(health)}</Text>
      <Text>status: {JSON.stringify(status)}</Text>
    </>
  );
}

function UnavailableFeedback(): ReactElement {
  return <Text>{`Daemon unavailable at ${TUI_DAEMON_SOCKET_DISPLAY}. Start with: jarvis daemon start`}</Text>;
}

async function showWithInk(state: TuiViewState, inkRender: InkRender): Promise<void> {
  const element: ReactElement =
    state.kind === "connected" ? (
      <ConnectedFeedback health={state.health} status={state.status} />
    ) : (
      <UnavailableFeedback />
    );
  const instance = inkRender(element);
  await instance.waitUntilRenderFlush();
  instance.unmount();
}

async function present(state: TuiViewState, deps: RunTuiEntryDeps): Promise<void> {
  if (deps.viewHost !== undefined) {
    await deps.viewHost.show(state);
    return;
  }
  await showWithInk(state, deps.inkRender ?? render);
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
