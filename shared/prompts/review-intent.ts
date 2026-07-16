import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assemblePromptForStep } from "./assemble.ts";
import { listIntentStageMarkdownFiles } from "./intent-split.ts";
import { loadPromptRegistry } from "./registry.ts";
import { enforceDelimiterPolicy, renderTemplateWithDeclarations } from "./render.ts";
import { bindReviewPromptProfile, intentReviewProfile } from "./review-profile.ts";

export type IntentReviewPromptContext = {
  stagingDir: string;
  verdictPath: string;
  passNumber?: number;
  totalPasses?: number;
  priorCycleVerdict?: string;
};

function specGuidance(): string {
  return readFileSync(join(import.meta.dir, "..", "..", "v1", "docs", "spec-guidance.md"), "utf8");
}

function stagedIntents(stagingDir: string): string {
  if (!existsSync(stagingDir)) return "";
  return listIntentStageMarkdownFiles(stagingDir)
    .map((path) => {
      const name = path.split(/[\\/]/u).at(-1) ?? path;
      return `<<<FILE name="${name}" BEGIN>>>\n${readFileSync(path, "utf8")}\n<<<FILE END>>>`;
    })
    .join("\n\n");
}

function renderIntentReviewPrompt(
  promptId: string,
  context: IntentReviewPromptContext,
  verdict = "",
  extra: Record<string, string> = {},
): string {
  const registry = loadPromptRegistry();
  const artifact = registry.getById(promptId);
  const staged = stagedIntents(context.stagingDir);
  enforceDelimiterPolicy({
    value: staged,
    begin: "<<<STAGED_INTENT_BEGIN>>>",
    end: "<<<STAGED_INTENT_END>>>",
    placeholderName: "STAGED_INTENT",
  });
  return renderTemplateWithDeclarations(
    assemblePromptForStep({ registry, stepPromptId: promptId }),
    artifact.metadata.placeholders,
    {
      STAGED_INTENT: staged,
      SPEC_GUIDANCE: specGuidance(),
      VERDICT: verdict,
      VERDICT_PATH: context.verdictPath,
      REVIEW_PASS_NUMBER: String(context.passNumber ?? 1),
      REVIEW_PASS_CONTEXT:
        context.priorCycleVerdict?.trim() ??
        (context.totalPasses === 1
          ? "This is the only review pass."
          : `This is review pass 1 of ${context.totalPasses ?? 1}.`),
      ADVERSARY_FINDINGS: "(no prior findings)",
      ADVOCATE_RESPONSE: "(no prior response)",
      ...extra,
    },
  ).trim();
}

export function renderIntentReviewCriticPrompt(context: IntentReviewPromptContext): string {
  return renderIntentReviewPrompt("intent.prompt.review", context);
}

export function renderIntentReviewActuatorPrompt(context: IntentReviewPromptContext, verdict: string): string {
  return renderIntentReviewPrompt("intent.prompt.review-actuator", context, verdict);
}

export const INTENT_REVIEW_DEBATE_ROLE_PROMPT_IDS = {
  adversary: "intent.prompt.review.adversary",
  advocate: "intent.prompt.review.advocate",
  adjudicator: "intent.prompt.review.adjudicator",
} as const;
export type IntentReviewDebateRole = keyof typeof INTENT_REVIEW_DEBATE_ROLE_PROMPT_IDS;

export function renderIntentReviewDebateRolePrompt(
  role: IntentReviewDebateRole,
  context: IntentReviewPromptContext,
  priorOutput?: string,
): string {
  return renderIntentReviewPrompt(
    INTENT_REVIEW_DEBATE_ROLE_PROMPT_IDS[role],
    context,
    "",
    role === "advocate"
      ? { ADVERSARY_FINDINGS: priorOutput ?? "(no prior findings)" }
      : role === "adjudicator"
        ? { ADVOCATE_RESPONSE: priorOutput ?? "(no prior response)" }
        : {},
  );
}

export const intentReviewPromptProfile = bindReviewPromptProfile<
  IntentReviewPromptContext,
  "critic" | "actuator" | IntentReviewDebateRole
>(intentReviewProfile, {
  critic: renderIntentReviewCriticPrompt,
  actuator: renderIntentReviewActuatorPrompt,
  debateRole: (role, context, prior) => {
    if (role === "critic" || role === "actuator") throw new Error(`unsupported intent debate role: ${role}`);
    return renderIntentReviewDebateRolePrompt(role, context, prior);
  },
});
