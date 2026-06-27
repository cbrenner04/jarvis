import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import type { ConfigOptions } from "../config.ts";
import { stripPlanSpecTimestampPrefix } from "../modes/plan/spec-paths.ts";

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
  targetDir?: string;
  commit?: boolean;
  externalSpecsRoot?: string;
  isMergedPr?: (branch: string) => boolean;
  removeItem?: (item: { path: string; branch: string; dir: string }) => void;
  candidateHomes?: string[];
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

function resolveSpecArchiveSource(
  projectRoot: string,
  targetDir: string,
  branch: string,
  candidateHomes: string[] = [targetDir, "v1/spec", "v2/spec"],
): { source: string; specName: string; missingSource: string; sourceHome: string } {
  const specName = specNameForBranch(branch);

  for (const homeDir of candidateHomes) {
    const specRoot = join(projectRoot, homeDir);
    const exactSource = join(specRoot, specName);
    if (existsSync(exactSource)) {
      return { source: exactSource, specName, missingSource: exactSource, sourceHome: homeDir };
    }

    if (isPlanBranch(branch) && existsSync(specRoot)) {
      const timestampedMatch = readdirSync(specRoot)
        .filter((entry) => entry !== "completed")
        .filter((entry) => stripPlanSpecTimestampPrefix(entry) === specName)
        .sort()[0];
      if (timestampedMatch !== undefined) {
        return {
          source: join(specRoot, timestampedMatch),
          specName: timestampedMatch,
          missingSource: exactSource,
          sourceHome: homeDir,
        };
      }
    }
  }

  return {
    source: join(projectRoot, targetDir, specName),
    specName,
    missingSource: join(projectRoot, targetDir, specName),
    sourceHome: targetDir,
  };
}

function resolveExternalSpecArchiveSource(
  externalSpecsRoot: string,
  branch: string,
): { source: string; specName: string; missingSource: string } {
  const specName = specNameForBranch(branch);
  const exactSource = join(externalSpecsRoot, specName);
  if (existsSync(exactSource)) {
    return { source: exactSource, specName, missingSource: exactSource };
  }

  if (isPlanBranch(branch) && existsSync(externalSpecsRoot)) {
    const timestampedMatch = readdirSync(externalSpecsRoot)
      .filter((entry) => entry !== "completed" && entry !== "ready-intents")
      .filter((entry) => stripPlanSpecTimestampPrefix(entry) === specName)
      .sort()[0];
    if (timestampedMatch !== undefined) {
      return {
        source: join(externalSpecsRoot, timestampedMatch),
        specName: timestampedMatch,
        missingSource: exactSource,
      };
    }
  }

  return {
    source: exactSource,
    specName,
    missingSource: exactSource,
  };
}

function archiveResolvedSpec(args: {
  io: CleanupIo;
  branch: string;
  dir: string;
  archiveRoot: string;
  source: string;
  specName: string;
  missingSource: string;
  onArchive?: (destination: string, specName: string) => void;
}): boolean {
  const { archiveRoot, branch, dir, io, missingSource, onArchive, source, specName } = args;
  if (specName === "completed") {
    io.stderr(`unsafe spec archive mapping for "${dir}": refusing to move ${archiveRoot}/completed/\n`);
    return false;
  }

  const completedRoot = join(archiveRoot, "completed");
  const destination = join(completedRoot, specName);

  if (!existsSync(source)) {
    io.stdout(`no spec directory moved for ${branch}: missing ${missingSource}\n`);
    return true;
  }

  if (existsSync(destination)) {
    io.stderr(`spec archive destination already exists; left source in place: ${source} -> ${destination}\n`);
    return false;
  }

  try {
    mkdirSync(completedRoot, { recursive: true });
    renameSync(source, destination);
    onArchive?.(destination, specName);
    io.stdout(`moved spec directory ${source} -> ${destination}\n`);
    return true;
  } catch (err) {
    io.stderr(`failed to archive spec directory ${source} -> ${destination}: ${(err as Error).message}\n`);
    return false;
  }
}

function deleteMergedBranch(projectRoot: string, branch: string): void {
  try {
    execSync(`git branch -d "${branch}"`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    execSync(`git branch -D "${branch}"`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
  }
}

function quotePathForGit(path: string): string {
  return path.replaceAll('"', '\\"');
}

function commitArchivedSpecMove(projectRoot: string, source: string, destination: string, specName: string): void {
  const sourceRelativePath = relative(projectRoot, source);
  const destinationRelativePath = relative(projectRoot, destination);
  const quotedSource = quotePathForGit(sourceRelativePath);
  const quotedDestination = quotePathForGit(destinationRelativePath);

  execSync(`git add -A -- "${quotedDestination}"`, {
    cwd: projectRoot,
    stdio: "pipe",
  });
  const trackedSourcePaths = execSync(`git ls-files -- "${quotedSource}"`, {
    cwd: projectRoot,
    stdio: "pipe",
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);

  for (const trackedSourcePath of trackedSourcePaths) {
    const quotedTrackedSourcePath = quotePathForGit(trackedSourcePath);
    execSync(`git rm --cached --ignore-unmatch -- "${quotedTrackedSourcePath}"`, {
      cwd: projectRoot,
      stdio: "pipe",
    });
  }
  execSync(`git commit -m "cleanup: archive spec ${specName}"`, {
    cwd: projectRoot,
    stdio: "pipe",
  });
  execSync("git push", {
    cwd: projectRoot,
    stdio: "pipe",
  });
}

export function cleanupCommand(opts: CleanupCommandOptions): number {
  const worktreeDir = join(opts.projectRoot, ".worktree");
  const targetDir = opts.targetDir ?? "spec";
  const commit = opts.commit ?? true;
  const candidateHomes = opts.candidateHomes ?? [targetDir, "v1/spec", "v2/spec"];
  const worktrees = readdirSync(worktreeDir).filter((name) => name !== ".keep");

  const toRemove: Array<{ path: string; branch: string; dir: string }> = [];

  for (const worktreeName of worktrees) {
    const worktreePath = join(worktreeDir, worktreeName);
    let branch: string;
    try {
      branch = branchForWorktree(worktreePath);
    } catch {
      opts.io.stdout(`skipping ${worktreeName}: could not determine branch\n`);
      continue;
    }

    if (!(opts.isMergedPr ?? isMergedPr)(branch)) {
      continue;
    }

    if (hasDirtyStatus(worktreePath, opts.projectRoot)) {
      opts.io.stdout(`skipping ${worktreeName}: has uncommitted or unpushed changes\n`);
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
        deleteMergedBranch(opts.projectRoot, item.branch);
      }
      const tag = isPlanBranch(item.branch) ? " (plan)" : "";
      opts.io.stdout(`removed ${item.branch}${tag}\n`);

      const branchSlug = specNameForBranch(item.branch);
      if (!commit && opts.externalSpecsRoot === undefined) {
        opts.io.stderr(`missing cleanup archive root for ${item.branch}\n`);
        hadFailures = true;
        continue;
      }
      let archived: boolean;
      if (commit) {
        const { source, specName, missingSource, sourceHome } = resolveSpecArchiveSource(
          opts.projectRoot,
          targetDir,
          item.branch,
          candidateHomes,
        );
        archived = archiveResolvedSpec({
          io: opts.io,
          branch: item.branch,
          dir: item.dir,
          archiveRoot: join(opts.projectRoot, sourceHome),
          source,
          specName,
          missingSource,
          onArchive: (destination, resolvedSpecName) => {
            commitArchivedSpecMove(opts.projectRoot, source, destination, resolvedSpecName);
          },
        });
      } else {
        const externalSpecsRoot = opts.externalSpecsRoot as string;
        const { source, specName, missingSource } = resolveExternalSpecArchiveSource(externalSpecsRoot, item.branch);
        archived = archiveResolvedSpec({
          io: opts.io,
          branch: item.branch,
          dir: item.dir,
          archiveRoot: externalSpecsRoot,
          source,
          specName,
          missingSource,
          onArchive: () => {
            rmSync(join(externalSpecsRoot, "ready-intents", `${branchSlug}.md`), { force: true });
          },
        });
      }
      if (!archived) {
        hadFailures = true;
      }
    } catch (err) {
      opts.io.stderr(`failed to remove ${item.branch}: ${(err as Error).message}\n`);
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
  } catch {
    return true;
  }

  try {
    const unpushed = execSync("git log @{u}..", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });
    return unpushed.trim().length > 0;
  } catch {
    return false;
  }
}
