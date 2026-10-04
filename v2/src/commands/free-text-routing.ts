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
import {
  appendRoutingAuditLine,
  normalizedRequestDigest,
  type RoutingAuditLine,
  type RoutingAuditOutcome,
} from "./free-text-routing-audit.ts";
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
    return translateFailure(io, "validation-rejected", rejectionReason(validation.rejection));
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

function admissionFailureReason(
  admission: Extract<PipelineStartAdmissionResult, { kind: "admission-failure" }>,
): string {
  return admission.failure;
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
      audit: {
        outcome: "dispatched",
        reason: admissionFailureReason(admission),
        action: actionName,
        dispatchExitCode: 1,
      },
    };
  }
  io.stdout(`${admission.pipelineId}\n`);
  return {
    exitCode: 0,
    audit: { outcome: "dispatched", action: actionName, dispatchExitCode: 0 },
  };
}

function requireTargetId(io: Io, id: string): number | undefined {
  if (!isTargetId(id)) {
    return routingStderrError(io, "invalid-target-id");
  }
  return undefined;
}

function resolutionRejected(exitCode: number, reason: string, action?: string): DispatchResult {
  return {
    exitCode,
    audit: { outcome: "resolution-rejected", reason, ...(action === undefined ? {} : { action }) },
  };
}

async function dispatchRunAction(
  actionName: RoutingAction["action"],
  targetArgv: string[],
  io: Io,
  cliDeps: CliDeps,
  run: typeof runRunCommand,
): Promise<DispatchResult> {
  const exitCode = await run(targetArgv, io, cliDeps);
  return { exitCode, audit: { outcome: "dispatched", action: actionName, dispatchExitCode: exitCode } };
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
    case "pipeline.approve": {
      const invalid = requireTargetId(io, action.pipelineId);
      if (invalid !== undefined) return resolutionRejected(invalid, "invalid-target-id", action.action);
      const runPipeline = seams.runPipelineCommand ?? runPipelineCommand;
      const exitCode = await runPipeline(["approve", action.pipelineId], io, cliDeps);
      return { exitCode, audit: { outcome: "dispatched", action: action.action, dispatchExitCode: exitCode } };
    }
    case "pipeline.reject": {
      const invalid = requireTargetId(io, action.pipelineId);
      if (invalid !== undefined) return resolutionRejected(invalid, "invalid-target-id", action.action);
      const runPipeline = seams.runPipelineCommand ?? runPipelineCommand;
      const exitCode = await runPipeline(["reject", action.pipelineId], io, cliDeps);
      return { exitCode, audit: { outcome: "dispatched", action: action.action, dispatchExitCode: exitCode } };
    }
    case "pipeline.resume": {
      const invalid = requireTargetId(io, action.pipelineId);
      if (invalid !== undefined) return resolutionRejected(invalid, "invalid-target-id", action.action);
      const runPipeline = seams.runPipelineCommand ?? runPipelineCommand;
      const exitCode = await runPipeline(["resume", action.pipelineId], io, cliDeps);
      return { exitCode, audit: { outcome: "dispatched", action: action.action, dispatchExitCode: exitCode } };
    }
    case "run.kill": {
      const invalid = requireTargetId(io, action.runId);
      if (invalid !== undefined) return resolutionRejected(invalid, "invalid-target-id", action.action);
      return dispatchRunAction(
        action.action,
        ["kill", action.runId],
        io,
        cliDeps,
        seams.runRunCommand ?? runRunCommand,
      );
    }
    case "run.resume": {
      const invalid = requireTargetId(io, action.runId);
      if (invalid !== undefined) return resolutionRejected(invalid, "invalid-target-id", action.action);
      return dispatchRunAction(
        action.action,
        ["resume", action.runId],
        io,
        cliDeps,
        seams.runRunCommand ?? runRunCommand,
      );
    }
    case "run.log": {
      const invalid = requireTargetId(io, action.runId);
      if (invalid !== undefined) return resolutionRejected(invalid, "invalid-target-id", action.action);
      return dispatchRunAction(action.action, ["log", action.runId], io, cliDeps, seams.runRunCommand ?? runRunCommand);
    }
    default: {
      const exitCode = routingStderrError(io, "unknown-action");
      return resolutionRejected(exitCode, "unknown-action");
    }
  }
}

async function recordRoutingAudit(
  normalizedBody: string,
  operatorSessionId: string,
  auditFields: RoutingAuditFields,
  io: Io,
  seams: FreeTextRoutingSeams,
): Promise<void> {
  const digest = normalizedRequestDigest(normalizedBody);
  const line: RoutingAuditLine = {
    at: new Date().toISOString(),
    operatorSessionId,
    ...digest,
    ...auditFields,
  };
  await appendRoutingAuditLine(line, io, seams.routingAuditPath);
}

/** Single orchestration entry for free-text routing: translate, validate, resolve, dispatch. */
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
  await recordRoutingAudit(normalizedBody, operatorSessionId, auditFields, io, seams);
  return exitCode;
}

export { routingCatalogExcerpt };
