import { describe, expect, test } from "bun:test";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { RUN_STATUSES } from "../persistence/state-store.ts";
import {
  firstSelectableRunId,
  joinMonitorRow,
  livenessTone,
  monitorSegmentRows,
  monitorTextLines,
  orderSelectableRuns,
  RUN_STATUS_TONES,
} from "./tui-monitor-lines.ts";
import type { TuiMonitorState } from "./tui-monitor-types.ts";

const SINGLE_STEP_RUN: DaemonListRunRow = {
  runId: "run-single",
  project: "demo",
  branch: "single",
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
  status: "in-progress",
  isLive: true,
  workflow: {
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
    selectedRunId: null,
    waitState: { kind: "none" },
    steeringFeedback: null,
    ...overrides,
  };
}

const MONITOR_LINES_FIXTURE_STATE: TuiMonitorState = {
  runs: [
    { runId: "run-alpha", project: "demo", branch: "alpha", status: "in-progress", isLive: true },
    { runId: "run-beta", project: "demo", branch: "beta", status: "completed", isLive: false },
    { runId: "run-queued", project: "demo", branch: "queued", status: "queued", isLive: false },
  ],
  selectedRunId: "run-alpha",
  waitState: { kind: "ready", runId: "run-alpha", result: { runStatus: "in-progress" } },
  steeringFeedback: "daemon_error: paused",
};

const MONITOR_LINES_FIXTURE_PIN = [
  "jarvis tui",
  "runId project branch status liveness",
  "> run-alpha demo alpha in-progress live",
  "  run-beta demo beta completed not-live",
  "Queue",
  "  run-queued demo queued queued waiting: memory headroom",
  "Outcome",
  "runStatus: in-progress",
  "daemon_error: paused",
  "Press up/down or j to select; q or Ctrl-C to quit.",
] as const;

describe("orderSelectableRuns", () => {
  test("lists active runs before terminal runs while preserving daemon order within each group", () => {
    const completedOlder: DaemonListRunRow = {
      runId: "run-completed-older",
      project: "demo",
      branch: "old",
      status: "completed",
      isLive: false,
    };
    const activeNewer: DaemonListRunRow = {
      runId: "run-active-newer",
      project: "demo",
      branch: "new",
      status: "in-progress",
      isLive: true,
    };
    const activeOlder: DaemonListRunRow = {
      runId: "run-active-older",
      project: "demo",
      branch: "active-old",
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
      status: "paused",
      isLive: false,
    };
    const terminal: DaemonListRunRow = {
      runId: "run-failed",
      project: "demo",
      branch: "fail",
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
      status: "completed",
      isLive: false,
    };

    expect(firstSelectableRunId([terminal, SINGLE_STEP_RUN])).toBe("run-single");
  });

  test("falls back to the first terminal row when every selectable run is terminal", () => {
    const newer: DaemonListRunRow = {
      runId: "run-newer",
      project: "demo",
      branch: "new",
      status: "killed",
      isLive: false,
    };
    const older: DaemonListRunRow = {
      runId: "run-older",
      project: "demo",
      branch: "old",
      status: "blocked",
      isLive: false,
    };

    expect(firstSelectableRunId([newer, older])).toBe("run-newer");
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
    const state = monitorState({ runs: [SINGLE_STEP_RUN], selectedRunId: "run-single" });
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
      status: "completed",
      isLive: false,
    };
    const activeSecond: DaemonListRunRow = {
      runId: "run-alpha",
      project: "demo",
      branch: "alpha",
      status: "in-progress",
      isLive: true,
    };

    const lines = monitorTextLines(monitorState({ runs: [terminalFirst, activeSecond], selectedRunId: "run-alpha" }));

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
        selectedRunId: "run-wf",
      }),
    );

    expect(lines).toContain("Workflow");
    expect(lines).toContain("  step-1 implement completed complete attempts=2");
    expect(lines).toContain("> step-2 review in_progress attempts=1");
    expect(lines).toContain("  step-3 verify pending attempts=0");
  });

  test("renders distinct durable draft and debate rows with terminal status tones", () => {
    const draft: DaemonListRunRow = {
      runId: "run-plan-draft",
      project: "demo",
      branch: "plan",
      status: "completed",
      isLive: false,
    };
    const debate = (status: "completed" | "failed" | "interrupted"): DaemonListRunRow => ({
      runId: `run-authored-review-${status}`,
      project: "demo",
      branch: "plan",
      status,
      isLive: false,
      workflow: {
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
      const rows = monitorSegmentRows(
        monitorState({ runs: [draft, debate(status)], selectedRunId: `run-authored-review-${status}` }),
      );
      expect(rows.map(joinMonitorRow)).toEqual(
        expect.arrayContaining([
          "  run-plan-draft demo plan completed not-live",
          `> run-authored-review-${status} demo plan ${status} not-live`,
          "  authored-plan-review  " +
            (status === "completed"
              ? "completed complete"
              : `stopped ${status === "failed" ? "invocation_failure" : status}`) +
            " attempts=1",
        ]),
      );
      const statusSegment = rows.flatMap((line) => line.segments).find((segment) => segment.text === status);
      expect(statusSegment?.tone).toBe(status === "completed" ? "success" : "failure");
    }
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
                WORKFLOW_STEP_1_COMPLETED,
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
    expect(lines.filter((line) => line.startsWith("> ") && line.includes("step-"))).toHaveLength(0);
  });

  test("no Queue heading when no runs are queued", () => {
    const lines = monitorTextLines(monitorState({ runs: [SINGLE_STEP_RUN], selectedRunId: "run-single" }));

    expect(lines).not.toContain("Queue");
  });

  test("queued runs render under a Queue heading, oldest-queued-first, with admission descriptor", () => {
    const queuedNewer: DaemonListRunRow = {
      runId: "run-queued-newer",
      project: "demo",
      branch: "newer",
      status: "queued",
      isLive: false,
    };
    const queuedOlder: DaemonListRunRow = {
      runId: "run-queued-older",
      project: "demo",
      branch: "older",
      status: "queued",
      isLive: false,
    };

    // state.runs arrives newest-first (matches daemon `list` ordering); queuedNewer was queued after queuedOlder.
    const lines = monitorTextLines(
      monitorState({ runs: [queuedNewer, queuedOlder, SINGLE_STEP_RUN], selectedRunId: "run-single" }),
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
      status: "queued",
      isLive: false,
    };

    const lines = monitorTextLines(monitorState({ runs: [queuedRun], selectedRunId: null }));

    expect(lines).toContain("No runs.");
    expect(lines).toContain("Queue");
  });
});
