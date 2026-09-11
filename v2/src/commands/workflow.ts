import { existsSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatRpcError, request } from "../cli/ipc.ts";
import { waitForRunCompletion } from "../cli/run-completion.ts";
import { withConnectDispatch } from "../cli/stale-dispatch.ts";
import { WORKFLOW_IMPLEMENT_USAGE, WORKFLOW_INTENT_USAGE, WORKFLOW_PLAN_USAGE, WORKFLOW_USAGE } from "../cli/usage.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { resolveWritePathIterationBounds } from "../config/machine-config-loader.ts";
import { parseStartResult } from "../daemon/daemon-wire.ts";
import { getExternalWorktreePath } from "../execution/external-worktree.ts";
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
import { IMPLEMENT_WRITE_STEP_RULES } from "../execution/write-loop-input.ts";
import type { IpcClient } from "../ipc/client.ts";
import { RpcError } from "../ipc/rpc-errors.ts";
import { classifyNeverLandedLane, type DestroyedArtifacts } from "./cleanup.ts";
import { maybeResetStaleWorkspace } from "./stale-reset-workspace.ts";
import {
  type ImplementWorkflowCliInput,
  type IntentWorkflowCliInput,
  type PlanWorkflowCliInput,
  parseImplementWorkflowArgs,
  parseIntentWorkflowArgs,
  parsePlanWorkflowArgs,
} from "./workflow-args.ts";
import {
  prepareWorkflowStart,
  type WorkflowStartPreparationResult,
  type WorkflowStartResetFlags,
} from "./workflow-start-preparation.ts";
import { stampWorkflowStepsWithMachineConfig } from "./workflow-step-config-stamp.ts";

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
          promptId: "implement.prompt.body",
          stepRules: IMPLEMENT_WRITE_STEP_RULES,
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
  const identity = resolveImplementSpecIdentity(deps.cwd(), parsed.specPath, registry, deps.machineConfigPath);
  if ("error" in identity) return undefined;
  const completion = validateImplementSpecTreeCompletion(
    identity.absoluteSpecPath,
    identity.specReadRoot ?? identity.projectRoot,
    (path) => readFileSync(path, "utf8"),
  );
  if (completion !== "implement.already_complete: requested spec has no unchecked non-human-only acceptance criteria") {
    return undefined;
  }
  const mutationRepair = resolveImplementMutationRepair(deps);
  return {
    project: identity.project,
    branch: parsed.branchName ?? basename(dirname(identity.absoluteSpecPath)),
    specPath: identity.externalPlanSpec === true ? identity.absoluteSpecPath : identity.specPath,
    ...(mutationRepair !== undefined ? { mutationRepair } : {}),
  };
}

function resolveWorkflowPresetBuilder(name: string | undefined, deps: CliDeps): ResolvedWorkflowPreset | undefined {
  if (name === undefined) return undefined;
  if (name !== "intent" && name !== "plan" && name !== "implement") return undefined;
  const builder = deps.workflowPresetBuilders[name];
  if (builder === undefined) return undefined;
  return { builder, canonicalName: name };
}

async function startWorkflowRun(
  client: IpcClient,
  steps: SuccessfulWorkflowBuild["steps"],
  built: SuccessfulWorkflowBuild,
  isIntentPreset: boolean,
  detach: boolean,
  io: Io,
  deps: CliDeps,
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
  if (detach || deps.forceSkipAttachClientWait) return 0;
  return waitForRunCompletion(client, deps.attachWaitRunIdOverride ?? start.runId, io);
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

/** Refusal for a standalone plan lane whose never-landed classification could not be established. */
function standaloneInconclusiveNeverLandedRefusal(reason: string): string {
  return `Error: Cannot re-run incomplete spec: never-landed classification is inconclusive (${reason}); the lane is preserved. Re-run \`jarvis run workflow plan --ready-intent <path>\` where \`gh\` is reachable (outside the agent sandbox), or hand-finish with \`jarvis cleanup --abandon <branch>\` after confirming no open PR.`;
}

function standalonePlanLaneRetirementDisposition(status: "reset" | "no-op"): string {
  return status === "reset"
    ? "failed plan resume worktree disposition: retired-and-rematerialized from base"
    : "failed plan resume worktree disposition: reused existing worktree";
}

type StandalonePlanLaneClassification =
  | { kind: "skip" }
  | { kind: "landed" }
  | { kind: "disposable" }
  | { kind: "refused"; message: string };

/**
 * Standalone plan re-dispatch onto an existing materialized lane classifies it before stale
 * reset, so a confirmed never-landed lane (no open PR, no unlanded commit outside harness
 * staging) is retired rather than refused by the ordinary descendant/landed-criteria gate. Fresh
 * materialization (no existing worktree) skips classification and makes no `gh` probe.
 */
async function classifyStandalonePlanLane(
  built: SuccessfulWorkflowBuild,
  deps: CliDeps,
): Promise<StandalonePlanLaneClassification> {
  const writeStep = built.steps.find((step) => step.behavior === "write");
  const worktree = writeStep?.behavior === "write" ? writeStep.worktree : undefined;
  if (worktree === undefined || worktree.git === false) return { kind: "skip" };
  if (!existsSync(getExternalWorktreePath(worktree))) return { kind: "skip" };
  const runner = deps.subprocessRunner ?? realAsyncSubprocessRunner;
  const classification = await classifyNeverLandedLane(
    worktree.projectRoot,
    worktree.branchName,
    worktree.baseRef,
    runner,
  );
  if (classification.kind === "inconclusive") {
    return { kind: "refused", message: standaloneInconclusiveNeverLandedRefusal(classification.reason) };
  }
  return { kind: classification.kind === "never-landed" ? "disposable" : "landed" };
}

/**
 * Retire and rematerialize a confirmed never-landed standalone plan lane, bypassing the ordinary
 * descendant/landed-criteria refusal that a disposable marker exists to skip. Emits the shared
 * retirement disposition line before returning control to the caller for dispatch.
 */
async function resetDisposableStandalonePlanLane(
  prepared: Extract<WorkflowStartPreparationResult, { ok: true }>,
  baseFlags: WorkflowStartResetFlags,
  client: IpcClient,
  deps: CliDeps,
  io: Io,
): Promise<number | undefined> {
  const outcome: { status?: "reset" | "no-op" } = {};
  const resetExitCode = await maybeResetStaleWorkspace(
    "plan",
    prepared.built,
    deps,
    io,
    { ...baseFlags, disposableLane: true },
    client,
    (destroyed) => {
      prepared.destroyedArtifacts = destroyed;
    },
    (status) => {
      outcome.status = status;
    },
  );
  if (resetExitCode !== undefined) return resetExitCode;
  if (outcome.status !== undefined) {
    io.stderr(`${standalonePlanLaneRetirementDisposition(outcome.status)}\n`);
  }
  return undefined;
}

/** Standalone plan admission gate for an existing lane; `handled: false` means no classification applied (fresh dispatch or non-plan workflow). */
async function admitStandalonePlanLane(
  prepared: Extract<WorkflowStartPreparationResult, { ok: true }>,
  baseFlags: WorkflowStartResetFlags,
  client: IpcClient,
  deps: CliDeps,
  io: Io,
): Promise<{ exitCode: number | undefined; handled: boolean }> {
  const laneClassification = await classifyStandalonePlanLane(prepared.built, deps);
  if (laneClassification.kind === "refused") {
    io.stderr(`${laneClassification.message}\n`);
    return { exitCode: 1, handled: true };
  }
  if (laneClassification.kind !== "disposable") return { exitCode: undefined, handled: false };
  const exitCode = await resetDisposableStandalonePlanLane(prepared, baseFlags, client, deps, io);
  return { exitCode, handled: true };
}

export async function runWorkflowCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const resolved = resolveWorkflowPresetBuilder(argv[0], deps);
  if (resolved === undefined) {
    io.stderr(WORKFLOW_USAGE);
    return 1;
  }
  const { builder, canonicalName } = resolved;
  const isIntentPreset = canonicalName === "intent";
  const isPlanPreset = canonicalName === "plan";
  const { rest: workflowArgv, detach } = parseWorkflowDetachFlag(argv.slice(1));
  const parsed = parseWorkflowArgsByName(workflowArgv, isIntentPreset, isPlanPreset);
  if (!parsed.ok) {
    io.stderr(getWorkflowUsage(canonicalName));
    return 1;
  }
  const builderInputResult = buildWorkflowBuilderInput(canonicalName, parsed, isIntentPreset, isPlanPreset, deps);
  if (!builderInputResult.ok) return 1;
  const recovery =
    canonicalName === "implement"
      ? resolveImplementRecoveryRequest(parsed as Extract<ImplementWorkflowCliInput, { ok: true }>, deps)
      : undefined;
  const preparationRequest = {
    workflow: canonicalName as "intent" | "plan" | "implement",
    builder,
    builderInput: builderInputResult.input,
    machineConfigPath: deps.machineConfigPath,
    stampSteps: stampWorkflowStepsWithMachineConfig,
    staleReset: {
      run: maybeResetStaleWorkspace,
      deps,
      io,
      flags: {
        skipDirtyWorktreeGate: "resetDespiteDirty" in parsed && parsed.resetDespiteDirty === true,
        skipLandedCriteriaGate: "resetDespiteLandedCriteria" in parsed && parsed.resetDespiteLandedCriteria === true,
      },
    },
  };
  let preparationPromise: Promise<WorkflowStartPreparationResult> | undefined;
  const prepare = () => (preparationPromise ??= prepareWorkflowStart(preparationRequest));
  const initialPreparation = recovery === undefined ? await prepare() : undefined;
  if (initialPreparation !== undefined && !initialPreparation.ok) {
    io.stderr(`${initialPreparation.error.replace(/\n+$/, "")}\n`);
    return 1;
  }
  let completedPreparation: Extract<WorkflowStartPreparationResult, { ok: true }> | undefined;
  const exitCode = await withConnectDispatch(io, deps, async (client) => {
    if (canonicalName === "implement") {
      const recovered = await maybeRecoverImplement(client, recovery, detach, io);
      if (recovered.admitted) return recovered.exitCode;
    }
    const prepared = initialPreparation ?? (await prepare());
    if (!prepared.ok) {
      io.stderr(`${prepared.error.replace(/\n+$/, "")}\n`);
      return 1;
    }
    completedPreparation = prepared;
    const laneGate = isPlanPreset
      ? await admitStandalonePlanLane(prepared, preparationRequest.staleReset.flags, client, deps, io)
      : { exitCode: undefined, handled: false as const };
    const resetExitCode = laneGate.handled ? laneGate.exitCode : await prepared.runStaleResetPreflight(client);
    if (resetExitCode !== undefined) return resetExitCode;
    return startWorkflowRun(client, prepared.steps, prepared.built, isIntentPreset, detach, io, deps);
  });
  const destroyedArtifacts = completedPreparation?.destroyedArtifacts;
  if (exitCode !== 0 && destroyedArtifacts !== undefined && Object.keys(destroyedArtifacts).length > 0) {
    io.stderr(`${formatDestroyedArtifactsSummary(destroyedArtifacts)}\n`);
  }
  return exitCode;
}
