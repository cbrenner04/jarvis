import { describe, expect, test } from "bun:test";
import type { PipelineContext } from "../persistence/state-store.ts";
import { chainedImplementWorkflowDeps, chainedPlanWorkflowDeps } from "./pipeline-chained-workflow-deps.ts";

const CONTEXT: PipelineContext = {
  cwd: "/repo",
  configPath: "/fake/.jarvis/config.json",
  projectRegistry: {},
};

describe("chained workflow deps", () => {
  test("chainedImplementWorkflowDeps threads configPath and loadWorkflowSteps from context", () => {
    const deps = chainedImplementWorkflowDeps(CONTEXT);
    expect(deps.configPath).toBe("/fake/.jarvis/config.json");
    expect(typeof deps.loadWorkflowSteps).toBe("function");
    // inherits the plan-stage project matcher
    expect(typeof deps.resolveProjectMatch).toBe("function");
  });

  test("chainedPlanWorkflowDeps exposes only the project matcher", () => {
    const deps = chainedPlanWorkflowDeps(CONTEXT);
    expect(typeof deps.resolveProjectMatch).toBe("function");
    expect("configPath" in deps).toBe(false);
    expect("loadWorkflowSteps" in deps).toBe(false);
  });
});
