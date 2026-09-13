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
        { stepId: "step-0", role: "implement", durable: true },
        { stepId: "step-1", role: "review", behavior: "review", durable: true },
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

  test("ignores a non-durable reviewed-plan step with no row", () => {
    const entryRun = createRun({ stepId: "step-0", status: "completed" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "plan", durable: true },
        { stepId: "step-1", role: "", behavior: "review", durable: false },
      ],
    });

    expect(
      rollupWorkflowRunStatus({
        entryRun,
        workflowSnapshot: snapshot,
        siblingRuns: [createRun({ id: "run-0", stepId: "step-0", status: "completed" })],
        isLive: false,
      }),
    ).toBe("completed");
  });

  test("returns first terminal step status that is not completed", () => {
    const entryRun = createRun({ stepId: "step-0", status: "completed" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement", durable: true },
        { stepId: "step-1", role: "review", behavior: "review", durable: true },
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
        { stepId: "step-0", role: "implement" },
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

  test("treats a legacy snapshot without durability metadata as durable", () => {
    const entryRun = createRun({ stepId: "step-0", status: "completed" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement" },
        { stepId: "step-1", role: "review", behavior: "review" },
      ],
    });

    expect(
      rollupWorkflowRunStatus({
        entryRun,
        workflowSnapshot: snapshot,
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

    const status = rollupWorkflowRunStatus({
      entryRun,
      workflowSnapshot: snapshot,
      siblingRuns,
      isLive: false,
    });

    expect(status).toBe("completed");

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
    const entryRun = createRun({ stepId: "step-0", status: "in-progress" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement" },
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
        { stepId: "step-0", role: "implement" },
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
      steps: [{ stepId: "step-0", role: "implement" }],
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

  test("returns killed when a durable review-debate step has no row", () => {
    const entryRun = createRun({ stepId: "step-0", status: "completed" });
    const snapshot = createSnapshot({
      steps: [
        { stepId: "step-0", role: "implement" },
        { stepId: "step-debate", role: "", behavior: "review-debate", durable: true },
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

  test("returns entry run status when workflowSnapshot is absent", () => {
    const entryRun = createRun({ status: "failed" });
    const siblingRuns: Run[] = [];

    const status = rollupWorkflowRunStatus({
      entryRun,
      siblingRuns,
      isLive: false,
    });

    expect(status).toBe("failed");
  });
});

describe("rollupWorkflowRunStatus linked-implement rows", () => {
  const snapshot = createSnapshot({
    steps: [
      { stepId: "implement", role: "implement", durable: true },
      { stepId: "implement-review", role: "review", behavior: "review", durable: true },
    ],
  });
  const links = [
    createRun({ id: "link-0", stepId: "implement~link-0", status: "completed", createdAt: 1 }),
    createRun({ id: "link-1", stepId: "implement~link-1", status: "completed", createdAt: 2 }),
  ];
  const rollup = (siblingRuns: Run[]) =>
    rollupWorkflowRunStatus({ entryRun: links[0] as Run, workflowSnapshot: snapshot, siblingRuns, isLive: false });

  test("a failed later step is reached past completed link rows", () => {
    expect(rollup([...links, createRun({ id: "review", stepId: "implement-review", status: "failed" })])).toBe(
      "failed",
    );
  });

  test("completed links and review roll up completed", () => {
    expect(rollup([...links, createRun({ id: "review", stepId: "implement-review", status: "completed" })])).toBe(
      "completed",
    );
  });

  test("no implement row rolls up killed", () => {
    expect(rollup([createRun({ id: "review", stepId: "implement-review", status: "completed" })])).toBe("killed");
  });

  test("any failed link row fails the step over a later completed one", () => {
    const failedFirst = [{ ...(links[0] as Run), status: "failed" as const }, links[1] as Run];
    expect(rollup([...failedFirst, createRun({ id: "review", stepId: "implement-review", status: "completed" })])).toBe(
      "failed",
    );
  });

  // Implement-only snapshot: no later step can mask a partial linked implement as `killed`.
  const implementOnly = createSnapshot({ steps: [{ stepId: "implement", role: "implement", durable: true }] });
  const rollupImplementOnly = (siblingRuns: Run[]) =>
    rollupWorkflowRunStatus({ entryRun: links[0] as Run, workflowSnapshot: implementOnly, siblingRuns, isLive: false });

  test("a completed link row with no shrink or later-step row rolls up killed", () => {
    // The daemon died between link-0 and link-1: a partial implement must not settle `succeeded`.
    expect(rollupImplementOnly([links[0] as Run])).toBe("killed");
    expect(rollupImplementOnly(links)).toBe("killed");
  });

  test("a completed shrink row is evidence linked routing finished", () => {
    const shrink = createRun({ id: "shrink", stepId: "implement~shrink", status: "completed", createdAt: 3 });
    expect(rollupImplementOnly([...links, shrink])).toBe("completed");
  });
});
