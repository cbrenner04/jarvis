import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { monitorTextLines } from "./tui-monitor-lines.ts";
import { filterMonitorRunsForLiveWindow } from "./tui-monitor-terminal-window.ts";
import {
  buildWorkflowTableRows,
  workflowCollapsedContextSuffix,
  workflowRoleLabel,
} from "./tui-monitor-workflow-collapse.ts";
import type { TuiMonitorState } from "./tui-monitor-types.ts";

const FILTER_NOW_MS = 1_700_000_000_000;

const INVOCATION_ID = "inv-implement-review";

const WORKFLOW_STEPS = [
  { stepId: "implement", role: "implement", status: "completed", attemptCount: 2, terminalOutcome: "complete" },
  { stepId: "implement-review", role: "actuator", status: "in_progress", attemptCount: 1 },
  { stepId: "verify", role: "verify", status: "pending", attemptCount: 0 },
] as const;

const COMPLETED_WORKFLOW_STEPS = [
  { stepId: "implement", role: "implement", status: "completed", attemptCount: 2, terminalOutcome: "complete" },
  { stepId: "implement-review", role: "actuator", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
  { stepId: "verify", role: "verify", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
] as const;

const FAILED_WORKFLOW_STEPS = [
  { stepId: "implement", role: "implement", status: "completed", attemptCount: 2, terminalOutcome: "complete" },
  {
    stepId: "implement-review",
    role: "actuator",
    status: "stopped",
    attemptCount: 1,
    terminalOutcome: "invocation_failure",
  },
  { stepId: "verify", role: "verify", status: "pending", attemptCount: 0 },
] as const;

function workflowRun(
  overrides: Partial<DaemonListRunRow> & Pick<DaemonListRunRow, "runId" | "stepId" | "branch" | "status">,
): DaemonListRunRow {
  return {
    project: "demo",
    isLive: overrides.status === "in-progress",
    workflow: {
      invocationId: INVOCATION_ID,
      steps: [...WORKFLOW_STEPS],
    },
    ...overrides,
  };
}

function monitorState(overrides: Partial<TuiMonitorState>): TuiMonitorState {
  return {
    runs: [],
    selectedNodeId: null,
    waitState: { kind: "none" },
    steeringFeedback: null,
    ...overrides,
  };
}

function tableBodyLines(state: TuiMonitorState): string[] {
  const lines = monitorTextLines(state);
  const headerIndex = lines.indexOf("runId project branch status liveness");
  const endIndex = lines.findIndex(
    (line, index) => index > headerIndex && (line === "Workflow" || line === "Queue" || line === "Outcome"),
  );
  const end = endIndex === -1 ? lines.length : endIndex;
  return lines.slice(headerIndex + 1, end).filter((line) => line.includes(" demo "));
}

describe("workflow collapse rendering", () => {
  test("collapsed table shows one top-level row for a multi-run workflow", () => {
    // Mutating `seenInvocations` dedup + `workflow-collapsed` emit in `buildWorkflowTableRows`
    // turns this RED (one top-level row per selectable member — here run-implement + run-review;
    // run-verify is queued/excluded via orderedSelectable); no test-only global.
    const runs = [
      workflowRun({
        runId: "run-implement",
        stepId: "implement",
        branch: "feature",
        status: "completed",
        isLive: false,
        finishedAtMs: 1_000,
      }),
      workflowRun({
        runId: "run-review",
        stepId: "implement-review",
        branch: "feature-review",
        status: "in-progress",
        isLive: true,
      }),
      workflowRun({
        runId: "run-verify",
        stepId: "verify",
        branch: "feature-verify",
        status: "queued",
        isLive: false,
      }),
    ];

    const body = tableBodyLines(monitorState({ runs, selectedNodeId: "run-review" }));

    expect(body).toHaveLength(1);
    expect(body[0]).toContain("run-review");
    expect(body[0]).toContain("workflow-step:implement-review/actuator");
    expect(body.some((line) => line.includes("run-implement"))).toBe(false);
  });

  test("expanded rows show distinct role labels for each constituent run", () => {
    const runs = [
      workflowRun({
        runId: "run-implement",
        stepId: "implement",
        branch: "feature",
        status: "completed",
        isLive: false,
      }),
      workflowRun({
        runId: "run-review",
        stepId: "implement-review",
        branch: "feature-review",
        status: "in-progress",
        isLive: true,
      }),
    ];

    const tableRows = buildWorkflowTableRows(runs, runs, new Set([INVOCATION_ID]));
    const body = tableRows.map((row) => {
      const run = row.kind === "workflow-collapsed" ? row.representative : row.run;
      const suffix =
        row.kind === "workflow-collapsed"
          ? workflowCollapsedContextSuffix(row.members)
          : row.kind === "workflow-child"
            ? workflowRoleLabel(row.run)
            : "";
      return `${run.runId} ${run.project} ${run.branch} ${run.status}${suffix}`;
    });

    const implementLine = body.find((line) => line.includes("run-implement"));
    const reviewLine = body.find((line) => line.includes("run-review"));
    expect(implementLine).toBeDefined();
    expect(reviewLine).toBeDefined();
    expect(implementLine).toContain("role:implement");
    expect(reviewLine).toContain("workflow-step:implement-review/actuator");
    expect(reviewLine).not.toContain("role:actuator");
  });

  test("terminal rollup shows workflow terminal status on the collapsed row", () => {
    const completedWorkflow = { invocationId: INVOCATION_ID, steps: [...COMPLETED_WORKFLOW_STEPS] };
    const runs = [
      workflowRun({
        runId: "run-implement",
        stepId: "implement",
        branch: "feature",
        status: "completed",
        isLive: false,
        workflow: completedWorkflow,
      }),
      workflowRun({
        runId: "run-review",
        stepId: "implement-review",
        branch: "feature-review",
        status: "completed",
        isLive: false,
        workflow: completedWorkflow,
      }),
      workflowRun({
        runId: "run-verify",
        stepId: "verify",
        branch: "feature-verify",
        status: "completed",
        isLive: false,
        workflow: completedWorkflow,
      }),
    ];

    const body = tableBodyLines(monitorState({ runs, selectedNodeId: "run-implement" }));
    expect(body).toHaveLength(1);
    expect(body[0]).toContain("workflow-status:completed");
  });

  test("terminal rollup reflects a later failed step, not the entry row status", () => {
    const failedWorkflow = { invocationId: INVOCATION_ID, steps: [...FAILED_WORKFLOW_STEPS] };
    const runs = [
      workflowRun({
        runId: "run-implement",
        stepId: "implement",
        branch: "feature",
        status: "completed",
        isLive: false,
        workflow: failedWorkflow,
      }),
      workflowRun({
        runId: "run-review",
        stepId: "implement-review",
        branch: "feature-review",
        status: "failed",
        isLive: false,
        workflow: failedWorkflow,
      }),
    ];

    const body = tableBodyLines(monitorState({ runs, selectedNodeId: "run-implement" }));
    expect(body).toHaveLength(1);
    expect(body[0]).toContain("workflow-status:failed");
    expect(body[0]).not.toContain("workflow-status:completed");
  });

  test("twenty-row terminal cap bounds collapsed workflow rows in rendered output", () => {
    const runs = Array.from({ length: 21 }, (_, index) => {
      const invocationId = `inv-cap-${index}`;
      const workflow = {
        invocationId,
        steps: [
          {
            stepId: "implement",
            role: "implement",
            status: "completed" as const,
            attemptCount: 1,
            terminalOutcome: "complete",
          },
        ],
      };
      return workflowRun({
        runId: `run-cap-${index}`,
        stepId: "implement",
        branch: `cap-${index}`,
        status: "completed",
        isLive: false,
        finishedAtMs: FILTER_NOW_MS - index * 1_000,
        workflow,
      });
    });

    const filtered = filterMonitorRunsForLiveWindow(runs, { nowMs: FILTER_NOW_MS });
    const body = tableBodyLines(monitorState({ runs: filtered, selectedNodeId: "run-cap-0" }));
    expect(body.filter((line) => line.includes("workflow-status:"))).toHaveLength(20);
  });
});
