import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { PipelineSnapshot } from "../daemon/pipeline-observation.ts";
import { RUN_STATUSES } from "../persistence/state-store.ts";
import { buildAttentionRows } from "./tui-attention-rows.ts";
import {
  buildTreeRunRow,
  firstSelectableRunId,
  joinMonitorRow,
  livenessTone,
  mergePipelineSnapshots,
  monitorDockLines,
  monitorLeftPaneAttentionRows,
  monitorLeftPaneQueueRows,
  monitorLeftPaneTreeRows,
  monitorLeftPaneWorkHeadingRows,
  monitorRightPaneSegmentRows,
  monitorSegmentRows,
  monitorSelectableNodeIds,
  monitorTextLines,
  orderSelectableRuns,
  pipelineObservationBuckets,
  RUN_STATUS_TONES,
  wrapMonitorRows,
} from "./tui-monitor-lines.ts";
import {
  buildMonitorPipelineTreeJoin,
  buildStageMonitorTreeRow,
  monitorPipelineBranchNodeId,
  monitorPipelineStageNodeId,
} from "./tui-monitor-pipeline-tree.ts";
import { TUI_TERMINAL_WINDOW_MS } from "./tui-monitor-terminal-window.ts";
import type { TuiMonitorState } from "./tui-monitor-types.ts";
import type { WorkflowTableRow } from "./tui-monitor-workflow-collapse.ts";
import { computeShellLayout, monitorTreeRun } from "./tui-shell-layout.ts";
import { formatAbsoluteTimestamp } from "./tui-timestamp-format.ts";

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

/** Composed rows are `indent, marker, gap, label, gap, atom0, gap, atom1, ...`; gaps interleaved are excluded. */
function clusterAtoms(row: ReturnType<typeof buildStageMonitorTreeRow>): string[] {
  return row.segments
    .slice(5)
    .filter((_, index) => index % 2 === 0)
    .map((segment) => segment.text);
}

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
    decidedAt: null,
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

function dockStatus(state: TuiMonitorState): string {
  return monitorDockLines({ terminalColumns: 245, ...state })[0];
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
  // Fixture's work tree is always non-empty, so the Work heading always claims one row.
  const maxVisibleRows = layout.paneHeight - 1;
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

/** First segment of a composed run/ad-hoc row is always the `2 * depth`-column indent. */
function indentSegmentText(tableRow: WorkflowTableRow, depth: number): string {
  return buildTreeRunRow(tableRow, depth, 90, TEST_NOW_MS).segments[0]?.text ?? "";
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
  "── Queue (1) ──",
  "  run-queued demo queued queued waiting: memory headroom",
  "Run",
  "runId: run-alpha",
  "project: demo",
  "branch: alpha",
  "status: in-progress",
  "isLive: true",
  "createdAt: 1970-01-01T00:00:00Z",
  " ",
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

describe("buildTreeRunRow liveness", () => {
  test("omits liveness for every not-live run or ad-hoc row while retaining live liveness", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "...(run.isLive ? { live: \"live\", liveTone: \"active\" as const } : {})," -> "...(run.isLive ? { live: \"live\", liveTone: \"active\" as const } : { live: \"idle\" }),"
    // @mutate v2/src/tui/tui-monitor-lines.ts "...(run.isLive ? { live: \"live\", liveTone: \"active\" as const } : {})," -> "...(run.isLive ? {} : { live: \"live\", liveTone: \"active\" as const }),"
    const liveRow: WorkflowTableRow = {
      kind: "standalone",
      run: workflowRun("run-live", "in-progress", "inv-live", { isLive: true }),
    };
    const terminalNotLiveRow: WorkflowTableRow = {
      kind: "standalone",
      run: workflowRun("run-terminal", "completed", "inv-terminal", { isLive: false, finishedAtMs: 5_000 }),
    };
    const pausedNotLiveRow: WorkflowTableRow = {
      kind: "standalone",
      run: workflowRun("run-paused", "paused", "inv-paused", { isLive: false }),
    };
    const orphanRun = workflowRun("run-adhoc", "completed", "inv-adhoc-orphan", { isLive: false, finishedAtMs: 6_000 });
    const { adHocNodes } = buildMonitorPipelineTreeJoin([], [orphanRun]);
    const adHocRow = adHocNodes[0];
    if (adHocRow === undefined) throw new Error("expected an ad-hoc node");

    const cases = [
      { label: "live", tableRow: liveRow, expectLive: true },
      { label: "terminal not-live", tableRow: terminalNotLiveRow, expectLive: false },
      { label: "paused not-live", tableRow: pausedNotLiveRow, expectLive: false },
      { label: "ad-hoc not-live", tableRow: adHocRow.tableRow, expectLive: false },
    ];

    for (const { label, tableRow, expectLive } of cases) {
      const composed = buildTreeRunRow(tableRow, 0, 90, TEST_NOW_MS);
      const text = joinMonitorRow(composed);
      const run = monitorTreeRun(tableRow);
      expect(text, label).toContain(run.status);
      expect(text, label).not.toContain("idle");
      const liveSegment = composed.segments.find((segment) => segment.text === "live");
      if (expectLive) {
        expect(liveSegment?.tone, label).toBe("active");
      } else {
        expect(liveSegment, label).toBeUndefined();
        expect(text, label).not.toMatch(/\blive\b/);
      }
    }
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

  test("renders ruled Queue heading only for queued rows", () => {
    // Mutation checkpoint: disabling empty-Queue suppression must turn this assertion RED.
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (queuedRuns.length === 0) return [];" -> "if (false) return [];"
    // Empty queue: no heading painted at all.
    const emptyLines = monitorTextLines(monitorState({ runs: [SINGLE_STEP_RUN], selectedNodeId: "run-single" }));
    expect(emptyLines.some((line) => line.includes("Queue"))).toBe(false);

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

    const queueIndex = lines.indexOf("── Queue (2) ──");
    const olderIndex = lines.findIndex((line) => line.includes("run-queued-older"));
    const newerIndex = lines.findIndex((line) => line.includes("run-queued-newer"));

    // Keystone checkpoint: reverting to the bare `Queue` label must turn this assertion RED.
    // @mutate v2/src/tui/tui-monitor-lines.ts "row(untoned(`── Queue (${queuedRuns.length}) ──`))" -> "row(untoned(\"Queue\"))"
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
    expect(lines).toContain("── Queue (1) ──");
  });
});

describe("monitorLeftPaneTreeRows", () => {
  test("emits pipeline, stage, and run rows with increasing depth and appends the ad-hoc orphan as a top-level row", () => {
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

    const { treeRows } = monitorLeftPaneTreeRows(state, treeLayout(), TREE_NOW_MS);

    expect(treeRows.map((row) => ({ kind: row.kind, id: row.id, depth: row.depth }))).toEqual([
      { kind: "pipeline", id: PIPELINE_ID, depth: 0 },
      { kind: "stage", id: stageId, depth: 1 },
      { kind: "run", id: "run-implement", depth: 2 },
      { kind: "adhoc", id: "run-orphan", depth: 0 },
    ]);
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
    expect(indentSegmentText({ kind: "standalone", run: matchedRun }, 0)).toBe("");
    expect(indentSegmentText({ kind: "standalone", run: matchedRun }, 1)).toBe("  ");
    expect(indentSegmentText(runRow.tableRow, 2)).toBe("    ");
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

    expect(indentSegmentText(childRow.tableRow, 3)).toBe("      ");
  });

  test("keeps stage-matched runs out of the ad-hoc top level when they fail the terminal window", () => {
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

    const { treeRows } = monitorLeftPaneTreeRows(state, treeLayout(), TREE_NOW_MS);

    expect(treeRows.some((row) => row.kind === "run" && row.id === "run-stale-matched")).toBe(true);
    expect(treeRows.some((row) => row.kind === "adhoc")).toBe(false);
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

describe("monitorLeftPaneAttentionRows", () => {
  test("renders the pinned attention segment", () => {
    // Keystone checkpoint: an in-body mutation directive disables the complete attention consumer integration.
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (projection.total === 0) return [];" -> "return [];"
    const undatedGate = pipelineSnapshot({
      pipelineId: "pipe-gate",
      name: "full-review",
      stages: [snapshotStage({ stageId: "approve-intent", position: 0, status: "awaiting" })],
    });
    const failedRuns: DaemonListRunRow[] = Array.from({ length: 6 }, (_, index) =>
      workflowRun(`run-fail-${index}`, "failed", `inv-fail-${index}`, {
        finishedAtMs: 1_000 * (index + 1),
        isLive: false,
      }),
    );
    const state = monitorState({
      runs: failedRuns,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [undatedGate] } },
    });

    const lines = monitorLeftPaneAttentionRows(state, TREE_NOW_MS).map(joinMonitorRow);

    // Seven actionable incidents (one gate, six failed runs): heading reports the pre-cap total,
    // six selectable rows paint, and the seventh (newest, capped out) shows only as overflow.
    expect(lines[0]).toBe("── Needs attention (7) ──");
    expect(lines).toHaveLength(1 + 6 + 1);
    expect(lines.at(-1)).toBe("+1 more");
    // The undated gate (no predecessor) paints no age; dated failed runs paint their durable idle age.
    expect(lines[1]).toContain("approve-intent");
    expect(lines[1]).not.toContain("idle");
    expect(lines[2]).toContain("idle");
  });

  test("reserves every painted left-pane heading without a negative tree budget", () => {
    const noIncidents = monitorState({});
    expect(monitorLeftPaneAttentionRows(noIncidents, TREE_NOW_MS)).toEqual([]);
    // No actionable incidents: the attention segment consumes zero work-tree viewport rows.
    // The non-empty Work tree still reserves its own heading row.
    const { pipelines: fillerPipelines } = overflowPaneMonitorFixture();
    const noIncidentTreeState = monitorState({
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: fillerPipelines } },
    });
    const smallLayout = treeLayout(10); // paneHeight 6
    expect(monitorLeftPaneTreeRows(noIncidentTreeState, smallLayout, TREE_NOW_MS).treeRows.length).toBe(
      smallLayout.paneHeight - 1,
    );

    const eightDatedFailures: DaemonListRunRow[] = Array.from({ length: 8 }, (_, index) =>
      workflowRun(`run-overflow-${index}`, "failed", `inv-overflow-${index}`, {
        finishedAtMs: 1_000 * (index + 1),
        isLive: false,
      }),
    );
    const overflowState = monitorState({ runs: eightDatedFailures });
    const overflowLines = monitorLeftPaneAttentionRows(overflowState, TREE_NOW_MS).map(joinMonitorRow);
    // Mutation checkpoint: in-body mutation directives invert overflow rendering, empty-segment
    // suppression, durable-age omission, queue order, attention viewport subtraction, and the
    // tree-budget floor; each turns this test red.
    // @mutate v2/src/tui/tui-monitor-lines.ts "projection.overflow > 0 ? [row(untoned(`+${projection.overflow} more`))] : []" -> "[row(untoned(`+${projection.overflow} more`))]"
    expect(overflowLines).toHaveLength(1 + 6 + 1);
    expect(overflowLines.at(-1)).toBe("+2 more");
    expect(overflowLines.slice(1, 7).every((line) => line.includes("idle"))).toBe(true);
    // The overflow line renders only above the cap: six or fewer incidents paint no `+N more` line,
    // so inverting the `overflow > 0` guard (painting `+0 more`) turns this red.
    const fewFailures: DaemonListRunRow[] = Array.from({ length: 3 }, (_, index) =>
      workflowRun(`run-few-${index}`, "failed", `inv-few-${index}`, {
        finishedAtMs: 1_000 * (index + 1),
        isLive: false,
      }),
    );
    const fewState = monitorState({ runs: fewFailures });
    const fewLines = monitorLeftPaneAttentionRows(fewState, TREE_NOW_MS).map(joinMonitorRow);
    expect(fewLines).toHaveLength(1 + 3);
    expect(fewLines.some((line) => line.includes("more"))).toBe(false);
    // @mutate v2/src/tui/tui-monitor-lines.ts "age === \"\" ? [] : [separator(), untoned(`idle ${age}`)]" -> "[separator(), untoned(`idle ${age}`)]"

    const snapshot = pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [implementStage(INVOCATION_MATCHED)] });
    const matchedRun = workflowRun("run-implement", "in-progress", INVOCATION_MATCHED);
    const failedA = workflowRun("run-attn-a", "failed", "inv-attn-a", { finishedAtMs: 1_000, isLive: false });
    const failedB = workflowRun("run-attn-b", "failed", "inv-attn-b", { finishedAtMs: 2_000, isLive: false });
    const queuedRun: DaemonListRunRow = {
      runId: "run-queued-attn",
      project: "demo",
      branch: "q",
      createdAt: 0,
      status: "queued",
      isLive: false,
    };
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const baseState = monitorState({
      runs: [matchedRun, failedA, failedB, queuedRun],
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
      expandedPipelineNodeIds: [PIPELINE_ID, stageId],
    });

    // attentionRowCount = 3 (heading + 2 rows, no overflow); Work reservation = 1; queue reservation = 1.
    const roomyLayout = treeLayout(76); // paneHeight 72
    const roomy = monitorLeftPaneTreeRows(baseState, roomyLayout, TREE_NOW_MS);
    const tightLayout = treeLayout(10); // paneHeight 6
    const tight = monitorLeftPaneTreeRows(baseState, tightLayout, TREE_NOW_MS);
    // Full flattened tree is unchanged by pane height or attention/Work/queue reservations.
    expect(tight.fullTreeRows.map((r) => r.id)).toEqual(roomy.fullTreeRows.map((r) => r.id));
    expect(roomy.treeRows).toEqual(roomy.fullTreeRows);
    expect(tight.treeRows.length).toBe(Math.max(0, tightLayout.paneHeight - 3 - 1 - 1));
    // @mutate v2/src/tui/tui-monitor-lines.ts "leftPaneAttentionRowCount(state) + leftPaneWorkHeadingRowCount(displayNodes) + leftPaneQueueHeadingRowCount(state)" -> "leftPaneWorkHeadingRowCount(displayNodes) + leftPaneQueueHeadingRowCount(state)"
    // @mutate v2/src/tui/tui-monitor-lines.ts "leftPaneAttentionRowCount(state) + leftPaneWorkHeadingRowCount(displayNodes) + leftPaneQueueHeadingRowCount(state)" -> "leftPaneAttentionRowCount(state) + leftPaneQueueHeadingRowCount(state)"
    // @mutate v2/src/tui/tui-monitor-lines.ts "leftPaneAttentionRowCount(state) + leftPaneWorkHeadingRowCount(displayNodes) + leftPaneQueueHeadingRowCount(state)" -> "leftPaneAttentionRowCount(state) + leftPaneWorkHeadingRowCount(displayNodes)"

    // Queue reservation and rows are unaffected by the attention/Work segments (existing Queue stays after the tree).
    expect(monitorLeftPaneQueueRows(baseState).map(joinMonitorRow)[0]).toBe("── Queue (1) ──");

    // A pane too small for the reservations never yields a negative tree budget.
    const overwhelmedState = monitorState({
      runs: [matchedRun, ...eightDatedFailures, queuedRun],
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
      expandedPipelineNodeIds: [PIPELINE_ID, stageId],
    });
    const overwhelmedLayout = treeLayout(7); // paneHeight 3
    expect(monitorLeftPaneTreeRows(overwhelmedState, overwhelmedLayout, TREE_NOW_MS).treeRows).toEqual([]);
    // @mutate v2/src/tui/tui-monitor-lines.ts "Math.max(0, layout.paneHeight - reserved)" -> "layout.paneHeight - reserved"
  });
});

describe("monitorLeftPaneWorkHeadingRows", () => {
  test("renders ruled Work heading from the full work model", () => {
    // Mutation checkpoint: painting Work for a genuinely empty model must turn this guard RED.
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (displayNodes.length === 0) return [];" -> "return [];"
    const emptyState = monitorState({});
    expect(monitorLeftPaneWorkHeadingRows(emptyState)).toEqual([]);

    const snapshot = pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [implementStage(INVOCATION_MATCHED)] });
    const matchedRun = workflowRun("run-implement", "in-progress", INVOCATION_MATCHED);
    const orphanRun = workflowRun("run-orphan", "completed", INVOCATION_ORPHAN, { isLive: false });
    const stageId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const state = monitorState({
      runs: [matchedRun, orphanRun],
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
      expandedPipelineNodeIds: [PIPELINE_ID, stageId],
    });
    // Complete model: the pipeline and the ad-hoc orphan are the only depth-zero nodes (2), even
    // though the expanded pipeline nests a stage and run row deeper in the same model.
    expect(monitorLeftPaneWorkHeadingRows(state).map(joinMonitorRow)).toEqual(["── Work (2) ──"]);

    // A non-empty model still paints Work even when its clipped tree-row budget is zero.
    const zeroVisibleLayout = treeLayout(4); // paneHeight 0
    expect(monitorLeftPaneTreeRows(state, zeroVisibleLayout, TREE_NOW_MS).treeRows).toEqual([]);
    expect(monitorLeftPaneWorkHeadingRows(state).map(joinMonitorRow)).toEqual(["── Work (2) ──"]);
  });
});

describe("mergePipelineSnapshots", () => {
  test("an empty or undefined socket map merges to no snapshots", () => {
    expect(mergePipelineSnapshots(undefined)).toEqual([]);
    expect(mergePipelineSnapshots({})).toEqual([]);
  });

  test("distinct pipelines from both sockets survive in sorted socket-path order", () => {
    const onB = pipelineSnapshot({ pipelineId: "b-only", state: "running" });
    const onA = pipelineSnapshot({ pipelineId: "a-only", state: "running" });

    const merged = mergePipelineSnapshots({ "/b": { pipelines: [onB] }, "/a": { pipelines: [onA] } });

    expect(merged.map((snapshot) => snapshot.pipelineId)).toEqual(["a-only", "b-only"]);
  });

  test("merging two sockets serving the same pipeline yields one snapshot per pipelineId", () => {
    // Keystone: reverting the never-seen-pipelineId guard to always-push reproduces the pre-fix
    // duplicate-row defect (concatenation, one snapshot per socket instead of one per pipelineId).
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (existingIndex === undefined) {" -> "if (true) {"
    const snapshotA = pipelineSnapshot({ pipelineId: "shared", state: "running" });
    const snapshotB = pipelineSnapshot({ pipelineId: "shared", state: "running" });

    const merged = mergePipelineSnapshots({ "/a": { pipelines: [snapshotA] }, "/b": { pipelines: [snapshotB] } });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.pipelineId).toBe("shared");
  });

  test("the more-advanced snapshot at the later socket path outranks the earlier, less-advanced one", () => {
    // Mutation checkpoint: collapsing the collision guard to first-encounter-wins turns this test RED.
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (pipelineSnapshotOutranks(snapshot, socketPath, current, currentSocketPath)) {" -> "if (false) {"
    const lessAdvanced = pipelineSnapshot({ pipelineId: "shared", state: "running", finishedAtMs: null, stages: [] });
    const moreAdvanced = pipelineSnapshot({
      pipelineId: "shared",
      state: "succeeded",
      finishedAtMs: 10,
      stages: [snapshotStage({ stageId: "implement", endedAt: 10 })],
    });

    const merged = mergePipelineSnapshots({
      "/a": { pipelines: [lessAdvanced] },
      "/b": { pipelines: [moreAdvanced] },
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.finishedAtMs).toBe(10);
  });

  test("the more-advanced snapshot at the earlier socket path outranks the later, less-advanced one", () => {
    // Mutation checkpoint: collapsing the collision guard to unconditional last-wins turns this test RED.
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (pipelineSnapshotOutranks(snapshot, socketPath, current, currentSocketPath)) {" -> "if (true) {"
    const moreAdvanced = pipelineSnapshot({
      pipelineId: "shared",
      state: "succeeded",
      finishedAtMs: 10,
      stages: [snapshotStage({ stageId: "implement", endedAt: 10 })],
    });
    const lessAdvanced = pipelineSnapshot({ pipelineId: "shared", state: "running", finishedAtMs: null, stages: [] });

    const merged = mergePipelineSnapshots({
      "/a": { pipelines: [moreAdvanced] },
      "/b": { pipelines: [lessAdvanced] },
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.finishedAtMs).toBe(10);
  });

  test("two sockets serving an identical expanded pipeline paint no duplicate node ids at any tree depth", () => {
    const pipelineId = "shared-fan-out";
    const snapshot = pipelineSnapshot({
      pipelineId,
      name: "full-review",
      state: "running",
      stages: [
        snapshotStage({ id: "intent-default", stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({
          id: "gate-alpha",
          stageId: "approve-intent",
          branchKey: "alpha",
          position: 1,
          status: "approved",
        }),
        snapshotStage({
          id: "gate-beta",
          stageId: "approve-intent",
          branchKey: "beta",
          position: 1,
          status: "approved",
        }),
        snapshotStage({ id: "plan-alpha", stageId: "plan", branchKey: "alpha", position: 2, status: "running" }),
        snapshotStage({ id: "plan-beta", stageId: "plan", branchKey: "beta", position: 2, status: "running" }),
      ],
    });
    const branchAlphaId = monitorPipelineBranchNodeId(pipelineId, "alpha");
    const branchBetaId = monitorPipelineBranchNodeId(pipelineId, "beta");
    const state = monitorState({
      pipelineSnapshotsBySocketPath: { "/a": { pipelines: [snapshot] }, "/b": { pipelines: [snapshot] } },
      expandedPipelineNodeIds: [pipelineId, branchAlphaId, branchBetaId],
      terminalColumns: 245,
      terminalRows: 72,
    });

    const { treeRows } = monitorLeftPaneTreeRows(state, treeLayout(), TREE_NOW_MS);
    const selectableIds = monitorSelectableNodeIds(state, TREE_NOW_MS);
    const treeIds = treeRows.map((row) => row.id);

    expect(treeIds.length).toBe(new Set(treeIds).size);
    expect(selectableIds.length).toBe(new Set(selectableIds).size);
    expect(treeIds).toEqual(
      expect.arrayContaining([
        pipelineId,
        branchAlphaId,
        branchBetaId,
        monitorPipelineStageNodeId(pipelineId, "plan", "alpha"),
        monitorPipelineStageNodeId(pipelineId, "plan", "beta"),
      ]),
    );
  });
});

describe("monitorSelectableNodeIds", () => {
  test("lists every full-flatten work-tree row id in pane order", () => {
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

  test("every ad-hoc row stays selectable when the work tree overflows the pane", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "node.kind === \"adhoc\" ? [node] : flattenPipelineNode(node, effectiveExpansion, builderRuns)" -> "node.kind === \"adhoc\" ? [] : flattenPipelineNode(node, effectiveExpansion, builderRuns)"
    const terminalColumns = 80;
    const terminalRows = 24;
    const layout = computeShellLayout(terminalColumns, terminalRows, 0);
    const maxVisibleRows = layout.paneHeight;
    const activeRuns = Array.from({ length: maxVisibleRows }, (_, index) =>
      workflowRun(`run-active-${index}`, "in-progress", `inv-active-${index}`, { createdAt: index }),
    );
    const finishedTerminal = workflowRun("run-term-finished", "completed", "inv-term-finished", {
      isLive: false,
      finishedAtMs: TREE_NOW_MS,
    });
    const finishlessTerminal = workflowRun("run-term-finishless", "failed", "inv-term-finishless", { isLive: false });
    const runs = [...activeRuns, finishedTerminal, finishlessTerminal];
    const state = monitorState({ runs, selectedNodeId: null, terminalColumns, terminalRows });

    const selectableIds = monitorSelectableNodeIds(state, TREE_NOW_MS);
    const { treeRows } = monitorLeftPaneTreeRows(state, layout, TREE_NOW_MS);

    expect(runs.length).toBeGreaterThan(maxVisibleRows);
    for (const run of runs) {
      expect(selectableIds).toContain(run.runId);
    }
    expect(treeRows.length).toBeLessThanOrEqual(maxVisibleRows);
  });

  test("prefixes capped attention ids before every full-flatten tree id and excludes overflow", () => {
    // Mutation checkpoint: dropping the attention-id prefix, or including the overflow row, must turn this pin RED.
    // @mutate v2/src/tui/tui-monitor-lines.ts "[...projection.rows.map((attentionRow) => attentionRow.id), ...fullTreeRows.map((row) => row.id)]" -> "fullTreeRows.map((row) => row.id)"
    const sevenFailures: DaemonListRunRow[] = Array.from({ length: 7 }, (_, index) =>
      workflowRun(`run-select-${index}`, "failed", `inv-select-${index}`, {
        finishedAtMs: 1_000 * (index + 1),
        isLive: false,
      }),
    );
    const snapshot = pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [] });
    const state = monitorState({
      runs: sevenFailures,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const projection = buildAttentionRows(state.pipelineSnapshotsBySocketPath, state.runs);
    const { fullTreeRows } = monitorLeftPaneTreeRows(state, treeLayout(), TREE_NOW_MS);
    const ids = monitorSelectableNodeIds(state, TREE_NOW_MS);

    expect(projection.total).toBe(7);
    expect(projection.overflow).toBe(1);
    expect(projection.rows).toHaveLength(6);
    expect(ids.slice(0, 6)).toEqual(projection.rows.map((row) => row.id));
    expect(ids.slice(6)).toEqual(fullTreeRows.map((row) => row.id));
    for (const overflowRun of sevenFailures) {
      const overflowRowId = `attention:failed-run:${overflowRun.runId}`;
      if (!projection.rows.some((row) => row.id === overflowRowId)) {
        expect(ids).not.toContain(overflowRowId);
      }
    }
  });
});

describe("attention selection target detail", () => {
  test("attention selection resolves target detail beyond collapsed ancestors", () => {
    // Keystone checkpoint: an in-body mutation directive disables the complete attention-target resolution.
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (attentionTargetId !== null) {" -> "if (false) {"
    // Mutation checkpoint: suppressing attention-target aliasing here must turn this pin RED.
    // @mutate v2/src/tui/tui-monitor-lines.ts "return projection.rows.find((attentionRow) => attentionRow.id === selected)?.targetId ?? null;" -> "return null;"
    const pipelineId = "pipe-attr";
    const attributedRun = workflowRun("run-attributed", "failed", "inv-attr", { finishedAtMs: 5_000, isLive: false });
    const snapshot = pipelineSnapshot({
      pipelineId,
      stages: [
        snapshotStage({ stageId: "implement", position: 0, status: "failed", workflowInvocationId: "inv-attr" }),
      ],
    });
    const adHocActive = workflowRun("run-adhoc-active", "in-progress", "inv-adhoc");
    const adHocFailed = workflowRun("run-adhoc-failed", "failed", "inv-adhoc", { finishedAtMs: 6_000, isLive: false });

    const state = monitorState({
      runs: [attributedRun, adHocActive, adHocFailed],
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
      expandedPipelineNodeIds: [], // pipeline and stage ancestors stay collapsed
    });

    const projection = buildAttentionRows(state.pipelineSnapshotsBySocketPath, state.runs);
    const attributedRow = projection.rows.find((row) => row.targetId === "run-attributed");
    const adHocRow = projection.rows.find((row) => row.kind === "failed-run" && row.targetId !== "run-attributed");
    expect(attributedRow).toBeDefined();
    expect(adHocRow).toBeDefined();
    // The failed ad-hoc member's row targets the group's representative, not itself.
    expect(adHocRow?.targetId).toBe("run-adhoc-active");

    // Mutation checkpoint: resolving stages against the complete joined model (not painted/expanded rows) here
    // must turn collapsed-ancestor target resolution RED.
    // @mutate v2/src/tui/tui-monitor-lines.ts "for (const stage of pipelineStageNodes(pipeline)) {" -> "for (const stage of []) {"
    const attributedState = { ...state, selectedNodeId: attributedRow?.id ?? null };
    const attributedLines = monitorRightPaneSegmentRows(attributedState, TREE_NOW_MS).map(joinMonitorRow);
    expect(attributedState.selectedNodeId).toBe(attributedRow?.id ?? null);
    expect(attributedLines).not.toContain("No run selected.");
    expect(attributedLines.some((line) => line.includes("run-attributed"))).toBe(true);

    const adHocState = { ...state, selectedNodeId: adHocRow?.id ?? null };
    const adHocLines = monitorRightPaneSegmentRows(adHocState, TREE_NOW_MS).map(joinMonitorRow);
    expect(adHocState.selectedNodeId).toBe(adHocRow?.id ?? null);
    expect(adHocLines).not.toContain("No run selected.");
    expect(adHocLines.some((line) => line.includes("run-adhoc-active"))).toBe(true);
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
    "Pipeline",
    `pipelineId: ${PIPELINE_ID}`,
    "name: feature-pipeline",
    "project: demo",
    "state: succeeded",
    "work: 2m",
    "idle: 5s",
    "wallClock: 2m 0s",
    `createdAt: ${formatAbsoluteTimestamp(pipelineCreatedAt)}`,
    `finishedAtMs: ${formatAbsoluteTimestamp(pipelineFinishedAt)}`,
    "terminalAction: ready",
    "seedPath: seeds/intent.md",
    `terminalPublicationSucceededAt: ${formatAbsoluteTimestamp(pipelineFinishedAt)}`,
    " ",
    "Stages",
    "stage: implement status=succeeded elapsed=1m 0s",
    "stage: implement status=succeeded elapsed=1m 0s",
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

  test("pipeline detail renders absolute timestamps as ISO 8601 UTC", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "value: formatAbsoluteTimestamp(value)" -> "value: String(value)"
    const state = monitorState({
      runs: detailedRuns,
      selectedNodeId: PIPELINE_ID,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [detailedSnapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines).toContain(`createdAt: ${formatAbsoluteTimestamp(pipelineCreatedAt)}`);
    expect(lines).toContain(`finishedAtMs: ${formatAbsoluteTimestamp(pipelineFinishedAt)}`);
    expect(lines).toContain(`terminalPublicationSucceededAt: ${formatAbsoluteTimestamp(pipelineFinishedAt)}`);
    expect(lines.some((line) => line === `createdAt: ${pipelineCreatedAt}`)).toBe(false);
  });

  test("absent absolute timestamps paint no detail row", () => {
    // @mutate v2/src/tui/tui-timestamp-format.ts "if (epochMs == null) { return \"\"; }" -> "if (false) { return \"\"; }"
    const snapshot = pipelineSnapshot({
      pipelineId: "pipe-no-absolute-timestamps",
      state: "pending",
      finishedAtMs: null,
      stages: [snapshotStage({ stageId: "implement", status: "pending" })],
    });
    const state = monitorState({
      selectedNodeId: snapshot.pipelineId,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines.some((line) => line.startsWith("finishedAtMs:"))).toBe(false);
    expect(lines.some((line) => line.startsWith("terminalPublicationSucceededAt:"))).toBe(false);
    expect(lines.some((line) => line.includes("Invalid Date"))).toBe(false);

    // Select the stage node itself (with null startedAt/endedAt/decidedAt) so stageDetailRows runs.
    const stageNodeId = monitorPipelineStageNodeId("pipe-no-absolute-timestamps", "implement", "default");
    const stageState = monitorState({
      selectedNodeId: stageNodeId,
      expandedPipelineNodeIds: ["pipe-no-absolute-timestamps"],
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });
    const stageLines = monitorRightPaneSegmentRows(stageState, TREE_NOW_MS).map(joinMonitorRow);

    expect(stageLines).toContain("Stage");
    expect(stageLines.some((line) => line.startsWith("startedAt:"))).toBe(false);
    expect(stageLines.some((line) => line.startsWith("endedAt:"))).toBe(false);
    expect(stageLines.some((line) => line.startsWith("decidedAt:"))).toBe(false);
    expect(stageLines.some((line) => line.includes("Invalid Date"))).toBe(false);
  });

  test("a stage with a decided approval instant paints decidedAt as ISO 8601 UTC", () => {
    const decidedAt = TREE_NOW_MS - 45_000;
    const snapshot = pipelineSnapshot({
      pipelineId: "pipe-decided-at",
      stages: [
        snapshotStage({
          stageId: "approve-plan",
          status: "approved",
          endedAt: TREE_NOW_MS - 45_000,
          decidedAt,
        }),
      ],
    });
    const stageNodeId = monitorPipelineStageNodeId("pipe-decided-at", "approve-plan", "default");
    const state = monitorState({
      selectedNodeId: stageNodeId,
      expandedPipelineNodeIds: ["pipe-decided-at"],
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines).toContain(`decidedAt: ${formatAbsoluteTimestamp(decidedAt)}`);
    expect(lines).toContain("decidedAt: 2023-11-14T22:12:35Z");
  });

  test("pipeline detail separates work idle and wall clock", () => {
    const createdAt = TREE_NOW_MS - 600_000;
    const stage = snapshotStage({
      stageId: "implement",
      status: "succeeded",
      startedAt: TREE_NOW_MS - 300_000,
      endedAt: TREE_NOW_MS - 180_000,
    });
    const snapshot = pipelineSnapshot({
      pipelineId: "pipe-timing-detail",
      state: "pending",
      createdAt,
      stages: [stage],
    });
    const state = monitorState({
      selectedNodeId: snapshot.pipelineId,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });
    const current = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);
    const later = monitorRightPaneSegmentRows(state, TREE_NOW_MS + 60_000).map(joinMonitorRow);
    expect(current).toContain("work: 2m");
    expect(current).toContain("idle: 3m");
    expect(current).toContain("wallClock: 10m 0s");
    expect(current).toContain(`createdAt: ${formatAbsoluteTimestamp(createdAt)}`);
    expect(later).toContain("work: 2m");
    expect(later).toContain("idle: 4m");
    expect(later).toContain("wallClock: 11m 0s");

    const terminal = { ...snapshot, state: "succeeded" as const, finishedAtMs: TREE_NOW_MS - 120_000 };
    const terminalState = monitorState({
      selectedNodeId: terminal.pipelineId,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [terminal] } },
    });
    const terminalLines = monitorRightPaneSegmentRows(terminalState, TREE_NOW_MS + 60_000).map(joinMonitorRow);
    expect(terminalLines).toContain("wallClock: 8m 0s");
    expect(terminalLines).toContain(`finishedAtMs: ${formatAbsoluteTimestamp(TREE_NOW_MS - 120_000)}`);

    const empty = pipelineSnapshot({ pipelineId: "pipe-no-activity", state: "pending", createdAt, stages: [] });
    const emptyLines = monitorRightPaneSegmentRows(
      monitorState({
        selectedNodeId: empty.pipelineId,
        pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [empty] } },
      }),
      TREE_NOW_MS,
    ).map(joinMonitorRow);
    expect(emptyLines).toContain("work: 0s");
    expect(emptyLines.some((line) => line.startsWith("idle:"))).toBe(false);
  });

  test("ordinary stage elapsed agrees across tree roll-up and detail", () => {
    const startedAt = TREE_NOW_MS - 125_000;
    const snapshot = pipelineSnapshot({
      pipelineId: "pipe-stage-elapsed",
      stages: [snapshotStage({ stageId: "implement", status: "running", startedAt })],
    });
    const pipeline = buildMonitorPipelineTreeJoin([snapshot], []).pipelineNodes[0];
    const stage = pipeline?.stages[0];
    if (stage === undefined) throw new Error("expected stage");
    expect(buildStageMonitorTreeRow(stage, 120, TREE_NOW_MS).segments.at(-1)?.text).toBe("2m 5s");

    const state = monitorState({
      selectedNodeId: stage.id,
      expandedPipelineNodeIds: [snapshot.pipelineId],
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });
    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);
    expect(lines).toContain("stage: implement status=running elapsed=2m 5s");
    expect(lines.filter((line) => line === "elapsed: 2m 5s")).toHaveLength(1);
  });

  test("a failed stage with no start paints failed before start in tree and detail", () => {
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "if (stage.status === \"failed\" && stage.startedAt === null) return \"failed before start\";" -> "if (false) return \"failed before start\";"
    // @mutate v2/src/tui/tui-monitor-pipeline-tree.ts "return compact ? \"failed!\" : \"failed before start\";" -> "return \"failed before start\";"
    const failedEndedAt = TREE_NOW_MS - 10_000;
    const snapshot = pipelineSnapshot({
      pipelineId: "pipe-failed-before-start",
      stages: [
        snapshotStage({ stageId: "implement", position: 0, status: "failed", startedAt: null, endedAt: failedEndedAt }),
        snapshotStage({ stageId: "plan", position: 1, status: "skipped", startedAt: null }),
        snapshotStage({ stageId: "review", position: 2, status: "interrupted", startedAt: null }),
        snapshotStage({ stageId: "approve-plan", position: 3, status: "awaiting", startedAt: null }),
        snapshotStage({ stageId: "verify", position: 4, status: "succeeded", startedAt: null }),
        snapshotStage({ stageId: "cleanup", position: 5, status: "pending", startedAt: null }),
      ],
    });
    const pipeline = buildMonitorPipelineTreeJoin([snapshot], []).pipelineNodes[0];
    const [failedStage, skippedStage, interruptedStage, approvalStage, malformedStage, otherStage] =
      pipeline?.stages ?? [];
    if (
      failedStage === undefined ||
      skippedStage === undefined ||
      interruptedStage === undefined ||
      approvalStage === undefined ||
      malformedStage === undefined ||
      otherStage === undefined
    ) {
      throw new Error("expected six stages");
    }

    expect(clusterAtoms(buildStageMonitorTreeRow(failedStage, 120, TREE_NOW_MS)).at(-1)).toBe("failed before start");
    expect(clusterAtoms(buildStageMonitorTreeRow(failedStage, 90, TREE_NOW_MS)).at(-1)).toBe("failed!");
    for (const stage of [skippedStage, interruptedStage, approvalStage, malformedStage, otherStage]) {
      expect(clusterAtoms(buildStageMonitorTreeRow(stage, 120, TREE_NOW_MS))).toEqual([stage.status]);
      expect(clusterAtoms(buildStageMonitorTreeRow(stage, 90, TREE_NOW_MS))).toEqual([stage.status]);
    }

    const state = monitorState({
      selectedNodeId: failedStage.id,
      expandedPipelineNodeIds: [snapshot.pipelineId],
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });
    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);
    expect(lines).toContain("stage: implement status=failed elapsed=failed before start");
    expect(lines).toContain("elapsed: failed before start");
    for (const stageId of ["plan", "review", "approve-plan", "verify", "cleanup"]) {
      expect(lines.some((line) => line.startsWith(`stage: ${stageId} `) && line.includes("elapsed="))).toBe(false);
    }
  });

  test("pipeline selection separates identity, stage roll-up, and stage detail with blank rows", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "return index === 0 ? [] : [row(untoned(SECTION_GAP))];" -> "return [];"
    const stageNodeId = monitorPipelineStageNodeId(PIPELINE_ID, "implement", "default");
    const state = monitorState({
      runs: detailedRuns,
      selectedNodeId: stageNodeId,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [detailedSnapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines).toEqual([
      ...pipelineBlock,
      " ",
      "Stage",
      "id: record-z",
      "stageId: implement",
      "branch: default",
      "position: 9",
      "status: succeeded",
      "elapsed: 1m 0s",
      "workflowInvocationId: inv-detail-a",
      `startedAt: ${formatAbsoluteTimestamp(stageStartedAt)}`,
      `endedAt: ${formatAbsoluteTimestamp(pipelineFinishedAt)}`,
      " ",
      "Artifact",
      "{",
      '  "a": {',
      '    "a": "",',
      '    "z": false',
      "  },",
      '  "z": 1',
      "}",
    ]);
    expect(lines[0]).toBe("Pipeline");
    expect(lines.at(-1)).not.toBe(" ");
    expect(lines.some((line, index) => line === " " && lines[index + 1] === " ")).toBe(false);
  });

  test("a stage-less pipeline renders no Stages heading", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "const present = sections.filter((section) => section.rows.length > 0);" -> "const present = [...sections];"
    const snapshot = pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [] });
    const state = monitorState({
      selectedNodeId: PIPELINE_ID,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines).not.toContain("Stages");
    expect(lines).not.toContain(" ");
  });

  test("an elided gate's stage record still lists in the pipeline detail roll-up", () => {
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      name: "full-review",
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "approve-intent", position: 1, status: "approved" }),
        snapshotStage({ stageId: "plan", position: 2, status: "pending" }),
      ],
    });
    const state = monitorState({
      selectedNodeId: PIPELINE_ID,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines).toContain("gate: approve-intent outcome=approved");
  });

  test("a decided gate record paints a compact gate row with its outcome", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "return status === \"approved\" || status === \"rejected\";" -> "return false;"
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({ stageId: "approve-intent", position: 1, status: "approved", endedAt: null }),
        snapshotStage({ stageId: "approve-plan", position: 3, status: "rejected", endedAt: TREE_NOW_MS - 30_000 }),
      ],
    });
    const state = monitorState({
      selectedNodeId: PIPELINE_ID,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines.slice(lines.indexOf("Stages") + 1)).toEqual([
      "gate: approve-intent outcome=approved",
      "gate: approve-plan outcome=rejected decided=30s",
    ]);
  });

  test("roll-up rows drop an empty elapsed and an empty decided age", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "const present = fields.filter(([, value]) => value !== \"\");" -> "const present = [...fields];"
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({ stageId: "plan", status: "pending", startedAt: null }),
        snapshotStage({ stageId: "approve-intent", position: 1, status: "approved", endedAt: null }),
      ],
    });
    const state = monitorState({
      selectedNodeId: PIPELINE_ID,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines.slice(lines.indexOf("Stages") + 1)).toEqual([
      "stage: plan status=pending",
      "gate: approve-intent outcome=approved",
    ]);
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
      " ",
      "Stage",
      "id: record-z",
      "stageId: implement",
      "branch: default",
      "position: 9",
      "status: succeeded",
      "elapsed: 1m 0s",
      "workflowInvocationId: inv-detail-a",
      `startedAt: ${formatAbsoluteTimestamp(stageStartedAt)}`,
      `endedAt: ${formatAbsoluteTimestamp(pipelineFinishedAt)}`,
      " ",
      "Artifact",
      "{",
      '  "a": {',
      '    "a": "",',
      '    "z": false',
      "  },",
      '  "z": 1',
      "}",
    ]);
  });

  test("stage detail under a branch is that branch's own record", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "pipeline?.snapshot.stages.find((stage) => stage.stageId === treeRow.stageId && stage.branchKey === treeRow.branchKey)" -> "pipeline?.snapshot.stages.find((stage) => stage.stageId === treeRow.stageId)"
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "implement", branchKey: "alpha", position: 2, status: "succeeded" }),
        snapshotStage({ stageId: "implement", branchKey: "beta", position: 2, status: "running" }),
      ],
    });
    const state = monitorState({
      selectedNodeId: monitorPipelineStageNodeId(PIPELINE_ID, "implement", "beta"),
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines).toContain("branch: beta");
    expect(lines).toContain("status: running");
    expect(lines).not.toContain("branch: alpha");
    expect(lines).not.toContain("status: succeeded");
  });

  test("selecting a branch node renders pipeline context and the full branch key", () => {
    const branchKey = "tui-pipeline-tree-model";
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "implement", branchKey, position: 2, status: "running" }),
        snapshotStage({ stageId: "implement", branchKey: "tui-pipeline-tree-monitor", position: 2, status: "running" }),
      ],
    });
    const state = monitorState({
      selectedNodeId: monitorPipelineBranchNodeId(PIPELINE_ID, branchKey),
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines).toContain(`pipelineId: ${PIPELINE_ID}`);
    expect(lines).toContain(`branch: ${branchKey}`);
    expect(monitorDockLines(state)[3]).toContain("e expand/collapse");
  });

  test("the pipeline roll-up heads each branch group with its full unstripped branch key", () => {
    const modelBranch = "tui-pipeline-tree-model";
    const monitorBranch = "tui-pipeline-tree-monitor";
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({ stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({ stageId: "plan", branchKey: modelBranch, position: 2, status: "succeeded" }),
        snapshotStage({ stageId: "plan", branchKey: monitorBranch, position: 2, status: "succeeded" }),
        snapshotStage({ stageId: "implement", branchKey: modelBranch, position: 4, status: "running" }),
        snapshotStage({ stageId: "implement", branchKey: monitorBranch, position: 4, status: "running" }),
      ],
    });
    const state = monitorState({
      selectedNodeId: PIPELINE_ID,
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);
    const rollup = lines.slice(lines.indexOf("Stages") + 1);

    expect(rollup).toEqual([
      "stage: intent status=succeeded",
      `Branch ${modelBranch}`,
      "stage: plan status=succeeded",
      "stage: implement status=running",
      `Branch ${monitorBranch}`,
      "stage: plan status=succeeded",
      "stage: implement status=running",
    ]);
    expect(rollup.every((line) => !line.includes("branch="))).toBe(true);
  });

  test("a completed intent stage artifact renders its downstream intents one path per line", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "return typeof record.entryRunId === \"string\" && typeof record.specPath === \"string\";" -> "return false;"
    const artifact = {
      entryRunId: "run-intent",
      invocationId: "inv-intent",
      specPath: "v2/spec/example/index.md",
      downstreamInputs: ["intents/one.md", "intents/two.md", "intents/three.md"],
      prNumber: 42,
      prUrl: "https://example.test/pr/42",
      requestedBase: "plan/example",
      resolvedBase: "main",
    };
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [snapshotStage({ stageId: "intent", status: "succeeded", artifact })],
    });
    const state = monitorState({
      selectedNodeId: monitorPipelineStageNodeId(PIPELINE_ID, "intent", "default"),
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);
    const artifactLines = lines.slice(lines.indexOf("Artifact"));

    expect(artifactLines).toEqual([
      "Artifact",
      "specPath: v2/spec/example/index.md",
      "entryRunId: run-intent",
      "invocationId: inv-intent",
      "prNumber: 42",
      "prUrl: https://example.test/pr/42",
      "requestedBase: plan/example",
      "resolvedBase: main",
      "downstreamInputs",
      "  intents/one.md",
      "  intents/two.md",
      "  intents/three.md",
    ]);
    expect(lines.some((line) => line.includes('{"'))).toBe(false);
  });

  test("an artifact with no downstream inputs paints no downstreamInputs label", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (paths.length === 0) return [];" -> "if (paths.length < 0) return [];"
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({
          stageId: "intent",
          status: "succeeded",
          artifact: { entryRunId: "run-intent", specPath: "v2/spec/example/index.md" },
        }),
      ],
    });
    const state = monitorState({
      selectedNodeId: monitorPipelineStageNodeId(PIPELINE_ID, "intent", "default"),
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines.slice(lines.indexOf("Artifact"))).toEqual([
      "Artifact",
      "specPath: v2/spec/example/index.md",
      "entryRunId: run-intent",
    ]);
    expect(lines).not.toContain("downstreamInputs");
  });

  test("a stage with no artifact paints no Artifact heading", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (isEmptyDetailValue(artifact)) return [];" -> "if (false) return [];"
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [snapshotStage({ stageId: "intent", artifact: null })],
    });
    const state = monitorState({
      selectedNodeId: monitorPipelineStageNodeId(PIPELINE_ID, "intent", "default"),
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines).not.toContain("Artifact");
  });

  test("an unrecognized artifact shape renders as indented multi-line JSON", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "const artifactSection = stageArtifactSection(stage.artifact);" -> "const artifactSection = { rows: detailRows([[\"artifact\", stage.artifact]]) };"
    const snapshot = pipelineSnapshot({
      pipelineId: PIPELINE_ID,
      stages: [
        snapshotStage({
          stageId: "inspect",
          status: "succeeded",
          artifact: { z: 1, a: { z: false, a: "" } },
        }),
      ],
    });
    const state = monitorState({
      selectedNodeId: monitorPipelineStageNodeId(PIPELINE_ID, "inspect", "default"),
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines.slice(lines.indexOf("Artifact"))).toEqual([
      "Artifact",
      "{",
      '  "a": {',
      '    "a": "",',
      '    "z": false',
      "  },",
      '  "z": 1',
      "}",
    ]);
    expect(lines).not.toContain('{"a":{"a":"","z":false},"z":1}');
  });

  test("stage failure values preserve JSON omission and falsy semantics", () => {
    const cases: ReadonlyArray<readonly [unknown, string | undefined]> = [
      [undefined, undefined],
      [false, "false"],
      [0, "0"],
      ["plain", "plain"],
      [{ z: [{ y: 2, a: 1 }], a: false }, '{"a":false,"z":[{"a":1,"y":2}]}'],
    ];

    for (const [value, expected] of cases) {
      const stage = snapshotStage({ stageId: "inspect", artifact: undefined, failureDetail: value });
      const snapshot = pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [stage] });
      const state = monitorState({
        selectedNodeId: monitorPipelineStageNodeId(PIPELINE_ID, "inspect", "default"),
        pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
      });
      const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);
      const matching = lines.filter((line) => line.startsWith("failureDetail:"));

      expect(matching).toEqual(expected === undefined ? [] : [`failureDetail: ${expected}`]);
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
    const singleStageBlock = pipelineBlock.slice(0, -1).map((line) => (line === "work: 2m" ? "work: 1m" : line));

    expect(lines).toEqual([
      ...singleStageBlock,
      " ",
      "Run",
      "runId: run-detail-a",
      "project: demo",
      "branch: selected-branch",
      "status: completed",
      "isLive: false",
      `createdAt: ${formatAbsoluteTimestamp(101)}`,
      `finishedAtMs: ${formatAbsoluteTimestamp(202)}`,
      "stepId: selected-run",
      "workflowInvocationId: inv-detail-a",
      "loopOutcomeKind: complete",
      "iterationsConsumed: 0",
      "resumable: false",
      'error: {"nextAction":"inspect_spec","publicationFailure":{"exitCode":0,"message":"failed","operation":"publish","stdoutTail":""},"reas',
      'on":"agent_blocked","retryable":false}',
      "reviewPasses: 0",
      "reviewBehavior: light",
      "prNumber: 0",
      " ",
      "Workflow",
      "  selected-plan plan completed  attempts=0",
      "> selected-run implement in_progress attempts=2",
      " ",
      "daemon_error: retained steering",
    ]);
    expect(lines.some((line) => line.includes("conflicting"))).toBe(false);
    expect(lines).not.toContain("Outcome");
    expect(lines.some((line) => line.startsWith("runStatus:"))).toBe(false);
    expect(lines).not.toContain("iterationsConsumed: 88");
    expect(lines).not.toContain("resumable: true");
  });

  test("unattributed run detail omits null and empty-string fields", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (isEmptyDetailValue(value)) return [];" -> "if (false) return [];"
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
      "status: paused",
      "isLive: false",
      `createdAt: ${formatAbsoluteTimestamp(0)}`,
      "iterationsConsumed: 0",
      "resumable: false",
      "reviewPasses: 0",
      "prNumber: 0",
    ]);
    expect(lines.some((line) => line.startsWith("pipelineId:"))).toBe(false);
    expect(lines).not.toContain("Stages");
    expect(lines).not.toContain("Outcome");
    expect(lines.some((line) => line.startsWith("runStatus:"))).toBe(false);
  });

  test("detail rows keep falsy-but-present values", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "return value === undefined || value === null || value === \"\";" -> "return !value;"
    const selectedRun: DaemonListRunRow = {
      runId: "run-falsy",
      project: "demo",
      branch: "main",
      status: "paused",
      isLive: false,
      createdAt: 0,
      iterationsConsumed: 0,
      resumable: false,
      prNumber: 0,
    };
    const lines = monitorRightPaneSegmentRows(
      monitorState({ runs: [selectedRun], selectedNodeId: selectedRun.runId }),
      TREE_NOW_MS,
    ).map(joinMonitorRow);

    expect(lines).toContain("isLive: false");
    expect(lines).toContain("iterationsConsumed: 0");
    expect(lines).toContain("resumable: false");
    expect(lines).toContain("prNumber: 0");
    expect(lines).toContain(`createdAt: ${formatAbsoluteTimestamp(0)}`);
  });

  test("ad-hoc run detail omits pipeline context when a pipeline row precedes it", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (treeRow === undefined || treeRow.kind === \"adhoc\") return undefined;" -> "if (treeRow === undefined) return undefined;"
    const snapshot = pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [implementStage(INVOCATION_MATCHED)] });
    const matchedRun = workflowRun("run-implement", "in-progress", INVOCATION_MATCHED);
    const orphanRun = workflowRun("run-orphan", "completed", INVOCATION_ORPHAN, { isLive: false });
    const state = monitorState({
      runs: [matchedRun, orphanRun],
      selectedNodeId: "run-orphan",
      pipelineSnapshotsBySocketPath: { "/tmp/test.sock": { pipelines: [snapshot] } },
    });

    const lines = monitorRightPaneSegmentRows(state, TREE_NOW_MS).map(joinMonitorRow);

    expect(lines.some((line) => line.startsWith("pipelineId:"))).toBe(false);
    expect(lines).not.toContain("Stages");
    expect(lines).toContain("Run");
    expect(lines).toContain("runId: run-orphan");
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
    expect(lines.slice(0, 5)).toEqual([
      "Pipeline",
      `pipelineId: ${offPanePipelineId}`,
      "name: pipeline-0",
      "project: demo",
      "state: succeeded",
    ]);
    expect(lines).toContain("wallClock: 1m 40s");
    expect(lines).toContain("stage: plan status=succeeded");
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
  test("classifies every pipeline state into the four dock buckets", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (snapshot.state === \"awaiting-approval\") return \"awaitingGate\";" -> "if (snapshot.state !== \"awaiting-approval\") return \"awaitingGate\";"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (RUNNING_PIPELINE_STATES.has(snapshot.state)) return \"running\";" -> "if (!RUNNING_PIPELINE_STATES.has(snapshot.state)) return \"running\";"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (snapshot.state === \"succeeded\") return \"done\";" -> "if (snapshot.state !== \"succeeded\") return \"done\";"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (FAILED_PIPELINE_STATES.has(snapshot.state)) return \"failed\";" -> "if (!FAILED_PIPELINE_STATES.has(snapshot.state)) return \"failed\";"
    const snapshots = [
      pipelineSnapshot({ pipelineId: "awaiting", state: "awaiting-approval" }),
      pipelineSnapshot({ pipelineId: "pending", state: "pending" }),
      pipelineSnapshot({ pipelineId: "running", state: "running" }),
      pipelineSnapshot({ pipelineId: "succeeded", state: "succeeded" }),
      pipelineSnapshot({ pipelineId: "failed", state: "failed" }),
      pipelineSnapshot({ pipelineId: "rejected", state: "rejected" }),
      pipelineSnapshot({ pipelineId: "interrupted", state: "interrupted" }),
    ];

    expect(
      pipelineObservationBuckets(
        monitorState({ pipelineSnapshotsBySocketPath: { "/socket": { pipelines: snapshots } } }),
      ),
    ).toEqual({ running: 2, awaitingGate: 1, failed: 3, done: 1 });
  });

  test("classifies a reachable fan-out gate ahead of sibling running work", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (snapshotHasReachableUndecidedGate(snapshot)) return \"awaitingGate\";" -> "if (false) return \"awaitingGate\";"
    const snapshot = pipelineSnapshot({
      pipelineId: "fan-out",
      name: "full-review",
      state: "running",
      stages: [
        snapshotStage({
          id: "intent-default",
          stageId: "intent",
          position: 0,
          status: "succeeded",
          artifact: {
            entryRunId: "run-intent",
            specPath: "intent.md",
            downstreamInputs: ["alpha.md", "beta.md"],
          },
        }),
        snapshotStage({
          id: "gate-alpha",
          stageId: "approve-intent",
          branchKey: "alpha",
          position: 1,
          status: "awaiting",
        }),
        snapshotStage({
          id: "gate-beta",
          stageId: "approve-intent",
          branchKey: "beta",
          position: 1,
          status: "approved",
        }),
        snapshotStage({
          id: "plan-alpha",
          stageId: "plan",
          branchKey: "alpha",
          position: 2,
          status: "pending",
        }),
        snapshotStage({
          id: "plan-beta",
          stageId: "plan",
          branchKey: "beta",
          position: 2,
          status: "running",
        }),
      ],
    });

    expect(
      pipelineObservationBuckets(
        monitorState({ pipelineSnapshotsBySocketPath: { "/socket": { pipelines: [snapshot] } } }),
      ),
    ).toEqual({
      running: 0,
      awaitingGate: 1,
      failed: 0,
      done: 0,
    });
  });

  test("counts pipeline observations by the merge-level winner per pipelineId", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "buckets[classifyPipelineObservation(snapshot)] += 1;" -> "buckets[classifyPipelineObservation(snapshot)] += 0;"
    // "colliding" is running (unfinished) on /a and terminal on /b; the merge winner is /b's
    // terminal snapshot (finished beats unfinished), so it counts once as "done", not twice.
    const state = monitorState({
      pipelineSnapshotsBySocketPath: {
        "/a": { pipelines: [pipelineSnapshot({ pipelineId: "colliding", state: "running" })] },
        "/b": { pipelines: [pipelineSnapshot({ pipelineId: "colliding", state: "succeeded", finishedAtMs: 10 })] },
      },
    });

    expect(pipelineObservationBuckets(state)).toEqual({ running: 0, awaitingGate: 0, failed: 0, done: 1 });
  });

  test("renders running and awaiting-gate counts before dock metadata", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "return `${running} running · ${awaitingGate} awaiting gate · ${failed} failed · ${done} done · ${profile}@${digest} · refresh ${refresh}${feedback}`;" -> "return `${running + awaitingGate} active · ${profile}@${digest} · refresh ${refresh}${feedback}`;"
    const state = monitorState({
      machineProfile: "profile",
      keyedSocketDigest: "digest",
      pipelineSnapshotsBySocketPath: {
        "/socket": {
          pipelines: [
            pipelineSnapshot({ pipelineId: "parked", state: "awaiting-approval" }),
            pipelineSnapshot({ pipelineId: "running", state: "running" }),
          ],
        },
      },
    });
    const prefix = "1 running · 1 awaiting gate · 0 failed · 0 done";
    const full = dockStatus(state);

    expect(full).toStartWith(`${prefix} · profile@digest`);
    expect(full.indexOf(prefix)).toBeLessThan(full.indexOf("profile@digest"));
    expect(monitorDockLines({ ...state, terminalColumns: Bun.stringWidth(prefix) })[0]).toBe(prefix);
    expect(full).not.toContain("2 active");
  });

  test("classifies ad-hoc workflow groups through their terminal rollup", () => {
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (workflowGroupHasActiveMember(members) || !isTerminalRunStatus(rollup)) {" -> "if (!workflowGroupHasActiveMember(members) && isTerminalRunStatus(rollup)) {"
    // @mutate v2/src/tui/tui-monitor-lines.ts "if (rollup === \"completed\") {" -> "if (rollup !== \"completed\") {"
    const workflow = (invocationId: string) => ({
      invocationId,
      steps: [
        { stepId: "implement", role: "implement", status: "completed" as const, attemptCount: 1 },
        { stepId: "review", role: "review", status: "completed" as const, attemptCount: 1 },
      ],
    });
    const member = (
      invocationId: string,
      stepId: string,
      status: DaemonListRunRow["status"],
      isLive = false,
    ): DaemonListRunRow =>
      workflowRun(`${invocationId}-${stepId}`, status, invocationId, {
        stepId,
        isLive,
        workflow: workflow(invocationId),
      });
    const activeWorkflow: NonNullable<DaemonListRunRow["workflow"]> = {
      invocationId: "active",
      steps: [
        { stepId: "implement", role: "implement", status: "completed", attemptCount: 1 },
        { stepId: "review", role: "review", status: "in_progress", attemptCount: 1 },
      ],
    };
    const runs = [
      workflowRun("active-implement", "completed", "active", {
        stepId: "implement",
        isLive: false,
        workflow: activeWorkflow,
      }),
      workflowRun("active-review", "in-progress", "active", {
        stepId: "review",
        isLive: false,
        workflow: activeWorkflow,
      }),
      workflowRun("hidden-live-implement", "completed", "hidden-live", {
        stepId: "implement",
        isLive: true,
        workflow: {
          invocationId: "hidden-live",
          steps: [{ stepId: "implement", role: "implement", status: "completed", attemptCount: 1 }],
        },
      }),
      member("done", "implement", "completed"),
      member("done", "review", "completed"),
      ...(["failed", "blocked", "interrupted", "killed"] as const).flatMap((status) => [
        member(status, "implement", "completed"),
        member(status, "review", status),
      ]),
    ];

    expect(dockStatus(monitorState({ runs }))).toStartWith(
      "2 running · 0 awaiting gate · 4 failed · 1 done · unknown@unknown",
    );
  });

  test("counts genuine ad-hoc invocations once without duplicating matched pipeline work", () => {
    const matched = workflowRun("matched", "completed", INVOCATION_MATCHED, { isLive: false });
    const unmatched = workflowRun("unmatched", "completed", INVOCATION_ORPHAN, { isLive: false });
    const state = monitorState({
      runs: [matched, unmatched],
      pipelineSnapshotsBySocketPath: {
        "/socket": {
          pipelines: [pipelineSnapshot({ pipelineId: PIPELINE_ID, stages: [implementStage(INVOCATION_MATCHED)] })],
        },
      },
    });

    expect(dockStatus(state)).toStartWith("1 running · 0 awaiting gate · 0 failed · 1 done · unknown@unknown");
  });

  test("counts standalone ad-hoc rows as degenerate groups", () => {
    const runs: DaemonListRunRow[] = [
      { runId: "running", project: "demo", branch: "running", createdAt: 0, status: "paused", isLive: false },
      { runId: "done", project: "demo", branch: "done", createdAt: 0, status: "completed", isLive: false },
      { runId: "failed", project: "demo", branch: "failed", createdAt: 0, status: "failed", isLive: false },
    ];

    expect(dockStatus(monitorState({ runs }))).toStartWith(
      "1 running · 0 awaiting gate · 1 failed · 1 done · unknown@unknown",
    );
  });

  test("keeps queued work out of dock counts", () => {
    const queued: DaemonListRunRow = {
      runId: "queued",
      project: "demo",
      branch: "queued",
      createdAt: 0,
      status: "queued",
      isLive: false,
    };
    const completed: DaemonListRunRow = {
      runId: "completed",
      project: "demo",
      branch: "completed",
      createdAt: 0,
      status: "completed",
      isLive: false,
    };
    const state = monitorState({ runs: [queued, completed] });

    expect(dockStatus(state)).toStartWith("0 running · 0 awaiting gate · 0 failed · 1 done · unknown@unknown");
    expect(monitorTextLines(state)).toContain("── Queue (1) ──");
    expect(monitorTextLines(state)).toContain("  queued demo queued queued waiting: memory headroom");
  });

  test("projects exactly four ordered dock rows from one state snapshot", () => {
    const state = monitorState({
      commandBuffer: "start",
      commandCursor: 5,
      machineProfile: "workstation",
      keyedSocketDigest: "0123456789abcdef",
      refreshIntervalLabel: "2s",
      lastCommandResult: "ready",
      terminalColumns: 160,
      pipelineSnapshotsBySocketPath: {
        "/socket": { pipelines: [pipelineSnapshot({ pipelineId: "active" })] },
      },
    });

    const lines = monitorDockLines(state);

    expect(lines).toEqual([
      "1 running · 0 awaiting gate · 0 failed · 0 done · workstation@0123456789abcdef · refresh 2s · result: ready",
      "> start▏",
      "",
      "j/↓ next · ↑ previous · [/] divider · : command · / command · q quit",
    ]);
    expect(lines).toHaveLength(4);
    expect(lines).not.toEqual(["1 running · refresh 2s", ">", "", ""]);
  });

  test("projects retained pipeline buckets and RPC and command feedback together", () => {
    // "contradictory" collides across sockets: /a's terminal snapshot outranks /b's running one
    // (finished beats unfinished), so it resolves to "done", not the old bucket-precedence "running".
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
      terminalColumns: 180,
    });

    expect(pipelineObservationBuckets(state)).toEqual({ running: 1, awaitingGate: 0, failed: 1, done: 1 });
    const controlReplacement = "\uFFFD";
    expect(monitorDockLines(state)[0]).toBe(
      `1 running · 0 awaiting gate · 1 failed · 1 done · profile@digest · refresh 750ms · error: list${controlReplacement}failed · result: retained${controlReplacement}result`,
    );
    expect(monitorDockLines({ ...state, lastRpcError: null })[0]).toBe(
      `1 running · 0 awaiting gate · 1 failed · 1 done · profile@digest · refresh 750ms · result: retained${controlReplacement}result`,
    );
    expect(pipelineObservationBuckets({ ...state, lastRpcError: "refresh failed" })).toEqual({
      running: 1,
      awaitingGate: 0,
      failed: 1,
      done: 1,
    });
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
      terminalColumns: 180,
    });
    const statusPrefix = "0 running · 0 awaiting gate · 0 failed · 0 done · profile@digest · refresh 750ms";
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
    // @mutate v2/src/tui/tui-monitor-lines.ts "state.selectedNodeId !== null && isExpandablePipelineNodeId(pipelineNodes, state.selectedNodeId)" -> "false"
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

  test("dock hints advertise Enter reveal only for an attention-row selection", () => {
    // Mutation checkpoint: forcing the reveal condition true in tui-monitor-lines.ts must turn this pin RED.
    // @mutate v2/src/tui/tui-monitor-lines.ts "state.selectedNodeId !== null && resolveAttentionTargetId(state, state.selectedNodeId) !== null" -> "true"
    const branchPipelineId = "pipe-hint-branch";
    const branchSnapshot = pipelineSnapshot({
      pipelineId: branchPipelineId,
      name: "full-review",
      stages: [
        snapshotStage({ id: "intent-default", stageId: "intent", position: 0, status: "succeeded" }),
        snapshotStage({
          id: "gate-alpha",
          stageId: "approve-intent",
          branchKey: "alpha",
          position: 1,
          status: "approved",
        }),
        snapshotStage({ id: "plan-alpha", stageId: "plan", branchKey: "alpha", position: 2, status: "running" }),
      ],
    });
    const branchId = monitorPipelineBranchNodeId(branchPipelineId, "alpha");
    const stageId = monitorPipelineStageNodeId(branchPipelineId, "plan", "alpha");

    const runPipelineId = "pipe-hint-run";
    const runSnapshot = pipelineSnapshot({
      pipelineId: runPipelineId,
      stages: [implementStage("inv-hint-run")],
    });
    const attributedRun = workflowRun("run-hint-attributed", "in-progress", "inv-hint-run");
    const adHocRun = workflowRun("run-hint-adhoc", "in-progress", "inv-hint-adhoc");
    const failedAdHocRun = workflowRun("run-hint-failed", "failed", "inv-hint-failed", {
      isLive: false,
      finishedAtMs: 5_000,
    });

    const state = monitorState({
      runs: [attributedRun, adHocRun, failedAdHocRun],
      pipelineSnapshotsBySocketPath: { "/socket": { pipelines: [branchSnapshot, runSnapshot] } },
      expandedPipelineNodeIds: [branchPipelineId, branchId],
      terminalColumns: 245,
    });

    const projection = buildAttentionRows(state.pipelineSnapshotsBySocketPath, state.runs);
    const attentionId = projection.rows.find((row) => row.kind === "failed-run")?.id;
    if (attentionId === undefined) throw new Error("expected a failed-run attention row");

    const hints = (selectedNodeId: string | null) => monitorDockLines({ ...state, selectedNodeId })[3];

    expect(hints(null)).not.toContain("Enter reveal");
    expect(hints(branchPipelineId)).not.toContain("Enter reveal");
    expect(hints(branchId)).not.toContain("Enter reveal");
    expect(hints(stageId)).not.toContain("Enter reveal");
    expect(hints(attributedRun.runId)).not.toContain("Enter reveal");
    expect(hints(adHocRun.runId)).not.toContain("Enter reveal");
    expect(hints(attentionId)).toContain("Enter reveal");

    const commandFocusHints = monitorDockLines({ ...state, selectedNodeId: attentionId, focus: "command" })[3];
    expect(commandFocusHints).toBe("Esc tree · Enter submit");
    expect(commandFocusHints).not.toContain("Enter reveal");
  });
});
