import { basename } from "node:path";
import { parseArgs } from "node:util";
import {
  PIPELINE_LIST_PARSE_ARG_OPTIONS,
  PIPELINE_RECOVER_PARSE_ARG_OPTIONS,
  PIPELINE_RESUME_PARSE_ARG_OPTIONS,
  PIPELINE_START_PARSE_ARG_OPTIONS,
} from "../cli/command-help-flags.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatConnectionError, formatRpcError, request, withRunClient } from "../cli/ipc.ts";
import { connectWithAutoStart } from "../cli/stale-dispatch.ts";
import {
  PIPELINE_APPROVE_USAGE,
  PIPELINE_DISMISS_USAGE,
  PIPELINE_LIST_USAGE,
  PIPELINE_RECOVER_USAGE,
  PIPELINE_REJECT_USAGE,
  PIPELINE_RESUME_USAGE,
  PIPELINE_START_USAGE,
  PIPELINE_UNDISMISS_USAGE,
  PIPELINE_USAGE,
  PIPELINE_WAIT_USAGE,
} from "../cli/usage.ts";
import { loadMachineConfig, readProjectConfigRecord } from "../config/machine-config-loader.ts";
import { isPipelineTerminal, type PipelineDerivedState } from "../daemon/pipeline-execution.ts";
import type {
  PipelineBoundaryResult,
  PipelineSnapshot,
  PipelineTerminalState,
} from "../daemon/pipeline-observation.ts";
import { getPipelineDefinition } from "../execution/pipeline-registry.ts";
import { resolveProjectPipeline } from "../execution/project-pipeline-resolution.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { admitPipelineStart, type PipelineStartAdmissionInput } from "./pipeline-start-admission.ts";

type PipelineStartCliInput =
  | {
      ok: true;
      input: PipelineStartAdmissionInput;
      detach: boolean;
    }
  | { ok: false };

function parsePipelineWaitBoundary(value: unknown): PipelineBoundaryResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { kind?: unknown; state?: unknown; stageId?: unknown; branchKey?: unknown };
  if (record.kind === "terminal") {
    const state = record.state;
    if (state === "succeeded" || state === "failed" || state === "rejected" || state === "interrupted") {
      return { kind: "terminal", state };
    }
    return undefined;
  }
  if (
    record.kind === "awaiting-approval" &&
    typeof record.stageId === "string" &&
    record.stageId.length > 0 &&
    typeof record.branchKey === "string" &&
    record.branchKey.length > 0
  ) {
    return { kind: "awaiting-approval", stageId: record.stageId, branchKey: record.branchKey };
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

export type PipelineMutationOutcome = { kind: "applied" } | { kind: "resumed" } | { kind: "refused"; reason: string };

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
): { ok: true; pipelineId: string; stageId: string; branchKey: string } | { ok: false } {
  if (argv.length !== 3) return { ok: false };
  const pipelineId = argv[0];
  const stageId = argv[1];
  const branchKey = argv[2];
  if (pipelineId === undefined || stageId === undefined || branchKey === undefined) return { ok: false };
  if (pipelineId.trim().length === 0 || stageId.trim().length === 0 || branchKey.trim().length === 0) {
    return { ok: false };
  }
  return { ok: true, pipelineId, stageId, branchKey };
}

type PipelineStaleResetOverrideFlags = {
  resetDespiteDirty?: boolean;
  resetDespiteLandedCriteria?: boolean;
};

type PipelineRpcParams = Record<string, string | boolean>;

function readStaleResetOverrideFlags(
  values: Record<string, string | boolean | undefined>,
): PipelineStaleResetOverrideFlags {
  const resetDespiteDirty = values["reset-despite-dirty"] === true;
  const resetDespiteLandedCriteria = values["reset-despite-landed-criteria"] === true;
  return {
    ...(resetDespiteDirty ? { resetDespiteDirty: true } : {}),
    ...(resetDespiteLandedCriteria ? { resetDespiteLandedCriteria: true } : {}),
  };
}

function parsePipelineResumeArgs(
  argv: readonly string[],
): ({ ok: true; pipelineId: string; branchKey?: string } & PipelineStaleResetOverrideFlags) | { ok: false } {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: PIPELINE_RESUME_PARSE_ARG_OPTIONS,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch {
    return { ok: false };
  }

  if (positionals.length < 1 || positionals.length > 2) return { ok: false };
  const pipelineId = positionals[0];
  if (pipelineId === undefined || pipelineId.trim().length === 0) return { ok: false };
  const branchKey = positionals[1];
  if (branchKey !== undefined && branchKey.trim().length === 0) return { ok: false };

  return {
    ok: true,
    pipelineId,
    ...(branchKey !== undefined ? { branchKey } : {}),
    ...readStaleResetOverrideFlags(values),
  };
}

function parsePipelineRecoverArgs(
  argv: readonly string[],
): ({ ok: true; pipelineId: string; branchKey: string } & PipelineStaleResetOverrideFlags) | { ok: false } {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: PIPELINE_RECOVER_PARSE_ARG_OPTIONS,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch {
    return { ok: false };
  }

  if (positionals.length !== 2) return { ok: false };
  const pipelineId = positionals[0];
  const branchKey = positionals[1];
  if (pipelineId === undefined || branchKey === undefined) return { ok: false };
  if (pipelineId.trim().length === 0 || branchKey.trim().length === 0) return { ok: false };

  return {
    ok: true,
    pipelineId,
    branchKey,
    ...readStaleResetOverrideFlags(values),
  };
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
    return { ok: true, input: { projectKey, seedText }, detach };
  }
  if (seedPath !== undefined) {
    return { ok: true, input: { projectKey, seedPath }, detach };
  }
  return { ok: false };
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

async function runPipelineStartCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const parsed = parsePipelineStartArgs(argv);
  if (!parsed.ok) {
    io.stderr(PIPELINE_START_USAGE);
    return 1;
  }

  let attachedClient: IpcClient | undefined;
  const admission = await admitPipelineStart(parsed.input, {
    cwd: deps.cwd(),
    configPath: deps.machineConfigPath,
    readProjectRegistry: deps.readProjectRegistry,
    readProjectConfigRecord,
    loadMachineConfig,
    loadAgentModelConfig: deps.loadAgentModelConfig,
    resolveProjectPipeline,
    getPipelineDefinition,
    connect: () => connectWithAutoStart(deps, deps.socketPath),
    ...(parsed.detach
      ? {}
      : {
          retainConnection: (connection: { close(): void }) => {
            attachedClient = connection as IpcClient;
            return true;
          },
        }),
    request: (connection, method, params) => request(connection as IpcClient, method, params),
  });
  if (admission.kind !== "admitted") {
    io.stderr(admission.detail);
    return 1;
  }

  io.stdout(`${admission.pipelineId}\n`);
  if (parsed.detach) return 0;
  if (attachedClient === undefined) {
    io.stderr("pipeline: admitted connection unavailable\n");
    return 1;
  }
  try {
    return await waitForPipelineTerminal(attachedClient, admission.pipelineId, io, deps);
  } finally {
    attachedClient.close();
  }
}

type PipelineListDeps = CliDeps & { now: () => number };

type PipelineListCliInput =
  | { ok: true; json: boolean; all: boolean; since: number | undefined; state: PipelineDerivedState | undefined }
  | { ok: false };

const PIPELINE_LIST_STATE_VALUES: ReadonlySet<string> = new Set([
  "pending",
  "running",
  "awaiting-approval",
  "succeeded",
  "failed",
  "rejected",
  "interrupted",
]);

function parsePipelineListStateValue(value: string): PipelineDerivedState | undefined {
  return PIPELINE_LIST_STATE_VALUES.has(value) ? (value as PipelineDerivedState) : undefined;
}

const PIPELINE_LIST_TIME_UNITS = [
  { unit: "d", ms: 86_400_000 },
  { unit: "h", ms: 3_600_000 },
  { unit: "m", ms: 60_000 },
  { unit: "s", ms: 1_000 },
] as const;

function parsePipelineListSince(value: string, nowMs: number): number | undefined {
  const durationMatch = /^(\d+)([dhms])$/.exec(value);
  if (durationMatch !== null) {
    const amount = Number(durationMatch[1]);
    const unit = PIPELINE_LIST_TIME_UNITS.find((candidate) => candidate.unit === durationMatch[2]);
    if (!Number.isInteger(amount) || amount <= 0 || unit === undefined) return undefined;
    return nowMs - amount * unit.ms;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parsePipelineListArgs(argv: readonly string[], nowMs: number): PipelineListCliInput {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: PIPELINE_LIST_PARSE_ARG_OPTIONS,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch {
    return { ok: false };
  }
  if (positionals.length !== 0) return { ok: false };

  const json = values.json === true;
  const all = values.all === true;

  let since: number | undefined;
  if (values.since !== undefined) {
    if (typeof values.since !== "string") return { ok: false };
    const parsedSince = parsePipelineListSince(values.since, nowMs);
    if (parsedSince === undefined) return { ok: false };
    since = parsedSince;
  }

  let state: PipelineDerivedState | undefined;
  if (values.state !== undefined) {
    if (typeof values.state !== "string") return { ok: false };
    const parsedState = parsePipelineListStateValue(values.state);
    if (parsedState === undefined) return { ok: false };
    state = parsedState;
  }

  return { ok: true, json, all, since, state };
}

function selectPipelines(
  pipelines: readonly PipelineSnapshot[],
  cutoff: number,
  state: PipelineDerivedState | undefined,
): PipelineSnapshot[] {
  return pipelines
    .filter((pipeline) => {
      // Mutation checkpoint: returning true unconditionally must turn the cutoff/state filter tests RED.
      return pipeline.createdAt >= cutoff && (state === undefined || pipeline.state === state);
    })
    .sort((a, b) =>
      a.createdAt !== b.createdAt ? b.createdAt - a.createdAt : a.pipelineId.localeCompare(b.pipelineId),
    );
}

function formatPipelineCreatedAge(createdAt: number, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - createdAt);
  for (const { unit, ms } of PIPELINE_LIST_TIME_UNITS) {
    const amount = Math.floor(elapsedMs / ms);
    if (amount > 0) return `${amount}${unit}`;
  }
  return "0s";
}

const STAGE_STATUS_GLYPHS = [
  ["interrupted", "!"],
  ["rejected", "✗"],
  ["failed", "✗"],
  ["running", "●"],
  ["awaiting", "?"],
  ["pending", "·"],
  ["skipped", "–"],
  ["approved", "✓"],
  ["succeeded", "✓"],
] as const;

function stageGroupGlyph(statuses: readonly string[]): string {
  for (const [status, glyph] of STAGE_STATUS_GLYPHS) {
    if (statuses.includes(status)) return glyph;
  }
  return "?";
}

function renderStageSummary(stages: PipelineSnapshot["stages"]): string {
  const groups = new Map<string, { position: number; statuses: string[] }>();
  for (const stage of stages) {
    const group = groups.get(stage.stageId);
    if (group === undefined) {
      groups.set(stage.stageId, { position: stage.position, statuses: [stage.status] });
    } else {
      group.statuses.push(stage.status);
      group.position = Math.min(group.position, stage.position);
    }
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => a.position - b.position)
    .map(([stageId, group]) => {
      const suffix = group.statuses.length > 1 ? `×${group.statuses.length}` : "";
      return `${stageGroupGlyph(group.statuses)}${stageId}${suffix}`;
    })
    .join(" ");
}

function seedBasename(seedPath: string | undefined): string {
  return seedPath === undefined ? "-" : basename(seedPath);
}

function renderPipelineListRows(pipelines: readonly PipelineSnapshot[], nowMs: number, showDismissal: boolean): string {
  return `${pipelines
    .map((pipeline) =>
      [
        pipeline.pipelineId.slice(0, 8),
        pipeline.name,
        pipeline.state,
        seedBasename(pipeline.seedPath),
        formatPipelineCreatedAge(pipeline.createdAt, nowMs),
        renderStageSummary(pipeline.stages),
        // Mutation checkpoint: replacing this conditional spread with `...[]` must turn the
        // --all dismissal-marker test RED; replacing it with an unconditional spread must
        // turn the without-`--all` no-marker test RED.
        ...(showDismissal ? [typeof pipeline.dismissedAt === "number" ? "dismissed" : "-"] : []),
      ].join("\t"),
    )
    .join("\n")}\n`;
}

async function runPipelineListCommand(argv: readonly string[], io: Io, deps: PipelineListDeps): Promise<number> {
  const parsed = parsePipelineListArgs(argv, deps.now());
  if (!parsed.ok) {
    io.stderr(PIPELINE_LIST_USAGE);
    return 1;
  }
  if (parsed.json && (parsed.since !== undefined || parsed.state !== undefined)) {
    io.stderr(PIPELINE_LIST_USAGE);
    return 1;
  }

  return withRunClient(io, deps, async (client) => {
    try {
      const result = await request(client, "pipeline_list", parsed.all ? { includeDismissed: true } : undefined);
      const snapshot = readPipelineListResult(result);
      if (snapshot === undefined) {
        io.stderr("invalid daemon response\n");
        return 1;
      }

      if (parsed.json) {
        io.stdout(`${JSON.stringify(snapshot)}\n`);
        return 0;
      }

      const cutoff = parsed.since ?? -Infinity;
      const selected = selectPipelines(snapshot.pipelines as PipelineSnapshot[], cutoff, parsed.state);
      if (selected.length === 0) {
        io.stdout("No pipelines.\n");
        return 0;
      }
      io.stdout(renderPipelineListRows(selected, deps.now(), parsed.all));
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

async function requestPipelineRpc(
  client: IpcClient,
  method: string,
  params: PipelineRpcParams,
  io: Io,
): Promise<{ ok: true; response: unknown } | { ok: false }> {
  try {
    return { ok: true, response: await request(client, method, params) };
  } catch (error) {
    io.stderr(error instanceof RpcError ? formatRpcError(error) : formatConnectionError(error));
    return { ok: false };
  }
}

async function runPipelineMutationCommand(
  method: "pipeline_approve" | "pipeline_reject" | "pipeline_resume",
  params: PipelineRpcParams,
  successKind: "applied" | "resumed",
  io: Io,
  deps: CliDeps,
): Promise<number> {
  return withRunClient(io, deps, async (client) => {
    const result = await requestPipelineRpc(client, method, params, io);
    if (!result.ok) return 1;
    const outcome = parsePipelineMutationOutcome(result.response, successKind);
    if (outcome === undefined) {
      io.stderr("invalid daemon response\n");
      return 1;
    }
    if (outcome.kind === "refused") {
      io.stderr(`${outcome.reason}\n`);
    }
    // Mutation checkpoint: returning 0 unconditionally must turn the refused-decision
    // exit-code tests RED.
    return outcome.kind === successKind ? 0 : 1;
  });
}

export type PipelineRecoverOutcome =
  | { kind: "admitted"; pipelineId: string; branchKey: string; stageId: string; entryRunId: string }
  | { kind: "resolution_refused"; pipelineId: string; branchKey: string; reason: string; message: string }
  | { kind: "stage_claimed"; pipelineId: string; branchKey: string; stageId: string };

const PIPELINE_RECOVER_RESULT_KINDS: ReadonlySet<string> = new Set(["admitted", "resolution_refused", "stage_claimed"]);

function isNonEmptyString(field: unknown): field is string {
  return typeof field === "string" && field.length > 0;
}

function parsePipelineRecoverOutcome(value: unknown): PipelineRecoverOutcome | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as {
    kind?: unknown;
    pipelineId?: unknown;
    branchKey?: unknown;
    stageId?: unknown;
    entryRunId?: unknown;
    reason?: unknown;
    message?: unknown;
  };
  if (typeof record.kind !== "string" || !PIPELINE_RECOVER_RESULT_KINDS.has(record.kind)) return undefined;
  if (!isNonEmptyString(record.pipelineId) || !isNonEmptyString(record.branchKey)) return undefined;
  if (record.kind === "admitted" && (!isNonEmptyString(record.stageId) || !isNonEmptyString(record.entryRunId))) {
    return undefined;
  }
  if (record.kind === "resolution_refused" && (!isNonEmptyString(record.reason) || !isNonEmptyString(record.message))) {
    return undefined;
  }
  if (record.kind === "stage_claimed" && !isNonEmptyString(record.stageId)) return undefined;
  return record as PipelineRecoverOutcome;
}

async function runPipelineRecoverCommand(
  params: { pipelineId: string; branchKey: string } & PipelineStaleResetOverrideFlags,
  io: Io,
  deps: CliDeps,
): Promise<number> {
  const { pipelineId, branchKey, resetDespiteDirty, resetDespiteLandedCriteria } = params;
  return withRunClient(io, deps, async (client) => {
    const result = await requestPipelineRpc(
      client,
      "pipeline_recover",
      {
        pipelineId,
        branchKey,
        ...(resetDespiteDirty ? { resetDespiteDirty: true } : {}),
        ...(resetDespiteLandedCriteria ? { resetDespiteLandedCriteria: true } : {}),
      },
      io,
    );
    if (!result.ok) return 1;
    const outcome = parsePipelineRecoverOutcome(result.response);
    if (outcome === undefined) {
      io.stderr("invalid daemon response\n");
      return 1;
    }
    if (outcome.kind === "resolution_refused") {
      io.stderr(`${outcome.reason}: ${outcome.message}\n`);
    }
    if (outcome.kind === "stage_claimed") {
      io.stderr(`pipeline recover: stage ${outcome.stageId} is claimed by another operation\n`);
    }
    if (outcome.kind === "admitted") {
      io.stdout(`${JSON.stringify(outcome)}\n`);
    }
    // Mutation checkpoint: returning 0 unconditionally must turn the refusal exit-code tests RED.
    return outcome.kind === "admitted" ? 0 : 1;
  });
}

export type PipelineDismissalOutcome =
  | { kind: "applied"; pipelineId: string; state: PipelineDerivedState }
  | { kind: "refused"; pipelineId: string; reason: string };

function parsePipelineDismissalArgs(argv: readonly string[]): { ok: true; pipelineId: string } | { ok: false } {
  if (argv.length !== 1) return { ok: false };
  const pipelineId = argv[0];
  if (pipelineId === undefined || pipelineId.trim().length === 0) return { ok: false };
  return { ok: true, pipelineId };
}

function parsePipelineDismissalOutcome(value: unknown): PipelineDismissalOutcome | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as { kind?: unknown; pipelineId?: unknown; state?: unknown; reason?: unknown };
  if (!isNonEmptyString(record.pipelineId)) return undefined;
  if (record.kind === "applied") {
    if (typeof record.state !== "string") return undefined;
    const state = parsePipelineListStateValue(record.state);
    if (state === undefined) return undefined;
    return { kind: "applied", pipelineId: record.pipelineId, state };
  }
  if (record.kind === "refused" && typeof record.reason === "string") {
    return { kind: "refused", pipelineId: record.pipelineId, reason: record.reason };
  }
  return undefined;
}

async function runPipelineDismissalCommand(
  mode: "dismiss" | "undismiss",
  pipelineId: string,
  io: Io,
  deps: CliDeps,
): Promise<number> {
  return withRunClient(io, deps, async (client) => {
    const method = mode === "dismiss" ? "pipeline_dismiss" : "pipeline_undismiss";
    const result = await requestPipelineRpc(client, method, { pipelineId }, io);
    if (!result.ok) return 1;
    const outcome = parsePipelineDismissalOutcome(result.response);
    if (outcome === undefined) {
      io.stderr("invalid daemon response\n");
      return 1;
    }
    if (outcome.kind !== "applied") {
      io.stderr(`${outcome.reason}\n`);
      return 1;
    }
    // Mutation checkpoint: neutering this guard to `if (false)` must drop the live-state
    // warning, turning the live-pipeline-dismissal test RED.
    if (mode === "dismiss" && !isPipelineTerminal(outcome.state)) {
      io.stderr(`pipeline dismiss: ${outcome.pipelineId} is ${outcome.state} and now hidden from listings\n`);
    }
    io.stdout(`pipeline ${mode}: ${outcome.pipelineId}\n`);
    return 0;
  });
}

export async function runPipelineCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const subcommand = argv[0];
  if (subcommand === "start") {
    return runPipelineStartCommand(argv.slice(1), io, deps);
  }
  if (subcommand === "list") {
    return runPipelineListCommand(argv.slice(1), io, { ...deps, now: deps.now ?? (() => Date.now()) });
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
      // Mutation checkpoint: dropping `branchKey` here must turn the branch-scoped
      // approve/reject RPC tests RED.
      { pipelineId: parsed.pipelineId, stageId: parsed.stageId, branchKey: parsed.branchKey },
      "applied",
      io,
      deps,
    );
  }
  return runPipelineControlSubcommand(subcommand, argv, io, deps);
}

/** Tail of the pipeline dispatcher: resume/recover/dismiss/undismiss and the usage fallback,
 * split out of {@link runPipelineCommand} to keep each under the cognitive-complexity budget. */
async function runPipelineControlSubcommand(
  subcommand: string | undefined,
  argv: readonly string[],
  io: Io,
  deps: CliDeps,
): Promise<number> {
  if (subcommand === "resume") {
    const parsed = parsePipelineResumeArgs(argv.slice(1));
    if (!parsed.ok) {
      io.stderr(PIPELINE_RESUME_USAGE);
      return 1;
    }
    return runPipelineMutationCommand(
      "pipeline_resume",
      // Mutation checkpoint: dropping `branchKey` here must turn the branch-scoped resume RPC test RED.
      {
        pipelineId: parsed.pipelineId,
        ...(parsed.branchKey !== undefined ? { branchKey: parsed.branchKey } : {}),
        ...(parsed.resetDespiteDirty ? { resetDespiteDirty: true } : {}),
        ...(parsed.resetDespiteLandedCriteria ? { resetDespiteLandedCriteria: true } : {}),
      },
      "resumed",
      io,
      deps,
    );
  }
  if (subcommand === "recover") {
    const parsed = parsePipelineRecoverArgs(argv.slice(1));
    if (!parsed.ok) {
      io.stderr(PIPELINE_RECOVER_USAGE);
      return 1;
    }
    return runPipelineRecoverCommand(parsed, io, deps);
  }
  if (subcommand === "dismiss" || subcommand === "undismiss") {
    const parsed = parsePipelineDismissalArgs(argv.slice(1));
    if (!parsed.ok) {
      io.stderr(subcommand === "dismiss" ? PIPELINE_DISMISS_USAGE : PIPELINE_UNDISMISS_USAGE);
      return 1;
    }
    return runPipelineDismissalCommand(subcommand, parsed.pipelineId, io, deps);
  }
  io.stderr(PIPELINE_USAGE);
  return 1;
}
