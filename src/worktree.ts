import { execSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
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
    const baseBranch = await getBaseBranch();
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

export function pushCurrent(projectRoot: string, isFirstPush: boolean): void {
  const args = isFirstPush ? "push -u origin HEAD" : "push";
  try {
    execSync(`git ${args}`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`git push failed: ${errorMessage}`);
  }
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
        const expectedTarget = relative(
          dirname(targetPath),
          sourcePath,
        );
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
