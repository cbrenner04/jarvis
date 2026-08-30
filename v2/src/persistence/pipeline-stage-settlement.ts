import { type InvocationFailureDetail, isExhaustedRoleTimeout } from "../execution/invocation-failure.ts";
import type { WriteLoopOutcomeKind } from "../execution/write-loop.ts";
import type { Attempt, Run } from "./state-store.ts";

export type PipelineStageArtifact = {
  entryRunId: string;
  invocationId?: string;
  specPath: string;
  downstreamInputs?: string[];
  prNumber?: number;
  prUrl?: string;
  requestedBase?: string;
  resolvedBase?: string;
};

export function stageArtifactFromEntryRun(
  entryRunId: string,
  entryRun: Run,
  invocationId?: string,
  publicationBaseRetarget?: { requestedBase: string; resolvedBase: string },
): PipelineStageArtifact {
  return {
    entryRunId,
    ...(invocationId !== undefined ? { invocationId } : {}),
    specPath: entryRun.specPath,
    ...(entryRun.downstreamInputs?.length ? { downstreamInputs: [...entryRun.downstreamInputs] } : {}),
    ...(entryRun.prNumber != null ? { prNumber: entryRun.prNumber } : {}),
    ...(entryRun.prUrl != null ? { prUrl: entryRun.prUrl } : {}),
    ...(publicationBaseRetarget ?? {}),
  };
}

type StageFailureDetail = {
  reason: string;
  retryable: boolean;
  nextAction: "resume" | "inspect_spec" | "fix_config" | "retry_later" | "stop";
  message?: string;
};

const failure = (
  reason: string,
  nextAction: StageFailureDetail["nextAction"],
  retryable = false,
): StageFailureDetail => ({ reason, retryable, nextAction });

function invocationFailureDetail(detail: InvocationFailureDetail | null | undefined): StageFailureDetail {
  if (detail == null) return failure("invocation_error", "stop");
  if (isExhaustedRoleTimeout(detail)) return failure("role_timeout", "stop");
  const mapped = {
    quota: failure("quota_exhausted", "retry_later"),
    stall: failure("role_stalled", "retry_later", true),
    model_config: failure("model_config", "fix_config"),
    error: failure("invocation_error", "stop"),
    no_binding: failure("no_binding", "fix_config"),
    landing: failure("landing_failed", "resume", true),
    timeout: failure("role_timeout", "retry_later", true),
  } satisfies Record<InvocationFailureDetail["failureKind"], StageFailureDetail>;
  const result = mapped[detail.failureKind];
  return (detail.failureKind === "error" || detail.failureKind === "model_config") && detail.message !== undefined
    ? { ...result, message: detail.message }
    : result;
}

function attemptFailureDetail(attempt: Attempt | undefined): StageFailureDetail | undefined {
  switch (attempt?.outcomeKind) {
    case "invalid_token":
      return failure("invalid_token", "resume", true);
    case "missing_blocker":
      return failure("missing_blocker", "resume", true);
    case "blocked":
      return failure("agent_blocked", "inspect_spec");
    case "contract_miss":
      return failure("contract_miss", "inspect_spec");
    case "invocation_failure":
      return invocationFailureDetail(attempt.invocationFailureDetail);
    case "idle_output_timeout":
      return failure("idle_output_timeout", "stop");
    default:
      return undefined;
  }
}

function terminalCauseFailureDetail(
  terminalCause: WriteLoopOutcomeKind,
  terminalFailureDetail: InvocationFailureDetail | null | undefined,
): StageFailureDetail | undefined {
  switch (terminalCause) {
    case "blocked":
      return failure("agent_blocked", "inspect_spec");
    case "contract_miss":
      return failure("contract_miss", "inspect_spec");
    case "invocation_failure":
      return invocationFailureDetail(terminalFailureDetail);
    case "iteration_timeout":
      return failure("iteration_timeout", "stop");
    case "idle_output_timeout":
      return failure("idle_output_timeout", "stop");
    case "budget-exhausted":
      return failure("resumable_budget", "resume", true);
    case "paused":
      return failure("resumable_pause", "resume", true);
    case "completion_commit_failed":
      return failure("completion_commit_failed", "resume", true);
    case "iteration_commit_failed":
      return failure("iteration_commit_failed", "resume", true);
    case "ready_gate_failed":
      return failure("ready_gate_failed", "resume", true);
    case "ready_gate_command_missing":
      return failure("ready_gate_command_missing", "fix_config");
    case "ready_gate_out_of_scope":
      return failure("ready_gate_out_of_scope", "stop");
    case "ready_flip_failed":
      return failure("ready_flip_failed", "stop");
    case "surviving_mutation_failed":
      return failure("surviving_mutation_failed", "resume", true);
    case "mutation_repair_exhausted":
      return failure("mutation_repair_exhausted", "inspect_spec");
    case "runtime_smoke_failed": {
      const result = failure("runtime_smoke_failed", "stop");
      return terminalFailureDetail?.message === undefined
        ? result
        : { ...result, message: terminalFailureDetail.message };
    }
    case "landing_failed": {
      const result = failure("landing_failed", "resume", true);
      return terminalFailureDetail?.message === undefined
        ? result
        : { ...result, message: terminalFailureDetail.message };
    }
    default:
      return undefined;
  }
}

export function stageFailureDetailFromEntryRun(entryRun: Run & { attempts: Attempt[] }): StageFailureDetail {
  if (entryRun.terminalCause != null) {
    const fromCause = terminalCauseFailureDetail(entryRun.terminalCause, entryRun.terminalFailureDetail);
    if (fromCause !== undefined) return fromCause;
  }
  for (let index = entryRun.attempts.length - 1; index >= 0; index -= 1) {
    const attempt = entryRun.attempts[index];
    if (attempt?.outcomeKind == null) continue;
    const fromAttempt = attemptFailureDetail(attempt);
    if (fromAttempt !== undefined) return fromAttempt;
    break;
  }
  if (entryRun.status === "blocked") return failure("agent_blocked", "inspect_spec");
  if (entryRun.status === "killed") return failure("resumable_kill", "resume", true);
  return failure("harness_failure", "stop");
}
