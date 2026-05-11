import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

export type EnsureDraftPrOpts = {
  branch: string;
  base: string;
  title: string;
  bodyGenerator: () => Promise<string>;
};

export async function ensureDraftPr(
  opts: EnsureDraftPrOpts,
): Promise<{ number: number; created: boolean }> {
  const existingPr = checkPrExists(opts.branch);
  if (existingPr) {
    return { number: existingPr, created: false };
  }

  const body = await opts.bodyGenerator();
  const prNumber = createDraftPr(
    opts.branch,
    opts.base,
    opts.title,
    body,
  );
  return { number: prNumber, created: true };
}

function checkPrExists(branch: string): number | null {
  try {
    const output = execSync(
      `gh pr view ${branch} --json number,state -q .number`,
      { stdio: "pipe", encoding: "utf8" },
    );
    const number = parseInt(output.trim(), 10);
    return isNaN(number) ? null : number;
  } catch {
    return null;
  }
}

function createDraftPr(
  branch: string,
  base: string,
  title: string,
  body: string,
): number {
  const prOutput = execSync(
    `gh pr create --draft --base ${base} --head ${branch} --title "${escapeShellArg(title)}" --body "${escapeShellArg(body)}" --json number -q .number`,
    { stdio: "pipe", encoding: "utf8" },
  );
  const number = parseInt(prOutput.trim(), 10);
  if (isNaN(number)) {
    throw new Error("failed to parse PR number from gh output");
  }
  return number;
}

function escapeShellArg(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\$/g, "\\$");
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
  if (!match || !match[1]) {
    return null;
  }
  return match[1].trim();
}

function extractSpecNames(indexContent: string): string[] {
  const matches = Array.from(indexContent.matchAll(/\]\(\.\/([^)]+)\)/g));
  return matches
    .map((m) => m[1])
    .filter((name): name is string => name !== undefined && !name.endsWith(".md"));
}

function extractFirstHeadingFromSpec(specPath: string): string | null {
  try {
    const content = readFileSync(specPath, "utf8");
    return extractFirstHeading(content);
  } catch {
    return null;
  }
}
