import { renderPromptForStep } from "./assemble.ts";
import { enforceDelimiterPolicy } from "./render.ts";
import { loadPromptRegistry } from "./registry.ts";
import { DEFAULT_WRITE_STEP_RULES } from "./step-rules.ts";

export const REVIEW_FEEDBACK_WRITE_PROMPT_ID = "review-feedback.prompt.write";
export const REVIEW_FEEDBACK_RULES_PROMPT_ID = "review-feedback.rules";

export type ReviewFeedbackLaneKind = "intent" | "plan" | "implement";

export function buildReviewFeedbackLaneContext(opts: {
  laneKind: ReviewFeedbackLaneKind;
  entrySpecPath: string;
  projectRoot?: string;
}): string {
  switch (opts.laneKind) {
    case "intent":
      return `- Ready-intents root: \`${opts.entrySpecPath}\`\n- Seed-split intent files live under that directory.`;
    case "plan":
      return `- Admitted plan spec tree root: \`${opts.entrySpecPath}\``;
    case "implement":
      return `- Project root: \`${opts.projectRoot ?? opts.entrySpecPath}\`\n- Lane spec path (code context): \`${opts.entrySpecPath}\``;
  }
}

export function renderReviewFeedbackRulesBody(): string {
  return loadPromptRegistry().getById(REVIEW_FEEDBACK_RULES_PROMPT_ID).body.trim();
}

export function resolveReviewFeedbackStepRules(stepRules?: string): string {
  if (stepRules !== undefined && stepRules.trim().length > 0) {
    return stepRules.trim();
  }
  return `${renderReviewFeedbackRulesBody()}\n\n${DEFAULT_WRITE_STEP_RULES}`;
}

export function buildReviewFeedbackWritePrompt(opts: {
  reviewInput: string;
  laneKind: ReviewFeedbackLaneKind;
  laneContext?: string;
  entrySpecPath?: string;
  projectRoot?: string;
  stepRules?: string;
}): string {
  enforceDelimiterPolicy({
    value: opts.reviewInput,
    begin: "<<<REVIEW_INPUT_BEGIN>>>",
    end: "<<<REVIEW_INPUT_END>>>",
    placeholderName: "REVIEW_INPUT",
  });

  const laneContext =
    opts.laneContext ??
    (opts.entrySpecPath === undefined
      ? undefined
      : buildReviewFeedbackLaneContext(
          opts.projectRoot !== undefined
            ? {
                laneKind: opts.laneKind,
                entrySpecPath: opts.entrySpecPath,
                projectRoot: opts.projectRoot,
              }
            : { laneKind: opts.laneKind, entrySpecPath: opts.entrySpecPath },
        ));

  if (laneContext === undefined || laneContext.trim().length === 0) {
    throw new Error("review-feedback write prompt requires laneContext or entrySpecPath");
  }

  return renderPromptForStep({
    stepPromptId: REVIEW_FEEDBACK_WRITE_PROMPT_ID,
    placeholders: {
      REVIEW_INPUT: opts.reviewInput,
      LANE_KIND: opts.laneKind,
      LANE_CONTEXT: laneContext,
      STEP_RULES: resolveReviewFeedbackStepRules(opts.stepRules),
    },
  });
}
