import { isExhaustedRoleTimeout } from "../execution/invocation-failure.ts";
import type { Attempt, Run, StateStore } from "./state-store.ts";

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

type PrEvidence = { prNumber: number; prUrl: string };

/**
 * Resolve published PR evidence across an invocation's rows.
 *
 * Completion publication dispatches late under its own run id, so the PR is frequently recorded
 * on a successor row rather than on the entry run. Reading the entry row alone reports
 * `completion_publication_missing_pr_evidence` for work that published fine, failing the stage
 * and skipping its terminal action. Prefer the entry run when it carries a complete pair, then
 * fall back to the first sibling that does.
 */
export function resolvePrEvidenceAcrossInvocation(
  entryRun: { prNumber?: number | null; prUrl?: string | null },
  siblingRuns: readonly { prNumber?: number | null; prUrl?: string | null }[],
): PrEvidence | undefined {
  const candidates = [entryRun, ...siblingRuns];
  for (const candidate of candidates) {
    if (candidate.prNumber != null && candidate.prUrl != null) {
      return { prNumber: candidate.prNumber, prUrl: candidate.prUrl };
    }
  }
  return undefined;
}

export function stageArtifactFromEntryRun(
  entryRunId: string,
  entryRun: NonNullable<ReturnType<StateStore["loadRun"]>>,
  invocationId: string | undefined = entryRun.workflowSnapshot?.invocationId,
  publicationBaseRetarget?: { requestedBase: string; resolvedBase: string },
  prEvidence: PrEvidence | undefined = resolvePrEvidenceAcrossInvocation(entryRun, []),
): PipelineStageArtifact {
  return {
    entryRunId,
    ...(invocationId !== undefined ? { invocationId } : {}),
    specPath: entryRun.specPath,
    ...(entryRun.downstreamInputs?.length ? { downstreamInputs: [...entryRun.downstreamInputs] } : {}),
    ...(prEvidence !== undefined ? { prNumber: prEvidence.prNumber, prUrl: prEvidence.prUrl } : {}),
    ...(publicationBaseRetarget ?? {}),
  };
}

type DurableRunWithAttempts = Run & { attempts: Attempt[] };

type DurableOperatorError = {
  reason: string;
  retryable: boolean;
  nextAction: string;
  message?: string;
};

function durableOperatorErrorFromEntryRun(entryRun: DurableRunWithAttempts): DurableOperatorError {
  const invocationFailureDetail = entryRun.terminalFailureDetail;
  if (entryRun.terminalCause === "invocation_failure" && invocationFailureDetail != null) {
    switch (invocationFailureDetail.failureKind) {
      case "quota":
        return { reason: "quota_exhausted", retryable: false, nextAction: "retry_later" };
      case "model_config":
      case "no_binding":
        return {
          reason: invocationFailureDetail.failureKind,
          retryable: false,
          nextAction: "fix_config",
          ...(invocationFailureDetail.failureKind === "model_config" && invocationFailureDetail.message !== undefined
            ? { message: invocationFailureDetail.message }
            : {}),
        };
      case "landing":
        return { reason: "landing_failed", retryable: true, nextAction: "resume" };
      case "timeout":
      case "stall":
        return {
          reason: invocationFailureDetail.failureKind === "timeout" ? "role_timeout" : "role_stalled",
          retryable: !isExhaustedRoleTimeout(invocationFailureDetail),
          nextAction: isExhaustedRoleTimeout(invocationFailureDetail) ? "stop" : "retry_later",
        };
      case "error":
        return {
          reason: "invocation_error",
          retryable: false,
          nextAction: "stop",
          ...(invocationFailureDetail.message !== undefined ? { message: invocationFailureDetail.message } : {}),
        };
    }
  }

  switch (entryRun.terminalCause) {
    case "blocked":
      return { reason: "agent_blocked", retryable: false, nextAction: "inspect_spec" };
    case "contract_miss":
      return { reason: "contract_miss", retryable: false, nextAction: "inspect_spec" };
    case "idle_output_timeout":
      return { reason: "idle_output_timeout", retryable: false, nextAction: "stop" };
  }

  const lastAttempt = [...entryRun.attempts].reverse().find((attempt) => attempt.outcomeKind != null);
  switch (lastAttempt?.outcomeKind) {
    case "invalid_token":
      return { reason: "invalid_token", retryable: true, nextAction: "resume" };
    case "missing_blocker":
      return { reason: "missing_blocker", retryable: true, nextAction: "resume" };
    case "blocked":
      return { reason: "agent_blocked", retryable: false, nextAction: "inspect_spec" };
    case "contract_miss":
      return { reason: "contract_miss", retryable: false, nextAction: "inspect_spec" };
    case "invocation_failure":
      if (lastAttempt.invocationFailureDetail != null) {
        return durableOperatorErrorFromEntryRun({
          ...entryRun,
          terminalCause: "invocation_failure",
          terminalFailureDetail: lastAttempt.invocationFailureDetail,
        });
      }
      break;
    case "idle_output_timeout":
      return { reason: "idle_output_timeout", retryable: false, nextAction: "stop" };
  }

  if (entryRun.status === "blocked") return { reason: "agent_blocked", retryable: false, nextAction: "inspect_spec" };
  if (entryRun.status === "killed") return { reason: "resumable_kill", retryable: true, nextAction: "resume" };
  return { reason: "harness_failure", retryable: false, nextAction: "stop" };
}

export function stageFailureDetailFromEntryRun(entryRun: DurableRunWithAttempts): unknown {
  return {
    ...durableOperatorErrorFromEntryRun(entryRun),
    entryRunStatus: entryRun.status,
    ...(entryRun.terminalCause != null ? { terminalCause: entryRun.terminalCause } : {}),
    ...(entryRun.terminalFailureDetail != null ? { terminalFailureDetail: entryRun.terminalFailureDetail } : {}),
    attempts: entryRun.attempts.map(({ attemptNumber, outcomeKind, invocationFailureDetail }) => ({
      attemptNumber,
      outcomeKind,
      ...(invocationFailureDetail != null ? { invocationFailureDetail } : {}),
    })),
  };
}
