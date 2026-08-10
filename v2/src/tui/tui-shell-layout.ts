import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { MonitorLineRow, MonitorSegment, MonitorSegmentTone } from "./tui-monitor-lines.ts";
import {
  type WorkflowTableRow,
  workflowCollapsedContextSuffix,
  workflowRoleLabel,
} from "./tui-monitor-workflow-collapse.ts";

export const MONITOR_TREE_NOT_LIVE_LABEL = "idle";

const SHORT_MONITOR_ID_LENGTH = 8;

export function shortMonitorId(id: string): string {
  return id.slice(0, SHORT_MONITOR_ID_LENGTH);
}

export type LayoutMode = "stacked" | "split";

export type ShellLayout = {
  layoutMode: LayoutMode;
  leftWidth: number;
  rightWidth: number;
  paneHeight: number;
  dockHeight: number;
};

const STACKED_THRESHOLD = 120;
const LEFT_FLOOR = 72;
const LEFT_BASE_FRACTION = 0.38;
const LEFT_CEILING_FRACTION = 0.4;
const DOCK_HEIGHT = 4;
const NUDGE_DELTA = 2;

function baseLeftWidth(columns: number): number {
  return Math.ceil(columns * LEFT_BASE_FRACTION);
}

function clampLeftWidth(columns: number, dividerOffset: number): number {
  return Math.max(
    LEFT_FLOOR,
    Math.min(Math.floor(columns * LEFT_CEILING_FRACTION), baseLeftWidth(columns) + dividerOffset),
  );
}

export function computeShellLayout(columns: number, rows: number, dividerOffset: number): ShellLayout {
  const leftWidth = clampLeftWidth(columns, dividerOffset);
  return {
    layoutMode: columns < STACKED_THRESHOLD ? "stacked" : "split",
    leftWidth,
    rightWidth: columns - leftWidth,
    paneHeight: rows - DOCK_HEIGHT,
    dockHeight: DOCK_HEIGHT,
  };
}

export function nudgeDividerOffset(columns: number, dividerOffset: number, direction: "[" | "]"): number {
  const delta = direction === "[" ? -NUDGE_DELTA : NUDGE_DELTA;
  return clampLeftWidth(columns, dividerOffset + delta) - baseLeftWidth(columns);
}

export function monitorTreeRun(tableRow: WorkflowTableRow): DaemonListRunRow {
  switch (tableRow.kind) {
    case "standalone":
    case "workflow-child":
      return tableRow.run;
    case "workflow-collapsed":
      return tableRow.representative;
  }
}

function runRowLabelHead(run: DaemonListRunRow): string {
  return `${workflowRoleLabel(run)} ${shortMonitorId(run.runId)}`;
}

/** Role-first run label; workflow-collapsed rows keep their step-context suffix. */
export function runRowLabel(tableRow: WorkflowTableRow): string {
  const head = runRowLabelHead(monitorTreeRun(tableRow));
  if (tableRow.kind !== "workflow-collapsed") return head;
  return `${head}${workflowCollapsedContextSuffix(tableRow.members)}`;
}

// ---- Display-width row composition ----
//
// Every work-tree row composes as `indent · marker · fill label · right-aligned cluster`.
// Indent is `2 * depth` columns, marker is one column plus one gap, the label fills every
// remaining column up to the cluster, and the cluster right-aligns to the pane edge. Below
// a row's supported floor, composition falls back to one clipped, unpadded line.

/** Minimum label columns a row must retain at or above its supported floor. */
export const MIN_LABEL_COLUMNS = 4;

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const ELLIPSIS = "…";
const ROW_GAP = " ";
const EMPTY_STATUS_PLACEHOLDER = "—";

function graphemes(text: string): string[] {
  return Array.from(GRAPHEME_SEGMENTER.segment(text), ({ segment }) => segment);
}

function displayWidth(text: string): number {
  return Bun.stringWidth(text);
}

function clipToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  let result = "";
  let used = 0;
  for (const grapheme of graphemes(text)) {
    const graphemeWidth = displayWidth(grapheme);
    // Mutation checkpoint: letting a grapheme overshoot width here must turn grapheme-safe clipping RED.
    if (used + graphemeWidth > width) break;
    result += grapheme;
    used += graphemeWidth;
  }
  return result;
}

/** Ellipsize at a grapheme boundary (when needed) and pad to exactly `width` display columns. */
function fillLabel(text: string, width: number): string {
  const textWidth = displayWidth(text);
  if (textWidth <= width) return text + " ".repeat(width - textWidth);
  const ellipsisWidth = displayWidth(ELLIPSIS);
  const truncated = clipToWidth(text, Math.max(0, width - ellipsisWidth));
  const content = `${truncated}${ELLIPSIS}`;
  return content + " ".repeat(Math.max(0, width - displayWidth(content)));
}

function compactStatusText(status: string): string {
  return status.length > 0 ? status : EMPTY_STATUS_PLACEHOLDER;
}

export type MonitorRowClusterAtom = {
  text: string;
  droppable: boolean;
  tone?: MonitorSegmentTone;
};

type MonitorRowSpec = {
  depth: number;
  marker: string;
  label: string;
  compactStatus: string;
  compactStatusTone?: MonitorSegmentTone;
  clusterAtoms: readonly MonitorRowClusterAtom[];
};

function hierarchyColumns(depth: number): number {
  return 2 * depth + 2;
}

/** Row-specific supported-width floor: hierarchy, label/cluster gap, compact status, minimum label. */
export function monitorRowFloor(depth: number, compactStatus: string): number {
  return hierarchyColumns(depth) + 1 + displayWidth(compactStatusText(compactStatus)) + MIN_LABEL_COLUMNS;
}

function clusterWidth(atoms: readonly MonitorRowClusterAtom[]): number {
  if (atoms.length === 0) return 0;
  return atoms.reduce((sum, atom) => sum + displayWidth(atom.text), 0) + (atoms.length - 1);
}

function clusterFits(atoms: readonly MonitorRowClusterAtom[], depth: number, paneWidth: number): boolean {
  const gap = atoms.length > 0 ? 1 : 0;
  // Mutation checkpoint: omitting MIN_LABEL_COLUMNS from the fit budget here must turn full-cluster-fit RED.
  return hierarchyColumns(depth) + gap + clusterWidth(atoms) + MIN_LABEL_COLUMNS <= paneWidth;
}

/** Drop the rightmost droppable atom, skipping non-droppable atoms; null when none remain droppable. */
function dropRightmostDroppable(atoms: readonly MonitorRowClusterAtom[]): MonitorRowClusterAtom[] | null {
  for (let index = atoms.length - 1; index >= 0; index -= 1) {
    // Mutation checkpoint: dropping a non-droppable atom here must turn compact-status retention RED.
    if (atoms[index]?.droppable) return [...atoms.slice(0, index), ...atoms.slice(index + 1)];
  }
  return null;
}

function degradeCluster(
  fullAtoms: readonly MonitorRowClusterAtom[],
  compactAtom: MonitorRowClusterAtom,
  depth: number,
  paneWidth: number,
): MonitorRowClusterAtom[] {
  // Mutation checkpoint: keeping empty atoms here must turn empty-atom elision RED.
  let atoms = fullAtoms.filter((atom) => atom.text.length > 0);
  while (atoms.length > 0 && !clusterFits(atoms, depth, paneWidth)) {
    const dropped = dropRightmostDroppable(atoms);
    if (dropped === null) break;
    atoms = dropped;
  }
  // Mutation checkpoint: skipping the compact-status fallback here must turn cluster-exhaustion fallback RED.
  if (atoms.length === 0 || !clusterFits(atoms, depth, paneWidth)) return [compactAtom];
  return atoms;
}

function interleaveClusterSegments(atoms: readonly MonitorRowClusterAtom[]): MonitorSegment[] {
  const segments: MonitorSegment[] = [];
  atoms.forEach((atom, index) => {
    if (index > 0) segments.push({ text: ROW_GAP });
    segments.push(atom.tone === undefined ? { text: atom.text } : { text: atom.text, tone: atom.tone });
  });
  return segments;
}

function clippedRowLine(spec: MonitorRowSpec, paneWidth: number): MonitorLineRow {
  const indent = "  ".repeat(spec.depth);
  const marker = spec.marker.length > 0 ? spec.marker : " ";
  const naive = `${indent}${marker}${ROW_GAP}${spec.label}${ROW_GAP}${spec.compactStatus}`;
  // Mutation checkpoint: returning the unclipped naive line here must turn below-floor clipping RED.
  return { segments: [{ text: clipToWidth(naive, paneWidth) }] };
}

/** Compose indent · marker · fill label · right-aligned cluster, or a clipped line below the row's floor. */
function composeMonitorRow(spec: MonitorRowSpec, paneWidth: number): MonitorLineRow {
  // Mutation checkpoint: comparing against the wrong floor here must turn below-floor clipping RED.
  if (paneWidth < monitorRowFloor(spec.depth, spec.compactStatus)) {
    return clippedRowLine(spec, paneWidth);
  }

  const compactAtom: MonitorRowClusterAtom = {
    text: spec.compactStatus,
    droppable: false,
    ...(spec.compactStatusTone === undefined ? {} : { tone: spec.compactStatusTone }),
  };
  const atoms = degradeCluster(spec.clusterAtoms, compactAtom, spec.depth, paneWidth);
  const labelWidth = paneWidth - hierarchyColumns(spec.depth) - 1 - clusterWidth(atoms);
  const label = fillLabel(spec.label, labelWidth);
  const marker = spec.marker.length > 0 ? spec.marker : " ";

  return {
    segments: [
      { text: "  ".repeat(spec.depth) },
      { text: marker },
      { text: ROW_GAP },
      { text: label },
      { text: ROW_GAP },
      ...interleaveClusterSegments(atoms),
    ],
  };
}

/** Pipeline row: fill label, cluster `definition, attention, elapsed`, compact status is pipeline state. */
export function composePipelineRow(
  input: {
    depth: number;
    marker: string;
    label: string;
    definition: string;
    attention: string;
    elapsed: string;
    status: string;
  },
  paneWidth: number,
): MonitorLineRow {
  return composeMonitorRow(
    {
      depth: input.depth,
      marker: input.marker,
      label: input.label,
      compactStatus: compactStatusText(input.status),
      clusterAtoms: [
        { text: input.definition, droppable: true },
        { text: input.attention, droppable: true },
        { text: input.elapsed, droppable: true },
      ],
    },
    paneWidth,
  );
}

/** Branch row: fill label, cluster `current stage, status, elapsed`; status never drops. */
export function composeBranchRow(
  input: { depth: number; marker: string; label: string; currentStage: string; status: string; elapsed: string },
  paneWidth: number,
): MonitorLineRow {
  return composeMonitorRow(
    {
      depth: input.depth,
      marker: input.marker,
      label: input.label,
      compactStatus: compactStatusText(input.status),
      clusterAtoms: [
        { text: input.currentStage, droppable: true },
        { text: input.status, droppable: false },
        { text: input.elapsed, droppable: true },
      ],
    },
    paneWidth,
  );
}

/** Stage row: fill label, cluster `status, elapsed`; status never drops. */
export function composeStageRow(
  input: { depth: number; marker: string; label: string; status: string; elapsed: string },
  paneWidth: number,
): MonitorLineRow {
  return composeMonitorRow(
    {
      depth: input.depth,
      marker: input.marker,
      label: input.label,
      compactStatus: compactStatusText(input.status),
      clusterAtoms: [
        { text: input.status, droppable: false },
        { text: input.elapsed, droppable: true },
      ],
    },
    paneWidth,
  );
}

/** Run row: fill label, cluster `status, live, elapsed`; status never drops. Ad-hoc rows reuse this shape. */
export function composeRunRow(
  input: {
    depth: number;
    label: string;
    status: string;
    statusTone?: MonitorSegmentTone;
    live: string;
    liveTone?: MonitorSegmentTone;
    elapsed: string;
  },
  paneWidth: number,
): MonitorLineRow {
  return composeMonitorRow(
    {
      depth: input.depth,
      marker: "",
      label: input.label,
      compactStatus: compactStatusText(input.status),
      ...(input.statusTone === undefined ? {} : { compactStatusTone: input.statusTone }),
      clusterAtoms: [
        { text: input.status, droppable: false, ...(input.statusTone === undefined ? {} : { tone: input.statusTone }) },
        { text: input.live, droppable: true, ...(input.liveTone === undefined ? {} : { tone: input.liveTone }) },
        { text: input.elapsed, droppable: true },
      ],
    },
    paneWidth,
  );
}
