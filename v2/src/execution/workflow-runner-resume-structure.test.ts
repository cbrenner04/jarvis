import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXECUTION_DIR = import.meta.dir;
const WORKFLOW_RUNNER_SOURCE = readFileSync(join(EXECUTION_DIR, "workflow-runner.ts"), "utf8");
const RESUME_MODULE_SOURCE = readFileSync(join(EXECUTION_DIR, "workflow-runner-resume.ts"), "utf8");
const SHARED_MATCHER_IMPORT = /from\s+["'].*?shared\/write-sibling-step-id\.ts["']/;

const EXECUTION_PRODUCTION_SOURCES = readdirSync(EXECUTION_DIR)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => ({ name, source: readFileSync(join(EXECUTION_DIR, name), "utf8") }));

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

test("isWriteSiblingStepId is not defined locally under v2/src/execution/", () => {
  for (const { name, source } of EXECUTION_PRODUCTION_SOURCES) {
    expect(source.match(functionDefinitionPattern("isWriteSiblingStepId"))).toBeNull();
  }
});

test("workflow-runner-resume.ts and workflow-runner.ts import the shared write-sibling step-id matcher", () => {
  expect(RESUME_MODULE_SOURCE.match(SHARED_MATCHER_IMPORT)).not.toBeNull();
  expect(WORKFLOW_RUNNER_SOURCE.match(SHARED_MATCHER_IMPORT)).not.toBeNull();
});
