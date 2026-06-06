import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { renderTemplateWithDeclarations } from "../../../../shared/prompts/render.ts";

export function buildPrompt(promptText: string): string {
  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({
    registry,
    stepPromptId: "prompt.prompt.body",
  });

  const rendered = renderTemplateWithDeclarations(template, [{ name: "PROMPT_TEXT", type: "string", required: true }], {
    PROMPT_TEXT: promptText,
  });

  return rendered.trim();
}
