import type { PublicationFailure } from "../execution/publication-retry.ts";
import { survivingMutationLogFields } from "../execution/ready-finalize.ts";
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
  "missing_blocker",
  "quota_exhausted",
  "model_config",
  "no_binding",
  "landing_failed",
  "invocation_error",
  "role_timeout",
  "role_stalled",
  "harness_failure",
  "state_store_lock_timeout",
  "not_implemented",
  "completion_commit_failed",
  "iteration_commit_failed",
  "ready_gate_failed",
  "ready_flip_failed",
  "surviving_mutation_failed",
  "iteration_timeout",
  "unsupported_resume_context",
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
  publicationFailure?: PublicationFailure;
  survivingMutation?: string;
  survivingMutationSourceFile?: string;
  survivingMutationSourceLine?: number;
};

/** Last terminal log row selected for operator-error composition (`loop_finished` or `run_execution_failed`). */
export type TerminalLogRecord = PersistedRecord & { event: LoopFinishedEvent | RunExecutionFailedEvent };

type RunWithAttempts = {
  status: RunStatus;
  attempts?: Attempt[];
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
  timeout: op("role_timeout", "retry_later", true),
  stall: op("role_stalled", "retry_later", true),
};

const RESUMABLE_FINALIZATION_LOOP_OUTCOME_KINDS = new Set<LoopFinishedEvent["loopOutcomeKind"]>([
  "ready_gate_failed",
  "surviving_mutation_failed",
  "completion_commit_failed",
  "iteration_commit_failed",
]);

function isResumableFinalizationLoopFinished(event: LoopFinishedEvent): boolean {
  return event.resumable && RESUMABLE_FINALIZATION_LOOP_OUTCOME_KINDS.has(event.loopOutcomeKind);
}

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

/** Classify post-boundary store lock failures that should resume instead of stopping. */
export function isPostBoundaryStateStoreLockTimeout(
  terminalRecord: TerminalLogRecord | undefined,
  run: RunWithAttempts,
): boolean {
  if (terminalRecord?.event.kind !== "run_execution_failed") return false;
  const message = terminalRecord.event.message;
  if (message === undefined || !message.toLowerCase().includes("database is locked")) return false;
  return lastCommittedAttempt(run.attempts ?? [])?.outcomeKind === "done";
}

function mapInvocationFromAttempt(attempt: Attempt): RunOperatorError | undefined {
  switch (attempt.outcomeKind) {
    case "invalid_token":
      return op("invalid_token", "resume", true);
    case "missing_blocker":
      return op("missing_blocker", "resume", true);
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
      return {
        ...op("completion_commit_failed", "resume", true),
        ...(event.publicationFailure !== undefined ? { publicationFailure: event.publicationFailure } : {}),
      };
    case "iteration_commit_failed":
      return {
        ...op("iteration_commit_failed", "resume", true),
        ...(event.publicationFailure !== undefined ? { publicationFailure: event.publicationFailure } : {}),
      };
    case "ready_gate_failed":
      return op("ready_gate_failed", "resume", true);
    case "ready_flip_failed":
      return {
        ...op("ready_flip_failed", "stop", false),
        ...(event.publicationFailure !== undefined ? { publicationFailure: event.publicationFailure } : {}),
      };
    case "surviving_mutation_failed":
      return {
        ...op("surviving_mutation_failed", "resume", true),
        ...survivingMutationLogFields(event),
      };
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

const RUN_OPERATOR_ERROR_RECOVERY: Record<RunOperatorErrorReason, string> = {
  resumable_pause: "use `jarvis run resume <run-id>`",
  resumable_budget: "use `jarvis run resume <run-id>`",
  resumable_kill: "use `jarvis run resume <run-id>`",
  agent_blocked: "inspect the active subspec, resolve the blocker, and re-run the workflow",
  contract_miss: "inspect the spec contract and re-run the workflow",
  invalid_token: "use `jarvis run resume <run-id>`",
  missing_blocker: "use `jarvis run resume <run-id>`",
  quota_exhausted: "retry later or advance to the next configured agent",
  model_config: "fix agent/model configuration (`jarvis config`, machine profile)",
  no_binding: "fix agent bindings in configuration",
  landing_failed: "fix publication landing and use `jarvis run resume <run-id>`",
  invocation_error: "inspect `jarvis run log <run-id>` and re-run if appropriate",
  role_timeout: "re-dispatch the same workflow (not `jarvis run resume`)",
  role_stalled: "re-dispatch the same workflow (not `jarvis run resume`)",
  harness_failure: "inspect `jarvis run log <run-id>` and re-run if appropriate",
  state_store_lock_timeout: "use `jarvis run resume <run-id>`",
  not_implemented: "workflow-backed paused runs only; ad-hoc paused runs cannot resume yet",
  completion_commit_failed: "fix publication/commit state and use `jarvis run resume <run-id>`",
  iteration_commit_failed: "use `jarvis run resume <run-id>` to retry the iteration commit",
  ready_gate_failed: "fix the ready gate and use `jarvis run resume <run-id>`",
  ready_flip_failed:
    "manually fix the PR draft-to-ready transition and verify with `gh pr view <prNumber> --json isDraft`",
  surviving_mutation_failed: "fix mutation expectations and use `jarvis run resume <run-id>`",
  iteration_timeout: "inspect the run and re-dispatch with a higher iteration timeout",
  unsupported_resume_context: "fix the persisted snapshot or start a fresh workflow",
};

/** Check if a run's operator error (if any) advertises resumability. */
export function isResumeAdmitted(run: RunWithAttempts, terminalRecord?: TerminalLogRecord): boolean {
  return composeRunOperatorError(run, terminalRecord)?.nextAction === "resume";
}

/** `terminal_run` message when resume is refused; undefined when admission would succeed. */
export function terminalResumeRefusalMessage(
  run: RunWithAttempts,
  terminalRecord?: TerminalLogRecord,
): string | undefined {
  const operatorError = composeRunOperatorError(run, terminalRecord);
  if (operatorError?.nextAction === "resume") return undefined;
  const base = `Cannot resume a ${run.status} run`;
  if (operatorError === undefined) return base;
  return `${base}: ${RUN_OPERATOR_ERROR_RECOVERY[operatorError.reason]}`;
}

/**
 * Compose operator error from durable run state and optional terminal log.
 * Resumable durable statuses win over conflicting log; for `failed` / `blocked`,
 * a resumable finalization `loop_finished` wins over last-attempt detail, otherwise
 * attempt detail wins over conflicting `loop_finished`, and durable-status resumable
 * `loopOutcomeKind` values from stale logs do not override `failed` / `blocked`.
 */
export function composeRunOperatorError(
  run: RunWithAttempts,
  terminalRecord?: TerminalLogRecord,
): RunOperatorError | undefined {
  if (run.status === "in-progress") return undefined;
  // A completed run can still carry a trailing `run_execution_failed`: its workflow died
  // after the step run settled (review step, publication). Surface that, not silence.
  if (
    run.status === "completed" &&
    terminalRecord?.event.kind !== "loop_finished" &&
    terminalRecord?.event.kind !== "run_execution_failed"
  ) {
    return undefined;
  }

  const lastAttempt = lastCommittedAttempt(run.attempts ?? []);
  if (lastAttempt?.outcomeKind === "invalid_token") {
    return op("invalid_token", "resume", true);
  }
  if (lastAttempt?.outcomeKind === "missing_blocker") {
    return op("missing_blocker", "resume", true);
  }

  const resumable = RESUMABLE_TERMINALS[run.status];
  if (resumable) return resumable;
  const allowResumableLogOutcomes = run.status !== "failed" && run.status !== "blocked";

  if (terminalRecord?.event.kind === "run_execution_failed") {
    if (isPostBoundaryStateStoreLockTimeout(terminalRecord, run)) {
      return op("state_store_lock_timeout", "resume", true);
    }
    return op("harness_failure", "stop");
  }

  if (
    terminalRecord?.event.kind === "loop_finished" &&
    (run.status === "failed" || run.status === "blocked") &&
    isResumableFinalizationLoopFinished(terminalRecord.event)
  ) {
    const fromFinalization = mapFromLoopFinished(terminalRecord.event, lastAttempt, true);
    if (fromFinalization) return fromFinalization;
  }

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
