import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatRpcError, request } from "../cli/ipc.ts";
import { waitForRunCompletion } from "../cli/run-completion.ts";
import { withConnectDispatch } from "../cli/stale-dispatch.ts";
import { WORKFLOW_IMPLEMENT_USAGE, WORKFLOW_INTENT_USAGE, WORKFLOW_PLAN_USAGE, WORKFLOW_USAGE } from "../cli/usage.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import {
  readConfiguredIdleOutputTimeoutMs,
  readReviewRoleTimeoutMs,
  resolveWritePathIterationBounds,
} from "../config/machine-config-loader.ts";
import { parseStartResult } from "../daemon/daemon-wire.ts";
import {
  resolveImplementSpecIdentity,
  validateImplementSpecTreeCompletion,
} from "../execution/implement-workflow-steps.ts";
import { loadWorkflowSteps } from "../execution/workflow-loader.ts";
import type {
  WorkflowPresetBuilder,
  WorkflowPresetBuilderInput,
  WorkflowPresetBuilderResult,
} from "../execution/workflow-presets.ts";
import { DEFAULT_WRITE_STEP_RULES } from "../execution/write-loop-input.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { jarvisHome } from "../paths.ts";
import { createStaleResetDaemonClient, type DestroyedArtifacts, resetStaleWorkspace } from "./cleanup.ts";
import {
  type ImplementWorkflowCliInput,
  type IntentWorkflowCliInput,
  LEGACY_WORKFLOW_ALIASES,
  type PlanWorkflowCliInput,
  parseImplementWorkflowArgs,
  parseIntentWorkflowArgs,
  parsePlanWorkflowArgs,
} from "./workflow-args.ts";

let forceSkipAttachClientWaitForTest = false;
let attachWaitRunIdOverrideForTest: string | undefined;

export function setForceSkipAttachClientWaitForTest(value: boolean): void {
  forceSkipAttachClientWaitForTest = value;
}

export function setAttachWaitRunIdOverrideForTest(runId: string | undefined): void {
  attachWaitRunIdOverrideForTest = runId;
}

function parseWorkflowDetachFlag(argv: readonly string[]): { rest: readonly string[]; detach: boolean } {
  const rest: string[] = [];
  let detach = false;
  for (const arg of argv) {
    if (arg === "--detach") detach = true;
    else rest.push(arg);
  }
  return { rest, detach };
}

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
    const {
      ok: _ok,
      resetDespiteDirty: _resetDespiteDirty,
      ...launchInput
    } = parsed as Extract<ImplementWorkflowCliInput, { ok: true }>;
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
  if (isPlanPreset) {
    const {
      ok: _ok,
      resetDespiteDirty: _resetDespiteDirty,
      ...launchInput
    } = parsed as Extract<PlanWorkflowCliInput, { ok: true }>;
    return {
      ok: true,
      input: { cwd: deps.cwd(), ...launchInput, configPath: deps.machineConfigPath } as WorkflowPresetBuilderInput,
    };
  }
  if (isIntentPreset) {
    const { ok: _ok, ...launchInput } = parsed as Extract<IntentWorkflowCliInput, { ok: true }>;
    return {
      ok: true,
      input: { cwd: deps.cwd(), ...launchInput, configPath: deps.machineConfigPath } as WorkflowPresetBuilderInput,
    };
  }
  return { ok: false };
}

type ResolvedWorkflowPreset = {
  builder: WorkflowPresetBuilder;
  canonicalName: string;
  alias: (typeof LEGACY_WORKFLOW_ALIASES)[string] | undefined;
};

type SuccessfulWorkflowBuild = Extract<WorkflowPresetBuilderResult, { ok: true }>;

type ImplementRecoveryRequest = {
  project: string;
  branch: string;
  specPath: string;
  detach?: boolean;
  mutationRepair?: {
    agents: readonly string[];
    agentModelConfig: AgentModelConfig;
    stepRules: string;
    iterationTimeoutMs: number;
    iterationCeilingMs: number;
    idleOutputMs?: number;
  };
};

function resolveImplementMutationRepair(deps: CliDeps): ImplementRecoveryRequest["mutationRepair"] | undefined {
  try {
    const [step] = loadWorkflowSteps(
      [
        {
          behavior: "write",
          stepId: "implement",
          role: "implement",
          promptId: "patch.prompt.body",
          stepRules: DEFAULT_WRITE_STEP_RULES,
          worktree: { projectRoot: "", projectName: "", branchName: "", baseRef: "" },
          specPath: "",
          expectedArtifactPath: "",
        },
      ],
      { machineConfigPath: deps.machineConfigPath },
    );
    if (step === undefined || step.behavior !== "write") return undefined;
    const bounds = resolveWritePathIterationBounds(deps.machineConfigPath);
    return {
      agents: step.agents,
      agentModelConfig: step.agentModelConfig,
      stepRules: step.stepRules,
      iterationTimeoutMs: bounds.iterationTimeoutMs,
      iterationCeilingMs: bounds.iterationCeilingMs,
      ...(bounds.idleOutputMs !== undefined ? { idleOutputMs: bounds.idleOutputMs } : {}),
    };
  } catch {
    return undefined;
  }
}

function resolveImplementRecoveryRequest(
  parsed: Extract<ImplementWorkflowCliInput, { ok: true }>,
  deps: CliDeps,
): ImplementRecoveryRequest | undefined {
  const registry = deps.readProjectRegistry();
  const identity = resolveImplementSpecIdentity(deps.cwd(), parsed.specPath, registry);
  if ("error" in identity) return undefined;
  const completion = validateImplementSpecTreeCompletion(identity.absoluteSpecPath, identity.projectRoot, (path) =>
    readFileSync(path, "utf8"),
  );
  if (completion !== "implement.already_complete: requested spec has no unchecked non-human-only acceptance criteria") {
    return undefined;
  }
  const mutationRepair = resolveImplementMutationRepair(deps);
  return {
    project: identity.project,
    branch: parsed.branchName ?? basename(dirname(identity.absoluteSpecPath)),
    specPath: identity.specPath,
    ...(mutationRepair !== undefined ? { mutationRepair } : {}),
  };
}

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
  let bounds: ReturnType<typeof resolveWritePathIterationBounds>;
  let configuredIdleOutputMs: number | undefined;
  let reviewRoleTimeoutMs: number;
  try {
    bounds = resolveWritePathIterationBounds(machineConfigPath);
    configuredIdleOutputMs = readConfiguredIdleOutputTimeoutMs(machineConfigPath);
    reviewRoleTimeoutMs = readReviewRoleTimeoutMs(machineConfigPath);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return { ok: false };
  }
  const steps = built.steps.map((step) =>
    step.behavior === "write"
      ? { ...step, ...bounds }
      : step.behavior === "review" || step.behavior === "review-debate"
        ? {
            ...step,
            roleTimeoutMs: reviewRoleTimeoutMs,
            ...(configuredIdleOutputMs === undefined ? {} : { idleOutputMs: configuredIdleOutputMs }),
          }
        : step,
  );
  return { ok: true, steps, built };
}

/** Workflows whose persistent worktree can go stale between runs; intent stages its own tree. */
const STALE_RESET_WORKFLOWS = new Set(["implement", "plan"]);

async function maybeResetStaleWorkspace(
  canonicalName: string,
  built: SuccessfulWorkflowBuild,
  deps: CliDeps,
  io: Io,
  parsed: ImplementWorkflowCliInput | IntentWorkflowCliInput | PlanWorkflowCliInput,
  client: IpcClient,
  onDestroyed?: (destroyed: DestroyedArtifacts) => void,
): Promise<number | undefined> {
  if (!STALE_RESET_WORKFLOWS.has(canonicalName)) return undefined;
  const skipDirtyWorktreeGate = "resetDespiteDirty" in parsed && parsed.resetDespiteDirty === true;
  const writeStep = built.steps.find((step) => step.behavior === "write");
  const worktree = writeStep?.behavior === "write" ? writeStep.worktree : undefined;
  if (!(worktree?.git !== false && worktree?.projectRoot && worktree.projectName && worktree.branchName)) {
    return undefined;
  }
  // Runs inside the connected dispatch scope, so an escaping throw would otherwise be reported as a
  // daemon connection error. Classify reset failures here instead.
  let resetResult: Awaited<ReturnType<typeof resetStaleWorkspace>>;
  try {
    resetResult = await resetStaleWorkspace(
      worktree.projectName,
      worktree.branchName,
      worktree.projectRoot,
      deps.jarvisRoot ?? jarvisHome(),
      deps.subprocessRunner ?? realAsyncSubprocessRunner,
      createStaleResetDaemonClient(client),
      io,
      { skipDirtyWorktreeGate },
    );
  } catch (error) {
    io.stderr(`Error: Stale workspace reset failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if ("destroyed" in resetResult && resetResult.destroyed !== undefined) onDestroyed?.(resetResult.destroyed);
  if (resetResult.status === "refused") {
    if ("code" in resetResult && resetResult.code === "worktree_claimed") {
      io.stderr(`worktree_claimed: ${resetResult.message}\n`);
    } else if ("reason" in resetResult) {
      io.stderr(`Error: Cannot re-run incomplete spec: ${resetResult.reason}\n`);
    }
    return 1;
  }
  return undefined;
}

async function startWorkflowRun(
  client: IpcClient,
  steps: SuccessfulWorkflowBuild["steps"],
  built: SuccessfulWorkflowBuild,
  isIntentPreset: boolean,
  detach: boolean,
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
  const skipClientWait = detach || forceSkipAttachClientWaitForTest;
  if (skipClientWait) return 0;
  return waitForRunCompletion(client, attachWaitRunIdOverrideForTest ?? start.runId, io);
}

async function maybeRecoverImplement(
  client: IpcClient,
  recovery: ImplementRecoveryRequest | undefined,
  detach: boolean,
  io: Io,
): Promise<{ admitted: boolean; exitCode: number }> {
  if (recovery === undefined) return { admitted: false, exitCode: 0 };
  let result: unknown;
  try {
    result = await request(client, "implement.recover", { ...recovery, ...(detach ? { detach: true } : {}) });
  } catch (error) {
    if (error instanceof RpcError) {
      io.stderr(formatRpcError(error));
      return { admitted: true, exitCode: 1 };
    }
    throw error;
  }
  if (typeof result !== "object" || result === null || !("kind" in result)) {
    io.stderr("invalid daemon response\n");
    return { admitted: true, exitCode: 1 };
  }
  const recoveryResult = result as { kind: unknown; ok?: unknown; message?: unknown; prUrl?: unknown };
  if (recoveryResult.kind === "not_admitted") return { admitted: false, exitCode: 0 };
  if (recoveryResult.kind !== "admitted" || typeof recoveryResult.ok !== "boolean") {
    io.stderr("invalid daemon response\n");
    return { admitted: true, exitCode: 1 };
  }
  if (!recoveryResult.ok) {
    io.stderr(
      `${typeof recoveryResult.message === "string" ? recoveryResult.message : "Recovery finalization failed"}\n`,
    );
    return { admitted: true, exitCode: 1 };
  }
  if (typeof recoveryResult.prUrl === "string") io.stdout(`${recoveryResult.prUrl}\n`);
  return { admitted: true, exitCode: 0 };
}

function formatDestroyedArtifactsSummary(destroyed: DestroyedArtifacts): string {
  const lines: string[] = ["Retirement destroyed artifacts:"];
  if (destroyed.worktreePath) lines.push(`  worktree: ${destroyed.worktreePath}`);
  if (destroyed.localBranch) lines.push(`  local branch: ${destroyed.localBranch}`);
  if (destroyed.remoteBranch) lines.push(`  remote branch: ${destroyed.remoteBranch}`);
  if (destroyed.remoteTrackingRef) lines.push(`  remote-tracking ref: ${destroyed.remoteTrackingRef}`);
  if (destroyed.closedPrNumber) lines.push(`  PR: #${destroyed.closedPrNumber}`);
  return lines.join("\n");
}

export async function runWorkflowCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const resolved = resolveWorkflowPresetBuilder(argv[0], deps);
  if (resolved === undefined) {
    io.stderr(WORKFLOW_USAGE);
    return 1;
  }
  const { builder, canonicalName, alias } = resolved;
  const isIntentPreset = canonicalName === "intent";
  const isPlanPreset = canonicalName === "plan";
  const { rest: workflowArgv, detach } = parseWorkflowDetachFlag(argv.slice(1));
  const parsed = parseWorkflowArgsByName(workflowArgv, isIntentPreset, isPlanPreset);
  if (!parsed.ok) {
    io.stderr(getWorkflowUsage(canonicalName));
    return 1;
  }
  applyLegacyWorkflowAlias(parsed, alias, io);
  const builderInputResult = buildWorkflowBuilderInput(canonicalName, parsed, isIntentPreset, isPlanPreset, deps);
  if (!builderInputResult.ok) return 1;
  const recovery =
    canonicalName === "implement"
      ? resolveImplementRecoveryRequest(parsed as Extract<ImplementWorkflowCliInput, { ok: true }>, deps)
      : undefined;
  const initialPreparation =
    recovery === undefined
      ? await prepareWorkflowSteps(builder, builderInputResult.input, deps.machineConfigPath, io)
      : undefined;
  if (initialPreparation !== undefined && !initialPreparation.ok) return 1;
  let destroyedArtifacts: DestroyedArtifacts | undefined;
  const exitCode = await withConnectDispatch(io, deps, async (client) => {
    if (canonicalName === "implement") {
      const recovered = await maybeRecoverImplement(client, recovery, detach, io);
      if (recovered.admitted) return recovered.exitCode;
    }
    const prepared =
      initialPreparation ?? (await prepareWorkflowSteps(builder, builderInputResult.input, deps.machineConfigPath, io));
    if (!prepared.ok) return 1;
    const resetExitCode = await maybeResetStaleWorkspace(
      canonicalName,
      prepared.built,
      deps,
      io,
      parsed,
      client,
      (destroyed) => {
        destroyedArtifacts = destroyed;
      },
    );
    if (resetExitCode !== undefined) return resetExitCode;
    return startWorkflowRun(client, prepared.steps, prepared.built, isIntentPreset, detach, io);
  });
  if (exitCode !== 0 && destroyedArtifacts !== undefined && Object.keys(destroyedArtifacts).length > 0) {
    io.stderr(`${formatDestroyedArtifactsSummary(destroyedArtifacts)}\n`);
  }
  return exitCode;
}
