import { describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_MODEL_CONFIG } from "./workflow-runner.test-support.ts";
import type { ReviewWorkflowStep } from "./workflow-runner.ts";
import { planRecoveryLanding } from "./workflow-runner-resume.test-support.ts";

function baseReviewStep(): ReviewWorkflowStep {
  return {
    behavior: "review",
    stepId: "plan-review",
    project: "demo",
    branch: "b",
    cwd: "/tmp/plan-recovery-landing",
    verdictPath: "/tmp/plan-recovery-landing/verdict.md",
    maxCycles: 1,
    agents: { critic: [], actuator: [] },
    agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
  };
}

describe("planRecoveryLanding", () => {
  test("refuses a captured step with no plan-tree landing", () => {
    const step = baseReviewStep();
    expect(() => planRecoveryLanding(step)).toThrow("expected plan-tree landing");
  });

  test("carries a captured step's plan-tree landing through unchanged", () => {
    const landing = { kind: "plan-tree" as const, stagingDir: ".jarvis-plan-stage", durablePath: "/tmp/durable" };
    const step: ReviewWorkflowStep = { ...baseReviewStep(), landing };
    expect(planRecoveryLanding(step)).toEqual({
      stepId: step.stepId,
      behavior: step.behavior,
      verdictPath: step.verdictPath,
      landing,
    });
  });
});
