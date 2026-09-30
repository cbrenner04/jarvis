import type { Run, StateStore } from "./state-store.ts";

/** Lazy rows of earlier same-lane invocations (entry row created before `entryRun`), for the rollup's missing-successor rule. */
export function priorLaneRunsForWorkflowRollup(
  entryRun: Run,
  invocationId: string,
  store: Pick<StateStore, "findWorkflowRunsOnLane">,
): () => Run[] {
  const findWorkflowRunsOnLane = store.findWorkflowRunsOnLane.bind(store);
  return () => {
    const byInvocation = new Map<string, Run[]>();
    const lane = { project: entryRun.project, branch: entryRun.branch, specRef: entryRun.specRef };
    for (const run of findWorkflowRunsOnLane(lane)) {
      const id = run.workflowSnapshot?.invocationId;
      if (id === undefined || id === invocationId) continue;
      byInvocation.set(id, [...(byInvocation.get(id) ?? []), run]);
    }
    return [...byInvocation.values()].flatMap((rows) => {
      const entryStepId = rows[0]?.workflowSnapshot?.steps[0]?.stepId;
      const priorEntry = rows.find((row) => row.stepId === entryStepId);
      return priorEntry !== undefined && priorEntry.createdAt < entryRun.createdAt ? rows : [];
    });
  };
}
