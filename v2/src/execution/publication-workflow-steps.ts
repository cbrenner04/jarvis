import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getBaseBranch } from "../../../shared/git.ts";
import type { ResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { findProjectMatch, type ProjectMatch, type ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import {
  INTENT_REVIEW_DEBATE_ROLE_PROMPT_IDS,
  intentReviewPromptProfile,
} from "../../../shared/prompts/review-intent.ts";
import { planReviewPromptProfile } from "../../../shared/prompts/review-plan.ts";
import { readMachineConfigDocument } from "../config/machine-config-loader.ts";
import type { MachineProfileLoadOptions } from "../config/machine-profile-loader.ts";
import { jarvisHome } from "../paths.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import type { PublicationLanding } from "./publication-landing.ts";
import {
  type LoadedWorkflowStep,
  type ReviewDebateWorkflowSourceStep,
  type ReviewWorkflowSourceStep,
  loadWorkflowSteps as realLoadWorkflowSteps,
  type WorkflowSourceStep,
  type WriteWorkflowSourceStep,
} from "./workflow-loader.ts";
import { type AnyWorkflowStep, resolveWorkflowPreset, type WriteWorkflowStep } from "./workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";

const INTENT_STAGE = ".jarvis-intent-stage";
const PLAN_STAGE = ".jarvis-plan-stage";
const RESERVED_SLUGS = new Set(["index", "head"]);

export type IntentWorkflowInput = {
  cwd: string;
  seed?: string;
  seedText?: string;
  targetDir?: string;
  invocationId?: string;
  configPath?: string;
  jarvisRoot?: string;
  reviewPasses?: number;
  reviewBehavior?: "debate" | "light";
};
export type PlanWorkflowInput = {
  cwd: string;
  readyIntent: string;
  targetDir?: string;
  configPath?: string;
  reviewPasses?: number;
  reviewBehavior?: "debate" | "light";
};
type ProjectConfig = ProjectMatch & { git?: boolean; plan?: { commit?: boolean; targetDir?: string } };
export type IntentWorkflowIdentity = {
  invocationId: string;
  project: string;
  slug: string;
  branch: string;
  seedFingerprint: string;
};
export type PlanWorkflowIdentity = { name: string; branch: string };
export type IntentWorkflowResult =
  | { ok: true; steps: AnyWorkflowStep[]; identity: IntentWorkflowIdentity }
  | { ok: false; error: string };
export type PlanWorkflowResult =
  | { ok: true; steps: AnyWorkflowStep[]; identity: PlanWorkflowIdentity }
  | { ok: false; error: string };
export type IntentCollision = { message: string; recordedInvocationId?: string; resumable?: boolean };
type LoaderDeps = {
  loadWorkflowSteps?: (
    steps: readonly WorkflowSourceStep[],
    options?: {
      machineConfigPath?: string;
      machineProfile?: string;
      machinesDir?: MachineProfileLoadOptions["machinesDir"];
    },
  ) => LoadedWorkflowStep[];
  machineConfigPath?: string;
  machineProfile?: string;
  machinesDir?: MachineProfileLoadOptions["machinesDir"];
};
export type IntentWorkflowDeps = LoaderDeps & {
  resolveProjectMatch?: (path: string) => ProjectMatch | undefined;
  readSeed?: (path: string) => string;
  resolveBaseBranch?: (projectRoot: string) => string | Promise<string>;
  inspectIdentity?: (identity: IntentWorkflowIdentity) => IntentCollision | undefined;
  createBinding?: (binding: ResolvedAgentBinding) => InvocationBinding;
};
export type PlanWorkflowDeps = LoaderDeps & {
  resolveProjectMatch?: (path: string) => ProjectMatch | undefined;
  readReadyIntent?: (path: string) => { ok: true; name: string; content: string } | { ok: false; message: string };
  resolveBaseBranch?: (projectRoot: string) => string | Promise<string>;
};

function validTargetDir(value: string): boolean {
  return value.length > 0 && !isAbsolute(value) && !value.split(/[\\/]/u).includes("..") && value !== ".";
}
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
function projectSafeId(project: string): string {
  const safe = project.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.length > 0 ? safe : "project";
}
function projectConfig(path: string | undefined, project: ProjectMatch): ProjectConfig {
  const d = readMachineConfigDocument(path);
  const raw = d?.projects;
  const e =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>)[project.key] : undefined;
  const v = e && typeof e === "object" && !Array.isArray(e) ? (e as Record<string, unknown>) : {};
  const p = v.plan && typeof v.plan === "object" && !Array.isArray(v.plan) ? (v.plan as Record<string, unknown>) : {};
  return {
    ...project,
    ...(typeof v.git === "boolean" ? { git: v.git } : {}),
    plan: {
      ...(typeof p.commit === "boolean" ? { commit: p.commit } : {}),
      ...(typeof p.targetDir === "string" ? { targetDir: p.targetDir } : {}),
    },
  };
}
function registry(path: string | undefined): Record<string, ProjectRegistryEntry> {
  const p = readMachineConfigDocument(path)?.projects;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, ProjectRegistryEntry>) : {};
}
function loadOptions(deps: LoaderDeps) {
  return {
    ...(deps.machineConfigPath !== undefined ? { machineConfigPath: deps.machineConfigPath } : {}),
    ...(deps.machineProfile !== undefined ? { machineProfile: deps.machineProfile } : {}),
    ...(deps.machinesDir !== undefined ? { machinesDir: deps.machinesDir } : {}),
  };
}
function loadedWriteSteps(deps: LoaderDeps, source: readonly WorkflowSourceStep[]): WriteWorkflowStep[] {
  return (deps.loadWorkflowSteps ?? realLoadWorkflowSteps)(source, loadOptions(deps)).filter(
    (s): s is WriteWorkflowStep => s.behavior === "write",
  );
}

type PublicationKind = "intent" | "plan";
type PublicationDefinition = {
  promptId: string;
  stageDir: string;
  output: (source: WriteWorkflowSourceStep) => WriteWorkflowSourceStep;
  landing: "intent-stage" | "plan-tree";
};
const PUBLICATIONS: Record<PublicationKind, PublicationDefinition> = {
  intent: { promptId: "intent.prompt.split", stageDir: INTENT_STAGE, output: (s) => s, landing: "intent-stage" },
  plan: { promptId: "plan.prompt.draft", stageDir: PLAN_STAGE, output: (s) => s, landing: "plan-tree" },
};
function publish(
  kind: PublicationKind,
  deps: LoaderDeps,
  source: WriteWorkflowSourceStep,
  loaded?: LoadedWorkflowStep[],
): AnyWorkflowStep[] {
  const row = PUBLICATIONS[kind];
  const selected = row.output({ ...source, promptId: row.promptId, expectedArtifactPath: row.stageDir });
  const writes = (loaded ?? loadedWriteSteps(deps, [selected])).filter(
    (s): s is WriteWorkflowStep => s.behavior === "write",
  );
  return resolveWorkflowPreset(kind, writes);
}

type SeedDetails = { label: string; content: string; slug: string; name: string; paths: string[] };
function resolveSeed(
  input: IntentWorkflowInput,
  project: ProjectMatch,
  readSeed: (path: string) => string,
): SeedDetails | { error: string } {
  if (input.seed !== undefined) {
    if (isAbsolute(input.seed)) return { error: "intent: --seed must be a relative path" };
    const path = join(input.cwd, input.seed);
    try {
      if (!statSync(path).isFile()) return { error: `intent: seed is not a file: ${input.seed}` };
      const canonical = realpathSync(path);
      if (!inside(realpathSync(project.root), canonical))
        return { error: `intent: seed escapes registered project after symlink resolution: ${input.seed}` };
      const name = basename(canonical).replace(/\.[^.]*$/u, "");
      return {
        label: relative(realpathSync(project.root), canonical),
        content: readSeed(canonical),
        name,
        slug: slugify(name),
        paths: [canonical],
      };
    } catch (e) {
      return { error: `intent: cannot resolve seed path: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const content = input.seedText ?? "";
  const slug = slugify(content.split(/\s+/u).slice(0, 6).join(" "));
  return { label: "inline seed", content, slug, name: slug, paths: [] };
}
/**
 * Machine-config `modes.plan` block, normalized. Shared by every publication row's
 * input resolver so target-dir and commit defaults resolve identically.
 */
function machineModePlan(configPath: string | undefined): Record<string, unknown> {
  const document = readMachineConfigDocument(configPath) ?? {};
  const modes = document.modes && typeof document.modes === "object" ? (document.modes as Record<string, unknown>) : {};
  return modes.plan && typeof modes.plan === "object" ? (modes.plan as Record<string, unknown>) : {};
}

/** Target dir precedence: explicit flag, then project config, then machine `modes.plan`, then `spec`. */
function resolveTargetDir(
  explicit: string | undefined,
  config: ReturnType<typeof projectConfig>,
  modePlan: Record<string, unknown>,
  canonicalSeedTargetDir?: string,
): string {
  return (
    explicit ??
    canonicalSeedTargetDir ??
    config.plan?.targetDir ??
    (typeof modePlan.targetDir === "string" ? modePlan.targetDir : undefined) ??
    "spec"
  );
}

function canonicalTargetDir(
  project: ProjectMatch,
  path: string | undefined,
  inputDirectory: string,
): string | undefined {
  if (path === undefined || basename(dirname(path)) !== inputDirectory) return undefined;
  let projectRoot = resolve(project.root);
  let inputPath = resolve(path);
  try {
    projectRoot = realpathSync(project.root);
    inputPath = realpathSync(path);
  } catch {
    // Builder tests may provide virtual ready-intent paths through injected readers.
  }
  const targetDir = relative(projectRoot, dirname(dirname(inputPath)));
  return validTargetDir(targetDir) ? targetDir : undefined;
}

/** The intent row's input contract: exactly-one-seed, target-dir shape, project match, seed slug. */
function resolveIntentInput(
  input: IntentWorkflowInput,
  deps: IntentWorkflowDeps,
):
  | {
      project: NonNullable<ReturnType<typeof findProjectMatch>>;
      seed: Exclude<ReturnType<typeof resolveSeed>, { error: string }>;
    }
  | { error: string } {
  if ((input.seed === undefined) === (input.seedText === undefined))
    return { error: "intent: provide exactly one of --seed <path> or --seed-text <text>" };
  if (input.targetDir !== undefined && !validTargetDir(input.targetDir))
    return { error: "intent: --target-dir must be a relative non-traversing path" };
  const project = (deps.resolveProjectMatch ?? ((p) => findProjectMatch(p, registry(input.configPath))))(input.cwd);
  if (!project) return { error: `intent: no registered project matches ${input.cwd}` };
  const seed = resolveSeed(input, project, deps.readSeed ?? ((p) => readFileSync(p, "utf8")));
  if ("error" in seed) return seed;
  if (!seed.slug) return { error: "intent: seed does not produce a slug" };
  if (RESERVED_SLUGS.has(seed.slug)) return { error: `intent: reserved slug: ${seed.slug}` };
  return { project, seed };
}

function intentSource(
  input: IntentWorkflowInput,
  deps: IntentWorkflowDeps,
):
  | { source: WriteWorkflowSourceStep; identity: IntentWorkflowIdentity }
  | { error: string }
  | Promise<{ source: WriteWorkflowSourceStep; identity: IntentWorkflowIdentity } | { error: string }> {
  return (async () => {
    const resolved = resolveIntentInput(input, deps);
    if ("error" in resolved) return resolved;
    const { project, seed } = resolved;
    const config = projectConfig(input.configPath, project);
    const plan = machineModePlan(input.configPath);
    const targetDir = resolveTargetDir(
      input.targetDir,
      config,
      plan,
      canonicalTargetDir(project, seed.paths[0], "seeds"),
    );
    if (!validTargetDir(targetDir)) return { error: "intent: configured targetDir is invalid" };
    const publishGit =
      config.git !== false && (config.plan?.commit ?? (typeof plan.commit === "boolean" ? plan.commit : true));
    const root = input.jarvisRoot ?? jarvisHome();
    const branch = `intent/${seed.slug}`;
    const localPath = join(root, "intent-work", projectSafeId(project.key), seed.slug);
    const durableDir = publishGit
      ? join(targetDir, "ready-intents")
      : join(root, "specs", projectSafeId(project.key), "ready-intents");
    const identity = {
      invocationId: input.invocationId ?? crypto.randomUUID(),
      project: project.key,
      slug: seed.slug,
      branch,
      seedFingerprint: createHash("sha256").update(`${seed.label}\0${seed.content}`).digest("hex"),
    };
    const collision = deps.inspectIdentity?.(identity);
    if (collision && collision.recordedInvocationId !== identity.invocationId && !collision.resumable)
      return { error: `intent: ${collision.message}; rerun with a new seed or resume the recorded invocation` };
    const worktree = join(root, "worktrees", project.key, branch);
    const baseRef = publishGit ? await (deps.resolveBaseBranch ?? getBaseBranch)(project.root) : "none";
    const source: WriteWorkflowSourceStep = {
      behavior: "write",
      stepId: "intent",
      role: "plan",
      promptId: PUBLICATIONS.intent.promptId,
      promptPlaceholders: { WORKDIR: worktree, SEED_LABEL: seed.label, SEED_CONTENT: seed.content },
      stepRules: DEFAULT_WRITE_STEP_RULES,
      worktree: {
        projectRoot: project.root,
        projectName: project.key,
        branchName: branch,
        baseRef,
        jarvisRoot: root,
        ...(publishGit ? {} : { git: false, localPath }),
      },
      specPath: durableDir,
      expectedArtifactPath: INTENT_STAGE,
      landing: {
        kind: "intent-stage",
        output: { durableDir },
        stagingDir: INTENT_STAGE,
        invocationId: identity.invocationId,
        baseRef,
        inputs: { sourceRoot: project.root, paths: seed.paths, consumeFrom: publishGit ? "worktree" : "source" },
      } satisfies PublicationLanding,
      workflowInvocationId: identity.invocationId,
      creationTitle: `intent: ${seed.name}`,
      publishCompletion: publishGit,
    };
    return { source, identity };
  })();
}
export async function buildIntentWorkflowSteps(
  input: IntentWorkflowInput,
  deps: IntentWorkflowDeps = {},
): Promise<IntentWorkflowResult> {
  const r = await intentSource(input, deps);
  if ("error" in r) return { ok: false, error: r.error };
  const passes = input.reviewPasses ?? 0;
  if (!Number.isInteger(passes) || passes < 0)
    return { ok: false, error: "intent: reviewPasses must be a non-negative integer" };
  if (passes === 0) {
    try {
      return { ok: true, steps: publish("intent", deps, r.source), identity: r.identity };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const behavior = input.reviewBehavior ?? "debate";
  if (behavior !== "debate" && behavior !== "light")
    return { ok: false, error: 'intent: reviewBehavior must be "debate" or "light"' };
  const landing = r.source.landing;
  if (landing?.kind !== "intent-stage") return { ok: false, error: "intent: missing durable output configuration" };
  const cwd = getExternalWorktreePath(r.source.worktree);
  const verdictPath = join(cwd, intentReview);
  const profileContext = { stagingDir: resolve(cwd, landing.stagingDir), verdictPath };
  const review: ReviewWorkflowSourceStep | ReviewDebateWorkflowSourceStep =
    behavior === "light"
      ? {
          behavior: "review",
          stepId: "review",
          project: r.source.worktree.projectName,
          branch: r.source.worktree.branchName,
          cwd,
          prompt: "intent.prompt.review",
          verdictPath,
          maxCycles: passes,
          profile: intentReviewPromptProfile,
          profileContext,
          ...(deps.createBinding ? { createBinding: deps.createBinding } : {}),
          landing,
        }
      : {
          behavior: "review-debate",
          stepId: "review",
          project: r.source.worktree.projectName,
          branch: r.source.worktree.branchName,
          cwd,
          prompts: {
            ...INTENT_REVIEW_DEBATE_ROLE_PROMPT_IDS,
          },
          verdictPath,
          maxCycles: passes,
          profile: intentReviewPromptProfile,
          profileContext,
          ...(deps.createBinding ? { createBinding: deps.createBinding } : {}),
        };
  try {
    const loaded = (deps.loadWorkflowSteps ?? realLoadWorkflowSteps)([r.source, review], loadOptions(deps));
    const loadedReview = loaded.find((step) =>
      behavior === "light" ? step.behavior === "review" : step.behavior === "review-debate",
    );
    if (!loadedReview) return { ok: false, error: "intent: review step was not loaded" };
    return { ok: true, steps: [...publish("intent", deps, r.source, loaded), loadedReview], identity: r.identity };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
export async function buildPlanWorkflowSteps(
  input: PlanWorkflowInput,
  deps: PlanWorkflowDeps = {},
): Promise<PlanWorkflowResult> {
  const r = await planSource(input, deps);
  if ("error" in r) return { ok: false, error: r.error };
  const passes = input.reviewPasses ?? 0;
  if (!Number.isInteger(passes) || passes < 0)
    return { ok: false, error: "plan: reviewPasses must be a non-negative integer" };
  if (passes === 0) {
    try {
      return { ok: true, steps: publish("plan", deps, r.source), identity: r.identity };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const behavior = input.reviewBehavior ?? "debate";
  if (behavior !== "debate" && behavior !== "light")
    return { ok: false, error: 'plan: reviewBehavior must be "debate" or "light"' };
  const landing = r.source.landing;
  if (landing?.kind !== "plan-tree") return { ok: false, error: "plan: missing staged tree landing configuration" };
  const cwd = getExternalWorktreePath(r.source.worktree);
  const review: ReviewWorkflowSourceStep | ReviewDebateWorkflowSourceStep =
    behavior === "light"
      ? {
          behavior: "review",
          stepId: "plan-review",
          project: r.source.worktree.projectName,
          branch: r.source.worktree.branchName,
          cwd,
          prompt: "",
          verdictPath: join(cwd, PLAN_STAGE, "verdict-plan.md"),
          maxCycles: passes,
          profile: planReviewPromptProfile,
          profileContext: { specPath: join(cwd, PLAN_STAGE), worktreePath: cwd },
          landing,
        }
      : {
          behavior: "review-debate",
          stepId: "review-debate",
          project: r.source.worktree.projectName,
          branch: r.source.worktree.branchName,
          cwd,
          prompts: {
            adversary: "plan.prompt.review.adversary",
            advocate: "plan.prompt.review.advocate",
            adjudicator: "plan.prompt.review.adjudicator",
          },
          verdictPath: join(cwd, PLAN_STAGE, "verdict-plan.md"),
          maxCycles: passes,
          profile: planReviewPromptProfile,
          profileContext: { specPath: join(cwd, PLAN_STAGE), worktreePath: cwd },
          landing,
        };
  try {
    const loaded = (deps.loadWorkflowSteps ?? realLoadWorkflowSteps)([r.source, review], loadOptions(deps));
    const loadedReview = loaded.find((step) => step.behavior === review.behavior);
    if (!loadedReview) return { ok: false, error: `plan: ${behavior} review step was not loaded` };
    return { ok: true, steps: [...publish("plan", deps, r.source, loaded), loadedReview], identity: r.identity };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
const intentReview = ".jarvis-intent-review-verdict.md";
export async function buildReviewedIntentWorkflowSteps(
  input: IntentWorkflowInput,
  deps: IntentWorkflowDeps = {},
): Promise<IntentWorkflowResult> {
  return buildIntentWorkflowSteps(
    { ...input, reviewPasses: input.reviewPasses ?? 1, reviewBehavior: input.reviewBehavior ?? "light" },
    deps,
  );
}

function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split("\n");
  if (lines[0] !== "---") return result;
  for (const line of lines.slice(1)) {
    if (line === "---") break;
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) result[m[1]] = m[2];
  }
  return result;
}
export function validateReadyIntent(
  path: string,
): { ok: true; name: string; content: string } | { ok: false; message: string } {
  try {
    if (!statSync(path).isFile()) return { ok: false, message: `plan: ready-intent file not found: ${path}` };
    const name = basename(path).replace(/\.md$/, "");
    if (basename(dirname(path)) !== "ready-intents")
      return { ok: false, message: `plan: ready-intent must be located in <targetDir>/ready-intents/; got ${path}` };
    const content = readFileSync(path, "utf8");
    const fm = parseFrontmatter(content);
    if (!fm.name) return { ok: false, message: "plan: ready-intent frontmatter missing required `name:` field" };
    if (fm.name !== name)
      return {
        ok: false,
        message: `plan: ready-intent \`name:\` frontmatter (${JSON.stringify(fm.name)}) does not match filename (${JSON.stringify(name)})`,
      };
    if (!/^## Prerequisites\b/m.test(content))
      return { ok: false, message: "plan: ready-intent missing required `## Prerequisites` section" };
    return { ok: true, name: fm.name, content };
  } catch (e) {
    return { ok: false, message: `plan: could not read ready-intent: ${e instanceof Error ? e.message : String(e)}` };
  }
}
function planSource(
  input: PlanWorkflowInput,
  deps: PlanWorkflowDeps,
):
  | { source: WriteWorkflowSourceStep; identity: PlanWorkflowIdentity }
  | { error: string }
  | Promise<{ source: WriteWorkflowSourceStep; identity: PlanWorkflowIdentity } | { error: string }> {
  return (async () => {
    if (isAbsolute(input.readyIntent)) return { error: "plan: --ready-intent must be a relative path" };
    if (input.targetDir !== undefined && !validTargetDir(input.targetDir))
      return { error: "plan: --target-dir must be a relative non-traversing path" };
    const project = (deps.resolveProjectMatch ?? ((p) => findProjectMatch(p, registry(input.configPath))))(input.cwd);
    if (!project) return { error: `plan: no registered project matches ${input.cwd}` };
    const ready =
      deps.readReadyIntent?.(join(input.cwd, input.readyIntent)) ??
      validateReadyIntent(join(input.cwd, input.readyIntent));
    if (!ready.ok) return { error: ready.message };
    const config = projectConfig(input.configPath, project);
    const modePlan = machineModePlan(input.configPath);
    const target = resolveTargetDir(
      input.targetDir,
      config,
      modePlan,
      canonicalTargetDir(project, join(input.cwd, input.readyIntent), "ready-intents"),
    );
    if (!validTargetDir(target)) return { error: "plan: configured targetDir is invalid" };
    const git = config.git !== false && (config.plan?.commit ?? true);
    const root = jarvisHome();
    const branch = `plan/${ready.name}`;
    const cwd = join(root, "worktrees", project.key, branch);
    const timestamp = `${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
    const specDir = join(target, `${timestamp}-${ready.name}`);
    const durableSpecPath = git ? specDir : join(root, "specs", projectSafeId(project.key), "plans", ready.name);
    const source: WriteWorkflowSourceStep = {
      behavior: "write",
      stepId: "plan",
      role: "plan",
      promptId: PUBLICATIONS.plan.promptId,
      promptPlaceholders: { WORKDIR: cwd },
      stepRules: DEFAULT_WRITE_STEP_RULES,
      worktree: {
        projectRoot: project.root,
        projectName: project.key,
        branchName: branch,
        baseRef: git ? await (deps.resolveBaseBranch ?? getBaseBranch)(project.root) : "none",
        jarvisRoot: root,
        ...(git ? {} : { git: false, localPath: join(root, "specs", projectSafeId(project.key), "plans", ready.name) }),
      },
      specPath: durableSpecPath,
      expectedArtifactPath: PLAN_STAGE,
      landing: {
        kind: "plan-tree",
        stagingDir: PLAN_STAGE,
        durablePath: durableSpecPath,
        inputs: {
          sourceRoot: project.root,
          paths: [join(input.cwd, input.readyIntent)],
          consumeFrom: git ? "worktree" : "source",
        },
      } satisfies PublicationLanding,
      intentSeed: ready.content,
      workflowInvocationId: crypto.randomUUID(),
      creationTitle: `plan: ${ready.name}`,
      publishCompletion: true,
    };
    return { source, identity: { name: ready.name, branch } };
  })();
}
export async function buildReviewedPlanWorkflowSteps(
  input: PlanWorkflowInput,
  deps: PlanWorkflowDeps = {},
): Promise<PlanWorkflowResult> {
  return buildPlanWorkflowSteps(
    { ...input, reviewPasses: input.reviewPasses ?? 1, reviewBehavior: input.reviewBehavior ?? "debate" },
    deps,
  );
}
export async function buildReviewedPlanLightWorkflowSteps(
  input: PlanWorkflowInput,
  deps: PlanWorkflowDeps = {},
): Promise<PlanWorkflowResult> {
  return buildPlanWorkflowSteps(
    { ...input, reviewPasses: input.reviewPasses ?? 1, reviewBehavior: input.reviewBehavior ?? "light" },
    deps,
  );
}
