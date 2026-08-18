import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Io } from "../cli/io.ts";
import type { LoadError } from "../config/agent-model-config.ts";
import { readMachineConfigDocument } from "../config/machine-config-loader.ts";
import { loadMachineProfileModels } from "../config/machine-profile-loader.ts";
import { MACHINE_CONFIG_PATH } from "../paths.ts";
import { evaluateReadiness, readinessExitCode, renderReadinessReport } from "./init-readiness.ts";

const DEFAULT_AGENT_CANDIDATES = ["claude", "codex", "cursor"] as const;
const PROJECT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const MACHINE_PROFILES_DIR = join(import.meta.dir, "..", "..", "..", "config", "machines");

type GitRunner = (cwd: string, args: readonly string[]) => string | undefined | Promise<string | undefined>;

export type InitCommandDeps = {
  machineConfigPath?: string;
  machinesDir?: string;
  isExecutable?: (name: string) => boolean;
  writeConfigAtomically?: (path: string, content: string) => void;
  writeQueueSentinel?: (path: string) => void;
  cwd?: string;
  git?: GitRunner;
  checkBunRuntime?: () => Promise<{ ok: boolean; detail?: string }>;
  checkGithubAuth?: () => Promise<{ ok: boolean; detail?: string }>;
  checkDaemon?: () => Promise<{ state: "running" | "stale" | "stopped" }>;
};

type InitOptions = {
  profile?: string;
  name?: string;
  targetDir?: string;
  scaffold?: boolean;
  check?: boolean;
};

function machineProfileNames(machinesDir: string): string[] {
  return readdirSync(machinesDir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isFile() && entry.name.endsWith(".json") && entry.name.length > 5 ? [entry.name.slice(0, -5)] : [],
    )
    .sort();
}

function choices(names: readonly string[]): string {
  return names.join(", ");
}

const USAGE = "expected [--profile <name>] [--name <key>] [--target-dir <dir>] [--scaffold] [--check]";

function parseOptions(argv: readonly string[]): InitOptions {
  const options: InitOptions = {};
  let i = 0;
  while (i < argv.length) {
    const flag = argv[i];
    if (flag === "--scaffold" && options.scaffold === undefined) {
      options.scaffold = true;
      i += 1;
      continue;
    }
    if (flag === "--check" && options.check === undefined) {
      options.check = true;
      i += 1;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.length === 0) throw new Error(USAGE);
    if (flag === "--profile" && options.profile === undefined) options.profile = value;
    else if (flag === "--name" && options.name === undefined) options.name = value;
    else if (flag === "--target-dir" && options.targetDir === undefined) options.targetDir = value;
    else throw new Error(USAGE);
    i += 2;
  }
  return options;
}

function atomicWrite(path: string, content: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  const temporaryPath = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, content, { flag: "wx" });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function validateConfiguredProfile(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Machine config 'machineProfile' must be a non-empty string");
  }
  return value;
}

/** Shared by setup and `--check`: an out-of-enumeration or conflicting `--profile` selector is
 * always invalid, whether or not a machine profile is already configured. */
function assertProfileSelectorValid(
  requestedProfile: string | undefined,
  configuredProfile: string | undefined,
  profileNames: readonly string[],
): void {
  const exactChoices = choices(profileNames);
  if (requestedProfile !== undefined && !profileNames.includes(requestedProfile)) {
    throw new Error(`unknown machine profile '${requestedProfile}'; choose one of: ${exactChoices}`);
  }
  if (configuredProfile !== undefined && !profileNames.includes(configuredProfile)) {
    throw new Error(`unknown configured machine profile '${configuredProfile}'; choose one of: ${exactChoices}`);
  }
  if (requestedProfile !== undefined && configuredProfile !== undefined && requestedProfile !== configuredProfile) {
    throw new Error(
      `machine profile '${configuredProfile}' conflicts with --profile '${requestedProfile}'; choose one of: ${exactChoices}`,
    );
  }
}

function selectProfile(
  requestedProfile: string | undefined,
  configuredProfile: string | undefined,
  profileNames: readonly string[],
): string {
  assertProfileSelectorValid(requestedProfile, configuredProfile, profileNames);
  if (configuredProfile === undefined && requestedProfile === undefined) {
    throw new Error(`--profile is required; choose one of: ${choices(profileNames)}`);
  }
  return configuredProfile ?? (requestedProfile as string);
}

/** Read-only counterpart for `--check`: resolves the same selector precedence without requiring
 * either side, and reports whether a machine profile is actually configured (never established by
 * the selector alone). */
function resolveCheckProfile(
  requestedProfile: string | undefined,
  configuredProfile: string | undefined,
  profileNames: readonly string[],
): { profile: string; profileConfigured: boolean } {
  assertProfileSelectorValid(requestedProfile, configuredProfile, profileNames);
  return { profile: requestedProfile ?? configuredProfile ?? "", profileConfigured: configuredProfile !== undefined };
}

/** Read-only counterpart to `resolveAgents`: never throws when no agent is runnable, so an empty
 * roster is reported by the "agents" readiness check instead of aborting the check early. */
function resolveCheckAgents(existing: Record<string, unknown>, isExecutable: (name: string) => boolean): string[] {
  const configuredAgents = existing.agents as string[] | undefined;
  return configuredAgents ?? DEFAULT_AGENT_CANDIDATES.filter(isExecutable);
}

function resolveAgents(existing: Record<string, unknown>, isExecutable: (name: string) => boolean): string[] {
  const configuredAgents = existing.agents as string[] | undefined;
  const agents = configuredAgents ?? DEFAULT_AGENT_CANDIDATES.filter(isExecutable);
  if (agents.length === 0) {
    throw new Error(`no runnable default agent found; tried: ${DEFAULT_AGENT_CANDIDATES.join(", ")}`);
  }
  return agents;
}

function validateRoster(
  selectedProfile: string,
  agents: readonly string[],
  machinesDir: string,
  isExecutable: (name: string) => boolean,
): void {
  const modelConfig = loadMachineProfileModels(selectedProfile, agents, { machinesDir });
  if (Array.isArray((modelConfig as LoadError).errors)) {
    throw new Error(
      `machine profile '${selectedProfile}' does not bind configured agents: ${(modelConfig as LoadError).errors.join("; ")}`,
    );
  }
  for (const agent of agents) {
    if (!isExecutable(agent)) {
      throw new Error(`configured agent '${agent}' is not runnable on PATH`);
    }
  }
}

type MachineBootstrapResult = {
  profile: string;
  agents: string[];
  config: Record<string, unknown> | undefined;
};

function prepareMachineConfig(
  requestedProfile: string | undefined,
  existing: Record<string, unknown>,
  machinesDir: string,
  isExecutable: (name: string) => boolean,
): MachineBootstrapResult {
  const profileNames = machineProfileNames(machinesDir);
  const configuredProfile = validateConfiguredProfile(existing.machineProfile);
  const selectedProfile = selectProfile(requestedProfile, configuredProfile, profileNames);
  const configuredAgents = existing.agents as string[] | undefined;
  const agents = resolveAgents(existing, isExecutable);
  validateRoster(selectedProfile, agents, machinesDir, isExecutable);

  const needsWrite = configuredProfile === undefined || configuredAgents === undefined;
  if (!needsWrite) return { profile: selectedProfile, agents, config: undefined };

  const next = { ...existing };
  if (configuredProfile === undefined) next.machineProfile = selectedProfile;
  if (configuredAgents === undefined) next.agents = [...agents];
  return { profile: selectedProfile, agents, config: next };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateProjectEntry(projectKey: string, project: unknown): asserts project is Record<string, unknown> {
  if (!isRecord(project)) throw new Error(`Machine config 'projects.${projectKey}' must be an object`);
  if (project.root !== undefined && typeof project.root !== "string") {
    throw new Error(`Machine config 'projects.${projectKey}.root' must be a string`);
  }
  if (project.origin !== undefined && typeof project.origin !== "string") {
    throw new Error(`Machine config 'projects.${projectKey}.origin' must be a string`);
  }
  if (project.plan !== undefined && !isRecord(project.plan)) {
    throw new Error(`Machine config 'projects.${projectKey}.plan' must be an object`);
  }
  if (isRecord(project.plan) && project.plan.targetDir !== undefined && typeof project.plan.targetDir !== "string") {
    throw new Error(`Machine config 'projects.${projectKey}.plan.targetDir' must be a string`);
  }
}

type ProjectRegistration = {
  projectRoot: string;
  projectKey: string;
  projects: Record<string, unknown>;
  existingProject: Record<string, unknown> | undefined;
};

async function resolveProjectRegistration(
  existing: Record<string, unknown>,
  requestedName: string | undefined,
  cwd: string,
  git: GitRunner,
): Promise<ProjectRegistration> {
  const resolvedCwd = resolve(cwd);
  const discoveredRoot = await git(resolvedCwd, ["rev-parse", "--show-toplevel"]);
  if (discoveredRoot === undefined || discoveredRoot.length === 0) {
    throw new Error(`current directory '${resolvedCwd}' is not a Git worktree`);
  }
  const projectRoot = resolve(discoveredRoot);
  if (resolvedCwd !== projectRoot) {
    throw new Error(`current directory '${resolvedCwd}' must equal Git worktree root '${projectRoot}'`);
  }

  const configuredProjects = existing.projects;
  if (configuredProjects !== undefined && !isRecord(configuredProjects)) {
    throw new Error("Machine config 'projects' must be an object");
  }
  const projects = configuredProjects ?? {};
  const existingRootKeys = Object.entries(projects).flatMap(([key, value]) =>
    isRecord(value) && typeof value.root === "string" && resolve(value.root) === projectRoot ? [key] : [],
  );
  const projectKey = requestedName ?? (existingRootKeys.length === 1 ? existingRootKeys[0] : basename(projectRoot));
  if (projectKey === undefined || !PROJECT_KEY_PATTERN.test(projectKey)) {
    throw new Error(`project key '${projectKey ?? ""}' must match [A-Za-z0-9][A-Za-z0-9_-]*`);
  }

  const existingProject = projects[projectKey];
  if (existingProject !== undefined) validateProjectEntry(projectKey, existingProject);
  const storedRoot = existingProject?.root;
  if (storedRoot !== undefined && resolve(storedRoot as string) !== projectRoot) {
    throw new Error(`project key '${projectKey}' is bound to '${storedRoot as string}', not '${projectRoot}'`);
  }
  if (existingRootKeys.some((key) => key !== projectKey)) {
    throw new Error(
      `project root '${projectRoot}' is already registered as '${existingRootKeys.find((key) => key !== projectKey) as string}', not '${projectKey}'`,
    );
  }

  return { projectRoot, projectKey, projects, existingProject: existingProject as Record<string, unknown> | undefined };
}

async function prepareProjectConfig(
  existing: Record<string, unknown>,
  registration: ProjectRegistration,
  git: GitRunner,
): Promise<Record<string, unknown> | undefined> {
  const { projectRoot, projectKey, projects, existingProject } = registration;
  const nextProject = { ...(existingProject ?? {}) };
  let changed = false;
  if (nextProject.root === undefined) {
    nextProject.root = projectRoot;
    changed = true;
  }
  if (nextProject.origin === undefined) {
    const origin = await git(projectRoot, ["remote", "get-url", "origin"]);
    if (origin !== undefined && origin.length > 0) {
      nextProject.origin = origin;
      changed = true;
    }
  }
  if (!changed) return undefined;
  return { ...existing, projects: { ...projects, [projectKey]: nextProject } };
}

function validTargetDir(value: string): boolean {
  return value.length > 0 && !isAbsolute(value) && value !== "." && !value.split(/[\\/]/u).includes("..");
}

function legacyModePlanTargetDir(existing: Record<string, unknown>): string | undefined {
  const modes = existing.modes;
  if (!isRecord(modes) || !isRecord(modes.plan)) return undefined;
  return typeof modes.plan.targetDir === "string" ? modes.plan.targetDir : undefined;
}

function ownedTargetDir(existingProject: Record<string, unknown> | undefined): string | undefined {
  if (!isRecord(existingProject?.plan)) return undefined;
  const value = existingProject.plan.targetDir;
  return typeof value === "string" ? value : undefined;
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Walks every existing ancestor of `relativePath` (resolved from `projectRoot`), resolving
 * symlinks physically and rejecting any that escape the resolved project root. `finalMustBeDirectory`
 * governs the leaf: `true` for a directory destination (the target dir itself), `false` for a
 * sentinel file leaf (parents must still be directories).
 */
function assertContainedPath(projectRoot: string, relativePath: string, finalMustBeDirectory: boolean): void {
  let projectRootReal: string;
  try {
    projectRootReal = realpathSync(projectRoot);
  } catch (error) {
    throw new Error(`project root '${projectRoot}' could not be resolved: ${errorMessage(error)}`);
  }
  const segments = relativePath.split(/[\\/]/u).filter((part) => part.length > 0);
  let literal = projectRoot;
  for (const [index, segment] of segments.entries()) {
    literal = join(literal, segment);
    if (!existsSync(literal)) continue;
    let real: string;
    try {
      real = realpathSync(literal);
    } catch (error) {
      throw new Error(`'${literal}' could not be resolved: ${errorMessage(error)}`);
    }
    if (!inside(projectRootReal, real)) {
      throw new Error(`target directory '${relativePath}' escapes project root '${projectRoot}'`);
    }
    const isLast = index === segments.length - 1;
    const mustBeDirectory = !isLast || finalMustBeDirectory;
    if (mustBeDirectory !== statSync(real).isDirectory()) {
      throw new Error(`cannot use '${relativePath}': '${literal}' has an unexpected type`);
    }
  }
}

/** Target-dir precedence: explicit `--target-dir`, then the project's owned `plan.targetDir`,
 * then the legacy (read-only) `modes.plan.targetDir`, then `spec`. Shared by setup and scaffolding. */
function resolveTargetDir(
  requestedTargetDir: string | undefined,
  existing: Record<string, unknown>,
  existingProject: Record<string, unknown> | undefined,
): string {
  if (requestedTargetDir !== undefined && !validTargetDir(requestedTargetDir)) {
    throw new Error(`--target-dir '${requestedTargetDir}' must be a relative non-traversing path`);
  }
  const owned = ownedTargetDir(existingProject);
  if (owned !== undefined && !validTargetDir(owned)) {
    throw new Error(`project 'plan.targetDir' value '${owned}' must be a relative non-traversing path`);
  }
  return requestedTargetDir ?? owned ?? legacyModePlanTargetDir(existing) ?? "spec";
}

type TargetDirResolution = { targetDir: string; nextProject?: Record<string, unknown> };

function prepareTargetDir(
  requestedTargetDir: string | undefined,
  existing: Record<string, unknown>,
  existingProject: Record<string, unknown> | undefined,
  projectRoot: string,
): TargetDirResolution {
  const targetDir = resolveTargetDir(requestedTargetDir, existing, existingProject);
  assertContainedPath(projectRoot, targetDir, true);
  const owned = ownedTargetDir(existingProject);
  if (requestedTargetDir === undefined || requestedTargetDir === owned) return { targetDir };
  return {
    targetDir,
    nextProject: {
      ...(existingProject ?? {}),
      plan: { ...(isRecord(existingProject?.plan) ? existingProject.plan : {}), targetDir: requestedTargetDir },
    },
  };
}

const SENTINEL_NAME = ".gitkeep";
const QUEUE_DIRS = ["seeds", "ready-intents"] as const;

function sentinelPath(targetDir: string, queueDir: (typeof QUEUE_DIRS)[number]): string {
  return join(targetDir, queueDir, SENTINEL_NAME);
}

function writeSentinelAtomically(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "", { flag: "wx" });
}

/** Preflights physical containment (and parent-directory shape) for every queue sentinel destination,
 * before any write happens. */
function assertScaffoldable(projectRoot: string, targetDir: string): void {
  for (const queueDir of QUEUE_DIRS) assertContainedPath(projectRoot, sentinelPath(targetDir, queueDir), false);
}

/** Creates only the queue sentinels that do not already exist; existing sentinels are preserved. */
function scaffoldQueueDirs(projectRoot: string, targetDir: string, writeQueueSentinel: (path: string) => void): void {
  for (const queueDir of QUEUE_DIRS) {
    const path = join(projectRoot, sentinelPath(targetDir, queueDir));
    const exists = existsSync(path);
    if (exists) continue;
    writeQueueSentinel(path);
  }
}

async function defaultGit(cwd: string, args: readonly string[]): Promise<string | undefined> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (exitCode !== 0) return undefined;
  return stdout.trim();
}

/** `--check`: same shared evaluator and renderer as setup, but strictly read-only. Selectors
 * (`--name`, `--profile`, `--target-dir`) resolve which probes to run without persisting anything
 * or establishing state that isn't already configured or registered. */
async function runCheckMode(
  options: InitOptions,
  io: Io,
  configPath: string,
  machinesDir: string,
  isExecutable: (name: string) => boolean,
  cwd: string,
  git: GitRunner,
  injected: InitCommandDeps,
): Promise<number> {
  if (options.scaffold === true) throw new Error("--check does not accept --scaffold");

  const existing = readMachineConfigDocument(configPath) ?? {};
  const configuredProfile = validateConfiguredProfile(existing.machineProfile);
  const profileNames = machineProfileNames(machinesDir);
  const { profile, profileConfigured } = resolveCheckProfile(options.profile, configuredProfile, profileNames);
  const agents = resolveCheckAgents(existing, isExecutable);

  const registration = await resolveProjectRegistration(existing, options.name, cwd, git);
  const targetDir = resolveTargetDir(options.targetDir, existing, registration.existingProject);

  const checkResults = await evaluateReadiness(
    {
      machinesDir,
      profile,
      profileConfigured,
      agents,
      isExecutable,
      projectRoot: registration.projectRoot,
      projectRegistered: registration.existingProject !== undefined,
      storedOrigin:
        typeof registration.existingProject?.origin === "string" ? registration.existingProject.origin : undefined,
      targetDir,
    },
    readinessDeps(injected, git),
  );
  io.stdout(renderReadinessReport(checkResults));
  return readinessExitCode(checkResults);
}

function readinessDeps(injected: InitCommandDeps, git: NonNullable<InitCommandDeps["git"]>) {
  return {
    ...(injected.checkBunRuntime !== undefined ? { checkBunRuntime: injected.checkBunRuntime } : {}),
    ...(injected.checkGithubAuth !== undefined ? { checkGithubAuth: injected.checkGithubAuth } : {}),
    ...(injected.checkDaemon !== undefined ? { checkDaemon: injected.checkDaemon } : {}),
    currentOrigin: async (root: string) => git(root, ["remote", "get-url", "origin"]),
  };
}

export async function runInitCommand(argv: readonly string[], io: Io, injected: InitCommandDeps = {}): Promise<number> {
  const configPath = injected.machineConfigPath ?? MACHINE_CONFIG_PATH;
  const machinesDir = injected.machinesDir ?? MACHINE_PROFILES_DIR;
  const isExecutable = injected.isExecutable ?? ((name: string) => Bun.which(name) !== null);
  const writeConfigAtomically = injected.writeConfigAtomically ?? atomicWrite;
  const writeQueueSentinel = injected.writeQueueSentinel ?? writeSentinelAtomically;
  const cwd = injected.cwd ?? process.cwd();
  const git = injected.git ?? defaultGit;

  try {
    const options = parseOptions(argv);
    if (options.check === true) {
      return await runCheckMode(options, io, configPath, machinesDir, isExecutable, cwd, git, injected);
    }
    const existing = readMachineConfigDocument(configPath) ?? {};
    const machineBootstrap = prepareMachineConfig(options.profile, existing, machinesDir, isExecutable);
    const machineConfig = machineBootstrap.config ?? existing;

    const registration = await resolveProjectRegistration(machineConfig, options.name, cwd, git);
    const preparedProjectConfig = await prepareProjectConfig(machineConfig, registration, git);
    const afterRegistration = preparedProjectConfig ?? machineConfig;
    const registeredProjects = isRecord(afterRegistration.projects)
      ? (afterRegistration.projects as Record<string, unknown>)
      : {};
    const registeredProject =
      (registeredProjects[registration.projectKey] as Record<string, unknown> | undefined) ??
      registration.existingProject;

    const { targetDir, nextProject } = prepareTargetDir(
      options.targetDir,
      afterRegistration,
      registeredProject,
      registration.projectRoot,
    );
    const preparedTargetConfig =
      nextProject !== undefined
        ? {
            ...afterRegistration,
            projects: { ...registeredProjects, [registration.projectKey]: nextProject },
          }
        : undefined;

    const next = preparedTargetConfig ?? afterRegistration;

    if (options.scaffold === true) assertScaffoldable(registration.projectRoot, targetDir);

    if (
      machineBootstrap.config !== undefined ||
      preparedProjectConfig !== undefined ||
      preparedTargetConfig !== undefined
    ) {
      writeConfigAtomically(configPath, `${JSON.stringify(next, null, 2)}\n`);
    }

    if (options.scaffold === true) scaffoldQueueDirs(registration.projectRoot, targetDir, writeQueueSentinel);

    const readinessResults = await evaluateReadiness(
      {
        machinesDir,
        profile: machineBootstrap.profile,
        agents: machineBootstrap.agents,
        isExecutable,
        projectRoot: registration.projectRoot,
        projectRegistered: true,
        storedOrigin: typeof registeredProject?.origin === "string" ? registeredProject.origin : undefined,
        targetDir,
      },
      readinessDeps(injected, git),
    );
    io.stdout(renderReadinessReport(readinessResults));
    return readinessExitCode(readinessResults);
  } catch (error) {
    io.stderr(`init: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
