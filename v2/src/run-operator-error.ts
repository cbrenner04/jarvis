import type { LoopFinishedEvent, PersistedRecord, RunExecutionFailedEvent } from "./log-stream.ts";
import type { Attempt } from "./state-store.ts";
import type { RunStatus } from "./state-store-types.ts";

/** Closed operator-facing stop reason; not raw loop or invocation taxonomy. */
export type RunOperatorErrorReason =
  | "resumable_pause"
  | "resumable_budget"
  | "resumable_kill"
  | "agent_blocked"
  | "contract_miss"
  | "invalid_token"
  | "quota_exhausted"
  | "model_config"
  | "no_binding"
  | "invocation_error"
  | "harness_failure";

/** Closed remediation hint for operators; not free text. */
export type RunOperatorNextAction = "resume" | "inspect_spec" | "fix_config" | "retry_later" | "stop";

/** Stable operator error record composed from durable run state and terminal log signals. */
export type RunOperatorError = {
  reason: RunOperatorErrorReason;
  retryable: boolean;
  nextAction: RunOperatorNextAction;
};

export type TerminalLogRecord = PersistedRecord & { event: LoopFinishedEvent | RunExecutionFailedEvent };

type RunWithAttempts = {
  status: RunStatus;
  attempts: Attempt[];
};

/**
 * Last persisted terminal log signal for a run: prefer `loop_finished`, else `run_execution_failed`.
 *
 * @param records - Persisted log tail in `seq` order (same precedence as daemon `wait`).
 * @returns The terminal record, or `undefined` when none.
 */
export function findTerminalLogRecord(records: PersistedRecord[]): TerminalLogRecord | undefined {
  let loopFinished: TerminalLogRecord | undefined;
  let runExecutionFailed: TerminalLogRecord | undefined;

  for (const record of records) {
    if (record.event.kind === "loop_finished") {
      loopFinished = record as TerminalLogRecord;
    } else if (record.event.kind === "run_execution_failed") {
      runExecutionFailed = record as TerminalLogRecord;
    }
  }

  return loopFinished ?? runExecutionFailed;
}

function lastCommittedAttempt(attempts: Attempt[]): Attempt | undefined {
  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    const attempt = attempts[i];
    if (attempt?.outcomeKind !== null && attempt?.outcomeKind !== undefined) {
      return attempt;
    }
  }
  return undefined;
}

function mapInvocationFromAttempt(attempt: Attempt): RunOperatorError | undefined {
  if (attempt.outcomeKind === "invalid_token") {
    return { reason: "invalid_token", retryable: false, nextAction: "stop" };
  }
  if (attempt.outcomeKind === "blocked") {
    return { reason: "agent_blocked", retryable: false, nextAction: "inspect_spec" };
  }
  if (attempt.outcomeKind === "contract_miss") {
    return { reason: "contract_miss", retryable: false, nextAction: "inspect_spec" };
  }
  if (attempt.outcomeKind !== "invocation_failure") {
    return undefined;
  }

  const detail = attempt.invocationFailureDetail;
  if (detail === null) {
    return { reason: "invocation_error", retryable: false, nextAction: "stop" };
  }

  switch (detail.failureKind) {
    case "quota":
      return { reason: "quota_exhausted", retryable: false, nextAction: "retry_later" };
    case "model_config":
      return { reason: "model_config", retryable: false, nextAction: "fix_config" };
    case "no_binding":
      return { reason: "no_binding", retryable: false, nextAction: "fix_config" };
    case "error":
      return { reason: "invocation_error", retryable: false, nextAction: "stop" };
    default:
      return { reason: "invocation_error", retryable: false, nextAction: "stop" };
  }
}

function mapFromLoopFinished(event: LoopFinishedEvent, lastAttempt?: Attempt): RunOperatorError | undefined {
  switch (event.loopOutcomeKind) {
    case "paused":
      return { reason: "resumable_pause", retryable: true, nextAction: "resume" };
    case "budget-exhausted":
      return { reason: "resumable_budget", retryable: true, nextAction: "resume" };
    case "blocked":
      return { reason: "agent_blocked", retryable: false, nextAction: "inspect_spec" };
    case "contract_miss":
      return { reason: "contract_miss", retryable: false, nextAction: "inspect_spec" };
    case "invocation_failure": {
      const fromAttempt = lastAttempt ? mapInvocationFromAttempt(lastAttempt) : undefined;
      return fromAttempt ?? { reason: "invocation_error", retryable: false, nextAction: "stop" };
    }
    default:
      return undefined;
  }
}

/**
 * Compose a stable operator error from durable run state and an optional terminal log record.
 *
 * @param run - Durable run row with attempt history from `loadRun`.
 * @param terminalRecord - Last `loop_finished` or `run_execution_failed` when a log reader is available.
 * @returns Operator error for non-success terminals; `undefined` for in-progress and successful `completed`.
 * @invariant Resumable durable statuses (`paused`, `budget-soft-stopped`, `killed`) win over conflicting log.
 * @invariant For `failed` / `blocked`, last-attempt store detail wins over conflicting `loop_finished`.
 */
export function composeRunOperatorError(
  run: RunWithAttempts,
  terminalRecord?: TerminalLogRecord,
): RunOperatorError | undefined {
  if (run.status === "in-progress" || run.status === "completed") {
    return undefined;
  }

  if (run.status === "paused") {
    return { reason: "resumable_pause", retryable: true, nextAction: "resume" };
  }
  if (run.status === "budget-soft-stopped") {
    return { reason: "resumable_budget", retryable: true, nextAction: "resume" };
  }
  if (run.status === "killed") {
    return { reason: "resumable_kill", retryable: true, nextAction: "resume" };
  }

  const lastAttempt = lastCommittedAttempt(run.attempts);

  if (terminalRecord?.event.kind === "run_execution_failed") {
    return { reason: "harness_failure", retryable: false, nextAction: "stop" };
  }

  if (run.status === "failed" || run.status === "blocked") {
    const fromAttempt = lastAttempt ? mapInvocationFromAttempt(lastAttempt) : undefined;
    if (fromAttempt) {
      return fromAttempt;
    }
  }

  if (terminalRecord?.event.kind === "loop_finished") {
    const fromLog = mapFromLoopFinished(terminalRecord.event, lastAttempt);
    if (fromLog) {
      return fromLog;
    }
  }

  if (lastAttempt) {
    const fromAttempt = mapInvocationFromAttempt(lastAttempt);
    if (fromAttempt) {
      return fromAttempt;
    }
  }

  if (run.status === "blocked") {
    return { reason: "agent_blocked", retryable: false, nextAction: "inspect_spec" };
  }

  if (run.status === "failed") {
    return { reason: "harness_failure", retryable: false, nextAction: "stop" };
  }

  return undefined;
}
