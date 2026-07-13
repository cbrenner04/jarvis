import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { assemblePromptForStep } from "../../../../shared/prompts/assemble.ts";
import { loadPromptRegistry } from "../../../../shared/prompts/registry.ts";
import { renderTemplateWithDeclarations } from "../../../../shared/prompts/render.ts";
import { DEFAULT_WRITE_STEP_RULES } from "../../../../shared/prompts/step-rules.ts";

export type BuildPromptExtras = {
  repoGuidance?: string;
  activeSubspecPath?: string;
  activeSubspecBody?: string;
  timeoutCheckpointContext?: string;
};

/** Read bounded repo guidance from the registered target repo root. */
export function readRepoGuidance(projectRoot: string): string {
  const parts: string[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const path = join(projectRoot, name);
    if (existsSync(path)) {
      parts.push(readFileSync(path, "utf8"));
    }
  }
  return parts.join(parts.length > 1 ? "\n\n" : "");
}

function stripOptionalPromptSection(
  text: string,
  sectionHeader: string,
  beginMarker: string,
  endMarker: string,
): string {
  const headerIndex = text.indexOf(sectionHeader);
  if (headerIndex === -1) {
    return text;
  }
  const beginIndex = text.indexOf(beginMarker, headerIndex);
  const endIndex = text.indexOf(endMarker, beginIndex);
  if (beginIndex === -1 || endIndex === -1) {
    return text;
  }
  let removeEnd = endIndex + endMarker.length;
  while (text[removeEnd] === "\n") {
    removeEnd += 1;
  }
  return `${text.slice(0, headerIndex)}${text.slice(removeEnd)}`;
}

export function buildPrompt(specPath: string, siblings?: string[], extras?: BuildPromptExtras): string {
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

  const repoGuidance = extras?.repoGuidance ?? "";
  const activeSubspecPath = extras?.activeSubspecPath ?? "";
  const activeSubspecBody = extras?.activeSubspecBody ?? "";
  const timeoutCheckpointContext = extras?.timeoutCheckpointContext ?? "";
  const activeSubspecPathLine = activeSubspecPath.length > 0 ? `${activeSubspecPath}\n` : "";

  let rendered = renderTemplateWithDeclarations(
    template,
    [
      { name: "SPEC_PATH", type: "string", required: true },
      { name: "SIBLINGS_BLOCK", type: "string", required: true },
      { name: "REPO_GUIDANCE", type: "string", required: true },
      { name: "ACTIVE_SUBSPEC_PATH", type: "string", required: true },
      { name: "ACTIVE_SUBSPEC_BODY", type: "string", required: true },
      { name: "PATCH_RULES", type: "string", required: true },
      { name: "TIMEOUT_CHECKPOINT_CONTEXT", type: "string", required: true },
      { name: "STEP_RULES", type: "string", required: true },
    ],
    {
      SPEC_PATH: specPath,
      SIBLINGS_BLOCK: siblingsBlock,
      REPO_GUIDANCE: repoGuidance,
      ACTIVE_SUBSPEC_PATH: activeSubspecPathLine,
      ACTIVE_SUBSPEC_BODY: activeSubspecBody,
      PATCH_RULES: registry.getById("patch.rules").body.trim(),
      TIMEOUT_CHECKPOINT_CONTEXT: timeoutCheckpointContext,
      STEP_RULES: DEFAULT_WRITE_STEP_RULES,
    },
  );

  const optionalSections = [
    {
      content: repoGuidance,
      header: "## Repo Guidance",
      begin: "<<<REPO_GUIDANCE_BEGIN>>>",
      end: "<<<REPO_GUIDANCE_END>>>",
    },
    {
      content: activeSubspecPath,
      header: "## Active Subspec",
      begin: "<<<ACTIVE_SUBSPEC_BEGIN>>>",
      end: "<<<ACTIVE_SUBSPEC_END>>>",
    },
    {
      content: timeoutCheckpointContext,
      header: "## Timeout Checkpoint",
      begin: "<<<TIMEOUT_CHECKPOINT_BEGIN>>>",
      end: "<<<TIMEOUT_CHECKPOINT_END>>>",
    },
  ];
  for (const section of optionalSections) {
    if (section.content.length === 0) {
      rendered = stripOptionalPromptSection(rendered, section.header, section.begin, section.end);
    }
  }

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
// Provides the agent with: spec tree (read-only data), branch change summary vs base, pass context.
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
  const branchDiff = getBranchDiffSummary(opts.cwd, opts.baseBranch ?? "main");

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

/** Stat and changed-path listing for branch vs base; not a unified diff. */
export function getBranchDiffSummary(cwd: string, baseBranch: string): string {
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

function getRunScopedDiff(cwd: string, allowlist: string[], baseBranch: string): string {
  if (allowlist.length === 0) {
    return "(no allowed files)";
  }
  try {
    const mergeBase = execFileSync("git", ["merge-base", baseBranch, "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
    const diff = execFileSync("git", ["diff", mergeBase, "HEAD", "--", ...allowlist], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    return diff || "(no changes)";
  } catch (err) {
    return `(failed to generate diff: ${err instanceof Error ? err.message : String(err)})`;
  }
}

export type ShrinkPromptOpts = {
  specPath: string;
  cwd: string;
  allowlist: string[];
  baseBranch?: string;
};

/** Build shrink prompt: run-scoped diff, allowlist, read-only spec tree; no patch.rules. */
export function buildShrinkPrompt(opts: ShrinkPromptOpts): string {
  const registry = loadPromptRegistry();
  const template = assemblePromptForStep({
    registry,
    stepPromptId: "patch.prompt.shrink",
  });

  const specTree = buildSpecTree(dirname(opts.specPath), opts.cwd);
  const baseBranch = opts.baseBranch ?? "main";
  const allowlistBlock = opts.allowlist.map((path) => `- ${path}`).join("\n");
  const branchSummary = getBranchDiffSummary(opts.cwd, baseBranch);
  const runScopedDiff = getRunScopedDiff(opts.cwd, opts.allowlist, baseBranch);

  return renderTemplateWithDeclarations(
    template,
    [
      { name: "SPEC_PATH", type: "string", required: true },
      { name: "SPEC_TREE", type: "string", required: true },
      { name: "ALLOWLIST", type: "string", required: true },
      { name: "BRANCH_DIFF", type: "string", required: true },
      { name: "RUN_SCOPED_DIFF", type: "string", required: true },
      { name: "STEP_RULES", type: "string", required: true },
    ],
    {
      SPEC_PATH: opts.specPath,
      SPEC_TREE: specTree,
      ALLOWLIST: allowlistBlock || "(empty)",
      BRANCH_DIFF: branchSummary,
      RUN_SCOPED_DIFF: runScopedDiff,
      STEP_RULES: DEFAULT_WRITE_STEP_RULES,
    },
  ).trim();
}

export function buildVerdictActuatorPrompt(verdict: string, specPath: string): string {
  const basePrompt = buildPrompt(specPath, undefined, {
    repoGuidance: "",
    activeSubspecPath: "",
    activeSubspecBody: "",
  });
  return `${basePrompt}\n\n## Review Actuator Rules\n\n- Apply the review verdict to implementation files only.\n- The completed spec tree is read-only: do not edit spec files, tick criteria, append blockers, or edit verdict-patch.md.\n- Do not expand scope beyond the verdict.\n\n## Review Verdict\n\nBased on a review of your implementation, the following changes are required:\n\n${verdict}`;
}
