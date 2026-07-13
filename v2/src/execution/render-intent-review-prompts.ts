import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assemblePromptForStep } from "../../../shared/prompts/assemble.ts";
import { listIntentStageMarkdownFiles } from "../../../shared/prompts/intent-split.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { enforceDelimiterPolicy, renderTemplateWithDeclarations } from "../../../shared/prompts/render.ts";

const CRITIC_PROMPT_ID = "intent.prompt.review";
const ACTUATOR_PROMPT_ID = "intent.prompt.review-actuator";

export type IntentReviewPromptContext = {
  stagingDir: string;
  verdictPath: string;
};

function specGuidance(): string {
  return readFileSync(join(import.meta.dir, "..", "..", "..", "v1", "docs", "spec-guidance.md"), "utf8");
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

function renderIntentReviewPrompt(promptId: string, context: IntentReviewPromptContext, verdict = ""): string {
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
    },
  ).trim();
}

export function renderIntentReviewCriticPrompt(context: IntentReviewPromptContext): string {
  return renderIntentReviewPrompt(CRITIC_PROMPT_ID, context);
}

export function renderIntentReviewActuatorPrompt(context: IntentReviewPromptContext, verdict: string): string {
  return renderIntentReviewPrompt(ACTUATOR_PROMPT_ID, context, verdict);
}
