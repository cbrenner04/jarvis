import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import {
  buildWorkflowTableRows,
  type WorkflowTableRow,
} from "./tui-monitor-workflow-collapse.ts";
import { filterMonitorRunsForLiveWindow } from "./tui-monitor-terminal-window.ts";
import {
  formatTreeCell,
  monitorTreeRun,
  TREE_COLUMN_WIDTHS,
  type TreeColumnId,
  visibleColumns,
} from "./tui-shell-layout.ts";

export type MonitorPipelineTreeRunNode = {
  kind: "run";
  id: string;
  depth: number;
  tableRow: WorkflowTableRow;
};

export type MonitorPipelineTreeStageNode = {
  kind: "stage";
  id: string;
  depth: number;
  stageId: string;
  branchKey: string;
  status: string;
  runs: MonitorPipelineTreeRunNode[];
};

export type MonitorPipelineTreePipelineNode = {
  kind: "pipeline";
  id: string;
  depth: number;
  snapshot: PipelineSnapshot;
  project: string;
  stages: MonitorPipelineTreeStageNode[];
};

export type MonitorPipelineTreeDisplayNode =
  | MonitorPipelineTreePipelineNode
  | MonitorPipelineTreeStageNode
  | MonitorPipelineTreeRunNode;

export function monitorPipelineStageNodeId(
  pipelineId: string,
  stageId: string,
  branchKey: string,
): string {
  return `${pipelineId}:${stageId}:${branchKey}`;
}

export function stageBranchCellValue(branchKey: string): string {
  return branchKey === "default" ? "" : branchKey;
}

function joinPipelineTreeCells(
  columnValues: Partial<Record<TreeColumnId, string>>,
  leftPaneWidth: number,
): string {
  return visibleColumns(leftPaneWidth)
    .map((column) => {
      const width = TREE_COLUMN_WIDTHS[column];
      // Mutation checkpoint: omitting width padding in joinPipelineTreeCells / formatTreeCell must turn width reservation RED.
      return formatTreeCell(columnValues[column] ?? "", width).padEnd(width, " ");
    })
    .join("");
}

export function buildPipelineMonitorTreeRow(
  node: MonitorPipelineTreePipelineNode,
  selectedRunId: string | null,
  leftPaneWidth: number,
): string {
  return joinPipelineTreeCells(
    {
      marker: node.id === selectedRunId ? ">" : " ",
      label: node.snapshot.name,
      project: node.project,
      state: node.snapshot.state,
    },
    leftPaneWidth,
  );
}

export function buildStageMonitorTreeRow(
  node: MonitorPipelineTreeStageNode,
  selectedRunId: string | null,
  leftPaneWidth: number,
): string {
  return joinPipelineTreeCells(
    {
      marker: node.id === selectedRunId ? ">" : " ",
      indent: "  ",
      label: node.stageId,
      branch: stageBranchCellValue(node.branchKey),
      state: node.status,
    },
    leftPaneWidth,
  );
}

function workflowTableRowsToRunNodes(
  stageDepth: number,
  tableRows: readonly WorkflowTableRow[],
): MonitorPipelineTreeRunNode[] {
  return tableRows.map((tableRow) => ({
    kind: "run" as const,
    id: monitorTreeRun(tableRow).runId,
    depth: tableRow.kind === "workflow-child" ? stageDepth + 2 : stageDepth + 1,
    tableRow,
  }));
}

function claimInvocationId(claimed: Set<string>, invocationId: string | null): invocationId is string {
  if (invocationId === null || claimed.has(invocationId)) return false;
  claimed.add(invocationId);
  return true;
}

function derivePipelineProject(
  snapshot: PipelineSnapshot,
  builderRuns: readonly DaemonListRunRow[],
): string {
  const claimedInvocationIds = new Set<string>();
  for (const stage of snapshot.stages) {
    const invocationId = stage.workflowInvocationId;
    if (!claimInvocationId(claimedInvocationIds, invocationId)) continue;
    const joinedRun = builderRuns.find((run) => run.workflow?.invocationId === invocationId);
    // Mutation checkpoint: skipping the joinedRun guard must turn pipeline project derivation RED.
    if (joinedRun !== undefined) return joinedRun.project;
  }
  return "";
}

function collectMatchedInvocationIds(snapshots: readonly PipelineSnapshot[]): Set<string> {
  const matched = new Set<string>();
  for (const snapshot of snapshots) {
    const claimedInPipeline = new Set<string>();
    for (const stage of snapshot.stages) {
      const invocationId = stage.workflowInvocationId;
      if (claimInvocationId(claimedInPipeline, invocationId)) {
        matched.add(invocationId);
      }
    }
  }
  return matched;
}

function buildStageNodes(
  snapshot: PipelineSnapshot,
  builderRuns: readonly DaemonListRunRow[],
): MonitorPipelineTreeStageNode[] {
  const claimedInPipeline = new Set<string>();
  const stages: MonitorPipelineTreeStageNode[] = [];

  for (const stage of snapshot.stages) {
    const invocationId = stage.workflowInvocationId;
    let tableRows: WorkflowTableRow[] = [];

    if (claimInvocationId(claimedInPipeline, invocationId)) {
      const stageRuns = builderRuns.filter(
        (run) => run.workflow?.invocationId === invocationId,
      );
      // Mutation checkpoint: negating the invocationId equality guard must turn stage join RED.
      tableRows = buildWorkflowTableRows(stageRuns, builderRuns, new Set());
    }

    stages.push({
      kind: "stage",
      id: monitorPipelineStageNodeId(snapshot.pipelineId, stage.stageId, stage.branchKey),
      depth: 1,
      stageId: stage.stageId,
      branchKey: stage.branchKey,
      status: stage.status,
      runs: workflowTableRowsToRunNodes(1, tableRows),
    });
  }

  return stages;
}

function isUnattributedCandidate(
  run: DaemonListRunRow,
  matchedInvocationIds: ReadonlySet<string>,
): boolean {
  const invocationId = run.workflow?.invocationId;
  if (invocationId === undefined) return true;
  // Mutation checkpoint: negating matchedInvocationIds exclusion must turn unattributed filtering RED.
  return !matchedInvocationIds.has(invocationId);
}

export function buildMonitorPipelineTreeJoin(
  snapshots: readonly PipelineSnapshot[],
  runs: readonly DaemonListRunRow[],
  options: { nowMs: number },
): {
  pipelineNodes: MonitorPipelineTreePipelineNode[];
  unattributedRows: WorkflowTableRow[];
} {
  const builderRuns = runs.filter((run) => run.status !== "queued");
  const matchedInvocationIds = collectMatchedInvocationIds(snapshots);

  const pipelineNodes = snapshots.map((snapshot) => ({
    kind: "pipeline" as const,
    id: snapshot.pipelineId,
    depth: 0,
    snapshot,
    project: derivePipelineProject(snapshot, builderRuns),
    stages: buildStageNodes(snapshot, builderRuns),
  }));

  const unattributedCandidates = builderRuns.filter((run) =>
    isUnattributedCandidate(run, matchedInvocationIds),
  );
  const windowedUnattributed = filterMonitorRunsForLiveWindow(unattributedCandidates, {
    nowMs: options.nowMs,
  });
  const unattributedRows = buildWorkflowTableRows(windowedUnattributed, builderRuns, new Set());

  return { pipelineNodes, unattributedRows };
}

function isTerminalPipelineNode(pipeline: MonitorPipelineTreePipelineNode): boolean {
  return pipeline.snapshot.finishedAtMs !== null;
}

function orderPipelineNodes(
  pipelineNodes: readonly MonitorPipelineTreePipelineNode[],
): MonitorPipelineTreePipelineNode[] {
  return [...pipelineNodes].sort((left, right) => {
    const leftTerminal = isTerminalPipelineNode(left);
    const rightTerminal = isTerminalPipelineNode(right);
    if (leftTerminal !== rightTerminal) return leftTerminal ? 1 : -1;
    if (!leftTerminal) return left.snapshot.createdAt - right.snapshot.createdAt;
    return (left.snapshot.finishedAtMs ?? 0) - (right.snapshot.finishedAtMs ?? 0);
  });
}

function resolveSelectedAncestors(
  pipelineNodes: readonly MonitorPipelineTreePipelineNode[],
  selectedNodeId: string | null,
): Set<string> {
  if (selectedNodeId === null) return new Set();

  for (const pipeline of pipelineNodes) {
    if (pipeline.id === selectedNodeId) return new Set();

    for (const stage of pipeline.stages) {
      if (stage.id === selectedNodeId) {
        return new Set([pipeline.id]);
      }

      for (const run of stage.runs) {
        if (run.id === selectedNodeId) {
          return new Set([pipeline.id, stage.id]);
        }
      }
    }
  }

  return new Set();
}

function flattenPipelineNode(
  pipeline: MonitorPipelineTreePipelineNode,
  effectiveExpansion: ReadonlySet<string>,
): MonitorPipelineTreeDisplayNode[] {
  const nodes: MonitorPipelineTreeDisplayNode[] = [pipeline];

  if (!effectiveExpansion.has(pipeline.id)) {
    return nodes;
  }

  for (const stage of pipeline.stages) {
    nodes.push(stage);
    if (effectiveExpansion.has(stage.id)) {
      nodes.push(...stage.runs);
    }
  }

  return nodes;
}

function dropOldestTerminalPipeline(
  orderedPipelines: MonitorPipelineTreePipelineNode[],
): MonitorPipelineTreePipelineNode[] | null {
  const terminalIndex = orderedPipelines.findIndex(isTerminalPipelineNode);
  if (terminalIndex === -1) return null;

  const dropped = orderedPipelines[terminalIndex];
  // Mutation checkpoint: dropping a non-terminal pipeline during FIFO trimming must turn active retention RED.
  if (!isTerminalPipelineNode(dropped!)) return null;

  return [
    ...orderedPipelines.slice(0, terminalIndex),
    ...orderedPipelines.slice(terminalIndex + 1),
  ];
}

export function flattenMonitorPipelineTree(
  pipelineNodes: readonly MonitorPipelineTreePipelineNode[],
  expandedNodeIds: ReadonlySet<string>,
  selectedNodeId: string | null,
  maxVisibleRows: number,
): MonitorPipelineTreeDisplayNode[] {
  const effectiveExpansion = new Set([
    ...expandedNodeIds,
    ...resolveSelectedAncestors(pipelineNodes, selectedNodeId),
  ]);
  let orderedPipelines = orderPipelineNodes(pipelineNodes);

  while (true) {
    const displayNodes = orderedPipelines.flatMap((pipeline) =>
      flattenPipelineNode(pipeline, effectiveExpansion),
    );
    if (displayNodes.length <= maxVisibleRows) {
      return displayNodes;
    }

    const trimmed = dropOldestTerminalPipeline(orderedPipelines);
    if (trimmed === null) {
      return displayNodes;
    }

    orderedPipelines = trimmed;
  }
}

export function buildMonitorPipelineTree(
  snapshots: readonly PipelineSnapshot[],
  runs: readonly DaemonListRunRow[],
  expandedNodeIds: ReadonlySet<string>,
  selectedNodeId: string | null,
  maxVisibleRows: number,
  options: { nowMs: number },
): {
  displayNodes: MonitorPipelineTreeDisplayNode[];
  unattributedRows: WorkflowTableRow[];
} {
  const { pipelineNodes, unattributedRows } = buildMonitorPipelineTreeJoin(snapshots, runs, options);
  return {
    displayNodes: flattenMonitorPipelineTree(
      pipelineNodes,
      expandedNodeIds,
      selectedNodeId,
      maxVisibleRows,
    ),
    unattributedRows,
  };
}
