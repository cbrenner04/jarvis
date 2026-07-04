import type { LogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { executeWriteLoop, type WriteLoopInput, type WriteLoopOutcomeKind } from "./write-loop.ts";

/** Classification of a workflow outcome — mirrors the write loop's outcome kinds. */
export type WorkflowOutcomeKind = WriteLoopOutcomeKind;

const WORKFLOW_PRESETS = {
  "write-write": ["write", "write"],
} as const;

type WorkflowBehavior = (typeof WORKFLOW_PRESETS)[keyof typeof WORKFLOW_PRESETS][number];
type WorkflowScopedWriteLoopInput = Omit<WriteLoopInput, "logSink" | "stateStore" | "stepId">;

/**
 * A single workflow step.
 *
 * Contract: carries only per-step write-loop inputs plus workflow-local identity.
 * `stateStore` and `logSink` are workflow-scoped and are injected by
 * `executeWorkflow`, not supplied on each step.
 * Invariants: `stepId` must be unique within the workflow; `role` is opaque and
 * is not persisted by the runner.
 */
export type WorkflowStep = WorkflowScopedWriteLoopInput & {
  /** Unique identifier for this step within the workflow. */
  stepId: string;
  /** Opaque role identifier for durable identity only. */
  role: string;
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

/**
 * Result of a workflow invocation.
 *
 * Contract: reports the stopping outcome, the step that produced it, the
 * durable run ID for that step, and total iterations consumed across the
 * workflow.
 * Invariants: `stepIndex`/`stepId` always refer to the step that produced the
 * returned `kind`.
 */
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

/**
 * Input for the workflow runner.
 *
 * Contract: `steps` is required and ordered. `stateStore` and `logSink`, when
 * supplied, are shared across every step in the workflow.
 */
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

/**
 * Execute a multi-step workflow.
 *
 * Params: `args.steps` must be non-empty and have unique `stepId`s. Optional
 * `stateStore`/`logSink` are shared across all steps.
 * Returns: the terminal or soft-stop outcome for the step that stopped the
 * workflow, or `complete` for the final step when every step completes.
 * Throws: if `steps` is empty or contains duplicate `stepId`s.
 * Invariants: steps are replayed in order on every invocation; previously
 * completed steps rely on `executeWriteLoop`'s idempotent resume behavior
 * rather than a runner-side skip phase.
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

      // Extract workflow-specific fields and pass the rest to executeWriteLoop
      const { stepId, role, ...loopInput } = step;

      const stepInput: WriteLoopInput = {
        ...loopInput,
        stepId,
        stateStore: store,
        ...(args.logSink !== undefined ? { logSink: args.logSink } : {}),
      };

      const result = await executeWriteLoop(stepInput);
      totalIterationsConsumed += result.iterationsConsumed;
      lastResult = result;
      lastStepId = stepId;

      // If this step didn't complete, stop the workflow
      if (result.kind !== "complete") {
        return {
          kind: result.kind,
          stepIndex,
          stepId,
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
