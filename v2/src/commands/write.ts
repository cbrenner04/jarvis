import type { CliDeps } from "../cli/deps.ts";
import { exitCodeForWriteResult } from "../cli/run-completion.ts";
import type { AgentModelConfig, LoadError } from "../config/agent-model-config.ts";
import { loadMachineConfig, resolveWritePathIterationBounds } from "../config/machine-config-loader.ts";
import type { WriteLoopInput, WriteLoopResult } from "../execution/write-loop.ts";
import {
  buildWriteLoopInputFromCliValues,
  DEFAULT_WRITE_AGENTS,
  parseWriteArgs,
} from "../execution/write-loop-input.ts";

export type WriteCliInput = { ok: true; input: WriteLoopInput } | { ok: false; message?: string };

function isLoadError(value: AgentModelConfig | LoadError): value is LoadError {
  return "errors" in value && Array.isArray((value as LoadError).errors);
}

export function parseWriteCliInput(argv: readonly string[], deps: CliDeps): WriteCliInput {
  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    values = parseWriteArgs(argv);
  } catch {
    return { ok: false };
  }

  let fallbackAgents: readonly string[] | undefined;
  try {
    fallbackAgents = loadMachineConfig(deps.machineConfigPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `${message}\n` };
  }

  const agents = fallbackAgents ?? DEFAULT_WRITE_AGENTS;
  let agentModelConfig: AgentModelConfig | LoadError;
  try {
    agentModelConfig = deps.loadAgentModelConfig(agents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `${message}\n` };
  }
  if (isLoadError(agentModelConfig)) {
    return { ok: false, message: `Failed to load agent model config: ${agentModelConfig.errors.join(", ")}\n` };
  }

  const built = buildWriteLoopInputFromCliValues(values, agentModelConfig, fallbackAgents);
  if (!built.ok) {
    return { ok: false };
  }
  try {
    const bounds = resolveWritePathIterationBounds(deps.machineConfigPath);
    return { ok: true, input: { ...built.input, ...bounds } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `${message}\n` };
  }
}

export function writeStdoutJson(result: WriteLoopResult): string {
  const payload: Record<string, unknown> = {
    kind: result.kind,
    runId: result.runId,
    iterationsConsumed: result.iterationsConsumed,
    resumable: result.resumable,
  };
  if (result.failureKind !== undefined) {
    payload.failureKind = result.failureKind;
    payload.bindingAttempts = result.bindingAttempts;
  }
  if (result.commitSha !== undefined) payload.commitSha = result.commitSha;
  if (result.completionCommitError !== undefined) payload.completionCommitError = result.completionCommitError;
  if (result.readyGateError !== undefined) payload.readyGateError = result.readyGateError;
  if (result.readyGateOutsidePaths !== undefined) payload.readyGateOutsidePaths = result.readyGateOutsidePaths;
  if (result.readyGateOutOfScopeDetail !== undefined)
    payload.readyGateOutOfScopeDetail = result.readyGateOutOfScopeDetail;
  if (result.readyFlipError !== undefined) payload.readyFlipError = result.readyFlipError;
  if (result.publicationFailure !== undefined) payload.publicationFailure = result.publicationFailure;
  return JSON.stringify(payload, null, 2);
}

export { exitCodeForWriteResult };
