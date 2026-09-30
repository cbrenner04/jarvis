import { findProjectMatch } from "../../../shared/project-registry.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import type { BuildImplementWorkflowStepsInput } from "../execution/implement-workflow-steps.ts";
import type { ReviewFeedbackAdmissionRefusalCode } from "../execution/review-feedback-admission-prelude.ts";
import { runReviewFeedbackAdmissionPrelude } from "../execution/review-feedback-admission-prelude.ts";
import { WORKFLOW_PRESET_BUILDERS, type WorkflowPresetBuilder } from "../execution/workflow-presets.ts";
import {
  type ReviewFeedbackLaneBareRequest,
  type ReviewFeedbackLanePipelineRequest,
  type ReviewFeedbackLaneRefusalCode,
  type ReviewFeedbackLaneResolutionStore,
  resolveReviewFeedbackLane,
} from "../persistence/review-feedback-lane-resolution.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { maybeResetStaleWorkspace } from "./stale-reset-workspace.ts";
import type { ReviewFeedbackWorkflowCliInput } from "./workflow-args.ts";
import { prepareWorkflowStart, type WorkflowStartPreparationResult } from "./workflow-start-preparation.ts";
import { stampWorkflowStepsWithMachineConfig } from "./workflow-step-config-stamp.ts";

export const REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE = "review_feedback_write_not_available";

type ReviewFeedbackWorkflowAdmissionRefusalCode =
  | ReviewFeedbackLaneRefusalCode
  | ReviewFeedbackAdmissionRefusalCode
  | typeof REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE;

type ReviewFeedbackWorkflowAdmissionRefusal = {
  code: ReviewFeedbackWorkflowAdmissionRefusalCode;
  message: string;
};

export function formatReviewFeedbackWorkflowAdmissionRefusal(refusal: ReviewFeedbackWorkflowAdmissionRefusal): string {
  return `${refusal.code}: ${refusal.message}`;
}

function laneRequestFromCli(
  project: string,
  parsed: Extract<ReviewFeedbackWorkflowCliInput, { ok: true }>,
): ReviewFeedbackLaneBareRequest | ReviewFeedbackLanePipelineRequest {
  const branch = parsed.branch;
  if (parsed.pipelineId !== undefined || parsed.stageId !== undefined || parsed.branchKey !== undefined) {
    return {
      mode: "pipeline",
      project,
      branch,
      pipelineId: parsed.pipelineId ?? "",
      stageId: parsed.stageId ?? "",
      ...(parsed.branchKey !== undefined ? { branchKey: parsed.branchKey } : {}),
    };
  }
  return { mode: "bare", project, branch };
}

type ReviewFeedbackWorkflowAdmissionDeps = {
  store: ReviewFeedbackLaneResolutionStore;
  subprocessRunner: AsyncSubprocessRunner;
  machineConfigPath: string;
  builder: WorkflowPresetBuilder;
  project: string;
  projectRoot: string;
};

export async function prepareReviewFeedbackWorkflowAdmission(
  parsed: Extract<ReviewFeedbackWorkflowCliInput, { ok: true }>,
  deps: ReviewFeedbackWorkflowAdmissionDeps,
): Promise<
  | { ok: true; preparation: Extract<WorkflowStartPreparationResult, { ok: true }> }
  | { ok: false; refusal: ReviewFeedbackWorkflowAdmissionRefusal }
> {
  const laneResult = resolveReviewFeedbackLane(deps.store, laneRequestFromCli(deps.project, parsed));
  if (!laneResult.ok) {
    return { ok: false, refusal: { code: laneResult.code, message: laneResult.message } };
  }
  const prelude = await runReviewFeedbackAdmissionPrelude(laneResult.target, deps.subprocessRunner);
  if (!prelude.ok) {
    return { ok: false, refusal: { code: prelude.code, message: prelude.message } };
  }
  const preparation = await prepareWorkflowStart({
    workflow: "review-feedback",
    builder: deps.builder,
    builderInput: {
      target: laneResult.target,
      projectRoot: deps.projectRoot,
      configPath: deps.machineConfigPath,
    } as unknown as BuildImplementWorkflowStepsInput,
    machineConfigPath: deps.machineConfigPath,
    stampSteps: stampWorkflowStepsWithMachineConfig,
    staleReset: {
      run: maybeResetStaleWorkspace,
      deps: {} as CliDeps,
      io: {} as Io,
      flags: { skipDirtyWorktreeGate: false, skipLandedCriteriaGate: false },
    },
  });
  if (!preparation.ok) {
    return { ok: false, refusal: { code: REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE, message: preparation.error } };
  }
  return { ok: true, preparation };
}

export async function runReviewFeedbackWorkflowCommand(
  _workflowArgv: readonly string[],
  parsed: Extract<ReviewFeedbackWorkflowCliInput, { ok: true }>,
  io: Io,
  deps: CliDeps,
): Promise<number> {
  const registry = deps.readProjectRegistry();
  const project = findProjectMatch(deps.cwd(), registry);
  if (project === undefined) {
    io.stderr("review-feedback: no registered project matches cwd\n");
    return 1;
  }
  const store = deps.reviewFeedbackLaneStore ?? openStateStore();
  const runner = deps.subprocessRunner ?? realAsyncSubprocessRunner;
  const builder = deps.workflowPresetBuilders["review-feedback"] ?? WORKFLOW_PRESET_BUILDERS["review-feedback"];
  const outcome = await prepareReviewFeedbackWorkflowAdmission(parsed, {
    store,
    subprocessRunner: runner,
    machineConfigPath: deps.machineConfigPath,
    builder,
    project: project.key,
    projectRoot: project.root,
  });
  if (!outcome.ok) {
    io.stderr(`${formatReviewFeedbackWorkflowAdmissionRefusal(outcome.refusal)}\n`);
    return 1;
  }
  io.stderr(
    `${formatReviewFeedbackWorkflowAdmissionRefusal({
      code: REVIEW_FEEDBACK_WRITE_NOT_AVAILABLE,
      message: "review-feedback write dispatch is not available yet",
    })}\n`,
  );
  return 1;
}
