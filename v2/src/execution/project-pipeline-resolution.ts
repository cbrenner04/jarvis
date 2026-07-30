import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { ProjectPipelineConfig } from "../config/machine-config-loader.ts";
import {
  PIPELINE_TERMINAL_ACTIONS,
  type PipelineDefinition,
  type PipelineTerminalAction,
  type PipelineValidationError,
  validatePipelineDefinition,
} from "./pipeline-definition.ts";
import type { getPipelineDefinition } from "./pipeline-registry.ts";

type PipelineLookup = typeof getPipelineDefinition;

export type InvalidProjectPipelineConfigError = {
  code: "invalid-project-pipeline-config";
  key: string;
  message: string;
};

export type ProjectPipelineResolutionResult =
  | { ok: true; definition: PipelineDefinition }
  | {
      ok: false;
      error:
        | InvalidProjectPipelineConfigError
        | { code: "unknown-pipeline"; name: string }
        | { code: "invalid-pipeline-definition"; errors: PipelineValidationError[] };
    };

type ParsedProjectPipeline = {
  name: string;
  terminalAction: PipelineTerminalAction;
  reviewOverrides: Array<[stageId: string, posture: string]>;
};

let invertTerminalActionConflictGuardForTest = false;

export function setInvertTerminalActionConflictGuardForTest(value: boolean): void {
  invertTerminalActionConflictGuardForTest = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(key: string, message: string): { ok: false; error: InvalidProjectPipelineConfigError } {
  return { ok: false, error: { code: "invalid-project-pipeline-config", key, message } };
}

function parseProjectPipeline(
  config: ProjectPipelineConfig,
): { ok: true; pipeline: ParsedProjectPipeline } | { ok: false; error: InvalidProjectPipelineConfigError } {
  const pipelineKey = `projects.${config.projectKey}.pipeline`;
  if (!isRecord(config.pipeline)) {
    return invalid(pipelineKey, `${pipelineKey} must be an object`);
  }

  for (const key of Object.keys(config.pipeline)) {
    if (key !== "name" && key !== "terminalAction" && key !== "reviewOverrides") {
      const offendingKey = `${pipelineKey}.${key}`;
      return invalid(offendingKey, `${offendingKey} is not allowed`);
    }
  }

  const nameKey = `${pipelineKey}.name`;
  if (typeof config.pipeline.name !== "string" || config.pipeline.name.length === 0) {
    return invalid(nameKey, `${nameKey} must be a non-empty string`);
  }

  const terminalActionKey = `${pipelineKey}.terminalAction`;
  const rawTerminalAction = config.pipeline.terminalAction;
  if (rawTerminalAction === undefined) {
    return invalid(terminalActionKey, `${terminalActionKey} is required`);
  }
  if (typeof rawTerminalAction !== "string") {
    return invalid(terminalActionKey, `${terminalActionKey} must be a string`);
  }
  if (rawTerminalAction.length === 0) {
    return invalid(terminalActionKey, `${terminalActionKey} must be a non-empty string`);
  }
  if (!(PIPELINE_TERMINAL_ACTIONS as readonly string[]).includes(rawTerminalAction)) {
    return invalid(terminalActionKey, `${terminalActionKey} has unknown value "${rawTerminalAction}"`);
  }

  const reviewOverridesKey = `${pipelineKey}.reviewOverrides`;
  const rawOverrides = config.pipeline.reviewOverrides;
  if (rawOverrides !== undefined && !isRecord(rawOverrides)) {
    return invalid(reviewOverridesKey, `${reviewOverridesKey} must be an object`);
  }

  const reviewOverrides: Array<[string, string]> = [];
  for (const [stageId, posture] of Object.entries(rawOverrides ?? {})) {
    const overrideKey = `${reviewOverridesKey}.${stageId}`;
    if (typeof posture !== "string") {
      return invalid(overrideKey, `${overrideKey} must be a string`);
    }
    reviewOverrides.push([stageId, posture]);
  }

  return {
    ok: true,
    pipeline: {
      name: config.pipeline.name,
      terminalAction: rawTerminalAction as PipelineTerminalAction,
      reviewOverrides,
    },
  };
}

function copyDefinition(definition: PipelineDefinition): PipelineDefinition {
  return {
    ...definition,
    stages: definition.stages.map((stage) => ({ ...stage })),
  };
}

export function resolveProjectPipeline(
  config: ProjectPipelineConfig,
  lookup: PipelineLookup,
  agentModelConfig: AgentModelConfig,
): ProjectPipelineResolutionResult {
  const parsed = parseProjectPipeline(config);
  if (!parsed.ok) return parsed;

  const selected = lookup(parsed.pipeline.name);
  if (!selected.ok) return selected;

  const definition = copyDefinition(selected.definition);
  for (const [stageId, posture] of parsed.pipeline.reviewOverrides) {
    const overrideKey = `projects.${config.projectKey}.pipeline.reviewOverrides.${stageId}`;
    const stage = definition.stages.find((candidate) => candidate.stageId === stageId);
    if (stage === undefined) {
      return invalid(overrideKey, `${overrideKey} must name an existing workflow stage`);
    }
    if (stage.kind !== "workflow") {
      return invalid(overrideKey, `${overrideKey} cannot target an approval stage`);
    }
    stage.review = posture;
  }

  definition.terminalAction = parsed.pipeline.terminalAction;

  const pipelineKey = `projects.${config.projectKey}.pipeline`;
  const terminalActionKey = `${pipelineKey}.terminalAction`;
  const nameKey = `${pipelineKey}.name`;
  const lacksImplementStage = !definition.stages.some(
    (stage) => stage.kind === "workflow" && stage.workflow === "implement",
  );
  if (invertTerminalActionConflictGuardForTest ? !lacksImplementStage : lacksImplementStage) {
    return invalid(
      terminalActionKey,
      `${terminalActionKey} is incompatible with ${nameKey} when the composed pipeline has no implement workflow stage`,
    );
  }

  const validation = validatePipelineDefinition(definition, { agentModelConfig });
  if (!validation.ok) {
    return {
      ok: false,
      error: { code: "invalid-pipeline-definition", errors: validation.errors },
    };
  }

  return { ok: true, definition };
}

export function formatProjectPipelineResolutionError(
  resolution: Extract<ProjectPipelineResolutionResult, { ok: false }>,
): string {
  const { error } = resolution;
  if (error.code === "invalid-project-pipeline-config") {
    return `${error.code}: ${error.message}`;
  }
  if (error.code === "unknown-pipeline") {
    return `${error.code}: ${error.name}`;
  }
  return `${error.code}: ${error.errors.map((item) => item.message).join("; ")}`;
}
