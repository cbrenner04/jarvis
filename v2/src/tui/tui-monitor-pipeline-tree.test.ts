import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { formatElapsedWallClock } from "./tui-elapsed-format.ts";
import { buildTreeRunRow, type MonitorLineRow } from "./tui-monitor-lines.ts";
import {
  buildMonitorPipelineTree,
  buildMonitorPipelineTreeJoin,
  buildPipelineMonitorTreeRow,
  buildStageMonitorTreeRow,
  flattenMonitorPipelineTree,
  isExpandablePipelineNodeId,
  type MonitorPipelineTreeDisplayNode,
  type MonitorPipelineTreePipelineNode,
  monitorPipelineBranchNodeId,
  monitorPipelineStageNodeId,
  pipelineAttentionSummary,
  pipelineStageRollupGroups,
  stageBranchCellValue,
  strippedBranchLabels,
} from "./tui-monitor-pipeline-tree.ts";

const FILTER_NOW_MS = 1_700_000_000_000;
const PIPELINE_ID = "pipe-abc";
const INVOCATION_MATCHED = "inv-matched";
const INVOCATION_ORPHAN = "inv-orphan";

function listRun(overrides: Partial<DaemonListRunRow> & Pick<DaemonListRunRow, "runId">): DaemonListRunRow {
  return {
    project: "demo",
    branch: "main",
    createdAt: 0,
    status: "in-progress",
    isLive: true,
    ...overrides,
  };
}

function workflowRun(
  overrides: Partial<DaemonListRunRow> & Pick<DaemonListRunRow, "runId" | "status">,
  invocationId: string,
): DaemonListRunRow {
  return listRun({
    workflow: {
      invocationId,
      steps: [{ stepId: "implement", role: "implement", status: "in_progress", attemptCount: 1 }],
    },
    stepId: "implement",
    ...overrides,
  });
}

function pipelineSnapshot(
  overrides: Partial<PipelineSnapshot> & Pick<PipelineSnapshot, "pipelineId">,
): PipelineSnapshot {
  return {
    name: "feature-pipeline",
    state: "running",
    createdAt: 1_700_000_000_000,
    finishedAtMs: null,
    stages: [],
    ...overrides,
    terminalPublicationSucceededAt: overrides.terminalPublicationSucceededAt ?? null,
    terminalPublicationFailure: overrides.terminalPublicationFailure ?? null,
  };
}

function snapshotStage(
  overrides: Partial<PipelineSnapshot["stages"][number]> & Pick<PipelineSnapshot["stages"][number], "stageId">,
): PipelineSnapshot["stages"][number] {
  return {
    branchKey: "default",
    status: "running",
    workflowInvocationId: null,
    startedAt: null,
    endedAt: null,
    decidedAt: null,
    ...overrides,
    id: overrides.id ?? "stage",
    position: overrides.position ?? 0,
    artifact: overrides.artifact ?? null,
    failureDetail: overrides.failureDetail ?? null,
  };
}

function implementStage(
  invocationId: string,
  overrides?: Partial<PipelineSnapshot["stages"][number]>,
): PipelineSnapshot["stages"][number] {
  return snapshotStage({ stageId: "implement", workflowInvocationId: invocationId, ...overrides });
}

function pipelineWithStageAndRun(
  pipelineId: string,
  invocationId: string,
  runId: string,
  overrides?: Partial<PipelineSnapshot>,
): { snapshot: PipelineSnapshot; run: DaemonListRunRow } {
  return {
    snapshot: pipelineSnapshot({
      pipelineId,
      stages: [implementStage(invocationId)],
      ...overrides,
    }),
    run: workflowRun({ runId, status: "in-progress" }, invocationId),
  };
}

function joinTree(snapshots: PipelineSnapshot[], runs: DaemonListRunRow[] = []): MonitorPipelineTreePipelineNode[] {
  return buildMonitorPipelineTreeJoin(snapshots, runs).pipelineNodes;
}

function flattenJoined(
  pipelineNodes: MonitorPipelineTreePipelineNode[],
  expandedNodeIds: ReadonlySet<string>,
  selectedNodeId: string | null,
  _maxVisibleRows: number,
  builderRuns: readonly DaemonListRunRow[] = [],
) {
  return flattenMonitorPipelineTree(pipelineNodes, [], expandedNodeIds, selectedNodeId, builderRuns);
}

/** Composed rows are `indent, marker, gap, label, gap, atom0, gap, atom1, ...`; label is always segment 3. */
function labelSegment(row: MonitorLineRow): string {
  return row.segments[3]?.text ?? "";
}

/** Right-aligned cluster atoms, in order (gaps interleaved between them are excluded). */
function clusterAtoms(row: MonitorLineRow): string[] {
  return row.segments
    .slice(5)
    .filter((_, index) => index % 2 === 0)
    .map((segment) => segment.text);
}

function rowDisplayWidth(row: MonitorLineRow): number {
  return row.segments.reduce((sum, segment) => sum + Bun.stringWidth(segment.text), 0);
}

describe("buildMonitorPipelineTreeJoin", () => {
  test("nests a run whose workflow invocation matches a stage under that stage", () => {
    // Mutation checkpoint: negating the invocationId equality guard in buildStageNodes must turn stage join RED.
    const pipelineNodes = joinTree(
      [pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [implementStage(INVOCATION_MATCHED)] })],
      [workflowRun({ runId: "run-implement", status: "in-progress" }, INVOCATION_MATCHED)],
    );
    const stage = pipelineNodes[0]?.stages[0];
    const runNode = stage?.runs[0];

    expect(stage?.kind).toBe("stage");
    expect(runNode).toMatchObject({
      kind: "run",
      id: "run-implement",
      depth: 2,
    });
    expect(runNode?.tableRow.kind).toBe("workflow-collapsed");
  });

  test("places runs with no matching stage only in the ad-hoc top level", () => {
    const { pipelineNodes, adHocNodes } = buildMonitorPipelineTreeJoin(
      [pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [implementStage(INVOCATION_MATCHED)] })],
      [workflowRun({ runId: "run-orphan", status: "completed", isLive: false }, INVOCATION_ORPHAN)],
    );

    expect(pipelineNodes[0]?.stages[0]?.runs).toHaveLength(0);
    expect(adHocNodes).toHaveLength(1);
    expect(adHocNodes[0]?.kind).toBe("adhoc");
    expect(adHocNodes[0]?.tableRow.kind).toBe("workflow-collapsed");
    expect(adHocNodes[0]?.id).toBe("run-orphan");
  });

  test("an ad-hoc top-level row is labeled with its entry run's branch", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "label: labelOverride ?? runRowLabel(tableRow)," -> "label: runRowLabel(tableRow),"
    const branch = "adhoc-work";
    const run = workflowRun(
      { runId: "12345678-1234-1234-1234-123456789abc", status: "in-progress", branch },
      INVOCATION_ORPHAN,
    );
    const { adHocNodes } = buildMonitorPipelineTreeJoin([], [run]);
    const node = adHocNodes[0];
    if (node === undefined) throw new Error("expected ad-hoc node");
    const paintedRow = buildTreeRunRow(node.tableRow, node.depth, 90, FILTER_NOW_MS, node.label);
    const roleFirstRow = buildTreeRunRow(node.tableRow, node.depth, 90, FILTER_NOW_MS);

    expect(labelSegment(paintedRow).trimEnd()).toBe(branch);
    expect(node.label).toBe(branch);
    expect(labelSegment(paintedRow)).not.toBe(labelSegment(roleFirstRow));
  });

  test("fan-out stages with the same stageId but different branchKey get distinct ids and branch cells", () => {
    // Mutation checkpoint: omitting branchKey from monitorPipelineStageNodeId must turn fan-out node id RED.
    const pipelineNodes = joinTree([
      pipelineSnapshot({
        pipelineId: PIPELINE_ID,
        stages: [
          snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
          snapshotStage({
            stageId: "plan",
            branchKey: "alpha",
            position: 1,
            status: "succeeded",
            workflowInvocationId: "inv-plan-alpha",
          }),
          snapshotStage({
            stageId: "plan",
            branchKey: "beta",
            position: 1,
            workflowInvocationId: "inv-plan-beta",
          }),
        ],
      }),
    ]);
    const pipeline = pipelineNodes[0];
    expect(pipeline).toBeDefined();
    if (pipeline === undefined) throw new Error("expected pipeline node");
    expect(pipeline.stages).toHaveLength(1);
    expect(pipeline.branches).toHaveLength(2);

    const alphaBranch = pipeline.branches.find((branch) => branch.branchKey === "alpha");
    const betaBranch = pipeline.branches.find((branch) => branch.branchKey === "beta");
    expect(alphaBranch).toBeDefined();
    expect(betaBranch).toBeDefined();
    if (alphaBranch === undefined || betaBranch === undefined) throw new Error("expected branch nodes");
    const alphaStage = alphaBranch.stages[0];
    const betaStage = betaBranch.stages[0];
    expect(alphaStage).toBeDefined();
    expect(betaStage).toBeDefined();
    if (!alphaStage || !betaStage) throw new Error("expected branch stages");

    expect(alphaStage.id).toBe(monitorPipelineStageNodeId(PIPELINE_ID, "plan", "alpha"));
    expect(betaStage.id).toBe(monitorPipelineStageNodeId(PIPELINE_ID, "plan", "beta"));
    expect(alphaStage.kind).toBe("stage");
    expect(betaStage.kind).toBe("stage");
    expect(stageBranchCellValue("alpha")).toBe("alpha");
    expect(stageBranchCellValue("beta")).toBe("beta");
  });

  test("derives pipeline project from the first joined run and is empty when none joined", () => {
    // Mutation checkpoint: skipping the joinedRun guard in derivePipelineProject must turn project derivation RED.
    const pipelineNodes = joinTree(
      [
        pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [implementStage(INVOCATION_MATCHED)] }),
        pipelineSnapshot({
          pipelineId: "pipe-empty",
          stages: [snapshotStage({ stageId: "plan", status: "pending", workflowInvocationId: "inv-missing" })],
        }),
      ],
      [workflowRun({ runId: "run-implement", status: "in-progress", project: "jarvis" }, INVOCATION_MATCHED)],
    );

    expect(pipelineNodes[0]?.project).toBe("jarvis");
    expect(pipelineNodes[1]?.project).toBe("");
  });

  test("pipeline and stage row helpers fill the full pane width", () => {
    const pipelineNode = {
      kind: "pipeline" as const,
      id: PIPELINE_ID,
      depth: 0,
      snapshot: pipelineSnapshot({ pipelineId: PIPELINE_ID }),
      project: "demo",
      stages: [],
      branches: [],
    };
    const stageNode = {
      kind: "stage" as const,
      id: monitorPipelineStageNodeId(PIPELINE_ID, "implement", "feature"),
      depth: 1,
      stageId: "implement",
      label: "implement",
      branchKey: "feature",
      status: "running",
      startedAt: null,
      endedAt: null,
      runs: [],
    };

    const pipelineRow = buildPipelineMonitorTreeRow(pipelineNode, 90, FILTER_NOW_MS);
    const stageRow = buildStageMonitorTreeRow(stageNode, 90, FILTER_NOW_MS);

    expect(rowDisplayWidth(pipelineRow)).toBe(90);
    expect(rowDisplayWidth(stageRow)).toBe(90);
  });

  test("two pipelines of one definition label their rows with distinct seed basenames", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "label: pipelineRowLabel(node.snapshot)," -> "label: node.snapshot.name,"
    const workRowsNode = {
      kind: "pipeline" as const,
      id: "pipe-1",
      depth: 0,
      snapshot: pipelineSnapshot({
        pipelineId: "pipe-1",
        name: "full-review",
        seedPath: "v2/spec/seeds/tui-work-row-labels.md",
      }),
      project: "demo",
      stages: [],
      branches: [],
    };
    const attentionSegmentNode = {
      kind: "pipeline" as const,
      id: "pipe-2",
      depth: 0,
      snapshot: pipelineSnapshot({
        pipelineId: "pipe-2",
        name: "full-review",
        seedPath: "v2/spec/seeds/tui-attention-segment.md",
      }),
      project: "demo",
      stages: [],
      branches: [],
    };

    const workRowsLabel = labelSegment(buildPipelineMonitorTreeRow(workRowsNode, 90, FILTER_NOW_MS));
    const attentionSegmentLabel = labelSegment(buildPipelineMonitorTreeRow(attentionSegmentNode, 90, FILTER_NOW_MS));

    expect(workRowsLabel.trimEnd()).toBe("tui-work-row-labels");
    expect(attentionSegmentLabel.trimEnd()).toBe("tui-attention-segment");
    expect(workRowsLabel).not.toBe(attentionSegmentLabel);
  });

  test("a pipeline with no recorded seed path labels its row with the definition name and short pipeline id", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (slug.length > 0) return slug;" -> "if (slug.length >= 0) return slug;"
    const pipelineId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const pipelineNode = {
      kind: "pipeline" as const,
      id: pipelineId,
      depth: 0,
      snapshot: pipelineSnapshot({ pipelineId, name: "full-review" }),
      project: "demo",
      stages: [],
      branches: [],
    };

    const label = labelSegment(buildPipelineMonitorTreeRow(pipelineNode, 90, FILTER_NOW_MS));

    expect(label.trimEnd()).toBe(`full-review ${pipelineId.slice(0, 8)}`);
  });

  test("pins the first stage when two stages in one snapshot share a workflowInvocationId", () => {
    // Mutation checkpoint: negating claimInvocationId duplicate guard in buildStageNodes must turn first-wins pinning RED.
    const sharedInvocation = "inv-shared";
    const pipelineNodes = joinTree(
      [
        pipelineSnapshot({
          pipelineId: PIPELINE_ID,
          stages: [
            implementStage(sharedInvocation, { stageId: "plan", status: "succeeded" }),
            implementStage(sharedInvocation, { stageId: "implement", status: "running" }),
          ],
        }),
      ],
      [workflowRun({ runId: "run-shared", status: "in-progress" }, sharedInvocation)],
    );
    const stages = pipelineNodes[0]?.stages ?? [];

    expect(stages[0]?.runs.map((node) => node.id)).toEqual(["run-shared"]);
    expect(stages[1]?.runs).toEqual([]);
  });

  test("excludes stage-matched and queued runs from ad-hoc candidates", () => {
    // Mutation checkpoint: negating matchedInvocationIds exclusion in isAdHocCandidate must turn ad-hoc filtering RED.
    const { pipelineNodes, adHocNodes } = buildMonitorPipelineTreeJoin(
      [pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [implementStage(INVOCATION_MATCHED)] })],
      [
        workflowRun({ runId: "run-matched", status: "in-progress" }, INVOCATION_MATCHED),
        workflowRun({ runId: "run-queued", status: "queued", isLive: false }, "inv-queued"),
        workflowRun(
          { runId: "run-stale-orphan", status: "completed", isLive: false, finishedAtMs: FILTER_NOW_MS - 3_600_001 },
          INVOCATION_ORPHAN,
        ),
        workflowRun(
          { runId: "run-fresh-orphan", status: "completed", isLive: false, finishedAtMs: FILTER_NOW_MS - 60_000 },
          "inv-fresh",
        ),
      ],
    );

    expect(pipelineNodes[0]?.stages[0]?.runs.some((node) => node.id === "run-matched")).toBe(true);
    expect(adHocNodes.map((node) => node.id)).toEqual(["run-stale-orphan", "run-fresh-orphan"]);
    expect(adHocNodes.some((node) => node.id === "run-matched")).toBe(false);
    expect(adHocNodes.some((node) => node.id === "run-queued")).toBe(false);
  });
});

describe("branch-grouped pipeline subtree", () => {
  const MODEL_BRANCH = "tui-pipeline-tree-model";
  const MONITOR_BRANCH = "tui-pipeline-tree-monitor";

  test("the stage roll-up groups post-split records under their branch after the pre-split records", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "const branched = split !== null && stage.position >= split;" -> "const branched = false;"
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "plan", branchKey: MODEL_BRANCH, position: 2, status: "succeeded" }),
        snapshotStage({ stageId: "plan", branchKey: MONITOR_BRANCH, position: 2, status: "succeeded" }),
        snapshotStage({ stageId: "implement", branchKey: MODEL_BRANCH, position: 4, status: "running" }),
        snapshotStage({ stageId: "implement", branchKey: MONITOR_BRANCH, position: 4, status: "running" }),
      ],
    });

    const groups = pipelineStageRollupGroups(snapshot);

    expect(groups.map((group) => group.branchKey)).toEqual([null, MODEL_BRANCH, MONITOR_BRANCH]);
    expect(groups.map((group) => group.records.map((record) => `${record.stageId}:${record.branchKey}`))).toEqual([
      ["intent:default"],
      [`plan:${MODEL_BRANCH}`, `implement:${MODEL_BRANCH}`],
      [`plan:${MONITOR_BRANCH}`, `implement:${MONITOR_BRANCH}`],
    ]);
  });

  test("the stage roll-up drops the post-split default placeholder record", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (isElidedPlaceholderStage(stage, split)) continue;" -> "if (false) continue;"
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "plan", branchKey: MODEL_BRANCH, position: 2, status: "succeeded" }),
        snapshotStage({ stageId: "plan", branchKey: MONITOR_BRANCH, position: 2, status: "succeeded" }),
        snapshotStage({ stageId: "plan", position: 2, status: "skipped" }),
        snapshotStage({ stageId: "implement", branchKey: MODEL_BRANCH, position: 4, status: "running" }),
        snapshotStage({ stageId: "implement", branchKey: MONITOR_BRANCH, position: 4, status: "running" }),
      ],
    });

    const groupedRecords = pipelineStageRollupGroups(snapshot).flatMap((group) => group.records);

    expect(groupedRecords).not.toContain(snapshot.stages[3]);
    expect(groupedRecords).toHaveLength(snapshot.stages.length - 1);
  });

  test("post-split stages group under one branch node per branchKey after pre-split stages", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return branchedPositions.length === 0 ? null : Math.min(...branchedPositions);" -> "return null;"
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "plan", branchKey: MODEL_BRANCH, position: 2, status: "succeeded" }),
        snapshotStage({ stageId: "plan", branchKey: MONITOR_BRANCH, position: 2, status: "succeeded" }),
        snapshotStage({ stageId: "implement", branchKey: MODEL_BRANCH, position: 4, status: "running" }),
        snapshotStage({ stageId: "implement", branchKey: MONITOR_BRANCH, position: 4, status: "running" }),
      ],
    });
    const pipelineNodes = joinTree([snapshot]);
    const expanded = new Set([
      PIPELINE_ID,
      monitorPipelineBranchNodeId(PIPELINE_ID, MODEL_BRANCH),
      monitorPipelineBranchNodeId(PIPELINE_ID, MONITOR_BRANCH),
    ]);

    const displayNodes = flattenJoined(pipelineNodes, expanded, null, 20);

    expect(displayNodes.map((node) => ({ kind: node.kind, id: node.id }))).toEqual([
      { kind: "pipeline", id: PIPELINE_ID },
      { kind: "stage", id: monitorPipelineStageNodeId(PIPELINE_ID, "intent", "default") },
      { kind: "branch", id: monitorPipelineBranchNodeId(PIPELINE_ID, MODEL_BRANCH) },
      { kind: "stage", id: monitorPipelineStageNodeId(PIPELINE_ID, "plan", MODEL_BRANCH) },
      { kind: "stage", id: monitorPipelineStageNodeId(PIPELINE_ID, "implement", MODEL_BRANCH) },
      { kind: "branch", id: monitorPipelineBranchNodeId(PIPELINE_ID, MONITOR_BRANCH) },
      { kind: "stage", id: monitorPipelineStageNodeId(PIPELINE_ID, "plan", MONITOR_BRANCH) },
      { kind: "stage", id: monitorPipelineStageNodeId(PIPELINE_ID, "implement", MONITOR_BRANCH) },
    ]);
  });

  test("a post-split default placeholder row is absent while a pre-split default stage renders", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return stage.position >= splitPosition && stage.branchKey === MONITOR_TREE_DEFAULT_BRANCH_KEY;" -> "return false;"
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "plan", branchKey: MODEL_BRANCH, position: 2, status: "succeeded" }),
        snapshotStage({ stageId: "plan", position: 2, status: "skipped" }),
      ],
    });
    const pipelineNodes = joinTree([snapshot]);
    const pipeline = pipelineNodes[0];
    if (pipeline === undefined) throw new Error("expected pipeline node");
    // Expand every branch the join actually produced, including a spurious `default` branch a
    // disabled elision guard would create, so its placeholder stage would surface if unelided.
    const expanded = new Set([PIPELINE_ID, ...pipeline.branches.map((branch) => branch.id)]);

    const ids = flattenJoined(pipelineNodes, expanded, null, 20).map((node) => node.id);

    expect(ids).not.toContain(monitorPipelineStageNodeId(PIPELINE_ID, "plan", "default"));
    expect(ids).toContain(monitorPipelineStageNodeId(PIPELINE_ID, "intent", "default"));
  });

  test("branch labels strip the prefix shared by siblings and a lone branch keeps its full key", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (branchKeys.length < 2) return [...branchKeys];" -> "if (branchKeys.length < 0) return [...branchKeys];"
    expect(strippedBranchLabels(["tui-pipeline-list-poll", MODEL_BRANCH, MONITOR_BRANCH])).toEqual([
      "list-poll",
      "tree-model",
      "tree-monitor",
    ]);
    expect(strippedBranchLabels(["only-branch-key"])).toEqual(["only-branch-key"]);
    expect(strippedBranchLabels(["alpha", "beta"])).toEqual(["alpha", "beta"]);
  });

  test("a branch summarizes as its first unsatisfied stage and falls back to its last stage status", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "!SATISFIED_BRANCH_STAGE_STATUSES.has(record.status)" -> "record.status !== \"succeeded\""
    const branchKey = "model";
    const midFlight = pipelineSnapshot({
      pipelineId: "pipe-mid-flight",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "plan", branchKey, position: 2, status: "succeeded" }),
        snapshotStage({ stageId: "implement", branchKey, position: 4, status: "running" }),
      ],
    });
    const settled = pipelineSnapshot({
      pipelineId: "pipe-settled",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "plan", branchKey, position: 2, status: "succeeded" }),
        snapshotStage({ stageId: "implement", branchKey, position: 4, status: "approved" }),
        snapshotStage({ stageId: "cleanup", branchKey, position: 6, status: "skipped" }),
      ],
    });
    const rejected = pipelineSnapshot({
      pipelineId: "pipe-rejected",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "approve-plan", branchKey, position: 2, status: "rejected" }),
      ],
    });

    const [midFlightNode, settledNode, rejectedNode] = joinTree([midFlight, settled, rejected]);

    expect(midFlightNode?.branches[0]).toMatchObject({ summaryStageId: "implement", summaryStatus: "running" });
    expect(settledNode?.branches[0]).toMatchObject({ summaryStageId: "cleanup", summaryStatus: "skipped" });
    expect(rejectedNode?.branches[0]).toMatchObject({ summaryStageId: "approve-plan", summaryStatus: "rejected" });
  });

  test("selecting a run under a branch expands that branch only and leaves sibling branches collapsed", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (run.id === selectedNodeId) return new Set([pipeline.id, branch.id, stage.id]);" -> "if (run.id === selectedNodeId) return new Set([pipeline.id, stage.id]);"
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        implementStage("inv-alpha", { branchKey: "alpha", position: 2 }),
        implementStage("inv-beta", { branchKey: "beta", position: 2 }),
      ],
    });
    const runs = [
      workflowRun({ runId: "run-alpha", status: "in-progress" }, "inv-alpha"),
      workflowRun({ runId: "run-beta", status: "in-progress" }, "inv-beta"),
    ];

    const displayNodes = flattenJoined(joinTree([snapshot], runs), new Set(), "run-alpha", 20, runs);

    expect(displayNodes.map((node) => node.id)).toEqual([
      PIPELINE_ID,
      monitorPipelineStageNodeId(PIPELINE_ID, "intent", "default"),
      monitorPipelineBranchNodeId(PIPELINE_ID, "alpha"),
      monitorPipelineStageNodeId(PIPELINE_ID, "implement", "alpha"),
      "run-alpha",
      monitorPipelineBranchNodeId(PIPELINE_ID, "beta"),
    ]);
  });

  test("a branch node id is expandable and toggling it collapses its stages", () => {
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        implementStage(INVOCATION_MATCHED, { branchKey: "alt", position: 2 }),
      ],
    });
    const pipelineNodes = joinTree([snapshot]);
    const branchId = monitorPipelineBranchNodeId(PIPELINE_ID, "alt");

    expect(isExpandablePipelineNodeId(pipelineNodes, branchId)).toBe(true);

    const collapsed = flattenJoined(pipelineNodes, new Set([PIPELINE_ID]), null, 20);
    const expanded = flattenJoined(pipelineNodes, new Set([PIPELINE_ID, branchId]), null, 20);
    const collapsedAgain = flattenJoined(pipelineNodes, new Set([PIPELINE_ID]), null, 20);

    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "alt");
    expect(collapsed.some((node) => node.id === stageId)).toBe(false);
    expect(expanded.some((node) => node.id === stageId)).toBe(true);
    expect(collapsedAgain.map((node) => node.id)).toEqual(collapsed.map((node) => node.id));
  });
});

describe("gate elision and intent yield", () => {
  function fullReviewStage(
    stageId: string,
    position: number,
    status: string,
    overrides?: Partial<PipelineSnapshot["stages"][number]>,
  ): PipelineSnapshot["stages"][number] {
    return snapshotStage({ stageId, position, status, ...overrides });
  }

  test("an approved gate row is absent while an awaiting gate row renders", () => {
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      name: "full-review",
      stages: [
        fullReviewStage("intent", 0, "succeeded"),
        fullReviewStage("approve-intent", 1, "approved"),
        fullReviewStage("plan", 2, "succeeded"),
        fullReviewStage("approve-plan", 3, "awaiting"),
        fullReviewStage("implement", 4, "pending"),
      ],
    });
    const pipelineNodes = joinTree([snapshot]);
    const ids = flattenJoined(pipelineNodes, new Set([PIPELINE_ID]), null, 20).map((node) => node.id);
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return status !== \"awaiting\" && status !== \"rejected\";" -> "return false;"

    expect(ids).not.toContain(monitorPipelineStageNodeId(PIPELINE_ID, "approve-intent", "default"));
    expect(ids).toContain(monitorPipelineStageNodeId(PIPELINE_ID, "approve-plan", "default"));
    expect(ids).toContain(monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default"));
  });

  test("a post-split workflow stage settled skipped still renders under its branch", () => {
    const branchKey = "alpha";
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      name: "full-review",
      stages: [
        fullReviewStage("intent", 0, "succeeded"),
        fullReviewStage("approve-intent", 1, "approved"),
        fullReviewStage("plan", 2, "succeeded", { branchKey }),
        fullReviewStage("approve-plan", 3, "awaiting", { branchKey }),
        fullReviewStage("implement", 4, "skipped", { branchKey }),
      ],
    });
    const pipelineNodes = joinTree([snapshot]);
    const branchId = monitorPipelineBranchNodeId(PIPELINE_ID, branchKey);
    const ids = flattenJoined(pipelineNodes, new Set([PIPELINE_ID, branchId]), null, 20).map((node) => node.id);
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (kind !== \"approval\") return false;" -> "if (kind === \"approval\") return false;"

    expect(ids).not.toContain(monitorPipelineStageNodeId(PIPELINE_ID, "approve-intent", "default"));
    expect(ids).toContain(monitorPipelineStageNodeId(PIPELINE_ID, "implement", branchKey));
  });

  test("a skipped gate row is absent from a fanned-out branch subtree", () => {
    const branchKey = "beta";
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      name: "full-review",
      stages: [
        fullReviewStage("intent", 0, "succeeded"),
        fullReviewStage("approve-intent", 1, "approved"),
        fullReviewStage("plan", 2, "succeeded", { branchKey }),
        fullReviewStage("approve-plan", 3, "skipped", { branchKey }),
        fullReviewStage("implement", 4, "running", { branchKey }),
      ],
    });
    const pipelineNodes = joinTree([snapshot]);
    const branchId = monitorPipelineBranchNodeId(PIPELINE_ID, branchKey);
    const ids = flattenJoined(pipelineNodes, new Set([PIPELINE_ID, branchId]), null, 20).map((node) => node.id);
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (!resolved.ok) return new Map();" -> "if (resolved.ok) return new Map();"

    expect(ids).not.toContain(monitorPipelineStageNodeId(PIPELINE_ID, "approve-plan", branchKey));
  });

  test("the intent stage row appends the split yield only when the artifact lists downstream inputs", () => {
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({
          stageId: "intent",
          position: 0,
          status: "succeeded",
          artifact: { downstreamInputs: ["a.md", "b.md", "c.md"] },
        }),
        snapshotStage({ stageId: "plan", position: 1, status: "pending", artifact: null }),
      ],
    });
    const stages = joinTree([snapshot])[0]?.stages ?? [];
    const intentStage = stages.find((stage) => stage.stageId === "intent");
    const planStage = stages.find((stage) => stage.stageId === "plan");
    expect(intentStage).toBeDefined();
    expect(planStage).toBeDefined();
    if (intentStage === undefined || planStage === undefined) throw new Error("expected intent and plan stages");
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (inputs.length === 0) return \"\";" -> "if (inputs.length < 0) return \"\";"

    const intentRow = buildStageMonitorTreeRow(intentStage, 90, FILTER_NOW_MS);
    const planRow = buildStageMonitorTreeRow(planStage, 90, FILTER_NOW_MS);

    expect(labelSegment(intentRow).trimEnd()).toBe("intent → 3 intents");
    expect(labelSegment(planRow).trimEnd()).toBe("plan");
  });
});

describe("row semantics", () => {
  test("derives structural expansion glyphs and pipeline-local attention", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "const annotatedPipeline = withExpansionMarker({ ...pipeline, attention: pipelineAttentionSummary(pipeline) }, effectiveExpansion);" -> "const annotatedPipeline = pipeline;"
    const invocation = "inv-glyph-run";
    const withRun = pipelineSnapshot({
      pipelineId: "pipe-glyph-run",
      stages: [implementStage(invocation, { status: "running" })],
    });
    const empty = pipelineSnapshot({ pipelineId: "pipe-glyph-empty", stages: [] });
    const leafStage = pipelineSnapshot({
      pipelineId: "pipe-glyph-leaf-stage",
      stages: [snapshotStage({ stageId: "plan", status: "pending" })],
    });
    const run = workflowRun({ runId: "run-glyph", status: "in-progress" }, invocation);
    const pipelineNodes = joinTree([withRun, empty, leafStage], [run]);
    const stageId = monitorPipelineStageNodeId("pipe-glyph-run", "implement", "default");
    const leafStageId = monitorPipelineStageNodeId("pipe-glyph-leaf-stage", "plan", "default");

    // Mutation checkpoint: reporting an empty pipeline/stage as expandable must turn empty-node-leaf RED.
    expect(isExpandablePipelineNodeId(pipelineNodes, "pipe-glyph-run")).toBe(true);
    expect(isExpandablePipelineNodeId(pipelineNodes, "pipe-glyph-empty")).toBe(false);
    expect(isExpandablePipelineNodeId(pipelineNodes, stageId)).toBe(true);
    expect(isExpandablePipelineNodeId(pipelineNodes, leafStageId)).toBe(false);

    const collapsed = flattenJoined(pipelineNodes, new Set(), null, 20, [run]);
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return effectiveExpansion.has(node.id) ? \"▼\" : \"▶\";" -> "return effectiveExpansion.has(node.id) ? \"▶\" : \"▼\";"
    expect(collapsed.find((node) => node.id === "pipe-glyph-run")).toMatchObject({ marker: "▶", depth: 0 });
    expect(collapsed.find((node) => node.id === "pipe-glyph-empty")).toMatchObject({ marker: "", depth: 0 });

    const pipelineExpanded = flattenJoined(pipelineNodes, new Set(["pipe-glyph-run"]), null, 20, [run]);
    expect(pipelineExpanded.find((node) => node.id === "pipe-glyph-run")).toMatchObject({ marker: "▼", depth: 0 });
    expect(pipelineExpanded.find((node) => node.id === stageId)).toMatchObject({ marker: "▶", depth: 1 });

    const stageExpanded = flattenJoined(pipelineNodes, new Set(["pipe-glyph-run", stageId]), null, 20, [run]);
    expect(stageExpanded.find((node) => node.id === stageId)).toMatchObject({ marker: "▼", depth: 1 });
    expect(stageExpanded.find((node) => node.id === "run-glyph")).toMatchObject({ depth: 2 });

    const leafExpandedForced = flattenJoined(pipelineNodes, new Set(["pipe-glyph-leaf-stage", leafStageId]), null, 20);
    expect(leafExpandedForced.find((node) => node.id === leafStageId)).toMatchObject({ marker: "", depth: 1 });

    // An empty branch (no displayable stages) is a leaf too; structural emptiness alone gates it,
    // never reachable through buildStageNodes so it is exercised directly here.
    const emptyBranchPipelineId = "pipe-glyph-empty-branch";
    const emptyBranchId = monitorPipelineBranchNodeId(emptyBranchPipelineId, "alpha");
    const pipelineWithEmptyBranch: MonitorPipelineTreePipelineNode = {
      kind: "pipeline",
      id: emptyBranchPipelineId,
      depth: 0,
      snapshot: pipelineSnapshot({ pipelineId: emptyBranchPipelineId }),
      project: "",
      stages: [],
      branches: [
        {
          kind: "branch",
          id: emptyBranchId,
          depth: 1,
          pipelineId: emptyBranchPipelineId,
          branchKey: "alpha",
          label: "alpha",
          summaryStageId: "",
          summaryStatus: "",
          stages: [],
          startedAt: null,
          endedAt: null,
        },
      ],
    };
    // Mutation checkpoint: reporting an empty branch as expandable must turn empty-branch-leaf RED.
    expect(isExpandablePipelineNodeId([pipelineWithEmptyBranch], emptyBranchId)).toBe(false);
    const emptyBranchExpanded = flattenMonitorPipelineTree(
      [pipelineWithEmptyBranch],
      [],
      new Set([emptyBranchPipelineId, emptyBranchId]),
      null,
    );
    expect(emptyBranchExpanded.find((node) => node.id === emptyBranchId)).toMatchObject({ marker: "", depth: 1 });

    // Reachable depth 3: an expanded multi-step workflow stage nests a workflow-child run beneath
    // its workflow-collapsed parent.
    const multiInvocation = "inv-glyph-multi";
    const multiWorkflowSteps = [
      { stepId: "implement", role: "implement", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
      { stepId: "implement-review", role: "actuator", status: "in_progress", attemptCount: 1 },
    ] as const;
    const multiWorkflow = { invocationId: multiInvocation, steps: [...multiWorkflowSteps] };
    const multiSnapshot = pipelineSnapshot({
      pipelineId: "pipe-glyph-multi",
      stages: [implementStage(multiInvocation, { status: "running" })],
    });
    const multiRuns = [
      workflowRun({ runId: "run-multi-implement", status: "completed", isLive: false }, multiInvocation),
      {
        ...workflowRun({ runId: "run-multi-review", status: "in-progress" }, multiInvocation),
        stepId: "implement-review",
        workflow: multiWorkflow,
      },
    ];
    const multiStageId = monitorPipelineStageNodeId("pipe-glyph-multi", "implement", "default");
    const multiExpanded = flattenJoined(
      joinTree([multiSnapshot], multiRuns),
      new Set(["pipe-glyph-multi", multiStageId]),
      null,
      20,
      multiRuns,
    );
    expect(multiExpanded.find((node) => node.id === "run-multi-implement")).toMatchObject({ depth: 3 });

    // Pipeline-local attention.
    const gateAndFailure = pipelineSnapshot({
      pipelineId: "pipe-attention-gate-failure",
      name: "full-review",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "approve-intent", position: 1, status: "awaiting" }),
        snapshotStage({ stageId: "plan", position: 2, status: "succeeded" }),
        implementStage(INVOCATION_MATCHED, { position: 3, branchKey: "alpha", status: "failed" }),
        // Post-split `default` placeholder every branch superseded; must not count toward attention.
        snapshotStage({ stageId: "implement", position: 3, status: "failed" }),
      ],
    });
    const rejectedGate = pipelineSnapshot({
      pipelineId: "pipe-attention-rejected-gate",
      name: "full-review",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "approve-intent", position: 1, status: "approved" }),
        snapshotStage({ stageId: "approve-plan", position: 2, status: "rejected" }),
      ],
    });
    const unresolvedDefinition = pipelineSnapshot({
      pipelineId: "pipe-attention-unresolved",
      name: "unregistered-pipeline",
      stages: [snapshotStage({ stageId: "implement", position: 0, status: "failed" })],
    });
    const attentionNodes = joinTree([gateAndFailure, rejectedGate, unresolvedDefinition]);
    const gateAndFailureNode = attentionNodes.find((node) => node.id === "pipe-attention-gate-failure");
    const rejectedGateNode = attentionNodes.find((node) => node.id === "pipe-attention-rejected-gate");
    const unresolvedNode = attentionNodes.find((node) => node.id === "pipe-attention-unresolved");
    if (gateAndFailureNode === undefined || rejectedGateNode === undefined || unresolvedNode === undefined) {
      throw new Error("expected pipeline nodes");
    }
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (!resolved.ok) return new Map();" -> "if (resolved.ok) return new Map();"
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (isElidedPlaceholderStage(stage, splitPosition)) continue;" -> "if (false) continue;"
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (gateCount > 0) atoms.push(`✋${gateCount}`);" -> "atoms.push(`✋${gateCount}`);"
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (failedCount > 0) atoms.push(`✗${failedCount}`);" -> "atoms.push(`✗${failedCount}`);"
    expect(pipelineAttentionSummary(gateAndFailureNode)).toBe("✋1 ✗1");
    expect(pipelineAttentionSummary(rejectedGateNode)).toBe("✋1");
    expect(pipelineAttentionSummary(unresolvedNode)).toBe("✗1");
  });
});

describe("monitor pipeline tree elapsed cells", () => {
  const PIPELINE_START_MS = 1_700_000_000_000;
  const STAGE_START_MS = PIPELINE_START_MS + 60_000;
  const RUN_START_MS = PIPELINE_START_MS + 300_000;
  const ACTIVE_NOW_MS = PIPELINE_START_MS + 600_000;
  const PIPELINE_END_MS = PIPELINE_START_MS + 120_000;
  const STAGE_END_MS = PIPELINE_START_MS + 180_000;
  const RUN_END_MS = PIPELINE_START_MS + 360_000;
  const ELAPSED_INVOCATION = "inv-elapsed";

  function elapsedFixture(nowMs: number) {
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      createdAt: PIPELINE_START_MS,
      finishedAtMs: null,
      stages: [
        implementStage(ELAPSED_INVOCATION, {
          startedAt: STAGE_START_MS,
          endedAt: null,
        }),
      ],
    });
    const run = workflowRun(
      { runId: "run-elapsed", status: "in-progress", createdAt: RUN_START_MS },
      ELAPSED_INVOCATION,
    );
    const pipelineNodes = joinTree([snapshot], [run]);
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const displayNodes = flattenJoined(pipelineNodes, new Set([PIPELINE_ID, stageId]), null, 10, [run]);
    const pipelineNode = displayNodes.find((node) => node.kind === "pipeline");
    const stageNode = displayNodes.find((node) => node.kind === "stage");
    const runNode = displayNodes.find((node) => node.kind === "run");
    if (pipelineNode?.kind !== "pipeline" || stageNode?.kind !== "stage" || runNode?.kind !== "run") {
      throw new Error("expected pipeline, stage, and run nodes");
    }
    return {
      pipelineElapsed: clusterAtoms(buildPipelineMonitorTreeRow(pipelineNode, 90, nowMs)).at(-1) ?? "",
      stageElapsed: clusterAtoms(buildStageMonitorTreeRow(stageNode, 90, nowMs)).at(-1) ?? "",
      runElapsed: clusterAtoms(buildTreeRunRow(runNode.tableRow, runNode.depth, 90, nowMs)).at(-1) ?? "",
    };
  }

  test("active pipeline stage and run rows render independent elapsed from injected nowMs", () => {
    const elapsed = elapsedFixture(ACTIVE_NOW_MS);

    expect(elapsed.pipelineElapsed).toBe(formatElapsedWallClock(PIPELINE_START_MS, null, ACTIVE_NOW_MS));
    expect(elapsed.stageElapsed).toBe(formatElapsedWallClock(STAGE_START_MS, null, ACTIVE_NOW_MS));
    expect(elapsed.runElapsed).toBe(formatElapsedWallClock(RUN_START_MS, null, ACTIVE_NOW_MS));
    expect(elapsed.pipelineElapsed).not.toBe(elapsed.stageElapsed);
    expect(elapsed.stageElapsed).not.toBe(elapsed.runElapsed);
    expect(elapsed.pipelineElapsed).not.toBe(elapsed.runElapsed);
  });

  test("terminal pipeline stage and run rows freeze elapsed at recorded end times", () => {
    // Mutation checkpoint: passing null for finishedAtMs/endedAt/finishedAtMs on terminal rows must turn terminal freeze RED.
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      createdAt: PIPELINE_START_MS,
      finishedAtMs: PIPELINE_END_MS,
      state: "succeeded",
      stages: [
        implementStage(ELAPSED_INVOCATION, {
          startedAt: STAGE_START_MS,
          endedAt: STAGE_END_MS,
          status: "succeeded",
        }),
      ],
    });
    const run = workflowRun(
      {
        runId: "run-elapsed",
        status: "completed",
        isLive: false,
        createdAt: RUN_START_MS,
        finishedAtMs: RUN_END_MS,
      },
      ELAPSED_INVOCATION,
    );
    const pipelineNodes = joinTree([snapshot], [run]);
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const displayNodes = flattenJoined(pipelineNodes, new Set([PIPELINE_ID, stageId]), null, 10, [run]);
    const pipelineNode = displayNodes.find((node) => node.kind === "pipeline");
    const stageNode = displayNodes.find((node) => node.kind === "stage");
    const runNode = displayNodes.find((node) => node.kind === "run");
    if (pipelineNode?.kind !== "pipeline" || stageNode?.kind !== "stage" || runNode?.kind !== "run") {
      throw new Error("expected pipeline, stage, and run nodes");
    }

    const frozenNowMs = ACTIVE_NOW_MS + 3_600_000;
    const atEnd = {
      pipelineElapsed: clusterAtoms(buildPipelineMonitorTreeRow(pipelineNode, 90, PIPELINE_END_MS)).at(-1) ?? "",
      stageElapsed: clusterAtoms(buildStageMonitorTreeRow(stageNode, 90, STAGE_END_MS)).at(-1) ?? "",
      runElapsed: clusterAtoms(buildTreeRunRow(runNode.tableRow, runNode.depth, 90, RUN_END_MS)).at(-1) ?? "",
    };
    const later = {
      pipelineElapsed: clusterAtoms(buildPipelineMonitorTreeRow(pipelineNode, 90, frozenNowMs)).at(-1) ?? "",
      stageElapsed: clusterAtoms(buildStageMonitorTreeRow(stageNode, 90, frozenNowMs)).at(-1) ?? "",
      runElapsed: clusterAtoms(buildTreeRunRow(runNode.tableRow, runNode.depth, 90, frozenNowMs)).at(-1) ?? "",
    };

    expect(atEnd.pipelineElapsed).toBe(formatElapsedWallClock(PIPELINE_START_MS, PIPELINE_END_MS, PIPELINE_END_MS));
    expect(atEnd.stageElapsed).toBe(formatElapsedWallClock(STAGE_START_MS, STAGE_END_MS, STAGE_END_MS));
    expect(atEnd.runElapsed).toBe(formatElapsedWallClock(RUN_START_MS, RUN_END_MS, RUN_END_MS));
    expect(later).toEqual(atEnd);
  });

  test("stage row elapsed is empty when startedAt is null", () => {
    // Mutation checkpoint: passing null for startedAt when unset must turn empty-stage-elapsed RED.
    const stageNode = {
      kind: "stage" as const,
      id: monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default"),
      depth: 1,
      stageId: "implement",
      label: "implement",
      branchKey: "default",
      status: "pending",
      startedAt: null,
      endedAt: null,
      runs: [],
    };

    // No elapsed atom is composed at all; only the status atom remains in the cluster.
    expect(clusterAtoms(buildStageMonitorTreeRow(stageNode, 90, ACTIVE_NOW_MS))).toEqual(["pending"]);
  });

  test("branch elapsed spans its displayable stage records", () => {
    const branchKey = "alpha";
    const beforeStart = pipelineSnapshot({
      pipelineId: "pipe-branch-elapsed-before",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        implementStage("inv-before", { branchKey, position: 2, status: "pending" }),
      ],
    });
    const active = pipelineSnapshot({
      pipelineId: "pipe-branch-elapsed-active",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({
          stageId: "plan",
          branchKey,
          position: 2,
          status: "succeeded",
          startedAt: STAGE_START_MS,
          endedAt: STAGE_START_MS + 30_000,
        }),
        implementStage("inv-active", {
          branchKey,
          position: 3,
          status: "running",
          startedAt: STAGE_START_MS + 60_000,
          endedAt: null,
        }),
      ],
    });
    const terminal = pipelineSnapshot({
      pipelineId: "pipe-branch-elapsed-terminal",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({
          stageId: "plan",
          branchKey,
          position: 2,
          status: "succeeded",
          startedAt: STAGE_START_MS,
          endedAt: STAGE_START_MS + 30_000,
        }),
        implementStage("inv-terminal", {
          branchKey,
          position: 3,
          status: "succeeded",
          startedAt: STAGE_START_MS + 60_000,
          endedAt: STAGE_START_MS + 90_000,
        }),
      ],
    });

    const beforeBranch = joinTree([beforeStart])[0]?.branches[0];
    const activeBranch = joinTree([active])[0]?.branches[0];
    const terminalBranch = joinTree([terminal])[0]?.branches[0];
    if (beforeBranch === undefined || activeBranch === undefined || terminalBranch === undefined) {
      throw new Error("expected branch nodes");
    }

    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "const startedAt = starts.length === 0 ? null : Math.min(...starts);" -> "const startedAt = starts.length === 0 ? null : Math.max(...starts);"
    expect(beforeBranch.startedAt).toBeNull();
    expect(beforeBranch.endedAt).toBeNull();
    expect(formatElapsedWallClock(beforeBranch.startedAt, beforeBranch.endedAt, ACTIVE_NOW_MS)).toBe("");

    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "const allEnded = stages.length > 0 && stages.every((stage) => stage.endedAt !== null);" -> "const allEnded = true;"
    expect(activeBranch.startedAt).toBe(STAGE_START_MS);
    expect(activeBranch.endedAt).toBeNull();
    const activeElapsedEarly = formatElapsedWallClock(activeBranch.startedAt, activeBranch.endedAt, ACTIVE_NOW_MS);
    const activeElapsedLater = formatElapsedWallClock(
      activeBranch.startedAt,
      activeBranch.endedAt,
      ACTIVE_NOW_MS + 60_000,
    );
    expect(activeElapsedEarly).toBe(formatElapsedWallClock(STAGE_START_MS, null, ACTIVE_NOW_MS));
    expect(activeElapsedEarly).not.toBe(activeElapsedLater);

    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "const endedAt = allEnded ? Math.max(...stages.map((stage) => stage.endedAt as number)) : null;" -> "const endedAt = null;"
    expect(terminalBranch.startedAt).toBe(STAGE_START_MS);
    expect(terminalBranch.endedAt).toBe(STAGE_START_MS + 90_000);
    const terminalElapsedAtEnd = formatElapsedWallClock(
      terminalBranch.startedAt,
      terminalBranch.endedAt,
      STAGE_START_MS + 90_000,
    );
    const terminalElapsedLater = formatElapsedWallClock(
      terminalBranch.startedAt,
      terminalBranch.endedAt,
      STAGE_START_MS + 3_600_000,
    );
    expect(terminalElapsedAtEnd).toBe(terminalElapsedLater);
  });
});

describe("buildMonitorPipelineTree", () => {
  test("maps snapshots, runs, expansion, and selection to ordered display nodes", () => {
    const { snapshot, run } = pipelineWithStageAndRun(PIPELINE_ID, INVOCATION_MATCHED, "run-implement");
    const expanded = new Set([PIPELINE_ID, monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default")]);

    const displayNodes = buildMonitorPipelineTree([snapshot], [run], expanded, null);

    expect(displayNodes.map((node) => ({ kind: node.kind, id: node.id, depth: node.depth }))).toEqual([
      { kind: "pipeline", id: PIPELINE_ID, depth: 0 },
      {
        kind: "stage",
        id: monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default"),
        depth: 1,
      },
      { kind: "run", id: "run-implement", depth: 2 },
    ]);
  });

  test("ad-hoc work items order among pipelines by rank then finish", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "workflowGroupHasActiveMember(members)" -> "true"
    const runningPipeline = pipelineSnapshot({ pipelineId: "pipe-running", createdAt: 1000, finishedAtMs: null });
    const terminalPipeline = pipelineSnapshot({
      pipelineId: "pipe-terminal",
      createdAt: 50,
      state: "succeeded",
      finishedAtMs: 300,
    });
    const activeAdHocRun = workflowRun(
      { runId: "run-active-adhoc", status: "in-progress", createdAt: 1500 },
      "inv-active-adhoc",
    );
    // createdAt is earlier than every running top-level item's createdAt (1000, 1500) — the
    // rank-checkpoint fixture invariant: promoting this item to "running" is the only thing that
    // moves it, since non-terminal items sort by createdAt ascending.
    const terminalAdHocRun = workflowRun(
      { runId: "run-terminal-adhoc", status: "completed", isLive: false, finishedAtMs: 500, createdAt: 10 },
      "inv-terminal-adhoc",
    );

    const displayNodes = buildMonitorPipelineTree(
      [runningPipeline, terminalPipeline],
      [activeAdHocRun, terminalAdHocRun],
      new Set(),
      null,
    );

    expect(displayNodes.map((node) => ({ kind: node.kind, id: node.id }))).toEqual([
      { kind: "pipeline", id: "pipe-running" },
      { kind: "adhoc", id: "run-active-adhoc" },
      { kind: "adhoc", id: "run-terminal-adhoc" },
      { kind: "pipeline", id: "pipe-terminal" },
    ]);
  });
});

describe("flattenMonitorPipelineTree workflow constituent rows", () => {
  const MULTI_INVOCATION = "inv-multi";
  const MULTI_WORKFLOW_STEPS = [
    { stepId: "implement", role: "implement", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
    { stepId: "implement-review", role: "actuator", status: "in_progress", attemptCount: 1 },
  ] as const;

  function multiMemberRuns(): DaemonListRunRow[] {
    const workflow = { invocationId: MULTI_INVOCATION, steps: [...MULTI_WORKFLOW_STEPS] };
    return [
      workflowRun({ runId: "run-implement", status: "completed", isLive: false }, MULTI_INVOCATION),
      {
        ...workflowRun({ runId: "run-review", status: "in-progress" }, MULTI_INVOCATION),
        stepId: "implement-review",
        workflow,
      },
    ];
  }

  function flattenSelectedMultiMemberStage(
    expandedNodeIds: ReadonlySet<string>,
    selectedNodeId: string,
  ): MonitorPipelineTreeDisplayNode[] {
    const _stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [implementStage(MULTI_INVOCATION)],
    });
    const runs = multiMemberRuns();
    return flattenJoined(joinTree([snapshot], runs), expandedNodeIds, selectedNodeId, 10, runs);
  }

  test("collapsed stage under an expanded pipeline emits one workflow-collapsed run row at depth 2", () => {
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [implementStage(MULTI_INVOCATION)],
    });
    const runs = multiMemberRuns();
    const displayNodes = flattenJoined(joinTree([snapshot], runs), new Set([PIPELINE_ID]), null, 10, runs);
    const runNodes = displayNodes.filter((node) => node.kind === "run");

    expect(runNodes).toHaveLength(1);
    expect(runNodes[0]).toMatchObject({ kind: "run", depth: 2 });
    expect(runNodes[0]?.kind === "run" ? runNodes[0].tableRow.kind : "").toBe("workflow-collapsed");
  });

  test("expanded stage emits workflow-collapsed parent at depth 2 plus workflow-child rows at depth 3", () => {
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [implementStage(MULTI_INVOCATION)],
    });
    const runs = multiMemberRuns();
    const displayNodes = flattenJoined(joinTree([snapshot], runs), new Set([PIPELINE_ID, stageId]), null, 10, runs);
    const runNodes = displayNodes.filter((node) => node.kind === "run");

    expect(runNodes.map((node) => ({ id: node.id, depth: node.depth, kind: node.tableRow.kind }))).toEqual([
      { id: "run-review", depth: 2, kind: "workflow-collapsed" },
      { id: "run-implement", depth: 3, kind: "workflow-child" },
    ]);
  });

  test("selected stage expansion toggles flatten output", () => {
    // Mutation checkpoint: re-adding the removed self-expand loop in resolveEffectiveExpansion must turn this RED.
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const collapsed = flattenSelectedMultiMemberStage(new Set(), stageId);
    const expanded = flattenSelectedMultiMemberStage(new Set([stageId]), stageId);

    expect(collapsed.map((node) => node.id)).not.toEqual(expanded.map((node) => node.id));
    expect(collapsed.filter((node) => node.kind === "run").map((node) => node.id)).toEqual(["run-review"]);
    expect(expanded.filter((node) => node.kind === "run").map((node) => node.id)).toEqual([
      "run-review",
      "run-implement",
    ]);
  });

  test("toggling expandedNodeIds on a selected stage round-trips flatten output", () => {
    // Mutation checkpoint: re-adding the removed self-expand loop in resolveEffectiveExpansion must turn this RED.
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const collapsed = flattenSelectedMultiMemberStage(new Set(), stageId);
    const expanded = flattenSelectedMultiMemberStage(new Set([stageId]), stageId);
    const collapsedAgain = flattenSelectedMultiMemberStage(new Set(), stageId);

    expect(collapsed.map((node) => node.id)).toEqual(collapsedAgain.map((node) => node.id));
    expect(collapsed.map((node) => node.id)).not.toEqual(expanded.map((node) => node.id));
  });
});

describe("flattenMonitorPipelineTree collapse", () => {
  test("a collapsed pipeline omits its stage and run descendants", () => {
    // Mutation checkpoint: showing stage descendants when the pipeline id is absent from effective expansion must turn pipeline collapse RED.
    const { snapshot, run } = pipelineWithStageAndRun(PIPELINE_ID, INVOCATION_MATCHED, "run-implement");
    const displayNodes = flattenJoined(joinTree([snapshot], [run]), new Set(), null, 10);

    expect(displayNodes).toEqual([expect.objectContaining({ kind: "pipeline", id: PIPELINE_ID, depth: 0 })]);
  });

  test("a collapsed stage omits only its runs while the stage row stays visible", () => {
    // Mutation checkpoint: hiding the stage row when only runs are collapsed must turn stage collapse RED.
    const { snapshot, run } = pipelineWithStageAndRun(PIPELINE_ID, INVOCATION_MATCHED, "run-implement");
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const displayNodes = flattenJoined(joinTree([snapshot], [run]), new Set([PIPELINE_ID]), null, 10);

    expect(displayNodes.map((node) => node.kind)).toEqual(["pipeline", "stage", "run"]);
    expect(displayNodes[1]).toMatchObject({ kind: "stage", id: stageId, depth: 1 });
  });
});

describe("flattenMonitorPipelineTree reveal-on-select", () => {
  test("selecting a descendant expands ancestors only and leaves sibling pipelines collapsed", () => {
    // Mutation checkpoint: omitting selected-node ancestors from effective expansion must turn reveal-on-select RED.
    const first = pipelineWithStageAndRun("pipe-one", "inv-one", "run-one");
    const second = pipelineWithStageAndRun("pipe-two", "inv-two", "run-two");
    const runs = [first.run, second.run];
    const displayNodes = flattenJoined(
      joinTree([first.snapshot, second.snapshot], runs),
      new Set(),
      "run-two",
      20,
      runs,
    );

    expect(displayNodes.map((node) => ({ kind: node.kind, id: node.id }))).toEqual([
      { kind: "pipeline", id: "pipe-one" },
      { kind: "pipeline", id: "pipe-two" },
      {
        kind: "stage",
        id: monitorPipelineStageNodeId("pipe-two", "implement", "default"),
      },
      { kind: "run", id: "run-two" },
    ]);
  });

  test("selecting a run reveals ancestor stages only and leaves sibling stage runs collapsed", () => {
    // Mutation checkpoint: expanding stage runs without stage-id membership in effective expansion must turn sibling-stage collapse RED.
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        implementStage("inv-plan", { stageId: "plan", status: "succeeded" }),
        implementStage("inv-implement", { stageId: "implement", status: "running" }),
      ],
    });
    const runs = [
      workflowRun({ runId: "run-plan", status: "completed", isLive: false }, "inv-plan"),
      workflowRun({ runId: "run-implement", status: "in-progress" }, "inv-implement"),
    ];
    const planStageId = monitorPipelineStageNodeId(PIPELINE_ID, "plan", "default");
    const implementStageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const displayNodes = flattenJoined(joinTree([snapshot], runs), new Set(), "run-plan", 20, runs);

    expect(displayNodes.map((node) => ({ kind: node.kind, id: node.id }))).toEqual([
      { kind: "pipeline", id: PIPELINE_ID },
      { kind: "stage", id: planStageId },
      { kind: "run", id: "run-plan" },
      { kind: "stage", id: implementStageId },
      { kind: "run", id: "run-implement" },
    ]);
  });
});

describe("flattenMonitorPipelineTree ordering", () => {
  test("top-level rows order running before gated before terminal", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "state === GATED_PIPELINE_STATE" -> "false"
    const snapshots = [
      pipelineSnapshot({ pipelineId: "running-1000", createdAt: 1000, finishedAtMs: null }),
      pipelineSnapshot({ pipelineId: "running-2000", createdAt: 2000, finishedAtMs: null }),
      pipelineSnapshot({
        pipelineId: "gated-100",
        createdAt: 100,
        state: "awaiting-approval",
        finishedAtMs: null,
      }),
      pipelineSnapshot({
        pipelineId: "gated-500",
        createdAt: 500,
        state: "awaiting-approval",
        finishedAtMs: null,
      }),
      pipelineSnapshot({ pipelineId: "terminal", createdAt: 50, state: "succeeded", finishedAtMs: 900 }),
    ];
    const displayNodes = flattenJoined(
      joinTree(snapshots),
      new Set(["running-1000", "running-2000", "gated-100", "gated-500", "terminal"]),
      null,
      20,
    );

    expect(displayNodes.filter((node) => node.kind === "pipeline").map((node) => node.id)).toEqual([
      "running-1000",
      "running-2000",
      "gated-100",
      "gated-500",
      "terminal",
    ]);
  });

  test("terminal rows order newest finish first", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return (b.finishedAtMs ?? b.createdAt) - (a.finishedAtMs ?? a.createdAt);" -> "return (a.finishedAtMs ?? a.createdAt) - (b.finishedAtMs ?? b.createdAt);"
    const snapshots = [
      pipelineSnapshot({ pipelineId: "terminal-old", createdAt: 50, state: "succeeded", finishedAtMs: 300 }),
      pipelineSnapshot({ pipelineId: "terminal-new", createdAt: 100, state: "succeeded", finishedAtMs: 500 }),
    ];
    const displayNodes = flattenJoined(joinTree(snapshots), new Set(["terminal-old", "terminal-new"]), null, 20);

    expect(displayNodes.filter((node) => node.kind === "pipeline").map((node) => node.id)).toEqual([
      "terminal-new",
      "terminal-old",
    ]);
  });

  test("a finishless terminal row sorts by createdAt among terminals", () => {
    // Defensive-fallback fixture: the daemon's own derivePipelineFinishedAtMs always backfills a
    // real finish for terminal pipelines. This exercises the client-side createdAt fallback that
    // guards against parsePipelineList's unchecked wire-payload cast.
    const snapshots = [
      pipelineSnapshot({ pipelineId: "terminal-newest", createdAt: 300, state: "succeeded", finishedAtMs: 900 }),
      pipelineSnapshot({ pipelineId: "terminal-finishless", createdAt: 500, state: "succeeded", finishedAtMs: null }),
      pipelineSnapshot({ pipelineId: "terminal-oldest", createdAt: 100, state: "succeeded", finishedAtMs: 300 }),
    ];
    const displayNodes = flattenJoined(
      joinTree(snapshots),
      new Set(["terminal-newest", "terminal-finishless", "terminal-oldest"]),
      null,
      20,
    );

    expect(displayNodes.filter((node) => node.kind === "pipeline").map((node) => node.id)).toEqual([
      "terminal-newest",
      "terminal-finishless",
      "terminal-oldest",
    ]);
  });
});

describe("flattenMonitorPipelineTree overflow retention", () => {
  test("expanded tree exceeding maxVisibleRows retains every pipeline id", () => {
    // Mutation checkpoint: re-enabling flatten-time dropOldestTerminalPipeline trimming in flattenMonitorPipelineTree must turn this pin RED; covers active-pipeline drop.
    const active = pipelineSnapshot({
      pipelineId: "pipe-active",
      createdAt: 100,
      finishedAtMs: null,
      stages: [implementStage("inv-active")],
    });
    const terminalStage = (invocationId: string) =>
      snapshotStage({ stageId: "plan", status: "succeeded", workflowInvocationId: invocationId });
    const terminalOld = pipelineSnapshot({
      pipelineId: "pipe-terminal-old",
      createdAt: 10,
      state: "succeeded",
      finishedAtMs: 100,
      stages: [terminalStage("inv-old"), implementStage("inv-old-2", { stageId: "implement", status: "succeeded" })],
    });
    const terminalNew = pipelineSnapshot({
      pipelineId: "pipe-terminal-new",
      createdAt: 20,
      state: "succeeded",
      finishedAtMs: 200,
      stages: [terminalStage("inv-new"), implementStage("inv-new-2", { stageId: "implement", status: "succeeded" })],
    });
    const snapshots = [terminalOld, active, terminalNew];
    const runs = [
      workflowRun({ runId: "run-active", status: "in-progress" }, "inv-active"),
      workflowRun({ runId: "run-old-plan", status: "completed", isLive: false }, "inv-old"),
      workflowRun({ runId: "run-old-implement", status: "completed", isLive: false }, "inv-old-2"),
      workflowRun({ runId: "run-new-plan", status: "completed", isLive: false }, "inv-new"),
      workflowRun({ runId: "run-new-implement", status: "completed", isLive: false }, "inv-new-2"),
    ];
    const snapshotsBefore = structuredClone(snapshots);
    const runsBefore = structuredClone(runs);
    const expanded = new Set([
      "pipe-active",
      monitorPipelineStageNodeId("pipe-active", "implement", "default"),
      "pipe-terminal-old",
      monitorPipelineStageNodeId("pipe-terminal-old", "plan", "default"),
      monitorPipelineStageNodeId("pipe-terminal-old", "implement", "default"),
      "pipe-terminal-new",
      monitorPipelineStageNodeId("pipe-terminal-new", "plan", "default"),
      monitorPipelineStageNodeId("pipe-terminal-new", "implement", "default"),
    ]);

    const displayNodes = flattenJoined(joinTree(snapshots, runs), expanded, null, 5, runs);

    expect(displayNodes.length).toBeGreaterThan(5);
    expect(displayNodes.filter((node) => node.kind === "pipeline").map((node) => node.id)).toEqual([
      "pipe-active",
      "pipe-terminal-new",
      "pipe-terminal-old",
    ]);
    expect(snapshots).toEqual(snapshotsBefore);
    expect(runs).toEqual(runsBefore);
  });

  test("omits collapsed pipeline descendant rows from flatten output", () => {
    // Mutation checkpoint: including collapsed pipeline descendant rows in flatten output must turn collapse-only pin RED.
    const collapsedTerminal = pipelineSnapshot({
      pipelineId: "pipe-collapsed-terminal",
      createdAt: 10,
      state: "succeeded",
      finishedAtMs: 100,
      stages: [
        snapshotStage({ stageId: "plan", status: "succeeded", workflowInvocationId: "inv-collapsed" }),
        snapshotStage({ stageId: "implement", status: "succeeded", workflowInvocationId: "inv-collapsed-2" }),
      ],
    });
    const expandedTerminal = pipelineSnapshot({
      pipelineId: "pipe-expanded-terminal",
      createdAt: 20,
      state: "succeeded",
      finishedAtMs: 200,
      stages: [snapshotStage({ stageId: "plan", status: "succeeded", workflowInvocationId: "inv-expanded" })],
    });
    const runs = [
      workflowRun({ runId: "run-collapsed-plan", status: "completed", isLive: false }, "inv-collapsed"),
      workflowRun({ runId: "run-collapsed-implement", status: "completed", isLive: false }, "inv-collapsed-2"),
      workflowRun({ runId: "run-expanded-plan", status: "completed", isLive: false }, "inv-expanded"),
    ];
    const expanded = new Set([
      "pipe-expanded-terminal",
      monitorPipelineStageNodeId("pipe-expanded-terminal", "plan", "default"),
    ]);
    const displayNodes = flattenJoined(joinTree([collapsedTerminal, expandedTerminal], runs), expanded, null, 4, runs);

    expect(displayNodes.map((node) => ({ kind: node.kind, id: node.id }))).toEqual([
      { kind: "pipeline", id: "pipe-expanded-terminal" },
      {
        kind: "stage",
        id: monitorPipelineStageNodeId("pipe-expanded-terminal", "plan", "default"),
      },
      { kind: "run", id: "run-expanded-plan" },
      { kind: "pipeline", id: "pipe-collapsed-terminal" },
    ]);
  });
});
