import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildImplementWorkflowStepsInput } from "../execution/implement-workflow-steps.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { IntentWorkflowInput, PlanWorkflowInput } from "../execution/publication-workflow-steps.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import { publishCompletionArtifacts } from "../execution/write-loop.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import type { PipelineStageArtifact } from "./pipeline-stage-dispatch.ts";
import {
  type PipelineContext,
  type PipelineStageResolveDeps,
  resolveStageWorkflowSteps,
  setInvertPriorWorktreeRootGuardForTest,
} from "./pipeline-stage-resolve.ts";

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

function stageArtifact(entryRunId: string, specPath: string): PipelineStageArtifact {
  return { entryRunId, specPath };
}

function loadRunAt(worktreePath: string): NonNullable<PipelineStageResolveDeps["loadRun"]> {
  return () => ({ worktreePath });
}

function chainedDeps(
  worktreePath: string,
  overrides: Partial<PipelineStageResolveDeps> = {},
): PipelineStageResolveDeps {
  return { loadRun: loadRunAt(worktreePath), ...overrides };
}

async function resolveFirstIntentStageWithRealBuilders(review: "none" | "debate") {
  const cwd = mkdtempSync(join(tmpdir(), "pipeline-resolve-intent-"));
  const configPath = writeHomeMachineConfig({ projects: { demo: { root: cwd } } });
  const context: PipelineContext = { cwd, configPath, seed: "ship feature" };
  const definition: PipelineDefinition = {
    name: "p",
    stages: [{ stageId: "intent", kind: "workflow", workflow: "intent", review }],
  };
  return resolveStageWorkflowSteps(definition, 0, context, new Map(), { builders: WORKFLOW_PRESET_BUILDERS });
}

afterEach(() => {
  setInvertPriorWorktreeRootGuardForTest(false);
});

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
    const stageArtifacts = new Map([["intent", stageArtifact("run-intent", recordedArtifact)]]);

    const result = await resolveStageWorkflowSteps(definition, 1, baseContext, stageArtifacts, {
      builders,
      ...chainedDeps(baseContext.cwd),
    });

    expect(result.ok).toBe(true);
    expect(seenInput?.readyIntent).toBe(recordedArtifact);
    expect(seenInput?.cwd).toBe(baseContext.cwd);
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
    const stageArtifacts = new Map([["intent", stageArtifact("run-intent", recordedArtifact)]]);

    const result = await resolveStageWorkflowSteps(definition, 2, baseContext, stageArtifacts, {
      builders,
      ...chainedDeps(baseContext.cwd),
    });

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

    const result = await resolveStageWorkflowSteps(
      definition,
      1,
      baseContext,
      new Map([["intent", stageArtifact("run-intent", "x.md")]]),
      { builders, ...chainedDeps(baseContext.cwd) },
    );

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

    const result = await resolveStageWorkflowSteps(
      definition,
      1,
      baseContext,
      new Map([["intent", stageArtifact("run-intent", "x.md")]]),
      { builders, ...chainedDeps(baseContext.cwd) },
    );

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
    const stageArtifacts = new Map([["plan", stageArtifact("run-plan", "spec/index.md")]]);

    const result = await resolveStageWorkflowSteps(definition, 1, baseContext, stageArtifacts, {
      builders,
      resolveBaseRef: async () => "main",
      ...chainedDeps(baseContext.cwd),
    });

    expect(result.ok).toBe(true);
    expect(seenInput?.reviewBehavior).toBe("light");
    expect(seenInput?.specPath).toBe("spec/index.md");
  });

  test("intent+debate maps to intent preset with debate reviewBehavior and one pass", async () => {
    let seenInput: IntentWorkflowInput | undefined;
    const builders = fakeBuilders({
      intent: async (input) => {
        seenInput = input as unknown as IntentWorkflowInput;
        return { ok: true, steps: [okStep], identity: {} as never };
      },
    });
    const definition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "intent", kind: "workflow", workflow: "intent", review: "debate" }],
    };

    const result = await resolveStageWorkflowSteps(definition, 0, baseContext, new Map(), { builders });

    expect(result.ok).toBe(true);
    expect(seenInput).toMatchObject({ reviewPasses: 1, reviewBehavior: "debate" });
  });

  test("an intent stage with review none resolves zero review passes and no review behavior", async () => {
    let seenInput: IntentWorkflowInput | undefined;
    const builders = fakeBuilders({
      intent: async (input) => {
        seenInput = input as unknown as IntentWorkflowInput;
        return { ok: true, steps: [okStep], identity: {} as never };
      },
    });
    const definition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "intent", kind: "workflow", workflow: "intent", review: "none" }],
    };

    const result = await resolveStageWorkflowSteps(definition, 0, baseContext, new Map(), { builders });

    expect(result.ok).toBe(true);
    expect(seenInput?.reviewPasses).toBe(0);
    expect(seenInput?.reviewBehavior).toBeUndefined();
  });

  test("a stage whose (workflow, review) pair has no table entry returns a resolution failure, not a throw", async () => {
    const builders = fakeBuilders();
    const definition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "implement", kind: "workflow", workflow: "implement", review: "none" }],
    };

    const result = await resolveStageWorkflowSteps(definition, 0, baseContext, new Map(), { builders });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("implement");
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

    const result = await resolveStageWorkflowSteps(definition, 0, baseContext, new Map(), {
      builders,
      loadRun: () => null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("preceding workflow artifact");
  });

  test("intent review debate resolves through real preset builders with a review-debate step", async () => {
    const result = await resolveFirstIntentStageWithRealBuilders("debate");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.some((step) => step.behavior === "review-debate")).toBe(true);
  });

  test("intent review none resolves through real preset builders without a review step", async () => {
    const result = await resolveFirstIntentStageWithRealBuilders("none");

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
    const stageArtifacts = new Map([["intent", stageArtifact("run-intent", "spec/ready-intents/feature.md")]]);

    const result = await resolveStageWorkflowSteps(definition, 1, context, stageArtifacts, {
      builders: WORKFLOW_PRESET_BUILDERS,
      ...chainedDeps(cwd),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.some((step) => step.behavior === "review" || step.behavior === "review-debate")).toBe(false);
  });

  test("leave-draft pipeline implement completion skips ready finalization", async () => {
    const publishWriteStep = { behavior: "write", publishCompletion: true } as never;
    const builders = fakeBuilders({
      implement: async () => ({ ok: true, steps: [publishWriteStep] }),
    });
    const leaveDraftDefinition: PipelineDefinition = {
      name: "p",
      terminalAction: "leave-draft",
      stages: [
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const resolveDeps = {
      builders,
      resolveBaseRef: async () => "main",
      ...chainedDeps(baseContext.cwd),
    };
    const stageArtifacts = new Map([["plan", stageArtifact("run-plan", "spec/index.md")]]);

    const leaveDraft = await resolveStageWorkflowSteps(leaveDraftDefinition, 1, baseContext, stageArtifacts, resolveDeps);
    expect(leaveDraft.ok).toBe(true);
    if (!leaveDraft.ok) return;
    const leaveDraftStep = leaveDraft.steps.find(
      (step): step is Extract<(typeof leaveDraft.steps)[number], { behavior: "write" }> =>
        step.behavior === "write" && step.publishCompletion !== false,
    );
    if (!leaveDraftStep) throw new Error("expected publish write step");
    expect(leaveDraftStep.skipReadyFinalization).toBe(true);

    const readyDefinition: PipelineDefinition = { ...leaveDraftDefinition, terminalAction: "ready" };
    const ready = await resolveStageWorkflowSteps(readyDefinition, 1, baseContext, stageArtifacts, resolveDeps);
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    const readyStep = ready.steps.find(
      (step): step is Extract<(typeof ready.steps)[number], { behavior: "write" }> =>
        step.behavior === "write" && step.publishCompletion !== false,
    );
    expect(readyStep?.skipReadyFinalization).toBeUndefined();

    let finalizerCalled = false;
    const outcome = await publishCompletionArtifacts(
      {
        skipReadyFinalization: true,
        completionPublisher: async () => ({ prNumber: 1, prUrl: "https://example.com/pr/1" }),
        readyFinalizer: async () => {
          finalizerCalled = true;
          return {};
        },
      },
      {
        worktreePath: "/repo",
        baseRef: "main",
        specPath: "spec/index.md",
        branch: "feature",
      },
    );
    expect(finalizerCalled).toBe(false);
    expect(outcome.kind).toBe("success");
  });

  test("plan stage resolves chained readyIntent from the intent entry-run worktree, not admission cwd", async () => {
    const operatorCwd = mkdtempSync(join(tmpdir(), "pipeline-resolve-operator-"));
    const intentWorktree = mkdtempSync(join(tmpdir(), "pipeline-resolve-intent-wt-"));
    const readyIntentRel = "spec/ready-intents/feature.md";
    mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(intentWorktree, readyIntentRel), "---\nname: feature\n---\n## Prerequisites\n", "utf8");
    expect(existsSync(join(operatorCwd, readyIntentRel))).toBe(false);

    let seenInput: PlanWorkflowInput | undefined;
    const builders = fakeBuilders({
      plan: async (input) => {
        seenInput = input as unknown as PlanWorkflowInput;
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
    const stageArtifacts = new Map([["intent", stageArtifact("run-intent", readyIntentRel)]]);
    const deps = { builders, ...chainedDeps(intentWorktree) };

    const result = await resolveStageWorkflowSteps(definition, 1, { cwd: operatorCwd, seed: "seed" }, stageArtifacts, deps);
    expect(result.ok).toBe(true);
    expect(seenInput?.cwd).toBe(intentWorktree);
    expect(seenInput?.readyIntent).toBe(readyIntentRel);

    setInvertPriorWorktreeRootGuardForTest(true);
    let invertedInput: PlanWorkflowInput | undefined;
    const inverted = await resolveStageWorkflowSteps(
      definition,
      1,
      { cwd: operatorCwd, seed: "seed" },
      stageArtifacts,
      {
        ...deps,
        builders: fakeBuilders({
          plan: async (input) => {
            invertedInput = input as unknown as PlanWorkflowInput;
            return { ok: true, steps: [okStep], identity: {} as never };
          },
        }),
      },
    );
    expect(inverted.ok).toBe(true);
    expect(invertedInput?.cwd).not.toBe(intentWorktree);
    expect(invertedInput?.cwd).toBe(operatorCwd);
  });

  test("implement stage resolves chained specPath from the plan entry-run worktree and resolveBaseRef uses that worktree", async () => {
    const operatorCwd = mkdtempSync(join(tmpdir(), "pipeline-resolve-operator-"));
    const planWorktree = mkdtempSync(join(tmpdir(), "pipeline-resolve-plan-wt-"));
    const planSpecRel = "spec/feature/index.md";
    mkdirSync(join(planWorktree, "spec", "feature"), { recursive: true });
    writeFileSync(join(planWorktree, planSpecRel), "# Feature\n", "utf8");
    expect(existsSync(join(operatorCwd, planSpecRel))).toBe(false);

    let seenInput: BuildImplementWorkflowStepsInput | undefined;
    const baseRefCalls: string[] = [];
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
    const stageArtifacts = new Map([["plan", stageArtifact("run-plan", planSpecRel)]]);
    const deps = {
      builders,
      resolveBaseRef: async (cwd: string) => {
        baseRefCalls.push(cwd);
        return "main";
      },
      ...chainedDeps(planWorktree),
    };

    const result = await resolveStageWorkflowSteps(definition, 1, { cwd: operatorCwd, seed: "seed" }, stageArtifacts, deps);
    expect(result.ok).toBe(true);
    expect(seenInput?.cwd).toBe(planWorktree);
    expect(seenInput?.specPath).toBe(planSpecRel);
    expect(baseRefCalls).toEqual([planWorktree]);

    setInvertPriorWorktreeRootGuardForTest(true);
    let invertedInput: BuildImplementWorkflowStepsInput | undefined;
    const inverted = await resolveStageWorkflowSteps(
      definition,
      1,
      { cwd: operatorCwd, seed: "seed" },
      stageArtifacts,
      {
        ...deps,
        builders: fakeBuilders({
          implement: async (input) => {
            invertedInput = input;
            return { ok: true, steps: [okStep] };
          },
        }),
      },
    );
    expect(inverted.ok).toBe(true);
    expect(invertedInput?.cwd).not.toBe(planWorktree);
    expect(invertedInput?.cwd).toBe(operatorCwd);
  });

  test("missing prior artifact, entryRunId, entry run, or worktreePath returns resolution failure without falling back to context.cwd", async () => {
    const builders = fakeBuilders({ plan: async () => ({ ok: true, steps: [okStep], identity: {} as never }) });
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const loadRun = loadRunAt(baseContext.cwd);

    const missingArtifact = await resolveStageWorkflowSteps(definition, 1, baseContext, new Map(), {
      builders,
      loadRun,
    });
    expect(missingArtifact.ok).toBe(false);
    if (missingArtifact.ok) return;
    expect(missingArtifact.error).toContain("preceding workflow artifact");

    const missingEntryRunId = await resolveStageWorkflowSteps(
      definition,
      1,
      baseContext,
      new Map([["intent", { entryRunId: "", specPath: "spec/ready-intents/x.md" }]]),
      { builders, loadRun },
    );
    expect(missingEntryRunId.ok).toBe(false);
    if (missingEntryRunId.ok) return;
    expect(missingEntryRunId.error).toContain("entryRunId");

    const missingEntryRun = await resolveStageWorkflowSteps(
      definition,
      1,
      baseContext,
      new Map([["intent", stageArtifact("run-missing", "spec/ready-intents/x.md")]]),
      { builders, loadRun: () => null },
    );
    expect(missingEntryRun.ok).toBe(false);
    if (missingEntryRun.ok) return;
    expect(missingEntryRun.error).toContain("not found");

    const missingWorktreePath = await resolveStageWorkflowSteps(
      definition,
      1,
      baseContext,
      new Map([["intent", stageArtifact("run-empty-wt", "spec/ready-intents/x.md")]]),
      { builders, loadRun: () => ({ worktreePath: "" }) },
    );
    expect(missingWorktreePath.ok).toBe(false);
    if (missingWorktreePath.ok) return;
    expect(missingWorktreePath.error).toContain("worktreePath");
  });
});
