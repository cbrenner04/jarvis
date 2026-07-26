import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  branchExistsLocal,
  branchExistsOnOrigin,
  getCurrentBranch,
  originTrackingRefResolves,
} from "../../shared/git.ts";
import { getBaseBranch, type SyncTransientRetryOptions, withSyncTransientRetry } from "./gh.ts";

function getCommitCountAheadOfBase(projectRoot: string, branchName: string, baseBranch: string): number {
  const output = execFileSync("git", ["rev-list", "--count", `${baseBranch}..${branchName}`], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
  return parseInt(output, 10);
}

function retireOrphanWorktree(projectRoot: string, specName: string): void {
  const worktreePath = join(projectRoot, ".worktree", specName);

  if (existsSync(worktreePath)) {
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
        cwd: projectRoot,
        stdio: "pipe",
      });
    } catch (err) {
      throw new Error(`failed to remove orphan worktree: ${(err as Error).message}`);
    }
  }

  if (branchExistsLocal(projectRoot, specName)) {
    try {
      execFileSync("git", ["branch", "-D", specName], {
        cwd: projectRoot,
        stdio: "pipe",
      });
    } catch (err) {
      throw new Error(`failed to delete orphan branch: ${(err as Error).message}`);
    }
  }
}

function clearWorktreeLitter(worktreePath: string): void {
  try {
    execFileSync("git", ["clean", "-fdx"], {
      cwd: worktreePath,
      stdio: "pipe",
    });
  } catch {
    // best effort; litter clearance is not critical
  }
}

export function getSpecName(specPath: string): string {
  return dirname(resolve(specPath)).split("/").at(-1) ?? "spec";
}

export function getPatchWorktreePath(projectRoot: string, specName: string): string {
  return join(projectRoot, ".worktree", specName);
}

function getBranchCreationArgs(projectRoot: string, branchName: string, baseBranch: string): string[] {
  if (originTrackingRefResolves(projectRoot, baseBranch)) {
    return ["--no-track", branchName, `origin/${baseBranch}`];
  }
  return [branchName, baseBranch];
}

export async function ensureWorktree(projectRoot: string, specPath: string): Promise<string> {
  const specName = getSpecName(specPath);
  const worktreePath = getPatchWorktreePath(projectRoot, specName);

  // Resumed runs can be launched from the patch worktree itself. Reuse that
  // checkout instead of trying to create another worktree for the same branch.
  if (currentBranchMatches(projectRoot, specName)) {
    return projectRoot;
  }

  bestEffortFetch(projectRoot);

  let branchExists = branchExistsLocal(projectRoot, specName);
  const branchExistsRemote = branchExistsOnOrigin(projectRoot, specName);

  // Detect and retire iter-0 orphan: branch+worktree with zero commits ahead of base
  if (branchExists && existsSync(worktreePath)) {
    const baseBranch = await getBaseBranch(projectRoot);
    if (getCommitCountAheadOfBase(projectRoot, specName, baseBranch) === 0) {
      retireOrphanWorktree(projectRoot, specName);
      branchExists = false; // Branch was deleted; reflect in state
    } else {
      // WIP branch exists with commits; clear litter and reuse
      clearWorktreeLitter(worktreePath);
      return worktreePath;
    }
  }

  if (existsSync(worktreePath)) {
    clearWorktreeLitter(worktreePath);
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
    execFileSync("git", ["branch", ...getBranchCreationArgs(projectRoot, specName, baseBranch)], {
      cwd: projectRoot,
      stdio: "pipe",
    });
    execFileSync("git", ["worktree", "add", worktreePath, specName], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  }

  clearWorktreeLitter(worktreePath);
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
    execFileSync("git", ["branch", ...getBranchCreationArgs(opts.projectRoot, branchName, baseBranch)], {
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

export function removePatchWorktree(projectRoot: string, specName: string): void {
  const worktreePath = getPatchWorktreePath(projectRoot, specName);
  if (!existsSync(worktreePath)) {
    return;
  }
  execFileSync("git", ["worktree", "remove", "--force", worktreePath], {
    cwd: projectRoot,
    stdio: "pipe",
  });
  if (existsSync(worktreePath)) {
    throw new Error(`worktree still exists at ${worktreePath}`);
  }
}

export function deleteLocalBranch(projectRoot: string, branchName: string): void {
  if (!branchExistsLocal(projectRoot, branchName)) {
    return;
  }
  execFileSync("git", ["branch", "-D", branchName], {
    cwd: projectRoot,
    stdio: "pipe",
  });
  if (branchExistsLocal(projectRoot, branchName)) {
    throw new Error(`local branch ${branchName} still exists`);
  }
}

export function deleteRemoteBranch(projectRoot: string, branchName: string): void {
  if (!branchExistsOnOrigin(projectRoot, branchName)) {
    return;
  }
  withSyncTransientRetry(
    () => {
      execFileSync("git", ["push", "origin", "--delete", branchName], {
        cwd: projectRoot,
        env: process.env,
        stdio: "pipe",
      });
    },
    { op: "git push origin --delete" },
  );
  execFileSync("git", ["fetch", "origin", "--prune"], {
    cwd: projectRoot,
    stdio: "pipe",
  });
  if (branchExistsOnOrigin(projectRoot, branchName)) {
    throw new Error(`remote branch origin/${branchName} still exists`);
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

export function tryConvergeNonFfActuatorPush(cwd: string, branch: string): { converged: boolean } {
  try {
    // Fetch the remote branch
    execFileSync("git", ["fetch", "origin", branch], {
      cwd,
      stdio: "pipe",
    });
  } catch {
    return { converged: false };
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
      return { converged: false };
    }

    // Trees match; reset to fetched tip
    execFileSync("git", ["reset", "--hard", "FETCH_HEAD"], {
      cwd,
      stdio: "pipe",
    });

    return { converged: true };
  } catch {
    return { converged: false };
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
      // Skip node_modules if it's already a real directory (promoted from symlink)
      if (linkTarget === "node_modules") {
        try {
          readlinkSync(targetPath);
          // It's a symlink, so we should remove it and recreate
          rmSync(targetPath, { recursive: true });
        } catch {
          // Not a symlink, it's a real directory; skip and don't recreate symlink
          continue;
        }
      } else {
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
    }

    const relativeSource = relative(dirname(targetPath), sourcePath);
    symlinkSync(relativeSource, targetPath, "dir");
  }
}
