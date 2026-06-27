import { execFileSync } from "node:child_process";

/**
 * Result of checking whether the current branch contains its PR base.
 */
export type BaseCurrentCheckResult =
  | {
      status: "current";
      baseRefName: string | null;
    }
  | {
      status: "behind";
      baseRefName: string;
    };

/**
 * Resolve the PR base, fetch `origin/<base>`, and check whether `HEAD`
 * contains that fetched base tip. Base-resolution and fetch failures soft-fail
 * to `current` so transient git/GitHub issues do not strand PRs in draft.
 */
export function checkBaseCurrent(opts: { branch: string; cwd: string }): BaseCurrentCheckResult {
  let baseRefName: string;
  try {
    baseRefName = execFileSync("gh", ["pr", "view", opts.branch, "--json", "baseRefName", "-q", ".baseRefName"], {
      cwd: opts.cwd,
      env: process.env,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch {
    return { status: "current", baseRefName: null };
  }

  if (baseRefName === "") {
    return { status: "current", baseRefName: null };
  }

  try {
    execFileSync("git", ["fetch", "origin", baseRefName], {
      cwd: opts.cwd,
      env: process.env,
      stdio: "pipe",
    });
  } catch {
    return { status: "current", baseRefName };
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", `origin/${baseRefName}`, "HEAD"], {
      cwd: opts.cwd,
      env: process.env,
      stdio: "pipe",
    });
    return { status: "current", baseRefName };
  } catch (err) {
    const exitCode = (err as NodeJS.ErrnoException & { status?: number }).status;
    if (exitCode === 1) {
      return { status: "behind", baseRefName };
    }
    return { status: "current", baseRefName };
  }
}
