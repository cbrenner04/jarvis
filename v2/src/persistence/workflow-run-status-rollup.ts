import {
  findSnapshotStepForRunStepId,
  isHiddenShrinkStepId,
  LINK_STEP_ID_INFIX,
  resolveAuthoredStepId,
} from "../../../shared/write-sibling-step-id.ts";
import type { Run, RunStatus, WorkflowSnapshot } from "./state-store.ts";

type RollupArgs = {
  entryRun: Run;
  workflowSnapshot?: WorkflowSnapshot | null;
  siblingRuns: Run[];
  isLive: boolean;
};

/** Rollup status plus the sibling row that determined a non-completed verdict, when one did. */
type WorkflowRunRollup = { status: RunStatus; causeRun?: Run };

/** One authored step's verdict: any failed row wins, else its latest-created row. */
function authoredStepRun(runs: readonly Run[]): Run | undefined {
  return (
    runs.find((run) => run.status === "failed") ??
    runs.reduce<Run | undefined>(
      (latest, run) => (latest === undefined || run.createdAt >= latest.createdAt ? run : latest),
      undefined,
    )
  );
}

/**
 * A completed `~link-N` row proves only that link ran. Routing finished only when its `~shrink` row
 * (dispatched after the terminal link) or a later authored step's row exists; otherwise the
 * invocation died between links and must not roll up `completed`.
 */
function linkedRoutingFinished(
  siblingRuns: readonly Run[],
  steps: readonly { stepId: string }[],
  index: number,
): boolean {
  const stepId = steps[index]?.stepId;
  const laterStepIds = new Set(steps.slice(index + 1).map((step) => step.stepId));
  return siblingRuns.some((run) => {
    if (run.stepId == null) return false;
    const authored = resolveAuthoredStepId(run.stepId);
    return (isHiddenShrinkStepId(run.stepId) && authored === stepId) || laterStepIds.has(authored);
  });
}

/**
 * Computes the workflow-level status from a workflow invocation's durable rows.
 * The rollup applies only to the invocation's entry row; sibling rows keep their own status.
 *
 * Liveness is an input, not inferred from rows, because a live invocation's review step
 * may carry no run row yet, and we must not report `completed` mid-review.
 *
 * Sibling rows map to authored steps via `findSnapshotStepForRunStepId`, so linked-implement
 * `~link-N` rows count toward their authored step, which rolls up `completed` only with evidence routing finished. A durable authored step with no row in a
 * non-live invocation rolls up to `killed`. Legacy snapshots have no durability metadata, so
 * their steps remain durable. A run with no workflow snapshot uses its own status unchanged.
 */
export function resolveWorkflowRunRollup(args: RollupArgs): WorkflowRunRollup {
  const { entryRun, workflowSnapshot, siblingRuns, isLive } = args;

  if (workflowSnapshot === null || workflowSnapshot === undefined) {
    return { status: entryRun.status };
  }

  if (isLive) return { status: "in-progress" };

  // Implement's hidden shrink is the completion-publication boundary. Its failure
  // must prevent the authored entry row from rolling up to completed.
  const failedShrink = siblingRuns.find((run) => isHiddenShrinkStepId(run.stepId) && run.status === "failed");
  if (failedShrink !== undefined) return { status: "failed", causeRun: failedShrink };

  const runsByStepId = new Map<string, Run[]>();
  for (const run of siblingRuns) {
    if (run.stepId == null || isHiddenShrinkStepId(run.stepId)) continue;
    const step = findSnapshotStepForRunStepId(workflowSnapshot.steps, run.stepId);
    if (step === undefined) continue;
    runsByStepId.set(step.stepId, [...(runsByStepId.get(step.stepId) ?? []), run]);
  }
  const steps = workflowSnapshot.steps;
  for (const [index, step] of steps.entries()) {
    if (step.durable === false) continue;
    const stepRun = authoredStepRun(runsByStepId.get(step.stepId) ?? []);
    if (stepRun === undefined) return { status: "killed" };
    if (stepRun.status !== "completed") return { status: stepRun.status, causeRun: stepRun };
    if (stepRun.stepId?.includes(LINK_STEP_ID_INFIX) && !linkedRoutingFinished(siblingRuns, steps, index)) {
      return { status: "killed" };
    }
  }

  return { status: "completed" };
}

export function rollupWorkflowRunStatus(args: RollupArgs): RunStatus {
  return resolveWorkflowRunRollup(args).status;
}
