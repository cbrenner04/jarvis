import { isExhaustedRoleTimeout } from "../execution/invocation-failure.ts";
import type { PublicationFailure } from "../execution/publication-retry.ts";
import { readyGateOutOfScopeLogFields, survivingMutationLogFields } from "../execution/ready-finalize.ts";
import type {
  ContractMissDetailEvent,
  LoopFinishedEvent,
  PersistedRecord,
  RunExecutionFailedEvent,
} from "../persistence/log-stream.ts";
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
  "ready_gate_out_of_scope",
  "ready_flip_failed",
  "surviving_mutation_failed",
  "mutation_repair_exhausted",
  "iteration_timeout",
  "idle_output_timeout",
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
  completionCommitError?: string;
  survivingMutation?: string;
  survivingMutationSourceFile?: string;
  survivingMutationSourceLine?: number;
  readyGateOutsidePaths?: string[];
  readyGateOutOfScopeDetail?: string;
  contractMissDetail?: string;
  completedSubspecPaths?: string[];
  remainingSubspecPaths?: string[];
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
      if (isExhaustedRoleTimeout(detail)) return op("role_timeout", "stop", false);
      return INVOCATION_BY_FAILURE_KIND[detail.failureKind] ?? op("invocation_error", "stop");
    }
    case "idle_output_timeout":
      return op("idle_output_timeout", "stop");
    default:
      return undefined;
  }
}

function resumableFinalizationLoopFinishedOutranksAttemptDetail(event: LoopFinishedEvent | undefined): boolean {
  if (event === undefined || !event.resumable) return false;
  switch (event.loopOutcomeKind) {
    case "ready_gate_failed":
    case "ready_gate_out_of_scope":
    case "surviving_mutation_failed":
    case "completion_commit_failed":
    case "iteration_commit_failed":
    case "iteration_timeout":
    case "landing_failed":
      return true;
    default:
      return false;
  }
}

/** Prefer resumable finalization `loop_finished` over mappable last-attempt detail on failed / blocked rows. */
export function resolveFailedBlockedAttemptPrecedence(
  lastAttempt: Attempt | undefined,
  loopFinishedEvent: LoopFinishedEvent | undefined,
): RunOperatorError | undefined {
  if (loopFinishedEvent?.loopOutcomeKind === "mutation_repair_exhausted") {
    return mapFromLoopFinished(loopFinishedEvent, lastAttempt, false);
  }
  if (loopFinishedEvent && resumableFinalizationLoopFinishedOutranksAttemptDetail(loopFinishedEvent)) {
    const fromFinalization = mapFromLoopFinished(loopFinishedEvent, lastAttempt, true);
    if (fromFinalization) return fromFinalization;
  }
  return lastAttempt ? mapInvocationFromAttempt(lastAttempt) : undefined;
}

function mapFromLoopFinished(
  event: LoopFinishedEvent,
  lastAttempt?: Attempt,
  allowResumableLogOutcomes = true,
): RunOperatorError | undefined {
  const resumable = RESUMABLE_TERMINALS[event.loopOutcomeKind];
  if (resumable) return allowResumableLogOutcomes ? resumable : undefined;

  switch (event.loopOutcomeKind) {
    case "landing_failed":
      return op("landing_failed", "resume", true);
    case "completion_commit_failed":
      return {
        ...op(event.loopOutcomeKind, "resume", true),
        ...(event.publicationFailure !== undefined ? { publicationFailure: event.publicationFailure } : {}),
        ...("completionCommitError" in event && typeof event.completionCommitError === "string"
          ? { completionCommitError: event.completionCommitError }
          : {}),
      };
    case "iteration_commit_failed":
      return {
        ...op(event.loopOutcomeKind, "resume", true),
        ...(event.publicationFailure !== undefined ? { publicationFailure: event.publicationFailure } : {}),
      };
    case "ready_gate_failed":
      return op("ready_gate_failed", "resume", true);
    case "ready_gate_out_of_scope":
      return {
        ...op("ready_gate_out_of_scope", "resume", true),
        ...readyGateOutOfScopeLogFields(event),
      };
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
    case "mutation_repair_exhausted":
      return op("mutation_repair_exhausted", "inspect_spec");
    case "blocked":
      return op("agent_blocked", "inspect_spec");
    case "contract_miss":
      return allowResumableLogOutcomes && event.resumable
        ? op("contract_miss", "resume", true)
        : op("contract_miss", "inspect_spec");
    case "invocation_failure":
      return (lastAttempt && mapInvocationFromAttempt(lastAttempt)) ?? op("invocation_error", "stop");
    case "iteration_timeout": {
      const base = event.resumable ? op("iteration_timeout", "resume", true) : op("iteration_timeout", "stop");
      return {
        ...base,
        ...(event.completedSubspecPaths !== undefined ? { completedSubspecPaths: event.completedSubspecPaths } : {}),
        ...(event.remainingSubspecPaths !== undefined ? { remainingSubspecPaths: event.remainingSubspecPaths } : {}),
        ...(event.publicationFailure !== undefined ? { publicationFailure: event.publicationFailure } : {}),
      };
    }
    case "idle_output_timeout":
      return op("idle_output_timeout", "stop");
    default:
      return undefined;
  }
}

/** Operator recovery copy for `terminal_run` refusals; aligned with `v2/docs/operator-runbook.md`. */
export const RUN_OPERATOR_ERROR_RECOVERY = {
  resumable_pause: "run jarvis run resume when the row reports nextAction resume",
  resumable_budget: "run jarvis run resume after the budget clears or raise the iteration budget",
  resumable_kill: "run jarvis run resume to continue from the killed checkpoint",
  agent_blocked: "inspect the spec, resolve the blocker, then re-run the spec",
  contract_miss:
    "read contract_miss_detail in jarvis run log; jarvis run resume when nextAction is resume, otherwise fix the spec and re-run",
  invalid_token: "run jarvis run resume after fixing the invalid blocked token",
  missing_blocker: "run jarvis run resume after the harness records blocker text",
  quota_exhausted: "wait for quota reset or switch agents, then re-dispatch the workflow",
  model_config: "fix agent/model config, then re-dispatch the workflow",
  no_binding: "fix agent bindings in config, then re-dispatch the workflow",
  landing_failed: "fix landing/publication access, then jarvis run resume",
  invocation_error: "inspect jarvis run log for the invocation failure, then re-dispatch or stop",
  role_timeout: "re-dispatch the same workflow",
  role_stalled: "re-dispatch the same workflow",
  harness_failure: "inspect jarvis run log and ~/.jarvis/daemon.log, then re-dispatch or stop",
  state_store_lock_timeout: "run jarvis run resume after the store lock clears",
  not_implemented: "workflow paused write steps use jarvis run resume; ad-hoc paused runs are not supported yet",
  completion_commit_failed: "fix git/gh publication, then jarvis run resume",
  iteration_commit_failed: "fix git state, then jarvis run resume",
  ready_gate_failed: "fix the ready gate failure, then jarvis run resume",
  ready_gate_out_of_scope: "retry finalization with jarvis run resume; do not repair unrelated source files",
  ready_flip_failed:
    "manually fix the PR draft-to-ready transition, then verify with gh pr view <prNumber> --json isDraft",
  surviving_mutation_failed: "fix surviving-mutation test coverage, then jarvis run resume (before repair exhaustion)",
  mutation_repair_exhausted: "manually fix and publish the worktree, or untick criteria before re-running implement",
  iteration_timeout:
    "run jarvis run resume when nextAction is resume, otherwise inspect the stall in jarvis run log and re-dispatch the workflow",
  idle_output_timeout: "inspect the stall in jarvis run log, then re-dispatch the workflow",
  unsupported_resume_context: "fix the persisted workflow snapshot or re-run the spec",
} satisfies Record<RunOperatorErrorReason, string>;

/** Check if a run's operator error (if any) advertises resumability. */
export function isResumeAdmitted(run: RunWithAttempts, terminalRecord?: TerminalLogRecord): boolean {
  return composeRunOperatorError(run, terminalRecord)?.nextAction === "resume";
}

/** Refusal message when resume is blocked; omitted when the row is admitted. */
export function terminalResumeRefusalMessage(
  run: RunWithAttempts,
  terminalRecord?: TerminalLogRecord,
): string | undefined {
  const error = composeRunOperatorError(run, terminalRecord);
  if (error?.nextAction === "resume") return undefined;
  const reason = error?.reason ?? "harness_failure";
  return `Cannot resume a ${run.status} run — ${RUN_OPERATOR_ERROR_RECOVERY[reason]}`;
}

/**
 * Compose operator error from durable run state and optional terminal log.
 * Resumable durable statuses win over conflicting log. On `failed` / `blocked`,
 * a resumable finalization `loop_finished` outranks last-attempt detail; other
 * conflicting `loop_finished` values do not override mappable attempt detail, and
 * durable-status resumable kinds from stale logs stay demoted.
 */
function composeRunOperatorErrorFromState(
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

  const loopFinishedEvent = terminalRecord?.event.kind === "loop_finished" ? terminalRecord.event : undefined;
  if (
    lastAttempt?.outcomeKind === "contract_miss" &&
    loopFinishedEvent?.loopOutcomeKind === "contract_miss" &&
    loopFinishedEvent.resumable
  ) {
    return op("contract_miss", "resume", true);
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
    const fromPrecedence = resolveFailedBlockedAttemptPrecedence(lastAttempt, loopFinishedEvent);
    if (fromPrecedence) return fromPrecedence;
  }

  if (terminalRecord?.event.kind === "loop_finished") {
    const fromLog = mapFromLoopFinished(terminalRecord.event, lastAttempt, allowResumableLogOutcomes);
    if (fromLog) return fromLog;
  }

  if (run.status === "blocked") return op("agent_blocked", "inspect_spec");
  if (run.status === "failed") return op("harness_failure", "stop");
  return undefined;
}

export function composeRunOperatorError(
  run: RunWithAttempts,
  terminalRecord?: TerminalLogRecord,
  logRecords?: PersistedRecord[],
): RunOperatorError | undefined {
  const error = composeRunOperatorErrorFromState(run, terminalRecord);
  if (error?.reason !== "contract_miss" || !logRecords) return error;
  let lastDetailEvent: ContractMissDetailEvent | undefined;
  for (const record of logRecords) {
    if (record.event.kind === "contract_miss_detail") {
      lastDetailEvent = record.event;
    }
  }
  const failureReason = lastDetailEvent?.failureReason;
  return failureReason === undefined ? error : { ...error, contractMissDetail: failureReason };
}
