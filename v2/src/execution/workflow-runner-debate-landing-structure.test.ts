import { expect, test } from "bun:test";
import {
  listProductionExecutionSources,
  readProductionExecutionSource,
} from "./execution-terminal-settlement-guard.ts";
import { EXTRACTED_FROM_WORKFLOW_RUNNER } from "./workflow-runner-debate-landing.ts";

function functionDefinitionPattern(name: string): RegExp {
  return new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[<(]`);
}

test("review-debate landing helpers are not defined in workflow-runner.ts", () => {
  const sources = listProductionExecutionSources();
  const workflowRunnerSource = readProductionExecutionSource(sources, "workflow-runner.ts");
  const debateLandingSource = readProductionExecutionSource(sources, "workflow-runner-debate-landing.ts");

  for (const name of EXTRACTED_FROM_WORKFLOW_RUNNER) {
    expect(workflowRunnerSource.match(functionDefinitionPattern(name))).toBeNull();
    expect(debateLandingSource.match(functionDefinitionPattern(name))).not.toBeNull();
  }
});
