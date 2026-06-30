import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type MatchingOpenPr } from "./pr.ts";
import { readLiveWorktreeLock, type WorktreeLock } from "./worktree-lock.ts";

/** PR guards for scoped abandon: merged, inspection failure, multiple open, or ready open PR block retire. */
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

/**
 * Composite preflight for scoped abandon: worktree exists, no live lock, branch resolves, PR guards pass.
 * Stale locks are ignored; any step failure is ineligible (conservative).
 */
export function checkScopedAbandonPreflight(args: {
  projectRoot: string;
  worktreeName: string;
  worktreePath?: string;
  deps: ScopedAbandonPreflightDeps;
}): ScopedAbandonPreflightResult {
  const worktreePath = args.worktreePath ?? join(args.projectRoot, ".worktree", args.worktreeName);
  if (!existsSync(worktreePath)) {
    return { eligible: false, reason: "missing" };
  }

  const liveLock = readLiveWorktreeLock(worktreePath);
  if (liveLock !== null) {
    return { eligible: false, reason: "live_lock", lock: liveLock };
  }

  let branch: string;
  try {
    branch = branchForWorktree(worktreePath);
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

/** True when {@link checkScopedAbandonPreflight} returns eligible. */
export function isScopedAbandonEligible(args: {
  projectRoot: string;
  worktreeName: string;
  worktreePath?: string;
  deps: ScopedAbandonPreflightDeps;
}): boolean {
  return checkScopedAbandonPreflight(args).eligible;
}

/** PR-only abandon guards shared by global abandon scan and scoped preflight. */
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

function branchForWorktree(worktreePath: string): string {
  return execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: worktreePath,
    stdio: "pipe",
    encoding: "utf8",
  }).trim();
}
