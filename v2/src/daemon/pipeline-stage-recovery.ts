import { join } from "node:path";
import { isRecord } from "../../../shared/is-record.ts";
import type { CompletionCommitter } from "../execution/completion-commit.ts";
import type { PipelineStage } from "../execution/pipeline-definition.ts";
import type { PublicationInputs } from "../execution/publication-landing.ts";
import {
  isPlanStageEntryRunRecoverable,
  type PlanStageRecoveryLanding,
  type PlanStageRecoveryOutcome,
  type PlanStageRecoveryRequest,
  recoverPlanStage,
} from "../execution/workflow-runner-resume.ts";
import type { LogSink } from "../persistence/log-stream.ts";
import type {
  Pipeline,
  PipelineReopenRefusalReason,
  PipelineStageRecord,
  StateStore,
} from "../persistence/state-store.ts";
import type { PipelineExecutionDeps } from "./pipeline-execution.ts";
import { continuePipeline, findStageRecord } from "./pipeline-execution.ts";
import { stageArtifactFromEntryRun } from "./pipeline-stage-dispatch.ts";

type PipelineStageRecoveryDeps = {
  store: StateStore;
  /** Compatibility injection for callers sharing dispatch deps; recovery never invokes it. */
  resolveStage?: PipelineExecutionDeps["resolveStage"];
};

type PipelineStageRecoveryRefusalReason =
  | "pipeline_not_found"
  | "branch_not_found"
  | "no_failed_stage"
  | "stage_not_plan"
  | "stage_not_linked"
  | "stage_not_recoverable";

/** A recovery target admitted for a branch's blocked plan stage: enough to build a `PlanStageRecoveryRequest`. */
type PipelineStageRecoveryTarget = {
  runId: string;
  project: string;
  branch: string;
  worktreePath: string;
  writeStepId: string;
  recoveryLanding: PlanStageRecoveryLanding;
  /** The captured failed row's own authored `stageId` — the row recovery execution admits, settles, and reopens. */
  stageId: string;
};

type PipelineStageRecoveryResolution =
  | { ok: true; target: PipelineStageRecoveryTarget }
  | { ok: false; reason: PipelineStageRecoveryRefusalReason; message: string };

const PLAN_STAGE_DIR = ".jarvis-plan-stage";
const PLAN_VERDICT_FILE = "verdict-plan.md";

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isPublicationInputs(value: unknown): value is PublicationInputs {
  if (!isRecord(value) || !isNonBlankString(value.sourceRoot) || !Array.isArray(value.paths)) return false;
  if (!value.paths.every(isNonBlankString)) return false;
  return value.consumeFrom === "worktree" || value.consumeFrom === "source";
}

function stageNotRecoverable(stageId: string, detail: string): PipelineStageRecoveryResolution {
  return {
    ok: false,
    reason: "stage_not_recoverable",
    message: `stage "${stageId}" has incomplete durable recovery context: ${detail}`,
  };
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
 * target for that branch's blocked plan stage from its linked run and workflow snapshot.
 * `branchKey: "default"` addresses unscoped rows. Effect-free: no store writes, claims,
 * pipeline-context loads, workflow resolution, or dispatch.
 */
export async function resolveBlockedPlanStageRecoveryTarget(
  args: { pipelineId: string; branchKey: string },
  deps: PipelineStageRecoveryDeps,
): Promise<PipelineStageRecoveryResolution> {
  const { store } = deps;
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
  if (stage.review === "none") {
    return stageNotRecoverable(stage.stageId, "plan stage has no review landing");
  }

  const entryRunId = record.workflowInvocationId;
  const entryRun = entryRunId !== null ? store.loadRun(entryRunId) : null;
  if (entryRunId === null || entryRun === null) {
    return { ok: false, reason: "stage_not_linked", message: `stage "${stage.stageId}" has no linked entry run` };
  }
  if (!isNonBlankString(entryRun.project) || !isNonBlankString(entryRun.branch)) {
    return stageNotRecoverable(stage.stageId, "linked run identity is missing or malformed");
  }
  if (!isNonBlankString(entryRun.worktreePath) || !isNonBlankString(entryRun.specPath)) {
    return stageNotRecoverable(stage.stageId, "linked run worktreePath or specPath is missing or malformed");
  }
  if (!isNonBlankString(entryRun.stepId)) {
    return stageNotRecoverable(stage.stageId, "linked write step identity is missing or malformed");
  }
  const snapshot = entryRun.workflowSnapshot;
  if (!isRecord(snapshot) || !isNonBlankString(snapshot.invocationId) || !Array.isArray(snapshot.steps)) {
    return stageNotRecoverable(stage.stageId, "linked workflow snapshot is missing or malformed");
  }
  const writeStep = snapshot.steps.find((candidate) => isRecord(candidate) && candidate.stepId === entryRun.stepId);
  if (!isRecord(writeStep) || writeStep.expectedArtifactPath !== PLAN_STAGE_DIR) {
    return stageNotRecoverable(stage.stageId, "linked write snapshot identity is missing or malformed");
  }
  const reviewStep = snapshot.steps.find(
    (candidate) =>
      isRecord(candidate) &&
      isNonBlankString(candidate.stepId) &&
      (candidate.behavior === "review" || candidate.behavior === "review-debate"),
  );
  if (!isRecord(reviewStep) || !isNonBlankString(reviewStep.stepId)) {
    return stageNotRecoverable(stage.stageId, "linked review snapshot identity is missing or malformed");
  }
  if (!isPublicationInputs(writeStep.landingInputs)) {
    return stageNotRecoverable(stage.stageId, "linked write snapshot landingInputs is missing or malformed");
  }
  if (!isPlanStageEntryRunRecoverable(entryRun, store, reviewStep.stepId)) {
    return stageNotRecoverable(stage.stageId, "linked entry run is not a recoverable plan stage");
  }

  const recoveryLanding: PlanStageRecoveryLanding = {
    stepId: reviewStep.stepId,
    behavior: reviewStep.behavior as "review" | "review-debate",
    verdictPath: join(entryRun.worktreePath, PLAN_STAGE_DIR, PLAN_VERDICT_FILE),
    landing: {
      kind: "plan-tree",
      stagingDir: PLAN_STAGE_DIR,
      durablePath: entryRun.specPath,
      inputs: writeStep.landingInputs,
    },
  };

  return {
    ok: true,
    target: {
      runId: entryRunId,
      project: entryRun.project,
      branch: entryRun.branch,
      worktreePath: entryRun.worktreePath,
      writeStepId: entryRun.stepId,
      recoveryLanding,
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

type PipelineStageRecoveryExecutionOutcome =
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
      recoveryLanding: target.recoveryLanding,
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
type PipelineStageRecoveryAdmission =
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
