import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { getBaseBranch } from "../../../shared/git.ts";
import { findProjectMatch, type ProjectMatch, type ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import { readMachineConfigDocument } from "../config/machine-config-loader.ts";
import { loadWorkflowSteps as realLoadWorkflowSteps, type WorkflowSourceStep } from "./workflow-loader.ts";
import { type AnyWorkflowStep, resolveWorkflowPreset } from "./workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";

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

type ProjectConfig = ProjectMatch & {
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
  seedFingerprint: string;
};

export type IntentCollision = {
  message: string;
  /** The invocation that owns the existing state; other invocations must fail. */
  recordedInvocationId?: string;
  /** Compatibility seam for callers that have already matched the recorded invocation. */
  resumable?: boolean;
};

export type IntentWorkflowResult =
  | { ok: true; steps: AnyWorkflowStep[]; identity: IntentWorkflowIdentity }
  | { ok: false; error: string };

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
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

type SeedDetails = { label: string; content: string; slug: string };

function resolveFileSeed(
  input: IntentWorkflowInput,
  project: ProjectMatch,
  seed: string,
  readSeed: (path: string) => string,
): SeedDetails | { error: string } {
  const seedPath = isAbsolute(seed) ? seed : join(input.cwd, seed);
  if (!seedFile(seedPath)) return { error: `intent: seed is not a file: ${seed}` };
  let canonicalSeed: string;
  let canonicalRoot: string;
  try {
    canonicalSeed = realpathSync(seedPath);
    canonicalRoot = realpathSync(project.root);
  } catch (error) {
    return { error: `intent: cannot resolve seed path: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!inside(canonicalRoot, canonicalSeed)) {
    return { error: `intent: seed escapes registered project after symlink resolution: ${seed}` };
  }
  return {
    label: relative(canonicalRoot, canonicalSeed),
    content: readSeed(canonicalSeed),
    slug: slugify(basename(canonicalSeed).replace(/\.[^.]*$/u, "")),
  };
}

function resolveSeed(
  input: IntentWorkflowInput,
  project: ProjectMatch,
  readSeed: (path: string) => string,
): SeedDetails | { error: string } {
  if (input.seed !== undefined) return resolveFileSeed(input, project, input.seed, readSeed);
  const content = input.seedText ?? "";
  return { label: "inline seed", content, slug: slugify(content.split(/\s+/u).slice(0, 6).join(" ")) };
}

function resolveOutput(
  input: IntentWorkflowInput,
  project: ProjectConfig,
  slug: string,
):
  | {
      targetDir: string;
      publish: boolean;
      worktree: string;
      localPath: string;
      durableDir: string;
    }
  | { error: string } {
  const global = readMachineConfigDocument(input.configPath) ?? {};
  const modes = global.modes && typeof global.modes === "object" ? (global.modes as Record<string, unknown>) : {};
  const plan = modes.plan && typeof modes.plan === "object" ? (modes.plan as Record<string, unknown>) : {};
  const targetDir =
    input.targetDir ??
    project.plan?.targetDir ??
    (typeof plan.targetDir === "string" ? plan.targetDir : undefined) ??
    "spec";
  if (!validTargetDir(targetDir)) return { error: "intent: configured targetDir is invalid" };
  const publish =
    project.git !== false && (project.plan?.commit ?? (typeof plan.commit === "boolean" ? plan.commit : true));
  const jarvisRoot = input.jarvisRoot ?? join(homedir(), ".jarvis");
  const branch = `intent/${slug}`;
  const worktree = join(jarvisRoot, "worktrees", project.key, branch);
  const localPath = join(jarvisRoot, "intent-work", projectSafeId(project.key), slug);
  const durableDir = publish
    ? join(targetDir, "ready-intents")
    : join(jarvisRoot, "specs", projectSafeId(project.key), "ready-intents");
  return { targetDir, publish, worktree, localPath, durableDir };
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

  const resolveProject =
    deps.resolveProjectMatch ?? ((path: string) => findProjectMatch(path, projectRegistry(input.configPath)));
  const project = resolveProject(input.cwd);
  if (project === undefined) return { ok: false, error: `intent: no registered project matches ${input.cwd}` };
  const config = projectConfig(input.configPath, project);
  const seed = resolveSeed(input, project, deps.readSeed ?? ((path: string) => readFileSync(path, "utf8")));
  if ("error" in seed) return { ok: false, error: seed.error };
  const { label: seedLabel, content: seedContent, slug } = seed;
  if (slug.length === 0) return { ok: false, error: "intent: seed does not produce a slug" };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: `intent: reserved slug: ${slug}` };

  const branch = `intent/${slug}`;
  const seedFingerprint = createHash("sha256").update(`${seedLabel}\0${seedContent}`).digest("hex");
  const identity = {
    invocationId: input.invocationId ?? crypto.randomUUID(),
    project: project.key,
    slug,
    branch,
    seedFingerprint,
  };
  const collision = deps.inspectIdentity?.(identity);
  const sameInvocation =
    collision !== undefined &&
    (collision.recordedInvocationId === identity.invocationId || collision.resumable === true);
  if (collision !== undefined && !sameInvocation) {
    return {
      ok: false,
      error: `intent: ${collision.message}; rerun with a new seed or resume the recorded invocation`,
    };
  }

  const output = resolveOutput(input, config, slug);
  if ("error" in output) return { ok: false, error: output.error };
  const { publish, worktree, localPath, durableDir } = output;
  const base = publish ? await (deps.resolveBaseBranch ?? getBaseBranch)(project.root) : "none";
  const sourceStep: WorkflowSourceStep = {
    behavior: "write",
    stepId: "intent",
    role: "plan",
    promptId: "intent.prompt.split",
    promptPlaceholders: { WORKDIR: worktree, SEED_LABEL: seedLabel, SEED_CONTENT: seedContent },
    stepRules: DEFAULT_WRITE_STEP_RULES,
    worktree: {
      projectRoot: project.root,
      projectName: project.key,
      branchName: branch,
      baseRef: base,
      ...(publish ? {} : { git: false, localPath }),
    },
    specPath: durableDir,
    expectedArtifactPath: STAGE_DIR,
    intentOutput: { durableDir },
    publishCompletion: publish,
  };
  try {
    const loaded = (deps.loadWorkflowSteps ?? realLoadWorkflowSteps)([sourceStep]);
    return { ok: true, steps: resolveWorkflowPreset("intent", loaded), identity };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
