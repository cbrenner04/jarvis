import type {
  CliWorkflowPresetName,
  WorkflowPresetBuilder,
  WorkflowPresetBuilderInput,
  WorkflowPresetBuilderResult,
} from "../execution/workflow-presets.ts";
import type { IpcClient } from "../ipc/client.ts";

export const BASE_WORKFLOW_NAMES = ["intent", "plan", "implement"] as const;
export const WORKFLOW_REVIEW_POSTURES = ["none", "light", "debate"] as const;

export type BaseWorkflowName = (typeof BASE_WORKFLOW_NAMES)[number];
export type WorkflowReviewPosture = (typeof WORKFLOW_REVIEW_POSTURES)[number];
type SuccessfulWorkflowBuild = Extract<WorkflowPresetBuilderResult, { ok: true }>;

export type WorkflowStartResetFlags = {
  skipDirtyWorktreeGate: boolean;
  skipLandedCriteriaGate: boolean;
};

/** Mirrors `DestroyedArtifacts` without importing cleanup's daemon dependency graph. */
export type WorkflowStartDestroyedArtifacts = {
  closedPrNumber?: number;
  worktreePath?: string;
  localBranch?: string;
  remoteBranch?: string;
  remoteTrackingRef?: string;
};

export type WorkflowStartPreparationRequest<TDeps = unknown, TIo = unknown> = {
  workflow: BaseWorkflowName;
  builder: WorkflowPresetBuilder;
  builderInput: WorkflowPresetBuilderInput;
  machineConfigPath: string;
  stampSteps: (steps: SuccessfulWorkflowBuild["steps"], machineConfigPath: string) => SuccessfulWorkflowBuild["steps"];
  staleReset: {
    run: (
      workflow: string,
      built: SuccessfulWorkflowBuild,
      deps: TDeps,
      io: TIo,
      flags: WorkflowStartResetFlags,
      client: IpcClient,
      onDestroyed?: (destroyed: WorkflowStartDestroyedArtifacts) => void,
    ) => Promise<number | undefined>;
    deps: TDeps;
    io: TIo;
    flags: WorkflowStartResetFlags;
  };
};

export type WorkflowStartPreparationResult =
  | { ok: false; error: string }
  | {
      ok: true;
      steps: SuccessfulWorkflowBuild["steps"];
      built: SuccessfulWorkflowBuild;
      destroyedArtifacts?: WorkflowStartDestroyedArtifacts;
      runStaleResetPreflight: (client: IpcClient) => Promise<number | undefined>;
    };

const WORKFLOW_POSTURE_PRESETS = {
  intent: { none: "intent", light: "intent-reviewed", debate: "intent" },
  plan: { none: "plan", light: "plan-reviewed-light", debate: "plan-reviewed" },
  implement: { light: "implement", debate: "implement" },
} as const satisfies Record<BaseWorkflowName, Partial<Record<WorkflowReviewPosture, CliWorkflowPresetName>>>;

export function isBaseWorkflowName(value: string): value is BaseWorkflowName {
  return (BASE_WORKFLOW_NAMES as readonly string[]).includes(value);
}

export function isWorkflowReviewPosture(value: string): value is WorkflowReviewPosture {
  return (WORKFLOW_REVIEW_POSTURES as readonly string[]).includes(value);
}

export function resolveWorkflowPresetName(workflow: string, review: string): CliWorkflowPresetName | undefined {
  if (!isBaseWorkflowName(workflow) || !isWorkflowReviewPosture(review)) return undefined;
  return (WORKFLOW_POSTURE_PRESETS[workflow] as Partial<Record<WorkflowReviewPosture, CliWorkflowPresetName>>)[review];
}

export function isUnrealizableWorkflowReview(workflow: string, review: string): boolean {
  return (
    isBaseWorkflowName(workflow) &&
    isWorkflowReviewPosture(review) &&
    resolveWorkflowPresetName(workflow, review) === undefined
  );
}

export async function prepareWorkflowStart<TDeps, TIo>(
  request: WorkflowStartPreparationRequest<TDeps, TIo>,
): Promise<WorkflowStartPreparationResult> {
  const built = await request.builder(request.builderInput as Parameters<WorkflowPresetBuilder>[0]);
  if (!built.ok) return { ok: false, error: built.error };
  let steps: SuccessfulWorkflowBuild["steps"];
  try {
    steps = request.stampSteps(built.steps, request.machineConfigPath);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const prepared: Extract<WorkflowStartPreparationResult, { ok: true }> = {
    ok: true,
    steps,
    built,
    runStaleResetPreflight: async (client) =>
      request.staleReset.run(
        request.workflow,
        built,
        request.staleReset.deps,
        request.staleReset.io,
        request.staleReset.flags,
        client,
        (destroyed) => {
          prepared.destroyedArtifacts = destroyed;
        },
      ),
  };
  return prepared;
}
