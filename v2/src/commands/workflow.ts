import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatRpcError, request } from "../cli/ipc.ts";
import { waitForRunCompletion } from "../cli/run-completion.ts";
import { stripAutoBounceFlag, withAutoBounceDispatch } from "../cli/stale-dispatch.ts";
import { WORKFLOW_IMPLEMENT_USAGE, WORKFLOW_INTENT_USAGE, WORKFLOW_PLAN_USAGE, WORKFLOW_USAGE } from "../cli/usage.ts";
import { readIterationTimeoutMs } from "../config/machine-config-loader.ts";
import { parseStartResult } from "../daemon/daemon-wire.ts";
import type {
  WorkflowPresetBuilder,
  WorkflowPresetBuilderInput,
  WorkflowPresetBuilderResult,
} from "../execution/workflow-presets.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { jarvisHome } from "../paths.ts";
import { resetStaleWorkspace } from "./cleanup.ts";
import {
  type ImplementWorkflowCliInput,
  type IntentWorkflowCliInput,
  LEGACY_WORKFLOW_ALIASES,
  type PlanWorkflowCliInput,
  parseImplementWorkflowArgs,
  parseIntentWorkflowArgs,
  parsePlanWorkflowArgs,
} from "./workflow-args.ts";

function getWorkflowUsage(name: string): string {
  if (name === "intent") return WORKFLOW_INTENT_USAGE;
  if (name === "plan") return WORKFLOW_PLAN_USAGE;
  if (name === "implement") return WORKFLOW_IMPLEMENT_USAGE;
  return WORKFLOW_USAGE;
}

function parseWorkflowArgsByName(args: readonly string[], isIntentPreset: boolean, isPlanPreset: boolean) {
  if (isIntentPreset) {
    return parseIntentWorkflowArgs(args);
  }
  if (isPlanPreset) {
    return parsePlanWorkflowArgs(args);
  }
  return parseImplementWorkflowArgs(args);
}

function buildWorkflowBuilderInput(
  name: string,
  parsed: ImplementWorkflowCliInput | IntentWorkflowCliInput | PlanWorkflowCliInput,
  isIntentPreset: boolean,
  isPlanPreset: boolean,
  deps: CliDeps,
): { ok: true; input: WorkflowPresetBuilderInput } | { ok: false } {
  if (name === "implement") {
    const { ok: _ok, ...launchInput } = parsed as Extract<ImplementWorkflowCliInput, { ok: true }>;
    return {
      ok: true,
      input: {
        cwd: deps.cwd(),
        ...launchInput,
        configPath: deps.machineConfigPath,
        projectRegistry: deps.readProjectRegistry(),
      },
    };
  }
  const parsedRecord = parsed as Record<string, unknown>;
  if (isIntentPreset || isPlanPreset) {
    return {
      ok: true,
      input: { cwd: deps.cwd(), ...parsedRecord, configPath: deps.machineConfigPath } as WorkflowPresetBuilderInput,
    };
  }
  return {
    ok: true,
    input: { cwd: deps.cwd(), ...parsedRecord } as WorkflowPresetBuilderInput,
  };
}

type ResolvedWorkflowPreset = {
  builder: WorkflowPresetBuilder;
  canonicalName: string;
  alias: (typeof LEGACY_WORKFLOW_ALIASES)[string] | undefined;
};

type SuccessfulWorkflowBuild = Extract<WorkflowPresetBuilderResult, { ok: true }>;

function resolveWorkflowPresetBuilder(name: string | undefined, deps: CliDeps): ResolvedWorkflowPreset | undefined {
  if (name === undefined) return undefined;
  const alias = LEGACY_WORKFLOW_ALIASES[name];
  const canonicalName = alias?.canonical ?? name;
  const builder = Object.hasOwn(deps.workflowPresetBuilders, canonicalName)
    ? deps.workflowPresetBuilders[canonicalName]
    : Object.hasOwn(deps.workflowPresetBuilders, name)
      ? deps.workflowPresetBuilders[name]
      : undefined;
  if (builder === undefined) return undefined;
  return { builder, canonicalName, alias };
}

function applyLegacyWorkflowAlias(
  parsed: ImplementWorkflowCliInput | IntentWorkflowCliInput | PlanWorkflowCliInput,
  alias: ResolvedWorkflowPreset["alias"],
  io: Io,
): void {
  if (alias === undefined) return;
  if ("reviewPasses" in parsed && parsed.reviewPasses === undefined) parsed.reviewPasses = alias.passes;
  if ("reviewBehavior" in parsed && parsed.reviewBehavior === undefined) parsed.reviewBehavior = alias.behavior;
  io.stderr(`deprecated: use ${alias.canonical} --review-passes ${alias.passes} --review-behavior ${alias.behavior}\n`);
}

async function prepareWorkflowSteps(
  builder: WorkflowPresetBuilder,
  builderInput: WorkflowPresetBuilderInput,
  machineConfigPath: string,
  io: Io,
): Promise<{ ok: true; steps: SuccessfulWorkflowBuild["steps"]; built: SuccessfulWorkflowBuild } | { ok: false }> {
  const built = await builder(builderInput as Parameters<WorkflowPresetBuilder>[0]);
  if (!built.ok) {
    io.stderr(`${built.error.replace(/\n+$/, "")}\n`);
    return { ok: false };
  }
  let iterationTimeoutMs: number;
  try {
    iterationTimeoutMs = readIterationTimeoutMs(machineConfigPath);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return { ok: false };
  }
  const steps = built.steps.map((step) => (step.behavior === "write" ? { ...step, iterationTimeoutMs } : step));
  return { ok: true, steps, built };
}

/** Workflows whose persistent worktree can go stale between runs; intent stages its own tree. */
const STALE_RESET_WORKFLOWS = new Set(["implement", "plan"]);

async function maybeResetStaleWorkspace(
  canonicalName: string,
  built: SuccessfulWorkflowBuild,
  deps: CliDeps,
  io: Io,
): Promise<number | undefined> {
  if (!STALE_RESET_WORKFLOWS.has(canonicalName)) return undefined;
  const writeStep = built.steps.find((step) => step.behavior === "write");
  const worktree = writeStep?.behavior === "write" ? writeStep.worktree : undefined;
  if (!(worktree?.git !== false && worktree?.projectRoot && worktree.projectName && worktree.branchName)) {
    return undefined;
  }
  const resetResult = await resetStaleWorkspace(
    worktree.projectName,
    worktree.branchName,
    worktree.projectRoot,
    deps.jarvisRoot ?? jarvisHome(),
    deps.subprocessRunner ?? realAsyncSubprocessRunner,
    async () => [],
    io,
  );
  if (resetResult.status === "refused") {
    io.stderr(`Error: Cannot re-run incomplete spec: ${resetResult.reason}\n`);
    return 1;
  }
  return undefined;
}

async function startWorkflowRun(
  client: IpcClient,
  steps: SuccessfulWorkflowBuild["steps"],
  built: SuccessfulWorkflowBuild,
  isIntentPreset: boolean,
  io: Io,
): Promise<number> {
  let result: unknown;
  try {
    result = await request(client, "start", { steps });
  } catch (error) {
    if (error instanceof RpcError) {
      io.stderr(formatRpcError(error));
      return 1;
    }
    throw error;
  }
  const start = parseStartResult(result);
  if (start === undefined) {
    io.stderr("invalid daemon response\n");
    return 1;
  }
  if (isIntentPreset) {
    const intentStep = built.steps[0];
    if (
      intentStep?.behavior === "write" &&
      intentStep.landing?.kind === "intent-stage" &&
      intentStep.publishCompletion === false
    ) {
      io.stderr(`intent paths: ${intentStep.landing.output.durableDir}\n`);
    }
  }
  io.stdout(`${start.runId}\n`);
  return waitForRunCompletion(client, start.runId, io);
}

export async function runWorkflowCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const bounce = stripAutoBounceFlag(argv.slice(1));
  const resolved = resolveWorkflowPresetBuilder(argv[0], deps);
  if (resolved === undefined) {
    io.stderr(WORKFLOW_USAGE);
    return 1;
  }
  const { builder, canonicalName, alias } = resolved;
  const isIntentPreset = canonicalName === "intent";
  const isPlanPreset = canonicalName === "plan";
  const parsed = parseWorkflowArgsByName(bounce.argv, isIntentPreset, isPlanPreset);
  if (!parsed.ok) {
    io.stderr(getWorkflowUsage(canonicalName));
    return 1;
  }
  applyLegacyWorkflowAlias(parsed, alias, io);
  const builderInputResult = buildWorkflowBuilderInput(canonicalName, parsed, isIntentPreset, isPlanPreset, deps);
  if (!builderInputResult.ok) return 1;
  const prepared = await prepareWorkflowSteps(builder, builderInputResult.input, deps.machineConfigPath, io);
  if (!prepared.ok) return 1;
  const resetExitCode = await maybeResetStaleWorkspace(canonicalName, prepared.built, deps, io);
  if (resetExitCode !== undefined) return resetExitCode;
  return withAutoBounceDispatch(io, deps, bounce.autoBounce, async (client) =>
    startWorkflowRun(client, prepared.steps, prepared.built, isIntentPreset, io),
  );
}
