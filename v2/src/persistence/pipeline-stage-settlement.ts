import { isExhaustedRoleTimeout } from "../execution/invocation-failure.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import {
  type Attempt,
  isTerminalRunStatus,
  type Pipeline,
  type PipelineStageRecord,
  type Run,
  type RunStatus,
  type StateStore,
} from "./state-store.ts";
import { rollupWorkflowRunStatus } from "./workflow-run-status-rollup.ts";

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

export type LinkedStageSettlementStore = Pick<
  StateStore,
  "loadRun" | "findRunsByInvocationId" | "loadPipeline" | "listPipelines" | "updateStage"
>;

export type LinkedStageTarget = { pipelineId: string; stageId: string; branchKey: string };

export type LinkedStageSettlementOptions = {
  /** Only these stage rows; default scans every pipeline for `running` rows linked to the entry run. */
  stageTargets?: readonly LinkedStageTarget[];
  /** Log-derived `requestedBase`/`resolvedBase` for a succeeded stage artifact. */
  publicationBaseRetarget?: { requestedBase: string; resolvedBase: string };
  /** Log-derived operator failure detail; the durable row projection is the fallback. */
  failureDetail?: unknown;
};

export type LinkedStageSettlement =
  | { kind: "settled"; stages: LinkedStageTarget[]; rollupStatus: RunStatus }
  | { kind: "not-terminal"; rollupStatus: RunStatus }
  | { kind: "no-entry-run" }
  | { kind: "no-linked-stages"; rollupStatus: RunStatus };

/** The authored-order final workflow stage of a `ready`/`merge` pipeline must carry PR evidence to succeed. */
export function terminalPublicationStageRequiresPrEvidence(definition: PipelineDefinition, stageId: string): boolean {
  if (definition.terminalAction !== "ready" && definition.terminalAction !== "merge") return false;
  for (let index = definition.stages.length - 1; index >= 0; index -= 1) {
    const stage = definition.stages[index];
    if (stage?.kind !== "workflow") continue;
    return stage.stageId === stageId;
  }
  return false;
}

function linkedRunningStages(
  store: LinkedStageSettlementStore,
  entryRunId: string,
  targets: readonly LinkedStageTarget[] | undefined,
): Array<{ pipeline: Pipeline & { stages: PipelineStageRecord[] }; stage: PipelineStageRecord }> {
  const found: Array<{ pipeline: Pipeline & { stages: PipelineStageRecord[] }; stage: PipelineStageRecord }> = [];
  const pipelines =
    targets === undefined
      ? store.listPipelines()
      : [...new Set(targets.map((target) => target.pipelineId))]
          .map((pipelineId) => store.loadPipeline(pipelineId))
          .filter((pipeline): pipeline is Pipeline & { stages: PipelineStageRecord[] } => pipeline !== null);
  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      if (stage.status !== "running" || stage.workflowInvocationId !== entryRunId) continue;
      if (
        targets !== undefined &&
        !targets.some(
          (target) =>
            target.pipelineId === pipeline.id &&
            target.stageId === stage.stageId &&
            target.branchKey === stage.branchKey,
        )
      ) {
        continue;
      }
      found.push({ pipeline, stage });
    }
  }
  return found;
}

/**
 * The one linked-stage settlement algorithm: map a terminal workflow invocation's durable rows onto
 * every `running` stage linked to its entry run. Idempotent — a stage settles once, and a live or
 * non-terminal invocation leaves every row untouched. The SQLite store wraps it in a transaction;
 * the daemon owner reaches it through `StateStore.settleLinkedStagesFromEntryRun`.
 */
export function settleLinkedStagesFromEntryRunWith(
  store: LinkedStageSettlementStore,
  entryRunId: string,
  options: LinkedStageSettlementOptions = {},
): LinkedStageSettlement {
  const entryRun = store.loadRun(entryRunId);
  if (entryRun === null) return { kind: "no-entry-run" };
  const workflowSnapshot = entryRun.workflowSnapshot ?? null;
  const siblingRuns = workflowSnapshot === null ? [] : store.findRunsByInvocationId(workflowSnapshot.invocationId);
  const rollupStatus = rollupWorkflowRunStatus({ entryRun, workflowSnapshot, siblingRuns, isLive: false });
  if (!isTerminalRunStatus(rollupStatus)) return { kind: "not-terminal", rollupStatus };

  const linked = linkedRunningStages(store, entryRunId, options.stageTargets);
  if (linked.length === 0) return { kind: "no-linked-stages", rollupStatus };
  const endedAt = Date.now();
  const settled: LinkedStageTarget[] = [];
  for (const { pipeline, stage } of linked) {
    const target = { pipelineId: pipeline.id, stageId: stage.stageId, branchKey: stage.branchKey };
    settled.push(target);
    if (rollupStatus !== "completed") {
      store.updateStage({
        ...target,
        patch: {
          status: "failed",
          endedAt,
          failureDetail: options.failureDetail ?? stageFailureDetailFromEntryRun(entryRun),
        },
      });
      continue;
    }
    const prEvidence = resolvePrEvidenceAcrossInvocation(entryRun, siblingRuns);
    const missingPrEvidence =
      terminalPublicationStageRequiresPrEvidence(pipeline.definition, stage.stageId) && prEvidence === undefined;
    if (entryRun.specPath.length === 0 || missingPrEvidence) {
      store.updateStage({
        ...target,
        patch: {
          status: "failed",
          endedAt,
          failureDetail:
            entryRun.specPath.length === 0
              ? { message: `pipeline-stage-dispatch: entry run ${entryRunId} completed without a recorded spec path` }
              : {
                  code: "completion_publication_missing_pr_evidence",
                  message: `completion publication left no confirmed PR evidence on linked entry run ${entryRunId}`,
                },
        },
      });
      continue;
    }
    store.updateStage({
      ...target,
      patch: {
        status: "succeeded",
        endedAt,
        failureDetail: null,
        artifact: stageArtifactFromEntryRun(
          entryRunId,
          entryRun,
          undefined,
          options.publicationBaseRetarget,
          prEvidence,
        ),
      },
    });
  }
  return { kind: "settled", stages: settled, rollupStatus };
}
