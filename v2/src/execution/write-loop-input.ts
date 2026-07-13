import { parseArgs } from "node:util";
import { DEFAULT_WRITE_STEP_RULES } from "../../../shared/prompts/step-rules.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { WriteLoopInput } from "./write-loop.ts";

export { DEFAULT_WRITE_STEP_RULES };

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

type BuildWriteLoopInputResult = { ok: true; input: WriteLoopInput } | { ok: false };

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
  agentModelConfig: AgentModelConfig,
  fallbackAgents?: readonly string[],
): BuildWriteLoopInputResult {
  const required = requireLaunchFields(fields, fallbackAgents);
  const maxIterations = parseMaxIterations(fields.maxIterations);

  if (required === null || maxIterations === null) {
    return { ok: false };
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
    bindings: [],
    bindingResolution: { role: "implement", agents: required.agents, agentModelConfig },
  };

  return maxIterations === undefined ? { ok: true, input } : { ok: true, input: { ...input, maxIterations } };
}

/** Map `parseArgs` write/run-start flag values to {@link buildWriteLoopInput}. */
export function buildWriteLoopInputFromCliValues(
  values: Record<string, string | boolean | string[] | undefined>,
  agentModelConfig: AgentModelConfig,
  fallbackAgents?: readonly string[],
): BuildWriteLoopInputResult {
  return buildWriteLoopInput(toLaunchFields(values), agentModelConfig, fallbackAgents);
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
  fallbackAgents?: readonly string[],
): RequiredLaunchFields | null {
  const projectRoot = requireString(fields.projectRoot);
  const projectName = requireString(fields.projectName);
  const branchName = requireString(fields.branchName);
  const baseRef = requireString(fields.baseRef);
  const specPath = requireString(fields.specPath);
  const artifactPath = requireString(fields.artifactPath);
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

function requireString(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function parseMaxIterations(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  const maxIterations = Number.parseInt(raw, 10);
  return Number.isNaN(maxIterations) || maxIterations < 1 ? null : maxIterations;
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
