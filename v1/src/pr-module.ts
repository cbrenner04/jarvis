import type { Agent, AgentRunOptions } from "./agents/types.ts";
import type { CommitInfo } from "./pr.ts";
import { extractNarrative, NARRATIVE_END_MARKER, NARRATIVE_START_MARKER, renderAttributionSummary } from "./pr.ts";
import {
  type DiffStat,
  generateNarrativeViaAgent,
  generateTemplateNarrative,
  shouldRegenerateNarrative,
} from "./pr-shared.ts";

export type UpdatePrBodyOpts = {
  /** Shared PR body update options. */
  branch: string;
  base: string;
  cwd: string;
  prNarrative?: "template" | "agent" | undefined;
  agent?: Agent | undefined;
  runOptions?: Partial<Omit<AgentRunOptions, "cwd">> | undefined;
  /** Test seam: fetch the current PR body. Defaults to `gh pr view`. */
  fetchPrBody?: ((branch: string, cwd: string) => string) | undefined;
  /** Test seam: write the new PR body. Defaults to `gh pr edit --body-file -`. */
  writePrBody?: ((branch: string, body: string, cwd: string) => void) | undefined;
  /** Test seam: render the attribution footer. Defaults to `renderAttributionSummary`. */
  renderFooter?: ((opts: { cwd: string; base: string }) => string) | undefined;

  /** Mode-specific: build the header (H1 + mode-specific content). */
  buildHeader: () => string;
  /** Mode-specific: get subspec titles from index. */
  getSubspecTitles: () => string[];
  /** Mode-specific: build prompt for agent (if prNarrative is "agent"). */
  buildPrompt?: (() => string) | undefined;
  /** Optional: get diff stats for change summary (patch-mode only). */
  getDiffStats?: (() => DiffStat[]) | undefined;
  /** Optional: get subspec bodies for why lines (patch-mode only). */
  getSubspecBodies?: (() => string[]) | undefined;
  /** Test seam: get commit subjects. Defaults to git branch commits. */
  getCommitSubjects?: (() => string[]) | undefined;
};

const defaultFetchPrBody = (branch: string, cwd: string): string => {
  const { execFileSync } = require("node:child_process");
  return execFileSync("gh", ["pr", "view", branch, "--json", "body", "-q", ".body"], {
    cwd,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });
};

const defaultWritePrBody = (branch: string, body: string, cwd: string): void => {
  const { execFileSync } = require("node:child_process");
  execFileSync("gh", ["pr", "edit", branch, "--body-file", "-"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: body,
  });
};

/**
 * Shared PR body update logic for both patch and plan modes.
 *
 * Rewrites the PR body: fetch current body, preserve/regenerate narrative section
 * between markers (if present), rebuild the header via buildHeader, render the
 * attribution footer from git trailers, and pipe the assembled body to
 * `gh pr edit --body-file -`.
 *
 * Behavior depends on `prNarrative`:
 * - `template`: regenerate narrative deterministically from subspecs + commits
 * - `agent`: if narrative is empty/missing/marked-generated, regenerate via agent
 *
 * Throws on `gh` failure; callers wrap with try/catch and warn-and-continue.
 */
export async function updatePrBody(opts: UpdatePrBodyOpts): Promise<void> {
  const { readBranchCommits } = require("./pr.ts");
  const fetchPrBody = opts.fetchPrBody ?? defaultFetchPrBody;
  const writePrBody = opts.writePrBody ?? defaultWritePrBody;
  const renderFooter = opts.renderFooter ?? renderAttributionSummary;
  const prNarrative = opts.prNarrative ?? "template";

  const currentBody = fetchPrBody(opts.branch, opts.cwd);
  let narrative = extractNarrative(currentBody);

  if (prNarrative === "template") {
    // Regenerate template narrative if it's empty, missing, or marked as generated
    // Preserve human-edited narratives (those with broken hash)
    if (shouldRegenerateNarrative(narrative)) {
      const narrativeOpts: Parameters<typeof generateTemplateNarrative>[0] = {
        getSubspecTitles: opts.getSubspecTitles,
        getCommitSubjects: opts.getCommitSubjects ?? (() => {
          const commits = readBranchCommits({ cwd: opts.cwd, base: opts.base });
          return commits.map((commit: CommitInfo) => commit.subject);
        }),
      };
      if (opts.getDiffStats !== undefined) {
        narrativeOpts.getDiffStats = opts.getDiffStats;
      }
      if (opts.getSubspecBodies !== undefined) {
        narrativeOpts.getSubspecBodies = opts.getSubspecBodies;
      }
      narrative = generateTemplateNarrative(narrativeOpts);
    }
  } else {
    // Agent mode: regenerate if empty/missing or marked as generated
    if (shouldRegenerateNarrative(narrative) && opts.agent && opts.buildPrompt !== undefined) {
      const generated = await generateNarrativeViaAgent({
        buildPrompt: opts.buildPrompt,
        agent: opts.agent,
        cwd: opts.cwd,
        ...(opts.runOptions !== undefined ? { runOptions: opts.runOptions } : {}),
      });
      if (generated !== null) {
        narrative = generated;
      }
    }
  }

  const header = opts.buildHeader();
  let headerAndNarrative = header;
  if (narrative) {
    headerAndNarrative += `\n\n${NARRATIVE_START_MARKER}\n${narrative}\n${NARRATIVE_END_MARKER}`;
  }
  const footer = renderFooter({ cwd: opts.cwd, base: opts.base });
  const newBody = footer === "" ? headerAndNarrative : `${headerAndNarrative}\n\n---\n\n${footer}`;
  writePrBody(opts.branch, newBody, opts.cwd);
}
