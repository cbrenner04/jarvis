import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { findProjectMatch, type ProjectRegistryEntry, type ProjectMatch } from "../../../shared/project-registry.ts";
import { getBaseBranch } from "../../../v1/src/gh.ts";
import { readMachineConfigDocument } from "../config/machine-config-loader.ts";
import { type AnyWorkflowStep, resolveWorkflowPreset } from "./workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";
import { loadWorkflowSteps as realLoadWorkflowSteps, type WorkflowSourceStep } from "./workflow-loader.ts";

const STAGE_DIR = ".jarvis-intent-stage";
const RESERVED_SLUGS = new Set(["index", "head"]);

export type IntentWorkflowInput = {
  cwd: string;
  seed?: string;
  seedText?: string;
  targetDir?: string;
  invocationId?: string;
  configPath?: string;
  jarvisRoot?: string;
};

type ProjectConfig = ProjectRegistryEntry & {
  git?: boolean;
  plan?: { commit?: boolean; targetDir?: string };
};

export type IntentWorkflowDeps = {
  resolveProjectMatch?: (path: string) => ProjectMatch | undefined;
  loadWorkflowSteps?: typeof realLoadWorkflowSteps;
  readSeed?: (path: string) => string;
  resolveBaseBranch?: (projectRoot: string) => string | Promise<string>;
  inspectIdentity?: (identity: IntentWorkflowIdentity) => IntentCollision | undefined;
};

export type IntentWorkflowIdentity = {
  invocationId: string;
  project: string;
  slug: string;
  branch: string;
};

export type IntentCollision = { message: string; resumable?: boolean };

export type IntentWorkflowResult =
  | { ok: true; steps: AnyWorkflowStep[]; identity: IntentWorkflowIdentity }
  | { ok: false; error: string };

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function validTargetDir(value: string): boolean {
  return value.length > 0 && !isAbsolute(value) && !value.split(/[\\/]/u).includes("..") && value !== ".";
}

function seedFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function projectConfig(configPath: string | undefined, project: ProjectMatch): ProjectConfig {
  const document = readMachineConfigDocument(configPath);
  const raw = document?.projects;
  const entry = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>)[project.key] : undefined;
  const value = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
  const plan = value.plan && typeof value.plan === "object" && !Array.isArray(value.plan) ? value.plan as Record<string, unknown> : {};
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
  return projects && typeof projects === "object" && !Array.isArray(projects) ? projects as Record<string, ProjectRegistryEntry> : {};
}

/** Build the unregistered one-step intent workflow; all failures are pre-daemon results. */
export async function buildIntentWorkflowSteps(
  input: IntentWorkflowInput,
  deps: IntentWorkflowDeps = {},
): Promise<IntentWorkflowResult> {
  if ((input.seed === undefined) === (input.seedText === undefined)) {
    return { ok: false, error: "intent: provide exactly one of --seed <path> or --seed-text <text>" };
  }
  if (input.targetDir !== undefined && !validTargetDir(input.targetDir)) {
    return { ok: false, error: "intent: --target-dir must be a relative non-traversing path" };
  }

  const resolveProject = deps.resolveProjectMatch ?? ((path: string) => findProjectMatch(path, projectRegistry(input.configPath)));
  const project = resolveProject(input.cwd);
  if (project === undefined) return { ok: false, error: `intent: no registered project matches ${input.cwd}` };
  const config = projectConfig(input.configPath, project);
  const global = readMachineConfigDocument(input.configPath) ?? {};
  const modes = global.modes && typeof global.modes === "object" ? global.modes as Record<string, unknown> : {};
  const plan = modes.plan && typeof modes.plan === "object" ? modes.plan as Record<string, unknown> : {};

  let seedLabel: string;
  let seedContent: string;
  let slug: string;
  if (input.seed !== undefined) {
    const seedPath = isAbsolute(input.seed) ? input.seed : join(input.cwd, input.seed);
    if (!seedFile(seedPath)) return { ok: false, error: `intent: seed is not a file: ${input.seed}` };
    let canonicalSeed: string;
    let canonicalRoot: string;
    try {
      canonicalSeed = realpathSync(seedPath);
      canonicalRoot = realpathSync(project.root);
    } catch (error) {
      return { ok: false, error: `intent: cannot resolve seed path: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!inside(canonicalRoot, canonicalSeed)) {
      return { ok: false, error: `intent: seed escapes registered project after symlink resolution: ${input.seed}` };
    }
    seedLabel = relative(canonicalRoot, canonicalSeed);
    seedContent = (deps.readSeed ?? ((path: string) => readFileSync(path, "utf8")))(canonicalSeed);
    slug = slugify(basename(canonicalSeed).replace(/\.[^.]*$/u, ""));
  } else {
    seedLabel = "inline seed";
    seedContent = input.seedText ?? "";
    slug = slugify(seedContent.split(/\s+/u).slice(0, 6).join(" "));
  }
  if (slug.length === 0) return { ok: false, error: "intent: seed does not produce a slug" };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: `intent: reserved slug: ${slug}` };

  const branch = `intent/${slug}`;
  const identity = { invocationId: input.invocationId ?? crypto.randomUUID(), project: project.key, slug, branch };
  const collision = deps.inspectIdentity?.(identity);
  if (collision !== undefined && !collision.resumable) {
    return { ok: false, error: `intent: ${collision.message}; rerun with a new seed or resume the recorded invocation` };
  }

  const targetDir = input.targetDir ?? config.plan?.targetDir ?? (typeof plan.targetDir === "string" ? plan.targetDir : undefined) ?? "spec";
  if (!validTargetDir(targetDir)) return { ok: false, error: "intent: configured targetDir is invalid" };
  const publish = config.git !== false && (config.plan?.commit ?? (typeof plan.commit === "boolean" ? plan.commit : true));
  const jarvisRoot = input.jarvisRoot ?? join(homedir(), ".jarvis");
  const worktree = join(jarvisRoot, "worktrees", project.key, branch);
  const durableDir = publish
    ? join(targetDir, "ready-intents")
    : join(jarvisRoot, "specs", project.key, "ready-intents");
  const base = publish ? await (deps.resolveBaseBranch ?? getBaseBranch)(project.root) : "none";
  const sourceStep: WorkflowSourceStep = {
    behavior: "write",
    stepId: "intent",
    role: "plan",
    promptId: "intent.prompt.split",
    promptPlaceholders: { WORKDIR: worktree, SEED_LABEL: seedLabel, SEED_CONTENT: seedContent },
    stepRules: DEFAULT_WRITE_STEP_RULES,
    worktree: { projectRoot: project.root, projectName: project.key, branchName: branch, baseRef: base },
    specPath: durableDir,
    expectedArtifactPath: STAGE_DIR,
    intentOutput: { durableDir },
  };
  try {
    const loaded = (deps.loadWorkflowSteps ?? realLoadWorkflowSteps)([sourceStep]);
    return { ok: true, steps: resolveWorkflowPreset("intent", loaded), identity };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
