import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { type InjectedInkUi, type InkUseInput, loadInkUi } from "./tui-ink-runtime.ts";
import {
  buildTreeRunRow,
  type MonitorLineRow,
  type MonitorSegmentTone,
  monitorDockLines,
  monitorLeftPaneAttentionRows,
  monitorLeftPaneQueueRows,
  monitorLeftPaneTreeRows,
  monitorRightPaneSegmentRows,
} from "./tui-monitor-lines.ts";
import {
  buildBranchMonitorTreeRow,
  buildPipelineMonitorTreeRow,
  buildStageMonitorTreeRow,
  type MonitorPipelineTreeDisplayNode,
} from "./tui-monitor-pipeline-tree.ts";
import type { TuiMonitorControls, TuiMonitorSession, TuiMonitorState } from "./tui-monitor-types.ts";
import { computeShellLayout, nudgeDividerOffset } from "./tui-shell-layout.ts";

type MonitorText = (props: { children?: string; color?: string; key?: number; inverse?: boolean }) => ReactElement;
type MonitorBox = (props: {
  children?: ReactNode;
  flexDirection?: "column" | "row";
  width?: number;
  height?: number;
  overflow?: "hidden" | "visible";
  flexShrink?: number;
  key?: number;
}) => ReactElement;

const TONE_COLORS: Record<MonitorSegmentTone, string> = {
  active: "cyan",
  success: "green",
  failure: "red",
};

const DEFAULT_TERMINAL_COLUMNS = 245;
const DEFAULT_TERMINAL_ROWS = 72;

function renderSegmentRow(
  line: MonitorLineRow,
  Text: MonitorText,
  rowKey: number,
  RowBox?: MonitorBox,
  isSelected = false,
): ReactElement {
  const cells = line.segments.map((segment, index) => {
    const props: { key: number; color?: string; inverse?: boolean } = { key: index };
    if (segment.tone !== undefined) props.color = TONE_COLORS[segment.tone];
    // Mutation checkpoint: dropping this inverse prop must turn selection-presentation coverage RED.
    if (isSelected) props.inverse = true;
    return createElement(Text, props, segment.text);
  });
  // Mutation checkpoint: dropping flexShrink: 0 lets Yoga squeeze overflowing rows instead of letting
  // the pane's overflow: "hidden" clip them, and must turn left-pane attention clipping RED.
  if (RowBox !== undefined) {
    return createElement(RowBox, { key: rowKey, flexDirection: "row", flexShrink: 0 }, ...cells);
  }
  return createElement(Fragment, { key: rowKey }, ...cells);
}

function renderTreeRow(
  treeRow: MonitorPipelineTreeDisplayNode,
  leftPaneWidth: number,
  nowMs: number,
  Text: MonitorText,
  rowKey: number,
  RowBox: MonitorBox | undefined,
  isSelected: boolean,
): ReactElement {
  switch (treeRow.kind) {
    case "pipeline":
      return renderSegmentRow(
        buildPipelineMonitorTreeRow(treeRow, leftPaneWidth, nowMs),
        Text,
        rowKey,
        RowBox,
        isSelected,
      );
    case "stage":
      return renderSegmentRow(
        buildStageMonitorTreeRow(treeRow, leftPaneWidth, nowMs),
        Text,
        rowKey,
        RowBox,
        isSelected,
      );
    case "branch":
      return renderSegmentRow(
        buildBranchMonitorTreeRow(treeRow, leftPaneWidth, nowMs),
        Text,
        rowKey,
        RowBox,
        isSelected,
      );
    case "run":
      return renderSegmentRow(
        buildTreeRunRow(treeRow.tableRow, treeRow.depth, leftPaneWidth, nowMs),
        Text,
        rowKey,
        RowBox,
        isSelected,
      );
    case "adhoc":
      return renderSegmentRow(
        buildTreeRunRow(treeRow.tableRow, treeRow.depth, leftPaneWidth, nowMs, treeRow.label),
        Text,
        rowKey,
        RowBox,
        isSelected,
      );
  }
}

function renderSegmentRows(
  lines: readonly MonitorLineRow[],
  Text: MonitorText,
  RowBox: MonitorBox | undefined,
  keyOffset = 0,
): ReactElement[] {
  return lines.map((line, index) => renderSegmentRow(line, Text, keyOffset + index, RowBox));
}

function shellTerminalSize(state: TuiMonitorState): { columns: number; rows: number } {
  const stdout = typeof process === "object" && process.stdout !== undefined ? process.stdout : undefined;
  return {
    columns: state.terminalColumns ?? stdout?.columns ?? DEFAULT_TERMINAL_COLUMNS,
    rows: state.terminalRows ?? stdout?.rows ?? DEFAULT_TERMINAL_ROWS,
  };
}

/** Identifiable left-pane subtree for shell layout tests. */
export function MonitorLeftPane({ children }: { children?: ReactNode }): ReactElement {
  return createElement(Fragment, null, children);
}

/** Identifiable right-pane subtree for shell layout tests. */
export function MonitorRightPane({ children }: { children?: ReactNode }): ReactElement {
  return createElement(Fragment, null, children);
}

/** Identifiable dock subtree for shell layout tests. */
export function MonitorDock({ children }: { children?: ReactNode }): ReactElement {
  return createElement(Fragment, null, children);
}

/** Left-pane tree derivation used by the ink shell; exported for tests. */
export function monitorLeftPaneContentRows(state: TuiMonitorState, nowMs: number) {
  const { columns, rows } = shellTerminalSize(state);
  const layout = computeShellLayout(columns, rows, state.dividerOffset ?? 0);
  return monitorLeftPaneTreeRows(state, layout, nowMs);
}

function renderLeftPaneContent(
  state: TuiMonitorState,
  leftPaneWidth: number,
  Text: MonitorText,
  RowBox: MonitorBox | undefined,
  nowMs: number,
): ReactElement[] {
  const { columns, rows } = shellTerminalSize(state);
  const layout = computeShellLayout(columns, rows, state.dividerOffset ?? 0);
  const rendered: ReactElement[] = [];
  // Keystone checkpoint: an in-body mutation directive disables this call to turn the pinned
  // attention consumer integration RED.
  const attentionRows = monitorLeftPaneAttentionRows(state, nowMs);
  rendered.push(...renderSegmentRows(attentionRows, Text, RowBox, rendered.length));
  const { treeRows, fullTreeRows } = monitorLeftPaneTreeRows(state, layout, nowMs);
  if (fullTreeRows.length === 0) {
    rendered.push(renderSegmentRow({ segments: [{ text: "No runs." }] }, Text, rendered.length, RowBox));
  } else {
    for (const treeRow of treeRows) {
      rendered.push(
        renderTreeRow(
          treeRow,
          leftPaneWidth,
          nowMs,
          Text,
          rendered.length,
          RowBox,
          treeRow.id === state.selectedNodeId,
        ),
      );
    }
  }
  const queueRows = monitorLeftPaneQueueRows(state);
  rendered.push(...renderSegmentRows(queueRows, Text, RowBox, rendered.length));
  return rendered;
}

function renderDockContent(state: TuiMonitorState, Text: MonitorText, Box: MonitorBox | undefined): ReactElement[] {
  const rows = monitorDockLines(state).map((text, key) => createElement(Text, { key }, text));
  if (Box === undefined) return rows;
  return rows.map((row, index) =>
    createElement(Box, { key: index, flexDirection: "row", height: 1, overflow: "hidden" }, row),
  );
}

/** Ink tree for one monitor snapshot; shared by the session host and render tests. */
export function createMonitorDisplay(
  state: TuiMonitorState,
  Text: MonitorText,
  Box?: MonitorBox,
  nowMs = Date.now(),
): ReactElement {
  const { columns, rows } = shellTerminalSize(state);
  const dividerOffset = state.dividerOffset ?? 0;
  const layout = computeShellLayout(columns, rows, dividerOffset);
  const leftContent = renderLeftPaneContent(
    state,
    layout.layoutMode === "split" ? layout.leftWidth : columns,
    Text,
    Box,
    nowMs,
  );
  const rightContent = renderSegmentRows(monitorRightPaneSegmentRows(state, nowMs), Text, Box);
  const dockContent = renderDockContent(state, Text, Box);

  const leftPane = createElement(
    MonitorLeftPane,
    null,
    Box === undefined
      ? leftContent
      : createElement(
          Box,
          {
            flexDirection: "column",
            width: layout.layoutMode === "split" ? layout.leftWidth : columns,
            height: layout.paneHeight,
            overflow: "hidden", // clips the left pane (attention segment, tree, queue) to paneHeight
          },
          ...leftContent,
        ),
  );
  const rightPane = createElement(
    MonitorRightPane,
    null,
    Box === undefined
      ? rightContent
      : createElement(
          Box,
          {
            flexDirection: "column",
            width: layout.layoutMode === "split" ? layout.rightWidth : columns,
            height: layout.paneHeight,
            overflow: "hidden",
          },
          ...rightContent,
        ),
  );
  const dock = createElement(
    MonitorDock,
    null,
    Box === undefined
      ? dockContent
      : createElement(Box, { flexDirection: "column", height: layout.dockHeight, overflow: "hidden" }, ...dockContent),
  );

  if (Box === undefined) {
    return createElement(Fragment, null, leftPane, rightPane, dock);
  }

  if (layout.layoutMode === "stacked") {
    return createElement(
      Box,
      { flexDirection: "column" },
      createElement(
        Box,
        { flexDirection: "column", height: layout.paneHeight, overflow: "hidden" },
        leftPane,
        rightPane,
      ),
      dock,
    );
  }

  return createElement(
    Box,
    { flexDirection: "column" },
    createElement(Box, { flexDirection: "row", height: layout.paneHeight, overflow: "hidden" }, leftPane, rightPane),
    dock,
  );
}

function mergeMonitorSessionState(previous: TuiMonitorState, next: TuiMonitorState): TuiMonitorState {
  const { columns, rows } = shellTerminalSize(next);
  const refreshIntervalLabel = next.refreshIntervalLabel ?? previous.refreshIntervalLabel;
  return {
    ...next,
    dividerOffset: previous.dividerOffset ?? 0,
    terminalColumns: next.terminalColumns ?? columns,
    terminalRows: next.terminalRows ?? rows,
    ...(refreshIntervalLabel === undefined ? {} : { refreshIntervalLabel }),
  };
}

/** Open the production ink monitor for one session. */
export async function openInkMonitor(
  initialState: TuiMonitorState,
  controls: TuiMonitorControls,
  inkRender?: InkRender | InjectedInkUi,
  nowMs?: () => number,
): Promise<TuiMonitorSession> {
  const { renderFn, Text, Box, useInput: inkUseInput, usePaste: inkUsePaste } = await loadInkUi(inkRender);
  const useInput: InkUseInput = inkUseInput ?? (() => {});
  const usePaste = inkUsePaste ?? (() => {});
  const sessionState = { current: mergeMonitorSessionState(initialState, initialState) };
  const clock = nowMs ?? (() => Date.now());

  const MonitorDisplay = ({ state }: { state: TuiMonitorState }): ReactElement =>
    createMonitorDisplay(state, Text, Box, clock());

  const MonitorSessionRoot = (): ReactElement => {
    usePaste((text) => {
      if ((sessionState.current.focus ?? "tree") !== "command") return;
      const inserted = text.replace(/[\r\n]/gu, "");
      if (inserted.length > 0) controls.insertCommandText(inserted);
    });

    useInput((input, key) => {
      if (key.ctrl && input === "c") {
        controls.quit();
        return;
      }
      if (key.ctrl || key.meta) return;

      const commandFocused = (sessionState.current.focus ?? "tree") === "command";
      if (commandFocused) {
        if (key.return && !key.shift) {
          controls.submitCommand(sessionState.current.commandBuffer ?? "");
          return;
        }
        if (key.return && key.shift) return;
        const editorSpecialKey =
          key.escape || key.leftArrow || key.rightArrow || key.backspace || key.delete || key.upArrow || key.downArrow;
        if (editorSpecialKey) {
          if (key.escape) controls.focusTree();
          else if (key.leftArrow) controls.moveCommandCursorLeft();
          else if (key.rightArrow) controls.moveCommandCursorRight();
          else if (key.backspace) controls.deleteCommandBackward();
          else if (key.delete) controls.deleteCommandForward();
          return;
        }
        const inserted = input.replace(/[\r\n]/gu, "");
        if (inserted !== "") controls.insertCommandText(inserted);
      }
      if (commandFocused) return;

      if (input === ":" || input === "/") {
        controls.focusCommand();
        return;
      }
      if (input === "q") {
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
        return;
      }
      if (input === "e") {
        // Mutation checkpoint: skipping this `e` binding in tui-ink-monitor.tsx must turn pipeline/stage expansion RED.
        controls.toggleSelectedWorkflowExpansion();
        return;
      }
      // Operand order (`!key.shift && key.return`) is reversed from the command-focus branch's
      // `key.return && !key.shift` deliberately, so this directive's anchor text stays distinct from
      // that branch's two directives — do not normalize the order to match.
      if (!key.shift && key.return) {
        // Mutation checkpoint: inverting `!key.shift` here must turn attention reveal RED.
        controls.revealSelectedAttentionTarget();
        return;
      }
      if (input === "[" || input === "]") {
        const { columns } = shellTerminalSize(sessionState.current);
        const currentOffset = sessionState.current.dividerOffset ?? 0;
        const nextOffset = nudgeDividerOffset(columns, currentOffset, input);
        if (nextOffset !== currentOffset) {
          sessionState.current = { ...sessionState.current, dividerOffset: nextOffset };
          instance.rerender(createElement(MonitorSessionRoot));
        }
      }
    });

    return createElement(MonitorDisplay, { state: sessionState.current });
  };

  const instance = renderFn(createElement(MonitorSessionRoot), { exitOnCtrlC: false });

  return {
    update(state) {
      sessionState.current = mergeMonitorSessionState(sessionState.current, state);
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
