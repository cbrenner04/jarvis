import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { RunFixCommandOpts } from "../../../shared/fix-command.ts";
import { getCurrentHeadAsync } from "../../../shared/git.ts";
import { createResolvedAgentBinding, type ResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import {
  completeLinkedSubspec,
  type LinkedIndexRoutingResult,
  resolveActiveLinkedSubspec,
  resolvePinnedLinkedSubspec,
} from "../../../shared/linked-subspec-routing.ts";
import { extractBlockerBody } from "../../../shared/spec-parser.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import {
  type AgentModelConfig,
  resolveExecutableRole,
  resolveInvocationBindings,
} from "../config/agent-model-config.ts";
import type { ImplementReviewBehavior } from "../config/machine-config-loader.ts";
import { type IntentFinalizationEvent, type LogSink, priorLogRecordsFromSink } from "../persistence/log-stream.ts";
import {
  type Attempt,
  openStateStore,
  type StateStore,
  type WorkflowSnapshot,
  type WorkflowSnapshotStep,
} from "../persistence/state-store.ts";
import {
  type CompletionCommitter,
  type CompletionStepMetadata,
  createCompletionCommitter,
  mutatingReviewPassCommitFields,
  renderStepCommitTitle,
} from "./completion-commit.ts";
import type { CompletionPublisher } from "./completion-publisher.ts";
import {
  type ExternalSpecGitScope,
  excludeExternalSpecGitPaths,
  externalSpecGitScope,
  withExternalSpecTreeReadOnly,
} from "./external-spec-git.ts";
import { getExternalWorktreePath, withExternalWorktree as realWithExternalWorktree } from "./external-worktree.ts";
import { landImplementSpecTreeFromReadRoot } from "./implement-spec-landing.ts";
import type { IntentPipelineHandoff } from "./intent-output.ts";
import { listLandedIntentFiles } from "./intent-output.ts";
import { deriveIntentRunBodySummary } from "./intent-run-body-summary.ts";
import type { InvocationFailureDetail } from "./invocation-failure.ts";
import { readBranchCommits } from "./pr-attribution.ts";
import { landPublication, type PublicationLanding } from "./publication-landing.ts";
import { type PublicationFailure, publicationFailureFor } from "./publication-retry.ts";
import type { ReadyFinalizer } from "./ready-finalize.ts";
import {
  outOfScopeSettlementResumable,
  ReadyGateError,
  readyGateFailureLogFields,
  readyGateOutOfScopeLogFields,
  survivingMutationLogFields,
} from "./ready-finalize.ts";
import {
  executeReviewCycle,
  type ReviewCycleInput,
  type ReviewCycleOutcome,
  type ReviewCycleResult,
  type ReviewCycleRole,
} from "./review-cycle.ts";
import type { ReviewDebateInput, ReviewDebateRole } from "./review-debate.ts";
import { executeReviewCycleEnforced } from "./review-intent-enforcement.ts";
import { cycleProfileContext } from "./review-profile-context.ts";
import { rehydrateReviewPromptProfile } from "./review-profile-registry.ts";
import { resolvePublicationTitle } from "./spec-creation-title.ts";
import { deriveSpecRunBodySummary } from "./spec-run-body-summary.ts";
import {
  armSuccessorShellIdleWatchdog,
  isSuccessorShellStallOutcome,
  raceSuccessorShellIdle,
  type SuccessorShellStallOutcome,
} from "./successor-step-idle-watchdog.ts";
import {
  buildReviewInvocationFailureDetail,
  buildStandardReviewLandingActuatorContext,
  discardEphemeralReviewVerdictDrift,
  finishReviewedLanding,
  isPostCommitReviewRetryableFailureKind,
  landReviewedOutputOrFail,
  type ReviewDebateLandingDeps,
  type ReviewDebateStepOutcome,
  runReviewDebateStep,
  settleReviewedStagedMarkdownLintFailure,
} from "./workflow-runner-debate-landing.ts";
import { landReviewedPublicationOutput, wireWorkflowRunnerResumeDeps } from "./workflow-runner-resume.ts";

export { isPostCommitReviewRetryableFailureKind };

import { buildJsonlSink } from "./telemetry-sink.ts";
import {
  boundaryStampFromStoredRun,
  defaultTelemetrySinkPath,
  emitWorkBoundaryRecorded,
} from "./work-boundary-telemetry.ts";
import {
  appendRuntimeSmokeOutcome,
  DEFAULT_ITERATION_TIMEOUT_MS,
  executeWriteLoop,
  exhaustedRedTerminalLogFields,
  getUncommittedPaths,
  publishWithReadyRepair,
  type WriteLoopInput,
  type WriteLoopOutcomeKind,
  type WriteLoopResult,
} from "./write-loop.ts";

/** Workflow-runner-level telemetry context, shared identically across write and review steps. */
type WorkflowTelemetryContext = {
  operatorSessionId: string;
  workflow: string;
  sinkPath?: string;
};

const WORKFLOW_PRESET_LENGTHS = {
  "write-write": 2,
  implement: [1, 2] as const,
  intent: 1,
  plan: 1,
  "plan-reviewed": 1,
  "plan-reviewed-light": 1,
} as const;

/** Presets whose `role`/`promptId` are pinned by the preset, overriding any caller-supplied values. */
const WORKFLOW_PRESET_PINNED_FIELDS: Partial<Record<WorkflowPresetName, { role: string; promptId: string }>> = {
  implement: { role: "implement", promptId: "patch.prompt.body" },
  intent: { role: "plan", promptId: "intent.prompt.split" },
  plan: { role: "plan", promptId: "plan.prompt.draft" },
  "plan-reviewed": { role: "plan", promptId: "plan.prompt.draft" },
  "plan-reviewed-light": { role: "plan", promptId: "plan.prompt.draft" },
};

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

function landingFailedTerminalFailureDetail(message?: string): InvocationFailureDetail | undefined {
  if (message === undefined || message.length === 0) return undefined;
  return { failureKind: "error", bindingAttempts: [], message };
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

function settleCompletedPublication(store: StateStore, runId: string, prNumber?: number, prUrl?: string): void {
  store.commitTerminalRunSettlement({
    runId,
    status: "completed",
    terminalCause: "complete",
    ...(prNumber !== undefined ? { prNumber } : {}),
    ...(prUrl !== undefined ? { prUrl } : {}),
  });
}

type WorkflowPublicationFailureKind =
  | "completion_commit_failed"
  | "ready_gate_failed"
  | "ready_gate_command_missing"
  | "ready_gate_out_of_scope"
  | "ready_flip_failed"
  | "surviving_mutation_failed"
  | "runtime_smoke_failed";

function workflowPublicationFailureTerminalDetail(
  kind: WorkflowPublicationFailureKind,
  error?: Error,
): InvocationFailureDetail | undefined {
  if (kind === "surviving_mutation_failed") return terminalFailureDetailFromError(error);
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

function settleWorkflowPublicationFailure(
  store: StateStore,
  runId: string,
  kind: WorkflowPublicationFailureKind,
  error?: Error,
  prNumber?: number,
  prUrl?: string,
): void {
  // Only ready_flip_failed keeps the run completed (the commit landed; the draft→ready flip is a
  // post-completion PR-state fix). Every other publication failure kind — including
  // runtime_smoke_failed — settles failed, matching the resume path and the pre-atomic inline path.
  const terminalStatus = kind === "ready_flip_failed" ? "completed" : "failed";
  const terminalFailureDetail = workflowPublicationFailureTerminalDetail(kind, error);
  store.commitTerminalRunSettlement({
    runId,
    status: terminalStatus,
    terminalCause: kind,
    ...(terminalFailureDetail !== undefined ? { terminalFailureDetail } : {}),
    ...(prNumber !== undefined ? { prNumber } : {}),
    ...(prUrl !== undefined ? { prUrl } : {}),
  });
}

/** Post-implement-commit shrink outcomes that resume at the hidden `~shrink` row without re-invoking implement. */
export function isPostCommitShrinkResumableOutcome(
  result: Pick<WriteLoopResult, "kind"> & Partial<Pick<WriteLoopResult, "failureKind">>,
  artifact?: { worktreePath: string; expectedArtifactPath: string },
): boolean {
  if (result.kind === "contract_miss") return true;
  if (result.kind === "blocked") {
    if (artifact === undefined) return true;
    const artifactPath = join(artifact.worktreePath, artifact.expectedArtifactPath);
    if (!existsSync(artifactPath)) return true;
    const body = extractBlockerBody(readFileSync(artifactPath, "utf8"))?.body;
    return body === undefined || body.trim() === "";
  }
  return result.kind === "invocation_failure" && result.failureKind === "error";
}

function settlePostCommitShrinkForResume(
  store: StateStore,
  logSink: LogSink | undefined,
  shrinkResult: WriteLoopResult,
): WriteLoopResult {
  store.setRunStatus(shrinkResult.runId, "paused");
  if (shrinkResult.kind === "contract_miss" || shrinkResult.kind === "blocked") {
    logSink?.append(shrinkResult.runId, {
      kind: "loop_finished",
      loopOutcomeKind: shrinkResult.kind,
      iterationsConsumed: shrinkResult.iterationsConsumed,
      resumable: true,
    });
  }
  return { ...shrinkResult, resumable: true };
}

export type WorkflowPresetName = keyof typeof WORKFLOW_PRESET_LENGTHS;

export class LinkedIndexReadError extends Error {
  readonly indexPath: string;
  override readonly cause: unknown;

  constructor(indexPath: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to read linked routing index ${indexPath}: ${reason}`);
    this.name = "LinkedIndexReadError";
    this.indexPath = indexPath;
    this.cause = cause;
  }
}

const REVIEW_DEBATE_ROLES: readonly ReviewDebateRole[] = ["adversary", "advocate", "adjudicator", "actuator"];
const SHRINK_ROLE = "shrink";
const SHRINK_PROMPT_ID = "patch.prompt.shrink";
const SHRINK_STEP_ID_SUFFIX = "~shrink";

/** Per-step write-loop input plus workflow identity; bindings are derived at execution. */
export type WriteWorkflowStep = Omit<WriteLoopInput, "bindings"> & {
  behavior: "write";
  stepId: string;
  role: string;
  agents: readonly string[];
  agentModelConfig: AgentModelConfig;
  createBinding?: (binding: ResolvedAgentBinding) => InvocationBinding;
  landing?: PublicationLanding;
  /** Caller-recorded identity for an intent invocation. */
  workflowInvocationId?: string;
  /** Caller-supplied title for a newly created completion PR. */
  creationTitle?: string;
  /** Raw ready-intent content threaded from the plan builder; consumed by write-step seeding. */
  intentSeed?: string;
  /**
   * When set, `specPath` is an index of linked subspecs. Each iteration
   * re-resolves the first unchecked link, runs the write loop against it, and
   * on completion advances only that link's index checkbox before resolving
   * the next one — continuing until no unchecked link remains.
   */
  linkedIndexRouting?: boolean;
  /** Pinned by `resolveWorkflowPreset("implement", ...)` on all but the last of its resolved positions, so the post-completion shrink pass fires once per resolved preset, not once per position. */
  suppressShrink?: boolean;
  /** Resolved implement review behavior, stamped at workflow build time for snapshot retention. */
  implementReviewBehavior?: ImplementReviewBehavior;
  /** Identifies an admitted external plan so stale reset does not inspect it as worktree content. */
  externalPlanSpec?: true;
  /** Linked-index routing root when the spec tree lives outside the implement worktree. */
  specReadRoot?: string;
};

/** Per-role agent fallback orders for a `review-debate` step's four fixed debate roles. */
type ReviewDebateStepAgents = Record<ReviewDebateRole, readonly string[]>;

type ReviewStepAgents = Record<ReviewCycleRole, readonly string[]>;

/** Per-step review-debate input plus workflow identity; role bindings are derived at execution. */
export type ReviewDebateWorkflowStep = Omit<ReviewDebateInput, "bindings" | "onRoleStart"> & {
  stepId: string;
  behavior: "review-debate";
  project: string;
  branch: string;
  agents: ReviewDebateStepAgents;
  agentModelConfig: AgentModelConfig;
  createBinding?: (binding: ResolvedAgentBinding) => InvocationBinding;
  landing?: PublicationLanding;
  stagedMarkdownLintMaxReprompts?: number;
  /** Set only by plan-stage recovery: revalidate staged plan bytes immediately before landing. */
  revalidateStagedPlanBeforeLanding?: boolean;
  /** Identifies an admitted external plan whose markdown remains read-only during review. */
  externalPlanSpec?: true;
  /** External review prompt label root and recovery boundary. */
  specReadRoot?: string;
};

/** Per-step critic/actuator review input; bindings are derived at execution. */
export type ReviewWorkflowStep = Omit<ReviewCycleInput, "bindings" | "onRoleStart"> & {
  stepId: string;
  behavior: "review";
  project: string;
  branch: string;
  agents: ReviewStepAgents;
  agentModelConfig: AgentModelConfig;
  createBinding?: (binding: ResolvedAgentBinding) => InvocationBinding;
  landing?: PublicationLanding;
  stagedMarkdownLintMaxReprompts?: number;
  /** Set only by plan-stage recovery: revalidate staged plan bytes immediately before landing. */
  revalidateStagedPlanBeforeLanding?: boolean;
  /** Identifies an admitted external plan whose markdown remains read-only during review. */
  externalPlanSpec?: true;
  /** External review prompt label root and recovery boundary. */
  specReadRoot?: string;
};

/** Live/terminal progress for a review step's daemon-visible row, tracked in-memory only. */
export type ReviewProgress =
  | { status: "in_progress"; role: ReviewDebateRole | ReviewCycleRole }
  | {
      status: "completed" | "stopped";
      role: ReviewDebateRole | ReviewCycleRole;
      terminalOutcome: "complete" | "invocation_failure";
      attemptCount: number;
    };

export type ReviewDebateProgress = ReviewProgress;

/** One authored workflow step with durable run identity, dispatched on `behavior` at execution. */
export type WorkflowStep = WriteWorkflowStep;

export type AnyWorkflowStep = WorkflowStep | ReviewDebateWorkflowStep | ReviewWorkflowStep;

export type WorkflowStepInput = AnyWorkflowStep;

export type WorkflowResult = {
  kind: WriteLoopOutcomeKind | "pre-publication";
  stepIndex: number;
  stepId: string;
  runId: string;
  iterationsConsumed: number;
  resumable: boolean;
  commitSha?: string;
  completionCommitError?: string;
  readyGateError?: string;
  readyGateOutsidePaths?: string[];
  readyGateOutOfScopeDetail?: string;
  readyFlipError?: string;
  readyFlipPrNumber?: number;
  publicationFailure?: PublicationFailure;
  survivingMutation?: string;
  survivingMutationSourceFile?: string;
  survivingMutationSourceLine?: number;
  boundaryTelemetryFailure?: string;
  prePublicationError?: string;
  invocationFailureMessage?: string;
  /** Named linked-index routing diagnostic (`implement.<kind>`), set only for linked-index routing failures. */
  routingFailure?: string;
};

export type WorkflowRunnerInput = {
  steps: AnyWorkflowStep[];
  stateStore?: StateStore;
  logSink?: LogSink;
  /** Reports a review step's live/terminal role progress, keyed by `invocationId`+`stepId`. */
  onReviewDebateProgress?: (invocationId: string, stepId: string, progress: ReviewDebateProgress) => void;
  /** Shared telemetry context for every step's invocations; omitted emits no `invocation_completed` rows. */
  telemetry?: WorkflowTelemetryContext;
  /** Fires once a step's run row is durably created/resolved, before that step executes. */
  onStepRunCreated?: (stepIndex: number, runId: string) => void;
  completionCommitter?: CompletionCommitter;
  completionPublisher?: CompletionPublisher;
  readyFinalizer?: ReadyFinalizer;
  /** Test seam overriding shared `runFixCommand` during ready-gate repair autofix. */
  runFixCommand?: (opts: RunFixCommandOpts) => Promise<void>;
  /** When set, suppresses reuse of completed runs from prior invocations, forcing new run rows. */
  freshDispatch?: boolean;
};

function isWriteStep(step: AnyWorkflowStep): step is WriteWorkflowStep {
  return step.behavior === "write";
}

/** Telemetry `workflow` label inferred from the first write step in a preset. */
export function workflowTelemetryLabel(steps: readonly AnyWorkflowStep[]): string {
  const writeStep = steps.find(isWriteStep);
  if (writeStep === undefined) return "workflow";
  if (writeStep.promptId === "intent.prompt.split") return "intent";
  if (writeStep.role === "implement") return "implement";
  if (writeStep.promptId === "plan.prompt.draft") return "plan";
  return writeStep.stepId;
}

/** Validate preset step count and return the supplied steps unchanged. */
export function resolveWorkflowPreset(
  name: WorkflowPresetName,
  steps: Omit<WriteWorkflowStep, "behavior">[],
): WorkflowStep[] {
  const expected = WORKFLOW_PRESET_LENGTHS[name];
  if (expected === undefined) {
    throw new Error(`Unknown workflow preset: "${name}"`);
  }

  const isValid = Array.isArray(expected) ? expected.includes(steps.length) : steps.length === expected;

  if (!isValid) {
    const msg = Array.isArray(expected)
      ? `Workflow preset "${name}" requires ${expected.join(" or ")} steps, received ${steps.length}`
      : `Workflow preset "${name}" requires ${expected} steps, received ${steps.length}`;
    throw new Error(msg);
  }

  const pinned = WORKFLOW_PRESET_PINNED_FIELDS[name];
  return steps.map((step, index) => {
    const suppressShrink = name === "implement" && index < steps.length - 1 ? true : undefined;
    return {
      ...step,
      behavior: "write",
      ...(pinned ?? {}),
      ...(suppressShrink !== undefined ? { suppressShrink } : {}),
    } satisfies WorkflowStepInput;
  });
}

type PreparedWorkflowStep =
  | {
      kind: "completed";
      runId: string;
      completionAgent?: string;
    }
  | {
      kind: "pending";
      input: WriteLoopInput;
    };

/** Uniform per-step outcome shape, regardless of which behavior produced it. */
type WorkflowStepOutcome = {
  kind: WriteLoopOutcomeKind;
  runId: string;
  iterationsConsumed: number;
  resumable: boolean;
  routingFailure?: string;
  invocationFailureMessage?: string;
  /** False when linked implement completed without routing to an active subspec. */
  implementReviewEligible?: boolean;
  completionAgent?: string;
  /** 1-indexed reached review/review-debate pass whose actuator produced the tracked mutation;
   * absent for non-review outcomes and for a review dispatch that never mutated. */
  reviewPass?: number;
};

/** Dispatch one step to its behavior-specific executor and normalize the result. */
async function runWorkflowStep(
  step: AnyWorkflowStep,
  stepIndex: number,
  workflowSnapshot: WorkflowSnapshot,
  store: StateStore,
  logSink: LogSink | undefined,
  onReviewDebateProgress: ((invocationId: string, stepId: string, progress: ReviewDebateProgress) => void) | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  onStepRunCreated: ((stepIndex: number, runId: string) => void) | undefined,
  freshDispatch: boolean | undefined,
  touchedStepsInExecution: Set<string>,
  reviewPassCommitDeps: ReviewPassCommitDeps | undefined,
): Promise<WorkflowStepOutcome> {
  if (step.behavior === "review-debate" || step.behavior === "review") {
    return withExternalSpecTreeReadOnly(externalSpecGitScope(step), [step.verdictPath], () =>
      runReviewDispatch(
        step,
        stepIndex,
        workflowSnapshot,
        onReviewDebateProgress,
        telemetry,
        onStepRunCreated,
        store,
        logSink,
        freshDispatch,
        reviewPassCommitDeps,
      ),
    );
  }

  if (step.role === "implement" && step.linkedIndexRouting) {
    return runLinkedImplementStep(
      step,
      stepIndex,
      workflowSnapshot,
      store,
      logSink,
      telemetry,
      onStepRunCreated,
      freshDispatch,
      touchedStepsInExecution,
    );
  }

  const preparedStep = prepareWorkflowStep(
    step,
    workflowSnapshot,
    store,
    logSink,
    telemetry,
    freshDispatch,
    touchedStepsInExecution,
  );
  if (preparedStep.kind === "completed") {
    onStepRunCreated?.(stepIndex, preparedStep.runId);
    const stored = store.loadRun(preparedStep.runId);
    const stamp = stored ? boundaryStampFromStoredRun(stored) : undefined;
    return {
      kind: "complete",
      runId: preparedStep.runId,
      iterationsConsumed: 0,
      resumable: false,
      ...(preparedStep.completionAgent ? { completionAgent: preparedStep.completionAgent } : {}),
      ...(stamp !== undefined ? stamp : {}),
    };
  }

  touchedStepsInExecution.add(step.stepId);

  return executeWriteLoop(
    onStepRunCreated
      ? { ...preparedStep.input, onRunCreated: (runId) => onStepRunCreated(stepIndex, runId) }
      : preparedStep.input,
  );
}

/** Resolve `path` inside a materialized worktree. */
function resolveInWorktree(worktreePath: string, path: string): string {
  return isAbsolute(path) ? path : join(worktreePath, path);
}

function resolveLinkedImplementIndexPath(step: WriteWorkflowStep, worktreePath: string): string {
  if (step.externalPlanSpec === true) {
    return step.specPath;
  }
  return resolveInWorktree(worktreePath, step.specPath);
}

function resolveLinkedImplementRoutingRoot(step: WriteWorkflowStep, worktreePath: string): string {
  if (step.specReadRoot !== undefined) {
    return step.specReadRoot;
  }
  if (step.externalPlanSpec === true && isAbsolute(step.specPath)) {
    return dirname(step.specPath);
  }
  return worktreePath;
}

function resolveImplementSpecPathForPublication(step: WriteWorkflowStep, worktreePath: string): string {
  if (step.externalPlanSpec === true || step.specReadRoot === undefined) {
    return step.specPath;
  }
  const landed = landImplementSpecTreeFromReadRoot({
    worktreePath,
    specReadRoot: step.specReadRoot,
    specPath: step.specPath,
  });
  if (!landed.ok) {
    throw new Error(landed.error);
  }
  return landed.specPath;
}

function linkedImplementRoutingFailureOutcome(
  routing: Extract<LinkedIndexRoutingResult, { ok: false }>,
  totalIterationsConsumed: number,
  stepIndex: number,
  onStepRunCreated: ((stepIndex: number, runId: string) => void) | undefined,
): WorkflowStepOutcome {
  const runId = crypto.randomUUID();
  onStepRunCreated?.(stepIndex, runId);

  if (routing.errorKind === "empty_index" || routing.errorKind === "already_complete") {
    return {
      kind: "complete",
      runId,
      iterationsConsumed: totalIterationsConsumed,
      resumable: false,
      implementReviewEligible: false,
    };
  }
  return {
    kind: "blocked",
    runId,
    iterationsConsumed: totalIterationsConsumed,
    resumable: false,
    routingFailure: `implement.${routing.errorKind}: ${routing.error}`,
  };
}

async function runPreparedLinkedWriteStep(
  linkStep: WriteWorkflowStep,
  stepIndex: number,
  workflowSnapshot: WorkflowSnapshot,
  store: StateStore,
  logSink: LogSink | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  onStepRunCreated: ((stepIndex: number, runId: string) => void) | undefined,
  freshDispatch: boolean | undefined,
  touchedStepsInExecution: Set<string>,
  requiredIntegrationScope?: string,
): Promise<WorkflowStepOutcome> {
  const preparedLink = prepareWorkflowStep(
    linkStep,
    workflowSnapshot,
    store,
    logSink,
    telemetry,
    freshDispatch,
    touchedStepsInExecution,
  );
  if (preparedLink.kind === "completed") {
    onStepRunCreated?.(stepIndex, preparedLink.runId);
    const stored = store.loadRun(preparedLink.runId);
    const stamp = stored ? boundaryStampFromStoredRun(stored) : undefined;
    return {
      kind: "complete",
      runId: preparedLink.runId,
      iterationsConsumed: 0,
      resumable: false,
      ...(preparedLink.completionAgent ? { completionAgent: preparedLink.completionAgent } : {}),
      ...(stamp !== undefined ? stamp : {}),
    };
  }

  touchedStepsInExecution.add(linkStep.stepId);

  return executeWriteLoop(
    onStepRunCreated
      ? {
          ...preparedLink.input,
          onRunCreated: (runId) => onStepRunCreated(stepIndex, runId),
          ...(requiredIntegrationScope ? { requiredIntegrationScope } : {}),
        }
      : { ...preparedLink.input, ...(requiredIntegrationScope ? { requiredIntegrationScope } : {}) },
  );
}

function finalizeLinkedImplementPass(
  stepped: WorkflowStepOutcome,
  routing: Extract<LinkedIndexRoutingResult, { ok: true }>,
  beforeIndexContent: string,
  indexPath: string,
): WorkflowStepOutcome | undefined {
  const afterIndexContent = readFileSync(indexPath, "utf8");
  const finalized = completeLinkedSubspec(
    beforeIndexContent,
    afterIndexContent,
    { index: routing.active.index, isTerminal: routing.isTerminal },
    routing.active.body,
  );
  if (!finalized.ok) {
    writeFileSync(indexPath, beforeIndexContent, "utf8");
    return {
      ...stepped,
      kind: finalized.errorKind === "link_incomplete" ? "contract_miss" : "blocked",
      routingFailure: `implement.${finalized.errorKind}`,
    };
  }
  writeFileSync(indexPath, finalized.indexContent, "utf8");
  if (finalized.isTerminal) {
    return { ...stepped, implementReviewEligible: true };
  }
  return undefined;
}

/**
 * Drive one `implement` step across every criteria-incomplete linked subspec named by its
 * index (`specPath`). Each pass resolves the active link once, runs the write loop against it
 * with that link's path as the completion artifact, then — only once the write loop reports
 * `complete` — re-resolves that same pinned link (not a fresh selection) to read back the
 * agent's edits, verifies its non-human-only acceptance criteria, guards against agent-authored
 * edits to the index routing checklist, and advances only that link's checkbox before resolving
 * the next link. Returns as soon as a link produces a non-complete outcome, or once the terminal
 * link advances.
 */
async function runLinkedImplementStep(
  step: WriteWorkflowStep,
  stepIndex: number,
  workflowSnapshot: WorkflowSnapshot,
  store: StateStore,
  logSink: LogSink | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  onStepRunCreated: ((stepIndex: number, runId: string) => void) | undefined,
  freshDispatch: boolean | undefined,
  touchedStepsInExecution: Set<string>,
): Promise<WorkflowStepOutcome> {
  const worktreePath = getExternalWorktreePath(step.worktree);
  await (step.withExternalWorktree ?? realWithExternalWorktree)(step.worktree, () => undefined);
  const linkedProjectRoot = resolveLinkedImplementRoutingRoot(step, worktreePath);

  let totalIterationsConsumed = 0;

  for (;;) {
    const indexPath = resolveLinkedImplementIndexPath(step, worktreePath);

    let beforeIndexContent: string;
    try {
      beforeIndexContent = readFileSync(indexPath, "utf8");
    } catch (error) {
      throw new LinkedIndexReadError(indexPath, error);
    }
    const routing = resolveActiveLinkedSubspec(indexPath, linkedProjectRoot);
    if (!routing.ok) {
      return linkedImplementRoutingFailureOutcome(routing, totalIterationsConsumed, stepIndex, onStepRunCreated);
    }

    const linkStep: WriteWorkflowStep = {
      ...step,
      stepId: `${step.stepId}~link-${routing.active.index}`,
      expectedArtifactPath: routing.active.path,
    };

    const outcome = await runPreparedLinkedWriteStep(
      linkStep,
      stepIndex,
      workflowSnapshot,
      store,
      logSink,
      telemetry,
      onStepRunCreated,
      freshDispatch,
      touchedStepsInExecution,
      routing.active.requiredIntegrationScope,
    );

    totalIterationsConsumed += outcome.iterationsConsumed;
    const stepped: WorkflowStepOutcome = { ...outcome, iterationsConsumed: totalIterationsConsumed };

    if (outcome.kind !== "complete") {
      return stepped;
    }

    const pinnedRouting = resolvePinnedLinkedSubspec(indexPath, linkedProjectRoot, routing.active.index);
    if (!pinnedRouting.ok) {
      return linkedImplementRoutingFailureOutcome(pinnedRouting, totalIterationsConsumed, stepIndex, onStepRunCreated);
    }

    const finalized = finalizeLinkedImplementPass(stepped, pinnedRouting, beforeIndexContent, indexPath);
    if (finalized !== undefined) {
      return finalized;
    }
  }
}

/**
 * Execute a multi-step workflow: run each step's behavior to completion before
 * advancing. A non-complete outcome stops at that step.
 *
 * Role bindings are validated for every step before any durable state change,
 * including on resume against the config loaded at that time.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: step ordering and final publication are one boundary.
export async function executeWorkflow(args: WorkflowRunnerInput): Promise<WorkflowResult> {
  if (args.steps.length === 0) {
    throw new Error("Workflow requires at least one step");
  }

  const stepIds = new Set<string>();
  for (const step of args.steps) {
    if (stepIds.has(step.stepId)) {
      throw new Error(`Duplicate stepId in workflow: "${step.stepId}"`);
    }
    stepIds.add(step.stepId);
  }

  validateWorkflowStepRoles(args.steps);

  const store = args.stateStore ?? openStateStore();

  try {
    let totalIterationsConsumed = 0;
    let lastResult: WorkflowStepOutcome | undefined;
    let lastStepId = "";
    let completionAgent: string | undefined;
    let shrinkNarrative: string | undefined;
    let boundaryTelemetryFailure: string | undefined;
    let implementReviewEligible = false;
    const touchedStepsInExecution = new Set<string>();
    const workflowSnapshot = buildWorkflowSnapshot(args.steps, store, args.freshDispatch);
    const reviewPassCommitDeps = buildReviewPassCommitDeps(args, workflowSnapshot);

    for (let stepIndex = 0; stepIndex < args.steps.length; stepIndex++) {
      const step = args.steps[stepIndex];
      if (!step) throw new Error("Unreachable: step undefined in bounded loop");

      if (
        (step.behavior === "review-debate" || step.behavior === "review") &&
        step.profile?.domain === "implement" &&
        args.steps.some((candidate) => candidate.behavior === "write" && candidate.role === "implement") &&
        !implementReviewEligible
      ) {
        continue;
      }

      if (step.behavior === "write" && step.role === "implement" && !step.suppressShrink) {
        await (step.withExternalWorktree ?? realWithExternalWorktree)(step.worktree, () => undefined);
      }

      const stepResult = await runWorkflowStep(
        step,
        stepIndex,
        workflowSnapshot,
        store,
        args.logSink,
        args.onReviewDebateProgress,
        args.telemetry,
        args.onStepRunCreated,
        args.freshDispatch,
        touchedStepsInExecution,
        reviewPassCommitDeps,
      );
      totalIterationsConsumed += stepResult.iterationsConsumed;
      lastResult = stepResult;
      lastStepId = step.stepId;
      if (stepResult.kind === "complete") {
        if ((stepResult as WriteLoopResult).completionAgent) {
          completionAgent = (stepResult as WriteLoopResult).completionAgent;
        } else if (stepResult.completionAgent) {
          completionAgent = stepResult.completionAgent;
        }
      }
      if (step.behavior === "write" && step.role === "implement" && stepResult.kind === "complete") {
        implementReviewEligible = stepResult.implementReviewEligible !== false;
      }

      if (stepResult.kind !== "complete") {
        return {
          kind: stepResult.kind,
          stepIndex,
          stepId: step.stepId,
          runId: stepResult.runId,
          iterationsConsumed: totalIterationsConsumed,
          resumable: stepResult.resumable,
          ...(stepResult.routingFailure !== undefined ? { routingFailure: stepResult.routingFailure } : {}),
          ...(stepResult.invocationFailureMessage !== undefined
            ? { invocationFailureMessage: stepResult.invocationFailureMessage }
            : {}),
        };
      }

      if (step.behavior === "write" && step.role === "implement" && !step.suppressShrink && implementReviewEligible) {
        const worktreePath = getExternalWorktreePath(step.worktree);
        let shrinkResult = await runShrinkAfterImplementComplete(
          step,
          stepIndex,
          workflowSnapshot,
          store,
          args.logSink,
          args.telemetry,
          args.onStepRunCreated,
          args.freshDispatch,
          touchedStepsInExecution,
        );
        totalIterationsConsumed += shrinkResult.iterationsConsumed;
        lastResult = shrinkResult;
        lastStepId = step.stepId;
        const postCommitShrinkResumable = isPostCommitShrinkResumableOutcome(shrinkResult, {
          worktreePath,
          expectedArtifactPath: step.expectedArtifactPath,
        });
        if (postCommitShrinkResumable) {
          // The implement output is already checkpointed. Leave only this shrink run resumable.
          shrinkResult = settlePostCommitShrinkForResume(store, args.logSink, shrinkResult);
        }
        if (shrinkResult.kind === "complete" && (shrinkResult as WriteLoopResult).completionAgent) {
          completionAgent = (shrinkResult as WriteLoopResult).completionAgent;
        }
        if (shrinkResult.kind === "complete") {
          shrinkNarrative = tryReadShrinkNarrative(getExternalWorktreePath(step.worktree));
        }
        if (shrinkResult.kind !== "complete") {
          return {
            kind: shrinkResult.kind,
            stepIndex,
            stepId: step.stepId,
            runId: shrinkResult.runId,
            iterationsConsumed: totalIterationsConsumed,
            resumable: shrinkResult.resumable,
          };
        }
      }
    }

    if (!lastResult) throw new Error("Unreachable: lastResult undefined after checked bounds");

    let publicationSpecPath: string | undefined;
    const completionStep = [...args.steps].reverse().find(isWriteStep);
    const lastStep = args.steps[args.steps.length - 1];
    const isReviewLastStep = lastStep?.behavior === "review" || lastStep?.behavior === "review-debate";
    const writeStepRun = completionStep
      ? store.findRunByProjectBranch({
          project: completionStep.worktree.projectName,
          branch: completionStep.worktree.branchName,
          stepId: completionStep.stepId,
        })
      : null;
    const durableWriteAgent = writeStepRun ? reviewCompletionAgent(writeStepRun) : undefined;
    // A reviewed-last workflow's completion tail must still commit/push/PR when the critic
    // approved with an empty verdict and the review step's actuator never ran (no
    // `completionAgent` from that step). Attribute to the write step's own durably recorded
    // completion agent — the agent that actually ran it — falling back to the write step's
    // configured agent only when no durable record exists, so publication is never silently
    // skipped because the actuator was skipped.
    const boundaryAgent =
      lastResult.kind === "complete"
        ? (completionAgent ?? (isReviewLastStep ? (durableWriteAgent ?? completionStep?.agents[0]) : undefined))
        : undefined;
    // A re-dispatched completed run (e.g. its durable rows reused without a recorded completion
    // agent) can leave the boundary unresolved even though the branch already carries real,
    // attributed commits. Fall back to the newest `Jarvis-Agent` trailer on the branch so
    // publication is not silently skipped for identity alone.
    const publicationAgent =
      lastResult.kind === "complete"
        ? boundaryAgent === undefined
          ? await branchCommitAgent(completionStep)
          : boundaryAgent
        : boundaryAgent;

    // The publication tail always writes status/log records against `lastResult.runId`. When the
    // last step is non-durable (e.g. a light review with no landing), that id is a synthesized
    // `crypto.randomUUID()` with no durable row. Redirect the tail to settle the completion step's
    // durable row instead — its hidden `~shrink` row when one exists, else its own row — so the
    // terminal record lands somewhere `run wait` can actually see.
    if (lastStep !== undefined && !isDurableWorkflowStep(lastStep) && completionStep !== undefined) {
      const settleWorktree = completionStep.worktree;
      const shrinkRun = store.findRunByProjectBranch({
        project: settleWorktree.projectName,
        branch: settleWorktree.branchName,
        stepId: `${completionStep.stepId}${SHRINK_STEP_ID_SUFFIX}`,
      });
      const settleRun =
        shrinkRun ??
        store.findRunByProjectBranch({
          project: settleWorktree.projectName,
          branch: settleWorktree.branchName,
          stepId: completionStep.stepId,
        });
      if (settleRun !== null) {
        lastResult = { ...lastResult, runId: settleRun.id };
      }
    }

    // A reviewed-last workflow that completed with no resolvable publication agent (no durable
    // record and no configured write-step agent) must fail visibly rather than silently return
    // `complete` with the commit/push/PR tail skipped.
    if (
      lastResult.kind === "complete" &&
      isReviewLastStep &&
      completionStep !== undefined &&
      publicationAgent === undefined &&
      completionStep.publishCompletion !== false
    ) {
      const message = "no completion agent available to attribute the publication commit";
      store.commitTerminalRunSettlement({
        runId: lastResult.runId,
        status: "failed",
        terminalCause: "invocation_failure",
        terminalFailureDetail: terminalFailureDetailFromError(undefined, message),
      });
      args.logSink?.append(lastResult.runId, {
        kind: "loop_finished",
        loopOutcomeKind: "invocation_failure",
        iterationsConsumed: totalIterationsConsumed,
        resumable: true,
      });
      traceCompletionPublication(
        args.logSink,
        lastResult.runId,
        completionStep?.landing,
        completionStep?.worktree.branchName ?? "",
        `invocation_failure: ${message}`,
      );
      return {
        kind: "invocation_failure",
        stepIndex: args.steps.length - 1,
        stepId: lastStepId,
        runId: lastResult.runId,
        iterationsConsumed: totalIterationsConsumed,
        resumable: true,
        invocationFailureMessage: message,
      };
    }

    // For reviewed workflows, landing is deferred until after review completes.
    // Skip landing if the last step is a review step; it will be handled after review.
    if (
      publicationAgent !== undefined &&
      completionStep?.landing !== undefined &&
      completionStep.landing.kind !== "none" &&
      !isReviewLastStep
    ) {
      const worktreePath = getExternalWorktreePath(completionStep.worktree);
      try {
        const landed = await landPublication(completionStep.landing, worktreePath);
        publicationSpecPath = landed.specPath;
        persistIntentHandoff(
          store,
          completionStep.landing,
          landed,
          completionStep.worktree.projectName,
          completionStep.worktree.branchName,
          completionStep.stepId,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const landingDetail = landingFailedTerminalFailureDetail(message);
        store.commitTerminalRunSettlement({
          runId: lastResult.runId,
          status: "failed",
          terminalCause: "landing_failed",
          ...(landingDetail !== undefined ? { terminalFailureDetail: landingDetail } : {}),
        });
        args.logSink?.append(lastResult.runId, {
          kind: "loop_finished",
          loopOutcomeKind: "landing_failed",
          iterationsConsumed: totalIterationsConsumed,
          resumable: true,
        });
        traceCompletionPublication(
          args.logSink,
          lastResult.runId,
          completionStep.landing,
          completionStep.worktree.branchName,
          `landing_failed: ${message}`,
        );
        return {
          kind: "pre-publication",
          stepIndex: args.steps.length - 1,
          stepId: lastStepId,
          runId: lastResult.runId,
          iterationsConsumed: totalIterationsConsumed,
          resumable: true,
          prePublicationError: message,
        };
      }
    }
    if (publicationAgent !== undefined && completionStep?.publishCompletion !== false) {
      if (completionStep) {
        const worktree = completionStep.worktree;
        const worktreePath = getExternalWorktreePath(worktree);
        const landedSpecPath =
          completionStep.role === "implement"
            ? resolveImplementSpecPathForPublication(completionStep, worktreePath)
            : undefined;
        if (landedSpecPath !== undefined) {
          completionStep.specPath = landedSpecPath;
        }
        const publicationPath =
          publicationSpecPath ?? landedSpecPath ?? writeStepRun?.specPath ?? completionStep.specPath;
        try {
          const creationTitle = resolvePublicationTitle(worktreePath, publicationPath, workflowSnapshot.creationTitle);
          store.setCreationTitle(lastResult.runId, creationTitle);
          const completionRun = store.findRunByProjectBranch({
            project: worktree.projectName,
            branch: worktree.branchName,
            stepId: completionStep.stepId,
          });
          if (completionRun !== null) store.setCreationTitle(completionRun.id, creationTitle);
          // A review commit belongs to the latest pass that left the tracked mutation in this
          // publication; a non-mutating later pass (approval, no actuator) never reassigns it.
          const commitStep: CompletionStepMetadata | undefined =
            isReviewLastStep && lastResult.reviewPass !== undefined
              ? {
                  kind: lastStep?.behavior === "review-debate" ? "review-debate" : "review",
                  pass: lastResult.reviewPass,
                }
              : undefined;
          // The gate below suppresses publication only when the diff against base was positively
          // read back empty. Every state where the diff can't be evaluated at all — an
          // unresolvable base, a fake commitSha from a test double, a non-Git worktreePath —
          // resolves to "changed" instead, preserving the pre-change always-publish behavior
          // rather than guessing.
          const worktreeHasGit = existsSync(join(worktreePath, ".git"));
          const headBeforeCompletionCommit = worktreeHasGit ? await getCurrentHeadAsync(worktreePath) : undefined;
          const published = await (args.completionCommitter ?? createCompletionCommitter())({
            worktreePath,
            baseRef: worktree.baseRef,
            specPath: publicationPath,
            agent: publicationAgent,
            title: commitStep !== undefined ? renderStepCommitTitle(commitStep, creationTitle) : creationTitle,
            iterationTimeoutMs: completionStep.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS,
            ...externalSpecGitScope(completionStep),
            ...(commitStep !== undefined ? { step: commitStep } : {}),
          });
          const publicationSha = published.commitSha ?? headBeforeCompletionCommit;
          const baseDiffOutcome =
            publicationSha !== undefined
              ? await readDiffOutcome(worktreePath, worktree.baseRef, publicationSha)
              : "changed";
          if (published.commitSha === undefined) {
            const uncommitted = await getUncommittedPaths(worktreePath, completionStep);
            const remainingStaged = remainingStagedIntentPaths(worktreePath, completionStep.landing);
            const namedPaths = [...new Set([...uncommitted, ...remainingStaged])];
            if (namedPaths.length > 0) {
              const uncommittedChangesMessage = `Uncommitted changes: ${namedPaths.join(", ")}`;
              settleWorkflowPublicationFailure(
                store,
                lastResult.runId,
                "completion_commit_failed",
                new Error(uncommittedChangesMessage),
              );
              args.logSink?.append(lastResult.runId, {
                kind: "loop_finished",
                loopOutcomeKind: "completion_commit_failed",
                iterationsConsumed: totalIterationsConsumed,
                resumable: true,
                completionCommitError: uncommittedChangesMessage,
              });
              traceCompletionPublication(
                args.logSink,
                lastResult.runId,
                completionStep.landing,
                worktree.branchName,
                `completion_commit_failed: uncommitted changes: ${namedPaths.join(", ")}`,
              );
              return {
                kind: "completion_commit_failed",
                stepIndex: args.steps.length - 1,
                stepId: lastStepId,
                runId: lastResult.runId,
                iterationsConsumed: totalIterationsConsumed,
                resumable: true,
                completionCommitError: `Uncommitted changes: ${namedPaths.join(", ")}`,
              };
            }
          }
          if (published.commitSha !== undefined && baseDiffOutcome === "empty") {
            // A legacy pending completion may still return an empty marker commit. Roll it back
            // only when it is also a no-op against its own parent; a real revert stays intact.
            await suppressContentEmptyCompletionCommit(worktreePath, published.commitSha, headBeforeCompletionCommit);
            traceCompletionPublication(
              args.logSink,
              lastResult.runId,
              completionStep.landing,
              worktree.branchName,
              "no_content_ahead_of_base: completion commit matches base, nothing to publish",
            );
          }
          if (publicationSha !== undefined && baseDiffOutcome !== "empty") {
            const stamped = lastResult as WriteLoopResult;
            if (published.commitSha !== undefined) stamped.commitSha = published.commitSha;
            if (
              published.commitSha !== undefined &&
              published.filesChanged !== undefined &&
              stamped.attemptId !== undefined &&
              stamped.outcomeKind !== undefined &&
              stamped.runStatus !== undefined
            ) {
              const failure = emitWorkBoundaryRecorded(
                args.telemetry,
                {
                  runId: stamped.runId,
                  attemptId: stamped.attemptId,
                  outcomeKind: stamped.outcomeKind,
                  runStatus: stamped.runStatus,
                },
                { commitSha: published.commitSha, filesChanged: published.filesChanged },
              );
              if (failure !== undefined) {
                boundaryTelemetryFailure = failure;
              }
            }
            let bodySummary: string | undefined;
            let specTemplate = false;
            if (completionStep.landing?.kind === "intent-stage") {
              bodySummary = deriveIntentRunBodySummary({
                creationTitle: workflowSnapshot.creationTitle,
                intentFiles: await listLandedIntentFiles(worktreePath, workflowSnapshot.invocationId),
              });
            } else if (
              completionStep.landing?.kind === "plan-tree" ||
              completionStep.promptId === "plan.prompt.draft" ||
              completionStep.role === "implement"
            ) {
              specTemplate = true;
              bodySummary = await deriveSpecRunBodySummary({
                worktreePath,
                specPath: publicationSpecPath ?? completionStep.specPath,
                baseRef: worktree.baseRef,
                ...externalSpecGitScope(completionStep),
              });
            }
            const repairInput = buildCompletionStepWriteLoopInput(completionStep, workflowSnapshot, args, store);
            store.setRunStatus(lastResult.runId, "in-progress");
            const publication = await publishWithReadyRepair(
              repairInput,
              store,
              lastResult as WriteLoopResult,
              totalIterationsConsumed,
              {
                worktreePath,
                baseRef: worktree.baseRef,
                specPath: publicationPath,
                branch: worktree.branchName,
                creationTitle,
                ...externalSpecGitScope(completionStep),
                ...(bodySummary !== undefined ? { bodySummary } : {}),
                ...(specTemplate ? { specTemplate } : {}),
                ...(shrinkNarrative !== undefined ? { narrative: shrinkNarrative } : {}),
              },
            );
            totalIterationsConsumed = publication.iterationsConsumed;
            if (publication.failure !== undefined) {
              if (completionStep.signal?.aborted) {
                return {
                  kind: "progress",
                  stepIndex: args.steps.length - 1,
                  stepId: lastStepId,
                  runId: lastResult.runId,
                  iterationsConsumed: totalIterationsConsumed,
                  resumable: true,
                };
              }
              appendRuntimeSmokeOutcome(args.logSink, lastResult.runId, publication.failure.runtimeSmokeOutcome);
              const publicationFailure = publicationFailureFor(publication.failure.error);
              const isFlipFailure = publication.failure.kind === "ready_flip_failed";
              const isGateFailure =
                publication.failure.kind === "ready_gate_failed" ||
                publication.failure.kind === "ready_gate_command_missing" ||
                publication.failure.kind === "ready_gate_out_of_scope";
              const gateOutOfScopeFields = readyGateOutOfScopeLogFields(publication.failure.error);
              const priorRecords = priorLogRecordsFromSink(args.logSink, lastResult.runId);
              const publicationResumable =
                publication.failure.kind === "ready_gate_out_of_scope"
                  ? outOfScopeSettlementResumable(gateOutOfScopeFields.readyGateOutsidePaths, priorRecords)
                  : publication.failure.kind === "ready_gate_command_missing"
                    ? false
                    : !isFlipFailure;
              const publicationLoopFinishedBase = {
                kind: "loop_finished" as const,
                iterationsConsumed: totalIterationsConsumed,
                resumable: publicationResumable,
                ...survivingMutationLogFields(publication.failure.error),
                ...gateOutOfScopeFields,
                ...readyGateFailureLogFields(publication.failure.kind, publication.failure.error),
                ...exhaustedRedTerminalLogFields(publication.readyGateOrigin),
                ...(publicationFailure !== undefined ? { publicationFailure } : {}),
              };
              if (publication.failure.kind === "completion_commit_failed") {
                const publicationCommitErrorMessage = publication.failure.error?.message ?? "completion commit failed";
                args.logSink?.append(lastResult.runId, {
                  ...publicationLoopFinishedBase,
                  loopOutcomeKind: "completion_commit_failed",
                  completionCommitError: publicationCommitErrorMessage,
                });
              } else {
                args.logSink?.append(lastResult.runId, {
                  ...publicationLoopFinishedBase,
                  loopOutcomeKind: publication.failure.kind,
                });
              }
              // The row was marked `in-progress` for the finalization tail, so both branches must
              // restore a terminal status. A flip failure keeps its documented `completed` status;
              // leaving `in-progress` strands it non-live and hangs `run wait`.
              settleWorkflowPublicationFailure(
                store,
                lastResult.runId,
                publication.failure.kind,
                publication.failure.error,
                publication.failure.prNumber,
                publication.failure.prUrl,
              );
              traceCompletionPublication(
                args.logSink,
                lastResult.runId,
                completionStep.landing,
                worktree.branchName,
                `${publication.failure.kind}: ${publication.failure.error?.message ?? "publication failed"}`,
              );
              return {
                kind: publication.failure.kind,
                stepIndex: args.steps.length - 1,
                stepId: lastStepId,
                runId: lastResult.runId,
                iterationsConsumed: totalIterationsConsumed,
                resumable: publicationResumable,
                ...(isGateFailure
                  ? {
                      readyGateError:
                        publication.failure.kind === "ready_gate_out_of_scope"
                          ? (gateOutOfScopeFields.readyGateOutOfScopeDetail ??
                            publication.failure.error?.message ??
                            "ready gate failed")
                          : (publication.failure.error?.message ?? "ready gate failed"),
                      ...gateOutOfScopeFields,
                    }
                  : isFlipFailure
                    ? {
                        readyFlipError: publication.failure.error?.message ?? "ready flip failed",
                        ...(publication.failure.prNumber !== undefined
                          ? { readyFlipPrNumber: publication.failure.prNumber }
                          : {}),
                      }
                    : publication.failure.kind === "surviving_mutation_failed"
                      ? survivingMutationLogFields(publication.failure.error)
                      : { completionCommitError: publication.failure.error?.message ?? "completion commit failed" }),
                ...(publicationFailure !== undefined ? { publicationFailure } : {}),
              };
            }
            appendRuntimeSmokeOutcome(args.logSink, lastResult.runId, publication.success?.runtimeSmokeOutcome);
            if (
              publication.success !== undefined &&
              publication.success.prNumber !== undefined &&
              publication.success.prUrl !== undefined
            ) {
              settleCompletedPublication(
                store,
                lastResult.runId,
                publication.success.prNumber,
                publication.success.prUrl,
              );
            } else {
              settleCompletedPublication(store, lastResult.runId);
            }
            traceCompletionPublication(args.logSink, lastResult.runId, completionStep.landing, worktree.branchName);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const completionCommitErrorMessage = message;
          settleWorkflowPublicationFailure(
            store,
            lastResult.runId,
            "completion_commit_failed",
            error instanceof Error ? error : new Error(message),
          );
          args.logSink?.append(lastResult.runId, {
            kind: "loop_finished",
            loopOutcomeKind: "completion_commit_failed",
            iterationsConsumed: totalIterationsConsumed,
            resumable: true,
            completionCommitError: completionCommitErrorMessage,
          });
          traceCompletionPublication(
            args.logSink,
            lastResult.runId,
            completionStep.landing,
            worktree.branchName,
            `completion_commit_failed: ${message}`,
          );
          return {
            kind: "completion_commit_failed",
            stepIndex: args.steps.length - 1,
            stepId: lastStepId,
            runId: lastResult.runId,
            iterationsConsumed: totalIterationsConsumed,
            resumable: true,
            completionCommitError: message,
          };
        }
      }
    }
    return {
      kind: "complete",
      stepIndex: args.steps.length - 1,
      stepId: lastStepId,
      runId: lastResult.runId,
      iterationsConsumed: totalIterationsConsumed,
      resumable: false,
      ...((lastResult as WriteLoopResult).commitSha !== undefined
        ? { commitSha: (lastResult as WriteLoopResult).commitSha }
        : {}),
      ...(boundaryTelemetryFailure !== undefined ? { boundaryTelemetryFailure } : {}),
    };
  } finally {
    if (!args.stateStore) {
      store.close();
    }
  }
}

/**
 * Fall back to the branch's own commit attribution when a completed boundary resolves no
 * publishing identity — e.g. a re-dispatched implement whose durable rows were reused without a
 * recorded completion agent. Newest attributed commit wins; an unreadable branch or a branch
 * whose commits carry no `Jarvis-Agent` trailer resolves no identity rather than inventing one.
 */
async function branchCommitAgent(step: WriteWorkflowStep | undefined): Promise<string | undefined> {
  if (step === undefined) return undefined;
  try {
    const commits = await readBranchCommits({
      cwd: getExternalWorktreePath(step.worktree),
      base: step.worktree.baseRef,
    });
    return [...commits]
      .reverse()
      .flatMap((c) => c.jarvisAgentTrailers)
      .find((agent) => agent.length > 0);
  } catch {
    return undefined;
  }
}

/**
 * Trace the workflow-completion publication tail's finalization attempt, scoped to intent
 * workflows (the other landing kinds — plan-tree, none — aren't this subspec's concern).
 */
function traceCompletionPublication(
  logSink: LogSink | undefined,
  runId: string,
  landing: WriteWorkflowStep["landing"],
  branch: string,
  stopReason?: string,
): void {
  if (landing?.kind !== "intent-stage") return;
  recordIntentFinalization(logSink, runId, "completion_publication", branch, stopReason);
}

/**
 * Staged intent files a no-commitSha publication attempt left behind. A committer can report no
 * new commit while `git status` shows no uncommitted changes (e.g. the stage was tracked but the
 * commit itself never landed) — this catches that gap so a populated stage never settles `done`.
 */
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

/** Fail before durable state changes if any step role is missing from its agent config. */
export function validateWorkflowStepRoles(steps: readonly AnyWorkflowStep[]): void {
  const missingBindings = steps.flatMap((step) => missingWorkflowStepRoleBindings(step));

  if (missingBindings.length > 0) {
    throw new Error(`Workflow step role validation failed: ${missingBindings.join(", ")}`);
  }
}

function missingWorkflowStepRoleBindings(step: AnyWorkflowStep): string[] {
  if (isWriteStep(step)) return missingWriteStepRoleBindings(step);
  if (step.behavior === "review-debate") return missingReviewDebateStepRoleBindings(step);
  return missingReviewStepRoleBindings(step);
}

function missingWriteStepRoleBindings(step: WriteWorkflowStep): string[] {
  const roles = step.role === "implement" ? [step.role, SHRINK_ROLE] : [step.role];
  return step.agents.flatMap((agent) => missingAgentRoleBindings(step, agent, roles));
}

function missingReviewDebateStepRoleBindings(step: ReviewDebateWorkflowStep): string[] {
  return REVIEW_DEBATE_ROLES.flatMap((role) =>
    step.agents[role].flatMap((agent) => missingAgentRoleBindings(step, agent, [role])),
  );
}

function missingReviewStepRoleBindings(step: ReviewWorkflowStep): string[] {
  return (["critic", "actuator"] as const).flatMap((role) =>
    step.agents[role].flatMap((agent) => missingAgentRoleBindings(step, agent, [role])),
  );
}

function missingAgentRoleBindings(
  step: WriteWorkflowStep | ReviewDebateWorkflowStep | ReviewWorkflowStep,
  agent: string,
  roles: readonly string[],
): string[] {
  return roles
    .filter((role) => !hasAgentRoleBinding(step.agentModelConfig, agent, role))
    .map((role) => `(${step.stepId}, ${role}, ${agent})`);
}

function hasAgentRoleBinding(agentModelConfig: AgentModelConfig, agent: string, role: string): boolean {
  const agentEntry = agentModelConfig[agent];
  return agentEntry !== undefined && Object.hasOwn(agentEntry, role);
}

/** Shared row-persistence policy used for both execution and workflow snapshots. */
function isDurableWorkflowStep(
  step: ReviewDebateWorkflowStep | ReviewWorkflowStep,
): step is ReviewWorkflowStep & { landing: Extract<PublicationLanding, { kind: "intent-stage" }> };
function isDurableWorkflowStep(step: AnyWorkflowStep): boolean;
function isDurableWorkflowStep(step: AnyWorkflowStep): boolean {
  return (
    step.behavior === "write" ||
    step.behavior === "review-debate" ||
    (step.behavior === "review" && step.landing !== undefined && step.landing.kind !== "none")
  );
}

/**
 * Every step, including review behaviors, contributes an entry to the shared snapshot
 * so the daemon's `list` handler can render a row for it. The shared durability
 * policy is captured with each step so status readers do not infer persistence from
 * behavior names. Non-durable steps are excluded from existing-run lookup.
 */
function buildWorkflowSnapshot(
  steps: readonly AnyWorkflowStep[],
  store: StateStore,
  freshDispatch?: boolean,
): WorkflowSnapshot {
  const requestedInvocationId = steps.find(isWriteStep)?.workflowInvocationId;
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: linear per-step mapping resolving durable/write-step identity; extraction would split the 1:1 step-to-snapshot mapping across helpers and obscure it
  const authoredSteps = steps.map((step) => ({
    stepId: step.stepId,
    role: step.behavior === "write" ? step.role : "",
    durable: isDurableWorkflowStep(step),
    ...(step.behavior === "review-debate" || step.behavior === "review"
      ? { behavior: step.behavior as "review-debate" | "review" }
      : {}),
    ...(step.behavior === "write"
      ? {
          stepRules: step.stepRules,
          expectedArtifactPath: step.expectedArtifactPath,
          ...(step.promptId !== undefined ? { promptId: step.promptId } : {}),
          ...(step.promptPlaceholders !== undefined ? { promptPlaceholders: step.promptPlaceholders } : {}),
          agents: step.agents,
          agentModelConfig: step.agentModelConfig,
          iterationTimeoutMs: step.iterationTimeoutMs,
          iterationCeilingMs: step.iterationCeilingMs,
          idleOutputMs: step.idleOutputMs,
          ...(step.fixCommand !== undefined ? { fixCommand: step.fixCommand } : {}),
          ...(step.readyCommand !== undefined ? { readyCommand: step.readyCommand } : {}),
          ...(step.externalPlanSpec === true ? { externalPlanSpec: true as const } : {}),
          ...(step.specReadRoot !== undefined ? { specReadRoot: step.specReadRoot } : {}),
        }
      : {}),
  }));

  // When freshDispatch is set, skip reusing prior invocation's snapshot and mint a new invocationId
  if (!freshDispatch) {
    const identifiableSteps = steps.filter(isDurableWorkflowStep);
    for (const step of identifiableSteps) {
      const { project, branch } =
        step.behavior === "write" ? { project: step.worktree.projectName, branch: step.worktree.branchName } : step;
      const existingRun = store.findRunByProjectBranch({ project, branch, stepId: step.stepId });
      const candidate = existingRun?.workflowSnapshot;
      if (candidate !== null && candidate !== undefined && snapshotMatchesAuthoredSteps(candidate, authoredSteps)) {
        if (requestedInvocationId !== undefined && candidate.invocationId !== requestedInvocationId) {
          throw new Error("intent: existing workflow is owned by another invocation; resume the recorded invocation");
        }
        return candidate.creationTitle !== undefined || !existingRun?.creationTitle
          ? candidate
          : { ...candidate, creationTitle: existingRun.creationTitle };
      }
    }
  }

  return {
    invocationId: requestedInvocationId ?? crypto.randomUUID(),
    steps: authoredSteps,
    ...workflowCreationTitleField(steps),
    ...implementReviewPassesField(steps),
    ...implementReviewBehaviorField(steps),
  };
}

function workflowCreationTitleField(
  steps: readonly AnyWorkflowStep[],
): { creationTitle: string } | Record<string, never> {
  const writeStep = steps.find(isWriteStep);
  const creationTitle = writeStep?.creationTitle;
  return creationTitle === undefined ? {} : { creationTitle };
}

/** Retains the resolved implement review count on the workflow snapshot when applicable. */
function implementReviewPassesField(
  steps: readonly AnyWorkflowStep[],
): { reviewPasses: number } | Record<string, never> {
  const reviewPasses = implementReviewPassesFromSteps(steps);
  return reviewPasses === undefined ? {} : { reviewPasses };
}

/** Retains the resolved implement review behavior on the workflow snapshot when applicable. */
function implementReviewBehaviorField(
  steps: readonly AnyWorkflowStep[],
): { reviewBehavior: ImplementReviewBehavior } | Record<string, never> {
  const reviewBehavior = implementReviewBehaviorFromSteps(steps);
  return reviewBehavior === undefined ? {} : { reviewBehavior };
}

function implementReviewBehaviorFromSteps(steps: readonly AnyWorkflowStep[]): ImplementReviewBehavior | undefined {
  const implementStep = steps.find(
    (step): step is WriteWorkflowStep =>
      step.behavior === "write" && step.role === "implement" && step.suppressShrink !== true,
  );
  if (implementStep === undefined) return undefined;
  return implementStep.implementReviewBehavior;
}

function implementReviewPassesFromSteps(steps: readonly AnyWorkflowStep[]): number | undefined {
  const hasImplementWrite = steps.some(
    (step): step is WriteWorkflowStep =>
      step.behavior === "write" && step.role === "implement" && step.suppressShrink !== true,
  );
  if (!hasImplementWrite) return undefined;

  const patchReviewStep = steps.find(
    (step): step is ReviewDebateWorkflowStep | ReviewWorkflowStep =>
      (step.behavior === "review-debate" || step.behavior === "review") && step.profile?.domain === "implement",
  );
  return patchReviewStep?.maxCycles ?? 0;
}

/**
 * Guards against grafting a foreign invocation's snapshot: a durable run found by
 * `(project, branch, stepId)` may belong to an unrelated workflow spec that happens to
 * reuse the same stepId label. Only adopt the snapshot if its full authored step list
 * matches this invocation's.
 */
function snapshotMatchesAuthoredSteps(
  snapshot: WorkflowSnapshot,
  authoredSteps: readonly {
    stepId: string;
    role: string;
    behavior?: "review-debate" | "review";
  }[],
): boolean {
  if (snapshot.steps.length !== authoredSteps.length) return false;
  return snapshot.steps.every((step, index) => {
    const authored = authoredSteps[index];
    return step.stepId === authored?.stepId && step.role === authored?.role && step.behavior === authored?.behavior;
  });
}

function buildCompletionStepWriteLoopInput(
  step: WriteWorkflowStep,
  workflowSnapshot: WorkflowSnapshot,
  args: WorkflowRunnerInput,
  store: StateStore,
): WriteLoopInput {
  const { role, agents, agentModelConfig, createBinding, behavior: _behavior, ...loopInput } = step;
  const executableRole = resolveExecutableRole(role);
  const bindings = resolveInvocationBindings(
    executableRole,
    agents,
    agentModelConfig,
    createBinding ?? createResolvedAgentBinding,
  );
  const telemetryContext = args.telemetry;

  return {
    ...loopInput,
    bindings,
    bindingResolution: {
      role,
      agents,
      agentModelConfig,
    },
    workflowSnapshot,
    publishCompletion: false,
    stateStore: store,
    ...(args.completionCommitter !== undefined ? { completionCommitter: args.completionCommitter } : {}),
    ...(args.completionPublisher !== undefined ? { completionPublisher: args.completionPublisher } : {}),
    ...(args.readyFinalizer !== undefined ? { readyFinalizer: args.readyFinalizer } : {}),
    ...(args.runFixCommand !== undefined ? { runFixCommand: args.runFixCommand } : {}),
    ...(args.logSink !== undefined ? { logSink: args.logSink } : {}),
    ...(telemetryContext !== undefined
      ? {
          telemetry: {
            sinkPath: telemetryContext.sinkPath ?? defaultTelemetrySinkPath(),
            operatorSessionId: telemetryContext.operatorSessionId,
            workflow: telemetryContext.workflow,
            role,
          },
        }
      : {}),
  };
}

function prepareWorkflowStep(
  step: WriteWorkflowStep,
  workflowSnapshot: WorkflowSnapshot,
  store: StateStore,
  logSink: LogSink | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  freshDispatch: boolean | undefined,
  touchedStepsInExecution: Set<string>,
): PreparedWorkflowStep {
  const existingRun = store.findRunByProjectBranch({
    project: step.worktree.projectName,
    branch: step.worktree.branchName,
    stepId: step.stepId,
  });

  // A fresh dispatch reuses a prior run only within this execution's own touched steps.
  const shouldSkipReuse = freshDispatch === true && !touchedStepsInExecution.has(step.stepId);

  if (
    !shouldSkipReuse &&
    (existingRun?.status === "completed" ||
      (existingRun?.status === "failed" && existingRun.attempts.at(-1)?.completionAgent?.trim() !== undefined) ||
      (step.landing !== undefined && step.landing.kind !== "none" && existingRun?.status === "failed"))
  ) {
    const completionAgent = existingRun.attempts.at(-1)?.completionAgent?.trim();
    return { kind: "completed", runId: existingRun.id, ...(completionAgent ? { completionAgent } : {}) };
  }

  const {
    stepId,
    role,
    agents,
    agentModelConfig,
    createBinding,
    behavior: _behavior,
    workflowInvocationId: _invocationId,
    ...loopInput
  } = step;
  const executableRole = resolveExecutableRole(role);
  const bindings = resolveInvocationBindings(
    executableRole,
    agents,
    agentModelConfig,
    createBinding ?? createResolvedAgentBinding,
  );

  return {
    kind: "pending",
    input: {
      ...loopInput,
      stepId,
      workflowSnapshot,
      ...(workflowSnapshot.creationTitle !== undefined ? { creationTitle: workflowSnapshot.creationTitle } : {}),
      bindings,
      bindingResolution: {
        role,
        agents,
        agentModelConfig,
      },
      ...(step.iterationTimeoutMs !== undefined ? { iterationTimeoutMs: step.iterationTimeoutMs } : {}),
      ...(step.iterationCeilingMs !== undefined ? { iterationCeilingMs: step.iterationCeilingMs } : {}),
      ...(step.idleOutputMs !== undefined ? { idleOutputMs: step.idleOutputMs } : {}),
      stateStore: store,
      ...(logSink !== undefined ? { logSink } : {}),
      ...(telemetry !== undefined
        ? {
            telemetry: {
              sinkPath: telemetry.sinkPath ?? defaultTelemetrySinkPath(),
              operatorSessionId: telemetry.operatorSessionId,
              workflow: telemetry.workflow,
              role,
            },
          }
        : {}),
      ...(freshDispatch !== undefined ? { freshDispatch } : {}),
      publishCompletion: false,
    },
  };
}

async function runShrinkAfterImplementComplete(
  step: WriteWorkflowStep,
  stepIndex: number,
  workflowSnapshot: WorkflowSnapshot,
  store: StateStore,
  logSink: LogSink | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  onStepRunCreated: ((stepIndex: number, runId: string) => void) | undefined,
  freshDispatch: boolean | undefined,
  touchedStepsInExecution: Set<string>,
): Promise<WriteLoopResult> {
  const { ...shrinkBase } = step;
  const shrinkStep = {
    ...shrinkBase,
    stepId: `${step.stepId}${SHRINK_STEP_ID_SUFFIX}`,
    role: SHRINK_ROLE,
    promptId: SHRINK_PROMPT_ID,
    ...(step.externalPlanSpec === true ? { externalSpecReadOnly: true as const } : {}),
    promptPlaceholders: await shrinkPromptPlaceholders(step),
  };
  const preparedStep = prepareWorkflowStep(
    shrinkStep,
    workflowSnapshot,
    store,
    logSink,
    telemetry,
    freshDispatch,
    touchedStepsInExecution,
  );
  if (preparedStep.kind === "completed") {
    onStepRunCreated?.(stepIndex, preparedStep.runId);
    const stored = store.loadRun(preparedStep.runId);
    const stamp = stored ? boundaryStampFromStoredRun(stored) : undefined;
    return {
      kind: "complete",
      runId: preparedStep.runId,
      iterationsConsumed: 0,
      resumable: false,
      ...(preparedStep.completionAgent ? { completionAgent: preparedStep.completionAgent } : {}),
      ...(stamp !== undefined ? stamp : {}),
    };
  }

  touchedStepsInExecution.add(shrinkStep.stepId);

  return withExternalSpecTreeReadOnly(externalSpecGitScope(step), [], () =>
    executeWriteLoop(
      onStepRunCreated
        ? { ...preparedStep.input, onRunCreated: (runId) => onStepRunCreated(stepIndex, runId) }
        : preparedStep.input,
    ),
  );
}

async function shrinkPromptPlaceholders(
  step: WriteWorkflowStep,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<Record<string, string>> {
  const worktreePath = getExternalWorktreePath(step.worktree);
  const gitScope = externalSpecGitScope(step);
  const allowlist = excludeExternalSpecGitPaths(
    worktreePath,
    await changedFiles(worktreePath, step.worktree.baseRef, runner),
    gitScope,
  );
  const scopedPaths =
    allowlist.length > 0 ? allowlist : step.externalPlanSpec === true ? [] : [step.expectedArtifactPath];
  return {
    SPEC_PATH: step.specPath,
    SPEC_TREE: readSpecTree(
      worktreePath,
      step.specPath,
      step.externalPlanSpec === true ? resolveLinkedImplementRoutingRoot(step, worktreePath) : worktreePath,
    ),
    ALLOWLIST: scopedPaths.length > 0 ? scopedPaths.map((path) => `- ${path}`).join("\n") : "(no changed files)",
    BRANCH_DIFF: (await gitOutput(worktreePath, ["diff", "--stat", step.worktree.baseRef, "--"], runner)) || "(empty)",
    RUN_SCOPED_DIFF:
      (await gitOutput(worktreePath, ["diff", step.worktree.baseRef, "--", ...scopedPaths], runner)) || "(empty)",
  };
}

function readSpecTree(worktreePath: string, specPath: string, labelRoot: string): string {
  const resolvedSpecPath = isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
  const specRoot = dirname(resolvedSpecPath);
  if (!existsSync(specRoot)) return "(missing spec tree)";

  const files = listMarkdownFiles(specRoot).sort();
  if (files.length === 0) return "(empty spec tree)";

  return files
    .map((filePath) => {
      const label = relative(labelRoot, filePath) || filePath;
      return `## ${label}\n\n${readFileSync(filePath, "utf8")}`;
    })
    .join("\n\n");
}

function listMarkdownFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(path));
    } else if (entry.isFile() && path.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

async function changedFiles(
  worktreePath: string,
  baseRef: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string[]> {
  return (await gitOutput(worktreePath, ["diff", "--name-only", baseRef, "--"], runner))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const GIT_OUTPUT_MAX_BUFFER = 10 * 1024 * 1024;

async function gitOutput(
  worktreePath: string,
  args: readonly string[],
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string> {
  if (!existsSync(join(worktreePath, ".git"))) return "";
  try {
    return (await runner.runAsync("git", [...args], worktreePath, { maxBuffer: GIT_OUTPUT_MAX_BUFFER })).trim();
  } catch {
    return "";
  }
}

/**
 * Diff `toRef` against `fromRef`, reporting whether it carries file changes. A failed or
 * unparseable read (an unresolvable ref, a non-Git worktree) resolves to `"unreadable"` rather
 * than throwing or being conflated with a positively-empty diff — the completion-publication gate
 * only suppresses publication when this read succeeds and comes back `"empty"`.
 */
async function readDiffOutcome(
  worktreePath: string,
  fromRef: string,
  toRef: string,
): Promise<"empty" | "changed" | "unreadable"> {
  try {
    const output = await realAsyncSubprocessRunner.runAsync(
      "git",
      ["diff", "--name-only", fromRef, toRef],
      worktreePath,
      { maxBuffer: GIT_OUTPUT_MAX_BUFFER },
    );
    return output.split("\n").some((line) => line.trim().length > 0) ? "changed" : "empty";
  } catch {
    return "unreadable";
  }
}

/**
 * Undo a completion commit whose diff against base came back empty — but only when the commit is
 * itself a no-op against its own parent. `filesChangedFromBase === 0` means the commit's tree
 * equals base's tree, not that the commit equals its parent: a boundary that legitimately reverts
 * branch content back to base produces a real commit with real changes relative to its parent,
 * and resetting would dump that diff into the working tree for no reason — that commit is left on
 * the branch untouched, just not published. The parent is read from the commit itself (not a head
 * sampled before the committer call) because the committer's pending-retry path can return a
 * `commitSha` that already was HEAD going in, which would otherwise make the reset a no-op and
 * leave the content-empty commit dangling. A failed rollback subprocess still means "don't
 * publish" rather than throwing out of a completed run.
 */
async function suppressContentEmptyCompletionCommit(
  worktreePath: string,
  commitSha: string,
  headBeforeCompletionCommit: string | undefined,
): Promise<void> {
  let parent: string | undefined;
  try {
    parent = (await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", `${commitSha}^`], worktreePath)).trim();
  } catch {
    parent = headBeforeCompletionCommit;
  }
  if (parent === undefined) return;
  if ((await readDiffOutcome(worktreePath, parent, commitSha)) !== "empty") return;
  try {
    await realAsyncSubprocessRunner.runAsync("git", ["reset", "--mixed", parent], worktreePath);
  } catch {
    // A failed rollback still must not publish; the marker commit (empty vs base) stays local.
  }
}

/** Read the shrink-authored narrative from .scratch/shrink-narrative.md if present, undefined otherwise. Absent file does not fail. */
function tryReadShrinkNarrative(worktreePath: string): string | undefined {
  const narrativePath = join(worktreePath, ".scratch", "shrink-narrative.md");
  try {
    if (!existsSync(narrativePath)) {
      return undefined;
    }
    const content = readFileSync(narrativePath, "utf8").trim();
    return content.length > 0 ? content : undefined;
  } catch {
    return undefined;
  }
}

export type ReviewStepOutcome = WorkflowStepOutcome & { kind: "complete" | "invocation_failure" | "landing_failed" };

/**
 * A review commit belongs to the latest pass whose actuator produced the tracked mutation, and
 * to that pass's actuator agent — a later non-mutating pass (critic approval, no actuator
 * invocation) cannot reassign either. Returns `undefined` when no cycle in `cycles` ever
 * mutated. `actuatorAgent` extracts the agent label from a `"completed"`-kind cycle; callers
 * supply it because the debate and light-review cycle shapes key `roleResults` by different
 * role unions.
 */
function lastMutatingReviewPass<C extends { kind: string; actuatorRan?: boolean }>(
  cycles: readonly C[],
  actuatorAgent: (cycle: Extract<C, { kind: "completed" }>) => string | undefined,
): { pass: number; agent: string | undefined } | undefined {
  for (let index = cycles.length - 1; index >= 0; index -= 1) {
    const cycle = cycles[index];
    if (cycle !== undefined && cycle.kind === "completed" && cycle.actuatorRan) {
      return { pass: index + 1, agent: actuatorAgent(cycle as Extract<C, { kind: "completed" }>) };
    }
  }
  return undefined;
}

type ReviewPassCommitDeps = ExternalSpecGitScope & {
  completionCommitter?: CompletionCommitter;
  baseRef: string;
  specPath: string;
  creationTitleHint?: string;
  iterationTimeoutMs?: number;
};

function buildReviewPassCommitDeps(
  args: WorkflowRunnerInput,
  workflowSnapshot: WorkflowSnapshot,
): ReviewPassCommitDeps | undefined {
  const writeStep = [...args.steps].reverse().find(isWriteStep);
  if (writeStep === undefined) return undefined;
  const worktreePath = getExternalWorktreePath(writeStep.worktree);
  if (!existsSync(join(worktreePath, ".git"))) return undefined;
  return {
    ...(args.completionCommitter !== undefined ? { completionCommitter: args.completionCommitter } : {}),
    baseRef: writeStep.worktree.baseRef,
    specPath: writeStep.specPath,
    ...(workflowSnapshot.creationTitle !== undefined ? { creationTitleHint: workflowSnapshot.creationTitle } : {}),
    ...(writeStep.iterationTimeoutMs !== undefined ? { iterationTimeoutMs: writeStep.iterationTimeoutMs } : {}),
    ...externalSpecGitScope(writeStep),
  };
}

function reviewActuatorAgentFromCycle(cycle: Extract<ReviewCycleOutcome, { kind: "completed" }>): string | undefined {
  return cycle.roleResults.actuator?.final?.result.kind === "ok"
    ? cycle.roleResults.actuator.final.binding.metadata?.agent?.trim()
    : undefined;
}

function reviewMutatingPassHandler(
  deps: ReviewPassCommitDeps | undefined,
  landing: ReviewWorkflowStep["landing"] | undefined,
  worktreePath: string,
  behavior: "review" | "review-debate",
): ((pass: number, agent: string | undefined) => Promise<void>) | undefined {
  if (deps === undefined || (landing !== undefined && landing.kind !== "none")) return undefined;
  return (pass, agent) => commitMutatingReviewPass(deps, { behavior, pass, agent, worktreePath });
}

async function commitMutatingReviewPass(
  deps: ReviewPassCommitDeps,
  args: {
    behavior: "review" | "review-debate";
    pass: number;
    agent: string | undefined;
    worktreePath: string;
  },
): Promise<void> {
  const agent = args.agent?.trim();
  if (!agent) throw new Error("completion attribution is missing");
  const title = resolvePublicationTitle(args.worktreePath, deps.specPath, deps.creationTitleHint);
  const headBefore = await getCurrentHeadAsync(args.worktreePath);
  const fields = mutatingReviewPassCommitFields(args.behavior, args.pass, title);
  const published = await (deps.completionCommitter ?? createCompletionCommitter())({
    worktreePath: args.worktreePath,
    baseRef: deps.baseRef,
    specPath: deps.specPath,
    agent,
    title: fields.title,
    step: fields.step,
    iterationTimeoutMs: deps.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS,
    formatMode: "checkpoint",
    ...externalSpecGitScope(deps),
  });
  if (published.commitSha === undefined || published.commitSha === headBefore) return;
}

type IncrementalReviewCycleRun = {
  result: ReviewCycleResult;
  boundaryViolation?: string;
  verdictState?: Awaited<ReturnType<typeof executeReviewCycleEnforced>>["verdictState"];
};

async function runReviewCyclesIncremental(
  maxCycles: number,
  buildSingleCycleInput: (pass: number, priorVerdict: string | undefined) => ReviewCycleInput,
  runSingleCycle: (input: ReviewCycleInput) => Promise<IncrementalReviewCycleRun>,
  onMutatingPass?: (pass: number, agent: string | undefined) => Promise<void>,
): Promise<{
  result: ReviewCycleResult;
  boundaryViolation?: string;
  verdictState: Awaited<ReturnType<typeof executeReviewCycleEnforced>>["verdictState"];
}> {
  const allCycles: ReviewCycleOutcome[] = [];
  let priorVerdict: string | undefined;
  let verdictState: Awaited<ReturnType<typeof executeReviewCycleEnforced>>["verdictState"] = { kind: "missing" };
  for (let pass = 1; pass <= maxCycles; pass += 1) {
    const cycleRun = await runSingleCycle(buildSingleCycleInput(pass, priorVerdict));
    if (cycleRun.verdictState !== undefined) verdictState = cycleRun.verdictState;
    allCycles.push(...cycleRun.result.cycles);
    const lastCycle = cycleRun.result.cycles.at(-1);
    if (lastCycle?.kind === "completed" && lastCycle.actuatorRan) {
      await onMutatingPass?.(pass, reviewActuatorAgentFromCycle(lastCycle));
    }
    if (cycleRun.boundaryViolation !== undefined) {
      const mergedResult: ReviewCycleResult =
        cycleRun.result.kind === "invocation_failure"
          ? { ...cycleRun.result, cycles: allCycles }
          : { kind: "complete", cycles: allCycles };
      return { result: mergedResult, verdictState, boundaryViolation: cycleRun.boundaryViolation };
    }
    if (cycleRun.result.kind === "invocation_failure") {
      return { result: { ...cycleRun.result, cycles: allCycles }, verdictState };
    }
    if (lastCycle?.kind === "completed" && !lastCycle.actuatorRan) {
      return { result: { kind: "complete", cycles: allCycles }, verdictState };
    }
    if (lastCycle?.kind !== "completed") {
      return {
        result: { kind: "invocation_failure", failureKind: "error", cycles: allCycles },
        verdictState,
      };
    }
    priorVerdict = lastCycle.verdict;
  }
  return { result: { kind: "complete", cycles: allCycles }, verdictState };
}

async function raceStepSuccessorShellIdle<T>(
  step: { idleOutputMs?: number; signal?: AbortSignal },
  ctx: { runId: string; attemptId: string; store: StateStore; logSink?: LogSink },
  run: (handoff: { signal: AbortSignal | undefined; onRoleStart: () => void }) => Promise<T>,
): Promise<T | SuccessorShellStallOutcome> {
  const stallAbort = new AbortController();
  const shellIdleWatchdog = armSuccessorShellIdleWatchdog({
    ...(step.idleOutputMs !== undefined ? { idleOutputMs: step.idleOutputMs } : {}),
    ...(step.signal !== undefined ? { signal: step.signal } : {}),
    onStall: () => stallAbort.abort(),
  });
  return raceSuccessorShellIdle(
    {
      ...(step.idleOutputMs !== undefined ? { idleOutputMs: step.idleOutputMs } : {}),
      ...(step.signal !== undefined ? { signal: step.signal } : {}),
      ...ctx,
    },
    shellIdleWatchdog,
    stallAbort,
    run,
  );
}

function findDurableWriteStepId(steps: readonly WorkflowSnapshotStep[]): string | undefined {
  return steps.find((step) => step.behavior === undefined)?.stepId;
}

function persistIntentHandoff(
  store: StateStore,
  landing: PublicationLanding | undefined,
  handoff: IntentPipelineHandoff,
  project: string,
  branch: string,
  writeTarget: string | { reviewRunId: string },
): void {
  if (landing?.kind !== "intent-stage") return;
  const writeStepId =
    typeof writeTarget === "string"
      ? writeTarget
      : findDurableWriteStepId(store.loadRun(writeTarget.reviewRunId)?.workflowSnapshot?.steps ?? []);
  if (writeStepId === undefined) return;
  const writeRun = store.findRunByProjectBranch({ project, branch, stepId: writeStepId });
  if (writeRun === null) return;
  store.setRunSpecPath(writeRun.id, handoff.specPath);
  if (handoff.downstreamInputs !== undefined) {
    store.setRunDownstreamInputs(writeRun.id, handoff.downstreamInputs);
  } else {
    store.clearRunDownstreamInputs(writeRun.id);
  }
}

function isReviewLandingRecoveryAttempt(lastAttempt: Attempt | undefined): boolean {
  if (lastAttempt === undefined) return false;
  if (lastAttempt.outcomeKind === "landing_failed") return true;
  return (
    lastAttempt.outcomeKind === "invocation_failure" && lastAttempt.invocationFailureDetail?.failureKind === "landing"
  );
}

/**
 * A review step's own durable completion checkpoint, keyed like a write step's run row.
 * Retrying landing, commit, push, PR, or finalization re-enters `runReviewStep` for this step;
 * its completed or landing-failed checkpoint resumes past review without re-invoking agents.
 */
function findReviewLandingCheckpoint(
  store: StateStore,
  step: Pick<ReviewDebateWorkflowStep | ReviewWorkflowStep, "project" | "branch" | "stepId">,
): NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>> | undefined {
  const existing = store.findRunByProjectBranch({ project: step.project, branch: step.branch, stepId: step.stepId });
  const lastAttempt = existing?.attempts.at(-1);
  return existing?.status === "completed" ||
    (existing?.status === "failed" && isReviewLandingRecoveryAttempt(lastAttempt))
    ? existing
    : undefined;
}

/**
 * Structured trace for a finalization attempt on either seam (review-step landing or the
 * workflow completion publication tail). `stopReason` is set only when finalization did not
 * complete; absent on the happy path. Kept as a single-line helper so callers instrument
 * without growing their own complexity.
 */
function recordIntentFinalization(
  logSink: LogSink | undefined,
  runId: string,
  phase: IntentFinalizationEvent["phase"],
  branch: string,
  stopReason?: string,
): void {
  logSink?.append(runId, {
    kind: "intent_finalization",
    phase,
    branch,
    ...(stopReason !== undefined ? { stopReason } : {}),
  });
}

function reviewCompletionAgent(run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>): string | undefined {
  for (let index = run.attempts.length - 1; index >= 0; index -= 1) {
    const agent = run.attempts[index]?.completionAgent?.trim();
    if (agent) return agent;
  }
  return undefined;
}

/** Durable counterpart to {@link reviewCompletionAgent}: the mutating pass persisted alongside it. */
function reviewCompletionPass(run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>): number | undefined {
  for (let index = run.attempts.length - 1; index >= 0; index -= 1) {
    const pass = run.attempts[index]?.completionReviewPass;
    if (pass !== undefined && pass !== null) return pass;
  }
  return undefined;
}

wireWorkflowRunnerResumeDeps({
  persistIntentHandoff,
  recordIntentFinalization,
  reviewCompletionAgent,
  reviewCompletionPass,
  settleReviewedStagedMarkdownLintFailure,
  executeWorkflow,
});

type ReviewStepExecutionIds = {
  runId: string;
  attemptId: string;
};

function resolveReviewStepBindings(step: ReviewWorkflowStep) {
  const resolveBindings = step.createBinding ?? createResolvedAgentBinding;
  return {
    critic: resolveInvocationBindings("critic", step.agents.critic, step.agentModelConfig, resolveBindings),
    actuator: resolveInvocationBindings("actuator", step.agents.actuator, step.agentModelConfig, resolveBindings),
  };
}

const REVIEW_DEBATE_LANDING_DEPS: ReviewDebateLandingDeps = {
  findReviewLandingCheckpoint,
  reviewCompletionAgent,
  reviewCompletionPass,
  raceStepSuccessorShellIdle,
  landReviewedPublicationOutput,
  resolveReviewStepBindings,
};

function buildReviewStepTelemetryFields(
  step: Pick<ReviewWorkflowStep, "stepId" | "project" | "branch" | "cwd">,
  ids: ReviewStepExecutionIds,
  telemetry: WorkflowTelemetryContext | undefined,
) {
  if (telemetry === undefined) {
    return {};
  }
  return {
    telemetry: {
      sink: buildJsonlSink(telemetry.sinkPath ?? defaultTelemetrySinkPath()),
      operatorSessionId: telemetry.operatorSessionId,
      runId: ids.runId,
      attemptId: ids.attemptId,
      project: step.project,
      workflow: telemetry.workflow,
      stepId: step.stepId,
      worktreePath: step.cwd,
      branch: step.branch,
      specRef: "",
    },
  };
}

function buildReviewStepOnRoleStart(
  invocationId: string,
  stepId: string,
  onProgress: ((invocationId: string, stepId: string, progress: ReviewProgress) => void) | undefined,
  invocationCount: { value: number },
  disarmShellIdle?: () => void,
) {
  if (onProgress === undefined && disarmShellIdle === undefined) {
    return {};
  }
  return {
    onRoleStart: (role: ReviewCycleRole) => {
      disarmShellIdle?.();
      if (onProgress !== undefined) {
        invocationCount.value += 1;
        onProgress(invocationId, stepId, { status: "in_progress", role });
      }
    },
  };
}

function terminalRoleFromReviewCycles(cycles: ReviewCycleResult["cycles"]): ReviewCycleRole {
  const lastCycle = cycles[cycles.length - 1];
  if (lastCycle?.kind === "role_failed") {
    return lastCycle.failedRole;
  }
  if (lastCycle?.kind === "completed" && lastCycle.actuatorRan) {
    return "actuator";
  }
  return "critic";
}

function reviewedIntentWorkspaceFailure(stagingDir: string): string | undefined {
  try {
    if (!existsSync(stagingDir) || readdirSync(stagingDir).length === 0) {
      return `intent review: staged workspace is missing or empty: ${stagingDir}`;
    }
    return undefined;
  } catch (error) {
    return `intent review: could not inspect staged workspace ${stagingDir}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function reviewedIntentEvidenceFailure(result: ReviewCycleResult, verdictPath: string): string | undefined {
  const criticRan = result.cycles.some((cycle) => cycle.roleResults.critic?.final?.result.kind === "ok");
  if (!criticRan) return "intent review: critic invocation did not produce a verdict";
  try {
    readFileSync(verdictPath, "utf8");
    return undefined;
  } catch (error) {
    return `intent review: critic did not produce verdict artifact ${verdictPath}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function reviewedIntentFailureMessage(result: Extract<ReviewCycleResult, { kind: "invocation_failure" }>): string {
  if (
    (result.failedRole === "critic" || result.failedRole === "actuator") &&
    (result.failureKind === "no_binding" || result.failureKind === "quota")
  ) {
    return `intent review: configured ${result.failedRole} bindings exhausted (${result.failureKind})`;
  }
  return `intent review: ${result.failedRole ?? "review"} invocation failed (${result.failureKind})`;
}

type ReviewWorkflowCycleInput = Omit<
  ReviewWorkflowStep,
  | "stepId"
  | "behavior"
  | "project"
  | "branch"
  | "agents"
  | "agentModelConfig"
  | "createBinding"
  | "landing"
  | "profile"
  | "profileContext"
>;

function commitIntentStageInvocationFailure(
  store: StateStore,
  ids: ReviewStepExecutionIds,
  invocationFailureDetail: InvocationFailureDetail,
): void {
  store.commitCompletionBoundary({
    attemptId: ids.attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail,
    ...completionBoundarySettlementFields("invocation_failure", invocationFailureDetail),
  });
}

function standardReviewWorkspaceFailureOutcome(
  step: ReviewWorkflowStep,
  landing: ReviewWorkflowStep["landing"],
  ids: ReviewStepExecutionIds,
  store: StateStore,
): ReviewStepOutcome | undefined {
  if (landing?.kind !== "intent-stage") {
    return undefined;
  }
  const workspaceFailure = reviewedIntentWorkspaceFailure(resolve(step.cwd, landing.stagingDir));
  if (workspaceFailure === undefined) {
    return undefined;
  }
  commitIntentStageInvocationFailure(store, ids, {
    failureKind: "error",
    bindingAttempts: [],
    message: workspaceFailure,
  });
  return {
    kind: "invocation_failure",
    runId: ids.runId,
    iterationsConsumed: 0,
    resumable: false,
    invocationFailureMessage: workspaceFailure,
  };
}

async function runStandardReviewCycle(
  step: ReviewWorkflowStep,
  reviewInput: ReviewWorkflowCycleInput,
  landing: ReviewWorkflowStep["landing"],
  reviewCycleInput: ReviewCycleInput,
  reviewPassCommitDeps: ReviewPassCommitDeps | undefined,
): Promise<{
  result: ReviewCycleResult;
  verdictState: Awaited<ReturnType<typeof executeReviewCycleEnforced>>["verdictState"];
  boundaryViolation?: string;
}> {
  const onMutatingPass = reviewMutatingPassHandler(reviewPassCommitDeps, landing, step.cwd, "review");
  if (landing?.kind === "intent-stage") {
    return runReviewCyclesIncremental(
      reviewCycleInput.maxCycles,
      (pass, priorVerdict) => ({
        ...reviewCycleInput,
        maxCycles: 1,
        profileContext: cycleProfileContext(reviewCycleInput.profileContext, pass, priorVerdict),
      }),
      async (singleInput) => {
        const enforced = await executeReviewCycleEnforced({
          input: singleInput,
          invocationId: landing.invocationId,
          stagingDir: resolve(step.cwd, landing.stagingDir),
          cwd: step.cwd,
          verdictPath: reviewInput.verdictPath,
        });
        return {
          result: enforced.result,
          verdictState: enforced.verdictState,
          ...(enforced.boundaryViolation !== undefined ? { boundaryViolation: enforced.boundaryViolation } : {}),
        };
      },
      onMutatingPass,
    );
  }
  return runReviewCyclesIncremental(
    reviewCycleInput.maxCycles,
    (pass, priorVerdict) => ({
      ...reviewCycleInput,
      maxCycles: 1,
      profileContext: cycleProfileContext(reviewCycleInput.profileContext, pass, priorVerdict),
    }),
    async (singleInput) => ({ result: await executeReviewCycle(singleInput) }),
    onMutatingPass,
  );
}

function standardReviewBoundaryFailureOutcome(
  boundaryViolationMsg: string,
  landing: ReviewWorkflowStep["landing"],
  ids: ReviewStepExecutionIds,
  store: StateStore,
  iterationsConsumed: number,
): ReviewStepOutcome {
  if (landing?.kind === "intent-stage") {
    commitIntentStageInvocationFailure(store, ids, {
      failureKind: "error",
      bindingAttempts: [],
      message: boundaryViolationMsg,
    });
  }
  return {
    kind: "invocation_failure",
    runId: ids.runId,
    iterationsConsumed,
    resumable: true,
    invocationFailureMessage: boundaryViolationMsg,
  };
}

function standardReviewRoleFailureOutcome(
  result: Extract<ReviewCycleResult, { kind: "invocation_failure" }>,
  landing: ReviewWorkflowStep["landing"],
  ids: ReviewStepExecutionIds,
  store: StateStore,
): ReviewStepOutcome {
  const message = reviewedIntentFailureMessage(result);
  const lastCycle = result.cycles.at(-1);
  const failedRole = result.failedRole ?? (lastCycle?.kind === "role_failed" ? lastCycle.failedRole : "review");
  const roleExecution = lastCycle?.kind === "role_failed" ? lastCycle.roleResults[lastCycle.failedRole] : undefined;
  const detail = buildReviewInvocationFailureDetail(result.failureKind, failedRole, roleExecution, message);
  if (landing?.kind === "intent-stage") {
    commitIntentStageInvocationFailure(store, ids, detail);
  }
  return {
    kind: "invocation_failure",
    runId: ids.runId,
    iterationsConsumed: result.cycles.length,
    resumable: isPostCommitReviewRetryableFailureKind(detail),
    ...(landing?.kind === "intent-stage" ? { invocationFailureMessage: message } : {}),
  };
}

function standardReviewEvidenceFailureOutcome(
  result: Extract<ReviewCycleResult, { kind: "complete" }>,
  landing: ReviewWorkflowStep["landing"],
  reviewInput: ReviewWorkflowCycleInput,
  ids: ReviewStepExecutionIds,
  store: StateStore,
): ReviewStepOutcome | undefined {
  if (landing?.kind !== "intent-stage") {
    return undefined;
  }
  const evidenceFailure = reviewedIntentEvidenceFailure(result, reviewInput.verdictPath);
  if (evidenceFailure === undefined) {
    return undefined;
  }
  commitIntentStageInvocationFailure(store, ids, {
    failureKind: "error",
    bindingAttempts: [],
    message: evidenceFailure,
  });
  return {
    kind: "invocation_failure",
    runId: ids.runId,
    iterationsConsumed: result.cycles.length,
    resumable: false,
    invocationFailureMessage: evidenceFailure,
  };
}

async function finalizeStandardReviewStep(
  step: ReviewWorkflowStep,
  landing: ReviewWorkflowStep["landing"],
  result: Extract<ReviewCycleResult, { kind: "complete" }>,
  ids: ReviewStepExecutionIds,
  bindings: ReturnType<typeof resolveReviewStepBindings>,
  telemetry: WorkflowTelemetryContext | undefined,
  store: StateStore,
  logSink?: LogSink,
  shellIdle?: { signal?: AbortSignal; onActuatorStart?: () => void },
): Promise<ReviewStepOutcome> {
  const mutating = lastMutatingReviewPass(result.cycles, (cycle) =>
    cycle.roleResults.actuator?.final?.result.kind === "ok"
      ? cycle.roleResults.actuator.final.binding.metadata?.agent?.trim()
      : undefined,
  );
  const completionAgent = mutating?.agent;
  if (landing !== undefined && landing.kind !== "none") {
    const lastCycle = result.cycles.at(-1);
    const actuatorRan = lastCycle?.kind === "completed" && lastCycle.actuatorRan;
    const verdict = lastCycle?.kind === "completed" ? lastCycle.verdict : "";
    const priorCycle = result.cycles.at(-2);
    const priorVerdict = priorCycle?.kind === "completed" ? priorCycle.verdict : undefined;
    const actuatorContext = actuatorRan
      ? buildStandardReviewLandingActuatorContext(
          step,
          landing,
          bindings,
          verdict,
          cycleProfileContext(step.profileContext, result.cycles.length, priorVerdict),
          buildReviewStepTelemetryFields(step, ids, telemetry),
          shellIdle,
        )
      : undefined;
    const landingFailure = await landReviewedOutputOrFail(
      step,
      landing,
      ids.attemptId,
      ids.runId,
      result.cycles.length,
      store,
      logSink,
      REVIEW_DEBATE_LANDING_DEPS,
      actuatorContext,
    );
    if (landingFailure !== undefined) {
      if (landingFailure.kind === "landing_failed") {
        logSink?.append(ids.runId, {
          kind: "loop_finished",
          loopOutcomeKind: "landing_failed",
          iterationsConsumed: landingFailure.iterationsConsumed,
          resumable: landingFailure.resumable,
        });
      }
      return landingFailure;
    }
  }
  store.commitCompletionBoundary({
    attemptId: ids.attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    terminalCause: "complete",
    ...(completionAgent ? { completionAgent } : {}),
    ...(mutating?.pass !== undefined ? { completionReviewPass: mutating.pass } : {}),
  });
  return {
    kind: "complete",
    runId: ids.runId,
    iterationsConsumed: result.cycles.length,
    resumable: false,
    ...(completionAgent ? { completionAgent } : {}),
    ...(mutating?.pass !== undefined ? { reviewPass: mutating.pass } : {}),
  };
}

function resolveProfileReviewCompletion(
  lastCycle: ReviewCycleOutcome | undefined,
  cycles: readonly ReviewCycleOutcome[],
): {
  kind: "complete" | "invocation_failure";
  terminalRole: ReviewCycleRole;
  completionAgent: string | undefined;
  reviewPass: number | undefined;
} {
  if (lastCycle?.kind === "role_failed") {
    return {
      kind: "invocation_failure",
      terminalRole: lastCycle.failedRole,
      completionAgent: undefined,
      reviewPass: undefined,
    };
  }
  const actuatorRan = lastCycle?.kind === "completed" && lastCycle.actuatorRan;
  const mutating = lastMutatingReviewPass(cycles, (cycle) =>
    cycle.roleResults.actuator?.final?.result.kind === "ok"
      ? cycle.roleResults.actuator.final.binding.metadata?.agent?.trim()
      : undefined,
  );
  return {
    kind: "complete",
    terminalRole: actuatorRan ? "actuator" : "critic",
    completionAgent: mutating?.agent,
    reviewPass: mutating?.pass,
  };
}

function resolveProfileReviewRetryable(result: ReviewCycleResult, lastCycle: ReviewCycleOutcome | undefined): boolean {
  if (result.kind !== "invocation_failure") {
    return false;
  }
  const profileFailedRole = result.failedRole ?? (lastCycle?.kind === "role_failed" ? lastCycle.failedRole : "review");
  const failedRoleExecution =
    lastCycle?.kind === "role_failed" ? lastCycle.roleResults[lastCycle.failedRole] : undefined;
  return isPostCommitReviewRetryableFailureKind(
    buildReviewInvocationFailureDetail(result.failureKind, profileFailedRole, failedRoleExecution),
  );
}

async function runProfileReviewStep(
  step: ReviewWorkflowStep,
  reviewInput: ReviewWorkflowCycleInput,
  ids: ReviewStepExecutionIds,
  bindings: ReturnType<typeof resolveReviewStepBindings>,
  invocationId: string,
  onProgress: ((invocationId: string, stepId: string, progress: ReviewProgress) => void) | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  reviewPassCommitDeps?: ReviewPassCommitDeps,
): Promise<ReviewStepOutcome> {
  const { stepId } = step;
  const invocationCount = { value: 0 };
  const profile = rehydrateReviewPromptProfile(step.profile);
  const reviewCycleBase: ReviewCycleInput = {
    cwd: step.cwd,
    ...(profile !== undefined ? { profile } : {}),
    ...(step.profileContext !== undefined ? { profileContext: step.profileContext } : {}),
    ...(reviewInput.prompt !== undefined ? { prompt: reviewInput.prompt } : {}),
    ...(reviewInput.actuatorPromptRenderer !== undefined
      ? { actuatorPromptRenderer: reviewInput.actuatorPromptRenderer }
      : {}),
    bindings,
    verdictPath: reviewInput.verdictPath,
    maxCycles: reviewInput.maxCycles,
    // Without this the step's per-role bound is dropped and every role falls back to the default.
    ...(reviewInput.roleTimeoutMs !== undefined ? { roleTimeoutMs: reviewInput.roleTimeoutMs } : {}),
    ...(reviewInput.idleOutputMs !== undefined ? { idleOutputMs: reviewInput.idleOutputMs } : {}),
    ...(reviewInput.signal !== undefined ? { signal: reviewInput.signal } : {}),
    ...buildReviewStepTelemetryFields(step, ids, telemetry),
    ...buildReviewStepOnRoleStart(invocationId, stepId, onProgress, invocationCount),
  };
  const onMutatingPass = reviewMutatingPassHandler(reviewPassCommitDeps, step.landing, step.cwd, "review");
  const { result } = await runReviewCyclesIncremental(
    reviewInput.maxCycles,
    (pass, priorVerdict) => ({
      ...reviewCycleBase,
      maxCycles: 1,
      profileContext: cycleProfileContext(reviewCycleBase.profileContext, pass, priorVerdict),
    }),
    async (singleInput) => ({ result: await executeReviewCycle(singleInput) }),
    onMutatingPass,
  );

  const lastCycle = result.cycles[result.cycles.length - 1];
  const { kind, terminalRole, completionAgent, reviewPass } = resolveProfileReviewCompletion(lastCycle, result.cycles);

  if (kind === "complete") {
    await discardEphemeralReviewVerdictDrift(step.cwd, reviewInput.verdictPath);
  }

  onProgress?.(invocationId, stepId, {
    status: kind === "complete" ? "completed" : "stopped",
    role: terminalRole,
    terminalOutcome: kind,
    attemptCount: Math.max(invocationCount.value, 1),
  });

  if (kind === "complete" && step.landing !== undefined && step.landing.kind !== "none") {
    const landed = await landReviewedPublicationOutput(step.cwd, step.landing, reviewInput.verdictPath);
    if (!landed.ok) {
      return {
        kind: "invocation_failure",
        runId: ids.runId,
        iterationsConsumed: result.cycles.length,
        resumable: true,
        invocationFailureMessage: landed.message,
      };
    }
  }

  return {
    kind,
    runId: ids.runId,
    iterationsConsumed: result.cycles.length,
    resumable: resolveProfileReviewRetryable(result, lastCycle),
    ...(completionAgent ? { completionAgent } : {}),
    ...(reviewPass !== undefined ? { reviewPass } : {}),
  };
}

async function runStandardReviewStep(
  step: ReviewWorkflowStep,
  reviewInput: ReviewWorkflowCycleInput,
  landing: ReviewWorkflowStep["landing"],
  ids: ReviewStepExecutionIds,
  bindings: ReturnType<typeof resolveReviewStepBindings>,
  invocationId: string,
  onProgress: ((invocationId: string, stepId: string, progress: ReviewProgress) => void) | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  store: StateStore,
  logSink?: LogSink,
  shellIdle?: { signal?: AbortSignal; onRoleStart?: () => void },
  reviewPassCommitDeps?: ReviewPassCommitDeps,
): Promise<ReviewStepOutcome> {
  const { stepId } = step;
  const workspaceFailureOutcome = standardReviewWorkspaceFailureOutcome(step, landing, ids, store);
  if (workspaceFailureOutcome !== undefined) {
    return workspaceFailureOutcome;
  }

  const invocationCount = { value: 0 };
  const profile = rehydrateReviewPromptProfile(step.profile);
  const reviewCycleInput: ReviewCycleInput = {
    ...reviewInput,
    ...(profile !== undefined ? { profile } : {}),
    ...(step.profileContext !== undefined ? { profileContext: step.profileContext } : {}),
    bindings,
    ...(shellIdle?.signal !== undefined ? { signal: shellIdle.signal } : {}),
    ...buildReviewStepTelemetryFields(step, ids, telemetry),
    ...buildReviewStepOnRoleStart(invocationId, stepId, onProgress, invocationCount, shellIdle?.onRoleStart),
  };

  const { result, boundaryViolation: boundaryViolationMsg } = await runStandardReviewCycle(
    step,
    reviewInput,
    landing,
    reviewCycleInput,
    reviewPassCommitDeps,
  );

  if (boundaryViolationMsg !== undefined) {
    return standardReviewBoundaryFailureOutcome(boundaryViolationMsg, landing, ids, store, result.cycles.length);
  }

  onProgress?.(invocationId, stepId, {
    status: result.kind === "complete" ? "completed" : "stopped",
    role: terminalRoleFromReviewCycles(result.cycles),
    terminalOutcome: result.kind,
    attemptCount: Math.max(invocationCount.value, 1),
  });

  if (result.kind === "invocation_failure") {
    return standardReviewRoleFailureOutcome(result, landing, ids, store);
  }

  const evidenceFailureOutcome = standardReviewEvidenceFailureOutcome(result, landing, reviewInput, ids, store);
  if (evidenceFailureOutcome !== undefined) {
    return evidenceFailureOutcome;
  }

  await discardEphemeralReviewVerdictDrift(step.cwd, reviewInput.verdictPath);

  return finalizeStandardReviewStep(step, landing, result, ids, bindings, telemetry, store, logSink, shellIdle);
}

async function runReviewDispatch(
  step: ReviewDebateWorkflowStep | ReviewWorkflowStep,
  stepIndex: number,
  workflowSnapshot: WorkflowSnapshot,
  onProgress: ((invocationId: string, stepId: string, progress: ReviewProgress) => void) | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  onStepRunCreated: ((stepIndex: number, runId: string) => void) | undefined,
  store: StateStore,
  logSink: LogSink | undefined,
  freshDispatch: boolean | undefined,
  reviewPassCommitDeps: ReviewPassCommitDeps | undefined,
): Promise<ReviewDebateStepOutcome | ReviewStepOutcome> {
  const { invocationId } = workflowSnapshot;
  if (step.behavior === "review-debate") {
    return runReviewDebateStep(
      step,
      stepIndex,
      invocationId,
      onProgress,
      telemetry,
      onStepRunCreated,
      store,
      workflowSnapshot,
      freshDispatch,
      logSink,
      REVIEW_DEBATE_LANDING_DEPS,
      reviewMutatingPassHandler(reviewPassCommitDeps, step.landing, step.cwd, "review-debate"),
    );
  }

  const { landing, ...reviewInput } = step;

  // Only reviewed-intent workflows carry a durable post-review checkpoint; generic review
  // steps stay non-durable (no run row, fresh synthesized run ID each dispatch).
  if (isDurableWorkflowStep(step) && !freshDispatch) {
    const checkpoint = findReviewLandingCheckpoint(store, step);
    if (checkpoint !== undefined) {
      onStepRunCreated?.(stepIndex, checkpoint.id);
      return await finishReviewedLanding(
        step,
        step.landing,
        checkpoint.id,
        store,
        reviewCompletionAgent(checkpoint),
        reviewCompletionPass(checkpoint),
        logSink,
        REVIEW_DEBATE_LANDING_DEPS,
      );
    }
  }

  const bindings = resolveReviewStepBindings(step);
  const runId = isDurableWorkflowStep(step)
    ? store.createRun({
        project: step.project,
        specRef: step.landing.kind === "intent-stage" ? step.landing.baseRef : "",
        worktreePath: step.cwd,
        branch: step.branch,
        specPath: step.landing.stagingDir,
        stepId: step.stepId,
        workflowSnapshot,
      })
    : crypto.randomUUID();
  const ids: ReviewStepExecutionIds = {
    runId,
    attemptId: isDurableWorkflowStep(step) ? store.recordAttemptStart(runId) : crypto.randomUUID(),
  };
  onStepRunCreated?.(stepIndex, ids.runId);

  if (isDurableWorkflowStep(step)) {
    logSink?.append(ids.runId, { kind: "iteration_started", attemptId: ids.attemptId });
  }

  let outcome: ReviewStepOutcome | SuccessorShellStallOutcome;
  if (isDurableWorkflowStep(step)) {
    const stallAbort = new AbortController();
    const shellIdleWatchdog = armSuccessorShellIdleWatchdog({
      ...(step.idleOutputMs !== undefined ? { idleOutputMs: step.idleOutputMs } : {}),
      ...(step.signal !== undefined ? { signal: step.signal } : {}),
      onStall: () => stallAbort.abort(),
    });
    outcome = await raceSuccessorShellIdle(
      {
        ...(step.idleOutputMs !== undefined ? { idleOutputMs: step.idleOutputMs } : {}),
        ...(step.signal !== undefined ? { signal: step.signal } : {}),
        runId: ids.runId,
        attemptId: ids.attemptId,
        store,
        ...(logSink !== undefined ? { logSink } : {}),
      },
      shellIdleWatchdog,
      stallAbort,
      ({ signal, onRoleStart }) =>
        runStandardReviewStep(
          step,
          reviewInput,
          step.landing,
          ids,
          bindings,
          invocationId,
          onProgress,
          telemetry,
          store,
          logSink,
          { ...(signal !== undefined ? { signal } : {}), onRoleStart },
          reviewPassCommitDeps,
        ),
    );
  } else {
    outcome = await runProfileReviewStep(
      step,
      reviewInput,
      ids,
      bindings,
      invocationId,
      onProgress,
      telemetry,
      reviewPassCommitDeps,
    );
  }

  if (isDurableWorkflowStep(step) && !isSuccessorShellStallOutcome(outcome)) {
    logSink?.append(ids.runId, {
      kind: "loop_finished",
      loopOutcomeKind: outcome.kind,
      iterationsConsumed: outcome.iterationsConsumed,
      resumable: outcome.resumable,
    });
  }

  return outcome;
}
