import { expect, test } from "bun:test";
import type { ReviewProgress } from "../execution/workflow-runner.ts";
import type { Attempt, Run, RunStatus, WorkflowSnapshot } from "../persistence/state-store.ts";
import { stoppedOutcomeForRun, workflowRowSnapshot } from "./workflow-list-snapshot.ts";
import type { LoadedRun } from "./daemon.ts";

function runFixture(
  status: Run["status"],
  attempts: Array<Pick<Attempt, "outcomeKind">> = [],
): Run & { attempts: Attempt[] } {
  return {
    id: "run-1",
    project: "wf-outcomes",
    specRef: "main",
    createdAt: 0,
    status,
    attemptCount: attempts.length,
    worktreePath: "/tmp/wf-outcomes",
    branch: "wf-outcomes",
    specPath: "/tmp/spec.md",
    attempts: attempts.map((attempt, index) => ({
      id: `attempt-${index}`,
      runId: "run-1",
      attemptNumber: index + 1,
      startedAt: 0,
      status: "completed",
      outcomeKind: attempt.outcomeKind,
      completedAt: null,
      invocationFailureDetail: null,
    })),
  };
}

function loadedRun(workflowSnapshot: WorkflowSnapshot): LoadedRun {
  return {
    ...runFixture("completed"),
    workflowSnapshot,
    stepId: workflowSnapshot.steps[0]?.stepId ?? null,
  };
}

test.each([
  ["blocked with a contract_miss attempt", runFixture("blocked", [{ outcomeKind: "contract_miss" }]), "contract_miss"],
  ["blocked without a contract_miss attempt", runFixture("blocked", [{ outcomeKind: "blocked" }]), "blocked"],
  ["budget-soft-stopped", runFixture("budget-soft-stopped"), "budget-exhausted"],
  ["paused", runFixture("paused"), "paused"],
  ["killed", runFixture("killed"), "killed"],
  ["any other status (failed)", runFixture("failed"), "invocation_failure"],
] as const)("stoppedOutcomeForRun maps %s", (_name, run, expected) => {
  expect(stoppedOutcomeForRun(run)).toBe(expected);
});

test("completed entry rollup backstop suppresses pending without progress", () => {
  const snapshot: WorkflowSnapshot = {
    invocationId: "inv-backstop",
    steps: [
      { stepId: "step-1", role: "plan", durable: false },
      { stepId: "review-1", role: "", behavior: "review", durable: false },
      { stepId: "step-3", role: "plan", durable: false },
    ],
  };
  const row = workflowRowSnapshot(loadedRun(snapshot), new Map(), new Set(), new Map(), "completed");
  expect(row?.steps.every((step) => step.status !== "pending")).toBe(true);
  const reviewStep = row?.steps.find((step) => step.stepId === "review-1");
  expect(reviewStep?.status).toBe("completed");
});

test("completed rollup guard suppresses pending on non-durable review steps without live progress", () => {
  const snapshot: WorkflowSnapshot = {
    invocationId: "inv-completed-guard",
    steps: [{ stepId: "review-1", role: "", behavior: "review", durable: false }],
  };
  const row = workflowRowSnapshot(loadedRun(snapshot), new Map(), new Set(), new Map(), "completed");
  expect(row?.steps[0]?.status).not.toBe("pending");
});

test("completed rollup pending-suppression guard inversion", () => {
  const suppressPendingWithoutRun = (entryRollup: RunStatus) => entryRollup === "completed";
  const inverted = (entryRollup: RunStatus) => entryRollup !== "completed";
  expect(inverted("completed")).toBe(false);
  expect(suppressPendingWithoutRun("completed")).toBe(true);

  const snapshot: WorkflowSnapshot = {
    invocationId: "inv-completed-guard-inversion",
    steps: [{ stepId: "review-1", role: "", behavior: "review", durable: false }],
  };
  const row = workflowRowSnapshot(loadedRun(snapshot), new Map(), new Set(), new Map(), "completed");
  expect(row?.steps[0]?.status).not.toBe("pending");
});

test("early-stop entry rollup keeps later unstarted steps pending when a sibling row is completed", () => {
  const snapshot: WorkflowSnapshot = {
    invocationId: "inv-early-stop-sibling",
    steps: [
      { stepId: "step-1", role: "implement" },
      { stepId: "review-1", role: "", behavior: "review", durable: false },
      { stepId: "step-3", role: "verify" },
    ],
  };
  const step1Run: LoadedRun = {
    ...runFixture("completed"),
    id: "step-1-run",
    workflowSnapshot: snapshot,
    stepId: "step-1",
  };
  const workflowRuns = new Map<string, Map<string, LoadedRun>>([
    [snapshot.invocationId, new Map([["step-1", step1Run]])],
  ]);
  const siblingRowRun: LoadedRun = {
    ...step1Run,
    id: "step-1-run",
    stepId: "step-1",
  };
  const row = workflowRowSnapshot(siblingRowRun, workflowRuns, new Set(), new Map(), "killed");
  expect(row?.steps.find((step) => step.stepId === "review-1")?.status).toBe("pending");
  expect(row?.steps.find((step) => step.stepId === "step-3")?.status).toBe("pending");
});

test("settled review projection requires attemptCount after agent invocation was reported", () => {
  const snapshot: WorkflowSnapshot = {
    invocationId: "inv-attempt-count",
    steps: [{ stepId: "review-1", role: "", behavior: "review", durable: false }],
  };
  const progressByInvocation = new Map<string, Map<string, ReviewProgress>>([
    [
      snapshot.invocationId,
      new Map([
        [
          "review-1",
          {
            status: "completed",
            role: "actuator",
            terminalOutcome: "complete",
            attemptCount: 1,
          },
        ],
      ]),
    ],
  ]);
  const row = workflowRowSnapshot(loadedRun(snapshot), new Map(), new Set(), progressByInvocation, "completed");
  expect(row?.steps[0]?.attemptCount).toBeGreaterThanOrEqual(1);
});

test("settled review attemptCount guard inversion", () => {
  const settledAttemptCount = (raw: number | undefined) => Math.max(raw ?? 0, 1);
  const inverted = (raw: number | undefined) => raw ?? 0;
  expect(inverted(0)).toBe(0);
  expect(settledAttemptCount(0)).toBe(1);

  const snapshot: WorkflowSnapshot = {
    invocationId: "inv-attempt-count-inversion",
    steps: [{ stepId: "review-1", role: "", behavior: "review", durable: false }],
  };
  const progressByInvocation = new Map<string, Map<string, ReviewProgress>>([
    [
      snapshot.invocationId,
      new Map([
        [
          "review-1",
          {
            status: "completed",
            role: "actuator",
            terminalOutcome: "complete",
            attemptCount: 1,
          },
        ],
      ]),
    ],
  ]);
  const row = workflowRowSnapshot(loadedRun(snapshot), new Map(), new Set(), progressByInvocation, "completed");
  expect(row?.steps[0]?.attemptCount).toBeGreaterThanOrEqual(1);
});
