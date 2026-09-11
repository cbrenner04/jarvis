import { describe, expect, test } from "bun:test";
import {
  buildResetStaleWorkspaceOptions,
  maybeResetStaleWorkspace,
  STALE_RESET_WORKFLOWS,
} from "./stale-reset-workspace.ts";

describe("stale-reset-workspace exports", () => {
  test("maybeResetStaleWorkspace and STALE_RESET_WORKFLOWS are importable", () => {
    expect(typeof maybeResetStaleWorkspace).toBe("function");
    expect(STALE_RESET_WORKFLOWS.has("intent")).toBe(true);
  });
});

describe("buildResetStaleWorkspaceOptions: the real plan step shape", () => {
  /**
   * `buildPlanWorkflowSteps` names a freshly-timestamped durable spec directory
   * (`${timestamp}-${ready.name}`) on every invocation, so on a re-dispatch the `specPath` it hands
   * here refers to a directory that exists in neither tree. The CLI stale-reset cases all substitute
   * an implement fixture whose `specPath` is a stable `index.md`, which is a different shape: this
   * pins the plan one so a regression cannot hide behind that substitution.
   */
  function planWriteStep(specPath: string) {
    return { behavior: "write" as const, specPath };
  }

  test("threads a plan lane's timestamped specPath through unchanged", () => {
    const specPath = "spec/20260911T015530Z-improve-api";
    const options = buildResetStaleWorkspaceOptions({
      skipDirtyWorktreeGate: false,
      skipLandedCriteriaGate: false,
      baseRef: "main",
      writeStep: planWriteStep(specPath) as never,
      parsed: { disposableLane: true },
    });

    expect(options.specPath).toBe(specPath);
    expect(options.disposableLane).toBe(true);
    expect(options.baseRef).toBe("main");
  });

  test("omits disposableLane unless the classification set it", () => {
    // `disposableLane` is only ever true for a confirmed never-landed lane; anything else must leave
    // the key absent so the descendant and landed-criteria gates run.
    const options = buildResetStaleWorkspaceOptions({
      skipDirtyWorktreeGate: false,
      skipLandedCriteriaGate: false,
      baseRef: "main",
      writeStep: planWriteStep("spec/20260911T015530Z-improve-api") as never,
      parsed: {},
    });

    expect("disposableLane" in options).toBe(false);
  });

  test("drops specPath for an external plan spec, which has no in-repo criteria to compare", () => {
    const options = buildResetStaleWorkspaceOptions({
      skipDirtyWorktreeGate: false,
      skipLandedCriteriaGate: false,
      baseRef: "main",
      writeStep: { behavior: "write", specPath: "plans/improve-api", externalPlanSpec: true } as never,
      parsed: { disposableLane: true },
    });

    expect("specPath" in options).toBe(false);
    expect(options.disposableLane).toBe(true);
  });
});
