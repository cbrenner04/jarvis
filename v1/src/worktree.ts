import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { branchExistsLocal, branchExistsOnOrigin, getCurrentBranch } from "../../shared/git.ts";
import { getBaseBranch } from "./gh.ts";

export function getSpecName(specPath: string): string {
  const resolvedPath = resolve(specPath);
  const dir = dirname(resolvedPath);
  const basename = resolvedPath.split("/").at(-1);

  if (basename === "index.md") {
    return dir.split("/").at(-1) ?? "spec";
  }
  return dir.split("/").at(-1) ?? "spec";
}

export async function ensureWorktree(projectRoot: string, specPath: string): Promise<string> {
  const specName = getSpecName(specPath);
  const worktreePath = join(projectRoot, ".worktree", specName);

  // Resumed runs can be launched from the patch worktree itself. Reuse that
  // checkout instead of trying to create another worktree for the same branch.
  if (currentBranchMatches(projectRoot, specName)) {
    return projectRoot;
  }

  bestEffortFetch(projectRoot);

  const branchExists = branchExistsLocal(projectRoot, specName);
  const branchExistsRemote = branchExistsOnOrigin(projectRoot, specName);

  if (existsSync(worktreePath)) {
    return worktreePath;
  }

  if (branchExists || branchExistsRemote) {
    if (!branchExists && branchExistsRemote) {
      execFileSync("git", ["branch", specName, `origin/${specName}`], {
        cwd: projectRoot,
        stdio: "pipe",
      });
    }
    execFileSync("git", ["worktree", "add", "--checkout", worktreePath, specName], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } else {
    const baseBranch = await getBaseBranch(projectRoot);
    execFileSync("git", ["branch", specName, baseBranch], {
      cwd: projectRoot,
      stdio: "pipe",
    });
    execFileSync("git", ["worktree", "add", worktreePath, specName], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  }

  return worktreePath;
}

export interface CreatePlanWorktreeOptions {
  projectRoot: string;
  name: string;
  baseBranch?: string;
}

export async function createPlanWorktree(opts: CreatePlanWorktreeOptions): Promise<string> {
  const dirPrefix = "plan-";
  const branchPrefix = "plan/";
  const worktreePath = join(opts.projectRoot, ".worktree", dirPrefix + opts.name);
  const branchName = branchPrefix + opts.name;

  bestEffortFetch(opts.projectRoot);

  // Fail loudly if the plan worktree already exists
  if (existsSync(worktreePath)) {
    throw new Error(
      `plan worktree already exists at ${worktreePath}; resolve with \`jarvis1 cleanup\` or remove manually`,
    );
  }

  const branchExists = branchExistsLocal(opts.projectRoot, branchName);
  const branchExistsRemote = branchExistsOnOrigin(opts.projectRoot, branchName);

  if (branchExists || branchExistsRemote) {
    if (!branchExists && branchExistsRemote) {
      execFileSync("git", ["branch", branchName, `origin/${branchName}`], {
        cwd: opts.projectRoot,
        stdio: "pipe",
      });
    }
    execFileSync("git", ["worktree", "add", "--checkout", worktreePath, branchName], {
      cwd: opts.projectRoot,
      stdio: "pipe",
    });
  } else {
    const baseBranch = opts.baseBranch ?? (await getBaseBranch(opts.projectRoot));
    execFileSync("git", ["branch", branchName, baseBranch], {
      cwd: opts.projectRoot,
      stdio: "pipe",
    });
    execFileSync("git", ["worktree", "add", worktreePath, branchName], {
      cwd: opts.projectRoot,
      stdio: "pipe",
    });
  }

  return worktreePath;
}

export async function ensurePatchWorktreeForExistingBranch(
  projectRoot: string,
  worktreeName: string,
): Promise<{ path: string; source: "origin" | "local" }> {
  return ensureExistingBranchWorktree({
    projectRoot,
    worktreeName,
    branchName: worktreeName,
    missingBranchMessage: `no local or remote branch named ${worktreeName}; cannot create worktree`,
  });
}

export function ensureExistingBranchWorktree(opts: {
  projectRoot: string;
  worktreeName: string;
  branchName: string;
  missingBranchMessage: string;
}): { path: string; source: "origin" | "local" } {
  const worktreePath = join(opts.projectRoot, ".worktree", opts.worktreeName);

  bestEffortFetch(opts.projectRoot);

  const branchExists = branchExistsLocal(opts.projectRoot, opts.branchName);
  const branchExistsRemote = branchExistsOnOrigin(opts.projectRoot, opts.branchName);

  if (!branchExists && !branchExistsRemote) {
    throw new Error(opts.missingBranchMessage);
  }

  mkdirSync(join(opts.projectRoot, ".worktree"), { recursive: true });

  if (!branchExists && branchExistsRemote) {
    execFileSync("git", ["branch", opts.branchName, `origin/${opts.branchName}`], {
      cwd: opts.projectRoot,
      stdio: "pipe",
    });
  }

  execFileSync("git", ["worktree", "add", "--checkout", worktreePath, opts.branchName], {
    cwd: opts.projectRoot,
    stdio: "pipe",
  });

  return {
    path: worktreePath,
    source: branchExistsRemote ? "origin" : "local",
  };
}

function bestEffortFetch(projectRoot: string): void {
  try {
    execFileSync("git", ["fetch", "origin"], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    // fetch might fail if no origin or no network, but we continue anyway
  }
}

function currentBranchMatches(projectRoot: string, branchName: string): boolean {
  try {
    return getCurrentBranch(projectRoot) === branchName;
  } catch {
    return false;
  }
}

/**
 * When the agent cwd is a git checkout, spec completion requires a clean
 * working tree so checkbox checks cannot succeed while work (including seeded
 * spec files) remains untracked or uncommitted — otherwise the draft PR never
 * updates.
 *
 * Returns `undefined` if there is nothing to verify (no `.git`) or the tree is
 * clean. Otherwise returns a short, human-readable reason.
 *
 * Callers are expected to append a triage suggestion line such as:
 * `Run \`jarvis triage <worktree-name>\` to inspect state and see suggested next moves.\n`
 * The worktree name is typically `basename(agentWorkingDir)`.
 */
export function worktreeCompletionBlocker(cwd: string): string | undefined {
  if (!existsSync(join(cwd, ".git"))) {
    return undefined;
  }
  try {
    const porcelain = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      stdio: "pipe",
    }).trim();
    if (porcelain !== "") {
      return `the worktree is not clean (${porcelain.split("\n").length} path(s)); uncommitted or untracked changes:\n${porcelain}`;
    }
    return undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `could not run git status in worktree: ${message}`;
  }
}

export function pushCurrent(opts: { cwd: string; firstPush: boolean }): void {
  const args = opts.firstPush ? ["push", "-u", "origin", getCurrentBranch(opts.cwd)] : ["push"];
  try {
    execFileSync("git", args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: "pipe",
    });
  } catch (err) {
    const stderr = getProcessStderr(err);
    throw new Error(stderr.length > 0 ? stderr : String(err));
  }
}

export function hasUpstream(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
      cwd,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function getProcessStderr(err: unknown): string {
  if (
    typeof err === "object" &&
    err !== null &&
    "stderr" in err &&
    Buffer.isBuffer((err as { stderr: unknown }).stderr)
  ) {
    return (err as { stderr: Buffer }).stderr.toString("utf8");
  }
  return "";
}

export function createWorktreeSymlinks(
  projectRoot: string,
  worktreePath: string,
  symlinks: string[] | undefined,
): void {
  if (!symlinks || symlinks.length === 0 || resolve(projectRoot) === resolve(worktreePath)) {
    return;
  }

  for (const linkTarget of symlinks) {
    const sourcePath = join(projectRoot, linkTarget);
    const targetPath = join(worktreePath, linkTarget);

    if (!existsSync(sourcePath)) {
      continue;
    }

    if (existsSync(targetPath)) {
      try {
        const currentLink = readlinkSync(targetPath);
        const expectedTarget = relative(dirname(targetPath), sourcePath);
        if (currentLink === expectedTarget) {
          continue;
        }
        rmSync(targetPath, { recursive: true });
      } catch {
        throw new Error(`Cannot create symlink at ${targetPath}: non-symlink file or directory already exists`);
      }
    }

    const relativeSource = relative(dirname(targetPath), sourcePath);
    symlinkSync(relativeSource, targetPath, "dir");
  }
}
