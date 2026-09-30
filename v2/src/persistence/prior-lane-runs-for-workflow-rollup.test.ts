import { describe, expect, test } from "bun:test";
import { priorLaneRunsForWorkflowRollup } from "./prior-lane-runs-for-workflow-rollup.ts";
import type { Run, StateStore } from "./state-store.ts";

const lane = { project: "project", branch: "branch", specRef: "main" };

const workflowSteps = [
  { stepId: "implement", role: "implement" as const, durable: true },
  { stepId: "implement-review", role: "review" as const, behavior: "review" as const, durable: true },
];

function runRow(overrides: Partial<Run> = {}): Run {
  return {
    id: "run",
    project: lane.project,
    branch: lane.branch,
    specRef: lane.specRef,
    createdAt: 1,
    status: "completed",
    attemptCount: 0,
    worktreePath: "/worktree",
    specPath: "spec.md",
    ...overrides,
  };
}

function storeWithLaneRows(rows: Run[]): Pick<StateStore, "findWorkflowRunsOnLane"> {
  return {
    findWorkflowRunsOnLane: (query) => {
      expect(query).toEqual(lane);
      return rows;
    },
  };
}

describe("priorLaneRunsForWorkflowRollup", () => {
  test("returns no rows when the lane is empty", () => {
    const entryRun = runRow({
      id: "entry",
      stepId: "implement",
      createdAt: 200,
      workflowSnapshot: { invocationId: "inv-current", steps: [...workflowSteps] },
    });
    expect(priorLaneRunsForWorkflowRollup(entryRun, "inv-current", storeWithLaneRows([]))()).toEqual([]);
  });

  test("excludes runs from the current invocation and rows without an invocation id", () => {
    const priorSnapshot = { invocationId: "inv-prior", steps: [...workflowSteps] };
    const priorRows = [
      runRow({
        id: "prior-entry",
        stepId: "implement",
        createdAt: 50,
        workflowSnapshot: priorSnapshot,
      }),
      runRow({
        id: "prior-review",
        stepId: "implement-review",
        createdAt: 100,
        workflowSnapshot: priorSnapshot,
      }),
    ];
    const entryRun = runRow({
      id: "entry",
      stepId: "implement",
      createdAt: 200,
      workflowSnapshot: { invocationId: "inv-current", steps: [...workflowSteps] },
    });
    const laneRows = [
      ...priorRows,
      runRow({
        id: "current-inv-prior-entry",
        stepId: "implement",
        createdAt: 150,
        workflowSnapshot: { invocationId: "inv-current", steps: [...workflowSteps] },
      }),
      runRow({
        id: "same-inv-review",
        stepId: "implement-review",
        createdAt: 160,
        workflowSnapshot: { invocationId: "inv-current", steps: [...workflowSteps] },
      }),
      runRow({
        id: "missing-invocation-entry",
        stepId: "implement",
        createdAt: 40,
        workflowSnapshot: { steps: [...workflowSteps] } as NonNullable<Run["workflowSnapshot"]>,
      }),
      runRow({
        id: "missing-invocation-review",
        stepId: "implement-review",
        createdAt: 45,
        workflowSnapshot: { steps: [...workflowSteps] } as NonNullable<Run["workflowSnapshot"]>,
      }),
    ];
    expect(priorLaneRunsForWorkflowRollup(entryRun, "inv-current", storeWithLaneRows(laneRows))()).toEqual(priorRows);
  });

  test("returns an earlier invocation's rows when its entry row predates the entry run", () => {
    const priorSnapshot = { invocationId: "inv-prior", steps: [...workflowSteps] };
    const priorRows = [
      runRow({
        id: "prior-entry",
        stepId: "implement",
        createdAt: 50,
        workflowSnapshot: priorSnapshot,
      }),
      runRow({
        id: "prior-review",
        stepId: "implement-review",
        createdAt: 100,
        workflowSnapshot: priorSnapshot,
      }),
    ];
    const entryRun = runRow({
      id: "entry",
      stepId: "implement",
      createdAt: 200,
      workflowSnapshot: { invocationId: "inv-current", steps: [...workflowSteps] },
    });
    expect(priorLaneRunsForWorkflowRollup(entryRun, "inv-current", storeWithLaneRows(priorRows))()).toEqual(priorRows);
  });

  test("drops invocation groups whose entry row is missing or not strictly before the entry run", () => {
    const priorSnapshot = { invocationId: "inv-prior", steps: [...workflowSteps] };
    const entryRun = runRow({
      id: "entry",
      stepId: "implement",
      createdAt: 200,
      workflowSnapshot: { invocationId: "inv-current", steps: [...workflowSteps] },
    });
    const tooNew = [
      runRow({
        id: "prior-entry-new",
        stepId: "implement",
        createdAt: 250,
        workflowSnapshot: priorSnapshot,
      }),
    ];
    const reviewOnly = [
      runRow({
        id: "prior-review-only",
        stepId: "implement-review",
        createdAt: 100,
        workflowSnapshot: priorSnapshot,
      }),
    ];
    const store = storeWithLaneRows([...tooNew, ...reviewOnly]);
    expect(priorLaneRunsForWorkflowRollup(entryRun, "inv-current", store)()).toEqual([]);
  });
});
