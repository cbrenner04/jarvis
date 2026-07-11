import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { renderArtifactTemplate } from "../../../shared/prompts/render.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { executeReviewCycle, type ReviewCycleInput, type ReviewCycleOutcome } from "./review-cycle.ts";

export type PlanReviewPromptContext = {
  specPath: string;
  jarvisRoot?: string;
  worktreePath: string;
};

export type PlanReviewCycleOutcome = ReviewCycleOutcome;

export type PlanReviewCycleInput = Omit<ReviewCycleInput, "prompt" | "actuatorPromptRenderer"> & {
  context: PlanReviewPromptContext;
};

export type PlanReviewCycleResult = {
  kind: "complete" | "invocation_failure";
  failureKind?: string;
  cycles: PlanReviewCycleOutcome[];
};

