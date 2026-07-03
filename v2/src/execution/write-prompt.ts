import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { renderArtifactTemplate } from "../../../shared/prompts/render.ts";

export function renderWriteExecutePrompt(args: { specPath: string; stepRules: string }): string {
  const registry = loadPromptRegistry();
  const artifact = registry.getById("write.execute");
  const principlesArtifact = registry.getById("write.principles");
  return renderArtifactTemplate(artifact, {
    SPEC_PATH: args.specPath,
    PRINCIPLES: principlesArtifact.body,
    STEP_RULES: args.stepRules,
  }).trim();
}
