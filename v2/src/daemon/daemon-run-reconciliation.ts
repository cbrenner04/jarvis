import type { LogReader, LogSink } from "../persistence/log-stream.ts";
import { isTerminalRunStatus, type Run, type StateStore } from "../persistence/state-store.ts";

function reconciliationTerminalStatus(run: Run): "killed" | "interrupted" | undefined {
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

/** A published lane needs no fresh implement invocation after an orphaned link is reconciled. */
export async function settlePublishedLinkedRecovery(
  store: StateStore,
  logSink: LogSink,
  runId: string,
): Promise<boolean> {
  const run = store.loadRun(runId);
  if (!run?.stepId || !/^[^~]+~link-\d+$/.test(run.stepId)) return false;
  const invocationId = run.workflowSnapshot?.invocationId;
  if (invocationId === undefined) return false;
  const rows = store.listRuns();
  const runIndex = rows.findIndex((row) => row.id === runId);
  const publication = rows.find(
    (candidate, candidateIndex) =>
      candidate.project === run.project &&
      candidate.branch === run.branch &&
      candidate.status === "completed" &&
      candidate.terminalCause === "complete" &&
      typeof candidate.prNumber === "number" &&
      (candidate.workflowSnapshot?.invocationId === invocationId ||
        (candidate.workflowSnapshot !== undefined && candidateIndex < runIndex)),
  );
  if (!publication || typeof publication.prNumber !== "number") return false;
  await store.admitRunForResume(runId);
  const settlement = store.commitTerminalRunSettlement({
    runId,
    status: "completed",
    terminalCause: "complete",
    prNumber: publication.prNumber,
    ...(typeof publication.prUrl === "string" ? { prUrl: publication.prUrl } : {}),
  });
  if (settlement.kind === "rejected") {
    logSink.append(runId, {
      kind: "run_settlement_rejected",
      attemptedStatus: settlement.attemptedStatus,
      reportingIdentity: settlement.reportingIdentity,
    });
    return true;
  }
  logSink.append(runId, {
    kind: "run_recovery",
    outcome: "settled",
    message: `Published lane already settled by run ${publication.id}; implement was not resumed`,
  });
  return true;
}
