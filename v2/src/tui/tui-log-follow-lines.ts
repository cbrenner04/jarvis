import type { PersistedRecord } from "../persistence/log-stream.ts";

/** One operator-visible log-follow line from a persisted record. */
export function formatLogFollowLine(record: PersistedRecord): string {
  const parts = [`seq=${record.seq}`, `kind=${record.event.kind}`];
  const event = record.event;

  switch (event.kind) {
    case "iteration_started":
      if (event.attemptId !== undefined) parts.push(`attemptId=${event.attemptId}`);
      break;
    case "boundary_committed":
      if (event.attemptId !== undefined) parts.push(`attemptId=${event.attemptId}`);
      if (event.outcomeKind !== undefined) parts.push(`outcomeKind=${event.outcomeKind}`);
      if (event.runStatus !== undefined) parts.push(`runStatus=${event.runStatus}`);
      break;
    case "loop_finished":
      if (event.loopOutcomeKind !== undefined) parts.push(`loopOutcomeKind=${event.loopOutcomeKind}`);
      if (event.iterationsConsumed !== undefined) parts.push(`iterationsConsumed=${event.iterationsConsumed}`);
      if (event.resumable !== undefined) parts.push(`resumable=${event.resumable}`);
      break;
    case "run_execution_failed":
      if (event.message !== undefined) parts.push(`message=${JSON.stringify(event.message)}`);
      break;
    case "run_reconciled":
      parts.push(`runStatus=${event.runStatus}`);
      parts.push(`reason=${event.reason}`);
      break;
    case "invalid_token_detail":
      if (event.attemptId !== undefined) parts.push(`attemptId=${event.attemptId}`);
      if (event.tokenText.length > 0) parts.push(`tokenText=${JSON.stringify(event.tokenText)}`);
      break;
    case "token_reprompt":
      if (event.attemptId !== undefined) parts.push(`attemptId=${event.attemptId}`);
      if (event.responseText.length > 0) parts.push(`responseText=${JSON.stringify(event.responseText)}`);
      break;
  }

  return parts.join(" ");
}
