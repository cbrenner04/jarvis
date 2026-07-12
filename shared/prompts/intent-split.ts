import { readdirSync } from "node:fs";
import { join } from "node:path";
import { assemblePromptForStep } from "./assemble.ts";
import { loadPromptRegistry } from "./registry.ts";
import { enforceDelimiterPolicy, PromptRenderingError, renderTemplateWithDeclarations } from "./render.ts";

export const INTENT_SPLIT_PROMPT_ID = "intent.prompt.split";

export function buildIntentSplitPrompt(opts: {
  workdir: string;
  seedLabel: string;
  seedContent: string;
  stagingDir: string;
  stepRules?: string;
}): string {
  const registry = loadPromptRegistry();
  const artifact = registry.getById(INTENT_SPLIT_PROMPT_ID);
  let template = assemblePromptForStep({
    registry,
    stepPromptId: INTENT_SPLIT_PROMPT_ID,
  });

  enforceDelimiterPolicy({
    value: opts.seedContent,
    begin: "<<<SEED_BEGIN>>>",
    end: "<<<SEED_END>>>",
    placeholderName: "SEED_CONTENT",
  });

  try {
    template = renderTemplateWithDeclarations(template, artifact.metadata.placeholders, {
      WORKDIR: opts.workdir,
      SEED_LABEL: opts.seedLabel,
      SEED_CONTENT: opts.seedContent,
    });
  } catch (err) {
    if (err instanceof PromptRenderingError) {
      throw new Error(`intent-split prompt configuration error: ${err.details}`);
    }
    throw err;
  }

  const sections = [
    template,
    `## File output

- Write the authored intents as markdown files under \`${opts.stagingDir}\`.
- Write one file per intent.
- Filename must be \`<name>.md\`, where \`name:\` is the frontmatter slug in that file.
- Include a \`## Prerequisites\` section in every emitted intent.
- If there are prerequisites, write one prerequisite behavior per physical line as \`- ...\`; do not use prose, numbered lists, nested bullets, or wrapped continuation lines.
- Leave the \`## Prerequisites\` body empty when there are no prerequisites.
- Do not create subdirectories.
- Do not edit any files outside \`${opts.stagingDir}\`.
- Do not write spec \`index.md\` files or numbered subspec files.`,
  ];

  if (opts.stepRules !== undefined && opts.stepRules.trim().length > 0) {
    sections.push(`## Step completion

${opts.stepRules.trim()}`);
  }

  return sections.join("\n\n");
}

export function listIntentStageMarkdownFiles(stagingDir: string): string[] {
  return readdirSync(stagingDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(stagingDir, entry.name))
    .sort();
}
