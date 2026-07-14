import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { dirname, join, relative } from "node:path";
import { assemblePromptForStep } from "./assemble.ts";
import { loadPromptRegistry } from "./registry.ts";
import { renderTemplateWithDeclarations } from "./render.ts";
import { bindReviewPromptProfile, implementReviewProfile } from "./review-profile.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../subprocess.ts";

export const PATCH_REVIEW_CRITIC_PROMPT_ID = "patch.prompt.review.critic" as const;
export const PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS = {
  adversary: "patch.prompt.review.adversary",
  advocate: "patch.prompt.review.advocate",
  adjudicator: "patch.prompt.review.adjudicator",
} as const;
export type ReviewDebateRenderRole = keyof typeof PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS;
export type ReviewDebateRenderContext = {
  specPath: string; cwd: string; passNumber: number; totalPasses: number; baseBranch?: string; priorCycleVerdict?: string;
};

function visit(dir: string, cwd: string, out: string[]): void {
  let entries: Dirent<string>[];
  try { entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" }); } catch { return; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) visit(path, cwd, out);
    else if (entry.name.endsWith(".md")) {
      const content = readFileSync(path, "utf8");
      out.push(`<<<FILE name="${relative(cwd, path)}" BEGIN>>>\n${content}${content.endsWith("\n") ? "" : "\n"}<<<FILE END>>>\n`);
    }
  }
}

async function branchDiff(cwd: string, baseBranch: string, runner: AsyncSubprocessRunner): Promise<string> {
  try {
    const mergeBase = (await runner.runAsync("git", ["merge-base", baseBranch, "HEAD"], cwd)).trim();
    const stat = (await runner.runAsync("git", ["diff", "--stat", mergeBase, "HEAD"], cwd)).trim();
    const paths = (await runner.runAsync("git", ["diff", "--name-only", mergeBase, "HEAD"], cwd)).trim();
    return `${stat || "(no changes)"}${paths ? `\n\nChanged paths:\n${paths.split("\n").filter(Boolean).sort().join("\n")}` : ""}`;
  } catch (error) { return `(failed to generate diff: ${error instanceof Error ? error.message : String(error)})`; }
}

function passContext(context: ReviewDebateRenderContext): string {
  const base = context.totalPasses === 1 ? "This is the only review pass." : `This is review pass ${context.passNumber} of ${context.totalPasses}.`;
  return context.priorCycleVerdict?.trim() ? `${base}\n\nPrior cycle verdict:\n${context.priorCycleVerdict.trim()}` : base;
}

function stripOptionalSection(text: string, header: string, begin: string, end: string): string {
  const headerIndex = text.indexOf(header);
  if (headerIndex < 0) return text;
  const beginIndex = text.indexOf(begin, headerIndex);
  const endIndex = text.indexOf(end, beginIndex);
  if (beginIndex < 0 || endIndex < 0) return text;
  let removeEnd = endIndex + end.length;
  while (text[removeEnd] === "\n") removeEnd += 1;
  return `${text.slice(0, headerIndex)}${text.slice(removeEnd)}`;
}

function patchBodyPrompt(specPath: string): string {
  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({ registry, stepPromptId: "patch.prompt.body" });
  const declarations = [
    { name: "SPEC_PATH", type: "string" as const, required: true }, { name: "SIBLINGS_BLOCK", type: "string" as const, required: true },
    { name: "REPO_GUIDANCE", type: "string" as const, required: true }, { name: "ACTIVE_SUBSPEC_PATH", type: "string" as const, required: true },
    { name: "ACTIVE_SUBSPEC_BODY", type: "string" as const, required: true }, { name: "PATCH_RULES", type: "string" as const, required: true },
    { name: "TIMEOUT_CHECKPOINT_CONTEXT", type: "string" as const, required: true }, { name: "STEP_RULES", type: "string" as const, required: true },
  ];
  let rendered = renderTemplateWithDeclarations(template, declarations, {
    SPEC_PATH: specPath, SIBLINGS_BLOCK: "", REPO_GUIDANCE: "", ACTIVE_SUBSPEC_PATH: "", ACTIVE_SUBSPEC_BODY: "",
    PATCH_RULES: registry.getById("patch.rules").body.trim(), TIMEOUT_CHECKPOINT_CONTEXT: "", STEP_RULES: "",
  });
  for (const section of [
    ["## Repo Guidance", "<<<REPO_GUIDANCE_BEGIN>>>", "<<<REPO_GUIDANCE_END>>>"] as const,
    ["## Active Subspec", "<<<ACTIVE_SUBSPEC_BEGIN>>>", "<<<ACTIVE_SUBSPEC_END>>>"] as const,
    ["## Timeout Checkpoint", "<<<TIMEOUT_CHECKPOINT_BEGIN>>>", "<<<TIMEOUT_CHECKPOINT_END>>>"] as const,
  ]) rendered = stripOptionalSection(rendered, section[0], section[1], section[2]);
  return rendered.replace("\n\nFollow these Jarvis rules:", "\nFollow these Jarvis rules:").trim();
}

async function renderStep(stepPromptId: string, context: ReviewDebateRenderContext, extra: Record<string, string> = {}, runner = realAsyncSubprocessRunner): Promise<string> {
  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({ registry, stepPromptId });
  const tree: string[] = [];
  const specPath = context.specPath.startsWith("/") ? context.specPath : join(context.cwd, context.specPath);
  visit(dirname(specPath), context.cwd, tree);
  return renderTemplateWithDeclarations(template, [
    { name: "SPEC_PATH", type: "string", required: true }, { name: "SPEC_TREE", type: "string", required: true },
    { name: "BRANCH_DIFF", type: "string", required: true }, { name: "REVIEW_PASS_NUMBER", type: "string", required: true },
    { name: "REVIEW_PASS_CONTEXT", type: "string", required: true },
    ...Object.keys(extra).map((name) => ({ name, type: "string" as const, required: true })),
  ], { SPEC_PATH: context.specPath, SPEC_TREE: tree.join(""), BRANCH_DIFF: await branchDiff(context.cwd, context.baseBranch ?? "main", runner), REVIEW_PASS_NUMBER: String(context.passNumber), REVIEW_PASS_CONTEXT: passContext(context), ...extra }).trim();
}

export function renderReviewDebateActuatorPrompt(verdict: string, specPath: string): string {
  const body = patchBodyPrompt(specPath);
  return `${body}\n\n## Review Actuator Rules\n\n- Apply the review verdict to implementation files only.\n- The completed spec tree is read-only: do not edit spec files, tick criteria, append blockers, or edit verdict-patch.md.\n- Do not expand scope beyond the verdict.\n\n## Review Verdict\n\nBased on a review of your implementation, the following changes are required:\n\n${verdict}`;
}

export async function renderPatchReviewCriticPrompt(context: ReviewDebateRenderContext, runner = realAsyncSubprocessRunner): Promise<string> { return renderStep(PATCH_REVIEW_CRITIC_PROMPT_ID, context, {}, runner); }
export async function renderReviewDebateRolePrompt(role: ReviewDebateRenderRole, context: ReviewDebateRenderContext, priorRoleOutput?: string, runner = realAsyncSubprocessRunner): Promise<string> {
  return renderStep(PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS[role], context, role === "advocate" ? { ADVERSARY_FINDINGS: priorRoleOutput ?? "(no prior findings)" } : role === "adjudicator" ? { ADVOCATE_RESPONSE: priorRoleOutput ?? "(no advocate response)" } : {}, runner);
}
export const implementReviewPromptProfile = bindReviewPromptProfile<ReviewDebateRenderContext, ReviewDebateRenderRole>(implementReviewProfile, {
  critic: (context) => renderPatchReviewCriticPrompt(context), actuator: (context, verdict) => renderReviewDebateActuatorPrompt(verdict, context.specPath), debateRole: (role, context, prior) => renderReviewDebateRolePrompt(role, context, prior),
});
export type ReviewDebateCyclePrompts = { adversary: string; advocate: string; adjudicator: string };
export async function renderReviewDebateCyclePrompts(context: ReviewDebateRenderContext, prior: Partial<Record<ReviewDebateRenderRole, string>> = {}, runner = realAsyncSubprocessRunner): Promise<ReviewDebateCyclePrompts> {
  return { adversary: await renderReviewDebateRolePrompt("adversary", context, undefined, runner), advocate: await renderReviewDebateRolePrompt("advocate", context, prior.adversary, runner), adjudicator: await renderReviewDebateRolePrompt("adjudicator", context, prior.advocate, runner) };
}
export function nextReviewDebateCycleContext(context: ReviewDebateRenderContext, priorCycleVerdict: string): ReviewDebateRenderContext { return { ...context, passNumber: context.passNumber + 1, priorCycleVerdict }; }
