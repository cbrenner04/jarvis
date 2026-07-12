import { assemblePromptForStep } from "./assemble.ts";
import { loadPromptRegistry } from "./registry.ts";
import { enforceDelimiterPolicy, renderTemplateWithDeclarations } from "./render.ts";

export const PLAN_DRAFT_PROMPT_ID = "plan.prompt.draft";

export function buildPlanDraftPrompt(opts: {
  name: string;
  intent: string;
  specGuidance: string;
  workDirLabel?: string;
  targetDir?: string;
  flatSpecLayout?: boolean;
  specDir?: string;
  stepRules?: string;
}): string {
  const registry = loadPromptRegistry();
  const artifact = registry.getById(PLAN_DRAFT_PROMPT_ID);
  let template = assemblePromptForStep({
    registry,
    stepPromptId: PLAN_DRAFT_PROMPT_ID,
  });

  const workDir = opts.workDirLabel ?? opts.name;
  const targetDir = opts.targetDir ?? "spec";
  if (opts.flatSpecLayout) {
    template = template.replace(
      "- **Only write files under `spec/<NAME>/`.**",
      "- **Only write files in the working directory.** Do not create `spec/` subdirectories or other parent paths.",
    );
    template = template.replaceAll("spec/<NAME>/intent.md", "intent.md");
  } else {
    template = template.replaceAll("spec/<NAME>/", `${targetDir}/<NAME>/`);
  }

  enforceDelimiterPolicy({
    value: opts.intent,
    begin: "<<<INTENT_BEGIN>>>",
    end: "<<<INTENT_END>>>",
    placeholderName: "INTENT",
  });
  enforceDelimiterPolicy({
    value: opts.specGuidance,
    begin: "<<<SPEC_GUIDANCE_BEGIN>>>",
    end: "<<<SPEC_GUIDANCE_END>>>",
    placeholderName: "SPEC_GUIDANCE",
  });

  template = renderTemplateWithDeclarations(template, artifact.metadata.placeholders, {
    WORKDIR: workDir,
    NAME: opts.name,
    INTENT: opts.intent,
    SPEC_GUIDANCE: opts.specGuidance,
  });

  const sections = [template];

  if (opts.specDir !== undefined) {
    sections.push(`## File output

- Write \`index.md\` and numbered subspec files (\`00-*.md\`, \`01-*.md\`, etc.) under \`${opts.specDir}\`.
- Do not emit spec content to stdout.
- Do not write files outside \`${opts.specDir}\`.`);
  }

  if (opts.stepRules !== undefined && opts.stepRules.trim().length > 0) {
    sections.push(`## Step completion

${opts.stepRules.trim()}`);
  }

  return sections.join("\n\n");
}
