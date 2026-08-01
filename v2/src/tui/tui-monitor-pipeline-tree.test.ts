import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { formatElapsedWallClock } from "./tui-elapsed-format.ts";
import {
  buildMonitorPipelineTree,
  buildMonitorPipelineTreeJoin,
  buildPipelineMonitorTreeRow,
  buildStageMonitorTreeRow,
  flattenMonitorPipelineTree,
  type MonitorPipelineTreeDisplayNode,
  type MonitorPipelineTreePipelineNode,
  monitorPipelineStageNodeId,
  stageBranchCellValue,
} from "./tui-monitor-pipeline-tree.ts";
import { TUI_TERMINAL_WINDOW_MS } from "./tui-monitor-terminal-window.ts";
import { buildMonitorTreeRow, monitorTreeRun, TREE_COLUMN_WIDTHS, visibleColumns } from "./tui-shell-layout.ts";

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
    ...overrides,
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
  return buildMonitorPipelineTreeJoin(snapshots, runs, { filterNowMs: FILTER_NOW_MS }).pipelineNodes;
}

function flattenJoined(
  pipelineNodes: MonitorPipelineTreePipelineNode[],
  expandedNodeIds: ReadonlySet<string>,
  selectedNodeId: string | null,
  maxVisibleRows: number,
  builderRuns: readonly DaemonListRunRow[] = [],
) {
  return flattenMonitorPipelineTree(pipelineNodes, expandedNodeIds, selectedNodeId, maxVisibleRows, builderRuns);
}

function columnSlice(row: string, leftPaneWidth: number, column: keyof typeof TREE_COLUMN_WIDTHS): string {
  let offset = 0;
  for (const id of visibleColumns(leftPaneWidth)) {
    const width = TREE_COLUMN_WIDTHS[id];
    if (id === column) {
      return row.slice(offset, offset + width);
    }
    offset += width;
  }
  throw new Error(`column ${column} not visible at width ${leftPaneWidth}`);
}

function fullWidthRowLength(leftPaneWidth: number): number {
  return visibleColumns(leftPaneWidth).reduce((sum, column) => sum + TREE_COLUMN_WIDTHS[column], 0);
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

  test("places runs with no matching stage only in unattributed", () => {
    const { pipelineNodes, unattributedRows } = buildMonitorPipelineTreeJoin(
      [pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [implementStage(INVOCATION_MATCHED)] })],
      [workflowRun({ runId: "run-orphan", status: "completed", isLive: false }, INVOCATION_ORPHAN)],
      { filterNowMs: FILTER_NOW_MS },
    );

    expect(pipelineNodes[0]?.stages[0]?.runs).toHaveLength(0);
    expect(unattributedRows).toHaveLength(1);
    expect(unattributedRows[0]?.kind).toBe("workflow-collapsed");
    expect(unattributedRows[0] !== undefined ? monitorTreeRun(unattributedRows[0]).runId : "").toBe("run-orphan");
  });

  test("fan-out stages with the same stageId but different branchKey get distinct ids and branch cells", () => {
    // Mutation checkpoint: omitting branchKey from monitorPipelineStageNodeId must turn fan-out node id RED.
    const pipelineNodes = joinTree([
      pipelineSnapshot({
        pipelineId: PIPELINE_ID,
        stages: [
          snapshotStage({
            stageId: "plan",
            status: "succeeded",
            workflowInvocationId: "inv-plan-default",
          }),
          snapshotStage({
            stageId: "plan",
            branchKey: "alt",
            workflowInvocationId: "inv-plan-alt",
          }),
        ],
      }),
    ]);
    const stages = pipelineNodes[0]?.stages ?? [];

    expect(stages).toHaveLength(2);
    expect(stages[0]?.id).toBe(monitorPipelineStageNodeId(PIPELINE_ID, "plan", "default"));
    expect(stages[1]?.id).toBe(monitorPipelineStageNodeId(PIPELINE_ID, "plan", "alt"));
    expect(stages[0]?.kind).toBe("stage");
    expect(stages[1]?.kind).toBe("stage");
    expect(stageBranchCellValue("default")).toBe("");
    expect(stageBranchCellValue("alt")).toBe("alt");

    const defaultStage = stages[0];
    const altStage = stages[1];
    expect(defaultStage).toBeDefined();
    expect(altStage).toBeDefined();
    if (!defaultStage || !altStage) throw new Error("expected branch stages");
    const defaultRow = buildStageMonitorTreeRow(defaultStage, null, 90, FILTER_NOW_MS);
    const altRow = buildStageMonitorTreeRow(altStage, null, 90, FILTER_NOW_MS);
    expect(columnSlice(defaultRow, 90, "branch").trimEnd()).toBe("");
    expect(columnSlice(altRow, 90, "branch").trimEnd()).toBe("alt");
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

  test("pipeline and stage row helpers reserve column widths", () => {
    // Mutation checkpoint: omitting width padding in joinPipelineTreeCells must turn width reservation RED.
    const pipelineNode = {
      kind: "pipeline" as const,
      id: PIPELINE_ID,
      depth: 0,
      snapshot: pipelineSnapshot({ pipelineId: PIPELINE_ID }),
      project: "demo",
      stages: [],
    };
    const stageNode = {
      kind: "stage" as const,
      id: monitorPipelineStageNodeId(PIPELINE_ID, "implement", "feature"),
      depth: 1,
      stageId: "implement",
      branchKey: "feature",
      status: "running",
      startedAt: null,
      endedAt: null,
      runs: [],
    };

    const pipelineRow = buildPipelineMonitorTreeRow(pipelineNode, null, 90, FILTER_NOW_MS);
    const stageRow = buildStageMonitorTreeRow(stageNode, null, 90, FILTER_NOW_MS);

    expect(pipelineRow.length).toBe(fullWidthRowLength(90));
    expect(stageRow.length).toBe(fullWidthRowLength(90));
    expect(columnSlice(pipelineRow, 90, "project")).toBe("demo".padEnd(TREE_COLUMN_WIDTHS.project));
    expect(columnSlice(stageRow, 90, "branch")).toBe("feature".padEnd(TREE_COLUMN_WIDTHS.branch));
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

  test("excludes stage-matched and queued runs from unattributed while windowing orphans", () => {
    // Mutation checkpoint: negating matchedInvocationIds exclusion in isUnattributedCandidate must turn unattributed filtering RED.
    const staleFinishedAt = FILTER_NOW_MS - TUI_TERMINAL_WINDOW_MS - 1;
    const { pipelineNodes, unattributedRows } = buildMonitorPipelineTreeJoin(
      [pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [implementStage(INVOCATION_MATCHED)] })],
      [
        workflowRun({ runId: "run-matched", status: "in-progress" }, INVOCATION_MATCHED),
        workflowRun({ runId: "run-queued", status: "queued", isLive: false }, "inv-queued"),
        workflowRun(
          { runId: "run-stale-orphan", status: "completed", isLive: false, finishedAtMs: staleFinishedAt },
          INVOCATION_ORPHAN,
        ),
        workflowRun(
          { runId: "run-fresh-orphan", status: "completed", isLive: false, finishedAtMs: FILTER_NOW_MS - 60_000 },
          "inv-fresh",
        ),
      ],
      { filterNowMs: FILTER_NOW_MS },
    );

    expect(pipelineNodes[0]?.stages[0]?.runs.some((node) => node.id === "run-matched")).toBe(true);
    expect(unattributedRows.map((row) => monitorTreeRun(row).runId)).toEqual(["run-fresh-orphan"]);
    expect(unattributedRows.some((row) => monitorTreeRun(row).runId === "run-matched")).toBe(false);
    expect(unattributedRows.some((row) => monitorTreeRun(row).runId === "run-queued")).toBe(false);
    expect(unattributedRows.some((row) => monitorTreeRun(row).runId === "run-stale-orphan")).toBe(false);
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
    const displayNodes = flattenJoined(
      pipelineNodes,
      new Set([PIPELINE_ID, stageId]),
      null,
      10,
      [run],
    );
    const pipelineNode = displayNodes.find((node) => node.kind === "pipeline");
    const stageNode = displayNodes.find((node) => node.kind === "stage");
    const runNode = displayNodes.find((node) => node.kind === "run");
    if (pipelineNode?.kind !== "pipeline" || stageNode?.kind !== "stage" || runNode?.kind !== "run") {
      throw new Error("expected pipeline, stage, and run nodes");
    }
    return {
      pipelineElapsed: columnSlice(buildPipelineMonitorTreeRow(pipelineNode, null, 90, nowMs), 90, "elapsed").trimEnd(),
      stageElapsed: columnSlice(buildStageMonitorTreeRow(stageNode, null, 90, nowMs), 90, "elapsed").trimEnd(),
      runElapsed: columnSlice(
        buildMonitorTreeRow(runNode.tableRow, null, 90, nowMs),
        90,
        "elapsed",
      ).trimEnd(),
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
      pipelineElapsed: columnSlice(buildPipelineMonitorTreeRow(pipelineNode, null, 90, PIPELINE_END_MS), 90, "elapsed").trimEnd(),
      stageElapsed: columnSlice(buildStageMonitorTreeRow(stageNode, null, 90, STAGE_END_MS), 90, "elapsed").trimEnd(),
      runElapsed: columnSlice(buildMonitorTreeRow(runNode.tableRow, null, 90, RUN_END_MS), 90, "elapsed").trimEnd(),
    };
    const later = {
      pipelineElapsed: columnSlice(buildPipelineMonitorTreeRow(pipelineNode, null, 90, frozenNowMs), 90, "elapsed").trimEnd(),
      stageElapsed: columnSlice(buildStageMonitorTreeRow(stageNode, null, 90, frozenNowMs), 90, "elapsed").trimEnd(),
      runElapsed: columnSlice(buildMonitorTreeRow(runNode.tableRow, null, 90, frozenNowMs), 90, "elapsed").trimEnd(),
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
      branchKey: "default",
      status: "pending",
      startedAt: null,
      endedAt: null,
      runs: [],
    };

    expect(columnSlice(buildStageMonitorTreeRow(stageNode, null, 90, ACTIVE_NOW_MS), 90, "elapsed").trimEnd()).toBe("");
  });
});

describe("buildMonitorPipelineTree", () => {
  test("maps snapshots, runs, expansion, selection, and maxVisibleRows to ordered display nodes", () => {
    const { snapshot, run } = pipelineWithStageAndRun(PIPELINE_ID, INVOCATION_MATCHED, "run-implement");
    const expanded = new Set([PIPELINE_ID, monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default")]);

    const { displayNodes } = buildMonitorPipelineTree([snapshot], [run], expanded, null, 10, {
      filterNowMs: FILTER_NOW_MS,
    });

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
  test("orders active pipelines above terminals by createdAt then finishedAtMs", () => {
    // Mutation checkpoint: sorting terminals before actives or by createdAt among terminals must turn ordering RED.
    const snapshots = [
      pipelineSnapshot({ pipelineId: "pipe-terminal-late", createdAt: 400, state: "succeeded", finishedAtMs: 500 }),
      pipelineSnapshot({ pipelineId: "pipe-active-late", createdAt: 200, finishedAtMs: null }),
      pipelineSnapshot({ pipelineId: "pipe-terminal-early", createdAt: 50, state: "succeeded", finishedAtMs: 300 }),
      pipelineSnapshot({ pipelineId: "pipe-active-early", createdAt: 100, finishedAtMs: null }),
    ];
    const displayNodes = flattenJoined(
      joinTree(snapshots),
      new Set(["pipe-active-early", "pipe-active-late", "pipe-terminal-early", "pipe-terminal-late"]),
      null,
      20,
    );

    expect(displayNodes.filter((node) => node.kind === "pipeline").map((node) => node.id)).toEqual([
      "pipe-active-early",
      "pipe-active-late",
      "pipe-terminal-early",
      "pipe-terminal-late",
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
      "pipe-terminal-old",
      "pipe-terminal-new",
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
      { kind: "pipeline", id: "pipe-collapsed-terminal" },
      { kind: "pipeline", id: "pipe-expanded-terminal" },
      {
        kind: "stage",
        id: monitorPipelineStageNodeId("pipe-expanded-terminal", "plan", "default"),
      },
      { kind: "run", id: "run-expanded-plan" },
    ]);
  });
});
