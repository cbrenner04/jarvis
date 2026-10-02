import { readFileSync } from "node:fs";
import type { CodexSandboxMode } from "../../../shared/invocation/agents.ts";
import { isRecord } from "../../../shared/is-record.ts";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import { MACHINE_CONFIG_PATH } from "../paths.ts";

export const DEFAULT_ITERATION_TIMEOUT_MS = 600_000;
const DEFAULT_ITERATION_CEILING_MS = 1_800_000;
export const DEFAULT_IDLE_OUTPUT_TIMEOUT_MS = 90_000;
export const DEFAULT_REVIEW_ROLE_TIMEOUT_MS = 1_800_000;
export const DEFAULT_RUN_TIMEOUT_MS = 21_600_000;

type WritePathIterationBounds = {
  iterationTimeoutMs: number;
  iterationCeilingMs: number;
  idleOutputMs?: number;
};

function readPositiveNumberField(configPath: string, field: string, defaultValue: number): number {
  const value = readMachineConfigDocument(configPath)?.[field];
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Machine config '${field}' must be a positive number`);
  }
  return value;
}

/** Resolves the machine-wide write iteration wall segment. */
function readIterationTimeoutMs(configPath: string = MACHINE_CONFIG_PATH): number {
  return readPositiveNumberField(configPath, "iterationTimeoutMs", DEFAULT_ITERATION_TIMEOUT_MS);
}

/** Resolves the machine-wide hard ceiling for progress-extended write iterations. */
export function readIterationCeilingMs(configPath: string = MACHINE_CONFIG_PATH): number {
  return readPositiveNumberField(configPath, "iterationCeilingMs", DEFAULT_ITERATION_CEILING_MS);
}

/**
 * Resolves the whole-run wall-clock budget: `projects.<projectKey>.runTimeoutMs` when set, else top-level
 * `runTimeoutMs`, else 6h. Must be positive and not below `iterationCeilingMs`.
 */
export function readRunTimeoutMs(projectKey?: string, configPath: string = MACHINE_CONFIG_PATH): number {
  const override = projectKey === undefined ? undefined : readProjectConfigRecord(projectKey, configPath)?.runTimeoutMs;
  const field = override === undefined ? "runTimeoutMs" : `projects.${projectKey}.runTimeoutMs`;
  const value = override ?? readMachineConfigDocument(configPath)?.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Machine config '${field}' must be a positive number`);
  }
  const iterationCeilingMs = readIterationCeilingMs(configPath);
  if (value < iterationCeilingMs) {
    throw new Error(
      `Machine config '${field}' (${value}) must not be below 'iterationCeilingMs' (${iterationCeilingMs})`,
    );
  }
  return value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Explicit idle budget plus the config path it came from: the project override, else the machine key. */
function readIdleOutputTimeoutSetting(
  configPath: string,
  projectKey: string | undefined,
): { value: number | undefined; field: string } {
  const override =
    projectKey === undefined ? undefined : readProjectConfigOverrides(projectKey, configPath).idleOutputTimeoutMs;
  if (override !== undefined) {
    return { value: override, field: `projects.${projectKey}.overrides.idleOutputTimeoutMs` };
  }
  const value = readMachineConfigDocument(configPath)?.idleOutputTimeoutMs;
  if (value !== undefined && !isNonNegativeInteger(value)) {
    throw new Error("Machine config 'idleOutputTimeoutMs' must be a non-negative integer");
  }
  return { value, field: "idleOutputTimeoutMs" };
}

/**
 * Reads an explicitly configured idle-output watchdog budget without applying a default:
 * `projects.<projectKey>.overrides.idleOutputTimeoutMs` when set, else top-level `idleOutputTimeoutMs`.
 */
export function readConfiguredIdleOutputTimeoutMs(
  configPath: string = MACHINE_CONFIG_PATH,
  projectKey?: string,
): number | undefined {
  return readIdleOutputTimeoutSetting(configPath, projectKey).value;
}

/** Resolves the machine-wide wall clock bounding each review/review-debate role invocation. */
export function readReviewRoleTimeoutMs(configPath: string = MACHINE_CONFIG_PATH): number {
  return readPositiveNumberField(configPath, "reviewRoleTimeoutMs", DEFAULT_REVIEW_ROLE_TIMEOUT_MS);
}

const DEFAULT_CODEX_SANDBOX_MODE: CodexSandboxMode = "workspace-write";

const CODEX_SANDBOX_MODES: readonly CodexSandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

function isCodexSandboxMode(value: string): value is CodexSandboxMode {
  return (CODEX_SANDBOX_MODES as readonly string[]).includes(value);
}

/**
 * Resolves the machine-wide Codex sandbox mode for v2 write/implement invocations. A missing,
 * non-string, or unrecognized `codexSandboxMode` resolves to `workspace-write`.
 */
export function readCodexSandboxMode(configPath: string = MACHINE_CONFIG_PATH): CodexSandboxMode {
  const value = readMachineConfigDocument(configPath)?.codexSandboxMode;
  if (typeof value !== "string") return DEFAULT_CODEX_SANDBOX_MODE;
  return isCodexSandboxMode(value) ? value : DEFAULT_CODEX_SANDBOX_MODE;
}

/**
 * Reads write-path iteration bounds (idle budget honoring the project override when `projectKey` is given)
 * and rejects inverted idle/wall/ceiling ordering.
 */
export function resolveWritePathIterationBounds(
  configPath: string = MACHINE_CONFIG_PATH,
  projectKey?: string,
): WritePathIterationBounds {
  const iterationTimeoutMs = readIterationTimeoutMs(configPath);
  const iterationCeilingMs = readIterationCeilingMs(configPath);
  const idleSetting = readIdleOutputTimeoutSetting(configPath, projectKey);
  const idleOutputTimeoutMs = idleSetting.value ?? DEFAULT_IDLE_OUTPUT_TIMEOUT_MS;
  if (idleOutputTimeoutMs > 0 && idleOutputTimeoutMs > iterationTimeoutMs) {
    throw new Error(
      `Machine config '${idleSetting.field}' (${idleOutputTimeoutMs}) must not exceed 'iterationTimeoutMs' (${iterationTimeoutMs})`,
    );
  }
  if (iterationTimeoutMs > iterationCeilingMs) {
    throw new Error(
      `Machine config 'iterationTimeoutMs' (${iterationTimeoutMs}) must not exceed 'iterationCeilingMs' (${iterationCeilingMs})`,
    );
  }
  return {
    iterationTimeoutMs,
    iterationCeilingMs,
    ...(idleOutputTimeoutMs > 0 ? { idleOutputMs: idleOutputTimeoutMs } : {}),
  };
}

const DEFAULT_SESSION_HOT_DAYS = 14;
const DEFAULT_SESSION_COLD_DAYS = 90;
const RETENTION_SESSIONS_BLOCK_ERROR =
  "retention.sessions.hotDays and retention.sessions.coldDays must be positive integers";

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function readRetentionSessions(
  configPath: string = MACHINE_CONFIG_PATH,
): { ok: true; hotDays: number; coldDays: number } | { ok: false; error: string } {
  const parsed = readMachineConfigFile(configPath);
  if (parsed === undefined) {
    return { ok: true, hotDays: DEFAULT_SESSION_HOT_DAYS, coldDays: DEFAULT_SESSION_COLD_DAYS };
  }
  if (!isRecord(parsed)) {
    throw new Error(
      `Machine config at ${configPath} must be a JSON object, got ${
        Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed
      }`,
    );
  }

  const retention = parsed.retention;
  if (retention !== undefined && !isRecord(retention)) {
    return { ok: false, error: RETENTION_SESSIONS_BLOCK_ERROR };
  }

  const sessions = retention !== undefined ? retention.sessions : undefined;
  if (sessions !== undefined && !isRecord(sessions)) {
    return { ok: false, error: RETENTION_SESSIONS_BLOCK_ERROR };
  }

  let hotDays = DEFAULT_SESSION_HOT_DAYS;
  let coldDays = DEFAULT_SESSION_COLD_DAYS;
  if (isRecord(sessions)) {
    if (sessions.hotDays !== undefined) {
      if (!isPositiveInteger(sessions.hotDays)) {
        return { ok: false, error: "retention.sessions.hotDays must be a positive integer" };
      }
      hotDays = sessions.hotDays;
    }
    if (sessions.coldDays !== undefined) {
      if (!isPositiveInteger(sessions.coldDays)) {
        return { ok: false, error: "retention.sessions.coldDays must be a positive integer" };
      }
      coldDays = sessions.coldDays;
    }
  }
  if (coldDays <= hotDays) {
    return { ok: false, error: "retention.sessions.coldDays must be greater than retention.sessions.hotDays" };
  }

  return { ok: true, hotDays, coldDays };
}

export function readMachineConfigDocument(
  configPath: string = MACHINE_CONFIG_PATH,
): Record<string, unknown> | undefined {
  const parsed = readMachineConfigFile(configPath);
  if (parsed === undefined) return undefined;

  if (!isRecord(parsed)) {
    throw new Error(
      `Machine config at ${configPath} must be a JSON object, got ${
        Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed
      }`,
    );
  }

  if ("agents" in parsed) {
    validateMachineConfigAgents(parsed.agents);
  }

  return parsed;
}

export function validateMachineConfigAgents(agents: unknown, field = "agents"): string[] {
  if (!Array.isArray(agents)) {
    throw new Error(`Machine config '${field}' must be an array, got ${typeof agents}`);
  }

  if (agents.length === 0) {
    throw new Error(`Machine config '${field}' array must not be empty`);
  }

  const seenAgents = new Set<string>();
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    if (typeof agent !== "string") {
      throw new Error(`Machine config '${field}' entry at index ${i} must be a string, got ${typeof agent}`);
    }
    if (agent === "") {
      throw new Error(`Machine config '${field}' entry at index ${i} must not be an empty string`);
    }
    if (seenAgents.has(agent)) {
      throw new Error(`Machine config '${field}' contains duplicate entry: "${agent}"`);
    }
    seenAgents.add(agent);
  }

  return agents;
}

export function loadMachineConfig(configPath: string = MACHINE_CONFIG_PATH): string[] | undefined {
  const parsed = readMachineConfigDocument(configPath);
  if (parsed === undefined || !("agents" in parsed)) {
    return undefined;
  }

  return parsed.agents as string[];
}

export type ImplementReviewBehavior = "debate" | "light";

export type ProjectPipelineConfig = {
  projectKey: string;
  pipeline: unknown;
};

export function readProjectConfigRecord(
  projectKey: string,
  configPath: string = MACHINE_CONFIG_PATH,
): Record<string, unknown> | undefined {
  const projects = readMachineConfigDocument(configPath)?.projects;
  if (!isRecord(projects)) return undefined;
  const project = projects[projectKey];
  return isRecord(project) ? project : undefined;
}

/** Per-project values shadowing their machine-wide keys for that project's runs. */
type ProjectConfigOverrides = { agents?: string[]; idleOutputTimeoutMs?: number };

const PROJECT_OVERRIDE_KEYS: readonly string[] = ["agents", "idleOutputTimeoutMs"];

/**
 * Validates `projects.<projectKey>.overrides`. The key set is closed: an unknown key throws naming its
 * full config path, so a typo never silently falls back to the machine value.
 */
export function parseProjectConfigOverrides(
  projectKey: string,
  project: Record<string, unknown> | undefined,
): ProjectConfigOverrides {
  const block = project?.overrides;
  if (block === undefined) return {};
  const path = `projects.${projectKey}.overrides`;
  if (!isRecord(block)) throw new Error(`Machine config '${path}' must be an object`);
  for (const key of Object.keys(block)) {
    if (!PROJECT_OVERRIDE_KEYS.includes(key)) {
      throw new Error(
        `Machine config '${path}.${key}' is not a supported override (allowed: ${PROJECT_OVERRIDE_KEYS.join(", ")})`,
      );
    }
  }
  const overrides: ProjectConfigOverrides = {};
  if (block.agents !== undefined) overrides.agents = validateMachineConfigAgents(block.agents, `${path}.agents`);
  if (block.idleOutputTimeoutMs !== undefined) {
    if (!isNonNegativeInteger(block.idleOutputTimeoutMs)) {
      throw new Error(`Machine config '${path}.idleOutputTimeoutMs' must be a non-negative integer`);
    }
    overrides.idleOutputTimeoutMs = block.idleOutputTimeoutMs;
  }
  return overrides;
}

/** Reads and validates a registered project's override block; `{}` when the project or block is absent. */
export function readProjectConfigOverrides(
  projectKey: string,
  configPath: string = MACHINE_CONFIG_PATH,
): ProjectConfigOverrides {
  return parseProjectConfigOverrides(projectKey, readProjectConfigRecord(projectKey, configPath));
}

/** Reads a registered project's `fixCommand` when set to a non-empty string. */
export function readProjectFixCommand(
  projectKey: string,
  configPath: string = MACHINE_CONFIG_PATH,
): string | undefined {
  const fixCommand = readProjectConfigRecord(projectKey, configPath)?.fixCommand;
  return typeof fixCommand === "string" && fixCommand.trim() !== "" ? fixCommand : undefined;
}

/** Reads a registered project's `readyCommand` when set to a non-empty string. */
export function readProjectReadyCommand(
  projectKey: string,
  configPath: string = MACHINE_CONFIG_PATH,
): string | undefined {
  const readyCommand = readProjectConfigRecord(projectKey, configPath)?.readyCommand;
  return typeof readyCommand === "string" && readyCommand.trim() !== "" ? readyCommand : undefined;
}

/** Reads top-level `notificationSinkCommand` when set to a non-empty string. */
export function readNotificationSinkCommand(configPath: string = MACHINE_CONFIG_PATH): string | undefined {
  const command = readMachineConfigDocument(configPath)?.notificationSinkCommand;
  return typeof command === "string" && command.trim() !== "" ? command : undefined;
}

/** Reads the raw pipeline fragment without changing the project-registry projection. */
export function readProjectPipelineConfig(
  projectKey: string,
  configPath: string = MACHINE_CONFIG_PATH,
): ProjectPipelineConfig {
  const project = readProjectConfigRecord(projectKey, configPath);
  return { projectKey, pipeline: project?.pipeline };
}

/**
 * Walks projects.<projectKey>.implement.<field>. Absent ancestors (or a non-object project)
 * yield `value: undefined` so callers apply their default; a present non-object `implement`
 * is the only walk-level error.
 */
function readProjectImplementField(
  doc: Record<string, unknown> | undefined,
  projectKey: string,
  field: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const projects = doc?.projects;
  if (!isRecord(projects)) return { ok: true, value: undefined };

  const project = projects[projectKey];
  if (!isRecord(project)) return { ok: true, value: undefined };

  const implement = project.implement;
  if (implement === undefined) return { ok: true, value: undefined };
  if (!isRecord(implement)) {
    return { ok: false, error: `projects.${projectKey}.implement must be an object` };
  }

  return { ok: true, value: implement[field] };
}

export function readProjectImplementReviewBehavior(
  projectKey: string,
  configPath: string = MACHINE_CONFIG_PATH,
): { ok: true; reviewBehavior: ImplementReviewBehavior } | { ok: false; error: string } {
  const field = readProjectImplementField(readMachineConfigDocument(configPath), projectKey, "reviewBehavior");
  if (!field.ok) return field;

  const value = field.value;
  if (value === undefined) return { ok: true, reviewBehavior: "debate" };
  if (value !== "debate" && value !== "light") {
    return {
      ok: false,
      error: `projects.${projectKey}.implement.reviewBehavior must be "debate" or "light"`,
    };
  }
  return { ok: true, reviewBehavior: value };
}

export function readProjectImplementReviewPasses(
  projectKey: string,
  configPath: string = MACHINE_CONFIG_PATH,
): { ok: true; reviewPasses: number } | { ok: false; error: string } {
  const field = readProjectImplementField(readMachineConfigDocument(configPath), projectKey, "reviewPasses");
  if (!field.ok) return field;

  const value = field.value;
  if (value === undefined) return { ok: true, reviewPasses: 1 };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return {
      ok: false,
      error: `projects.${projectKey}.implement.reviewPasses must be a non-negative integer`,
    };
  }
  return { ok: true, reviewPasses: value };
}

export function readProjectRegistry(configPath: string = MACHINE_CONFIG_PATH): Record<string, ProjectRegistryEntry> {
  const projects = readMachineConfigDocument(configPath)?.projects;
  if (!isRecord(projects)) return {};

  const registry: Record<string, ProjectRegistryEntry> = {};
  for (const [key, value] of Object.entries(projects)) {
    if (!isRecord(value)) continue;
    const { root, origin } = value;
    if (typeof root !== "string" || root === "") continue;
    registry[key] = typeof origin === "string" ? { root, origin } : { root };
  }
  return registry;
}

export function resolveMachineProfile(configPath: string = MACHINE_CONFIG_PATH): string {
  const machineProfile = readMachineConfigDocument(configPath)?.machineProfile;

  if (typeof machineProfile !== "string" || machineProfile === "") {
    throw new Error(`Machine config at ${configPath} is missing required 'machineProfile' key`);
  }

  return machineProfile;
}

function readMachineConfigFile(configPath: string): unknown {
  let content: string;
  try {
    content = readFileSync(configPath, "utf8");
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
      return undefined;
    }
    throw err;
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Failed to parse machine config at ${configPath}: invalid JSON`);
  }
}
