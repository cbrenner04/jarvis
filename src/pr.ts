import { execFileSync } from "node:child_process";

export type EnsureDraftPrOpts = {
  branch: string;
  base: string;
  title: string;
  bodyGenerator: () => Promise<string>;
  footer: string;
  cwd?: string;
};

export async function ensureDraftPr(
  opts: EnsureDraftPrOpts,
): Promise<{ number: number; created: boolean }> {
  const existingPr = checkPrExists(opts.branch, opts.cwd);
  if (existingPr) {
    return { number: existingPr, created: false };
  }

  let body = await opts.bodyGenerator();
  if (opts.footer !== "") {
    body = `${body}\n\n---\n\n${opts.footer}`;
  }
  const prNumber = createDraftPr(
    opts.branch,
    opts.base,
    opts.title,
    body,
    opts.cwd,
  );
  return { number: prNumber, created: true };
}

export function checkPrExists(branch: string, cwd?: string): number | null {
  // Filter to OPEN PRs only. `gh pr view <branch>` returns the most recent PR
  // regardless of state, so a previously merged/closed PR on the same branch
  // would otherwise be treated as the current PR (e.g. when a worktree branch
  // is reused after its prior PR has been merged).
  try {
    const output = execFileSync(
      "gh",
      [
        "pr",
        "view",
        branch,
        "--json",
        "number,state",
        "-q",
        'select(.state=="OPEN") | .number',
      ],
      { cwd, env: process.env, stdio: "pipe", encoding: "utf8" },
    );
    const number = parseInt(output.trim(), 10);
    return Number.isNaN(number) ? null : number;
  } catch {
    return null;
  }
}

function createDraftPr(
  branch: string,
  base: string,
  title: string,
  body: string,
  cwd?: string,
): number {
  execFileSync(
    "gh",
    [
      "pr",
      "create",
      "--draft",
      "--base",
      base,
      "--head",
      branch,
      "--title",
      title,
      "--body",
      body,
    ],
    { cwd, env: process.env, stdio: "pipe" },
  );
  const prOutput = execFileSync(
    "gh",
    ["pr", "view", branch, "--json", "number,state", "-q", ".number"],
    { cwd, env: process.env, stdio: "pipe", encoding: "utf8" },
  );
  const number = parseInt(prOutput.trim(), 10);
  if (Number.isNaN(number)) {
    throw new Error("failed to parse PR number from gh output");
  }
  return number;
}

/**
 * Per-commit information harvested from `git log <base>..HEAD`.
 *
 * `firstBodyLine` is the first non-empty line of the commit body and is used
 * to filter to subspec commits (those whose first body line begins with
 * `Spec: `). `jarvisAgentTrailers` is the list of values for any
 * `Jarvis-Agent` trailers on the commit, in the order git reports them.
 */
export type CommitInfo = {
  shortSha: string;
  subject: string;
  firstBodyLine: string;
  jarvisAgentTrailers: string[];
};

const SUBSPEC_FIRST_BODY_LINE_PREFIX = "Spec: ";
const COMMIT_FIELD_SEP = "\x1f";
const COMMIT_RECORD_SEP = "\x1e";

/**
 * Read commits on the current branch ahead of `base` and parse out the
 * fields renderAttribution needs. Exported only for tests; production
 * callers should use `renderAttribution` directly.
 */
export function readBranchCommits(opts: {
  cwd: string;
  base: string;
}): CommitInfo[] {
  let output: string;
  try {
    output = execFileSync(
      "git",
      [
        "log",
        "--reverse",
        // %h short sha, %s subject, %(trailers ...) joined by US, %b full body
        // Records separated by RS so subjects/bodies can contain newlines.
        `--format=%h${COMMIT_FIELD_SEP}%s${COMMIT_FIELD_SEP}%(trailers:key=Jarvis-Agent,valueonly=true,separator=%x1f)${COMMIT_FIELD_SEP}%b${COMMIT_RECORD_SEP}`,
        `${opts.base}..HEAD`,
      ],
      { cwd: opts.cwd, env: process.env, stdio: "pipe", encoding: "utf8" },
    );
  } catch {
    return [];
  }

  const commits: CommitInfo[] = [];
  const records = output.split(COMMIT_RECORD_SEP);
  for (const rawRecord of records) {
    const record = rawRecord.replace(/^\n+/, "");
    if (record === "") {
      continue;
    }
    const fields = record.split(COMMIT_FIELD_SEP);
    if (fields.length < 4) {
      continue;
    }
    const shortSha = fields[0] ?? "";
    const subject = fields[1] ?? "";
    const trailerField = fields[2] ?? "";
    const body = fields[3] ?? "";
    const trailers =
      trailerField === ""
        ? []
        : trailerField.split(COMMIT_FIELD_SEP).map((s) => s.trim());
    // git's %b includes trailers; strip them so firstBodyLine reflects the
    // commit body proper. Detect the trailer block as the trailing run of
    // `Key: value` lines preceded by a blank line.
    const bodyWithoutTrailers = stripTrailerBlock(body);
    const firstBodyLine = firstNonEmptyLine(bodyWithoutTrailers);
    commits.push({
      shortSha,
      subject,
      firstBodyLine,
      jarvisAgentTrailers: trailers,
    });
  }
  return commits;
}

function firstNonEmptyLine(text: string): string {
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line !== "") {
      return line;
    }
  }
  return "";
}

function stripTrailerBlock(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  // Walk backward across blank lines.
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "") === "") {
    end -= 1;
  }
  // Identify the trailing run of trailer-shaped lines. The `Spec: <path>`
  // line that `commitSubspec` writes as the first body line is structurally
  // a trailer, but our convention treats it as body content; preserve it.
  let trailerStart = end;
  const trailerLine = /^[A-Za-z][A-Za-z0-9-]*:\s.+$/;
  while (trailerStart > 0) {
    const line = lines[trailerStart - 1] ?? "";
    if (!trailerLine.test(line)) {
      break;
    }
    if (line.startsWith("Spec: ")) {
      break;
    }
    trailerStart -= 1;
  }
  if (trailerStart === end) {
    return body;
  }
  // The trailer block must be preceded by a blank line (or the start of body).
  if (trailerStart > 0 && (lines[trailerStart - 1] ?? "") !== "") {
    return body;
  }
  return lines.slice(0, trailerStart).join("\n");
}

/**
 * Render the PR-body attribution footer from `Jarvis-Agent` trailers on
 * commits between `base` and `HEAD`.
 *
 * Returns `""` when the branch has no subspec commits at all (typical
 * pre-first-commit state). When the branch has subspec commits, the footer
 * is the per-commit list (chronological, oldest first), a blank line, and
 * (when at least one commit carries a label) a deduped summary line of the
 * form `Written by <A>, <B> through Jarvis.`. Commits without a
 * `Jarvis-Agent` trailer are listed with `unknown` as the label and
 * excluded from the summary.
 */
export function renderAttribution(opts: {
  cwd: string;
  base: string;
}): string {
  const commits = readBranchCommits({ cwd: opts.cwd, base: opts.base });
  const subspecCommits = commits.filter((c) =>
    c.firstBodyLine.startsWith(SUBSPEC_FIRST_BODY_LINE_PREFIX),
  );
  if (subspecCommits.length === 0) {
    return "";
  }

  const bullets: string[] = [];
  const labelOrder: string[] = [];
  const seenLabels = new Set<string>();
  for (const commit of subspecCommits) {
    const label =
      commit.jarvisAgentTrailers.length === 0
        ? "unknown"
        : commit.jarvisAgentTrailers.join(", ");
    bullets.push(`- ${commit.shortSha} ${commit.subject} \u2014 ${label}`);
    for (const single of commit.jarvisAgentTrailers) {
      if (single === "" || seenLabels.has(single)) {
        continue;
      }
      seenLabels.add(single);
      labelOrder.push(single);
    }
  }

  const lines = [...bullets];
  if (labelOrder.length > 0) {
    lines.push("");
    lines.push(`Written by ${labelOrder.join(", ")} through Jarvis.`);
  }
  return lines.join("\n");
}
