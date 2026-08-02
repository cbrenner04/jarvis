import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import type { RunStatus } from "../persistence/state-store.ts";
import type { PipelineListResult } from "./tui-daemon-client.ts";
import { formatElapsedWallClock } from "./tui-elapsed-format.ts";
import {
  buildMonitorPipelineTree,
  type MonitorPipelineTreeDisplayNode,
  type MonitorPipelineTreePipelineNode,
} from "./tui-monitor-pipeline-tree.ts";
import type { TuiMonitorState } from "./tui-monitor-types.ts";
import {
  buildWorkflowTableRows,
  isActiveRunStatus,
  type WorkflowTableRow,
  workflowCollapsedContextSuffix,
  workflowRoleLabel,
} from "./tui-monitor-workflow-collapse.ts";
import type { ShellLayout } from "./tui-shell-layout.ts";
import { computeShellLayout, monitorTreeRun } from "./tui-shell-layout.ts";

/** Non-queued runs in display order: active group then terminal group, daemon order within each. */
export function orderSelectableRuns(runs: readonly DaemonListRunRow[]): DaemonListRunRow[] {
  const active: DaemonListRunRow[] = [];
  const terminal: DaemonListRunRow[] = [];
  for (const run of runs) {
    if (run.status === "queued") continue;
    if (isActiveRunStatus(run.status)) {
      active.push(run);
    } else {
      terminal.push(run);
    }
  }
  return [...active, ...terminal];
}

/** Selectable runs in monitor display order (collapsed workflows count as one row). */
export function monitorSelectableRuns(state: TuiMonitorState): DaemonListRunRow[] {
  const selectable = orderSelectableRuns(state.runs);
  return buildWorkflowTableRows(selectable, state.runs, new Set()).map((row) =>
    row.kind === "workflow-collapsed" ? row.representative : row.run,
  );
}

/** Clock for unattributed terminal retention; pinned on refresh, not display tick. */
export function monitorTerminalFilterNowMs(state: TuiMonitorState, displayNowMs: number): number {
  return state.terminalWindowNowMs ?? displayNowMs;
}

/** Initial monitor selection: first selectable tree or unattributed row in pane order. */
export function firstSelectableNodeId(state: TuiMonitorState, nowMs = Date.now()): string | null {
  return monitorSelectableNodeIds(state, nowMs)[0] ?? null;
}

/** Selectable node ids in left-pane order: full flattened tree rows, then unattributed runs. */
export function monitorSelectableNodeIds(state: TuiMonitorState, nowMs = Date.now()): string[] {
  const columns = state.terminalColumns ?? 245;
  const rows = state.terminalRows ?? 72;
  const layout = computeShellLayout(columns, rows, state.dividerOffset ?? 0);
  const { fullTreeRows, unattributedRows } = monitorLeftPaneTreeRows(state, layout, nowMs);
  // Mutation checkpoint: omitting unattributed rows from monitorSelectableNodeIds must turn tree+unattributed navigation pin RED.
  return [...fullTreeRows.map((row) => row.id), ...unattributedRows.map((row) => monitorTreeRun(row).runId)];
}

/** Initial monitor selection: topmost active run, or first terminal when all are terminal. */
export function firstSelectableRunId(state: TuiMonitorState): string | null {
  return monitorSelectableRuns(state)[0]?.runId ?? null;
}

export type MonitorSegmentTone = "active" | "success" | "failure";

export type MonitorSegment = {
  text: string;
  tone?: MonitorSegmentTone;
};

export type MonitorLineRow = {
  segments: readonly MonitorSegment[];
};

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export const RUN_STATUS_TONES: Record<RunStatus, MonitorSegmentTone> = {
  "in-progress": "active",
  completed: "success",
  blocked: "failure",
  "budget-soft-stopped": "failure",
  paused: "active",
  failed: "failure",
  interrupted: "failure",
  killed: "failure",
  queued: "active",
};

export function livenessTone(isLive: boolean): MonitorSegmentTone | undefined {
  return isLive ? "active" : undefined;
}

const QUEUE_ADMISSION_DESCRIPTOR = "waiting: memory headroom";

function untoned(text: string): MonitorSegment {
  return { text };
}

function separator(): MonitorSegment {
  return untoned(" ");
}

function row(...segments: MonitorSegment[]): MonitorLineRow {
  return { segments };
}

export function wrapMonitorRows(rows: readonly MonitorLineRow[], width: number): MonitorLineRow[] {
  return rows.flatMap((line) => {
    const wrapped: MonitorLineRow[] = [];
    let segments: MonitorSegment[] = [];
    let usedWidth = 0;

    const flush = (): void => {
      wrapped.push({ segments });
      segments = [];
      usedWidth = 0;
    };

    for (const segment of line.segments) {
      for (const { segment: grapheme } of GRAPHEME_SEGMENTER.segment(segment.text)) {
        const graphemeWidth = Bun.stringWidth(grapheme);
        // A grapheme wider than width remains whole on an otherwise empty row.
        if (segments.length > 0 && usedWidth + graphemeWidth > width) flush();
        const current = segments.at(-1);
        if (current !== undefined && current.tone === segment.tone) {
          current.text += grapheme;
        } else {
          segments.push({ text: grapheme, ...(segment.tone === undefined ? {} : { tone: segment.tone }) });
        }
        usedWidth += graphemeWidth;
      }
    }
    if (segments.length > 0 || wrapped.length === 0) flush();
    return wrapped;
  });
}

function effectiveRightPaneWidth(layout: ShellLayout, columns: number): number {
  return Math.max(1, layout.layoutMode === "split" ? layout.rightWidth : columns);
}

export function joinMonitorRow(line: MonitorLineRow): string {
  return line.segments.map((segment) => segment.text).join("");
}

function runTableRow(run: DaemonListRunRow, selectedNodeId: string | null, suffix = ""): MonitorLineRow {
  const marker = run.runId === selectedNodeId ? ">" : " ";
  const livenessText = run.isLive ? "live" : "not-live";
  const liveTone = livenessTone(run.isLive);
  return row(
    untoned(marker),
    separator(),
    untoned(run.runId),
    separator(),
    untoned(run.project),
    separator(),
    untoned(run.branch),
    separator(),
    { text: run.status, tone: RUN_STATUS_TONES[run.status] },
    separator(),
    liveTone === undefined ? untoned(livenessText) : { text: livenessText, tone: liveTone },
    ...(suffix.length > 0 ? [separator(), untoned(suffix.trimStart())] : []),
  );
}

function renderWorkflowTableRow(tableRow: WorkflowTableRow, selectedNodeId: string | null): MonitorLineRow {
  switch (tableRow.kind) {
    case "standalone":
      return runTableRow(tableRow.run, selectedNodeId);
    case "workflow-collapsed":
      return runTableRow(tableRow.representative, selectedNodeId, workflowCollapsedContextSuffix(tableRow.members));
    case "workflow-child":
      return runTableRow(tableRow.run, selectedNodeId, workflowRoleLabel(tableRow.run));
  }
}

function queueRow(run: DaemonListRunRow): MonitorLineRow {
  return row(
    untoned("  "),
    untoned(run.runId),
    separator(),
    untoned(run.project),
    separator(),
    untoned(run.branch),
    separator(),
    { text: run.status, tone: RUN_STATUS_TONES[run.status] },
    separator(),
    untoned(QUEUE_ADMISSION_DESCRIPTOR),
  );
}

/** Non-queued runs with `isLive: true` for the dock active count. */
export function countActiveLiveRuns(state: TuiMonitorState): number {
  return state.runs.filter((run) => run.status !== "queued" && run.isLive).length;
}

/** Workflow table rows for the left-pane grid (empty when no selectable runs). */
export function monitorLeftPaneTableRows(state: TuiMonitorState): WorkflowTableRow[] {
  const selectableRuns = orderSelectableRuns(state.runs);
  return buildWorkflowTableRows(selectableRuns, state.runs, new Set());
}

export function mergePipelineSnapshots(
  pipelineSnapshotsBySocketPath: Readonly<Record<string, PipelineListResult>> | undefined,
): PipelineSnapshot[] {
  if (pipelineSnapshotsBySocketPath === undefined) return [];
  const merged: PipelineSnapshot[] = [];
  for (const socketPath of Object.keys(pipelineSnapshotsBySocketPath).sort()) {
    merged.push(...(pipelineSnapshotsBySocketPath[socketPath]?.pipelines ?? []));
  }
  return merged;
}

function leftPaneQueueHeadingRowCount(state: TuiMonitorState): number {
  return state.runs.some((run) => run.status === "queued") ? 1 : 0;
}

function leftPaneTreeMaxVisibleRows(state: TuiMonitorState, layout: ShellLayout): number {
  return layout.paneHeight - leftPaneQueueHeadingRowCount(state);
}

function reclampLeftPaneTreeScrollOffset(offset: number, maxVisibleRows: number, totalTreeRows: number): number {
  const maxOffset = Math.max(0, totalTreeRows - maxVisibleRows);
  return Math.min(Math.max(0, offset), maxOffset);
}

/** Recompute {@link TuiMonitorState.leftPaneTreeScrollOffset} for the current selection. */
export function withLeftPaneTreeScrollFollow(state: TuiMonitorState, nowMs = Date.now()): TuiMonitorState {
  const columns = state.terminalColumns ?? 245;
  const rows = state.terminalRows ?? 72;
  const layout = computeShellLayout(columns, rows, state.dividerOffset ?? 0);
  const maxVisibleRows = leftPaneTreeMaxVisibleRows(state, layout);
  const { fullTreeRows } = monitorLeftPaneTreeRows(state, layout, nowMs);
  const currentOffset = state.leftPaneTreeScrollOffset ?? 0;
  const selectedId = state.selectedNodeId;
  const selectedIndex = selectedId === null ? -1 : fullTreeRows.findIndex((row) => row.id === selectedId);
  if (selectedIndex < 0) {
    return {
      ...state,
      leftPaneTreeScrollOffset: reclampLeftPaneTreeScrollOffset(currentOffset, maxVisibleRows, fullTreeRows.length),
    };
  }
  let offset = currentOffset;
  if (selectedIndex < offset) {
    offset = selectedIndex;
  } else if (selectedIndex >= offset + maxVisibleRows) {
    offset = selectedIndex - maxVisibleRows + 1;
  }
  return {
    ...state,
    leftPaneTreeScrollOffset: reclampLeftPaneTreeScrollOffset(offset, maxVisibleRows, fullTreeRows.length),
  };
}

/** Pipeline tree and unattributed rows for the ink monitor left pane. */
export function monitorLeftPaneTreeRows(
  state: TuiMonitorState,
  layout: ShellLayout,
  nowMs: number,
): {
  treeRows: readonly MonitorPipelineTreeDisplayNode[];
  fullTreeRows: readonly MonitorPipelineTreeDisplayNode[];
  unattributedRows: readonly WorkflowTableRow[];
} {
  const snapshots = mergePipelineSnapshots(state.pipelineSnapshotsBySocketPath);
  const maxVisibleRows = leftPaneTreeMaxVisibleRows(state, layout);
  const expandedNodeIds = new Set(state.expandedPipelineNodeIds ?? []);
  const filterNowMs = monitorTerminalFilterNowMs(state, nowMs);
  const { displayNodes, unattributedRows } = buildMonitorPipelineTree(
    snapshots,
    state.runs,
    expandedNodeIds,
    state.selectedNodeId,
    maxVisibleRows,
    { filterNowMs },
  );
  const scrollOffset = reclampLeftPaneTreeScrollOffset(
    state.leftPaneTreeScrollOffset ?? 0,
    maxVisibleRows,
    displayNodes.length,
  );
  return {
    treeRows: displayNodes.slice(scrollOffset, scrollOffset + maxVisibleRows),
    fullTreeRows: displayNodes,
    unattributedRows,
  };
}

/** Queue block for the left pane (heading + rows). */
export function monitorLeftPaneQueueRows(state: TuiMonitorState): MonitorLineRow[] {
  const queuedRuns = state.runs.filter((run) => run.status === "queued").toReversed();
  if (queuedRuns.length === 0) return [];
  return [row(untoned("Queue")), ...queuedRuns.map((run) => queueRow(run))];
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? "null" : stableJson(entry))).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

function detailValue(value: unknown): string {
  return typeof value === "string" ? value : stableJson(value);
}

function detailRows(entries: readonly (readonly [label: string, value: unknown])[]): MonitorLineRow[] {
  return entries.flatMap(([label, value]) =>
    value === undefined ? [] : [row(untoned(`${label}: ${detailValue(value)}`))],
  );
}

function pipelineProjectRows(snapshot: PipelineSnapshot, runs: readonly DaemonListRunRow[]): MonitorLineRow[] {
  const invocationIds = new Set(
    snapshot.stages.flatMap((stage) => (stage.workflowInvocationId === null ? [] : [stage.workflowInvocationId])),
  );
  const projects = new Set(
    runs
      .filter(
        (run) => run.status !== "queued" && run.workflow !== undefined && invocationIds.has(run.workflow.invocationId),
      )
      .map((run) => run.project),
  );
  const project = [...projects][0] ?? "";
  if (projects.size !== 1 || project.length === 0) return [];
  return [row(untoned(`project: ${project}`))];
}

function pipelineContextRows(
  pipeline: MonitorPipelineTreePipelineNode,
  runs: readonly DaemonListRunRow[],
  nowMs: number,
): MonitorLineRow[] {
  const snapshot = pipeline.snapshot;
  return [
    ...detailRows([
      ["pipelineId", snapshot.pipelineId],
      ["name", snapshot.name],
    ]),
    ...pipelineProjectRows(snapshot, runs),
    ...detailRows([
      ["state", snapshot.state],
      ["elapsed", formatElapsedWallClock(snapshot.createdAt, snapshot.finishedAtMs, nowMs)],
      ["createdAt", snapshot.createdAt],
      ["finishedAtMs", snapshot.finishedAtMs],
      ["terminalAction", snapshot.terminalAction],
      ["seedPath", snapshot.seedPath],
      ["terminalPublicationSucceededAt", snapshot.terminalPublicationSucceededAt],
      ["terminalPublicationFailure", snapshot.terminalPublicationFailure],
    ]),
    row(untoned("Stages")),
    ...snapshot.stages.map((stage) =>
      row(
        untoned(
          `stage: ${stage.stageId} branch=${stage.branchKey} status=${stage.status} elapsed=${formatElapsedWallClock(stage.startedAt, stage.endedAt, nowMs)}`,
        ),
      ),
    ),
  ];
}

function stageDetailRows(stage: PipelineSnapshot["stages"][number] | undefined): MonitorLineRow[] {
  if (stage === undefined) return [];
  return [
    row(untoned("Stage")),
    ...detailRows([
      ["id", stage.id],
      ["stageId", stage.stageId],
      ["branch", stage.branchKey],
      ["position", stage.position],
      ["status", stage.status],
      ["workflowInvocationId", stage.workflowInvocationId],
      ["artifact", stage.artifact],
      ["failureDetail", stage.failureDetail],
      ["startedAt", stage.startedAt],
      ["endedAt", stage.endedAt],
    ]),
  ];
}

function selectedRunDetailRows(run: DaemonListRunRow): MonitorLineRow[] {
  const lines = [
    row(untoned("Run")),
    ...detailRows([
      ["runId", run.runId],
      ["project", run.project],
      ["branch", run.branch],
      ["status", run.status],
      ["isLive", run.isLive],
      ["createdAt", run.createdAt],
      ["finishedAtMs", run.finishedAtMs],
      ["stepId", run.stepId],
      ["workflowInvocationId", run.workflow?.invocationId],
    ]),
  ];
  if (run.workflow !== undefined) {
    lines.push(row(untoned("Workflow")));
    for (const step of run.workflow.steps) {
      const marker = step.status === "in_progress" ? ">" : " ";
      const outcomeSuffix = step.terminalOutcome !== undefined ? ` ${step.terminalOutcome}` : "";
      lines.push(
        row(
          untoned(`${marker} ${step.stepId} ${step.role} ${step.status}${outcomeSuffix} attempts=${step.attemptCount}`),
        ),
      );
    }
  }
  lines.push(
    ...detailRows([
      ["loopOutcomeKind", run.loopOutcomeKind],
      ["iterationsConsumed", run.iterationsConsumed],
      ["resumable", run.resumable],
      ["error", run.error],
      ["reviewPasses", run.reviewPasses],
      ["reviewBehavior", run.reviewBehavior],
      ["worktreePath", run.worktreePath],
      ["prNumber", run.prNumber],
      ["prUrl", run.prUrl],
    ]),
  );
  return lines;
}

function unwrappedRightPaneSegmentRows(state: TuiMonitorState, layout: ShellLayout, nowMs: number): MonitorLineRow[] {
  const selected = state.selectedNodeId;
  if (selected === null) {
    return [row(untoned("No run selected."))];
  }

  const { fullTreeRows } = monitorLeftPaneTreeRows(state, layout, nowMs);
  // Mutation checkpoint: resolving selection from painted treeRows only must turn off-pane right-pane detail pin RED.
  const treeRow = fullTreeRows.find((entry) => entry.id === selected);

  if (treeRow?.kind === "pipeline") {
    return pipelineContextRows(treeRow, state.runs, nowMs);
  }

  const selectedTreeIndex = treeRow === undefined ? -1 : fullTreeRows.indexOf(treeRow);
  const pipeline = fullTreeRows
    .slice(0, Math.max(0, selectedTreeIndex))
    .findLast((entry): entry is MonitorPipelineTreePipelineNode => entry.kind === "pipeline");
  const pipelineLines = pipeline === undefined ? [] : pipelineContextRows(pipeline, state.runs, nowMs);

  if (treeRow?.kind === "stage") {
    const stage = pipeline?.snapshot.stages[pipeline.stages.indexOf(treeRow)];
    return [...pipelineLines, ...stageDetailRows(stage)];
  }

  const selectedRunId =
    treeRow?.kind === "run" ? treeRow.id : monitorSelectableRuns(state).find((run) => run.runId === selected)?.runId;
  const selectedRun = state.runs.find((run) => run.runId === selectedRunId);
  if (selectedRun === undefined) {
    return [row(untoned("No run selected."))];
  }
  const lines = [...pipelineLines, ...selectedRunDetailRows(selectedRun)];
  if (state.steeringFeedback !== null) {
    lines.push(row(untoned(state.steeringFeedback)));
  }
  return lines;
}

/** Pipeline, stage, selected-run, and steering detail for the right pane. */
export function monitorRightPaneSegmentRows(state: TuiMonitorState, nowMs = Date.now()): MonitorLineRow[] {
  const columns = state.terminalColumns ?? 245;
  const terminalRows = state.terminalRows ?? 72;
  const layout = computeShellLayout(columns, terminalRows, state.dividerOffset ?? 0);
  const rows = unwrappedRightPaneSegmentRows(state, layout, nowMs);
  return wrapMonitorRows(rows, effectiveRightPaneWidth(layout, columns));
}

/** Segment rows for the ink run monitor from one snapshot. */
export function monitorSegmentRows(state: TuiMonitorState, nowMs = Date.now()): MonitorLineRow[] {
  const selected = state.selectedNodeId;
  const lines: MonitorLineRow[] = [];
  const tableRows = monitorLeftPaneTableRows(state);
  if (tableRows.length === 0) {
    lines.push(row(untoned("No runs.")));
  } else {
    lines.push(row(untoned("runId project branch status liveness")));
    for (const tableRow of tableRows) {
      lines.push(renderWorkflowTableRow(tableRow, selected));
    }
  }
  lines.push(...monitorLeftPaneQueueRows(state), ...monitorRightPaneSegmentRows(state, nowMs));
  lines.push(row(untoned("Press up/down or j to select; e expands pipeline/stage; q or Ctrl-C to quit.")));
  return lines;
}

/** Flat text lines for the ink run monitor from one snapshot. */
export function monitorTextLines(state: TuiMonitorState): string[] {
  return monitorSegmentRows(state).map(joinMonitorRow);
}
