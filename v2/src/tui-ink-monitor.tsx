import { createElement, Fragment, type ReactElement } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { loadInkUi } from "./tui-ink-runtime.ts";
import { monitorTextLines } from "./tui-monitor-lines.ts";
import type { TuiMonitorControls, TuiMonitorSession, TuiMonitorState } from "./tui-monitor-types.ts";

/** Open the production ink monitor for one session. */
export async function openInkMonitor(
  initialState: TuiMonitorState,
  controls: TuiMonitorControls,
  inkRender?: InkRender,
): Promise<TuiMonitorSession> {
  const { renderFn, Text, Box, useInput } = await loadInkUi(inkRender);
  const sessionState = { current: initialState };

  const MonitorDisplay = ({ state }: { state: TuiMonitorState }): ReactElement => {
    const lines = monitorTextLines(state).map((line, index) => createElement(Text, { key: index }, line));
    if (Box !== undefined) return createElement(Box, { flexDirection: "column" }, ...lines);
    return createElement(Fragment, null, ...lines);
  };

  const MonitorSessionRoot = (): ReactElement => {
    useInput?.((input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) controls.quit();
    });
    return createElement(MonitorDisplay, { state: sessionState.current });
  };

  const instance = renderFn(createElement(MonitorSessionRoot));

  return {
    update(state) {
      sessionState.current = state;
      instance.rerender(createElement(MonitorSessionRoot));
    },
    async waitUntilExit() {
      await new Promise<void>(() => {});
    },
    close() {
      instance.unmount();
    },
  };
}
