import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSpec } from "../../../shared/spec-parser.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { readBranchCommits } from "./pr-attribution.ts";
import { resolveSpecIndexPath } from "./spec-creation-title.ts";

type DiffStat = { added: number; removed: number; path: string };
type Git = (cwd: string, args: readonly string[]) => Promise<string>;

function firstProseLine(body: string): string | undefined {
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || /^[-*+]\s/.test(line)) continue;
    return line.length > 80 ? `${line.slice(0, 80)}…` : line;
  }
  return undefined;
}

function area(path: string): string {
  const parts = path.split("/");
  return parts.length === 1 ? "(root)" : parts.slice(0, 2).join("/");
}

function riskCue(diffs: readonly DiffStat[]): string | undefined {
  const source = diffs.some(
    (d) =>
      !d.path.endsWith(".test.ts") &&
      !d.path.includes("/test/") &&
      !d.path.endsWith(".md") &&
      !d.path.endsWith(".json"),
  );
  const tests = diffs.some((d) => d.path.endsWith(".test.ts") || d.path.includes("/test/"));
  return source && !tests ? "no test changes" : undefined;
}

function renderTemplate(
  subspecs: readonly { title: string; why: string | undefined }[],
  commits: readonly string[],
  diffs: readonly DiffStat[],
): string {
  const lines: string[] = [];
  if (subspecs.length > 0) {
    lines.push("## Subspecs");
    for (const { title, why } of subspecs) {
      lines.push(`- ${title}${why === undefined ? "" : ` — ${why}`}`);
    }
  }
  if (commits.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("## Commits", ...commits.map((subject) => `- ${subject}`));
  }
  if (diffs.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(...renderDiffSummary(diffs));
  }
  return lines.length === 0 ? "(no content)" : lines.join("\n");
}

/** Risk cues, change totals, and per-area breakdown for the changed-files section. */
function renderDiffSummary(diffs: readonly DiffStat[]): string[] {
  const lines: string[] = [];
  const cue = riskCue(diffs);
  if (cue !== undefined) lines.push("## Risk cues", `- ${cue}`, "");
  const totals = diffs.reduce((sum, diff) => ({ added: sum.added + diff.added, removed: sum.removed + diff.removed }), {
    added: 0,
    removed: 0,
  });
  lines.push(
    "## Change summary",
    `${diffs.length} file${diffs.length === 1 ? "" : "s"} changed (+${totals.added}/-${totals.removed})`,
    "",
  );
  const groups = new Map<string, { added: number; removed: number; files: number }>();
  for (const diff of diffs) {
    const key = area(diff.path);
    const current = groups.get(key) ?? { added: 0, removed: 0, files: 0 };
    current.added += diff.added;
    current.removed += diff.removed;
    current.files += 1;
    groups.set(key, current);
  }
  const sortedGroups = [...groups.entries()].sort(
    ([a, x], [b, y]) => y.added + y.removed - (x.added + x.removed) || a.localeCompare(b),
  );
  for (const [key, stats] of sortedGroups) {
    lines.push(`- ${key}: ${stats.files} file${stats.files === 1 ? "" : "s"} (+${stats.added}/-${stats.removed})`);
  }
  return lines;
}

async function readDiffStats(cwd: string, base: string, git: Git): Promise<DiffStat[]> {
  try {
    const output = await git(cwd, ["diff", "--numstat", `${base}...HEAD`]);
    return output.split("\n").flatMap((line) => {
      const [added, removed, path] = line.split("\t");
      if (path === undefined || added === undefined || removed === undefined) return [];
      const parsedAdded = added === "-" ? 0 : Number.parseInt(added, 10);
      const parsedRemoved = removed === "-" ? 0 : Number.parseInt(removed, 10);
      return Number.isNaN(parsedAdded) || Number.isNaN(parsedRemoved)
        ? []
        : [{ added: parsedAdded, removed: parsedRemoved, path }];
    });
  } catch {
    return [];
  }
}

/** Derive the v1-shaped plan/implement template from the current worktree. */
export async function deriveSpecRunBodySummary(input: {
  worktreePath: string;
  specPath: string;
  baseRef: string;
  git?: Git;
}): Promise<string> {
  const indexPath = resolveSpecIndexPath(input.worktreePath, input.specPath);
  if (!existsSync(indexPath)) return "(no content)";
  const index = parseSpec(readFileSync(indexPath, "utf8"));
  const bodies = index.linkedSubspecs.map((subspec) => {
    try {
      return readFileSync(join(dirname(indexPath), subspec.path), "utf8");
    } catch {
      return "";
    }
  });
  const git = input.git ?? ((cwd, args) => realAsyncSubprocessRunner.runAsync("git", [...args], cwd));
  const [commits, diffs] = await Promise.all([
    readBranchCommits({ cwd: input.worktreePath, base: input.baseRef, git }).catch(() => []),
    readDiffStats(input.worktreePath, input.baseRef, git),
  ]);
  return renderTemplate(
    index.linkedSubspecs.map((subspec, i) => ({ title: subspec.text, why: firstProseLine(bodies[i] ?? "") })),
    commits.map((commit) => commit.subject),
    diffs,
  );
}
