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

export type ReviewPromptOpts = {
  specPath: string;
  cwd: string;
  passNumber: number;
  totalPasses: number;
};

// Build review prompt for a critique pass on completed patch work.
// Provides the agent with: spec tree (read-only data), branch diff vs base, pass context.
// Bias is subtractive: cut redundancy, simplify, reduce complexity.
export function buildReviewPrompt(opts: ReviewPromptOpts): string {
  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({
    registry,
    stepPromptId: "patch.prompt.review",
  });

  // Gather the full spec tree as read-only reference material
  const specTree = buildSpecTree(dirname(opts.specPath), opts.cwd);
  // Get the branch diff showing what changed vs base
  const branchDiff = getBranchDiff(opts.cwd);

  const context =
    opts.totalPasses === 1
      ? "This is the only review pass."
      : `This is review pass ${opts.passNumber} of ${opts.totalPasses}.`;

  const rendered = renderTemplateWithDeclarations(
    template,
    [
      { name: "SPEC_PATH", type: "string", required: true },
      { name: "SPEC_TREE", type: "string", required: true },
      { name: "BRANCH_DIFF", type: "string", required: true },
      { name: "REVIEW_PASS_NUMBER", type: "string", required: true },
      { name: "REVIEW_PASS_CONTEXT", type: "string", required: true },
    ],
    {
      SPEC_PATH: opts.specPath,
      SPEC_TREE: specTree,
      BRANCH_DIFF: branchDiff,
      REVIEW_PASS_NUMBER: String(opts.passNumber),
      REVIEW_PASS_CONTEXT: context,
    },
  );

  return rendered.trim();
}

function buildSpecTree(specDir: string, cwd: string): string {
  const lines: string[] = [];
  visitSpecFiles(specDir, cwd, "", lines);
  return lines.join("");
}

function visitSpecFiles(
  dir: string,
  cwd: string,
  indent: string,
  lines: string[],
): void {
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

function getBranchDiff(cwd: string): string {
  try {
    // Get the merge-base with main/master to find the common ancestor
    const baseBranch = getBaseBranch(cwd);
    const mergeBase = execFileSync(
      "git",
      ["merge-base", "--quiet", baseBranch, "HEAD"],
      {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
      },
    ).trim();

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

function getBaseBranch(cwd: string): string {
  try {
    return execFileSync(
      "git",
      ["config", "--default", "main", "--get", "jarvis.baseBranch"],
      {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
      },
    ).trim();
  } catch {
    return "main";
  }
}
