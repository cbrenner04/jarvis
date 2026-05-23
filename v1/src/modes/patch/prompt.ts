import { loadPromptRegistry } from "../../prompts/registry.ts";

function jarvisRules(): string {
  return loadPromptRegistry().getById("patch.rules").body.trim();
}

export function buildPrompt(specPath: string, siblings?: string[]): string {
  const template = loadPromptRegistry().getById("patch.prompt.body").body;

  let siblingsBlock = "";

  if (siblings !== undefined && siblings.length > 0) {
    const lines = ["Additional project sibling directories are available for this run:"];
    for (const sibling of siblings) {
      lines.push(`- ${sibling}`);
    }
    lines.push(
      "Treat these directories as part of the target project when the active spec requires cross-repo edits.",
    );
    siblingsBlock = `${lines.join("\n")}\n`;
  }

  const rendered = template
    .replace("<SPEC_PATH>", specPath)
    .replace("<SIBLINGS_BLOCK>", siblingsBlock)
    .replace("<PATCH_RULES>", jarvisRules());

  return rendered.replace("\n\nFollow these Jarvis rules:", "\nFollow these Jarvis rules:").trim();
}
