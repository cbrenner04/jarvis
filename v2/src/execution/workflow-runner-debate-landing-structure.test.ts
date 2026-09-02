import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_RUNNER_SOURCE = readFileSync(join(import.meta.dir, "workflow-runner.ts"), "utf8");

const EXTRACTED_FROM_WORKFLOW_RUNNER = [
  "runReviewDebateStep",
  "tryActuatorOnlyReviewDebateRetry",
  "landReviewedOutputOrFail",
  "finishReviewedLanding",
  "finishReviewDebateLanding",
  "commitReviewDebateOutcome",
  "buildReviewDebateLandingActuatorContext",
  "repromptReviewedStagedMarkdownLintOrFail",
] as const;

function functionDefinitionPattern(name: string): RegExp {
  return new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[<(]`);
}

test("review-debate landing helpers are not defined in workflow-runner.ts", () => {
  for (const name of EXTRACTED_FROM_WORKFLOW_RUNNER) {
    expect(WORKFLOW_RUNNER_SOURCE.match(functionDefinitionPattern(name))).toBeNull();
  }
});
