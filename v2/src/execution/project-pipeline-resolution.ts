import { isRecord } from "../../../shared/is-record.ts";
import {
  parseRatingLevel,
  RATING_DIMENSIONS,
  RATING_LEVELS,
  type RatingDimension,
  type RatingLevel,
} from "../../../shared/seed-metadata.ts";
import { isWorkflowReviewPosture, WORKFLOW_REVIEW_POSTURES } from "../commands/workflow-start-preparation.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { ProjectPipelineConfig } from "../config/machine-config-loader.ts";
import {
  PIPELINE_SUPERSEDE_POLICIES,
  PIPELINE_TERMINAL_ACTIONS,
  type PipelineDefinition,
  type PipelineSupersedePolicy,
  type PipelineTerminalAction,
  type PipelineValidationError,
  validatePipelineDefinition,
} from "./pipeline-definition.ts";
import type { getPipelineDefinition } from "./pipeline-registry.ts";

type PipelineLookup = typeof getPipelineDefinition;

/**
 * Ratings supplied per start: seed frontmatter merged with `--risk` / `--effort` (flag wins per dimension). Raw values —
 * an untyped caller may pass a non-string — validated here before the `pipeline.name` short-circuit and before floors.
 */
export type SuppliedRatings = Partial<Record<RatingDimension, unknown>>;

type InvalidProjectPipelineConfigError = {
  code: "invalid-project-pipeline-config";
  key: string;
  message: string;
};

type InvalidRatingError = { code: "invalid-rating"; dimension: RatingDimension; value: string; message: string };
type UnresolvedRatingError = { code: "unresolved-rating"; dimension: RatingDimension; message: string };

export type RatingAdmissionSource = "seed" | "flag" | "minimum";

type AdmissionRatingMetadata = {
  effective: Record<RatingDimension, RatingLevel>;
  sources: Record<RatingDimension, RatingAdmissionSource>;
};

type ProjectPipelineResolutionOptions = {
  ratingFlagPresence?: Partial<Record<RatingDimension, true>>;
};

type ProjectPipelineResolutionResult =
  | { ok: true; definition: PipelineDefinition; admissionRatings?: AdmissionRatingMetadata }
  | {
      ok: false;
      error:
        | InvalidProjectPipelineConfigError
        | InvalidRatingError
        | UnresolvedRatingError
        | { code: "unknown-pipeline"; name: string }
        | { code: "invalid-pipeline-definition"; errors: PipelineValidationError[] };
    };

type ParsedProjectPipeline = {
  name: string | undefined;
  minimums: Partial<Record<RatingDimension, RatingLevel>>;
  terminalAction: PipelineTerminalAction;
  supersede: PipelineSupersedePolicy;
  reviewOverrides: Array<[stageId: string, posture: string]>;
};

/**
 * One deterministic mapping from the effective (risk, effort) pair to a registry pipeline name. High risk always takes
 * the fullest review; only low risk with low effort takes the ungated pipeline; every other pair takes gated light
 * review. Dimensions are never collapsed into a score.
 */
export const RATING_PAIR_PIPELINES: Record<RatingLevel, Record<RatingLevel, string>> = {
  low: { low: "fast", medium: "full-light-review", high: "full-light-review" },
  medium: { low: "full-light-review", medium: "full-light-review", high: "full-light-review" },
  high: { low: "full-review", medium: "full-review", high: "full-review" },
};

/** The registry pipeline name selected for an effective (risk, effort) pair. */
export function selectPipelineForRatings(ratings: Record<RatingDimension, RatingLevel>): string {
  return RATING_PAIR_PIPELINES[ratings.risk][ratings.effort];
}

const MINIMUM_KEYS: Record<RatingDimension, string> = { risk: "minimumRisk", effort: "minimumEffort" };
const ALLOWED_PIPELINE_KEYS = new Set([
  "name",
  "terminalAction",
  "supersede",
  "reviewOverrides",
  ...Object.values(MINIMUM_KEYS),
]);

function invalid(key: string, message: string): { ok: false; error: InvalidProjectPipelineConfigError } {
  return { ok: false, error: { code: "invalid-project-pipeline-config", key, message } };
}

function parseNonEmptyEnumString<T extends string>(
  key: string,
  raw: unknown,
  allowed: readonly T[],
): { ok: true; value: T } | { ok: false; error: InvalidProjectPipelineConfigError } {
  if (typeof raw !== "string") {
    return invalid(key, `${key} must be a string`);
  }
  if (raw.length === 0) {
    return invalid(key, `${key} must be a non-empty string`);
  }
  if (!(allowed as readonly string[]).includes(raw)) {
    return invalid(key, `${key} has unknown value "${raw}"`);
  }
  return { ok: true, value: raw as T };
}

function parseMinimums(
  pipelineKey: string,
  pipeline: Record<string, unknown>,
): { ok: true; minimums: ParsedProjectPipeline["minimums"] } | { ok: false; error: InvalidProjectPipelineConfigError } {
  const minimums: ParsedProjectPipeline["minimums"] = {};
  for (const dimension of RATING_DIMENSIONS) {
    const raw = pipeline[MINIMUM_KEYS[dimension]];
    if (raw === undefined) continue;
    const parsed = parseNonEmptyEnumString(`${pipelineKey}.${MINIMUM_KEYS[dimension]}`, raw, RATING_LEVELS);
    if (!parsed.ok) return parsed;
    minimums[dimension] = parsed.value;
  }
  return { ok: true, minimums };
}

function parseReviewOverrides(
  reviewOverridesKey: string,
  rawOverrides: unknown,
): { ok: true; reviewOverrides: Array<[string, string]> } | { ok: false; error: InvalidProjectPipelineConfigError } {
  if (rawOverrides !== undefined && !isRecord(rawOverrides)) {
    return invalid(reviewOverridesKey, `${reviewOverridesKey} must be an object`);
  }
  const reviewOverrides: Array<[string, string]> = [];
  for (const [stageId, posture] of Object.entries(rawOverrides ?? {})) {
    const overrideKey = `${reviewOverridesKey}.${stageId}`;
    if (typeof posture !== "string") {
      return invalid(overrideKey, `${overrideKey} must be a string`);
    }
    if (!isWorkflowReviewPosture(posture)) {
      return invalid(overrideKey, `${overrideKey} has unknown review posture "${posture}"`);
    }
    reviewOverrides.push([stageId, posture]);
  }
  return { ok: true, reviewOverrides };
}

function parseProjectPipeline(
  config: ProjectPipelineConfig,
): { ok: true; pipeline: ParsedProjectPipeline } | { ok: false; error: InvalidProjectPipelineConfigError } {
  const pipelineKey = `projects.${config.projectKey}.pipeline`;
  if (!isRecord(config.pipeline)) {
    return invalid(pipelineKey, `${pipelineKey} must be an object`);
  }

  for (const key of Object.keys(config.pipeline)) {
    if (!ALLOWED_PIPELINE_KEYS.has(key)) {
      const offendingKey = `${pipelineKey}.${key}`;
      return invalid(offendingKey, `${offendingKey} is not allowed`);
    }
  }

  const nameKey = `${pipelineKey}.name`;
  const rawName = config.pipeline.name;
  if (rawName !== undefined && (typeof rawName !== "string" || rawName.length === 0)) {
    return invalid(nameKey, `${nameKey} must be a non-empty string`);
  }

  const minimums = parseMinimums(pipelineKey, config.pipeline);
  if (!minimums.ok) return minimums;

  const terminalActionKey = `${pipelineKey}.terminalAction`;
  const rawTerminalAction = config.pipeline.terminalAction;
  if (rawTerminalAction === undefined) {
    return invalid(terminalActionKey, `${terminalActionKey} is required`);
  }
  const parsedTerminalAction = parseNonEmptyEnumString(terminalActionKey, rawTerminalAction, PIPELINE_TERMINAL_ACTIONS);
  if (!parsedTerminalAction.ok) return parsedTerminalAction;

  const supersedeKey = `${pipelineKey}.supersede`;
  const rawSupersede = config.pipeline.supersede;
  let supersede: PipelineSupersedePolicy = "close";
  if (rawSupersede !== undefined) {
    const parsedSupersede = parseNonEmptyEnumString(supersedeKey, rawSupersede, PIPELINE_SUPERSEDE_POLICIES);
    if (!parsedSupersede.ok) return parsedSupersede;
    supersede = parsedSupersede.value;
  }

  const overrides = parseReviewOverrides(`${pipelineKey}.reviewOverrides`, config.pipeline.reviewOverrides);
  if (!overrides.ok) return overrides;

  return {
    ok: true,
    pipeline: {
      name: rawName,
      minimums: minimums.minimums,
      terminalAction: parsedTerminalAction.value,
      supersede,
      reviewOverrides: overrides.reviewOverrides,
    },
  };
}

function ratingRank(level: RatingLevel): number {
  return RATING_LEVELS.indexOf(level);
}

/** Every supplied rating must be on the scale, even when `pipeline.name` will ignore it for selection. */
function validateSuppliedRatings(
  supplied: SuppliedRatings,
): { ok: true; levels: Partial<Record<RatingDimension, RatingLevel>> } | { ok: false; error: InvalidRatingError } {
  const levels: Partial<Record<RatingDimension, RatingLevel>> = {};
  for (const dimension of RATING_DIMENSIONS) {
    const raw = supplied[dimension];
    if (raw === undefined) continue;
    // Guard before `parseRatingLevel`: a non-string from an untyped caller refuses, never throws.
    const level = typeof raw === "string" ? parseRatingLevel(raw) : undefined;
    if (level === undefined) {
      return {
        ok: false,
        error: {
          code: "invalid-rating",
          dimension,
          value: typeof raw === "string" ? raw : String(raw),
          message: `${dimension} rating must be one of ${RATING_LEVELS.join(", ")}; got ${JSON.stringify(raw)}`,
        },
      };
    }
    levels[dimension] = level;
  }
  return { ok: true, levels };
}

/**
 * Per dimension: `effective = max(project minimum, supplied)`. A minimum is a floor, never a default: with nothing
 * supplied the dimension is unresolved even when a minimum exists.
 */
function resolveEffectiveRatings(
  minimums: ParsedProjectPipeline["minimums"],
  supplied: Partial<Record<RatingDimension, RatingLevel>>,
  ratingFlagPresence: Partial<Record<RatingDimension, true>>,
):
  | {
      ok: true;
      ratings: Record<RatingDimension, RatingLevel>;
      sources: Record<RatingDimension, RatingAdmissionSource>;
    }
  | { ok: false; error: UnresolvedRatingError } {
  const ratings: Partial<Record<RatingDimension, RatingLevel>> = {};
  const sources: Partial<Record<RatingDimension, RatingAdmissionSource>> = {};
  for (const dimension of RATING_DIMENSIONS) {
    const suppliedLevel = supplied[dimension];
    if (suppliedLevel === undefined) {
      return {
        ok: false,
        error: {
          code: "unresolved-rating",
          dimension,
          message: `${dimension} rating is unresolved: neither seed frontmatter nor --${dimension} supplies one, and a project minimum is a floor, not a default`,
        },
      };
    }
    const minimum = minimums[dimension];
    const effective = maxRating(suppliedLevel, minimum);
    ratings[dimension] = effective;
    // Mutation checkpoint: negating the minimum floor guard must turn admission source tests RED.
    if (minimum !== undefined && ratingRank(minimum) > ratingRank(suppliedLevel)) {
      sources[dimension] = "minimum";
    } else if (ratingFlagPresence[dimension]) {
      sources[dimension] = "flag";
    } else {
      sources[dimension] = "seed";
    }
  }
  return {
    ok: true,
    ratings: ratings as Record<RatingDimension, RatingLevel>,
    sources: sources as Record<RatingDimension, RatingAdmissionSource>,
  };
}

function maxRating(supplied: RatingLevel, minimum: RatingLevel | undefined): RatingLevel {
  if (minimum === undefined) return supplied;
  return ratingRank(minimum) > ratingRank(supplied) ? minimum : supplied;
}

function postureRank(posture: string): number {
  return (WORKFLOW_REVIEW_POSTURES as readonly string[]).indexOf(posture);
}

function copyDefinition(definition: PipelineDefinition): PipelineDefinition {
  return {
    ...definition,
    stages: definition.stages.map((stage) => ({ ...stage })),
  };
}

type Selection = { name: string; label: string; ratingSelected: boolean };

function selectPipeline(
  parsed: ParsedProjectPipeline,
  supplied: SuppliedRatings,
  pipelineKey: string,
  ratingFlagPresence: Partial<Record<RatingDimension, true>>,
):
  | { ok: true; selection: Selection; admissionRatings?: AdmissionRatingMetadata }
  | { ok: false; error: InvalidRatingError | UnresolvedRatingError } {
  // Validate every supplied value first: a malformed `--risk` / `--effort` refuses even when `pipeline.name` wins.
  const validated = validateSuppliedRatings(supplied);
  if (!validated.ok) return validated;
  if (parsed.name !== undefined) {
    return { ok: true, selection: { name: parsed.name, label: `${pipelineKey}.name`, ratingSelected: false } };
  }
  const effective = resolveEffectiveRatings(parsed.minimums, validated.levels, ratingFlagPresence);
  if (!effective.ok) return effective;
  const name = selectPipelineForRatings(effective.ratings);
  return {
    ok: true,
    selection: {
      name,
      label: `the rating-selected pipeline "${name}" (risk ${effective.ratings.risk}, effort ${effective.ratings.effort})`,
      ratingSelected: true,
    },
    admissionRatings: { effective: effective.ratings, sources: effective.sources },
  };
}

function applyReviewOverrides(
  definition: PipelineDefinition,
  parsed: ParsedProjectPipeline,
  selection: Selection,
  pipelineKey: string,
): { ok: true } | { ok: false; error: InvalidProjectPipelineConfigError } {
  for (const [stageId, posture] of parsed.reviewOverrides) {
    const overrideKey = `${pipelineKey}.reviewOverrides.${stageId}`;
    const stage = definition.stages.find((candidate) => candidate.stageId === stageId);
    if (stage === undefined) {
      return invalid(overrideKey, `${overrideKey} must name an existing workflow stage`);
    }
    if (stage.kind !== "workflow") {
      return invalid(overrideKey, `${overrideKey} cannot target an approval stage`);
    }
    // Rating selection is a floor: an override may strengthen a stage's review but never weaken it.
    if (selection.ratingSelected && postureRank(posture) < postureRank(stage.review)) {
      return invalid(
        overrideKey,
        `${overrideKey} cannot weaken review "${stage.review}" to "${posture}" below ${selection.label}`,
      );
    }
    stage.review = posture;
  }
  return { ok: true };
}

/**
 * Resolves a project's admitted pipeline definition. Supplied ratings are validated first (`invalid-rating`); then
 * `pipeline.name`, when set, selects the definition outright and the ratings play no further part. Otherwise the
 * effective (risk, effort) pair — each dimension `max(project minimum, supplied rating)` — selects it through
 * `RATING_PAIR_PIPELINES`. Terminal action, supersede, and review overrides apply to the selected copy.
 */
export function resolveProjectPipeline(
  config: ProjectPipelineConfig,
  lookup: PipelineLookup,
  agentModelConfig: AgentModelConfig,
  supplied: SuppliedRatings = {},
  options: ProjectPipelineResolutionOptions = {},
): ProjectPipelineResolutionResult {
  const parsed = parseProjectPipeline(config);
  if (!parsed.ok) return parsed;

  const pipelineKey = `projects.${config.projectKey}.pipeline`;
  const ratingFlagPresence = options.ratingFlagPresence ?? {};
  const selection = selectPipeline(parsed.pipeline, supplied, pipelineKey, ratingFlagPresence);
  if (!selection.ok) return selection;

  const selected = lookup(selection.selection.name);
  if (!selected.ok) return selected;

  const definition = copyDefinition(selected.definition);
  const overridden = applyReviewOverrides(definition, parsed.pipeline, selection.selection, pipelineKey);
  if (!overridden.ok) return overridden;

  definition.terminalAction = parsed.pipeline.terminalAction;
  definition.supersede = parsed.pipeline.supersede;

  const terminalActionKey = `${pipelineKey}.terminalAction`;
  const lacksImplementStage = !definition.stages.some(
    (stage) => stage.kind === "workflow" && stage.workflow === "implement",
  );
  // Mutation checkpoint: negating `lacksImplementStage` here must turn
  // `rejects terminal-action approval conflicts` RED.
  if (lacksImplementStage) {
    return invalid(
      terminalActionKey,
      `${terminalActionKey} is incompatible with ${selection.selection.label} when the composed pipeline has no implement workflow stage`,
    );
  }

  const validation = validatePipelineDefinition(definition, { agentModelConfig });
  if (!validation.ok) {
    return {
      ok: false,
      error: { code: "invalid-pipeline-definition", errors: validation.errors },
    };
  }

  return {
    ok: true,
    definition,
    ...(selection.admissionRatings === undefined ? {} : { admissionRatings: selection.admissionRatings }),
  };
}

export function formatProjectPipelineResolutionError(
  resolution: Extract<ProjectPipelineResolutionResult, { ok: false }>,
): string {
  const { error } = resolution;
  if (error.code === "unknown-pipeline") {
    return `${error.code}: ${error.name}`;
  }
  if (error.code === "invalid-pipeline-definition") {
    return `${error.code}: ${error.errors.map((item) => item.message).join("; ")}`;
  }
  return `${error.code}: ${error.message}`;
}
