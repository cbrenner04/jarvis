import type { PersistedRecord } from "../persistence/log-stream.ts";

/** One operator-visible log-follow line from a persisted record. */
export function formatLogFollowLine(record: PersistedRecord): string {
  const parts = [`seq=${record.seq}`, `kind=${record.event.kind}`];
  const event = record.event;

  /** Append `key=value`, skipping absent values. */
  const add = (key: string, value: string | number | boolean | undefined): void => {
    if (value !== undefined) parts.push(`${key}=${value}`);
  };
  /** Append `key="quoted"`, skipping absent values. */
  const addQuoted = (key: string, value: string | undefined): void => {
    if (value !== undefined) parts.push(`${key}=${JSON.stringify(value)}`);
  };
  /** Append `key="quoted"`, skipping empty text. */
  const addText = (key: string, text: string): void => {
    if (text.length > 0) parts.push(`${key}=${JSON.stringify(text)}`);
  };

  switch (event.kind) {
    case "iteration_started":
      add("attemptId", event.attemptId);
      break;
    case "boundary_committed":
      add("attemptId", event.attemptId);
      add("outcomeKind", event.outcomeKind);
      add("runStatus", event.runStatus);
      break;
    case "loop_finished":
      add("loopOutcomeKind", event.loopOutcomeKind);
      add("iterationsConsumed", event.iterationsConsumed);
      add("resumable", event.resumable);
      break;
    case "run_execution_failed":
      addQuoted("message", event.message);
      break;
    case "run_reconciled":
      add("runStatus", event.runStatus);
      add("reason", event.reason);
      break;
    case "invalid_token_detail":
      add("attemptId", event.attemptId);
      addText("tokenText", event.tokenText);
      break;
    case "token_reprompt":
      add("attemptId", event.attemptId);
      addText("responseText", event.responseText);
      break;
    case "blocker_reprompt":
      add("attemptId", event.attemptId);
      addText("responseText", event.responseText);
      break;
    case "missing_blocker_detail":
      add("attemptId", event.attemptId);
      addText("responseText", event.responseText);
      break;
    case "intent_finalization":
      add("phase", event.phase);
      add("branch", event.branch);
      addQuoted("stopReason", event.stopReason);
      break;
  }

  return parts.join(" ");
}
