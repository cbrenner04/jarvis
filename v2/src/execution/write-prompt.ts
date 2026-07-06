import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { renderArtifactTemplate } from "../../../shared/prompts/render.ts";

export function renderStepPrompt(promptId: string, placeholders: Record<string, string>): string {
  const registry = loadPromptRegistry();
  const artifact = registry.getById(promptId);
  return renderArtifactTemplate(artifact, placeholders).trim();
}
