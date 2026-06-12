import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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
    const lines = ["Additional project sibling directories are available for this run:"];
    for (const sibling of siblings) {
      lines.push(`- ${sibling}`);
    }
    lines.push("Treat these directories as part of the target project when the active spec requires cross-repo edits.");
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

  return rendered.replace("\n\nFollow these Jarvis rules:", "\nFollow these Jarvis rules:").trim();
}

export type ReviewPromptOpts = {
  specPath: string;
  cwd: string;
  passNumber: number;
  totalPasses: number;
  /** Base branch to diff against. Defaults to `main`. */
  baseBranch?: string;
  /** Review role: adversary, advocate, or adjudicator. */
  role?: "adversary" | "advocate" | "adjudicator";
  /** Prior role's artifact (e.g., adversary findings for advocate). */
  priorArtifact?: string;
};

// Build review prompt for a critique pass on completed patch work.
// Provides the agent with: spec tree (read-only data), branch diff vs base, pass context.
// Bias is subtractive: cut redundancy, simplify, reduce complexity.
export function buildReviewPrompt(opts: ReviewPromptOpts): string {
  const registry = loadPromptRegistry();
  const role = opts.role ?? "adversary";

  // Select role-specific prompt template
  const promptId =
    role === "adjudicator"
      ? "patch.prompt.review.adjudicator"
      : role === "advocate"
        ? "patch.prompt.review.advocate"
        : "patch.prompt.review.adversary";

  const template = assemblePromptForStep({
    registry,
    stepPromptId: promptId,
  });

  // Gather the full spec tree as read-only reference material
  const specTree = buildSpecTree(dirname(opts.specPath), opts.cwd);
  // Get the branch diff showing what changed vs base
  const branchDiff = getBranchDiff(opts.cwd, opts.baseBranch ?? "main");

  const context =
    opts.totalPasses === 1
      ? "This is the only review pass."
      : `This is review pass ${opts.passNumber} of ${opts.totalPasses}.`;

  const declarations = [
    { name: "SPEC_PATH", type: "string" as const, required: true },
    { name: "SPEC_TREE", type: "string" as const, required: true },
    { name: "BRANCH_DIFF", type: "string" as const, required: true },
    { name: "REVIEW_PASS_NUMBER", type: "string" as const, required: true },
    { name: "REVIEW_PASS_CONTEXT", type: "string" as const, required: true },
  ];

  const values: Record<string, string> = {
    SPEC_PATH: opts.specPath,
    SPEC_TREE: specTree,
    BRANCH_DIFF: branchDiff,
    REVIEW_PASS_NUMBER: String(opts.passNumber),
    REVIEW_PASS_CONTEXT: context,
  };

  // Add role-specific placeholders for advocate and adjudicator
  if (role === "advocate") {
    declarations.push({ name: "ADVERSARY_FINDINGS", type: "string" as const, required: true });
    values.ADVERSARY_FINDINGS = opts.priorArtifact || "(no prior findings)";
  }

  if (role === "adjudicator") {
    declarations.push({ name: "ADVOCATE_RESPONSE", type: "string" as const, required: true });
    // For adjudicator, priorArtifact should be the advocate's response; if not available use a placeholder
    values.ADVOCATE_RESPONSE = opts.priorArtifact || "(no advocate response)";
  }

  const rendered = renderTemplateWithDeclarations(template, declarations, values);

  return rendered.trim();
}

function buildSpecTree(specDir: string, cwd: string): string {
  const lines: string[] = [];
  visitSpecFiles(specDir, cwd, "", lines);
  return lines.join("");
}

function visitSpecFiles(dir: string, cwd: string, indent: string, lines: string[]): void {
  let entries: Array<{ name: string; isDir: boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.name !== ".git" && e.name !== "node_modules")
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
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
      visitSpecFiles(fullPath, cwd, indent, lines);
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

function getBranchDiff(cwd: string, baseBranch: string): string {
  try {
    // Find the common ancestor with the base branch, then diff to HEAD.
    const mergeBase = execFileSync("git", ["merge-base", baseBranch, "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    // Get diff from merge-base to HEAD
    const diff = execFileSync("git", ["diff", mergeBase], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });

    return diff || "(no changes)";
  } catch (err) {
    return `(failed to generate diff: ${err instanceof Error ? err.message : String(err)})`;
  }
}

export function buildVerdictActuatorPrompt(verdict: string, specPath: string): string {
  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({
    registry,
    stepPromptId: "patch.prompt.body",
  });

  const rendered = renderTemplateWithDeclarations(
    template,
    [
      { name: "SPEC_PATH", type: "string", required: true },
      { name: "SIBLINGS_BLOCK", type: "string", required: true },
      { name: "PATCH_RULES", type: "string", required: true },
    ],
    {
      SPEC_PATH: specPath,
      SIBLINGS_BLOCK: "",
      PATCH_RULES: registry.getById("patch.rules").body.trim(),
    },
  );

  // Replace the final instruction with the verdict
  const basePrompt = rendered.replace("\n\nFollow these Jarvis rules:", "\nFollow these Jarvis rules:").trim();
  return `${basePrompt}\n\n## Review Verdict\n\nBased on a review of your implementation, the following changes are required:\n\n${verdict}`;
}
