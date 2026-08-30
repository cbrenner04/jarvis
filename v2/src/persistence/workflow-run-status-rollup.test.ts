import { describe, expect, test } from "bun:test";
import type { Run, WorkflowSnapshot } from "./state-store.ts";
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
      { stepId: "step-0", role: "implement" },
      { stepId: "step-1", role: "review", behavior: "review" },
    ],
    ...overrides,
  };
}

describe("rollupWorkflowRunStatus", () => {
  test("returns in-progress when live", () => {
    expect(
      rollupWorkflowRunStatus({
        entryRun: createRun({ status: "completed" }),
        workflowSnapshot: createSnapshot(),
        siblingRuns: [],
        isLive: true,
      }),
    ).toBe("in-progress");
  });

  test("returns completed when all authored durable steps are completed", () => {
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement", durable: true },
        { stepId: "step-1", role: "review", behavior: "review", durable: true },
      ],
    });
    expect(
      rollupWorkflowRunStatus({
        entryRun: createRun({ stepId: "step-0", status: "completed" }),
        workflowSnapshot: snapshot,
        siblingRuns: [
          createRun({ id: "run-0", stepId: "step-0", status: "completed" }),
          createRun({ id: "run-1", stepId: "step-1", status: "completed" }),
        ],
        isLive: false,
      }),
    ).toBe("completed");
  });

  test("ignores a non-durable reviewed-plan step with no row", () => {
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "plan", durable: true },
        { stepId: "step-1", role: "", behavior: "review", durable: false },
      ],
    });
    expect(
      rollupWorkflowRunStatus({
        entryRun: createRun({ stepId: "step-0", status: "completed" }),
        workflowSnapshot: snapshot,
        siblingRuns: [createRun({ id: "run-0", stepId: "step-0", status: "completed" })],
        isLive: false,
      }),
    ).toBe("completed");
  });

  test("returns first terminal step status that is not completed", () => {
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement", durable: true },
        { stepId: "step-1", role: "review", behavior: "review", durable: true },
      ],
    });
    expect(
      rollupWorkflowRunStatus({
        entryRun: createRun({ stepId: "step-0", status: "completed" }),
        workflowSnapshot: snapshot,
        siblingRuns: [
          createRun({ id: "run-0", stepId: "step-0", status: "completed" }),
          createRun({ id: "run-1", stepId: "step-1", status: "failed" }),
        ],
        isLive: false,
      }),
    ).toBe("failed");
  });

  test("returns killed when an authored durable step has no row in non-live invocation", () => {
    expect(
      rollupWorkflowRunStatus({
        entryRun: createRun({ stepId: "step-0", status: "completed" }),
        workflowSnapshot: createSnapshot(),
        siblingRuns: [createRun({ id: "run-0", stepId: "step-0", status: "completed" })],
        isLive: false,
      }),
    ).toBe("killed");
  });

  test("treats a legacy snapshot without durability metadata as durable", () => {
    expect(
      rollupWorkflowRunStatus({
        entryRun: createRun({ stepId: "step-0", status: "completed" }),
        workflowSnapshot: createSnapshot(),
        siblingRuns: [createRun({ id: "run-0", stepId: "step-0", status: "completed" })],
        isLive: false,
      }),
    ).toBe("killed");
  });

  test("rolls up durable review-debate completion, failure, and interruption", () => {
    const entryRun = createRun({ stepId: "step-0", status: "completed" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement" },
        { stepId: "step-debate", role: "", behavior: "review-debate", durable: true },
        { stepId: "step-1", role: "review", behavior: "review" },
      ],
    });
    const siblingRuns = [
      createRun({ id: "run-0", stepId: "step-0", status: "completed" }),
      createRun({ id: "run-debate", stepId: "step-debate", status: "completed" }),
      createRun({ id: "run-1", stepId: "step-1", status: "completed" }),
    ];

    expect(rollupWorkflowRunStatus({ entryRun, workflowSnapshot: snapshot, siblingRuns, isLive: false })).toBe(
      "completed",
    );
    for (const debateStatus of ["failed", "interrupted"] as const) {
      expect(
        rollupWorkflowRunStatus({
          entryRun,
          workflowSnapshot: snapshot,
          siblingRuns: siblingRuns.map((run) =>
            run.stepId === "step-debate" ? { ...run, status: debateStatus } : run,
          ),
          isLive: false,
        }),
      ).toBe(debateStatus);
    }
  });

  test("returns blocked when a durable step is blocked", () => {
    expect(
      rollupWorkflowRunStatus({
        entryRun: createRun({ stepId: "step-0", status: "in-progress" }),
        workflowSnapshot: createSnapshot(),
        siblingRuns: [
          createRun({ id: "run-0", stepId: "step-0", status: "blocked" }),
          createRun({ id: "run-1", stepId: "step-1", status: "in-progress" }),
        ],
        isLive: false,
      }),
    ).toBe("blocked");
  });

  test("returns in-progress for live invocation even with mixed step statuses", () => {
    expect(
      rollupWorkflowRunStatus({
        entryRun: createRun({ stepId: "step-0", status: "completed" }),
        workflowSnapshot: createSnapshot(),
        siblingRuns: [
          createRun({ id: "run-0", stepId: "step-0", status: "completed" }),
          createRun({ id: "run-1", stepId: "step-1", status: "in-progress" }),
        ],
        isLive: true,
      }),
    ).toBe("in-progress");
  });

  test("handles single-step workflow", () => {
    const snapshot = createSnapshot({ steps: [{ stepId: "step-0", role: "implement" }] });
    expect(
      rollupWorkflowRunStatus({
        entryRun: createRun({ stepId: "step-0", status: "completed" }),
        workflowSnapshot: snapshot,
        siblingRuns: [createRun({ id: "run-0", stepId: "step-0", status: "completed" })],
        isLive: false,
      }),
    ).toBe("completed");
  });

  test("returns killed when a durable review-debate step has no row", () => {
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement" },
        { stepId: "step-debate", role: "", behavior: "review-debate", durable: true },
      ],
    });
    expect(
      rollupWorkflowRunStatus({
        entryRun: createRun({ stepId: "step-0", status: "completed" }),
        workflowSnapshot: snapshot,
        siblingRuns: [createRun({ id: "run-0", stepId: "step-0", status: "completed" })],
        isLive: false,
      }),
    ).toBe("killed");
  });

  test("returns entry run status without a workflow snapshot", () => {
    expect(
      rollupWorkflowRunStatus({
        entryRun: createRun({ status: "blocked" }),
        workflowSnapshot: null,
        siblingRuns: [],
        isLive: false,
      }),
    ).toBe("blocked");
    expect(
      rollupWorkflowRunStatus({
        entryRun: createRun({ status: "failed" }),
        siblingRuns: [],
        isLive: false,
      }),
    ).toBe("failed");
  });
});
