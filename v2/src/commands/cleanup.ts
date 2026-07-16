import { join, relative } from "node:path";
import type { ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { jarvisHome } from "../paths.ts";
import { openStateStore, type Run } from "../persistence/state-store.ts";

export type CleanupCandidate = { project: string; root: string; path: string; branch: string };

type Worktree = { path: string; branch?: string };

export type CleanupDeps = {
  runner: AsyncSubprocessRunner;
  listLiveRuns: () => Promise<DaemonListRunRow[]>;
  listDurableRuns: () => Run[];
  jarvisRoot: string;
};

export type CleanupResult = { candidates: CleanupCandidate[]; removed: CleanupCandidate[]; failures: string[] };

const TERMINAL = new Set(["completed", "blocked", "failed", "killed"]);

function parseWorktrees(output: string): Worktree[] {
  const entries: Worktree[] = [];
  let current: Worktree | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("branch refs/heads/") && current) {
      current.branch = line.slice("branch refs/heads/".length);
    }
  }
  if (current) entries.push(current);
  return entries;
}

function isInside(path: string, home: string): boolean {
  const rel = relative(home, path);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith("../");
}

async function hasMergedPr(candidate: CleanupCandidate, runner: AsyncSubprocessRunner): Promise<boolean> {
  try {
    return (
      (
        await runner.runAsync(
          "gh",
          ["pr", "view", "--head", candidate.branch, "--json", "state", "-q", ".state"],
          candidate.root,
        )
      ).trim() === "MERGED"
    );
  } catch {
    return false;
  }
}

function isOwned(candidate: CleanupCandidate, durable: Run[], live: DaemonListRunRow[]): boolean {
  return (
    durable.some(
      (run) => run.project === candidate.project && run.worktreePath === candidate.path && !TERMINAL.has(run.status),
    ) || live.some((run) => run.project === candidate.project && run.branch === candidate.branch && run.isLive)
  );
}

async function eligible(
  candidate: CleanupCandidate,
  deps: CleanupDeps,
  durable: Run[],
  live: DaemonListRunRow[],
): Promise<boolean> {
  if (isOwned(candidate, durable, live)) return false;
  return hasMergedPr(candidate, deps.runner);
}

/** Discover only registered-project linked worktrees, including branches containing slashes. */
export async function discoverCleanupCandidates(
  projects: Record<string, ProjectRegistryEntry>,
  deps: CleanupDeps,
): Promise<CleanupCandidate[]> {
  const durable = deps.listDurableRuns();
  const live = await deps.listLiveRuns();
  const found: CleanupCandidate[] = [];
  for (const [project, entry] of Object.entries(projects)) {
    let worktrees: Worktree[];
    try {
      worktrees = parseWorktrees(await deps.runner.runAsync("git", ["worktree", "list", "--porcelain"], entry.root));
    } catch {
      continue;
    }
    const home = join(deps.jarvisRoot, "worktrees", project);
    for (const worktree of worktrees) {
      if (worktree.branch === undefined || !isInside(worktree.path, home)) continue;
      const candidate = { project, root: entry.root, path: worktree.path, branch: worktree.branch };
      if (await eligible(candidate, deps, durable, live)) found.push(candidate);
    }
  }
  return found;
}

/** Rechecks all fail-closed guards, then removes only local worktree/branch state. */
export async function cleanupMergedWorkspaces(
  projects: Record<string, ProjectRegistryEntry>,
  deps: CleanupDeps,
  dryRun: boolean,
): Promise<CleanupResult> {
  const candidates = await discoverCleanupCandidates(projects, deps);
  if (dryRun) return { candidates, removed: [], failures: [] };
  const removed: CleanupCandidate[] = [];
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const live = await deps.listLiveRuns();
      const durable = deps.listDurableRuns();
      if (!(await eligible(candidate, deps, durable, live))) continue;
      await deps.runner.runAsync("git", ["worktree", "remove", "--force", candidate.path], candidate.root);
      await deps.runner.runAsync("git", ["branch", "-D", candidate.branch], candidate.root);
      removed.push(candidate);
    } catch (error) {
      failures.push(`${candidate.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { candidates, removed, failures };
}

export function defaultCleanupDeps(listLiveRuns: () => Promise<DaemonListRunRow[]>): CleanupDeps {
  const store = openStateStore();
  return {
    runner: realAsyncSubprocessRunner,
    listLiveRuns,
    listDurableRuns: () => store.listRuns(),
    jarvisRoot: jarvisHome(),
  };
}
