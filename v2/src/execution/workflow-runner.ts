import { createResolvedAgentBinding, type ResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import {
  type AgentModelConfig,
  resolveExecutableRole,
  resolveInvocationBindings,
} from "../config/agent-model-config.ts";
import type { LogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import type { OnReviseConfig, RunStatus, WorkflowSnapshot } from "../persistence/state-store-types.ts";
import { parseRevisionNumber } from "./revision-step-id.ts";
import { executeWriteLoop, type WriteLoopInput, type WriteLoopOutcomeKind } from "./write-loop.ts";

const WORKFLOW_PRESET_LENGTHS = {
  "write-write": 2,
} as const;

export type WorkflowPresetName = keyof typeof WORKFLOW_PRESET_LENGTHS;

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

/** One authored workflow step, dispatched on `behavior` at execution. */
export type WorkflowStep = WriteWorkflowStep | HumanWorkflowStep;

/** Authoring input for `defineWorkflowStep`, identical in shape to `WorkflowStep`. */
export type WorkflowStepInput = WorkflowStep;

/** Result of a workflow invocation. */
export type WorkflowResult = {
  kind: WriteLoopOutcomeKind | "awaiting-human" | "revising";
  stepIndex: number;
  stepId: string;
  runId: string;
  iterationsConsumed: number;
  resumable: boolean;
};

/** Input for the workflow runner. */
export type WorkflowRunnerInput = {
  steps: WorkflowStep[];
  stateStore?: StateStore;
  logSink?: LogSink;
};

/** Build the runtime `WorkflowStep` shape from authoring input; `behavior` selects the dispatch path. */
export function defineWorkflowStep(step: WorkflowStepInput): WorkflowStep {
  return step;
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
  validateOnReviseTargets(args.steps);

  const store = args.stateStore ?? openStateStore();

  try {
    let totalIterationsConsumed = 0;
    let lastResult: Awaited<ReturnType<typeof executeWriteLoop>> | undefined;
    let lastStepId = "";
    const workflowSnapshot = buildWorkflowSnapshot(args.steps, store);

    for (let stepIndex = 0; stepIndex < args.steps.length; stepIndex++) {
      const step = args.steps[stepIndex];
      if (!step) throw new Error("Unreachable: step undefined in bounded loop");

      if (step.behavior === "human") {
        const humanStep = prepareHumanWorkflowStep(step, workflowSnapshot, store);
        if (humanStep.kind === "completed") {
          lastStepId = step.stepId;
          lastResult = {
            kind: "complete",
            runId: humanStep.runId,
            iterationsConsumed: 0,
            resumable: false,
          };
          continue;
        }

        return {
          kind: humanStep.kind,
          stepIndex,
          stepId: step.stepId,
          runId: humanStep.runId,
          iterationsConsumed: totalIterationsConsumed,
          resumable: false,
        };
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
export function validateWorkflowStepRoles(steps: readonly WorkflowStep[]): void {
  const missingBindings: string[] = [];

  for (const step of steps) {
    if (step.behavior !== "write") continue;
    for (const agent of step.agents) {
      const agentEntry = step.agentModelConfig[agent];
      if (!agentEntry || !Object.hasOwn(agentEntry, step.role)) {
        missingBindings.push(`(${step.stepId}, ${step.role}, ${agent})`);
      }
    }
  }

  if (missingBindings.length > 0) {
    throw new Error(`Workflow step role validation failed: ${missingBindings.join(", ")}`);
  }
}

/** Fail before durable state changes if a human step's `onRevise.repeatStepId` isn't an earlier step's `stepId`. */
export function validateOnReviseTargets(steps: readonly WorkflowStep[]): void {
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

/** `(project, branch)` run identity for a step, regardless of behavior. */
function stepIdentity(step: WorkflowStep): { project: string; branch: string } {
  return step.behavior === "human"
    ? { project: step.project, branch: step.branch }
    : { project: step.worktree.projectName, branch: step.worktree.branchName };
}

function buildWorkflowSnapshot(steps: readonly WorkflowStep[], store: StateStore): WorkflowSnapshot {
  const authoredSteps = steps.map((step) => ({
    stepId: step.stepId,
    role: step.behavior === "write" ? step.role : "",
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

  for (const step of steps) {
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
  authoredSteps: readonly { stepId: string; role: string; onRevise?: OnReviseConfig }[],
): boolean {
  if (snapshot.steps.length !== authoredSteps.length) return false;
  return snapshot.steps.every((step, index) => {
    const authored = authoredSteps[index];
    return (
      step.stepId === authored?.stepId &&
      step.role === authored?.role &&
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
      stateStore: store,
      ...(logSink !== undefined ? { logSink } : {}),
    },
  };
}
