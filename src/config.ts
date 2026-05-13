import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

let configWriteLocked = false;

function atomicWriteSync(
  file: string,
  content: string,
): void {
  if (configWriteLocked) {
    throw new Error("Config write in progress");
  }

  configWriteLocked = true;
  try {
    const dir = resolve(file, "..");
    mkdirSync(dir, { recursive: true });

    const pid = process.pid;
    const rand = randomBytes(4).toString("hex");
    const tmpFile = `${file}.tmp.${pid}.${rand}`;

    let fd = -1;
    try {
      writeFileSync(tmpFile, content, "utf8");
      fd = openSync(tmpFile, "r");
      fsyncSync(fd);
    } finally {
      if (fd !== -1) {
        closeSync(fd);
      }
    }
    renameSync(tmpFile, file);
  } finally {
    configWriteLocked = false;
  }
}

export const CONFIG_DIR = join(homedir(), ".jarvis");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const SESSIONS_DIR = join(CONFIG_DIR, "sessions");

const AGENT_NAMES = ["claude", "codex", "cursor", "opencode"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export type Project = {
  root: string;
  origin?: string;
  git?: boolean;
};

export type ProjectMatch = {
  key: string;
  root: string;
  origin?: string;
};

export type PatchModels = Record<AgentName, string>;

export type Config = {
  version: 1;
  agentOrder: AgentName[];
  maxIterations: number;
  iterationTimeoutMs: number;
  runTimeoutMs?: number;
  patchModels: PatchModels;
  logServerUrl?: string;
  logServerBind?: string;
  worktreeSymlinks?: string[];
  git: boolean;
  projects: Record<string, Project>;
};

export type ConfigOptions = {
  dir?: string;
  maxIterations?: number;
};

const DEFAULT_CONFIG: Config = {
  version: 1,
  agentOrder: ["claude", "codex", "cursor"],
  maxIterations: 10,
  iterationTimeoutMs: 30 * 60_000,
  patchModels: {
    claude: "haiku",
    codex: "gpt-5.3-codex",
    cursor: "Composer 2",
    opencode: "github-copilot/claude-opus-4.7",
  },
  logServerUrl: "http://127.0.0.1:4310/logs",
  logServerBind: "127.0.0.1:4310",
  git: true,
  projects: {},
};

function resolvePaths(opts?: ConfigOptions): { dir: string; file: string } {
  const dir = opts?.dir ?? CONFIG_DIR;
  return { dir, file: join(dir, "config.json") };
}

function resolveSessionsDir(opts?: ConfigOptions): string {
  const dir = opts?.dir ?? CONFIG_DIR;
  return join(dir, "sessions");
}

function isAgentName(value: unknown): value is AgentName {
  return (
    typeof value === "string" &&
    (AGENT_NAMES as readonly string[]).includes(value)
  );
}

function fail(file: string, message: string): never {
  throw new Error(`Invalid config at ${file}: ${message}`);
}

function validateConfig(input: unknown, file: string): Config {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail(file, "expected a JSON object");
  }
  const obj = input as Record<string, unknown>;

  if (obj.version !== 1) {
    fail(
      file,
      `missing or unsupported version (expected 1, got ${JSON.stringify(obj.version)})`,
    );
  }

  if (!Array.isArray(obj.agentOrder)) {
    fail(file, "agentOrder must be an array");
  }
  const agentOrder: AgentName[] = [];
  for (const entry of obj.agentOrder) {
    if (!isAgentName(entry)) {
      fail(
        file,
        `unknown agent ${JSON.stringify(entry)} (allowed: ${AGENT_NAMES.join(", ")})`,
      );
    }
    agentOrder.push(entry);
  }

  const maxIterations = validatePositiveInteger(
    obj.maxIterations ?? DEFAULT_CONFIG.maxIterations,
    "maxIterations",
    (message) => fail(file, message),
  );

  const iterationTimeoutMs = validatePositiveInteger(
    obj.iterationTimeoutMs ?? DEFAULT_CONFIG.iterationTimeoutMs,
    "iterationTimeoutMs",
    (message) => fail(file, message),
  );

  let runTimeoutMs: number | undefined;
  if (obj.runTimeoutMs !== undefined) {
    runTimeoutMs = validatePositiveInteger(
      obj.runTimeoutMs,
      "runTimeoutMs",
      (message) => fail(file, message),
    );
  }

  const patchModels = validatePatchModels(obj.patchModels, file);
  const logServerUrl = validateConfigString(
    obj.logServerUrl ?? DEFAULT_CONFIG.logServerUrl,
    "logServerUrl",
    (message) => fail(file, message),
  );
  const logServerBind = validateConfigString(
    obj.logServerBind ?? DEFAULT_CONFIG.logServerBind,
    "logServerBind",
    (message) => fail(file, message),
  );

  const git = validateOptionalBoolean(
    obj.git,
    "git",
    DEFAULT_CONFIG.git,
    (message) => fail(file, message),
  );

  const rawProjects = obj.projects;
  if (
    rawProjects === null ||
    typeof rawProjects !== "object" ||
    Array.isArray(rawProjects)
  ) {
    fail(file, "projects must be an object");
  }

  const projects: Record<string, Project> = {};
  const seenRoots = new Map<string, string>();
  for (const [name, value] of Object.entries(
    rawProjects as Record<string, unknown>,
  )) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(file, `project ${JSON.stringify(name)} must be an object`);
    }
    const root = (value as Record<string, unknown>).root;
    if (typeof root !== "string") {
      fail(file, `project ${JSON.stringify(name)} is missing root`);
    }
    if (!isAbsolute(root)) {
      fail(
        file,
        `project ${JSON.stringify(name)} root must be an absolute path (got ${JSON.stringify(root)})`,
      );
    }
    const existing = seenRoots.get(root);
    if (existing !== undefined) {
      fail(
        file,
        `duplicate project root ${JSON.stringify(root)} (used by ${JSON.stringify(existing)} and ${JSON.stringify(name)})`,
      );
    }
    seenRoots.set(root, name);
    const project: Project = { root };
    const originRaw = (value as Record<string, unknown>).origin;
    if (originRaw !== undefined) {
      if (typeof originRaw !== "string") {
        fail(file, `project ${JSON.stringify(name)} origin must be a string`);
      }
      if (originRaw.trim() === "") {
        fail(
          file,
          `project ${JSON.stringify(name)} origin must be a non-empty string`,
        );
      }
      project.origin = originRaw;
    }
    const gitRaw = (value as Record<string, unknown>).git;
    if (gitRaw !== undefined) {
      if (typeof gitRaw !== "boolean") {
        fail(file, `project ${JSON.stringify(name)} git must be a boolean`);
      }
      project.git = gitRaw;
    }
    projects[name] = project;
  }

  return {
    version: 1,
    agentOrder,
    maxIterations,
    iterationTimeoutMs,
    ...(runTimeoutMs !== undefined ? { runTimeoutMs } : {}),
    patchModels,
    logServerUrl,
    logServerBind,
    git,
    projects,
  };
}

function validatePatchModels(input: unknown, file: string): PatchModels {
  if (input === undefined) {
    return structuredClone(DEFAULT_CONFIG.patchModels);
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail(file, "patchModels must be an object");
  }

  const obj = input as Record<string, unknown>;
  const allowed = new Set<string>(AGENT_NAMES);
  const patchModels: Partial<PatchModels> = {};

  for (const [name, value] of Object.entries(obj)) {
    if (!allowed.has(name)) {
      fail(
        file,
        `patchModels contains unknown agent ${JSON.stringify(name)} (allowed: ${AGENT_NAMES.join(", ")})`,
      );
    }
    if (typeof value !== "string") {
      fail(file, `patchModels.${name} must be a string`);
    }
    if (value.trim() === "") {
      fail(file, `patchModels.${name} must be a non-empty string`);
    }
    patchModels[name as AgentName] = value;
  }

  for (const name of AGENT_NAMES) {
    if (patchModels[name] === undefined) {
      if (name === "opencode") {
        patchModels.opencode = DEFAULT_CONFIG.patchModels.opencode;
        continue;
      }
      fail(file, `patchModels.${name} is required`);
    }
  }

  return patchModels as PatchModels;
}

export function validatePositiveInteger(
  value: unknown,
  name: string,
  failWith: (message: string) => never = (message) => {
    throw new Error(message);
  },
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    failWith(`${name} must be a positive integer`);
  }
  return value;
}

function validateConfigString(
  value: unknown,
  name: string,
  failWith: (message: string) => never,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    failWith(`${name} must be a non-empty string`);
  }
  return value;
}

function validateOptionalBoolean(
  value: unknown,
  name: string,
  fallback: boolean,
  failWith: (message: string) => never,
): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    failWith(`${name} must be a boolean`);
  }
  return value;
}

function serialize(cfg: Config): string {
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

export function loadConfig(opts?: ConfigOptions): Config {
  const { dir, file } = resolvePaths(opts);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const cfg = withOptionOverrides(structuredClone(DEFAULT_CONFIG), opts);
    atomicWriteSync(file, serialize(DEFAULT_CONFIG));
    return cfg;
  }
  const raw = readFileSync(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(file, `not valid JSON (${(err as Error).message})`);
  }
  return withOptionOverrides(validateConfig(parsed, file), opts);
}

function withOptionOverrides(cfg: Config, opts?: ConfigOptions): Config {
  if (opts?.maxIterations === undefined) {
    return cfg;
  }
  return {
    ...cfg,
    maxIterations: validatePositiveInteger(opts.maxIterations, "maxIterations"),
  };
}

export function writeConfig(cfg: Config, opts?: ConfigOptions): void {
  const { dir, file } = resolvePaths(opts);
  const validated = validateConfig(cfg, file);
  mkdirSync(dir, { recursive: true });
  atomicWriteSync(file, serialize(validated));
}

export function registerProject(
  name: string,
  root: string,
  opts?: ConfigOptions & { origin?: string },
): void {
  if (!isAbsolute(root)) {
    throw new Error(`Project root must be absolute: ${root}`);
  }
  const cfg = loadConfig(opts);
  for (const [existingName, project] of Object.entries(cfg.projects)) {
    if (project.root === root && existingName !== name) {
      throw new Error(
        `Project root ${root} is already registered as ${JSON.stringify(existingName)}`,
      );
    }
  }
  const project: Project = { root };
  if (opts?.origin !== undefined && opts.origin.trim() !== "") {
    project.origin = opts.origin;
  }
  cfg.projects[name] = project;
  writeConfig(cfg, opts);
}

export function setProjectOrigin(
  name: string,
  origin: string,
  opts?: ConfigOptions,
): void {
  const cfg = loadConfig(opts);
  const project = cfg.projects[name];
  if (project === undefined) {
    throw new Error(`Project ${JSON.stringify(name)} is not registered`);
  }
  cfg.projects[name] = { ...project, origin };
  writeConfig(cfg, opts);
}

export function setGit(value: boolean, opts?: ConfigOptions): void {
  const cfg = loadConfig(opts);
  cfg.git = value;
  writeConfig(cfg, opts);
}

export function setProjectGit(
  name: string,
  value: boolean | undefined,
  opts?: ConfigOptions,
): void {
  const cfg = loadConfig(opts);
  const project = cfg.projects[name];
  if (project === undefined) {
    throw new Error(`Project ${JSON.stringify(name)} is not registered`);
  }
  const next: Project = { root: project.root };
  if (project.origin !== undefined) {
    next.origin = project.origin;
  }
  if (value !== undefined) {
    next.git = value;
  }
  cfg.projects[name] = next;
  writeConfig(cfg, opts);
}

export function effectiveGit(cfg: Config, projectName?: string): boolean {
  if (projectName !== undefined) {
    const project = cfg.projects[projectName];
    if (project !== undefined && project.git !== undefined) {
      return project.git;
    }
  }
  return cfg.git;
}

export function findProjectForPath(
  p: string,
  opts?: ConfigOptions,
): Project | undefined {
  const match = findProjectMatchForPath(p, opts);
  if (match === undefined) {
    return undefined;
  }
  const project: Project = { root: match.root };
  if (match.origin !== undefined) {
    project.origin = match.origin;
  }
  return project;
}

export function findProjectMatchForPath(
  p: string,
  opts?: ConfigOptions,
): ProjectMatch | undefined {
  const target = resolve(p);
  const cfg = loadConfig(opts);
  let best: ProjectMatch | undefined;
  let bestLen = -1;
  for (const [key, project] of Object.entries(cfg.projects)) {
    const root = project.root;
    const prefix = root.endsWith(sep) ? root : root + sep;
    if (target === root || target.startsWith(prefix)) {
      if (root.length > bestLen) {
        const match: ProjectMatch = { key, root };
        if (project.origin !== undefined) {
          match.origin = project.origin;
        }
        best = match;
        bestLen = root.length;
      }
    }
  }
  return best;
}

export function openSessionLog(
  namespace: string,
  timestamp: string,
  opts?: ConfigOptions,
): number {
  const sessionsDir = resolveSessionsDir(opts);
  mkdirSync(sessionsDir, { recursive: true });
  return openSync(join(sessionsDir, `${namespace}-${timestamp}.log`), "a");
}
