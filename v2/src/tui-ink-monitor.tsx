import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";
import type { TuiMonitorControls, TuiMonitorSession, TuiMonitorState } from "./tui-monitor-types.ts";

/** Open the production ink monitor for one session. */
export async function openInkMonitor(
  initialState: TuiMonitorState,
  controls: TuiMonitorControls,
  inkRender?: InkRender,
): Promise<TuiMonitorSession> {
  let renderFn: InkRender;
  let Box: ((props: { children?: ReactNode; flexDirection?: "column" | "row" }) => ReactElement) | undefined;
  let Text: (props: { children?: ReactNode }) => ReactElement;
  let useInput:
    | ((
        inputHandler: (
          input: string,
          key: { ctrl?: boolean; upArrow?: boolean; downArrow?: boolean; return?: boolean },
        ) => void,
      ) => void)
    | undefined;

  if (inkRender !== undefined) {
    renderFn = inkRender;
    Text = ({ children }) => createElement(Fragment, null, children);
  } else {
    const ink = await import("ink");
    renderFn = ink.render;
    Box = ink.Box as typeof Box;
    Text = ({ children }) => createElement(ink.Text, null, children);
    useInput = ink.useInput;
  }

  const sessionState = { current: initialState };

  const MonitorDisplay = ({ state }: { state: TuiMonitorState }): ReactElement => {
    const selected = state.selectedRunId;
    const waitState = state.waitState;
    const outcomeLines =
      selected === null
        ? ["No run selected."]
        : waitState.kind === "pending"
          ? [`Waiting for ${waitState.runId}...`]
          : waitState.kind === "ready"
            ? [
                `runStatus: ${waitState.result.runStatus}`,
                ...(waitState.result.loopOutcomeKind !== undefined
                  ? [`loopOutcomeKind: ${waitState.result.loopOutcomeKind}`]
                  : []),
                ...(waitState.result.iterationsConsumed !== undefined
                  ? [`iterationsConsumed: ${waitState.result.iterationsConsumed}`]
                  : []),
                ...(waitState.result.resumable !== undefined ? [`resumable: ${waitState.result.resumable}`] : []),
              ]
            : waitState.kind === "error"
              ? [`Wait failed for ${waitState.runId}.`]
              : ["No outcome yet."];

    const lines: ReactElement[] = [];
    lines.push(createElement(Text, { key: "title" }, "jarvis tui"));
    if (state.runs.length === 0) {
      lines.push(createElement(Text, { key: "empty" }, "No runs."));
    } else {
      lines.push(createElement(Text, { key: "header" }, "runId project branch status liveness"));
      for (const run of state.runs) {
        const marker = run.runId === selected ? ">" : " ";
        lines.push(
          createElement(
            Text,
            { key: run.runId },
            `${marker} ${run.runId} ${run.project} ${run.branch} ${run.status} ${run.isLive ? "live" : "not-live"}`,
          ),
        );
      }
    }
    lines.push(createElement(Text, { key: "outcome-title" }, "Outcome"));
    for (const [index, line] of outcomeLines.entries()) {
      lines.push(createElement(Text, { key: `outcome-${index}` }, line));
    }
    lines.push(createElement(Text, { key: "quit" }, "Press q or Ctrl-C to quit."));

    if (Box !== undefined) {
      return createElement(Box, { flexDirection: "column" }, ...lines);
    }
    return createElement(Fragment, null, ...lines);
  };

  const MonitorSessionRoot = (): ReactElement => {
    useInput?.((input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        controls.quit();
      }
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
