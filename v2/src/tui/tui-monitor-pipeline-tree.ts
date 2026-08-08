import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { isPipelineTerminal, type PipelineDerivedState } from "../daemon/pipeline-execution.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { formatElapsedWallClock } from "./tui-elapsed-format.ts";
import {
  buildWorkflowTableRows,
  type WorkflowTableRow,
  workflowGroupHasActiveMember,
  workflowRollupFinishedAtMs,
  workflowTableRowMembers,
} from "./tui-monitor-workflow-collapse.ts";
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
  startedAt: number | null;
  endedAt: number | null;
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

export type MonitorPipelineTreeAdHocNode = {
  kind: "adhoc";
  id: string;
  depth: 0;
  tableRow: WorkflowTableRow;
};

export type MonitorPipelineTreeDisplayNode =
  | MonitorPipelineTreePipelineNode
  | MonitorPipelineTreeStageNode
  | MonitorPipelineTreeRunNode
  | MonitorPipelineTreeAdHocNode;

export function monitorPipelineStageNodeId(pipelineId: string, stageId: string, branchKey: string): string {
  return `${pipelineId}:${stageId}:${branchKey}`;
}

export function stageBranchCellValue(branchKey: string): string {
  return branchKey === "default" ? "" : branchKey;
}

function joinPipelineTreeCells(columnValues: Partial<Record<TreeColumnId, string>>, leftPaneWidth: number): string {
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
  selectedNodeId: string | null,
  leftPaneWidth: number,
  nowMs: number,
): string {
  return joinPipelineTreeCells(
    {
      marker: node.id === selectedNodeId ? ">" : " ",
      label: node.snapshot.name,
      project: node.project,
      state: node.snapshot.state,
      // Mutation checkpoint: passing null for finishedAtMs on terminal pipelines must turn terminal freeze RED.
      elapsed: formatElapsedWallClock(node.snapshot.createdAt, node.snapshot.finishedAtMs, nowMs),
    },
    leftPaneWidth,
  );
}

export function buildStageMonitorTreeRow(
  node: MonitorPipelineTreeStageNode,
  selectedNodeId: string | null,
  leftPaneWidth: number,
  nowMs: number,
): string {
  return joinPipelineTreeCells(
    {
      marker: node.id === selectedNodeId ? ">" : " ",
      indent: "  ",
      label: node.stageId,
      branch: stageBranchCellValue(node.branchKey),
      state: node.status,
      // Mutation checkpoint: passing null for startedAt when unset must turn empty-stage-elapsed RED.
      elapsed: formatElapsedWallClock(node.startedAt, node.endedAt, nowMs),
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

function derivePipelineProject(snapshot: PipelineSnapshot, builderRuns: readonly DaemonListRunRow[]): string {
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
      const stageRuns = builderRuns.filter((run) => run.workflow?.invocationId === invocationId);
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
      startedAt: stage.startedAt,
      endedAt: stage.endedAt,
      runs: workflowTableRowsToRunNodes(1, tableRows),
    });
  }

  return stages;
}

function isAdHocCandidate(run: DaemonListRunRow, matchedInvocationIds: ReadonlySet<string>): boolean {
  const invocationId = run.workflow?.invocationId;
  if (invocationId === undefined) return true;
  // Mutation checkpoint: negating matchedInvocationIds exclusion must turn ad-hoc filtering RED.
  return !matchedInvocationIds.has(invocationId);
}

export function buildMonitorPipelineTreeJoin(
  snapshots: readonly PipelineSnapshot[],
  runs: readonly DaemonListRunRow[],
): {
  pipelineNodes: MonitorPipelineTreePipelineNode[];
  adHocNodes: MonitorPipelineTreeAdHocNode[];
  builderRuns: DaemonListRunRow[];
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

  const adHocCandidates = builderRuns.filter((run) => isAdHocCandidate(run, matchedInvocationIds));
  const adHocNodes = buildWorkflowTableRows(adHocCandidates, builderRuns, new Set()).map((tableRow) => ({
    kind: "adhoc" as const,
    id: monitorTreeRun(tableRow).runId,
    depth: 0 as const,
    tableRow,
  }));

  return { pipelineNodes, adHocNodes, builderRuns };
}

type TopLevelOrderKey = { rank: "running" | "gated" | "terminal"; createdAt: number; finishedAtMs: number | null };

const GATED_PIPELINE_STATE: PipelineDerivedState = "awaiting-approval";

function pipelineNodeOrderKey(node: MonitorPipelineTreePipelineNode): TopLevelOrderKey {
  const { state, createdAt, finishedAtMs } = node.snapshot;
  const rank = isPipelineTerminal(state) ? "terminal" : state === GATED_PIPELINE_STATE ? "gated" : "running";
  return { rank, createdAt, finishedAtMs };
}

const ORDER_RANK_WEIGHT: Record<TopLevelOrderKey["rank"], number> = { running: 0, gated: 1, terminal: 2 };

function compareTopLevelOrderKeys(a: TopLevelOrderKey, b: TopLevelOrderKey): number {
  if (a.rank !== b.rank) return ORDER_RANK_WEIGHT[a.rank] - ORDER_RANK_WEIGHT[b.rank];
  if (a.rank !== "terminal") return a.createdAt - b.createdAt;
  // Mutation checkpoint: swapping a/b here must turn newest-finish-first ordering RED.
  return (b.finishedAtMs ?? b.createdAt) - (a.finishedAtMs ?? a.createdAt);
}

function adHocNodeOrderKey(node: MonitorPipelineTreeAdHocNode): TopLevelOrderKey {
  const members = workflowTableRowMembers(node.tableRow);
  const rank = workflowGroupHasActiveMember(members) ? "running" : "terminal";
  return {
    rank,
    createdAt: Math.min(...members.map((run) => run.createdAt)),
    finishedAtMs: workflowRollupFinishedAtMs(members) ?? null,
  };
}

function orderTopLevelNodes(
  pipelineNodes: readonly MonitorPipelineTreePipelineNode[],
  adHocNodes: readonly MonitorPipelineTreeAdHocNode[],
): (MonitorPipelineTreePipelineNode | MonitorPipelineTreeAdHocNode)[] {
  return [
    ...pipelineNodes.map((node) => ({ node, key: pipelineNodeOrderKey(node) })),
    ...adHocNodes.map((node) => ({ node, key: adHocNodeOrderKey(node) })),
  ]
    .sort((left, right) => compareTopLevelOrderKeys(left.key, right.key))
    .map(({ node }) => node);
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

function stageRunsForExpansion(
  pipeline: MonitorPipelineTreePipelineNode,
  stage: MonitorPipelineTreeStageNode,
  builderRuns: readonly DaemonListRunRow[],
): MonitorPipelineTreeRunNode[] {
  const snapshotStage = pipeline.snapshot.stages.find(
    (candidate) => candidate.stageId === stage.stageId && candidate.branchKey === stage.branchKey,
  );
  const invocationId = snapshotStage?.workflowInvocationId;
  if (invocationId === null || invocationId === undefined) return stage.runs;

  const stageRuns = builderRuns.filter((run) => run.workflow?.invocationId === invocationId);
  const tableRows = buildWorkflowTableRows(stageRuns, builderRuns, new Set([invocationId]));
  return workflowTableRowsToRunNodes(stage.depth, tableRows);
}

function flattenPipelineNode(
  pipeline: MonitorPipelineTreePipelineNode,
  effectiveExpansion: ReadonlySet<string>,
  builderRuns: readonly DaemonListRunRow[],
): MonitorPipelineTreeDisplayNode[] {
  const nodes: MonitorPipelineTreeDisplayNode[] = [pipeline];

  if (!effectiveExpansion.has(pipeline.id)) {
    return nodes;
  }

  for (const stage of pipeline.stages) {
    nodes.push(stage);
    if (effectiveExpansion.has(stage.id)) {
      nodes.push(...stageRunsForExpansion(pipeline, stage, builderRuns));
    } else {
      nodes.push(...stage.runs);
    }
  }

  return nodes;
}

function resolveEffectiveExpansion(
  pipelineNodes: readonly MonitorPipelineTreePipelineNode[],
  expandedNodeIds: ReadonlySet<string>,
  selectedNodeId: string | null,
): Set<string> {
  return new Set([...expandedNodeIds, ...resolveSelectedAncestors(pipelineNodes, selectedNodeId)]);
}

export function isExpandablePipelineNodeId(
  pipelineNodes: readonly MonitorPipelineTreePipelineNode[],
  nodeId: string,
): boolean {
  for (const pipeline of pipelineNodes) {
    if (pipeline.id === nodeId) return true;
    for (const stage of pipeline.stages) {
      if (stage.id === nodeId) return true;
    }
  }
  return false;
}

export function flattenMonitorPipelineTree(
  pipelineNodes: readonly MonitorPipelineTreePipelineNode[],
  adHocNodes: readonly MonitorPipelineTreeAdHocNode[],
  expandedNodeIds: ReadonlySet<string>,
  selectedNodeId: string | null,
  builderRuns: readonly DaemonListRunRow[] = [],
): MonitorPipelineTreeDisplayNode[] {
  const effectiveExpansion = resolveEffectiveExpansion(pipelineNodes, expandedNodeIds, selectedNodeId);
  return orderTopLevelNodes(pipelineNodes, adHocNodes).flatMap((node) =>
    node.kind === "adhoc" ? [node] : flattenPipelineNode(node, effectiveExpansion, builderRuns),
  );
}

export function buildMonitorPipelineTree(
  snapshots: readonly PipelineSnapshot[],
  runs: readonly DaemonListRunRow[],
  expandedNodeIds: ReadonlySet<string>,
  selectedNodeId: string | null,
): MonitorPipelineTreeDisplayNode[] {
  const { pipelineNodes, adHocNodes, builderRuns } = buildMonitorPipelineTreeJoin(snapshots, runs);
  return flattenMonitorPipelineTree(pipelineNodes, adHocNodes, expandedNodeIds, selectedNodeId, builderRuns);
}
