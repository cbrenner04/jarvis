import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { renderTemplateWithDeclarations } from "../../../../shared/prompts/render.ts";

export function buildPrompt(specPath: string, siblings?: string[]): string {
  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({
    registry,
    stepPromptId: "patch.prompt.body",
  });

  let siblingsBlock = "";

  if (siblings !== undefined && siblings.length > 0) {
    const lines = [
      "Additional project sibling directories are available for this run:",
    ];
    for (const sibling of siblings) {
      lines.push(`- ${sibling}`);
    }
    lines.push(
      "Treat these directories as part of the target project when the active spec requires cross-repo edits.",
    );
    siblingsBlock = `${lines.join("\n")}\n`;
  }

  const rendered = renderTemplateWithDeclarations(
    template,
    [
      { name: "SPEC_PATH", type: "string", required: true },
      { name: "SIBLINGS_BLOCK", type: "string", required: true },
      { name: "PATCH_RULES", type: "string", required: true },
    ],
    {
      SPEC_PATH: specPath,
      SIBLINGS_BLOCK: siblingsBlock,
      PATCH_RULES: registry.getById("patch.rules").body.trim(),
    },
  );

  return rendered
    .replace("\n\nFollow these Jarvis rules:", "\nFollow these Jarvis rules:")
    .trim();
}
