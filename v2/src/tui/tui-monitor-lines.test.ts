import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { monitorTextLines } from "./tui-monitor-lines.ts";
import type { TuiMonitorState } from "./tui-monitor-types.ts";

const SINGLE_STEP_RUN: DaemonListRunRow = {
  runId: "run-single",
  project: "demo",
  branch: "single",
  status: "in-progress",
  isLive: true,
};

const WORKFLOW_RUN: DaemonListRunRow = {
  runId: "run-wf",
  project: "demo",
  branch: "wf",
  status: "in-progress",
  isLive: true,
  workflow: {
    steps: [
      { stepId: "step-1", role: "implement", status: "completed", attemptCount: 2, terminalOutcome: "complete" },
      { stepId: "step-2", role: "review", status: "in_progress", attemptCount: 1 },
      { stepId: "step-3", role: "verify", status: "pending", attemptCount: 0 },
    ],
  },
};

function monitorState(overrides: Partial<TuiMonitorState> = {}): TuiMonitorState {
  return {
    runs: [],
    selectedRunId: null,
    waitState: { kind: "none" },
    steeringFeedback: null,
    ...overrides,
  };
}

describe("monitorTextLines", () => {
  test("workflow-backed selected run shows active step, prior outcomes, and attempt counts", () => {
    const lines = monitorTextLines(
      monitorState({
        runs: [WORKFLOW_RUN],
        selectedRunId: "run-wf",
      }),
    );

    expect(lines).toContain("Workflow");
    expect(lines).toContain("  step-1 implement completed complete attempts=2");
    expect(lines).toContain("> step-2 review in_progress attempts=1");
    expect(lines).toContain("  step-3 verify pending attempts=0");
  });

  test("single-step selected run renders no workflow chrome", () => {
    const lines = monitorTextLines(
      monitorState({
        runs: [SINGLE_STEP_RUN],
        selectedRunId: "run-single",
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
              steps: [
                WORKFLOW_RUN.workflow!.steps[0]!,
                { stepId: "step-2", role: "review", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
                { stepId: "step-3", role: "verify", status: "stopped", attemptCount: 1, terminalOutcome: "blocked" },
              ],
            },
          },
        ],
        selectedRunId: "run-wf",
      }),
    );

    expect(lines).toContain("  step-3 verify stopped blocked attempts=1");
    expect(lines.filter((line) => line.includes("pending"))).toHaveLength(0);
  });

  test("completed workflow shows no active step and final step completed", () => {
    const lines = monitorTextLines(
      monitorState({
        runs: [
          {
            ...WORKFLOW_RUN,
            status: "completed",
            isLive: false,
            workflow: {
              steps: [
                {
                  stepId: "step-a",
                  role: "implement",
                  status: "completed",
                  attemptCount: 1,
                  terminalOutcome: "complete",
                },
                { stepId: "step-b", role: "review", status: "completed", attemptCount: 1, terminalOutcome: "complete" },
              ],
            },
          },
        ],
        selectedRunId: "run-wf",
      }),
    );

    expect(lines.filter((line) => line.startsWith("> ") && line.includes("step-"))).toHaveLength(0);
    expect(lines).toContain("  step-b review completed complete attempts=1");
    expect(lines).not.toContain("pending");
  });

  test("selection change swaps workflow view to the newly selected row", () => {
    const otherWorkflowRun: DaemonListRunRow = {
      runId: "run-other",
      project: "demo",
      branch: "other",
      status: "in-progress",
      isLive: true,
      workflow: {
        steps: [{ stepId: "only", role: "implement", status: "in_progress", attemptCount: 1 }],
      },
    };

    const first = monitorTextLines(
      monitorState({
        runs: [WORKFLOW_RUN, otherWorkflowRun],
        selectedRunId: "run-wf",
      }),
    );
    const second = monitorTextLines(
      monitorState({
        runs: [WORKFLOW_RUN, otherWorkflowRun],
        selectedRunId: "run-other",
      }),
    );

    expect(first).toContain("> step-2 review in_progress attempts=1");
    expect(second).toContain("> only implement in_progress attempts=1");
    expect(second).not.toContain("step-2");
  });
});
