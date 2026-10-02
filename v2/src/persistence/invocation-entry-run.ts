import type { StateStore } from "./state-store.ts";

type InvocationEntryRunStore = Pick<StateStore, "loadRun" | "findRunsByInvocationId">;

/**
 * The entry run of `runId`'s invocation — the row a stage links: the invocation's row whose `stepId`
 * is `workflowSnapshot.steps[0].stepId`, else (linked implement, whose first row is `<step>~link-0`)
 * its earliest-created row. A resumed sibling row resolves to it; a row with no snapshot is its own
 * entry run.
 */
export function resolveInvocationEntryRunId(store: InvocationEntryRunStore, runId: string): string {
  const snapshot = store.loadRun(runId)?.workflowSnapshot;
  if (snapshot === null || snapshot === undefined) return runId;
  const entryStepId = snapshot.steps[0]?.stepId;
  const rows = store.findRunsByInvocationId(snapshot.invocationId);
  // `findRunsByInvocationId` returns creation order, so `rows[0]` is the earliest-created row.
  return (rows.find((row) => row.stepId === entryStepId) ?? rows[0])?.id ?? runId;
}
