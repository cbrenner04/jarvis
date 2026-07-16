import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DaemonListRunRow } from "../daemon/daemon-wire.ts";
import { jarvisHome } from "../paths.ts";

export type CleanupIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  readlineSync: (prompt: string) => string | Promise<string>;
};

export type CleanupOptions = {
  io: CleanupIo;
  dryRun?: boolean;
  projectRegistry: Record<string, { root: string; origin?: string }>;
  isMergedPr?: (branch: string, projectRoot?: string) => boolean;
  listRunsFromDaemon?: () => Promise<DaemonListRunRow[]>;
};

type WorktreeCandidate = {
  projectKey: string;
  projectRoot: string;
  branchName: string;
  worktreePath: string;
};

type WorktreeCheckResult = {
  candidate: WorktreeCandidate;
  eligible: boolean;
  reason?: string;
};

function isMergedPr(branch: string, projectRoot?: string): boolean {
  try {
    const output = execFileSync("gh", ["pr", "view", branch, "--json", "state", "-q", ".state"], {
      encoding: "utf8",
      stdio: "pipe",
      cwd: projectRoot,
    });
    return output.trim() === "MERGED";
  } catch {
    return false;
  }
}

function _getCurrentBranch(worktreePath: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: "pipe",
      cwd: worktreePath,
    }).trim();
  } catch {
    return null;
  }
}

function discoverWorktreeCandidates(projectRegistry: Record<string, { root: string }>): WorktreeCandidate[] {
  const jarvisRoot = jarvisHome();
  const worktreesRoot = join(jarvisRoot, "worktrees");

  if (!existsSync(worktreesRoot)) {
    return [];
  }

  const candidates: WorktreeCandidate[] = [];

  for (const projectKey of Object.keys(projectRegistry)) {
    const projectWorktreesPath = join(worktreesRoot, projectKey);
    if (!existsSync(projectWorktreesPath)) {
      continue;
    }

    const projectRoot = projectRegistry[projectKey]!.root;
    const discoverBranches = (dirPath: string, parentPath: string = ""): void => {
      if (!existsSync(dirPath)) return;
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".keep" || entry.name.startsWith(".")) {
          continue;
        }
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          const branchName = parentPath ? `${parentPath}/${entry.name}` : entry.name;
          const worktreePath = fullPath;
          if (existsSync(join(worktreePath, ".git"))) {
            candidates.push({
              projectKey,
              projectRoot,
              branchName,
              worktreePath,
            });
          } else {
            discoverBranches(fullPath, branchName);
          }
        }
      }
    };

    discoverBranches(projectWorktreesPath);
  }

  return candidates;
}

async function checkWorktreeEligibility(
  candidate: WorktreeCandidate,
  opts: {
    isMergedPr?: (branch: string, projectRoot?: string) => boolean;
    listRunsFromDaemon?: () => Promise<DaemonListRunRow[]>;
  },
): Promise<WorktreeCheckResult> {
  const checkMerged = opts.isMergedPr ?? isMergedPr;

  if (!checkMerged(candidate.branchName, candidate.projectRoot)) {
    return {
      candidate,
      eligible: false,
      reason: "PR not merged",
    };
  }

  if (opts.listRunsFromDaemon) {
    try {
      const runs = await opts.listRunsFromDaemon();
      const nonTerminalRuns = runs.filter((run) => {
        if (run.status === "completed" || run.status === "blocked" || run.status === "failed") {
          return false;
        }
        return run.worktreePath === candidate.worktreePath || run.branch === candidate.branchName;
      });

      if (nonTerminalRuns.length > 0) {
        return {
          candidate,
          eligible: false,
          reason: "referenced by non-terminal durable run",
        };
      }

      const liveRuns = runs.filter(
        (run) => run.isLive && (run.worktreePath === candidate.worktreePath || run.branch === candidate.branchName),
      );
      if (liveRuns.length > 0) {
        return {
          candidate,
          eligible: false,
          reason: "daemon reports live run",
        };
      }
    } catch {
      return {
        candidate,
        eligible: false,
        reason: "failed to inspect daemon state",
      };
    }
  }

  return { candidate, eligible: true };
}

function deleteLocalBranch(projectRoot: string, branchName: string): void {
  try {
    execFileSync("git", ["branch", "-d", branchName], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    execFileSync("git", ["branch", "-D", branchName], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  }
}

function removeWorktree(worktreePath: string): void {
  rmSync(worktreePath, { recursive: true, force: true });
}

export async function cleanupCommand(opts: CleanupOptions): Promise<number> {
  const candidates = discoverWorktreeCandidates(opts.projectRegistry);

  if (candidates.length === 0) {
    opts.io.stdout("no merged worktrees to remove\n");
    return 0;
  }

  const results = await Promise.all(
    candidates.map((candidate) =>
      checkWorktreeEligibility(candidate, {
        ...(opts.isMergedPr !== undefined ? { isMergedPr: opts.isMergedPr } : {}),
        ...(opts.listRunsFromDaemon !== undefined ? { listRunsFromDaemon: opts.listRunsFromDaemon } : {}),
      }),
    ),
  );

  const eligible = results.filter((r) => r.eligible);

  if (eligible.length === 0) {
    opts.io.stdout("no merged worktrees to remove\n");
    return 0;
  }

  opts.io.stdout("\nWorktrees to remove:\n");
  for (const result of eligible) {
    opts.io.stdout(`  ${result.candidate.branchName} (${result.candidate.projectKey})\n`);
  }

  if (opts.dryRun) {
    return 0;
  }

  const responseOrPromise = opts.io.readlineSync("\nRemove these worktrees? [y/N] ");
  const response = responseOrPromise instanceof Promise ? await responseOrPromise : responseOrPromise;
  if (!["y", "yes"].includes(response.toLowerCase())) {
    opts.io.stdout("cancelled\n");
    return 0;
  }

  let hadFailures = false;

  for (const result of eligible) {
    try {
      const c = result.candidate;
      const recheck = await checkWorktreeEligibility(c, {
        ...(opts.isMergedPr !== undefined ? { isMergedPr: opts.isMergedPr } : {}),
        ...(opts.listRunsFromDaemon !== undefined ? { listRunsFromDaemon: opts.listRunsFromDaemon } : {}),
      });

      if (!recheck.eligible) {
        opts.io.stdout(`skipping ${c.branchName}: ${recheck.reason}\n`);
        continue;
      }

      removeWorktree(c.worktreePath);
      deleteLocalBranch(c.projectRoot, c.branchName);
      opts.io.stdout(`removed ${c.branchName}\n`);
    } catch (err) {
      opts.io.stderr(`failed to remove ${result.candidate.branchName}: ${(err as Error).message}\n`);
      hadFailures = true;
    }
  }

  return hadFailures ? 1 : 0;
}
