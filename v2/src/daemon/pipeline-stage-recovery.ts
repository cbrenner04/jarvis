import type { CompletionCommitter } from "../execution/completion-commit.ts";
import type { PipelineStage } from "../execution/pipeline-definition.ts";
import type { PublicationLanding } from "../execution/publication-landing.ts";
import {
  type AnyWorkflowStep,
  isPlanStageEntryRunRecoverable,
  type PlanStageRecoveryOutcome,
  type PlanStageRecoveryRequest,
  type ReviewDebateWorkflowStep,
  type ReviewWorkflowStep,
  recoverPlanStage,
} from "../execution/workflow-runner.ts";
import type { LogSink } from "../persistence/log-stream.ts";
import type {
  Pipeline,
  PipelineReopenRefusalReason,
  PipelineStageRecord,
  StateStore,
} from "../persistence/state-store.ts";
import { loadPipelineContext } from "../persistence/state-store.ts";
import type { PipelineExecutionDeps } from "./pipeline-execution.ts";
import { buildBranchStageArtifacts, continuePipeline, findFanOutSplit, findStageRecord } from "./pipeline-execution.ts";
import { stageArtifactFromEntryRun } from "./pipeline-stage-dispatch.ts";
import {
  isFanOutStageResolution,
  resolveStageWorkflowSteps,
  singleStageResolutionSteps,
} from "./pipeline-stage-resolve.ts";

export type PipelineStageRecoveryDeps = {
  store: StateStore;
  resolveStage?: typeof resolveStageWorkflowSteps;
};

export type PipelineStageRecoveryRefusalReason =
  | "pipeline_not_found"
  | "branch_not_found"
  | "missing_context"
  | "no_failed_stage"
  | "stage_not_plan"
  | "stage_not_linked"
  | "stage_resolution_failed"
  | "stage_not_recoverable";

/** A recovery target admitted for a branch's blocked plan stage: enough to build a `PlanStageRecoveryRequest`. */
export type PipelineStageRecoveryTarget = {
  runId: string;
  project: string;
  branch: string;
  worktreePath: string;
  writeStepId: string;
  steps: AnyWorkflowStep[];
  /** The captured failed row's own authored `stageId` — the row recovery execution admits, settles, and reopens. */
  stageId: string;
};

export type PipelineStageRecoveryResolution =
  | { ok: true; target: PipelineStageRecoveryTarget }
  | { ok: false; reason: PipelineStageRecoveryRefusalReason; message: string };

type PlanTreeReviewStep = (ReviewWorkflowStep | ReviewDebateWorkflowStep) & {
  landing: Extract<PublicationLanding, { kind: "plan-tree" }>;
};

function isPlanTreeReviewStep(step: AnyWorkflowStep): step is PlanTreeReviewStep {
  return (step.behavior === "review" || step.behavior === "review-debate") && step.landing?.kind === "plan-tree";
}

/** True when the pipeline carries any durable row (any status) under `branchKey`. */
function branchHasRows(pipeline: Pipeline & { stages: PipelineStageRecord[] }, branchKey: string): boolean {
  if (branchKey.trim() === "") return false;
  return pipeline.definition.stages.some(
    (stage) => findStageRecord(pipeline.stages, stage.stageId, branchKey) !== undefined,
  );
}

/** The branch's own single `failed` workflow stage row, plus its authored definition. */
function findBranchFailedWorkflowStage(
  pipeline: Pipeline & { stages: PipelineStageRecord[] },
  branchKey: string,
): { stage: Extract<PipelineStage, { kind: "workflow" }>; record: PipelineStageRecord } | undefined {
  for (const stage of pipeline.definition.stages) {
    if (stage.kind !== "workflow") continue;
    const record = findStageRecord(pipeline.stages, stage.stageId, branchKey);
    if (record?.status === "failed") return { stage, record };
  }
  return undefined;
}

/**
 * Resolves `{ pipelineId, branchKey }` against durable pipeline/stage rows into a recovery
 * target for that branch's blocked plan stage — its linked entry run, and the re-resolved
 * review actuator step(s) that carry the plan-tree landing, with `landing.durablePath` pinned
 * to the entry run's own recorded `specPath`. `branchKey: "default"` addresses unscoped rows;
 * no fan-out split is required. Effect-free: no store writes, no claims, no dispatch.
 */
export async function resolveBlockedPlanStageRecoveryTarget(
  args: { pipelineId: string; branchKey: string },
  deps: PipelineStageRecoveryDeps,
): Promise<PipelineStageRecoveryResolution> {
  const { store } = deps;
  const resolveStage = deps.resolveStage ?? resolveStageWorkflowSteps;
  const { pipelineId, branchKey } = args;

  const pipeline = store.loadPipeline(pipelineId);
  if (!pipeline) {
    return { ok: false, reason: "pipeline_not_found", message: `pipeline ${pipelineId} not found` };
  }

  if (!branchHasRows(pipeline, branchKey)) {
    return {
      ok: false,
      reason: "branch_not_found",
      message: `branch "${branchKey}" not found on pipeline ${pipelineId}`,
    };
  }

  const failed = findBranchFailedWorkflowStage(pipeline, branchKey);
  if (!failed) {
    return { ok: false, reason: "no_failed_stage", message: `branch "${branchKey}" has no failed stage` };
  }
  const { stage, record } = failed;

  if (stage.workflow !== "plan") {
    return { ok: false, reason: "stage_not_plan", message: `stage "${stage.stageId}" is not a plan stage` };
  }

  const entryRunId = record.workflowInvocationId;
  const entryRun = entryRunId !== null ? store.loadRun(entryRunId) : null;
  if (entryRunId === null || entryRun === null || !entryRun.stepId) {
    return { ok: false, reason: "stage_not_linked", message: `stage "${stage.stageId}" has no linked entry run` };
  }

  if (pipeline.context === null) {
    return {
      ok: false,
      reason: "missing_context",
      message: `pipeline ${pipelineId} has no persisted admission context`,
    };
  }

  const loadedContext = loadPipelineContext(pipeline.context);
  if (!loadedContext.ok) {
    return {
      ok: false,
      reason: "stage_resolution_failed",
      message: `pipeline-context-loader: ${loadedContext.error.errors.join("; ")}`,
    };
  }

  const split = findFanOutSplit(pipeline);
  const stageArtifacts =
    split !== null ? buildBranchStageArtifacts(pipeline, split, branchKey, record.position) : new Map();

  const resolution = await resolveStage(pipeline.definition, record.position, loadedContext.context, stageArtifacts, {
    loadRun: (runId) => {
      const run = store.loadRun(runId);
      return run === null ? null : { worktreePath: run.worktreePath, branch: run.branch };
    },
    branchKey,
    ...(split !== null ? { splitPosition: split.splitPosition } : {}),
  });

  if (resolution.ok === false) {
    return {
      ok: false,
      reason: "stage_resolution_failed",
      message: resolution.error,
    };
  }

  const branchIndex = split?.branchKeys.indexOf(branchKey) ?? -1;
  const resolvedSteps =
    branchKey === "default"
      ? isFanOutStageResolution(resolution)
        ? undefined
        : singleStageResolutionSteps(resolution)
      : isFanOutStageResolution(resolution)
        ? resolution.results[branchIndex]?.steps
        : undefined;
  if (resolvedSteps === undefined) {
    return {
      ok: false,
      reason: "stage_resolution_failed",
      message: `pipeline-stage-recovery: branch "${branchKey}" has no paired stage resolution`,
    };
  }

  // Recovery never re-runs the leading write step.
  const [, ...remainingSteps] = resolvedSteps;
  const reviewStep = remainingSteps.find(isPlanTreeReviewStep);
  if (reviewStep === undefined) {
    return {
      ok: false,
      reason: "stage_not_recoverable",
      message: `stage "${stage.stageId}" has no plan-tree review landing to recover`,
    };
  }
  if (reviewStep.cwd !== entryRun.worktreePath) {
    return {
      ok: false,
      reason: "stage_not_recoverable",
      message: `resolved review step cwd "${reviewStep.cwd}" does not match the linked run's worktree "${entryRun.worktreePath}"`,
    };
  }
  if (!isPlanStageEntryRunRecoverable(entryRun, store, reviewStep.stepId)) {
    return {
      ok: false,
      reason: "stage_not_recoverable",
      message: `linked entry run for stage "${stage.stageId}" is not a recoverable plan stage`,
    };
  }

  const recoveredStep: AnyWorkflowStep = {
    ...reviewStep,
    landing: { ...reviewStep.landing, durablePath: entryRun.specPath },
  };

  return {
    ok: true,
    target: {
      runId: entryRunId,
      project: entryRun.project,
      branch: entryRun.branch,
      worktreePath: entryRun.worktreePath,
      writeStepId: entryRun.stepId,
      steps: [recoveredStep],
      stageId: stage.stageId,
    },
  };
}

/** Injected attempt seam: runs the recovery request and reports how it stopped. Defaults to `recoverPlanStage`. */
export type PipelineStageRecoveryAttempt = (request: PlanStageRecoveryRequest) => Promise<PlanStageRecoveryOutcome>;

export type PipelineStageRecoveryExecutionDeps = Omit<PipelineExecutionDeps, "context"> & {
  attempt?: PipelineStageRecoveryAttempt;
  logSink?: LogSink;
  completionCommitter?: CompletionCommitter;
};

export type PipelineStageRecoveryExecutionOutcome =
  | {
      kind: "resolution_refused";
      pipelineId: string;
      branchKey: string;
      reason: PipelineStageRecoveryRefusalReason;
      message: string;
    }
  | { kind: "stage_claimed"; pipelineId: string; branchKey: string; stageId: string }
  | { kind: "recovered"; pipelineId: string; branchKey: string; stageId: string; entryRunId: string }
  | {
      kind: "not_recovered";
      pipelineId: string;
      branchKey: string;
      stageId: string;
      entryRunId: string;
      failureDetail: unknown;
    }
  | {
      kind: "reopen_refused";
      pipelineId: string;
      branchKey: string;
      stageId: string;
      entryRunId: string;
      reason: PipelineReopenRefusalReason;
    };

/** The `failureDetail` payload a stopped or refused attempt settles onto the still-`failed` row. */
function recoveryAttemptFailureDetail(outcome: PlanStageRecoveryOutcome): unknown {
  if (!outcome.ok) return { code: outcome.code, message: outcome.message };
  if (outcome.kind === "completion_commit_failed") {
    return { code: "completion_commit_failed", message: outcome.completionCommitError };
  }
  return {
    code: outcome.kind,
    message:
      outcome.invocationFailureMessage ??
      outcome.readyGateError ??
      outcome.completionCommitError ??
      outcome.publicationFailure?.message ??
      outcome.prePublicationError ??
      outcome.routingFailure ??
      outcome.survivingMutation ??
      `recovery attempt stopped with kind "${outcome.kind}"`,
  };
}

/**
 * Recovers, re-settles, and advances only the target branch's blocked plan stage: resolves the
 * branch's failed row (see {@link resolveBlockedPlanStageRecoveryTarget}), captures its linked
 * entry run and worktree before any mutation, claims durable stage admission, then runs the
 * injected attempt (default {@link recoverPlanStage}) against that capture with no prior row
 * write. Only `{ ok: true, kind: "complete" }` reopens the branch, relinks the reopened row
 * `running` to the captured entry run, settles it `succeeded`, and continues that branch
 * (`continuePipeline`, scoped to `branchKey`); every other outcome settles the still-`failed`
 * row in place with the attempt's own reason and continues nothing. The admission claim is
 * always released once the attempt (and any settlement) finishes.
 */
export async function recoverPipelineBranchStage(
  args: { pipelineId: string; branchKey: string },
  deps: PipelineStageRecoveryExecutionDeps,
): Promise<PipelineStageRecoveryExecutionOutcome> {
  const admission = await resolveAndClaimRecoveryTarget(args, deps);
  if (!admission.ok) return admission.refusal;
  return runClaimedRecoveryAttempt(args, admission.target, deps);
}

/**
 * Resolves a branch's blocked plan stage (see {@link resolveBlockedPlanStageRecoveryTarget}) and
 * claims durable stage admission for it, returning either the claimed target or the same
 * `resolution_refused`/`stage_claimed` refusal both {@link recoverPipelineBranchStage} and
 * {@link admitAndRecoverPipelineBranchStage} surface — shared so neither duplicates the
 * resolve-then-claim sequence.
 */
async function resolveAndClaimRecoveryTarget(
  args: { pipelineId: string; branchKey: string },
  deps: PipelineStageRecoveryExecutionDeps,
): Promise<
  | { ok: true; target: PipelineStageRecoveryTarget }
  | {
      ok: false;
      refusal: Extract<PipelineStageRecoveryExecutionOutcome, { kind: "resolution_refused" | "stage_claimed" }>;
    }
> {
  const { pipelineId, branchKey } = args;
  const resolution = await resolveBlockedPlanStageRecoveryTarget(args, deps);
  if (!resolution.ok) {
    return {
      ok: false,
      refusal: {
        kind: "resolution_refused",
        pipelineId,
        branchKey,
        reason: resolution.reason,
        message: resolution.message,
      },
    };
  }
  const { target } = resolution;
  const admission = claimResolvedPipelineBranchStageRecovery(args, target, deps.store);
  return admission.kind === "admitted" ? { ok: true, target } : { ok: false, refusal: admission };
}

/**
 * Runs the attempt against an already durably-claimed target, settles the row from its outcome,
 * and continues the branch on success. Assumes the caller already applied
 * `claimPipelineStageAdmission` for `target.stageId`; always releases it here.
 */
async function runClaimedRecoveryAttempt(
  args: { pipelineId: string; branchKey: string },
  target: PipelineStageRecoveryTarget,
  deps: PipelineStageRecoveryExecutionDeps,
): Promise<PipelineStageRecoveryExecutionOutcome> {
  const { store } = deps;
  const { pipelineId, branchKey } = args;
  const entryRunId = target.runId;
  const stageId = target.stageId;

  let settlement: PipelineStageRecoveryExecutionOutcome;
  try {
    const attempt = deps.attempt ?? recoverPlanStage;
    const outcome = await attempt({
      runId: entryRunId,
      project: target.project,
      branch: target.branch,
      worktreePath: target.worktreePath,
      writeStepId: target.writeStepId,
      steps: [...target.steps],
      stateStore: store,
      ...(deps.logSink !== undefined ? { logSink: deps.logSink } : {}),
      ...(deps.completionCommitter !== undefined ? { completionCommitter: deps.completionCommitter } : {}),
    });

    const succeeded = outcome.ok && outcome.kind === "complete";
    if (!succeeded) {
      const failureDetail = recoveryAttemptFailureDetail(outcome);
      store.updateStage({ pipelineId, stageId, branchKey, patch: { status: "failed", failureDetail } });
      settlement = { kind: "not_recovered", pipelineId, branchKey, stageId, entryRunId, failureDetail };
    } else {
      const reopen = store.reopenFailedPipeline({ pipelineId, branchKey });
      if (reopen.kind === "refused") {
        const failureDetail = {
          code: "reopen_refused",
          message: `reopenFailedPipeline refused: ${reopen.reason}`,
        };
        store.updateStage({ pipelineId, stageId, branchKey, patch: { status: "failed", failureDetail } });
        settlement = { kind: "reopen_refused", pipelineId, branchKey, stageId, entryRunId, reason: reopen.reason };
      } else {
        store.updateStage({
          pipelineId,
          stageId,
          branchKey,
          patch: { status: "running", startedAt: Date.now(), workflowInvocationId: entryRunId },
        });
        const entryRun = store.loadRun(entryRunId);
        if (entryRun === null) {
          const failureDetail = {
            code: "entry_run_missing",
            message: `entry run ${entryRunId} not found after recovery`,
          };
          store.updateStage({ pipelineId, stageId, branchKey, patch: { status: "failed", failureDetail } });
          settlement = { kind: "not_recovered", pipelineId, branchKey, stageId, entryRunId, failureDetail };
        } else {
          store.updateStage({
            pipelineId,
            stageId,
            branchKey,
            patch: { status: "succeeded", artifact: stageArtifactFromEntryRun(entryRunId, entryRun) },
          });
          settlement = { kind: "recovered", pipelineId, branchKey, stageId, entryRunId };
        }
      }
    }
  } finally {
    store.releasePipelineStageAdmission({ pipelineId, stageId, branchKey });
  }

  if (settlement.kind === "recovered") {
    const {
      attempt: _attempt,
      logSink: _logSink,
      completionCommitter: _completionCommitter,
      ...continuationDeps
    } = deps;
    await continuePipeline(pipelineId, continuationDeps, branchKey);
  }

  return settlement;
}

/** {@link admitAndRecoverPipelineBranchStage}'s result: admission decided synchronously; attempt outcome is not carried. */
export type PipelineStageRecoveryAdmission =
  | { kind: "admitted"; pipelineId: string; branchKey: string; stageId: string; entryRunId: string }
  | {
      kind: "resolution_refused";
      pipelineId: string;
      branchKey: string;
      reason: PipelineStageRecoveryRefusalReason;
      message: string;
    }
  | { kind: "stage_claimed"; pipelineId: string; branchKey: string; stageId: string };

/** Claims durable stage admission for a resolved recovery target. */
export function claimResolvedPipelineBranchStageRecovery(
  args: { pipelineId: string; branchKey: string },
  target: PipelineStageRecoveryTarget,
  store: StateStore,
): Extract<PipelineStageRecoveryAdmission, { kind: "admitted" | "stage_claimed" }> {
  const { pipelineId, branchKey } = args;
  const claim = store.claimPipelineStageAdmission({ pipelineId, stageId: target.stageId, branchKey });
  if (claim.kind === "refused") {
    return { kind: "stage_claimed", pipelineId, branchKey, stageId: target.stageId };
  }
  return { kind: "admitted", pipelineId, branchKey, stageId: target.stageId, entryRunId: target.runId };
}

/** Runs a claimed recovery attempt; detaches when `detachContinuation` is true. */
export async function executeClaimedPipelineBranchStageRecovery(
  args: { pipelineId: string; branchKey: string },
  target: PipelineStageRecoveryTarget,
  deps: PipelineStageRecoveryExecutionDeps,
  options: { detachContinuation?: boolean; onSettled?: () => void } = {},
): Promise<void> {
  const { pipelineId, branchKey } = args;
  const run = runClaimedRecoveryAttempt(args, target, deps).finally(() => options.onSettled?.());
  if (options.detachContinuation) {
    void run.catch((err: unknown) => {
      console.error(`Pipeline ${pipelineId} branch ${branchKey} recovery failed:`, err);
    });
    return;
  }
  await run;
}

/**
 * Resolves and claims a branch's blocked plan stage, then runs the attempt chain.
 * With `detachContinuation: true` (RPC default) the response returns before settlement;
 * `onSettled` runs after attempt, settlement, and any success continuation finish.
 */
export async function admitAndRecoverPipelineBranchStage(
  args: { pipelineId: string; branchKey: string },
  deps: PipelineStageRecoveryExecutionDeps,
  options: { detachContinuation?: boolean; onSettled?: () => void } = {},
): Promise<PipelineStageRecoveryAdmission> {
  const { pipelineId, branchKey } = args;
  const admission = await resolveAndClaimRecoveryTarget(args, deps);
  if (!admission.ok) return admission.refusal;
  const { target } = admission;
  const { stageId, runId: entryRunId } = target;

  await executeClaimedPipelineBranchStageRecovery(args, target, deps, options);

  return { kind: "admitted", pipelineId, branchKey, stageId, entryRunId };
}
