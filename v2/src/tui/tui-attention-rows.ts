import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { hasPipelineTerminalPublicationFailure } from "../daemon/pipeline-execution.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { DEFAULT_PIPELINE_STAGE_BRANCH_KEY } from "../persistence/state-store.ts";
import type { PipelineListResult } from "./tui-daemon-client.ts";
import { mergePipelineSnapshots } from "./tui-monitor-lines.ts";
import {
  buildMonitorPipelineTreeJoin,
  monitorPipelineStageNodeId,
  pipelineRowLabel,
  pipelineStageNodes,
  stageBranchCellValue,
} from "./tui-monitor-pipeline-tree.ts";
import { workflowRoleLabel, workflowTableRowMembers } from "./tui-monitor-workflow-collapse.ts";
import { monitorTreeRun } from "./tui-shell-layout.ts";

/** One projected operator-attention incident. */
export type AttentionRowKind =
  | "awaiting-gate"
  | "rejected-gate"
  | "failed-stage"
  | "failed-run"
  | "blocked-run"
  | "publication-failure";

export type AttentionRow = {
  /** Separately namespaced selectable id; never collides with a tree node id. */
  id: string;
  kind: AttentionRowKind;
  /** Tree node id this row navigates to. */
  targetId: string;
  sinceMs: number | null;
  glyph: string;
  what: string;
  where: string;
  /** Gate identity for the queued act-in-place consumer; present only on gate rows. */
  gate?: { pipelineId: string; stageId: string; branchKey: string };
};

export type AttentionProjection = {
  rows: readonly AttentionRow[];
  /** Total actionable incidents before the cap. */
  total: number;
  /** Rows dropped by the cap; display-only, never selectable. */
  overflow: number;
};

const GATE_GLYPH = "✋";
const FAILURE_GLYPH = "✗";
const ATTENTION_ROW_CAP = 6;
const GATE_KINDS = new Set<AttentionRowKind>(["awaiting-gate", "rejected-gate"]);

type StageRecord = PipelineSnapshot["stages"][number];

function attentionRowId(...parts: string[]): string {
  return `attention:${parts.join(":")}`;
}

function stageKindMap(name: string): Map<string, string> {
  const resolved = getPipelineDefinition(name);
  if (!resolved.ok) return new Map();
  return new Map(resolved.definition.stages.map((stage) => [stage.stageId, stage.kind]));
}

function pipelineTargetLabel(snapshot: PipelineSnapshot, branchKey: string): string {
  const suffix = stageBranchCellValue(branchKey);
  return suffix === "" ? pipelineRowLabel(snapshot) : `${pipelineRowLabel(snapshot)} › ${suffix}`;
}

function maxByPosition(records: readonly StageRecord[]): StageRecord | undefined {
  return records.reduce<StageRecord | undefined>((max, record) => {
    if (max === undefined || record.position > max.position) return record;
    return max;
  }, undefined);
}

/** Nearest lower-position predecessor: same branch first, then the shared default-branch predecessor. */
function nearestPredecessor(
  stages: readonly StageRecord[],
  branchKey: string,
  position: number,
): StageRecord | undefined {
  const sameBranch = maxByPosition(
    stages.filter((stage) => stage.branchKey === branchKey && stage.position < position),
  );
  if (sameBranch !== undefined) return sameBranch;
  if (branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY) return undefined;
  return maxByPosition(
    stages.filter((stage) => stage.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY && stage.position < position),
  );
}

function awaitingGateSinceMs(
  snapshot: PipelineSnapshot,
  kinds: Map<string, string>,
  stage: StageRecord,
): number | null {
  const predecessor = nearestPredecessor(snapshot.stages, stage.branchKey, stage.position);
  if (predecessor === undefined) return null;
  if (kinds.get(predecessor.stageId) === "approval") return predecessor.decidedAt;
  return predecessor.endedAt;
}

/** Durable pipeline terminal finish from stage endedAt/decidedAt only; never createdAt or finishedAtMs. */
function terminalPublicationSinceMs(snapshot: PipelineSnapshot): number | null {
  const finishAts = snapshot.stages
    .flatMap((stage) => [stage.endedAt, stage.decidedAt])
    .filter((value): value is number => value !== null);
  return finishAts.length > 0 ? Math.max(...finishAts) : null;
}

function gateAndStageIncidents(snapshot: PipelineSnapshot): AttentionRow[] {
  const kinds = stageKindMap(snapshot.name);
  const rows: AttentionRow[] = [];

  for (const stage of snapshot.stages) {
    const targetId = monitorPipelineStageNodeId(snapshot.pipelineId, stage.stageId, stage.branchKey);
    const where = pipelineTargetLabel(snapshot, stage.branchKey);

    if (kinds.get(stage.stageId) === "approval") {
      if (stage.status === "awaiting") {
        rows.push({
          id: attentionRowId("gate", snapshot.pipelineId, stage.stageId, stage.branchKey),
          kind: "awaiting-gate",
          targetId,
          sinceMs: awaitingGateSinceMs(snapshot, kinds, stage),
          glyph: GATE_GLYPH,
          what: stage.stageId,
          where,
          gate: { pipelineId: snapshot.pipelineId, stageId: stage.stageId, branchKey: stage.branchKey },
        });
      } else if (stage.status === "rejected") {
        rows.push({
          id: attentionRowId("gate", snapshot.pipelineId, stage.stageId, stage.branchKey),
          kind: "rejected-gate",
          targetId,
          sinceMs: stage.decidedAt,
          glyph: GATE_GLYPH,
          what: stage.stageId,
          where,
          gate: { pipelineId: snapshot.pipelineId, stageId: stage.stageId, branchKey: stage.branchKey },
        });
      }
      continue;
    }

    if (stage.status === "failed") {
      rows.push({
        id: attentionRowId("stage", snapshot.pipelineId, stage.stageId, stage.branchKey),
        kind: "failed-stage",
        targetId,
        sinceMs: stage.endedAt,
        glyph: FAILURE_GLYPH,
        what: stage.stageId,
        where,
      });
    }
  }

  return rows;
}

function publicationFailureIncidents(snapshot: PipelineSnapshot): AttentionRow[] {
  if (!hasPipelineTerminalPublicationFailure(snapshot)) return [];
  return [
    {
      id: attentionRowId("publication", snapshot.pipelineId),
      kind: "publication-failure",
      targetId: snapshot.pipelineId,
      sinceMs: terminalPublicationSinceMs(snapshot),
      glyph: FAILURE_GLYPH,
      what: snapshot.terminalAction ?? "publish",
      where: pipelineRowLabel(snapshot),
    },
  ];
}

function runAttentionKind(status: DaemonListRunRow["status"]): AttentionRowKind | undefined {
  if (status === "failed") return "failed-run";
  if (status === "blocked") return "blocked-run";
  return undefined;
}

function runIncidents(snapshots: readonly PipelineSnapshot[], runs: readonly DaemonListRunRow[]): AttentionRow[] {
  const { pipelineNodes, adHocNodes } = buildMonitorPipelineTreeJoin(snapshots, runs);

  const attribution = new Map<string, { snapshot: PipelineSnapshot; branchKey: string }>();
  for (const pipeline of pipelineNodes) {
    for (const stage of pipelineStageNodes(pipeline)) {
      for (const runNode of stage.runs) {
        for (const member of workflowTableRowMembers(runNode.tableRow)) {
          attribution.set(member.runId, { snapshot: pipeline.snapshot, branchKey: stage.branchKey });
        }
      }
    }
  }

  const adHocInfo = new Map<string, { targetId: string; label: string }>();
  for (const node of adHocNodes) {
    const info = { targetId: monitorTreeRun(node.tableRow).runId, label: node.label };
    for (const member of workflowTableRowMembers(node.tableRow)) {
      adHocInfo.set(member.runId, info);
    }
  }

  const rows: AttentionRow[] = [];
  for (const run of runs) {
    const kind = runAttentionKind(run.status);
    if (kind === undefined) continue;

    const pipelineAttribution = attribution.get(run.runId);
    const adHoc = adHocInfo.get(run.runId);
    const targetId = pipelineAttribution !== undefined ? run.runId : (adHoc?.targetId ?? run.runId);
    const where =
      pipelineAttribution !== undefined
        ? pipelineTargetLabel(pipelineAttribution.snapshot, pipelineAttribution.branchKey)
        : (adHoc?.label ?? run.branch);

    rows.push({
      id: attentionRowId(kind, run.runId),
      kind,
      targetId,
      sinceMs: run.finishedAtMs ?? null,
      glyph: FAILURE_GLYPH,
      what: workflowRoleLabel(run),
      where,
    });
  }

  return rows;
}

function groupRank(kind: AttentionRowKind): number {
  return GATE_KINDS.has(kind) ? 0 : 1;
}

function compareAttentionRows(a: AttentionRow, b: AttentionRow): number {
  const rankDelta = groupRank(a.kind) - groupRank(b.kind);
  if (rankDelta !== 0) return rankDelta;

  const aDated = a.sinceMs !== null;
  const bDated = b.sinceMs !== null;
  if (aDated !== bDated) {
    return aDated ? -1 : 1;
  }
  if (aDated && bDated) {
    const sinceDelta = (a.sinceMs as number) - (b.sinceMs as number);
    if (sinceDelta !== 0) return sinceDelta;
  }
  if (a.targetId !== b.targetId) {
    return a.targetId < b.targetId ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Projects durable pipeline gates/failures and run failures into capped, ordered operator-attention rows.
 * Gates before failures; dated rows oldest-first within each group; undated rows by target id then row id.
 */
export function buildAttentionRows(
  pipelineSnapshotsBySocketPath: Readonly<Record<string, PipelineListResult>> | undefined,
  runs: readonly DaemonListRunRow[],
): AttentionProjection {
  const snapshots = mergePipelineSnapshots(pipelineSnapshotsBySocketPath);

  const incidents = [
    ...snapshots.flatMap(gateAndStageIncidents),
    ...snapshots.flatMap(publicationFailureIncidents),
    ...runIncidents(snapshots, runs),
  ].sort(compareAttentionRows);

  const rows = incidents.slice(0, ATTENTION_ROW_CAP);
  return { rows, total: incidents.length, overflow: incidents.length - rows.length };
}
