import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { checkPrExists, renderAttribution } from "../../pr.ts";
import { parsePatchSpec } from "./spec.ts";

export const NARRATIVE_START_MARKER = "<!-- jarvis:narrative:start -->";
export const NARRATIVE_END_MARKER = "<!-- jarvis:narrative:end -->";

type LinkedSubspecLine = {
  checked: boolean;
  text: string;
  path: string;
};

export function buildPrBody(opts: {
  indexPath: string;
  narrative: string | null;
}): string {
  const indexContent = readFileSync(opts.indexPath, "utf8");
  const parsedIndex = parsePatchSpec(indexContent);

  const linkedForBody: LinkedSubspecLine[] = parsedIndex.linkedSubspecs
    .filter((linked) => linked.path.endsWith(".md"))
    .map((linked) => ({
      checked: linked.checked,
      text: linked.text,
      path: linked.path,
    }));

  const total = linkedForBody.length;
  const completed = linkedForBody.filter((s) => s.checked).length;

  const lines: string[] = [];
  if (parsedIndex.h1) {
    lines.push(`# ${parsedIndex.h1}`);
    lines.push("");
  }
  lines.push("## Progress");
  lines.push("");
  lines.push(`${completed} of ${total} subspecs complete`);
  lines.push("");
  lines.push("## Subspecs");
  lines.push("");
  for (const linked of linkedForBody) {
    const box = linked.checked ? "[x]" : "[ ]";
    lines.push(`- ${box} [${linked.text}](${linked.path})`);
  }

  let body = lines.join("\n");

  if (opts.narrative !== null) {
    body += `\n\n${NARRATIVE_START_MARKER}\n${opts.narrative}\n${NARRATIVE_END_MARKER}`;
  }

  return body;
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

export type UpdatePrBodyOpts = {
  indexPath: string;
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
 * deterministic header from `indexPath`, render the attribution footer from
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
  const headerAndNarrative = buildPrBody({
    indexPath: opts.indexPath,
    narrative,
  });
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

export function maybeMarkReady(opts: { indexPath: string; cwd: string }): void {
  if (!linkedSubspecsAreComplete(readFileSync(opts.indexPath, "utf8"))) {
    return;
  }

  const branch = getCurrentBranch(opts.cwd);
  const prExists = checkPrExists(branch, opts.cwd);
  if (!prExists) {
    throw new Error(
      `cannot mark PR ready: no PR found for branch ${branch}. This should not happen after opening a draft PR.`,
    );
  }

  execFileSync("gh", ["pr", "ready", branch], {
    cwd: opts.cwd,
    env: process.env,
    stdio: "pipe",
  });
}

export function generatePrBodyFromSpec(specIndexPath: string): string {
  const specDir = dirname(specIndexPath);
  const indexContent = readFileSync(specIndexPath, "utf8");
  const parsedIndex = parsePatchSpec(indexContent);

  let body = parsedIndex.h1 ? `# ${parsedIndex.h1}\n\n` : "";

  const linkedForBody = parsedIndex.linkedSubspecs.filter(
    (linked) => !linked.path.endsWith(".md"),
  );

  if (linkedForBody.length > 0) {
    body += "## Subspecs\n\n";
    for (const linked of linkedForBody) {
      const h1 = extractFirstHeadingFromSpec(resolve(specDir, linked.path));
      if (h1) {
        body += `- ${h1}\n`;
      }
    }
  }

  return body;
}

function extractFirstHeadingFromSpec(specPath: string): string | null {
  try {
    const content = readFileSync(specPath, "utf8");
    return parsePatchSpec(content).h1 ?? null;
  } catch {
    return null;
  }
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
