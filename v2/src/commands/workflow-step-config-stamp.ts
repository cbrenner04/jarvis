import {
  readConfiguredIdleOutputTimeoutMs,
  readProjectFixCommand,
  readProjectReadyCommand,
  readReviewRoleTimeoutMs,
  resolveWritePathIterationBounds,
} from "../config/machine-config-loader.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";

export function stampWorkflowStepsWithMachineConfig(
  steps: readonly AnyWorkflowStep[],
  machineConfigPath: string,
): AnyWorkflowStep[] {
  const bounds = resolveWritePathIterationBounds(machineConfigPath);
  const configuredIdleOutputMs = readConfiguredIdleOutputTimeoutMs(machineConfigPath);
  const reviewRoleTimeoutMs = readReviewRoleTimeoutMs(machineConfigPath);
  return steps.map((step) => {
    if (step.behavior !== "write") {
      return step.behavior === "review" || step.behavior === "review-debate"
        ? {
            ...step,
            roleTimeoutMs: reviewRoleTimeoutMs,
            ...(configuredIdleOutputMs === undefined ? {} : { idleOutputMs: configuredIdleOutputMs }),
          }
        : step;
    }
    const fixCommand = readProjectFixCommand(step.worktree.projectName, machineConfigPath);
    const readyCommand = readProjectReadyCommand(step.worktree.projectName, machineConfigPath);
    return {
      ...step,
      ...bounds,
      ...(fixCommand !== undefined ? { fixCommand } : {}),
      ...(readyCommand !== undefined ? { readyCommand } : {}),
    };
  });
}
