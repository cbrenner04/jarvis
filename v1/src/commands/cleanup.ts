import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import type { ConfigOptions, ProjectMatch } from "../config.ts";
import { computeProjectSafeId, stripPlanSpecTimestampPrefix } from "../modes/plan/spec-paths.ts";

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
  isMergedPr?: (branch: string) => boolean;
  removeItem?: (item: { path: string; branch: string; dir: string }) => void;
  candidateHomes?: string[];
  project?: ProjectMatch;
  commit?: boolean;
  jarvisConfigDir?: string;
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

function archiveExternalSpec(
  jarvisConfigDir: string,
  project: ProjectMatch,
  specDirBasename: string,
  io: CleanupIo,
): boolean {
  const projectId = computeProjectSafeId(project);
  const externalHome = join(jarvisConfigDir, "specs", projectId);
  const source = join(externalHome, specDirBasename);
  const destination = join(externalHome, "completed", specDirBasename);

  if (specDirBasename === "completed" || specDirBasename === "ready-intents") {
    io.stderr(
      `unsafe spec archive mapping for "${specDirBasename}": refusing to move external spec with reserved name\n`,
    );
    return false;
  }

  if (!existsSync(source)) {
    io.stdout(`no spec directory moved for external spec: missing ${source}\n`);
    return true;
  }

  if (existsSync(destination)) {
    io.stderr(`spec archive destination already exists; left source in place: ${source} -> ${destination}\n`);
    return false;
  }

  try {
    mkdirSync(join(externalHome, "completed"), { recursive: true });
    renameSync(source, destination);
    io.stdout(`moved spec directory ${source} -> ${destination}\n`);
    return true;
  } catch (err) {
    io.stderr(`failed to archive spec directory ${source} -> ${destination}: ${(err as Error).message}\n`);
    return false;
  }
}

function pruneReadyIntent(
  jarvisConfigDir: string,
  project: ProjectMatch,
  specDirBasename: string,
  io: CleanupIo,
): void {
  const projectId = computeProjectSafeId(project);
  const strippedName = stripPlanSpecTimestampPrefix(specDirBasename);
  const readyIntentPath = join(jarvisConfigDir, "specs", projectId, "ready-intents", `${strippedName}.md`);

  if (!existsSync(readyIntentPath)) {
    return;
  }

  try {
    rmSync(readyIntentPath);
    io.stdout(`pruned consumed ready-intent ${readyIntentPath}\n`);
  } catch (err) {
    io.stderr(`failed to prune ready-intent ${readyIntentPath}: ${(err as Error).message}\n`);
  }
}

export function cleanupCommand(opts: CleanupCommandOptions): number {
  const worktreeDir = join(opts.projectRoot, ".worktree");
  const targetDir = opts.targetDir ?? "spec";
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
  const commit = opts.commit ?? true;
  const jarvisConfigDir = opts.jarvisConfigDir ?? join(process.env.HOME ?? process.env.USERPROFILE ?? "~", ".jarvis");

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

      if (!commit && opts.project) {
        const specDirBasename = specNameForBranch(item.branch);
        if (isPlanBranch(item.branch)) {
          opts.io.stdout(
            `skipping external archive for plan-mode worktree on branch ${item.branch}: plan worktrees do not produce external archives\n`,
          );
          continue;
        }

        const archiveSuccess = archiveExternalSpec(jarvisConfigDir, opts.project, specDirBasename, opts.io);
        if (!archiveSuccess) {
          hadFailures = true;
          continue;
        }
        pruneReadyIntent(jarvisConfigDir, opts.project, specDirBasename, opts.io);
      } else {
        const { source, specName, missingSource, sourceHome } = resolveSpecArchiveSource(
          opts.projectRoot,
          targetDir,
          item.branch,
          candidateHomes,
        );
        if (specName === "completed") {
          opts.io.stderr(`unsafe spec archive mapping for "${item.dir}": refusing to move ${targetDir}/completed/\n`);
          hadFailures = true;
          continue;
        }

        const completedRoot = join(opts.projectRoot, sourceHome, "completed");
        const destination = join(completedRoot, specName);

        if (!existsSync(source)) {
          opts.io.stdout(`no spec directory moved for ${item.branch}: missing ${missingSource}\n`);
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
          commitArchivedSpecMove(opts.projectRoot, source, destination, specName);
          opts.io.stdout(`moved spec directory ${source} -> ${destination}\n`);
        } catch (err) {
          opts.io.stderr(`failed to archive spec directory ${source} -> ${destination}: ${(err as Error).message}\n`);
          hadFailures = true;
        }
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
