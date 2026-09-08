import { describe, expect, test } from "bun:test";
import type { ReviewDebateWorkflowStep, ReviewWorkflowStep } from "../execution/workflow-runner.ts";
import { writeMachineConfig } from "../testing/cli-test-helpers.ts";
import { createMinimalDispatchWriteStep } from "../testing/workflow-step-fixtures.ts";
import { stampWorkflowStepsWithMachineConfig } from "./workflow-step-config-stamp.ts";

function reviewStep(): ReviewWorkflowStep {
  return {
    behavior: "review",
    stepId: "review",
    project: "demo",
    branch: "implement-run",
    agents: { critic: ["claude"], actuator: ["claude"] },
    agentModelConfig: {},
    cwd: "/fake",
    verdictPath: "verdict.md",
    maxCycles: 1,
  };
}

function reviewDebateStep(): ReviewDebateWorkflowStep {
  return {
    behavior: "review-debate",
    stepId: "review-debate",
    project: "demo",
    branch: "implement-run",
    agents: {
      adversary: ["claude"],
      advocate: ["claude"],
      adjudicator: ["claude"],
      actuator: ["claude"],
    },
    agentModelConfig: {},
    cwd: "/fake",
    verdictPath: "verdict.md",
    maxCycles: 1,
    prompts: { adversary: "a", advocate: "b", adjudicator: "c" },
  };
}

describe("stampWorkflowStepsWithMachineConfig gate commands", () => {
  test("stamps configured fixCommand and readyCommand onto write, review, and review-debate steps", () => {
    // @mutate v2/src/commands/workflow-step-config-stamp.ts "...(fixCommand !== undefined ? { fixCommand } : {})," -> "...(fixCommand === undefined ? { fixCommand } : {}),"
    // @mutate v2/src/commands/workflow-step-config-stamp.ts "...(readyCommand !== undefined ? { readyCommand } : {})," -> "...(readyCommand === undefined ? { readyCommand } : {}),"
    const configPath = writeMachineConfig({
      projects: { demo: { fixCommand: "npm run fix-custom", readyCommand: "npm run verify-custom" } },
    });
    const stamped = stampWorkflowStepsWithMachineConfig(
      [createMinimalDispatchWriteStep(), reviewStep(), reviewDebateStep()],
      configPath,
    );
    expect(stamped[0]).toMatchObject({
      behavior: "write",
      fixCommand: "npm run fix-custom",
      readyCommand: "npm run verify-custom",
    });
    expect(stamped[1]).toMatchObject({
      behavior: "review",
      fixCommand: "npm run fix-custom",
      readyCommand: "npm run verify-custom",
    });
    expect(stamped[2]).toMatchObject({
      behavior: "review-debate",
      fixCommand: "npm run fix-custom",
      readyCommand: "npm run verify-custom",
    });
  });

  test("leaves gate commands unstamped when project overrides are absent", () => {
    const configPath = writeMachineConfig({ projects: { demo: {} } });
    const stamped = stampWorkflowStepsWithMachineConfig([createMinimalDispatchWriteStep(), reviewStep()], configPath);
    for (const step of stamped) {
      expect(step).not.toHaveProperty("fixCommand");
      expect(step).not.toHaveProperty("readyCommand");
    }
  });
});
