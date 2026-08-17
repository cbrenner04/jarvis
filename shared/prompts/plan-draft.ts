import { assemblePromptForStep } from "./assemble.ts";
import { loadPromptRegistry } from "./registry.ts";
import { enforceDelimiterPolicy, renderTemplateWithDeclarations } from "./render.ts";

export const PLAN_DRAFT_PROMPT_ID = "plan.prompt.draft";

const HARNESS_NORMALIZER_DIAGNOSTICS_HEADING = "## Prior harness normalizer diagnostics";

/**
 * Canonical ordered `## Prior harness normalizer diagnostics` section for a preserved plan-draft
 * redraft prompt: one numbered `<<<HARNESS_NORMALIZER_DIAGNOSTIC n BEGIN>>>`/`...END>>>` data zone
 * per payload, in source order, separated by one blank line. Callers only invoke this with a
 * non-empty list; the section is omitted entirely when no diagnostics were collected.
 */
export function buildHarnessNormalizerDiagnosticsSection(diagnostics: readonly string[]): string {
  const records = diagnostics.map((payload, index) => {
    const n = index + 1;
    const trimmed = payload.trim();
    return `<<<HARNESS_NORMALIZER_DIAGNOSTIC ${n} BEGIN>>>\n${trimmed}\n<<<HARNESS_NORMALIZER_DIAGNOSTIC ${n} END>>>`;
  });
  return `${HARNESS_NORMALIZER_DIAGNOSTICS_HEADING}\n\n${records.join("\n\n")}`;
}

export function buildPlanDraftPrompt(opts: {
  name: string;
  intent: string;
  specGuidance: string;
  workDirLabel?: string;
  targetDir?: string;
  flatSpecLayout?: boolean;
  specDir?: string;
  stepRules?: string;
  harnessNormalizerDiagnostics?: readonly string[];
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

  if (opts.harnessNormalizerDiagnostics !== undefined && opts.harnessNormalizerDiagnostics.length > 0) {
    sections.push(buildHarnessNormalizerDiagnosticsSection(opts.harnessNormalizerDiagnostics));
  }

  return sections.join("\n\n");
}
