import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { createResolvedAgentBinding, type ResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import {
  type AgentModelConfig,
  resolveExecutableRole,
  resolveInvocationBindings,
} from "../config/agent-model-config.ts";
import type { LogSink } from "../persistence/log-stream.ts";
import {
  type OnReviseConfig,
  openStateStore,
  type RunStatus,
  type StateStore,
  type WorkflowSnapshot,
} from "../persistence/state-store.ts";
import { type CompletionCommitter, createCompletionCommitter } from "./completion-commit.ts";
import { type CompletionPublisher, createCompletionPublisher } from "./completion-publisher.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { createReadyFinalizer, type ReadyFinalizer } from "./ready-finalize.ts";
import {
  executeReviewDebate,
  type ReviewDebateInput,
  type ReviewDebateRole,
  type ReviewDebateRoleBindings,
} from "./review-debate.ts";
import { parseRevisionNumber } from "./revision-step-id.ts";
import { buildJsonlSink } from "./telemetry-sink.ts";
import {
  boundaryStampFromStoredRun,
  DEFAULT_TELEMETRY_SINK_PATH,
  emitWorkBoundaryRecorded,
} from "./work-boundary-telemetry.ts";
import {
  executeWriteLoop,
  type WriteLoopInput,
  type WriteLoopOutcomeKind,
  type WriteLoopResult,
} from "./write-loop.ts";

/** Workflow-runner-level telemetry context, shared identically across write and review-debate steps. */
type WorkflowTelemetryContext = {
  operatorSessionId: string;
  workflow: string;
  sinkPath?: string;
};

const WORKFLOW_PRESET_LENGTHS = {
  "write-write": 2,
  implement: 1,
} as const;

/** Presets whose `role`/`promptId` are pinned by the preset, overriding any caller-supplied values. */
const WORKFLOW_PRESET_PINNED_FIELDS: Partial<Record<WorkflowPresetName, { role: string; promptId: string }>> = {
  implement: { role: "implement", promptId: "patch.prompt.body" },
};

export type WorkflowPresetName = keyof typeof WORKFLOW_PRESET_LENGTHS;

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

/** Live/terminal progress for a `review-debate` step's daemon-visible row, tracked in-memory only. */
export type ReviewDebateProgress =
  | { status: "in_progress"; role: ReviewDebateRole }
  | { status: "completed" | "stopped"; role: ReviewDebateRole; terminalOutcome: "complete" | "invocation_failure" };

/** One authored workflow step with durable run identity, dispatched on `behavior` at execution. */
export type WorkflowStep = WriteWorkflowStep | HumanWorkflowStep;

export type AnyWorkflowStep = WorkflowStep | ReviewDebateWorkflowStep;

export type WorkflowStepInput = AnyWorkflowStep;

export type WorkflowResult = {
  kind: WriteLoopOutcomeKind | "awaiting-human" | "revising";
  stepIndex: number;
  stepId: string;
  runId: string;
  iterationsConsumed: number;
  resumable: boolean;
  commitSha?: string;
  completionCommitError?: string;
  readyFinalizeError?: string;
  boundaryTelemetryFailure?: string;
};

export type WorkflowRunnerInput = {
  steps: AnyWorkflowStep[];
  stateStore?: StateStore;
  logSink?: LogSink;
  /** Reports a `review-debate` step's live/terminal role progress, keyed by `invocationId`+`stepId`. */
  onReviewDebateProgress?: (invocationId: string, stepId: string, progress: ReviewDebateProgress) => void;
  /** Shared telemetry context for every step's invocations; omitted emits no `invocation_completed` rows. */
  telemetry?: WorkflowTelemetryContext;
  /** Fires once a step's run row is durably created/resolved, before that step executes. */
  onStepRunCreated?: (stepIndex: number, runId: string) => void;
  completionCommitter?: CompletionCommitter;
  completionPublisher?: CompletionPublisher;
  readyFinalizer?: ReadyFinalizer;
};

function isWriteStep(step: AnyWorkflowStep): step is WriteWorkflowStep {
  return step.behavior === "write";
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

  if (steps.length !== expected) {
    throw new Error(`Workflow preset "${name}" requires ${expected} steps, received ${steps.length}`);
  }

  const pinned = WORKFLOW_PRESET_PINNED_FIELDS[name];
  return steps.map((step) => ({ ...step, behavior: "write", ...(pinned ?? {}) }) satisfies WorkflowStepInput);
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

  if (step.behavior === "review-debate") {
    return runReviewDebateStep(
      step,
      stepIndex,
      workflowSnapshot.invocationId,
      onReviewDebateProgress,
      telemetry,
      onStepRunCreated,
    );
  }

  const preparedStep = prepareWorkflowStep(step, workflowSnapshot, store, logSink, telemetry);
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

  return executeWriteLoop(
    onStepRunCreated
      ? { ...preparedStep.input, onRunCreated: (runId) => onStepRunCreated(stepIndex, runId) }
      : preparedStep.input,
  );
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
    const workflowSnapshot = buildWorkflowSnapshot(args.steps, store);

    for (let stepIndex = 0; stepIndex < args.steps.length; stepIndex++) {
      const step = args.steps[stepIndex];
      if (!step) throw new Error("Unreachable: step undefined in bounded loop");

      const stepResult = await runWorkflowStep(
        step,
        stepIndex,
        workflowSnapshot,
        store,
        args.logSink,
        args.onReviewDebateProgress,
        args.telemetry,
        args.onStepRunCreated,
      );
      totalIterationsConsumed += stepResult.iterationsConsumed;
      lastResult = stepResult;
      lastStepId = step.stepId;
      if (stepResult.kind === "complete" && (stepResult as WriteLoopResult).completionAgent) {
        completionAgent = (stepResult as WriteLoopResult).completionAgent;
      }

      if (stepResult.kind !== "complete") {
        return {
          kind: stepResult.kind,
          stepIndex,
          stepId: step.stepId,
          runId: stepResult.runId,
          iterationsConsumed: totalIterationsConsumed,
          resumable: stepResult.resumable,
        };
      }

      if (step.behavior === "write" && step.role === "implement") {
        const shrinkResult = await runShrinkAfterImplementComplete(
          step,
          stepIndex,
          workflowSnapshot,
          store,
          args.logSink,
          args.telemetry,
          args.onStepRunCreated,
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

    const publicationAgent = lastResult.kind === "complete" ? (completionAgent ?? "") : undefined;
    if (publicationAgent !== undefined) {
      try {
        const completionStep = [...args.steps].reverse().find(isWriteStep);
        if (completionStep) {
          const worktree = completionStep.worktree;
          const published = (args.completionCommitter ?? createCompletionCommitter())({
            worktreePath: getExternalWorktreePath(worktree),
            baseRef: worktree.baseRef,
            specPath: completionStep.specPath,
            agent: publicationAgent,
          });
          if (published.commitSha !== undefined) {
            const stamped = lastResult as WriteLoopResult;
            (stamped as WriteLoopResult).commitSha = published.commitSha;
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
            try {
              await (args.completionPublisher ?? createCompletionPublisher())({
                worktreePath: getExternalWorktreePath(worktree),
                baseRef: worktree.baseRef,
                specPath: completionStep.specPath,
                branch: worktree.branchName,
              });
            } catch (publishError) {
              throw new Error(
                `Publication failed: ${publishError instanceof Error ? publishError.message : String(publishError)}`,
              );
            }
            try {
              await (args.readyFinalizer ?? createReadyFinalizer())({
                worktreePath: getExternalWorktreePath(worktree),
                branch: worktree.branchName,
              });
            } catch (finalizeError) {
              throw new Error(
                `Ready finalize failed: ${finalizeError instanceof Error ? finalizeError.message : String(finalizeError)}`,
              );
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const loopOutcomeKind = message.startsWith("Ready finalize failed")
          ? "ready_finalize_failed"
          : "completion_commit_failed";
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
            ? { readyFinalizeError: message }
            : { completionCommitError: message }),
        };
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
  return isWriteStep(step) ? missingWriteStepRoleBindings(step) : missingReviewDebateStepRoleBindings(step);
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

function missingAgentRoleBindings(
  step: WriteWorkflowStep | ReviewDebateWorkflowStep,
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
 * Every step, including `review-debate`, contributes an entry to the shared snapshot
 * so the daemon's `list` handler can render a row for it. Only `write` and `human`
 * steps carry durable run identity, though: a `review-debate` step has no durable
 * run/resume in this slice (deferred to first consumer), so it is excluded from the
 * existing-run lookup that resumes a prior invocation's snapshot.
 */
function buildWorkflowSnapshot(steps: readonly AnyWorkflowStep[], store: StateStore): WorkflowSnapshot {
  const authoredSteps = steps.map((step) => ({
    stepId: step.stepId,
    role: step.behavior === "write" ? step.role : "",
    ...(step.behavior === "review-debate" ? { behavior: "review-debate" as const } : {}),
    ...(step.behavior === "human" && step.onRevise !== undefined ? { onRevise: step.onRevise } : {}),
    ...(step.behavior === "write"
      ? {
          stepRules: step.stepRules,
          expectedArtifactPath: step.expectedArtifactPath,
          agents: step.agents,
          agentModelConfig: step.agentModelConfig,
        }
      : {}),
  }));

  const identifiableSteps = steps.filter((step): step is WorkflowStep => step.behavior !== "review-debate");
  for (const step of identifiableSteps) {
    const { project, branch } = stepIdentity(step);
    const existingRun = store.findRunByProjectBranch({ project, branch, stepId: step.stepId });
    const candidate = existingRun?.workflowSnapshot;
    if (candidate !== null && candidate !== undefined && snapshotMatchesAuthoredSteps(candidate, authoredSteps)) {
      return candidate;
    }
  }

  return {
    invocationId: crypto.randomUUID(),
    steps: authoredSteps,
  };
}

/**
 * Guards against grafting a foreign invocation's snapshot: a durable run found by
 * `(project, branch, stepId)` may belong to an unrelated workflow spec that happens to
 * reuse the same stepId label. Only adopt the snapshot if its full authored step list
 * matches this invocation's.
 */
function snapshotMatchesAuthoredSteps(
  snapshot: WorkflowSnapshot,
  authoredSteps: readonly { stepId: string; role: string; behavior?: "review-debate"; onRevise?: OnReviseConfig }[],
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
): PreparedWorkflowStep {
  const existingRun = store.findRunByProjectBranch({
    project: step.worktree.projectName,
    branch: step.worktree.branchName,
    stepId: step.stepId,
  });
  if (existingRun?.status === "completed") {
    const completionAgent = existingRun.attempts.at(-1)?.completionAgent?.trim();
    return { kind: "completed", runId: existingRun.id, ...(completionAgent ? { completionAgent } : {}) };
  }

  const { stepId, role, agents, agentModelConfig, createBinding, behavior: _behavior, ...loopInput } = step;
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
      bindings,
      bindingResolution: {
        role,
        agents,
        agentModelConfig,
      },
      stateStore: store,
      ...(logSink !== undefined ? { logSink } : {}),
      ...(telemetry !== undefined
        ? {
            telemetry: {
              sinkPath: telemetry.sinkPath ?? DEFAULT_TELEMETRY_SINK_PATH,
              operatorSessionId: telemetry.operatorSessionId,
              workflow: telemetry.workflow,
              role,
            },
          }
        : {}),
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
): Promise<WriteLoopResult> {
  const shrinkStep = {
    ...step,
    stepId: `${step.stepId}${SHRINK_STEP_ID_SUFFIX}`,
    role: SHRINK_ROLE,
    promptId: SHRINK_PROMPT_ID,
    promptPlaceholders: shrinkPromptPlaceholders(step),
  };
  const preparedStep = prepareWorkflowStep(shrinkStep, workflowSnapshot, store, logSink, telemetry);
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
  return executeWriteLoop(
    onStepRunCreated
      ? { ...preparedStep.input, onRunCreated: (runId) => onStepRunCreated(stepIndex, runId) }
      : preparedStep.input,
  );
}

function shrinkPromptPlaceholders(step: WriteWorkflowStep): Record<string, string> {
  const worktreePath = getExternalWorktreePath(step.worktree);
  const allowlist = changedFiles(worktreePath, step.worktree.baseRef);
  return {
    SPEC_PATH: step.specPath,
    SPEC_TREE: readSpecTree(worktreePath, step.specPath),
    ALLOWLIST: (allowlist.length > 0 ? allowlist : [step.expectedArtifactPath]).map((path) => `- ${path}`).join("\n"),
    BRANCH_DIFF: gitOutput(worktreePath, ["diff", "--stat", step.worktree.baseRef, "--"]) || "(empty)",
    RUN_SCOPED_DIFF:
      gitOutput(worktreePath, [
        "diff",
        step.worktree.baseRef,
        "--",
        ...(allowlist.length > 0 ? allowlist : [step.expectedArtifactPath]),
      ]) || "(empty)",
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

function changedFiles(worktreePath: string, baseRef: string): string[] {
  return gitOutput(worktreePath, ["diff", "--name-only", baseRef, "--"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function gitOutput(worktreePath: string, args: readonly string[]): string {
  if (!existsSync(join(worktreePath, ".git"))) return "";
  try {
    return execFileSync("git", args, { cwd: worktreePath, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch {
    return "";
  }
}

type ReviewDebateStepOutcome = {
  kind: Extract<WriteLoopOutcomeKind, "complete" | "invocation_failure">;
  runId: string;
  iterationsConsumed: number;
  resumable: false;
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

  const result = await executeReviewDebate({
    ...debateInput,
    bindings,
    ...(telemetry !== undefined
      ? {
          telemetry: {
            sink: buildJsonlSink(telemetry.sinkPath ?? DEFAULT_TELEMETRY_SINK_PATH),
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
      : {}),
    ...(onProgress !== undefined
      ? { onRoleStart: (role: ReviewDebateRole) => onProgress(invocationId, stepId, { status: "in_progress", role }) }
      : {}),
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

  return { kind, runId, iterationsConsumed: result.cycles.length, resumable: false };
}
