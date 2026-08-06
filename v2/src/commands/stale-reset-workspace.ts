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

type SuccessfulWorkflowBuild = Extract<WorkflowPresetBuilderResult, { ok: true }>;

/** Incomplete re-run stale reset applies to implement, plan, and intent (intent-reviewed shares the preset). */
export const STALE_RESET_WORKFLOWS = new Set(["implement", "plan", "intent"]);

export async function maybeResetStaleWorkspace(
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
  const skipLandedCriteriaGate = "resetDespiteLandedCriteria" in parsed && parsed.resetDespiteLandedCriteria === true;
  const writeStep = built.steps.find((step) => step.behavior === "write");
  const worktree = writeStep?.behavior === "write" ? writeStep.worktree : undefined;
  if (!(worktree?.git !== false && worktree?.projectRoot && worktree.projectName && worktree.branchName)) {
    return undefined;
  }
  const resetOptions: ResetStaleWorkspaceOptions = {
    skipDirtyWorktreeGate,
    skipLandedCriteriaGate,
    baseRef: worktree.baseRef,
    ...(writeStep?.behavior === "write" && writeStep.specPath !== undefined ? { specPath: writeStep.specPath } : {}),
  };
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
      resetOptions,
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
