import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadPromptRegistry } from "../../../shared/prompts/registry.ts";
import { renderArtifactTemplate } from "../../../shared/prompts/render.ts";
import type { PublicationLanding } from "./publication-landing.ts";
import { type LintStagedMarkdownDeps, lintStagedMarkdown } from "./staged-markdown-lint.ts";

export type ReviewedStagedMarkdownLintAdmission =
  | { kind: "skip" }
  | { kind: "pass" }
  | { kind: "violation"; ruleId: string; filePath: string; message: string }
  | { kind: "invocation_error"; message: string };

export type ReviewedStagedMarkdownLintReprompt = {
  ruleId: string;
  offendingFile: string;
  message: string;
};

export const REVIEW_STAGED_MARKDOWN_LINT_MAX_REPROMPTS = 10;

export function reviewedStagingDir(landing: Exclude<PublicationLanding, { kind: "none" }>): string | undefined {
  if (landing.kind === "plan-tree" || landing.kind === "intent-stage") {
    return landing.stagingDir;
  }
  return undefined;
}

function stagingRootHasMarkdown(stagingRoot: string): boolean {
  if (!existsSync(stagingRoot)) return false;
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".md") && !/^verdict-.*\.md$/i.test(entry.name)) {
        files.push(path);
      }
    }
  }
  walk(stagingRoot);
  return files.length > 0;
}

export async function lintReviewedStagedMarkdownOrFail(
  worktreePath: string,
  landing: Exclude<PublicationLanding, { kind: "none" }>,
  deps?: LintStagedMarkdownDeps,
): Promise<ReviewedStagedMarkdownLintAdmission> {
  const stagingDir = reviewedStagingDir(landing);
  if (stagingDir === undefined) {
    return { kind: "skip" };
  }

  const resolvedWorktree = deps?.worktreePath ?? worktreePath;
  const stagingRoot = join(resolvedWorktree, stagingDir);
  if (!stagingRootHasMarkdown(stagingRoot)) {
    return { kind: "skip" };
  }

  const result = await lintStagedMarkdown(stagingDir, { ...deps, worktreePath: resolvedWorktree });
  if (result.kind === "clean") return { kind: "pass" };
  if (result.kind === "violation") {
    return {
      kind: "violation",
      ruleId: result.ruleId,
      filePath: result.filePath,
      message: result.message,
    };
  }
  return { kind: "invocation_error", message: result.message };
}

export function renderReviewedStagedMarkdownLintReprompt(
  reprompt: ReviewedStagedMarkdownLintReprompt,
  stagingDir: string,
): string {
  return renderArtifactTemplate(loadPromptRegistry().getById("write.staged-markdown-lint-reprompt"), {
    RULE_ID: reprompt.ruleId,
    OFFENDING_FILE: reprompt.offendingFile,
    STAGING_DIR: stagingDir,
    VIOLATION: reprompt.message,
  });
}
