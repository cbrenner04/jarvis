import { render, Text } from "ink";
import type { ReactElement } from "react";
import {
  TUI_DAEMON_SOCKET_DISPLAY,
  type TuiDaemonHealthResult,
  type TuiDaemonStatusResult,
} from "./tui-daemon-client.ts";
import type { TuiViewState } from "./tui-entry.tsx";

/** Injectable ink `render` seam for tests. */
export type InkRender = typeof render;

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

/**
 * Render operator-visible TUI connect feedback through ink.
 *
 * @param state Connected liveness proof or unavailable-daemon state.
 * @param inkRender Injectable ink render; defaults to production `render`.
 */
export async function showTuiInkFeedback(state: TuiViewState, inkRender: InkRender = render): Promise<void> {
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
