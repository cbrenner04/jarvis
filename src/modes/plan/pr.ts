import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CommitInfo } from "../../pr.ts";
import { readBranchCommits } from "../../pr.ts";

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
  /** Worktree root; used to locate `spec/<name>/index.md`. Required to render the live header. */
  worktreePath?: string;
}): string {
  const specDirBasename = opts.specDirBasename ?? opts.name;
  const indexPath =
    opts.worktreePath !== undefined
      ? join(opts.worktreePath, "spec", specDirBasename, "index.md")
      : null;
  const parsed =
    indexPath !== null ? parseIndex(indexPath) : { title: "", subspecs: [] };

  const titleLine =
    parsed.title !== "" ? `# ${parsed.title}` : `# Plan: ${opts.name}`;

  const lines: string[] = [
    titleLine,
    "",
    `- Intent: \`spec/${specDirBasename}/intent.md\``,
    `- Index: \`spec/${specDirBasename}/index.md\``,
  ];
  return lines.join("\n");
}

/**
 * Check if a commit is a plan-mode meta-commit.
 * Meta-commits have subjects starting with "plan: " and first body line
 * pointing to the intent.md file (not a subspec file).
 */
function isPlanMetaCommit(commit: CommitInfo): boolean {
  return (
    commit.subject.startsWith("plan: ") &&
    commit.firstBodyLine.startsWith("Spec: spec/") &&
    commit.firstBodyLine.includes("/intent.md")
  );
}

/**
 * Check if a commit is a subspec commit.
 * Subspec commits have first body line starting with "Spec: " and pointing
 * to an actual subspec file (not intent.md).
 */
function isSubspecCommit(commit: CommitInfo): boolean {
  return (
    commit.firstBodyLine.startsWith("Spec: spec/") &&
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
