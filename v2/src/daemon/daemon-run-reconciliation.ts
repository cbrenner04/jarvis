import type { LogReader, LogSink } from "../persistence/log-stream.ts";
import { isTerminalRunStatus, type Run, type StateStore } from "../persistence/state-store.ts";

export function reconciliationTerminalStatus(run: Run): "killed" | "interrupted" | undefined {
  if (isTerminalRunStatus(run.status)) return undefined;
  const isReviewDebate = run.workflowSnapshot?.steps.some(
    (step) => step.stepId === run.stepId && step.behavior === "review-debate",
  );
  return isReviewDebate ? "interrupted" : "killed";
}

/** Marks orphaned runs before IPC is exposed. Review-debate rows are interrupted. */
export async function reconcileOrphanedRuns(
  stateStore: StateStore,
  logSink: LogSink,
  logReader?: LogReader,
): Promise<string[]> {
  const reconciledRunIds: string[] = [];
  for (const runId of await stateStore.beginRunReconciliation()) {
    let run = stateStore.loadRun(runId);
    const terminalStatus = run === null ? undefined : reconciliationTerminalStatus(run);
    if (terminalStatus !== undefined) {
      stateStore.commitTerminalRunSettlement({ runId, status: terminalStatus });
      run = stateStore.loadRun(runId);
    }
    const eventPersisted = logReader
      ?.tail(runId)
      .some(
        (record) =>
          record.event.kind === "run_reconciled" &&
          record.event.runStatus === run?.status &&
          record.event.reason === "daemon_restart",
      );
    if ((run?.status === "killed" || run?.status === "interrupted") && !eventPersisted) {
      logSink.append(runId, { kind: "run_reconciled", runStatus: run.status, reason: "daemon_restart" });
    }
    stateStore.finishRunReconciliation(runId);
    reconciledRunIds.push(runId);
  }
  return reconciledRunIds;
}
