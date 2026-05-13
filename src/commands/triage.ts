import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ConfigOptions } from "../config.ts";

export type TriageIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type TriageCommandOptions = {
  projectRoot: string;
  io: TriageIo;
  config?: ConfigOptions;
  worktreeName?: string;
};

export function triageCommand(opts: TriageCommandOptions): number {
  const worktreeDir = join(opts.projectRoot, ".worktree");

  // Named form: drill-down for a specific worktree
  if (opts.worktreeName !== undefined) {
    return triageDrillDown(worktreeDir, opts.worktreeName, opts.io);
  }

  // No-arg form: list all worktrees with summary
  return triageListWorktrees(worktreeDir, opts.io);
}

function triageListWorktrees(worktreeDir: string, io: TriageIo): number {
  let worktrees: string[];
  try {
    worktrees = readdirSync(worktreeDir).filter((name) => name !== ".keep");
  } catch {
    io.stdout("no worktrees\n");
    return 0;
  }

  if (worktrees.length === 0) {
    io.stdout("no worktrees\n");
    return 0;
  }

  io.stdout("NAME\t\tDIRTY\t\tAHEAD/BEHIND\tPR\t\tSPEC\n");

  for (const worktreeName of worktrees) {
    const worktreePath = join(worktreeDir, worktreeName);
    const dirtyStatus = getDirtyStatusSummary(worktreePath);
    const aheadBehind = getAheadBehind(worktreePath);
    const prState = getPrState(worktreeName);
    const specProgress = getSpecProgress(worktreePath);

    io.stdout(
      `${worktreeName}\t\t${dirtyStatus}\t\t${aheadBehind}\t\t${prState}\t\t${specProgress}\n`,
    );
  }

  return 0;
}

function triageDrillDown(
  worktreeDir: string,
  worktreeName: string,
  io: TriageIo,
): number {
  const worktreePath = join(worktreeDir, worktreeName);

  if (!existsSync(worktreePath)) {
    io.stderr(`unknown worktree: ${worktreeName}\n`);
    return 1;
  }

  // Print section headers with pending content
  io.stdout("Identity\n  (pending)\n\n");
  io.stdout("Git\n  (pending)\n\n");
  io.stdout("Spec\n  (pending)\n\n");
  io.stdout("PR\n  (pending)\n\n");
  io.stdout("Session log\n  (pending)\n\n");
  io.stdout("Suggested next moves\n  (pending)\n");

  return 0;
}

function getDirtyStatusSummary(worktreePath: string): string {
  try {
    const porcelain = execSync("git status --porcelain", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (porcelain.trim().length > 0) {
      return "dirty";
    }

    const unpushed = execSync("git log @{u}..", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (unpushed.trim().length > 0) {
      return "dirty";
    }

    return "clean";
  } catch {
    return "-";
  }
}

function getAheadBehind(worktreePath: string): string {
  try {
    const output = execSync(
      "git rev-list --left-right --count @{u}...HEAD",
      {
        cwd: worktreePath,
        stdio: "pipe",
        encoding: "utf8",
      },
    );
    const [behind, ahead] = output.trim().split("\t");
    return `${ahead}/${behind}`;
  } catch {
    return "-";
  }
}

function getPrState(branch: string): string {
  try {
    const output = execSync(`gh pr view "${branch}" --json state -q .state`, {
      stdio: "pipe",
      encoding: "utf8",
    });
    return output.trim().toLowerCase();
  } catch {
    return "no PR";
  }
}

function getSpecProgress(worktreePath: string): string {
  // Stub for now - will be filled in by subspec 01
  return "-";
}
