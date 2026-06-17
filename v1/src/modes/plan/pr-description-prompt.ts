import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { enforceDelimiterPolicy, renderTemplateWithDeclarations } from "../../../../shared/prompts/render.ts";

const PR_DESCRIPTION_BEGIN = "<<<PR_DESCRIPTION_BEGIN>>>";
const PR_DESCRIPTION_END = "<<<PR_DESCRIPTION_END>>>";

export function buildPrDescriptionPrompt(opts: { intent: string; specContext: string }): string {
  // Guard injected content against PR description sentinels
  enforceDelimiterPolicy({
    value: opts.intent,
    begin: PR_DESCRIPTION_BEGIN,
    end: PR_DESCRIPTION_END,
    placeholderName: "INTENT",
  });

  enforceDelimiterPolicy({
    value: opts.specContext,
    begin: PR_DESCRIPTION_BEGIN,
    end: PR_DESCRIPTION_END,
    placeholderName: "SPEC_CONTEXT",
  });

  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({
    registry,
    stepPromptId: "plan.prompt.pr-description",
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
