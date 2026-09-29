import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import type { WorkflowPresetBuilderResult } from "../execution/workflow-presets.ts";
import type { IpcClient } from "../ipc/client.ts";
import { jarvisHome } from "../paths.ts";
import {
  createStaleResetDaemonClient,
  type DestroyedArtifacts,
  type ResetStaleWorkspaceOptions,
  resetStaleWorkspace,
} from "./cleanup.ts";
import type { ImplementWorkflowCliInput, IntentWorkflowCliInput, PlanWorkflowCliInput } from "./workflow-args.ts";
import type { WorkflowStartResetFlags } from "./workflow-start-preparation.ts";

type SuccessfulWorkflowBuild = Extract<WorkflowPresetBuilderResult, { ok: true }>;

/** Incomplete re-run stale reset applies to implement, plan, and intent (intent-reviewed shares the preset). */
export const STALE_RESET_WORKFLOWS = new Set(["implement", "plan", "intent"]);

/**
 * Assemble `resetStaleWorkspace` options. Extracted so `maybeResetStaleWorkspace` stays under
 * biome's cognitive-complexity limit: the two conditional spreads are the branching that pushed it
 * over when `disposableLane` was threaded through.
 */
export function buildResetStaleWorkspaceOptions(args: {
  skipDirtyWorktreeGate: boolean;
  skipLandedCriteriaGate: boolean;
  baseRef: string | undefined;
  writeStep: SuccessfulWorkflowBuild["steps"][number] | undefined;
  parsed: Record<string, unknown>;
}): ResetStaleWorkspaceOptions {
  const { skipDirtyWorktreeGate, skipLandedCriteriaGate, baseRef, writeStep, parsed } = args;
  const carriesSpecPath =
    writeStep?.behavior === "write" && writeStep.specPath !== undefined && writeStep.externalPlanSpec !== true;
  const specPath = carriesSpecPath && writeStep?.behavior === "write" ? writeStep.specPath : undefined;
  const disposableLane = parsed.disposableLane === true;
  const resetDespiteContinuable = parsed.resetDespiteContinuable === true;
  return {
    skipDirtyWorktreeGate,
    skipLandedCriteriaGate,
    ...(baseRef !== undefined ? { baseRef } : {}),
    ...(specPath !== undefined ? { specPath } : {}),
    ...(disposableLane ? { disposableLane: true } : {}),
    ...(resetDespiteContinuable ? { resetDespiteContinuable: true } : {}),
  };
}

export type StaleResetWorkspaceProbeRefusal = { refused: true; message: string };

type StaleResetParsed =
  | WorkflowStartResetFlags
  | ImplementWorkflowCliInput
  | IntentWorkflowCliInput
  | PlanWorkflowCliInput;

async function runStaleResetForWorkflow(
  canonicalName: string,
  built: SuccessfulWorkflowBuild,
  deps: CliDeps,
  io: Io,
  parsed: StaleResetParsed,
  client: IpcClient,
  probe: boolean,
  onDestroyed?: (destroyed: DestroyedArtifacts) => void,
  onOutcome?: (status: "reset" | "no-op" | "continue") => void,
): Promise<number | undefined | StaleResetWorkspaceProbeRefusal> {
  if (!STALE_RESET_WORKFLOWS.has(canonicalName)) return undefined;
  const skipDirtyWorktreeGate =
    "skipDirtyWorktreeGate" in parsed
      ? parsed.skipDirtyWorktreeGate
      : "resetDespiteDirty" in parsed && parsed.resetDespiteDirty === true;
  const skipLandedCriteriaGate =
    "skipLandedCriteriaGate" in parsed
      ? parsed.skipLandedCriteriaGate
      : "resetDespiteLandedCriteria" in parsed && parsed.resetDespiteLandedCriteria === true;
  const writeStep = built.steps.find((step) => step.behavior === "write");
  const worktree = writeStep?.behavior === "write" ? writeStep.worktree : undefined;
  if (!(worktree?.git !== false && worktree?.projectRoot && worktree.projectName && worktree.branchName)) {
    return undefined;
  }
  const resetOptions = buildResetStaleWorkspaceOptions({
    skipDirtyWorktreeGate,
    skipLandedCriteriaGate,
    baseRef: worktree.baseRef,
    writeStep,
    parsed,
  });
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
      probe === true ? { ...resetOptions, gatesOnly: true, skipWorktreeClaimGate: true } : resetOptions,
    );
  } catch (error) {
    const line = `Error: Stale workspace reset failed: ${error instanceof Error ? error.message : String(error)}\n`;
    if (probe === true) return { refused: true, message: line };
    io.stderr(line);
    return 1;
  }
  if ("destroyed" in resetResult && resetResult.destroyed !== undefined) onDestroyed?.(resetResult.destroyed);
  if (resetResult.status === "refused") {
    if ("code" in resetResult && resetResult.code === "worktree_claimed") {
      const line = `worktree_claimed: ${resetResult.message}\n`;
      if (probe === true) return { refused: true, message: line };
      io.stderr(line);
    } else if ("reason" in resetResult) {
      const line = `Error: Cannot re-run incomplete spec: ${resetResult.reason}\n`;
      if (probe === true) return { refused: true, message: line };
      io.stderr(line);
    }
    return 1;
  }
  // A continuation that rebased the lane records its pre-rebase tip on the write step, so the run's
  // snapshot carries the publisher's lease authorization across resume.
  if (resetResult.status === "continue" && resetResult.preRebaseSha !== undefined && writeStep?.behavior === "write") {
    writeStep.leaseFromSha = resetResult.preRebaseSha;
  }
  onOutcome?.(resetResult.status);
  return undefined;
}

export async function maybeResetStaleWorkspace(
  canonicalName: string,
  built: SuccessfulWorkflowBuild,
  deps: CliDeps,
  io: Io,
  parsed: StaleResetParsed,
  client: IpcClient,
  onDestroyed?: (destroyed: DestroyedArtifacts) => void,
  onOutcome?: (status: "reset" | "no-op" | "continue") => void,
): Promise<number | undefined> {
  const result = await runStaleResetForWorkflow(
    canonicalName,
    built,
    deps,
    io,
    parsed,
    client,
    false,
    onDestroyed,
    onOutcome,
  );
  if (result !== undefined && typeof result === "object" && "refused" in result) return 1;
  return result;
}

/** Non-mutating stale-reset gate evaluation for pipeline resume admission. */
export async function probeMaybeResetStaleWorkspace(
  canonicalName: string,
  built: SuccessfulWorkflowBuild,
  deps: CliDeps,
  io: Io,
  parsed: StaleResetParsed,
  client: IpcClient,
): Promise<StaleResetWorkspaceProbeRefusal | undefined> {
  const result = await runStaleResetForWorkflow(canonicalName, built, deps, io, parsed, client, true);
  if (result !== undefined && typeof result === "object" && "refused" in result) return result;
  return undefined;
}
