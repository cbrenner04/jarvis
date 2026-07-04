import type { LogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { executeWriteLoop, type WriteLoopInput, type WriteLoopOutcomeKind } from "./write-loop.ts";

/** Classification of a workflow outcome — mirrors the write loop's outcome kinds. */
export type WorkflowOutcomeKind = WriteLoopOutcomeKind;

const WORKFLOW_PRESETS = {
  "write-write": ["write", "write"],
} as const;

/** A single step in a workflow. */
export type WorkflowStep = WriteLoopInput & {
  /** Unique identifier for this step within the workflow. */
  stepId: string;
  /** Opaque role identifier for durable identity only. */
  role: string;
};

/** Authoring input for one workflow step before behavior-specific fields are normalized. */
export type WorkflowStepDefinition = WorkflowStep & {
  /** Behavior primitive this step runs. */
  behavior: (typeof WORKFLOW_PRESETS)[keyof typeof WORKFLOW_PRESETS][number];
};

/** Named workflow presets available to callers. */
export type WorkflowPresetName = keyof typeof WORKFLOW_PRESETS;

/** Per-position caller input for a preset-resolved step. */
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

export function defineWorkflowStep(args: WorkflowStepDefinition): WorkflowStep {
  const { behavior: _behavior, ...step } = args;
  return step;
}

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
