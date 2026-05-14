import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { checkPrExists } from "../../pr.ts";
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
