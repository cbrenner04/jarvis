import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createResolvedAgentBinding, type ResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { completeLinkedSubspec, resolveActiveLinkedSubspec } from "../../../shared/linked-subspec-routing.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import {
  type AgentModelConfig,
  resolveExecutableRole,
  resolveInvocationBindings,
} from "../config/agent-model-config.ts";
import type { ImplementReviewBehavior } from "../config/machine-config-loader.ts";
import type { LogSink } from "../persistence/log-stream.ts";
import {
  type OnReviseConfig,
  openStateStore,
  type RunStatus,
  type StateStore,
  type WorkflowSnapshot,
} from "../persistence/state-store.ts";
import { type CompletionCommitter, createCompletionCommitter } from "./completion-commit.ts";
import type { CompletionPublisher } from "./completion-publisher.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { listLandedIntentFiles } from "./intent-output.ts";
import { deriveIntentRunBodySummary } from "./intent-run-body-summary.ts";
import { landPublication, type PublicationLanding } from "./publication-landing.ts";
import type { ReadyFinalizer } from "./ready-finalize.ts";
import {
  executeReviewCycle,
  type ReviewCycleInput,
  type ReviewCycleResult,
  type ReviewCycleRole,
} from "./review-cycle.ts";
import {
  executeReviewDebate,
  type ReviewDebateInput,
  type ReviewDebateRole,
  type ReviewDebateRoleBindings,
} from "./review-debate.ts";
import {
  cleanupVerdictFile,
  excludeVerdictFromStaging,
  executeReviewCycleEnforced,
} from "./review-intent-enforcement.ts";
import { parseRevisionNumber } from "./revision-step-id.ts";
import { resolvePublicationTitle } from "./spec-creation-title.ts";
import { deriveSpecRunBodySummary } from "./spec-run-body-summary.ts";
import { buildJsonlSink } from "./telemetry-sink.ts";
import {
  boundaryStampFromStoredRun,
  defaultTelemetrySinkPath,
  emitWorkBoundaryRecorded,
} from "./work-boundary-telemetry.ts";
import {
  executeWriteLoop,
  publishCompletionArtifacts,
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

/**
 * A human decision gate. Carries none of the write-loop-only fields (`role`,
 * `agents`, `stepRules`, `agentModelConfig`, `expectedArtifactPath`) and no
 * `worktree` of its own — only the `(project, branch)` identity its run row
 * needs, distinct from the worktree a later `onRevise` decision may name.
 */
export type HumanWorkflowStep = {
  behavior: "human";
  stepId: string;
  project: string;
  branch: string;
  onRevise?: OnReviseConfig;
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
  /** When configured, landing is deferred until after successful review. */
  landing?: PublicationLanding;
};

/** Live/terminal progress for a review step's daemon-visible row, tracked in-memory only. */
export type ReviewProgress =
  | { status: "in_progress"; role: ReviewDebateRole | ReviewCycleRole }
  | {
      status: "completed" | "stopped";
      role: ReviewDebateRole | ReviewCycleRole;
      terminalOutcome: "complete" | "invocation_failure";
    };

export type ReviewDebateProgress = ReviewProgress;

/** One authored workflow step with durable run identity, dispatched on `behavior` at execution. */
export type WorkflowStep = WriteWorkflowStep | HumanWorkflowStep;

export type AnyWorkflowStep = WorkflowStep | ReviewDebateWorkflowStep | ReviewWorkflowStep;

export type WorkflowStepInput = AnyWorkflowStep;

export type WorkflowResult = {
  kind: WriteLoopOutcomeKind | "awaiting-human" | "revising" | "pre-publication";
  stepIndex: number;
  stepId: string;
  runId: string;
  iterationsConsumed: number;
  resumable: boolean;
  commitSha?: string;
  completionCommitError?: string;
  readyFinalizeError?: string;
  boundaryTelemetryFailure?: string;
  prePublicationError?: string;
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
  kind: WriteLoopOutcomeKind | "awaiting-human" | "revising";
  runId: string;
  iterationsConsumed: number;
  resumable: boolean;
  routingFailure?: string;
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
  if (step.behavior === "human") {
    const humanStep = prepareHumanWorkflowStep(step, workflowSnapshot, store);
    onStepRunCreated?.(stepIndex, humanStep.runId);
    return {
      kind: humanStep.kind === "completed" ? "complete" : humanStep.kind,
      runId: humanStep.runId,
      iterationsConsumed: 0,
      resumable: false,
    };
  }

  if (step.behavior === "review-debate" || step.behavior === "review") {
    return runReviewDispatch(
      step,
      stepIndex,
      workflowSnapshot.invocationId,
      onReviewDebateProgress,
      telemetry,
      onStepRunCreated,
      store,
      logSink,
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

/** Linked-index routing base: external worktree when present, else registered project root. */
function resolveLinkedImplementRoutingBase(worktreePath: string, projectRoot: string): string {
  return existsSync(worktreePath) ? worktreePath : projectRoot;
}

function linkedImplementRoutingFailureOutcome(
  routing: Extract<ReturnType<typeof resolveActiveLinkedSubspec>, { ok: false }>,
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
      ? { ...preparedLink.input, onRunCreated: (runId) => onStepRunCreated(stepIndex, runId) }
      : preparedLink.input,
  );
}

function finalizeLinkedImplementPass(
  stepped: WorkflowStepOutcome,
  routing: Extract<ReturnType<typeof resolveActiveLinkedSubspec>, { ok: true }>,
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
 * Drive one `implement` step across every unchecked linked subspec named by its
 * index (`specPath`). Each pass re-resolves the active link, runs the write
 * loop against it with that link's path as the completion artifact, then — only
 * once the write loop reports `complete` — verifies the link's non-human-only
 * acceptance criteria, guards against agent-authored edits to the index routing
 * checklist, and advances only that link's checkbox before resolving the next
 * link. Returns as soon as a link produces a non-complete outcome, or once the
 * terminal link advances.
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
  const projectRoot = step.worktree.projectRoot;

  let totalIterationsConsumed = 0;

  for (;;) {
    const routingBase = resolveLinkedImplementRoutingBase(worktreePath, projectRoot);
    const indexPath = resolveInWorktree(routingBase, step.specPath);

    let beforeIndexContent: string;
    try {
      beforeIndexContent = readFileSync(indexPath, "utf8");
    } catch (error) {
      throw new LinkedIndexReadError(indexPath, error);
    }
    const routing = resolveActiveLinkedSubspec(indexPath, routingBase);
    if (!routing.ok) {
      return linkedImplementRoutingFailureOutcome(routing, totalIterationsConsumed, stepIndex, onStepRunCreated);
    }

    const linkStep: WriteWorkflowStep = {
      ...step,
      stepId: `${step.stepId}~link-${routing.active.index}`,
      expectedArtifactPath: relative(routingBase, routing.active.path),
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
    );

    totalIterationsConsumed += outcome.iterationsConsumed;
    const stepped: WorkflowStepOutcome = { ...outcome, iterationsConsumed: totalIterationsConsumed };

    if (outcome.kind !== "complete") {
      return stepped;
    }

    const worktreeIndexPath = resolveInWorktree(worktreePath, step.specPath);
    const worktreeRouting = resolveActiveLinkedSubspec(worktreeIndexPath, worktreePath);
    if (!worktreeRouting.ok) {
      return linkedImplementRoutingFailureOutcome(
        worktreeRouting,
        totalIterationsConsumed,
        stepIndex,
        onStepRunCreated,
      );
    }

    const finalized = finalizeLinkedImplementPass(stepped, worktreeRouting, beforeIndexContent, worktreeIndexPath);
    if (finalized !== undefined) {
      return finalized;
    }
  }
}

async function getUncommittedPaths(worktreePath: string): Promise<string[]> {
  return (await gitOutput(worktreePath, ["status", "--porcelain"]))
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
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
  validateOnReviseTargets(args.steps);

  const store = args.stateStore ?? openStateStore();

  try {
    let totalIterationsConsumed = 0;
    let lastResult: WorkflowStepOutcome | undefined;
    let lastStepId = "";
    let completionAgent: string | undefined;
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
        };
      }

      if (step.behavior === "write" && step.role === "implement" && !step.suppressShrink && implementReviewEligible) {
        const shrinkResult = await runShrinkAfterImplementComplete(
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
        if (shrinkResult.kind === "complete" && (shrinkResult as WriteLoopResult).completionAgent) {
          completionAgent = (shrinkResult as WriteLoopResult).completionAgent;
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

    const publicationAgent = lastResult.kind === "complete" ? completionAgent : undefined;
    let publicationSpecPath: string | undefined;
    const completionStep = [...args.steps].reverse().find(isWriteStep);
    const lastStep = args.steps[args.steps.length - 1];
    const isReviewLastStep = lastStep?.behavior === "review";

    // For reviewed intent workflows, landing is deferred until after review completes.
    // Skip landing if the last step is a review step; it will be handled after review.
    if (
      publicationAgent !== undefined &&
      completionStep?.landing !== undefined &&
      completionStep.landing.kind !== "none" &&
      !isReviewLastStep
    ) {
      const worktreePath = getExternalWorktreePath(completionStep.worktree);
      try {
        publicationSpecPath = (await landPublication(completionStep.landing, worktreePath)).specPath;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        store.setRunStatus(lastResult.runId, "failed");
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
        const publicationPath = publicationSpecPath ?? completionStep.specPath;
        try {
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
          });
          if (published.commitSha === undefined) {
            const uncommitted = await getUncommittedPaths(worktreePath);
            if (uncommitted.length > 0) {
              args.logSink?.append(lastResult.runId, {
                kind: "loop_finished",
                loopOutcomeKind: "completion_commit_failed",
                iterationsConsumed: totalIterationsConsumed,
                resumable: true,
              });
              return {
                kind: "completion_commit_failed",
                stepIndex: args.steps.length - 1,
                stepId: lastStepId,
                runId: lastResult.runId,
                iterationsConsumed: totalIterationsConsumed,
                resumable: true,
                completionCommitError: `Uncommitted changes: ${uncommitted.join(", ")}`,
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
            if (completionStep.landing?.kind === "intent-stage") {
              bodySummary = deriveIntentRunBodySummary({
                creationTitle: workflowSnapshot.creationTitle,
                intentFiles: await listLandedIntentFiles(worktreePath, workflowSnapshot.invocationId),
              });
            } else if (
              completionStep.landing?.kind === "plan-tree" ||
              completionStep.promptId === "plan.prompt.draft"
            ) {
              bodySummary = deriveSpecRunBodySummary({
                worktreePath,
                specPath: publicationSpecPath ?? completionStep.specPath,
              });
            }
            const publishError = await publishCompletionArtifacts(
              {
                ...(args.completionPublisher !== undefined ? { completionPublisher: args.completionPublisher } : {}),
                ...(args.readyFinalizer !== undefined ? { readyFinalizer: args.readyFinalizer } : {}),
              },
              {
                worktreePath,
                baseRef: worktree.baseRef,
                specPath: publicationPath,
                branch: worktree.branchName,
                creationTitle,
                ...(bodySummary !== undefined ? { bodySummary } : {}),
              },
            );
            if (publishError !== undefined) {
              const loopOutcomeKind = publishError.kind;
              args.logSink?.append(lastResult.runId, {
                kind: "loop_finished",
                loopOutcomeKind,
                iterationsConsumed: totalIterationsConsumed,
                resumable: true,
              });
              return {
                kind: loopOutcomeKind,
                stepIndex: args.steps.length - 1,
                stepId: lastStepId,
                runId: lastResult.runId,
                iterationsConsumed: totalIterationsConsumed,
                resumable: true,
                ...(loopOutcomeKind === "ready_finalize_failed"
                  ? { readyFinalizeError: publishError.error?.message ?? "ready finalize failed" }
                  : { completionCommitError: publishError.error?.message ?? "completion commit failed" }),
              };
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          args.logSink?.append(lastResult.runId, {
            kind: "loop_finished",
            loopOutcomeKind: "completion_commit_failed",
            iterationsConsumed: totalIterationsConsumed,
            resumable: true,
          });
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

/** Fail before durable state changes if any step role is missing from its agent config. */
export function validateWorkflowStepRoles(steps: readonly AnyWorkflowStep[]): void {
  const missingBindings = steps.flatMap((step) => missingWorkflowStepRoleBindings(step));

  if (missingBindings.length > 0) {
    throw new Error(`Workflow step role validation failed: ${missingBindings.join(", ")}`);
  }
}

function missingWorkflowStepRoleBindings(step: AnyWorkflowStep): string[] {
  if (step.behavior === "human") return [];
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

/** Fail before durable state changes if a human step's `onRevise.repeatStepId` isn't an earlier step's `stepId`. */
function validateOnReviseTargets(steps: readonly AnyWorkflowStep[]): void {
  const invalidTargets: string[] = [];

  steps.forEach((step, stepIndex) => {
    if (step.behavior !== "human" || step.onRevise === undefined) return;
    const targetIndex = steps.findIndex((candidate) => candidate.stepId === step.onRevise?.repeatStepId);
    if (targetIndex === -1 || targetIndex >= stepIndex) {
      invalidTargets.push(`(${step.stepId}, ${step.onRevise.repeatStepId})`);
    }
  });

  if (invalidTargets.length > 0) {
    throw new Error(`Workflow onRevise validation failed: ${invalidTargets.join(", ")}`);
  }
}

/** `(project, branch)` run identity for a step that carries durable run identity. */
function stepIdentity(step: WorkflowStep): { project: string; branch: string } {
  return step.behavior === "human"
    ? { project: step.project, branch: step.branch }
    : { project: step.worktree.projectName, branch: step.worktree.branchName };
}

/**
 * Every step, including review behaviors, contributes an entry to the shared snapshot
 * so the daemon's `list` handler can render a row for it. Only `write` and `human`
 * steps carry durable run identity, though: a `review-debate` step has no durable
 * run/resume in this slice (deferred to first consumer), so it is excluded from the
 * existing-run lookup that resumes a prior invocation's snapshot.
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
    ...(step.behavior === "review-debate" || step.behavior === "review"
      ? { behavior: step.behavior as "review-debate" | "review" }
      : {}),
    ...(step.behavior === "human" && step.onRevise !== undefined ? { onRevise: step.onRevise } : {}),
    ...(step.behavior === "write"
      ? {
          stepRules: step.stepRules,
          expectedArtifactPath: step.expectedArtifactPath,
          agents: step.agents,
          agentModelConfig: step.agentModelConfig,
          iterationTimeoutMs: step.iterationTimeoutMs,
        }
      : {}),
  }));

  // When freshDispatch is set, skip reusing prior invocation's snapshot and mint a new invocationId
  if (!freshDispatch) {
    const identifiableSteps = steps.filter(
      (step): step is WorkflowStep | HumanWorkflowStep =>
        step.behavior !== "review-debate" && step.behavior !== "review",
    );
    for (const step of identifiableSteps) {
      const { project, branch } = stepIdentity(step);
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
    onRevise?: OnReviseConfig;
  }[],
): boolean {
  if (snapshot.steps.length !== authoredSteps.length) return false;
  return snapshot.steps.every((step, index) => {
    const authored = authoredSteps[index];
    return (
      step.stepId === authored?.stepId &&
      step.role === authored?.role &&
      step.behavior === authored?.behavior &&
      onReviseEqual(step.onRevise, authored.onRevise)
    );
  });
}

/** Compares `onRevise` config by value so an edited budget/target is treated as a mismatch. */
function onReviseEqual(a: OnReviseConfig | undefined, b: OnReviseConfig | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.repeatStepId === b.repeatStepId && a.maxRevisions === b.maxRevisions;
}

type PreparedHumanStep =
  | { kind: "completed"; runId: string }
  | { kind: "awaiting-human"; runId: string }
  | { kind: "revising"; runId: string };

const REVISION_TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "blocked"];

/** The highest-numbered `${repeatStepId}~r<n>` run among `runs`, if any. */
export function latestRevisionRun(
  runs: readonly { stepId?: string | null; status: RunStatus }[],
  repeatStepId: string,
): { status: RunStatus } | undefined {
  return runs.reduce<{ n: number; status: RunStatus } | undefined>((best, run) => {
    const n = run.stepId ? parseRevisionNumber(run.stepId, repeatStepId) : null;
    if (n === null) return best;
    return !best || n > best.n ? { n, status: run.status } : best;
  }, undefined);
}

/**
 * Reaching a human step converges its run to `awaiting-human` directly via the
 * state store — no write loop, no attempt/outcome history, no `## Blocker` spec edit.
 * A `revising` run re-converges to `awaiting-human` once its in-flight revision
 * write loop reaches a terminal outcome; otherwise it stays `revising`.
 */
function prepareHumanWorkflowStep(
  step: HumanWorkflowStep,
  workflowSnapshot: WorkflowSnapshot,
  store: StateStore,
): PreparedHumanStep {
  const existingRun = store.findRunByProjectBranch({
    project: step.project,
    branch: step.branch,
    stepId: step.stepId,
  });
  if (existingRun?.status === "completed") {
    return { kind: "completed", runId: existingRun.id };
  }

  if (existingRun?.status === "revising" && step.onRevise !== undefined) {
    const revisionRuns = store.findRevisionRuns({
      project: step.project,
      branch: step.branch,
      repeatStepId: step.onRevise.repeatStepId,
    });
    const latest = latestRevisionRun(revisionRuns, step.onRevise.repeatStepId);
    if (latest && REVISION_TERMINAL_STATUSES.includes(latest.status)) {
      store.setRunStatus(existingRun.id, "awaiting-human");
      return { kind: "awaiting-human", runId: existingRun.id };
    }
    return { kind: "revising", runId: existingRun.id };
  }

  const runId =
    existingRun?.id ??
    store.createRun({
      project: step.project,
      specRef: "",
      worktreePath: "",
      branch: step.branch,
      specPath: "",
      stepId: step.stepId,
      workflowSnapshot,
    });
  store.setRunStatus(runId, "awaiting-human");
  return { kind: "awaiting-human", runId };
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
      resumable: false;
    };

type ReviewStepOutcome =
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
    };

/**
 * Resolve each of the step's four per-role `agents` orders to that role's bindings and run
 * the debate. No durable run/resume for a review-debate step in this slice (deferred to
 * first consumer); `runId` is synthesized for reporting only. `onProgress`, if supplied,
 * is fed the currently-executing role as the cycle advances, then the terminal role/outcome.
 */
async function runReviewDebateStep(
  step: ReviewDebateWorkflowStep,
  stepIndex: number,
  invocationId: string,
  onProgress: ((invocationId: string, stepId: string, progress: ReviewDebateProgress) => void) | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  onStepRunCreated: ((stepIndex: number, runId: string) => void) | undefined,
): Promise<ReviewDebateStepOutcome> {
  const { stepId, project, branch, agents, agentModelConfig, createBinding, ...debateInput } = step;
  const resolveBindings = createBinding ?? createResolvedAgentBinding;
  const runId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  onStepRunCreated?.(stepIndex, runId);

  const bindings = Object.fromEntries(
    REVIEW_DEBATE_ROLES.map((role) => [
      role,
      resolveInvocationBindings(resolveExecutableRole(role), agents[role], agentModelConfig, resolveBindings),
    ]),
  ) as ReviewDebateRoleBindings;

  const telemetryFields =
    telemetry !== undefined
      ? {
          telemetry: {
            sink: buildJsonlSink(telemetry.sinkPath ?? defaultTelemetrySinkPath()),
            operatorSessionId: telemetry.operatorSessionId,
            runId,
            attemptId,
            project,
            workflow: telemetry.workflow,
            stepId,
            worktreePath: step.cwd,
            branch,
            specRef: "",
          },
        }
      : {};

  const onRoleStart =
    onProgress !== undefined
      ? { onRoleStart: (role: ReviewDebateRole) => onProgress(invocationId, stepId, { status: "in_progress", role }) }
      : {};

  const result = await executeReviewDebate({
    ...debateInput,
    bindings,
    ...telemetryFields,
    ...onRoleStart,
  });

  const lastCycle = result.cycles[result.cycles.length - 1];
  const kind = lastCycle?.kind === "role_failed" ? "invocation_failure" : "complete";
  const terminalRole: ReviewDebateRole =
    lastCycle?.kind === "role_failed" ? lastCycle.failedRole : lastCycle?.actuatorRan ? "actuator" : "adjudicator";

  onProgress?.(invocationId, stepId, {
    status: kind === "complete" ? "completed" : "stopped",
    role: terminalRole,
    terminalOutcome: kind,
  });

  const actuatorExecution =
    lastCycle?.kind === "completed" && lastCycle.actuatorRan ? lastCycle.roleResults?.actuator?.final : undefined;
  const completionAgent =
    kind === "complete" && actuatorExecution?.result.kind === "ok"
      ? actuatorExecution.binding.metadata?.agent?.trim()
      : undefined;

  return {
    kind,
    runId,
    iterationsConsumed: result.cycles.length,
    resumable: false,
    ...(completionAgent ? { completionAgent } : {}),
  };
}

/**
 * A review step's own durable completion checkpoint, keyed like a write/human step's run row.
 * Retrying landing, commit, push, PR, or finalization re-enters `runReviewStep` for this step;
 * its completed or landing-failed checkpoint resumes past review without re-invoking agents.
 */
function findReviewLandingCheckpoint(
  store: StateStore,
  step: ReviewWorkflowStep,
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
 * Exclude the verdict file from staging, run final validation + transactional landing, then
 * remove the verdict. Returns an error message on failure, or undefined on success.
 */
async function landReviewedIntentOutput(
  worktreePath: string,
  deferred: Extract<PublicationLanding, { kind: "intent-stage" }>,
  verdictPath: string,
): Promise<string | undefined> {
  const ownerPath = `${verdictPath}.owner`;
  const verdict = existsSync(verdictPath) ? readFileSync(verdictPath, "utf8") : undefined;
  const owner = existsSync(ownerPath) ? readFileSync(ownerPath, "utf8") : undefined;
  try {
    excludeVerdictFromStaging(resolve(worktreePath, deferred.stagingDir), verdictPath);
    if (owner !== undefined) {
      rmSync(ownerPath, { force: true });
    }
    await landPublication(deferred, worktreePath);
    cleanupVerdictFile(verdictPath);
    return undefined;
  } catch (error) {
    if (verdict !== undefined) writeFileSync(verdictPath, verdict, "utf8");
    if (owner !== undefined) writeFileSync(ownerPath, owner, "utf8");
    return error instanceof Error ? error.message : String(error);
  }
}

function reviewCompletionAgent(run: NonNullable<ReturnType<StateStore["findRunByProjectBranch"]>>): string | undefined {
  for (let index = run.attempts.length - 1; index >= 0; index -= 1) {
    const agent = run.attempts[index]?.completionAgent?.trim();
    if (agent) return agent;
  }
  return undefined;
}

async function finishReviewedIntentLanding(
  step: ReviewWorkflowStep,
  deferred: Extract<PublicationLanding, { kind: "intent-stage" }>,
  runId: string,
  store: StateStore,
  completionAgent: string | undefined,
  logSink?: LogSink,
): Promise<ReviewStepOutcome> {
  const attemptId = store.recordAttemptStart(runId);
  logSink?.append(runId, { kind: "iteration_started", attemptId });
  const landingError = await landReviewedIntentOutput(step.cwd, deferred, step.verdictPath);
  if (landingError !== undefined) {
    store.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: "invocation_failure",
      invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: landingError },
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
) {
  if (onProgress === undefined) {
    return {};
  }
  return {
    onRoleStart: (role: ReviewCycleRole) => {
      onProgress(invocationId, stepId, { status: "in_progress", role });
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
  const result = await executeReviewCycle({
    cwd: step.cwd,
    ...(step.profile !== undefined ? { profile: step.profile } : {}),
    ...(step.profileContext !== undefined ? { profileContext: step.profileContext } : {}),
    ...(reviewInput.prompt !== undefined ? { prompt: reviewInput.prompt } : {}),
    ...(reviewInput.actuatorPromptRenderer !== undefined
      ? { actuatorPromptRenderer: reviewInput.actuatorPromptRenderer }
      : {}),
    bindings,
    verdictPath: reviewInput.verdictPath,
    maxCycles: reviewInput.maxCycles,
    ...(reviewInput.signal !== undefined ? { signal: reviewInput.signal } : {}),
    ...buildReviewStepTelemetryFields(step, ids, telemetry),
    ...buildReviewStepOnRoleStart(invocationId, stepId, onProgress),
  });

  const lastCycle = result.cycles[result.cycles.length - 1];
  const kind = lastCycle?.kind === "role_failed" ? "invocation_failure" : "complete";
  const terminalRole: ReviewCycleRole =
    lastCycle?.kind === "role_failed"
      ? lastCycle.failedRole
      : lastCycle?.kind === "completed" && lastCycle.actuatorRan
        ? "actuator"
        : "critic";

  onProgress?.(invocationId, stepId, {
    status: kind === "complete" ? "completed" : "stopped",
    role: terminalRole,
    terminalOutcome: kind,
  });

  const actuatorExecution =
    lastCycle?.kind === "completed" && lastCycle.actuatorRan ? lastCycle.roleResults?.actuator?.final : undefined;
  const completionAgent =
    kind === "complete" && actuatorExecution?.result.kind === "ok"
      ? actuatorExecution.binding.metadata?.agent?.trim()
      : undefined;

  return {
    kind,
    runId: ids.runId,
    iterationsConsumed: result.cycles.length,
    resumable: false,
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
): Promise<ReviewStepOutcome> {
  const { stepId } = step;
  const reviewCycleInput: ReviewCycleInput = {
    ...reviewInput,
    ...(step.profile !== undefined ? { profile: step.profile } : {}),
    ...(step.profileContext !== undefined ? { profileContext: step.profileContext } : {}),
    bindings,
    ...buildReviewStepTelemetryFields(step, ids, telemetry),
    ...buildReviewStepOnRoleStart(invocationId, stepId, onProgress),
  };

  const enforcementResult =
    landing?.kind === "intent-stage"
      ? await executeReviewCycleEnforced({
          input: reviewCycleInput,
          invocationId: landing.invocationId,
          stagingDir: resolve(step.cwd, landing.stagingDir),
          cwd: step.cwd,
          verdictPath: reviewInput.verdictPath,
        })
      : {
          result: await executeReviewCycle(reviewCycleInput),
          verdictState: { kind: "missing" } as const,
          boundaryViolation: undefined as string | undefined,
        };

  const { result, boundaryViolation: boundaryViolationMsg } = enforcementResult;

  if (boundaryViolationMsg !== undefined) {
    if (landing?.kind === "intent-stage") {
      store.commitCompletionBoundary({
        attemptId: ids.attemptId,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
        invocationFailureDetail: { failureKind: "error", bindingAttempts: [] },
      });
    }
    return {
      kind: "invocation_failure",
      runId: ids.runId,
      iterationsConsumed: result.cycles.length,
      resumable: true,
    };
  }

  onProgress?.(invocationId, stepId, {
    status: result.kind === "complete" ? "completed" : "stopped",
    role: terminalRoleFromReviewCycles(result.cycles),
    terminalOutcome: result.kind,
  });

  if (result.kind === "invocation_failure") {
    if (landing?.kind === "intent-stage") {
      store.commitCompletionBoundary({
        attemptId: ids.attemptId,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
        invocationFailureDetail: { failureKind: result.failureKind, bindingAttempts: [] },
      });
    }
    return { kind: "invocation_failure", runId: ids.runId, iterationsConsumed: result.cycles.length, resumable: false };
  }

  const completionAgent =
    result.cycles.at(-1)?.kind === "completed"
      ? result.cycles.at(-1)?.roleResults.actuator?.final?.binding.metadata?.agent?.trim()
      : undefined;
  if (landing?.kind !== "intent-stage") {
    return {
      kind: "complete",
      runId: ids.runId,
      iterationsConsumed: result.cycles.length,
      resumable: false,
      ...(completionAgent ? { completionAgent } : {}),
    };
  }
  store.commitCompletionBoundary({
    attemptId: ids.attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    ...(completionAgent ? { completionAgent } : {}),
  });
  const landed = await finishReviewedIntentLanding(step, landing, ids.runId, store, completionAgent);
  return { ...landed, iterationsConsumed: result.cycles.length };
}

async function runReviewDispatch(
  step: ReviewDebateWorkflowStep | ReviewWorkflowStep,
  stepIndex: number,
  invocationId: string,
  onProgress: ((invocationId: string, stepId: string, progress: ReviewProgress) => void) | undefined,
  telemetry: WorkflowTelemetryContext | undefined,
  onStepRunCreated: ((stepIndex: number, runId: string) => void) | undefined,
  store: StateStore,
  logSink: LogSink | undefined,
): Promise<ReviewDebateStepOutcome | ReviewStepOutcome> {
  if (step.behavior === "review-debate") {
    return runReviewDebateStep(step, stepIndex, invocationId, onProgress, telemetry, onStepRunCreated);
  }

  const { landing, ...reviewInput } = step;

  // Only reviewed-intent workflows carry a durable post-review checkpoint; generic review
  // steps stay non-durable (no run row, fresh synthesized run ID each dispatch).
  if (landing?.kind === "intent-stage") {
    const checkpoint = findReviewLandingCheckpoint(store, step);
    if (checkpoint !== undefined) {
      onStepRunCreated?.(stepIndex, checkpoint.id);
      return await finishReviewedIntentLanding(
        step,
        landing,
        checkpoint.id,
        store,
        reviewCompletionAgent(checkpoint),
        logSink,
      );
    }
  }

  const bindings = resolveReviewStepBindings(step);
  const runId =
    landing?.kind === "intent-stage"
      ? store.createRun({
          project: step.project,
          specRef: landing.baseRef,
          worktreePath: step.cwd,
          branch: step.branch,
          specPath: landing.stagingDir,
          stepId: step.stepId,
        })
      : crypto.randomUUID();
  const ids: ReviewStepExecutionIds = {
    runId,
    attemptId: landing?.kind === "intent-stage" ? store.recordAttemptStart(runId) : crypto.randomUUID(),
  };
  onStepRunCreated?.(stepIndex, ids.runId);

  if (landing?.kind === "intent-stage") {
    logSink?.append(ids.runId, { kind: "iteration_started", attemptId: ids.attemptId });
  }

  const outcome = await (landing?.kind === "intent-stage"
    ? runStandardReviewStep(step, reviewInput, landing, ids, bindings, invocationId, onProgress, telemetry, store)
    : runProfileReviewStep(step, reviewInput, ids, bindings, invocationId, onProgress, telemetry));

  if (landing?.kind === "intent-stage") {
    logSink?.append(ids.runId, {
      kind: "loop_finished",
      loopOutcomeKind: outcome.kind,
      iterationsConsumed: outcome.iterationsConsumed,
      resumable: outcome.resumable,
    });
  }

  return outcome;
}
