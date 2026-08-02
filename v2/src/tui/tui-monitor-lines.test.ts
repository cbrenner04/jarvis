import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { RUN_STATUSES } from "../persistence/state-store.ts";
import {
  firstSelectableRunId,
  joinMonitorRow,
  livenessTone,
  monitorLeftPaneTreeRows,
  monitorRightPaneSegmentRows,
  monitorSegmentRows,
  monitorSelectableNodeIds,
  monitorTextLines,
  orderSelectableRuns,
  RUN_STATUS_TONES,
} from "./tui-monitor-lines.ts";
import { monitorPipelineStageNodeId } from "./tui-monitor-pipeline-tree.ts";
import { TUI_TERMINAL_WINDOW_MS } from "./tui-monitor-terminal-window.ts";
import type { TuiMonitorState } from "./tui-monitor-types.ts";
import { computeShellLayout, listMonitorTreeCellsAtDepth, TREE_COLUMN_WIDTHS } from "./tui-shell-layout.ts";

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
    waitState: { kind: "none" },
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
  waitState: { kind: "ready", runId: "run-alpha", result: { runStatus: "in-progress" } },
  steeringFeedback: "daemon_error: paused",
};

const MONITOR_LINES_FIXTURE_PIN = [
  "runId project branch status liveness",
  "> run-alpha demo alpha in-progress live",
  "  run-beta demo beta completed not-live",
  "Queue",
  "  run-queued demo queued queued waiting: memory headroom",
  "Outcome",
  "runStatus: in-progress",
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

    expect(selectableIds).toEqual(pipelines.map((pipeline) => pipeline.pipelineId));
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
      pipelines.slice(scrollOffset, scrollOffset + maxVisibleRows).map((pipeline) => pipeline.pipelineId),
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

  test("attributed run selection starts with the same pipeline block", () => {
    const snapshot = pipelineSnapshot({
      ...detailedSnapshot,
      stages: [detailedStage],
    });
    const state = monitorState({
      runs: [detailedRun],
      selectedNodeId: "run-detail-a",
      waitState: { kind: "ready", runId: "run-detail-a", result: { runStatus: "completed" } },
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);
    const singleStageBlock = pipelineBlock.slice(0, -1);

    expect(lines.slice(0, singleStageBlock.length)).toEqual(singleStageBlock);
    expect(lines.some((line) => line === "Workflow")).toBe(true);
    expect(lines.some((line) => line.startsWith("> implement"))).toBe(true);
    expect(lines).toContain("Outcome");
    expect(lines).toContain("runStatus: completed");
  });

  test("resolves pipeline detail for off-pane tree row selection", () => {
    // Mutation checkpoint: resolving selection from painted treeRows only must turn off-pane right-pane detail pin RED.
    const { state, layout, maxVisibleRows, pipelines } = overflowPaneMonitorFixture();
    const offPanePipelineId = pipelines[maxVisibleRows]!.pipelineId;
    const paintedIds = monitorLeftPaneTreeRows(state, layout, TREE_NOW_MS).treeRows.map((row) => row.id);

    expect(paintedIds).not.toContain(offPanePipelineId);

    const lines = monitorRightPaneSegmentRows({ ...state, selectedNodeId: offPanePipelineId }, TREE_NOW_MS).map(
      joinMonitorRow,
    );

    expect(lines).not.toContain("No run selected.");
    expect(lines.slice(0, 4)).toEqual([
      `pipelineId: ${offPanePipelineId}`,
      `name: pipeline-${maxVisibleRows}`,
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
      waitState: { kind: "ready", runId: "run-implement", result: { runStatus: "in-progress" } },
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
});
