import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { realSubprocessRunner, type SubprocessRunner } from "../../../shared/subprocess.ts";
import { stripPlanSpecTimestampPrefix } from "../modes/plan/spec-paths.ts";
import { closePr, findMatchingOpenPrs, type MatchingOpenPr } from "../pr.ts";
import { checkAbandonPrEligibility, checkScopedAbandonPreflight, isMergedPr } from "../scoped-abandon-preflight.ts";
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
  runner?: SubprocessRunner;
};

type CleanupItem = { path: string; branch: string; dir: string };
type CleanupDeps = Required<
  Pick<
    CleanupCommandOptions,
    "isMergedPr" | "findMatchingOpenPrs" | "closePr" | "deleteLocalBranch" | "deleteRemoteBranch"
  >
>;

function branchForWorktree(worktreePath: string, runner: SubprocessRunner): string {
  return runner.run("git", ["rev-parse", "--abbrev-ref", "HEAD"], worktreePath).trim();
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

function findArchivableRootSpecs(args: {
  projectRoot: string;
  targetDir: string;
  scopedSpecName?: string;
  io: CleanupIo;
  findMatchingOpenPrs: (branch: string, cwd?: string) => MatchingOpenPr[];
}): Array<{ source: string; specName: string }> {
  const { projectRoot, targetDir, scopedSpecName, io, findMatchingOpenPrs } = args;
  const rootDir = join(projectRoot, targetDir);
  if (!existsSync(rootDir)) {
    return [];
  }

  const entries = readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "completed")
    .map((entry) => entry.name)
    .filter((name) => scopedSpecName === undefined || name === scopedSpecName);

  const candidates: Array<{ source: string; specName: string }> = [];
  for (const specName of entries) {
    const source = join(rootDir, specName);
    if (resolveCompletionSpecFile(source) === null) {
      continue;
    }
    if (
      checkArchivePreconditions({
        io,
        projectRoot,
        source,
        specName,
        removedWorktreeDir: "",
        findMatchingOpenPrs,
      })
    ) {
      candidates.push({ source, specName });
    }
  }
  return candidates;
}

function archiveRootSpecs(args: {
  io: CleanupIo;
  projectRoot: string;
  targetDir: string;
  candidates: Array<{ source: string; specName: string }>;
  runner: SubprocessRunner;
}): boolean {
  const rootDir = join(args.projectRoot, args.targetDir);
  let hadFailures = false;
  for (const candidate of args.candidates) {
    const archived = archiveResolvedSpec({
      io: args.io,
      branch: candidate.specName,
      dir: candidate.specName,
      archiveRoot: rootDir,
      source: candidate.source,
      specName: candidate.specName,
      missingSource: candidate.source,
      onArchive: (destination, resolvedSpecName) => {
        commitArchivedSpecMove(args.projectRoot, candidate.source, destination, resolvedSpecName, args.runner);
      },
    });
    if (!archived) {
      hadFailures = true;
    }
  }
  return hadFailures;
}

function deleteMergedBranch(projectRoot: string, branch: string, runner: SubprocessRunner): void {
  try {
    runner.run("git", ["branch", "-d", branch], projectRoot);
  } catch {
    runner.run("git", ["branch", "-D", branch], projectRoot);
  }
}

function commitArchivedSpecMove(
  projectRoot: string,
  source: string,
  destination: string,
  specName: string,
  runner: SubprocessRunner,
): void {
  const sourceRelativePath = relative(projectRoot, source);
  const destinationRelativePath = relative(projectRoot, destination);

  runner.run("git", ["add", "-A", "--", destinationRelativePath], projectRoot);
  const trackedStdout = runner.run("git", ["ls-files", "--", sourceRelativePath], projectRoot);
  const trackedSourcePaths = trackedStdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);

  for (const trackedSourcePath of trackedSourcePaths) {
    runner.run("git", ["rm", "--cached", "--ignore-unmatch", "--", trackedSourcePath], projectRoot);
  }
  runner.run("git", ["commit", "-m", `cleanup: archive spec ${specName}`], projectRoot);
  runner.run("git", ["push"], projectRoot);
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

  const runner = opts.runner ?? realSubprocessRunner;

  if (abandon && opts.worktreeName !== undefined) {
    return scopedAbandonCleanup({
      deps,
      dryRun: opts.dryRun ?? false,
      io: opts.io,
      projectRoot: opts.projectRoot,
      worktreeName: opts.worktreeName,
      runner,
    });
  }

  if (!abandon && opts.worktreeName !== undefined) {
    return scopedRootArchivalCleanup({
      commit,
      dryRun: opts.dryRun ?? false,
      io: opts.io,
      projectRoot: opts.projectRoot,
      targetDir,
      specName: opts.worktreeName,
      findMatchingOpenPrs: deps.findMatchingOpenPrs,
      runner,
    });
  }

  const worktrees = readdirSync(worktreeDir).filter((name) => name !== ".keep");

  const toRemove: CleanupItem[] = [];

  for (const worktreeName of worktrees) {
    const worktreePath = join(worktreeDir, worktreeName);
    let branch: string;
    try {
      branch = branchForWorktree(worktreePath, runner);
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

    toRemove.push({ path: worktreePath, branch, dir: worktreeName });
  }

  const rootCandidates =
    !abandon && commit
      ? findArchivableRootSpecs({
          projectRoot: opts.projectRoot,
          targetDir,
          io: opts.io,
          findMatchingOpenPrs: deps.findMatchingOpenPrs,
        })
      : [];

  if (toRemove.length === 0 && rootCandidates.length === 0) {
    opts.io.stdout(abandon ? "no abandoned worktrees to remove\n" : "no merged worktrees to remove\n");
    return 0;
  }

  if (toRemove.length > 0) {
    opts.io.stdout("\nWorktrees to remove:\n");
    for (const item of toRemove) {
      const tag = isPlanBranch(item.branch) ? " (plan)" : "";
      opts.io.stdout(`  ${item.branch}${tag}\n`);
    }
  }

  if (rootCandidates.length > 0) {
    opts.io.stdout("\nRoot specs to archive:\n");
    for (const candidate of rootCandidates) {
      opts.io.stdout(`  ${candidate.specName}\n`);
    }
  }

  if (opts.dryRun) {
    return 0;
  }

  if (toRemove.length > 0) {
    const response = opts.io.readlineSync("\nRemove these worktrees? [y/N] ");
    if (!["y", "yes"].includes(response.toLowerCase())) {
      opts.io.stdout("cancelled\n");
      return 0;
    }
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
          runner,
        });
      } else if (opts.removeItem) {
        opts.removeItem(item);
      } else {
        runner.run("git", ["worktree", "remove", "--force", item.path], opts.projectRoot);
        deleteMergedBranch(opts.projectRoot, item.branch, runner);
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
          commitArchivedSpecMove(opts.projectRoot, r.source, destination, resolvedSpecName, runner);
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

  if (
    archiveRootSpecs({
      io: opts.io,
      projectRoot: opts.projectRoot,
      targetDir,
      candidates: rootCandidates,
      runner,
    })
  ) {
    hadFailures = true;
  }

  return hadFailures ? 1 : 0;
}

function scopedRootArchivalCleanup(args: {
  commit: boolean;
  dryRun: boolean;
  io: CleanupIo;
  projectRoot: string;
  targetDir: string;
  specName: string;
  findMatchingOpenPrs: (branch: string, cwd?: string) => MatchingOpenPr[];
  runner: SubprocessRunner;
}): number {
  if (!args.commit) {
    args.io.stdout("no root specs to archive\n");
    return 0;
  }

  const candidates = findArchivableRootSpecs({
    projectRoot: args.projectRoot,
    targetDir: args.targetDir,
    scopedSpecName: args.specName,
    io: args.io,
    findMatchingOpenPrs: args.findMatchingOpenPrs,
  });

  if (candidates.length === 0) {
    args.io.stdout("no root specs to archive\n");
    return 0;
  }

  args.io.stdout("\nRoot specs to archive:\n");
  for (const candidate of candidates) {
    args.io.stdout(`  ${candidate.specName}\n`);
  }

  if (args.dryRun) {
    return 0;
  }

  const hadFailures = archiveRootSpecs({
    io: args.io,
    projectRoot: args.projectRoot,
    targetDir: args.targetDir,
    candidates,
    runner: args.runner,
  });

  return hadFailures ? 1 : 0;
}

function scopedAbandonCleanup(args: {
  deps: CleanupDeps;
  dryRun: boolean;
  io: CleanupIo;
  projectRoot: string;
  worktreeName: string;
  runner: SubprocessRunner;
}): number {
  const worktreePath = join(args.projectRoot, ".worktree", args.worktreeName);
  const preflight = checkScopedAbandonPreflight({
    projectRoot: args.projectRoot,
    worktreePath,
    deps: { ...args.deps, runner: args.runner },
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
      runner: args.runner,
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
  runner: SubprocessRunner;
}): void {
  const matchingPr = args.findMatchingOpenPrsFn(args.item.branch, args.projectRoot)[0];
  if (matchingPr !== undefined) {
    try {
      args.closePrFn(matchingPr.number, args.projectRoot);
    } catch (err) {
      args.io.stderr(`failed to close PR #${matchingPr.number} for ${args.item.branch}: ${(err as Error).message}\n`);
    }
  }

  args.runner.run("git", ["worktree", "remove", "--force", args.item.path], args.projectRoot);
  args.deleteLocalBranchFn(args.projectRoot, args.item.branch);
  args.deleteRemoteBranchFn(args.projectRoot, args.item.branch);
}
