import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { LogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { executeWriteLoop, type WriteLoopInput, type WriteLoopOutcomeKind } from "./write-loop.ts";

export type WorkflowStep = WriteLoopInput & {
  stepId: string;
  role: string;
};

export type WorkflowResult = {
  kind: WriteLoopOutcomeKind;
  stepIndex: number;
  stepId: string;
  runId: string;
  iterationsConsumed: number;
  resumable: boolean;
};

export type WorkflowRunnerInput = {
  agents: readonly string[];
  agentModelConfig: AgentModelConfig;
  steps: WorkflowStep[];
  stateStore?: StateStore;
  logSink?: LogSink;
};

export async function executeWorkflow(args: WorkflowRunnerInput): Promise<WorkflowResult> {
  const { steps, agents, agentModelConfig, stateStore, logSink } = args;

  if (steps.length === 0) {
    throw new Error("Workflow requires at least one step");
  }

  const stepIds = new Set<string>();
  for (const step of steps) {
    if (stepIds.has(step.stepId)) {
      throw new Error(`Duplicate stepId in workflow: "${step.stepId}"`);
    }
    stepIds.add(step.stepId);
  }

  validateWorkflowStepRoles(steps, agents, agentModelConfig);

  const store = stateStore ?? openStateStore();

  try {
    let totalIterationsConsumed = 0;
    let lastResult: Awaited<ReturnType<typeof executeWriteLoop>> | undefined;

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const step = steps[stepIndex];
      if (!step) throw new Error("Unreachable: step undefined in bounded loop");

      const { stepId, role: _role, ...loopInput } = step;

      const result = await executeWriteLoop({
        ...loopInput,
        stepId,
        stateStore: store,
        ...(logSink !== undefined ? { logSink } : {}),
      });
      totalIterationsConsumed += result.iterationsConsumed;
      lastResult = result;

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
    }

    if (!lastResult) throw new Error("Unreachable: lastResult undefined after checked bounds");
    const lastStep = steps[steps.length - 1];
    if (!lastStep) throw new Error("Unreachable: lastStep undefined after checked bounds");

    return {
      kind: "complete",
      stepIndex: steps.length - 1,
      stepId: lastStep.stepId,
      runId: lastResult.runId,
      iterationsConsumed: totalIterationsConsumed,
      resumable: false,
    };
  } finally {
    if (!stateStore) {
      store.close();
    }
  }
}

function validateWorkflowStepRoles(
  steps: readonly WorkflowStep[],
  agents: readonly string[],
  agentModelConfig: AgentModelConfig,
): void {
  const missingBindings: string[] = [];

  for (const step of steps) {
    for (const agent of agents) {
      if ((agentModelConfig[agent] as Record<string, unknown> | undefined)?.[step.role] === undefined) {
        missingBindings.push(`(${step.stepId}, ${step.role}, ${agent})`);
      }
    }
  }

  if (missingBindings.length > 0) {
    throw new Error(`Workflow step role validation failed: ${missingBindings.join(", ")}`);
  }
}
