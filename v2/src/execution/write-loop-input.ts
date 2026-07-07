import { parseArgs } from "node:util";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import type { WriteLoopInput } from "./write-loop.ts";

/** Default step rules injected into every write-loop launch payload. */
export const DEFAULT_WRITE_STEP_RULES = "Return exactly one terminal token: done|no-work|blocked|progress.";

/** Default agent list when config has no `agents` override. */
export const DEFAULT_WRITE_AGENTS = ["claude"] as const;

/** Raw launch field values shared by CLI argv mapping and the TUI collector. */
export type WriteLaunchFieldValues = {
  projectRoot: string;
  projectName: string;
  branchName: string;
  baseRef: string;
  specPath: string;
  artifactPath: string;
  /** Positive integer string; omitted leaves `maxIterations` unset on the payload. */
  maxIterations?: string;
};

type BuildWriteLoopInputResult = { ok: true; input: WriteLoopInput } | { ok: false; errors: string[] };

type RequiredLaunchFields = {
  projectRoot: string;
  projectName: string;
  branchName: string;
  baseRef: string;
  specPath: string;
  artifactPath: string;
  agents: readonly string[];
};

/** Map validated launch fields to the daemon `start` / foreground write payload. */
export function buildWriteLoopInput(
  fields: Partial<WriteLaunchFieldValues>,
  createBindings: (agentIds: readonly string[]) => readonly InvocationBinding[],
  fallbackAgents?: readonly string[],
): BuildWriteLoopInputResult {
  const errors: string[] = [];
  const required = requireLaunchFields(fields, errors, fallbackAgents);
  const maxIterations = parseMaxIterations(fields.maxIterations, errors);

  if (errors.length > 0 || required === null || maxIterations === null) {
    return { ok: false, errors };
  }

  const input: WriteLoopInput = {
    worktree: {
      projectRoot: required.projectRoot,
      projectName: required.projectName,
      branchName: required.branchName,
      baseRef: required.baseRef,
    },
    specPath: required.specPath,
    stepRules: DEFAULT_WRITE_STEP_RULES,
    expectedArtifactPath: required.artifactPath,
    bindings: createBindings(required.agents),
  };

  return maxIterations === undefined ? { ok: true, input } : { ok: true, input: { ...input, maxIterations } };
}

/** Map `parseArgs` write/run-start flag values to {@link buildWriteLoopInput}. */
export function buildWriteLoopInputFromCliValues(
  values: Record<string, string | boolean | string[] | undefined>,
  createBindings: (agentIds: readonly string[]) => readonly InvocationBinding[],
  fallbackAgents?: readonly string[],
): BuildWriteLoopInputResult | { ok: false; message?: string } {
  const maxIterationsRaw = stringValue(values["max-iterations"]);
  const maxIterationsCheck = parseMaxIterations(maxIterationsRaw, []);
  if (maxIterationsRaw !== undefined && maxIterationsCheck === null) {
    return { ok: false, message: "Error: --max-iterations must be a positive integer\n" };
  }

  return buildWriteLoopInput(toLaunchFields(values), createBindings, fallbackAgents);
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
      "max-iterations": { type: "string" },
    },
  }).values;
}

function requireLaunchFields(
  fields: Partial<WriteLaunchFieldValues>,
  errors: string[],
  fallbackAgents?: readonly string[],
): RequiredLaunchFields | null {
  const projectRoot = requireString(fields.projectRoot, "project-root", errors);
  const projectName = requireString(fields.projectName, "project", errors);
  const branchName = requireString(fields.branchName, "branch", errors);
  const baseRef = requireString(fields.baseRef, "base", errors);
  const specPath = requireString(fields.specPath, "spec", errors);
  const artifactPath = requireString(fields.artifactPath, "artifact", errors);
  const agents = fallbackAgents ?? DEFAULT_WRITE_AGENTS;

  if (
    projectRoot === undefined ||
    projectName === undefined ||
    branchName === undefined ||
    baseRef === undefined ||
    specPath === undefined ||
    artifactPath === undefined
  ) {
    return null;
  }

  return { projectRoot, projectName, branchName, baseRef, specPath, artifactPath, agents };
}

function requireString(value: string | undefined, name: string, errors: string[]): string | undefined {
  if (value === undefined || value.length === 0) {
    errors.push(`missing required field: ${name}`);
    return undefined;
  }
  return value;
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

function toLaunchFields(
  values: Record<string, string | boolean | string[] | undefined>,
): Partial<WriteLaunchFieldValues> {
  const fields: Partial<WriteLaunchFieldValues> = {};
  const assign = <K extends keyof WriteLaunchFieldValues>(key: K, value: string | undefined): void => {
    if (value !== undefined) fields[key] = value;
  };

  assign("projectRoot", stringValue(values["project-root"]));
  assign("projectName", stringValue(values.project));
  assign("branchName", stringValue(values.branch));
  assign("baseRef", stringValue(values.base));
  assign("specPath", stringValue(values.spec));
  assign("artifactPath", stringValue(values.artifact));
  assign("maxIterations", stringValue(values["max-iterations"]));
  return fields;
}

function stringValue(value: string | boolean | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
