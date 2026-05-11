import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

export const CONFIG_DIR = join(homedir(), ".jarvis");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const SESSIONS_DIR = join(CONFIG_DIR, "sessions");

const AGENT_NAMES = ["claude", "codex", "cursor"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export type Project = {
  root: string;
};

export type ProjectMatch = {
  key: string;
  root: string;
};

export type PatchModels = Record<AgentName, string>;

export type Config = {
  version: 1;
  agentOrder: AgentName[];
  maxIterations: number;
  patchModels: PatchModels;
  logServerUrl?: string;
  logServerBind?: string;
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
  patchModels: {
    claude: "haiku",
    codex: "gpt-5.3-codex",
    cursor: "Composer 2",
  },
  logServerUrl: "http://127.0.0.1:4310/logs",
  logServerBind: "127.0.0.1:4310",
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
    projects[name] = { root };
  }

  return {
    version: 1,
    agentOrder,
    maxIterations,
    patchModels,
    logServerUrl,
    logServerBind,
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

function serialize(cfg: Config): string {
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

export function loadConfig(opts?: ConfigOptions): Config {
  const { dir, file } = resolvePaths(opts);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const cfg = withOptionOverrides(structuredClone(DEFAULT_CONFIG), opts);
    writeFileSync(file, serialize(DEFAULT_CONFIG));
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
  writeFileSync(file, serialize(validated));
}

export function registerProject(
  name: string,
  root: string,
  opts?: ConfigOptions,
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
  cfg.projects[name] = { root };
  writeConfig(cfg, opts);
}

export function findProjectForPath(
  p: string,
  opts?: ConfigOptions,
): Project | undefined {
  const match = findProjectMatchForPath(p, opts);
  if (match === undefined) {
    return undefined;
  }
  return { root: match.root };
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
        best = { key, root };
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
