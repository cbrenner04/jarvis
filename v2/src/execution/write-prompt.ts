import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { renderArtifactTemplate } from "../../../shared/prompts/render.ts";
import type { PromptRegistry } from "../../../shared/prompts/types.ts";

// Global fragments (order-ranked, minus the step's own `remove` list) are prepended ahead
// of the step body — mirrors assemblePromptForStep's global-fragment discovery, without the
// behavior-fragment half (write.execute's PRINCIPLES placeholder already carries write's
// behavior fragment; auto-including it here would duplicate it).
function globalFragmentBodies(registry: PromptRegistry, removeIds: readonly string[]): string[] {
  const remove = new Set(removeIds);
  return registry
    .all()
    .filter(
      (artifact) =>
        artifact.metadata.kind === "fragment" &&
        artifact.metadata.behavior === "global" &&
        !remove.has(artifact.metadata.id),
    )
    .sort((a, b) => {
      const ao = a.metadata.order;
      const bo = b.metadata.order;
      if (ao !== null && bo !== null) return ao - bo || a.metadata.id.localeCompare(b.metadata.id);
      if (ao !== null) return -1;
      if (bo !== null) return 1;
      return a.metadata.id.localeCompare(b.metadata.id);
    })
    .map((artifact) => artifact.body.trim());
}

export function renderStepPrompt(promptId: string, placeholders: Record<string, string>): string {
  const registry = loadPromptRegistry();
  const artifact = registry.getById(promptId);
  const globals = globalFragmentBodies(registry, artifact.metadata.remove);
  const body = [...globals, artifact.body.trim()].join("\n\n");
  return renderArtifactTemplate({ ...artifact, body }, placeholders).trim();
}
