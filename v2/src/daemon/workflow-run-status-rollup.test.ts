import { describe, expect, test } from "bun:test";
import type { Run, WorkflowSnapshot } from "../persistence/state-store.ts";
import { rollupWorkflowRunStatus } from "./workflow-run-status-rollup.ts";

function createRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-id",
    project: "test-project",
    specRef: "main",
    createdAt: Date.now(),
    status: "in-progress",
    attemptCount: 0,
    worktreePath: "/tmp/worktree",
    branch: "test-branch",
    specPath: "spec.md",
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return {
    invocationId: "inv-123",
    steps: [
      { stepId: "step-0", role: "implement", behavior: "write" },
      { stepId: "step-1", role: "review", behavior: "review" },
    ],
    ...overrides,
  };
}

describe("rollupWorkflowRunStatus", () => {
  test("returns in-progress when live", () => {
    const entryRun = createRun({ status: "completed" });
    const snapshot = createSnapshot();
    const siblingRuns: Run[] = [];

    const status = rollupWorkflowRunStatus({
      entryRun,
      workflowSnapshot: snapshot,
      siblingRuns,
      isLive: true,
    });

    expect(status).toBe("in-progress");
  });

  test("returns completed when all authored durable steps are completed", () => {
    const entryRun = createRun({ stepId: "step-0", status: "completed" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement", behavior: "write" },
        { stepId: "step-1", role: "review", behavior: "review" },
      ],
    });
    const siblingRuns = [
      createRun({ id: "run-0", stepId: "step-0", status: "completed" }),
      createRun({ id: "run-1", stepId: "step-1", status: "completed" }),
    ];

    const status = rollupWorkflowRunStatus({
      entryRun,
      workflowSnapshot: snapshot,
      siblingRuns,
      isLive: false,
    });

    expect(status).toBe("completed");
  });

  test("returns first terminal step status that is not completed", () => {
    const entryRun = createRun({ stepId: "step-0", status: "completed" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement", behavior: "write" },
        { stepId: "step-1", role: "review", behavior: "review" },
      ],
    });
    const siblingRuns = [
      createRun({ id: "run-0", stepId: "step-0", status: "completed" }),
      createRun({ id: "run-1", stepId: "step-1", status: "failed" }),
    ];

    const status = rollupWorkflowRunStatus({
      entryRun,
      workflowSnapshot: snapshot,
      siblingRuns,
      isLive: false,
    });

    expect(status).toBe("failed");
  });

  test("returns killed when an authored durable step has no row in non-live invocation", () => {
    const entryRun = createRun({ stepId: "step-0", status: "completed" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement", behavior: "write" },
        { stepId: "step-1", role: "review", behavior: "review" },
      ],
    });
    const siblingRuns = [createRun({ id: "run-0", stepId: "step-0", status: "completed" })];

    const status = rollupWorkflowRunStatus({
      entryRun,
      workflowSnapshot: snapshot,
      siblingRuns,
      isLive: false,
    });

    expect(status).toBe("killed");
  });

  test("skips review-debate steps when walking authored steps", () => {
    const entryRun = createRun({ stepId: "step-0", status: "completed" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement", behavior: "write" },
        { stepId: "step-debate", role: "debate", behavior: "review-debate" },
        { stepId: "step-1", role: "review", behavior: "review" },
      ],
    });
    const siblingRuns = [
      createRun({ id: "run-0", stepId: "step-0", status: "completed" }),
      createRun({ id: "run-1", stepId: "step-1", status: "completed" }),
    ];

    const status = rollupWorkflowRunStatus({
      entryRun,
      workflowSnapshot: snapshot,
      siblingRuns,
      isLive: false,
    });

    expect(status).toBe("completed");
  });

  test("returns blocked when a durable step is blocked", () => {
    const entryRun = createRun({ stepId: "step-0", status: "in-progress" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement", behavior: "write" },
        { stepId: "step-1", role: "review", behavior: "review" },
      ],
    });
    const siblingRuns = [
      createRun({ id: "run-0", stepId: "step-0", status: "blocked" }),
      createRun({ id: "run-1", stepId: "step-1", status: "in-progress" }),
    ];

    const status = rollupWorkflowRunStatus({
      entryRun,
      workflowSnapshot: snapshot,
      siblingRuns,
      isLive: false,
    });

    expect(status).toBe("blocked");
  });

  test("returns in-progress for live invocation even with mixed step statuses", () => {
    const entryRun = createRun({ stepId: "step-0", status: "completed" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement", behavior: "write" },
        { stepId: "step-1", role: "review", behavior: "review" },
      ],
    });
    const siblingRuns = [
      createRun({ id: "run-0", stepId: "step-0", status: "completed" }),
      createRun({ id: "run-1", stepId: "step-1", status: "in-progress" }),
    ];

    const status = rollupWorkflowRunStatus({
      entryRun,
      workflowSnapshot: snapshot,
      siblingRuns,
      isLive: true,
    });

    expect(status).toBe("in-progress");
  });

  test("handles single-step workflow", () => {
    const entryRun = createRun({ stepId: "step-0", status: "completed" });
    const snapshot = createSnapshot({
      steps: [{ stepId: "step-0", role: "implement", behavior: "write" }],
    });
    const siblingRuns = [createRun({ id: "run-0", stepId: "step-0", status: "completed" })];

    const status = rollupWorkflowRunStatus({
      entryRun,
      workflowSnapshot: snapshot,
      siblingRuns,
      isLive: false,
    });

    expect(status).toBe("completed");
  });

  test("returns killed when only review-debate steps are present and none have rows", () => {
    const entryRun = createRun({ stepId: "step-0", status: "completed" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement", behavior: "write" },
        { stepId: "step-debate", role: "debate", behavior: "review-debate" },
      ],
    });
    const siblingRuns = [createRun({ id: "run-0", stepId: "step-0", status: "completed" })];

    const status = rollupWorkflowRunStatus({
      entryRun,
      workflowSnapshot: snapshot,
      siblingRuns,
      isLive: false,
    });

    expect(status).toBe("completed");
  });

  test("returns entry run status when workflowSnapshot is null", () => {
    const entryRun = createRun({ status: "blocked" });
    const siblingRuns: Run[] = [];

    const status = rollupWorkflowRunStatus({
      entryRun,
      workflowSnapshot: null,
      siblingRuns,
      isLive: false,
    });

    expect(status).toBe("blocked");
  });

  test("returns entry run status when workflowSnapshot is undefined", () => {
    const entryRun = createRun({ status: "failed" });
    const siblingRuns: Run[] = [];

    const status = rollupWorkflowRunStatus({
      entryRun,
      workflowSnapshot: undefined,
      siblingRuns,
      isLive: false,
    });

    expect(status).toBe("failed");
  });
});
