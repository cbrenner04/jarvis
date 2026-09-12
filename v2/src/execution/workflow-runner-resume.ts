import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { errorMessage } from "../../../shared/error-message.ts";
import type { RunFixCommandOpts } from "../../../shared/fix-command.ts";
import { createResolvedAgentBinding, type ResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { resolvePinnedLinkedSubspec } from "../../../shared/linked-subspec-routing.ts";
import { extractBlockerBody } from "../../../shared/spec-parser.ts";
import {
  findSnapshotStepForRunStepId,
  isWriteSiblingStepId,
  LINK_STEP_ID_INFIX,
  matchesLinkedSiblingStepId,
} from "../../../shared/write-sibling-step-id.ts";
import { resolveExecutableRole, resolveInvocationBindings } from "../config/agent-model-config.ts";
import {
  type IntentFinalizationEvent,
  type LogSink,
  type LoopFinishedEvent,
  type PersistedRecord,
  priorLogRecordsFromSink,
  type RunExecutionFailedEvent,
} from "../persistence/log-stream.ts";
import type {
  Attempt,
  OutcomeKind,
  Run,
  StateStore,
  WorkflowSnapshot,
  WorkflowSnapshotStep,
} from "../persistence/state-store.ts";
import {
  type CompletionCommitter,
  type CompletionStepMetadata,
  createCompletionCommitter,
  mutatingReviewPassCommitFields,
  renderStepCommitTitle,
} from "./completion-commit.ts";
import type { CompletionPublisher } from "./completion-publisher.ts";
import { verifyDiffDerivedMutations } from "./diff-derived-mutation-verifier.ts";
import { type ExternalSpecGitScope, externalSpecGitScope, withExternalSpecTreeReadOnly } from "./external-spec-git.ts";
import type { IntentPipelineHandoff } from "./intent-output.ts";
import { configuredIntentDurableDir, listLandedIntentFiles } from "./intent-output.ts";
import { deriveIntentRunBodySummary } from "./intent-run-body-summary.ts";
import type { InvocationFailureDetail } from "./invocation-failure.ts";
import { landPublication, type PublicationLanding } from "./publication-landing.ts";
import { publicationFailureFor } from "./publication-retry.ts";
import type { ReadyFinalizer } from "./ready-finalize.ts";
import {
  isResumableOutOfScopeTerminalEvidence,
  nonTerminatingMutationLogFields,
  outOfScopeSettlementResumable,
  ReadyGateError,
  readyGateFailureLogFields,
  readyGateOutOfScopeLogFields,
  SurvivingMutationError,
  survivingMutationLogFields,
} from "./ready-finalize.ts";
import { excludeVerdictFromStaging, VERDICT_FILE } from "./review-intent-enforcement.ts";
import { lintReviewedStagedMarkdownOrFail } from "./reviewed-staged-markdown-lint.ts";
import { resolvePublicationTitle } from "./spec-creation-title.ts";
import { deriveSpecRunBodySummary } from "./spec-run-body-summary.ts";
import { lintStagedMarkdown } from "./staged-markdown-lint.ts";
import type { WorkflowResult, WorkflowRunnerInput, WriteWorkflowStep } from "./workflow-runner.ts";
import { revalidateStagedPlanContract } from "./workflow-runner-debate-landing.ts";
import {
  appendRuntimeSmokeOutcome,
  DEFAULT_ITERATION_TIMEOUT_MS,
  enforcePersistedReadyGateRepairFence,
  exhaustedRedTerminalLogFields,
  getUncommittedPaths,
  hasRetainedFinalizationCheckpoint,
  isExhaustedRedTerminalEvidence,
  MAX_MUTATION_REPAIR_ATTEMPTS,
  type PersistedRepairFenceEnforcer,
  publishWithReadyRepair,
  runMutationRepairIteration,
  type WriteLoopInput,
  type WriteLoopOutcomeKind,
  type WriteLoopResult,
} from "./write-loop.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";

export const EXTRACTED_FROM_WORKFLOW_RUNNER = [
  "recoverPlanStage",
  "resumePopulatedIntentPublication",
  "resumeReviewMutationFinalization",
  "landReviewedPublicationOutput",
  "settlePublicationResumeFailure",
  "resolveReviewMutationRowHead",
  "admitPlanRecoveryBlockerAndClaim",
  "restoreVerdictSidecars",
  "settleIntentResumeStagedMarkdownLintFailure",
  "inertResumeWriteLoopInput",
  "mutationRepairLoopInput",
  "settleSuccessfulReviewMutationPublication",
] as const;

type WorkflowRunnerResumeInjectedDeps = {
  persistIntentHandoff: (
    store: StateStore,
    landing: PublicationLanding | undefined,
    handoff: IntentPipelineHandoff,
    project: string,
    branch: string,
    writeTarget: string | { reviewRunId: string },
  ) => void;
  recordIntentFinalization: (
    logSink: LogSink | undefined,
    runId: string,
    phase: IntentFinalizationEvent["phase"],
    branch: string,
    stopReason?: string,
  ) => void;
  reviewCompletionAgent: (run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>) => string | undefined;
  reviewCompletionPass: (run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>) => number | undefined;
  settleReviewedStagedMarkdownLintFailure: (
    store: StateStore,
    attemptId: string,
    runId: string,
    iterationsConsumed: number,
    resumable: boolean,
    logSink?: LogSink,
  ) => void;
  executeWorkflow: (input: WorkflowRunnerInput) => Promise<WorkflowResult>;
};

let workflowRunnerResumeInjected: WorkflowRunnerResumeInjectedDeps | undefined;

export function wireWorkflowRunnerResumeDeps(deps: WorkflowRunnerResumeInjectedDeps): void {
  workflowRunnerResumeInjected = deps;
}

function resumeInjected(): WorkflowRunnerResumeInjectedDeps {
  if (workflowRunnerResumeInjected === undefined) {
    throw new Error("workflow-runner resume deps are not wired");
  }
  return workflowRunnerResumeInjected;
}

type WorkflowPublicationFailureKind =
  | "completion_commit_failed"
  | "ready_gate_failed"
  | "ready_gate_command_missing"
  | "ready_gate_out_of_scope"
  | "ready_flip_failed"
  | "surviving_mutation_failed"
  | "non_terminating_mutation_failed"
  | "runtime_smoke_failed";

function terminalFailureDetailFromError(error?: Error, fallbackMessage?: string): InvocationFailureDetail {
  const message = error?.message || fallbackMessage || "harness failure";
  return { failureKind: "error", bindingAttempts: [], message };
}

function readyGateTerminalFailureDetail(error?: Error): InvocationFailureDetail {
  if (error instanceof ReadyGateError) {
    const output = error.output.trim().slice(-4096);
    const message =
      output.length > 0 ? `ready gate failed (exit ${String(error.exitCode ?? "unknown")}): ${output}` : error.command;
    return { failureKind: "error", bindingAttempts: [], message };
  }
  return terminalFailureDetailFromError(error, "ready gate failed");
}

function completionBoundarySettlementFields(
  terminalCause: WriteLoopOutcomeKind,
  terminalFailureDetail?: InvocationFailureDetail,
): {
  terminalCause: WriteLoopOutcomeKind;
  terminalFailureDetail?: InvocationFailureDetail;
} {
  return {
    terminalCause,
    ...(terminalFailureDetail !== undefined ? { terminalFailureDetail } : {}),
  };
}

export function workflowPublicationFailureTerminalDetail(
  kind: WorkflowPublicationFailureKind,
  error?: Error,
): InvocationFailureDetail | undefined {
  if (kind === "surviving_mutation_failed" || kind === "non_terminating_mutation_failed") {
    return terminalFailureDetailFromError(error);
  }
  if (kind === "ready_gate_failed" || kind === "ready_gate_command_missing" || kind === "ready_gate_out_of_scope") {
    return readyGateTerminalFailureDetail(error);
  }
  if (kind === "runtime_smoke_failed") return terminalFailureDetailFromError(error, "runtime smoke failed");
  if (kind === "ready_flip_failed") return terminalFailureDetailFromError(error, "ready flip failed");
  if (kind === "completion_commit_failed") {
    return terminalFailureDetailFromError(error, error?.message ?? "completion commit failed");
  }
  return undefined;
}

function traceCompletionPublication(
  logSink: LogSink | undefined,
  runId: string,
  landing: WriteWorkflowStep["landing"],
  branch: string,
  stopReason?: string,
): void {
  if (landing?.kind !== "intent-stage") return;
  resumeInjected().recordIntentFinalization(logSink, runId, "completion_publication", branch, stopReason);
}

function remainingStagedIntentPaths(worktreePath: string, landing: WriteWorkflowStep["landing"]): string[] {
  if (landing?.kind !== "intent-stage") return [];
  const stagingDir = resolve(worktreePath, landing.stagingDir);
  if (!existsSync(stagingDir)) return [];
  try {
    return readdirSync(stagingDir).map((name) => join(landing.stagingDir, name));
  } catch {
    return [];
  }
}

function isReviewLandingRecoveryAttempt(lastAttempt: Attempt | undefined): boolean {
  if (lastAttempt === undefined) return false;
  if (lastAttempt.outcomeKind === "landing_failed") return true;
  return (
    lastAttempt.outcomeKind === "invocation_failure" && lastAttempt.invocationFailureDetail?.failureKind === "landing"
  );
}
/** Restore the verdict sidecar files a failed promotion attempt removed before landing. */
function restoreVerdictSidecars(
  verdictPath: string,
  verdict: string | undefined,
  ownerPath: string,
  owner: string | undefined,
): void {
  if (verdict !== undefined) writeFileSync(verdictPath, verdict, "utf8");
  if (owner !== undefined) writeFileSync(ownerPath, owner, "utf8");
}

/**
 * Both landing kinds exclude their reserved verdict from staging before landing: durable output
 * is never more than the durable-file allowlist (`index.md`/`intent.md`/index-linked numbered
 * subspecs for plan-tree; sanitized files for intent-stage) — the verdict, its ownership marker,
 * and any staging backup are never published. This is the one promotion + verdict-cleanup entry
 * shared by every review-landing call site (light review, review-debate, and the non-durable
 * profile review path); it always runs regardless of whether the review step's actuator ran.
 * Returns `{ ok: true, specPath }` on success or `{ ok: false, message }` on failure.
 */
export async function landReviewedPublicationOutput(
  worktreePath: string,
  deferred: Exclude<PublicationLanding, { kind: "none" }>,
  verdictPath: string,
  trace?: {
    logSink: LogSink | undefined;
    runId: string;
    branch: string;
    persistHandoff?: {
      store: StateStore;
      project: string;
      branch: string;
      writeTarget: string | { reviewRunId: string };
    };
  },
): Promise<{ ok: true; specPath: string } | { ok: false; message: string }> {
  const ownerPath = `${verdictPath}.owner`;
  const verdict = existsSync(verdictPath) ? readFileSync(verdictPath, "utf8") : undefined;
  const owner = existsSync(ownerPath) ? readFileSync(ownerPath, "utf8") : undefined;
  try {
    excludeVerdictFromStaging(resolve(worktreePath, deferred.stagingDir), verdictPath);
    if (owner !== undefined) {
      rmSync(ownerPath, { force: true });
    }
    const result = await landPublication(deferred, worktreePath);
    if (trace?.persistHandoff) {
      resumeInjected().persistIntentHandoff(
        trace.persistHandoff.store,
        deferred,
        result,
        trace.persistHandoff.project,
        trace.persistHandoff.branch,
        trace.persistHandoff.writeTarget,
      );
    }
    if (trace) resumeInjected().recordIntentFinalization(trace.logSink, trace.runId, "review_landing", trace.branch);
    return { ok: true, specPath: result.specPath };
  } catch (error) {
    restoreVerdictSidecars(verdictPath, verdict, ownerPath, owner);
    const message = errorMessage(error);
    if (trace)
      resumeInjected().recordIntentFinalization(trace.logSink, trace.runId, "review_landing", trace.branch, message);
    return { ok: false, message };
  }
}
const INTENT_STAGE_DIR = ".jarvis-intent-stage";

/** Reconstructed context for resuming a review-behavior step's populated-stage `landing_failed` row. */
type IntentFinalizationResumeContext = {
  runId: string;
  worktreePath: string;
  project: string;
  branch: string;
  baseRef: string;
  invocationId: string;
  durableDir: string;
  verdictPath: string;
  landing: Extract<PublicationLanding, { kind: "intent-stage" }>;
  completionAgent: string | undefined;
  creationTitleHint: string | undefined;
  behavior: "review" | "review-debate";
  reviewPass: number | undefined;
};

type IntentFinalizationResumeResolution =
  | { ok: true; context: IntentFinalizationResumeContext }
  | { ok: false; message: string };

/** The durable write step's snapshot entry is the only one carrying no `behavior` field. */
function findDurableWriteStepId(steps: readonly WorkflowSnapshotStep[]): string | undefined {
  return steps.find((step) => step.behavior === undefined)?.stepId;
}

/** Latest attempt completion timestamp on a row, or `undefined` when no attempt has completed. */
function latestAttemptCompletedAt(run: { attempts: readonly Attempt[] }): number | undefined {
  let latest: number | undefined;
  for (const attempt of run.attempts) {
    if (attempt.completedAt === null) continue;
    if (latest === undefined || attempt.completedAt > latest) latest = attempt.completedAt;
  }
  return latest;
}

/**
 * Resolves the durable write step's completed sibling row for a review-behavior row's finalization
 * resume: an exact match on the authored write stepId, or a completed `<writeStepId>~link-N` row
 * left by a linked-implement workflow's terminal pass. Candidates are scoped to the review row's own
 * `(project, branch)` and to completed rows within the same workflow invocation; among ties, the
 * candidate with the latest attempt-completion timestamp wins, with the row id as a stable
 * tie-breaker. Returns `undefined` when no admissible candidate exists.
 */
function resolveDurableWriteSiblingRun(
  run: { project: string; branch: string },
  store: StateStore,
  snapshot: WorkflowSnapshot,
  writeStepId: string,
): (Run & { attempts: Attempt[] }) | undefined {
  const candidateIds = store
    .findRunsByInvocationId(snapshot.invocationId)
    .filter(
      (candidate) =>
        candidate.project === run.project &&
        candidate.branch === run.branch &&
        isWriteSiblingStepId(candidate.stepId, writeStepId),
    )
    .map((candidate) => candidate.id);

  let selected: (Run & { attempts: Attempt[] }) | undefined;
  let selectedCompletedAt = -Infinity;
  for (const id of candidateIds) {
    const candidate = store.loadRun(id);
    if (!candidate || candidate.status !== "completed") continue;
    // Some completed rows never recorded an attempt boundary (status set directly); `createdAt`
    // is always present and keeps such a row eligible without pretending it has a real completion time.
    const completedAt = latestAttemptCompletedAt(candidate) ?? candidate.createdAt;
    if (
      selected === undefined ||
      completedAt > selectedCompletedAt ||
      (completedAt === selectedCompletedAt && candidate.id > selected.id)
    ) {
      selected = candidate;
      selectedCompletedAt = completedAt;
    }
  }
  return selected;
}

/** Reconstructed head shared by every review-behavior-row resume resolver. */
type ReviewRowHead = {
  snapshot: WorkflowSnapshot;
  writeStep: WorkflowSnapshotStep | undefined;
  writeRun: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>;
  completionAgent: string | undefined;
  behavior: "review" | "review-debate";
  reviewPass: number | undefined;
};

type ReviewRowHeadResolution = { ok: true; head: ReviewRowHead } | { ok: false; message: string };

/**
 * Shared admission head for review-behavior-row finalization resume: the row must be a failed
 * review/review-debate step, and its sibling durable write step's own row must exist — the only
 * row carrying the resolved `specPath` and a fallback completion agent. Used by the populated-intent
 * `landing_failed` path only; the review-mutation tail uses {@link resolveReviewMutationRowHead}
 * instead, which applies stricter, tail-specific admission.
 */
function resolveReviewRowHead(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
  store: StateStore,
): ReviewRowHeadResolution {
  const snapshot = run.workflowSnapshot;
  const stepId = run.stepId;
  const step = snapshot?.steps.find((candidate) => candidate.stepId === stepId);
  if (!snapshot || !stepId || !step || (step.behavior !== "review" && step.behavior !== "review-debate")) {
    return { ok: false, message: "run is not a review-behavior step" };
  }
  if (run.status !== "failed") return { ok: false, message: "run is not in a failed state" };
  const writeStepId = findDurableWriteStepId(snapshot.steps);
  const writeRun = writeStepId
    ? store.findRunByProjectBranch({ project: run.project, branch: run.branch, stepId: writeStepId })
    : null;
  if (!writeRun) return { ok: false, message: "durable write step row not found" };
  const writeStep = snapshot.steps.find((candidate) => candidate.stepId === writeStepId);
  const completionAgent =
    resumeInjected().reviewCompletionAgent(run) ??
    resumeInjected().reviewCompletionAgent(writeRun) ??
    writeStep?.agents?.[0];
  const reviewPass = resumeInjected().reviewCompletionPass(run);
  return { ok: true, head: { snapshot, writeStep, writeRun, completionAgent, behavior: step.behavior, reviewPass } };
}

/** Durable source for a resume's stamped `fixCommand`/`readyCommand`: the write row's `queuedInput`
 * (direct writes) first, then the workflow snapshot's write step (workflow rows). Never the
 * default machine-config path — a pipeline admitted under a scoped config stamped these at dispatch. */
type WriteSiblingCommandSource = {
  queuedInput?: WriteLoopInput;
  snapshotStep?: WorkflowSnapshotStep;
};

function snapshotStepHasGateCommands(step: WorkflowSnapshotStep | undefined): boolean {
  return step?.fixCommand !== undefined || step?.readyCommand !== undefined;
}

/** Reconstruct stamped gate commands for resume tails; review rows prefer their own snapshot step. */
export function resolveWriteSiblingCommandSource(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
  store: StateStore,
): WriteSiblingCommandSource | undefined {
  const snapshot = run.workflowSnapshot;
  const ownStep = snapshot?.steps.find((candidate) => candidate.stepId === run.stepId);
  if (ownStep && ownStep.behavior !== "review" && ownStep.behavior !== "review-debate") {
    return {
      ...(run.queuedInput != null ? { queuedInput: run.queuedInput } : {}),
      snapshotStep: ownStep,
    };
  }
  if (
    ownStep &&
    (ownStep.behavior === "review" || ownStep.behavior === "review-debate") &&
    snapshotStepHasGateCommands(ownStep)
  ) {
    return {
      ...(run.queuedInput != null ? { queuedInput: run.queuedInput } : {}),
      snapshotStep: ownStep,
    };
  }
  const writeStepId = snapshot ? findDurableWriteStepId(snapshot.steps) : undefined;
  const writeRun = writeStepId
    ? store.findRunByProjectBranch({ project: run.project, branch: run.branch, stepId: writeStepId })
    : null;
  if (!writeRun) return undefined;
  const snapshotStep = snapshot?.steps.find((candidate) => candidate.stepId === writeStepId);
  return {
    ...(writeRun.queuedInput != null ? { queuedInput: writeRun.queuedInput } : {}),
    ...(snapshotStep !== undefined ? { snapshotStep } : {}),
  };
}

/**
 * Admission head for the review-mutation resume tail only: the row must be a *durable*, failed
 * review/review-debate step — a non-durable light review sharing that stepId is not a recovery
 * target — and its completed durable write-step sibling row must be resolvable within the same
 * workflow invocation (see {@link resolveDurableWriteSiblingRun}), which carries the resolved
 * `specPath` and a fallback completion agent. Deliberately not shared with
 * {@link resolveIntentFinalizationResumeContext}: that path's admission must stay on its
 * pre-existing behavior.
 */
function resolveReviewMutationRowHead(run: Run, store: StateStore): ReviewRowHeadResolution {
  const snapshot = run.workflowSnapshot;
  const stepId = run.stepId;
  const step = snapshot?.steps.find((candidate) => candidate.stepId === stepId);
  if (
    !snapshot ||
    !stepId ||
    !step ||
    (step.behavior !== "review" && step.behavior !== "review-debate") ||
    step.durable === false
  ) {
    return { ok: false, message: "run is not a review-behavior step" };
  }
  if (run.status !== "failed") return { ok: false, message: "run is not in a failed state" };
  const writeStepId = findDurableWriteStepId(snapshot.steps);
  const writeRun = writeStepId ? resolveDurableWriteSiblingRun(run, store, snapshot, writeStepId) : undefined;
  if (!writeRun) return { ok: false, message: "durable write step row not found" };
  const writeStep = snapshot.steps.find((candidate) => candidate.stepId === writeStepId);
  const completionAgent = resumeInjected().reviewCompletionAgent(writeRun) ?? writeStep?.agents?.[0];
  // The review-mutation resume tail commits ahead of re-verification unclassified (default
  // `write`), so this head never carries a reviewPass regardless of the row's own.
  return {
    ok: true,
    head: { snapshot, writeStep, writeRun, completionAgent, behavior: step.behavior, reviewPass: undefined },
  };
}

/** True when `.jarvis-intent-stage/` exists under `worktreePath` and holds at least one file. */
function hasPopulatedIntentStage(worktreePath: string): boolean {
  const stageDir = join(worktreePath, INTENT_STAGE_DIR);
  if (!existsSync(stageDir)) return false;
  try {
    return readdirSync(stageDir, { withFileTypes: true }).some((entry) => entry.isFile());
  } catch {
    return false;
  }
}

const PLAN_STAGE_DIR = ".jarvis-plan-stage";

/** True when `.jarvis-plan-stage/` exists under `worktreePath` and holds at least one file. */
function hasPopulatedPlanStage(worktreePath: string): boolean {
  const stageDir = join(worktreePath, PLAN_STAGE_DIR);
  if (!existsSync(stageDir)) return false;
  try {
    return readdirSync(stageDir, { withFileTypes: true }).some((entry) => entry.isFile());
  } catch {
    return false;
  }
}

/** Reason codes an operator recovery request refuses admission with. */
type PlanStageRecoveryRefusalCode =
  | "missing_plan_context"
  | "stage_identity_mismatch"
  | "unrelated_plan_stage"
  | "recovery_requires_git"
  | "operator_blocker"
  | "plan_stage_invalid";

/** True when a terminal failed review row's last attempt admits completed-write plan recovery. */
function isAdmittedReviewFailedPlanRecoveryOutcome(lastAttempt: Attempt | undefined): boolean {
  if (lastAttempt === undefined) return false;
  const outcomeKind = lastAttempt.outcomeKind;
  if (outcomeKind === "idle_output_timeout") return true;
  if (outcomeKind === "invocation_failure") {
    return lastAttempt.invocationFailureDetail?.failureKind !== "landing";
  }
  return false;
}

function hasStagedPlanOperatorBlocker(worktreePath: string): boolean {
  const intentPath = join(worktreePath, PLAN_STAGE_DIR, "intent.md");
  if (!existsSync(intentPath)) return false;
  return extractBlockerBody(readFileSync(intentPath, "utf8")) !== undefined;
}

function hasLivePlanRecoveryWorktreeClaim(
  store: StateStore,
  project: string,
  branch: string,
  excludedRunIds: ReadonlySet<string>,
): boolean {
  if (store.hasQueuedRun({ project, branch })) return true;
  for (const candidate of store.listRuns()) {
    if (candidate.project !== project || candidate.branch !== branch) continue;
    if (excludedRunIds.has(candidate.id)) continue;
    if (
      candidate.status === "in-progress" ||
      candidate.status === "paused" ||
      candidate.status === "budget-soft-stopped"
    ) {
      return true;
    }
  }
  return false;
}

function resolveFailedPlanReviewSiblingRun(
  writeRun: Run & { attempts: Attempt[] },
  store: StateStore,
  capturedReviewStepIds: readonly string[],
): (Run & { attempts: Attempt[] }) | undefined {
  const snapshot = writeRun.workflowSnapshot;
  if (!snapshot) return undefined;
  const stepIds =
    capturedReviewStepIds.length > 0
      ? capturedReviewStepIds
      : snapshot.steps
          .filter((step) => step.behavior === "review" || step.behavior === "review-debate")
          .map((step) => step.stepId);

  let selected: (Run & { attempts: Attempt[] }) | undefined;
  let selectedCompletedAt = -Infinity;
  for (const stepId of stepIds) {
    const reviewRun = store.findRunByProjectBranch({
      project: writeRun.project,
      branch: writeRun.branch,
      stepId,
    });
    if (!reviewRun || reviewRun.status !== "failed") continue;
    if (reviewRun.workflowSnapshot?.invocationId !== snapshot.invocationId) continue;
    const lastAttempt = reviewRun.attempts.at(-1);
    if (!isAdmittedReviewFailedPlanRecoveryOutcome(lastAttempt)) continue;
    const completedAt = latestAttemptCompletedAt(reviewRun) ?? reviewRun.createdAt;
    if (
      selected === undefined ||
      completedAt > selectedCompletedAt ||
      (completedAt === selectedCompletedAt && reviewRun.id > selected.id)
    ) {
      selected = reviewRun;
      selectedCompletedAt = completedAt;
    }
  }
  return selected;
}

function isBlockedPlanWriteRecoveryCandidate(
  run: Run & { attempts: Attempt[] },
  writeStep: WorkflowSnapshotStep | undefined,
): boolean {
  const lastAttempt = run.attempts.at(-1);
  const outcomeKind = lastAttempt?.outcomeKind ?? null;
  return (
    run.status === "blocked" &&
    (outcomeKind === "contract_miss" || outcomeKind === "blocked") &&
    writeStep?.expectedArtifactPath === PLAN_STAGE_DIR
  );
}

function isReviewFailedPlanWriteRecoveryCandidate(
  run: Run & { attempts: Attempt[] },
  writeStep: WorkflowSnapshotStep | undefined,
  store: StateStore,
  capturedReviewStepIds: readonly string[],
): boolean {
  if (run.status !== "completed" || writeStep?.expectedArtifactPath !== PLAN_STAGE_DIR) return false;
  return resolveFailedPlanReviewSiblingRun(run, store, capturedReviewStepIds) !== undefined;
}

/** Whether a pipeline-linked plan entry run is recoverable through `recoverPlanStage`. */
export function isPlanStageEntryRunRecoverable(
  entryRun: Run & { attempts: Attempt[] },
  store: StateStore,
  reviewStepId: string,
): boolean {
  const writeStep = entryRun.workflowSnapshot?.steps.find((candidate) => candidate.stepId === entryRun.stepId);
  if (entryRun.status !== "blocked" && entryRun.status !== "completed") return true;
  return (
    isBlockedPlanWriteRecoveryCandidate(entryRun, writeStep) ||
    isReviewFailedPlanWriteRecoveryCandidate(entryRun, writeStep, store, [reviewStepId])
  );
}

/**
 * Names one stopped plan run to recover: the run identified by `runId` must still resolve to
 * the persisted `(project, branch, worktreePath, writeStepId)` relationship captured for that
 * attempt. `recoveryLanding` carries only the durable review identity and plan-tree paths needed
 * to land the on-disk staged tree directly; recovery never reconstructs or dispatches a workflow.
 */
export type PlanStageRecoveryLanding = {
  stepId: string;
  behavior: "review" | "review-debate";
  verdictPath: string;
  landing: Extract<PublicationLanding, { kind: "plan-tree" }>;
};

export type PlanStageRecoveryRequest = Omit<WorkflowRunnerInput, "steps"> & {
  runId: string;
  project: string;
  branch: string;
  worktreePath: string;
  writeStepId: string;
  recoveryLanding: PlanStageRecoveryLanding;
  stateStore: StateStore;
};

export type PlanStageRecoveryOutcome =
  | ({ ok: true } & WorkflowResult)
  | { ok: false; code: PlanStageRecoveryRefusalCode; message: string };

/** Exact template `appendBlockerToSpec` (write-loop.ts) writes for a `plan.prompt.draft` contract miss. */
function harnessPlanBlockerText(reason: string): string {
  return `\n## Blocker\n\nArtifact contract check failed: ${reason}\n`;
}

/** The `contract_miss_detail` reason persisted for this run's last attempt, if any. */
function capturedPlanContractMissReason(logSink: LogSink | undefined, runId: string): string | undefined {
  const records = priorLogRecordsFromSink(logSink, runId);
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const event = records[i]?.event;
    if (event?.kind === "contract_miss_detail") {
      return event.failureReason ?? event.failedContractId;
    }
  }
  return undefined;
}

type PlanBlockerProvenance = { kind: "none" } | { kind: "harness"; text: string } | { kind: "operator" };

/**
 * Classifies the trailing `## Blocker` (if any) in the staged `intent.md` of a stopped
 * plan-draft attempt. Only a `contract_miss` attempt can carry harness-authored metadata — the
 * harness never appends a blocker for a `blocked` outcome, that text is always agent-authored.
 * Harness authorship requires an exact, trailing match against the template rebuilt from this
 * run's own captured `contract_miss_detail` reason; anything else (missing reason, changed body,
 * non-trailing placement) is treated as operator-authored.
 */
function resolvePlanBlockerProvenance(
  worktreePath: string,
  outcomeKind: OutcomeKind | null,
  logSink: LogSink | undefined,
  runId: string,
): PlanBlockerProvenance {
  const intentPath = join(worktreePath, PLAN_STAGE_DIR, "intent.md");
  if (!existsSync(intentPath)) return { kind: "none" };
  const content = readFileSync(intentPath, "utf8");
  if (extractBlockerBody(content) === undefined) return { kind: "none" };
  if (outcomeKind !== "contract_miss") return { kind: "operator" };
  const reason = capturedPlanContractMissReason(logSink, runId);
  if (reason === undefined) return { kind: "operator" };
  const expected = harnessPlanBlockerText(reason);
  return content.endsWith(expected) ? { kind: "harness", text: expected } : { kind: "operator" };
}

/**
 * Commits a recovered plan-tree landing's durable output. `executeWorkflow`'s ordinary completion
 * tail attributes and commits publication against a paired write step's row, which recovery never
 * constructs. This reuses the identical commit primitive (`createCompletionCommitter`, the same
 * one the ordinary tail calls) so recovered and ordinary plan publication share one commit
 * construction and one durable-file allowlist (`planFiles`); recovery just supplies its own
 * attribution since it has no write-step row to read it from. Recovery never dispatches the
 * review step, so its row (if any) never carries a completion agent; `fallbackAgent` — the
 * captured plan-draft step's configured agent — attributes the commit instead.
 */
async function commitRecoveredPlanLanding(
  context: {
    worktreePath: string;
    project: string;
    branch: string;
    baseRef: string;
    durablePath: string;
    stepId: string;
    behavior: "review" | "review-debate";
    fallbackAgent: string | undefined;
  },
  store: StateStore,
  completionCommitter: CompletionCommitter | undefined,
): Promise<{ kind: "complete"; commitSha?: string } | { kind: "completion_commit_failed"; message: string }> {
  const reviewRun = store.findRunByProjectBranch({
    project: context.project,
    branch: context.branch,
    stepId: context.stepId,
  });
  const agent = (reviewRun ? resumeInjected().reviewCompletionAgent(reviewRun) : undefined) ?? context.fallbackAgent;
  if (agent === undefined) {
    return {
      kind: "completion_commit_failed",
      message: "no completion agent available to attribute the publication commit",
    };
  }
  const reviewPass = reviewRun ? resumeInjected().reviewCompletionPass(reviewRun) : undefined;
  const commitStep: CompletionStepMetadata | undefined =
    reviewPass !== undefined ? { kind: context.behavior, pass: reviewPass } : undefined;
  const title = resolvePublicationTitle(context.worktreePath, context.durablePath);
  if (reviewRun) store.setCreationTitle(reviewRun.id, title);
  try {
    const published = await (completionCommitter ?? createCompletionCommitter())({
      worktreePath: context.worktreePath,
      baseRef: context.baseRef,
      specPath: context.durablePath,
      agent,
      title: commitStep !== undefined ? renderStepCommitTitle(commitStep, title) : title,
      iterationTimeoutMs: DEFAULT_ITERATION_TIMEOUT_MS,
      ...(commitStep !== undefined ? { step: commitStep } : {}),
    });
    if (published.commitSha === undefined) {
      const uncommitted = await getUncommittedPaths(context.worktreePath);
      if (uncommitted.length > 0) {
        return { kind: "completion_commit_failed", message: `Uncommitted changes: ${uncommitted.join(", ")}` };
      }
    }
    return { kind: "complete", ...(published.commitSha !== undefined ? { commitSha: published.commitSha } : {}) };
  } catch (error) {
    return {
      kind: "completion_commit_failed",
      message: errorMessage(error),
    };
  }
}

/**
 * Recovers a stopped `contract_miss`/`blocked` plan-draft run whose staged subspec was
 * hand-corrected, without redrafting: verifies the run identified by `runId` still identifies
 * the captured `(project, branch, worktreePath, writeStepId)` checkout and a populated
 * `.jarvis-plan-stage/`, admits it independently of `resumable`, validates the on-disk staged
 * tree, strips only a proven harness-authored blocker, then lands it directly via
 * {@link landReviewedPublicationOutput} — no review/actuator role runs between validation and
 * landing, so nothing can mutate the operator's correction — and, once landing completes,
 * commits the durable output via {@link commitRecoveredPlanLanding}.
 */
/** Admission-time blocker/claim checks for the two plan-recovery paths; returns a refusal outcome or `undefined` to proceed. */
function admitPlanRecoveryBlockerAndClaim(
  run: Run & { attempts: Attempt[] },
  store: StateStore,
  request: PlanStageRecoveryRequest,
  reviewFailedPath: boolean,
  capturedReviewStepIds: string[],
): PlanStageRecoveryOutcome | undefined {
  if (reviewFailedPath) {
    const evidenceReview = resolveFailedPlanReviewSiblingRun(run, store, capturedReviewStepIds);
    if (evidenceReview === undefined) {
      return { ok: false, code: "unrelated_plan_stage", message: "no recoverable populated plan stage for this run" };
    }
    if (hasStagedPlanOperatorBlocker(run.worktreePath)) {
      return { ok: false, code: "operator_blocker", message: "staged plan carries an operator-authored blocker" };
    }
    const excludedRunIds = new Set([run.id, evidenceReview.id]);
    if (hasLivePlanRecoveryWorktreeClaim(store, run.project, run.branch, excludedRunIds)) {
      return {
        ok: false,
        code: "unrelated_plan_stage",
        message: "a live run holds the worktree claim for this branch",
      };
    }
    return undefined;
  }
  const lastAttempt = run.attempts.at(-1);
  const outcomeKind = lastAttempt?.outcomeKind ?? null;
  const provenance = resolvePlanBlockerProvenance(run.worktreePath, outcomeKind, request.logSink, run.id);
  if (provenance.kind === "operator") {
    return { ok: false, code: "operator_blocker", message: "staged plan carries an operator-authored blocker" };
  }
  return undefined;
}

/** Removes a provenance-proven harness blocker after staged-tree validation admits recovery. */
function stripHarnessPlanBlocker(run: Run & { attempts: Attempt[] }, provenance: PlanBlockerProvenance): void {
  if (provenance.kind === "harness") {
    const intentPath = join(run.worktreePath, PLAN_STAGE_DIR, "intent.md");
    const content = readFileSync(intentPath, "utf8");
    writeFileSync(intentPath, content.slice(0, content.length - provenance.text.length), "utf8");
  }
}

/** Lints the admitted bytes with a proven harness blocker omitted, without mutating the staged tree. */
async function lintPlanRecoveryStage(
  worktreePath: string,
  provenance: PlanBlockerProvenance,
): ReturnType<typeof lintStagedMarkdown> {
  if (provenance.kind !== "harness") {
    return lintStagedMarkdown(PLAN_STAGE_DIR, { worktreePath });
  }
  // The copy lives outside the worktree: this path only validates, and the worktree is an arbitrary
  // target project that may not ignore `.scratch/` — or may already have a *file* there, which made
  // `mkdirSync` throw `ENOTDIR` and surface as an opaque error instead of `plan_stage_invalid`.
  // Lint config is resolved from the harness root and passed with an explicit `--config`, so the
  // copy's location does not affect which rules run. Matches the tmpdir convention used by the
  // base-ref probe, review backup, and smoke verifier.
  const lintWorktree = mkdtempSync(join(tmpdir(), "jarvis-plan-recovery-lint-"));
  try {
    const lintStage = join(lintWorktree, PLAN_STAGE_DIR);
    cpSync(join(worktreePath, PLAN_STAGE_DIR), lintStage, { recursive: true });
    const intentPath = join(lintStage, "intent.md");
    const content = readFileSync(intentPath, "utf8");
    writeFileSync(intentPath, content.slice(0, content.length - provenance.text.length), "utf8");
    return await lintStagedMarkdown(PLAN_STAGE_DIR, { worktreePath: lintWorktree });
  } finally {
    rmSync(lintWorktree, { recursive: true, force: true });
  }
}

export async function recoverPlanStage(request: PlanStageRecoveryRequest): Promise<PlanStageRecoveryOutcome> {
  const store = request.stateStore;
  const run = store.loadRun(request.runId);
  if (!run?.workflowSnapshot || !run.stepId) {
    return { ok: false, code: "missing_plan_context", message: "no persisted plan context for this run" };
  }
  if (
    run.project !== request.project ||
    run.branch !== request.branch ||
    run.worktreePath !== request.worktreePath ||
    run.stepId !== request.writeStepId
  ) {
    return {
      ok: false,
      code: "stage_identity_mismatch",
      message: "captured plan context does not match the persisted run",
    };
  }
  const writeStep = run.workflowSnapshot.steps.find((candidate) => candidate.stepId === run.stepId);
  const landingStep = request.recoveryLanding;
  if (landingStep === undefined || landingStep.landing?.kind !== "plan-tree") {
    return {
      ok: false,
      code: "missing_plan_context",
      message: "no plan-tree landing captured for recovery",
    };
  }
  const capturedReviewStepIds = [landingStep.stepId];
  const reviewFailedPath = isReviewFailedPlanWriteRecoveryCandidate(run, writeStep, store, capturedReviewStepIds);
  const blockedWritePath = isBlockedPlanWriteRecoveryCandidate(run, writeStep);
  if ((!blockedWritePath && !reviewFailedPath) || !hasPopulatedPlanStage(run.worktreePath)) {
    return { ok: false, code: "unrelated_plan_stage", message: "no recoverable populated plan stage for this run" };
  }
  if (!existsSync(join(run.worktreePath, ".git"))) {
    return {
      ok: false,
      code: "recovery_requires_git",
      message: "plan-stage recovery requires Git-backed publication mode",
    };
  }
  const blockerAdmission = admitPlanRecoveryBlockerAndClaim(
    run,
    store,
    request,
    reviewFailedPath,
    capturedReviewStepIds,
  );
  if (blockerAdmission) return blockerAdmission;
  const blockerProvenance = resolvePlanBlockerProvenance(
    run.worktreePath,
    run.attempts.at(-1)?.outcomeKind ?? null,
    request.logSink,
    run.id,
  );

  // Validate the on-disk staged tree before landing: an operator correction never trusted past
  // admission. No agent role runs between this check and landing, so it never needs repeating.
  const stagingDir = join(run.worktreePath, PLAN_STAGE_DIR);
  const contract = revalidateStagedPlanContract(stagingDir);
  if (!contract.ok) {
    return { ok: false, code: "plan_stage_invalid", message: contract.reason };
  }
  const lint = await lintPlanRecoveryStage(run.worktreePath, blockerProvenance);
  if (lint.kind === "violation") {
    return { ok: false, code: "plan_stage_invalid", message: `${lint.ruleId}: ${lint.message} (${lint.filePath})` };
  }
  if (lint.kind === "invocation_error") {
    return { ok: false, code: "plan_stage_invalid", message: lint.message };
  }

  stripHarnessPlanBlocker(run, blockerProvenance);

  const landed = await landReviewedPublicationOutput(run.worktreePath, landingStep.landing, landingStep.verdictPath);
  if (!landed.ok) {
    return {
      ok: true,
      kind: "invocation_failure",
      stepIndex: 0,
      stepId: landingStep.stepId,
      runId: run.id,
      iterationsConsumed: 0,
      resumable: true,
      invocationFailureMessage: landed.message,
    };
  }
  const commit = await commitRecoveredPlanLanding(
    {
      worktreePath: run.worktreePath,
      project: run.project,
      branch: run.branch,
      baseRef: run.specRef,
      durablePath: landingStep.landing.durablePath,
      stepId: landingStep.stepId,
      behavior: landingStep.behavior,
      fallbackAgent: writeStep?.agents?.[0],
    },
    store,
    request.completionCommitter,
  );
  if (commit.kind === "completion_commit_failed") {
    return {
      ok: true,
      kind: "completion_commit_failed",
      stepIndex: 0,
      stepId: landingStep.stepId,
      runId: run.id,
      iterationsConsumed: 0,
      resumable: true,
      completionCommitError: commit.message,
    };
  }
  return {
    ok: true,
    kind: "complete",
    stepIndex: 0,
    stepId: landingStep.stepId,
    runId: run.id,
    iterationsConsumed: 0,
    resumable: false,
    ...(commit.commitSha !== undefined ? { commitSha: commit.commitSha } : {}),
  };
}

/** Refusal reason when the persisted write step predates seed-consumption recording; publishing would strand the seed. */
export const INTENT_RESUME_LANDING_INPUTS_NOT_RECORDED =
  "landing inputs not recorded on the persisted snapshot; re-run the intent";

/**
 * Admission and reconstruction for resuming a review-behavior step's `landing_failed` row without
 * re-entering review: requires a failed review/review-debate row whose last attempt recorded
 * `landing_failed` or a landing `invocation_failure`, a populated `.jarvis-intent-stage/`, and
 * the sibling durable write step's own row — the only row carrying the resolved `durableDir`
 * (its `specPath`).
 */
export function resolveIntentFinalizationResumeContext(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
  store: StateStore,
): IntentFinalizationResumeResolution {
  const head = resolveReviewRowHead(run, store);
  if (!head.ok) return head;
  const { snapshot, writeStep, writeRun, completionAgent, behavior, reviewPass } = head.head;
  const lastAttempt = run.attempts.at(-1);
  if (!isReviewLandingRecoveryAttempt(lastAttempt)) {
    return { ok: false, message: "run did not fail at landing" };
  }
  if (!hasPopulatedIntentStage(run.worktreePath)) {
    return { ok: false, message: "the intent stage is empty or missing" };
  }
  const landingInputs = writeStep?.landingInputs;
  if (landingInputs === undefined) {
    return { ok: false, message: INTENT_RESUME_LANDING_INPUTS_NOT_RECORDED };
  }

  const configuredDurableDir = configuredIntentDurableDir(run.worktreePath, writeRun.specPath);

  return {
    ok: true,
    context: {
      runId: run.id,
      worktreePath: run.worktreePath,
      project: run.project,
      branch: run.branch,
      baseRef: run.specRef,
      invocationId: snapshot.invocationId,
      durableDir: configuredDurableDir,
      verdictPath: join(run.worktreePath, VERDICT_FILE),
      landing: {
        kind: "intent-stage",
        output: { durableDir: configuredDurableDir },
        stagingDir: INTENT_STAGE_DIR,
        invocationId: snapshot.invocationId,
        baseRef: run.specRef,
        inputs: landingInputs,
      },
      completionAgent,
      creationTitleHint: snapshot.creationTitle,
      behavior,
      reviewPass,
    },
  };
}

type IntentFinalizationResumeOutcome =
  | { ok: true; commitSha?: string; prNumber?: number; prUrl?: string }
  | { ok: false; message: string };

export type IntentFinalizationResumeDeps = {
  logSink?: LogSink;
  completionCommitter?: CompletionCommitter;
  completionPublisher?: CompletionPublisher;
  readyFinalizer?: ReadyFinalizer;
  runFixCommand?: (opts: RunFixCommandOpts) => Promise<void>;
};

function settleIntentResumeStagedMarkdownLintFailure(
  store: StateStore,
  context: IntentFinalizationResumeContext,
  attemptId: string,
  resumable: boolean,
  deps: IntentFinalizationResumeDeps,
): IntentFinalizationResumeOutcome {
  resumeInjected().settleReviewedStagedMarkdownLintFailure(store, attemptId, context.runId, 0, resumable, deps.logSink);
  deps.logSink?.append(context.runId, {
    kind: "loop_finished",
    loopOutcomeKind: "landing_failed",
    iterationsConsumed: 0,
    resumable,
  });
  return { ok: false, message: "staged markdown lint failed" };
}

function intentFinalizationSettlementResumable(store: StateStore, runId: string): boolean {
  const settledRun = store.loadRun(runId);
  if (settledRun === null) return false;
  return resolveIntentFinalizationResumeContext(settledRun, store).ok;
}

type PublicationResumeSettlementPolicy = {
  /** Whether the emitted `loop_finished` is retryable, judged after the boundary commits. */
  resumable: (store: StateStore, runId: string, loopOutcomeKind: WriteLoopOutcomeKind) => boolean;
};

/** Intent finalization: retryable iff the settled run still admits `resumePopulatedIntentPublication`. */
const INTENT_FINALIZATION_RESUME_POLICY: PublicationResumeSettlementPolicy = {
  resumable: (store, runId) => intentFinalizationSettlementResumable(store, runId),
};

/**
 * Settle a publication-resume attempt (intent finalization or review-mutation finalization) as a
 * visible failure — never a silent no-op on an admitted resume. One writer serves both callers so
 * the `resumable` projection cannot re-diverge; the policy owns retryability, the context supplies
 * the trace landing when the caller has one.
 */
function settlePublicationResumeFailure(
  store: StateStore,
  context: { runId: string; branch: string; landing?: WriteWorkflowStep["landing"] },
  attemptId: string,
  loopOutcomeKind: WriteLoopOutcomeKind,
  iterationsConsumed: number,
  message: string,
  logSink: LogSink | undefined,
  policy: PublicationResumeSettlementPolicy,
): { ok: false; message: string } {
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message },
    ...completionBoundarySettlementFields(loopOutcomeKind, terminalFailureDetailFromError(undefined, message)),
  });
  logSink?.append(context.runId, {
    kind: "loop_finished",
    loopOutcomeKind,
    iterationsConsumed,
    resumable: policy.resumable(store, context.runId, loopOutcomeKind),
    ...(loopOutcomeKind === "completion_commit_failed" ? { completionCommitError: message } : {}),
  });
  if (context.landing !== undefined) {
    traceCompletionPublication(
      logSink,
      context.runId,
      context.landing,
      context.branch,
      `${loopOutcomeKind}: ${message}`,
    );
  }
  return { ok: false, message };
}

/** Stub `WriteLoopInput` for `publishWithReadyRepair`: `maxIterations: 0` forbids the agent-driven
 * ready-gate repair branch (no agent bindings exist on resume) so any gate failure surfaces directly. */
function inertResumeWriteLoopInput(
  context: { worktreePath: string; project: string; branch: string; baseRef: string } & ExternalSpecGitScope,
  specPath: string,
  deps: IntentFinalizationResumeDeps,
  landing?: PublicationLanding,
  writeSibling?: WriteSiblingCommandSource,
): WriteLoopInput {
  const fixCommand = writeSibling?.queuedInput?.fixCommand ?? writeSibling?.snapshotStep?.fixCommand;
  const readyCommand = writeSibling?.queuedInput?.readyCommand ?? writeSibling?.snapshotStep?.readyCommand;
  return {
    worktree: {
      projectRoot: context.worktreePath,
      projectName: context.project,
      branchName: context.branch,
      baseRef: context.baseRef,
    },
    specPath,
    stepRules: "",
    expectedArtifactPath: "",
    bindings: [],
    maxIterations: 0,
    ...(fixCommand !== undefined ? { fixCommand } : {}),
    ...(readyCommand !== undefined ? { readyCommand } : {}),
    ...(deps.completionCommitter !== undefined ? { completionCommitter: deps.completionCommitter } : {}),
    ...(deps.completionPublisher !== undefined ? { completionPublisher: deps.completionPublisher } : {}),
    ...(deps.readyFinalizer !== undefined ? { readyFinalizer: deps.readyFinalizer } : {}),
    ...(deps.runFixCommand !== undefined ? { runFixCommand: deps.runFixCommand } : {}),
    ...(deps.logSink !== undefined ? { logSink: deps.logSink } : {}),
    ...(landing !== undefined ? { landing } : {}),
    ...externalSpecGitScope(context),
    ...(context.externalPlanSpec === true ? { externalSpecReadOnly: true as const } : {}),
  };
}

/** Commit the landed `durableDir` and run the shared commit/push/PR publication tail. */
/** Settle a resume failure when the intent-resume committer produced no commit but left named uncommitted paths. */
async function settleIntentResumeUncommittedFailure(
  published: Awaited<ReturnType<CompletionCommitter>>,
  context: IntentFinalizationResumeContext,
  store: StateStore,
  attemptId: string,
  deps: IntentFinalizationResumeDeps,
): Promise<IntentFinalizationResumeOutcome | undefined> {
  if (published.commitSha !== undefined) return undefined;
  const uncommitted = await getUncommittedPaths(context.worktreePath);
  const remainingStaged = remainingStagedIntentPaths(context.worktreePath, context.landing);
  const namedPaths = [...new Set([...uncommitted, ...remainingStaged])];
  if (namedPaths.length === 0) return undefined;
  return settlePublicationResumeFailure(
    store,
    context,
    attemptId,
    "completion_commit_failed",
    0,
    `Uncommitted changes: ${namedPaths.join(", ")}`,
    deps.logSink,
    INTENT_FINALIZATION_RESUME_POLICY,
  );
}

function resumePublicationFailureBoundaryFields(
  failure: NonNullable<Awaited<ReturnType<typeof publishWithReadyRepair>>["failure"]>,
  message: string,
): {
  terminalCause: WriteLoopOutcomeKind;
  terminalFailureDetail?: InvocationFailureDetail;
  invocationFailureDetail?: InvocationFailureDetail;
} {
  const isFlip = failure.kind === "ready_flip_failed";
  const landingDetail = { failureKind: "landing" as const, bindingAttempts: [] as [], message };
  const terminalFailureDetail =
    workflowPublicationFailureTerminalDetail(failure.kind, failure.error) ??
    terminalFailureDetailFromError(failure.error, message);
  return {
    terminalCause: failure.kind,
    terminalFailureDetail,
    ...(isFlip ? {} : { invocationFailureDetail: landingDetail }),
  };
}

function completedPublicationBoundaryFields(success?: { prNumber?: number; prUrl?: string }): {
  terminalCause: "complete";
  prNumber?: number;
  prUrl?: string;
} {
  return {
    terminalCause: "complete",
    ...(success?.prNumber !== undefined ? { prNumber: success.prNumber } : {}),
    ...(success?.prUrl !== undefined ? { prUrl: success.prUrl } : {}),
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: intent-resume commit-and-publish orchestrates commit, terminal settlement, and publication branches in sequence
async function runIntentResumeCommitAndPublish(
  context: IntentFinalizationResumeContext,
  store: StateStore,
  attemptId: string,
  deps: IntentFinalizationResumeDeps,
  writeSibling?: WriteSiblingCommandSource,
): Promise<IntentFinalizationResumeOutcome> {
  const creationTitle = resolvePublicationTitle(context.worktreePath, context.durableDir, context.creationTitleHint);
  store.setCreationTitle(context.runId, creationTitle);
  const boundaryAgent = context.completionAgent;
  const committer = deps.completionCommitter ?? createCompletionCommitter();
  let published: Awaited<ReturnType<CompletionCommitter>>;
  try {
    published = await committer({
      worktreePath: context.worktreePath,
      baseRef: context.baseRef,
      specPath: context.durableDir,
      agent: boundaryAgent as string,
      ...(context.reviewPass === undefined
        ? { title: creationTitle }
        : mutatingReviewPassCommitFields(context.behavior, context.reviewPass, creationTitle)),
      iterationTimeoutMs: DEFAULT_ITERATION_TIMEOUT_MS,
    });
  } catch (error) {
    const message = errorMessage(error);
    return settlePublicationResumeFailure(
      store,
      context,
      attemptId,
      "completion_commit_failed",
      0,
      message,
      deps.logSink,
      INTENT_FINALIZATION_RESUME_POLICY,
    );
  }
  const uncommittedFailure = await settleIntentResumeUncommittedFailure(published, context, store, attemptId, deps);
  if (uncommittedFailure !== undefined) return uncommittedFailure;

  const bodySummary = deriveIntentRunBodySummary({
    creationTitle: context.creationTitleHint,
    intentFiles: await listLandedIntentFiles(context.worktreePath, context.invocationId),
  });
  const result: WriteLoopResult = {
    kind: "complete",
    runId: context.runId,
    iterationsConsumed: 0,
    resumable: false,
    ...(context.completionAgent !== undefined ? { completionAgent: context.completionAgent } : {}),
  };
  store.setRunStatus(context.runId, "in-progress");
  const publication = await publishWithReadyRepair(
    inertResumeWriteLoopInput(context, context.durableDir, deps, context.landing, writeSibling),
    store,
    result,
    0,
    {
      worktreePath: context.worktreePath,
      baseRef: context.baseRef,
      specPath: context.durableDir,
      branch: context.branch,
      creationTitle,
      ...(bodySummary !== undefined ? { bodySummary } : {}),
    },
  );
  if (publication.failure !== undefined) {
    const failure = publication.failure;
    const isFlip = failure.kind === "ready_flip_failed";
    const message = failure.error?.message ?? failure.kind;
    const publicationFailure = publicationFailureFor(failure.error);
    const failureFields = resumePublicationFailureBoundaryFields(failure, message);
    store.commitCompletionBoundary({
      attemptId,
      runStatus: isFlip ? "completed" : "failed",
      outcomeKind: isFlip ? "done" : "invocation_failure",
      ...(failureFields.invocationFailureDetail !== undefined
        ? { invocationFailureDetail: failureFields.invocationFailureDetail }
        : {}),
      terminalCause: failureFields.terminalCause,
      ...(failureFields.terminalFailureDetail !== undefined
        ? { terminalFailureDetail: failureFields.terminalFailureDetail }
        : {}),
    });
    const intentResumePublicationCommitError = message;
    deps.logSink?.append(context.runId, {
      kind: "loop_finished",
      loopOutcomeKind: failure.kind,
      iterationsConsumed: publication.iterationsConsumed,
      resumable: !isFlip,
      ...survivingMutationLogFields(failure.error),
      ...nonTerminatingMutationLogFields(failure.error),
      ...readyGateOutOfScopeLogFields(failure.error),
      ...readyGateFailureLogFields(failure.kind, failure.error),
      ...(publicationFailure !== undefined ? { publicationFailure } : {}),
      ...(failure.kind === "completion_commit_failed"
        ? { completionCommitError: intentResumePublicationCommitError }
        : {}),
    });
    traceCompletionPublication(
      deps.logSink,
      context.runId,
      context.landing,
      context.branch,
      `${failure.kind}: ${message}`,
    );
    return { ok: false, message };
  }

  appendRuntimeSmokeOutcome(deps.logSink, context.runId, publication.success?.runtimeSmokeOutcome);
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    ...completedPublicationBoundaryFields(publication.success),
    ...(context.completionAgent ? { completionAgent: context.completionAgent } : {}),
  });
  deps.logSink?.append(context.runId, {
    kind: "loop_finished",
    loopOutcomeKind: "complete",
    iterationsConsumed: publication.iterationsConsumed,
    resumable: false,
  });
  traceCompletionPublication(deps.logSink, context.runId, context.landing, context.branch);
  return {
    ok: true,
    ...(published.commitSha !== undefined ? { commitSha: published.commitSha } : {}),
    ...(publication.success?.prNumber !== undefined ? { prNumber: publication.success.prNumber } : {}),
    ...(publication.success?.prUrl !== undefined ? { prUrl: publication.success.prUrl } : {}),
  };
}

/**
 * Daemon-callable resume for a review-behavior step's populated-stage `landing_failed` row:
 * replays only finalization (promote `durableDir`, verdict-sidecar cleanup, commit, push, draft
 * PR) from the persisted workflow snapshot — no split/critic/actuator re-invocation, no
 * `freshDispatch`. Callers must gate on {@link resolveIntentFinalizationResumeContext} first;
 * this never returns a no-op stub — an admitted resume always settles success or a visible failure.
 */
export async function resumePopulatedIntentPublication(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
  store: StateStore,
  deps: IntentFinalizationResumeDeps = {},
): Promise<IntentFinalizationResumeOutcome> {
  const resolved = resolveIntentFinalizationResumeContext(run, store);
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const { context } = resolved;
  // Resolve before the status flip below: the head lookup requires the row still `failed`.
  const writeSibling = resolveWriteSiblingCommandSource(run, store);

  const attemptId = store.recordAttemptStart(context.runId);
  deps.logSink?.append(context.runId, { kind: "iteration_started", attemptId });

  try {
    if (context.completionAgent === undefined) {
      return settlePublicationResumeFailure(
        store,
        context,
        attemptId,
        "invocation_failure",
        0,
        "no completion agent available to attribute the publication commit",
        deps.logSink,
        INTENT_FINALIZATION_RESUME_POLICY,
      );
    }

    const lintResult = await lintReviewedStagedMarkdownOrFail(context.worktreePath, context.landing);
    if (lintResult.kind === "violation" || lintResult.kind === "invocation_error") {
      return settleIntentResumeStagedMarkdownLintFailure(
        store,
        context,
        attemptId,
        lintResult.kind === "violation",
        deps,
      );
    }

    const landed = await landReviewedPublicationOutput(context.worktreePath, context.landing, context.verdictPath, {
      logSink: deps.logSink,
      runId: context.runId,
      branch: context.branch,
      persistHandoff: {
        store,
        project: context.project,
        branch: context.branch,
        writeTarget: { reviewRunId: context.runId },
      },
    });
    if (!landed.ok) {
      return settlePublicationResumeFailure(
        store,
        context,
        attemptId,
        "invocation_failure",
        0,
        landed.message,
        deps.logSink,
        INTENT_FINALIZATION_RESUME_POLICY,
      );
    }

    return await runIntentResumeCommitAndPublish(context, store, attemptId, deps, writeSibling);
  } catch (error) {
    const message = errorMessage(error);
    return settlePublicationResumeFailure(
      store,
      context,
      attemptId,
      "invocation_failure",
      0,
      message,
      deps.logSink,
      INTENT_FINALIZATION_RESUME_POLICY,
    );
  }
}

/**
 * Terminal outcome kinds admitted for review-mutation finalization resume: `surviving_mutation_failed`
 * is the row's original failure, and `ready_gate_failed`/`completion_commit_failed` are the other
 * outcomes this same resume path can itself settle as resumable — admitting them is
 * self-consistency, not scope creep, since only this path (never a fresh review pass) ever writes
 * them onto a review-behavior row. `runtime_smoke_failed` is excluded: retrying this tail cannot
 * change a runtime-smoke outcome, so it never gets a second attempt.
 */
export const REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS = new Set([
  "surviving_mutation_failed",
  "non_terminating_mutation_failed",
  "ready_gate_failed",
  "ready_gate_out_of_scope",
  "completion_commit_failed",
]);

/** Reconstructed context for resuming a review-behavior row that settled `surviving_mutation_failed`. */
type ReviewMutationResumeContext = ExternalSpecGitScope & {
  runId: string;
  /** Durable write-step row carrying persisted ready-gate repair fence provenance. */
  writeSiblingRunId: string;
  worktreePath: string;
  project: string;
  branch: string;
  baseRef: string;
  specPath: string;
  invocationId: string;
  /** `intent-stage` when the sibling write step lands to `.jarvis-intent-stage/`; `plain` otherwise. */
  landingKind: "intent-stage" | "plain";
  completionAgent: string | undefined;
  creationTitleHint: string | undefined;
};

type ReviewMutationResumeResolution =
  | { ok: true; context: ReviewMutationResumeContext }
  | { ok: false; message: string };

function persistedExternalSpecGitScope(
  writeRun: Pick<Run, "queuedInput">,
  writeStep: WorkflowSnapshotStep | undefined,
): ExternalSpecGitScope {
  const persisted = writeStep?.externalPlanSpec === true ? writeStep : writeRun.queuedInput;
  return persisted?.externalPlanSpec === true && persisted.specReadRoot !== undefined
    ? { externalPlanSpec: true, specReadRoot: persisted.specReadRoot }
    : {};
}

type PausedWriteResumeReconstruction = { ok: true; input: WriteLoopInput } | { ok: false; message: string };

function parseLinkedRowIndex(runStepId: string, authoredStepId: string): number | undefined {
  const prefix = `${authoredStepId}${LINK_STEP_ID_INFIX}`;
  if (!runStepId.startsWith(prefix)) return undefined;
  const suffix = runStepId.slice(prefix.length);
  const index = Number(suffix);
  if (!Number.isInteger(index) || String(index) !== suffix) return undefined;
  return index;
}

function linkedResumeIndexPath(
  snapshotStep: WorkflowSnapshotStep,
  run: Pick<Run, "specPath" | "worktreePath">,
): string {
  if (snapshotStep.externalPlanSpec === true) {
    return run.specPath;
  }
  return isAbsolute(run.specPath) ? run.specPath : join(run.worktreePath, run.specPath);
}

function linkedResumeRoutingRoot(snapshotStep: WorkflowSnapshotStep, run: Pick<Run, "worktreePath">): string {
  return snapshotStep.specReadRoot ?? run.worktreePath;
}

function linkedResumeExpectedArtifactPath(
  absoluteSubspecPath: string,
  snapshotStep: WorkflowSnapshotStep,
  worktreePath: string,
): string {
  if (snapshotStep.externalPlanSpec === true && snapshotStep.specReadRoot !== undefined) {
    return absoluteSubspecPath;
  }
  const relativePath = relative(worktreePath, absoluteSubspecPath).replace(/\\/g, "/");
  return relativePath.startsWith("..") ? absoluteSubspecPath : relativePath;
}

/**
 * Reconstruct write-loop input for a paused linked-implement row (`<stepId>~link-N`): resolve the
 * authored snapshot write step, re-read pinned linked-index routing for `N`, and thread
 * `resumeReentry`, `specReadRoot` (external plans only), and the active subspec
 * `expectedArtifactPath` into the result. Daemon `reconstructWriteResume` is the intended consumer.
 */
export function reconstructPausedWriteResumeInput(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
): PausedWriteResumeReconstruction {
  if (run.status !== "paused") {
    return { ok: false, message: "paused write resume requires a paused run" };
  }
  const snapshot = run.workflowSnapshot;
  const stepId = run.stepId;
  if (!snapshot || !stepId) {
    return { ok: false, message: "run has no matching workflow snapshot step" };
  }
  const snapshotStep = findSnapshotStepForRunStepId(snapshot.steps, stepId);
  if (!snapshotStep || snapshotStep.behavior === "review" || snapshotStep.behavior === "review-debate") {
    return { ok: false, message: "run has no matching workflow snapshot step" };
  }
  const authoredStepId = snapshotStep.stepId;
  if (!matchesLinkedSiblingStepId(stepId, authoredStepId)) {
    return { ok: false, message: "run is not a paused linked write row" };
  }
  const linkIndex = parseLinkedRowIndex(stepId, authoredStepId);
  if (linkIndex === undefined) {
    return { ok: false, message: "run has an invalid linked step id" };
  }
  if (!snapshotStep.stepRules?.trim() || !snapshotStep.agents?.length || !snapshotStep.agentModelConfig) {
    return { ok: false, message: "snapshot step is missing write resume context" };
  }

  const routing = resolvePinnedLinkedSubspec(
    linkedResumeIndexPath(snapshotStep, run),
    linkedResumeRoutingRoot(snapshotStep, run),
    linkIndex,
  );
  if (!routing.ok) {
    return { ok: false, message: routing.error };
  }

  const expectedArtifactPath = linkedResumeExpectedArtifactPath(routing.active.path, snapshotStep, run.worktreePath);
  const externalScope = persistedExternalSpecGitScope(run, snapshotStep);

  return {
    ok: true,
    input: {
      worktree: {
        projectRoot: run.worktreePath,
        projectName: run.project,
        branchName: run.branch,
        baseRef: run.specRef,
      },
      specPath: run.specPath,
      stepRules: snapshotStep.stepRules,
      expectedArtifactPath,
      bindings: [],
      bindingResolution: {
        role: snapshotStep.role,
        agents: snapshotStep.agents,
        agentModelConfig: snapshotStep.agentModelConfig,
      },
      stepId,
      workflowSnapshot: snapshot,
      resumeReentry: true,
      ...(snapshotStep.promptId !== undefined ? { promptId: snapshotStep.promptId } : {}),
      ...(snapshotStep.promptPlaceholders !== undefined ? { promptPlaceholders: snapshotStep.promptPlaceholders } : {}),
      ...(snapshotStep.iterationTimeoutMs !== undefined ? { iterationTimeoutMs: snapshotStep.iterationTimeoutMs } : {}),
      ...(snapshotStep.iterationCeilingMs !== undefined ? { iterationCeilingMs: snapshotStep.iterationCeilingMs } : {}),
      ...(snapshotStep.idleOutputMs !== undefined ? { idleOutputMs: snapshotStep.idleOutputMs } : {}),
      ...(snapshotStep.fixCommand !== undefined ? { fixCommand: snapshotStep.fixCommand } : {}),
      ...(snapshotStep.readyCommand !== undefined ? { readyCommand: snapshotStep.readyCommand } : {}),
      ...externalScope,
      ...(snapshotStep.externalPlanSpec === true ? { externalSpecReadOnly: true as const } : {}),
    },
  };
}

/** Reconstruct a durable review-mutation row's write-sibling context without admitting its outcome. */
export function resolveReviewMutationLineageContext(run: Run, store: StateStore): ReviewMutationResumeResolution {
  const head = resolveReviewMutationRowHead(run, store);
  if (!head.ok) return head;
  const { snapshot, writeStep, writeRun } = head.head;
  const completionAgent = resumeInjected().reviewCompletionAgent(writeRun) ?? writeStep?.agents?.[0];
  return {
    ok: true,
    context: {
      runId: run.id,
      writeSiblingRunId: writeRun.id,
      worktreePath: writeRun.worktreePath,
      project: run.project,
      branch: run.branch,
      baseRef: writeRun.specRef,
      specPath: writeRun.specPath,
      invocationId: snapshot.invocationId,
      landingKind: writeStep?.expectedArtifactPath === INTENT_STAGE_DIR ? "intent-stage" : "plain",
      completionAgent,
      creationTitleHint: snapshot.creationTitle,
      ...persistedExternalSpecGitScope(writeRun, writeStep),
    },
  };
}

/**
 * Admission and reconstruction for resuming a review-behavior row's `surviving_mutation_failed`
 * failure: the sibling durable write step already committed (landing, if any, already succeeded),
 * so only mutation re-verification, the ready gate, and publication (push, draft PR, ready flip)
 * need to run again — never a write-loop re-entry or agent re-invocation.
 */
export function resolveReviewMutationResumeContext(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
  store: StateStore,
  terminalRecord: (PersistedRecord & { event: LoopFinishedEvent | RunExecutionFailedEvent }) | undefined,
): ReviewMutationResumeResolution {
  const resolved = resolveReviewMutationLineageContext(run, store);
  if (!resolved.ok) return resolved;
  if (
    terminalRecord?.event.kind !== "loop_finished" ||
    !REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS.has(terminalRecord.event.loopOutcomeKind)
  ) {
    return { ok: false, message: "run did not fail with a surviving mutation" };
  }
  if (
    terminalRecord.event.loopOutcomeKind === "ready_gate_out_of_scope" &&
    !isResumableOutOfScopeTerminalEvidence(terminalRecord.event)
  ) {
    return { ok: false, message: "ready_gate_out_of_scope with unchanged outside paths is not resumable" };
  }
  return resolved;
}

/**
 * Admission and reconstruction for resuming an ordinary write row's finalization failure:
 * only mutation re-verification, the ready gate, and publication run again — never write-loop
 * re-entry or a repair agent.
 */
function resolveOrdinaryWriteResumeContext(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
  terminalRecord: (PersistedRecord & { event: LoopFinishedEvent | RunExecutionFailedEvent }) | undefined,
  options: {
    admit: (event: LoopFinishedEvent) => boolean;
    rejectMessage: string;
    completionAgent?: string;
  },
): ReviewMutationResumeResolution {
  const snapshot = run.workflowSnapshot;
  const stepId = run.stepId;
  const step = stepId && snapshot ? findSnapshotStepForRunStepId(snapshot.steps, stepId) : undefined;
  if (step?.behavior === "review" || step?.behavior === "review-debate") {
    return { ok: false, message: "run is a review-behavior step" };
  }
  if (run.status !== "failed") {
    return { ok: false, message: "run is not in a failed state" };
  }
  if (terminalRecord?.event.kind !== "loop_finished" || !options.admit(terminalRecord.event)) {
    return { ok: false, message: options.rejectMessage };
  }
  const completionAgent = options.completionAgent ?? resumeInjected().reviewCompletionAgent(run) ?? step?.agents?.[0];
  return {
    ok: true,
    context: {
      runId: run.id,
      writeSiblingRunId: run.id,
      worktreePath: run.worktreePath,
      project: run.project,
      branch: run.branch,
      baseRef: run.specRef,
      specPath: run.specPath,
      invocationId: snapshot?.invocationId ?? run.id,
      landingKind: step?.expectedArtifactPath === INTENT_STAGE_DIR ? "intent-stage" : "plain",
      completionAgent,
      creationTitleHint: snapshot?.creationTitle,
      ...persistedExternalSpecGitScope(run, step),
    },
  };
}

/**
 * Admission and reconstruction for resuming an ordinary write row's `ready_gate_out_of_scope`
 * failure: the implement/plan pass already settled, so only mutation re-verification, the ready
 * gate, and publication need to run again — never a write-loop re-entry, repair agent, or
 * `ready_gate_repair` event.
 */
export function resolveWriteOutOfScopeResumeContext(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
  _store: StateStore,
  terminalRecord: (PersistedRecord & { event: LoopFinishedEvent | RunExecutionFailedEvent }) | undefined,
): ReviewMutationResumeResolution {
  return resolveOrdinaryWriteResumeContext(run, terminalRecord, {
    admit: isResumableOutOfScopeTerminalEvidence,
    rejectMessage: "run did not fail with ready_gate_out_of_scope",
  });
}

/**
 * Resume admission for `non_terminating_mutation_failed`: mutation re-verification, ready gate, and publication only.
 */
export function resolveWriteNonTerminatingResumeContext(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
  _store: StateStore,
  terminalRecord: (PersistedRecord & { event: LoopFinishedEvent | RunExecutionFailedEvent }) | undefined,
): ReviewMutationResumeResolution {
  return resolveOrdinaryWriteResumeContext(run, terminalRecord, {
    admit: (event) => event.loopOutcomeKind === "non_terminating_mutation_failed" && event.resumable === true,
    rejectMessage: "run did not fail with non_terminating_mutation_failed",
  });
}

/**
 * Admission and reconstruction for resuming an ordinary write row's exhausted-red
 * `ready_gate_failed` failure: the implement pass already settled and retained its publication
 * checkpoint, so only operator commit, mutation re-verification, the ready gate, and publication
 * need to run again — never a write-loop re-entry or repair agent.
 */
export function resolveExhaustedRedResumeContext(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
  _store: StateStore,
  terminalRecord: (PersistedRecord & { event: LoopFinishedEvent | RunExecutionFailedEvent }) | undefined,
): ReviewMutationResumeResolution {
  const checkpoint = run.retainedFinalizationCheckpoint;
  if (!hasRetainedFinalizationCheckpoint(run) || checkpoint === undefined || checkpoint === null) {
    return { ok: false, message: "retained finalization checkpoint is missing" };
  }
  // The checkpoint carries a required `completionAgent`, so no attempt or sibling-step
  // fallback applies here.
  return resolveOrdinaryWriteResumeContext(run, terminalRecord, {
    admit: isExhaustedRedTerminalEvidence,
    rejectMessage: "run did not fail with exhausted-red ready gate evidence",
    completionAgent: checkpoint.completionAgent,
  });
}

/**
 * Admission and reconstruction for resuming an ordinary write row's `completion_commit_failed`
 * failure: the write/shrink pass already settled, so only operator commit, mutation
 * re-verification, the ready gate, and publication need to run again — never write-loop re-entry.
 */
export function resolveCompletionCommitFailedResumeContext(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
  _store: StateStore,
  terminalRecord: (PersistedRecord & { event: LoopFinishedEvent | RunExecutionFailedEvent }) | undefined,
): ReviewMutationResumeResolution {
  return resolveOrdinaryWriteResumeContext(run, terminalRecord, {
    admit: (event) => event.loopOutcomeKind === "completion_commit_failed" && event.resumable === true,
    rejectMessage: "run did not fail with completion_commit_failed",
  });
}

type ReviewMutationResumeOutcome = { ok: true; prNumber?: number; prUrl?: string } | { ok: false; message: string };

type ReviewMutationResumeDeps = IntentFinalizationResumeDeps & {
  /** Present only for `implement.recover`; plain `run resume` remains agent-free. */
  mutationRepair?: Pick<
    WriteLoopInput,
    "bindings" | "stepRules" | "iterationTimeoutMs" | "iterationCeilingMs" | "idleOutputMs"
  >;
  /** Injection seam for persisted-fence enforcement; production uses `enforcePersistedReadyGateRepairFence`. */
  persistedRepairFenceEnforcer?: PersistedRepairFenceEnforcer;
  /** Injection seam for the auto-derived publication-time mutation repair binding factory. */
  mutationRepairBindingFactory?: (binding: ResolvedAgentBinding) => InvocationBinding;
};

/** Settle the review-mutation resume attempt as a visible failure — never a silent no-op or a strand at `in-progress`. */
/** Review-mutation finalization: retryable iff the outcome kind is one this resolver itself admits. */
const REVIEW_MUTATION_RESUME_POLICY: PublicationResumeSettlementPolicy = {
  // `invocation_failure` (no completion agent, thrown error) is never in the admitted set, so it
  // must not claim resumable either.
  resumable: (_store, _runId, loopOutcomeKind) => REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS.has(loopOutcomeKind),
};

/**
 * Commit uncommitted worktree changes (the natural "fix coverage, then resume" operator gesture)
 * before re-verification; settles a visible `completion_commit_failed` naming the offending paths
 * rather than letting an uncommitted fix silently re-fail the same way.
 */
async function commitReviewMutationResumeChanges(
  context: ReviewMutationResumeContext,
  store: StateStore,
  attemptId: string,
  creationTitle: string,
  deps: ReviewMutationResumeDeps,
): Promise<ReviewMutationResumeOutcome | undefined> {
  const recoveryFenceError = await (deps.persistedRepairFenceEnforcer ?? enforcePersistedReadyGateRepairFence)(
    {
      worktreePath: context.worktreePath,
      baseRef: context.baseRef,
      specPath: context.specPath,
    },
    store,
    context.writeSiblingRunId,
  );
  if (recoveryFenceError !== undefined) {
    return settlePublicationResumeFailure(
      store,
      context,
      attemptId,
      "completion_commit_failed",
      0,
      recoveryFenceError.message,
      deps.logSink,
      REVIEW_MUTATION_RESUME_POLICY,
    );
  }
  const committer = deps.completionCommitter ?? createCompletionCommitter();
  let published: Awaited<ReturnType<CompletionCommitter>>;
  try {
    published = await committer({
      worktreePath: context.worktreePath,
      baseRef: context.baseRef,
      specPath: context.specPath,
      agent: context.completionAgent as string,
      title: creationTitle,
      iterationTimeoutMs: deps.mutationRepair?.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS,
      ...externalSpecGitScope(context),
    });
  } catch (error) {
    const message = errorMessage(error);
    return settlePublicationResumeFailure(
      store,
      context,
      attemptId,
      "completion_commit_failed",
      0,
      message,
      deps.logSink,
      REVIEW_MUTATION_RESUME_POLICY,
    );
  }
  if (published.commitSha === undefined) {
    const uncommitted = await getUncommittedPaths(context.worktreePath, externalSpecGitScope(context));
    if (uncommitted.length > 0) {
      return settlePublicationResumeFailure(
        store,
        context,
        attemptId,
        "completion_commit_failed",
        0,
        `Uncommitted changes: ${uncommitted.join(", ")}`,
        deps.logSink,
        REVIEW_MUTATION_RESUME_POLICY,
      );
    }
  }
  return undefined;
}

/**
 * Publication shape (spec-template vs derived intent body summary) follows
 * {@link ReviewMutationResumeContext.landingKind} the same way the primary completion tail
 * branches on `completionStep.landing`.
 */
async function deriveReviewMutationResumeBodySummary(
  context: ReviewMutationResumeContext,
): Promise<{ bodySummary: string | undefined; specTemplate: boolean }> {
  if (context.landingKind === "intent-stage") {
    const bodySummary = deriveIntentRunBodySummary({
      creationTitle: context.creationTitleHint,
      intentFiles: await listLandedIntentFiles(context.worktreePath, context.invocationId),
    });
    return { bodySummary, specTemplate: false };
  }
  const bodySummary = await deriveSpecRunBodySummary({
    worktreePath: context.worktreePath,
    specPath: context.specPath,
    baseRef: context.baseRef,
    ...externalSpecGitScope(context),
  });
  return { bodySummary, specTemplate: true };
}

function mutationRepairLoopInput(
  context: ReviewMutationResumeContext,
  deps: ReviewMutationResumeDeps,
): WriteLoopInput | undefined {
  const repair = deps.mutationRepair;
  if (repair === undefined) return undefined;
  return {
    worktree: {
      projectRoot: context.worktreePath,
      projectName: context.project,
      branchName: context.branch,
      baseRef: context.baseRef,
      git: false,
      localPath: context.worktreePath,
    },
    specPath: context.specPath,
    expectedArtifactPath: context.specPath,
    bindings: repair.bindings,
    stepRules: repair.stepRules,
    // The ready-gate budget is independently enforced by `publishWithReadyRepair`; recovery's
    // inert resume limit must not suppress its three repair attempts.
    maxIterations: Number.POSITIVE_INFINITY,
    ...(repair.iterationTimeoutMs !== undefined ? { iterationTimeoutMs: repair.iterationTimeoutMs } : {}),
    ...(repair.iterationCeilingMs !== undefined ? { iterationCeilingMs: repair.iterationCeilingMs } : {}),
    ...(repair.idleOutputMs !== undefined ? { idleOutputMs: repair.idleOutputMs } : {}),
    ...(deps.completionCommitter !== undefined ? { completionCommitter: deps.completionCommitter } : {}),
    ...(deps.completionPublisher !== undefined ? { completionPublisher: deps.completionPublisher } : {}),
    ...(deps.readyFinalizer !== undefined ? { readyFinalizer: deps.readyFinalizer } : {}),
    ...(deps.runFixCommand !== undefined ? { runFixCommand: deps.runFixCommand } : {}),
    ...(deps.logSink !== undefined ? { logSink: deps.logSink } : {}),
    ...externalSpecGitScope(context),
    ...(context.externalPlanSpec === true ? { externalSpecReadOnly: true as const } : {}),
  };
}

function settleMutationRepairExhausted(
  store: StateStore,
  context: ReviewMutationResumeContext,
  message: string,
  iterationsConsumed: number,
  deps: ReviewMutationResumeDeps,
): ReviewMutationResumeOutcome {
  const attemptId = store.recordAttemptStart(context.runId);
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message },
    ...completionBoundarySettlementFields(
      "mutation_repair_exhausted",
      terminalFailureDetailFromError(undefined, message),
    ),
  });
  deps.logSink?.append(context.runId, {
    kind: "loop_finished",
    loopOutcomeKind: "mutation_repair_exhausted",
    iterationsConsumed,
    resumable: false,
  });
  return { ok: false, message };
}

async function runMutationRepairContinuation(
  context: ReviewMutationResumeContext,
  store: StateStore,
  originalAttemptId: string,
  initialError: SurvivingMutationError,
  deps: ReviewMutationResumeDeps,
  body: { bodySummary: string | undefined; specTemplate: boolean },
): Promise<ReviewMutationResumeOutcome> {
  const repairArgs = mutationRepairLoopInput(context, deps);
  if (repairArgs === undefined) return { ok: false, message: initialError.message };

  store.commitCompletionBoundary({ attemptId: originalAttemptId, runStatus: "in-progress", outcomeKind: "progress" });
  deps.logSink?.append(context.runId, {
    kind: "boundary_committed",
    attemptId: originalAttemptId,
    outcomeKind: "progress",
    runStatus: "in-progress",
  });

  let mutationError = initialError;
  for (let attempt = 1; attempt <= MAX_MUTATION_REPAIR_ATTEMPTS; attempt += 1) {
    const attemptResult = await runMutationRepairAttempt(
      context,
      store,
      repairArgs,
      mutationError,
      attempt,
      deps,
      body,
    );
    if (attemptResult.kind === "retry") {
      mutationError = attemptResult.mutationError;
      continue;
    }
    return attemptResult.outcome;
  }
  return settleMutationRepairExhausted(
    store,
    context,
    "Mutation survived every repair attempt",
    MAX_MUTATION_REPAIR_ATTEMPTS,
    deps,
  );
}

type MutationRepairAttemptResult =
  | { kind: "retry"; mutationError: SurvivingMutationError }
  | { kind: "settled"; outcome: ReviewMutationResumeOutcome };

/** Run a single mutation-repair attempt: repair, recommit, reverify, and (if clean) publish. */
async function runMutationRepairAttempt(
  context: ReviewMutationResumeContext,
  store: StateStore,
  repairArgs: NonNullable<ReturnType<typeof mutationRepairLoopInput>>,
  mutationError: SurvivingMutationError,
  attempt: number,
  deps: ReviewMutationResumeDeps,
  body: { bodySummary: string | undefined; specTemplate: boolean },
): Promise<MutationRepairAttemptResult> {
  const result: WriteLoopResult = {
    kind: "complete",
    runId: context.runId,
    iterationsConsumed: attempt - 1,
    resumable: false,
    ...(context.completionAgent !== undefined ? { completionAgent: context.completionAgent } : {}),
  };
  const repairOutcome = await withExternalSpecTreeReadOnly(externalSpecGitScope(context), [], () =>
    runMutationRepairIteration(repairArgs, store, result, mutationError, attempt),
  );
  if (repairOutcome === "blocked") {
    return {
      kind: "settled",
      outcome: await settleMutationRepairExhausted(
        store,
        context,
        "Mutation repair agent reported blocked",
        attempt,
        deps,
      ),
    };
  }
  if (repairOutcome === "unsettled") {
    return {
      kind: "settled",
      outcome: await settleMutationRepairExhausted(
        store,
        context,
        "Mutation repair agent did not settle",
        attempt,
        deps,
      ),
    };
  }

  store.setRunStatus(context.runId, "in-progress");
  const creationTitle = resolvePublicationTitle(context.worktreePath, context.specPath, context.creationTitleHint);
  const mutationRepairStep: CompletionStepMetadata = { kind: "mutation-repair" };
  try {
    await (deps.completionCommitter ?? createCompletionCommitter())({
      worktreePath: context.worktreePath,
      baseRef: context.baseRef,
      specPath: context.specPath,
      agent: context.completionAgent ?? "",
      title: renderStepCommitTitle(mutationRepairStep, creationTitle),
      iterationTimeoutMs: deps.mutationRepair?.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS,
      step: mutationRepairStep,
      ...externalSpecGitScope(context),
    });
  } catch (error) {
    const message = errorMessage(error);
    return {
      kind: "settled",
      outcome: await settlePublicationResumeFailure(
        store,
        context,
        store.recordAttemptStart(context.runId),
        "completion_commit_failed",
        0,
        message,
        deps.logSink,
        REVIEW_MUTATION_RESUME_POLICY,
      ),
    };
  }

  const verification = await verifyDiffDerivedMutations({
    worktreePath: context.worktreePath,
    runBase: context.baseRef,
  });
  if (verification.kind === "surviving-mutation") {
    return {
      kind: "retry",
      mutationError: new SurvivingMutationError(
        verification.mutation,
        verification.sourceSite.file,
        verification.sourceSite.line,
        verification.dualConstraint,
      ),
    };
  }

  const publication = await publishWithReadyRepair(repairArgs, store, result, attempt, {
    worktreePath: context.worktreePath,
    baseRef: context.baseRef,
    specPath: context.specPath,
    branch: context.branch,
    creationTitle,
    ...(body.bodySummary !== undefined ? { bodySummary: body.bodySummary } : {}),
    ...(body.specTemplate ? { specTemplate: true } : {}),
    ...externalSpecGitScope(context),
  });
  if (
    publication.failure?.kind === "surviving_mutation_failed" &&
    publication.failure.error instanceof SurvivingMutationError
  ) {
    return { kind: "retry", mutationError: publication.failure.error };
  }
  if (publication.failure !== undefined) {
    appendRuntimeSmokeOutcome(deps.logSink, context.runId, publication.failure.runtimeSmokeOutcome);
    return {
      kind: "settled",
      outcome: await settlePublicationResumeFailure(
        store,
        context,
        store.recordAttemptStart(context.runId),
        publication.failure.kind,
        0,
        publication.failure.error?.message ?? publication.failure.kind,
        deps.logSink,
        REVIEW_MUTATION_RESUME_POLICY,
      ),
    };
  }

  const finalAttemptId = store.recordAttemptStart(context.runId);
  appendRuntimeSmokeOutcome(deps.logSink, context.runId, publication.success?.runtimeSmokeOutcome);
  store.commitCompletionBoundary({
    attemptId: finalAttemptId,
    runStatus: "completed",
    outcomeKind: "done",
    ...completedPublicationBoundaryFields(publication.success),
    ...(context.completionAgent !== undefined ? { completionAgent: context.completionAgent } : {}),
  });
  deps.logSink?.append(context.runId, {
    kind: "loop_finished",
    loopOutcomeKind: "complete",
    iterationsConsumed: publication.iterationsConsumed,
    resumable: false,
  });
  return {
    kind: "settled",
    outcome: {
      ok: true,
      ...(publication.success?.prNumber !== undefined ? { prNumber: publication.success.prNumber } : {}),
      ...(publication.success?.prUrl !== undefined ? { prUrl: publication.success.prUrl } : {}),
    },
  };
}

function reviewMutationExhaustedTerminalFields(
  store: StateStore,
  runId: string,
  readyGateOrigin: "repair_budget_exhausted" | undefined,
): Pick<LoopFinishedEvent, "readyGateOrigin" | "readyGateRepairCount"> {
  if (readyGateOrigin !== undefined) {
    return exhaustedRedTerminalLogFields(readyGateOrigin);
  }
  const runRow = store.loadRun(runId);
  return runRow !== null && hasRetainedFinalizationCheckpoint(runRow)
    ? exhaustedRedTerminalLogFields("repair_budget_exhausted")
    : {};
}

/**
 * `ready_gate_failed` — including the exhausted-red case — is already a member of
 * `REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS`, so the retained-checkpoint origin adds no
 * admission beyond the set membership.
 */
async function settleFailedReviewMutationPublication(
  context: ReviewMutationResumeContext,
  store: StateStore,
  attemptId: string,
  publication: Awaited<ReturnType<typeof publishWithReadyRepair>>,
  deps: ReviewMutationResumeDeps,
  body: { bodySummary: string | undefined; specTemplate: boolean },
): Promise<ReviewMutationResumeOutcome> {
  const failure = publication.failure;
  if (failure === undefined) return { ok: false, message: "publication failed without a failure payload" };
  if (
    failure.kind === "surviving_mutation_failed" &&
    failure.error instanceof SurvivingMutationError &&
    deps.mutationRepair
  ) {
    return await runMutationRepairContinuation(context, store, attemptId, failure.error, deps, body);
  }
  const isFlip = failure.kind === "ready_flip_failed";
  const message = failure.error?.message ?? failure.kind;
  const publicationFailure = publicationFailureFor(failure.error);
  appendRuntimeSmokeOutcome(deps.logSink, context.runId, failure.runtimeSmokeOutcome);
  const failureFields = resumePublicationFailureBoundaryFields(failure, message);
  store.commitCompletionBoundary({
    attemptId,
    runStatus: isFlip ? "completed" : "failed",
    outcomeKind: isFlip ? "done" : "invocation_failure",
    ...(failureFields.invocationFailureDetail !== undefined
      ? { invocationFailureDetail: failureFields.invocationFailureDetail }
      : {}),
    terminalCause: failureFields.terminalCause,
    ...(failureFields.terminalFailureDetail !== undefined
      ? { terminalFailureDetail: failureFields.terminalFailureDetail }
      : {}),
    ...(context.completionAgent !== undefined ? { completionAgent: context.completionAgent } : {}),
  });
  const exhaustedFields = reviewMutationExhaustedTerminalFields(store, context.runId, publication.readyGateOrigin);
  const priorRecords = priorLogRecordsFromSink(deps.logSink, context.runId);
  const reviewMutationPublicationCommitError = message;
  deps.logSink?.append(context.runId, {
    kind: "loop_finished",
    loopOutcomeKind: failure.kind,
    iterationsConsumed: publication.iterationsConsumed,
    // Reflects this resolver's own retryability, not merely "not a ready-flip": `runtime_smoke_failed`
    // is excluded from `REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS`, so retrying this tail can never
    // change that outcome — the newly emitted record must say so rather than claim resumable.
    resumable:
      isFlip || !REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS.has(failure.kind)
        ? false
        : failure.kind === "ready_gate_out_of_scope"
          ? outOfScopeSettlementResumable(
              readyGateOutOfScopeLogFields(failure.error).readyGateOutsidePaths,
              priorRecords,
            )
          : failure.kind !== "ready_gate_command_missing",
    ...survivingMutationLogFields(failure.error),
    ...nonTerminatingMutationLogFields(failure.error),
    ...readyGateOutOfScopeLogFields(failure.error),
    ...readyGateFailureLogFields(failure.kind, failure.error),
    ...exhaustedFields,
    ...(publicationFailure !== undefined ? { publicationFailure } : {}),
    ...(failure.kind === "completion_commit_failed"
      ? { completionCommitError: reviewMutationPublicationCommitError }
      : {}),
  });
  return { ok: false, message };
}

function settleSuccessfulReviewMutationPublication(
  context: ReviewMutationResumeContext,
  store: StateStore,
  attemptId: string,
  publication: Awaited<ReturnType<typeof publishWithReadyRepair>>,
  deps: ReviewMutationResumeDeps,
): ReviewMutationResumeOutcome {
  appendRuntimeSmokeOutcome(deps.logSink, context.runId, publication.success?.runtimeSmokeOutcome);
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    ...completedPublicationBoundaryFields(publication.success),
    ...(context.completionAgent !== undefined ? { completionAgent: context.completionAgent } : {}),
  });
  deps.logSink?.append(context.runId, {
    kind: "loop_finished",
    loopOutcomeKind: "complete",
    iterationsConsumed: publication.iterationsConsumed,
    resumable: false,
  });
  return {
    ok: true,
    ...(publication.success?.prNumber !== undefined ? { prNumber: publication.success.prNumber } : {}),
    ...(publication.success?.prUrl !== undefined ? { prUrl: publication.success.prUrl } : {}),
  };
}

/**
 * Commit any uncommitted worktree changes and run the shared mutation-reverification / ready-gate /
 * publication tail.
 */
async function runReviewMutationCommitAndPublish(
  context: ReviewMutationResumeContext,
  store: StateStore,
  attemptId: string,
  deps: ReviewMutationResumeDeps,
  writeSibling?: WriteSiblingCommandSource,
): Promise<ReviewMutationResumeOutcome> {
  const creationTitle = resolvePublicationTitle(context.worktreePath, context.specPath, context.creationTitleHint);
  store.setCreationTitle(context.runId, creationTitle);
  const commitFailure = await commitReviewMutationResumeChanges(context, store, attemptId, creationTitle, deps);
  if (commitFailure !== undefined) return commitFailure;

  const publishFenceError = await (deps.persistedRepairFenceEnforcer ?? enforcePersistedReadyGateRepairFence)(
    {
      worktreePath: context.worktreePath,
      baseRef: context.baseRef,
      specPath: context.specPath,
    },
    store,
    context.writeSiblingRunId,
  );
  if (publishFenceError !== undefined) {
    return settlePublicationResumeFailure(
      store,
      context,
      attemptId,
      "completion_commit_failed",
      0,
      publishFenceError.message,
      deps.logSink,
      REVIEW_MUTATION_RESUME_POLICY,
    );
  }

  const { bodySummary, specTemplate } = await deriveReviewMutationResumeBodySummary(context);

  const result: WriteLoopResult = {
    kind: "complete",
    runId: context.runId,
    iterationsConsumed: 0,
    resumable: false,
    completionAgent: context.completionAgent as string,
  };
  store.setRunStatus(context.runId, "in-progress");
  const publication = await publishWithReadyRepair(
    inertResumeWriteLoopInput(context, context.specPath, deps, undefined, writeSibling),
    store,
    result,
    0,
    {
      worktreePath: context.worktreePath,
      baseRef: context.baseRef,
      specPath: context.specPath,
      branch: context.branch,
      creationTitle,
      ...(bodySummary !== undefined ? { bodySummary } : {}),
      ...(specTemplate ? { specTemplate } : {}),
      ...externalSpecGitScope(context),
    },
  );

  if (publication.failure !== undefined) {
    return settleFailedReviewMutationPublication(context, store, attemptId, publication, deps, {
      bodySummary,
      specTemplate,
    });
  }

  return settleSuccessfulReviewMutationPublication(context, store, attemptId, publication, deps);
}

function survivingMutationErrorFromTerminalRecord(
  terminalRecord: (PersistedRecord & { event: LoopFinishedEvent | RunExecutionFailedEvent }) | undefined,
): SurvivingMutationError | undefined {
  if (terminalRecord?.event.kind !== "loop_finished") return undefined;
  const fields = survivingMutationLogFields(terminalRecord.event);
  if (
    terminalRecord.event.loopOutcomeKind !== "surviving_mutation_failed" ||
    fields.survivingMutation === undefined ||
    fields.survivingMutationSourceFile === undefined ||
    fields.survivingMutationSourceLine === undefined
  ) {
    return undefined;
  }
  return new SurvivingMutationError(
    fields.survivingMutation,
    fields.survivingMutationSourceFile,
    fields.survivingMutationSourceLine,
  );
}

function buildAutoDerivedMutationRepairDeps(
  context: ReviewMutationResumeContext,
  store: StateStore,
  writeSibling: WriteSiblingCommandSource | undefined,
  deps: ReviewMutationResumeDeps,
): ReviewMutationResumeDeps["mutationRepair"] | undefined {
  const reviewRun = store.loadRun(context.runId);
  const writeRun = store.loadRun(context.writeSiblingRunId);
  const snapshot = reviewRun?.workflowSnapshot;
  if (reviewRun === null || writeRun === null || writeRun.stepId == null || snapshot == null) return undefined;

  const snapshotWriteStep = findSnapshotStepForRunStepId(snapshot.steps, writeRun.stepId);
  if (snapshotWriteStep === undefined) return undefined;
  const agents = snapshotWriteStep.agents;
  const agentModelConfig = snapshotWriteStep.agentModelConfig;
  if (!Array.isArray(agents) || agents.length === 0 || agentModelConfig === undefined) return undefined;

  const stepRules = writeSibling?.queuedInput?.stepRules ?? writeRun.queuedInput?.stepRules ?? DEFAULT_WRITE_STEP_RULES;
  const createBinding = deps.mutationRepairBindingFactory ?? createResolvedAgentBinding;
  try {
    const bindings = resolveInvocationBindings(
      resolveExecutableRole("implement"),
      agents,
      agentModelConfig,
      createBinding,
    );
    if (bindings.length === 0) return undefined;
    return {
      bindings,
      stepRules,
      ...(snapshotWriteStep.iterationTimeoutMs !== undefined
        ? { iterationTimeoutMs: snapshotWriteStep.iterationTimeoutMs }
        : {}),
      ...(snapshotWriteStep.iterationCeilingMs !== undefined
        ? { iterationCeilingMs: snapshotWriteStep.iterationCeilingMs }
        : {}),
      ...(snapshotWriteStep.idleOutputMs !== undefined ? { idleOutputMs: snapshotWriteStep.idleOutputMs } : {}),
    };
  } catch {
    return undefined;
  }
}

function settleAutoDerivedMutationRepairNoBinding(
  store: StateStore,
  context: ReviewMutationResumeContext,
  attemptId: string,
  message: string,
  deps: ReviewMutationResumeDeps,
): ReviewMutationResumeOutcome {
  const noBindingDetail: InvocationFailureDetail = {
    failureKind: "no_binding",
    bindingAttempts: [],
    message,
  };
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: noBindingDetail,
    ...completionBoundarySettlementFields("invocation_failure", noBindingDetail),
  });
  deps.logSink?.append(context.runId, {
    kind: "loop_finished",
    loopOutcomeKind: "invocation_failure",
    iterationsConsumed: 0,
    resumable: false,
  });
  return { ok: false, message };
}

async function runAutoDerivedSurvivingMutationRepair(
  context: ReviewMutationResumeContext,
  store: StateStore,
  attemptId: string,
  mutationError: SurvivingMutationError,
  deps: ReviewMutationResumeDeps,
  writeSibling: WriteSiblingCommandSource | undefined,
): Promise<ReviewMutationResumeOutcome> {
  const derived = buildAutoDerivedMutationRepairDeps(context, store, writeSibling, deps);
  if (derived === undefined) {
    return settleAutoDerivedMutationRepairNoBinding(
      store,
      context,
      attemptId,
      "no implement binding available for publication-time mutation repair",
      deps,
    );
  }
  const effectiveDeps: ReviewMutationResumeDeps = { ...deps, mutationRepair: derived };
  const creationTitle = resolvePublicationTitle(context.worktreePath, context.specPath, context.creationTitleHint);
  store.setCreationTitle(context.runId, creationTitle);
  const commitFailure = await commitReviewMutationResumeChanges(
    context,
    store,
    attemptId,
    creationTitle,
    effectiveDeps,
  );
  if (commitFailure !== undefined) return commitFailure;
  const body = await deriveReviewMutationResumeBodySummary(context);
  return runMutationRepairContinuation(context, store, attemptId, mutationError, effectiveDeps, body);
}

async function replayMutationFinalization(
  resolved: ReviewMutationResumeResolution,
  store: StateStore,
  deps: ReviewMutationResumeDeps,
  writeSibling?: WriteSiblingCommandSource,
  terminalRecord?: (PersistedRecord & { event: LoopFinishedEvent | RunExecutionFailedEvent }) | undefined,
): Promise<ReviewMutationResumeOutcome> {
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const { context } = resolved;

  const attemptId = store.recordAttemptStart(context.runId);
  store.setRunStatus(context.runId, "in-progress");
  deps.logSink?.append(context.runId, { kind: "iteration_started", attemptId });

  try {
    if (context.completionAgent === undefined) {
      return settlePublicationResumeFailure(
        store,
        context,
        attemptId,
        "invocation_failure",
        0,
        "no completion agent available to attribute the publication commit",
        deps.logSink,
        REVIEW_MUTATION_RESUME_POLICY,
      );
    }

    const mutationError = survivingMutationErrorFromTerminalRecord(terminalRecord);
    if (deps.mutationRepair === undefined && mutationError !== undefined) {
      return await runAutoDerivedSurvivingMutationRepair(context, store, attemptId, mutationError, deps, writeSibling);
    }

    return await runReviewMutationCommitAndPublish(context, store, attemptId, deps, writeSibling);
  } catch (error) {
    const message = errorMessage(error);
    return settlePublicationResumeFailure(
      store,
      context,
      attemptId,
      "invocation_failure",
      0,
      message,
      deps.logSink,
      REVIEW_MUTATION_RESUME_POLICY,
    );
  }
}

/** Finalization-only replay for review-mutation, exhausted-red, write out-of-scope, and owning write-row publication failures. */
export async function resumeReviewMutationFinalization(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
  store: StateStore,
  terminalRecord: (PersistedRecord & { event: LoopFinishedEvent | RunExecutionFailedEvent }) | undefined,
  deps: ReviewMutationResumeDeps = {},
): Promise<ReviewMutationResumeOutcome> {
  const reviewResolved = resolveReviewMutationResumeContext(run, store, terminalRecord);
  const exhaustedResolved = reviewResolved.ok
    ? reviewResolved
    : resolveExhaustedRedResumeContext(run, store, terminalRecord);
  const resolved = exhaustedResolved.ok
    ? exhaustedResolved
    : resolveWriteOutOfScopeResumeContext(run, store, terminalRecord);
  const nonTerminatingResolved = resolved.ok
    ? resolved
    : resolveWriteNonTerminatingResumeContext(run, store, terminalRecord);
  const completionCommitFailedResolved = nonTerminatingResolved.ok
    ? nonTerminatingResolved
    : resolveCompletionCommitFailedResumeContext(run, store, terminalRecord);
  // Resolve before replay flips the row to in-progress: the sibling lookup reads the failed row.
  const writeSibling = resolveWriteSiblingCommandSource(run, store);
  return replayMutationFinalization(completionCommitFailedResolved, store, deps, writeSibling, terminalRecord);
}
