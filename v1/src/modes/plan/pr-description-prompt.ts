import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { renderTemplateWithDeclarations } from "../../../../shared/prompts/render.ts";
import { enforceDelimiterPolicy } from "../../../../shared/prompts/render.ts";

export function buildPrDescriptionPrompt(opts: {
  intent: string;
  specContext: string;
}): string {
  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({
    registry,
    stepPromptId: "plan.prompt.pr-description",
  });

  enforceDelimiterPolicy({
    value: opts.intent,
    begin: "<<<INTENT_BEGIN>>>",
    end: "<<<INTENT_END>>>",
    placeholderName: "INTENT",
  });

  const rendered = renderTemplateWithDeclarations(
    template,
    [
      { name: "INTENT", type: "string", required: true },
      { name: "SPEC_CONTEXT", type: "string", required: true },
    ],
    {
      INTENT: opts.intent,
      SPEC_CONTEXT: opts.specContext,
    },
  );

  return rendered.trim();
}
