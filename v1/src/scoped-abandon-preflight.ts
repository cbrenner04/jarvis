import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { getCurrentBranch } from "../../shared/git.ts";
import type { MatchingOpenPr } from "./pr.ts";
import { readLiveWorktreeLock, type WorktreeLock } from "./worktree-lock.ts";

export type AbandonPrEligibility =
  | { kind: "eligible" }
  | { kind: "merged" }
  | { kind: "inspection_failed"; message: string }
  | { kind: "multiple_open" }
  | { kind: "ready_pr"; prNumber: number };

export type ScopedAbandonPreflightDeps = {
  isMergedPr: (branch: string) => boolean;
  findMatchingOpenPrs: (branch: string, cwd?: string) => MatchingOpenPr[];
};

export type ScopedAbandonPreflightResult =
  | { eligible: true; branch: string }
  | { eligible: false; reason: "missing" }
  | { eligible: false; reason: "live_lock"; lock: WorktreeLock }
  | { eligible: false; reason: "branch_resolve_failed" }
  | { eligible: false; reason: "pr_ineligible"; branch: string; eligibility: AbandonPrEligibility };

export function isMergedPr(branch: string): boolean {
  try {
    const output = execFileSync("gh", ["pr", "view", branch, "--json", "state", "-q", ".state"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return output.trim() === "MERGED";
  } catch {
    return false;
  }
}

export function checkScopedAbandonPreflight(args: {
  projectRoot: string;
  worktreePath: string;
  deps: ScopedAbandonPreflightDeps;
}): ScopedAbandonPreflightResult {
  if (!existsSync(args.worktreePath)) {
    return { eligible: false, reason: "missing" };
  }

  const liveLock = readLiveWorktreeLock(args.worktreePath);
  if (liveLock !== null) {
    return { eligible: false, reason: "live_lock", lock: liveLock };
  }

  let branch: string;
  try {
    branch = getCurrentBranch(args.worktreePath);
  } catch {
    return { eligible: false, reason: "branch_resolve_failed" };
  }

  const eligibility = checkAbandonPrEligibility({
    branch,
    isMergedPr: args.deps.isMergedPr,
    findMatchingOpenPrs: args.deps.findMatchingOpenPrs,
    projectRoot: args.projectRoot,
  });
  if (eligibility.kind !== "eligible") {
    return { eligible: false, reason: "pr_ineligible", branch, eligibility };
  }

  return { eligible: true, branch };
}

export function checkAbandonPrEligibility(args: {
  branch: string;
  isMergedPr: (branch: string) => boolean;
  findMatchingOpenPrs: (branch: string, cwd?: string) => MatchingOpenPr[];
  projectRoot: string;
}): AbandonPrEligibility {
  if (args.isMergedPr(args.branch)) {
    return { kind: "merged" };
  }

  let matchingOpenPrs: MatchingOpenPr[];
  try {
    matchingOpenPrs = args.findMatchingOpenPrs(args.branch, args.projectRoot);
  } catch (err) {
    return { kind: "inspection_failed", message: (err as Error).message };
  }

  if (matchingOpenPrs.length > 1) {
    return { kind: "multiple_open" };
  }

  const matchingPr = matchingOpenPrs[0];
  if (matchingPr !== undefined && !matchingPr.isDraft) {
    return { kind: "ready_pr", prNumber: matchingPr.number };
  }

  return { kind: "eligible" };
}
