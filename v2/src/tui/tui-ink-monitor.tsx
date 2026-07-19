import { createElement, Fragment, type ReactElement } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { type InjectedInkUi, type InkUseInput, loadInkUi } from "./tui-ink-runtime.ts";
import {
  joinMonitorRow,
  type MonitorLineRow,
  type MonitorSegmentTone,
  monitorSegmentRows,
} from "./tui-monitor-lines.ts";
import type { TuiMonitorControls, TuiMonitorSession, TuiMonitorState } from "./tui-monitor-types.ts";

type MonitorText = (props: { children?: string; color?: string; key?: number }) => ReactElement;
type MonitorRowBox = (props: {
  children?: ReactElement | ReactElement[];
  flexDirection?: "column" | "row";
  key?: number;
}) => ReactElement;

const TONE_COLORS: Record<MonitorSegmentTone, string> = {
  active: "cyan",
  success: "green",
  failure: "red",
};

function renderSegmentRow(
  line: MonitorLineRow,
  Text: MonitorText,
  rowKey: number,
  RowBox?: MonitorRowBox,
): ReactElement {
  const cells = line.segments.map((segment, index) => {
    const props: { key: number; color?: string } = { key: index };
    if (segment.tone !== undefined) props.color = TONE_COLORS[segment.tone];
    return createElement(Text, props, segment.text);
  });
  if (RowBox !== undefined) return createElement(RowBox, { key: rowKey, flexDirection: "row" }, ...cells);
  return createElement(Fragment, { key: rowKey }, ...cells);
}

/** Ink tree for one monitor snapshot; shared by the session host and render tests. */
export function createMonitorDisplay(state: TuiMonitorState, Text: MonitorText, Box?: MonitorRowBox): ReactElement {
  const rows = monitorSegmentRows(state);
  const rendered = rows.map((line, index) => renderSegmentRow(line, Text, index, Box));
  if (Box !== undefined) return createElement(Box, { flexDirection: "column" }, ...rendered);
  return createElement(Fragment, null, ...rendered);
}

/** Open the production ink monitor for one session. */
export async function openInkMonitor(
  initialState: TuiMonitorState,
  controls: TuiMonitorControls,
  inkRender?: InkRender | InjectedInkUi,
): Promise<TuiMonitorSession> {
  const { renderFn, Text, Box, useInput: inkUseInput } = await loadInkUi(inkRender);
  const useInput: InkUseInput = inkUseInput ?? (() => {});
  const sessionState = { current: initialState };

  const MonitorDisplay = ({ state }: { state: TuiMonitorState }): ReactElement =>
    createMonitorDisplay(state, Text, Box);

  const MonitorSessionRoot = (): ReactElement => {
    useInput((input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        controls.quit();
        return;
      }
      if (input === "k") {
        controls.killSelected();
        return;
      }
      if (input === "j" || key.downArrow) {
        controls.selectNextRun();
        return;
      }
      if (key.upArrow) {
        controls.selectPreviousRun();
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

export { joinMonitorRow };
