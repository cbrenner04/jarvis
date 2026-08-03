import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { type InjectedInkUi, type InkUseInput, loadInkUi } from "./tui-ink-runtime.ts";
import {
  livenessTone,
  type MonitorLineRow,
  type MonitorSegmentTone,
  monitorDockLines,
  monitorLeftPaneQueueRows,
  monitorLeftPaneTreeRows,
  monitorRightPaneSegmentRows,
  RUN_STATUS_TONES,
} from "./tui-monitor-lines.ts";
import {
  buildPipelineMonitorTreeRow,
  buildStageMonitorTreeRow,
  type MonitorPipelineTreeDisplayNode,
} from "./tui-monitor-pipeline-tree.ts";
import type { TuiMonitorControls, TuiMonitorSession, TuiMonitorState } from "./tui-monitor-types.ts";
import type { WorkflowTableRow } from "./tui-monitor-workflow-collapse.ts";
import {
  computeShellLayout,
  listMonitorTreeCellsAtDepth,
  monitorTreeRun,
  nudgeDividerOffset,
  TREE_COLUMN_WIDTHS,
  type TreeColumnId,
  visibleColumns,
} from "./tui-shell-layout.ts";

type MonitorText = (props: { children?: string; color?: string; key?: number }) => ReactElement;
type MonitorBox = (props: {
  children?: ReactNode;
  flexDirection?: "column" | "row";
  width?: number;
  height?: number;
  overflow?: "hidden" | "visible";
  key?: number;
}) => ReactElement;

const TONE_COLORS: Record<MonitorSegmentTone, string> = {
  active: "cyan",
  success: "green",
  failure: "red",
};

const DEFAULT_TERMINAL_COLUMNS = 245;
const DEFAULT_TERMINAL_ROWS = 72;
const TONE_COLUMNS = new Set<TreeColumnId>(["state", "live"]);

function gridCellTone(column: TreeColumnId, tableRow: WorkflowTableRow): MonitorSegmentTone | undefined {
  if (!TONE_COLUMNS.has(column)) return undefined;
  const run = monitorTreeRun(tableRow);
  if (column === "state") return RUN_STATUS_TONES[run.status];
  return livenessTone(run.isLive);
}

function renderSegmentRow(line: MonitorLineRow, Text: MonitorText, rowKey: number, RowBox?: MonitorBox): ReactElement {
  const cells = line.segments.map((segment, index) => {
    const props: { key: number; color?: string } = { key: index };
    if (segment.tone !== undefined) props.color = TONE_COLORS[segment.tone];
    return createElement(Text, props, segment.text);
  });
  if (RowBox !== undefined) return createElement(RowBox, { key: rowKey, flexDirection: "row" }, ...cells);
  return createElement(Fragment, { key: rowKey }, ...cells);
}

function splitPrebuiltTreeRow(row: string, leftPaneWidth: number): { column: TreeColumnId; text: string }[] {
  let offset = 0;
  return visibleColumns(leftPaneWidth).map((column) => {
    const width = TREE_COLUMN_WIDTHS[column];
    const text = row.slice(offset, offset + width);
    offset += width;
    return { column, text };
  });
}

function renderPrebuiltTreeRow(
  row: string,
  leftPaneWidth: number,
  Text: MonitorText,
  rowKey: number,
  RowBox?: MonitorBox,
): ReactElement {
  const cells = splitPrebuiltTreeRow(row, leftPaneWidth);
  const rendered = cells.map((cell, index) => createElement(Text, { key: index }, cell.text));
  if (RowBox !== undefined) return createElement(RowBox, { key: rowKey, flexDirection: "row" }, ...rendered);
  return createElement(Fragment, { key: rowKey }, ...rendered);
}

function renderRunGridRow(
  tableRow: WorkflowTableRow,
  selectedNodeId: string | null,
  leftPaneWidth: number,
  depth: number,
  nowMs: number,
  Text: MonitorText,
  rowKey: number,
  RowBox?: MonitorBox,
): ReactElement {
  const cells = listMonitorTreeCellsAtDepth(tableRow, selectedNodeId, leftPaneWidth, depth, nowMs);
  const rendered = cells.map((cell, index) => {
    const tone = gridCellTone(cell.column, tableRow);
    const props: { key: number; color?: string } = { key: index };
    if (tone !== undefined) props.color = TONE_COLORS[tone];
    return createElement(Text, props, cell.text);
  });
  if (RowBox !== undefined) return createElement(RowBox, { key: rowKey, flexDirection: "row" }, ...rendered);
  return createElement(Fragment, { key: rowKey }, ...rendered);
}

function renderTreeRow(
  treeRow: MonitorPipelineTreeDisplayNode,
  selectedNodeId: string | null,
  leftPaneWidth: number,
  nowMs: number,
  Text: MonitorText,
  rowKey: number,
  RowBox?: MonitorBox,
): ReactElement {
  switch (treeRow.kind) {
    case "pipeline":
      return renderPrebuiltTreeRow(
        buildPipelineMonitorTreeRow(treeRow, selectedNodeId, leftPaneWidth, nowMs),
        leftPaneWidth,
        Text,
        rowKey,
        RowBox,
      );
    case "stage":
      return renderPrebuiltTreeRow(
        buildStageMonitorTreeRow(treeRow, selectedNodeId, leftPaneWidth, nowMs),
        leftPaneWidth,
        Text,
        rowKey,
        RowBox,
      );
    case "run":
      return renderRunGridRow(
        treeRow.tableRow,
        selectedNodeId,
        leftPaneWidth,
        treeRow.depth,
        nowMs,
        Text,
        rowKey,
        RowBox,
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
  const { treeRows, unattributedRows } = monitorLeftPaneContentRows(state, nowMs);
  const rendered: ReactElement[] = [];
  if (treeRows.length === 0 && unattributedRows.length === 0) {
    rendered.push(renderSegmentRow({ segments: [{ text: "No runs." }] }, Text, 0, RowBox));
  } else {
    for (const [index, treeRow] of treeRows.entries()) {
      rendered.push(renderTreeRow(treeRow, state.selectedNodeId, leftPaneWidth, nowMs, Text, index, RowBox));
    }
    for (const [index, tableRow] of unattributedRows.entries()) {
      rendered.push(
        renderRunGridRow(
          tableRow,
          state.selectedNodeId,
          leftPaneWidth,
          0,
          nowMs,
          Text,
          treeRows.length + index,
          RowBox,
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
            overflow: "hidden",
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
          key.escape ||
          key.leftArrow ||
          key.rightArrow ||
          key.backspace ||
          key.delete ||
          key.upArrow ||
          key.downArrow;
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
