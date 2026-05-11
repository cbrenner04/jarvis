import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
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
};

export function cleanupCommand(opts: CleanupCommandOptions): number {
  const worktreeDir = join(opts.projectRoot, ".worktree");
  const worktrees = readdirSync(worktreeDir).filter((name) => name !== ".keep");

  const toRemove: Array<{ path: string; branch: string }> = [];

  for (const worktreeName of worktrees) {
    const worktreePath = join(worktreeDir, worktreeName);

    if (!isMergedPr(worktreeName)) {
      continue;
    }

    if (hasDirtyStatus(worktreePath, opts.projectRoot)) {
      opts.io.stdout(
        `skipping ${worktreeName}: has uncommitted or unpushed changes\n`,
      );
      continue;
    }

    toRemove.push({ path: worktreePath, branch: worktreeName });
  }

  if (toRemove.length === 0) {
    opts.io.stdout("no merged worktrees to remove\n");
    return 0;
  }

  opts.io.stdout("\nWorktrees to remove:\n");
  for (const item of toRemove) {
    opts.io.stdout(`  ${item.branch}\n`);
  }

  if (opts.dryRun) {
    return 0;
  }

  const response = opts.io.readlineSync("\nRemove these worktrees? [y/N] ");
  if (!["y", "yes"].includes(response.toLowerCase())) {
    opts.io.stdout("cancelled\n");
    return 0;
  }

  for (const item of toRemove) {
    try {
      execSync(`git worktree remove "${item.path}"`, {
        cwd: opts.projectRoot,
        stdio: "pipe",
      });
      execSync(`git branch -d "${item.branch}"`, {
        cwd: opts.projectRoot,
        stdio: "pipe",
      });
      opts.io.stdout(`removed ${item.branch}\n`);
    } catch (err) {
      opts.io.stderr(
        `failed to remove ${item.branch}: ${(err as Error).message}\n`,
      );
      return 1;
    }
  }

  return 0;
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
