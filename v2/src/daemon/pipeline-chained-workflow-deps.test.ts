import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import type { PipelineContext } from "../persistence/state-store.ts";
import { writeMachineConfig } from "../testing/cli-test-helpers.ts";
import {
  chainedImplementWorkflowDeps,
  chainedPlanWorkflowDeps,
  chainedStageSpecsHome,
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

  test.each([
    [{}, { ok: true, specsHome: "external" }],
    [{ specs: "repo" }, { ok: true, specsHome: "repo" }],
    [{ specs: "external" }, { ok: true, specsHome: "external" }],
  ] as const)("chainedStageSpecsHome resolves project config %p through the specs resolver", (extra, expected) => {
    const root = trackedMkdtempSync(join(tmpdir(), "chained-specs-home-"));
    const configPath = writeMachineConfig({ projects: { demo: { root, ...extra } } });
    const context: PipelineContext = { cwd: root, configPath, projectRegistry: { demo: { root, ...extra } } };
    expect(chainedStageSpecsHome(context, { key: "demo", root })).toEqual(expected);
  });

  test("chainedStageSpecsHome rejects machine modes.plan.commit, naming specs", () => {
    const root = trackedMkdtempSync(join(tmpdir(), "chained-specs-home-legacy-"));
    const configPath = writeMachineConfig({ modes: { plan: { commit: false } }, projects: { demo: { root } } });
    const context: PipelineContext = { cwd: root, configPath, projectRegistry: { demo: { root } } };
    const result = chainedStageSpecsHome(context, { key: "demo", root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("specs");
  });
});
