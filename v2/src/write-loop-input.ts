import { parseArgs } from "node:util";
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import type { WriteLoopInput } from "./write-loop.ts";

/** Default step rules injected into every write-loop launch payload. */
export const DEFAULT_WRITE_STEP_RULES = "Return exactly one terminal token: done|no-work|blocked|progress.";

/** Default agent list when launch fields omit `--agents`. */
export const DEFAULT_WRITE_AGENTS = ["claude"] as const;

/** Raw launch field values shared by CLI argv mapping and the TUI collector. */
export type WriteLaunchFieldValues = {
  projectRoot: string;
  projectName: string;
  branchName: string;
  baseRef: string;
  specPath: string;
  artifactPath: string;
  /** Comma-separated agent ids; omitted uses {@link DEFAULT_WRITE_AGENTS}. */
  agents?: string;
  /** Positive integer string; omitted leaves `maxIterations` unset on the payload. */
  maxIterations?: string;
};

export type BuildWriteLoopInputResult =
  | { ok: true; input: WriteLoopInput }
  | { ok: false; errors: string[] };

/**
 * Map validated launch fields to the daemon `start` / foreground write payload.
 *
 * @param fields Partial launch fields from CLI or TUI collection.
 * @param createBindings Factory for invocation bindings from parsed agent ids.
 * @returns Built `WriteLoopInput` or operator-visible validation errors.
 */
export function buildWriteLoopInput(
  fields: Partial<WriteLaunchFieldValues>,
  createBindings: (agentIds: readonly string[]) => readonly InvocationBinding[],
): BuildWriteLoopInputResult {
  const errors: string[] = [];

  const projectRoot = requireString(fields.projectRoot, "project-root", errors);
  const projectName = requireString(fields.projectName, "project", errors);
  const branchName = requireString(fields.branchName, "branch", errors);
  const baseRef = requireString(fields.baseRef, "base", errors);
  const specPath = requireString(fields.specPath, "spec", errors);
  const artifactPath = requireString(fields.artifactPath, "artifact", errors);

  const agents = parseAgents(fields.agents, errors);
  const maxIterations = parseMaxIterations(fields.maxIterations, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (maxIterations === null) {
    return { ok: false, errors: ["invalid max-iterations: must be a positive integer"] };
  }

  const input: WriteLoopInput = {
    worktree: {
      projectRoot: projectRoot!,
      projectName: projectName!,
      branchName: branchName!,
      baseRef: baseRef!,
    },
    specPath: specPath!,
    stepRules: DEFAULT_WRITE_STEP_RULES,
    expectedArtifactPath: artifactPath!,
    bindings: createBindings(agents!),
  };

  return maxIterations === undefined ? { ok: true, input } : { ok: true, input: { ...input, maxIterations } };
}

/**
 * Map `parseArgs` write/run-start flag values to {@link buildWriteLoopInput}.
 *
 * @param values Parsed CLI flag map from {@link parseWriteArgs}.
 * @param createBindings Factory for invocation bindings from parsed agent ids.
 */
export function buildWriteLoopInputFromCliValues(
  values: Record<string, string | boolean | string[] | undefined>,
  createBindings: (agentIds: readonly string[]) => readonly InvocationBinding[],
): BuildWriteLoopInputResult | { ok: false; message?: string } {
  const agents = stringValue(values.agents);
  const maxIterationsRaw = stringValue(values["max-iterations"]);
  const maxIterationsCheck = parseMaxIterations(maxIterationsRaw, []);
  if (maxIterationsRaw !== undefined && maxIterationsCheck === null) {
    return { ok: false, message: "Error: --max-iterations must be a positive integer\n" };
  }

  const result = buildWriteLoopInput(toLaunchFields(values), createBindings);

  if (!result.ok && agents !== undefined && parseAgents(agents, []) === null) {
    return { ok: false };
  }

  return result;
}

/** CLI flag names accepted by `jarvis write` and `jarvis run start`. */
export function parseWriteArgs(argv: readonly string[]): Record<string, string | boolean | string[] | undefined> {
  return parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      "project-root": { type: "string" },
      project: { type: "string" },
      branch: { type: "string" },
      base: { type: "string" },
      spec: { type: "string" },
      artifact: { type: "string" },
      agents: { type: "string" },
      "max-iterations": { type: "string" },
    },
  }).values;
}

function requireString(value: string | undefined, name: string, errors: string[]): string | undefined {
  if (value === undefined || value.length === 0) {
    errors.push(`missing required field: ${name}`);
    return undefined;
  }
  return value;
}

function parseAgents(raw: string | undefined, errors: string[]): readonly string[] | null | undefined {
  if (raw === undefined) return DEFAULT_WRITE_AGENTS;
  const agents = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (agents.length === 0) {
    errors.push("invalid agents: empty list");
    return null;
  }
  return agents;
}

function parseMaxIterations(raw: string | undefined, errors: string[]): number | undefined | null {
  if (raw === undefined) return undefined;
  const maxIterations = Number.parseInt(raw, 10);
  if (Number.isNaN(maxIterations) || maxIterations < 1) {
    errors.push("invalid max-iterations: must be a positive integer");
    return null;
  }
  return maxIterations;
}

function toLaunchFields(values: Record<string, string | boolean | string[] | undefined>): Partial<WriteLaunchFieldValues> {
  const fields: Partial<WriteLaunchFieldValues> = {};
  const projectRoot = stringValue(values["project-root"]);
  const projectName = stringValue(values.project);
  const branchName = stringValue(values.branch);
  const baseRef = stringValue(values.base);
  const specPath = stringValue(values.spec);
  const artifactPath = stringValue(values.artifact);
  const agents = stringValue(values.agents);
  const maxIterations = stringValue(values["max-iterations"]);

  if (projectRoot !== undefined) fields.projectRoot = projectRoot;
  if (projectName !== undefined) fields.projectName = projectName;
  if (branchName !== undefined) fields.branchName = branchName;
  if (baseRef !== undefined) fields.baseRef = baseRef;
  if (specPath !== undefined) fields.specPath = specPath;
  if (artifactPath !== undefined) fields.artifactPath = artifactPath;
  if (agents !== undefined) fields.agents = agents;
  if (maxIterations !== undefined) fields.maxIterations = maxIterations;
  return fields;
}

function stringValue(value: string | boolean | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
