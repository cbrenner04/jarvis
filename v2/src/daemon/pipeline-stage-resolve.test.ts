import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildImplementWorkflowStepsInput } from "../execution/implement-workflow-steps.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { landPublication } from "../execution/publication-landing.ts";
import {
  buildIntentWorkflowSteps,
  type IntentWorkflowInput,
  type PlanWorkflowInput,
} from "../execution/publication-workflow-steps.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import { publishCompletionArtifacts } from "../execution/write-loop.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import type { PipelineStageArtifact } from "./pipeline-stage-dispatch.ts";
import {
  type PipelineContext,
  type PipelineStageResolveDeps,
  resolveStageWorkflowSteps,
  singleStageResolutionSteps,
} from "./pipeline-stage-resolve.ts";

const QUEUE_WIDGET_SEED_REL = "v2/spec/seeds/queue-widget-refactor.md";
const QUEUE_WIDGET_SEED_CONTENT = `---
name: queue-widget-refactor
---

# Operator notes only
`;

type IntentWriteStep = Extract<AnyWorkflowStep, { behavior: "write" }>;

function intentWriteStep(steps: AnyWorkflowStep[]): IntentWriteStep {
  const step = steps.find((candidate) => candidate.behavior === "write");
  if (step?.behavior !== "write") throw new Error("expected write step");
  return step;
}

function intentSeedIdentity(step: IntentWriteStep): { slug: string; name: string; label: string; paths: string[] } {
  const branchName = step.worktree?.branchName ?? "";
  const slug = branchName.startsWith("intent/") ? branchName.slice("intent/".length) : branchName;
  const name = step.creationTitle?.startsWith("intent: ") ? step.creationTitle.slice("intent: ".length) : "";
  const label = step.promptPlaceholders?.SEED_LABEL ?? "";
  const paths = step.landing?.kind === "intent-stage" ? (step.landing.inputs?.paths ?? []) : [];
  return { slug, name, label, paths };
}

const intentOnlyDefinition: PipelineDefinition = {
  name: "p",
  stages: [{ stageId: "intent", kind: "workflow", workflow: "intent", review: "none" }],
};

function createSeedPathRepo(): { repoRoot: string; configPath: string; intentWorktree: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "pipeline-seed-path-repo-"));
  initGitRepo(repoRoot);
  writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
  mkdirSync(join(repoRoot, "v2", "spec", "seeds"), { recursive: true });
  writeFileSync(join(repoRoot, QUEUE_WIDGET_SEED_REL), QUEUE_WIDGET_SEED_CONTENT, "utf8");
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repoRoot });

  const intentBranch = "intent/queue-widget-refactor";
  const intentWorktree = join(repoRoot, ".jarvis-worktrees", intentBranch);
  mkdirSync(intentWorktree, { recursive: true });
  execFileSync("git", ["branch", intentBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", intentWorktree, intentBranch], { cwd: repoRoot });

  const configPath = writeHomeMachineConfig({ projects: { demo: { root: repoRoot } } });
  return { repoRoot, configPath, intentWorktree };
}

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

function stageArtifact(entryRunId: string, specPath: string, downstreamInputs?: string[]): PipelineStageArtifact {
  return downstreamInputs !== undefined ? { entryRunId, specPath, downstreamInputs } : { entryRunId, specPath };
}

function initGitRepo(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
}

function loadRunAt(worktreePath: string, branch = "main"): NonNullable<PipelineStageResolveDeps["loadRun"]> {
  return () => ({ worktreePath, branch });
}

function chainedDeps(
  worktreePath: string,
  branch = "main",
  overrides: Partial<PipelineStageResolveDeps> = {},
): PipelineStageResolveDeps {
  return { loadRun: loadRunAt(worktreePath, branch), ...overrides };
}

function createChainedHandoffRepo(): {
  repoRoot: string;
  configPath: string;
  intentBranch: string;
  intentWorktree: string;
  planBranch: string;
  planWorktree: string;
  readyIntentRel: string;
  planSpecRel: string;
} {
  const repoRoot = mkdtempSync(join(tmpdir(), "pipeline-chained-repo-"));
  initGitRepo(repoRoot);
  writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repoRoot });

  const intentBranch = "intent/feature";
  const readyIntentRel = "spec/ready-intents/feature.md";
  const intentWorktree = join(repoRoot, ".jarvis-worktrees", intentBranch);
  mkdirSync(intentWorktree, { recursive: true });
  execFileSync("git", ["branch", intentBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", intentWorktree, intentBranch], { cwd: repoRoot });
  mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
  writeFileSync(join(intentWorktree, readyIntentRel), "---\nname: feature\n---\n## Prerequisites\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: intentWorktree });
  execFileSync("git", ["commit", "-qm", "intent"], { cwd: intentWorktree });

  const planBranch = "plan/feature";
  const planSpecRel = "spec/feature/index.md";
  const planWorktree = join(repoRoot, ".jarvis-worktrees", planBranch);
  mkdirSync(planWorktree, { recursive: true });
  execFileSync("git", ["branch", planBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", planWorktree, planBranch], { cwd: repoRoot });
  mkdirSync(join(planWorktree, "spec", "feature"), { recursive: true });
  writeFileSync(join(planWorktree, planSpecRel), "# Feature\n\n- [ ] [Work](./00-work.md)\n", "utf8");
  writeFileSync(
    join(planWorktree, "spec/feature/00-work.md"),
    "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n",
    "utf8",
  );
  execFileSync("git", ["add", "-A"], { cwd: planWorktree });
  execFileSync("git", ["commit", "-qm", "plan"], { cwd: planWorktree });

  const configPath = writeHomeMachineConfig({ projects: { demo: { root: repoRoot } } });
  return { repoRoot, configPath, intentBranch, intentWorktree, planBranch, planWorktree, readyIntentRel, planSpecRel };
}

async function resolveFirstIntentStageWithRealBuilders(review: "none" | "debate", seed = "ship feature") {
  const cwd = mkdtempSync(join(tmpdir(), "pipeline-resolve-intent-"));
  const configPath = writeHomeMachineConfig({ projects: { demo: { root: cwd } } });
  const definition: PipelineDefinition = {
    name: "p",
    stages: [{ stageId: "intent", kind: "workflow", workflow: "intent", review }],
  };
  return resolveStageWorkflowSteps(definition, 0, { cwd, configPath, seed }, new Map(), {
    builders: WORKFLOW_PRESET_BUILDERS,
  });
}

async function resolveQueueWidgetIntent(repoRoot: string, configPath: string): Promise<IntentWriteStep> {
  const result = await resolveStageWorkflowSteps(
    intentOnlyDefinition,
    0,
    { cwd: repoRoot, configPath, seedPath: QUEUE_WIDGET_SEED_REL },
    new Map(),
    { builders: WORKFLOW_PRESET_BUILDERS },
  );
  if (!result.ok) throw new Error("expected queue-widget intent resolution");
  return intentWriteStep(singleStageResolutionSteps(result));
}

describe("resolveStageWorkflowSteps", () => {
  test("first workflow stage builds with inline PipelineContext.seed as seedText only", async () => {
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
    const inlineContext: PipelineContext = { cwd: "/repo", seed: "ship inline feature" };

    const result = await resolveStageWorkflowSteps(definition, 0, inlineContext, new Map(), { builders });

    expect(result.ok).toBe(true);
    expect(seenInput?.seedText).toBe(inlineContext.seed);
    expect(seenInput?.seed).toBeUndefined();
    // Mutation checkpoint: in `resolveIntentStage`, setting `seedPath` on the text branch turns the test RED.

    const realResult = await resolveFirstIntentStageWithRealBuilders("none", "ship inline feature");
    expect(realResult.ok).toBe(true);
    if (!realResult.ok) return;
    const identity = intentSeedIdentity(intentWriteStep(singleStageResolutionSteps(realResult)));
    expect(identity).toMatchObject({
      slug: "ship-inline-feature",
      name: "ship-inline-feature",
      label: "inline seed",
      paths: [],
    });
  });

  test("first workflow stage routes seedPath through file seed with standalone intent parity", async () => {
    const { repoRoot, configPath } = createSeedPathRepo();
    const pipelineIdentity = intentSeedIdentity(await resolveQueueWidgetIntent(repoRoot, configPath));

    const standalone = await buildIntentWorkflowSteps(
      { cwd: repoRoot, seed: QUEUE_WIDGET_SEED_REL, configPath, reviewPasses: 0 },
      { resolveProjectMatch: () => ({ key: "demo", root: repoRoot }) },
    );
    expect(standalone.ok).toBe(true);
    if (!standalone.ok) return;
    const standaloneIdentity = intentSeedIdentity(intentWriteStep(standalone.steps));

    const expected = {
      slug: "queue-widget-refactor",
      name: "queue-widget-refactor",
      label: QUEUE_WIDGET_SEED_REL,
    };
    expect(pipelineIdentity).toMatchObject(expected);
    expect(standaloneIdentity).toMatchObject(expected);
    expect(pipelineIdentity.paths.length).toBeGreaterThan(0);
    expect(standaloneIdentity.paths).toEqual(pipelineIdentity.paths);
    // Mutation checkpoint: in `resolveIntentStage`, routing `context.seedPath` through `{ seedText: context.seedPath }` breaks slug/name/label/`paths` parity with standalone `--seed` (path-string slugification) and turns the test RED.
  });

  test("pipeline file-seed landing consumes the seed from the intent worktree", async () => {
    const { repoRoot, configPath, intentWorktree } = createSeedPathRepo();
    const seedOnWorktree = join(intentWorktree, QUEUE_WIDGET_SEED_REL);
    expect(existsSync(seedOnWorktree)).toBe(true);

    const writeStep = await resolveQueueWidgetIntent(repoRoot, configPath);
    expect(intentSeedIdentity(writeStep).paths.length).toBeGreaterThan(0);
    if (writeStep.landing?.kind !== "intent-stage") throw new Error("expected intent-stage landing");
    // Mutation checkpoint: clearing `IntentWorkflowInput.seed` or `landing.inputs.paths` in `resolveIntentStage` / `intentSource` leaves the seed on the worktree and turns the test RED.

    mkdirSync(join(intentWorktree, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(
      join(intentWorktree, ".jarvis-intent-stage", "queue-widget-refactor.md"),
      "---\nname: queue-widget-refactor\n---\n\n## Prerequisites\n",
      "utf8",
    );

    await landPublication(writeStep.landing, intentWorktree);

    expect(existsSync(seedOnWorktree)).toBe(false);
    expect(existsSync(join(repoRoot, QUEUE_WIDGET_SEED_REL))).toBe(true);
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
    const planBranch = "plan/feature";
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
      ...chainedDeps(baseContext.cwd, planBranch),
    });

    expect(result.ok).toBe(true);
    expect(seenInput?.reviewBehavior).toBe("light");
    expect(seenInput?.specPath).toBe("spec/index.md");
    expect(seenInput?.baseRef).toBe(planBranch);
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
    expect(singleStageResolutionSteps(result).some((step) => step.behavior === "review-debate")).toBe(true);
  });

  test("intent review none resolves through real preset builders without a review step", async () => {
    const result = await resolveFirstIntentStageWithRealBuilders("none");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      singleStageResolutionSteps(result).some(
        (step) => step.behavior === "review" || step.behavior === "review-debate",
      ),
    ).toBe(false);
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
    expect(
      singleStageResolutionSteps(result).some(
        (step) => step.behavior === "review" || step.behavior === "review-debate",
      ),
    ).toBe(false);
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
      ...chainedDeps(baseContext.cwd, "plan/feature"),
    };
    const stageArtifacts = new Map([["plan", stageArtifact("run-plan", "spec/index.md")]]);

    const leaveDraft = await resolveStageWorkflowSteps(
      leaveDraftDefinition,
      1,
      baseContext,
      stageArtifacts,
      resolveDeps,
    );
    expect(leaveDraft.ok).toBe(true);
    if (!leaveDraft.ok) return;
    const leaveDraftStep = singleStageResolutionSteps(leaveDraft).find(
      (step): step is Extract<ReturnType<typeof singleStageResolutionSteps>[number], { behavior: "write" }> =>
        step.behavior === "write" && step.publishCompletion !== false,
    );
    if (!leaveDraftStep) throw new Error("expected publish write step");
    expect(leaveDraftStep.skipReadyFinalization).toBe(true);

    const readyDefinition: PipelineDefinition = { ...leaveDraftDefinition, terminalAction: "ready" };
    const ready = await resolveStageWorkflowSteps(readyDefinition, 1, baseContext, stageArtifacts, resolveDeps);
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    const readyStep = singleStageResolutionSteps(ready).find(
      (step): step is Extract<ReturnType<typeof singleStageResolutionSteps>[number], { behavior: "write" }> =>
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

    const result = await resolveStageWorkflowSteps(
      definition,
      1,
      { cwd: operatorCwd, seed: "seed" },
      stageArtifacts,
      deps,
    );
    expect(result.ok).toBe(true);
    // In `selectChainedStageCwd`, `return priorWorktreePath` → `return contextCwd` turns this test RED.
    expect(seenInput?.cwd).toBe(intentWorktree);
    expect(seenInput?.readyIntent).toBe(readyIntentRel);
  });

  test("implement stage resolves chained specPath from the plan entry-run worktree with prior branch as baseRef", async () => {
    const operatorCwd = mkdtempSync(join(tmpdir(), "pipeline-resolve-operator-"));
    const planBranch = "plan/feature";
    const planWorktree = mkdtempSync(join(tmpdir(), "pipeline-resolve-plan-wt-"));
    const planSpecRel = "spec/feature/index.md";
    mkdirSync(join(planWorktree, "spec", "feature"), { recursive: true });
    writeFileSync(join(planWorktree, planSpecRel), "# Feature\n", "utf8");
    expect(existsSync(join(operatorCwd, planSpecRel))).toBe(false);

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
    const stageArtifacts = new Map([["plan", stageArtifact("run-plan", planSpecRel)]]);
    const deps = { builders, ...chainedDeps(planWorktree, planBranch) };

    const result = await resolveStageWorkflowSteps(
      definition,
      1,
      { cwd: operatorCwd, seed: "seed" },
      stageArtifacts,
      deps,
    );
    expect(result.ok).toBe(true);
    // In `selectChainedStageCwd`, `return priorWorktreePath` → `return contextCwd` turns this test RED.
    expect(seenInput?.cwd).toBe(planWorktree);
    expect(seenInput?.specPath).toBe(planSpecRel);
    expect(seenInput?.baseRef).toBe(planBranch);
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
      { builders, loadRun: () => ({ worktreePath: "", branch: "main" }) },
    );
    expect(missingWorktreePath.ok).toBe(false);
    if (missingWorktreePath.ok) return;
    expect(missingWorktreePath.error).toContain("worktreePath");
  });

  test("plan stage resolves through real preset builders when ready-intent exists only on intent worktree", async () => {
    const { repoRoot, configPath, intentBranch, intentWorktree, readyIntentRel } = createChainedHandoffRepo();
    expect(existsSync(join(repoRoot, readyIntentRel))).toBe(false);

    const context: PipelineContext = { cwd: repoRoot, configPath, seed: "unused" };
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const stageArtifacts = new Map([["intent", stageArtifact("run-intent", readyIntentRel)]]);
    const deps = { builders: WORKFLOW_PRESET_BUILDERS, ...chainedDeps(intentWorktree, intentBranch) };

    const result = await resolveStageWorkflowSteps(definition, 1, context, stageArtifacts, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // In `selectChainedStageCwd`, `return priorWorktreePath` → `return contextCwd` turns this test RED.
    expect(singleStageResolutionSteps(result).some((step) => step.behavior === "write")).toBe(true);
  });

  test("implement stage resolves through real preset builders when plan spec exists only on plan worktree branch", async () => {
    const { repoRoot, configPath, planBranch, planWorktree, planSpecRel } = createChainedHandoffRepo();
    expect(existsSync(join(repoRoot, planSpecRel))).toBe(false);
    try {
      execFileSync("git", ["cat-file", "-e", `main:${planSpecRel}`], { cwd: repoRoot, stdio: "ignore" });
      throw new Error("plan spec should be absent from main");
    } catch (error) {
      expect(error).toBeDefined();
    }

    const context: PipelineContext = { cwd: repoRoot, configPath, seed: "unused" };
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const stageArtifacts = new Map([["plan", stageArtifact("run-plan", planSpecRel)]]);
    const deps = { builders: WORKFLOW_PRESET_BUILDERS, ...chainedDeps(planWorktree, planBranch) };

    const result = await resolveStageWorkflowSteps(definition, 1, context, stageArtifacts, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // In `selectChainedStageCwd`, `return priorWorktreePath` → `return contextCwd` turns this test RED.
    expect(singleStageResolutionSteps(result).some((step) => step.behavior === "write")).toBe(true);
  });

  test("splitting intent artifact with N=2 downstreamInputs resolves plan into two distinct ready-intent bindings", async () => {
    const intentWorktree = mkdtempSync(join(tmpdir(), "pipeline-resolve-fan-out-"));
    const readyA = "spec/ready-intents/alpha.md";
    const readyB = "spec/ready-intents/beta.md";
    const directorySpecPath = "spec/ready-intents";
    mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(intentWorktree, readyA), "---\nname: alpha\n---\n", "utf8");
    writeFileSync(join(intentWorktree, readyB), "---\nname: beta\n---\n", "utf8");

    const seenReadyIntents: string[] = [];
    const builders = fakeBuilders({
      plan: async (input) => {
        seenReadyIntents.push((input as unknown as PlanWorkflowInput).readyIntent);
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
    const stageArtifacts = new Map([["intent", stageArtifact("run-intent", directorySpecPath, [readyA, readyB])]]);
    const deps = { builders, ...chainedDeps(intentWorktree) };

    const result = await resolveStageWorkflowSteps(definition, 1, baseContext, stageArtifacts, deps);
    expect(result.ok).toBe(true);
    if (!result.ok || !("results" in result)) throw new Error("expected fan-out results");
    expect(result.results).toHaveLength(2);
    expect(seenReadyIntents).toEqual([readyA, readyB]);
  });

  test("single-file prior artifact without downstreamInputs still resolves one plan preset binding", async () => {
    const readyIntentRel = "spec/ready-intents/feature.md";
    const intentWorktree = mkdtempSync(join(tmpdir(), "pipeline-resolve-single-file-"));
    mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(intentWorktree, readyIntentRel), "---\nname: feature\n---\n", "utf8");

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

    const result = await resolveStageWorkflowSteps(definition, 1, baseContext, stageArtifacts, deps);
    expect(result.ok).toBe(true);
    if (!result.ok || "results" in result) throw new Error("expected single resolution");
    expect(seenInput?.readyIntent).toBe(readyIntentRel);
  });

  test("per-branch plan artifact resolving implement returns one resolution without re-fan-out", async () => {
    const planBranch = "plan/feature";
    const planWorktree = mkdtempSync(join(tmpdir(), "pipeline-resolve-plan-branch-"));
    const planSpecRel = "spec/feature/index.md";
    const ignoredA = "spec/ready-intents/ignored-a.md";
    const ignoredB = "spec/ready-intents/ignored-b.md";
    mkdirSync(join(planWorktree, "spec", "feature"), { recursive: true });
    mkdirSync(join(planWorktree, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(planWorktree, planSpecRel), "# Feature\n", "utf8");
    writeFileSync(join(planWorktree, ignoredA), "---\nname: ignored-a\n---\n", "utf8");
    writeFileSync(join(planWorktree, ignoredB), "---\nname: ignored-b\n---\n", "utf8");

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
    const stageArtifacts = new Map([["plan", stageArtifact("run-plan", planSpecRel, [ignoredA, ignoredB])]]);
    const deps = { builders, ...chainedDeps(planWorktree, planBranch) };

    const result = await resolveStageWorkflowSteps(definition, 1, baseContext, stageArtifacts, deps);
    expect(result.ok).toBe(true);
    if (!result.ok || "results" in result) throw new Error("expected single resolution");
    expect(seenInput?.specPath).toBe(planSpecRel);
  });

  test("downstreamInputs length 1 resolves one binding to that path", async () => {
    const intentWorktree = mkdtempSync(join(tmpdir(), "pipeline-resolve-length-one-"));
    const readyRel = "spec/ready-intents/only.md";
    const directorySpecPath = "spec/ready-intents";
    mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(intentWorktree, readyRel), "---\nname: only\n---\n", "utf8");

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
    const stageArtifacts = new Map([["intent", stageArtifact("run-intent", directorySpecPath, [readyRel])]]);
    const deps = { builders, ...chainedDeps(intentWorktree) };

    const result = await resolveStageWorkflowSteps(definition, 1, baseContext, stageArtifacts, deps);
    expect(result.ok).toBe(true);
    if (!result.ok || "results" in result) throw new Error("expected single resolution");
    expect(seenInput?.readyIntent).toBe(readyRel);
  });

  test("missing downstreamInputs path fails without falling back to directory specPath", async () => {
    const intentWorktree = mkdtempSync(join(tmpdir(), "pipeline-resolve-missing-downstream-"));
    const readyA = "spec/ready-intents/alpha.md";
    const readyB = "spec/ready-intents/missing.md";
    const directorySpecPath = "spec/ready-intents";
    mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(intentWorktree, readyA), "---\nname: alpha\n---\n", "utf8");

    const builders = fakeBuilders({
      plan: async () => ({ ok: true, steps: [okStep], identity: {} as never }),
    });
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const stageArtifacts = new Map([["intent", stageArtifact("run-intent", directorySpecPath, [readyA, readyB])]]);
    const deps = { builders, ...chainedDeps(intentWorktree) };

    const result = await resolveStageWorkflowSteps(definition, 1, baseContext, stageArtifacts, deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not found");
  });
});
