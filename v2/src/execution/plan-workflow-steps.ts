import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { readMachineConfigDocument } from "../config/machine-config-loader.ts";
import { findProjectMatch, type ProjectMatch, type ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import { loadWorkflowSteps as realLoadWorkflowSteps, type WorkflowSourceStep } from "./workflow-loader.ts";
import { resolveWorkflowPreset, type WorkflowStep } from "./workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./write-loop-input.ts";

export type PlanWorkflowInput = {
  cwd: string;
  readyIntent: string;
  targetDir?: string;
  configPath?: string;
  jarvisRoot?: string;
};

export type PlanWorkflowResult =
  | { ok: true; steps: WorkflowStep[]; identity: PlanWorkflowIdentity }
  | { ok: false; error: string };

export type PlanWorkflowIdentity = {
  project: string;
  name: string;
  branch: string;
  specDir: string;
};

function parseIntentFrontmatter(text: string): { name?: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if ((lines[0] ?? "") !== "---") {
    return {};
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "") === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return {};
  }
  for (let i = 1; i < end; i += 1) {
    const line = lines[i] ?? "";
    const match = /^name:\s*(.+)\s*$/.exec(line);
    if (match?.[1]) {
      return { name: match[1] };
    }
  }
  return {};
}

function hasPrerequisitesSection(text: string): boolean {
  const normalized = text.replace(/\r\n/g, "\n");
  return /^## Prerequisites\s*$/m.test(normalized);
}

function formatPlanSpecTimestamp(date: Date = new Date()): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
}

function validTargetDir(value: string): boolean {
  return value.length > 0 && !isAbsolute(value) && !value.split(/[\\/]/u).includes("..") && value !== ".";
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

function readyIntentFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Build the unregistered one-step plan workflow; all failures are pre-daemon results. */
export async function buildPlanWorkflowSteps(
  input: PlanWorkflowInput,
): Promise<PlanWorkflowResult> {
  if (!input.readyIntent) {
    return { ok: false, error: "plan: --ready-intent is required" };
  }

  if (input.targetDir !== undefined && !validTargetDir(input.targetDir)) {
    return { ok: false, error: "plan: --target-dir must be a relative non-traversing path" };
  }

  // Resolve project
  const resolveProject = (path: string) => findProjectMatch(path, projectRegistry(input.configPath));
  const project = resolveProject(input.cwd);
  if (project === undefined) {
    return { ok: false, error: `plan: no registered project matches ${input.cwd}` };
  }

  // Validate ready-intent file exists
  const readyIntentPath = isAbsolute(input.readyIntent) ? input.readyIntent : join(input.cwd, input.readyIntent);
  if (!readyIntentFile(readyIntentPath)) {
    return { ok: false, error: `plan: ready-intent file not found: ${input.readyIntent}` };
  }

  // Validate the file lives in a `ready-intents/` directory
  const filename = basename(readyIntentPath);
  const nameWithoutExt = filename.replace(/\.md$/, "");
  const dir = dirname(readyIntentPath);

  if (basename(dir) !== "ready-intents") {
    return {
      ok: false,
      error: `plan: ready-intent must be located in <targetDir>/ready-intents/; got ${input.readyIntent}`,
    };
  }

  // Read and validate content
  let content: string;
  try {
    content = readFileSync(readyIntentPath, "utf8");
  } catch (err) {
    return { ok: false, error: `plan: could not read ready-intent: ${(err as Error).message}` };
  }

  // Validate frontmatter
  const fm = parseIntentFrontmatter(content);
  if (!fm.name) {
    return { ok: false, error: `plan: ready-intent frontmatter missing required \`name:\` field` };
  }

  if (fm.name !== nameWithoutExt) {
    return {
      ok: false,
      error: `plan: ready-intent \`name:\` frontmatter (${JSON.stringify(fm.name)}) does not match filename (${JSON.stringify(nameWithoutExt)})`,
    };
  }

  // Validate Prerequisites section
  if (!hasPrerequisitesSection(content)) {
    return { ok: false, error: `plan: ready-intent missing required \`## Prerequisites\` section` };
  }

  // Resolve target directory with precedence
  const global = readMachineConfigDocument(input.configPath) ?? {};
  const modes = global.modes && typeof global.modes === "object" ? (global.modes as Record<string, unknown>) : {};
  const plan = modes.plan && typeof modes.plan === "object" ? (modes.plan as Record<string, unknown>) : {};

  // Load project config for plan.targetDir
  const document = readMachineConfigDocument(input.configPath);
  const raw = document?.projects;
  const entry =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>)[project.key] : undefined;
  const value = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
  const projectPlan =
    value.plan && typeof value.plan === "object" && !Array.isArray(value.plan)
      ? (value.plan as Record<string, unknown>)
      : {};

  const targetDir =
    input.targetDir ??
    (typeof projectPlan.targetDir === "string" ? projectPlan.targetDir : undefined) ??
    (typeof plan.targetDir === "string" ? plan.targetDir : undefined) ??
    "spec";

  if (!validTargetDir(targetDir)) {
    return { ok: false, error: "plan: configured targetDir is invalid" };
  }

  // Generate spec timestamp and directories
  const specTimestamp = formatPlanSpecTimestamp();
  const specDirBasename = `${specTimestamp}-${fm.name}`;
  const specDir = join(targetDir, specDirBasename);
  const branch = `plan/${fm.name}`;

  // Build identity
  const identity: PlanWorkflowIdentity = {
    project: project.key,
    name: fm.name,
    branch,
    specDir,
  };

  // Build write step
  try {
    // Read spec guidance
    const specGuidancePath = input.jarvisRoot
      ? join(input.jarvisRoot, "v1", "docs", "spec-guidance.md")
      : join(import.meta.dir, "..", "..", "..", "v1", "docs", "spec-guidance.md");
    let specGuidance: string;
    try {
      specGuidance = readFileSync(specGuidancePath, "utf8");
    } catch (err) {
      return { ok: false, error: `plan: could not read spec guidance: ${(err as Error).message}` };
    }

    const sourceStep = {
      behavior: "write",
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      promptPlaceholders: {
        WORKDIR: project.root,
        NAME: specDirBasename,
        INTENT: content,
        SPEC_GUIDANCE: specGuidance,
      },
      stepRules: DEFAULT_WRITE_STEP_RULES,
      worktree: {
        projectRoot: project.root,
        projectName: project.key,
        branchName: branch,
        baseRef: "main",
      },
      specPath: join(targetDir, specDirBasename),
      expectedArtifactPath: "index.md",
      publishCompletion: true,
      intentSeed: content,
      presetName: "plan",
      targetDir,
    } as unknown as WorkflowSourceStep;
    const loaded = realLoadWorkflowSteps([sourceStep]);
    return { ok: true, steps: resolveWorkflowPreset("plan", loaded), identity };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
