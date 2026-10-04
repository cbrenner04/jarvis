import { expect, test } from "bun:test";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import { createMinimalDispatchWriteStep } from "./workflow-step-fixtures.ts";

test("createMinimalDispatchWriteStep assigns to AnyWorkflowStep without a cast", () => {
  const step: AnyWorkflowStep = createMinimalDispatchWriteStep();
  expect(step.behavior).toBe("write");
  if (step.behavior === "write") {
    expect(step.worktree.projectName).toBe("demo");
  }
});

test("createMinimalDispatchWriteStep accepts stageIndex and branchKey overrides without casts", () => {
  const dispatchStep = createMinimalDispatchWriteStep({ stageIndex: 2, branchKey: "branch-a" });
  const step: AnyWorkflowStep = dispatchStep;
  expect(dispatchStep.stageIndex).toBe(2);
  expect(dispatchStep.branchKey).toBe("branch-a");
  expect(step.behavior).toBe("write");
});
