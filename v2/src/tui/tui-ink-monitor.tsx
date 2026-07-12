import { createElement, Fragment, type ReactElement, useState } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { loadInkUi } from "./tui-ink-runtime.ts";
import {
  joinMonitorRow,
  type MonitorLineRow,
  type MonitorSegmentTone,
  monitorSegmentRows,
} from "./tui-monitor-lines.ts";
import type { TuiMonitorControls, TuiMonitorSession, TuiMonitorState } from "./tui-monitor-types.ts";

export type ComposingMode = { kind: "idle" } | { kind: "composing"; buffer: string };

type MonitorUseInputHook = (
  inputHandler: (
    input: string,
    key: { ctrl?: boolean; return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean },
  ) => void,
) => void;

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
export function createMonitorDisplay(
  state: TuiMonitorState,
  composing: ComposingMode,
  Text: MonitorText,
  Box?: MonitorRowBox,
): ReactElement {
  const rows = monitorSegmentRows(state);
  if (composing.kind === "composing") {
    rows.push({ segments: [{ text: `Revise prompt: ${composing.buffer}` }] });
  }
  const rendered = rows.map((line, index) => renderSegmentRow(line, Text, index, Box));
  if (Box !== undefined) return createElement(Box, { flexDirection: "column" }, ...rendered);
  return createElement(Fragment, null, ...rendered);
}

/** Open the production ink monitor for one session. */
export async function openInkMonitor(
  initialState: TuiMonitorState,
  controls: TuiMonitorControls,
  inkRender?: InkRender,
): Promise<TuiMonitorSession> {
  const { renderFn, Text, Box, useInput: inkUseInput } = await loadInkUi(inkRender);
  const useInput: MonitorUseInputHook = inkUseInput ?? (() => {});
  const sessionState = { current: initialState };

  const MonitorDisplay = ({ state, composing }: { state: TuiMonitorState; composing: ComposingMode }): ReactElement =>
    createMonitorDisplay(state, composing, Text, Box);

  const MonitorSessionRoot = (): ReactElement => {
    const [composing, setComposing] = useState<ComposingMode>({ kind: "idle" });

    useInput((input, key) => {
      if (composing.kind === "composing") {
        if (key.return) {
          const trimmed = composing.buffer.trim();
          setComposing({ kind: "idle" });
          controls.reviseSelected(trimmed.length > 0 ? trimmed : undefined);
          return;
        }
        if (key.escape) {
          setComposing({ kind: "idle" });
          return;
        }
        if (key.backspace || key.delete) {
          setComposing({ kind: "composing", buffer: composing.buffer.slice(0, -1) });
          return;
        }
        if (!key.ctrl && input.length > 0) {
          setComposing({ kind: "composing", buffer: composing.buffer + input });
        }
        return;
      }

      if (input === "q" || (key.ctrl && input === "c")) {
        controls.quit();
        return;
      }
      if (input === "a") {
        controls.approveSelected();
        return;
      }
      if (input === "v") {
        setComposing({ kind: "composing", buffer: "" });
        return;
      }
      if (input === "k") {
        controls.killSelected();
      }
    });

    return createElement(MonitorDisplay, { state: sessionState.current, composing });
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
