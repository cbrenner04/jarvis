import { type ComponentType, createElement, Fragment, type ReactElement, type ReactNode } from "react";
import { TUI_DAEMON_SOCKET_DISPLAY } from "./tui-daemon-client.ts";
import type { TuiViewState } from "./tui-entry.tsx";

/** Injectable ink `render` seam for tests. */
export type InkRender = typeof import("ink").render;

type TextComponent = ComponentType<{ children?: ReactNode }>;

/** Render operator-visible non-monitor TUI feedback through ink. */
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
    state.kind === "rpc-error"
      ? createElement(Text, null, `${state.code}: ${state.message}`)
      : createElement(Text, null, `Daemon unavailable at ${TUI_DAEMON_SOCKET_DISPLAY}. Start with: jarvis daemon start`);

  const instance = renderFn(element);
  await instance.waitUntilRenderFlush();
  instance.unmount();
}
