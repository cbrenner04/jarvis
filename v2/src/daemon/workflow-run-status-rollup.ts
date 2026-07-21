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
  return workflowStoppingRun(args)?.status ?? "completed";
}

/**
 * Returns the durable row whose status stops a non-live workflow rollup.
 * `undefined` means every relevant step completed (or the workflow is live).
 */
export function workflowStoppingRun(args: {
  entryRun: Run;
  workflowSnapshot?: WorkflowSnapshot | null;
  siblingRuns: Run[];
  isLive: boolean;
}): Run | undefined {
  const { entryRun, workflowSnapshot, siblingRuns, isLive } = args;

  if (workflowSnapshot === null || workflowSnapshot === undefined) {
    return entryRun.status === "completed" ? undefined : entryRun;
  }

  if (isLive) return { ...entryRun, status: "in-progress" };

  // Implement's hidden shrink is the completion-publication boundary. Its failure
  // must prevent the authored entry row from rolling up to completed.
  const failedShrink = siblingRuns.find((run) => run.stepId?.endsWith("~shrink") && run.status === "failed");
  if (failedShrink !== undefined) return failedShrink;

  const runById = new Map(siblingRuns.map((run) => [run.stepId, run]));
  for (const step of workflowSnapshot.steps) {
    if (step.durable === false) continue;

    const stepRun = runById.get(step.stepId);
    if (stepRun !== undefined) {
      if (stepRun.status !== "completed") {
        return stepRun;
      }
    } else {
      return { ...entryRun, status: "killed" };
    }
  }

  return undefined;
}
