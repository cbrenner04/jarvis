import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { branchExistsLocal, branchExistsOnOrigin, getCurrentBranch } from "../../shared/git.ts";
import { getBaseBranch, type SyncTransientRetryOptions, withSyncTransientRetry } from "./gh.ts";

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

type CreateManagedWorktreeOptions = {
  projectRoot: string;
  name: string;
  dirPrefix: string;
  branchPrefix: string;
  kind: string;
  baseBranch?: string;
};

async function createManagedWorktree(opts: CreateManagedWorktreeOptions): Promise<string> {
  const worktreePath = join(opts.projectRoot, ".worktree", opts.dirPrefix + opts.name);
  const branchName = opts.branchPrefix + opts.name;

  bestEffortFetch(opts.projectRoot);

  if (existsSync(worktreePath)) {
    throw new Error(
      `${opts.kind} worktree already exists at ${worktreePath}; resolve with \`jarvis1 cleanup\` or remove manually`,
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

export async function createPlanWorktree(opts: CreatePlanWorktreeOptions): Promise<string> {
  return createManagedWorktree({
    projectRoot: opts.projectRoot,
    name: opts.name,
    dirPrefix: "plan-",
    branchPrefix: "plan/",
    kind: "plan",
    ...(opts.baseBranch !== undefined ? { baseBranch: opts.baseBranch } : {}),
  });
}

export interface CreatePromptWorktreeOptions {
  projectRoot: string;
  timestamp: string;
  nonce: string;
  baseBranch?: string;
}

export interface CreateIntentWorktreeOptions {
  projectRoot: string;
  name: string;
  baseBranch?: string;
}

export async function createIntentWorktree(opts: CreateIntentWorktreeOptions): Promise<string> {
  return createManagedWorktree({
    projectRoot: opts.projectRoot,
    name: opts.name,
    dirPrefix: "intent-",
    branchPrefix: "intent/",
    kind: "intent",
    ...(opts.baseBranch !== undefined ? { baseBranch: opts.baseBranch } : {}),
  });
}

export async function createPromptWorktree(opts: CreatePromptWorktreeOptions): Promise<string> {
  const name = `${opts.timestamp}-${opts.nonce}`;
  return createManagedWorktree({
    projectRoot: opts.projectRoot,
    name,
    dirPrefix: "prompt-",
    branchPrefix: "prompt/",
    kind: "prompt",
    ...(opts.baseBranch !== undefined ? { baseBranch: opts.baseBranch } : {}),
  });
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

export function bestEffortFetch(projectRoot: string): void {
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

export type PushCurrentOptions = {
  cwd: string;
  firstPush: boolean;
  execSync?: () => void;
  retryOpts?: Partial<SyncTransientRetryOptions>;
};

export function pushCurrent(opts: PushCurrentOptions): void {
  const { cwd, firstPush, execSync, retryOpts } = opts;

  const args = firstPush ? ["push", "-u", "origin", getCurrentBranch(cwd)] : ["push"];

  const realExecSync =
    execSync ||
    (() => {
      execFileSync("git", args, {
        cwd,
        env: process.env,
        stdio: "pipe",
      });
    });

  const handleError = (err: unknown): void => {
    const stderr = getProcessStderr(err);
    throw new Error(stderr.length > 0 ? stderr : String(err));
  };

  const thunk = () => {
    try {
      realExecSync();
    } catch (err) {
      handleError(err);
    }
  };

  withSyncTransientRetry(thunk, {
    op: "git push",
    ...retryOpts,
  });
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

export class RebaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RebaseConflictError";
  }
}

/**
 * Reconcile the current branch with its remote before push. Fetches and
 * rebases onto `origin/<branch>` if the remote has commits not reachable
 * from local HEAD. Aborts on rebase conflict and throws RebaseConflictError.
 * Non-fatal on fetch failure or missing upstream.
 */
export function reconcileActuatorCommit(cwd: string): void {
  const branch = getCurrentBranch(cwd);

  // Fetch remote refs
  bestEffortFetch(cwd);

  // Skip if no upstream configured
  if (!hasUpstream(cwd)) {
    return;
  }

  // Skip if origin/<branch> doesn't exist
  if (!branchExistsOnOrigin(cwd, branch)) {
    return;
  }

  // Check if remote has commits not reachable from local HEAD
  try {
    const countOutput = execFileSync("git", ["rev-list", "--count", `HEAD..origin/${branch}`], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    const count = parseInt(countOutput, 10);
    if (count === 0) {
      // Local is already up to date with remote
      return;
    }
  } catch {
    // If rev-list fails, skip rebase
    return;
  }

  // Rebase onto origin/<branch>
  try {
    execFileSync("git", ["rebase", `origin/${branch}`], {
      cwd,
      stdio: "pipe",
    });
  } catch (err) {
    // Rebase failed; check if it's due to a conflict
    try {
      execFileSync("git", ["rebase", "--abort"], {
        cwd,
        stdio: "pipe",
      });
    } catch {
      // best-effort abort
    }
    const stderr = getProcessStderr(err);
    throw new RebaseConflictError(stderr.length > 0 ? stderr : String(err));
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

export function isNonFastForwardPushError(stderr: string): boolean {
  const patterns = [
    /non-fast-forward/i,
    /failed to push some refs/i,
    /Updates were rejected because/i,
    /tip of your current branch is behind/i,
  ];
  return patterns.some((p) => p.test(stderr));
}

export type NonFfConvergenceResult = {
  converged: boolean;
  reason?: string;
};

export function tryConvergeNonFfActuatorPush(cwd: string, branch: string): NonFfConvergenceResult {
  try {
    // Fetch the remote branch
    execFileSync("git", ["fetch", "origin", branch], {
      cwd,
      stdio: "pipe",
    });
  } catch {
    return {
      converged: false,
      reason: "fetch failed",
    };
  }

  try {
    // Get tree SHAs
    const localTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    const remoteTree = execFileSync("git", ["rev-parse", "FETCH_HEAD^{tree}"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    if (localTree !== remoteTree) {
      return {
        converged: false,
        reason: "tree mismatch",
      };
    }

    // Trees match; reset to fetched tip
    execFileSync("git", ["reset", "--hard", "FETCH_HEAD"], {
      cwd,
      stdio: "pipe",
    });

    return { converged: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      converged: false,
      reason: `convergence check failed: ${message}`,
    };
  }
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
