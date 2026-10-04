import { createRoutingAgentBinding, type RoutingInvocationResult } from "../../../shared/invocation/agents.ts";
import { executeWithQuotaFallback } from "../../../shared/invocation/execute.ts";
import { routingFailureOf } from "../../../shared/invocation/routing.ts";
import { buildRoutingTranslatePrompt } from "../../../shared/prompts/routing-translate.ts";
import { findProjectMatch } from "../../../shared/project-registry.ts";
import {
  ROUTING_ACTION_CATALOG,
  type RoutingAction,
  type RoutingRejection,
  validateRoutingRequest,
} from "../cli/free-text-routing-actions.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { request } from "../cli/ipc.ts";
import { connectWithAutoStart } from "../cli/stale-dispatch.ts";
import {
  isLoadError,
  resolveRoutingBindings,
  type AgentModelConfig,
  type LoadError,
} from "../config/agent-model-config.ts";
import { loadMachineConfig, readProjectConfigRecord } from "../config/machine-config-loader.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { resolveProjectPipeline } from "../execution/project-pipeline-resolution.ts";
import type { IpcClient } from "../ipc/client.ts";
import {
  admitPipelineStart,
  type PipelineStartAdmissionDeps,
  type PipelineStartAdmissionInput,
  type PipelineStartAdmissionResult,
} from "./pipeline-start-admission.ts";
import { runPipelineCommand } from "./pipeline.ts";
import { runRunCommand } from "./run.ts";

const ROUTING_STDERR_PREFIX = "free-text-routing:";

const TARGET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RoutingInvocationSeam = (args: { prompt: string; cwd: string }) => Promise<RoutingInvocationResult>;

export type FreeTextRoutingSeams = {
  invokeRouting?: RoutingInvocationSeam;
  admitPipelineStart?: (
    input: PipelineStartAdmissionInput,
    deps: PipelineStartAdmissionDeps,
  ) => Promise<PipelineStartAdmissionResult>;
  runPipelineCommand?: typeof runPipelineCommand;
  runRunCommand?: typeof runRunCommand;
  loadMachineAgents?: (configPath: string) => readonly string[] | undefined;
  loadAgentModelConfig?: (agents: readonly string[]) => AgentModelConfig | LoadError;
};

function routingCatalogExcerpt(): string {
  return Object.entries(ROUTING_ACTION_CATALOG)
    .map(([action, schema]) => {
      const fields = Object.entries(schema)
        .map(([field, spec]) => `${field} (${spec.required ? "required" : "optional"})`)
        .join(", ");
      return `${action}: ${fields}`;
    })
    .join("\n");
}

function routingStderrError(io: Io, reason: string): number {
  io.stderr(`${ROUTING_STDERR_PREFIX} ${reason}\n`);
  return 1;
}

function rejectionReason(rejection: RoutingRejection): string {
  return rejection.reason;
}

function isTargetId(id: string): boolean {
  return TARGET_ID_PATTERN.test(id);
}

function pipelineStartAdmissionDeps(cliDeps: CliDeps): PipelineStartAdmissionDeps {
  return {
    cwd: cliDeps.cwd(),
    configPath: cliDeps.machineConfigPath,
    readProjectRegistry: cliDeps.readProjectRegistry,
    readProjectConfigRecord,
    loadMachineConfig,
    loadAgentModelConfig: cliDeps.loadAgentModelConfig,
    resolveProjectPipeline,
    getPipelineDefinition,
    connect: () => connectWithAutoStart(cliDeps, cliDeps.socketPath),
    request: (connection, method, params) => request(connection as IpcClient, method, params),
  };
}

async function defaultInvokeRouting(
  prompt: string,
  cwd: string,
  cliDeps: CliDeps,
  seams: FreeTextRoutingSeams,
): Promise<RoutingInvocationResult> {
  const loadAgents = seams.loadMachineAgents ?? loadMachineConfig;
  const agents = loadAgents(cliDeps.machineConfigPath);
  if (agents === undefined) {
    return { kind: "error", exitCode: -1, stderr: "missing machine agents configuration" };
  }
  const loadConfig = seams.loadAgentModelConfig ?? cliDeps.loadAgentModelConfig;
  const config = loadConfig(agents);
  if (isLoadError(config)) {
    return { kind: "error", exitCode: -1, stderr: config.errors.join("; ") };
  }
  let bindings;
  try {
    bindings = resolveRoutingBindings(agents, config, (binding) => createRoutingAgentBinding(binding));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error", exitCode: -1, stderr: message };
  }
  const execution = await executeWithQuotaFallback({
    prompt,
    cwd,
    bindings: bindings.bindings,
  });
  const final = execution.final?.result;
  if (final === undefined) {
    return { kind: "error", exitCode: -1, stderr: "routing produced no result" };
  }
  return final;
}

async function translateRequest(
  requestText: string,
  io: Io,
  cliDeps: CliDeps,
  seams: FreeTextRoutingSeams,
): Promise<{ ok: true; action: RoutingAction } | { ok: false; exitCode: number }> {
  const cwd = cliDeps.cwd();
  const prompt = buildRoutingTranslatePrompt({
    cwd,
    requestText,
    actionCatalogExcerpt: routingCatalogExcerpt(),
  });
  const invoke = seams.invokeRouting ?? ((args) => defaultInvokeRouting(args.prompt, args.cwd, cliDeps, seams));
  const result = await invoke({ prompt, cwd });
  const routingFailure = routingFailureOf(result);
  if (routingFailure !== null) {
    return { ok: false, exitCode: routingStderrError(io, routingFailure) };
  }
  if (result.kind === "quota") {
    return { ok: false, exitCode: routingStderrError(io, "quota-exhausted") };
  }
  if (result.kind !== "ok") {
    const detail = result.stderr.trim().length > 0 ? result.stderr.trim() : result.kind;
    if (detail.includes("no agent in the order can run the routing role")) {
      return { ok: false, exitCode: routingStderrError(io, "no-routable-agent") };
    }
    return { ok: false, exitCode: routingStderrError(io, "routing-error") };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, exitCode: routingStderrError(io, "malformed_output") };
  }
  const validation = validateRoutingRequest(parsed);
  if (!validation.ok) {
    return { ok: false, exitCode: routingStderrError(io, rejectionReason(validation.rejection)) };
  }
  return { ok: true, action: validation.action };
}

function resolvePipelineStartProjectKey(
  action: Extract<RoutingAction, { action: "pipeline.start" }>,
  cliDeps: CliDeps,
): { ok: true; projectKey: string } | { ok: false } {
  const registry = cliDeps.readProjectRegistry();
  if (action.project !== undefined) {
    return registry[action.project] === undefined ? { ok: false } : { ok: true, projectKey: action.project };
  }
  const match = findProjectMatch(cliDeps.cwd(), registry);
  return match === undefined ? { ok: false } : { ok: true, projectKey: match.key };
}

async function dispatchPipelineStart(
  action: Extract<RoutingAction, { action: "pipeline.start" }>,
  io: Io,
  cliDeps: CliDeps,
  seams: FreeTextRoutingSeams,
): Promise<number> {
  const project = resolvePipelineStartProjectKey(action, cliDeps);
  if (!project.ok) {
    return routingStderrError(io, "unregistered-project");
  }
  const admit = seams.admitPipelineStart ?? admitPipelineStart;
  const admission = await admit(
    { projectKey: project.projectKey, seedPath: action.seedPath },
    pipelineStartAdmissionDeps(cliDeps),
  );
  if (admission.kind !== "admitted") {
    io.stderr(admission.detail);
    return 1;
  }
  io.stdout(`${admission.pipelineId}\n`);
  return 0;
}

function requireTargetId(io: Io, id: string): number | undefined {
  if (!isTargetId(id)) {
    return routingStderrError(io, "invalid-target-id");
  }
  return undefined;
}

async function dispatchAction(
  action: RoutingAction,
  io: Io,
  cliDeps: CliDeps,
  seams: FreeTextRoutingSeams,
): Promise<number> {
  switch (action.action) {
    case "pipeline.start":
      return dispatchPipelineStart(action, io, cliDeps, seams);
    case "pipeline.approve": {
      const invalid = requireTargetId(io, action.pipelineId);
      if (invalid !== undefined) return invalid;
      const runPipeline = seams.runPipelineCommand ?? runPipelineCommand;
      return runPipeline(["approve", action.pipelineId], io, cliDeps);
    }
    case "pipeline.reject": {
      const invalid = requireTargetId(io, action.pipelineId);
      if (invalid !== undefined) return invalid;
      const runPipeline = seams.runPipelineCommand ?? runPipelineCommand;
      return runPipeline(["reject", action.pipelineId], io, cliDeps);
    }
    case "pipeline.resume": {
      const invalid = requireTargetId(io, action.pipelineId);
      if (invalid !== undefined) return invalid;
      const runPipeline = seams.runPipelineCommand ?? runPipelineCommand;
      return runPipeline(["resume", action.pipelineId], io, cliDeps);
    }
    case "run.kill": {
      const invalid = requireTargetId(io, action.runId);
      if (invalid !== undefined) return invalid;
      const runRun = seams.runRunCommand ?? runRunCommand;
      return runRun(["kill", action.runId], io, cliDeps);
    }
    case "run.resume": {
      const invalid = requireTargetId(io, action.runId);
      if (invalid !== undefined) return invalid;
      const runRun = seams.runRunCommand ?? runRunCommand;
      return runRun(["resume", action.runId], io, cliDeps);
    }
    case "run.log": {
      const invalid = requireTargetId(io, action.runId);
      if (invalid !== undefined) return invalid;
      const runRun = seams.runRunCommand ?? runRunCommand;
      return runRun(["log", action.runId], io, cliDeps);
    }
    default:
      return routingStderrError(io, "unknown-action");
  }
}

/** Single orchestration entry for free-text routing: translate, validate, resolve, dispatch. */
export async function runFreeTextRouting(
  requestText: string,
  io: Io,
  cliDeps: CliDeps,
  _operatorSessionId: string,
  seams: FreeTextRoutingSeams = {},
): Promise<number> {
  const trimmed = requestText.trim();
  if (trimmed.length === 0) {
    return routingStderrError(io, "empty-request");
  }
  const translated = await translateRequest(trimmed, io, cliDeps, seams);
  if (!translated.ok) return translated.exitCode;
  return dispatchAction(translated.action, io, cliDeps, seams);
}

export { routingCatalogExcerpt };
