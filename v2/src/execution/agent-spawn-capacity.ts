import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { DaemonClient } from "../commands/cleanup.ts";
import { retireEligibleWorktreesNonInteractive } from "../commands/cleanup.ts";
import { jarvisHome } from "../paths.ts";
import type { StateStore } from "../persistence/state-store.ts";

export type CapacityWarning = {
  kind: "warning";
  message: string;
  count: number;
};

export type CapacityRefusal = {
  kind: "refusal";
  message: string;
  count: number | null;
};

export type CapacityCheckResult = { kind: "ok" } | CapacityWarning | CapacityRefusal;

export type CapacityGuardConfig = {
  warnThreshold: number;
  refuseThreshold: number;
};

/** Git common dir for a project root (used to dedup registry aliases of the same repo). */
async function getGitCommonDir(projectRoot: string, runner: AsyncSubprocessRunner): Promise<string | null> {
  try {
    const commonDir = await runner.runAsync("git", ["rev-parse", "--git-common-dir"], projectRoot);
    return commonDir.trim();
  } catch {
    return null;
  }
}

async function pruneStaleWorktrees(projectRoot: string, runner: AsyncSubprocessRunner): Promise<void> {
  try {
    await runner.runAsync("git", ["worktree", "prune"], projectRoot);
  } catch {
    // Prune may fail but shouldn't block; continue gracefully
  }
}

async function listProjectWorktrees(projectRoot: string, runner: AsyncSubprocessRunner): Promise<string[]> {
  try {
    const output = await runner.runAsync("git", ["worktree", "list", "--porcelain"], projectRoot);
    const paths: string[] = [];
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        const path = line.slice("worktree ".length).trim();
        if (path.length > 0) {
          paths.push(path);
        }
      }
    }
    return paths;
  } catch {
    return [];
  }
}

/**
 * Count deduplicated worktree registrations across all projects in the registry.
 * Deduplicates by Git common directory to avoid double-charging when registry
 * aliases point to the same underlying repository.
 *
 * Returns the total count of unique registrations across all projects.
 */
export async function countDedupWorktrees(
  registry: Record<string, ProjectRegistryEntry>,
  runner: AsyncSubprocessRunner,
): Promise<number | null> {
  const seen = new Set<string>();

  for (const projectEntry of Object.values(registry)) {
    const projectRoot = projectEntry.root;
    const commonDir = await getGitCommonDir(projectRoot, runner);
    if (commonDir === null) {
      // Cannot determine if repos are duplicates; fail closed
      return null;
    }

    const worktrees = await listProjectWorktrees(projectRoot, runner);
    for (const worktree of worktrees) {
      // Combine common dir + worktree path to create a unique key
      const key = `${commonDir}:${worktree}`;
      seen.add(key);
    }
  }

  return seen.size;
}

/**
 * Check capacity and decide whether to warn, refuse, or proceed.
 * - If count is null (cannot be established), refuse (fail closed).
 * - If count < warnThreshold, return ok.
 * - If warnThreshold <= count < refuseThreshold, warn.
 * - If count >= refuseThreshold, refuse.
 */
export function classifyCapacityTier(count: number | null, config: CapacityGuardConfig): CapacityCheckResult {
  if (count === null) {
    return {
      kind: "refusal",
      message:
        "Cannot establish worktree capacity state safely (prune, enumeration, or eligibility check failed). " +
        "Run `jarvis cleanup` to remove eligible worktrees and retry, or investigate worktree state.",
      count: null,
    };
  }

  if (count >= config.refuseThreshold) {
    return {
      kind: "refusal",
      message:
        `Worktree capacity at ${count} registrations (refuse threshold: ${config.refuseThreshold}). ` +
        `The sandbox will fail with E2BIG on agent commands. Run \`jarvis cleanup\` to remove eligible worktrees.`,
      count,
    };
  }

  if (count >= config.warnThreshold) {
    return {
      kind: "warning",
      message:
        `Worktree capacity at ${count} registrations (warn threshold: ${config.warnThreshold}, ` +
        `refuse at ${config.refuseThreshold}). Consider running \`jarvis cleanup\` to prevent E2BIG failures.`,
      count,
    };
  }

  return { kind: "ok" };
}

/**
 * Guard callback: prune stale registrations, retire eligible worktrees,
 * count deduplicated registrations, classify tier, and return the result.
 *
 * This is the main entry point for the capacity guard, called before each
 * production v2 agent subprocess.
 */
export async function checkAgentSpawnCapacity(args: {
  registry: Record<string, ProjectRegistryEntry>;
  runner: AsyncSubprocessRunner;
  daemonClient: DaemonClient;
  store: StateStore;
  config: CapacityGuardConfig;
}): Promise<CapacityCheckResult> {
  // 1. Prune stale registrations in each project
  for (const projectEntry of Object.values(args.registry)) {
    await pruneStaleWorktrees(projectEntry.root, args.runner);
  }

  // 2. Retire cleanup-eligible worktrees through the 00 seam
  try {
    await retireEligibleWorktreesNonInteractive(
      args.registry,
      jarvisHome(),
      args.runner,
      args.daemonClient,
      args.store,
    );
  } catch {
    // Retirement failure doesn't prevent counting; continue
  }

  // 3. Count deduplicated registrations
  const count = await countDedupWorktrees(args.registry, args.runner);

  // 4. Classify tier and return result
  return classifyCapacityTier(count, args.config);
}

/**
 * Create a PreSpawnGuard instance that can be injected into executeWithQuotaFallback.
 * Returns null if the guard should not be used (e.g., for test bindings).
 */
export function createPreSpawnGuard(args: {
  registry: Record<string, ProjectRegistryEntry>;
  runner: AsyncSubprocessRunner;
  daemonClient: DaemonClient;
  store: StateStore;
  config: CapacityGuardConfig;
}): import("../../../shared/invocation/execute.ts").PreSpawnGuard {
  return {
    check: async () => {
      const result = await checkAgentSpawnCapacity(args);
      if (result.kind === "ok") {
        return { kind: "ok" };
      }
      if (result.kind === "warning") {
        return { kind: "warning", message: result.message };
      }
      return { kind: "refusal", message: result.message };
    },
  };
}
