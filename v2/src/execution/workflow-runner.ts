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
import { executeWriteLoop, type WriteLoopInput, type WriteLoopOutcomeKind } from "./write-loop.ts";

const WORKFLOW_PRESET_LENGTHS = {
  "write-write": 2,
} as const;

export type WorkflowPresetName = keyof typeof WORKFLOW_PRESET_LENGTHS;

/** Per-step write-loop input plus workflow identity; bindings are derived at execution. */
export type WorkflowStep = Omit<WriteLoopInput, "bindings"> & {
  stepId: string;
  role: string;
  agents: readonly string[];
  agentModelConfig: AgentModelConfig;
  createBinding?: (binding: ResolvedAgentBinding) => InvocationBinding;
};

/** Authoring input for `defineWorkflowStep`; `behavior` is metadata until the runner dispatches on it. */
export type WorkflowStepInput = WorkflowStep & {
  behavior: "write";
};

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
  steps: WorkflowStep[];
  stateStore?: StateStore;
  logSink?: LogSink;
};

/** Strip authoring-only `behavior` and return the runtime `WorkflowStep` shape. */
export function defineWorkflowStep({ behavior: _behavior, ...step }: WorkflowStepInput): WorkflowStep {
  return step;
}

/** Validate preset step count and return the supplied steps unchanged. */
export function resolveWorkflowPreset(
  name: WorkflowPresetName,
  steps: Omit<WorkflowStepInput, "behavior">[],
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

  const store = args.stateStore ?? openStateStore();

  try {
    let totalIterationsConsumed = 0;
    let lastResult: Awaited<ReturnType<typeof executeWriteLoop>> | undefined;
    let lastStepId = "";
    const workflowSnapshot = buildWorkflowSnapshot(args.steps, store);

    for (let stepIndex = 0; stepIndex < args.steps.length; stepIndex++) {
      const step = args.steps[stepIndex];
      if (!step) throw new Error("Unreachable: step undefined in bounded loop");

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
function validateWorkflowStepRoles(steps: readonly WorkflowStep[]): void {
  const missingBindings: string[] = [];

  for (const step of steps) {
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

function buildWorkflowSnapshot(steps: readonly WorkflowStep[], store: StateStore): WorkflowSnapshot {
  for (const step of steps) {
    const existingRun = store.findRunByProjectBranch({
      project: step.worktree.projectName,
      branch: step.worktree.branchName,
      stepId: step.stepId,
    });
    if (existingRun?.workflowSnapshot !== null && existingRun?.workflowSnapshot !== undefined) {
      return existingRun.workflowSnapshot;
    }
  }

  return {
    invocationId: crypto.randomUUID(),
    steps: steps.map(({ stepId, role }) => ({ stepId, role })),
  };
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
