import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { detectAtRiskHollowPinsInMarkdown, formatAtRiskHollowPinsSection } from "../mutation-checkpoint-criteria.ts";
import { detectUnfalsifiablePremisesInMarkdown, formatUnfalsifiablePremisesSection } from "../premise-falsification.ts";
import { loadPromptRegistry } from "./registry.ts";
import { renderArtifactTemplate } from "./render.ts";
import { bindReviewPromptProfile, planReviewProfile } from "./review-profile.ts";

export type PlanReviewPromptContext = { worktreePath: string; specPath: string };

function readSpecFiles(specPath: string): string {
  if (!existsSync(specPath)) return "";
  const entries = readdirSync(specPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((a, b) => {
      if (a.name === "index.md") return -1;
      if (b.name === "index.md") return 1;
      return a.name.localeCompare(b.name);
    });
  return entries
    .map(
      (file) =>
        `<<<FILE name="${file.name}" BEGIN>>>\n${readFileSync(join(specPath, file.name), "utf8")}\n<<<FILE END>>>`,
    )
    .join("\n\n");
}

/** `REVIEW_PASS_CONTEXT` for plan debate roles; sibling passes add named sections here. */
export function buildPlanReviewPassContext(context: PlanReviewPromptContext): string {
  const specPath = context.specPath;
  if (!existsSync(specPath)) return "";
  const stagedFiles = readdirSync(specPath, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md" && entry.name !== "intent.md",
  );
  const premiseFindings = stagedFiles.flatMap((entry) =>
    detectUnfalsifiablePremisesInMarkdown(readFileSync(join(specPath, entry.name), "utf8"), entry.name),
  );
  const hollowFindings = stagedFiles.flatMap((entry) =>
    detectAtRiskHollowPinsInMarkdown(readFileSync(join(specPath, entry.name), "utf8"), entry.name),
  );
  return [formatUnfalsifiablePremisesSection(premiseFindings), formatAtRiskHollowPinsSection(hollowFindings)]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

function renderPlanReviewPrompt(
  promptId: string,
  context: PlanReviewPromptContext,
  verdict = "",
  extra: Record<string, string> = {},
): string {
  const artifact = loadPromptRegistry().getById(promptId);
  return renderArtifactTemplate(artifact, {
    WORKDIR: context.worktreePath,
    NAME: basename(context.specPath.replace(/\\/g, "/")),
    INTENT: existsSync(join(context.specPath, "intent.md"))
      ? readFileSync(join(context.specPath, "intent.md"), "utf8")
      : "",
    CURRENT_SPEC: readSpecFiles(context.specPath),
    SPEC_GUIDANCE: readFileSync(join(import.meta.dir, "..", "..", "v1", "docs", "spec-guidance.md"), "utf8"),
    REVIEW_PASS_CONTEXT: "",
    VERDICT: verdict,
    ...extra,
  }).trim();
}

export function renderPlanReviewCriticPrompt(context: PlanReviewPromptContext): string {
  return renderPlanReviewPrompt("plan.prompt.review.critic", context);
}

export function renderPlanReviewActuatorPrompt(context: PlanReviewPromptContext, verdict: string): string {
  return renderPlanReviewPrompt("plan.prompt.review-actuator", context, verdict);
}

export type PlanReviewDebateRole = "adversary" | "advocate" | "adjudicator";

export function renderPlanReviewDebateRolePrompt(
  role: PlanReviewDebateRole,
  context: PlanReviewPromptContext,
  priorOutput?: string,
): string {
  return renderPlanReviewPrompt(`plan.prompt.review.${role}`, context, "", {
    REVIEW_PASS_CONTEXT: buildPlanReviewPassContext(context),
    ...(role === "advocate"
      ? { ADVERSARY_FINDINGS: priorOutput ?? "(no prior findings)" }
      : role === "adjudicator"
        ? { ADVOCATE_RESPONSE: priorOutput ?? "(no prior response)" }
        : {}),
  });
}

export const planReviewPromptProfile = bindReviewPromptProfile<PlanReviewPromptContext, PlanReviewDebateRole>(
  planReviewProfile,
  {
    critic: renderPlanReviewCriticPrompt,
    actuator: renderPlanReviewActuatorPrompt,
    debateRole: renderPlanReviewDebateRolePrompt,
  },
);
