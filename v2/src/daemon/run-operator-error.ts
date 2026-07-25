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

/** Exhaustive reason→recovery map (v2/docs/operator-runbook.md); new reasons fail typecheck until named. */
const RESUME_WITH_JARVIS = "resume with `jarvis run resume`";
const RECOVERY_BY_REASON: Record<RunOperatorErrorReason, string> = {
  resumable_pause: RESUME_WITH_JARVIS,
  resumable_budget: RESUME_WITH_JARVIS,
  resumable_kill: RESUME_WITH_JARVIS,
  agent_blocked: "resolve the blocker and re-run the spec",
  contract_miss: "inspect the spec",
  invalid_token: RESUME_WITH_JARVIS,
  missing_blocker: RESUME_WITH_JARVIS,
  quota_exhausted: "wait for quota to reset, then retry",
  model_config: "fix the agent/model config, then retry",
  no_binding: "fix the agent/model config, then retry",
  landing_failed: RESUME_WITH_JARVIS,
  invocation_error: "inspect the daemon log; no automated recovery",
  role_timeout: "re-dispatch the same workflow",
  role_stalled: "re-dispatch the same workflow",
  harness_failure: "inspect the daemon log; no automated recovery",
  state_store_lock_timeout: RESUME_WITH_JARVIS,
  not_implemented: "not yet implemented; re-run the spec instead",
  completion_commit_failed: "fix the uncommitted/publication state, then `jarvis run resume`",
  iteration_commit_failed: "fix the failing commit, then `jarvis run resume`",
  ready_gate_failed: "fix the failing gate or coverage, then `jarvis run resume`",
  ready_flip_failed:
    "inspect and manually fix the PR draft-to-ready transition (see error.prNumber), then verify with `gh pr view <prNumber> --json isDraft`",
  surviving_mutation_failed: "fix test coverage for the surviving mutation, then `jarvis run resume`",
  iteration_timeout: "inspect the daemon log; no automated recovery",
  unsupported_resume_context: "re-run the spec",
};

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

/** Check if a run's operator error (if any) advertises resumability. */
export function isResumeAdmitted(run: RunWithAttempts, terminalRecord?: TerminalLogRecord): boolean {
  return composeRunOperatorError(run, terminalRecord)?.nextAction === "resume";
}

/** `terminal_run` message when resume is refused; undefined when admission succeeds. */
export function terminalResumeRefusalMessage(
  run: RunWithAttempts,
  terminalRecord?: TerminalLogRecord,
): string | undefined {
  if (isResumeAdmitted(run, terminalRecord)) return undefined;
  const error = composeRunOperatorError(run, terminalRecord);
  return error === undefined
    ? `Cannot resume a ${run.status} run`
    : `Cannot resume a ${run.status} run: ${RECOVERY_BY_REASON[error.reason]}`;
}

/**
 * Compose operator error from durable run state and optional terminal log.
 * Resumable durable statuses win over conflicting log; for `failed` / `blocked`,
 * a terminal `loop_finished` composing `nextAction: "resume"` outranks last-attempt
 * detail; other resumable `loopOutcomeKind` values from stale logs do not override.
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

  if (run.status === "failed" || run.status === "blocked") {
    const fromAttempt = lastAttempt && mapInvocationFromAttempt(lastAttempt);
    if (terminalRecord?.event.kind === "loop_finished") {
      const fromLog = mapFromLoopFinished(terminalRecord.event, lastAttempt, allowResumableLogOutcomes);
      if (fromLog?.nextAction === "resume") return fromLog;
    }
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
