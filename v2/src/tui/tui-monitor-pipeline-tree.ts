import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { isPipelineTerminal, type PipelineDerivedState } from "../daemon/pipeline-execution.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
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
  label: string;
  branchKey: string;
  status: string;
  startedAt: number | null;
  endedAt: number | null;
  runs: MonitorPipelineTreeRunNode[];
};

export type MonitorPipelineTreeBranchNode = {
  kind: "branch";
  id: string;
  depth: 1;
  pipelineId: string;
  branchKey: string;
  label: string;
  summaryStageId: string;
  summaryStatus: string;
  stages: MonitorPipelineTreeStageNode[];
};

export type MonitorPipelineTreePipelineNode = {
  kind: "pipeline";
  id: string;
  depth: number;
  snapshot: PipelineSnapshot;
  project: string;
  stages: MonitorPipelineTreeStageNode[];
  branches: MonitorPipelineTreeBranchNode[];
};

export type MonitorPipelineTreeAdHocNode = {
  kind: "adhoc";
  id: string;
  depth: 0;
  tableRow: WorkflowTableRow;
};

export type MonitorPipelineTreeDisplayNode =
  | MonitorPipelineTreePipelineNode
  | MonitorPipelineTreeBranchNode
  | MonitorPipelineTreeStageNode
  | MonitorPipelineTreeRunNode
  | MonitorPipelineTreeAdHocNode;

const MONITOR_TREE_DEFAULT_BRANCH_KEY = "default";

export function monitorPipelineStageNodeId(pipelineId: string, stageId: string, branchKey: string): string {
  return `${pipelineId}:${stageId}:${branchKey}`;
}

export function monitorPipelineBranchNodeId(pipelineId: string, branchKey: string): string {
  return `${pipelineId}:${branchKey}`;
}

export function stageBranchCellValue(branchKey: string): string {
  return branchKey === MONITOR_TREE_DEFAULT_BRANCH_KEY ? "" : branchKey;
}

/** Lowest position carrying a non-default branchKey, or null when the pipeline never fanned out. */
function fanOutSplitPosition(snapshot: PipelineSnapshot): number | null {
  const branchedPositions = snapshot.stages
    .filter((stage) => stage.branchKey !== MONITOR_TREE_DEFAULT_BRANCH_KEY)
    .map((stage) => stage.position);
  // Mutation checkpoint: reporting no fan-out here must turn branch-grouping keystone RED.
  return branchedPositions.length === 0 ? null : Math.min(...branchedPositions);
}

/** A post-split `default` record is a placeholder every branch superseded; never rendered. */
function isElidedPlaceholderStage(stage: PipelineSnapshot["stages"][number], splitPosition: number | null): boolean {
  if (splitPosition === null) return false;
  // Mutation checkpoint: eliding nothing here must turn placeholder-elision RED.
  return stage.position >= splitPosition && stage.branchKey === MONITOR_TREE_DEFAULT_BRANCH_KEY;
}

/** stageId -> declared kind from the pipeline's registry definition; empty when the name is unregistered. */
function resolveStageKinds(name: string): Map<string, string> {
  const resolved = getPipelineDefinition(name);
  if (!resolved.ok) return new Map();
  return new Map(resolved.definition.stages.map((stage) => [stage.stageId, stage.kind]));
}

/** An approval-gate record elides once decided or bypassed; only `awaiting`/`rejected` stay visible. */
function isElidedGateStage(kind: string | undefined, status: string): boolean {
  if (kind !== "approval") return false;
  // Mutation checkpoint: eliding no gate here must turn gate elision RED.
  return status !== "awaiting" && status !== "rejected";
}

/** ` → N intents` when the artifact records a fan-out split, else empty. */
function intentYieldSuffix(artifact: unknown): string {
  const record = artifact as { downstreamInputs?: unknown } | null | undefined;
  const inputs = Array.isArray(record?.downstreamInputs) ? record.downstreamInputs : [];
  // Mutation checkpoint: suffixing artifact-less stages here must turn intent-yield-suffix RED.
  if (inputs.length === 0) return "";
  return ` → ${inputs.length} intents`;
}

/** Strip the longest leading `-`-segment run shared by every sibling; a lone or divergent key keeps its full text. */
export function strippedBranchLabels(branchKeys: readonly string[]): string[] {
  // Mutation checkpoint: stripping a lone branch with no sibling to share a prefix with must turn label-guard RED.
  if (branchKeys.length < 2) return [...branchKeys];
  const segmented = branchKeys.map((key) => key.split("-"));
  const cap = Math.min(...segmented.map((segments) => segments.length)) - 1;
  let sharedLength = 0;
  while (sharedLength < cap) {
    const candidate = segmented[0]?.[sharedLength];
    if (candidate === undefined || !segmented.every((segments) => segments[sharedLength] === candidate)) break;
    sharedLength += 1;
  }
  return segmented.map((segments) => segments.slice(sharedLength).join("-"));
}

const SATISFIED_BRANCH_STAGE_STATUSES = new Set(["succeeded", "approved", "skipped"]);

/** A branch summarizes as its first unsatisfied post-split stage, or its last stage once every stage settles. */
function deriveBranchSummary(records: readonly PipelineSnapshot["stages"][number][]): {
  stageId: string;
  status: string;
} {
  const unsatisfied = records.find((record) => !SATISFIED_BRANCH_STAGE_STATUSES.has(record.status));
  const target = unsatisfied ?? records[records.length - 1];
  return { stageId: target?.stageId ?? "", status: target?.status ?? "" };
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
      label: node.label,
      branch: stageBranchCellValue(node.branchKey),
      state: node.status,
      // Mutation checkpoint: passing null for startedAt when unset must turn empty-stage-elapsed RED.
      elapsed: formatElapsedWallClock(node.startedAt, node.endedAt, nowMs),
    },
    leftPaneWidth,
  );
}

export function buildBranchMonitorTreeRow(
  node: MonitorPipelineTreeBranchNode,
  selectedNodeId: string | null,
  leftPaneWidth: number,
): string {
  return joinPipelineTreeCells(
    {
      marker: node.id === selectedNodeId ? ">" : " ",
      indent: "  ",
      label: node.label,
      branch: node.summaryStageId,
      state: node.summaryStatus,
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
): { stages: MonitorPipelineTreeStageNode[]; branches: MonitorPipelineTreeBranchNode[] } {
  const splitPosition = fanOutSplitPosition(snapshot);
  const stageKinds = resolveStageKinds(snapshot.name);
  const claimedInPipeline = new Set<string>();
  const stages: MonitorPipelineTreeStageNode[] = [];
  const branchStagesByKey = new Map<string, MonitorPipelineTreeStageNode[]>();
  const branchRecordsByKey = new Map<string, PipelineSnapshot["stages"][number][]>();
  const branchKeyOrder: string[] = [];

  for (const stage of snapshot.stages) {
    if (isElidedPlaceholderStage(stage, splitPosition)) continue;
    if (isElidedGateStage(stageKinds.get(stage.stageId), stage.status)) continue;

    const isBranched = splitPosition !== null && stage.position >= splitPosition;
    const stageDepth = isBranched ? 2 : 1;
    const invocationId = stage.workflowInvocationId;
    let tableRows: WorkflowTableRow[] = [];

    if (claimInvocationId(claimedInPipeline, invocationId)) {
      const stageRuns = builderRuns.filter((run) => run.workflow?.invocationId === invocationId);
      // Mutation checkpoint: negating the invocationId equality guard must turn stage join RED.
      tableRows = buildWorkflowTableRows(stageRuns, builderRuns, new Set());
    }

    const stageNode: MonitorPipelineTreeStageNode = {
      kind: "stage",
      id: monitorPipelineStageNodeId(snapshot.pipelineId, stage.stageId, stage.branchKey),
      depth: stageDepth,
      stageId: stage.stageId,
      label: `${stage.stageId}${intentYieldSuffix(stage.artifact)}`,
      branchKey: stage.branchKey,
      status: stage.status,
      startedAt: stage.startedAt,
      endedAt: stage.endedAt,
      runs: workflowTableRowsToRunNodes(stageDepth, tableRows),
    };

    if (!isBranched) {
      stages.push(stageNode);
      continue;
    }

    if (!branchStagesByKey.has(stage.branchKey)) {
      branchStagesByKey.set(stage.branchKey, []);
      branchRecordsByKey.set(stage.branchKey, []);
      branchKeyOrder.push(stage.branchKey);
    }
    branchStagesByKey.get(stage.branchKey)?.push(stageNode);
    branchRecordsByKey.get(stage.branchKey)?.push(stage);
  }

  const strippedLabels = strippedBranchLabels(branchKeyOrder);
  const branches: MonitorPipelineTreeBranchNode[] = branchKeyOrder.map((branchKey, index) => {
    const summary = deriveBranchSummary(branchRecordsByKey.get(branchKey) ?? []);
    return {
      kind: "branch",
      id: monitorPipelineBranchNodeId(snapshot.pipelineId, branchKey),
      depth: 1,
      pipelineId: snapshot.pipelineId,
      branchKey,
      label: strippedLabels[index] ?? branchKey,
      summaryStageId: summary.stageId,
      summaryStatus: summary.status,
      stages: branchStagesByKey.get(branchKey) ?? [],
    };
  });

  return { stages, branches };
}

/** Pre-split stages followed by each branch's post-split stages, in position order. */
export function pipelineStageNodes(pipeline: MonitorPipelineTreePipelineNode): MonitorPipelineTreeStageNode[] {
  return [...pipeline.stages, ...pipeline.branches.flatMap((branch) => branch.stages)];
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
    ...buildStageNodes(snapshot, builderRuns),
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

function resolveBranchAncestors(
  pipeline: MonitorPipelineTreePipelineNode,
  selectedNodeId: string,
): Set<string> | undefined {
  for (const branch of pipeline.branches) {
    if (branch.id === selectedNodeId) return new Set([pipeline.id]);

    for (const stage of branch.stages) {
      if (stage.id === selectedNodeId) {
        return new Set([pipeline.id, branch.id]);
      }

      for (const run of stage.runs) {
        // Mutation checkpoint: dropping the branch from these ancestors must turn reveal-under-branch RED.
        if (run.id === selectedNodeId) return new Set([pipeline.id, branch.id, stage.id]);
      }
    }
  }

  return undefined;
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

    const branchAncestors = resolveBranchAncestors(pipeline, selectedNodeId);
    if (branchAncestors !== undefined) return branchAncestors;
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

function pushStageWithRuns(
  nodes: MonitorPipelineTreeDisplayNode[],
  pipeline: MonitorPipelineTreePipelineNode,
  stage: MonitorPipelineTreeStageNode,
  effectiveExpansion: ReadonlySet<string>,
  builderRuns: readonly DaemonListRunRow[],
): void {
  nodes.push(stage);
  if (effectiveExpansion.has(stage.id)) {
    nodes.push(...stageRunsForExpansion(pipeline, stage, builderRuns));
  } else {
    nodes.push(...stage.runs);
  }
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
    pushStageWithRuns(nodes, pipeline, stage, effectiveExpansion, builderRuns);
  }

  for (const branch of pipeline.branches) {
    nodes.push(branch);
    if (!effectiveExpansion.has(branch.id)) continue;
    for (const stage of branch.stages) {
      pushStageWithRuns(nodes, pipeline, stage, effectiveExpansion, builderRuns);
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
    for (const stage of pipelineStageNodes(pipeline)) {
      if (stage.id === nodeId) return true;
    }
    for (const branch of pipeline.branches) {
      if (branch.id === nodeId) return true;
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
