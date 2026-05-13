import { execFileSync } from "node:child_process";

export type EnsureDraftPrOpts = {
  branch: string;
  base: string;
  title: string;
  bodyGenerator: () => Promise<string>;
  cwd?: string;
};

export async function ensureDraftPr(
  opts: EnsureDraftPrOpts,
): Promise<{ number: number; created: boolean }> {
  const existingPr = checkPrExists(opts.branch, opts.cwd);
  if (existingPr) {
    return { number: existingPr, created: false };
  }

  const body = await opts.bodyGenerator();
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
