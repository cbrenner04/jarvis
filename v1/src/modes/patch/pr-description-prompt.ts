import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { enforceDelimiterPolicy, renderTemplateWithDeclarations } from "../../../../shared/prompts/render.ts";

const PR_DESCRIPTION_BEGIN = "<<<PR_DESCRIPTION_BEGIN>>>";
const PR_DESCRIPTION_END = "<<<PR_DESCRIPTION_END>>>";

export function buildPrDescriptionPrompt(opts: { specPath: string; specContext: string }): string {
  // Guard injected content against PR description sentinels
  enforceDelimiterPolicy({
    value: opts.specContext,
    begin: PR_DESCRIPTION_BEGIN,
    end: PR_DESCRIPTION_END,
    placeholderName: "SPEC_CONTEXT",
  });

  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({
    registry,
    stepPromptId: "patch.prompt.pr-description",
  });

  const rendered = renderTemplateWithDeclarations(
    template,
    [
      { name: "SPEC_PATH", type: "string", required: true },
      { name: "SPEC_CONTEXT", type: "string", required: true },
    ],
    {
      SPEC_PATH: opts.specPath,
      SPEC_CONTEXT: opts.specContext,
    },
  );

  return rendered.trim();
}
