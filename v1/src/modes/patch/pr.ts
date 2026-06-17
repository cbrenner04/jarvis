import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Agent, AgentRunOptions } from "../../agents/types.ts";
import {
  checkPrExists,
  extractGeneratedNarrativeContent,
  extractNarrative,
  markGeneratedNarrative,
  NARRATIVE_END_MARKER,
  NARRATIVE_START_MARKER,
  renderAttributionSummary,
} from "../../pr.ts";
import { type RunReadyAndCommitOpts, runReadyAndCommit } from "../../ready-gate.ts";
import { buildPrDescriptionPrompt } from "./pr-description-prompt.ts";
import { parsePatchSpec } from "./spec.ts";

export { NARRATIVE_END_MARKER, NARRATIVE_START_MARKER };

export function buildPrBody(opts: {
  indexPath: string;
  narrative: string | null;
  generatedNarrative?: boolean;
}): string {
  const indexContent = readFileSync(opts.indexPath, "utf8");
  const parsedIndex = parsePatchSpec(indexContent);

  const lines: string[] = [];
  if (parsedIndex.h1) {
    lines.push(`# ${parsedIndex.h1}`);
  }

  let body = lines.join("\n");

  if (opts.narrative !== null) {
    const narrative = opts.generatedNarrative ? markGeneratedNarrative(opts.narrative) : opts.narrative;
    const narrativeBlock = `${NARRATIVE_START_MARKER}\n${narrative}\n${NARRATIVE_END_MARKER}`;
    body = body === "" ? narrativeBlock : `${body}\n\n${narrativeBlock}`;
  }

  return body;
}

export { extractNarrative };

const PR_DESCRIPTION_BEGIN = "<<<PR_DESCRIPTION_BEGIN>>>";
const PR_DESCRIPTION_END = "<<<PR_DESCRIPTION_END>>>";
const PR_DESCRIPTION_CONTEXT_MAX_CHARS = 40_000;

/**
 * Generate the PR description by calling the model with the PR description prompt.
 * Returns the model's response containing Description + Decisions section.
 *
 * Extracts the content between PR_DESCRIPTION_BEGIN and PR_DESCRIPTION_END sentinels.
 * Validates that the extracted content contains the expected shape. Returns null if
 * generation fails, sentinels are malformed/absent, or validation fails.
 */
export async function generatePrDescription(opts: {
  specPath: string;
  agent: Agent;
  cwd: string;
  runOptions?: Partial<Omit<AgentRunOptions, "cwd">>;
}): Promise<string | null> {
  try {
    const prompt = buildPrDescriptionPrompt({
      specPath: opts.specPath,
      specContext: buildSpecContext(opts.specPath),
    });

    const result = await opts.agent.run(prompt, {
      cwd: opts.cwd,
      ...opts.runOptions,
    });

    if (result.kind !== "ok") {
      return null;
    }

    const stdout = result.stdout.trim();
    
    // Extract content between sentinels
    const beginIndex = stdout.indexOf(PR_DESCRIPTION_BEGIN);
    if (beginIndex === -1) {
      return null;
    }

    const endIndex = stdout.indexOf(PR_DESCRIPTION_END, beginIndex + PR_DESCRIPTION_BEGIN.length);
    if (endIndex === -1) {
      return null;
    }

    const description = stdout
      .slice(beginIndex + PR_DESCRIPTION_BEGIN.length, endIndex)
      .trim();

    if (description.length === 0) {
      return null;
    }

    if (!description.includes("Decisions:")) {
      return null;
    }

    return description;
  } catch {
    return null;
  }
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
  agent?: Agent;
  runOptions?: Partial<Omit<AgentRunOptions, "cwd">>;
  /** Test seam: fetch the current PR body. Defaults to `gh pr view`. */
  fetchPrBody?: (branch: string, cwd: string) => string;
  /** Test seam: write the new PR body. Defaults to `gh pr edit --body-file -`. */
  writePrBody?: (branch: string, body: string, cwd: string) => void;
  /** Test seam: render the attribution footer. Defaults to `renderAttribution`. */
  renderFooter?: (opts: { cwd: string; base: string }) => string;
};

/**
 * Rewrite the PR body for `branch` from scratch: fetch the current body,
 * preserve the narrative section between markers (if present and non-empty),
 * rebuild the deterministic header from `indexPath`, render the attribution
 * footer from git trailers, and pipe the assembled body to `gh pr edit --body-file -`.
 *
 * When the narrative block is empty or missing and an agent is provided,
 * regenerate the narrative. Otherwise, preserve existing narrative verbatim.
 *
 * Throws on `gh` failure; callers wrap with try/catch and warn-and-continue.
 */
export async function updatePrBody(opts: UpdatePrBodyOpts): Promise<void> {
  const fetchPrBody = opts.fetchPrBody ?? defaultFetchPrBody;
  const writePrBody = opts.writePrBody ?? defaultWritePrBody;
  const renderFooter = opts.renderFooter ?? renderAttributionSummary;

  const currentBody = fetchPrBody(opts.branch, opts.cwd);
  let narrative = extractNarrative(currentBody);
  const generatedNarrative = narrative === null ? null : extractGeneratedNarrativeContent(narrative);

  if ((!narrative || generatedNarrative !== null) && opts.agent) {
    const generateOpts: Parameters<typeof generatePrDescription>[0] = {
      specPath: opts.indexPath,
      agent: opts.agent,
      cwd: opts.cwd,
    };
    if (opts.runOptions !== undefined) {
      generateOpts.runOptions = opts.runOptions;
    }
    const generated = await generatePrDescription(generateOpts);
    if (generated !== null) {
      narrative = markGeneratedNarrative(generated);
    }
  }

  const header = buildPrBody({ indexPath: opts.indexPath, narrative: null });
  let headerAndNarrative = header;
  if (narrative) {
    headerAndNarrative += `\n\n${NARRATIVE_START_MARKER}\n${narrative}\n${NARRATIVE_END_MARKER}`;
  }
  const footer = renderFooter({ cwd: opts.cwd, base: opts.base });
  const newBody = footer === "" ? headerAndNarrative : `${headerAndNarrative}\n\n---\n\n${footer}`;
  writePrBody(opts.branch, newBody, opts.cwd);
}

function defaultFetchPrBody(branch: string, cwd: string): string {
  return execFileSync("gh", ["pr", "view", branch, "--json", "body", "-q", ".body"], {
    cwd,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });
}

function defaultWritePrBody(branch: string, body: string, cwd: string): void {
  execFileSync("gh", ["pr", "edit", branch, "--body-file", "-"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: body,
  });
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
  runReady?: (cwd: string) => void;
  /** Seam for dirty-check, git add -A, git commit, idempotency re-check, and pushCurrent together. Called only when markReady is absent and tree is dirty after runReady. */
  commitCheckFix?: (cwd: string, agentLabel: string) => void;
  /** Seam for the `gh pr ready <branch>` shell-out. Used by tests to verify it is/isn't called. Defaults to execFileSync call. */
  ghPrReady?: (branch: string, cwd: string) => void;
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

  // Run ready and commit logic
  runReadyAndCommit({
    cwd: opts.cwd,
    ...(opts.agentLabel !== undefined ? { agentLabel: opts.agentLabel } : {}),
    ...(opts.runReady !== undefined ? { runReady: opts.runReady } : {}),
    ...(opts.commitCheckFix !== undefined ? { commitCheckFix: opts.commitCheckFix } : {}),
  });

  // Then mark ready
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
