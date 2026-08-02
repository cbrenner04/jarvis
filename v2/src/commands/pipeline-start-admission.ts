import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { formatConnectionError, formatLifecycleError, formatRpcError } from "../cli/ipc.ts";
import type { AgentModelConfig, LoadError } from "../config/agent-model-config.ts";
import type { readProjectConfigRecord } from "../config/machine-config-loader.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import {
  formatProjectPipelineResolutionError,
  type resolveProjectPipeline,
} from "../execution/project-pipeline-resolution.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import type { PipelineContext } from "../persistence/state-store.ts";

export type PipelineStartAdmissionInput = { projectKey: string } & (
  | { seedPath: string; seedText?: never }
  | { seedText: string; seedPath?: never }
);

export type PipelineStartPreAdmissionFailure =
  | "invalid-seed-input"
  | "unregistered-project"
  | "configuration-read-exception"
  | "missing-pipeline"
  | "missing-machine-model-configuration"
  | "invalid-machine-model-configuration"
  | "invalid-seed-path"
  | "invalid-project-pipeline";

export type PipelineStartAdmissionFailure =
  | "daemon-refusal"
  | "malformed-daemon-response"
  | "rpc-transport-failure"
  | "connection-lifecycle-failure";

export type PipelineStartAdmissionResult =
  | { kind: "admitted"; pipelineId: string }
  | {
      kind: "pre-admission-failure";
      failure: PipelineStartPreAdmissionFailure;
      detail: string;
    }
  | {
      kind: "admission-failure";
      failure: PipelineStartAdmissionFailure;
      detail: string;
    };

export type PipelineStartAdmissionConnection = {
  close(): void;
};

export type PipelineStartAdmissionDeps = {
  cwd: string;
  configPath: string;
  readProjectRegistry: () => Record<string, { root: string; origin?: string }>;
  readProjectConfigRecord: typeof readProjectConfigRecord;
  loadMachineConfig: (configPath: string) => readonly string[] | undefined;
  loadAgentModelConfig: (agents: readonly string[]) => AgentModelConfig | LoadError;
  resolveProjectPipeline: typeof resolveProjectPipeline;
  getPipelineDefinition: typeof getPipelineDefinition;
  connect: () => Promise<PipelineStartAdmissionConnection>;
  /** Retains the admitted connection for caller-owned follow-up work such as CLI waiting. */
  retainConnection?: (connection: PipelineStartAdmissionConnection) => boolean;
  request: (
    connection: PipelineStartAdmissionConnection,
    method: "pipeline_start",
    params: { definition: PipelineDefinition; context: PipelineContext },
  ) => Promise<unknown>;
};

function preAdmissionFailure(failure: PipelineStartPreAdmissionFailure, detail: string): PipelineStartAdmissionResult {
  return { kind: "pre-admission-failure", failure, detail };
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function resolvePipelineSeed(
  cwd: string,
  seedPath: string,
  projectRoot: string,
): { ok: true } | { ok: false; detail: string } {
  if (isAbsolute(seedPath)) return { ok: false, detail: "pipeline: --seed must be a relative path\n" };
  const path = join(cwd, seedPath);
  try {
    if (!statSync(path).isFile()) {
      return { ok: false, detail: `pipeline: seed is not a file: ${seedPath}\n` };
    }
    const canonical = realpathSync(path);
    if (!inside(realpathSync(projectRoot), canonical)) {
      return {
        ok: false,
        detail: `pipeline: seed escapes registered project after symlink resolution: ${seedPath}\n`,
      };
    }
    accessSync(canonical, constants.R_OK);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      detail: `pipeline: cannot resolve seed path: ${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

function isLoadError(value: AgentModelConfig | LoadError): value is LoadError {
  return "errors" in value;
}

function connectionLifecycleDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Failed to connect to daemon on socket")) return `${message}\n`;
  return formatLifecycleError(error);
}

function closeConnection(connection: PipelineStartAdmissionConnection): void {
  try {
    connection.close();
  } catch {
    // A best-effort close must not violate the typed admission result contract.
  }
}

/** Exactly one of `seedPath` or `seedText`, each a string when present. */
function readExclusiveSeed(
  input: PipelineStartAdmissionInput,
): { seedPath: string | undefined; seedText: string | undefined } | PipelineStartAdmissionResult {
  const uncheckedInput = input as unknown;
  const invalid = preAdmissionFailure(
    "invalid-seed-input",
    "pipeline: exactly one of seedPath or seedText is required\n",
  );
  if (typeof uncheckedInput !== "object" || uncheckedInput === null) return invalid;

  const seedInput = uncheckedInput as { seedPath?: unknown; seedText?: unknown };
  const hasSeedPath = "seedPath" in seedInput;
  const hasSeedText = "seedText" in seedInput;
  if (hasSeedPath === hasSeedText) return invalid;
  if (hasSeedPath) {
    return typeof seedInput.seedPath === "string" ? { seedPath: seedInput.seedPath, seedText: undefined } : invalid;
  }
  return typeof seedInput.seedText === "string" ? { seedPath: undefined, seedText: seedInput.seedText } : invalid;
}

type AdmissionConfig = {
  registry: Record<string, { root: string; origin?: string }>;
  projectEntry: { root: string; origin?: string };
  pipeline: unknown;
  agentModelConfig: AgentModelConfig;
};

/** Registry, project pipeline record, and agent/model config, or the first refusal. */
function resolveAdmissionConfig(
  projectKey: string,
  deps: PipelineStartAdmissionDeps,
): AdmissionConfig | PipelineStartAdmissionResult {
  let registry: Record<string, { root: string; origin?: string }>;
  let projectRecord: Record<string, unknown> | undefined;
  let agents: readonly string[] | undefined;
  try {
    registry = deps.readProjectRegistry();
    const entry = registry[projectKey];
    if (entry === undefined) {
      return preAdmissionFailure("unregistered-project", `unregistered project: ${projectKey}\n`);
    }
    projectRecord = deps.readProjectConfigRecord(projectKey, deps.configPath);
    agents = deps.loadMachineConfig(deps.configPath);
  } catch (error) {
    return preAdmissionFailure("configuration-read-exception", formatLifecycleError(error));
  }

  const projectEntry = registry[projectKey];
  if (projectEntry === undefined) {
    return preAdmissionFailure("unregistered-project", `unregistered project: ${projectKey}\n`);
  }
  if (projectRecord === undefined || !("pipeline" in projectRecord)) {
    return preAdmissionFailure("missing-pipeline", `projects.${projectKey}.pipeline is required\n`);
  }
  if (agents === undefined) {
    return preAdmissionFailure(
      "missing-machine-model-configuration",
      `Machine config at ${deps.configPath} is missing required 'agents' key\n`,
    );
  }

  let agentModelConfig: AgentModelConfig | LoadError;
  try {
    agentModelConfig = deps.loadAgentModelConfig(agents);
  } catch (error) {
    return preAdmissionFailure("configuration-read-exception", formatLifecycleError(error));
  }
  if (isLoadError(agentModelConfig)) {
    return preAdmissionFailure("invalid-machine-model-configuration", `${agentModelConfig.errors.join("; ")}\n`);
  }

  return { registry, projectEntry, pipeline: projectRecord.pipeline, agentModelConfig };
}

function isAdmissionResult(value: object): value is PipelineStartAdmissionResult {
  return "kind" in value;
}

export async function admitPipelineStart(
  input: PipelineStartAdmissionInput,
  deps: PipelineStartAdmissionDeps,
): Promise<PipelineStartAdmissionResult> {
  const seed = readExclusiveSeed(input);
  if (isAdmissionResult(seed)) return seed;

  const projectKey = input.projectKey;
  const config = resolveAdmissionConfig(projectKey, deps);
  if (isAdmissionResult(config)) return config;
  const { registry, projectEntry, agentModelConfig } = config;

  const { seedPath } = seed;
  if (seedPath !== undefined) {
    const seedResolution = resolvePipelineSeed(deps.cwd, seedPath, projectEntry.root);
    if (!seedResolution.ok) {
      return preAdmissionFailure("invalid-seed-path", seedResolution.detail);
    }
  }

  const pipelineResolution = deps.resolveProjectPipeline(
    { projectKey, pipeline: config.pipeline },
    deps.getPipelineDefinition,
    agentModelConfig,
  );
  if (!pipelineResolution.ok) {
    return preAdmissionFailure("invalid-project-pipeline", formatProjectPipelineResolutionError(pipelineResolution));
  }

  const context: PipelineContext = {
    cwd: deps.cwd,
    ...(seedPath === undefined ? { seed: seed.seedText as string } : { seedPath }),
    configPath: deps.configPath,
    projectRegistry: registry,
  };

  let connection: PipelineStartAdmissionConnection;
  let retained = false;
  try {
    connection = await deps.connect();
  } catch (error) {
    return {
      kind: "admission-failure",
      failure: "connection-lifecycle-failure",
      detail: connectionLifecycleDetail(error),
    };
  }

  try {
    let response: unknown;
    try {
      response = await deps.request(connection, "pipeline_start", {
        definition: pipelineResolution.definition,
        context,
      });
    } catch (error) {
      if (error instanceof RpcError) {
        return { kind: "admission-failure", failure: "daemon-refusal", detail: formatRpcError(error) };
      }
      return {
        kind: "admission-failure",
        failure: "rpc-transport-failure",
        detail: formatConnectionError(error),
      };
    }

    const pipelineId =
      typeof response === "object" &&
      response !== null &&
      typeof (response as { pipelineId?: unknown }).pipelineId === "string"
        ? (response as { pipelineId: string }).pipelineId
        : undefined;
    if (pipelineId === undefined) {
      return {
        kind: "admission-failure",
        failure: "malformed-daemon-response",
        detail: "invalid daemon response\n",
      };
    }
    try {
      retained = deps.retainConnection?.(connection) === true;
    } catch {
      retained = false;
    }
    return { kind: "admitted", pipelineId };
  } finally {
    if (!retained) closeConnection(connection);
  }
}
