import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { PIPELINE_START_PARSE_ARG_OPTIONS } from "../cli/command-help-flags.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatConnectionError, formatRpcError, request, withRunClient } from "../cli/ipc.ts";
import { withConnectDispatch } from "../cli/stale-dispatch.ts";
import {
  PIPELINE_APPROVE_USAGE,
  PIPELINE_REJECT_USAGE,
  PIPELINE_RESUME_USAGE,
  PIPELINE_START_USAGE,
  PIPELINE_USAGE,
  PIPELINE_WAIT_USAGE,
} from "../cli/usage.ts";
import type { AgentModelConfig, LoadError } from "../config/agent-model-config.ts";
import { loadMachineConfig, readProjectConfigRecord } from "../config/machine-config-loader.ts";
import { isPipelineTerminal, type PipelineDerivedState } from "../daemon/pipeline-execution.ts";
import type { PipelineBoundaryResult, PipelineTerminalState } from "../daemon/pipeline-observation.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import {
  formatProjectPipelineResolutionError,
  resolveProjectPipeline,
} from "../execution/project-pipeline-resolution.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import type { PipelineContext } from "../persistence/state-store.ts";

let invertPreAdmissionResolutionGuardForTest = false;
let invertDetachClientWaitGuardForTest = false;
let invertListNonFollowGuardForTest = false;
let invertWaitBoundaryGuardForTest = false;
let invertAppliedRefusedGuardForTest = false;
let invertResumedRefusedGuardForTest = false;

export function setInvertPreAdmissionResolutionGuardForTest(value: boolean): void {
  invertPreAdmissionResolutionGuardForTest = value;
}

export function setInvertDetachClientWaitGuardForTest(value: boolean): void {
  invertDetachClientWaitGuardForTest = value;
}

export function setInvertListNonFollowGuardForTest(value: boolean): void {
  invertListNonFollowGuardForTest = value;
}

export function setInvertWaitBoundaryGuardForTest(value: boolean): void {
  invertWaitBoundaryGuardForTest = value;
}

export function setInvertAppliedRefusedGuardForTest(value: boolean): void {
  invertAppliedRefusedGuardForTest = value;
}

export function setInvertResumedRefusedGuardForTest(value: boolean): void {
  invertResumedRefusedGuardForTest = value;
}

type PipelineStartCliInput =
  | {
      ok: true;
      projectKey: string;
      seed: string;
      seedIsPath: boolean;
      detach: boolean;
    }
  | { ok: false };

function parsePipelineWaitBoundary(value: unknown): PipelineBoundaryResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { kind?: unknown; state?: unknown; stageId?: unknown };
  if (record.kind === "terminal") {
    const state = record.state;
    if (state === "succeeded" || state === "failed" || state === "rejected" || state === "interrupted") {
      return { kind: "terminal", state };
    }
    return undefined;
  }
  if (record.kind === "awaiting-approval" && typeof record.stageId === "string" && record.stageId.length > 0) {
    return { kind: "awaiting-approval", stageId: record.stageId };
  }
  return undefined;
}

function exitCodeForPipelineTerminalState(state: PipelineTerminalState): number {
  return state === "succeeded" ? 0 : 1;
}

function readPipelineListResult(value: unknown): { pipelines: unknown[] } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const pipelines = (value as { pipelines?: unknown }).pipelines;
  return Array.isArray(pipelines) ? { pipelines } : undefined;
}

type PipelineMutationOutcome = { kind: "applied" } | { kind: "resumed" } | { kind: "refused"; reason: string };

function parsePipelineMutationOutcome(
  value: unknown,
  successKind: "applied" | "resumed",
): PipelineMutationOutcome | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { kind?: unknown; reason?: unknown };
  if (record.kind === successKind) return { kind: successKind };
  if (record.kind === "refused" && typeof record.reason === "string") {
    return { kind: "refused", reason: record.reason };
  }
  return undefined;
}

function parsePipelineDecisionArgs(
  argv: readonly string[],
): { ok: true; pipelineId: string; stageId: string } | { ok: false } {
  if (argv.length !== 2) return { ok: false };
  const pipelineId = argv[0];
  const stageId = argv[1];
  if (pipelineId === undefined || stageId === undefined) return { ok: false };
  if (pipelineId.trim().length === 0 || stageId.trim().length === 0) return { ok: false };
  return { ok: true, pipelineId, stageId };
}

function exitCodeForPipelineMutationOutcome(success: boolean, invertGuard: boolean): number {
  if (invertGuard) return success ? 1 : 0;
  return success ? 0 : 1;
}

function hasNonTerminalListPipelines(pipelines: unknown[]): boolean {
  return pipelines.some((pipeline) => {
    if (typeof pipeline !== "object" || pipeline === null) return false;
    const state = (pipeline as { state?: unknown }).state;
    return typeof state === "string" && !isPipelineTerminal(state as PipelineDerivedState);
  });
}

function resolvePipelineSeed(
  cwd: string,
  seedPath: string,
): { ok: true; seed: string } | { ok: false; message: string } {
  if (isAbsolute(seedPath)) return { ok: false, message: "pipeline: --seed must be a relative path" };
  const path = join(cwd, seedPath);
  try {
    if (!statSync(path).isFile()) return { ok: false, message: `pipeline: seed is not a file: ${seedPath}` };
    return { ok: true, seed: readFileSync(path, "utf8") };
  } catch (error) {
    return {
      ok: false,
      message: `pipeline: cannot resolve seed path: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function parsePipelineStartArgs(argv: readonly string[]): PipelineStartCliInput {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: PIPELINE_START_PARSE_ARG_OPTIONS,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch {
    return { ok: false };
  }

  const detach = values.detach === true;
  const projectKey = positionals[0];
  if (projectKey === undefined || positionals.length !== 1) return { ok: false };

  const seedPath = typeof values.seed === "string" ? values.seed : undefined;
  const seedText = typeof values["seed-text"] === "string" ? values["seed-text"] : undefined;
  if ((seedPath === undefined) === (seedText === undefined)) return { ok: false };

  if (seedText !== undefined) {
    return { ok: true, projectKey, seed: seedText, seedIsPath: false, detach };
  }
  if (seedPath !== undefined) {
    return { ok: true, projectKey, seed: seedPath, seedIsPath: true, detach };
  }
  return { ok: false };
}

function isLoadError(value: AgentModelConfig | LoadError): value is LoadError {
  return "errors" in value;
}

async function waitForPipelineTerminal(client: IpcClient, pipelineId: string, io: Io, deps: CliDeps): Promise<number> {
  const unregister = deps.onSigint(() => client.close());
  try {
    while (true) {
      let response: unknown;
      try {
        response = await request(client, "pipeline_wait", { pipelineId });
      } catch (error) {
        if (error instanceof RpcError) {
          io.stderr(formatRpcError(error));
          return 1;
        }
        io.stderr(formatConnectionError(error));
        return 1;
      }
      const boundary = parsePipelineWaitBoundary(response);
      if (boundary === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }
      if (boundary.kind === "awaiting-approval") continue;
      io.stdout(`${JSON.stringify(boundary)}\n`);
      return exitCodeForPipelineTerminalState(boundary.state);
    }
  } finally {
    unregister();
  }
}

async function startAdmittedPipeline(
  client: IpcClient,
  definition: PipelineDefinition,
  context: PipelineContext,
  detach: boolean,
  io: Io,
  deps: CliDeps,
): Promise<number> {
  let result: unknown;
  try {
    result = await request(client, "pipeline_start", { definition, context });
  } catch (error) {
    if (error instanceof RpcError) {
      io.stderr(formatRpcError(error));
      return 1;
    }
    throw error;
  }
  const pipelineId =
    typeof result === "object" && result !== null && typeof (result as { pipelineId?: unknown }).pipelineId === "string"
      ? (result as { pipelineId: string }).pipelineId
      : undefined;
  if (pipelineId === undefined) {
    io.stderr("invalid daemon response\n");
    return 1;
  }
  io.stdout(`${pipelineId}\n`);
  if (detach && !invertDetachClientWaitGuardForTest) return 0;
  return waitForPipelineTerminal(client, pipelineId, io, deps);
}

async function runPipelineStartCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const parsed = parsePipelineStartArgs(argv);
  if (!parsed.ok) {
    io.stderr(PIPELINE_START_USAGE);
    return 1;
  }

  const registry = deps.readProjectRegistry();
  if (registry[parsed.projectKey] === undefined) {
    io.stderr(`unregistered project: ${parsed.projectKey}\n`);
    return 1;
  }

  const projectRecord = readProjectConfigRecord(parsed.projectKey, deps.machineConfigPath);
  if (projectRecord === undefined || !("pipeline" in projectRecord)) {
    io.stderr(`projects.${parsed.projectKey}.pipeline is required\n`);
    return 1;
  }

  const agents = loadMachineConfig(deps.machineConfigPath);
  if (agents === undefined) {
    io.stderr(`Machine config at ${deps.machineConfigPath} is missing required 'agents' key\n`);
    return 1;
  }
  const agentModelConfig = deps.loadAgentModelConfig(agents);
  if (isLoadError(agentModelConfig)) {
    io.stderr(`${agentModelConfig.errors.join("; ")}\n`);
    return 1;
  }

  let seed = parsed.seed;
  if (parsed.seedIsPath) {
    const resolvedSeed = resolvePipelineSeed(deps.cwd(), parsed.seed);
    if (!resolvedSeed.ok) {
      io.stderr(`${resolvedSeed.message}\n`);
      return 1;
    }
    seed = resolvedSeed.seed;
  }

  const resolution = resolveProjectPipeline(
    { projectKey: parsed.projectKey, pipeline: projectRecord.pipeline },
    getPipelineDefinition,
    agentModelConfig,
  );
  let definition: PipelineDefinition;
  if (resolution.ok) {
    definition = resolution.definition;
  } else if (invertPreAdmissionResolutionGuardForTest) {
    const fallback = getPipelineDefinition("fast");
    if (!fallback.ok) {
      io.stderr(formatProjectPipelineResolutionError(resolution));
      return 1;
    }
    definition = fallback.definition;
  } else {
    io.stderr(formatProjectPipelineResolutionError(resolution));
    return 1;
  }

  const context: PipelineContext = {
    cwd: deps.cwd(),
    seed,
    configPath: deps.machineConfigPath,
    projectRegistry: registry,
  };

  return withConnectDispatch(io, deps, async (client) =>
    startAdmittedPipeline(client, definition, context, parsed.detach, io, deps),
  );
}

async function runPipelineListCommand(io: Io, deps: CliDeps): Promise<number> {
  return withRunClient(io, deps, async (client) => {
    try {
      let result: unknown = await request(client, "pipeline_list");
      if (invertListNonFollowGuardForTest) {
        const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
        while (hasNonTerminalListPipelines(readPipelineListResult(result)?.pipelines ?? [])) {
          await sleep(50);
          result = await request(client, "pipeline_list");
        }
      }
      const snapshot = readPipelineListResult(result);
      if (snapshot === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }
      io.stdout(`${JSON.stringify(snapshot)}\n`);
      return 0;
    } catch (error) {
      if (error instanceof RpcError) {
        io.stderr(formatRpcError(error));
        return 1;
      }
      throw error;
    }
  });
}

async function runPipelineWaitCommand(pipelineId: string, io: Io, deps: CliDeps): Promise<number> {
  return withRunClient(io, deps, async (client) => {
    const unregister = deps.onSigint(() => client.close());
    try {
      if (invertWaitBoundaryGuardForTest) {
        const listResult = await request(client, "pipeline_list");
        const pipeline = readPipelineListResult(listResult)?.pipelines.find(
          (row) =>
            typeof row === "object" && row !== null && (row as { pipelineId?: unknown }).pipelineId === pipelineId,
        );
        const state =
          typeof pipeline === "object" && pipeline !== null ? (pipeline as { state?: unknown }).state : undefined;
        if (state === "pending" || state === "running") {
          io.stdout(`${JSON.stringify({ kind: "intermediate", state })}\n`);
          return 0;
        }
      }

      let response: unknown;
      try {
        response = await request(client, "pipeline_wait", { pipelineId });
      } catch (error) {
        if (error instanceof RpcError) {
          io.stderr(formatRpcError(error));
          return 1;
        }
        io.stderr(formatConnectionError(error));
        return 1;
      }
      const boundary = parsePipelineWaitBoundary(response);
      if (boundary === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }
      io.stdout(`${JSON.stringify(boundary)}\n`);
      return boundary.kind === "awaiting-approval" ? 0 : exitCodeForPipelineTerminalState(boundary.state);
    } finally {
      unregister();
    }
  });
}

async function runPipelineMutationCommand(
  method: "pipeline_approve" | "pipeline_reject" | "pipeline_resume",
  params: Record<string, string>,
  successKind: "applied" | "resumed",
  invertGuard: boolean,
  io: Io,
  deps: CliDeps,
): Promise<number> {
  return withRunClient(io, deps, async (client) => {
    let response: unknown;
    try {
      response = await request(client, method, params);
    } catch (error) {
      if (error instanceof RpcError) {
        io.stderr(formatRpcError(error));
        return 1;
      }
      io.stderr(formatConnectionError(error));
      return 1;
    }
    const outcome = parsePipelineMutationOutcome(response, successKind);
    if (outcome === undefined) {
      io.stderr("invalid daemon response\n");
      return 1;
    }
    if (outcome.kind === "refused") {
      io.stderr(`${outcome.reason}\n`);
    }
    return exitCodeForPipelineMutationOutcome(outcome.kind === successKind, invertGuard);
  });
}

export async function runPipelineCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const subcommand = argv[0];
  if (subcommand === "start") {
    return runPipelineStartCommand(argv.slice(1), io, deps);
  }
  if (subcommand === "list" && argv.length === 1) {
    return runPipelineListCommand(io, deps);
  }
  if (subcommand === "wait") {
    const pipelineId = argv[1];
    if (argv.length !== 2 || pipelineId === undefined || pipelineId.trim().length === 0) {
      io.stderr(PIPELINE_WAIT_USAGE);
      return 1;
    }
    return runPipelineWaitCommand(pipelineId, io, deps);
  }
  if (subcommand === "approve" || subcommand === "reject") {
    const parsed = parsePipelineDecisionArgs(argv.slice(1));
    if (!parsed.ok) {
      io.stderr(subcommand === "approve" ? PIPELINE_APPROVE_USAGE : PIPELINE_REJECT_USAGE);
      return 1;
    }
    return runPipelineMutationCommand(
      subcommand === "approve" ? "pipeline_approve" : "pipeline_reject",
      { pipelineId: parsed.pipelineId, stageId: parsed.stageId },
      "applied",
      invertAppliedRefusedGuardForTest,
      io,
      deps,
    );
  }
  if (subcommand === "resume") {
    const pipelineId = argv[1];
    if (argv.length !== 2 || pipelineId === undefined || pipelineId.trim().length === 0) {
      io.stderr(PIPELINE_RESUME_USAGE);
      return 1;
    }
    return runPipelineMutationCommand(
      "pipeline_resume",
      { pipelineId },
      "resumed",
      invertResumedRefusedGuardForTest,
      io,
      deps,
    );
  }
  io.stderr(PIPELINE_USAGE);
  return 1;
}
