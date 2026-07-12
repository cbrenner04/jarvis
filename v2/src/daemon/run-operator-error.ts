import type { LoopFinishedEvent, PersistedRecord, RunExecutionFailedEvent } from "../persistence/log-stream.ts";
import type { Attempt, RunStatus } from "../persistence/state-store.ts";

/** Closed operator-facing stop reason; not raw loop or invocation taxonomy. */
const RUN_OPERATOR_ERROR_REASONS = [
  "resumable_pause",
  "resumable_budget",
  "resumable_kill",
  "agent_blocked",
  "contract_miss",
  "invalid_token",
  "quota_exhausted",
  "model_config",
  "no_binding",
  "landing_failed",
  "invocation_error",
  "harness_failure",
  "not_implemented",
  "completion_commit_failed",
  "ready_finalize_failed",
  "iteration_timeout",
] as const;

export type RunOperatorErrorReason = (typeof RUN_OPERATOR_ERROR_REASONS)[number];

/** Closed remediation hint for operators; not free text. */
const RUN_OPERATOR_NEXT_ACTIONS = ["resume", "inspect_spec", "fix_config", "retry_later", "stop"] as const;

export type RunOperatorNextAction = (typeof RUN_OPERATOR_NEXT_ACTIONS)[number];

/** Stable operator error record composed from durable run state and terminal log signals. */
export type RunOperatorError = {
  reason: RunOperatorErrorReason;
  retryable: boolean;
  nextAction: RunOperatorNextAction;
};

const runOperatorErrorReasonSet = new Set<string>(RUN_OPERATOR_ERROR_REASONS);
const runOperatorNextActionSet = new Set<string>(RUN_OPERATOR_NEXT_ACTIONS);

export function isRunOperatorError(value: unknown): value is RunOperatorError {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.reason === "string" &&
    runOperatorErrorReasonSet.has(record.reason) &&
    typeof record.retryable === "boolean" &&
    typeof record.nextAction === "string" &&
    runOperatorNextActionSet.has(record.nextAction)
  );
}

/** Last terminal log row selected for operator-error composition (`loop_finished` or `run_execution_failed`). */
export type TerminalLogRecord = PersistedRecord & { event: LoopFinishedEvent | RunExecutionFailedEvent };

type RunWithAttempts = {
  status: RunStatus;
  attempts: Attempt[];
};

const op = (
  reason: RunOperatorErrorReason,
  nextAction: RunOperatorNextAction,
  retryable = false,
): RunOperatorError => ({ reason, retryable, nextAction });

const RESUMABLE_TERMINALS: Record<string, RunOperatorError> = {
  paused: op("resumable_pause", "resume", true),
  "budget-soft-stopped": op("resumable_budget", "resume", true),
  "budget-exhausted": op("resumable_budget", "resume", true),
  killed: op("resumable_kill", "resume", true),
};

const INVOCATION_BY_FAILURE_KIND: Record<string, RunOperatorError> = {
  quota: op("quota_exhausted", "retry_later"),
  model_config: op("model_config", "fix_config"),
  no_binding: op("no_binding", "fix_config"),
  landing: op("landing_failed", "resume", true),
  error: op("invocation_error", "stop"),
};

/** Chronologically last terminal event; `list` and `wait` share this selection. */
export function findTerminalLogRecord(records: PersistedRecord[]): TerminalLogRecord | undefined {
  let latest: TerminalLogRecord | undefined;
  for (const record of records) {
    if (record.event.kind === "loop_finished" || record.event.kind === "run_execution_failed") {
      latest = record as TerminalLogRecord;
    }
  }
  return latest;
}

function lastCommittedAttempt(attempts: Attempt[]): Attempt | undefined {
  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    const attempt = attempts[i];
    if (attempt?.outcomeKind != null) return attempt;
  }
  return undefined;
}

function mapInvocationFromAttempt(attempt: Attempt): RunOperatorError | undefined {
  switch (attempt.outcomeKind) {
    case "invalid_token":
      return op("invalid_token", "stop");
    case "blocked":
      return op("agent_blocked", "inspect_spec");
    case "contract_miss":
      return op("contract_miss", "inspect_spec");
    case "invocation_failure": {
      const detail = attempt.invocationFailureDetail;
      if (detail === null) return op("invocation_error", "stop");
      return INVOCATION_BY_FAILURE_KIND[detail.failureKind] ?? op("invocation_error", "stop");
    }
    default:
      return undefined;
  }
}

function mapFromLoopFinished(
  event: LoopFinishedEvent,
  lastAttempt?: Attempt,
  allowResumableLogOutcomes = true,
): RunOperatorError | undefined {
  const resumable = RESUMABLE_TERMINALS[event.loopOutcomeKind];
  if (resumable) return allowResumableLogOutcomes ? resumable : undefined;

  switch (event.loopOutcomeKind) {
    case "completion_commit_failed":
      return op("completion_commit_failed", "resume", true);
    case "ready_finalize_failed":
      return op("ready_finalize_failed", "resume", true);
    case "blocked":
      return op("agent_blocked", "inspect_spec");
    case "contract_miss":
      return op("contract_miss", "inspect_spec");
    case "invocation_failure":
      return (lastAttempt && mapInvocationFromAttempt(lastAttempt)) ?? op("invocation_error", "stop");
    case "iteration_timeout":
      return op("iteration_timeout", "stop");
    default:
      return undefined;
  }
}

/**
 * Compose operator error from durable run state and optional terminal log.
 * Resumable durable statuses win over conflicting log; for `failed` / `blocked`,
 * last-attempt store detail wins over conflicting `loop_finished`, and resumable
 * `loopOutcomeKind` values from stale logs do not override `failed` / `blocked`.
 */
export function composeRunOperatorError(
  run: RunWithAttempts,
  terminalRecord?: TerminalLogRecord,
): RunOperatorError | undefined {
  if (run.status === "in-progress") return undefined;
  if (run.status === "completed" && terminalRecord?.event.kind !== "loop_finished") return undefined;

  const resumable = RESUMABLE_TERMINALS[run.status];
  if (resumable) return resumable;

  const lastAttempt = lastCommittedAttempt(run.attempts);
  const allowResumableLogOutcomes = run.status !== "failed" && run.status !== "blocked";

  if (terminalRecord?.event.kind === "run_execution_failed") return op("harness_failure", "stop");

  if (run.status === "failed" || run.status === "blocked") {
    const fromAttempt = lastAttempt && mapInvocationFromAttempt(lastAttempt);
    if (fromAttempt) return fromAttempt;
  }

  if (terminalRecord?.event.kind === "loop_finished") {
    const fromLog = mapFromLoopFinished(terminalRecord.event, lastAttempt, allowResumableLogOutcomes);
    if (fromLog) return fromLog;
  }

  if (run.status === "blocked") return op("agent_blocked", "inspect_spec");
  if (run.status === "failed") return op("harness_failure", "stop");
  return undefined;
}
