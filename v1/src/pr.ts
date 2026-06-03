import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

// Stable HTML comments delimiting the manually editable PR narrative section.
export const NARRATIVE_START_MARKER = "<!-- jarvis:narrative:start -->";
export const NARRATIVE_END_MARKER = "<!-- jarvis:narrative:end -->";
const GENERATED_NARRATIVE_HASH_PREFIX =
  "<!-- jarvis:narrative:generated-sha256:";

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
const TRAILER_VALUE_SEP = "\x02";

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
        `--format=%h${COMMIT_FIELD_SEP}%s${COMMIT_FIELD_SEP}%(trailers:key=Jarvis-Agent,valueonly=true,separator=%x02)${COMMIT_FIELD_SEP}%b${COMMIT_RECORD_SEP}`,
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
        : trailerField.split(TRAILER_VALUE_SEP).map((s) => s.trim());
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
export function renderAttribution(opts: { cwd: string; base: string }): string {
  const commits = readBranchCommits({ cwd: opts.cwd, base: opts.base });
  const subspecCommits = getSubspecCommits(commits);
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

/**
 * Render only the compact attribution summary line for subspec commits.
 *
 * Returns `""` when there are no subspec commits or when no subspec commit
 * has a non-empty `Jarvis-Agent` trailer.
 */
export function renderAttributionSummary(opts: {
  cwd: string;
  base: string;
}): string {
  const commits = readBranchCommits({ cwd: opts.cwd, base: opts.base });
  const subspecCommits = getSubspecCommits(commits);
  if (subspecCommits.length === 0) {
    return "";
  }
  const labels = collectLabelOrder(subspecCommits);
  if (labels.length === 0) {
    return "";
  }
  return `Written by ${labels.join(", ")} through Jarvis.`;
}

function getSubspecCommits(commits: CommitInfo[]): CommitInfo[] {
  return commits.filter((c) =>
    c.firstBodyLine.startsWith(SUBSPEC_FIRST_BODY_LINE_PREFIX),
  );
}

function collectLabelOrder(commits: CommitInfo[]): string[] {
  const labelOrder: string[] = [];
  const seenLabels = new Set<string>();
  for (const commit of commits) {
    for (const label of commit.jarvisAgentTrailers) {
      if (label === "" || seenLabels.has(label)) {
        continue;
      }
      seenLabels.add(label);
      labelOrder.push(label);
    }
  }
  return labelOrder;
}

export function extractNarrative(prBody: string): string | null {
  const startIdx = prBody.indexOf(NARRATIVE_START_MARKER);
  if (startIdx === -1) {
    return null;
  }
  const afterStart = startIdx + NARRATIVE_START_MARKER.length;
  const endIdx = prBody.indexOf(NARRATIVE_END_MARKER, afterStart);
  if (endIdx === -1) {
    return null;
  }
  return prBody.slice(afterStart, endIdx).trim();
}

export function markGeneratedNarrative(narrative: string): string {
  const content = narrative.trim();
  return `${content}\n${GENERATED_NARRATIVE_HASH_PREFIX}${hashNarrative(content)} -->`;
}

export function extractGeneratedNarrativeContent(
  narrative: string,
): string | null {
  const lines = narrative.replace(/\r\n/g, "\n").split("\n");
  const marker = lines.at(-1)?.trim();
  const markerMatch = marker?.match(
    /^<!-- jarvis:narrative:generated-sha256:([a-f0-9]{64}) -->$/,
  );
  if (!markerMatch?.[1]) {
    return null;
  }

  const content = lines.slice(0, -1).join("\n").trim();
  if (hashNarrative(content) !== markerMatch[1]) {
    return null;
  }
  return content;
}

function hashNarrative(narrative: string): string {
  return createHash("sha256").update(narrative).digest("hex");
}

export type UpdatePrBodyOpts = {
  headerBuilder: () => string;
  branch: string;
  base: string;
  cwd: string;
  /** Test seam: fetch the current PR body. Defaults to `gh pr view`. */
  fetchPrBody?: (branch: string, cwd: string) => string;
  /** Test seam: write the new PR body. Defaults to `gh pr edit --body-file -`. */
  writePrBody?: (branch: string, body: string, cwd: string) => void;
  /** Test seam: render the attribution footer. Defaults to `renderAttribution`. */
  renderFooter?: (opts: { cwd: string; base: string }) => string;
};

/**
 * Rewrite the PR body for `branch` from scratch: fetch the current body,
 * preserve the narrative section between markers (if present), rebuild the
 * deterministic header via headerBuilder, render the attribution footer from
 * git trailers, and pipe the assembled body to `gh pr edit --body-file -`.
 *
 * Throws on `gh` failure; callers wrap with try/catch and warn-and-continue.
 */
export function updatePrBody(opts: UpdatePrBodyOpts): void {
  const fetchPrBody = opts.fetchPrBody ?? defaultFetchPrBody;
  const writePrBody = opts.writePrBody ?? defaultWritePrBody;
  const renderFooter = opts.renderFooter ?? renderAttribution;

  const currentBody = fetchPrBody(opts.branch, opts.cwd);
  const narrative = extractNarrative(currentBody);
  const header = opts.headerBuilder();
  let headerAndNarrative = header;
  if (narrative !== null) {
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
