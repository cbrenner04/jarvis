import type { PersistedRecord } from "./log-stream.ts";

/** One operator-visible log-follow line from a persisted record. */
export function formatLogFollowLine(record: PersistedRecord): string {
  const parts = [`seq=${record.seq}`, `kind=${record.event.kind}`];
  const event = record.event;

  switch (event.kind) {
    case "iteration_started":
      parts.push(`attemptId=${event.attemptId}`);
      break;
    case "boundary_committed":
      parts.push(`attemptId=${event.attemptId}`, `outcomeKind=${event.outcomeKind}`, `runStatus=${event.runStatus}`);
      break;
    case "loop_finished":
      parts.push(
        `loopOutcomeKind=${event.loopOutcomeKind}`,
        `iterationsConsumed=${event.iterationsConsumed}`,
        `resumable=${event.resumable}`,
      );
      break;
    case "run_execution_failed":
      break;
  }

  return parts.join(" ");
}
