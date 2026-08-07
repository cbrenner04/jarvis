import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { RUN_STATUSES } from "../persistence/state-store.ts";
import {
  countActivePipelines,
  firstSelectableRunId,
  joinMonitorRow,
  leftPaneUnattributedBodyRowBudget,
  livenessTone,
  monitorDockLines,
  monitorLeftPaneTreeRows,
  monitorLeftPaneUnattributedSegmentRows,
  monitorRightPaneSegmentRows,
  monitorSegmentRows,
  monitorSelectableNodeIds,
  monitorSelectableRuns,
  monitorTextLines,
  orderSelectableRuns,
  RUN_STATUS_TONES,
  wrapMonitorRows,
} from "./tui-monitor-lines.ts";
import { monitorPipelineStageNodeId } from "./tui-monitor-pipeline-tree.ts";
import { TUI_TERMINAL_WINDOW_MS } from "./tui-monitor-terminal-window.ts";
import type { TuiMonitorState } from "./tui-monitor-types.ts";
import {
  computeShellLayout,
  listMonitorTreeCellsAtDepth,
  monitorTreeRun,
  TREE_COLUMN_WIDTHS,
} from "./tui-shell-layout.ts";

const SINGLE_STEP_RUN: DaemonListRunRow = {
  runId: "run-single",
  project: "demo",
  branch: "single",
  createdAt: 0,
  status: "in-progress",
  isLive: true,
};

const WORKFLOW_STEP_1_COMPLETED = {
  stepId: "step-1",
  role: "implement",
  status: "completed",
  attemptCount: 2,
  terminalOutcome: "complete",
} as const;

const WORKFLOW_RUN: DaemonListRunRow = {
  runId: "run-wf",
  project: "demo",
  branch: "wf",
  createdAt: 0,
  status: "in-progress",
  isLive: true,
  workflow: {
    invocationId: "inv-wf-single",
    steps: [
      WORKFLOW_STEP_1_COMPLETED,
      { stepId: "step-2", role: "review", status: "in_progress", attemptCount: 1 },
      { stepId: "step-3", role: "verify", status: "pending", attemptCount: 0 },
    ],
  },
};

function monitorState(overrides: Partial<TuiMonitorState> = {}): TuiMonitorState {
  return {
    runs: [],
    selectedNodeId: null,
    steeringFeedback: null,
    expandedPipelineNodeIds: [],
    ...overrides,
  };
}

const TREE_NOW_MS = 1_700_000_000_000;
const PIPELINE_ID = "pipe-abc";
const INVOCATION_MATCHED = "inv-matched";
const INVOCATION_ORPHAN = "inv-orphan";

function pipelineSnapshot(
  overrides: Partial<PipelineSnapshot> & Pick<PipelineSnapshot, "pipelineId">,
): PipelineSnapshot {
  return {
    name: "feature-pipeline",
    state: "running",
    createdAt: TREE_NOW_MS,
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
    ...overrides,
    id: overrides.id ?? "stage",
    position: overrides.position ?? 0,
    artifact: Object.hasOwn(overrides, "artifact") ? overrides.artifact : null,
    failureDetail: Object.hasOwn(overrides, "failureDetail") ? overrides.failureDetail : null,
  };
}

function implementStage(invocationId: string): PipelineSnapshot["stages"][number] {
  return snapshotStage({ stageId: "implement", workflowInvocationId: invocationId });
}

function workflowRun(
  runId: string,
  status: DaemonListRunRow["status"],
  invocationId: string,
  overrides: Partial<DaemonListRunRow> = {},
): DaemonListRunRow {
  return {
    project: "demo",
    branch: "main",
    createdAt: 0,
    status,
    isLive: true,
    workflow: {
      invocationId,
      steps: [{ stepId: "implement", role: "implement", status: "in_progress", attemptCount: 1 }],
    },
    stepId: "implement",
    runId,
    ...overrides,
  };
}

function treeLayout(rows = 72) {
  return computeShellLayout(245, rows, 0);
}

function overflowPaneMonitorFixture(): {
  state: TuiMonitorState;
  layout: ReturnType<typeof computeShellLayout>;
  maxVisibleRows: number;
  pipelines: PipelineSnapshot[];
} {
  const terminalColumns = 80;
  const terminalRows = 24;
  const layout = computeShellLayout(terminalColumns, terminalRows, 0);
  const maxVisibleRows = layout.paneHeight;
  const pipelines = Array.from({ length: maxVisibleRows + 10 }, (_, index) =>
    pipelineSnapshot({
      pipelineId: `pipe-${index}`,
      name: `pipeline-${index}`,
      state: "succeeded",
      createdAt: TREE_NOW_MS + index,
      finishedAtMs: TREE_NOW_MS + 100_000 + index,
      stages: [snapshotStage({ stageId: "plan", status: "succeeded", workflowInvocationId: `inv-${index}` })],
    }),
  );
  const runs = pipelines.map((_, index) => workflowRun(`run-${index}`, "completed", `inv-${index}`, { isLive: false }));
  const state = monitorState({
    runs,
    selectedNodeId: "pipe-0",
    pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines } },
    terminalColumns,
    terminalRows,
  });
  return { state, layout, maxVisibleRows, pipelines };
}

const TEST_NOW_MS = 0;

function indentColumnText(
  tableRow: Parameters<typeof listMonitorTreeCellsAtDepth>[0],
  depth: number,
  selectedNodeId: string | null = null,
): string {
  const cell = listMonitorTreeCellsAtDepth(tableRow, selectedNodeId, 90, depth, TEST_NOW_MS).find(
    (entry) => entry.column === "indent",
  );
  return cell?.text ?? "";
}

const MONITOR_LINES_FIXTURE_STATE: TuiMonitorState = {
  runs: [
    { runId: "run-alpha", project: "demo", branch: "alpha", createdAt: 0, status: "in-progress", isLive: true },
    { runId: "run-beta", project: "demo", branch: "beta", createdAt: 0, status: "completed", isLive: false },
    { runId: "run-queued", project: "demo", branch: "queued", createdAt: 0, status: "queued", isLive: false },
  ],
  selectedNodeId: "run-alpha",
  steeringFeedback: "daemon_error: paused",
};

const MONITOR_LINES_FIXTURE_PIN = [
  "runId project branch status liveness",
  "> run-alpha demo alpha in-progress live",
  "  run-beta demo beta completed not-live",
  "Queue",
  "  run-queued demo queued queued waiting: memory headroom",
  "Run",
  "runId: run-alpha",
  "project: demo",
  "branch: alpha",
  "status: in-progress",
  "isLive: true",
  "createdAt: 0",
  "daemon_error: paused",
  "Press up/down or j to select; e expands pipeline/stage; q or Ctrl-C to quit.",
] as const;

describe("orderSelectableRuns", () => {
  test("lists active runs before terminal runs while preserving daemon order within each group", () => {
    const completedOlder: DaemonListRunRow = {
      runId: "run-completed-older",
      project: "demo",
      branch: "old",
      createdAt: 0,
      status: "completed",
      isLive: false,
    };
    const activeNewer: DaemonListRunRow = {
      runId: "run-active-newer",
      project: "demo",
      branch: "new",
      createdAt: 0,
      status: "in-progress",
      isLive: true,
    };
    const activeOlder: DaemonListRunRow = {
      runId: "run-active-older",
      project: "demo",
      branch: "active-old",
      createdAt: 0,
      status: "paused",
      isLive: false,
    };

    expect(orderSelectableRuns([completedOlder, activeNewer, activeOlder]).map((run) => run.runId)).toEqual([
      "run-active-newer",
      "run-active-older",
      "run-completed-older",
    ]);
  });

  test("keeps not-live active runs in the active group", () => {
    const notLiveActive: DaemonListRunRow = {
      runId: "run-awaiting",
      project: "demo",
      branch: "await",
      createdAt: 0,
      status: "paused",
      isLive: false,
    };
    const terminal: DaemonListRunRow = {
      runId: "run-failed",
      project: "demo",
      branch: "fail",
      createdAt: 0,
      status: "failed",
      isLive: false,
    };

    expect(orderSelectableRuns([terminal, notLiveActive]).map((run) => run.runId)).toEqual([
      "run-awaiting",
      "run-failed",
    ]);
  });

  test("excludes queued runs from selectable ordering", () => {
    const queued: DaemonListRunRow = {
      runId: "run-queued",
      project: "demo",
      branch: "q",
      createdAt: 0,
      status: "queued",
      isLive: false,
    };

    expect(orderSelectableRuns([queued, SINGLE_STEP_RUN]).map((run) => run.runId)).toEqual(["run-single"]);
  });
});

describe("firstSelectableRunId", () => {
  test("returns the topmost active run when terminal rows precede it in daemon order", () => {
    const terminal: DaemonListRunRow = {
      runId: "run-beta",
      project: "demo",
      branch: "beta",
      createdAt: 0,
      status: "completed",
      isLive: false,
    };

    expect(firstSelectableRunId(monitorState({ runs: [terminal, SINGLE_STEP_RUN] }))).toBe("run-single");
  });

  test("falls back to the first terminal row when every selectable run is terminal", () => {
    const newer: DaemonListRunRow = {
      runId: "run-newer",
      project: "demo",
      branch: "new",
      createdAt: 0,
      status: "killed",
      isLive: false,
    };
    const older: DaemonListRunRow = {
      runId: "run-older",
      project: "demo",
      branch: "old",
      createdAt: 0,
      status: "blocked",
      isLive: false,
    };

    expect(firstSelectableRunId(monitorState({ runs: [newer, older] }))).toBe("run-newer");
  });
});

describe("RUN_STATUS_TONES", () => {
  test("covers every RUN_STATUSES member", () => {
    for (const status of RUN_STATUSES) {
      expect(RUN_STATUS_TONES[status]).toBeDefined();
    }
  });
});

describe("livenessTone", () => {
  test("live is active and not-live is untoned", () => {
    expect(livenessTone(true)).toBe("active");
    expect(livenessTone(false)).toBeUndefined();
  });
});

describe("monitorSegmentRows", () => {
  test("joined rows match monitorTextLines", () => {
    const state = monitorState({ runs: [SINGLE_STEP_RUN], selectedNodeId: "run-single" });
    const lines = monitorTextLines(state);
    const rows = monitorSegmentRows(state);
    expect(rows.map(joinMonitorRow)).toEqual(lines);
  });
});

describe("monitorTextLines", () => {
  test("renders active runs before terminal runs in the run table", () => {
    const terminalFirst: DaemonListRunRow = {
      runId: "run-beta",
      project: "demo",
      branch: "beta",
      createdAt: 0,
      status: "completed",
      isLive: false,
    };
    const activeSecond: DaemonListRunRow = {
      runId: "run-alpha",
      project: "demo",
      branch: "alpha",
      createdAt: 0,
      status: "in-progress",
      isLive: true,
    };

    const lines = monitorTextLines(monitorState({ runs: [terminalFirst, activeSecond], selectedNodeId: "run-alpha" }));

    const headerIndex = lines.indexOf("runId project branch status liveness");
    const alphaIndex = lines.findIndex((line) => line.includes("run-alpha"));
    const betaIndex = lines.findIndex((line) => line.includes("run-beta"));

    expect(alphaIndex).toBeGreaterThan(headerIndex);
    expect(betaIndex).toBeGreaterThan(alphaIndex);
  });

  test("pins full output for fixture state", () => {
    expect(monitorTextLines(MONITOR_LINES_FIXTURE_STATE)).toEqual([...MONITOR_LINES_FIXTURE_PIN]);
  });

  test("workflow-backed selected run shows active step, prior outcomes, and attempt counts", () => {
    const lines = monitorTextLines(
      monitorState({
        runs: [WORKFLOW_RUN],
        selectedNodeId: "run-wf",
      }),
    );

    expect(lines).toContain("Workflow");
    expect(lines).toContain("  step-1 implement completed complete attempts=2");
    expect(lines).toContain("> step-2 review in_progress attempts=1");
    expect(lines).toContain("  step-3 verify pending attempts=0");
  });

  test("renders distinct durable draft and debate rows with terminal status tones", () => {
    const debate = (status: "completed" | "failed" | "interrupted"): DaemonListRunRow => ({
      runId: `run-authored-review-${status}`,
      project: "demo",
      branch: "plan",
      createdAt: 0,
      status,
      isLive: false,
      stepId: "authored-plan-review",
      workflow: {
        invocationId: "inv-plan-debate",
        steps: [
          { stepId: "plan-draft", role: "plan", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
          {
            stepId: "authored-plan-review",
            role: "",
            status: status === "completed" ? "completed" : "stopped",
            attemptCount: 1,
            terminalOutcome: status === "completed" ? "complete" : status === "failed" ? "invocation_failure" : status,
          },
        ],
      },
    });

    for (const status of ["completed", "failed", "interrupted"] as const) {
      const debateRow = debate(status);
      const debateWorkflow = debateRow.workflow;
      if (debateWorkflow === undefined) {
        throw new Error("debate fixture must include workflow");
      }
      const draft: DaemonListRunRow = {
        runId: "run-plan-draft",
        project: "demo",
        branch: "plan",
        createdAt: 0,
        status: "completed",
        isLive: false,
        stepId: "plan-draft",
        workflow: debateWorkflow,
      };
      const lines = monitorTextLines(
        monitorState({
          runs: [draft, debateRow],
          selectedNodeId: `run-authored-review-${status}`,
        }),
      );
      const rollupStatus = status === "completed" ? "completed" : status;
      expect(lines).toEqual(
        expect.arrayContaining([`  run-plan-draft demo plan completed not-live workflow-status:${rollupStatus}`]),
      );
      expect(lines.some((line) => line.includes(`run-authored-review-${status}`))).toBe(false);
      expect(lines.some((line) => line.includes(`workflow-status:${rollupStatus}`))).toBe(true);
    }
  });

  test("single-step selected run renders no workflow chrome", () => {
    const lines = monitorTextLines(
      monitorState({
        runs: [SINGLE_STEP_RUN],
        selectedNodeId: "run-single",
      }),
    );

    expect(lines).not.toContain("Workflow");
  });

  test("early workflow stop shows terminal outcome on last step and pending later steps", () => {
    const lines = monitorTextLines(
      monitorState({
        runs: [
          {
            ...WORKFLOW_RUN,
            status: "blocked",
            isLive: false,
            workflow: {
              invocationId: "inv-wf-single",
              steps: [
                WORKFLOW_STEP_1_COMPLETED,
                { stepId: "step-2", role: "review", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
                { stepId: "step-3", role: "verify", status: "stopped", attemptCount: 1, terminalOutcome: "blocked" },
              ],
            },
          },
        ],
        selectedNodeId: "run-wf",
      }),
    );

    expect(lines).toContain("  step-3 verify stopped blocked attempts=1");
    expect(lines.filter((line) => line.includes("pending"))).toHaveLength(0);
    expect(lines.filter((line) => line.startsWith("> ") && line.includes("step-"))).toHaveLength(0);
  });

  test("no Queue heading when no runs are queued", () => {
    const lines = monitorTextLines(monitorState({ runs: [SINGLE_STEP_RUN], selectedNodeId: "run-single" }));

    expect(lines).not.toContain("Queue");
  });

  test("queued runs render under a Queue heading, oldest-queued-first, with admission descriptor", () => {
    const queuedNewer: DaemonListRunRow = {
      runId: "run-queued-newer",
      project: "demo",
      branch: "newer",
      createdAt: 0,
      status: "queued",
      isLive: false,
    };
    const queuedOlder: DaemonListRunRow = {
      runId: "run-queued-older",
      project: "demo",
      branch: "older",
      createdAt: 0,
      status: "queued",
      isLive: false,
    };

    // state.runs arrives newest-first (matches daemon `list` ordering); queuedNewer was queued after queuedOlder.
    const lines = monitorTextLines(
      monitorState({ runs: [queuedNewer, queuedOlder, SINGLE_STEP_RUN], selectedNodeId: "run-single" }),
    );

    const queueIndex = lines.indexOf("Queue");
    const olderIndex = lines.findIndex((line) => line.includes("run-queued-older"));
    const newerIndex = lines.findIndex((line) => line.includes("run-queued-newer"));

    expect(queueIndex).toBeGreaterThan(-1);
    expect(olderIndex).toBeGreaterThan(queueIndex);
    expect(newerIndex).toBeGreaterThan(olderIndex);
    expect(lines[olderIndex]).toBe("  run-queued-older demo older queued waiting: memory headroom");
  });

  test("Runs section still renders when only queued runs exist", () => {
    const queuedRun: DaemonListRunRow = {
      runId: "run-queued",
      project: "demo",
      branch: "q",
      createdAt: 0,
      status: "queued",
      isLive: false,
    };

    const lines = monitorTextLines(monitorState({ runs: [queuedRun], selectedNodeId: null }));

    expect(lines).toContain("No runs.");
    expect(lines).toContain("Queue");
  });
});

describe("monitorLeftPaneTreeRows", () => {
  test("emits pipeline, stage, and run rows with increasing depth and places orphans after the tree", () => {
    // Mutation checkpoint: using monitorLeftPaneTableRows as the tree-pane source in tui-ink-monitor.tsx must turn pipeline tree row ordering RED.
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [implementStage(INVOCATION_MATCHED)],
    });
    const matchedRun = workflowRun("run-implement", "in-progress", INVOCATION_MATCHED);
    const orphanRun = workflowRun("run-orphan", "completed", INVOCATION_ORPHAN, { isLive: false });
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const state = monitorState({
      runs: [matchedRun, orphanRun],
      selectedNodeId: "run-implement",
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
      expandedPipelineNodeIds: [PIPELINE_ID, stageId],
    });

    const { treeRows, unattributedRows } = monitorLeftPaneTreeRows(state, treeLayout(), TREE_NOW_MS);

    expect(treeRows.map((row) => ({ kind: row.kind, id: row.id, depth: row.depth }))).toEqual([
      { kind: "pipeline", id: PIPELINE_ID, depth: 0 },
      { kind: "stage", id: stageId, depth: 1 },
      { kind: "run", id: "run-implement", depth: 2 },
    ]);
    expect(
      unattributedRows.map((row) => (row.kind === "workflow-collapsed" ? row.representative.runId : row.run.runId)),
    ).toEqual(["run-orphan"]);
  });

  test("maps node.depth to indent column slots for pipeline, stage, and run leaves", () => {
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [implementStage(INVOCATION_MATCHED)],
    });
    const matchedRun = workflowRun("run-implement", "in-progress", INVOCATION_MATCHED);
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const state = monitorState({
      runs: [matchedRun],
      selectedNodeId: "run-implement",
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
      expandedPipelineNodeIds: [PIPELINE_ID, stageId],
    });

    const { treeRows } = monitorLeftPaneTreeRows(state, treeLayout(), TREE_NOW_MS);
    const pipelineRow = treeRows.find((row) => row.kind === "pipeline");
    const stageRow = treeRows.find((row) => row.kind === "stage");
    const runRow = treeRows.find((row) => row.kind === "run");
    expect(runRow).toBeDefined();
    if (runRow?.kind !== "run") throw new Error("expected run row");

    expect(pipelineRow?.depth).toBe(0);
    expect(stageRow?.depth).toBe(1);
    expect(runRow.depth).toBe(2);
    expect(indentColumnText({ kind: "standalone", run: matchedRun }, 0).trimEnd()).toBe("");
    expect(indentColumnText({ kind: "standalone", run: matchedRun }, 1)).toBe("  ".padEnd(TREE_COLUMN_WIDTHS.indent));
    expect(indentColumnText(runRow.tableRow, 2)).toBe("  ".padEnd(TREE_COLUMN_WIDTHS.indent));
    const labelCell = listMonitorTreeCellsAtDepth(runRow.tableRow, "run-implement", 90, 2, TEST_NOW_MS).find(
      (entry) => entry.column === "label",
    );
    expect(labelCell?.text.startsWith("  ")).toBe(true);
  });

  test("expanded stage workflow-child rows render at depth 3 with indent column slots", () => {
    const MULTI_INVOCATION = "inv-multi";
    const MULTI_WORKFLOW_STEPS = [
      { stepId: "implement", role: "implement", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
      { stepId: "implement-review", role: "actuator", status: "in_progress", attemptCount: 1 },
    ] as const;
    const multiMemberRuns = (): DaemonListRunRow[] => {
      const _workflow = { invocationId: MULTI_INVOCATION, steps: [...MULTI_WORKFLOW_STEPS] };
      return [
        workflowRun("run-implement", "completed", MULTI_INVOCATION, { isLive: false }),
        {
          ...workflowRun("run-review", "in-progress", MULTI_INVOCATION),
          stepId: "implement-review",
        },
      ];
    };
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [implementStage(MULTI_INVOCATION)],
    });
    const runs = multiMemberRuns();
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const state = monitorState({
      runs,
      selectedNodeId: "run-implement",
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
      expandedPipelineNodeIds: [PIPELINE_ID, stageId],
    });

    const { treeRows } = monitorLeftPaneTreeRows(state, treeLayout(), TREE_NOW_MS);
    const childRow = treeRows.find((row) => row.kind === "run" && row.id === "run-implement");
    expect(childRow?.kind === "run" ? childRow.depth : -1).toBe(3);
    expect(childRow?.kind === "run" ? childRow.tableRow.kind : "").toBe("workflow-child");
    if (childRow?.kind !== "run") throw new Error("expected run row");

    expect(indentColumnText(childRow.tableRow, 3, "run-implement")).toBe("  ".padEnd(TREE_COLUMN_WIDTHS.indent));
    const labelCell = listMonitorTreeCellsAtDepth(childRow.tableRow, "run-implement", 90, 3, TEST_NOW_MS).find(
      (entry) => entry.column === "label",
    );
    expect(labelCell?.text.startsWith("  ")).toBe(true);
  });

  test("keeps stage-matched runs out of unattributed when they fail the terminal window", () => {
    // Mutation checkpoint: re-applying filterMonitorRunsForLiveWindow in tui-entry.tsx refreshRuns must turn full-run-set pipeline matching RED.
    const staleFinishedAt = TREE_NOW_MS - TUI_TERMINAL_WINDOW_MS - 1;
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [implementStage(INVOCATION_MATCHED)],
    });
    const staleMatched = workflowRun("run-stale-matched", "completed", INVOCATION_MATCHED, {
      isLive: false,
      finishedAtMs: staleFinishedAt,
    });
    const state = monitorState({
      runs: [staleMatched],
      selectedNodeId: "run-stale-matched",
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const { treeRows, unattributedRows } = monitorLeftPaneTreeRows(state, treeLayout(), TREE_NOW_MS);

    expect(treeRows.some((row) => row.kind === "run" && row.id === "run-stale-matched")).toBe(true);
    expect(unattributedRows).toHaveLength(0);
  });

  test("concatenates pipeline snapshots from socket paths in ascending key order", () => {
    // Mutation checkpoint: ignoring pipelineSnapshotsBySocketPath in monitorLeftPaneTreeRows must turn merged snapshot pin RED.
    const snapshotA = pipelineSnapshot({ pipelineId: "pipe-a", name: "alpha" });
    const snapshotB = pipelineSnapshot({ pipelineId: "pipe-b", name: "beta" });
    const state = monitorState({
      pipelineSnapshotsBySocketPath: {
        "/tmp/z.sock": { pipelines: [snapshotB] },
        "/tmp/a.sock": { pipelines: [snapshotA] },
      },
    });

    const { treeRows } = monitorLeftPaneTreeRows(state, treeLayout(), TREE_NOW_MS);

    expect(treeRows.filter((row) => row.kind === "pipeline").map((row) => row.id)).toEqual(["pipe-a", "pipe-b"]);
  });

  test("left pane labels unattributed segment with retained run count", () => {
    const layout = computeShellLayout(245, 9, 0);
    const baseFinish = TREE_NOW_MS - 3_600_000;
    const orphanRuns = [
      workflowRun("run-active", "in-progress", "inv-active", { createdAt: 100 }),
      workflowRun("run-term-oldest", "completed", "inv-term-oldest", {
        isLive: false,
        finishedAtMs: baseFinish,
        createdAt: 10,
      }),
      workflowRun("run-term-old", "completed", "inv-term-old", {
        isLive: false,
        finishedAtMs: baseFinish + 1_000,
        createdAt: 20,
      }),
      workflowRun("run-term-mid", "completed", "inv-term-mid", {
        isLive: false,
        finishedAtMs: baseFinish + 2_000,
        createdAt: 30,
      }),
      workflowRun("run-term-new", "completed", "inv-term-new", {
        isLive: false,
        finishedAtMs: baseFinish + 3_000,
        createdAt: 40,
      }),
    ];
    const state = monitorState({ runs: orphanRuns, selectedNodeId: null });
    const { heading, bodyRows } = monitorLeftPaneUnattributedSegmentRows(state, layout, TREE_NOW_MS);

    expect(joinMonitorRow(heading)).toBe("─ Unattributed (4) ─");
    expect(bodyRows.map((row) => monitorTreeRun(row).runId)).toEqual([
      "run-active",
      "run-term-old",
      "run-term-mid",
      "run-term-new",
    ]);
  });

  test("left pane labels unattributed segment with zero retained body rows", () => {
    const layout = computeShellLayout(245, 72, 0);
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [implementStage(INVOCATION_MATCHED)],
    });
    const matchedRun = workflowRun("run-implement", "in-progress", INVOCATION_MATCHED);
    const state = monitorState({
      runs: [matchedRun],
      selectedNodeId: null,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });
    const { heading, bodyRows } = monitorLeftPaneUnattributedSegmentRows(state, layout, TREE_NOW_MS);

    expect(joinMonitorRow(heading)).toBe("─ Unattributed (0) ─");
    expect(bodyRows).toEqual([]);
  });
});

describe("monitorSelectableNodeIds", () => {
  test("lists visible tree rows then unattributed runs in pane order", () => {
    // Mutation checkpoint: omitting unattributed rows from monitorSelectableNodeIds must turn tree+unattributed navigation pin RED.
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [implementStage(INVOCATION_MATCHED)],
    });
    const matchedRun = workflowRun("run-implement", "in-progress", INVOCATION_MATCHED);
    const orphanRun = workflowRun("run-orphan", "completed", INVOCATION_ORPHAN, { isLive: false });
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const state = monitorState({
      runs: [matchedRun, orphanRun],
      selectedNodeId: stageId,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
      expandedPipelineNodeIds: [PIPELINE_ID, stageId],
      terminalColumns: 245,
      terminalRows: 72,
    });

    expect(monitorSelectableNodeIds(state, TREE_NOW_MS)).toEqual([PIPELINE_ID, stageId, "run-implement", "run-orphan"]);
  });

  test("retains every full-flatten tree row id while painted tree rows stay within the pane budget", () => {
    // Mutation checkpoint: deriving monitorSelectableNodeIds from FIFO-trimmed or viewport-sliced displayNodes must turn this pin RED.
    const { state, layout, maxVisibleRows, pipelines } = overflowPaneMonitorFixture();

    const selectableIds = monitorSelectableNodeIds(state, TREE_NOW_MS);
    const { treeRows: paintedTreeRows } = monitorLeftPaneTreeRows(state, layout, TREE_NOW_MS);

    expect(selectableIds).toEqual([...pipelines].reverse().map((pipeline) => pipeline.pipelineId));
    expect(paintedTreeRows.length).toBeLessThanOrEqual(maxVisibleRows);
    expect(paintedTreeRows.length).toBeLessThan(selectableIds.length);
  });

  test("keeps off-pane tree row ids selectable while omitting them from the painted slice only", () => {
    const { state, layout } = overflowPaneMonitorFixture();

    const selectableIds = monitorSelectableNodeIds(state, TREE_NOW_MS);
    const paintedIds = monitorLeftPaneTreeRows(state, layout, TREE_NOW_MS).treeRows.map((row) => row.id);
    const offPaneIds = selectableIds.filter((id) => !paintedIds.includes(id));

    expect(offPaneIds.length).toBeGreaterThan(0);
    for (const id of offPaneIds) {
      expect(selectableIds).toContain(id);
      expect(paintedIds).not.toContain(id);
    }
  });

  test("leftPaneTreeScrollOffset shifts painted tree rows without trimming monitorSelectableNodeIds", () => {
    const { state, layout, maxVisibleRows, pipelines } = overflowPaneMonitorFixture();
    const baseSelectable = monitorSelectableNodeIds(state, TREE_NOW_MS);
    const scrollOffset = 5;
    const scrolled = { ...state, leftPaneTreeScrollOffset: scrollOffset };
    const { treeRows } = monitorLeftPaneTreeRows(scrolled, layout, TREE_NOW_MS);

    expect(monitorSelectableNodeIds(scrolled, TREE_NOW_MS)).toEqual(baseSelectable);
    expect(treeRows.map((row) => row.id)).toEqual(
      [...pipelines]
        .reverse()
        .slice(scrollOffset, scrollOffset + maxVisibleRows)
        .map((pipeline) => pipeline.pipelineId),
    );
  });
});

describe("monitorRightPaneSegmentRows", () => {
  const pipelineCreatedAt = TREE_NOW_MS - 125_000;
  const pipelineFinishedAt = TREE_NOW_MS - 5_000;
  const stageStartedAt = TREE_NOW_MS - 65_000;
  const detailedStage = snapshotStage({
    id: "record-z",
    stageId: "implement",
    position: 9,
    status: "succeeded",
    workflowInvocationId: "inv-detail-a",
    startedAt: stageStartedAt,
    endedAt: pipelineFinishedAt,
    artifact: { z: 1, a: { z: false, a: "" } },
    failureDetail: undefined,
  });
  const secondDetailedStage = snapshotStage({
    id: "record-a",
    stageId: "implement",
    position: 1,
    status: "succeeded",
    workflowInvocationId: "inv-detail-b",
    startedAt: stageStartedAt,
    endedAt: pipelineFinishedAt,
  });
  const detailedStages = [detailedStage, secondDetailedStage];
  const detailedSnapshot = pipelineSnapshot({
    pipelineId: PIPELINE_ID,
    state: "succeeded",
    terminalAction: "ready",
    seedPath: "seeds/intent.md",
    terminalPublicationSucceededAt: pipelineFinishedAt,
    createdAt: pipelineCreatedAt,
    finishedAtMs: pipelineFinishedAt,
    stages: detailedStages,
  });
  const detailedRun = workflowRun("run-detail-a", "completed", "inv-detail-a", { isLive: false });
  const secondDetailedRun = workflowRun("run-detail-b", "completed", "inv-detail-b", { isLive: false });
  const detailedRuns = [detailedRun, secondDetailedRun];
  const pipelineBlock = [
    `pipelineId: ${PIPELINE_ID}`,
    "name: feature-pipeline",
    "project: demo",
    "state: succeeded",
    "elapsed: 2m 0s",
    `createdAt: ${pipelineCreatedAt}`,
    `finishedAtMs: ${pipelineFinishedAt}`,
    "terminalAction: ready",
    "seedPath: seeds/intent.md",
    `terminalPublicationSucceededAt: ${pipelineFinishedAt}`,
    "terminalPublicationFailure: null",
    "Stages",
    "stage: implement branch=default status=succeeded elapsed=1m 0s",
    "stage: implement branch=default status=succeeded elapsed=1m 0s",
  ];

  test("pipeline selection renders complete identity and durable-order stage roll-up", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (treeRow?.kind === \"pipeline\") {" -> "if (false) {"
    const state = monitorState({
      runs: detailedRuns,
      selectedNodeId: PIPELINE_ID,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [detailedSnapshot] } },
    });

    expect(monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow)).toEqual(pipelineBlock);
  });

  test("stage selection appends the selected durable record with exact branch and stable diagnostics", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (treeRow?.kind === \"stage\") {" -> "if (false) {"
    const stageNodeId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const state = monitorState({
      runs: detailedRuns,
      selectedNodeId: stageNodeId,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [detailedSnapshot] } },
    });

    expect(monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow)).toEqual([
      ...pipelineBlock,
      "Stage",
      "id: record-z",
      "stageId: implement",
      "branch: default",
      "position: 9",
      "status: succeeded",
      "workflowInvocationId: inv-detail-a",
      'artifact: {"a":{"a":"","z":false},"z":1}',
      `startedAt: ${stageStartedAt}`,
      `endedAt: ${pipelineFinishedAt}`,
    ]);
  });

  test("stage artifact and failure values preserve JSON omission and falsy semantics", () => {
    const cases: ReadonlyArray<readonly [unknown, string | undefined]> = [
      [undefined, undefined],
      [null, "null"],
      [false, "false"],
      [0, "0"],
      ["", ""],
      ["plain", "plain"],
      [{ z: [{ y: 2, a: 1 }], a: false }, '{"a":false,"z":[{"a":1,"y":2}]}'],
    ];

    for (const field of ["artifact", "failureDetail"] as const) {
      for (const [value, expected] of cases) {
        const stage = {
          ...snapshotStage({ stageId: "inspect", artifact: undefined, failureDetail: undefined }),
          [field]: value,
        };
        const snapshot = pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [stage] });
        const state = monitorState({
          selectedNodeId: monitorPipelineStageNodeId(PIPELINE_ID, "inspect", "default"),
          pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
        });
        const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);
        const matching = lines.filter((line) => line.startsWith(`${field}:`));

        expect(matching).toEqual(expected === undefined ? [] : [`${field}: ${expected}`]);
      }
    }
  });

  test("pipeline project is omitted when joined rows are absent or conflict", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (projects.size !== 1 || project.length === 0) return [];" -> "if (false) return [];"
    const absent = pipelineSnapshot({
      pipelineId: "pipe-absent",
      stages: [snapshotStage({ stageId: "write", workflowInvocationId: null })],
    });
    const conflicting = pipelineSnapshot({
      pipelineId: "pipe-conflict",
      stages: [
        snapshotStage({ stageId: "write", workflowInvocationId: "inv-conflict-a" }),
        snapshotStage({ stageId: "review", workflowInvocationId: "inv-conflict-b" }),
      ],
    });
    const runs = [
      workflowRun("run-conflict-a", "in-progress", "inv-conflict-a", { project: "alpha" }),
      workflowRun("run-conflict-b", "in-progress", "inv-conflict-b", { project: "beta" }),
    ];

    for (const snapshot of [absent, conflicting]) {
      const lines = monitorRightPaneSegmentRows(
        monitorState({
          runs,
          selectedNodeId: snapshot.pipelineId,
          pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
        }),
        TREE_NOW_MS,
      ).map(joinMonitorRow);
      expect(lines.some((line) => line.startsWith("project:"))).toBe(false);
    }
  });

  test("attributed run detail is resolved only from the selected durable row", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "state.runs.find((run) => run.runId === selectedRunId)" -> "state.runs[0]"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (selectedRun === undefined) {" -> "if (true) {"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (state.steeringFeedback !== null) {" -> "if (false) {"
    const snapshot = pipelineSnapshot({
      ...detailedSnapshot,
      stages: [detailedStage],
    });
    const selectedRun: DaemonListRunRow = {
      ...detailedRun,
      branch: "selected-branch",
      createdAt: 101,
      finishedAtMs: 202,
      loopOutcomeKind: "complete",
      iterationsConsumed: 0,
      resumable: false,
      error: {
        reason: "agent_blocked",
        retryable: false,
        nextAction: "inspect_spec",
        publicationFailure: { operation: "publish", message: "failed", exitCode: 0, stdoutTail: "" },
      },
      reviewPasses: 0,
      reviewBehavior: "light",
      worktreePath: "",
      prNumber: 0,
      prUrl: "",
      workflow: {
        invocationId: "inv-detail-a",
        steps: [
          { stepId: "selected-plan", role: "plan", status: "completed", terminalOutcome: "", attemptCount: 0 },
          { stepId: "selected-run", role: "implement", status: "in_progress", attemptCount: 2 },
        ],
      },
      stepId: "selected-run",
    };
    const conflictingRun: DaemonListRunRow = {
      runId: "run-conflicting",
      project: "conflicting-project",
      branch: "conflicting-branch",
      status: "failed",
      isLive: true,
      createdAt: 303,
      finishedAtMs: 404,
      loopOutcomeKind: "invocation_failure",
      iterationsConsumed: 99,
      resumable: true,
      error: { reason: "quota_exhausted", retryable: true, nextAction: "retry_later" },
      reviewPasses: 7,
      reviewBehavior: "debate",
      worktreePath: "/conflicting/worktree",
      prNumber: 77,
      prUrl: "https://example.test/conflicting",
      workflow: {
        invocationId: "inv-conflicting",
        steps: [
          {
            stepId: "conflicting-step",
            role: "review",
            status: "stopped",
            terminalOutcome: "blocked",
            attemptCount: 8,
          },
        ],
      },
      stepId: "conflicting-step",
    };
    const state = monitorState({
      runs: [conflictingRun, selectedRun],
      selectedNodeId: "run-detail-a",
      steeringFeedback: "daemon_error: retained steering",
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);
    const singleStageBlock = pipelineBlock.slice(0, -1);

    expect(lines).toEqual([
      ...singleStageBlock,
      "Run",
      "runId: run-detail-a",
      "project: demo",
      "branch: selected-branch",
      "status: completed",
      "isLive: false",
      "createdAt: 101",
      "finishedAtMs: 202",
      "stepId: selected-run",
      "workflowInvocationId: inv-detail-a",
      "Workflow",
      "  selected-plan plan completed  attempts=0",
      "> selected-run implement in_progress attempts=2",
      "loopOutcomeKind: complete",
      "iterationsConsumed: 0",
      "resumable: false",
      'error: {"nextAction":"inspect_spec","publicationFailure":{"exitCode":0,"message":"failed","operation":"publish","stdoutTail":""},"reason":"agent_blocke',
      'd","retryable":false}',
      "reviewPasses: 0",
      "reviewBehavior: light",
      "worktreePath: ",
      "prNumber: 0",
      "prUrl: ",
      "daemon_error: retained steering",
    ]);
    expect(lines.some((line) => line.includes("conflicting"))).toBe(false);
    expect(lines).not.toContain("Outcome");
    expect(lines.some((line) => line.startsWith("runStatus:"))).toBe(false);
    expect(lines).not.toContain("iterationsConsumed: 88");
    expect(lines).not.toContain("resumable: true");
  });

  test("unattributed run detail preserves null and omits only undefined fields", () => {
    const selectedRun: DaemonListRunRow = {
      runId: "run-unattributed",
      project: "",
      branch: "",
      status: "paused",
      isLive: false,
      createdAt: 0,
      iterationsConsumed: 0,
      resumable: false,
      error: null as unknown as NonNullable<DaemonListRunRow["error"]>,
      reviewPasses: 0,
      worktreePath: "",
      prNumber: 0,
      prUrl: "",
    };
    const lines = monitorRightPaneSegmentRows(
      monitorState({ runs: [selectedRun], selectedNodeId: selectedRun.runId }),
      TREE_NOW_MS,
    ).map(joinMonitorRow);

    expect(lines).toEqual([
      "Run",
      "runId: run-unattributed",
      "project: ",
      "branch: ",
      "status: paused",
      "isLive: false",
      "createdAt: 0",
      "iterationsConsumed: 0",
      "resumable: false",
      "error: null",
      "reviewPasses: 0",
      "worktreePath: ",
      "prNumber: 0",
      "prUrl: ",
    ]);
    expect(lines.some((line) => line.startsWith("pipelineId:"))).toBe(false);
    expect(lines).not.toContain("Stages");
    expect(lines).not.toContain("Outcome");
    expect(lines.some((line) => line.startsWith("runStatus:"))).toBe(false);
  });

  test("right pane omits detail for runs outside the selectable window", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "selectableIds.includes(selected)" -> "true"
    const layout = computeShellLayout(245, 9, 0);
    const baseFinish = TREE_NOW_MS - 3_600_000;
    const evictedOrphan = workflowRun("run-evicted-orphan", "completed", "inv-evicted", {
      isLive: false,
      finishedAtMs: baseFinish,
      createdAt: 10,
    });
    const retainedOrphans = [
      workflowRun("run-active", "in-progress", "inv-active", { createdAt: 100 }),
      workflowRun("run-term-old", "completed", "inv-term-old", {
        isLive: false,
        finishedAtMs: baseFinish + 1_000,
        createdAt: 20,
      }),
      workflowRun("run-term-mid", "completed", "inv-term-mid", {
        isLive: false,
        finishedAtMs: baseFinish + 2_000,
        createdAt: 30,
      }),
      workflowRun("run-term-new", "completed", "inv-term-new", {
        isLive: false,
        finishedAtMs: baseFinish + 3_000,
        createdAt: 40,
      }),
    ];
    const state = monitorState({
      runs: [evictedOrphan, ...retainedOrphans],
      selectedNodeId: "run-evicted-orphan",
      terminalColumns: 245,
      terminalRows: 9,
    });

    expect(monitorSelectableRuns(state).some((run) => run.runId === "run-evicted-orphan")).toBe(true);
    expect(monitorSelectableNodeIds(state, TREE_NOW_MS)).not.toContain("run-evicted-orphan");
    expect(leftPaneUnattributedBodyRowBudget(state, layout, 0)).toBe(4);

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);
    expect(lines.some((line) => line.startsWith("runId:"))).toBe(false);
    expect(lines).not.toContain("Run");
  });

  test("resolves pipeline detail for off-pane tree row selection", () => {
    // Mutation checkpoint: resolving selection from painted treeRows only must turn off-pane right-pane detail pin RED.
    const { state, layout, pipelines } = overflowPaneMonitorFixture();
    const offPanePipeline = pipelines[0];
    if (!offPanePipeline) throw new Error("expected an off-pane pipeline");
    const offPanePipelineId = offPanePipeline.pipelineId;
    const paintedIds = monitorLeftPaneTreeRows(state, layout, TREE_NOW_MS).treeRows.map((row) => row.id);

    expect(paintedIds).not.toContain(offPanePipelineId);

    const lines = monitorRightPaneSegmentRows({ ...state, selectedNodeId: offPanePipelineId }, TREE_NOW_MS).map(
      joinMonitorRow,
    );

    expect(lines).not.toContain("No run selected.");
    expect(lines.slice(0, 4)).toEqual([
      `pipelineId: ${offPanePipelineId}`,
      "name: pipeline-0",
      "project: demo",
      "state: succeeded",
    ]);
    expect(lines).toContain("elapsed: 1m 40s");
    expect(lines).toContain("stage: plan branch=default status=succeeded elapsed=");
  });

  test("pipeline and stage selection hide the wait/outcome panel", () => {
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [implementStage(INVOCATION_MATCHED)],
    });
    const matchedRun = workflowRun("run-implement", "in-progress", INVOCATION_MATCHED);
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const base = monitorState({
      runs: [matchedRun],
      selectedNodeId: "run-implement",
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const pipelineLines = monitorRightPaneSegmentRows({ ...base, selectedNodeId: PIPELINE_ID }, TREE_NOW_MS).map(
      joinMonitorRow,
    );
    const stageLines = monitorRightPaneSegmentRows({ ...base, selectedNodeId: stageId }, TREE_NOW_MS).map(
      joinMonitorRow,
    );

    expect(pipelineLines.some((line) => line === "Outcome")).toBe(false);
    expect(pipelineLines.some((line) => line.startsWith("runStatus:"))).toBe(false);
    expect(stageLines.some((line) => line === "Outcome")).toBe(false);
    expect(stageLines.some((line) => line.startsWith("runStatus:"))).toBe(false);
  });

  const wideCombiningValue = `${"界".repeat(8)}-${"e\u0301".repeat(12)}`;
  const wrappingRun: DaemonListRunRow = {
    runId: `run-${wideCombiningValue}`,
    project: "demo",
    branch: "wrap-detail",
    status: "failed",
    isLive: false,
    createdAt: 0,
    error: {
      reason: "agent_blocked",
      retryable: false,
      nextAction: "inspect_spec",
      publicationFailure: {
        operation: "publish",
        message: `failure-${wideCombiningValue}`,
        exitCode: 1,
        stdoutTail: "",
      },
    },
    worktreePath: `/workspace/${"long-segment/".repeat(8)}`,
  };

  function wrappingState(terminalColumns: number, steeringFeedback: string | null = null): TuiMonitorState {
    return monitorState({
      runs: [wrappingRun],
      selectedNodeId: wrappingRun.runId,
      steeringFeedback,
      terminalColumns,
      terminalRows: 72,
    });
  }

  test("split detail wraps losslessly by display columns without ellipsis", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "wrapMonitorRows(rows, effectiveRightPaneWidth(layout, columns))" -> "rows"
    const columns = 120;
    const width = computeShellLayout(columns, 72, 0).rightWidth;
    const rows = monitorRightPaneSegmentRows(wrappingState(columns), TREE_NOW_MS);
    const unwrapped = monitorRightPaneSegmentRows(wrappingState(10_000), TREE_NOW_MS);

    expect(rows.length).toBeGreaterThan(unwrapped.length);
    expect(rows.every((line) => Bun.stringWidth(joinMonitorRow(line)) <= width)).toBe(true);
    expect(rows.map(joinMonitorRow).join("")).toBe(unwrapped.map(joinMonitorRow).join(""));
    expect(rows.some((line) => joinMonitorRow(line).includes("…"))).toBe(false);
  });

  test("stacked detail uses the full terminal width", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "layout.layoutMode === \"split\"" -> "true"
    const columns = 80;
    const layout = computeShellLayout(columns, 72, 0);
    const rows = monitorRightPaneSegmentRows(wrappingState(columns), TREE_NOW_MS);

    expect(layout.layoutMode).toBe("stacked");
    expect(rows.every((line) => Bun.stringWidth(joinMonitorRow(line)) <= columns)).toBe(true);
    expect(rows.some((line) => Bun.stringWidth(joinMonitorRow(line)) > layout.rightWidth)).toBe(true);
    expect(rows.map(joinMonitorRow).join("")).toBe(
      monitorRightPaneSegmentRows(wrappingState(10_000), TREE_NOW_MS).map(joinMonitorRow).join(""),
    );
  });

  test("one-column detail floors width, preserves zero-column marks, and atomically overflows wide graphemes", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "Math.max(1, layout.layoutMode === \"split\" ? layout.rightWidth : columns)" -> "layout.layoutMode === \"split\" ? layout.rightWidth : columns"
    const feedback = `\u0301${"narrow".repeat(4)}界`;
    const state = monitorState({
      runs: [SINGLE_STEP_RUN],
      selectedNodeId: SINGLE_STEP_RUN.runId,
      steeringFeedback: feedback,
      terminalColumns: 0,
      terminalRows: 72,
    });
    const rows = monitorRightPaneSegmentRows(state, TREE_NOW_MS);

    expect(
      rows.filter((line) => joinMonitorRow(line) !== "界").every((line) => Bun.stringWidth(joinMonitorRow(line)) <= 1),
    ).toBe(true);
    expect(rows.map(joinMonitorRow)).toContain("\u0301n");
    expect(rows.map(joinMonitorRow)).toContain("界");
    expect(rows.at(-1)).toEqual({ segments: [{ text: "界" }] });
    expect(rows.map(joinMonitorRow).join("")).toBe(
      monitorRightPaneSegmentRows({ ...state, terminalColumns: 10_000 }, TREE_NOW_MS)
        .map(joinMonitorRow)
        .join(""),
    );
    expect(rows.some((line) => joinMonitorRow(line).includes("…"))).toBe(false);
  });

  test("wrapping preserves source segment tones across wide and combining characters", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (segments.length > 0 && usedWidth + graphemeWidth > width) flush();" -> "if (false) flush();"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (current !== undefined && current.tone === segment.tone) {" -> "if (false) {"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (segments.length > 0 || wrapped.length === 0) flush();" -> "if (false) flush();"
    const source = [
      {
        segments: [
          { text: "ab界", tone: "active" as const },
          { text: "e\u0301z", tone: "failure" as const },
        ],
      },
    ];
    const wrapped = wrapMonitorRows(source, 3);

    expect(wrapped.map(joinMonitorRow)).toEqual(["ab", "界e\u0301", "z"]);
    expect(wrapped.flatMap((line) => line.segments)).toEqual([
      { text: "ab", tone: "active" },
      { text: "界", tone: "active" },
      { text: "e\u0301", tone: "failure" },
      { text: "z", tone: "failure" },
    ]);
  });

  test("wrapping keeps combining, tone, and ZWJ grapheme clusters atomic", () => {
    const source = [{ segments: [{ text: "A👍🏽e\u0301👨‍👩‍👧‍👦B", tone: "failure" as const }] }];
    const wrapped = wrapMonitorRows(source, 1);

    expect(wrapped.map(joinMonitorRow)).toEqual(["A", "👍🏽", "e\u0301", "👨‍👩‍👧‍👦", "B"]);
    expect(wrapped.flatMap((line) => line.segments)).toEqual([
      { text: "A", tone: "failure" },
      { text: "👍🏽", tone: "failure" },
      { text: "e\u0301", tone: "failure" },
      { text: "👨‍👩‍👧‍👦", tone: "failure" },
      { text: "B", tone: "failure" },
    ]);
    expect(wrapped.map(joinMonitorRow).join("")).toBe("A👍🏽e\u0301👨‍👩‍👧‍👦B");
  });
});

describe("monitorDockLines", () => {
  test("projects exactly four ordered dock rows from one state snapshot", () => {
    const state = monitorState({
      commandBuffer: "start",
      commandCursor: 5,
      machineProfile: "workstation",
      keyedSocketDigest: "0123456789abcdef",
      refreshIntervalLabel: "2s",
      lastCommandResult: "ready",
      terminalColumns: 90,
      pipelineSnapshotsBySocketPath: {
        "/socket": { pipelines: [pipelineSnapshot({ pipelineId: "active" })] },
      },
    });

    const lines = monitorDockLines(state);

    expect(lines).toEqual([
      "1 active · workstation@0123456789abcdef · refresh 2s · result: ready",
      "> start▏",
      "",
      "j/↓ next · ↑ previous · [/] divider · : command · / command · q quit",
    ]);
    expect(lines).toHaveLength(4);
    expect(lines).not.toEqual(["1 active · refresh 2s", ">", "", ""]);
  });

  test("counts retained pipeline identities once and projects RPC and command feedback together", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "(activeByPipelineId.get(snapshot.pipelineId) ?? false) || !TERMINAL_PIPELINE_STATES.has(snapshot.state)" -> "false"
    // @mutate v2/src/tui/tui-monitor-lines.ts ".filter(Boolean)" -> ""
    const terminal = pipelineSnapshot({ pipelineId: "contradictory", state: "succeeded", finishedAtMs: 20 });
    const nonTerminal = pipelineSnapshot({ pipelineId: "contradictory", state: "running", finishedAtMs: null });
    const duplicate = pipelineSnapshot({ pipelineId: "duplicate", state: "pending" });
    const terminalOnly = pipelineSnapshot({ pipelineId: "terminal-only", state: "failed", finishedAtMs: 30 });
    const state = monitorState({
      machineProfile: "profile",
      keyedSocketDigest: "digest",
      refreshIntervalLabel: "750ms",
      lastRpcError: "list\nfailed",
      lastCommandResult: "retained\rresult",
      pipelineSnapshotsBySocketPath: {
        "/a": { pipelines: [terminal, duplicate, terminalOnly] },
        "/b": { pipelines: [nonTerminal, duplicate] },
      },
      terminalColumns: 120,
    });

    expect(countActivePipelines(state)).toBe(2);
    const controlReplacement = "\uFFFD";
    expect(monitorDockLines(state)[0]).toBe(
      `2 active · profile@digest · refresh 750ms · error: list${controlReplacement}failed · result: retained${controlReplacement}result`,
    );
    expect(monitorDockLines({ ...state, lastRpcError: null })[0]).toBe(
      `2 active · profile@digest · refresh 750ms · result: retained${controlReplacement}result`,
    );
    expect(countActivePipelines({ ...state, lastRpcError: "refresh failed" })).toBe(2);
  });

  test("retains command feedback alongside RPC errors, clears only RPC on refresh, and fits both suffixes at narrow widths", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (state.lastRpcError !== null && state.lastRpcError !== undefined) {" -> "if (false) {"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (state.lastCommandResult !== null && state.lastCommandResult !== undefined) {" -> "if (false) {"
    const state = monitorState({
      machineProfile: "profile",
      keyedSocketDigest: "digest",
      refreshIntervalLabel: "750ms",
      lastRpcError: "daemon_error: list failed",
      lastCommandResult: "pipe-admitted",
      terminalColumns: 120,
    });
    const statusPrefix = "0 active · profile@digest · refresh 750ms";
    const bothSuffixes = " · error: daemon_error: list failed · result: pipe-admitted";
    const fullStatus = `${statusPrefix}${bothSuffixes}`;

    const lines = monitorDockLines(state);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(fullStatus);

    const afterSuccessfulRefresh = monitorDockLines({ ...state, lastRpcError: null });
    expect(afterSuccessfulRefresh).toHaveLength(4);
    expect(afterSuccessfulRefresh[0]).toBe(`${statusPrefix} · result: pipe-admitted`);

    const narrowWidth = Bun.stringWidth(fullStatus);
    expect(monitorDockLines({ ...state, terminalColumns: narrowWidth })[0]).toBe(fullStatus);

    const tooNarrow = Bun.stringWidth(statusPrefix) + 8;
    const truncated = monitorDockLines({ ...state, terminalColumns: tooNarrow })[0];
    expect(truncated.startsWith(statusPrefix)).toBe(true);
    expect(truncated).not.toContain("pipe-admitted");
    expect(Bun.stringWidth(truncated)).toBeLessThanOrEqual(tooNarrow);
  });

  test("bounds and sanitizes input at split, stacked, and tiny widths", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (/^[\\p{Cc}\\p{Cf}]+$/u.test(grapheme)) return DOCK_CONTROL_REPLACEMENT;" -> "if (false) return DOCK_CONTROL_REPLACEMENT;"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (used + paintedWidth > columns) break;" -> "if (false) break;"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (grapheme === \"\\t\") {" -> "if (false) {"
    // @mutate v2/src/tui/tui-monitor-lines.ts "width > columns ? DOCK_CONTROL_REPLACEMENT : safe" -> "false ? DOCK_CONTROL_REPLACEMENT : safe"
    for (const terminalColumns of [80, 120]) {
      for (const commandBuffer of [
        "",
        "x".repeat(terminalColumns - 3),
        "x".repeat(terminalColumns - 2),
        "x".repeat(terminalColumns * 3),
      ]) {
        const lines = monitorDockLines(
          monitorState({
            commandBuffer,
            commandCursor: commandBuffer.length,
            machineProfile: `unsafe\n${"p".repeat(terminalColumns)}`,
            terminalColumns,
          }),
        );
        expect(lines).toHaveLength(4);
        expect(lines.every((line) => !/\p{Cc}/u.test(line))).toBe(true);
        expect(lines.every((line) => Bun.stringWidth(line) <= terminalColumns)).toBe(true);
      }
    }

    expect(
      monitorDockLines(monitorState({ commandBuffer: "abcde", commandCursor: 5, terminalColumns: 8 })).slice(1, 3),
    ).toEqual(["> abcde▏", ""]);
    expect(
      monitorDockLines(monitorState({ commandBuffer: "abcdef", commandCursor: 6, terminalColumns: 8 })).slice(1, 3),
    ).toEqual(["> abcdef", "▏"]);
    expect(
      monitorDockLines(monitorState({ commandBuffer: "\tA\nB", commandCursor: 4, terminalColumns: 8 })).slice(1, 3),
    ).toEqual([">   A�B▏", ""]);
    expect(
      monitorDockLines(monitorState({ commandBuffer: "界", commandCursor: 0, terminalColumns: 1 })).slice(1, 3),
    ).toEqual(["▏", "�"]);
  });

  test("expands tabs from their painted row after wrapping and windowing", () => {
    const wrapped = monitorDockLines(
      monitorState({ commandBuffer: "abcdef\tX", commandCursor: 8, terminalColumns: 8 }),
    ).slice(1, 3);
    const windowed = monitorDockLines(
      monitorState({ commandBuffer: "0123456789\tX", commandCursor: 12, terminalColumns: 8 }),
    ).slice(1, 3);

    expect(wrapped).toEqual(["> abcdef", "    X▏"]);
    expect(windowed).toEqual(["> 234567", "89  X▏"]);
    expect([...wrapped, ...windowed].every((line) => Bun.stringWidth(line) <= 8)).toBe(true);
  });

  test("paints a tab that overshoots its row as one control glyph instead of blanking the row", () => {
    // A tab expands to the next four-column stop above `used`, which overshoots a
    // 7-column row. Dropping it would drop the cursor atom with it and fall back to
    // an empty input row, losing the buffer from view.
    const ascii = monitorDockLines(
      monitorState({ commandBuffer: "ab\t\t", commandCursor: 4, terminalColumns: 7 }),
    ).slice(1, 3);
    const wide = monitorDockLines(
      monitorState({ commandBuffer: "中a\t\t", commandCursor: 4, terminalColumns: 7 }),
    ).slice(1, 3);

    expect(ascii).toEqual(["> ab", "    �▏"]);
    expect(wide).toEqual(["> 中a", "    �▏"]);
    expect([...ascii, ...wide].every((line) => Bun.stringWidth(line) <= 7)).toBe(true);
  });

  test("projects a large pasted buffer without changing it", () => {
    const commandBuffer = "x".repeat(100_000);
    const state = monitorState({ commandBuffer, commandCursor: commandBuffer.length, terminalColumns: 80 });

    const lines = monitorDockLines(state);

    expect(lines).toHaveLength(4);
    expect(lines.slice(1, 3).join("")).toContain("▏");
    expect(state.commandBuffer).toBe(commandBuffer);
  });

  test("keeps clamped start, middle, and end cursors visible without mutating state", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (index === cursor) atoms.push({ text: DOCK_CURSOR, width: 1, cursor: true });" -> "if (false) atoms.push({ text: DOCK_CURSOR, width: 1, cursor: true });"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (cursor === graphemes.length) atoms.push({ text: DOCK_CURSOR, width: 1, cursor: true });" -> "if (false) atoms.push({ text: DOCK_CURSOR, width: 1, cursor: true });"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (cursorIndex < 0) return [];" -> "if (true) return [];"
    const buffer = "zero-one-two-three-four";
    const cases = [
      [-10, ["> ▏zero-on", "e-two-thre"]],
      [9, ["> zero-one", "-▏two-thre"]],
      [10_000, ["> ne-two-t", "hree-four▏"]],
    ] as const;
    for (const [commandCursor, expected] of cases) {
      const state = monitorState({ commandBuffer: buffer, commandCursor, terminalColumns: 10 });
      const before = structuredClone(state);
      const rows = monitorDockLines(state).slice(1, 3);
      const input = rows.join("");

      expect(rows).toEqual([...expected]);
      expect(input.match(/▏/gu)).toHaveLength(1);
      expect(state).toEqual(before);
      expect(state.commandBuffer).toBe(buffer);
      expect(state.commandCursor).toBe(commandCursor);
    }
  });

  test("keeps the cursor visible when an atomic grapheme consumes a row boundary", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "return columns === 1 ? \"\" : \"> \";" -> "return false ? \"\" : \"> \";"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (current.used + width > current.capacity) current = second;" -> "if (false) current = second;"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (current.used + paintedWidth > current.capacity) break;" -> "if (false) break;"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (![first, second].some((line) => line.content.includes(DOCK_CURSOR))) {" -> "if (false) {"
    const lines = monitorDockLines(monitorState({ commandBuffer: "界a", commandCursor: 2, terminalColumns: 3 }));

    expect(lines.slice(1, 3)).toEqual(["> ▏", ""]);
    expect(lines.slice(1, 3).join("")).toContain("▏");
  });

  test("shows contextual command-focus hints without multiline editing", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if ((state.focus ?? \"tree\") === \"command\") return \"Esc tree · Enter submit\";" -> "if (false) return \"Esc tree · Enter submit\";"
    // @mutate v2/src/tui/tui-monitor-lines.ts "snapshot.pipelineId === state.selectedNodeId" -> "false"
    // @mutate v2/src/tui/tui-monitor-lines.ts "monitorPipelineStageNodeId(snapshot.pipelineId, stage.stageId, stage.branchKey) === state.selectedNodeId" -> "false"
    // @mutate v2/src/tui/tui-monitor-lines.ts "state.runs.find((run) => run.runId === state.selectedNodeId)" -> "state.runs.find(() => false)"
    // @mutate v2/src/tui/tui-monitor-lines.ts "    selectedRun?.isLive === true &&" -> "    false &&"
    // @mutate v2/src/tui/tui-monitor-lines.ts "...(expandable ? [\"e expand/collapse\"] : [])" -> "...[]"
    // @mutate v2/src/tui/tui-monitor-lines.ts "...(killable ? [\"k kill\"] : [])" -> "...[]"
    const snapshot = pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [implementStage(INVOCATION_MATCHED)] });
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const active = workflowRun("run-active", "in-progress", INVOCATION_MATCHED);
    const terminal = workflowRun("run-terminal", "completed", "inv-terminal", { isLive: true });
    const notLive = workflowRun("run-idle", "in-progress", "inv-idle", { isLive: false });
    const base = monitorState({
      runs: [active, terminal, notLive],
      pipelineSnapshotsBySocketPath: { "/socket": { pipelines: [snapshot] } },
      terminalColumns: 200,
    });
    const hints = (selectedNodeId: string | null) => monitorDockLines({ ...base, selectedNodeId })[3];

    expect(hints(null)).toContain(": command");
    expect(hints(null)).toContain("/ command");
    expect(hints(null)).not.toContain("newline");
    expect(hints(null)).not.toContain("expand/collapse");
    expect(hints(null)).not.toContain("kill");
    expect(hints(PIPELINE_ID)).toContain("e expand/collapse");
    expect(hints(stageId)).toContain("e expand/collapse");
    expect(hints(active.runId)).toContain("k kill");
    expect(monitorDockLines({ ...base, selectedNodeId: active.runId, actionableRunIds: [] })[3]).not.toContain(
      "k kill",
    );
    expect(hints(active.runId)).not.toContain("expand/collapse");
    expect(hints(terminal.runId)).not.toContain("kill");
    expect(hints(notLive.runId)).not.toContain("kill");
    expect(hints("other-node")).not.toContain("kill");

    const commandHints = monitorDockLines({ ...base, selectedNodeId: active.runId, focus: "command" })[3];
    expect(commandHints).toBe("Esc tree · Enter submit");
    expect(commandHints).not.toContain("newline");
    expect(commandHints).not.toContain("kill");
    expect(commandHints).not.toContain("expand");
    expect(commandHints).not.toContain(": command");
  });
});
