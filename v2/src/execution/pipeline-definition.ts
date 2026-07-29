import type { AgentModelConfig } from "../config/agent-model-config.ts";

export const BASE_WORKFLOW_NAMES = ["intent", "plan", "implement"] as const;

const VALID_REVIEW_POSTURES = new Set(["none", "light", "debate"]);

const POSTURE_REQUIRED_ROLES = {
  light: ["critic", "actuator"],
  debate: ["adversary", "advocate", "adjudicator", "actuator"],
} as const satisfies Record<string, readonly string[]>;

function isRoleBoundInConfig(agentModelConfig: AgentModelConfig, role: string): boolean {
  for (const modelsByRole of Object.values(agentModelConfig)) {
    if (modelsByRole !== undefined && role in modelsByRole) {
      return true;
    }
  }
  return false;
}

export type PipelineValidationError = {
  code:
    | "unknown-workflow"
    | "invalid-review-posture"
    | "unrealizable-review-posture"
    | "missing-role-binding"
    | "duplicate-stage-id"
    | "empty-pipeline";
  stageId: string | null;
  field: string;
  message: string;
};

export type PipelineValidationResult = { ok: true } | { ok: false; errors: PipelineValidationError[] };

export interface WorkflowPipelineStage {
  stageId: string;
  kind: "workflow";
  workflow: string;
  review: string;
}

export interface ApprovalPipelineStage {
  stageId: string;
  kind: "approval";
}

export type PipelineStage = WorkflowPipelineStage | ApprovalPipelineStage;

export interface PipelineDefinition {
  name: string;
  stages: PipelineStage[];
}

function collectDuplicateStageIdErrors(stages: PipelineStage[], errors: PipelineValidationError[]): void {
  const stageIdCounts = new Map<string, number>();
  for (const stage of stages) {
    stageIdCounts.set(stage.stageId, (stageIdCounts.get(stage.stageId) ?? 0) + 1);
  }
  for (const [duplicatedId, count] of stageIdCounts) {
    if (count > 1) {
      errors.push({
        code: "duplicate-stage-id",
        stageId: null,
        field: "stages",
        message: `duplicate stageId "${duplicatedId}"`,
      });
    }
  }
}

function validateWorkflowStage(
  stage: WorkflowPipelineStage,
  baseWorkflowNames: readonly string[],
  agentModelConfig: AgentModelConfig,
  errors: PipelineValidationError[],
): void {
  const { stageId, workflow, review } = stage;
  const workflowKnown = baseWorkflowNames.includes(workflow);

  if (!workflowKnown) {
    errors.push({
      code: "unknown-workflow",
      stageId,
      field: "workflow",
      message: `stage "${stageId}": field workflow has unknown value "${workflow}"`,
    });
  }

  if (!VALID_REVIEW_POSTURES.has(review)) {
    errors.push({
      code: "invalid-review-posture",
      stageId,
      field: "review",
      message: `stage "${stageId}": field review has invalid posture "${review}"`,
    });
    return;
  }

  if (workflowKnown && workflow === "implement" && review === "none") {
    errors.push({
      code: "unrealizable-review-posture",
      stageId,
      field: "review",
      message: `stage "${stageId}": workflow "${workflow}" has no realization for review posture "${review}"`,
    });
    return;
  }

  if (review === "light" || review === "debate") {
    for (const role of POSTURE_REQUIRED_ROLES[review]) {
      if (!isRoleBoundInConfig(agentModelConfig, role)) {
        errors.push({
          code: "missing-role-binding",
          stageId,
          field: "review",
          message: `stage "${stageId}": review posture "${review}" requires unbound role "${role}"`,
        });
      }
    }
  }
}

export function validatePipelineDefinition(
  definition: PipelineDefinition,
  options: { agentModelConfig: AgentModelConfig },
): PipelineValidationResult {
  const errors: PipelineValidationError[] = [];
  const { stages } = definition;
  const { agentModelConfig } = options;
  const baseWorkflowNames: readonly string[] = BASE_WORKFLOW_NAMES;

  if (stages.length === 0) {
    errors.push({
      code: "empty-pipeline",
      stageId: null,
      field: "stages",
      message: "pipeline has no stages",
    });
    return { ok: false, errors };
  }

  collectDuplicateStageIdErrors(stages, errors);

  for (const stage of stages) {
    if (stage.kind === "workflow") {
      validateWorkflowStage(stage, baseWorkflowNames, agentModelConfig, errors);
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
