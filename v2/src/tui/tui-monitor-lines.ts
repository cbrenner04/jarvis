import type { TuiMonitorState } from "./tui-monitor-types.ts";

function outcomeLines(state: TuiMonitorState): string[] {
  const selected = state.selectedRunId;
  const waitState = state.waitState;
  if (selected === null) return ["No run selected."];
  if (waitState.kind === "pending") return [`Waiting for ${waitState.runId}...`];
  if (waitState.kind === "ready") {
    return [
      `runStatus: ${waitState.result.runStatus}`,
      ...(waitState.result.loopOutcomeKind !== undefined
        ? [`loopOutcomeKind: ${waitState.result.loopOutcomeKind}`]
        : []),
      ...(waitState.result.iterationsConsumed !== undefined
        ? [`iterationsConsumed: ${waitState.result.iterationsConsumed}`]
        : []),
      ...(waitState.result.resumable !== undefined ? [`resumable: ${waitState.result.resumable}`] : []),
    ];
  }
  if (waitState.kind === "error") return [`Wait failed for ${waitState.runId}.`];
  return ["No outcome yet."];
}

const QUEUE_ADMISSION_DESCRIPTOR = "waiting: memory headroom";

/** Flat text lines for the ink run monitor from one snapshot. */
export function monitorTextLines(state: TuiMonitorState): string[] {
  const selected = state.selectedRunId;
  const lines = ["jarvis tui"];
  const nonQueuedRuns = state.runs.filter((run) => run.status !== "queued");
  // `state.runs` is newest-first overall; reverse the queued subset for FIFO admission order.
  const queuedRuns = state.runs.filter((run) => run.status === "queued").toReversed();
  if (nonQueuedRuns.length === 0) {
    lines.push("No runs.");
  } else {
    lines.push("runId project branch status liveness");
    for (const run of nonQueuedRuns) {
      const marker = run.runId === selected ? ">" : " ";
      lines.push(
        `${marker} ${run.runId} ${run.project} ${run.branch} ${run.status} ${run.isLive ? "live" : "not-live"}`,
      );
    }
  }
  if (queuedRuns.length > 0) {
    lines.push("Queue");
    for (const run of queuedRuns) {
      lines.push(`  ${run.runId} ${run.project} ${run.branch} ${run.status} ${QUEUE_ADMISSION_DESCRIPTOR}`);
    }
  }
  const selectedRun = selected !== null ? state.runs.find((run) => run.runId === selected) : undefined;
  if (selectedRun?.workflow !== undefined) {
    lines.push("Workflow");
    for (const step of selectedRun.workflow.steps) {
      const marker = step.status === "in_progress" ? ">" : " ";
      const outcomeSuffix = step.terminalOutcome !== undefined ? ` ${step.terminalOutcome}` : "";
      lines.push(`${marker} ${step.stepId} ${step.role} ${step.status}${outcomeSuffix} attempts=${step.attemptCount}`);
    }
  }
  lines.push("Outcome", ...outcomeLines(state));
  if (state.steeringFeedback !== null) {
    lines.push(state.steeringFeedback);
  }
  lines.push("Press q or Ctrl-C to quit.");
  return lines;
}
