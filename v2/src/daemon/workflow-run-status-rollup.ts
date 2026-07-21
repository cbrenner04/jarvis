import type { Run, RunStatus, WorkflowSnapshot } from "../persistence/state-store.ts";

/**
 * Computes the workflow-level status from a workflow invocation's durable rows.
 * The rollup applies only to the invocation's entry row; sibling rows keep their own status.
 *
 * Liveness is an input, not inferred from rows, because a live invocation's review step
 * may carry no run row yet, and we must not report `completed` mid-review.
 *
 * A durable authored step with no row in a non-live invocation rolls up to `killed`,
 * capturing runs interrupted mid-workflow between step creation and step invocation.
 * Legacy snapshots have no durability metadata, so their steps remain durable.
 *
 * A run with no workflow snapshot uses its own status unchanged.
 */
export function rollupWorkflowRunStatus(args: {
  entryRun: Run;
  workflowSnapshot?: WorkflowSnapshot | null;
  siblingRuns: Run[];
  isLive: boolean;
}): RunStatus {
  const { entryRun, workflowSnapshot, siblingRuns, isLive } = args;

  if (workflowSnapshot === null || workflowSnapshot === undefined) {
    return entryRun.status;
  }

  if (isLive) return "in-progress";

  const stoppingRun = workflowStoppingRun({ workflowSnapshot, siblingRuns });
  if (stoppingRun !== undefined) return stoppingRun.status;

  const runById = new Map(siblingRuns.map((run) => [run.stepId, run]));
  for (const step of workflowSnapshot.steps) {
    if (step.durable === false) continue;
    if (!runById.has(step.stepId)) return "killed";
  }

  return "completed";
}

/** Returns the durable row that stops a non-live workflow rollup, if present. */
export function workflowStoppingRun(args: {
  workflowSnapshot: WorkflowSnapshot;
  siblingRuns: Run[];
}): Run | undefined {
  const { workflowSnapshot, siblingRuns } = args;
  const runById = new Map(siblingRuns.map((run) => [run.stepId, run]));
  for (const step of workflowSnapshot.steps) {
    if (step.durable === false) continue;

    const stepRun = runById.get(step.stepId);
    if (stepRun === undefined) return undefined;
    if (stepRun !== undefined && stepRun.status !== "completed") return stepRun;
  }

  // Implement's hidden shrink is the completion-publication boundary, after
  // every authored durable step has completed.
  return siblingRuns.find((run) => run.stepId?.endsWith("~shrink") && run.status === "failed");
}
