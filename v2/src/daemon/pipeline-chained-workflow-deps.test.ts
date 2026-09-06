import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineContext } from "../persistence/state-store.ts";
import { writeMachineConfig } from "../testing/cli-test-helpers.ts";
import {
  chainedImplementWorkflowDeps,
  chainedPlanWorkflowDeps,
  chainedStageEffectivePublishGit,
} from "./pipeline-chained-workflow-deps.ts";

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

  test("chainedStageEffectivePublishGit honors machine modes.plan.commit when project plan.commit is unset", () => {
    const root = mkdtempSync(join(tmpdir(), "chained-effective-publish-git-"));
    const configPath = writeMachineConfig({
      modes: { plan: { commit: false } },
      projects: { demo: { root } },
    });
    const context: PipelineContext = {
      cwd: root,
      configPath,
      projectRegistry: { demo: { root } },
    };
    expect(chainedStageEffectivePublishGit(context, { key: "demo", root })).toBe(false);
  });
});
