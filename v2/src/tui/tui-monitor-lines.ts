import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import type { RunStatus } from "../persistence/state-store.ts";
import type { PipelineListResult } from "./tui-daemon-client.ts";
import {
  buildMonitorPipelineTree,
  type MonitorPipelineTreeDisplayNode,
  stageBranchCellValue,
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
  const maxVisibleRows = layout.paneHeight - leftPaneQueueHeadingRowCount(state);
  const expandedNodeIds = new Set(state.expandedPipelineNodeIds ?? []);
  const { displayNodes, unattributedRows } = buildMonitorPipelineTree(
    snapshots,
    state.runs,
    expandedNodeIds,
    state.selectedNodeId,
    maxVisibleRows,
    { nowMs },
  );
  return {
    treeRows: displayNodes.slice(0, maxVisibleRows),
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

/** Workflow, outcome, and steering detail for the right pane. */
export function monitorRightPaneSegmentRows(state: TuiMonitorState, nowMs = Date.now()): MonitorLineRow[] {
  const selected = state.selectedNodeId;
  if (selected === null) {
    return [row(untoned("No run selected."))];
  }

  const columns = state.terminalColumns ?? 245;
  const terminalRows = state.terminalRows ?? 72;
  const layout = computeShellLayout(columns, terminalRows, state.dividerOffset ?? 0);
  const { fullTreeRows, unattributedRows } = monitorLeftPaneTreeRows(state, layout, nowMs);
  // Mutation checkpoint: resolving selection from painted treeRows only must turn off-pane right-pane detail pin RED.
  const treeRow = fullTreeRows.find((entry) => entry.id === selected);

  // Mutation checkpoint: treating pipeline selection as run detail in monitorRightPaneSegmentRows must turn pipeline/stage right-pane pin RED.
  if (treeRow?.kind === "pipeline") {
    return [
      row(untoned(`pipelineId: ${treeRow.snapshot.pipelineId}`)),
      row(untoned(`name: ${treeRow.snapshot.name}`)),
      row(untoned(`project: ${treeRow.project}`)),
      row(untoned(`state: ${treeRow.snapshot.state}`)),
    ];
  }
  if (treeRow?.kind === "stage") {
    return [
      row(untoned(`stageId: ${treeRow.stageId}`)),
      row(untoned(`branch: ${stageBranchCellValue(treeRow.branchKey)}`)),
      row(untoned(`status: ${treeRow.status}`)),
    ];
  }

  const selectedRunId =
    treeRow?.kind === "run"
      ? treeRow.id
      : unattributedRows.some((tableRow) => monitorTreeRun(tableRow).runId === selected)
        ? selected
        : null;
  if (selectedRunId === null) {
    return [row(untoned("No run selected."))];
  }

  const lines: MonitorLineRow[] = [];
  const selectedRun = state.runs.find((run) => run.runId === selectedRunId);
  if (selectedRun?.workflow !== undefined) {
    lines.push(row(untoned("Workflow")));
    for (const step of selectedRun.workflow.steps) {
      const marker = step.status === "in_progress" ? ">" : " ";
      const outcomeSuffix = step.terminalOutcome !== undefined ? ` ${step.terminalOutcome}` : "";
      lines.push(
        row(
          untoned(`${marker} ${step.stepId} ${step.role} ${step.status}${outcomeSuffix} attempts=${step.attemptCount}`),
        ),
      );
    }
  }
  lines.push(row(untoned("Outcome")), ...outcomeLines(state, selectedRunId));
  if (state.steeringFeedback !== null) {
    lines.push(row(untoned(state.steeringFeedback)));
  }
  return lines;
}

function outcomeLines(state: TuiMonitorState, _selectedRunId: string): MonitorLineRow[] {
  const waitState = state.waitState;
  if (waitState.kind === "pending") return [row(untoned(`Waiting for ${waitState.runId}...`))];
  if (waitState.kind === "ready") {
    return [
      row(untoned(`runStatus: ${waitState.result.runStatus}`)),
      ...(waitState.result.loopOutcomeKind !== undefined
        ? [row(untoned(`loopOutcomeKind: ${waitState.result.loopOutcomeKind}`))]
        : []),
      ...(waitState.result.iterationsConsumed !== undefined
        ? [row(untoned(`iterationsConsumed: ${waitState.result.iterationsConsumed}`))]
        : []),
      ...(waitState.result.resumable !== undefined ? [row(untoned(`resumable: ${waitState.result.resumable}`))] : []),
    ];
  }
  if (waitState.kind === "error") return [row(untoned(`Wait failed for ${waitState.runId}.`))];
  return [row(untoned("No outcome yet."))];
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
