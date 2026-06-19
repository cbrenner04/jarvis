import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Agent, AgentRunOptions } from "../../agents/types.ts";
import {
  checkPrExists,
  extractNarrative,
  NARRATIVE_END_MARKER,
  NARRATIVE_START_MARKER,
  readBranchCommits,
  renderAttributionSummary,
} from "../../pr.ts";
import {
  extractPrDescription,
  generateNarrativeViaAgent,
  PR_DESCRIPTION_BEGIN,
  PR_DESCRIPTION_CONTEXT_MAX_CHARS,
  PR_DESCRIPTION_END,
} from "../../pr-shared.ts";
import { updatePrBody as updatePrBodyShared } from "../../pr-module.ts";
import {
  type ReadyTier,
  type RunReadyAndCommitOpts,
  runReadyAndCommit,
  runReadyGateWithTier,
} from "../../ready-gate.ts";
import { buildPrDescriptionPrompt } from "./pr-description-prompt.ts";
import { parsePatchSpec } from "./spec.ts";

export { NARRATIVE_END_MARKER, NARRATIVE_START_MARKER };

export function buildPrBody(opts: {
  indexPath: string;
  narrative: string | null;
}): string {
  const indexContent = readFileSync(opts.indexPath, "utf8");
  const parsedIndex = parsePatchSpec(indexContent);

  const lines: string[] = [];
  if (parsedIndex.h1) {
    lines.push(`# ${parsedIndex.h1}`);
  }

  let body = lines.join("\n");

  if (opts.narrative !== null) {
    const narrativeBlock = `${NARRATIVE_START_MARKER}\n${opts.narrative}\n${NARRATIVE_END_MARKER}`;
    body = body === "" ? narrativeBlock : `${body}\n\n${narrativeBlock}`;
  }

  return body;
}

export { extractNarrative };

/**
 * Generate the PR description by calling the model with the PR description prompt.
 * Returns the model's response containing Description + Decisions section, marked as generated.
 * Returns null if generation fails or validation fails.
 */
export async function generatePrDescription(opts: {
  specPath: string;
  agent: Agent;
  cwd: string;
  runOptions?: Partial<Omit<AgentRunOptions, "cwd">>;
}): Promise<string | null> {
  const genOpts: Parameters<typeof generateNarrativeViaAgent>[0] = {
    buildPrompt: () =>
      buildPrDescriptionPrompt({
        specPath: opts.specPath,
        specContext: buildSpecContext(opts.specPath),
      }),
    agent: opts.agent,
    cwd: opts.cwd,
  };
  if (opts.runOptions !== undefined) {
    genOpts.runOptions = opts.runOptions;
  }
  return generateNarrativeViaAgent(genOpts);
}

function buildSpecContext(indexPath: string): string {
  const indexContent = readFileSync(indexPath, "utf8");
  const sections = [`## index.md\n\n${indexContent.trim()}`];
  const parsed = parsePatchSpec(indexContent);
  for (const subspec of parsed.linkedSubspecs) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(subspec.path)) {
      continue;
    }
    const subspecPath = resolve(dirname(indexPath), subspec.path);
    if (!existsSync(subspecPath)) {
      continue;
    }
    sections.push(`## ${subspec.path}\n\n${readFileSync(subspecPath, "utf8").trim()}`);
  }
  return truncateContext(sections.join("\n\n"));
}

function truncateContext(context: string): string {
  if (context.length <= PR_DESCRIPTION_CONTEXT_MAX_CHARS) {
    return context;
  }
  return `${context.slice(0, PR_DESCRIPTION_CONTEXT_MAX_CHARS)}\n\n[truncated]`;
}

export type UpdatePrBodyOpts = {
  indexPath: string;
  branch: string;
  base: string;
  cwd: string;
  prNarrative?: "template" | "agent";
  agent?: Agent;
  runOptions?: Partial<Omit<AgentRunOptions, "cwd">>;
  /** Test seam: fetch the current PR body. Defaults to `gh pr view`. */
  fetchPrBody?: (branch: string, cwd: string) => string;
  /** Test seam: write the new PR body. Defaults to `gh pr edit --body-file -`. */
  writePrBody?: (branch: string, body: string, cwd: string) => void;
  /** Test seam: render the attribution footer. Defaults to `renderAttributionSummary`. */
  renderFooter?: (opts: { cwd: string; base: string }) => string;
};

/**
 * Rewrite the PR body for `branch` from scratch: fetch the current body,
 * preserve/regenerate the narrative section between markers (if present),
 * rebuild the deterministic header from `indexPath`, render the attribution
 * footer from git trailers, and pipe the assembled body to `gh pr edit --body-file -`.
 *
 * Behavior depends on `prNarrative`:
 * - `template`: regenerate narrative from index subspecs + commits
 * - `agent`: if narrative is empty/missing/marked-generated, regenerate via agent
 *
 * Throws on `gh` failure; callers wrap with try/catch and warn-and-continue.
 */
export async function updatePrBody(opts: UpdatePrBodyOpts): Promise<void> {
  const sharedOpts: Parameters<typeof updatePrBodyShared>[0] = {
    branch: opts.branch,
    base: opts.base,
    cwd: opts.cwd,
    buildHeader: () => buildPrBody({ indexPath: opts.indexPath, narrative: null }),
    getSubspecTitles: () => {
      const indexContent = readFileSync(opts.indexPath, "utf8");
      const parsed = parsePatchSpec(indexContent);
      return parsed.linkedSubspecs.map((s) => extractSubspecTitle(s.path));
    },
    buildPrompt: () =>
      buildPrDescriptionPrompt({
        specPath: opts.indexPath,
        specContext: buildSpecContext(opts.indexPath),
      }),
  };
  if (opts.prNarrative !== undefined) {
    sharedOpts.prNarrative = opts.prNarrative;
  }
  if (opts.agent !== undefined) {
    sharedOpts.agent = opts.agent;
  }
  if (opts.runOptions !== undefined) {
    sharedOpts.runOptions = opts.runOptions;
  }
  if (opts.fetchPrBody !== undefined) {
    sharedOpts.fetchPrBody = opts.fetchPrBody;
  }
  if (opts.writePrBody !== undefined) {
    sharedOpts.writePrBody = opts.writePrBody;
  }
  if (opts.renderFooter !== undefined) {
    sharedOpts.renderFooter = opts.renderFooter;
  }
  return updatePrBodyShared(sharedOpts);
}

export function extractSubspecTitle(subspecPath: string): string {
  // Extract just the filename without extension as a fallback title
  const parts = subspecPath.split("/");
  const filename = parts[parts.length - 1] ?? subspecPath;
  return filename.replace(/\.md$/, "");
}


export type { RunReadyAndCommitOpts };
export { runReadyAndCommit };

export type MaybeMarkReadyOpts = {
  indexPath: string;
  cwd: string;
  /** Test seam: agent label for the commit trailer. Threaded to the `commitCheckFix` seam. */
  agentLabel?: string;
  /** Test seam: check if PR exists. Defaults to `checkPrExists`. */
  checkPrExists?: (branch: string, cwd: string) => boolean;
  /** Short-circuit seam: stubs the entire ready + commit + gh-pr-ready sequence. When present, skips all other seams. */
  markReady?: (branch: string, cwd: string) => void;
  /** Seam for just `bun run ready`. Used by tests when markReady is absent. Defaults to execFileSync call. */
  runReady?: (cwd: string, tier: ReadyTier) => void;
  /** Seam for dirty-check, git add -A, git commit, idempotency re-check, and pushCurrent together. Called only when markReady is absent and tree is dirty after runReady. */
  commitCheckFix?: (cwd: string, agentLabel: string) => void;
  /** Seam for the `gh pr ready <branch>` shell-out. Used by tests to verify it is/isn't called. Defaults to execFileSync call. */
  ghPrReady?: (branch: string, cwd: string) => void;
  /** Recorded green result from completion transition: reuse when tree unchanged, refresh on re-run. */
  recordedGreenResult?: {
    /** HEAD sha from completion transition ready gate (post-`runReadyAndCommit`). */
    headSha: string;
  };
  /** Refresh callback: called when ready re-runs and succeeds, to update the recorded result. */
  refreshRecordedGreenResult?: (headSha: string) => void;
};

export function maybeMarkReady(opts: MaybeMarkReadyOpts): void {
  if (!linkedSubspecsAreComplete(readFileSync(opts.indexPath, "utf8"))) {
    return;
  }

  const branch = getCurrentBranch(opts.cwd);
  const checkPr = opts.checkPrExists ?? checkPrExists;
  const prExists = checkPr(branch, opts.cwd);
  if (!prExists) {
    throw new Error(
      `cannot mark PR ready: no PR found for branch ${branch}. This should not happen after opening a draft PR.`,
    );
  }

  // Short-circuit: if markReady is provided, use it and skip all other seams
  if (opts.markReady) {
    opts.markReady(branch, opts.cwd);
    return;
  }

  const realGhPrReady = (branch: string, cwd: string) => {
    execFileSync("gh", ["pr", "ready", branch], {
      cwd,
      env: process.env,
      stdio: "pipe",
    });
  };

  // Run ready at the tier selected from the recorded green carrier, then flip draft→ready.
  runReadyGateWithTier({
    cwd: opts.cwd,
    agentLabel: opts.agentLabel ?? "",
    ...(opts.recordedGreenResult !== undefined ? { recordedGreenResult: opts.recordedGreenResult } : {}),
    ...(opts.runReady !== undefined ? { runReady: opts.runReady } : {}),
    ...(opts.commitCheckFix !== undefined ? { commitCheckFix: opts.commitCheckFix } : {}),
    ...(opts.refreshRecordedGreenResult !== undefined
      ? { refreshRecordedGreenResult: opts.refreshRecordedGreenResult }
      : {}),
  });

  const ghPrReadyFn = opts.ghPrReady ?? realGhPrReady;
  ghPrReadyFn(branch, opts.cwd);
}

function linkedSubspecsAreComplete(indexContent: string): boolean {
  const linked = parsePatchSpec(indexContent).linkedSubspecs;
  if (linked.length === 0) {
    return false;
  }
  return linked.every((item) => item.checked);
}

function getCurrentBranch(cwd: string): string {
  const output = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });
  return output.trim();
}
