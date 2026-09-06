import { expect, test } from "bun:test";
import { locateDiscoveredFile } from "../../../shared/structural-test-locator.ts";
import { listProductionExecutionSources } from "./execution-terminal-settlement-guard.ts";
import { EXTRACTED_FROM_WORKFLOW_RUNNER } from "./workflow-runner-resume.ts";

const PRODUCTION_SOURCES = listProductionExecutionSources();
const SHARED_MATCHER_IMPORT = /from\s+["'].*?shared\/write-sibling-step-id\.ts["']/;

function functionDefinitionPattern(name: string): RegExp {
  return new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[<(]`);
}

test("resume helpers are not defined in workflow-runner.ts", () => {
  const workflowRunnerSource = locateDiscoveredFile(PRODUCTION_SOURCES, "workflow-runner.ts");

  for (const name of EXTRACTED_FROM_WORKFLOW_RUNNER) {
    expect(workflowRunnerSource.match(functionDefinitionPattern(name))).toBeNull();
  }
});

test("resume helpers are defined in workflow-runner-resume.ts", () => {
  const resumeModuleSource = locateDiscoveredFile(PRODUCTION_SOURCES, "workflow-runner-resume.ts");

  // Paired with the absence assertion above: without this, deleting a helper outright
  // would pass just as well as moving it.
  for (const name of EXTRACTED_FROM_WORKFLOW_RUNNER) {
    expect(resumeModuleSource.match(functionDefinitionPattern(name))).not.toBeNull();
  }
});

test("isWriteSiblingStepId is not defined locally under v2/src/execution/", () => {
  for (const [, source] of Object.entries(PRODUCTION_SOURCES)) {
    expect(source.match(functionDefinitionPattern("isWriteSiblingStepId"))).toBeNull();
  }
});

test("workflow-runner-resume.ts and workflow-runner.ts import the shared write-sibling step-id matcher", () => {
  const resumeModuleSource = locateDiscoveredFile(PRODUCTION_SOURCES, "workflow-runner-resume.ts");
  const workflowRunnerSource = locateDiscoveredFile(PRODUCTION_SOURCES, "workflow-runner.ts");

  expect(resumeModuleSource.match(SHARED_MATCHER_IMPORT)).not.toBeNull();
  expect(workflowRunnerSource.match(SHARED_MATCHER_IMPORT)).not.toBeNull();
});
