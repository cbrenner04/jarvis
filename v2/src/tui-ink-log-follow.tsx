import { createElement, Fragment, type ReactElement } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { loadInkUi } from "./tui-ink-runtime.ts";
import type { TuiLogFollowControls, TuiLogFollowSession } from "./tui-log-follow-types.ts";

/** Open the production ink log-follow view for one session. */
export async function openInkLogFollow(
  controls: TuiLogFollowControls,
  inkRender?: InkRender,
): Promise<TuiLogFollowSession> {
  const { renderFn, Text, Box, useInput } = await loadInkUi(inkRender);
  const sessionState = { lines: [] as string[] };

  const LogFollowDisplay = ({ lines }: { lines: readonly string[] }): ReactElement => {
    const rendered = lines.map((line, index) => createElement(Text, { key: index }, line));
    if (Box !== undefined) return createElement(Box, { flexDirection: "column" }, ...rendered);
    return createElement(Fragment, null, ...rendered);
  };

  const LogFollowRoot = (): ReactElement => {
    useInput?.((input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) controls.quit();
    });
    return createElement(LogFollowDisplay, { lines: sessionState.lines });
  };

  const instance = renderFn(createElement(LogFollowRoot));

  return {
    appendLine(line) {
      sessionState.lines.push(line);
      instance.rerender(createElement(LogFollowRoot));
    },
    async waitUntilExit() {
      await new Promise<void>(() => {});
    },
    close() {
      instance.unmount();
    },
  };
}
