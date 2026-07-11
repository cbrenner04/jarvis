import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { renderArtifactTemplate } from "../../../shared/prompts/render.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { executeWithQuotaFallback, type InvocationOk } from "../../../shared/invocation/execute.ts";

export type PlanReviewLightInput = {
  cwd: string;
  specDir: string;
  intentPath: string;
  specGuidancePath: string;
  verdictPath: string;
  criticBindings: readonly InvocationBinding[];
  actuatorBindings: readonly InvocationBinding[];
  signal?: AbortSignal;
};

function readSpecFiles(specDir: string): string {
  const files: string[] = [];

  if (!existsSync(specDir)) {
    return "";
  }

  const entries = readdirSync(specDir, { withFileTypes: true });
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .sort((a, b) => {
      if (a.name === "index.md") return -1;
      if (b.name === "index.md") return 1;
      return a.name.localeCompare(b.name);
    });

  for (const file of mdFiles) {
    const content = readFileSync(join(specDir, file.name), "utf8");
    files.push(`<<<FILE name="${file.name}" BEGIN>>>\n${content}\n<<<FILE END>>>`);
  }

  return files.join("\n\n");
}

export async function executePlanReviewLight(args: PlanReviewLightInput): Promise<void> {
  const registry = loadPromptRegistry();
  const specContent = readSpecFiles(args.specDir);
  const intent = readFileSync(args.intentPath, "utf8");
  const specGuidance = readFileSync(args.specGuidancePath, "utf8");
  const name = args.specDir.split("/").pop()!;

  const criticArtifact = registry.getById("plan.prompt.review.critic");
  const criticPlaceholders = {
    WORKDIR: args.cwd,
    NAME: name,
    INTENT: intent,
    CURRENT_SPEC: specContent,
    SPEC_GUIDANCE: specGuidance,
    REVIEW_PASS_CONTEXT: "",
  };
  const criticPrompt = renderArtifactTemplate(criticArtifact, criticPlaceholders).trim();

  writeFileSync(args.verdictPath, "", "utf8");

  let verdict = "";
  try {
    const criticResult = await executeWithQuotaFallback({
      prompt: criticPrompt,
      cwd: args.cwd,
      bindings: args.criticBindings,
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
    });
    if (criticResult.final?.result.kind === "ok") {
      verdict = (criticResult.final.result as InvocationOk).stdout;
      writeFileSync(args.verdictPath, verdict, "utf8");
    }
  } catch {
    return;
  }

  if (verdict.trim().length === 0) {
    return;
  }

  const actuatorArtifact = registry.getById("plan.prompt.review-actuator");
  const actuatorPlaceholders = {
    WORKDIR: args.cwd,
    NAME: name,
    INTENT: intent,
    CURRENT_SPEC: specContent,
    SPEC_GUIDANCE: specGuidance,
    VERDICT: verdict,
  };
  const actuatorPrompt = renderArtifactTemplate(actuatorArtifact, actuatorPlaceholders).trim();

  try {
    await executeWithQuotaFallback({
      prompt: actuatorPrompt,
      cwd: args.cwd,
      bindings: args.actuatorBindings,
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
    });
  } catch {
    // verdict is persisted even if actuator fails
  }
}
