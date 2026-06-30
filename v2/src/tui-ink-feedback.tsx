import { type ComponentType, createElement, Fragment, type ReactElement, type ReactNode } from "react";
import {
  TUI_DAEMON_SOCKET_DISPLAY,
  type TuiDaemonHealthResult,
  type TuiDaemonStatusResult,
} from "./tui-daemon-client.ts";
import type { TuiViewState } from "./tui-entry.tsx";

/** Injectable ink `render` seam for tests. */
export type InkRender = typeof import("ink").render;

type TextComponent = ComponentType<{ children?: ReactNode }>;

function ConnectedFeedback({
  health,
  status,
  Text,
}: {
  health: TuiDaemonHealthResult;
  status: TuiDaemonStatusResult;
  Text: TextComponent;
}): ReactElement {
  return createElement(
    Fragment,
    null,
    createElement(Text, null, "Connected to daemon"),
    createElement(Text, null, `health: ${JSON.stringify(health)}`),
    createElement(Text, null, `status: ${JSON.stringify(status)}`),
  );
}

function UnavailableFeedback({ Text }: { Text: TextComponent }): ReactElement {
  return createElement(
    Text,
    null,
    `Daemon unavailable at ${TUI_DAEMON_SOCKET_DISPLAY}. Start with: jarvis daemon start`,
  );
}

/**
 * Render operator-visible TUI connect feedback through ink.
 *
 * When `inkRender` is provided, ink is not loaded — the caller owns rendering.
 * When omitted, ink is dynamically imported to avoid yoga-layout TLA TDZ on
 * module evaluation (Bun/Linux).
 *
 * @param state Connected liveness proof or unavailable-daemon state.
 * @param inkRender Injectable ink render; defaults to production ink `render`.
 */
export async function showTuiInkFeedback(state: TuiViewState, inkRender?: InkRender): Promise<void> {
  let renderFn: InkRender;
  let Text: TextComponent;

  if (inkRender !== undefined) {
    renderFn = inkRender;
    Text = ({ children }) => createElement(Fragment, null, children);
  } else {
    const ink = await import("ink");
    renderFn = ink.render;
    Text = ink.Text;
  }

  const element: ReactElement =
    state.kind === "connected"
      ? createElement(ConnectedFeedback, { health: state.health, status: state.status, Text })
      : createElement(UnavailableFeedback, { Text });

  const instance = renderFn(element);
  await instance.waitUntilRenderFlush();
  instance.unmount();
}
