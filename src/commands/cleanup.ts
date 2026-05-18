import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { ConfigOptions } from "../config.ts";

export type CleanupIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  readlineSync: (prompt: string) => string;
};

export type CleanupCommandOptions = {
  projectRoot: string;
  io: CleanupIo;
  config?: ConfigOptions;
  dryRun?: boolean;
  isMergedPr?: (branch: string) => boolean;
  removeItem?: (item: { path: string; branch: string; dir: string }) => void;
};

function branchForWorktree(worktreePath: string): string {
  return execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: worktreePath,
    stdio: "pipe",
    encoding: "utf8",
  }).trim();
}

function isPlanBranch(branch: string): boolean {
  return branch.startsWith("plan/");
}

function specNameForBranch(branch: string): string {
  if (isPlanBranch(branch)) {
    return branch.slice("plan/".length);
  }
  return branch;
}

export function cleanupCommand(opts: CleanupCommandOptions): number {
  const worktreeDir = join(opts.projectRoot, ".worktree");
  const worktrees = readdirSync(worktreeDir).filter((name) => name !== ".keep");

  const toRemove: Array<{ path: string; branch: string; dir: string }> = [];

  for (const worktreeName of worktrees) {
    const worktreePath = join(worktreeDir, worktreeName);
    let branch: string;
    try {
      branch = branchForWorktree(worktreePath);
    } catch {
      opts.io.stdout(
        `skipping ${worktreeName}: could not determine branch\n`,
      );
      continue;
    }

    if (!(opts.isMergedPr ?? isMergedPr)(branch)) {
      continue;
    }

    if (hasDirtyStatus(worktreePath, opts.projectRoot)) {
      opts.io.stdout(
        `skipping ${worktreeName}: has uncommitted or unpushed changes\n`,
      );
      continue;
    }

    toRemove.push({ path: worktreePath, branch, dir: worktreeName });
  }

  if (toRemove.length === 0) {
    opts.io.stdout("no merged worktrees to remove\n");
    return 0;
  }

  opts.io.stdout("\nWorktrees to remove:\n");
  for (const item of toRemove) {
    const tag = isPlanBranch(item.branch) ? " (plan)" : "";
    opts.io.stdout(`  ${item.branch}${tag}\n`);
  }

  if (opts.dryRun) {
    return 0;
  }

  const response = opts.io.readlineSync("\nRemove these worktrees? [y/N] ");
  if (!["y", "yes"].includes(response.toLowerCase())) {
    opts.io.stdout("cancelled\n");
    return 0;
  }

  let hadFailures = false;
  for (const item of toRemove) {
    try {
      if (opts.removeItem) {
        opts.removeItem(item);
      } else {
        execSync(`git worktree remove "${item.path}"`, {
          cwd: opts.projectRoot,
          stdio: "pipe",
        });
        execSync(`git branch -d "${item.branch}"`, {
          cwd: opts.projectRoot,
          stdio: "pipe",
        });
      }
      const tag = isPlanBranch(item.branch) ? " (plan)" : "";
      opts.io.stdout(`removed ${item.branch}${tag}\n`);

      const specName = specNameForBranch(item.branch);
      if (specName === "completed") {
        opts.io.stderr(
          `unsafe spec archive mapping for "${item.dir}": refusing to move spec/completed/\n`,
        );
        hadFailures = true;
        continue;
      }

      const source = join(opts.projectRoot, "spec", specName);
      const completedRoot = join(opts.projectRoot, "spec", "completed");
      const destination = join(completedRoot, specName);

      if (!existsSync(source)) {
        opts.io.stdout(
          `no spec directory moved for ${item.branch}: missing ${source}\n`,
        );
        continue;
      }

      if (existsSync(destination)) {
        opts.io.stderr(
          `spec archive destination already exists; left source in place: ${source} -> ${destination}\n`,
        );
        hadFailures = true;
        continue;
      }

      try {
        mkdirSync(completedRoot, { recursive: true });
        renameSync(source, destination);
        opts.io.stdout(`moved spec directory ${source} -> ${destination}\n`);
      } catch (err) {
        opts.io.stderr(
          `failed to archive spec directory ${source} -> ${destination}: ${(err as Error).message}\n`,
        );
        hadFailures = true;
      }
    } catch (err) {
      opts.io.stderr(
        `failed to remove ${item.branch}: ${(err as Error).message}\n`,
      );
      hadFailures = true;
    }
  }

  return hadFailures ? 1 : 0;
}

function isMergedPr(branch: string): boolean {
  try {
    const output = execSync(`gh pr view "${branch}" --json state -q .state`, {
      stdio: "pipe",
      encoding: "utf8",
    });
    return output.trim() === "MERGED";
  } catch {
    return false;
  }
}

function hasDirtyStatus(worktreePath: string, _projectRoot: string): boolean {
  try {
    const porcelain = execSync("git status --porcelain", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (porcelain.trim().length > 0) {
      return true;
    }

    const unpushed = execSync("git log @{u}..", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });
    return unpushed.trim().length > 0;
  } catch {
    return true;
  }
}
