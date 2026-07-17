import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getCurrentBranchAsync } from "../../../shared/git.ts";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { jarvisHome } from "../paths.ts";
import type { StateStore } from "../persistence/state-store.ts";
import { isBoundaryTerminalRunStatus } from "../persistence/state-store.ts";

export type DiscoveredWorktree = {
  path: string;
  branch: string;
};

/**
 * Discover materialized worktrees under ~/.jarvis/worktrees/<project>/.
 * Returns one candidate per real git worktree, excluding empty directories
 * and non-worktree debris. Each candidate carries its absolute path and
 * resolved branch (including slash-nested paths like plan/<name>).
 */
export async function discoverMaterializedWorktrees(
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string = jarvisHome(),
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<DiscoveredWorktree[]> {
  const candidates: DiscoveredWorktree[] = [];
  const worktreesRoot = join(jarvisRoot, "worktrees");

  if (!existsSync(worktreesRoot)) {
    return candidates;
  }

  for (const projectName of Object.keys(registry)) {
    const projectWorktreesDir = join(worktreesRoot, projectName);
    if (!existsSync(projectWorktreesDir)) {
      continue;
    }

    const discovered = await discoverWorktreesInProject(projectWorktreesDir, runner);
    candidates.push(...discovered);
  }

  return candidates;
}

/**
 * Walk the entire tree under <projectWorktreesDir> and find all valid
 * git worktrees, including slash-nested ones like plan/<name>.
 */
async function discoverWorktreesInProject(
  projectWorktreesDir: string,
  runner: AsyncSubprocessRunner,
): Promise<DiscoveredWorktree[]> {
  const candidates: DiscoveredWorktree[] = [];

  const entries = readdirSync(projectWorktreesDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(projectWorktreesDir, entry.name);
    if (entry.isDirectory()) {
      // Check if this directory is a valid worktree
      if (await isValidGitWorktree(fullPath, runner)) {
        const branch = await getCurrentBranchAsync(fullPath, runner);
        candidates.push({ path: fullPath, branch });
      } else {
        // Recurse into subdirectories (for slash-nested paths like plan/<name>)
        const nested = await discoverWorktreesRecursive(fullPath, runner);
        candidates.push(...nested);
      }
    }
  }

  return candidates;
}

/**
 * Recursively walk a directory tree to find nested worktrees.
 */
async function discoverWorktreesRecursive(dir: string, runner: AsyncSubprocessRunner): Promise<DiscoveredWorktree[]> {
  const candidates: DiscoveredWorktree[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (await isValidGitWorktree(fullPath, runner)) {
          const branch = await getCurrentBranchAsync(fullPath, runner);
          candidates.push({ path: fullPath, branch });
        } else {
          const nested = await discoverWorktreesRecursive(fullPath, runner);
          candidates.push(...nested);
        }
      }
    }
  } catch {
    // Ignore errors reading directories (e.g., permission denied)
  }

  return candidates;
}

/**
 * Check if a directory is a valid git worktree by running
 * `git rev-parse --is-inside-work-tree` and checking for "true".
 * Must NOT use stdio: "ignore" to capture stdout properly.
 */
async function isValidGitWorktree(worktreePath: string, runner: AsyncSubprocessRunner): Promise<boolean> {
  if (!existsSync(worktreePath)) return false;
  try {
    const result = await runner.runAsync("git", ["rev-parse", "--is-inside-work-tree"], worktreePath);
    return result.trim() === "true";
  } catch {
    return false;
  }
}

export type EligibilityResult = { status: "eligible" } | { status: "ineligible"; reason: string };

export type DaemonClient = (project: string, branch: string) => Promise<{ isLive: boolean }[]>;

/**
 * Determine whether a discovered worktree is eligible for retirement.
 * A worktree is eligible iff:
 * 1. Its PR is merged
 * 2. No non-terminal durable run references it (via project+branch)
 * 3. The daemon reports no live run for it
 *
 * Fail closed: any error (gh failure, daemon unreachable, store error) → ineligible.
 */
export async function checkEligibility(
  candidate: DiscoveredWorktree,
  project: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
): Promise<EligibilityResult> {
  // Check if PR is merged
  const mergedResult = await isMerged(candidate.branch, runner);
  if (!mergedResult.merged) {
    return { status: "ineligible", reason: `PR not merged: ${mergedResult.reason}` };
  }

  // Check durable run store for non-terminal runs
  const run = store.findRunByProjectBranch({ project, branch: candidate.branch });
  if (run && !isBoundaryTerminalRunStatus(run.status)) {
    return {
      status: "ineligible",
      reason: `Non-terminal run exists: status=${run.status}`,
    };
  }

  // Check daemon for live runs
  try {
    const daemonRuns = await daemonClient(project, candidate.branch);
    const hasLiveRun = daemonRuns.some((r) => r.isLive);
    if (hasLiveRun) {
      return { status: "ineligible", reason: "Daemon reports live run" };
    }
  } catch (err) {
    return {
      status: "ineligible",
      reason: `Daemon unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { status: "eligible" };
}

type MergedCheckResult = { merged: true } | { merged: false; reason: string };

/**
 * Check if a branch's PR is merged using `gh pr view <branch> --json state,mergedAt`.
 * This command includes merged PRs (unlike `gh pr list --head` which defaults to open).
 */
async function isMerged(branch: string, runner: AsyncSubprocessRunner): Promise<MergedCheckResult> {
  try {
    const output = await runner.runAsync("gh", ["pr", "view", branch, "--json", "state,mergedAt"], ".");
    const parsed = JSON.parse(output);
    if (parsed.state === "MERGED" && parsed.mergedAt) {
      return { merged: true };
    }
    return { merged: false, reason: `PR state is ${parsed.state}` };
  } catch (err) {
    if (err instanceof AsyncSubprocessError) {
      return { merged: false, reason: `gh failed: ${err.message}` };
    }
    return { merged: false, reason: `Unexpected error: ${String(err)}` };
  }
}

export type CleanupCandidate = {
  worktree: DiscoveredWorktree;
  project: string;
  eligibility: EligibilityResult;
};

/**
 * Run the cleanup command: discover merged-PR worktrees, filter by eligibility,
 * optionally preview (--dry-run) or prompt for confirmation, then retire them.
 *
 * Injected parameters allow the command to be tested with temp directories and
 * mock daemon clients. Production path constructs real daemon client (fail-closed).
 */
export async function runCleanupCommand(
  options: {
    dryRun?: boolean;
    promptConfirm?: (message: string) => Promise<boolean>;
  },
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string,
  runner: AsyncSubprocessRunner,
  daemonClient: DaemonClient,
  store: StateStore,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<number> {
  const discovered = await discoverMaterializedWorktrees(registry, jarvisRoot, runner);

  if (discovered.length === 0) {
    io.stdout("No eligible worktrees to clean up.\n");
    return 0;
  }

  // Check eligibility for each discovered worktree
  const candidates: CleanupCandidate[] = [];
  for (const worktree of discovered) {
    // Find which project owns this worktree by checking its path
    let project: string | undefined;
    for (const [proj] of Object.entries(registry)) {
      const projectWorktreesDir = join(jarvisRoot, "worktrees", proj);
      if (worktree.path.startsWith(`${projectWorktreesDir}/`)) {
        project = proj;
        break;
      }
    }

    if (!project) continue;

    const eligibility = await checkEligibility(worktree, project, runner, daemonClient, store);
    if (eligibility.status === "eligible") {
      candidates.push({ worktree, project, eligibility });
    }
  }

  if (candidates.length === 0) {
    io.stdout("No eligible worktrees to clean up.\n");
    return 0;
  }

  // Preview eligible worktrees
  io.stdout(`Found ${candidates.length} eligible worktree(s) for cleanup:\n`);
  for (const candidate of candidates) {
    io.stdout(`  ${candidate.worktree.path} (branch: ${candidate.worktree.branch})\n`);
  }

  if (options.dryRun) {
    io.stdout("(dry-run: no changes made)\n");
    return 0;
  }

  // Prompt for confirmation
  const confirmed =
    options.promptConfirm !== undefined ? await options.promptConfirm("Retire these worktrees? [y/N] ") : false;

  if (!confirmed) {
    io.stdout("Cancelled.\n");
    return 0;
  }

  // Re-check eligibility immediately before removal
  const stillEligible: CleanupCandidate[] = [];
  for (const candidate of candidates) {
    const recheck = await checkEligibility(candidate.worktree, candidate.project, runner, daemonClient, store);
    if (recheck.status === "eligible") {
      stillEligible.push(candidate);
    } else {
      io.stdout(`Skipped (became ineligible): ${candidate.worktree.path} — ${recheck.reason}\n`);
    }
  }

  if (stillEligible.length === 0) {
    io.stdout("No worktrees remain eligible after re-check.\n");
    return 0;
  }

  // Perform removals
  return performWorktreeRemovals(stillEligible, runner, io);
}

/**
 * Retire eligible worktrees via `git worktree remove` + `prune` + `git branch -D`.
 * Exit nonzero if any removal fails, leaving other candidates intact.
 */
export async function performWorktreeRemovals(
  candidates: CleanupCandidate[],
  runner: AsyncSubprocessRunner,
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
): Promise<number> {
  let failed = false;

  for (const candidate of candidates) {
    const worktree = candidate.worktree;
    try {
      // Remove worktree via git (cwd doesn't matter for absolute paths)
      await runner.runAsync("git", ["worktree", "remove", worktree.path], ".");

      // Prune to clean up stale registrations
      await runner.runAsync("git", ["worktree", "prune"], ".");

      // Delete local branch
      try {
        await runner.runAsync("git", ["branch", "-D", worktree.branch], ".");
      } catch (err) {
        // Branch delete may fail if already deleted; log but don't fail the whole operation
        io.stdout(
          `Warning: could not delete local branch ${worktree.branch}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }

      io.stdout(`Retired: ${worktree.path}\n`);
    } catch (err) {
      failed = true;
      io.stderr(`Failed to retire ${worktree.path}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  return failed ? 1 : 0;
}
