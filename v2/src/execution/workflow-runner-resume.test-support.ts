import { tmpdir } from "node:os";
import { createStubMarkdownlintRunner, DEFAULT_AGENT_MODEL_CONFIG } from "./workflow-runner.test-support.ts";
import type { PlanStageRecoveryLanding } from "./workflow-runner-resume.ts";
// Side-effect import: loading workflow-runner.ts wires workflow-runner-resume.ts's module-level
// resumeInjected() deps. Every split resume test file imports this test-support module, so the
// wiring happens exactly once regardless of which split file bun loads first.
import "./workflow-runner.ts";
import type { ReviewDebateWorkflowStep, ReviewWorkflowStep } from "./workflow-runner.ts";

/** Seed-less landing inputs: a recorded, empty seed set so resume admission is exercised without consumption. */
export const EMPTY_LANDING_INPUTS = { sourceRoot: tmpdir(), paths: [] as string[], consumeFrom: "worktree" as const };

/** Shared stub for `recoverPlanStage`/`resumePopulatedIntentPublication` calls below that don't assert on the lint runner themselves. */
export const DEFAULT_STAGED_MARKDOWN_LINT_RUNNER = createStubMarkdownlintRunner();

export function planRecoveryLanding(step: ReviewWorkflowStep | ReviewDebateWorkflowStep): PlanStageRecoveryLanding {
  if (step.landing?.kind !== "plan-tree") throw new Error("expected plan-tree landing");
  return {
    stepId: step.stepId,
    behavior: step.behavior,
    verdictPath: step.verdictPath,
    landing: step.landing,
  };
}

export function reviewMutationWorkflowSnapshot(
  invocationId: string,
  creationTitle: string,
  reviewStep: { stepId: string; role: string; durable?: boolean; behavior: "review" } = {
    stepId: "implement-review",
    role: "",
    durable: true,
    behavior: "review",
  },
) {
  return {
    invocationId,
    creationTitle,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "implement rules",
        expectedArtifactPath: "artifact",
        agents: ["codex"],
        agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
      },
      reviewStep,
    ],
  };
}
