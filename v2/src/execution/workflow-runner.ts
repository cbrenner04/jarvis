import { createResolvedAgentBinding, type ResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import {
  type AgentModelConfig,
  resolveExecutableRole,
  resolveInvocationBindings,
} from "../config/agent-model-config.ts";
import type { LogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import type { WorkflowSnapshot } from "../persistence/state-store-types.ts";
import {
  executeReviewDebate,
  type ReviewDebateInput,
  type ReviewDebateRole,
  type ReviewDebateRoleBindings,
} from "./review-debate.ts";
import { executeWriteLoop, type WriteLoopInput, type WriteLoopOutcomeKind } from "./write-loop.ts";

const WORKFLOW_PRESET_LENGTHS = {
  "write-write": 2,
} as const;

export type WorkflowPresetName = keyof typeof WORKFLOW_PRESET_LENGTHS;

const REVIEW_DEBATE_ROLES: readonly ReviewDebateRole[] = ["adversary", "advocate", "adjudicator", "actuator"];

/** Per-step write-loop input plus workflow identity; bindings are derived at execution. */
export type WorkflowStep = Omit<WriteLoopInput, "bindings"> & {
  stepId: string;
  /** Absent (loader-produced steps) is equivalent to `"write"`. */
  behavior?: "write";
  role: string;
  agents: readonly string[];
  agentModelConfig: AgentModelConfig;
  createBinding?: (binding: ResolvedAgentBinding) => InvocationBinding;
};

/** Per-role agent fallback orders for a `review-debate` step's four fixed debate roles. */
export type ReviewDebateStepAgents = Record<ReviewDebateRole, readonly string[]>;

/** Per-step review-debate input plus workflow identity; role bindings are derived at execution. */
export type ReviewDebateWorkflowStep = Omit<ReviewDebateInput, "bindings"> & {
  stepId: string;
  behavior: "review-debate";
  agents: ReviewDebateStepAgents;
  agentModelConfig: AgentModelConfig;
  createBinding?: (binding: ResolvedAgentBinding) => InvocationBinding;
};

/** Any dispatchable workflow step, discriminated by `behavior`. */
export type AnyWorkflowStep = WorkflowStep | ReviewDebateWorkflowStep;

/** Authoring input for `defineWorkflowStep`; `behavior` selects the dispatched step kind. */
export type WorkflowStepInput = (Omit<WorkflowStep, "behavior"> & { behavior: "write" }) | ReviewDebateWorkflowStep;

/** Result of a workflow invocation. */
export type WorkflowResult = {
  kind: WriteLoopOutcomeKind;
  stepIndex: number;
  stepId: string;
  runId: string;
  iterationsConsumed: number;
  resumable: boolean;
};

/** Input for the workflow runner. */
export type WorkflowRunnerInput = {
  steps: AnyWorkflowStep[];
  stateStore?: StateStore;
  logSink?: LogSink;
};

/** Return the runtime step shape; `behavior` is kept so the runner can dispatch on it. */
export function defineWorkflowStep(step: Omit<WorkflowStep, "behavior"> & { behavior: "write" }): WorkflowStep;
export function defineWorkflowStep(step: ReviewDebateWorkflowStep): ReviewDebateWorkflowStep;
export function defineWorkflowStep(step: WorkflowStepInput): AnyWorkflowStep {
  return step;
}

function isWriteStep(step: AnyWorkflowStep): step is WorkflowStep {
  return step.behavior !== "review-debate";
}

/** Validate preset step count and return the supplied steps unchanged. */
export function resolveWorkflowPreset(
  name: WorkflowPresetName,
  steps: Omit<WorkflowStep, "behavior">[],
): AnyWorkflowStep[] {
  const expected = WORKFLOW_PRESET_LENGTHS[name];
  if (expected === undefined) {
    throw new Error(`Unknown workflow preset: "${name}"`);
  }

  if (steps.length !== expected) {
    throw new Error(`Workflow preset "${name}" requires ${expected} steps, received ${steps.length}`);
  }

  return steps.map((step) => defineWorkflowStep({ ...step, behavior: "write" }));
}

type PreparedWorkflowStep =
  | {
      kind: "completed";
      runId: string;
    }
  | {
      kind: "pending";
      input: WriteLoopInput;
    };

/**
 * Execute a multi-step workflow: run each step's write loop to completion
 * before advancing. A non-complete outcome stops at that step.
 *
 * Role bindings are validated for every step before any durable state change,
 * including on resume against the config loaded at that time.
 */
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
    let lastResult: Awaited<ReturnType<typeof executeWriteLoop>> | undefined;
    let lastStepId = "";
    const workflowSnapshot = buildWorkflowSnapshot(args.steps, store);

    for (let stepIndex = 0; stepIndex < args.steps.length; stepIndex++) {
      const step = args.steps[stepIndex];
      if (!step) throw new Error("Unreachable: step undefined in bounded loop");

      if (!isWriteStep(step)) {
        const debateResult = await runReviewDebateStep(step);
        totalIterationsConsumed += debateResult.iterationsConsumed;
        lastResult = debateResult;
        lastStepId = step.stepId;

        if (debateResult.kind !== "complete") {
          return {
            kind: debateResult.kind,
            stepIndex,
            stepId: step.stepId,
            runId: debateResult.runId,
            iterationsConsumed: totalIterationsConsumed,
            resumable: false,
          };
        }
        continue;
      }

      const preparedStep = prepareWorkflowStep(step, workflowSnapshot, store, args.logSink);
      if (preparedStep.kind === "completed") {
        lastStepId = step.stepId;
        lastResult = {
          kind: "complete",
          runId: preparedStep.runId,
          iterationsConsumed: 0,
          resumable: false,
        };
        continue;
      }

      const result = await executeWriteLoop(preparedStep.input);
      totalIterationsConsumed += result.iterationsConsumed;
      lastResult = result;
      lastStepId = step.stepId;

      if (result.kind !== "complete") {
        return {
          kind: result.kind,
          stepIndex,
          stepId: step.stepId,
          runId: result.runId,
          iterationsConsumed: totalIterationsConsumed,
          resumable: result.resumable,
        };
      }
    }

    if (!lastResult) throw new Error("Unreachable: lastResult undefined after checked bounds");

    return {
      kind: "complete",
      stepIndex: args.steps.length - 1,
      stepId: lastStepId,
      runId: lastResult.runId,
      iterationsConsumed: totalIterationsConsumed,
      resumable: false,
    };
  } finally {
    if (!args.stateStore) {
      store.close();
    }
  }
}

/** Fail before durable state changes if any step role is missing from its agent config. */
export function validateWorkflowStepRoles(steps: readonly AnyWorkflowStep[]): void {
  const missingBindings: string[] = [];

  for (const step of steps) {
    if (isWriteStep(step)) {
      for (const agent of step.agents) {
        const agentEntry = step.agentModelConfig[agent];
        if (!agentEntry || !Object.hasOwn(agentEntry, step.role)) {
          missingBindings.push(`(${step.stepId}, ${step.role}, ${agent})`);
        }
      }
      continue;
    }

    for (const role of REVIEW_DEBATE_ROLES) {
      for (const agent of step.agents[role]) {
        const agentEntry = step.agentModelConfig[agent];
        if (!agentEntry || !Object.hasOwn(agentEntry, role)) {
          missingBindings.push(`(${step.stepId}, ${role}, ${agent})`);
        }
      }
    }
  }

  if (missingBindings.length > 0) {
    throw new Error(`Workflow step role validation failed: ${missingBindings.join(", ")}`);
  }
}

function buildWorkflowSnapshot(steps: readonly AnyWorkflowStep[], store: StateStore): WorkflowSnapshot {
  const writeSteps = steps.filter(isWriteStep);
  const authoredSteps = writeSteps.map(({ stepId, role }) => ({ stepId, role }));

  for (const step of writeSteps) {
    const existingRun = store.findRunByProjectBranch({
      project: step.worktree.projectName,
      branch: step.worktree.branchName,
      stepId: step.stepId,
    });
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
  authoredSteps: readonly { stepId: string; role: string }[],
): boolean {
  if (snapshot.steps.length !== authoredSteps.length) return false;
  return snapshot.steps.every(
    (step, index) => step.stepId === authoredSteps[index]?.stepId && step.role === authoredSteps[index]?.role,
  );
}

function prepareWorkflowStep(
  step: WorkflowStep,
  workflowSnapshot: WorkflowSnapshot,
  store: StateStore,
  logSink?: LogSink,
): PreparedWorkflowStep {
  const existingRun = store.findRunByProjectBranch({
    project: step.worktree.projectName,
    branch: step.worktree.branchName,
    stepId: step.stepId,
  });
  if (existingRun?.status === "completed") {
    return { kind: "completed", runId: existingRun.id };
  }

  const { stepId, role, agents, agentModelConfig, createBinding, ...loopInput } = step;
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
      stateStore: store,
      ...(logSink !== undefined ? { logSink } : {}),
    },
  };
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
 * first consumer); `runId` is synthesized for reporting only.
 */
async function runReviewDebateStep(step: ReviewDebateWorkflowStep): Promise<ReviewDebateStepOutcome> {
  const { stepId: _stepId, agents, agentModelConfig, createBinding, ...debateInput } = step;
  const resolveBindings = createBinding ?? createResolvedAgentBinding;

  const bindings = Object.fromEntries(
    REVIEW_DEBATE_ROLES.map((role) => [
      role,
      resolveInvocationBindings(resolveExecutableRole(role), agents[role], agentModelConfig, resolveBindings),
    ]),
  ) as ReviewDebateRoleBindings;

  const result = await executeReviewDebate({ ...debateInput, bindings });

  const lastCycle = result.cycles[result.cycles.length - 1];
  const kind = lastCycle?.kind === "role_failed" ? "invocation_failure" : "complete";

  return { kind, runId: crypto.randomUUID(), iterationsConsumed: result.cycles.length, resumable: false };
}
