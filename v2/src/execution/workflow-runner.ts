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

/** A single step in a workflow. */
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
      const { stepId, role, agents, agentModelConfig, createBinding, ...loopInput } = step;
      const executableRole = resolveExecutableRole(role);
      const bindings = resolveInvocationBindings(
        executableRole,
        agents,
        agentModelConfig,
        createBinding ?? createResolvedAgentBinding,
      );

      const stepInput: WriteLoopInput = {
        ...loopInput,
        stepId,
        bindings,
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
