import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Agent, AgentRunOptions } from "../../agents/types.ts";
import { type SyncTransientRetryOptions, withSyncTransientRetry } from "../../gh.ts";
import { type BaseCurrentCheckResult, checkBaseCurrent, writeReadyFlipBlocked } from "../../git/base-current.ts";
import type { CommitInfo } from "../../pr.ts";
import { extractNarrative, NARRATIVE_END_MARKER, NARRATIVE_START_MARKER, readBranchCommits } from "../../pr.ts";
import { updatePrBody as updatePrBodyShared } from "../../pr-module.ts";
import { generateNarrativeViaAgent } from "../../pr-shared.ts";
import { type ReadyTier, runReadyAndCommit } from "../../ready-gate.ts";
import { buildPrDescriptionPrompt } from "./pr-description-prompt.ts";

/**
 * A single subspec entry parsed from `index.md`.
 */
export type IndexSubspec = {
  /** Raw checklist line as it appears in `index.md` (e.g. `- [ ] [01 — Foo](./01-foo.md)`). */
  line: string;
  /** True iff the checkbox is checked (`[x]` or `[X]`). */
  checked: boolean;
  /** Linked subspec path from the checklist item. */
  path: string;
};

/**
 * Parse the H1 title and subspec checklist out of an `index.md`.
 *
 * The shape mirrors what `jarvis plan` and `jarvis run` author: a single H1,
 * followed (eventually) by a checklist whose items each contain a Markdown
 * link to a subspec file. We only read the title and the checklist itself —
 * everything else in the file is ignored. Missing or malformed input
 * degrades gracefully: a missing file yields an empty title and zero
 * subspecs; non-checklist content is preserved verbatim only inasmuch as the
 * matched checklist lines are returned untouched.
 */
export function parseIndex(indexPath: string): {
  title: string;
  subspecs: IndexSubspec[];
} {
  if (!existsSync(indexPath)) {
    return { title: "", subspecs: [] };
  }
  const content = readFileSync(indexPath, "utf8");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let title = "";
  const subspecs: IndexSubspec[] = [];
  for (const rawLine of lines) {
    if (title === "") {
      const h1 = rawLine.match(/^#\s+(.+?)\s*$/);
      if (h1?.[1] !== undefined) {
        title = h1[1].trim();
        continue;
      }
    }
    // Match GitHub-style task list items whose text contains a Markdown link.
    const checklist = rawLine.match(/^\s*-\s+\[( |x|X)\]\s+\[.+?\]\((.+?)\)/);
    if (checklist) {
      const checked = checklist[1] !== " ";
      subspecs.push({ line: rawLine, checked, path: checklist[2] ?? "" });
    }
  }
  return { title, subspecs };
}

/**
 * Build the deterministic header for a plan-mode PR body.
 *
 * The header is the spec H1 title followed by a short bullet list referencing
 * the intent and index files. When `index.md` does not yet exist (e.g., before
 * the first `plan: draft` commit), the header falls back to a minimal title
 * that does not block PR creation.
 */
export function buildPlanPrHeader(opts: {
  name: string;
  specDirBasename?: string;
  /** Worktree root; used to locate `<targetDir>/<name>/index.md`. Required to render the live header. */
  worktreePath?: string;
  /** Committed spec root (defaults to "spec" for backwards compatibility). */
  targetDir?: string;
}): string {
  const specDirBasename = opts.specDirBasename ?? opts.name;
  const targetDir = opts.targetDir ?? "spec";
  const indexPath =
    opts.worktreePath !== undefined ? join(opts.worktreePath, targetDir, specDirBasename, "index.md") : null;
  const parsed = indexPath !== null ? parseIndex(indexPath) : { title: "", subspecs: [] };

  const titleLine = parsed.title !== "" ? `# ${parsed.title}` : `# Plan: ${opts.name}`;

  const lines: string[] = [
    titleLine,
    "",
    `- Intent: \`${targetDir}/${specDirBasename}/intent.md\``,
    `- Index: \`${targetDir}/${specDirBasename}/index.md\``,
  ];
  return lines.join("\n");
}

/**
 * Check if a commit is a plan-mode meta-commit.
 * Meta-commits have subjects starting with "plan: " and first body line
 * pointing to the intent.md file (not a subspec file).
 * Recognizes both default `spec/` and configured roots like `v1/spec/`.
 */
function isPlanMetaCommit(commit: CommitInfo): boolean {
  return (
    commit.subject.startsWith("plan: ") &&
    commit.firstBodyLine.startsWith("Spec: ") &&
    commit.firstBodyLine.includes("/intent.md")
  );
}

/**
 * Check if a commit is a subspec commit.
 * Subspec commits have first body line starting with "Spec: " and pointing
 * to an actual subspec file (not intent.md).
 * Recognizes both default `spec/` and configured roots like `v1/spec/`.
 */
function isSubspecCommit(commit: CommitInfo): boolean {
  return commit.firstBodyLine.startsWith("Spec: ") && !commit.firstBodyLine.includes("/intent.md");
}

/**
 * Group consecutive plan-mode meta-commits together.
 */
function groupMetaCommits(commits: CommitInfo[]): (CommitInfo | CommitInfo[])[] {
  const groups: (CommitInfo | CommitInfo[])[] = [];
  let metaGroup: CommitInfo[] = [];

  for (const commit of commits) {
    if (isPlanMetaCommit(commit)) {
      metaGroup.push(commit);
    } else {
      if (metaGroup.length > 0) {
        const group = metaGroup.length === 1 && metaGroup[0] ? metaGroup[0] : metaGroup;
        groups.push(group);
        metaGroup = [];
      }
      groups.push(commit);
    }
  }

  if (metaGroup.length > 0) {
    const group = metaGroup.length === 1 && metaGroup[0] ? metaGroup[0] : metaGroup;
    groups.push(group);
  }

  return groups;
}

/**
 * Render the PR-body attribution footer for plan-mode PRs.
 * Collapses consecutive plan-mode meta-commits into a single summary line.
 * Subspec commits are rendered as individual bullets.
 *
 * Returns `""` when the branch has no commits at all. When the branch has
 * commits, the footer includes collapsed meta-commits and subspec bullets.
 */
export function renderPlanAttribution(opts: { cwd: string; base: string }): string {
  const commits = readBranchCommits({ cwd: opts.cwd, base: opts.base });
  if (commits.length === 0) {
    return "";
  }

  const grouped = groupMetaCommits(commits);
  const bullets: string[] = [];
  const labelOrder: string[] = [];
  const seenLabels = new Set<string>();

  for (const group of grouped) {
    if (Array.isArray(group)) {
      // Multiple collapsed meta-commits
      const metaCommits = group as CommitInfo[];
      const agentSet = new Set<string>();
      for (const commit of metaCommits) {
        for (const agent of commit.jarvisAgentTrailers) {
          agentSet.add(agent);
        }
      }
      const agents = Array.from(agentSet);
      const agentLabel = agents.length === 0 ? "Jarvis" : agents.join(", ");
      bullets.push(`- ${metaCommits.length} spec commits (refine, draft, review) — ${agentLabel}`);
      for (const agent of agents) {
        if (agent !== "" && !seenLabels.has(agent)) {
          seenLabels.add(agent);
          labelOrder.push(agent);
        }
      }
    } else {
      // Single commit (meta or subspec)
      const commit = group as CommitInfo;
      if (isPlanMetaCommit(commit)) {
        // Single meta-commit
        const agentSet = new Set<string>();
        for (const agent of commit.jarvisAgentTrailers) {
          agentSet.add(agent);
        }
        const agents = Array.from(agentSet);
        const agentLabel = agents.length === 0 ? "Jarvis" : agents.join(", ");
        bullets.push(`- 1 spec commits (refine, draft, review) — ${agentLabel}`);
        for (const agent of agents) {
          if (agent !== "" && !seenLabels.has(agent)) {
            seenLabels.add(agent);
            labelOrder.push(agent);
          }
        }
      } else if (isSubspecCommit(commit)) {
        // Individual subspec commit
        const label = commit.jarvisAgentTrailers.length === 0 ? "unknown" : commit.jarvisAgentTrailers.join(", ");
        bullets.push(`- ${commit.shortSha} ${commit.subject} — ${label}`);
        for (const single of commit.jarvisAgentTrailers) {
          if (single === "" || seenLabels.has(single)) {
            continue;
          }
          seenLabels.add(single);
          labelOrder.push(single);
        }
      }
    }
  }

  if (bullets.length === 0) {
    return "";
  }

  const lines = [...bullets];
  if (labelOrder.length > 0) {
    lines.push("");
    lines.push(`Written by ${labelOrder.join(", ")} through Jarvis.`);
  }
  return lines.join("\n");
}

export type PrState = "none" | "draft" | "ready";

export type OpenPrInfo = {
  state: PrState;
  number?: number;
};

/**
 * Look up the current state of an open PR for the given branch.
 * Returns an `OpenPrInfo` with state `none`, `draft`, or `ready`.
 * For `draft` and `ready` states, includes the PR number for later reference.
 */
export function getOpenPrState(branch: string, cwd: string): OpenPrInfo {
  try {
    const output = execFileSync(
      "gh",
      [
        "pr",
        "view",
        branch,
        "--json",
        "number,state,isDraft",
        "-q",
        'select(.state=="OPEN") | {number: .number, isDraft: .isDraft}',
      ],
      { cwd, env: process.env, stdio: "pipe", encoding: "utf8" },
    );
    const trimmed = output.trim();
    if (trimmed === "") {
      return { state: "none" };
    }
    const parsed = JSON.parse(trimmed) as { number: number; isDraft: boolean };
    return {
      state: parsed.isDraft ? "draft" : "ready",
      number: parsed.number,
    };
  } catch {
    return { state: "none" };
  }
}

export type MaybeMarkPlanPrReadyOpts = {
  branch: string;
  cwd: string;
  timeoutMs: number;
  /** Test seam: agent label for the pre-ready fix commit trailer. */
  agentLabel?: string;
  /** Test seam: get the open PR state. Defaults to `getOpenPrState`. */
  getOpenPrState?: (branch: string, cwd: string) => OpenPrInfo;
  /** Test seam: resolve/fetch/compare the PR base. Defaults to `checkBaseCurrent`. */
  checkBaseCurrent?: (opts: { branch: string; cwd: string }) => BaseCurrentCheckResult;
  /** Skip the base-current guard before `gh pr ready`. */
  skipBaseCurrentCheck?: boolean;
  /** Short-circuit seam: stubs the entire ready + commit + gh-pr-ready sequence. */
  markReady?: (branch: string, cwd: string) => void;
  /** Skip the local ready gate before `gh pr ready`. */
  skipReadyGate?: boolean;
  /** Seam for built-in `bun run fix` on `full` tier. Used by tests when markReady is absent. */
  runFix?: (cwd: string) => void;
  /** Per-project override for `bun run fix`. Tokenized on whitespace; no shell. */
  fixCommand?: string;
  /** Seam for verification only (`bun run ready`). Used by tests when markReady is absent. */
  runReady?: (cwd: string, tier: ReadyTier) => void;
  /** Seam for pre-ready fix commit/push on `full` tier when porcelain is non-empty after fix. */
  commitPreReadyFix?: (cwd: string, agentLabel: string) => void;
  /** Seam for the `gh pr ready <branch>` shell-out. Used by tests when markReady is absent. Defaults to execFileSync call wrapped with retry. */
  ghPrReady?: (branch: string, cwd: string) => void;
  /** Seam for retry behavior: exec, sleep, onRetry callbacks. Injected into the retry wrapper below ghPrReady. */
  ghPrReadyRetryOpts?: Partial<SyncTransientRetryOptions>;
  /** Test seam: operator-visible stderr sink for blocked flips. Defaults to `process.stderr.write`. */
  stderr?: (s: string) => void;
};

/**
 * Mark the plan-mode PR ready for review by invoking `gh pr ready <branch>`.
 *
 * Behavior depends on the current PR state:
 * - `none` (no open PR): silent no-op
 * - `draft` (open draft PR): run `bun run ready` gate unless skipped, then `gh pr ready` transition
 * - `ready` (open ready PR): skip both gate and transition, silent no-op
 *
 * Throws on `gh` failure or gate failure; callers wrap with try/catch and warn-and-continue.
 */
export function maybeMarkPlanPrReady(opts: MaybeMarkPlanPrReadyOpts): void {
  const getPrState = opts.getOpenPrState ?? getOpenPrState;
  const prInfo = getPrState(opts.branch, opts.cwd);

  // No open PR: silent no-op
  if (prInfo.state === "none") {
    return;
  }

  // Ready PR: silent no-op (skip gate and transition)
  if (prInfo.state === "ready") {
    return;
  }

  if (opts.skipBaseCurrentCheck !== true) {
    const baseCurrent = (opts.checkBaseCurrent ?? checkBaseCurrent)({ branch: opts.branch, cwd: opts.cwd });
    if (baseCurrent.status === "behind") {
      writeReadyFlipBlocked(
        opts.stderr ?? process.stderr.write.bind(process.stderr),
        opts.branch,
        baseCurrent.baseRefName,
      );
      return;
    }
  }

  // Draft PR: run gate and transition
  if (opts.markReady) {
    opts.markReady(opts.branch, opts.cwd);
    return;
  }

  const retryGhPrReady = (branch: string, cwd: string) => {
    withSyncTransientRetry(
      () => {
        execFileSync("gh", ["pr", "ready", branch], {
          cwd,
          env: process.env,
          stdio: "pipe",
        });
      },
      {
        op: "gh pr ready",
        isPrReady: true,
        ...opts.ghPrReadyRetryOpts,
      },
    );
  };

  if (opts.skipReadyGate !== true) {
    runReadyAndCommit({
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      ...(opts.agentLabel !== undefined ? { agentLabel: opts.agentLabel } : {}),
      ...(opts.fixCommand !== undefined ? { fixCommand: opts.fixCommand } : {}),
      ...(opts.runFix !== undefined ? { runFix: opts.runFix } : {}),
      ...(opts.runReady !== undefined ? { runReady: opts.runReady } : {}),
      ...(opts.commitPreReadyFix !== undefined ? { commitPreReadyFix: opts.commitPreReadyFix } : {}),
    });
  }

  const ghPrReadyFn = opts.ghPrReady ?? retryGhPrReady;
  ghPrReadyFn(opts.branch, opts.cwd);
}

export { extractNarrative, NARRATIVE_END_MARKER, NARRATIVE_START_MARKER };

const PR_DESCRIPTION_CONTEXT_MAX_CHARS = 40_000;

/**
 * Generate the PR description by calling the model with the PR description prompt.
 * Returns the model's response containing Description + Decisions section, marked as generated.
 * Returns null if generation fails or validation fails.
 */
export async function generatePrDescription(opts: {
  indexPath: string;
  intent: string;
  agent: Agent;
  cwd: string;
  runOptions?: Partial<Omit<AgentRunOptions, "cwd">>;
}): Promise<string | null> {
  const genOpts: Parameters<typeof generateNarrativeViaAgent>[0] = {
    buildPrompt: () =>
      buildPrDescriptionPrompt({
        intent: opts.intent,
        specContext: buildSpecContext(opts.indexPath),
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
  const specDir = dirnameFromPath(indexPath);
  const sections = [`## index.md\n\n${indexContent.trim()}`];
  const parsed = parseIndex(indexPath);
  const linkedPaths = parsed.subspecs.map((subspec) => subspec.path).filter((path) => path.length > 0);
  const paths =
    linkedPaths.length > 0 ? linkedPaths : readdirSync(specDir).filter((path) => /^\d{2}-.*\.md$/.test(path));
  for (const path of paths) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
      continue;
    }
    const filePath = join(specDir, path);
    if (!existsSync(filePath)) {
      continue;
    }
    sections.push(`## ${path}\n\n${readFileSync(filePath, "utf8").trim()}`);
  }
  return truncateContext(sections.join("\n\n"));
}

function dirnameFromPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "." : path.slice(0, idx);
}

function truncateContext(context: string): string {
  if (context.length <= PR_DESCRIPTION_CONTEXT_MAX_CHARS) {
    return context;
  }
  return `${context.slice(0, PR_DESCRIPTION_CONTEXT_MAX_CHARS)}\n\n[truncated]`;
}

export type UpdatePlanPrBodyOpts = {
  indexPath: string;
  specDirPath: string;
  branch: string;
  base: string;
  cwd: string;
  prNarrative?: "template" | "agent";
  /** Committed spec root (e.g. `v1/spec`). Defaults to `spec`. Threaded into the header so the title and file pointers resolve correctly. */
  targetDir?: string;
  intentContent?: string;
  agent?: Agent;
  runOptions?: Partial<Omit<AgentRunOptions, "cwd">>;
  /** Test seam: fetch the current PR body. Defaults to `gh pr view`. */
  fetchPrBody?: (branch: string, cwd: string) => string;
  /** Test seam: write the new PR body. Defaults to `gh pr edit --body-file -`. */
  writePrBody?: (branch: string, body: string, cwd: string) => void;
  /** Test seam: render the attribution footer. Defaults to `renderPlanAttribution`. */
  renderFooter?: (opts: { cwd: string; base: string }) => string;
};

/**
 * Rewrite the plan-mode PR body: fetch the current body, preserve/regenerate the
 * narrative section between markers (if present), rebuild the header from index.md,
 * render the attribution footer from git trailers, and pipe the assembled body to
 * `gh pr edit --body-file -`.
 *
 * Behavior depends on `prNarrative`:
 * - `template`: regenerate narrative from index subspecs + commits (ignores intentContent)
 * - `agent`: if narrative is empty/missing/marked-generated and intentContent present, regenerate via agent
 *
 * Throws on `gh` failure; callers wrap with try/catch and warn-and-continue.
 */
export async function updatePlanPrBody(opts: UpdatePlanPrBodyOpts): Promise<void> {
  const specDirBasename = basename(opts.specDirPath);
  const headerOpts: {
    name: string;
    worktreePath?: string;
    targetDir?: string;
  } = {
    name: specDirBasename,
  };
  if (opts.cwd !== undefined) {
    headerOpts.worktreePath = opts.cwd;
  }
  if (opts.targetDir !== undefined) {
    headerOpts.targetDir = opts.targetDir;
  }

  const prNarrative = opts.prNarrative ?? "template";

  const sharedOpts: Parameters<typeof updatePrBodyShared>[0] = {
    branch: opts.branch,
    base: opts.base,
    cwd: opts.cwd,
    buildHeader: () => buildPlanPrHeader(headerOpts),
    getSubspecTitles: () => {
      const parsed = parseIndex(opts.indexPath);
      return parsed.subspecs.map((s) => extractSubspecTitle(s.path));
    },
  };
  if (prNarrative !== undefined) {
    sharedOpts.prNarrative = prNarrative;
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
  if (prNarrative === "agent" && opts.intentContent) {
    const intentContent = opts.intentContent;
    sharedOpts.buildPrompt = () =>
      buildPrDescriptionPrompt({
        intent: intentContent,
        specContext: buildSpecContext(opts.indexPath),
      });
  }

  return updatePrBodyShared(sharedOpts);
}

function extractSubspecTitle(subspecPath: string): string {
  // Extract just the filename without extension as a fallback title
  const parts = subspecPath.split("/");
  const filename = parts[parts.length - 1] ?? subspecPath;
  return filename.replace(/\.md$/, "");
}
