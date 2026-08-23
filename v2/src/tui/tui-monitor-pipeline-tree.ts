import { basename } from "node:path";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { isPipelineTerminal, type PipelineDerivedState } from "../daemon/pipeline-execution.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { formatAggregateTiming, formatElapsedWallClock } from "./tui-elapsed-format.ts";
import type { MonitorLineRow } from "./tui-monitor-lines.ts";
import {
  buildWorkflowTableRows,
  partitionRunsByWorkflowInvocation,
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
  /** Union of this stage's own recorded-invocation run ids and every branch-attributed invocation's member run ids. */
  claimedRunIds: string[];
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

/** Session-local dismissed-pipeline display toggle shared by every TUI projection. */
export type MonitorPipelineDisplayOptions = { showDismissed?: boolean };

/** A dismissed pipeline leaves every TUI projection unless the session opts into showing it. */
export function isHiddenDismissedPipeline(snapshot: PipelineSnapshot, showDismissed: boolean): boolean {
  // Mutation checkpoint: reporting no dismissed pipeline as hidden here must turn the hide-dismissed-pipeline keystone RED.
  return snapshot.dismissedAt !== null && !showDismissed;
}

/** A shown dismissed pipeline row is marked so it never reads as live work. */
function dismissedPipelineLabel(snapshot: PipelineSnapshot, label: string): string {
  // Mutation checkpoint: dropping this early return must turn the dismissed-row-marker guard RED.
  if (snapshot.dismissedAt === null) return label;
  return `${label} (dismissed)`;
}

/** A dismissed run leaves the work tree unless the session opts into showing dismissed work. */
export function isHiddenDismissedRun(run: DaemonListRunRow, showDismissed: boolean): boolean {
  return (run.dismissedAt ?? null) !== null && !showDismissed;
}

/** A shown dismissed run row is marked so it never reads as live work. */
export function dismissedRunLabel(run: DaemonListRunRow, label: string): string {
  if ((run.dismissedAt ?? null) === null) return label;
  return `${label} (dismissed)`;
}

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

/** Shared pipeline/branch timing guard: labeled 20-column cell at or above 80 left-pane columns, compact below. Stage timing keeps its own threshold. */
function pipelineBranchTimingCompact(leftPaneWidth: number): boolean {
  return leftPaneWidth < 80;
}

export function buildPipelineMonitorTreeRow(
  pipeline: MonitorPipelineTreePipelineNode,
  width: number,
  nowMs: number,
): MonitorLineRow {
  const compact = pipelineBranchTimingCompact(width);
  const node = { ...pipeline, compact };
  return composePipelineRow(
    {
      depth: node.depth,
      marker: node.marker ?? "",
      label: dismissedPipelineLabel(node.snapshot, pipelineRowLabel(node.snapshot)),
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
  const compact = pipelineBranchTimingCompact(leftPaneWidth);
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

/** A blank branch never participates in branch attribution: it would collapse unrelated runs onto one stage. */
function attributableBranch(branch: string): string | null {
  const trimmed = branch.trim();
  // Mutation checkpoint: returning the untrimmed branch here must turn blank-branch exclusion RED.
  return trimmed.length === 0 ? null : trimmed;
}

function claimKey(project: string, branch: string): string {
  // Mutation checkpoint: dropping project from this key must turn cross-project exclusion RED.
  return `${project} ${branch}`;
}

/** Distinct (project, branch) claim keys of the runs joined to one stage's recorded invocation id. */
function stageClaimKeys(invocationId: string, builderRuns: readonly DaemonListRunRow[]): Set<string> {
  const keys = new Set<string>();
  for (const run of builderRuns) {
    if (run.workflow?.invocationId !== invocationId) continue;
    const branch = attributableBranch(run.branch);
    if (branch !== null) keys.add(claimKey(run.project, branch));
  }
  return keys;
}

type StageBranchClaim = { stageNodeId: string; startedAt: number | null; keys: ReadonlySet<string> };

/**
 * One claim per stage that displays its own invocation's runs, restricted to displayed pipelines and
 * mirroring buildStageNodes' elisions and dedup so a claim never names a stage that does not render.
 */
function collectStageBranchClaims(
  displayedSnapshots: readonly PipelineSnapshot[],
  builderRuns: readonly DaemonListRunRow[],
): StageBranchClaim[] {
  const claims: StageBranchClaim[] = [];
  for (const snapshot of displayedSnapshots) {
    const splitPosition = fanOutSplitPosition(snapshot);
    const stageKinds = resolveStageKinds(snapshot.name);
    const claimedInPipeline = new Set<string>();
    for (const stage of snapshot.stages) {
      if (isElidedPlaceholderStage(stage, splitPosition)) continue;
      if (isElidedGateStage(stageKinds.get(stage.stageId), stage.status)) continue;
      const invocationId = stage.workflowInvocationId;
      if (!claimInvocationId(claimedInPipeline, invocationId)) continue;
      const keys = stageClaimKeys(invocationId, builderRuns);
      if (keys.size === 0) continue;
      claims.push({
        stageNodeId: monitorPipelineStageNodeId(snapshot.pipelineId, stage.stageId, stage.branchKey),
        startedAt: stage.startedAt,
        keys,
      });
    }
  }
  return claims;
}

function startedAtRank(claim: StageBranchClaim): number {
  return claim.startedAt ?? Number.NEGATIVE_INFINITY;
}

/** Last-started claim wins; an unstarted stage loses to any started one and later listing order breaks equal starts. */
function mostRecentlyStartedClaim(claims: readonly StageBranchClaim[]): StageBranchClaim | undefined {
  let best: StageBranchClaim | undefined;
  for (const claim of claims) {
    // Mutation checkpoint: reducing this to first-match-wins must turn the tie-break test RED.
    if (best === undefined || startedAtRank(claim) >= startedAtRank(best)) best = claim;
  }
  return best;
}

function memberMatchesClaim(member: DaemonListRunRow, claim: StageBranchClaim): boolean {
  const branch = attributableBranch(member.branch);
  return branch !== null && claim.keys.has(claimKey(member.project, branch));
}

/** A claim matches an invocation when any one of its member runs — not just a representative — hits the claim's keys. */
function invocationMatchesClaim(members: readonly DaemonListRunRow[], claim: StageBranchClaim): boolean {
  return members.some((member) => memberMatchesClaim(member, claim));
}

/**
 * invocationId -> stage node id, for invocations no stage records but that share a claimed (project,
 * branch) via at least one member run.
 */
function collectBranchAttributedInvocations(
  claims: readonly StageBranchClaim[],
  builderRuns: readonly DaemonListRunRow[],
  matchedInvocationIds: ReadonlySet<string>,
): Map<string, string> {
  const { byInvocation } = partitionRunsByWorkflowInvocation(builderRuns);
  const attributed = new Map<string, string>();
  for (const [invocationId, members] of byInvocation) {
    if (matchedInvocationIds.has(invocationId)) continue;
    const candidates = claims.filter((claim) => invocationMatchesClaim(members, claim));
    const claim = mostRecentlyStartedClaim(candidates);
    if (claim !== undefined) attributed.set(invocationId, claim.stageNodeId);
  }
  return attributed;
}

function buildStageNodes(
  snapshot: PipelineSnapshot,
  builderRuns: readonly DaemonListRunRow[],
  branchAttribution: ReadonlyMap<string, string>,
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
    const stageNodeId = monitorPipelineStageNodeId(snapshot.pipelineId, stage.stageId, stage.branchKey);
    let stageRuns: DaemonListRunRow[] = [];

    if (claimInvocationId(claimedInPipeline, invocationId)) {
      // Mutation checkpoint: negating the invocationId equality guard must turn stage join RED.
      const ownRuns = builderRuns.filter((run) => run.workflow?.invocationId === invocationId);
      const branchRuns = builderRuns.filter(
        (run) =>
          run.workflow?.invocationId !== undefined &&
          run.workflow.invocationId !== invocationId &&
          branchAttribution.get(run.workflow.invocationId) === stageNodeId,
      );
      stageRuns = [...ownRuns, ...branchRuns];
    }
    const tableRows = buildWorkflowTableRows(stageRuns, builderRuns, new Set());

    const stageNode: MonitorPipelineTreeStageNode = {
      kind: "stage",
      id: stageNodeId,
      depth: stageDepth,
      stageId: stage.stageId,
      label: `${stage.stageId}${intentYieldSuffix(stage.artifact)}`,
      branchKey: stage.branchKey,
      status: stage.status,
      startedAt: stage.startedAt,
      endedAt: stage.endedAt,
      claimedRunIds: stageRuns.map((run) => run.runId),
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

function isAdHocCandidate(
  run: DaemonListRunRow,
  matchedInvocationIds: ReadonlySet<string>,
  branchAttribution: ReadonlyMap<string, string>,
): boolean {
  const invocationId = run.workflow?.invocationId;
  if (invocationId === undefined) return true;
  if (invocationId !== undefined && branchAttribution.has(invocationId)) return false;
  // Mutation checkpoint: negating matchedInvocationIds exclusion must turn ad-hoc filtering RED.
  return !matchedInvocationIds.has(invocationId);
}

export function buildMonitorPipelineTreeJoin(
  snapshots: readonly PipelineSnapshot[],
  runs: readonly DaemonListRunRow[],
  options: MonitorPipelineDisplayOptions = {},
): {
  pipelineNodes: MonitorPipelineTreePipelineNode[];
  adHocNodes: MonitorPipelineTreeAdHocNode[];
  builderRuns: DaemonListRunRow[];
} {
  const showDismissed = options.showDismissed === true;
  const builderRuns = runs.filter((run) => run.status !== "queued" && !isHiddenDismissedRun(run, showDismissed));
  const displayedSnapshots = snapshots.filter((snapshot) => !isHiddenDismissedPipeline(snapshot, showDismissed));
  // Mutation checkpoint: computing this off the filtered list here must turn ad-hoc-resurfacing suppression RED.
  const matchedInvocationIds = collectMatchedInvocationIds(snapshots);
  const stageBranchClaims = collectStageBranchClaims(displayedSnapshots, builderRuns);
  const branchAttribution = collectBranchAttributedInvocations(stageBranchClaims, builderRuns, matchedInvocationIds);

  const pipelineNodes = displayedSnapshots.map((snapshot) => ({
    kind: "pipeline" as const,
    id: snapshot.pipelineId,
    depth: 0,
    snapshot,
    project: derivePipelineProject(snapshot, builderRuns),
    attributedRuns: attributedRunsForStages(snapshot.stages, builderRuns),
    ...buildStageNodes(snapshot, builderRuns, branchAttribution),
  }));

  const adHocCandidates = builderRuns.filter((run) => isAdHocCandidate(run, matchedInvocationIds, branchAttribution));
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

/** Expands every invocation among the stage's claimed runs, not just its own recorded invocation. */
function stageRunsForExpansion(
  stage: MonitorPipelineTreeStageNode,
  builderRuns: readonly DaemonListRunRow[],
): MonitorPipelineTreeRunNode[] {
  const claimed = new Set(stage.claimedRunIds);
  if (claimed.size === 0) return stage.runs;

  const stageRuns = builderRuns.filter((run) => claimed.has(run.runId));
  const expandedInvocationIds = new Set(
    stageRuns.flatMap((run) => (run.workflow === undefined ? [] : [run.workflow.invocationId])),
  );
  const tableRows = buildWorkflowTableRows(stageRuns, builderRuns, expandedInvocationIds);
  return workflowTableRowsToRunNodes(stage.depth, tableRows);
}

function pushStageWithRuns(
  nodes: MonitorPipelineTreeDisplayNode[],
  stage: MonitorPipelineTreeStageNode,
  effectiveExpansion: ReadonlySet<string>,
  builderRuns: readonly DaemonListRunRow[],
): void {
  nodes.push(withExpansionMarker(stage, effectiveExpansion));
  if (effectiveExpansion.has(stage.id)) {
    nodes.push(...stageRunsForExpansion(stage, builderRuns));
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
    pushStageWithRuns(nodes, stage, effectiveExpansion, builderRuns);
  }

  for (const branch of pipeline.branches) {
    nodes.push(withExpansionMarker(branch, effectiveExpansion));
    if (!effectiveExpansion.has(branch.id)) continue;
    for (const stage of branch.stages) {
      pushStageWithRuns(nodes, stage, effectiveExpansion, builderRuns);
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
  options: MonitorPipelineDisplayOptions = {},
): MonitorPipelineTreeDisplayNode[] {
  const { pipelineNodes, adHocNodes, builderRuns } = buildMonitorPipelineTreeJoin(snapshots, runs, options);
  return flattenMonitorPipelineTree(pipelineNodes, adHocNodes, expandedNodeIds, selectedNodeId, builderRuns);
}
