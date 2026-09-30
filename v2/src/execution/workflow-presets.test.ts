import { describe, expect, test } from "bun:test";
import { isStandaloneOnlyPipelineWorkflow, WORKFLOW_PRESET_BUILDERS } from "./workflow-presets.ts";

describe("isStandaloneOnlyPipelineWorkflow", () => {
  test("every builder preset is pipeline-eligible", () => {
    for (const name of Object.keys(WORKFLOW_PRESET_BUILDERS)) {
      expect(isStandaloneOnlyPipelineWorkflow(name)).toBe(false);
    }
  });

  test("review-feedback is standalone-only", () => {
    expect(isStandaloneOnlyPipelineWorkflow("review-feedback")).toBe(true);
  });

  test("unknown workflow is not standalone-only", () => {
    expect(isStandaloneOnlyPipelineWorkflow("no-such-workflow")).toBe(false);
  });
});
