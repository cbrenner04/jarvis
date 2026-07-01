import { createElement, Fragment, type ReactElement } from "react";
import { TUI_DAEMON_SOCKET_DISPLAY } from "./tui-daemon-errors.ts";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { loadInkUi } from "./tui-ink-runtime.ts";
import type { TuiLogFollowControls, TuiLogFollowSession } from "./tui-log-follow-types.ts";
import type { TuiViewState } from "./tui-monitor-types.ts";

/** Open the production ink log-follow view for one session. */
export async function openInkLogFollow(
  controls: TuiLogFollowControls,
  inkRender?: InkRender,
): Promise<TuiLogFollowSession> {
  const { renderFn, Text, Box, useInput } = await loadInkUi(inkRender);
  const sessionState = { lines: [] as string[], feedback: undefined as TuiViewState | undefined };

  const feedbackLine = (feedback: TuiViewState | undefined): string | undefined => {
    if (feedback === undefined) return undefined;
    if (feedback.kind === "rpc-error") return `${feedback.code}: ${feedback.message}`;
    return `Daemon unavailable at ${TUI_DAEMON_SOCKET_DISPLAY}. Start with: jarvis daemon start`;
  };

  const LogFollowDisplay = ({
    lines,
    feedback,
  }: {
    lines: readonly string[];
    feedback: TuiViewState | undefined;
  }): ReactElement => {
    const rendered = lines.map((line, index) => createElement(Text, { key: index }, line));
    const feedbackText = feedbackLine(feedback);
    if (feedbackText !== undefined) {
      rendered.push(createElement(Text, { key: "feedback" }, feedbackText));
    }
    if (Box !== undefined) return createElement(Box, { flexDirection: "column" }, ...rendered);
    return createElement(Fragment, null, ...rendered);
  };

  const LogFollowRoot = (): ReactElement => {
    useInput?.((input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) controls.quit();
    });
    return createElement(LogFollowDisplay, { lines: sessionState.lines, feedback: sessionState.feedback });
  };

  const instance = renderFn(createElement(LogFollowRoot));

  return {
    appendLine(line) {
      sessionState.lines.push(line);
      instance.rerender(createElement(LogFollowRoot));
    },
    showFeedback(state) {
      sessionState.feedback = state;
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
