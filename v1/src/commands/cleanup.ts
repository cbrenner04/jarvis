import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { stripPlanSpecTimestampPrefix } from "../modes/plan/spec-paths.ts";
import { closePr, findMatchingOpenPrs, type MatchingOpenPr } from "../pr.ts";
import {
  checkAbandonPrEligibility,
  checkScopedAbandonPreflight,
} from "../scoped-abandon-preflight.ts";
import { deleteLocalBranch, deleteRemoteBranch } from "../worktree.ts";
import { isSpecComplete, specHasNonHumanOnlyAcceptanceCriteria } from "./triage.ts";

export type CleanupIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  readlineSync: (prompt: string) => string;
};

export type CleanupCommandOptions = {
  projectRoot: string;
  io: CleanupIo;
  dryRun?: boolean;
  abandon?: boolean;
  worktreeName?: string;
  targetDir?: string;
  commit?: boolean;
  externalSpecsRoot?: string;
  isMergedPr?: (branch: string) => boolean;
  removeItem?: (item: CleanupItem) => void;
  findMatchingOpenPrs?: (branch: string, cwd?: string) => MatchingOpenPr[];
  closePr?: (prNumber: number, cwd?: string) => void;
  deleteLocalBranch?: (projectRoot: string, branchName: string) => void;
  deleteRemoteBranch?: (projectRoot: string, branchName: string) => void;
  candidateHomes?: string[];
};

type CleanupItem = { path: string; branch: string; dir: string };
type CleanupDeps = Required<
  Pick<
    CleanupCommandOptions,
    "isMergedPr" | "findMatchingOpenPrs" | "closePr" | "deleteLocalBranch" | "deleteRemoteBranch"
  >
>;

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

function resolveCompletionSpecFile(sourceDir: string): string | null {
  const indexPath = join(sourceDir, "index.md");
  if (existsSync(indexPath)) {
    return indexPath;
  }
  if (!existsSync(sourceDir)) {
    return null;
  }
  const mdFiles = readdirSync(sourceDir).filter((entry) => entry.endsWith(".md"));
  if (mdFiles.length === 1) {
    return join(sourceDir, mdFiles[0] as string);
  }
  return null;
}

function checkArchivePreconditions(args: {
  io: CleanupIo;
  projectRoot: string;
  source: string;
  specName: string;
  removedWorktreeDir: string;
  findMatchingOpenPrs: (branch: string, cwd?: string) => MatchingOpenPr[];
}): boolean {
  const { io, projectRoot, source, specName, removedWorktreeDir, findMatchingOpenPrs } = args;
  const hasInFlightWorktree = specName !== removedWorktreeDir && existsSync(join(projectRoot, ".worktree", specName));

  let openPrCount: number;
  try {
    openPrCount = findMatchingOpenPrs(specName, projectRoot).length;
  } catch {
    io.stdout(`skipping archival of ${specName}: failed to inspect open PRs\n`);
    return false;
  }
  if (openPrCount > 1) {
    io.stdout(`skipping archival of ${specName}: multiple open PRs match branch ${specName}\n`);
    return false;
  }

  const specFile = resolveCompletionSpecFile(source);
  if (specFile !== null) {
    const complete = isSpecComplete(specFile);
    const inFlightOwner = hasInFlightWorktree || openPrCount > 0;
    if (!complete || (complete && !specHasNonHumanOnlyAcceptanceCriteria(specFile) && inFlightOwner)) {
      io.stdout(`skipping archival of ${specName}: spec not complete\n`);
      return false;
    }
  }

  if (hasInFlightWorktree) {
    io.stdout(`skipping archival of ${specName}: in-flight patch worktree ${specName} still exists\n`);
    return false;
  }
  if (openPrCount === 1) {
    io.stdout(`skipping archival of ${specName}: open implementation PR on ${specName}\n`);
    return false;
  }
  return true;
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
  const abandon = opts.abandon ?? false;
  const candidateHomes = opts.candidateHomes ?? [targetDir, "v1/spec", "v2/spec"];
  const deps: CleanupDeps = {
    isMergedPr: opts.isMergedPr ?? isMergedPr,
    findMatchingOpenPrs: opts.findMatchingOpenPrs ?? findMatchingOpenPrs,
    closePr: opts.closePr ?? closePr,
    deleteLocalBranch: opts.deleteLocalBranch ?? deleteLocalBranch,
    deleteRemoteBranch: opts.deleteRemoteBranch ?? deleteRemoteBranch,
  };

  if (abandon && opts.worktreeName !== undefined) {
    return scopedAbandonCleanup({
      deps,
      dryRun: opts.dryRun ?? false,
      io: opts.io,
      projectRoot: opts.projectRoot,
      worktreeName: opts.worktreeName,
    });
  }

  const worktrees = readdirSync(worktreeDir).filter((name) => name !== ".keep");

  const toRemove: CleanupItem[] = [];

  for (const worktreeName of worktrees) {
    const worktreePath = join(worktreeDir, worktreeName);
    let branch: string;
    try {
      branch = branchForWorktree(worktreePath);
    } catch {
      opts.io.stdout(`skipping ${worktreeName}: could not determine branch\n`);
      continue;
    }

    if (abandon) {
      const eligibility = checkAbandonPrEligibility({
        branch,
        isMergedPr: deps.isMergedPr,
        findMatchingOpenPrs: deps.findMatchingOpenPrs,
        projectRoot: opts.projectRoot,
      });
      if (eligibility.kind !== "eligible") {
        if (eligibility.kind === "inspection_failed") {
          opts.io.stdout(`skipping ${worktreeName}: failed to inspect PRs: ${eligibility.message}\n`);
        } else if (eligibility.kind === "multiple_open") {
          opts.io.stdout(`skipping ${worktreeName}: multiple open PRs match branch ${branch}\n`);
        } else if (eligibility.kind === "ready_pr") {
          opts.io.stdout(`skipping ${worktreeName}: open ready PR #${eligibility.prNumber}\n`);
        }
        continue;
      }
      toRemove.push({ path: worktreePath, branch, dir: worktreeName });
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
    opts.io.stdout(abandon ? "no abandoned worktrees to remove\n" : "no merged worktrees to remove\n");
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
      if (abandon) {
        retireAbandonedWorktree({
          closePrFn: deps.closePr,
          deleteLocalBranchFn: deps.deleteLocalBranch,
          deleteRemoteBranchFn: deps.deleteRemoteBranch,
          findMatchingOpenPrsFn: deps.findMatchingOpenPrs,
          item,
          projectRoot: opts.projectRoot,
          io: opts.io,
        });
      } else if (opts.removeItem) {
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

      if (abandon) {
        continue;
      }

      const branchSlug = specNameForBranch(item.branch);
      if (!commit && opts.externalSpecsRoot === undefined) {
        opts.io.stderr(`missing cleanup archive root for ${item.branch}\n`);
        hadFailures = true;
        continue;
      }
      let source: string;
      let specName: string;
      let missingSource: string;
      let archiveRoot: string;
      let onArchive: ((destination: string, resolvedSpecName: string) => void) | undefined;
      if (commit) {
        const r = resolveSpecArchiveSource(opts.projectRoot, targetDir, item.branch, candidateHomes);
        source = r.source;
        specName = r.specName;
        missingSource = r.missingSource;
        archiveRoot = join(opts.projectRoot, r.sourceHome);
        onArchive = (destination, resolvedSpecName) => {
          commitArchivedSpecMove(opts.projectRoot, r.source, destination, resolvedSpecName);
        };
      } else {
        const externalSpecsRoot = opts.externalSpecsRoot as string;
        ({ source, specName, missingSource } = resolveExternalSpecArchiveSource(externalSpecsRoot, item.branch));
        archiveRoot = externalSpecsRoot;
        onArchive = () => {
          rmSync(join(externalSpecsRoot, "ready-intents", `${branchSlug}.md`), { force: true });
        };
      }

      if (
        !checkArchivePreconditions({
          io: opts.io,
          projectRoot: opts.projectRoot,
          source,
          specName,
          removedWorktreeDir: item.dir,
          findMatchingOpenPrs: deps.findMatchingOpenPrs,
        })
      ) {
        continue;
      }

      const archived = archiveResolvedSpec({
        io: opts.io,
        branch: item.branch,
        dir: item.dir,
        archiveRoot,
        source,
        specName,
        missingSource,
        onArchive,
      });
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
    const output = execFileSync("gh", ["pr", "view", branch, "--json", "state", "-q", ".state"], {
      env: process.env,
      encoding: "utf8",
      stdio: "pipe",
    });
    return output.trim() === "MERGED";
  } catch {
    return false;
  }
}

function scopedAbandonCleanup(args: {
  deps: CleanupDeps;
  dryRun: boolean;
  io: CleanupIo;
  projectRoot: string;
  worktreeName: string;
}): number {
  const worktreePath = join(args.projectRoot, ".worktree", args.worktreeName);
  const preflight = checkScopedAbandonPreflight({
    projectRoot: args.projectRoot,
    worktreeName: args.worktreeName,
    worktreePath,
    deps: args.deps,
  });
  if (!preflight.eligible) {
    switch (preflight.reason) {
      case "missing":
        args.io.stderr(`unknown worktree: ${args.worktreeName}\n`);
        break;
      case "live_lock":
        args.io.stderr(
          `worktree is in use by process ${preflight.lock.pid} (started at ${preflight.lock.started_at})\n`,
        );
        return 9;
      case "branch_resolve_failed":
        args.io.stderr(`cannot abandon ${args.worktreeName}: could not determine branch\n`);
        break;
      case "pr_ineligible": {
        const { branch, eligibility } = preflight;
        switch (eligibility.kind) {
          case "merged":
            args.io.stderr(`cannot abandon ${args.worktreeName}: branch ${branch} PR is merged\n`);
            break;
          case "inspection_failed":
            args.io.stderr(`failed to inspect PR state for branch ${branch}: ${eligibility.message}\n`);
            break;
          case "multiple_open":
            args.io.stderr(`unsafe PR state for branch ${branch}: multiple open PRs match; refusing abandon\n`);
            break;
          case "ready_pr":
            args.io.stderr(
              `unsafe PR state for branch ${branch}: matching open PR #${eligibility.prNumber} is not draft\n`,
            );
            break;
        }
        break;
      }
    }
    return 1;
  }

  const { branch } = preflight;
  const item: CleanupItem = { path: worktreePath, branch, dir: args.worktreeName };
  const tag = isPlanBranch(branch) ? " (plan)" : "";
  args.io.stdout("\nWorktree to remove:\n");
  args.io.stdout(`${worktreePath} (${branch}${tag})\n`);

  if (args.dryRun) {
    return 0;
  }

  const response = args.io.readlineSync("\nRemove these worktrees? [y/N] ");
  if (!["y", "yes"].includes(response.toLowerCase())) {
    args.io.stdout("cancelled\n");
    return 0;
  }

  try {
    retireAbandonedWorktree({
      closePrFn: args.deps.closePr,
      deleteLocalBranchFn: args.deps.deleteLocalBranch,
      deleteRemoteBranchFn: args.deps.deleteRemoteBranch,
      findMatchingOpenPrsFn: args.deps.findMatchingOpenPrs,
      item,
      projectRoot: args.projectRoot,
      io: args.io,
    });
    args.io.stdout(`removed ${branch}${tag}\n`);
    return 0;
  } catch (err) {
    args.io.stderr(`failed to remove ${item.branch}: ${(err as Error).message}\n`);
    return 1;
  }
}

function retireAbandonedWorktree(args: {
  closePrFn: (prNumber: number, cwd?: string) => void;
  deleteLocalBranchFn: (projectRoot: string, branchName: string) => void;
  deleteRemoteBranchFn: (projectRoot: string, branchName: string) => void;
  findMatchingOpenPrsFn: (branch: string, cwd?: string) => MatchingOpenPr[];
  item: CleanupItem;
  projectRoot: string;
  io: CleanupIo;
}): void {
  const matchingPr = args.findMatchingOpenPrsFn(args.item.branch, args.projectRoot)[0];
  if (matchingPr !== undefined) {
    try {
      args.closePrFn(matchingPr.number, args.projectRoot);
    } catch (err) {
      args.io.stderr(`failed to close PR #${matchingPr.number} for ${args.item.branch}: ${(err as Error).message}\n`);
    }
  }

  execFileSync("git", ["worktree", "remove", "--force", args.item.path], {
    cwd: args.projectRoot,
    stdio: "pipe",
  });
  args.deleteLocalBranchFn(args.projectRoot, args.item.branch);
  args.deleteRemoteBranchFn(args.projectRoot, args.item.branch);
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
