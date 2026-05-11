import { execFileSync, execSync } from "node:child_process";
import { existsSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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

export async function ensureWorktree(
  projectRoot: string,
  specPath: string,
): Promise<string> {
  const specName = getSpecName(specPath);
  const worktreePath = join(projectRoot, ".worktree", specName);

  try {
    execSync("git fetch origin", { cwd: projectRoot, stdio: "pipe" });
  } catch {
    // fetch might fail if no origin or no network, but we continue anyway
  }

  const branchExists = branchExistsLocal(projectRoot, specName);
  const branchExistsRemote = branchExistsOnOrigin(projectRoot, specName);

  if (existsSync(worktreePath)) {
    return worktreePath;
  }

  if (branchExists || branchExistsRemote) {
    if (!branchExists && branchExistsRemote) {
      execSync(`git branch ${specName} origin/${specName}`, {
        cwd: projectRoot,
        stdio: "pipe",
      });
    }
    execSync(`git worktree add --checkout ${worktreePath} ${specName}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } else {
    const baseBranch = await getBaseBranch(projectRoot);
    execSync(`git branch ${specName} ${baseBranch}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
    execSync(`git worktree add ${worktreePath} ${specName}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
  }

  return worktreePath;
}

function branchExistsLocal(projectRoot: string, branchName: string): boolean {
  try {
    execSync(`git rev-parse --verify ${branchName}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function branchExistsOnOrigin(
  projectRoot: string,
  branchName: string,
): boolean {
  try {
    execSync(`git rev-parse --verify origin/${branchName}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
    return true;
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
 */
export function worktreeCompletionBlocker(cwd: string): string | undefined {
  if (!existsSync(join(cwd, ".git"))) {
    return undefined;
  }
  try {
    const porcelain = execSync("git status --porcelain", {
      cwd,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
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
  const args = opts.firstPush
    ? ["push", "-u", "origin", getCurrentBranch(opts.cwd)]
    : ["push"];
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

function getCurrentBranch(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: "pipe",
  }).trim();
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
  if (!symlinks || symlinks.length === 0) {
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
        throw new Error(
          `Cannot create symlink at ${targetPath}: non-symlink file or directory already exists`,
        );
      }
    }

    const relativeSource = relative(dirname(targetPath), sourcePath);
    symlinkSync(relativeSource, targetPath, "dir");
  }
}
