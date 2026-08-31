import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BaseWorkflowName,
  prepareWorkflowStart,
  resolveWorkflowPresetName,
  type WorkflowStartPreparationResult,
} from "../commands/workflow-start-preparation.ts";
import { stampWorkflowStepsWithMachineConfig } from "../commands/workflow-step-config-stamp.ts";
import type { BuildImplementWorkflowStepsInput } from "../execution/implement-workflow-steps.ts";
import type { IntentWorkflowInput, PlanWorkflowInput } from "../execution/publication-workflow-steps.ts";
import {
  type CliWorkflowPresetName,
  WORKFLOW_PRESET_BUILDERS,
  type WorkflowPresetBuilderInput,
} from "../execution/workflow-presets.ts";
import type { PipelineContext } from "../persistence/state-store.ts";
import { withFixedUuid } from "../testing/fixed-uuid.ts";
import { createChainedStageProjectMatch } from "./pipeline-stage-resolve.ts";
import { preparePipelineStageWorkflow, resolvePipelinePresetBuilder } from "./pipeline-workflow-preparation.ts";

function initGitRepo(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
}

const noopStaleReset = {
  run: async () => undefined,
  deps: undefined,
  io: undefined,
  flags: { skipDirtyWorktreeGate: true, skipLandedCriteriaGate: true },
} as const;

async function prepareViaCliAdapter(
  workflow: BaseWorkflowName,
  presetName: CliWorkflowPresetName,
  builderInput: WorkflowPresetBuilderInput,
  context: PipelineContext,
): Promise<Extract<WorkflowStartPreparationResult, { ok: true }>> {
  if (context.configPath === undefined) throw new Error("expected configPath");
  const builder = resolvePipelinePresetBuilder(presetName, WORKFLOW_PRESET_BUILDERS, context);
  const result = await prepareWorkflowStart({
    workflow,
    builder,
    builderInput,
    machineConfigPath: context.configPath,
    stampSteps: stampWorkflowStepsWithMachineConfig,
    staleReset: noopStaleReset,
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

async function prepareViaPipelineAdapter(
  workflow: BaseWorkflowName,
  presetName: CliWorkflowPresetName,
  builderInput: WorkflowPresetBuilderInput,
  context: PipelineContext,
): Promise<Extract<WorkflowStartPreparationResult, { ok: true }>> {
  const result = await preparePipelineStageWorkflow(
    workflow,
    presetName,
    builderInput,
    context,
    WORKFLOW_PRESET_BUILDERS,
  );
  if (!result.ok) throw new Error(result.error);
  return result;
}

async function expectAdapterParity(
  workflow: BaseWorkflowName,
  presetName: CliWorkflowPresetName,
  builderInput: WorkflowPresetBuilderInput,
  context: PipelineContext,
  uuid: string,
): Promise<void> {
  const cli = await withFixedUuid(uuid, () => prepareViaCliAdapter(workflow, presetName, builderInput, context));
  const pipeline = await withFixedUuid(uuid, () =>
    prepareViaPipelineAdapter(workflow, presetName, builderInput, context),
  );
  expect(JSON.stringify(cli.steps)).toBe(JSON.stringify(pipeline.steps));
}

async function withIsolatedJarvisHome<T>(
  fn: (configWriter: (overrides: Record<string, unknown>) => string) => Promise<T>,
): Promise<T> {
  const previousJarvisHome = process.env.JARVIS_HOME;
  const jarvisRoot = mkdtempSync(join(tmpdir(), "prep-parity-jarvis-home-"));
  process.env.JARVIS_HOME = jarvisRoot;
  const writeConfig = (overrides: Record<string, unknown>): string => {
    const configPath = join(jarvisRoot, "config.json");
    writeFileSync(configPath, JSON.stringify({ machineProfile: "home", ...overrides }));
    return configPath;
  };
  try {
    return await fn(writeConfig);
  } finally {
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
  }
}

function createChainedHandoffRepo(): {
  repoRoot: string;
  planBranch: string;
  planWorktree: string;
  planSpecRel: string;
} {
  const repoRoot = mkdtempSync(join(tmpdir(), "prep-parity-chained-"));
  initGitRepo(repoRoot);
  writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repoRoot });

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

  return { repoRoot, planBranch, planWorktree, planSpecRel };
}

describe("pipeline workflow preparation parity", () => {
  test("CLI and pipeline adapters produce byte-identical prepared steps for representative workflow postures", async () => {
    await withIsolatedJarvisHome(async (writeConfig) => {
      const intentRoot = mkdtempSync(join(tmpdir(), "prep-parity-intent-"));
      const intentConfigPath = writeConfig({
        projects: { demo: { root: intentRoot, git: false } },
      });
      const intentContext: PipelineContext = {
        cwd: intentRoot,
        configPath: intentConfigPath,
        seed: "ship inline feature",
      };
      const intentPreset = resolveWorkflowPresetName("intent", "none");
      if (intentPreset === undefined) throw new Error("expected intent preset");
      const intentSeed = intentContext.seed ?? "ship inline feature";
      const intentBuilderInput: IntentWorkflowInput = {
        cwd: intentRoot,
        seedText: intentSeed,
        reviewPasses: 0,
        configPath: intentConfigPath,
      };
      await expectAdapterParity(
        "intent",
        intentPreset,
        intentBuilderInput,
        intentContext,
        "00000000-0000-4000-8000-000000000101",
      );

      const planRoot = mkdtempSync(join(tmpdir(), "prep-parity-plan-"));
      const readyIntentRel = "spec/ready-intents/feature.md";
      mkdirSync(join(planRoot, "spec", "ready-intents"), { recursive: true });
      writeFileSync(join(planRoot, readyIntentRel), "---\nname: feature\n---\n## Prerequisites\n", "utf8");
      const planConfigPath = writeConfig({
        projects: { demo: { root: planRoot, git: false } },
      });
      const planContext: PipelineContext = { cwd: planRoot, configPath: planConfigPath, seed: "unused" };
      const planPreset = resolveWorkflowPresetName("plan", "light");
      if (planPreset === undefined) throw new Error("expected plan preset");
      const planBuilderInput: PlanWorkflowInput = {
        cwd: planRoot,
        readyIntent: readyIntentRel,
        reviewPasses: 1,
        reviewBehavior: "light",
        configPath: planConfigPath,
      };
      await expectAdapterParity(
        "plan",
        planPreset,
        planBuilderInput,
        planContext,
        "00000000-0000-4000-8000-000000000102",
      );

      const { repoRoot, planBranch, planWorktree, planSpecRel } = createChainedHandoffRepo();
      const configPath = writeConfig({ projects: { demo: { root: repoRoot } } });
      const implementContext: PipelineContext = { cwd: repoRoot, configPath, seed: "unused" };
      const implementPreset = resolveWorkflowPresetName("implement", "debate");
      if (implementPreset === undefined) throw new Error("expected implement preset");
      const projectMatch = createChainedStageProjectMatch(implementContext)(planWorktree);
      if (projectMatch === undefined) throw new Error("expected project match");
      const implementBuilderInput: BuildImplementWorkflowStepsInput = {
        cwd: planWorktree,
        baseRef: "main",
        preflightBaseRef: planBranch,
        specPath: planSpecRel,
        configPath,
        projectRegistry: { demo: { root: repoRoot } },
        projectRoot: projectMatch.root,
        projectName: projectMatch.key,
        preflightGitRoot: planWorktree,
      };
      await expectAdapterParity(
        "implement",
        implementPreset,
        implementBuilderInput,
        implementContext,
        "00000000-0000-4000-8000-000000000103",
      );
    });
  });
});
