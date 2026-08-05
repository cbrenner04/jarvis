import { parseArgs } from "node:util";
import type { ImplementReviewBehavior } from "../config/machine-config-loader.ts";

export const INTENT_WORKFLOW_PARSE_OPTIONS = {
  seed: { type: "string" },
  "seed-text": { type: "string" },
  "target-dir": { type: "string" },
  "review-passes": { type: "string" },
  "review-behavior": { type: "string" },
} as const satisfies Record<string, { type: "string" }>;

export const PLAN_WORKFLOW_PARSE_OPTIONS = {
  "ready-intent": { type: "string" },
  "target-dir": { type: "string" },
  "review-passes": { type: "string" },
  "review-behavior": { type: "string" },
  "reset-despite-dirty": { type: "boolean" },
  "reset-despite-landed-criteria": { type: "boolean" },
} as const satisfies Record<string, { type: "boolean" | "string" }>;

export const IMPLEMENT_WORKFLOW_PARSE_OPTIONS = {
  branch: { type: "string" },
  base: { type: "string" },
  spec: { type: "string" },
  artifact: { type: "string" },
  "review-passes": { type: "string" },
  "review-behavior": { type: "string" },
  "reset-despite-dirty": { type: "boolean" },
  "reset-despite-landed-criteria": { type: "boolean" },
} as const satisfies Record<string, { type: "boolean" | "string" }>;

type ReviewCliInput = { reviewPasses?: number; reviewBehavior?: ImplementReviewBehavior };

function parseReviewCliInput(
  values: Record<string, string | boolean | string[] | undefined>,
): ReviewCliInput | undefined {
  let reviewPasses: number | undefined;
  if (typeof values["review-passes"] === "string") {
    const raw = values["review-passes"];
    if (!/^\d+$/u.test(raw)) return undefined;
    reviewPasses = Number(raw);
    if (!Number.isSafeInteger(reviewPasses)) return undefined;
  }
  let reviewBehavior: ImplementReviewBehavior | undefined;
  if (typeof values["review-behavior"] === "string") {
    const raw = values["review-behavior"];
    if (raw !== "debate" && raw !== "light") return undefined;
    reviewBehavior = raw;
  }
  return {
    ...(reviewPasses !== undefined ? { reviewPasses } : {}),
    ...(reviewBehavior !== undefined ? { reviewBehavior } : {}),
  };
}

export type ImplementWorkflowCliInput =
  | {
      ok: true;
      branchName?: string;
      baseRef: string;
      specPath: string;
      artifactPath?: string;
      reviewPasses?: number;
      reviewBehavior?: ImplementReviewBehavior;
      resetDespiteDirty?: boolean;
      resetDespiteLandedCriteria?: boolean;
    }
  | { ok: false };

export function parseImplementWorkflowArgs(argv: readonly string[]): ImplementWorkflowCliInput {
  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    values = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: IMPLEMENT_WORKFLOW_PARSE_OPTIONS,
    }).values;
  } catch {
    return { ok: false };
  }

  const branchName = typeof values.branch === "string" ? values.branch : undefined;
  const baseRef = typeof values.base === "string" ? values.base : undefined;
  const specPath = typeof values.spec === "string" ? values.spec : undefined;
  const artifactPath = typeof values.artifact === "string" ? values.artifact : undefined;
  const review = parseReviewCliInput(values);
  if (review === undefined) return { ok: false };

  if (baseRef === undefined || specPath === undefined) {
    return { ok: false };
  }

  const resetDespiteDirty = values["reset-despite-dirty"] === true;
  const resetDespiteLandedCriteria = values["reset-despite-landed-criteria"] === true;

  return {
    ok: true,
    ...(branchName !== undefined ? { branchName } : {}),
    baseRef,
    specPath,
    ...(artifactPath !== undefined ? { artifactPath } : {}),
    ...review,
    ...(resetDespiteDirty ? { resetDespiteDirty: true } : {}),
    ...(resetDespiteLandedCriteria ? { resetDespiteLandedCriteria: true } : {}),
  };
}

export type IntentWorkflowCliInput =
  | ({ ok: true; seed: string; targetDir?: string } & ReviewCliInput)
  | ({ ok: true; seedText: string; targetDir?: string } & ReviewCliInput)
  | { ok: false };

export function parseIntentWorkflowArgs(argv: readonly string[]): IntentWorkflowCliInput {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: INTENT_WORKFLOW_PARSE_OPTIONS,
    }).values;
  } catch {
    return { ok: false };
  }
  const seed = typeof values.seed === "string" ? values.seed : undefined;
  const seedText = typeof values["seed-text"] === "string" ? values["seed-text"] : undefined;
  const targetDir = typeof values["target-dir"] === "string" ? values["target-dir"] : undefined;
  const review = parseReviewCliInput(values);
  if (review === undefined) return { ok: false };
  if ((seed === undefined) === (seedText === undefined)) return { ok: false };
  if (seed !== undefined) {
    return {
      ok: true,
      seed,
      ...(targetDir !== undefined ? { targetDir } : {}),
      ...review,
    };
  }
  if (seedText !== undefined) {
    return {
      ok: true,
      seedText,
      ...(targetDir !== undefined ? { targetDir } : {}),
      ...review,
    };
  }
  return { ok: false };
}

export type PlanWorkflowCliInput =
  | ({ ok: true; readyIntent: string; targetDir?: string; resetDespiteDirty?: boolean; resetDespiteLandedCriteria?: boolean } & ReviewCliInput)
  | { ok: false };

export function parsePlanWorkflowArgs(argv: readonly string[]): PlanWorkflowCliInput {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: PLAN_WORKFLOW_PARSE_OPTIONS,
    }).values;
  } catch {
    return { ok: false };
  }

  const readyIntent = typeof values["ready-intent"] === "string" ? values["ready-intent"] : undefined;
  const targetDir = typeof values["target-dir"] === "string" ? values["target-dir"] : undefined;
  const review = parseReviewCliInput(values);
  if (review === undefined) return { ok: false };

  if (readyIntent === undefined) {
    return { ok: false };
  }

  const resetDespiteDirty = values["reset-despite-dirty"] === true;
  const resetDespiteLandedCriteria = values["reset-despite-landed-criteria"] === true;

  return {
    ok: true,
    readyIntent,
    ...(targetDir !== undefined ? { targetDir } : {}),
    ...review,
    ...(resetDespiteDirty ? { resetDespiteDirty: true } : {}),
    ...(resetDespiteLandedCriteria ? { resetDespiteLandedCriteria: true } : {}),
  };
}

export const LEGACY_WORKFLOW_ALIASES: Readonly<
  Record<string, { canonical: "intent" | "plan"; passes: number; behavior: "debate" | "light" }>
> = {
  "intent-reviewed": { canonical: "intent", passes: 1, behavior: "light" },
  "plan-reviewed": { canonical: "plan", passes: 1, behavior: "debate" },
  "plan-reviewed-light": { canonical: "plan", passes: 1, behavior: "light" },
};
