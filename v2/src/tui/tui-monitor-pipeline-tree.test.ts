import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
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
import { monitorTreeRun, TREE_COLUMN_WIDTHS, visibleColumns } from "./tui-shell-layout.ts";

const FILTER_NOW_MS = 1_700_000_000_000;
const PIPELINE_ID = "pipe-abc";
const INVOCATION_MATCHED = "inv-matched";
const INVOCATION_ORPHAN = "inv-orphan";

function listRun(overrides: Partial<DaemonListRunRow> & Pick<DaemonListRunRow, "runId">): DaemonListRunRow {
  return {
    project: "demo",
    branch: "main",
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

function implementStage(
  invocationId: string,
  overrides?: Partial<PipelineSnapshot["stages"][number]>,
): PipelineSnapshot["stages"][number] {
  return {
    stageId: "implement",
    branchKey: "default",
    status: "running",
    workflowInvocationId: invocationId,
    ...overrides,
  };
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
  return buildMonitorPipelineTreeJoin(snapshots, runs, { nowMs: FILTER_NOW_MS }).pipelineNodes;
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
      { nowMs: FILTER_NOW_MS },
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
          {
            stageId: "plan",
            branchKey: "default",
            status: "succeeded",
            workflowInvocationId: "inv-plan-default",
          },
          {
            stageId: "plan",
            branchKey: "alt",
            status: "running",
            workflowInvocationId: "inv-plan-alt",
          },
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
    const defaultRow = buildStageMonitorTreeRow(defaultStage, null, 90);
    const altRow = buildStageMonitorTreeRow(altStage, null, 90);
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
          stages: [
            {
              stageId: "plan",
              branchKey: "default",
              status: "pending",
              workflowInvocationId: "inv-missing",
            },
          ],
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
      runs: [],
    };

    const pipelineRow = buildPipelineMonitorTreeRow(pipelineNode, null, 90);
    const stageRow = buildStageMonitorTreeRow(stageNode, null, 90);

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
      { nowMs: FILTER_NOW_MS },
    );

    expect(pipelineNodes[0]?.stages[0]?.runs.some((node) => node.id === "run-matched")).toBe(true);
    expect(unattributedRows.map((row) => monitorTreeRun(row).runId)).toEqual(["run-fresh-orphan"]);
    expect(unattributedRows.some((row) => monitorTreeRun(row).runId === "run-matched")).toBe(false);
    expect(unattributedRows.some((row) => monitorTreeRun(row).runId === "run-queued")).toBe(false);
    expect(unattributedRows.some((row) => monitorTreeRun(row).runId === "run-stale-orphan")).toBe(false);
  });
});

describe("buildMonitorPipelineTree", () => {
  test("maps snapshots, runs, expansion, selection, and maxVisibleRows to ordered display nodes", () => {
    const { snapshot, run } = pipelineWithStageAndRun(PIPELINE_ID, INVOCATION_MATCHED, "run-implement");
    const expanded = new Set([PIPELINE_ID, monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default")]);

    const { displayNodes } = buildMonitorPipelineTree([snapshot], [run], expanded, null, 10, {
      nowMs: FILTER_NOW_MS,
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

describe("flattenMonitorPipelineTree viewport FIFO", () => {
  test("iteratively drops oldest terminal pipelines until within maxVisibleRows while retaining actives", () => {
    // Mutation checkpoint: dropping a non-terminal pipeline during FIFO trimming must turn active retention RED.
    const active = pipelineSnapshot({
      pipelineId: "pipe-active",
      createdAt: 100,
      finishedAtMs: null,
      stages: [implementStage("inv-active")],
    });
    const terminalStage = (invocationId: string) => ({
      stageId: "plan",
      branchKey: "default",
      status: "succeeded",
      workflowInvocationId: invocationId,
    });
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

    expect(displayNodes.map((node) => node.id)).toEqual([
      "pipe-active",
      monitorPipelineStageNodeId("pipe-active", "implement", "default"),
      "run-active",
    ]);
    expect(snapshots).toEqual(snapshotsBefore);
    expect(runs).toEqual(runsBefore);
  });

  test("excludes collapsed pipeline subtrees from maxVisibleRows counting under terminal pressure", () => {
    // Mutation checkpoint: counting collapsed pipeline descendants toward maxVisibleRows must turn collapse+overflow RED.
    const collapsedTerminal = pipelineSnapshot({
      pipelineId: "pipe-collapsed-terminal",
      createdAt: 10,
      state: "succeeded",
      finishedAtMs: 100,
      stages: [
        {
          stageId: "plan",
          branchKey: "default",
          status: "succeeded",
          workflowInvocationId: "inv-collapsed",
        },
        {
          stageId: "implement",
          branchKey: "default",
          status: "succeeded",
          workflowInvocationId: "inv-collapsed-2",
        },
      ],
    });
    const expandedTerminal = pipelineSnapshot({
      pipelineId: "pipe-expanded-terminal",
      createdAt: 20,
      state: "succeeded",
      finishedAtMs: 200,
      stages: [
        {
          stageId: "plan",
          branchKey: "default",
          status: "succeeded",
          workflowInvocationId: "inv-expanded",
        },
      ],
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
