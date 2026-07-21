import type { ReviewProgress } from "../execution/workflow-runner.ts";
import type { WorkflowSnapshot } from "../persistence/state-store.ts";
import type { LoadedRun } from "./daemon.ts";

export type WorkflowStepListStatus = "pending" | "in_progress" | "completed" | "stopped";
export type WorkflowStepTerminalOutcome =
  | "complete"
  | "blocked"
  | "contract_miss"
  | "invocation_failure"
  | "iteration_timeout"
  | "budget-exhausted"
  | "paused"
  | "invalid_token"
  | "interrupted"
  | "killed";

export type WorkflowStepListSnapshot = {
  stepId: string;
  role: string;
  status: WorkflowStepListStatus;
  attemptCount: number;
  terminalOutcome?: WorkflowStepTerminalOutcome;
};

export function workflowRowSnapshot(
  run: LoadedRun,
  runsByWorkflowInvocation: ReadonlyMap<string, Map<string, LoadedRun>>,
  liveRunIds: ReadonlySet<string>,
  reviewDebateProgressByInvocation: ReadonlyMap<string, Map<string, ReviewProgress>>,
): { steps: WorkflowStepListSnapshot[] } | undefined {
  const snapshot = run.workflowSnapshot;
  if (snapshot === null || snapshot === undefined) return undefined;

  const workflowRuns = runsByWorkflowInvocation.get(snapshot.invocationId) ?? new Map<string, LoadedRun>();
  return {
    steps: snapshot.steps.map((step) =>
      workflowStepSnapshot(
        step,
        workflowRuns.get(step.stepId),
        liveRunIds,
        snapshot.invocationId,
        reviewDebateProgressByInvocation,
      ),
    ),
  };
}

function workflowStepSnapshot(
  step: WorkflowSnapshot["steps"][number],
  run: LoadedRun | undefined,
  liveRunIds: ReadonlySet<string>,
  invocationId: string,
  reviewDebateProgressByInvocation: ReadonlyMap<string, Map<string, ReviewProgress>>,
): WorkflowStepListSnapshot {
  const progress = reviewDebateProgressByInvocation.get(invocationId)?.get(step.stepId);
  if (
    step.behavior === "review-debate" &&
    run?.status === "in-progress" &&
    progress?.status === "in_progress"
  ) {
    return {
      stepId: step.stepId,
      role: progress.role,
      status: "in_progress",
      attemptCount: run.attempts.length,
    };
  }

  if ((step.behavior === "review-debate" || step.behavior === "review") && !step.durable) {
    if (!progress) {
      return { stepId: step.stepId, role: step.role, status: "pending", attemptCount: 0 };
    }
    if (progress.status === "in_progress") {
      return { stepId: step.stepId, role: progress.role, status: "in_progress", attemptCount: 0 };
    }
    return {
      stepId: step.stepId,
      role: progress.role,
      status: progress.status,
      attemptCount: 0,
      terminalOutcome: progress.terminalOutcome,
    };
  }

  if (!run) {
    return { stepId: step.stepId, role: step.role, status: "pending", attemptCount: 0 };
  }

  const attemptCount = run.attempts.length;
  if (run.status === "completed") {
    return {
      stepId: step.stepId,
      role: step.role,
      status: "completed",
      attemptCount,
      terminalOutcome: "complete",
    };
  }

  if (run.status === "in-progress" && liveRunIds.has(run.id)) {
    return {
      stepId: step.stepId,
      role: step.role,
      status: "in_progress",
      attemptCount,
    };
  }

  return {
    stepId: step.stepId,
    role: step.role,
    status: "stopped",
    attemptCount,
    terminalOutcome: stoppedOutcomeForRun(run),
  };
}

export function stoppedOutcomeForRun(run: LoadedRun): Exclude<WorkflowStepTerminalOutcome, "complete"> {
  if (run.status === "blocked") {
    return run.attempts[run.attempts.length - 1]?.outcomeKind === "contract_miss" ? "contract_miss" : "blocked";
  }
  if (run.status === "budget-soft-stopped") return "budget-exhausted";
  if (run.status === "paused") {
    return run.attempts[run.attempts.length - 1]?.outcomeKind === "invalid_token" ? "invalid_token" : "paused";
  }
  if (run.status === "killed") return "killed";
  if (run.status === "interrupted") return "interrupted";
  if (run.attempts[run.attempts.length - 1]?.outcomeKind === "iteration_timeout") return "iteration_timeout";
  return "invocation_failure";
}
