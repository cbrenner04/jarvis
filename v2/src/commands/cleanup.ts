import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import type { IpcClient } from "../ipc/client.ts";
import { jarvisHome } from "../paths.ts";

export type CleanupDeps = {
  jarvisRoot?: string;
  subprocessRunner?: AsyncSubprocessRunner;
  readProjectRegistry: () => Record<string, { root: string; origin?: string }>;
  isDryRun: boolean;
  daemonRuns?: DaemonListRunRow[] | null;
  prompt?: (question: string) => Promise<boolean>;
};

export type CleanupCandidate = {
  projectName: string;
  projectRoot: string;
  branchName: string;
  worktreePath: string;
};

export type WorktreeCandidate = CleanupCandidate & {
  isMerged: boolean | null;
  nonTerminalRunExists: boolean;
  daemonRunLive: boolean;
  eligible: boolean;
  eligibilityReason: string | undefined;
};

async function discoverWorktrees(
  projectRegistry: Record<string, { root: string; origin?: string }>,
  jarvisRoot: string,
): Promise<CleanupCandidate[]> {
  const candidates: CleanupCandidate[] = [];
  const worktreesHome = join(jarvisRoot, "worktrees");

  if (!existsSync(worktreesHome)) {
    return candidates;
  }

  let projects: string[];
  try {
    projects = readdirSync(worktreesHome);
  } catch {
    return candidates;
  }

  for (const projectName of projects) {
    const projectPath = join(worktreesHome, projectName);
    const projectConfig = projectRegistry[projectName];
    if (!projectConfig) continue;

    if (!isDir(projectPath)) continue;

    findWorktreesRecursive(projectPath, projectPath, projectName, projectConfig.root, candidates);
  }

  return candidates;
}

function findWorktreesRecursive(
  currentPath: string,
  projectWorktreeHome: string,
  projectName: string,
  projectRoot: string,
  candidates: CleanupCandidate[],
): void {
  if (!isDir(currentPath)) return;

  let entries: string[];
  try {
    entries = readdirSync(currentPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(currentPath, entry);

    if (!isDir(entryPath)) continue;

    // Check if this directory is a real worktree
    if (isRealWorktree(entryPath)) {
      // Calculate the relative path from projectWorktreeHome to get the branch name
      const branchName = entryPath.slice(projectWorktreeHome.length + 1); // +1 for the separator
      candidates.push({
        projectName,
        projectRoot,
        branchName,
        worktreePath: entryPath,
      });
    } else {
      // Recursively search in subdirectories
      findWorktreesRecursive(entryPath, projectWorktreeHome, projectName, projectRoot, candidates);
    }
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isRealWorktree(path: string): boolean {
  const gitDir = join(path, ".git");
  return existsSync(gitDir);
}

async function checkIsMergedPr(
  subprocess: AsyncSubprocessRunner,
  projectRoot: string,
  branchName: string,
): Promise<boolean | null> {
  try {
    const output = await subprocess.runAsync(
      "gh",
      ["pr", "list", "--head", branchName, "--json", "state"],
      projectRoot,
    );
    const parsed = JSON.parse(output.trim());

    if (!Array.isArray(parsed)) {
      return null;
    }

    if (parsed.length === 0) {
      return null;
    }

    return parsed[0].state === "MERGED";
  } catch {
    return null;
  }
}

export async function queryDaemonForRuns(
  daemonClient: IpcClient | null,
  request: (client: IpcClient, method: string) => Promise<unknown>,
): Promise<DaemonListRunRow[] | null> {
  if (!daemonClient) return null;

  try {
    const result = await request(daemonClient, "list");
    if (typeof result === "object" && result !== null && "runs" in result) {
      const runs = (result as Record<string, unknown>).runs;
      return Array.isArray(runs) ? runs : null;
    }
    return null;
  } catch {
    return null;
  }
}

function hasNonTerminalRun(runs: DaemonListRunRow[], worktreePath: string): boolean {
  return runs.some(
    (run) =>
      run.worktreePath === worktreePath &&
      run.status !== "completed" &&
      run.status !== "blocked" &&
      run.status !== "failed",
  );
}

function hasDaemonLiveRun(runs: DaemonListRunRow[], worktreePath: string): boolean {
  return runs.some((run) => run.worktreePath === worktreePath && run.isLive);
}

async function checkWorktreeEligibility(
  candidate: CleanupCandidate,
  subprocess: AsyncSubprocessRunner,
  daemonRuns: DaemonListRunRow[] | null,
): Promise<WorktreeCandidate> {
  const isMerged = await checkIsMergedPr(subprocess, candidate.projectRoot, candidate.branchName);
  const nonTerminalRun = daemonRuns ? hasNonTerminalRun(daemonRuns, candidate.worktreePath) : false;
  const daemonLive = daemonRuns ? hasDaemonLiveRun(daemonRuns, candidate.worktreePath) : false;

  let eligible = true;
  let eligibilityReason: string | undefined;

  if (isMerged === null) {
    eligible = false;
    eligibilityReason = "PR state inspection unavailable";
  } else if (!isMerged) {
    eligible = false;
    eligibilityReason = "PR not merged";
  }

  if (nonTerminalRun) {
    eligible = false;
    eligibilityReason = "Non-terminal durable run references worktree";
  }

  if (daemonLive) {
    eligible = false;
    eligibilityReason = "Daemon reports run live";
  }

  return {
    ...candidate,
    isMerged,
    nonTerminalRunExists: nonTerminalRun,
    daemonRunLive: daemonLive,
    eligible,
    eligibilityReason,
  };
}

async function removeWorktree(
  subprocess: AsyncSubprocessRunner,
  candidate: CleanupCandidate,
): Promise<{ success: boolean; error?: string }> {
  try {
    await subprocess.runAsync("git", ["worktree", "remove", candidate.worktreePath], candidate.projectRoot);
    await subprocess.runAsync("git", ["worktree", "prune"], candidate.projectRoot);

    try {
      await subprocess.runAsync("git", ["branch", "-D", candidate.branchName], candidate.projectRoot);
    } catch {
      return { success: false, error: "Failed to delete local branch after worktree removal" };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Failed to remove worktree: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function cleanup(
  io: { stdout: (s: string) => void; stderr: (s: string) => void },
  deps: CleanupDeps,
): Promise<number> {
  const jarvisRoot = deps.jarvisRoot ?? jarvisHome();
  const subprocess = deps.subprocessRunner ?? realAsyncSubprocessRunner;
  const projectRegistry = deps.readProjectRegistry();

  const candidates = await discoverWorktrees(projectRegistry, jarvisRoot);

  if (candidates.length === 0) {
    if (!deps.isDryRun) {
      io.stdout("No merged worktrees to retire.\n");
    }
    return 0;
  }

  const daemonRuns = deps.daemonRuns ?? null;

  const checked: WorktreeCandidate[] = [];
  for (const candidate of candidates) {
    const checked_candidate = await checkWorktreeEligibility(candidate, subprocess, daemonRuns);
    checked.push(checked_candidate);
  }

  const eligible = checked.filter((c) => c.eligible);

  if (deps.isDryRun) {
    io.stdout(`Discovered ${candidates.length} worktree(s):\n`);
    for (const candidate of checked) {
      const status = candidate.eligible ? "eligible" : `ineligible (${candidate.eligibilityReason})`;
      io.stdout(`  ${candidate.projectName}/${candidate.branchName}: ${status}\n`);
    }
    return 0;
  }

  if (eligible.length === 0) {
    io.stdout("No eligible worktrees to retire.\n");
    return 0;
  }

  io.stdout(`Found ${eligible.length} eligible worktree(s) for retirement:\n`);
  for (const candidate of eligible) {
    io.stdout(`  ${candidate.projectName}/${candidate.branchName}\n`);
  }

  const shouldContinue = deps.prompt ? await deps.prompt("Continue? [y/N] ") : true;

  if (!shouldContinue) {
    io.stdout("Cancelled.\n");
    return 0;
  }

  let failureCount = 0;
  for (const candidate of eligible) {
    const result = await removeWorktree(subprocess, candidate);
    if (!result.success) {
      io.stderr(`Failed to remove ${candidate.projectName}/${candidate.branchName}: ${result.error}\n`);
      failureCount++;
    } else {
      io.stdout(`Retired ${candidate.projectName}/${candidate.branchName}\n`);
    }
  }

  return failureCount > 0 ? 1 : 0;
}
