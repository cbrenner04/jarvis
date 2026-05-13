import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { checkPrExists } from "../../pr.ts";

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

  const indexH1 = extractFirstHeading(indexContent);
  const subspecNames = extractSpecNames(indexContent);

  let body = indexH1 ? `# ${indexH1}\n\n` : "";

  if (subspecNames.length > 0) {
    body += "## Subspecs\n\n";
    for (const name of subspecNames) {
      const h1 = extractFirstHeadingFromSpec(`${specDir}/${name}`);
      if (h1) {
        body += `- ${h1}\n`;
      }
    }
  }

  return body;
}

function extractFirstHeading(content: string): string | null {
  const match = content.match(/^# (.+)$/m);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function extractSpecNames(indexContent: string): string[] {
  const matches = Array.from(indexContent.matchAll(/\]\(\.\/([^)]+)\)/g));
  return matches
    .map((m) => m[1])
    .filter(
      (name): name is string => name !== undefined && !name.endsWith(".md"),
    );
}

function extractFirstHeadingFromSpec(specPath: string): string | null {
  try {
    const content = readFileSync(specPath, "utf8");
    return extractFirstHeading(content);
  } catch {
    return null;
  }
}

function linkedSubspecsAreComplete(indexContent: string): boolean {
  let sawLinkedSubspec = false;
  for (const line of indexContent.split(/\r?\n/)) {
    const match = line.match(/^\s*- \[([ xX])\] \[[^\]]+\]\(([^)]+)\)/);
    if (!match?.[1] || !match[2]) {
      continue;
    }
    sawLinkedSubspec = true;
    if (match[1] !== "x" && match[1] !== "X") {
      return false;
    }
  }
  return sawLinkedSubspec;
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
