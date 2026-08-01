import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import type { InkRender } from "./tui-ink-feedback.tsx";
import { type InjectedInkUi, type InkUseInput, loadInkUi } from "./tui-ink-runtime.ts";
import {
  countActiveLiveRuns,
  livenessTone,
  type MonitorLineRow,
  type MonitorSegmentTone,
  monitorLeftPaneQueueRows,
  monitorLeftPaneTableRows,
  monitorRightPaneSegmentRows,
  RUN_STATUS_TONES,
} from "./tui-monitor-lines.ts";
import type { TuiMonitorControls, TuiMonitorSession, TuiMonitorState } from "./tui-monitor-types.ts";
import type { WorkflowTableRow } from "./tui-monitor-workflow-collapse.ts";
import {
  computeShellLayout,
  listMonitorTreeCells,
  monitorTreeRun,
  nudgeDividerOffset,
  type TreeColumnId,
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
const DEFAULT_REFRESH_INTERVAL_LABEL = "1s";

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

function renderGridRow(
  tableRow: WorkflowTableRow,
  selectedRunId: string | null,
  leftPaneWidth: number,
  Text: MonitorText,
  rowKey: number,
  RowBox?: MonitorBox,
): ReactElement {
  const cells = listMonitorTreeCells(tableRow, selectedRunId, leftPaneWidth);
  const rendered = cells.map((cell, index) => {
    const tone = gridCellTone(cell.column, tableRow);
    const props: { key: number; color?: string } = { key: index };
    if (tone !== undefined) props.color = TONE_COLORS[tone];
    return createElement(Text, props, cell.text);
  });
  if (RowBox !== undefined) return createElement(RowBox, { key: rowKey, flexDirection: "row" }, ...rendered);
  return createElement(Fragment, { key: rowKey }, ...rendered);
}

function renderSegmentRows(
  lines: readonly MonitorLineRow[],
  Text: MonitorText,
  RowBox: MonitorBox | undefined,
): ReactElement[] {
  return lines.map((line, index) => renderSegmentRow(line, Text, index, RowBox));
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

function renderLeftPaneContent(
  state: TuiMonitorState,
  leftPaneWidth: number,
  Text: MonitorText,
  RowBox: MonitorBox | undefined,
): ReactElement[] {
  const tableRows = monitorLeftPaneTableRows(state);
  const rows: ReactElement[] = [];
  if (tableRows.length === 0) {
    rows.push(renderSegmentRow({ segments: [{ text: "No runs." }] }, Text, 0, RowBox));
  } else {
    for (const [index, tableRow] of tableRows.entries()) {
      rows.push(renderGridRow(tableRow, state.selectedRunId, leftPaneWidth, Text, index, RowBox));
    }
  }
  const queueRows = monitorLeftPaneQueueRows(state);
  rows.push(...renderSegmentRows(queueRows, Text, RowBox));
  return rows;
}

function renderDockContent(state: TuiMonitorState, Text: MonitorText): ReactElement[] {
  const activeCount = countActiveLiveRuns(state);
  const refreshLabel = state.refreshIntervalLabel ?? DEFAULT_REFRESH_INTERVAL_LABEL;
  return [
    createElement(Text, { key: 0 }, `${activeCount} active · refresh ${refreshLabel}`),
    createElement(Text, { key: 1 }, ">"),
    createElement(Text, { key: 2 }, ""),
    createElement(Text, { key: 3 }, ""),
  ];
}

/** Ink tree for one monitor snapshot; shared by the session host and render tests. */
export function createMonitorDisplay(state: TuiMonitorState, Text: MonitorText, Box?: MonitorBox): ReactElement {
  const { columns, rows } = shellTerminalSize(state);
  const dividerOffset = state.dividerOffset ?? 0;
  const layout = computeShellLayout(columns, rows, dividerOffset);
  const leftContent = renderLeftPaneContent(
    state,
    layout.layoutMode === "split" ? layout.leftWidth : columns,
    Text,
    Box,
  );
  const rightContent = renderSegmentRows(monitorRightPaneSegmentRows(state), Text, Box);
  const dockContent = renderDockContent(state, Text);

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
): Promise<TuiMonitorSession> {
  const { renderFn, Text, Box, useInput: inkUseInput } = await loadInkUi(inkRender);
  const useInput: InkUseInput = inkUseInput ?? (() => {});
  const sessionState = { current: mergeMonitorSessionState(initialState, initialState) };

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
        return;
      }
      if (input === "e") {
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

  const instance = renderFn(createElement(MonitorSessionRoot));

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
