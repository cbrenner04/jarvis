import { execFileSync } from "node:child_process";
import { getBaseBranch } from "../gh.ts";

export type BaseCurrentCheckResult =
  | {
      status: "current";
      baseRefName: string | null;
    }
  | {
      status: "behind";
      baseRefName: string;
    };

type AncestorVerdict =
  | { status: "current"; baseRefName: string }
  | { status: "behind"; baseRefName: string }
  | { status: "uncertain"; baseRefName: string };

function fetchAndCheckAncestor(baseRefName: string, cwd: string): AncestorVerdict {
  try {
    execFileSync("git", ["fetch", "origin", baseRefName], {
      cwd,
      env: process.env,
      stdio: "pipe",
    });
  } catch {
    return { status: "uncertain", baseRefName };
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", `origin/${baseRefName}`, "HEAD"], {
      cwd,
      env: process.env,
      stdio: "pipe",
    });
    return { status: "current", baseRefName };
  } catch (err) {
    const exitCode = (err as NodeJS.ErrnoException & { status?: number }).status;
    if (exitCode === 1) {
      return { status: "behind", baseRefName };
    }
    return { status: "uncertain", baseRefName };
  }
}

function ancestorVerdictToResult(verdict: AncestorVerdict, softFailBaseRefName: string | null): BaseCurrentCheckResult {
  if (verdict.status === "uncertain") {
    return { status: "current", baseRefName: softFailBaseRefName };
  }
  return verdict;
}

function resolvePrBaseRefName(branch: string, cwd: string): string | null {
  try {
    const baseRefName = execFileSync("gh", ["pr", "view", branch, "--json", "baseRefName", "-q", ".baseRefName"], {
      cwd,
      env: process.env,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
    return baseRefName === "" ? null : baseRefName;
  } catch {
    return null;
  }
}

export function checkBaseCurrent(opts: { branch: string; cwd: string }): BaseCurrentCheckResult {
  const baseRefName = resolvePrBaseRefName(opts.branch, opts.cwd);
  if (baseRefName === null) {
    return { status: "current", baseRefName: null };
  }
  return ancestorVerdictToResult(fetchAndCheckAncestor(baseRefName, opts.cwd), baseRefName);
}

export type CheckBaseCurrentForFinalizeOpts = {
  branch: string;
  cwd: string;
  hasOpenPr: boolean;
  getBaseBranch?: (cwd?: string) => Promise<string>;
};

export async function checkBaseCurrentForFinalize(
  opts: CheckBaseCurrentForFinalizeOpts,
): Promise<BaseCurrentCheckResult> {
  let baseRefName: string;
  let softFailBaseRefName: string | null;

  if (opts.hasOpenPr) {
    const resolved = resolvePrBaseRefName(opts.branch, opts.cwd);
    if (resolved === null) {
      return { status: "current", baseRefName: null };
    }
    baseRefName = resolved;
    softFailBaseRefName = resolved;
  } else {
    const getBase = opts.getBaseBranch ?? getBaseBranch;
    baseRefName = await getBase(opts.cwd);
    softFailBaseRefName = baseRefName;
  }

  return ancestorVerdictToResult(fetchAndCheckAncestor(baseRefName, opts.cwd), softFailBaseRefName);
}

export function writeReadyFlipBlocked(stderr: (s: string) => void, branch: string, baseRefName: string): void {
  stderr(`ready flip blocked: branch ${branch} does not contain base ${baseRefName}; PR stays draft\n`);
}
