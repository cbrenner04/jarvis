import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { StateStore } from "../persistence/state-store.ts";
import type { WorktreeCandidate } from "./cleanup-discovery.ts";

export type DaemonListRunsClient = (project: string, branch: string) => Promise<DaemonListRunRow[]>;

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string };

/**
 * Determine if a discovered worktree is safe to retire:
 * - PR must be merged
 * - No non-terminal durable runs may reference it
 * - No daemon-reported live runs may reference it
 *
 * Fails closed: if subprocess errors, daemon client throws, or store is unreadable,
 * the candidate is ineligible.
 */
export async function checkEligibilityGate(
  candidate: WorktreeCandidate,
  storePromise: Promise<StateStore>,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
  daemonClient: DaemonListRunsClient = async () => [],
): Promise<EligibilityResult> {
  try {
    // Check if PR is merged
    const mergedResult = await runner.runAsync(
      "gh",
      ["pr", "list", "--head", candidate.branch, "--state", "merged", "--json", "state"],
      process.cwd(),
    );

    const prs = JSON.parse(mergedResult) as Array<{ state?: string }>;
    if (!prs.length || prs[0]?.state !== "MERGED") {
      return { eligible: false, reason: `PR not merged for branch ${candidate.branch}` };
    }

    // Extract project from worktree path: ~/.jarvis/worktrees/<project>/...
    const pathSegments = candidate.path.split("/");
    const worktreesIdx = pathSegments.indexOf("worktrees");
    const projectSegment =
      worktreesIdx >= 0 && worktreesIdx + 1 < pathSegments.length ? pathSegments[worktreesIdx + 1] : undefined;
    const project = projectSegment ?? "unknown";

    // Check durable run store for non-terminal runs
    const store = await storePromise;
    const durableRun = store.findRunByProjectBranch({
      project,
      branch: candidate.branch,
    });

    if (durableRun && !isBoundaryTerminal(durableRun.status)) {
      return { eligible: false, reason: `Non-terminal durable run ${durableRun.id} references ${candidate.branch}` };
    }

    // Check daemon for live runs
    const daemonRuns = await daemonClient(project, candidate.branch);
    const liveRun = daemonRuns.find((run) => run.isLive);

    if (liveRun) {
      return { eligible: false, reason: `Daemon-reported live run references ${candidate.branch}` };
    }

    return { eligible: true };
  } catch (error) {
    return {
      eligible: false,
      reason: `Failed to check eligibility: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function isBoundaryTerminal(status: string): boolean {
  return status === "completed" || status === "blocked" || status === "failed";
}
