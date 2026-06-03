import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Agent } from "../../agents/types.ts";
import type { CommitInfo } from "../../pr.ts";
import {
  extractNarrative,
  NARRATIVE_END_MARKER,
  NARRATIVE_START_MARKER,
  readBranchCommits,
} from "../../pr.ts";
import { buildPrDescriptionPrompt } from "./pr-description-prompt.ts";

/**
 * A single subspec entry parsed from `index.md`.
 */
export type IndexSubspec = {
  /** Raw checklist line as it appears in `index.md` (e.g. `- [ ] [01 — Foo](./01-foo.md)`). */
  line: string;
  /** True iff the checkbox is checked (`[x]` or `[X]`). */
  checked: boolean;
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
    const checklist = rawLine.match(/^\s*-\s+\[( |x|X)\]\s+\[.+?\]\(.+?\)/);
    if (checklist) {
      const checked = checklist[1] !== " ";
      subspecs.push({ line: rawLine, checked });
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
    opts.worktreePath !== undefined
      ? join(opts.worktreePath, targetDir, specDirBasename, "index.md")
      : null;
  const parsed =
    indexPath !== null ? parseIndex(indexPath) : { title: "", subspecs: [] };

  const titleLine =
    parsed.title !== "" ? `# ${parsed.title}` : `# Plan: ${opts.name}`;

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
  return (
    commit.firstBodyLine.startsWith("Spec: ") &&
    !commit.firstBodyLine.includes("/intent.md")
  );
}

/**
 * Group consecutive plan-mode meta-commits together.
 */
function groupMetaCommits(
  commits: CommitInfo[],
): (CommitInfo | CommitInfo[])[] {
  const groups: (CommitInfo | CommitInfo[])[] = [];
  let metaGroup: CommitInfo[] = [];

  for (const commit of commits) {
    if (isPlanMetaCommit(commit)) {
      metaGroup.push(commit);
    } else {
      if (metaGroup.length > 0) {
        const group =
          metaGroup.length === 1 && metaGroup[0] ? metaGroup[0] : metaGroup;
        groups.push(group);
        metaGroup = [];
      }
      groups.push(commit);
    }
  }

  if (metaGroup.length > 0) {
    const group =
      metaGroup.length === 1 && metaGroup[0] ? metaGroup[0] : metaGroup;
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
export function renderPlanAttribution(opts: {
  cwd: string;
  base: string;
}): string {
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
      bullets.push(
        `- ${metaCommits.length} spec commits (refine, draft, review) — ${agentLabel}`,
      );
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
        bullets.push(
          `- 1 spec commits (refine, draft, review) — ${agentLabel}`,
        );
        for (const agent of agents) {
          if (agent !== "" && !seenLabels.has(agent)) {
            seenLabels.add(agent);
            labelOrder.push(agent);
          }
        }
      } else if (isSubspecCommit(commit)) {
        // Individual subspec commit
        const label =
          commit.jarvisAgentTrailers.length === 0
            ? "unknown"
            : commit.jarvisAgentTrailers.join(", ");
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
  /** Test seam: get the open PR state. Defaults to `getOpenPrState`. */
  getOpenPrState?: (branch: string, cwd: string) => OpenPrInfo;
  /** Test seam: invoke `gh pr ready`. Defaults to `execFileSync`. */
  markReady?: (branch: string, cwd: string) => void;
};

/**
 * Mark the plan-mode PR ready for review by invoking `gh pr ready <branch>`.
 *
 * Behavior depends on the current PR state:
 * - `none` (no open PR): silent no-op
 * - `draft` (open draft PR): run `bun run ready` gate, then `gh pr ready` transition
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

  // Draft PR: run gate and transition
  const mark =
    opts.markReady ??
    ((branch, cwd) => {
      try {
        execFileSync("bun", ["run", "ready"], {
          cwd,
          env: process.env,
          stdio: "pipe",
        });
      } catch (err) {
        const out = err as NodeJS.ErrnoException & {
          stdout?: Buffer;
          stderr?: Buffer;
        };
        const captured = [out.stdout?.toString(), out.stderr?.toString()]
          .filter(Boolean)
          .join("\n")
          .trim();
        throw new Error(
          captured
            ? `bun run ready failed:\n${captured}`
            : `bun run ready failed`,
        );
      }
      execFileSync("gh", ["pr", "ready", branch], {
        cwd,
        env: process.env,
        stdio: "pipe",
      });
    });
  mark(opts.branch, opts.cwd);
}

export { extractNarrative, NARRATIVE_END_MARKER, NARRATIVE_START_MARKER };

/**
 * Generate the PR description by calling the model with the PR description prompt.
 * Returns the model's response containing Description + Decisions section.
 *
 * Validates that the response contains the expected shape. Returns null if
 * generation fails or validation fails.
 */
export async function generatePrDescription(opts: {
  indexPath: string;
  intent: string;
  agent: Agent;
  cwd: string;
}): Promise<string | null> {
  try {
    const indexContent = readFileSync(opts.indexPath, "utf8");
    const prompt = buildPrDescriptionPrompt({
      intent: opts.intent,
      specContext: indexContent,
    });

    const result = await opts.agent.run(prompt, {
      cwd: opts.cwd,
    });

    if (result.kind !== "ok") {
      return null;
    }

    const description = result.stdout.trim();
    if (!description.includes("Decisions:")) {
      return null;
    }

    return description;
  } catch {
    return null;
  }
}

export type UpdatePlanPrBodyOpts = {
  indexPath: string;
  specDirPath: string;
  branch: string;
  base: string;
  cwd: string;
  /** Committed spec root (e.g. `v1/spec`). Defaults to `spec`. Threaded into the header so the title and file pointers resolve correctly. */
  targetDir?: string;
  intentContent?: string;
  agent?: Agent;
  /** Test seam: fetch the current PR body. Defaults to `gh pr view`. */
  fetchPrBody?: (branch: string, cwd: string) => string;
  /** Test seam: write the new PR body. Defaults to `gh pr edit --body-file -`. */
  writePrBody?: (branch: string, body: string, cwd: string) => void;
  /** Test seam: render the attribution footer. Defaults to `renderPlanAttribution`. */
  renderFooter?: (opts: { cwd: string; base: string }) => string;
};

/**
 * Rewrite the plan-mode PR body: fetch the current body, preserve the narrative
 * section between markers (if present), rebuild the header from index.md, render
 * the attribution footer from git trailers, and pipe the assembled body to
 * `gh pr edit --body-file -`.
 *
 * When the narrative block is empty or missing and an agent is provided,
 * regenerate the narrative. Otherwise, preserve existing narrative verbatim.
 *
 * Throws on `gh` failure; callers wrap with try/catch and warn-and-continue.
 */
export async function updatePlanPrBody(
  opts: UpdatePlanPrBodyOpts,
): Promise<void> {
  const fetchPrBody = opts.fetchPrBody ?? defaultFetchPrBody;
  const writePrBody = opts.writePrBody ?? defaultWritePrBody;
  const renderFooter = opts.renderFooter ?? renderPlanAttribution;

  const currentBody = fetchPrBody(opts.branch, opts.cwd);
  let narrative = extractNarrative(currentBody);

  if (!narrative && opts.agent && opts.intentContent) {
    narrative = await generatePrDescription({
      indexPath: opts.indexPath,
      intent: opts.intentContent,
      agent: opts.agent,
      cwd: opts.cwd,
    });
  }

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
  const header = buildPlanPrHeader(headerOpts);
  let headerAndNarrative = header;
  if (narrative) {
    headerAndNarrative += `\n\n${NARRATIVE_START_MARKER}\n${narrative}\n${NARRATIVE_END_MARKER}`;
  }
  const footer = renderFooter({ cwd: opts.cwd, base: opts.base });
  const newBody =
    footer === ""
      ? headerAndNarrative
      : `${headerAndNarrative}\n\n---\n\n${footer}`;
  writePrBody(opts.branch, newBody, opts.cwd);
}

function defaultFetchPrBody(branch: string, cwd: string): string {
  return execFileSync(
    "gh",
    ["pr", "view", branch, "--json", "body", "-q", ".body"],
    { cwd, env: process.env, stdio: "pipe", encoding: "utf8" },
  );
}

function defaultWritePrBody(branch: string, body: string, cwd: string): void {
  execFileSync("gh", ["pr", "edit", branch, "--body-file", "-"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: body,
  });
}
