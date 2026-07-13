import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { getBaseBranch } from "../../../shared/git.ts";
import { findProjectMatch, type ProjectMatch, type ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import { readMachineConfigDocument } from "../config/machine-config-loader.ts";
import type { MachineProfileLoadOptions } from "../config/machine-profile-loader.ts";
import { jarvisHome } from "../paths.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import {
  type LoadedWorkflowStep,
  type ReviewDebateWorkflowSourceStep,
  type ReviewWorkflowSourceStep,
  loadWorkflowSteps as realLoadWorkflowSteps,
  type WorkflowSourceStep,
  type WriteWorkflowSourceStep,
} from "./workflow-loader.ts";
import {
  type AnyWorkflowStep,
  type ReviewDebateWorkflowStep,
  type ReviewWorkflowStep,
  resolveWorkflowPreset,
  type WriteWorkflowStep,
} from "./workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";

const STAGE_DIR = ".jarvis-plan-stage";

export type PlanWorkflowInput = {
  cwd: string;
  readyIntent: string;
  targetDir?: string;
  configPath?: string;
  reviewPasses?: number;
};

type ProjectConfig = ProjectMatch & {
  git?: boolean;
  plan?: { commit?: boolean; targetDir?: string };
};

export type PlanWorkflowIdentity = {
  name: string;
  branch: string;
};

export type PlanWorkflowResult =
  | { ok: true; steps: AnyWorkflowStep[]; identity: PlanWorkflowIdentity }
  | { ok: false; error: string };

export type PlanWorkflowDeps = {
  resolveProjectMatch?: (path: string) => ProjectMatch | undefined;
  loadWorkflowSteps?: (
    steps: readonly WorkflowSourceStep[],
    options?: {
      machineConfigPath?: string;
      machineProfile?: string;
      machinesDir?: MachineProfileLoadOptions["machinesDir"];
    },
  ) => LoadedWorkflowStep[];
  readReadyIntent?: (path: string) => { ok: true; name: string; content: string } | { ok: false; message: string };
  resolveBaseBranch?: (projectRoot: string) => string | Promise<string>;
  machineConfigPath?: string;
  machineProfile?: string;
  machinesDir?: MachineProfileLoadOptions["machinesDir"];
};

function isExistingFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function validTargetDir(value: string): boolean {
  return value.length > 0 && !isAbsolute(value) && !value.split(/[\\/]/u).includes("..") && value !== ".";
}

function projectConfig(configPath: string | undefined, project: ProjectMatch): ProjectConfig {
  const document = readMachineConfigDocument(configPath);
  const raw = document?.projects;
  const entry =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>)[project.key] : undefined;
  const value = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
  const plan =
    value.plan && typeof value.plan === "object" && !Array.isArray(value.plan)
      ? (value.plan as Record<string, unknown>)
      : {};
  return {
    ...project,
    ...(typeof value.git === "boolean" ? { git: value.git } : {}),
    plan: {
      ...(typeof plan.commit === "boolean" ? { commit: plan.commit } : {}),
      ...(typeof plan.targetDir === "string" ? { targetDir: plan.targetDir } : {}),
    },
  };
}

function projectRegistry(configPath: string | undefined): Record<string, ProjectRegistryEntry> {
  const projects = readMachineConfigDocument(configPath)?.projects;
  return projects && typeof projects === "object" && !Array.isArray(projects)
    ? (projects as Record<string, ProjectRegistryEntry>)
    : {};
}

function projectSafeId(project: string): string {
  const safe = project.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.length > 0 ? safe : "project";
}

function parseFrontmatter(content: string): Record<string, string> {
  const lines: string[] = content.split("\n");
  const result: Record<string, string> = {};

  if (lines[0] !== "---") return result;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line === "---") break;

    const match = /^(\w+):\s*(.*)$/.exec(line);
    if (match) {
      result[match[1] as string] = match[2] as string;
    }
  }

  return result;
}

function hasPrerequisitesSection(content: string): boolean {
  return /^## Prerequisites\b/m.test(content);
}

export function validateReadyIntent(readyIntentPath: string):
  | {
      ok: true;
      name: string;
      content: string;
    }
  | {
      ok: false;
      message: string;
    } {
  if (!isExistingFile(readyIntentPath)) {
    return {
      ok: false,
      message: `plan: ready-intent file not found: ${readyIntentPath}`,
    };
  }

  const filename = basename(readyIntentPath);
  const nameWithoutExt = filename.replace(/\.md$/, "");
  const dir = dirname(readyIntentPath);

  if (basename(dir) !== "ready-intents") {
    return {
      ok: false,
      message: `plan: ready-intent must be located in <targetDir>/ready-intents/; got ${readyIntentPath}`,
    };
  }

  let content: string;
  try {
    content = readFileSync(readyIntentPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      message: `plan: could not read ready-intent: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const fm = parseFrontmatter(content);
  if (!fm.name) {
    return {
      ok: false,
      message: `plan: ready-intent frontmatter missing required \`name:\` field`,
    };
  }

  if (fm.name !== nameWithoutExt) {
    return {
      ok: false,
      message: `plan: ready-intent \`name:\` frontmatter (${JSON.stringify(fm.name)}) does not match filename (${JSON.stringify(nameWithoutExt)})`,
    };
  }

  if (!hasPrerequisitesSection(content)) {
    return {
      ok: false,
      message: `plan: ready-intent missing required \`## Prerequisites\` section`,
    };
  }

  return {
    ok: true,
    name: fm.name,
    content,
  };
}

function formatPlanSpecTimestamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

function resolveTargetDir(input: PlanWorkflowInput, project: ProjectConfig): string | { error: string } {
  const global = readMachineConfigDocument(input.configPath) ?? {};
  const modes = global.modes && typeof global.modes === "object" ? (global.modes as Record<string, unknown>) : {};
  const plan = modes.plan && typeof modes.plan === "object" ? (modes.plan as Record<string, unknown>) : {};
  const targetDir =
    input.targetDir ??
    project.plan?.targetDir ??
    (typeof plan.targetDir === "string" ? plan.targetDir : undefined) ??
    "spec";
  if (!validTargetDir(targetDir)) return { error: "plan: configured targetDir is invalid" };
  return targetDir;
}

async function buildPlanWorkflowSourceStep(
  input: PlanWorkflowInput,
  deps: PlanWorkflowDeps = {},
): Promise<{ ok: true; step: WriteWorkflowSourceStep; identity: PlanWorkflowIdentity } | { ok: false; error: string }> {
  if (isAbsolute(input.readyIntent)) {
    return { ok: false, error: "plan: --ready-intent must be a relative path" };
  }
  if (input.targetDir !== undefined && !validTargetDir(input.targetDir)) {
    return { ok: false, error: "plan: --target-dir must be a relative non-traversing path" };
  }

  const resolveProject =
    deps?.resolveProjectMatch ?? ((path: string) => findProjectMatch(path, projectRegistry(input.configPath)));
  const project = resolveProject(input.cwd);
  if (project === undefined) return { ok: false, error: `plan: no registered project matches ${input.cwd}` };
  const config = projectConfig(input.configPath, project);

  const readyIntentPath = join(input.cwd, input.readyIntent);
  const readyIntentResult = deps?.readReadyIntent?.(readyIntentPath) ?? validateReadyIntent(readyIntentPath);
  if (!readyIntentResult.ok) return { ok: false, error: readyIntentResult.message };

  const { name, content: intentSeed } = readyIntentResult;
  const specTimestamp = formatPlanSpecTimestamp(new Date());
  const targetDirResult = resolveTargetDir(input, config);
  if (typeof targetDirResult === "object") return { ok: false, error: targetDirResult.error };
  const targetDir = targetDirResult;

  const publish = config.git !== false && (config.plan?.commit ?? true);
  const jarvisRoot = jarvisHome();
  const branch = `plan/${name}`;
  const worktree = join(jarvisRoot, "worktrees", project.key, branch);
  const specDir = join(targetDir, `${specTimestamp}-${name}`);
  const base = publish ? await (deps?.resolveBaseBranch ?? getBaseBranch)(project.root) : "none";

  const sourceStep: WriteWorkflowSourceStep = {
    behavior: "write",
    stepId: "plan",
    role: "plan",
    promptId: "plan.prompt.draft",
    promptPlaceholders: { WORKDIR: worktree },
    stepRules: DEFAULT_WRITE_STEP_RULES,
    worktree: {
      projectRoot: project.root,
      projectName: project.key,
      branchName: branch,
      baseRef: base,
      ...(publish
        ? {}
        : { git: false, localPath: join(jarvisRoot, "specs", projectSafeId(project.key), "plans", name) }),
    },
    specPath: specDir,
    expectedArtifactPath: STAGE_DIR,
    intentSeed,
    workflowInvocationId: crypto.randomUUID(),
    publishCompletion: true,
  };

  return { ok: true, step: sourceStep, identity: { name, branch } };
}

function workflowLoadOptions(deps: PlanWorkflowDeps) {
  return {
    ...(deps.machineConfigPath !== undefined ? { machineConfigPath: deps.machineConfigPath } : {}),
    ...(deps.machineProfile !== undefined ? { machineProfile: deps.machineProfile } : {}),
    ...(deps.machinesDir !== undefined ? { machinesDir: deps.machinesDir } : {}),
  };
}

export async function buildPlanWorkflowSteps(
  input: PlanWorkflowInput,
  deps: PlanWorkflowDeps = {},
): Promise<PlanWorkflowResult> {
  const source = await buildPlanWorkflowSourceStep(input, deps);
  if (!source.ok) return source;
  try {
    const loaded = (deps.loadWorkflowSteps ?? realLoadWorkflowSteps)([source.step], workflowLoadOptions(deps));
    const writeSteps = loaded.filter((step): step is WriteWorkflowStep => step.behavior === "write");
    return { ok: true, steps: resolveWorkflowPreset("plan", writeSteps), identity: source.identity };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function resolvePlanReviewPasses(reviewPasses: number | undefined): number | { error: string } {
  const passes = reviewPasses ?? 1;
  if (!Number.isInteger(passes) || passes < 0) {
    return { error: "plan: --review-passes must be a non-negative integer" };
  }
  return passes;
}

function resolvePlanReviewCwd(sourceStep: WriteWorkflowSourceStep): string {
  return getExternalWorktreePath(sourceStep.worktree);
}

export async function buildReviewedPlanWorkflowSteps(
  input: PlanWorkflowInput,
  deps: PlanWorkflowDeps = {},
): Promise<PlanWorkflowResult> {
  const reviewPasses = resolvePlanReviewPasses(input.reviewPasses);
  if (typeof reviewPasses === "object") return { ok: false, error: reviewPasses.error };
  if (reviewPasses === 0) return buildPlanWorkflowSteps(input, deps);

  const source = await buildPlanWorkflowSourceStep(input, deps);
  if (!source.ok) return source;
  const cwd = resolvePlanReviewCwd(source.step);
  const reviewStep: ReviewDebateWorkflowSourceStep = {
    behavior: "review-debate",
    stepId: "review-debate",
    project: source.step.worktree.projectName,
    branch: source.step.worktree.branchName,
    cwd,
    prompts: {
      adversary: "plan.prompt.review.adversary",
      advocate: "plan.prompt.review.advocate",
      adjudicator: "plan.prompt.review.adjudicator",
    },
    verdictPath: join(cwd, source.step.specPath, "verdict-plan.md"),
    maxCycles: reviewPasses,
  };
  try {
    const loaded = (deps.loadWorkflowSteps ?? realLoadWorkflowSteps)(
      [source.step, reviewStep],
      workflowLoadOptions(deps),
    );
    const writeSteps = loaded.filter((step): step is WriteWorkflowStep => step.behavior === "write");
    const debateStep = loaded.find((step): step is ReviewDebateWorkflowStep => step.behavior === "review-debate");
    if (debateStep === undefined) return { ok: false, error: "plan: review-debate step was not loaded" };
    return {
      ok: true,
      steps: [...resolveWorkflowPreset("plan-reviewed", writeSteps), debateStep],
      identity: source.identity,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function buildReviewedPlanLightWorkflowSteps(
  input: PlanWorkflowInput,
  deps: PlanWorkflowDeps = {},
): Promise<PlanWorkflowResult> {
  const reviewPasses = resolvePlanReviewPasses(input.reviewPasses);
  if (typeof reviewPasses === "object") return { ok: false, error: reviewPasses.error };
  if (reviewPasses === 0) return buildPlanWorkflowSteps(input, deps);

  const source = await buildPlanWorkflowSourceStep(input, deps);
  if (!source.ok) return source;
  const cwd = resolvePlanReviewCwd(source.step);
  const reviewStep: ReviewWorkflowSourceStep = {
    behavior: "review",
    stepId: "plan-review",
    project: source.step.worktree.projectName,
    branch: source.step.worktree.branchName,
    cwd,
    prompt: "",
    verdictPath: join(cwd, source.step.specPath, "verdict-plan.md"),
    maxCycles: reviewPasses,
    planReviewContext: {
      specPath: join(cwd, source.step.specPath),
    },
  };
  try {
    const loaded = (deps.loadWorkflowSteps ?? realLoadWorkflowSteps)(
      [source.step, reviewStep],
      workflowLoadOptions(deps),
    );
    const writeSteps = loaded.filter((step): step is WriteWorkflowStep => step.behavior === "write");
    const reviewStepLoaded = loaded.find((step): step is ReviewWorkflowStep => step.behavior === "review");
    if (reviewStepLoaded === undefined) return { ok: false, error: "plan: review step was not loaded" };
    return {
      ok: true,
      steps: [...resolveWorkflowPreset("plan-reviewed-light", writeSteps), reviewStepLoaded],
      identity: source.identity,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
