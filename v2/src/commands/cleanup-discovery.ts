import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { jarvisHome } from "../paths.ts";

export type WorktreeCandidate = {
  path: string;
  branch: string;
  project: string;
};

/**
 * Discover materialized git worktrees under ~/.jarvis/worktrees/<project>/,
 * including slash-nested branch paths (plan/foo, intent/bar).
 * Returns only valid git worktrees, excluding empty directories and non-git debris.
 */
export async function discoverMaterializedWorktrees(
  registry: Record<string, ProjectRegistryEntry>,
  jarvisRoot: string = jarvisHome(),
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<WorktreeCandidate[]> {
  const candidates: WorktreeCandidate[] = [];
  const worktreesRoot = join(jarvisRoot, "worktrees");

  if (!existsSync(worktreesRoot)) {
    return candidates;
  }

  for (const projectName of Object.keys(registry)) {
    const projectPath = join(worktreesRoot, projectName);
    if (!existsSync(projectPath)) {
      continue;
    }

    const candidate = await discoverWorktreesForProject(projectPath, projectName, runner);
    candidates.push(...candidate);
  }

  return candidates;
}

async function discoverWorktreesForProject(
  projectPath: string,
  projectName: string,
  runner: AsyncSubprocessRunner,
): Promise<WorktreeCandidate[]> {
  const candidates: WorktreeCandidate[] = [];

  // Walk the directory tree, handling nested branch paths like plan/foo, intent/bar
  const walk = async (currentPath: string, branchPath: string): Promise<void> => {
    if (!existsSync(currentPath)) {
      return;
    }

    // Check if current path is a git worktree
    if (await isValidGitWorktree(currentPath, runner)) {
      const branch = await getCurrentBranch(currentPath, runner);
      candidates.push({
        path: currentPath,
        branch,
        project: projectName,
      });
      return; // Don't descend into worktrees
    }

    // If not a worktree, try to descend into subdirectories
    try {
      const entries = readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const subPath = join(currentPath, entry.name);
          const subBranchPath = branchPath ? `${branchPath}/${entry.name}` : entry.name;
          await walk(subPath, subBranchPath);
        }
      }
    } catch {
      // Ignore errors reading directories (permission denied, etc.)
    }
  };

  await walk(projectPath, "");
  return candidates;
}

async function isValidGitWorktree(worktreePath: string, runner: AsyncSubprocessRunner): Promise<boolean> {
  try {
    const result = await runner.runAsync("git", ["rev-parse", "--is-inside-work-tree"], worktreePath, {
      stdio: "ignore",
    });
    return result.trim() === "true";
  } catch {
    return false;
  }
}

async function getCurrentBranch(worktreePath: string, runner: AsyncSubprocessRunner): Promise<string> {
  try {
    return (await runner.runAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], worktreePath)).trim();
  } catch {
    return "unknown";
  }
}
