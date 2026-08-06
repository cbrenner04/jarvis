import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { RunFixCommandOpts } from "../../../shared/fix-command.ts";
import { getCurrentHeadAsync } from "../../../shared/git.ts";
import { createResolvedAgentBinding, type ResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import type { InvocationBinding, InvocationTelemetryContext } from "../../../shared/invocation/execute.ts";
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
import { readProjectFixCommand } from "../config/machine-config-loader.ts";
import type {
  IntentFinalizationEvent,
  LogSink,
  LoopFinishedEvent,
  PersistedRecord,
  RunExecutionFailedEvent,
} from "../persistence/log-stream.ts";
import {
  type Attempt,
  openStateStore,
  type Run,
  type StateStore,
  type WorkflowSnapshot,
  type WorkflowSnapshotStep,
} from "../persistence/state-store.ts";
import { type CompletionCommitter, createCompletionCommitter } from "./completion-commit.ts";
import type { CompletionPublisher } from "./completion-publisher.ts";
import { verifyDiffDerivedMutations } from "./diff-derived-mutation-verifier.ts";
import { getExternalWorktreePath, withExternalWorktree as realWithExternalWorktree } from "./external-worktree.ts";
import type { IntentPipelineHandoff } from "./intent-output.ts";
import { configuredIntentDurableDir, listLandedIntentFiles } from "./intent-output.ts";
import { deriveIntentRunBodySummary } from "./intent-run-body-summary.ts";
import {
  type InvocationFailureDetail,
  type InvocationFailureKind,
  isExhaustedRoleTimeout,
} from "./invocation-failure.ts";
import { landPublication, type PublicationLanding } from "./publication-landing.ts";
import { type PublicationFailure, publicationFailureFor } from "./publication-retry.ts";
import type { ReadyFinalizer } from "./ready-finalize.ts";
import { readyGateOutOfScopeLogFields, SurvivingMutationError, survivingMutationLogFields } from "./ready-finalize.ts";
import {
  executeReviewCycle,
  type ReviewCycleInput,
  type ReviewCycleOutcome,
  type ReviewCycleResult,
  type ReviewCycleRole,
} from "./review-cycle.ts";
import {
  executeReviewDebate,
  type ReviewDebateInput,
  type ReviewDebateRole,
  type ReviewDebateRoleBindings,
} from "./review-debate.ts";
import { excludeVerdictFromStaging, executeReviewCycleEnforced, VERDICT_FILE } from "./review-intent-enforcement.ts";
import { cycleProfileContext } from "./review-profile-context.ts";
import { rehydrateReviewPromptProfile } from "./review-profile-registry.ts";
import {
  invokeReviewRole,
  type ReviewRoleInvocationExecution,
  reviewRoleFailureKind,
} from "./review-role-invocation.ts";
import { resolvePublicationTitle } from "./spec-creation-title.ts";
import { deriveSpecRunBodySummary } from "./spec-run-body-summary.ts";
import {
  armSuccessorShellIdleWatchdog,
  isSuccessorShellStallOutcome,
  raceSuccessorShellIdle,
  type SuccessorShellStallOutcome,
} from "./successor-step-idle-watchdog.ts";
import { buildJsonlSink } from "./telemetry-sink.ts";
import {
  boundaryStampFromStoredRun,
  defaultTelemetrySinkPath,
  emitWorkBoundaryRecorded,
} from "./work-boundary-telemetry.ts";
import {
  appendRuntimeSmokeOutcome,
  DEFAULT_ITERATION_TIMEOUT_MS,
  enforcePersistedReadyGateRepairFence,
  executeWriteLoop,
  exhaustedRedTerminalLogFields,
  getUncommittedPaths,
  hasRetainedFinalizationCheckpoint,
  isExhaustedRedTerminalEvidence,
  MAX_MUTATION_REPAIR_ATTEMPTS,
  publishWithReadyRepair,
  runMutationRepairIteration,
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

export function isPostCommitReviewRetryableFailureKind(
  detail: Pick<InvocationFailureDetail, "failureKind" | "exhaustedRoleTimeout">,
): boolean {
  if (detail.failureKind === "stall") return true;
  return detail.failureKind === "timeout" && !isExhaustedRoleTimeout(detail);
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
): Promise<WorkflowStepOutcome> {
  if (step.behavior === "review-debate" || step.behavior === "review") {
    return runReviewDispatch(
      step,
      stepIndex,
      workflowSnapshot,
      onReviewDebateProgress,
      telemetry,
      onStepRunCreated,
      store,
      logSink,
      freshDispatch,
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

  let totalIterationsConsumed = 0;

  for (;;) {
    const indexPath = resolveInWorktree(worktreePath, step.specPath);

    let beforeIndexContent: string;
    try {
      beforeIndexContent = readFileSync(indexPath, "utf8");
    } catch (error) {
      throw new LinkedIndexReadError(indexPath, error);
    }
    const routing = resolveActiveLinkedSubspec(indexPath, worktreePath);
    if (!routing.ok) {
      return linkedImplementRoutingFailureOutcome(routing, totalIterationsConsumed, stepIndex, onStepRunCreated);
    }

    const linkStep: WriteWorkflowStep = {
      ...step,
      stepId: `${step.stepId}~link-${routing.active.index}`,
      expectedArtifactPath: relative(worktreePath, routing.active.path),
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

    const worktreeIndexPath = resolveInWorktree(worktreePath, step.specPath);
    const pinnedRouting = resolvePinnedLinkedSubspec(worktreeIndexPath, worktreePath, routing.active.index);
    if (!pinnedRouting.ok) {
      return linkedImplementRoutingFailureOutcome(pinnedRouting, totalIterationsConsumed, stepIndex, onStepRunCreated);
    }

    const finalized = finalizeLinkedImplementPass(stepped, pinnedRouting, beforeIndexContent, worktreeIndexPath);
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
    let preImplementResetAnchor: { worktreePath: string; sha: string } | undefined;
    let boundaryTelemetryFailure: string | undefined;
    let implementReviewEligible = false;
    const touchedStepsInExecution = new Set<string>();
    const workflowSnapshot = buildWorkflowSnapshot(args.steps, store, args.freshDispatch);

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

      // Per-iteration commits during this step's own write loop can advance HEAD before we ever
      // reach the pre-shrink commit below, so the pre-implement anchor must be sampled here, before
      // any of this step's iterations run — not read back out of HEAD after the fact. The worktree
      // is materialized first so the sample never depends on lazy creation happening inside the step.
      let headBeforeImplementStep: string | undefined;
      if (step.behavior === "write" && step.role === "implement" && !step.suppressShrink) {
        const worktreePathForStep = getExternalWorktreePath(step.worktree);
        await (step.withExternalWorktree ?? realWithExternalWorktree)(step.worktree, () => undefined);
        if (existsSync(join(worktreePathForStep, ".git"))) {
          headBeforeImplementStep = await getCurrentHeadAsync(worktreePathForStep);
        }
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
        const title = resolvePublicationTitle(worktreePath, step.specPath, workflowSnapshot.creationTitle);
        const committed = await createCompletionCommitter()({
          worktreePath,
          baseRef: step.worktree.baseRef,
          specPath: step.specPath,
          agent: completionAgent ?? step.agents[0] ?? "implement",
          title,
          iterationTimeoutMs: step.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS,
        });
        if (committed.commitSha !== undefined) {
          // Same guard (write/implement/!suppressShrink) as the sampling block above, so this is always set.
          preImplementResetAnchor = { worktreePath, sha: headBeforeImplementStep as string };
        }
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
    const publicationAgent =
      lastResult.kind === "complete"
        ? (completionAgent ?? (isReviewLastStep ? (durableWriteAgent ?? completionStep?.agents[0]) : undefined))
        : undefined;

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
      store.setRunStatus(lastResult.runId, "failed");
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
        store.setRunStatus(lastResult.runId, "failed");
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
        const publicationPath = publicationSpecPath ?? writeStepRun?.specPath ?? completionStep.specPath;
        try {
          if (preImplementResetAnchor !== undefined) {
            await realAsyncSubprocessRunner.runAsync(
              "git",
              ["reset", "--mixed", preImplementResetAnchor.sha],
              preImplementResetAnchor.worktreePath,
            );
          }
          const creationTitle = resolvePublicationTitle(worktreePath, publicationPath, workflowSnapshot.creationTitle);
          store.setCreationTitle(lastResult.runId, creationTitle);
          const completionRun = store.findRunByProjectBranch({
            project: worktree.projectName,
            branch: worktree.branchName,
            stepId: completionStep.stepId,
          });
          if (completionRun !== null) store.setCreationTitle(completionRun.id, creationTitle);
          const published = await (args.completionCommitter ?? createCompletionCommitter())({
            worktreePath,
            baseRef: worktree.baseRef,
            specPath: publicationPath,
            agent: publicationAgent,
            title: creationTitle,
            forceDistinctCommit: true,
            iterationTimeoutMs: completionStep.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS,
          });
          if (published.commitSha === undefined) {
            const uncommitted = await getUncommittedPaths(worktreePath);
            const remainingStaged = remainingStagedIntentPaths(worktreePath, completionStep.landing);
            const namedPaths = [...new Set([...uncommitted, ...remainingStaged])];
            if (namedPaths.length > 0) {
              const uncommittedChangesMessage = `Uncommitted changes: ${namedPaths.join(", ")}`;
              store.setRunStatus(lastResult.runId, "failed");
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
          if (published.commitSha !== undefined) {
            const stamped = lastResult as WriteLoopResult;
            stamped.commitSha = published.commitSha;
            if (
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
                publication.failure.kind === "ready_gate_out_of_scope";
              const gateOutOfScopeFields = readyGateOutOfScopeLogFields(publication.failure.error);
              const publicationLoopFinishedBase = {
                kind: "loop_finished" as const,
                iterationsConsumed: totalIterationsConsumed,
                resumable: !isFlipFailure,
                ...survivingMutationLogFields(publication.failure.error),
                ...gateOutOfScopeFields,
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
              store.setRunStatus(lastResult.runId, isFlipFailure ? "completed" : "failed");
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
                resumable: !isFlipFailure,
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
            store.setRunStatus(lastResult.runId, "completed");
            traceCompletionPublication(args.logSink, lastResult.runId, completionStep.landing, worktree.branchName);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const completionCommitErrorMessage = message;
          store.setRunStatus(lastResult.runId, "failed");
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
  const shrinkStep = {
    ...step,
    stepId: `${step.stepId}${SHRINK_STEP_ID_SUFFIX}`,
    role: SHRINK_ROLE,
    promptId: SHRINK_PROMPT_ID,
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

  return executeWriteLoop(
    onStepRunCreated
      ? { ...preparedStep.input, onRunCreated: (runId) => onStepRunCreated(stepIndex, runId) }
      : preparedStep.input,
  );
}

async function shrinkPromptPlaceholders(
  step: WriteWorkflowStep,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<Record<string, string>> {
  const worktreePath = getExternalWorktreePath(step.worktree);
  const allowlist = await changedFiles(worktreePath, step.worktree.baseRef, runner);
  return {
    SPEC_PATH: step.specPath,
    SPEC_TREE: readSpecTree(worktreePath, step.specPath),
    ALLOWLIST: (allowlist.length > 0 ? allowlist : [step.expectedArtifactPath]).map((path) => `- ${path}`).join("\n"),
    BRANCH_DIFF: (await gitOutput(worktreePath, ["diff", "--stat", step.worktree.baseRef, "--"], runner)) || "(empty)",
    RUN_SCOPED_DIFF:
      (await gitOutput(
        worktreePath,
        ["diff", step.worktree.baseRef, "--", ...(allowlist.length > 0 ? allowlist : [step.expectedArtifactPath])],
        runner,
      )) || "(empty)",
  };
}

function readSpecTree(worktreePath: string, specPath: string): string {
  const resolvedSpecPath = isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
  const specRoot = dirname(resolvedSpecPath);
  if (!existsSync(specRoot)) return "(missing spec tree)";

  const files = listMarkdownFiles(specRoot).sort();
  if (files.length === 0) return "(empty spec tree)";

  return files
    .map((filePath) => {
      const label = relative(worktreePath, filePath) || filePath;
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

type ReviewDebateStepOutcome =
  | {
      kind: "complete";
      runId: string;
      iterationsConsumed: number;
      resumable: false;
      completionAgent?: string;
    }
  | {
      kind: "invocation_failure";
      runId: string;
      iterationsConsumed: number;
      resumable: boolean;
      invocationFailureMessage?: string;
    };

type ReviewStepOutcome = WorkflowStepOutcome & { kind: "complete" | "invocation_failure" };

function reviewDebateResultOutcome(result: Awaited<ReturnType<typeof executeReviewDebate>>): {
  kind: "complete" | "invocation_failure";
  failureKind: InvocationFailureKind | undefined;
  terminalRole: ReviewDebateRole;
  completionAgent: string | undefined;
} {
  const lastCycle = result.cycles.at(-1);
  const kind = lastCycle?.kind === "role_failed" ? "invocation_failure" : "complete";
  const failureKind = lastCycle?.kind === "role_failed" ? lastCycle.failureKind : undefined;
  const terminalRole: ReviewDebateRole =
    lastCycle?.kind === "role_failed" ? lastCycle.failedRole : lastCycle?.actuatorRan ? "actuator" : "adjudicator";
  const actuatorExecution =
    lastCycle?.kind === "completed" && lastCycle.actuatorRan ? lastCycle.roleResults?.actuator?.final : undefined;
  const completionAgent =
    kind === "complete" && actuatorExecution?.result.kind === "ok"
      ? actuatorExecution.binding.metadata?.agent?.trim()
      : undefined;
  return { kind, failureKind, terminalRole, completionAgent };
}

function buildReviewRoleTelemetryFields(
  telemetry: WorkflowTelemetryContext | undefined,
  params: { runId: string; attemptId: string; project: string; stepId: string; cwd: string; branch: string },
): { telemetry?: Omit<InvocationTelemetryContext, "role" | "invocationIds"> } {
  if (telemetry === undefined) return {};
  return {
    telemetry: {
      sink: buildJsonlSink(telemetry.sinkPath ?? defaultTelemetrySinkPath()),
      operatorSessionId: telemetry.operatorSessionId,
      runId: params.runId,
      attemptId: params.attemptId,
      project: params.project,
      workflow: telemetry.workflow,
      stepId: params.stepId,
      worktreePath: params.cwd,
      branch: params.branch,
      specRef: "",
    },
  };
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

/**
 * Resolve each of the step's four per-role `agents` orders to that role's bindings and run
 * the debate. The fixed cycle is one durable attempt; mid-cycle resume remains deferred.
 */
async function runReviewDebateStep(
  step: ReviewDebateWorkflowStep,
  stepIndex: number,
  invocationId: string,
  onProgress: ((invocationId: string, stepId: string, progress: ReviewDebateProgress) => void) | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  onStepRunCreated: ((stepIndex: number, runId: string) => void) | undefined,
  store: StateStore,
  workflowSnapshot: WorkflowSnapshot,
  freshDispatch: boolean | undefined,
  logSink?: LogSink,
): Promise<ReviewDebateStepOutcome | ReviewStepOutcome> {
  const {
    stepId,
    project,
    branch,
    agents,
    agentModelConfig,
    createBinding,
    profile: serializedProfile,
    landing,
    ...debateInput
  } = step;
  if (landing !== undefined && landing.kind !== "none" && !freshDispatch) {
    const checkpoint = findReviewLandingCheckpoint(store, step);
    if (checkpoint !== undefined) {
      onStepRunCreated?.(stepIndex, checkpoint.id);
      return finishReviewedLanding(step, landing, checkpoint.id, store, reviewCompletionAgent(checkpoint), logSink);
    }
  }

  const resolveBindings = createBinding ?? createResolvedAgentBinding;

  if (!freshDispatch) {
    const actuatorOnlyRetry = await tryActuatorOnlyReviewDebateRetry(
      step,
      stepIndex,
      invocationId,
      onProgress,
      telemetry,
      onStepRunCreated,
      store,
      resolveBindings,
      logSink,
    );
    if (actuatorOnlyRetry !== undefined) return actuatorOnlyRetry;
  }

  const runId = store.createRun({
    project,
    specRef: landing?.kind === "intent-stage" ? landing.baseRef : "",
    worktreePath: step.cwd,
    branch,
    specPath: step.verdictPath,
    stepId,
    workflowSnapshot,
  });
  const attemptId = store.recordAttemptStart(runId);
  onStepRunCreated?.(stepIndex, runId);
  logSink?.append(runId, { kind: "iteration_started", attemptId });

  const bindings = Object.fromEntries(
    REVIEW_DEBATE_ROLES.map((role) => [
      role,
      resolveInvocationBindings(resolveExecutableRole(role), agents[role], agentModelConfig, resolveBindings),
    ]),
  ) as ReviewDebateRoleBindings;

  const telemetryFields = buildReviewRoleTelemetryFields(telemetry, {
    runId,
    attemptId,
    project,
    stepId,
    cwd: step.cwd,
    branch,
  });

  let invocationCount = 0;
  const debateOutcome = await raceStepSuccessorShellIdle(
    step,
    { runId, attemptId, store, ...(logSink !== undefined ? { logSink } : {}) },
    async ({ signal, onRoleStart }) => {
      const profile = rehydrateReviewPromptProfile(serializedProfile);
      return executeReviewDebate({
        ...debateInput,
        ...(profile !== undefined ? { profile } : {}),
        bindings,
        ...(signal !== undefined ? { signal } : {}),
        ...telemetryFields,
        onRoleStart: (role: ReviewDebateRole) => {
          onRoleStart();
          invocationCount += 1;
          onProgress?.(invocationId, stepId, { status: "in_progress", role });
        },
      });
    },
  );

  if (isSuccessorShellStallOutcome(debateOutcome)) {
    return debateOutcome;
  }

  const result = debateOutcome;

  const { kind, terminalRole, completionAgent } = reviewDebateResultOutcome(result);

  onProgress?.(invocationId, stepId, {
    status: kind === "complete" ? "completed" : "stopped",
    role: terminalRole,
    terminalOutcome: kind,
    attemptCount: Math.max(invocationCount, 1),
  });

  if (kind === "complete" && landing !== undefined && landing.kind !== "none") {
    const landingFailure = await landReviewedOutputOrFail(
      step,
      landing,
      attemptId,
      runId,
      result.cycles.length,
      store,
      logSink,
    );
    if (landingFailure !== undefined) return landingFailure;
  }

  const failed = result.cycles.at(-1);
  const failureDetail =
    kind === "invocation_failure" && failed?.kind === "role_failed"
      ? buildReviewInvocationFailureDetail(failed.failureKind, failed.failedRole, failed.roleResults[failed.failedRole])
      : undefined;

  commitReviewDebateOutcome(store, attemptId, kind, failureDetail, completionAgent);

  const retryableFailure =
    kind === "invocation_failure" &&
    failureDetail !== undefined &&
    isPostCommitReviewRetryableFailureKind(failureDetail);

  return {
    kind,
    runId,
    iterationsConsumed: result.cycles.length,
    resumable: retryableFailure,
    ...(completionAgent ? { completionAgent } : {}),
  };
}

function commitReviewDebateOutcome(
  store: StateStore,
  attemptId: string,
  kind: "complete" | "invocation_failure",
  failureDetail: InvocationFailureDetail | undefined,
  completionAgent: string | undefined,
): void {
  if (kind === "invocation_failure") {
    store.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: "invocation_failure",
      ...(failureDetail !== undefined ? { invocationFailureDetail: failureDetail } : {}),
    });
    return;
  }
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    ...(completionAgent ? { completionAgent } : {}),
  });
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

/** Lands a review step's deferred publication output, failing the attempt on error. */
async function landReviewedOutputOrFail(
  step: Pick<ReviewDebateWorkflowStep | ReviewWorkflowStep, "cwd" | "verdictPath" | "branch" | "project">,
  landing: Exclude<PublicationLanding, { kind: "none" }>,
  attemptId: string,
  runId: string,
  iterationsConsumed: number,
  store: StateStore,
  logSink?: LogSink,
): Promise<ReviewDebateStepOutcome | undefined> {
  const landed = await landReviewedPublicationOutput(step.cwd, landing, step.verdictPath, {
    logSink,
    runId,
    branch: step.branch,
    persistHandoff: { store, project: step.project, branch: step.branch, writeTarget: { reviewRunId: runId } },
  });
  if (landed.ok) return undefined;
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: landed.message },
  });
  return { kind: "invocation_failure", runId, iterationsConsumed, resumable: true };
}

/**
 * Re-dispatch admission for a `review-debate` step whose last attempt failed at the
 * actuator with a post-commit retryable `failureKind` (`timeout` or `stall`). Reuses the
 * same durable run row and re-invokes only the actuator against the already-adjudicated
 * `verdictPath`, instead of replaying the adversary/advocate/adjudicator chain. Returns
 * `undefined` when the step is not eligible, so the caller falls through to a full debate.
 */
async function tryActuatorOnlyReviewDebateRetry(
  step: ReviewDebateWorkflowStep,
  stepIndex: number,
  invocationId: string,
  onProgress: ((invocationId: string, stepId: string, progress: ReviewDebateProgress) => void) | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  onStepRunCreated: ((stepIndex: number, runId: string) => void) | undefined,
  store: StateStore,
  resolveBindings: (binding: ResolvedAgentBinding) => InvocationBinding,
  logSink?: LogSink,
): Promise<ReviewDebateStepOutcome | undefined> {
  // Single-cycle admission only: with maxCycles > 1, an actuator failure on an
  // intermediate cycle would otherwise retry that one actuator and report `complete`,
  // silently dropping the remaining cycles. This also makes the prompt-context
  // reconstruction below (pass 1, no prior-cycle verdict) correct by construction.
  if (step.maxCycles > 1) return undefined;
  const existingRun = store.findRunByProjectBranch({ project: step.project, branch: step.branch, stepId: step.stepId });
  if (existingRun === null || existingRun.status !== "failed") return undefined;
  const lastAttempt = existingRun.attempts.at(-1);
  const detail = lastAttempt?.invocationFailureDetail;
  if (
    lastAttempt?.outcomeKind !== "invocation_failure" ||
    detail?.role !== "actuator" ||
    detail.failureKind === undefined ||
    !isPostCommitReviewRetryableFailureKind(detail)
  ) {
    return undefined;
  }

  const runId = existingRun.id;
  onStepRunCreated?.(stepIndex, runId);
  const attemptId = store.recordAttemptStart(runId);
  logSink?.append(runId, { kind: "iteration_started", attemptId });

  let invocationCount = 0;
  const shellOutcome = await raceStepSuccessorShellIdle(
    step,
    { runId, attemptId, store, ...(logSink !== undefined ? { logSink } : {}) },
    async ({ signal, onRoleStart }) => {
      const verdict = existsSync(step.verdictPath) ? readFileSync(step.verdictPath, "utf8") : "";
      if (verdict.trim().length === 0) {
        const message = `review-debate actuator retry: missing or empty verdict at ${step.verdictPath}`;
        store.commitCompletionBoundary({
          attemptId,
          runStatus: "failed",
          outcomeKind: "invocation_failure",
          invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message },
        });
        return { kind: "missing_verdict" as const, message };
      }

      const bindings = resolveInvocationBindings(
        resolveExecutableRole("actuator"),
        step.agents.actuator,
        step.agentModelConfig,
        resolveBindings,
      );

      const profile = rehydrateReviewPromptProfile(step.profile);
      const profileContext = cycleProfileContext(step.profileContext, 1, undefined);
      const prompt = profile?.render.actuator ? await profile.render.actuator(profileContext, verdict) : verdict;

      const telemetryFields = buildReviewRoleTelemetryFields(telemetry, {
        runId,
        attemptId,
        project: step.project,
        stepId: step.stepId,
        cwd: step.cwd,
        branch: step.branch,
      });

      const execution = await invokeReviewRole(
        {
          cwd: step.cwd,
          ...(signal !== undefined ? { signal } : {}),
          ...(step.roleTimeoutMs !== undefined ? { roleTimeoutMs: step.roleTimeoutMs } : {}),
          ...(step.idleOutputMs !== undefined ? { idleOutputMs: step.idleOutputMs } : {}),
          ...telemetryFields,
          onRoleStart: () => {
            onRoleStart();
            invocationCount += 1;
            onProgress?.(invocationId, step.stepId, { status: "in_progress", role: "actuator" });
          },
        },
        "actuator",
        prompt,
        bindings,
      );
      return { kind: "execution" as const, execution };
    },
  );

  if (isSuccessorShellStallOutcome(shellOutcome)) {
    return shellOutcome;
  }

  if (shellOutcome.kind === "missing_verdict") {
    return {
      kind: "invocation_failure",
      runId,
      iterationsConsumed: 0,
      resumable: false,
      invocationFailureMessage: shellOutcome.message,
    };
  }

  const execution = shellOutcome.execution;

  const failureKind = reviewRoleFailureKind(execution);

  onProgress?.(invocationId, step.stepId, {
    status: failureKind === null ? "completed" : "stopped",
    role: "actuator",
    terminalOutcome: failureKind === null ? "complete" : "invocation_failure",
    attemptCount: Math.max(invocationCount, 1),
  });

  if (failureKind !== null) {
    const detail = buildReviewInvocationFailureDetail(failureKind, "actuator", execution);
    store.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: "invocation_failure",
      invocationFailureDetail: detail,
    });
    return {
      kind: "invocation_failure",
      runId,
      iterationsConsumed: 1,
      resumable: isPostCommitReviewRetryableFailureKind(detail),
    };
  }

  const completionAgent =
    execution.final?.result.kind === "ok" ? execution.final.binding.metadata?.agent?.trim() : undefined;

  if (step.landing !== undefined && step.landing.kind !== "none") {
    const landingFailure = await landReviewedOutputOrFail(step, step.landing, attemptId, runId, 1, store, logSink);
    if (landingFailure !== undefined) return landingFailure;
  }

  store.commitCompletionBoundary({
    attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    ...(completionAgent ? { completionAgent } : {}),
  });

  return {
    kind: "complete",
    runId,
    iterationsConsumed: 1,
    resumable: false,
    ...(completionAgent ? { completionAgent } : {}),
  };
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
    (existing?.status === "failed" &&
      lastAttempt?.outcomeKind === "invocation_failure" &&
      lastAttempt.invocationFailureDetail?.failureKind === "landing")
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
 * Intent landing excludes its reserved verdict. Plan landing carries its verdict verbatim.
 * This is the one promotion + verdict-cleanup entry shared by every review-landing call site
 * (light review, review-debate, and the non-durable profile review path); it always runs
 * regardless of whether the review step's actuator ran. Returns `{ ok: true, specPath }` on
 * success or `{ ok: false, message }` on failure.
 */
async function landReviewedPublicationOutput(
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
    if (deferred.kind === "intent-stage") {
      excludeVerdictFromStaging(resolve(worktreePath, deferred.stagingDir), verdictPath);
    }
    if (owner !== undefined) {
      rmSync(ownerPath, { force: true });
    }
    const result = await landPublication(deferred, worktreePath);
    if (trace?.persistHandoff) {
      persistIntentHandoff(
        trace.persistHandoff.store,
        deferred,
        result,
        trace.persistHandoff.project,
        trace.persistHandoff.branch,
        trace.persistHandoff.writeTarget,
      );
    }
    if (trace) recordIntentFinalization(trace.logSink, trace.runId, "review_landing", trace.branch);
    return { ok: true, specPath: result.specPath };
  } catch (error) {
    restoreVerdictSidecars(verdictPath, verdict, ownerPath, owner);
    const message = error instanceof Error ? error.message : String(error);
    if (trace) recordIntentFinalization(trace.logSink, trace.runId, "review_landing", trace.branch, message);
    return { ok: false, message };
  }
}

function reviewCompletionAgent(run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>): string | undefined {
  for (let index = run.attempts.length - 1; index >= 0; index -= 1) {
    const agent = run.attempts[index]?.completionAgent?.trim();
    if (agent) return agent;
  }
  return undefined;
}

async function finishReviewedLanding(
  step: Pick<ReviewDebateWorkflowStep | ReviewWorkflowStep, "cwd" | "verdictPath" | "branch" | "project">,
  deferred: Exclude<PublicationLanding, { kind: "none" }>,
  runId: string,
  store: StateStore,
  completionAgent: string | undefined,
  logSink?: LogSink,
): Promise<ReviewStepOutcome> {
  const attemptId = store.recordAttemptStart(runId);
  logSink?.append(runId, { kind: "iteration_started", attemptId });
  const landed = await landReviewedPublicationOutput(step.cwd, deferred, step.verdictPath, {
    logSink,
    runId,
    branch: step.branch,
    persistHandoff: { store, project: step.project, branch: step.branch, writeTarget: { reviewRunId: runId } },
  });
  if (!landed.ok) {
    store.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: "invocation_failure",
      invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: landed.message },
    });
    const outcome: ReviewStepOutcome = { kind: "invocation_failure", runId, iterationsConsumed: 0, resumable: true };
    logSink?.append(runId, {
      kind: "loop_finished",
      loopOutcomeKind: outcome.kind,
      iterationsConsumed: outcome.iterationsConsumed,
      resumable: outcome.resumable,
    });
    return outcome;
  }
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    ...(completionAgent ? { completionAgent } : {}),
  });
  const outcome: ReviewStepOutcome = {
    kind: "complete",
    runId,
    iterationsConsumed: 0,
    resumable: false,
    ...(completionAgent ? { completionAgent } : {}),
  };
  logSink?.append(runId, {
    kind: "loop_finished",
    loopOutcomeKind: outcome.kind,
    iterationsConsumed: outcome.iterationsConsumed,
    resumable: outcome.resumable,
  });
  return outcome;
}

const INTENT_STAGE_DIR = ".jarvis-intent-stage";

/** Reconstructed context for resuming a review-behavior step's populated-stage `landing_failed` row. */
export type IntentFinalizationResumeContext = {
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
};

export type IntentFinalizationResumeResolution =
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

/** A row's stepId is the authored write step itself, or one of its linked-implement executions. */
function isWriteSiblingStepId(candidateStepId: string | null | undefined, writeStepId: string): boolean {
  return candidateStepId === writeStepId || (candidateStepId?.startsWith(`${writeStepId}~link-`) ?? false);
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
  const completionAgent = reviewCompletionAgent(run) ?? reviewCompletionAgent(writeRun) ?? writeStep?.agents?.[0];
  return { ok: true, head: { snapshot, writeStep, writeRun, completionAgent } };
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
  const completionAgent = reviewCompletionAgent(writeRun) ?? writeStep?.agents?.[0];
  return { ok: true, head: { snapshot, writeStep, writeRun, completionAgent } };
}

/** True when `.jarvis-intent-stage/` exists under `worktreePath` and holds at least one file. */
export function hasPopulatedIntentStage(worktreePath: string): boolean {
  const stageDir = join(worktreePath, INTENT_STAGE_DIR);
  if (!existsSync(stageDir)) return false;
  try {
    return readdirSync(stageDir, { withFileTypes: true }).some((entry) => entry.isFile());
  } catch {
    return false;
  }
}

/**
 * Admission and reconstruction for resuming a review-behavior step's `landing_failed` row without
 * re-entering review: requires a failed review/review-debate row whose last attempt recorded a
 * landing invocation failure, a populated `.jarvis-intent-stage/`, and the sibling durable write
 * step's own row — the only row carrying the resolved `durableDir` (its `specPath`).
 */
export function resolveIntentFinalizationResumeContext(
  run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>,
  store: StateStore,
): IntentFinalizationResumeResolution {
  const head = resolveReviewRowHead(run, store);
  if (!head.ok) return head;
  const { snapshot, writeRun, completionAgent } = head.head;
  const lastAttempt = run.attempts.at(-1);
  if (
    lastAttempt?.outcomeKind !== "invocation_failure" ||
    lastAttempt.invocationFailureDetail?.failureKind !== "landing"
  ) {
    return { ok: false, message: "run did not fail at landing" };
  }
  if (!hasPopulatedIntentStage(run.worktreePath)) {
    return { ok: false, message: "the intent stage is empty or missing" };
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
      },
      completionAgent,
      creationTitleHint: snapshot.creationTitle,
    },
  };
}

export type IntentFinalizationResumeOutcome =
  | { ok: true; commitSha?: string; prNumber?: number; prUrl?: string }
  | { ok: false; message: string };

export type IntentFinalizationResumeDeps = {
  logSink?: LogSink;
  completionCommitter?: CompletionCommitter;
  completionPublisher?: CompletionPublisher;
  readyFinalizer?: ReadyFinalizer;
  runFixCommand?: (opts: RunFixCommandOpts) => Promise<void>;
};

/** Settle the resume attempt as a visible failure — never a silent no-op on an admitted resume. */
function settleIntentResumeFailure(
  store: StateStore,
  context: IntentFinalizationResumeContext,
  attemptId: string,
  loopOutcomeKind: WriteLoopOutcomeKind,
  iterationsConsumed: number,
  message: string,
  deps: IntentFinalizationResumeDeps,
): IntentFinalizationResumeOutcome {
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message },
  });
  const intentResumeCommitErrorMessage = message;
  deps.logSink?.append(context.runId, {
    kind: "loop_finished",
    loopOutcomeKind,
    iterationsConsumed,
    resumable: true,
    ...(loopOutcomeKind === "completion_commit_failed"
      ? { completionCommitError: intentResumeCommitErrorMessage }
      : {}),
  });
  traceCompletionPublication(
    deps.logSink,
    context.runId,
    context.landing,
    context.branch,
    `${loopOutcomeKind}: ${message}`,
  );
  return { ok: false, message };
}

/** Stub `WriteLoopInput` for `publishWithReadyRepair`: `maxIterations: 0` forbids the agent-driven
 * ready-gate repair branch (no agent bindings exist on resume) so any gate failure surfaces directly. */
function inertResumeWriteLoopInput(
  context: { worktreePath: string; project: string; branch: string; baseRef: string },
  specPath: string,
  deps: IntentFinalizationResumeDeps,
): WriteLoopInput {
  const fixCommand = readProjectFixCommand(context.project);
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
    ...(deps.completionCommitter !== undefined ? { completionCommitter: deps.completionCommitter } : {}),
    ...(deps.completionPublisher !== undefined ? { completionPublisher: deps.completionPublisher } : {}),
    ...(deps.readyFinalizer !== undefined ? { readyFinalizer: deps.readyFinalizer } : {}),
    ...(deps.runFixCommand !== undefined ? { runFixCommand: deps.runFixCommand } : {}),
    ...(deps.logSink !== undefined ? { logSink: deps.logSink } : {}),
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
  return settleIntentResumeFailure(
    store,
    context,
    attemptId,
    "completion_commit_failed",
    0,
    `Uncommitted changes: ${namedPaths.join(", ")}`,
    deps,
  );
}

async function runIntentResumeCommitAndPublish(
  context: IntentFinalizationResumeContext,
  store: StateStore,
  attemptId: string,
  deps: IntentFinalizationResumeDeps,
): Promise<IntentFinalizationResumeOutcome> {
  const creationTitle = resolvePublicationTitle(context.worktreePath, context.durableDir, context.creationTitleHint);
  store.setCreationTitle(context.runId, creationTitle);
  const committer = deps.completionCommitter ?? createCompletionCommitter();
  let published: Awaited<ReturnType<CompletionCommitter>>;
  try {
    published = await committer({
      worktreePath: context.worktreePath,
      baseRef: context.baseRef,
      specPath: context.durableDir,
      agent: context.completionAgent as string,
      title: creationTitle,
      forceDistinctCommit: true,
      iterationTimeoutMs: DEFAULT_ITERATION_TIMEOUT_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return settleIntentResumeFailure(store, context, attemptId, "completion_commit_failed", 0, message, deps);
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
    inertResumeWriteLoopInput(context, context.durableDir, deps),
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
    store.commitCompletionBoundary({
      attemptId,
      runStatus: isFlip ? "completed" : "failed",
      outcomeKind: isFlip ? "done" : "invocation_failure",
      ...(isFlip ? {} : { invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message } }),
    });
    const intentResumePublicationCommitError = message;
    deps.logSink?.append(context.runId, {
      kind: "loop_finished",
      loopOutcomeKind: failure.kind,
      iterationsConsumed: publication.iterationsConsumed,
      resumable: !isFlip,
      ...survivingMutationLogFields(failure.error),
      ...readyGateOutOfScopeLogFields(failure.error),
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

  const attemptId = store.recordAttemptStart(context.runId);
  deps.logSink?.append(context.runId, { kind: "iteration_started", attemptId });

  try {
    if (context.completionAgent === undefined) {
      return settleIntentResumeFailure(
        store,
        context,
        attemptId,
        "invocation_failure",
        0,
        "no completion agent available to attribute the publication commit",
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
      return settleIntentResumeFailure(store, context, attemptId, "invocation_failure", 0, landed.message, deps);
    }

    return await runIntentResumeCommitAndPublish(context, store, attemptId, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return settleIntentResumeFailure(store, context, attemptId, "invocation_failure", 0, message, deps);
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
  "ready_gate_failed",
  "ready_gate_out_of_scope",
  "completion_commit_failed",
]);

/** Reconstructed context for resuming a review-behavior row that settled `surviving_mutation_failed`. */
export type ReviewMutationResumeContext = {
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

export type ReviewMutationResumeResolution =
  | { ok: true; context: ReviewMutationResumeContext }
  | { ok: false; message: string };

/** Reconstruct a durable review-mutation row's write-sibling context without admitting its outcome. */
export function resolveReviewMutationLineageContext(run: Run, store: StateStore): ReviewMutationResumeResolution {
  const head = resolveReviewMutationRowHead(run, store);
  if (!head.ok) return head;
  const { snapshot, writeStep, writeRun } = head.head;
  const completionAgent = reviewCompletionAgent(writeRun) ?? writeStep?.agents?.[0];
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
  const step = stepId ? snapshot?.steps.find((candidate) => candidate.stepId === stepId) : undefined;
  if (step?.behavior === "review" || step?.behavior === "review-debate") {
    return { ok: false, message: "run is a review-behavior step" };
  }
  if (run.status !== "failed") {
    return { ok: false, message: "run is not in a failed state" };
  }
  if (terminalRecord?.event.kind !== "loop_finished" || !options.admit(terminalRecord.event)) {
    return { ok: false, message: options.rejectMessage };
  }
  const completionAgent = options.completionAgent ?? reviewCompletionAgent(run) ?? step?.agents?.[0];
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
    admit: (event) => event.loopOutcomeKind === "ready_gate_out_of_scope",
    rejectMessage: "run did not fail with ready_gate_out_of_scope",
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

export type ReviewMutationResumeOutcome =
  | { ok: true; prNumber?: number; prUrl?: string }
  | { ok: false; message: string };

export type ReviewMutationResumeDeps = IntentFinalizationResumeDeps & {
  /** Present only for `implement.recover`; plain `run resume` remains agent-free. */
  mutationRepair?: Pick<
    WriteLoopInput,
    "bindings" | "stepRules" | "iterationTimeoutMs" | "iterationCeilingMs" | "idleOutputMs"
  >;
  bypassPersistedReadyGateRepairFenceForTest?: boolean;
};

/** Settle the review-mutation resume attempt as a visible failure — never a silent no-op or a strand at `in-progress`. */
function settleReviewMutationResumeFailure(
  store: StateStore,
  context: ReviewMutationResumeContext,
  attemptId: string,
  loopOutcomeKind: WriteLoopOutcomeKind,
  message: string,
  deps: ReviewMutationResumeDeps,
): ReviewMutationResumeOutcome {
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message },
  });
  const reviewMutationResumeCommitErrorMessage = message;
  deps.logSink?.append(context.runId, {
    kind: "loop_finished",
    loopOutcomeKind,
    iterationsConsumed: 0,
    // Reflects this resolver's own retryability (see the sibling emit site below), not a blanket
    // "this tail can always be retried" — e.g. `invocation_failure` (no completion agent, thrown
    // error) is never in the admitted set, so it must not claim resumable either.
    resumable: REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS.has(loopOutcomeKind),
    ...(loopOutcomeKind === "completion_commit_failed"
      ? { completionCommitError: reviewMutationResumeCommitErrorMessage }
      : {}),
  });
  return { ok: false, message };
}

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
  const recoveryFenceError = await enforcePersistedReadyGateRepairFence(
    {
      worktreePath: context.worktreePath,
      baseRef: context.baseRef,
      specPath: context.specPath,
    },
    store,
    context.writeSiblingRunId,
    {
      bypass: deps.bypassPersistedReadyGateRepairFenceForTest === true,
    },
  );
  if (recoveryFenceError !== undefined) {
    return settleReviewMutationResumeFailure(
      store,
      context,
      attemptId,
      "completion_commit_failed",
      recoveryFenceError.message,
      deps,
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
      forceDistinctCommit: true,
      iterationTimeoutMs: deps.mutationRepair?.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return settleReviewMutationResumeFailure(store, context, attemptId, "completion_commit_failed", message, deps);
  }
  if (published.commitSha === undefined) {
    const uncommitted = await getUncommittedPaths(context.worktreePath);
    if (uncommitted.length > 0) {
      return settleReviewMutationResumeFailure(
        store,
        context,
        attemptId,
        "completion_commit_failed",
        `Uncommitted changes: ${uncommitted.join(", ")}`,
        deps,
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
  const repairOutcome = await runMutationRepairIteration(repairArgs, store, result, mutationError, attempt);
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
  try {
    await (deps.completionCommitter ?? createCompletionCommitter())({
      worktreePath: context.worktreePath,
      baseRef: context.baseRef,
      specPath: context.specPath,
      agent: context.completionAgent ?? "",
      title: creationTitle,
      forceDistinctCommit: true,
      iterationTimeoutMs: deps.mutationRepair?.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: "settled",
      outcome: await settleReviewMutationResumeFailure(
        store,
        context,
        store.recordAttemptStart(context.runId),
        "completion_commit_failed",
        message,
        deps,
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
      outcome: await settleReviewMutationResumeFailure(
        store,
        context,
        store.recordAttemptStart(context.runId),
        publication.failure.kind,
        publication.failure.error?.message ?? publication.failure.kind,
        deps,
      ),
    };
  }

  const finalAttemptId = store.recordAttemptStart(context.runId);
  appendRuntimeSmokeOutcome(deps.logSink, context.runId, publication.success?.runtimeSmokeOutcome);
  store.commitCompletionBoundary({
    attemptId: finalAttemptId,
    runStatus: "completed",
    outcomeKind: "done",
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
  store.commitCompletionBoundary({
    attemptId,
    runStatus: isFlip ? "completed" : "failed",
    outcomeKind: isFlip ? "done" : "invocation_failure",
    ...(isFlip ? {} : { invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message } }),
    ...(context.completionAgent !== undefined ? { completionAgent: context.completionAgent } : {}),
  });
  const exhaustedFields = reviewMutationExhaustedTerminalFields(store, context.runId, publication.readyGateOrigin);
  const reviewMutationPublicationCommitError = message;
  deps.logSink?.append(context.runId, {
    kind: "loop_finished",
    loopOutcomeKind: failure.kind,
    iterationsConsumed: publication.iterationsConsumed,
    // Reflects this resolver's own retryability, not merely "not a ready-flip": `runtime_smoke_failed`
    // is excluded from `REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS`, so retrying this tail can never
    // change that outcome — the newly emitted record must say so rather than claim resumable.
    resumable: !isFlip && REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS.has(failure.kind),
    ...survivingMutationLogFields(failure.error),
    ...readyGateOutOfScopeLogFields(failure.error),
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
): Promise<ReviewMutationResumeOutcome> {
  const creationTitle = resolvePublicationTitle(context.worktreePath, context.specPath, context.creationTitleHint);
  store.setCreationTitle(context.runId, creationTitle);
  const commitFailure = await commitReviewMutationResumeChanges(context, store, attemptId, creationTitle, deps);
  if (commitFailure !== undefined) return commitFailure;

  const publishFenceError = await enforcePersistedReadyGateRepairFence(
    {
      worktreePath: context.worktreePath,
      baseRef: context.baseRef,
      specPath: context.specPath,
    },
    store,
    context.writeSiblingRunId,
    {
      bypass: deps.bypassPersistedReadyGateRepairFenceForTest === true,
    },
  );
  if (publishFenceError !== undefined) {
    return settleReviewMutationResumeFailure(
      store,
      context,
      attemptId,
      "completion_commit_failed",
      publishFenceError.message,
      deps,
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
    inertResumeWriteLoopInput(context, context.specPath, deps),
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

async function replayMutationFinalization(
  resolved: ReviewMutationResumeResolution,
  store: StateStore,
  deps: ReviewMutationResumeDeps,
): Promise<ReviewMutationResumeOutcome> {
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const { context } = resolved;

  const attemptId = store.recordAttemptStart(context.runId);
  store.setRunStatus(context.runId, "in-progress");
  deps.logSink?.append(context.runId, { kind: "iteration_started", attemptId });

  try {
    if (context.completionAgent === undefined) {
      return settleReviewMutationResumeFailure(
        store,
        context,
        attemptId,
        "invocation_failure",
        "no completion agent available to attribute the publication commit",
        deps,
      );
    }

    return await runReviewMutationCommitAndPublish(context, store, attemptId, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return settleReviewMutationResumeFailure(store, context, attemptId, "invocation_failure", message, deps);
  }
}

/** Finalization-only replay for review-mutation, exhausted-red, and write out-of-scope gate failures. */
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
  return replayMutationFinalization(resolved, store, deps);
}

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

function buildReviewInvocationFailureDetail(
  failureKind: InvocationFailureKind,
  failedRole: string,
  roleExecution: ReviewRoleInvocationExecution | undefined,
  message?: string,
): InvocationFailureDetail {
  const roleTimeout = roleExecution?.roleTimeout;
  const attribution = roleTimeout ?? roleExecution?.idleTimeout;
  return {
    failureKind,
    bindingAttempts: roleTimeout?.bindingAttempts ?? [],
    message:
      roleTimeout !== undefined
        ? `review: ${failedRole} exceeded ${roleTimeout.boundMs}ms bound (agent=${roleTimeout.agent ?? "unknown"}, model=${roleTimeout.model ?? "unknown"})`
        : (message ?? `review: ${failedRole} invocation failed (${failureKind})`),
    ...(attribution !== undefined ? attribution : {}),
  };
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
) {
  if (landing?.kind === "intent-stage") {
    return executeReviewCycleEnforced({
      input: reviewCycleInput,
      invocationId: landing.invocationId,
      stagingDir: resolve(step.cwd, landing.stagingDir),
      cwd: step.cwd,
      verdictPath: reviewInput.verdictPath,
    });
  }
  return {
    result: await executeReviewCycle(reviewCycleInput),
    verdictState: { kind: "missing" } as const,
    boundaryViolation: undefined as string | undefined,
  };
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
  store: StateStore,
  logSink?: LogSink,
): Promise<ReviewStepOutcome> {
  const completionAgent =
    result.cycles.at(-1)?.kind === "completed"
      ? result.cycles.at(-1)?.roleResults.actuator?.final?.binding.metadata?.agent?.trim()
      : undefined;
  if (landing !== undefined && landing.kind !== "none") {
    const landingFailure = await landReviewedOutputOrFail(
      step,
      landing,
      ids.attemptId,
      ids.runId,
      result.cycles.length,
      store,
      logSink,
    );
    if (landingFailure !== undefined) return landingFailure;
  }
  store.commitCompletionBoundary({
    attemptId: ids.attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    ...(completionAgent ? { completionAgent } : {}),
  });
  return {
    kind: "complete",
    runId: ids.runId,
    iterationsConsumed: result.cycles.length,
    resumable: false,
    ...(completionAgent ? { completionAgent } : {}),
  };
}

function resolveProfileReviewCompletion(lastCycle: ReviewCycleOutcome | undefined): {
  kind: "complete" | "invocation_failure";
  terminalRole: ReviewCycleRole;
  completionAgent: string | undefined;
} {
  if (lastCycle?.kind === "role_failed") {
    return { kind: "invocation_failure", terminalRole: lastCycle.failedRole, completionAgent: undefined };
  }
  const actuatorRan = lastCycle?.kind === "completed" && lastCycle.actuatorRan;
  const actuatorExecution = actuatorRan ? lastCycle.roleResults?.actuator?.final : undefined;
  const completionAgent =
    actuatorExecution?.result.kind === "ok" ? actuatorExecution.binding.metadata?.agent?.trim() : undefined;
  return { kind: "complete", terminalRole: actuatorRan ? "actuator" : "critic", completionAgent };
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
): Promise<ReviewStepOutcome> {
  const { stepId } = step;
  const invocationCount = { value: 0 };
  const profile = rehydrateReviewPromptProfile(step.profile);
  const result = await executeReviewCycle({
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
  });

  const lastCycle = result.cycles[result.cycles.length - 1];
  const { kind, terminalRole, completionAgent } = resolveProfileReviewCompletion(lastCycle);

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

  return finalizeStandardReviewStep(step, landing, result, ids, store, logSink);
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
        logSink,
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
        ),
    );
  } else {
    outcome = await runProfileReviewStep(step, reviewInput, ids, bindings, invocationId, onProgress, telemetry);
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
