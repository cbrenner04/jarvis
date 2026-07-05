import { createElement, Fragment, type ReactElement, useState } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { loadInkUi } from "./tui-ink-runtime.ts";
import { monitorTextLines } from "./tui-monitor-lines.ts";
import type { TuiMonitorControls, TuiMonitorSession, TuiMonitorState } from "./tui-monitor-types.ts";

type ComposingMode = { kind: "idle" } | { kind: "composing"; buffer: string };

type MonitorUseInputHook = (
  inputHandler: (
    input: string,
    key: { ctrl?: boolean; return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean },
  ) => void,
) => void;

/** Open the production ink monitor for one session. */
export async function openInkMonitor(
  initialState: TuiMonitorState,
  controls: TuiMonitorControls,
  inkRender?: InkRender,
): Promise<TuiMonitorSession> {
  const { renderFn, Text, Box, useInput: inkUseInput } = await loadInkUi(inkRender);
  const useInput: MonitorUseInputHook = inkUseInput ?? (() => {});
  const sessionState = { current: initialState };

  const MonitorDisplay = ({ state, composing }: { state: TuiMonitorState; composing: ComposingMode }): ReactElement => {
    const lines = monitorTextLines(state);
    if (composing.kind === "composing") lines.push(`Revise prompt: ${composing.buffer}`);
    const rendered = lines.map((line, index) => createElement(Text, { key: index }, line));
    if (Box !== undefined) return createElement(Box, { flexDirection: "column" }, ...rendered);
    return createElement(Fragment, null, ...rendered);
  };

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
