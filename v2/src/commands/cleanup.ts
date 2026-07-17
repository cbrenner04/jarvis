import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { jarvisHome } from "../paths.ts";

export type CleanupIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  readlineSync: (prompt: string) => string;
};

export type CleanupCandidate = {
  projectName: string;
  branchName: string;
  worktreePath: string;
};

export type CleanupCommandOptions = {
  io: CleanupIo;
  dryRun?: boolean;
  jarvisRoot?: string;
  projectRegistry: Record<string, { root: string; origin?: string }>;
  runner?: AsyncSubprocessRunner;
  isMergedPr?: (branch: string, projectRoot: string) => Promise<boolean>;
  getNonTerminalRuns?: (projectName: string, branchName: string) => { id: string; status: string }[];
  isDaemonRunLive?: (worktreePath: string) => boolean;
};

export async function cleanupCommand(opts: CleanupCommandOptions): Promise<number> {
  const jarvisRoot = opts.jarvisRoot ?? jarvisHome();
  const runner = opts.runner ?? realAsyncSubprocessRunner;
  const isMergedPrFn = opts.isMergedPr ?? defaultIsMergedPr;
  const getNonTerminalRunsFn = opts.getNonTerminalRuns ?? (() => []);
  const isDaemonRunLiveFn = opts.isDaemonRunLive ?? (() => false);

  const candidates = discoverMergedWorkspaces(jarvisRoot, opts.projectRegistry);
  const eligible = await filterEligibleCandidates(
    candidates,
    opts.projectRegistry,
    isMergedPrFn,
    getNonTerminalRunsFn,
    isDaemonRunLiveFn,
  );

  if (eligible.length === 0) {
    opts.io.stdout("no merged worktrees to remove\n");
    return 0;
  }

  opts.io.stdout("\nWorktrees to remove:\n");
  for (const candidate of eligible) {
    opts.io.stdout(`  ${candidate.projectName}/${candidate.branchName}\n`);
  }

  if (opts.dryRun) {
    return 0;
  }

  const response = opts.io.readlineSync("\nRemove these worktrees? [y/N] ");
  if (!["y", "yes"].includes(response.toLowerCase())) {
    opts.io.stdout("cancelled\n");
    return 0;
  }

  const hadFailures = await removeWorktrees(
    eligible,
    opts.projectRegistry,
    runner,
    isMergedPrFn,
    getNonTerminalRunsFn,
    isDaemonRunLiveFn,
    opts.io,
  );

  return hadFailures ? 1 : 0;
}

async function filterEligibleCandidates(
  candidates: CleanupCandidate[],
  projectRegistry: Record<string, { root: string }>,
  isMergedPrFn: (branch: string, projectRoot: string) => Promise<boolean>,
  getNonTerminalRunsFn: (project: string, branch: string) => { id: string; status: string }[],
  isDaemonRunLiveFn: (path: string) => boolean,
): Promise<CleanupCandidate[]> {
  const eligible: CleanupCandidate[] = [];

  for (const candidate of candidates) {
    const projectRoot = projectRegistry[candidate.projectName]?.root;
    if (!projectRoot) {
      continue;
    }

    const isMerged = await isMergedPrFn(candidate.branchName, projectRoot);
    if (!isMerged) {
      continue;
    }

    const nonTerminalRuns = getNonTerminalRunsFn(candidate.projectName, candidate.branchName);
    if (nonTerminalRuns.length > 0) {
      continue;
    }

    if (isDaemonRunLiveFn(candidate.worktreePath)) {
      continue;
    }

    eligible.push(candidate);
  }

  return eligible;
}

async function removeWorktrees(
  eligible: CleanupCandidate[],
  projectRegistry: Record<string, { root: string }>,
  runner: AsyncSubprocessRunner,
  isMergedPrFn: (branch: string, projectRoot: string) => Promise<boolean>,
  getNonTerminalRunsFn: (project: string, branch: string) => { id: string; status: string }[],
  isDaemonRunLiveFn: (path: string) => boolean,
  io: CleanupIo,
): Promise<boolean> {
  let hadFailures = false;
  for (const candidate of eligible) {
    const projectRoot = projectRegistry[candidate.projectName]?.root;
    if (!projectRoot) {
      io.stderr(`cannot remove ${candidate.projectName}/${candidate.branchName}: project root not found\n`);
      hadFailures = true;
      continue;
    }

    // Recheck eligibility after confirmation
    const isMerged = await isMergedPrFn(candidate.branchName, projectRoot);
    if (!isMerged) {
      io.stdout(`skipping ${candidate.projectName}/${candidate.branchName}: PR no longer merged\n`);
      continue;
    }

    const nonTerminalRuns = getNonTerminalRunsFn(candidate.projectName, candidate.branchName);
    if (nonTerminalRuns.length > 0) {
      io.stdout(`skipping ${candidate.projectName}/${candidate.branchName}: durable run now exists\n`);
      continue;
    }

    if (isDaemonRunLiveFn(candidate.worktreePath)) {
      io.stdout(`skipping ${candidate.projectName}/${candidate.branchName}: daemon run now live\n`);
      continue;
    }

    try {
      await runner.runAsync("git", ["worktree", "remove", candidate.worktreePath], projectRoot);
      await runner.runAsync("git", ["worktree", "prune"], projectRoot);
      await runner.runAsync("git", ["branch", "-D", candidate.branchName], projectRoot);
      io.stdout(`removed ${candidate.projectName}/${candidate.branchName}\n`);
    } catch (err) {
      io.stderr(`failed to remove ${candidate.projectName}/${candidate.branchName}: ${(err as Error).message}\n`);
      hadFailures = true;
    }
  }
  return hadFailures;
}

function discoverMergedWorkspaces(
  jarvisRoot: string,
  projectRegistry: Record<string, { root: string }>,
): CleanupCandidate[] {
  const worktreesHome = join(jarvisRoot, "worktrees");
  if (!existsSync(worktreesHome)) {
    return [];
  }

  const candidates: CleanupCandidate[] = [];

  for (const projectName of Object.keys(projectRegistry)) {
    const projectWorktreesDir = join(worktreesHome, projectName);
    if (!existsSync(projectWorktreesDir)) {
      continue;
    }

    discoverBranchesRecursive(projectWorktreesDir, projectName, "", candidates);
  }

  return candidates;
}

function discoverBranchesRecursive(
  dir: string,
  projectName: string,
  branchPrefix: string,
  candidates: CleanupCandidate[],
): void {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const branchName = branchPrefix ? `${branchPrefix}/${entry}` : entry;

      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory()) {
          continue;
        }
        const hasGitDir = existsSync(join(fullPath, ".git"));
        const isEmptyDir = readdirSync(fullPath).length === 0;

        if (hasGitDir || isEmptyDir) {
          candidates.push({ projectName, branchName, worktreePath: fullPath });
        } else {
          // Non-empty directory without .git, recurse
          discoverBranchesRecursive(fullPath, projectName, branchName, candidates);
        }
      } catch {
        // Skip if can't read this path
      }
    }
  } catch {
    // Skip if can't read directory
  }
}

async function defaultIsMergedPr(branch: string, projectRoot: string): Promise<boolean> {
  try {
    const output = await realAsyncSubprocessRunner.runAsync(
      "gh",
      ["pr", "view", branch, "--json", "state", "-q", ".state"],
      projectRoot,
      { stdio: "pipe" },
    );
    return output.trim() === "MERGED";
  } catch {
    return false;
  }
}
