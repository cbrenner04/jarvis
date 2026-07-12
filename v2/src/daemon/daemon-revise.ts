import { createResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import { resolveExecutableRole, resolveInvocationBindings } from "../config/agent-model-config.ts";
import { nextRevisionNumber, revisionStepId } from "../execution/revision-step-id.ts";
import { latestRevisionRun } from "../execution/workflow-runner.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import type { RunStatus, StateStore, WorkflowSnapshotStep } from "../persistence/state-store.ts";
import type { LoadedRun, OwnershipKey, WorktreeOwnershipRegistry } from "./daemon.ts";

/**
 * Statuses that mean a `~rN` revision run is no longer in flight, whether it
 * reached a normal write-loop terminal outcome or was killed by an operator.
 * A killed revision must not permanently strand its human step in `"revising"`.
 */
export const REVISION_INACTIVE_STATUSES: readonly RunStatus[] = ["completed", "failed", "blocked", "killed"];

type RevisionWriteLoopInputResult =
  | { kind: "ok"; input: WriteLoopInput }
  | { kind: "error"; code: string; message: string };

/**
 * Rebuild the repeated step's `WriteLoopInput` for a revision attempt: reuses its
 * durably-snapshotted `stepRules`/`expectedArtifactPath`/`agents`/`agentModelConfig`
 * (appending a supplied `prompt` to `stepRules` rather than replacing it) instead of
 * fabricating an empty write-loop config.
 */
export function buildRevisionWriteLoopInput(
  repeatedStepConfig: WorkflowSnapshotStep,
  repeatedRun: LoadedRun,
  stepId: string,
  prompt: string | undefined,
): RevisionWriteLoopInputResult {
  const agents = repeatedStepConfig.agents ?? [];
  let bindings: WriteLoopInput["bindings"] = [];
  try {
    if (agents.length > 0) {
      bindings = resolveInvocationBindings(
        resolveExecutableRole(repeatedStepConfig.role),
        agents,
        repeatedStepConfig.agentModelConfig ?? {},
        createResolvedAgentBinding,
      );
    }
  } catch (err) {
    return {
      kind: "error",
      code: "revise_unsupported",
      message: `Unable to resolve bindings for repeated step "${repeatedStepConfig.stepId}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const baseStepRules = repeatedStepConfig.stepRules ?? "";
  const stepRules = prompt ? (baseStepRules ? `${baseStepRules}\n\n${prompt}` : prompt) : baseStepRules;

  return {
    kind: "ok",
    input: {
      worktree: {
        projectRoot: repeatedRun.worktreePath,
        projectName: repeatedRun.project,
        branchName: repeatedRun.branch,
        baseRef: repeatedRun.specRef,
      },
      specPath: repeatedRun.specPath,
      stepRules,
      expectedArtifactPath: repeatedStepConfig.expectedArtifactPath ?? "",
      bindings,
      bindingResolution: {
        role: repeatedStepConfig.role,
        agents,
        agentModelConfig: repeatedStepConfig.agentModelConfig ?? {},
      },
      stepId,
      ...(repeatedRun.workflowSnapshot ? { workflowSnapshot: repeatedRun.workflowSnapshot } : {}),
    },
  };
}

export type ReviseReconvergeDeps = {
  store: StateStore;
  registry: WorktreeOwnershipRegistry;
  checkWorktreeDirty: (worktreePath: string) => Promise<boolean>;
  spawnWriteLoop: (key: OwnershipKey, runId: string, worktreePath: string, input: WriteLoopInput) => void;
  checkWorktreeClaimed: (
    registry: WorktreeOwnershipRegistry,
    key: OwnershipKey,
  ) => { kind: "error"; code: "worktree_claimed"; message: string } | undefined;
};

export async function reviseAwaitingHuman(
  deps: ReviseReconvergeDeps,
  run: LoadedRun,
  prompt: string | undefined,
): Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }> {
  const { store, registry, checkWorktreeDirty, spawnWriteLoop } = deps;

  const onRevise = run.workflowSnapshot?.steps.find((step) => step.stepId === run.stepId)?.onRevise;
  if (!onRevise) {
    return { kind: "error", code: "revise_unsupported", message: "No onRevise configured for this human step" };
  }

  const repeatedStepConfig = run.workflowSnapshot?.steps.find((step) => step.stepId === onRevise.repeatStepId);
  if (!repeatedStepConfig) {
    return {
      kind: "error",
      code: "revise_unsupported",
      message: `No workflow snapshot config found for repeated step "${onRevise.repeatStepId}"`,
    };
  }

  const repeatedRun = store.findRunByProjectBranch({
    project: run.project,
    branch: run.branch,
    stepId: onRevise.repeatStepId,
  });
  if (!repeatedRun) {
    return {
      kind: "error",
      code: "revise_unsupported",
      message: `No run found for repeated step "${onRevise.repeatStepId}"`,
    };
  }

  const revisionRuns = store.findRevisionRuns({
    project: run.project,
    branch: run.branch,
    repeatStepId: onRevise.repeatStepId,
  });
  const n = nextRevisionNumber(
    revisionRuns.map((revisionRun) => revisionRun.stepId),
    onRevise.repeatStepId,
  );
  if (n > onRevise.maxRevisions) {
    return {
      kind: "error",
      code: "revise_exhausted",
      message: `Revision budget (${onRevise.maxRevisions}) exhausted for step "${onRevise.repeatStepId}"`,
    };
  }

  if (!(await checkWorktreeDirty(repeatedRun.worktreePath)) && !prompt) {
    return {
      kind: "error",
      code: "revise_requires_input",
      message: "revise requires either a dirty worktree or a prompt",
    };
  }

  const key: OwnershipKey = { project: repeatedRun.project, branch: repeatedRun.branch };
  const claimError = deps.checkWorktreeClaimed(registry, key);
  if (claimError) {
    return claimError;
  }

  const stepId = revisionStepId(onRevise.repeatStepId, n);
  const built = buildRevisionWriteLoopInput(repeatedStepConfig, repeatedRun, stepId, prompt);
  if (built.kind === "error") {
    return built;
  }

  const revisionRunId = store.createRun({
    project: repeatedRun.project,
    specRef: repeatedRun.specRef,
    worktreePath: repeatedRun.worktreePath,
    branch: repeatedRun.branch,
    specPath: repeatedRun.specPath,
    stepId,
    ...(repeatedRun.workflowSnapshot ? { workflowSnapshot: repeatedRun.workflowSnapshot } : {}),
  });

  store.setRunStatus(run.id, "revising");
  spawnWriteLoop(key, revisionRunId, repeatedRun.worktreePath, built.input);

  return { kind: "response", result: { ok: true, stepId } };
}

/**
 * A `"revising"` run re-converges to `awaiting-human` once its `~rN` revision
 * run is no longer active (terminal outcome, or killed). Returns the reloaded
 * run on reconvergence, or `undefined` if the revision is still in flight.
 */
export function reconvergeRevisingRun(deps: ReviseReconvergeDeps, run: LoadedRun): LoadedRun | undefined {
  const { store } = deps;

  const onRevise = run.workflowSnapshot?.steps.find((step) => step.stepId === run.stepId)?.onRevise;
  if (!onRevise) return undefined;

  const revisionRuns = store.findRevisionRuns({
    project: run.project,
    branch: run.branch,
    repeatStepId: onRevise.repeatStepId,
  });
  const latest = latestRevisionRun(revisionRuns, onRevise.repeatStepId);
  if (!latest || !REVISION_INACTIVE_STATUSES.includes(latest.status)) {
    return undefined;
  }

  store.setRunStatus(run.id, "awaiting-human");
  return store.loadRun(run.id) ?? undefined;
}
