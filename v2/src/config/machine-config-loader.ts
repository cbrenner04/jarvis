import { readFileSync } from "node:fs";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import { MACHINE_CONFIG_PATH } from "../paths.ts";

export const DEFAULT_ITERATION_TIMEOUT_MS = 600_000;
export const DEFAULT_ITERATION_CEILING_MS = 1_800_000;
export const DEFAULT_IDLE_OUTPUT_TIMEOUT_MS = 90_000;
export const DEFAULT_REVIEW_ROLE_TIMEOUT_MS = 1_800_000;

export type WritePathIterationBounds = {
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
export function readIterationTimeoutMs(configPath: string = MACHINE_CONFIG_PATH): number {
  return readPositiveNumberField(configPath, "iterationTimeoutMs", DEFAULT_ITERATION_TIMEOUT_MS);
}

/** Resolves the machine-wide hard ceiling for progress-extended write iterations. */
export function readIterationCeilingMs(configPath: string = MACHINE_CONFIG_PATH): number {
  return readPositiveNumberField(configPath, "iterationCeilingMs", DEFAULT_ITERATION_CEILING_MS);
}

/** Resolves idle-output watchdog budget for write-path ordering (v1-aligned default). */
export function readIdleOutputTimeoutMs(configPath: string = MACHINE_CONFIG_PATH): number {
  return readConfiguredIdleOutputTimeoutMs(configPath) ?? DEFAULT_IDLE_OUTPUT_TIMEOUT_MS;
}

/** Reads an explicitly configured idle-output watchdog budget without applying a default. */
export function readConfiguredIdleOutputTimeoutMs(configPath: string = MACHINE_CONFIG_PATH): number | undefined {
  const value = readMachineConfigDocument(configPath)?.idleOutputTimeoutMs;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error("Machine config 'idleOutputTimeoutMs' must be a non-negative integer");
  }
  return value;
}

/** Resolves the machine-wide wall clock bounding each review/review-debate role invocation. */
export function readReviewRoleTimeoutMs(configPath: string = MACHINE_CONFIG_PATH): number {
  return readPositiveNumberField(configPath, "reviewRoleTimeoutMs", DEFAULT_REVIEW_ROLE_TIMEOUT_MS);
}

/** Reads write-path iteration bounds and rejects inverted idle/wall/ceiling ordering. */
export function resolveWritePathIterationBounds(configPath: string = MACHINE_CONFIG_PATH): WritePathIterationBounds {
  const iterationTimeoutMs = readIterationTimeoutMs(configPath);
  const iterationCeilingMs = readIterationCeilingMs(configPath);
  const idleOutputTimeoutMs = readIdleOutputTimeoutMs(configPath);
  if (idleOutputTimeoutMs > 0 && idleOutputTimeoutMs > iterationTimeoutMs) {
    throw new Error(
      `Machine config 'idleOutputTimeoutMs' (${idleOutputTimeoutMs}) must not exceed 'iterationTimeoutMs' (${iterationTimeoutMs})`,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function validateMachineConfigAgents(agents: unknown): string[] {
  if (!Array.isArray(agents)) {
    throw new Error(`Machine config 'agents' must be an array, got ${typeof agents}`);
  }

  if (agents.length === 0) {
    throw new Error("Machine config 'agents' array must not be empty");
  }

  const seenAgents = new Set<string>();
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    if (typeof agent !== "string") {
      throw new Error(`Machine config 'agents' entry at index ${i} must be a string, got ${typeof agent}`);
    }
    if (agent === "") {
      throw new Error(`Machine config 'agents' entry at index ${i} must not be an empty string`);
    }
    if (seenAgents.has(agent)) {
      throw new Error(`Machine config 'agents' contains duplicate entry: "${agent}"`);
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

/** Reads the raw pipeline fragment without changing the project-registry projection. */
export function readProjectPipelineConfig(
  projectKey: string,
  configPath: string = MACHINE_CONFIG_PATH,
): ProjectPipelineConfig {
  const projects = readMachineConfigDocument(configPath)?.projects;
  const project = isRecord(projects) ? projects[projectKey] : undefined;
  return {
    projectKey,
    pipeline: isRecord(project) ? project.pipeline : undefined,
  };
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
