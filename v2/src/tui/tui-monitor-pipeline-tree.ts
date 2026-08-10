import { basename } from "node:path";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { isPipelineTerminal, type PipelineDerivedState } from "../daemon/pipeline-execution.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { formatAggregateTiming, formatElapsedWallClock } from "./tui-elapsed-format.ts";
import type { MonitorLineRow } from "./tui-monitor-lines.ts";
import {
  buildWorkflowTableRows,
  type WorkflowTableRow,
  workflowGroupHasActiveMember,
  workflowRollupFinishedAtMs,
  workflowTableRowMembers,
} from "./tui-monitor-workflow-collapse.ts";
import {
  composeBranchRow,
  composePipelineRow,
  composeStageRow,
  monitorTreeRun,
  shortMonitorId,
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
  /** Structural: nonempty `runs`. Set on flattened display nodes; absent on join-time nodes. */
  expandable?: boolean;
  /** `▼`/`▶` when expandable, blank otherwise. Set on flattened display nodes. */
  marker?: string;
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
  records: PipelineSnapshot["stages"];
  attributedRuns: DaemonListRunRow[];
  /** Earliest non-null `startedAt` among displayable stages, or null when none started. */
  startedAt: number | null;
  /** Latest `endedAt` once every displayable stage ended, else null (still running). */
  endedAt: number | null;
  expandable?: boolean;
  marker?: string;
};

export type MonitorPipelineTreePipelineNode = {
  kind: "pipeline";
  id: string;
  depth: number;
  snapshot: PipelineSnapshot;
  project: string;
  stages: MonitorPipelineTreeStageNode[];
  branches: MonitorPipelineTreeBranchNode[];
  attributedRuns: DaemonListRunRow[];
  expandable?: boolean;
  marker?: string;
  /** `✋<n> ✗<n>` from this pipeline's own displayable records; empty atoms/separators omitted. */
  attention?: string;
};

export type MonitorPipelineTreeAdHocNode = {
  kind: "adhoc";
  id: string;
  depth: 0;
  tableRow: WorkflowTableRow;
  label: string;
};

export type MonitorPipelineTreeDisplayNode =
  | MonitorPipelineTreePipelineNode
  | MonitorPipelineTreeBranchNode
  | MonitorPipelineTreeStageNode
  | MonitorPipelineTreeRunNode
  | MonitorPipelineTreeAdHocNode;

export type PipelineStageRollupGroup = {
  branchKey: string | null;
  records: readonly PipelineSnapshot["stages"][number][];
};

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

export function pipelineStageRollupGroups(snapshot: PipelineSnapshot): PipelineStageRollupGroup[] {
  const split = fanOutSplitPosition(snapshot);
  const preSplitRecords: PipelineSnapshot["stages"][number][] = [];
  const branchRecordsByKey = new Map<string, PipelineSnapshot["stages"][number][]>();
  const branchKeyOrder: string[] = [];

  for (const stage of snapshot.stages) {
    if (isElidedPlaceholderStage(stage, split)) continue;
    const branched = split !== null && stage.position >= split;
    if (!branched) {
      preSplitRecords.push(stage);
      continue;
    }
    if (!branchRecordsByKey.has(stage.branchKey)) {
      branchRecordsByKey.set(stage.branchKey, []);
      branchKeyOrder.push(stage.branchKey);
    }
    branchRecordsByKey.get(stage.branchKey)?.push(stage);
  }

  return [
    ...(preSplitRecords.length === 0 ? [] : [{ branchKey: null, records: preSplitRecords }]),
    ...branchKeyOrder.map((branchKey) => ({ branchKey, records: branchRecordsByKey.get(branchKey) ?? [] })),
  ];
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

/** `✋<n> ✗<n>` from this pipeline's own displayable stage records; empty atoms and separators omitted. */
export function pipelineAttentionSummary(pipeline: MonitorPipelineTreePipelineNode): string {
  const stageKinds = resolveStageKinds(pipeline.snapshot.name);
  const records = pipelineStageNodes(pipeline);
  const gateCount = records.filter((record) => stageKinds.get(record.stageId) === "approval").length;
  const failedCount = records.filter((record) => record.status === "failed").length;
  const atoms: string[] = [];
  // Mutation checkpoint: counting a zero gate here must turn attention gate-count RED.
  if (gateCount > 0) atoms.push(`✋${gateCount}`);
  // Mutation checkpoint: counting a zero failed count here must turn attention failed-count RED.
  if (failedCount > 0) atoms.push(`✗${failedCount}`);
  return atoms.join(" ");
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

/** Earliest displayable-stage start and, once every displayable stage ended, the latest end. */
function branchElapsedBounds(stages: readonly MonitorPipelineTreeStageNode[]): {
  startedAt: number | null;
  endedAt: number | null;
} {
  const starts = stages.map((stage) => stage.startedAt).filter((value): value is number => value !== null);
  const startedAt = starts.length === 0 ? null : Math.min(...starts);
  const allEnded = stages.length > 0 && stages.every((stage) => stage.endedAt !== null);
  // Mutation checkpoint: freezing before every displayable stage has ended must turn branch-elapsed freeze RED.
  const endedAt = allEnded ? Math.max(...stages.map((stage) => stage.endedAt as number)) : null;
  return { startedAt, endedAt };
}

type AggregateTiming = {
  workMs: number;
  lastActivityMs: number | null;
};

function latestActivity(activity: readonly number[]): number | null {
  return activity.length === 0 ? null : Math.max(...activity);
}

export type WorkIdleTiming = {
  workMs: number;
  idleMs: number | null;
};

function stageWorkMs(stage: PipelineSnapshot["stages"][number], nowMs: number): number {
  if (stage.startedAt === null) return 0;
  const endMs = stage.endedAt ?? (stage.status === "running" ? nowMs : stage.startedAt);
  if (Number.isNaN(stage.startedAt) || !Number.isFinite(endMs)) return 0;
  if (stage.startedAt > nowMs || endMs > nowMs) return 0;
  return Math.max(0, endMs - stage.startedAt);
}

function aggregateTiming(
  stages: readonly PipelineSnapshot["stages"][number][],
  members: readonly DaemonListRunRow[],
  nowMs: number,
): AggregateTiming {
  const activity: number[] = [];
  for (const stage of stages) {
    if (stage.startedAt !== null) activity.push(stage.startedAt);
    if (stage.endedAt !== null) activity.push(stage.endedAt);
    if (stage.decidedAt !== null) activity.push(stage.decidedAt);
  }
  for (const member of members) {
    if (member.finishedAtMs !== undefined) activity.push(member.finishedAtMs);
  }
  return {
    workMs: stages.reduce((sum, stage) => sum + stageWorkMs(stage, nowMs), 0),
    lastActivityMs: latestActivity(activity.filter(Number.isFinite)),
  };
}

/** `hidesIdle` reflects active execution: the pipeline's own derived state, or any branch member record. */
function workIdleTiming(hidesIdle: boolean, timing: AggregateTiming, nowMs: number): WorkIdleTiming {
  const work = { workMs: timing.workMs, idleMs: null };
  if (hidesIdle) return work;
  if (timing.lastActivityMs === null) return work;
  const idleMs = Math.max(0, nowMs - timing.lastActivityMs);
  return { workMs: timing.workMs, idleMs };
}

export function pipelineWorkIdleTiming(node: MonitorPipelineTreePipelineNode, nowMs: number): WorkIdleTiming {
  return workIdleTiming(
    node.snapshot.state === "running",
    aggregateTiming(node.snapshot.stages, node.attributedRuns, nowMs),
    nowMs,
  );
}

/** A branch hides idle when any of its member records — not just its summary record — is actively running. */
function branchHasActiveRecord(records: readonly PipelineSnapshot["stages"][number][]): boolean {
  return records.some((record) => record.status === "running");
}

export function branchWorkIdleTiming(node: MonitorPipelineTreeBranchNode, nowMs: number): WorkIdleTiming {
  return workIdleTiming(
    branchHasActiveRecord(node.records),
    aggregateTiming(node.records, node.attributedRuns, nowMs),
    nowMs,
  );
}

/** Runs attributed to any of these stages' workflow invocations. */
function attributedRunsForStages(
  stages: readonly PipelineSnapshot["stages"][number][],
  builderRuns: readonly DaemonListRunRow[],
): DaemonListRunRow[] {
  const invocationIds = new Set(
    stages.flatMap((stage) => (stage.workflowInvocationId === null ? [] : [stage.workflowInvocationId])),
  );
  return builderRuns.filter((run) => run.workflow !== undefined && invocationIds.has(run.workflow.invocationId));
}

/**
 * Right-aligned to its column when it fits. Non-compact overflow right-clips (costs at most a label
 * character). Compact overflow instead keeps the full work value and elides idle to `w<work>/i…`,
 * left-aligned so it never collides with the running form's right-aligned plain `w<work>`.
 */
function formatTreeTiming(timing: WorkIdleTiming, compact: boolean): string {
  const width = compact ? 8 : 20;
  const formatted = formatAggregateTiming(timing.workMs, timing.idleMs, compact);
  if (formatted.length <= width) return formatted.padStart(width);
  if (!compact) return formatted.slice(formatted.length - width);
  const work = formatAggregateTiming(timing.workMs, null, compact);
  const elided = `${work}/i…`;
  return elided.length > width ? work.padEnd(width) : elided.padEnd(width);
}

function formatPipelineTreeTiming(node: MonitorPipelineTreePipelineNode & { compact: boolean }, nowMs: number): string {
  return formatTreeTiming(pipelineWorkIdleTiming(node, nowMs), node.compact);
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

/** Seed basename sans extension, or `<name> <short pipelineId>` when no seed path was recorded. */
export function pipelineRowLabel(snapshot: PipelineSnapshot): string {
  const slug = basename(snapshot.seedPath ?? "").replace(/\.[^.]+$/, "");
  if (slug.length > 0) return slug;
  return `${snapshot.name} ${shortMonitorId(snapshot.pipelineId)}`;
}

export function buildPipelineMonitorTreeRow(
  pipeline: MonitorPipelineTreePipelineNode,
  width: number,
  nowMs: number,
): MonitorLineRow {
  const compact = width < 100;
  const node = { ...pipeline, compact };
  return composePipelineRow(
    {
      depth: node.depth,
      marker: node.marker ?? "",
      label: pipelineRowLabel(node.snapshot),
      definition: node.snapshot.name,
      attention: node.attention ?? "",
      elapsed: formatPipelineTreeTiming(node, nowMs),
      status: node.snapshot.state,
    },
    width,
  );
}

/** Shared stage elapsed projection: a terminal failure with no start renders `failed before start`; else wall-clock. */
export function stageElapsedLabel(
  stage: { status: string; startedAt: number | null; endedAt: number | null },
  nowMs: number,
): string {
  if (stage.status === "failed" && stage.startedAt === null) return "failed before start";
  return formatElapsedWallClock(stage.startedAt, stage.endedAt, nowMs);
}

/** Tree-only: the compact eight-character timing cell abbreviates failed-before-start as `failed!`. */
function stageTreeElapsedLabel(
  stage: { status: string; startedAt: number | null; endedAt: number | null },
  nowMs: number,
  compact: boolean,
): string {
  if (stage.status === "failed" && stage.startedAt === null) return compact ? "failed!" : "failed before start";
  return stageElapsedLabel(stage, nowMs);
}

export function buildStageMonitorTreeRow(
  node: MonitorPipelineTreeStageNode,
  leftPaneWidth: number,
  nowMs: number,
): MonitorLineRow {
  const compact = leftPaneWidth < 100;
  return composeStageRow(
    {
      depth: node.depth,
      marker: node.marker ?? "",
      label: node.label,
      status: node.status,
      // Mutation checkpoint: passing null for startedAt when unset must turn empty-stage-elapsed RED.
      elapsed: stageTreeElapsedLabel(node, nowMs, compact),
    },
    leftPaneWidth,
  );
}

export function buildBranchMonitorTreeRow(
  node: MonitorPipelineTreeBranchNode,
  leftPaneWidth: number,
  nowMs: number,
): MonitorLineRow {
  const compact = leftPaneWidth < 100;
  return composeBranchRow(
    {
      depth: node.depth,
      marker: node.marker ?? "",
      label: node.label,
      currentStage: node.summaryStageId,
      status: node.summaryStatus,
      elapsed: formatTreeTiming(branchWorkIdleTiming(node, nowMs), compact),
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
    const isBranched = splitPosition !== null && stage.position >= splitPosition;
    if (isBranched) {
      if (!branchRecordsByKey.has(stage.branchKey)) {
        branchRecordsByKey.set(stage.branchKey, []);
        branchStagesByKey.set(stage.branchKey, []);
        branchKeyOrder.push(stage.branchKey);
      }
      branchRecordsByKey.get(stage.branchKey)?.push(stage);
    }
    if (isElidedGateStage(stageKinds.get(stage.stageId), stage.status)) continue;

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

    branchStagesByKey.get(stage.branchKey)?.push(stageNode);
  }

  const displayBranchKeys = branchKeyOrder.filter((branchKey) => (branchStagesByKey.get(branchKey)?.length ?? 0) > 0);
  const strippedLabels = strippedBranchLabels(displayBranchKeys);
  const branches: MonitorPipelineTreeBranchNode[] = displayBranchKeys.map((branchKey, index) => {
    const summary = deriveBranchSummary(branchRecordsByKey.get(branchKey) ?? []);
    const branchStages = branchStagesByKey.get(branchKey) ?? [];
    const records = branchRecordsByKey.get(branchKey) ?? [];
    const { startedAt, endedAt } = branchElapsedBounds(branchStages);
    return {
      kind: "branch",
      id: monitorPipelineBranchNodeId(snapshot.pipelineId, branchKey),
      depth: 1,
      pipelineId: snapshot.pipelineId,
      branchKey,
      label: strippedLabels[index] ?? branchKey,
      summaryStageId: summary.stageId,
      summaryStatus: summary.status,
      stages: branchStages,
      records,
      attributedRuns: attributedRunsForStages(records, builderRuns),
      startedAt,
      endedAt,
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
    attributedRuns: attributedRunsForStages(snapshot.stages, builderRuns),
    ...buildStageNodes(snapshot, builderRuns),
  }));

  const adHocCandidates = builderRuns.filter((run) => isAdHocCandidate(run, matchedInvocationIds));
  const adHocNodes = buildWorkflowTableRows(adHocCandidates, builderRuns, new Set()).map((tableRow) => ({
    kind: "adhoc" as const,
    id: monitorTreeRun(tableRow).runId,
    depth: 0 as const,
    tableRow,
    label: monitorTreeRun(tableRow).branch,
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

function runNodeMatchesSelection(run: MonitorPipelineTreeRunNode, selectedNodeId: string): boolean {
  // Mutation checkpoint: reverting this to `run.id === selectedNodeId` must turn collapsed-member reveal RED.
  return (
    run.id === selectedNodeId || workflowTableRowMembers(run.tableRow).some((member) => member.runId === selectedNodeId)
  );
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
        if (runNodeMatchesSelection(run, selectedNodeId)) return new Set([pipeline.id, branch.id, stage.id]);
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
        if (runNodeMatchesSelection(run, selectedNodeId)) {
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
  nodes.push(withExpansionMarker(stage, effectiveExpansion));
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
  // Mutation checkpoint: skipping glyph/attention annotation here must turn row-semantic derivation RED.
  const annotatedPipeline = withExpansionMarker(
    { ...pipeline, attention: pipelineAttentionSummary(pipeline) },
    effectiveExpansion,
  );
  const nodes: MonitorPipelineTreeDisplayNode[] = [annotatedPipeline];

  if (!effectiveExpansion.has(pipeline.id)) {
    return nodes;
  }

  for (const stage of pipeline.stages) {
    pushStageWithRuns(nodes, pipeline, stage, effectiveExpansion, builderRuns);
  }

  for (const branch of pipeline.branches) {
    nodes.push(withExpansionMarker(branch, effectiveExpansion));
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

type MonitorPipelineTreeExpandableNode =
  | MonitorPipelineTreePipelineNode
  | MonitorPipelineTreeBranchNode
  | MonitorPipelineTreeStageNode;

/** A node is expandable exactly when its already-elided structural child collection is nonempty. */
function isStructurallyExpandableTreeNode(node: MonitorPipelineTreeExpandableNode): boolean {
  switch (node.kind) {
    case "pipeline":
      // Mutation checkpoint: reporting an empty pipeline as expandable must turn empty-pipeline-leaf RED.
      return node.stages.length > 0 || node.branches.length > 0;
    case "branch":
      // Mutation checkpoint: reporting an empty branch as expandable must turn empty-branch-leaf RED.
      return node.stages.length > 0;
    case "stage":
      // Mutation checkpoint: reporting an empty stage as expandable must turn empty-stage-leaf RED.
      return node.runs.length > 0;
  }
}

/** `▼` when an expandable node is in the effective expansion set, `▶` when not, blank for leaves. */
function monitorTreeNodeMarker(
  node: MonitorPipelineTreeExpandableNode,
  effectiveExpansion: ReadonlySet<string>,
): string {
  if (!isStructurallyExpandableTreeNode(node)) return "";
  // Mutation checkpoint: swapping the expanded/collapsed glyphs here must turn glyph derivation RED.
  return effectiveExpansion.has(node.id) ? "▼" : "▶";
}

function withExpansionMarker<T extends MonitorPipelineTreeExpandableNode>(
  node: T,
  effectiveExpansion: ReadonlySet<string>,
): T {
  return {
    ...node,
    expandable: isStructurallyExpandableTreeNode(node),
    marker: monitorTreeNodeMarker(node, effectiveExpansion),
  };
}

export function isExpandablePipelineNodeId(
  pipelineNodes: readonly MonitorPipelineTreePipelineNode[],
  nodeId: string,
): boolean {
  for (const pipeline of pipelineNodes) {
    if (pipeline.id === nodeId) return isStructurallyExpandableTreeNode(pipeline);
    for (const stage of pipelineStageNodes(pipeline)) {
      if (stage.id === nodeId) return isStructurallyExpandableTreeNode(stage);
    }
    for (const branch of pipeline.branches) {
      if (branch.id === nodeId) return isStructurallyExpandableTreeNode(branch);
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
