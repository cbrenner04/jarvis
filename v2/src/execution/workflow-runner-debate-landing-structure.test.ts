import { expect, test } from "bun:test";
import { locateDiscoveredFile } from "../../../shared/structural-test-locator.ts";
import { listProductionExecutionSources } from "./execution-terminal-settlement-guard.ts";
import { EXTRACTED_FROM_WORKFLOW_RUNNER } from "./workflow-runner-debate-landing.ts";

const PRODUCTION_SOURCES = listProductionExecutionSources();

function functionDefinitionPattern(name: string): RegExp {
  return new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[<(]`);
}

test("review-debate landing helpers are not defined in workflow-runner.ts", () => {
  const workflowRunnerSource = locateDiscoveredFile(PRODUCTION_SOURCES, "workflow-runner.ts");
  const debateLandingSource = locateDiscoveredFile(PRODUCTION_SOURCES, "workflow-runner-debate-landing.ts");

  for (const name of EXTRACTED_FROM_WORKFLOW_RUNNER) {
    expect(workflowRunnerSource.match(functionDefinitionPattern(name))).toBeNull();
    expect(debateLandingSource.match(functionDefinitionPattern(name))).not.toBeNull();
  }
});
