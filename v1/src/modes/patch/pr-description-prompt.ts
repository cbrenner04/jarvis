import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { renderTemplateWithDeclarations } from "../../../../shared/prompts/render.ts";

export function buildPrDescriptionPrompt(opts: { specPath: string; specContext: string }): string {
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
