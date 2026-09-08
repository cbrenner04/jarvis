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
    const projectName = step.behavior === "write" ? step.worktree.projectName : step.project;
    const fixCommand = readProjectFixCommand(projectName, machineConfigPath);
    const readyCommand = readProjectReadyCommand(projectName, machineConfigPath);
    if (step.behavior === "write") {
      return {
        ...step,
        ...bounds,
        ...(fixCommand !== undefined ? { fixCommand } : {}),
        ...(readyCommand !== undefined ? { readyCommand } : {}),
      };
    }
    return {
      ...step,
      roleTimeoutMs: reviewRoleTimeoutMs,
      ...(configuredIdleOutputMs === undefined ? {} : { idleOutputMs: configuredIdleOutputMs }),
      ...(fixCommand !== undefined ? { fixCommand } : {}),
      ...(readyCommand !== undefined ? { readyCommand } : {}),
    };
  });
}
