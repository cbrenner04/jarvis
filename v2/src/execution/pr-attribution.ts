import { execFile } from "node:child_process";

const SUBSPEC_FIRST_BODY_LINE_PREFIX = "Spec: ";
const COMMIT_FIELD_SEP = "\x1f";
const COMMIT_RECORD_SEP = "\x1e";
const TRAILER_VALUE_SEP = "\x02";

export type CommitInfo = {
  shortSha: string;
  subject: string;
  firstBodyLine: string;
  jarvisAgentTrailers: string[];
};

type Git = (cwd: string, args: readonly string[]) => Promise<string>;

function defaultGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: process.env, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout ?? "");
    });
  });
}

/** Read commits on the current branch ahead of `base` for attribution rendering. */
export async function readBranchCommits(opts: { cwd: string; base: string; git?: Git }): Promise<CommitInfo[]> {
  const git = opts.git ?? defaultGit;
  let output: string;
  try {
    output = await git(opts.cwd, [
      "log",
      "--reverse",
      `--format=%h${COMMIT_FIELD_SEP}%s${COMMIT_FIELD_SEP}%(trailers:key=Jarvis-Agent,valueonly=true,separator=%x02)${COMMIT_FIELD_SEP}%b${COMMIT_RECORD_SEP}`,
      `${opts.base}..HEAD`,
    ]);
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
    const trailers = trailerField === "" ? [] : trailerField.split(TRAILER_VALUE_SEP).map((s) => s.trim());
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
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "") === "") {
    end -= 1;
  }
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
  if (trailerStart > 0 && (lines[trailerStart - 1] ?? "") !== "") {
    return body;
  }
  return lines.slice(0, trailerStart).join("\n");
}

function getSubspecCommits(commits: CommitInfo[]): CommitInfo[] {
  return commits.filter((c) => c.firstBodyLine.startsWith(SUBSPEC_FIRST_BODY_LINE_PREFIX));
}

/** Render the PR-body attribution footer from `Jarvis-Agent` trailers on qualifying commits. */
export async function renderAttribution(opts: { cwd: string; base: string; git?: Git }): Promise<string> {
  const commits = await readBranchCommits(opts);
  const subspecCommits = getSubspecCommits(commits);
  if (subspecCommits.length === 0) {
    return "";
  }

  const bullets: string[] = [];
  const labelOrder: string[] = [];
  const seenLabels = new Set<string>();
  for (const commit of subspecCommits) {
    const label = commit.jarvisAgentTrailers.length === 0 ? "unknown" : commit.jarvisAgentTrailers.join(", ");
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
