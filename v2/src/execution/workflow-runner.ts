import { createResolvedAgentBinding, type ResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import {
  type AgentModelConfig,
  resolveExecutableRole,
  resolveInvocationBindings,
} from "../config/agent-model-config.ts";
import type { LogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { executeWriteLoop, type WriteLoopInput, type WriteLoopOutcomeKind } from "./write-loop.ts";

/** Classification of a workflow outcome — mirrors the write loop's outcome kinds. */
export type WorkflowOutcomeKind = WriteLoopOutcomeKind;

const WORKFLOW_PRESETS = {
  "write-write": ["write", "write"],
} as const;

type WorkflowBehavior = (typeof WORKFLOW_PRESETS)[keyof typeof WORKFLOW_PRESETS][number];

/**
 * A single step in a workflow.
 *
 * Contract: carries the per-step write-loop inputs (minus the pre-resolved
 * `bindings`, which the runner derives from `role`/`agents`/`agentModelConfig`)
 * plus workflow-local identity.
 * Invariants: `stepId` must be unique within the workflow; `role` is validated
 * at execution against the executable role subset.
 */
export type WorkflowStep = Omit<WriteLoopInput, "bindings"> & {
  /** Unique identifier for this step within the workflow. */
  stepId: string;
  /** Workflow-step role validated at execution against the executable role subset. */
  role: string;
  /** Ordered outer agent fallback list for this step. */
  agents: readonly string[];
  /** Loaded role-to-rung data for the agents in this step. */
  agentModelConfig: AgentModelConfig;
  /** Test seam for binding construction from one resolved `(agent, model)` rung. */
  createBinding?: (binding: ResolvedAgentBinding) => InvocationBinding;
};

/**
 * Authoring input for one workflow step before behavior-specific fields are normalized.
 *
 * Contract: same shape as `WorkflowStep`, plus a behavior discriminator used by
 * helper/preset authoring. Today only `"write"` is valid.
 * Invariants: workflow-scoped infrastructure remains excluded here because the
 * runner injects it once per workflow invocation.
 */
export type WorkflowStepDefinition = WorkflowStep & {
  /** Behavior primitive this step runs. */
  behavior: WorkflowBehavior;
};

/**
 * Named workflow presets available to callers.
 *
 * Contract: each preset fixes only step count and behavior sequence.
 */
export type WorkflowPresetName = keyof typeof WORKFLOW_PRESETS;

/**
 * Per-position caller input for a preset-resolved step.
 *
 * Contract: callers supply the same per-step fields as `WorkflowStep` and omit
 * `behavior`; the preset provides behavior per position.
 */
export type WorkflowPresetStepInput = WorkflowStep;

/** Result of a workflow invocation. */
export type WorkflowResult = {
  kind: WorkflowOutcomeKind;
  /** The index of the step that produced this outcome. */
  stepIndex: number;
  /** The step ID of the step that produced this outcome. */
  stepId: string;
  /** Run ID of the step that produced this outcome. */
  runId: string;
  /** Total iterations consumed across all steps. */
  iterationsConsumed: number;
  resumable: boolean;
};

/** Input for the workflow runner. */
export type WorkflowRunnerInput = {
  steps: WorkflowStep[];
  stateStore?: StateStore;
  logSink?: LogSink;
};

/**
 * Normalize one authored workflow step into the runtime `WorkflowStep` shape.
 *
 * Params: `args` must include `stepId`, `role`, `behavior`, and the per-step
 * write-loop inputs.
 * Returns: a `WorkflowStep` with the same step-local write-loop fields.
 * Throws: never.
 * Invariants: `behavior` is authoring metadata only today and is not persisted
 * on the returned step because the runner executes only write behavior.
 */
export function defineWorkflowStep(args: WorkflowStepDefinition): WorkflowStep {
  const { behavior: _behavior, ...step } = args;
  return step;
}

/**
 * Resolve a named preset into concrete workflow steps.
 *
 * Params: `name` selects the preset; `steps` supplies one authored step payload
 * per preset position, excluding `behavior`.
 * Returns: a `WorkflowStep[]` in preset order.
 * Throws: if `name` is unknown or `steps.length` does not match the preset's
 * fixed step count.
 * Invariants: preset resolution delegates step construction to
 * `defineWorkflowStep` once per position.
 */
export function resolveWorkflowPreset(name: WorkflowPresetName, steps: WorkflowPresetStepInput[]): WorkflowStep[] {
  const preset = WORKFLOW_PRESETS[name];
  if (preset === undefined) {
    throw new Error(`Unknown workflow preset: "${name}"`);
  }

  if (steps.length !== preset.length) {
    throw new Error(`Workflow preset "${name}" requires ${preset.length} steps, received ${steps.length}`);
  }

  return preset.map((behavior, index) => defineWorkflowStep({ ...steps[index]!, behavior }));
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
 * before advancing to the next step. A non-complete outcome stops the
 * workflow at that step without running any later steps.
 */
export async function executeWorkflow(args: WorkflowRunnerInput): Promise<WorkflowResult> {
  if (args.steps.length === 0) {
    throw new Error("Workflow requires at least one step");
  }

  // Validate unique stepIds
  const stepIds = new Set<string>();
  for (const step of args.steps) {
    if (stepIds.has(step.stepId)) {
      throw new Error(`Duplicate stepId in workflow: "${step.stepId}"`);
    }
    stepIds.add(step.stepId);
  }

  const store = args.stateStore ?? openStateStore();

  try {
    let totalIterationsConsumed = 0;
    let lastResult: Awaited<ReturnType<typeof executeWriteLoop>> | undefined;
    let lastStepId = "";

    for (let stepIndex = 0; stepIndex < args.steps.length; stepIndex++) {
      const step = args.steps[stepIndex];
      if (!step) throw new Error("Unreachable: step undefined in bounded loop");

      const preparedStep = prepareWorkflowStep(step, store, args.logSink);
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

      // If this step didn't complete, stop the workflow
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

      // Step completed successfully, continue to next step
    }

    // All steps completed
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

function prepareWorkflowStep(step: WorkflowStep, store: StateStore, logSink?: LogSink): PreparedWorkflowStep {
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
      bindings,
      stateStore: store,
      ...(logSink !== undefined ? { logSink } : {}),
    },
  };
}
