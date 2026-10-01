import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { prepareReviewFeedbackWorkflowAdmissionForLaneRequest } from "../commands/review-feedback-workflow-admission.ts";
import type { WorkflowPresetBuilder } from "../execution/workflow-presets.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import type { ReviewFeedbackLanePipelineStageRequest } from "../persistence/review-feedback-lane-resolution.ts";
import type { StateStore } from "../persistence/state-store.ts";
import type { WorkflowStartResult } from "./daemon-workflow-admission-handlers.ts";

export type PipelineStageReviewFeedbackLaunchParams = {
  pipelineId: string;
  stageId: string;
  branchKey?: string;
};

export type PipelineStageReviewFeedbackLaunchDeps = {
  store: StateStore;
  subprocessRunner: AsyncSubprocessRunner;
  machineConfigPath: string;
  resolveProjectRoot: (projectKey: string) => string | undefined;
  builder: WorkflowPresetBuilder;
  handleWorkflowStart: (steps: AnyWorkflowStep[]) => WorkflowStartResult;
};

function parseBranchKey(value: unknown): string | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) return "invalid";
  return value;
}

export function parsePipelineStageReviewFeedbackLaunchParams(
  params: unknown,
): { ok: true; value: PipelineStageReviewFeedbackLaunchParams } | { ok: false; message: string } {
  if (params === null || typeof params !== "object") {
    return { ok: false, message: "pipelineId and stageId required" };
  }
  const record = params as Record<string, unknown>;
  if (typeof record.pipelineId !== "string" || record.pipelineId.length === 0) {
    return { ok: false, message: "pipelineId and stageId required" };
  }
  if (typeof record.stageId !== "string" || record.stageId.length === 0) {
    return { ok: false, message: "pipelineId and stageId required" };
  }
  const branchKey = parseBranchKey(record.branchKey);
  if (branchKey === "invalid") {
    return { ok: false, message: "branchKey must be a non-empty string when provided" };
  }
  return {
    ok: true,
    value: {
      pipelineId: record.pipelineId,
      stageId: record.stageId,
      ...(branchKey !== undefined ? { branchKey } : {}),
    },
  };
}

export async function executePipelineStageReviewFeedbackLaunch(
  params: PipelineStageReviewFeedbackLaunchParams,
  deps: PipelineStageReviewFeedbackLaunchDeps,
): Promise<Awaited<WorkflowStartResult>> {
  const laneRequest: ReviewFeedbackLanePipelineStageRequest = {
    mode: "pipeline_stage",
    pipelineId: params.pipelineId,
    stageId: params.stageId,
    ...(params.branchKey !== undefined ? { branchKey: params.branchKey } : {}),
  };
  const outcome = await prepareReviewFeedbackWorkflowAdmissionForLaneRequest(laneRequest, {
    store: deps.store,
    subprocessRunner: deps.subprocessRunner,
    machineConfigPath: deps.machineConfigPath,
    builder: deps.builder,
    resolveProjectRoot: deps.resolveProjectRoot,
  });
  if (!outcome.ok) {
    return { kind: "error", code: outcome.refusal.code, message: outcome.refusal.message };
  }
  const started = deps.handleWorkflowStart(outcome.preparation.steps);
  return started instanceof Promise ? await started : started;
}
