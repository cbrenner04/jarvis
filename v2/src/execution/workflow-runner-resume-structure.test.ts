import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_RUNNER_SOURCE = readFileSync(join(import.meta.dir, "workflow-runner.ts"), "utf8");
const RESUME_MODULE_SOURCE = readFileSync(join(import.meta.dir, "workflow-runner-resume.ts"), "utf8");

const EXTRACTED_FROM_WORKFLOW_RUNNER = [
  "recoverPlanStage",
  "resumePopulatedIntentPublication",
  "resumeReviewMutationFinalization",
  "landReviewedPublicationOutput",
  "settleIntentResumeFailure",
  "settleReviewMutationResumeFailure",
  "resolveReviewMutationRowHead",
  "admitPlanRecoveryBlockerAndClaim",
  "restoreVerdictSidecars",
  "settleIntentResumeStagedMarkdownLintFailure",
  "inertResumeWriteLoopInput",
  "mutationRepairLoopInput",
  "settleSuccessfulReviewMutationPublication",
] as const;

function functionDefinitionPattern(name: string): RegExp {
  return new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[<(]`);
}

test("resume helpers are not defined in workflow-runner.ts", () => {
  for (const name of EXTRACTED_FROM_WORKFLOW_RUNNER) {
    expect(WORKFLOW_RUNNER_SOURCE.match(functionDefinitionPattern(name))).toBeNull();
  }
});

test("resume helpers are defined in workflow-runner-resume.ts", () => {
  // Paired with the absence assertion above: without this, deleting a helper outright
  // would pass just as well as moving it.
  for (const name of EXTRACTED_FROM_WORKFLOW_RUNNER) {
    expect(RESUME_MODULE_SOURCE.match(functionDefinitionPattern(name))).not.toBeNull();
  }
});
