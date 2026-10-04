import type { CliDeps } from "../cli/deps.ts";
import {
  ROUTING_ACTION_CATALOG,
  type RoutingAction,
  validateRoutingRequest,
} from "../cli/free-text-routing-actions.ts";
import type { Io } from "../cli/io.ts";
import { request } from "../cli/ipc.ts";
import { connectWithAutoStart } from "../cli/stale-dispatch.ts";
import {
  type AgentModelConfig,
  isLoadError,
  type LoadError,
  resolveRoutingBindings,
} from "../config/agent-model-config.ts";
import { loadMachineConfig, readProjectConfigRecord } from "../config/machine-config-loader.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { resolveProjectPipeline } from "../execution/project-pipeline-resolution.ts";
import type { IpcClient } from "../ipc/client.ts";
import { createRoutingAgentBinding, type RoutingInvocationResult } from "../shared/invocation/agents.ts";
import { executeWithQuotaFallback } from "../shared/invocation/execute.ts";
import { routingFailureOf } from "../shared/invocation/routing.ts";
import { findProjectMatch } from "../shared/project-registry.ts";
import { buildRoutingTranslatePrompt } from "../shared/prompts/routing-translate.ts";
import {
  appendRoutingAuditLine,
  normalizedRequestDigest,
  type RoutingAuditLine,
  type RoutingAuditOutcome,
} from "./free-text-routing-audit.ts";
import { runPipelineCommand } from "./pipeline.ts";
import {
  admitPipelineStart,
  type PipelineStartAdmissionDeps,
  type PipelineStartAdmissionInput,
  type PipelineStartAdmissionResult,
} from "./pipeline-start-admission.ts";
import { runRunCommand } from "./run.ts";

export const FREE_TEXT_ROUTING_STDERR_PREFIX = "free-text-routing:";

const TARGET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RoutingInvocationSeam = (args: { prompt: string; cwd: string }) => Promise<RoutingInvocationResult>;

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
  routingAuditPath?: string;
};

type RoutingAuditFields = Pick<RoutingAuditLine, "outcome" | "reason" | "action" | "dispatchExitCode">;

type TranslateResult = { ok: true; action: RoutingAction } | { ok: false; exitCode: number; audit: RoutingAuditFields };

type DispatchResult = { exitCode: number; audit: RoutingAuditFields };

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
  io.stderr(`${FREE_TEXT_ROUTING_STDERR_PREFIX} ${reason}\n`);
  return 1;
}

function dispatchedResult(exitCode: number, action: string): DispatchResult {
  return { exitCode, audit: { outcome: "dispatched", action, dispatchExitCode: exitCode } };
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

/** Routing binding resolution as a value: a refusal (no eligible vendor) becomes the command's error result. */
function resolveBindingsOrError(agents: readonly string[], config: Parameters<typeof resolveRoutingBindings>[1]) {
  try {
    return resolveRoutingBindings(agents, config, (binding) => createRoutingAgentBinding(binding));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error" as const, exitCode: -1, stderr: message };
  }
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
  const bindings = resolveBindingsOrError(agents, config);
  if ("stderr" in bindings) return bindings;
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

function translateFailure(
  io: Io,
  outcome: RoutingAuditOutcome,
  reason: string,
): { ok: false; exitCode: number; audit: RoutingAuditFields } {
  return { ok: false, exitCode: routingStderrError(io, reason), audit: { outcome, reason } };
}

async function translateRequest(
  requestText: string,
  io: Io,
  cliDeps: CliDeps,
  seams: FreeTextRoutingSeams,
): Promise<TranslateResult> {
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
    return translateFailure(io, "routing-rejected", routingFailure);
  }
  if (result.kind === "quota") {
    return translateFailure(io, "routing-failed", "quota-exhausted");
  }
  if (result.kind !== "ok") {
    const detail = result.stderr.trim().length > 0 ? result.stderr.trim() : result.kind;
    if (detail.includes("no agent in the order can run the routing role")) {
      return translateFailure(io, "routing-failed", "no-routable-agent");
    }
    return translateFailure(io, "routing-failed", "routing-error");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return translateFailure(io, "routing-failed", "malformed_output");
  }
  const validation = validateRoutingRequest(parsed);
  if (!validation.ok) {
    return translateFailure(io, "validation-rejected", validation.rejection.reason);
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
): Promise<DispatchResult> {
  const actionName = action.action;
  const project = resolvePipelineStartProjectKey(action, cliDeps);
  if (!project.ok) {
    return {
      exitCode: routingStderrError(io, "unregistered-project"),
      audit: { outcome: "resolution-rejected", reason: "unregistered-project", action: actionName },
    };
  }
  const admit = seams.admitPipelineStart ?? admitPipelineStart;
  const admission = await admit(
    { projectKey: project.projectKey, seedPath: action.seedPath },
    pipelineStartAdmissionDeps(cliDeps),
  );
  if (admission.kind === "pre-admission-failure") {
    io.stderr(admission.detail);
    return {
      exitCode: 1,
      audit: { outcome: "resolution-rejected", reason: admission.failure, action: actionName, dispatchExitCode: 1 },
    };
  }
  if (admission.kind === "admission-failure") {
    io.stderr(admission.detail);
    return {
      exitCode: 1,
      audit: { outcome: "dispatched", reason: admission.failure, action: actionName, dispatchExitCode: 1 },
    };
  }
  io.stdout(`${admission.pipelineId}\n`);
  return dispatchedResult(0, actionName);
}

function requireTargetId(io: Io, id: string): number | undefined {
  return TARGET_ID_PATTERN.test(id) ? undefined : routingStderrError(io, "invalid-target-id");
}

function resolutionRejected(exitCode: number, reason: string, action?: string): DispatchResult {
  return {
    exitCode,
    audit: { outcome: "resolution-rejected", reason, ...(action === undefined ? {} : { action }) },
  };
}

async function dispatchPipelineIdVerb(
  action: Extract<RoutingAction, { action: "pipeline.approve" | "pipeline.reject" | "pipeline.resume" }>,
  subcommand: "approve" | "reject" | "resume",
  io: Io,
  cliDeps: CliDeps,
  seams: FreeTextRoutingSeams,
): Promise<DispatchResult> {
  const invalid = requireTargetId(io, action.pipelineId);
  if (invalid !== undefined) return resolutionRejected(invalid, "invalid-target-id", action.action);
  const runPipeline = seams.runPipelineCommand ?? runPipelineCommand;
  return dispatchedResult(await runPipeline([subcommand, action.pipelineId], io, cliDeps), action.action);
}

async function dispatchRunIdVerb(
  action: Extract<RoutingAction, { action: "run.kill" | "run.resume" | "run.log" }>,
  subcommand: "kill" | "resume" | "log",
  io: Io,
  cliDeps: CliDeps,
  seams: FreeTextRoutingSeams,
): Promise<DispatchResult> {
  const targetId = action.runId;
  const invalid = requireTargetId(io, targetId);
  if (invalid !== undefined) return resolutionRejected(invalid, "invalid-target-id", action.action);
  const run = seams.runRunCommand ?? runRunCommand;
  return dispatchedResult(await run([subcommand, targetId], io, cliDeps), action.action);
}

async function dispatchAction(
  action: RoutingAction,
  io: Io,
  cliDeps: CliDeps,
  seams: FreeTextRoutingSeams,
): Promise<DispatchResult> {
  switch (action.action) {
    case "pipeline.start":
      return dispatchPipelineStart(action, io, cliDeps, seams);
    case "pipeline.approve":
      return dispatchPipelineIdVerb(action, "approve", io, cliDeps, seams);
    case "pipeline.reject":
      return dispatchPipelineIdVerb(action, "reject", io, cliDeps, seams);
    case "pipeline.resume":
      return dispatchPipelineIdVerb(action, "resume", io, cliDeps, seams);
    case "run.kill":
      return dispatchRunIdVerb(action, "kill", io, cliDeps, seams);
    case "run.resume":
      return dispatchRunIdVerb(action, "resume", io, cliDeps, seams);
    case "run.log":
      return dispatchRunIdVerb(action, "log", io, cliDeps, seams);
    default: {
      const exitCode = routingStderrError(io, "unknown-action");
      return resolutionRejected(exitCode, "unknown-action");
    }
  }
}

export async function runFreeTextRouting(
  requestText: string,
  io: Io,
  cliDeps: CliDeps,
  operatorSessionId: string,
  seams: FreeTextRoutingSeams = {},
): Promise<number> {
  const normalizedBody = requestText.trim();
  let auditFields: RoutingAuditFields;
  let exitCode: number;
  if (normalizedBody.length === 0) {
    auditFields = { outcome: "validation-rejected", reason: "empty-request" };
    exitCode = routingStderrError(io, "empty-request");
  } else {
    const translated = await translateRequest(normalizedBody, io, cliDeps, seams);
    if (!translated.ok) {
      auditFields = translated.audit;
      exitCode = translated.exitCode;
    } else {
      const dispatched = await dispatchAction(translated.action, io, cliDeps, seams);
      auditFields = dispatched.audit;
      exitCode = dispatched.exitCode;
    }
  }
  await appendRoutingAuditLine(
    {
      at: new Date().toISOString(),
      operatorSessionId,
      ...normalizedRequestDigest(normalizedBody),
      ...auditFields,
    },
    io,
    seams.routingAuditPath,
  );
  return exitCode;
}

export { routingCatalogExcerpt };
