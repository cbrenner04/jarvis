import { createElement, type ReactElement } from "react";
import { TUI_DAEMON_SOCKET_DISPLAY } from "./tui-daemon-errors.ts";
import { loadInkUi, type InjectedInkUi } from "./tui-ink-runtime.ts";
import type { TuiViewState } from "./tui-monitor-types.ts";

/** Injectable ink `render` seam for tests. */
export type InkRender = typeof import("ink").render;

/** Render operator-visible non-monitor TUI feedback through ink. */
export async function showTuiInkFeedback(state: TuiViewState, inkRender?: InkRender | InjectedInkUi): Promise<void> {
  const { renderFn, Text } = await loadInkUi(inkRender);

  const element: ReactElement =
    state.kind === "rpc-error"
      ? createElement(Text, null, `${state.code}: ${state.message}`)
      : createElement(
          Text,
          null,
          `Daemon unavailable at ${TUI_DAEMON_SOCKET_DISPLAY}. Start with: jarvis daemon start`,
        );

  const instance = renderFn(element);
  await instance.waitUntilRenderFlush();
  instance.unmount();
}
