import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { branchExistsOnOrigin } from "../../../../shared/git.ts";
import { type PatchTier, parseRunnableIndexTier, parseSpec } from "../../../../shared/spec-parser.ts";
import { createAgent } from "../../agents/factory.ts";
import type { Agent } from "../../agents/types.ts";
import { readGitOriginUrl } from "../../commands/init.ts";
import {
  CONFIG_DIR,
  type Config,
  effectiveGit,
  filterAgentsByCapabilityFloor,
  findProjectMatchForPath,
  type ProjectMatch,
  resolveReviewPasses,
  resolveSubRoleAgentOrder,
  setProjectOrigin,
} from "../../config.ts";
import { assertGhReady, withSyncTransientRetry } from "../../gh.ts";
import { closePr, findMatchingOpenPrs, type MatchingOpenPr } from "../../pr.ts";
import {
  bestEffortFetch,
  deleteLocalBranch,
  deleteRemoteBranch,
  getPatchWorktreePath,
  getSpecName,
  removePatchWorktree,
} from "../../worktree.ts";
import {
  acquireWorktreeLock,
  getWorktreeLockPath,
  isProcessAlive,
  releaseWorktreeLock,
  type WorktreeLock,
} from "../../worktree-lock.ts";
import { computeProjectSafeId } from "../plan/spec-paths.ts";
import { countUnchecked, getActiveLinkedSubspecPath } from "./completion.ts";
import { applyReset, clearDelta, loadDelta } from "./no-commit-delta.ts";
import type { PreflightOk, RunCommandOptions, RunIo } from "./run.ts";

type PreflightResult = PreflightOk | { kind: "error"; exitCode: number } | { kind: "exit"; exitCode: number };

function resolvePatchTierStartIndex(tier: PatchTier, ladderLength: number): number {
  if (ladderLength <= 1) {
    return 0;
  }
  switch (tier) {
    case "trivial":
      return 0;
    case "standard":
      return Math.min(1, ladderLength - 1);
    case "hard":
      return ladderLength - 1;
  }
}

function resolvePatchTier(
  specPath: string,
  tierOverride: PatchTier | undefined,
): { tier: PatchTier } | { error: string } {
  if (tierOverride !== undefined) {
    return { tier: tierOverride };
  }
  const content = existsSync(specPath) ? readSpecFile(specPath) : undefined;
  if (content === undefined) {
    return { tier: "trivial" };
  }
  const parsed = parseRunnableIndexTier(content);
  if (parsed.error !== undefined) {
    return { error: `error: ${parsed.error}` };
  }
  return { tier: parsed.tier ?? "trivial" };
}

function readSpecFile(specPath: string): string | undefined {
  try {
    return readFileSync(specPath, "utf8");
  } catch {
    return undefined;
  }
}

export async function resolveModeSpecificPreflight(
  opts: RunCommandOptions,
  initialSpecPath: string,
  project: ProjectMatch,
  projectMode: "registered" | "ad-hoc",
  cfg: Config,
): Promise<PreflightResult> {
  const gitEnabled = effectiveGit(cfg, projectMode === "registered" ? project.key : undefined);

  if (opts.cwdFlag !== undefined && gitEnabled) {
    opts.io.stderr(
      'error: --cwd is only valid when effective `git` is false; set "git": false in config to use --cwd\n',
    );
    return { kind: "error", exitCode: 1 };
  }
  let cwdOverride: string | undefined;
  if (opts.cwdFlag !== undefined) {
    cwdOverride = resolve(opts.cwdFlag);
    if (!existsSync(cwdOverride)) {
      opts.io.stderr(`error: --cwd directory does not exist: ${cwdOverride}\n`);
      return { kind: "error", exitCode: 1 };
    }
  }
  if (gitEnabled && !opts.skipGhCheck && !existsSync(join(project.root, ".git"))) {
    opts.io.stderr(
      'error: target is not a git checkout; set "git": false in config or pass --repo to a git checkout\n',
    );
    return { kind: "error", exitCode: 1 };
  }

  // Lazily populate `origin` for a registered project whose record is missing
  // it. Failures here do not block the run. Skipped in ad-hoc mode.
  if (projectMode === "registered") {
    try {
      const match = findProjectMatchForPath(project.root, opts.config);
      if (match !== undefined && match.origin === undefined) {
        const origin = readGitOriginUrl(match.root);
        if (origin !== undefined) {
          setProjectOrigin(match.key, origin, opts.config);
        }
      }
    } catch {
      // best-effort
    }
  }

  if (!opts.skipGhCheck && gitEnabled) {
    try {
      await assertGhReady();
    } catch (err) {
      opts.io.stderr(`${(err as Error).message}\n`);
      return { kind: "error", exitCode: 1 };
    }
  }

  // Handle --resume-review guards (run before ensureWorktree)
  if (opts.resumeReview) {
    // Guard 1: review disabled
    const reviewPasses = resolveReviewPasses(cfg, opts.reviewPasses);
    if (reviewPasses === 0) {
      opts.io.stderr(
        "error: --resume-review requires review passes > 0; enable review in config or pass --review-passes <n>\n",
      );
      return { kind: "error", exitCode: 1 };
    }

    // Guard 2: git off
    if (!gitEnabled) {
      opts.io.stderr('error: --resume-review requires git mode to be enabled; set "git": true in config\n');
      return { kind: "error", exitCode: 1 };
    }

    // Guard 3: no implementation PR / remote branch
    const specName = getSpecName(initialSpecPath);
    bestEffortFetch(project.root);
    if (!branchExistsOnOrigin(project.root, specName)) {
      opts.io.stderr(`error: no implementation PR exists for spec ${specName}; no remote branch found\n`);
      return { kind: "error", exitCode: 1 };
    }

    // Guard 4: incomplete spec
    if (countUnchecked(initialSpecPath) !== 0) {
      opts.io.stderr("error: spec has unchecked tasks; --resume-review only works on complete specs\n");
      return { kind: "error", exitCode: 1 };
    }
  }

  const cleanupSpecPath = deriveCleanupSpecPath(initialSpecPath);
  const trackSourceSpecDelta = isJarvisManagedExternalSpecPath(cleanupSpecPath, project, opts.config?.dir);
  if (gitEnabled && trackSourceSpecDelta) {
    resetTrackedSourceSpecDelta(cleanupSpecPath);
    const cleanupResult = await maybeCleanupStaleExternalSpecWorkspace({
      projectRoot: project.root,
      specPath: cleanupSpecPath,
      io: opts.io,
    });
    if (cleanupResult.kind === "error") {
      return cleanupResult;
    }
  }

  let agentWorkingDir = cwdOverride ?? project.root;
  let worktreeLocked = false;
  let stalepidRecovered: number | undefined;
  let patchWorktreePrepared = false;
  if (!opts.skipGhCheck && gitEnabled) {
    try {
      const { createWorktreeSymlinks, ensureWorktree } = await import("../../worktree.ts");
      agentWorkingDir = await ensureWorktree(project.root, initialSpecPath);
      patchWorktreePrepared = true;
      createWorktreeSymlinks(project.root, agentWorkingDir, cfg.worktreeSymlinks);

      const lockResult = acquireWorktreeLock(agentWorkingDir);
      if (lockResult.kind === "busy") {
        const lockInfo = lockResult.existingLock;
        opts.io.stderr(`worktree is in use by process ${lockInfo.pid} (started at ${lockInfo.started_at})\n`);
        return { kind: "error", exitCode: 9 };
      }
      if (lockResult.kind === "recovered") {
        stalepidRecovered = lockResult.stalepid;
      }
      worktreeLocked = true;
    } catch (err) {
      opts.io.stderr(`failed to create or resume worktree: ${(err as Error).message}\n`);
      return { kind: "error", exitCode: 1 };
    }
  }
  let preflightOk = false;
  try {
    let specPath = prepareActiveSpecPath({
      projectRoot: project.root,
      agentWorkingDir,
      specPath: initialSpecPath,
    });
    if (patchWorktreePrepared) {
      try {
        (opts.__testWriteActiveSpecPathMarker ?? writeActiveSpecPathMarker)(agentWorkingDir, specPath);
      } catch (err) {
        opts.io.stderr(`failed to write .active-spec-path marker: ${(err as Error).message}\n`);
        return { kind: "error", exitCode: 1 };
      }
    }
    const specDirs = specOutsideWorktreeReadDirs({
      specPath,
      agentWorkingDir,
    });

    // Reset delta for any external spec (broad predicate: outside agent working tree)
    // This covers external specs regardless of whether they're in the Jarvis-managed dir
    if (gitEnabled && specDirs !== undefined) {
      resetTrackedSourceSpecDelta(specPath);
    }

    const projectSiblings = cfg.projects[project.key]?.siblings ?? [];
    for (const sibling of projectSiblings) {
      if (!existsSync(sibling)) {
        opts.io.stderr(
          `error: configured sibling ${JSON.stringify(sibling)} does not exist for project ${JSON.stringify(project.key)}\n`,
        );
        return { kind: "error", exitCode: 1 };
      }
    }
    const additionalReadDirs =
      specDirs !== undefined || projectSiblings.length > 0
        ? [...new Set([...(specDirs ?? []), ...projectSiblings])]
        : undefined;

    let isIndexSpec = basename(specPath) === "index.md";
    if (!isIndexSpec) {
      const specDir = dirname(specPath);
      const siblingIndex = resolve(specDir, "index.md");
      const hasSiblingIndex = existsSync(siblingIndex);

      const promptLines = [
        `${specPath} is not an index spec.`,
        ...(hasSiblingIndex ? ["  [s] switch to ./index.md and run normally"] : []),
        "  [e] exit",
        "Choice [e]: ",
      ];
      const promptText = promptLines.join("\n");
      opts.io.stdout(promptText);
      const answer = (await (opts.confirmRun ?? confirmFromStdin)(promptText)).trim().toLowerCase();

      if (answer === "s" && hasSiblingIndex) {
        specPath = siblingIndex;
        isIndexSpec = true;
      } else {
        // e, empty input, or unrecognized
        return { kind: "exit", exitCode: 0 };
      }
    }

    maybeWarnAboutUnmergedPlanBranch({
      io: opts.io,
      projectRoot: project.root,
      specPath,
      gitEnabled,
    });

    const resolvedPatchTier = resolvePatchTier(specPath, opts.tierOverride);
    if ("error" in resolvedPatchTier) {
      opts.io.stderr(`${resolvedPatchTier.error}\n`);
      return { kind: "error", exitCode: 1 };
    }

    const specIsExternal = specDirs !== undefined;
    preflightOk = true;
    return {
      kind: "ok",
      project,
      projectMode,
      cfg,
      gitEnabled,
      agentWorkingDir,
      worktreeLocked,
      stalepidRecovered,
      specPath,
      additionalReadDirs,
      patchTier: resolvedPatchTier.tier,
      trackSourceSpecDelta,
      specIsExternal,
    };
  } finally {
    if (!preflightOk && worktreeLocked) {
      releaseWorktreeLock(agentWorkingDir);
      worktreeLocked = false;
    }
  }
}

function deriveCleanupSpecPath(specPath: string): string {
  if (basename(specPath) === "index.md") {
    return specPath;
  }
  const siblingIndex = resolve(dirname(specPath), "index.md");
  return existsSync(siblingIndex) ? siblingIndex : specPath;
}

function isJarvisManagedExternalSpecPath(specPath: string, project: ProjectMatch, configDir?: string): boolean {
  const expectedRoot = join(configDir ?? CONFIG_DIR, "specs", computeProjectSafeId(project), getSpecName(specPath));
  return dirname(resolve(specPath)) === expectedRoot;
}

function hasUncheckedAutomatedCriteria(indexPath: string): boolean {
  const parsedIndex = parseSpec(readFileSync(indexPath, "utf8"));
  const activeSubspec = parsedIndex.linkedSubspecs.find((item) => !item.checked);
  if (activeSubspec === undefined) {
    return false;
  }
  const activeSubspecPath = resolve(dirname(indexPath), activeSubspec.path);
  const parsedSubspec = parseSpec(readFileSync(activeSubspecPath, "utf8"));
  return parsedSubspec.acceptanceCriteria.some((criterion) => !criterion.checked && !criterion.humanOnly);
}

function resetTrackedSourceSpecDelta(indexPath: string): void {
  const activeSubspecPath = getActiveLinkedSubspecPath(indexPath);
  if (activeSubspecPath === undefined) {
    return;
  }
  const priorDelta = loadDelta(activeSubspecPath);
  if (priorDelta === null) {
    return;
  }
  applyReset(activeSubspecPath, priorDelta);
  clearDelta(activeSubspecPath);
}

function readLiveWorktreeLock(worktreePath: string): WorktreeLock | null {
  const lockPath = getWorktreeLockPath(worktreePath);
  if (!existsSync(lockPath)) {
    return null;
  }
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as WorktreeLock;
    return isProcessAlive(lock.pid) ? lock : null;
  } catch {
    return null;
  }
}

async function maybeCleanupStaleExternalSpecWorkspace(args: {
  projectRoot: string;
  specPath: string;
  io: RunIo;
}): Promise<{ kind: "ok" } | { kind: "error"; exitCode: number }> {
  if (!hasUncheckedAutomatedCriteria(args.specPath)) {
    return { kind: "ok" };
  }

  const specName = getSpecName(args.specPath);
  const worktreePath = getPatchWorktreePath(args.projectRoot, specName);
  const liveLock = readLiveWorktreeLock(worktreePath);
  if (liveLock !== null) {
    args.io.stderr(`worktree is in use by process ${liveLock.pid} (started at ${liveLock.started_at})\n`);
    return { kind: "error", exitCode: 9 };
  }

  bestEffortFetch(args.projectRoot);

  let matchingOpenPrs: MatchingOpenPr[];
  try {
    matchingOpenPrs = findMatchingOpenPrs(specName, args.projectRoot);
  } catch (err) {
    args.io.stderr(`failed to inspect stale PR state for branch ${specName}: ${(err as Error).message}\n`);
    return { kind: "error", exitCode: 1 };
  }

  if (matchingOpenPrs.length > 1) {
    args.io.stderr(`unsafe PR state for branch ${specName}: multiple open PRs match; refusing cleanup\n`);
    return { kind: "error", exitCode: 1 };
  }

  const matchingPr = matchingOpenPrs[0];
  if (matchingPr !== undefined && !matchingPr.isDraft) {
    args.io.stderr(`unsafe PR state for branch ${specName}: matching open PR #${matchingPr.number} is not draft\n`);
    return { kind: "error", exitCode: 1 };
  }

  if (matchingPr !== undefined) {
    try {
      withSyncTransientRetry(() => closePr(matchingPr.number, args.projectRoot), { op: "gh pr close" });
    } catch (err) {
      args.io.stderr(
        `failed to close stale draft PR #${matchingPr.number} for branch ${specName}: ${(err as Error).message}\n`,
      );
      return { kind: "error", exitCode: 1 };
    }
  }

  try {
    removePatchWorktree(args.projectRoot, specName);
  } catch (err) {
    args.io.stderr(`failed to remove stale worktree for ${specName}: ${(err as Error).message}\n`);
    return { kind: "error", exitCode: 1 };
  }

  try {
    deleteLocalBranch(args.projectRoot, specName);
  } catch (err) {
    args.io.stderr(`failed to remove stale local branch ${specName}: ${(err as Error).message}\n`);
    return { kind: "error", exitCode: 1 };
  }

  try {
    deleteRemoteBranch(args.projectRoot, specName);
  } catch (err) {
    args.io.stderr(`failed to remove stale remote branch origin/${specName}: ${(err as Error).message}\n`);
    return { kind: "error", exitCode: 1 };
  }

  return { kind: "ok" };
}

function deriveSpecNameFromPath(specPath: string): string {
  return basename(dirname(resolve(specPath)));
}

function readRemoteHeadBranch(projectRoot: string): string | null {
  try {
    const output = execFileSync("git", ["ls-remote", "--symref", "origin", "HEAD"], {
      cwd: projectRoot,
      env: process.env,
      stdio: "pipe",
      encoding: "utf8",
    });
    for (const line of output.split("\n")) {
      const match = /^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/.exec(line.trim());
      if (match?.[1]) {
        return match[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function readRemoteHeadSha(projectRoot: string, ref: string): string | null {
  try {
    const output = execFileSync("git", ["ls-remote", "--heads", "origin", ref], {
      cwd: projectRoot,
      env: process.env,
      stdio: "pipe",
      encoding: "utf8",
    });
    const firstLine = output
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (firstLine === undefined) {
      return null;
    }
    const sha = firstLine.split(/\s+/)[0];
    return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export function maybeWarnAboutUnmergedPlanBranch(args: {
  io: RunIo;
  projectRoot: string;
  specPath: string;
  gitEnabled: boolean;
}): void {
  if (!args.gitEnabled) {
    return;
  }
  const specName = deriveSpecNameFromPath(args.specPath);
  const planRef = `plan/${specName}`;
  const planSha = readRemoteHeadSha(args.projectRoot, planRef);
  if (planSha === null) {
    return;
  }

  const defaultBranch = readRemoteHeadBranch(args.projectRoot);
  if (defaultBranch === null) {
    return;
  }
  const defaultSha = readRemoteHeadSha(args.projectRoot, defaultBranch);
  if (defaultSha === null) {
    return;
  }

  const mergeCheck = spawnSync("git", ["merge-base", "--is-ancestor", planSha, defaultSha], {
    cwd: args.projectRoot,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (mergeCheck.status !== 1) {
    return;
  }
  args.io.stderr(
    `warning: a plan branch ${planRef} exists on origin and has not been merged. Run \`jarvis1 run\` after merging the plan PR to avoid drift between the spec on disk and the merged spec.\n`,
  );
}

export function buildActiveAgents(opts: RunCommandOptions, cfg: Config, patchTier: PatchTier): Agent[] {
  const overrides = opts.agents;
  const agents: Agent[] = [];
  const eligibleAgents = filterAgentsByCapabilityFloor(
    resolveSubRoleAgentOrder(cfg, "patchActuator"),
    cfg.modes.patch.actuationCapabilityFloor,
  );
  const startIndex = resolvePatchTierStartIndex(patchTier, eligibleAgents.length);
  for (const entry of eligibleAgents.slice(startIndex)) {
    const override = overrides?.[entry.agent];
    if (override !== undefined) {
      agents.push(override);
      continue;
    }
    agents.push(createAgent(entry.agent, entry.model));
  }
  return agents;
}

function specOutsideWorktreeReadDirs(opts: { specPath: string; agentWorkingDir: string }): string[] | undefined {
  const agentWorkingDir = resolve(opts.agentWorkingDir);
  const specPath = resolve(opts.specPath);
  const rel = relative(agentWorkingDir, specPath);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return undefined;
  }
  return [dirname(specPath)];
}

export function refreshActiveSpecPath(preflight: PreflightOk): string {
  const activeSpecPath = findRelocatedSpecFile(preflight.specPath, preflight.agentWorkingDir);
  preflight.specPath = activeSpecPath;
  return activeSpecPath;
}

export function findRelocatedSpecFile(previousPath: string, searchRoot: string): string {
  if (existsSync(previousPath)) {
    return previousPath;
  }

  const previousDirName = basename(dirname(previousPath));
  const previousFileName = basename(previousPath);
  const matches: string[] = [];
  findRelocatedSpecFileMatches(resolve(searchRoot), previousDirName, previousFileName, matches);

  return matches.length === 1 ? (matches[0] ?? previousPath) : previousPath;
}

function findRelocatedSpecFileMatches(dir: string, parentName: string, fileName: string, matches: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      findRelocatedSpecFileMatches(entryPath, parentName, fileName, matches);
      continue;
    }

    if (entry.isFile() && entry.name === fileName && basename(dirname(entryPath)) === parentName) {
      matches.push(entryPath);
    }
  }
}

export function prepareActiveSpecPath(opts: {
  projectRoot: string;
  agentWorkingDir: string;
  specPath: string;
}): string {
  const projectRoot = resolve(opts.projectRoot);
  const agentWorkingDir = resolve(opts.agentWorkingDir);
  const specPath = resolve(opts.specPath);
  if (projectRoot === agentWorkingDir) {
    return specPath;
  }

  const relativeSpecPath = relative(projectRoot, specPath);
  if (relativeSpecPath.startsWith("..") || relativeSpecPath.startsWith("/")) {
    return specPath;
  }

  const activeSpecPath = resolve(agentWorkingDir, relativeSpecPath);
  if (!existsSync(activeSpecPath)) {
    copyMissingRecursive(dirname(specPath), dirname(activeSpecPath));
  }
  return activeSpecPath;
}

function writeActiveSpecPathMarker(worktreeDir: string, activeSpecPath: string): void {
  ensureWorktreeLocalExcludeEntry(worktreeDir, ".active-spec-path");
  writeFileSync(join(worktreeDir, ".active-spec-path"), activeSpecPath, "utf8");
}

function ensureWorktreeLocalExcludeEntry(worktreeDir: string, entry: string): void {
  let excludePath: string;
  try {
    const out = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: worktreeDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!out) return;
    excludePath = out.startsWith("/") ? out : join(worktreeDir, out);
  } catch {
    return;
  }

  mkdirSync(dirname(excludePath), { recursive: true });

  let existing = "";
  try {
    existing = readFileSync(excludePath, "utf8");
  } catch {
    // file may not exist yet; treat as empty
  }

  const hasEntry = existing.split("\n").some((line) => line.trim() === entry);
  if (hasEntry) return;

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(excludePath, `${existing}${prefix}${entry}\n`, "utf8");
}

function copyMissingRecursive(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (existsSync(targetPath)) {
      if (entry.isDirectory()) {
        copyMissingRecursive(sourcePath, targetPath);
      }
      continue;
    }

    cpSync(sourcePath, targetPath, {
      recursive: entry.isDirectory(),
      force: false,
      errorOnExist: false,
    });
  }
}

async function confirmFromStdin(_prompt: string): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const newline = buffer.indexOf(10);
    if (newline !== -1) {
      chunks.push(buffer.subarray(0, newline));
      break;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
