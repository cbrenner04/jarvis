import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildImplementWorkflowStepsInput } from "../execution/implement-workflow-steps.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { IntentWorkflowInput, PlanWorkflowInput } from "../execution/publication-workflow-steps.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import { type PipelineContext, resolveStageWorkflowSteps } from "./pipeline-stage-resolve.ts";

const okStep = { behavior: "write" } as never;

function fakeBuilders(overrides: Partial<typeof WORKFLOW_PRESET_BUILDERS> = {}): typeof WORKFLOW_PRESET_BUILDERS {
  const failEverything = async () => ({ ok: false as const, error: "unexpected call" });
  return {
    implement: failEverything,
    intent: failEverything,
    "intent-reviewed": failEverything,
    plan: failEverything,
    "plan-reviewed": failEverything,
    "plan-reviewed-light": failEverything,
    ...overrides,
  };
}

const baseContext: PipelineContext = { cwd: "/repo", seed: "seed text" };

describe("resolveStageWorkflowSteps", () => {
  test("first workflow stage builds with PipelineContext.seed as the seed input", async () => {
    let seenInput: IntentWorkflowInput | undefined;
    const builders = fakeBuilders({
      "intent-reviewed": async (input) => {
        seenInput = input as unknown as IntentWorkflowInput;
        return { ok: true, steps: [okStep], identity: {} as never };
      },
    });
    const definition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "intent", kind: "workflow", workflow: "intent", review: "light" }],
    };

    const result = await resolveStageWorkflowSteps(definition, 0, baseContext, new Map(), { builders });

    expect(result.ok).toBe(true);
    expect(seenInput?.seedText).toBe(baseContext.seed);
  });

  test("second workflow stage builds with the first stage's recorded artifact as readyIntent, matching the recorded value", async () => {
    let seenInput: PlanWorkflowInput | undefined;
    const builders = fakeBuilders({
      "plan-reviewed": async (input) => {
        seenInput = input as unknown as PlanWorkflowInput;
        return { ok: true, steps: [okStep], identity: {} as never };
      },
    });
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "light" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "debate" },
      ],
    };
    const recordedArtifact = "spec/ready-intents/foo.md";
    const artifactSpecPaths = new Map([["intent", recordedArtifact]]);

    const result = await resolveStageWorkflowSteps(definition, 1, baseContext, artifactSpecPaths, { builders });

    expect(result.ok).toBe(true);
    expect(seenInput?.readyIntent).toBe(recordedArtifact);
  });

  test("approval stages are skipped when walking back to find the preceding workflow artifact", async () => {
    let seenInput: PlanWorkflowInput | undefined;
    const builders = fakeBuilders({
      "plan-reviewed-light": async (input) => {
        seenInput = input as unknown as PlanWorkflowInput;
        return { ok: true, steps: [okStep], identity: {} as never };
      },
    });
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "light" },
        { stageId: "approve-intent", kind: "approval" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "light" },
      ],
    };
    const recordedArtifact = "spec/ready-intents/foo.md";
    const artifactSpecPaths = new Map([["intent", recordedArtifact]]);

    const result = await resolveStageWorkflowSteps(definition, 2, baseContext, artifactSpecPaths, { builders });

    expect(result.ok).toBe(true);
    expect(seenInput?.readyIntent).toBe(recordedArtifact);
  });

  test("intent+none maps to intent preset", async () => {
    let called = false;
    const builders = fakeBuilders({
      intent: async () => {
        called = true;
        return { ok: true, steps: [okStep], identity: {} as never };
      },
    });
    const definition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "intent", kind: "workflow", workflow: "intent", review: "none" }],
    };

    const result = await resolveStageWorkflowSteps(definition, 0, baseContext, new Map(), { builders });

    expect(result.ok).toBe(true);
    expect(called).toBe(true);
  });

  test("plan+none maps to plan preset", async () => {
    let called = false;
    const builders = fakeBuilders({
      plan: async () => {
        called = true;
        return { ok: true, steps: [okStep], identity: {} as never };
      },
    });
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };

    const result = await resolveStageWorkflowSteps(definition, 1, baseContext, new Map([["intent", "x.md"]]), {
      builders,
    });

    expect(result.ok).toBe(true);
    expect(called).toBe(true);
  });

  test("plan+light maps to plan-reviewed-light preset", async () => {
    let called = false;
    const builders = fakeBuilders({
      "plan-reviewed-light": async () => {
        called = true;
        return { ok: true, steps: [okStep], identity: {} as never };
      },
    });
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "light" },
      ],
    };

    const result = await resolveStageWorkflowSteps(definition, 1, baseContext, new Map([["intent", "x.md"]]), {
      builders,
    });

    expect(result.ok).toBe(true);
    expect(called).toBe(true);
  });

  test("implement stage's built steps carry the stage's own posture as reviewBehavior, not a project default", async () => {
    let seenInput: BuildImplementWorkflowStepsInput | undefined;
    const builders = fakeBuilders({
      implement: async (input) => {
        seenInput = input;
        return { ok: true, steps: [okStep] };
      },
    });
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const artifactSpecPaths = new Map([["plan", "spec/index.md"]]);

    const result = await resolveStageWorkflowSteps(definition, 1, baseContext, artifactSpecPaths, {
      builders,
      resolveBaseRef: async () => "main",
    });

    expect(result.ok).toBe(true);
    expect(seenInput?.reviewBehavior).toBe("light");
    expect(seenInput?.specPath).toBe("spec/index.md");
  });

  test("a stage whose (workflow, review) pair has no table entry returns a resolution failure, not a throw", async () => {
    const builders = fakeBuilders();
    const definition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "intent", kind: "workflow", workflow: "intent", review: "debate" }],
    };

    const result = await resolveStageWorkflowSteps(definition, 0, baseContext, new Map(), { builders });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("intent");
  });

  test("a builder call reporting failure returns a resolution failure, not a thrown error or a fallback preset", async () => {
    const builders = fakeBuilders({
      intent: async () => ({ ok: false, error: "intent: boom" }),
    });
    const definition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "intent", kind: "workflow", workflow: "intent", review: "none" }],
    };

    const result = await resolveStageWorkflowSteps(definition, 0, baseContext, new Map(), { builders });

    expect(result).toEqual({ ok: false, error: "intent: boom" });
  });

  test("a stage with no preceding workflow artifact where one is required returns a resolution failure, not a throw", async () => {
    const builders = fakeBuilders();
    const definition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "plan", kind: "workflow", workflow: "plan", review: "none" }],
    };

    const result = await resolveStageWorkflowSteps(definition, 0, baseContext, new Map(), { builders });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("preceding workflow artifact");
  });

  test("intent review none resolves through real preset builders without a review step", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-resolve-intent-"));
    const configPath = writeHomeMachineConfig({ projects: { demo: { root: cwd } } });
    const context: PipelineContext = { cwd, configPath, seed: "ship feature" };
    const definition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "intent", kind: "workflow", workflow: "intent", review: "none" }],
    };

    const result = await resolveStageWorkflowSteps(definition, 0, context, new Map(), {
      builders: WORKFLOW_PRESET_BUILDERS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.some((step) => step.behavior === "review" || step.behavior === "review-debate")).toBe(false);
  });

  test("plan review none resolves through real preset builders without a review step", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-resolve-plan-"));
    mkdirSync(join(cwd, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(cwd, "spec/ready-intents/feature.md"), "---\nname: feature\n---\n## Prerequisites\n", "utf8");
    const configPath = writeHomeMachineConfig({ projects: { demo: { root: cwd } } });
    const context: PipelineContext = { cwd, configPath, seed: "unused" };
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const artifactSpecPaths = new Map([["intent", "spec/ready-intents/feature.md"]]);

    const result = await resolveStageWorkflowSteps(definition, 1, context, artifactSpecPaths, {
      builders: WORKFLOW_PRESET_BUILDERS,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.some((step) => step.behavior === "review" || step.behavior === "review-debate")).toBe(false);
  });
});
