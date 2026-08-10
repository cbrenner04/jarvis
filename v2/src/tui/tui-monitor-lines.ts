import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { derivePipelineBoundary, type PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import type { PipelineStageArtifact } from "../daemon/pipeline-stage-dispatch.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { isTerminalRunStatus, type RunStatus } from "../persistence/state-store.ts";
import { type AttentionRow, buildAttentionRows } from "./tui-attention-rows.ts";
import type { PipelineListResult } from "./tui-daemon-client.ts";
import { formatAggregateDuration, formatElapsedWallClock } from "./tui-elapsed-format.ts";
import {
  buildMonitorPipelineTree,
  buildMonitorPipelineTreeJoin,
  isExpandablePipelineNodeId,
  type MonitorPipelineTreeAdHocNode,
  type MonitorPipelineTreeDisplayNode,
  type MonitorPipelineTreePipelineNode,
  type MonitorPipelineTreeStageNode,
  pipelineStageNodes,
  pipelineStageRollupGroups,
  pipelineWorkIdleTiming,
  stageElapsedLabel,
} from "./tui-monitor-pipeline-tree.ts";
import type { TuiMonitorState } from "./tui-monitor-types.ts";
import {
  buildWorkflowTableRows,
  isActiveRunStatus,
  type WorkflowTableRow,
  workflowCollapsedContextSuffix,
  workflowGroupHasActiveMember,
  workflowGroupRollupRunStatus,
  workflowRoleLabel,
  workflowTableRowMembers,
} from "./tui-monitor-workflow-collapse.ts";
import type { ShellLayout } from "./tui-shell-layout.ts";
import {
  composeRunRow,
  computeShellLayout,
  MONITOR_TREE_NOT_LIVE_LABEL,
  monitorTreeRun,
  runRowElapsedLabel,
  runRowLabel,
} from "./tui-shell-layout.ts";
import { formatAbsoluteTimestamp } from "./tui-timestamp-format.ts";

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

/** Initial monitor selection: first selectable work-tree row in pane order. */
export function firstSelectableNodeId(state: TuiMonitorState, nowMs = Date.now()): string | null {
  return monitorSelectableNodeIds(state, nowMs)[0] ?? null;
}

/** Selectable node ids in left-pane order: capped attention ids, then every full flattened work-tree row. */
export function monitorSelectableNodeIds(state: TuiMonitorState, nowMs = Date.now()): string[] {
  const columns = state.terminalColumns ?? 245;
  const rows = state.terminalRows ?? 72;
  const layout = computeShellLayout(columns, rows, state.dividerOffset ?? 0);
  const { fullTreeRows } = monitorLeftPaneTreeRows(state, layout, nowMs);
  const projection = buildAttentionRows(state.pipelineSnapshotsBySocketPath, state.runs);
  // Mutation checkpoint: dropping the attention-id prefix here must turn selectable-prefix-order RED.
  // Mutation checkpoint: selecting overflow rows here must turn overflow-exclusion RED (projection.rows is already capped).
  return [...projection.rows.map((attentionRow) => attentionRow.id), ...fullTreeRows.map((row) => row.id)];
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

type DetailSection = {
  heading?: string;
  rows: readonly MonitorLineRow[];
};

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const SECTION_GAP = " ";

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

const DOCK_CURSOR = "▏";
const DOCK_CONTROL_REPLACEMENT = "�";
const DEFAULT_DOCK_COLUMNS = 245;
const DEFAULT_DOCK_REFRESH_LABEL = "1s";
const TAB_STOP_COLUMNS = 4;

type DockInputAtom = {
  text: string;
  width: number;
  cursor: boolean;
};

type PipelineObservationBucket = "running" | "awaitingGate" | "failed" | "done";

export type PipelineObservationBuckets = Record<PipelineObservationBucket, number>;

const RUNNING_PIPELINE_STATES: ReadonlySet<PipelineSnapshot["state"]> = new Set(["pending", "running"]);
const FAILED_PIPELINE_STATES: ReadonlySet<PipelineSnapshot["state"]> = new Set(["failed", "rejected", "interrupted"]);

function snapshotHasReachableUndecidedGate(snapshot: PipelineSnapshot): boolean {
  const resolved = getPipelineDefinition(snapshot.name);
  if (!resolved.ok) return false;
  return (
    derivePipelineBoundary({
      id: snapshot.pipelineId,
      name: snapshot.name,
      createdAt: snapshot.createdAt,
      ownerIdentity: null,
      status: snapshot.state === "interrupted" ? "interrupted" : "active",
      definition: resolved.definition,
      context: null,
      terminalPublicationFailure: snapshot.terminalPublicationFailure,
      terminalPublicationSucceededAt: snapshot.terminalPublicationSucceededAt,
      stages: snapshot.stages.map((stage) => ({ ...stage, pipelineId: snapshot.pipelineId })),
    })?.kind === "awaiting-approval"
  );
}

function classifyPipelineObservation(snapshot: PipelineSnapshot): PipelineObservationBucket {
  if (snapshot.state === "awaiting-approval") return "awaitingGate";
  if (snapshotHasReachableUndecidedGate(snapshot)) return "awaitingGate";
  if (RUNNING_PIPELINE_STATES.has(snapshot.state)) return "running";
  if (snapshot.state === "succeeded") return "done";
  if (FAILED_PIPELINE_STATES.has(snapshot.state)) return "failed";
  throw new Error(`Unsupported pipeline state: ${snapshot.state}`);
}

/** Counts merged (already-unique-per-id) pipeline snapshots by observation bucket. */
export function pipelineObservationBuckets(state: TuiMonitorState): PipelineObservationBuckets {
  const buckets: PipelineObservationBuckets = { running: 0, awaitingGate: 0, failed: 0, done: 0 };
  for (const snapshot of mergePipelineSnapshots(state.pipelineSnapshotsBySocketPath)) {
    buckets[classifyPipelineObservation(snapshot)] += 1;
  }
  return buckets;
}

function dockWorkStatusBuckets(state: TuiMonitorState): PipelineObservationBuckets {
  const buckets = pipelineObservationBuckets(state);
  const { adHocNodes } = buildMonitorPipelineTreeJoin(
    mergePipelineSnapshots(state.pipelineSnapshotsBySocketPath),
    state.runs,
  );
  for (const node of adHocNodes) {
    const members = workflowTableRowMembers(node.tableRow);
    const rollup = workflowGroupRollupRunStatus(members);
    if (workflowGroupHasActiveMember(members) || !isTerminalRunStatus(rollup)) {
      buckets.running += 1;
      continue;
    }
    if (rollup === "completed") {
      buckets.done += 1;
    } else {
      buckets.failed += 1;
    }
  }
  return buckets;
}

function sanitizeDockGrapheme(grapheme: string): string {
  if (/^[\p{Cc}\p{Cf}]+$/u.test(grapheme)) return DOCK_CONTROL_REPLACEMENT;
  return grapheme;
}

function fitDockRow(text: string, columns: number): string {
  let result = "";
  let used = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(text)) {
    const safe = sanitizeDockGrapheme(segment);
    const paintedWidth = Bun.stringWidth(safe);
    if (used + paintedWidth > columns) break;
    result += safe;
    used += paintedWidth;
  }
  return result;
}

function dockStatusLine(state: TuiMonitorState): string {
  const profile = state.machineProfile ?? "unknown";
  const digest = state.keyedSocketDigest ?? "unknown";
  const refresh = state.refreshIntervalLabel ?? DEFAULT_DOCK_REFRESH_LABEL;
  let feedback = "";
  if (state.lastRpcError !== null && state.lastRpcError !== undefined) {
    feedback += ` · error: ${state.lastRpcError}`;
  }
  if (state.lastCommandResult !== null && state.lastCommandResult !== undefined) {
    feedback += ` · result: ${state.lastCommandResult}`;
  }
  const { running, awaitingGate, failed, done } = dockWorkStatusBuckets(state);
  return `${running} running · ${awaitingGate} awaiting gate · ${failed} failed · ${done} done · ${profile}@${digest} · refresh ${refresh}${feedback}`;
}

function dockPrompt(columns: number): string {
  return columns === 1 ? "" : "> ";
}

function dockInputAtoms(buffer: string, cursorOffset: number, columns: number): DockInputAtom[] {
  const graphemes = Array.from(GRAPHEME_SEGMENTER.segment(buffer), ({ segment }) => segment);
  const cursor = Math.min(Math.max(0, cursorOffset), graphemes.length);
  const atoms: DockInputAtom[] = [];
  for (const [index, grapheme] of graphemes.entries()) {
    if (index === cursor) atoms.push({ text: DOCK_CURSOR, width: 1, cursor: true });
    if (grapheme === "\t") {
      atoms.push({ text: "\t", width: 0, cursor: false });
      continue;
    }
    const safe = sanitizeDockGrapheme(grapheme);
    const width = Bun.stringWidth(safe);
    const painted = width > columns ? DOCK_CONTROL_REPLACEMENT : safe;
    atoms.push({ text: painted, width: Bun.stringWidth(painted), cursor: false });
  }
  if (cursor === graphemes.length) atoms.push({ text: DOCK_CURSOR, width: 1, cursor: true });
  return atoms;
}

function dockInputWindow(atoms: readonly DockInputAtom[], capacity: number): readonly DockInputAtom[] {
  const cursorIndex = atoms.findIndex((atom) => atom.cursor);
  if (cursorIndex < 0) return [];
  let start = cursorIndex;
  let end = cursorIndex + 1;
  let remaining = capacity - (atoms[cursorIndex]?.width || 1);
  while (start > 0) {
    const previous = atoms[start - 1]!;
    const width = previous.width || TAB_STOP_COLUMNS;
    if (width > remaining) break;
    start -= 1;
    remaining -= width;
  }
  while (end < atoms.length) {
    const next = atoms[end]!;
    const width = next.width || TAB_STOP_COLUMNS;
    if (width > remaining) break;
    end += 1;
    remaining -= width;
  }
  return atoms.slice(start, end);
}

function paintDockInputRows(atoms: readonly DockInputAtom[], columns: number): [string, string] {
  const prompt = dockPrompt(columns);
  const capacities = [columns - Bun.stringWidth(prompt), columns] as const;
  const window = dockInputWindow(atoms, capacities[0] + capacities[1]);
  const first = { content: "", used: 0, capacity: capacities[0] };
  const second = { content: "", used: 0, capacity: capacities[1] };
  let current = first;
  for (const atom of window) {
    const tabWidth = (line: typeof first): number =>
      TAB_STOP_COLUMNS - ((line.used + (line === first ? Bun.stringWidth(prompt) : 0)) % TAB_STOP_COLUMNS);
    let width = atom.text === "\t" ? tabWidth(current) : atom.width;
    if (current.used + width > current.capacity) current = second;
    width = atom.text === "\t" ? tabWidth(current) : atom.width;
    // A tab expands to the next stop above `used`, which can overshoot a narrow row
    // even after re-measuring; paint it as a single control glyph rather than
    // dropping it, which would take the cursor atom with it and blank the row.
    const fits = current.used + width <= current.capacity;
    const text =
      atom.text === "\t" && !fits ? DOCK_CONTROL_REPLACEMENT : atom.text === "\t" ? " ".repeat(width) : atom.text;
    const paintedWidth = atom.text === "\t" && !fits ? 1 : width;
    if (current.used + paintedWidth > current.capacity) break;
    current.content += text;
    current.used += paintedWidth;
  }
  if (![first, second].some((line) => line.content.includes(DOCK_CURSOR))) {
    return [`${prompt}${DOCK_CURSOR}`, ""];
  }
  return [`${prompt}${first.content}`, second.content];
}

function dockHintLine(state: TuiMonitorState): string {
  if ((state.focus ?? "tree") === "command") return "Esc tree · Enter submit";
  const { pipelineNodes } = buildMonitorPipelineTreeJoin(
    mergePipelineSnapshots(state.pipelineSnapshotsBySocketPath),
    state.runs,
  );
  const expandable = state.selectedNodeId !== null && isExpandablePipelineNodeId(pipelineNodes, state.selectedNodeId);
  const selectedRun = state.runs.find((run) => run.runId === state.selectedNodeId);
  const killable =
    selectedRun?.isLive === true &&
    isActiveRunStatus(selectedRun.status) &&
    (state.actionableRunIds?.includes(selectedRun.runId) ?? true);
  return [
    "j/↓ next",
    "↑ previous",
    "[/] divider",
    ": command",
    "/ command",
    ...(expandable ? ["e expand/collapse"] : []),
    ...(killable ? ["k kill"] : []),
    "q quit",
  ].join(" · ");
}

/** Fixed status, input, continuation, and contextual-hint dock rows. */
export function monitorDockLines(state: TuiMonitorState): [string, string, string, string] {
  const columns = Math.max(1, state.terminalColumns ?? DEFAULT_DOCK_COLUMNS);
  const buffer = state.commandBuffer ?? "";
  const cursor = state.commandCursor ?? 0;
  const [input, continuation] = paintDockInputRows(dockInputAtoms(buffer, cursor, columns), columns);
  return [
    fitDockRow(dockStatusLine(state), columns),
    fitDockRow(input, columns),
    fitDockRow(continuation, columns),
    fitDockRow(dockHintLine(state), columns),
  ];
}

/** Workflow table rows for the left-pane grid (empty when no selectable runs). */
export function monitorLeftPaneTableRows(state: TuiMonitorState): WorkflowTableRow[] {
  const selectableRuns = orderSelectableRuns(state.runs);
  return buildWorkflowTableRows(selectableRuns, state.runs, new Set());
}

function countEndedStages(snapshot: PipelineSnapshot): number {
  return snapshot.stages.filter((stage) => stage.endedAt !== null).length;
}

/** True when `candidate` outranks `current` for the same pipelineId: finished beats unfinished, then more ended stages, then earlier socket path. */
function pipelineSnapshotOutranks(
  candidate: PipelineSnapshot,
  candidateSocketPath: string,
  current: PipelineSnapshot,
  currentSocketPath: string,
): boolean {
  const candidateFinished = candidate.finishedAtMs !== null;
  const currentFinished = current.finishedAtMs !== null;
  if (candidateFinished !== currentFinished) return candidateFinished;
  const candidateEndedCount = countEndedStages(candidate);
  const currentEndedCount = countEndedStages(current);
  if (candidateEndedCount !== currentEndedCount) return candidateEndedCount > currentEndedCount;
  return candidateSocketPath < currentSocketPath;
}

/** One snapshot per pipelineId, sorted-socket-path emission order, collision winner via `pipelineSnapshotOutranks`. */
export function mergePipelineSnapshots(
  pipelineSnapshotsBySocketPath: Readonly<Record<string, PipelineListResult>> | undefined,
): PipelineSnapshot[] {
  if (pipelineSnapshotsBySocketPath === undefined) return [];
  const merged: PipelineSnapshot[] = [];
  const indexByPipelineId = new Map<string, number>();
  const socketPathByPipelineId = new Map<string, string>();
  for (const socketPath of Object.keys(pipelineSnapshotsBySocketPath).sort()) {
    for (const snapshot of pipelineSnapshotsBySocketPath[socketPath]?.pipelines ?? []) {
      const existingIndex = indexByPipelineId.get(snapshot.pipelineId);
      if (existingIndex === undefined) {
        indexByPipelineId.set(snapshot.pipelineId, merged.length);
        socketPathByPipelineId.set(snapshot.pipelineId, socketPath);
        merged.push(snapshot);
        continue;
      }
      const current = merged[existingIndex]!;
      const currentSocketPath = socketPathByPipelineId.get(snapshot.pipelineId)!;
      if (pipelineSnapshotOutranks(snapshot, socketPath, current, currentSocketPath)) {
        merged[existingIndex] = snapshot;
        socketPathByPipelineId.set(snapshot.pipelineId, socketPath);
      }
    }
  }
  return merged;
}

function leftPaneQueueHeadingRowCount(state: TuiMonitorState): number {
  return state.runs.some((run) => run.status === "queued") ? 1 : 0;
}

/** Painted attention segment row count: heading, capped rows, and the overflow line when present. */
function leftPaneAttentionRowCount(state: TuiMonitorState): number {
  const projection = buildAttentionRows(state.pipelineSnapshotsBySocketPath, state.runs);
  if (projection.total === 0) return 0;
  return 1 + projection.rows.length + (projection.overflow > 0 ? 1 : 0);
}

function leftPaneTreeMaxVisibleRows(state: TuiMonitorState, layout: ShellLayout): number {
  // Mutation checkpoint: dropping this floor must turn the tree-budget-never-negative guard RED.
  return Math.max(0, layout.paneHeight - leftPaneQueueHeadingRowCount(state) - leftPaneAttentionRowCount(state));
}

function attentionRowLine(attentionRow: AttentionRow, selectedNodeId: string | null, nowMs: number): MonitorLineRow {
  const marker = attentionRow.id === selectedNodeId ? ">" : " ";
  const age = attentionRow.sinceMs === null ? "" : formatElapsedWallClock(attentionRow.sinceMs, null, nowMs);
  return row(
    untoned(marker),
    separator(),
    untoned(attentionRow.glyph),
    separator(),
    untoned(attentionRow.what),
    separator(),
    untoned(attentionRow.where),
    // Mutation checkpoint: painting idle age for an undated row must turn the durable-age guard RED.
    ...(age === "" ? [] : [separator(), untoned(`idle ${age}`)]),
  );
}

/** Pinned attention segment: heading, up to six capped rows, and a display-only overflow summary. */
export function monitorLeftPaneAttentionRows(state: TuiMonitorState, nowMs = Date.now()): MonitorLineRow[] {
  const projection = buildAttentionRows(state.pipelineSnapshotsBySocketPath, state.runs);
  if (projection.total === 0) return [];
  return [
    row(untoned(`── Needs attention (${projection.total}) ──`)),
    ...projection.rows.map((attentionRow) => attentionRowLine(attentionRow, state.selectedNodeId, nowMs)),
    // Mutation checkpoint: painting the overflow line without a positive overflow must turn this guard RED.
    ...(projection.overflow > 0 ? [row(untoned(`+${projection.overflow} more`))] : []),
  ];
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

/** Run/ad-hoc tree row: fill label plus `status, live, elapsed` cluster; `labelOverride` covers ad-hoc's branch label. */
export function buildTreeRunRow(
  tableRow: WorkflowTableRow,
  depth: number,
  leftPaneWidth: number,
  nowMs: number,
  labelOverride?: string,
): MonitorLineRow {
  const run = monitorTreeRun(tableRow);
  const liveTone = livenessTone(run.isLive);
  return composeRunRow(
    {
      depth,
      label: labelOverride ?? runRowLabel(tableRow),
      status: run.status,
      statusTone: RUN_STATUS_TONES[run.status],
      live: run.isLive ? "live" : MONITOR_TREE_NOT_LIVE_LABEL,
      ...(liveTone === undefined ? {} : { liveTone }),
      elapsed: runRowElapsedLabel(tableRow, nowMs),
    },
    leftPaneWidth,
  );
}

/** Pipeline and ad-hoc rows for the ink monitor left pane's unified work tree. */
export function monitorLeftPaneTreeRows(
  state: TuiMonitorState,
  layout: ShellLayout,
  _nowMs: number,
): {
  treeRows: readonly MonitorPipelineTreeDisplayNode[];
  fullTreeRows: readonly MonitorPipelineTreeDisplayNode[];
} {
  const snapshots = mergePipelineSnapshots(state.pipelineSnapshotsBySocketPath);
  const maxVisibleRows = leftPaneTreeMaxVisibleRows(state, layout);
  const expandedNodeIds = new Set(state.expandedPipelineNodeIds ?? []);
  const displayNodes = buildMonitorPipelineTree(snapshots, state.runs, expandedNodeIds, state.selectedNodeId);
  const scrollOffset = reclampLeftPaneTreeScrollOffset(
    state.leftPaneTreeScrollOffset ?? 0,
    maxVisibleRows,
    displayNodes.length,
  );
  const treeRows = displayNodes.slice(scrollOffset, scrollOffset + maxVisibleRows);
  return {
    treeRows,
    fullTreeRows: displayNodes,
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

function sectionGapRows(index: number): MonitorLineRow[] {
  return index === 0 ? [] : [row(untoned(SECTION_GAP))];
}

function joinDetailSections(sections: readonly DetailSection[]): MonitorLineRow[] {
  const present = sections.filter((section) => section.rows.length > 0);
  return present.flatMap((section, index) => [
    ...sectionGapRows(index),
    ...(section.heading === undefined ? [] : [row(untoned(section.heading))]),
    ...section.rows,
  ]);
}

function isEmptyDetailValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function detailRows(entries: readonly (readonly [label: string, value: unknown])[]): MonitorLineRow[] {
  return entries.flatMap(([label, value]) => {
    if (isEmptyDetailValue(value)) return [];
    return [row(untoned(`${label}: ${detailValue(value)}`))];
  });
}

function absoluteDetailRows(
  entries: readonly (readonly [label: string, value: number | null | undefined])[],
): MonitorLineRow[] {
  // `{ value: … }.value` is a mutation anchor: it makes the spec-pinned fragment
  // `value: formatAbsoluteTimestamp(value)` appear verbatim for `@mutate` to match.
  return detailRows(entries.map(([label, value]) => [label, { value: formatAbsoluteTimestamp(value) }.value] as const));
}

function isStageArtifactShape(artifact: unknown): artifact is PipelineStageArtifact {
  if (typeof artifact !== "object" || artifact === null) return false;
  const record = artifact as Record<string, unknown>;
  return typeof record.entryRunId === "string" && typeof record.specPath === "string";
}

function downstreamInputRows(inputs: readonly string[] | undefined): MonitorLineRow[] {
  const paths = inputs ?? [];
  if (paths.length === 0) return [];
  return [row(untoned("downstreamInputs")), ...paths.map((path) => row(untoned(`  ${path}`)))];
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonKeys(entry)]),
  );
}

function prettyJsonRows(value: unknown): MonitorLineRow[] {
  const pretty = JSON.stringify(sortJsonKeys(value), null, 2) as string;
  return pretty.split("\n").map((line) => row(untoned(line)));
}

function knownArtifactRows(artifact: PipelineStageArtifact): MonitorLineRow[] {
  return [
    ...detailRows([
      ["specPath", artifact.specPath],
      ["entryRunId", artifact.entryRunId],
      ["invocationId", artifact.invocationId],
      ["prNumber", artifact.prNumber],
      ["prUrl", artifact.prUrl],
      ["requestedBase", artifact.requestedBase],
      ["resolvedBase", artifact.resolvedBase],
    ]),
    ...downstreamInputRows(artifact.downstreamInputs),
  ];
}

function artifactRows(artifact: unknown): MonitorLineRow[] {
  if (isEmptyDetailValue(artifact)) return [];
  return isStageArtifactShape(artifact) ? knownArtifactRows(artifact) : prettyJsonRows(artifact);
}

function stageArtifactSection(artifact: unknown): DetailSection {
  return { heading: "Artifact", rows: artifactRows(artifact) };
}

function rollupFields(fields: readonly (readonly [label: string, value: string])[]): string {
  const present = fields.filter(([, value]) => value !== "");
  return present.map(([label, value]) => `${label}=${value}`).join(" ");
}

function isDecidedGateStatus(status: string): boolean {
  return status === "approved" || status === "rejected";
}

function pipelineStageRollupRow(stage: PipelineSnapshot["stages"][number], nowMs: number): MonitorLineRow {
  if (isDecidedGateStatus(stage.status)) {
    return row(
      untoned(
        `gate: ${stage.stageId} ${rollupFields([
          ["outcome", stage.status],
          ["decided", formatElapsedWallClock(stage.endedAt, null, nowMs)],
        ])}`,
      ),
    );
  }
  return row(
    untoned(
      `stage: ${stage.stageId} ${rollupFields([
        ["status", stage.status],
        ["elapsed", stageElapsedLabel(stage, nowMs)],
      ])}`,
    ),
  );
}

function pipelineStageRollupRows(snapshot: PipelineSnapshot, nowMs: number): MonitorLineRow[] {
  return pipelineStageRollupGroups(snapshot).flatMap((group) => [
    ...(group.branchKey === null ? [] : [row(untoned(`Branch ${group.branchKey}`))]),
    ...group.records.map((stage) => pipelineStageRollupRow(stage, nowMs)),
  ]);
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
): DetailSection[] {
  const snapshot = pipeline.snapshot;
  const timing = pipelineWorkIdleTiming(pipeline, nowMs);
  return [
    {
      heading: "Pipeline",
      rows: [
        ...detailRows([
          ["pipelineId", snapshot.pipelineId],
          ["name", snapshot.name],
        ]),
        ...pipelineProjectRows(snapshot, runs),
        ...detailRows([
          ["state", snapshot.state],
          ["work", formatAggregateDuration(timing.workMs)],
          ["idle", timing.idleMs === null ? "" : formatAggregateDuration(timing.idleMs)],
          ["wallClock", formatElapsedWallClock(snapshot.createdAt, snapshot.finishedAtMs, nowMs)],
        ]),
        ...absoluteDetailRows([
          ["createdAt", snapshot.createdAt],
          ["finishedAtMs", snapshot.finishedAtMs],
        ]),
        ...detailRows([
          ["terminalAction", snapshot.terminalAction],
          ["seedPath", snapshot.seedPath],
        ]),
        ...absoluteDetailRows([["terminalPublicationSucceededAt", snapshot.terminalPublicationSucceededAt]]),
        ...detailRows([["terminalPublicationFailure", snapshot.terminalPublicationFailure]]),
      ],
    },
    {
      heading: "Stages",
      rows: pipelineStageRollupRows(snapshot, nowMs),
    },
  ];
}

function stageDetailRows(stage: PipelineSnapshot["stages"][number] | undefined, nowMs: number): DetailSection[] {
  if (stage === undefined) return [];
  const artifactSection = stageArtifactSection(stage.artifact);
  return [
    {
      heading: "Stage",
      rows: detailRows([
        ["id", stage.id],
        ["stageId", stage.stageId],
        ["branch", stage.branchKey],
        ["position", stage.position],
        ["status", stage.status],
        ["elapsed", stageElapsedLabel(stage, nowMs)],
        ["workflowInvocationId", stage.workflowInvocationId],
        ["failureDetail", stage.failureDetail],
      ]).concat(
        absoluteDetailRows([
          ["startedAt", stage.startedAt],
          ["endedAt", stage.endedAt],
          ["decidedAt", stage.decidedAt],
        ]),
      ),
    },
    artifactSection,
  ];
}

function selectedRunDetailRows(run: DaemonListRunRow): DetailSection[] {
  const sections: DetailSection[] = [
    {
      heading: "Run",
      rows: detailRows([
        ["runId", run.runId],
        ["project", run.project],
        ["branch", run.branch],
        ["status", run.status],
        ["isLive", run.isLive],
      ])
        .concat(
          absoluteDetailRows([
            ["createdAt", run.createdAt],
            ["finishedAtMs", run.finishedAtMs],
          ]),
        )
        .concat(
          detailRows([
            ["stepId", run.stepId],
            ["workflowInvocationId", run.workflow?.invocationId],
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
        ),
    },
  ];
  if (run.workflow !== undefined && run.workflow.steps.length > 0) {
    const rows: MonitorLineRow[] = [];
    for (const step of run.workflow.steps) {
      const marker = step.status === "in_progress" ? ">" : " ";
      const outcomeSuffix = step.terminalOutcome !== undefined ? ` ${step.terminalOutcome}` : "";
      rows.push(
        row(
          untoned(`${marker} ${step.stepId} ${step.role} ${step.status}${outcomeSuffix} attempts=${step.attemptCount}`),
        ),
      );
    }
    sections.push({ heading: "Workflow", rows });
  }
  return sections;
}

function selectedAncestorPipeline(
  fullTreeRows: readonly MonitorPipelineTreeDisplayNode[],
  treeRow: MonitorPipelineTreeDisplayNode | undefined,
): MonitorPipelineTreePipelineNode | undefined {
  if (treeRow === undefined || treeRow.kind === "adhoc") return undefined;
  const selectedTreeIndex = fullTreeRows.indexOf(treeRow);
  return fullTreeRows
    .slice(0, Math.max(0, selectedTreeIndex))
    .findLast((entry): entry is MonitorPipelineTreePipelineNode => entry.kind === "pipeline");
}

const stageRecordForTreeRow = (
  pipeline: MonitorPipelineTreePipelineNode | undefined,
  treeRow: MonitorPipelineTreeStageNode,
): PipelineSnapshot["stages"][number] | undefined =>
  pipeline?.snapshot.stages.find((stage) => stage.stageId === treeRow.stageId && stage.branchKey === treeRow.branchKey);

/** Maps a selected attention row id to its target node id, or null when `selected` is not an attention row. */
function resolveAttentionTargetId(state: TuiMonitorState, selected: string): string | null {
  const projection = buildAttentionRows(state.pipelineSnapshotsBySocketPath, state.runs);
  // Mutation checkpoint: aliasing a non-attention selection to a target here must turn attention-target-aliasing RED.
  return projection.rows.find((attentionRow) => attentionRow.id === selected)?.targetId ?? null;
}

/**
 * Resolves an attention target's detail sections against the complete joined pipeline/ad-hoc model, independent of
 * collapsed ancestors and painted expansion. An ad-hoc target resolves via its group node id even when the failed
 * run is not the group's representative.
 */
function pipelineStageTargetDetail(
  pipeline: MonitorPipelineTreePipelineNode,
  runs: readonly DaemonListRunRow[],
  targetId: string,
  nowMs: number,
): { sections: DetailSection[]; isRunTarget: boolean } | null {
  for (const stage of pipelineStageNodes(pipeline)) {
    if (stage.id === targetId) {
      return {
        sections: [
          ...pipelineContextRows(pipeline, runs, nowMs),
          ...stageDetailRows(stageRecordForTreeRow(pipeline, stage), nowMs),
        ],
        isRunTarget: false,
      };
    }
    for (const runNode of stage.runs) {
      // Match the run node itself or, when it collapses several constituent runs, any member — an
      // attributed run's target id is its own runId, which need not be the collapsed representative.
      const matches =
        runNode.id === targetId ||
        workflowTableRowMembers(runNode.tableRow).some((member) => member.runId === targetId);
      if (!matches) continue;
      const run = runs.find((candidate) => candidate.runId === targetId);
      if (run === undefined) return { sections: [], isRunTarget: false };
      return {
        sections: [...pipelineContextRows(pipeline, runs, nowMs), ...selectedRunDetailRows(run)],
        isRunTarget: true,
      };
    }
  }
  return null;
}

function joinedTargetDetailSections(
  pipelineNodes: readonly MonitorPipelineTreePipelineNode[],
  adHocNodes: readonly MonitorPipelineTreeAdHocNode[],
  runs: readonly DaemonListRunRow[],
  targetId: string,
  nowMs: number,
): { sections: DetailSection[]; isRunTarget: boolean } {
  for (const pipeline of pipelineNodes) {
    // Mutation checkpoint: resolving against painted/expanded rows instead of the complete joined model here must
    // turn collapsed-ancestor target resolution RED.
    if (pipeline.id === targetId) {
      return { sections: pipelineContextRows(pipeline, runs, nowMs), isRunTarget: false };
    }

    const stageMatch = pipelineStageTargetDetail(pipeline, runs, targetId, nowMs);
    if (stageMatch !== null) return stageMatch;
  }

  for (const adHoc of adHocNodes) {
    if (adHoc.id !== targetId) continue;
    const run = runs.find((candidate) => candidate.runId === adHoc.id);
    return run === undefined
      ? { sections: [], isRunTarget: false }
      : { sections: selectedRunDetailRows(run), isRunTarget: true };
  }

  return { sections: [], isRunTarget: false };
}

function unwrappedRightPaneSegmentRows(state: TuiMonitorState, layout: ShellLayout, nowMs: number): MonitorLineRow[] {
  const selected = state.selectedNodeId;
  if (selected === null) {
    return joinDetailSections([{ rows: [row(untoned("No run selected."))] }]);
  }

  const attentionTargetId = resolveAttentionTargetId(state, selected);
  if (attentionTargetId !== null) {
    const snapshots = mergePipelineSnapshots(state.pipelineSnapshotsBySocketPath);
    const { pipelineNodes, adHocNodes } = buildMonitorPipelineTreeJoin(snapshots, state.runs);
    const { sections, isRunTarget } = joinedTargetDetailSections(
      pipelineNodes,
      adHocNodes,
      state.runs,
      attentionTargetId,
      nowMs,
    );
    if (sections.length === 0) {
      return joinDetailSections([{ rows: [row(untoned("No run selected."))] }]);
    }
    if (isRunTarget && state.steeringFeedback !== null) {
      sections.push({ rows: [row(untoned(state.steeringFeedback))] });
    }
    return joinDetailSections(sections);
  }

  const { fullTreeRows } = monitorLeftPaneTreeRows(state, layout, nowMs);
  // Mutation checkpoint: resolving selection from painted treeRows only must turn off-pane right-pane detail pin RED.
  const treeRow = fullTreeRows.find((entry) => entry.id === selected);

  if (treeRow?.kind === "pipeline") {
    return joinDetailSections(pipelineContextRows(treeRow, state.runs, nowMs));
  }

  const pipeline = selectedAncestorPipeline(fullTreeRows, treeRow);
  const pipelineSections = pipeline === undefined ? [] : pipelineContextRows(pipeline, state.runs, nowMs);

  if (treeRow?.kind === "stage") {
    return joinDetailSections([
      ...pipelineSections,
      ...stageDetailRows(stageRecordForTreeRow(pipeline, treeRow), nowMs),
    ]);
  }

  if (treeRow?.kind === "branch") {
    return joinDetailSections([
      ...pipelineSections,
      { heading: "Branch", rows: detailRows([["branch", treeRow.branchKey]]) },
    ]);
  }

  const selectedRunId = treeRow?.kind === "run" || treeRow?.kind === "adhoc" ? treeRow.id : undefined;
  const selectedRun = state.runs.find((run) => run.runId === selectedRunId);
  if (selectedRun === undefined) {
    return joinDetailSections([{ rows: [row(untoned("No run selected."))] }]);
  }
  const sections = [...pipelineSections, ...selectedRunDetailRows(selectedRun)];
  if (state.steeringFeedback !== null) {
    sections.push({ rows: [row(untoned(state.steeringFeedback))] });
  }
  return joinDetailSections(sections);
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
