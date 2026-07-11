import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { assemblePromptForStep } from "../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { renderTemplateWithDeclarations } from "../../../shared/prompts/render.ts";
import { buildVerdictActuatorPrompt } from "../../../v1/src/modes/patch/prompt.ts";

/** Registry prompt ids for the three read-only patch review debate roles. */
export const PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS = {
  adversary: "patch.prompt.review.adversary",
  advocate: "patch.prompt.review.advocate",
  adjudicator: "patch.prompt.review.adjudicator",
} as const;

export type ReviewDebateRenderRole = keyof typeof PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS;

export type ReviewDebateRenderContext = {
  specPath: string;
  cwd: string;
  passNumber: number;
  totalPasses: number;
  baseBranch?: string;
  priorCycleVerdict?: string;
};

function reviewPassContext(passNumber: number, totalPasses: number, priorCycleVerdict?: string): string {
  const base =
    totalPasses === 1
      ? "This is the only review pass."
      : `This is review pass ${passNumber} of ${totalPasses}.`;
  if (priorCycleVerdict !== undefined && priorCycleVerdict.trim().length > 0) {
    return `${base}\n\nPrior cycle verdict:\n${priorCycleVerdict.trim()}`;
  }
  return base;
}

function buildSpecTree(specDir: string, cwd: string): string {
  const lines: string[] = [];
  visitSpecFiles(specDir, cwd, lines);
  return lines.join("");
}

function visitSpecFiles(dir: string, cwd: string, lines: string[]): void {
  let entries: Array<{ name: string; isDir: boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules")
      .map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDir) {
      visitSpecFiles(fullPath, cwd, lines);
    } else if (entry.name.endsWith(".md")) {
      try {
        const content = readFileSync(fullPath, "utf8");
        const relPath = relative(cwd, fullPath);
        lines.push(`<<<FILE name="${relPath}" BEGIN>>>\n`);
        lines.push(content);
        if (!content.endsWith("\n")) {
          lines.push("\n");
        }
        lines.push(`<<<FILE END>>>\n`);
      } catch {
        // skip unreadable files
      }
    }
  }
}

function getBranchDiffSummary(cwd: string, baseBranch: string): string {
  try {
    const mergeBase = execFileSync("git", ["merge-base", baseBranch, "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    const stat = execFileSync("git", ["diff", "--stat", mergeBase, "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    const paths = execFileSync("git", ["diff", "--name-only", mergeBase, "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    })
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    if (paths.length === 0) {
      return stat || "(no changes)";
    }

    return `${stat || "(no changes)"}\n\nChanged paths:\n${paths.join("\n")}`;
  } catch (err) {
    return `(failed to generate diff: ${err instanceof Error ? err.message : String(err)})`;
  }
}

export function renderReviewDebateRolePrompt(
  role: ReviewDebateRenderRole,
  context: ReviewDebateRenderContext,
  priorRoleOutput?: string,
): string {
  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({
    registry,
    stepPromptId: PATCH_REVIEW_DEBATE_ROLE_PROMPT_IDS[role],
  });

  const specPathAbs = context.specPath.startsWith("/") ? context.specPath : join(context.cwd, context.specPath);
  const specTree = buildSpecTree(dirname(specPathAbs), context.cwd);
  const branchDiff = getBranchDiffSummary(context.cwd, context.baseBranch ?? "main");
  const declarations = [
    { name: "SPEC_PATH", type: "string" as const, required: true },
    { name: "SPEC_TREE", type: "string" as const, required: true },
    { name: "BRANCH_DIFF", type: "string" as const, required: true },
    { name: "REVIEW_PASS_NUMBER", type: "string" as const, required: true },
    { name: "REVIEW_PASS_CONTEXT", type: "string" as const, required: true },
  ];
  const values: Record<string, string> = {
    SPEC_PATH: context.specPath,
    SPEC_TREE: specTree,
    BRANCH_DIFF: branchDiff,
    REVIEW_PASS_NUMBER: String(context.passNumber),
    REVIEW_PASS_CONTEXT: reviewPassContext(context.passNumber, context.totalPasses, context.priorCycleVerdict),
  };

  if (role === "advocate") {
    declarations.push({ name: "ADVERSARY_FINDINGS", type: "string" as const, required: true });
    values.ADVERSARY_FINDINGS = priorRoleOutput ?? "(no prior findings)";
  }

  if (role === "adjudicator") {
    declarations.push({ name: "ADVOCATE_RESPONSE", type: "string" as const, required: true });
    values.ADVOCATE_RESPONSE = priorRoleOutput ?? "(no advocate response)";
  }

  return renderTemplateWithDeclarations(template, declarations, values).trim();
}

export function renderReviewDebateActuatorPrompt(verdict: string, specPath: string): string {
  return buildVerdictActuatorPrompt(verdict, specPath);
}

export type ReviewDebateCyclePrompts = {
  adversary: string;
  advocate: string;
  adjudicator: string;
};

/** Render all three read-only role prompts for one cycle from optional prior-role stdout. */
export function renderReviewDebateCyclePrompts(
  context: ReviewDebateRenderContext,
  priorRoleOutputs: Partial<Record<ReviewDebateRenderRole, string>> = {},
): ReviewDebateCyclePrompts {
  const adversary = renderReviewDebateRolePrompt("adversary", context);
  const advocate = renderReviewDebateRolePrompt("advocate", context, priorRoleOutputs.adversary);
  const adjudicator = renderReviewDebateRolePrompt("adjudicator", context, priorRoleOutputs.advocate);
  return { adversary, advocate, adjudicator };
}

/** Carry an adjudicator verdict into the next cycle's render context. */
export function nextReviewDebateCycleContext(
  context: ReviewDebateRenderContext,
  priorCycleVerdict: string,
): ReviewDebateRenderContext {
  return {
    ...context,
    passNumber: context.passNumber + 1,
    priorCycleVerdict,
  };
}
