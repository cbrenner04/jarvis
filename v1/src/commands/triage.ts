import { execFileSync, execSync } from "node:child_process";
import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseSpec } from "../../../shared/spec-parser.ts";
import { type CiCheckState, classifyCiChecks, fetchCommitChecksForSha } from "../ci-checks.ts";
import { appendAgentTrailer } from "../commit-trailer.ts";
import type { ConfigOptions } from "../config.ts";
import { CONFIG_DIR, DEFAULT_CONFIG, findProjectMatchForPath, loadConfig, resolvePlanFlags } from "../config.ts";
import { getBaseBranch, withSyncTransientRetry } from "../gh.ts";
import { type BaseCurrentCheckResult, checkBaseCurrentForFinalize } from "../git/base-current.ts";
import { countUnchecked, getActiveLinkedSubspecPath, getFirstUncheckedTask } from "../modes/patch/completion.ts";
import { generatePrBody, getIndexTitle } from "../modes/patch/completion-pipeline.ts";
import { findRelocatedSpecFile, prepareActiveSpecPath } from "../modes/patch/preflight.ts";
import { snapshotAcceptanceCriteria } from "../modes/patch/subspec.ts";
import { stripPlanSpecTimestampPrefix } from "../modes/plan/spec-paths.ts";
import { type EnsureDraftPrOpts, ensureDraftPr, findMatchingOpenPrs, renderAttributionSummary } from "../pr.ts";
import { ReadyCommandError, runReadyGateWithTier } from "../ready-gate.ts";
import { checkScopedAbandonPreflight, isMergedPr } from "../scoped-abandon-preflight.ts";
import { hasUpstream, pushCurrent } from "../worktree.ts";
import { getWorktreeLockPath, isProcessAlive, type WorktreeLock } from "../worktree-lock.ts";
import { emitMergeRefusal, type MergeTargetResolutionSeams, resolveMergeTarget } from "./resolve-merge-target.ts";

export type TriageIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type { CiCheckState };

export type TriageGhRunner = {
  getPrState: (branch: string) => { state: string; isDraft: boolean } | null;
  getMergeGateState?: (branch: string) => { mergeStateStatus: string } | null;
  getChecks?: (branch: string) => CiCheckState[] | null;
  getChecksForSha?: (sha: string) => CiCheckState[] | null;
};

export type CommitAndPushDirtyResult =
  | { ok: true }
  | { ok: false; reason: "still-dirty" | "commit-failed" | "push-failed"; message?: string };

export type TriageCommandOptions = {
  projectRoot: string;
  io: TriageIo;
  config?: ConfigOptions;
  cwd?: string;
  worktreeName?: string;
  worktreePath?: string;
  markReady?: boolean;
  merge?: boolean;
  ghRunner?: TriageGhRunner;
  mergeTargetSeams?: MergeTargetResolutionSeams;
  runGate?: (cwd: string, readyCommand?: string, fixCommand?: string, timeoutMs?: number) => void;
  prReady?: (branch: string, cwd: string) => void;
  commitAndPushDirty?: (worktreePath: string) => CommitAndPushDirtyResult;
  pushCurrent?: typeof pushCurrent;
  checkBaseCurrent?: (opts: {
    branch: string;
    cwd: string;
    hasOpenPr: boolean;
  }) => Promise<BaseCurrentCheckResult> | BaseCurrentCheckResult;
  ensureDraftPr?: (opts: EnsureDraftPrOpts) => Promise<{ number: number; created: boolean }>;
  adminMerge?: (branch: string, cwd: string) => void;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  runRecoveryProbe?: (cwd: string, args: string[]) => number;
};

export type DirtyKind = "clean" | "untracked-only" | "modified" | "mixed";
export type PrState = "none" | "DRAFT" | "OPEN" | "MERGED" | "CLOSED" | "unknown";

export type SuggestedMovesInput = {
  dirtyKind: DirtyKind;
  unpushed: number;
  prState: PrState;
  specComplete: boolean;
  worktreePath: string;
  worktreeName: string;
  scopedAbandonEligible: boolean;
  specPath?: string | undefined;
};

export function getSuggestedMoves(input: SuggestedMovesInput): string[] {
  for (const rule of suggestedMovesRules) {
    if (rule.match(input)) {
      return rule.format(input);
    }
  }
  return defaultSuggestedMove(input);
}

export function triageCommand(opts: TriageCommandOptions): number | Promise<number> {
  const worktreeDir = join(opts.projectRoot, ".worktree");

  // Named form: drill-down for a specific worktree
  if (opts.worktreeName !== undefined) {
    if (opts.markReady) {
      return triageMarkReady(opts);
    }
    if (opts.merge) {
      const resolution = resolveMergeTarget(
        opts.projectRoot,
        opts.worktreeName,
        opts.cwd ?? process.cwd(),
        opts.io,
        opts.mergeTargetSeams,
        opts.config,
      );
      if (!resolution.ok) {
        return 1;
      }
      return triageMerge({ ...opts, worktreePath: resolution.worktreePath });
    }
    return triageDrillDown(opts.projectRoot, worktreeDir, opts.worktreeName, opts.io);
  }

  // No-arg form: list all worktrees with summary
  const ghRunner = opts.ghRunner || createDefaultGhRunner();
  const project = findProjectMatchForPath(opts.projectRoot, opts.config);
  const jarvisWorktreeDir =
    project === undefined ? undefined : join(opts.config?.dir ?? CONFIG_DIR, "worktrees", project.key);
  return triageListWorktrees(worktreeDir, jarvisWorktreeDir, opts.io, ghRunner);
}

type WorktreeStatus = {
  name: string;
  home: "v1" | "v2";
  dirtyStatus: string;
  aheadBehind: string;
  prState: string;
  specProgress: string;
  isLanded: boolean;
  isDraft?: boolean;
  prStateRaw?: string;
  gateState?: string;
};

type ListedWorktree = { home: "v1" | "v2"; name: string; path: string };

function listWorktrees(home: string, label: "v1" | "v2"): ListedWorktree[] {
  const worktrees: ListedWorktree[] = [];
  const visit = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".keep") continue;
      const path = join(dir, entry.name);
      if (existsSync(join(path, ".git"))) {
        worktrees.push({ home: label, name: relative(home, path), path });
      } else {
        visit(path);
      }
    }
  };
  visit(home);
  return worktrees;
}

function triageListWorktrees(
  worktreeDir: string,
  jarvisWorktreeDir: string | undefined,
  io: TriageIo,
  ghRunner: TriageGhRunner,
): number {
  const worktrees = [
    ...listWorktrees(worktreeDir, "v1"),
    ...(jarvisWorktreeDir === undefined ? [] : listWorktrees(jarvisWorktreeDir, "v2")),
  ];

  if (worktrees.length === 0) {
    io.stdout("no worktrees\n");
    return 0;
  }

  io.stdout("HOME\tNAME\t\tDIRTY\t\tAHEAD/BEHIND\tPR\t\tSPEC\n");

  const statuses: WorktreeStatus[] = [];

  for (const worktree of worktrees) {
    const { home, name: worktreeName, path: worktreePath } = worktree;
    const dirtyStatus = getDirtyStatusSummary(worktreePath);
    const aheadBehind = getAheadBehind(worktreePath);
    const prStateResult = ghRunner.getPrState(worktreeName);
    const prState = formatPrStateForDisplay(prStateResult);
    const specProgress = getSpecProgress(worktreePath);

    io.stdout(`${home}\t${worktreeName}\t\t${dirtyStatus}\t\t${aheadBehind}\t\t${prState}\t\t${specProgress}\n`);

    const status: WorktreeStatus = {
      name: worktreeName,
      home,
      dirtyStatus,
      aheadBehind,
      prState,
      specProgress,
      ...classifyWorktree(worktreePath, worktreeName, ghRunner, prStateResult),
    };

    // Fetch merge gate state for outstanding entries
    if (!status.isLanded && ghRunner.getMergeGateState) {
      const gateStateResult = ghRunner.getMergeGateState(worktreeName);
      status.gateState = gateStateResult?.mergeStateStatus || "unavailable";
    }

    statuses.push(status);
  }

  // Emit session-end verdict
  emitVerdict(io, statuses);

  return 0;
}

function createDefaultGhRunner(): TriageGhRunner {
  return {
    getPrState: (branch: string) => {
      try {
        const fullOutput = execSync(`gh pr view "${branch}" --json state,isDraft`, {
          stdio: "pipe",
          encoding: "utf8",
        });
        const prData = JSON.parse(fullOutput);
        return {
          state: prData.state || "unknown",
          isDraft: prData.isDraft ?? false,
        };
      } catch {
        return null;
      }
    },
    getMergeGateState: (branch: string) => {
      try {
        const fullOutput = execSync(`gh pr view "${branch}" --json mergeStateStatus`, {
          stdio: "pipe",
          encoding: "utf8",
        });
        const prData = JSON.parse(fullOutput);
        return {
          mergeStateStatus: prData.mergeStateStatus || "unavailable",
        };
      } catch {
        return null;
      }
    },
    getChecks: fetchGhPrChecks,
  };
}

const MERGE_CI_POLL_INTERVAL_MS = 10_000;
const MERGE_CI_POLL_TIMEOUT_MS = 30 * 60 * 1000;

function fetchGhPrChecks(branch: string): CiCheckState[] | null {
  try {
    const fullOutput = execSync(`gh pr checks "${branch}" --json name,state`, {
      stdio: "pipe",
      encoding: "utf8",
    });
    const checks = JSON.parse(fullOutput);
    if (!Array.isArray(checks)) {
      return null;
    }
    return checks.map((c: { name: string; state: string }) => ({
      name: c.name,
      status: normalizeGhCheckState(c.state),
    }));
  } catch {
    return null;
  }
}

function sleepMs(ms: number): void {
  const bunGlobal = (globalThis as { Bun?: { sleepSync?: (ms: number) => void } }).Bun;
  bunGlobal?.sleepSync?.(ms);
}

function normalizeGhCheckState(state: string): string {
  return state.toLowerCase();
}

function classifyWorktree(
  worktreePath: string,
  worktreeName: string,
  ghRunner: TriageGhRunner,
  prStateResult?: { state: string; isDraft: boolean } | null,
): { isLanded: boolean; isDraft?: boolean; prStateRaw?: string } {
  // Plan worktrees are never landed
  if (worktreeName.startsWith("plan-") || worktreeName.startsWith("plan/")) {
    return { isLanded: false };
  }

  // Use provided prStateResult or fetch it
  const prState = prStateResult !== undefined ? prStateResult : ghRunner.getPrState(worktreeName);
  if (!prState || prState.state !== "MERGED") {
    return buildClassifyResult(false, prState);
  }

  // Check if tree is clean
  const dirtyKind = computeDirtyKind(worktreePath);
  if (dirtyKind !== "clean") {
    return buildClassifyResult(false, prState);
  }

  // Check if there are unpushed commits
  const unpushed = computeUnpushed(worktreePath);
  if (unpushed > 0) {
    return buildClassifyResult(false, prState);
  }

  // All conditions met: PR is merged, tree is clean, no unpushed commits
  return buildClassifyResult(true, prState);
}

function buildClassifyResult(
  isLanded: boolean,
  prStateResult: { state: string; isDraft: boolean } | null,
): { isLanded: boolean; isDraft?: boolean; prStateRaw?: string } {
  const result: { isLanded: boolean; isDraft?: boolean; prStateRaw?: string } = { isLanded };
  if (prStateResult?.isDraft !== undefined) {
    result.isDraft = prStateResult.isDraft;
  }
  if (prStateResult?.state !== undefined) {
    result.prStateRaw = prStateResult.state.toLowerCase();
  }
  return result;
}

function formatPrStateForDisplay(prStateResult: { state: string; isDraft: boolean } | null): string {
  if (!prStateResult) {
    return "no PR";
  }
  return prStateResult.state.toLowerCase();
}

function emitVerdict(io: TriageIo, statuses: WorktreeStatus[]): void {
  const outstanding = statuses.filter((s) => !s.isLanded);

  if (outstanding.length === 0) {
    io.stdout("\nSession-end verdict: all work landed\n");
  } else {
    io.stdout("\nSession-end verdict: outstanding work\n");
    for (const status of outstanding) {
      const draftMarker = status.isDraft ? " (draft)" : "";
      const reportedState = status.prStateRaw || "no PR";
      const gateStateMarker = status.gateState ? ` [${status.gateState}]` : "";
      io.stdout(`  ${status.home}\t${status.name}\t${reportedState}${draftMarker}${gateStateMarker}\n`);
    }
  }
}

function triageDrillDown(projectRoot: string, worktreeDir: string, worktreeName: string, io: TriageIo): number {
  const worktreePath = join(worktreeDir, worktreeName);

  if (!existsSync(worktreePath)) {
    io.stderr(`unknown worktree: ${worktreeName}\n`);
    return 1;
  }

  const exitCode = 0;

  // Identity section
  io.stdout("Identity\n");
  const identityContent = safeRun(() => renderIdentity(worktreePath));
  io.stdout(identityContent);
  io.stdout("\n");

  // Lock section
  io.stdout("Lock\n");
  const lockContent = safeRun(() => renderLock(worktreePath));
  io.stdout(lockContent);
  io.stdout("\n");

  // Git section
  io.stdout("Git\n");
  const gitContent = safeRun(() => renderGit(worktreePath));
  io.stdout(gitContent);
  io.stdout("\n");

  // Spec section
  io.stdout("Spec\n");
  const specContent = safeRun(() => renderSpec(worktreePath));
  io.stdout(specContent);
  io.stdout("\n");

  // PR section
  io.stdout("PR\n");
  const prContent = safeRun(() => renderPr(worktreeName));
  io.stdout(prContent);
  io.stdout("\n");

  // Session log section
  io.stdout("Session log\n");
  const sessionLogContent = safeRun(() => renderSessionLog(worktreePath));
  io.stdout(sessionLogContent);
  io.stdout("\n");

  // Suggested next moves section
  io.stdout("Suggested next moves\n");
  const suggestedContent = safeRun(() => renderSuggestedMoves(projectRoot, worktreeName, worktreePath));
  io.stdout(suggestedContent);

  return exitCode;
}

function safeRun(fn: () => string): string {
  try {
    return fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `  (error: ${message})\n`;
  }
}

function renderIdentity(worktreePath: string): string {
  const lines: string[] = [];

  // Worktree path
  lines.push(`  Path: ${worktreePath}`);

  // Branch name
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
    lines.push(`  Branch: ${branch}`);
  } catch {
    lines.push(`  Branch: (unknown)`);
  }

  // Spec path (from marker file)
  const specMarkerPath = join(worktreePath, ".active-spec-path");
  let specPath: string | undefined;
  if (existsSync(specMarkerPath)) {
    try {
      specPath = readFileSync(specMarkerPath, "utf8").trim();
      lines.push(`  Spec: ${specPath}`);
    } catch {
      lines.push(`  Spec: (marker file unreadable)`);
    }
  } else {
    lines.push(`  Spec: (unknown — pre-marker worktree)`);
  }

  // Active subspec (if spec is an index)
  if (specPath && existsSync(specPath)) {
    try {
      if (basename(specPath) === "index.md") {
        const activeSubspec = getActiveLinkedSubspecPath(specPath);
        if (activeSubspec) {
          lines.push(`  Active subspec: ${activeSubspec}`);
        }
      }
    } catch {
      // Ignore errors reading active subspec
    }
  }

  // Namespace
  if (specPath && existsSync(specPath)) {
    try {
      const namespace = buildNamespace(specPath);
      if (namespace) {
        lines.push(`  Namespace: ${namespace}`);
      }
    } catch {
      lines.push(`  Namespace: (unknown)`);
    }
  } else {
    lines.push(`  Namespace: (unknown)`);
  }

  return `${lines.join("\n")}\n`;
}

function renderLock(worktreePath: string): string {
  const lockPath = getWorktreeLockPath(worktreePath);

  if (!existsSync(lockPath)) {
    return "  (no lock)\n";
  }

  try {
    const raw = readFileSync(lockPath, "utf8");
    const lock: WorktreeLock = JSON.parse(raw);
    const lines: string[] = [];

    const isAlive = isProcessAlive(lock.pid);
    const status = isAlive ? "held" : "stale";
    lines.push(`  Status: ${status}`);
    lines.push(`  PID: ${lock.pid}`);
    if (!isAlive) {
      lines.push(`  (process no longer running)`);
    }
    lines.push(`  Started: ${lock.started_at}`);
    lines.push(`  Host: ${lock.host}`);

    return `${lines.join("\n")}\n`;
  } catch (err) {
    return `  (error reading lock: ${err instanceof Error ? err.message : String(err)})\n`;
  }
}

function renderGit(worktreePath: string): string {
  const lines: string[] = [];

  // Porcelain output
  try {
    const porcelain = execSync("git status --porcelain", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (porcelain.trim().length === 0) {
      lines.push("  (clean working tree)");
    } else {
      const porcelainLines = porcelain.split("\n");
      porcelainLines.forEach((l) => {
        if (l.length > 0) {
          lines.push(`  ${l}`);
        }
      });
    }
  } catch (err) {
    lines.push(`  (error: ${err instanceof Error ? err.message : String(err)})`);
    return `${lines.join("\n")}\n`;
  }

  // Ahead/behind
  try {
    const output = execSync("git rev-list --left-right --count @{u}...HEAD", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });
    const [behind, ahead] = output.trim().split("\t");
    lines.push(`  Ahead/behind: ${ahead}/${behind}`);
  } catch {
    lines.push(`  Ahead/behind: (no upstream)`);
  }

  // Unpushed commits
  try {
    const unpushed = execSync("git log @{u}.. --pretty='%h %s'", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (unpushed.trim().length > 0) {
      lines.push(`  Unpushed commits:`);
      unpushed.split("\n").forEach((l) => {
        if (l.trim().length > 0) {
          lines.push(`    ${l}`);
        }
      });
    }
  } catch {
    // No unpushed commits or no upstream
  }

  // Last commit
  try {
    const lastCommit = execSync("git log -1 --pretty='%h %s (%ar)'", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
    lines.push(`  Last commit: ${lastCommit}`);
  } catch {
    lines.push(`  Last commit: (none - empty repository)`);
  }

  return `${lines.join("\n")}\n`;
}

function renderSpec(worktreePath: string): string {
  const specMarkerPath = join(worktreePath, ".active-spec-path");
  const specPath = existsSync(specMarkerPath) ? readFileSync(specMarkerPath, "utf8").trim() : undefined;

  if (!specPath || !existsSync(specPath)) {
    return "  (spec unavailable — pre-marker worktree)\n";
  }

  const lines: string[] = [];

  try {
    // Task count
    const unchecked = countUnchecked(specPath);
    const content = readFileSync(specPath, "utf8");
    const taskCount = (content.match(/^\s*-\s\[(?: |x)\]/gm) || []).length;
    lines.push(`  ${taskCount - unchecked}/${taskCount} tasks checked`);

    // First unchecked task
    if (unchecked > 0) {
      try {
        const firstTask = getFirstUncheckedTask(specPath);
        lines.push(`  First unchecked: ${firstTask.line}`);
      } catch {
        // Ignore error
      }
    } else {
      lines.push(`  Status: complete`);
    }

    // Acceptance criteria for active subspec (if index spec)
    if (basename(specPath) === "index.md") {
      try {
        const activeSubspecPath = getActiveLinkedSubspecPath(specPath);
        if (activeSubspecPath && existsSync(activeSubspecPath)) {
          const criteria = snapshotAcceptanceCriteria(activeSubspecPath);
          const unmet = criteria.filter((c) => !c.checked);
          if (unmet.length > 0) {
            lines.push(`  Unmet criteria:`);
            unmet.forEach((c) => {
              lines.push(`    - [ ] ${c.text}`);
            });
          }
        }
      } catch {
        // Ignore errors reading acceptance criteria
      }
    }
  } catch (err) {
    return `  (error: ${err instanceof Error ? err.message : String(err)})\n`;
  }

  return `${lines.join("\n")}\n`;
}

function renderPr(branchName: string): string {
  try {
    const fullOutput = execSync(`gh pr view "${branchName}" --json state,url,isDraft,updatedAt,title`, {
      stdio: "pipe",
      encoding: "utf8",
    });
    const prData = JSON.parse(fullOutput);
    const lines: string[] = [];
    lines.push(`  State: ${prData.state}`);
    lines.push(`  URL: ${prData.url}`);
    lines.push(`  Title: ${prData.title}`);
    if (prData.updatedAt) {
      lines.push(`  Last updated: ${prData.updatedAt}`);
    }
    if (prData.isDraft) {
      lines.push(`  Draft: true`);
    }
    return `${lines.join("\n")}\n`;
  } catch {
    return "  (no PR)\n";
  }
}

function renderSessionLog(worktreePath: string): string {
  const specMarkerPath = join(worktreePath, ".active-spec-path");
  const specPath = existsSync(specMarkerPath) ? readFileSync(specMarkerPath, "utf8").trim() : undefined;

  let namespace: string | undefined;
  if (specPath && existsSync(specPath)) {
    try {
      namespace = buildNamespace(specPath);
    } catch {
      // Unable to determine namespace
    }
  }

  if (!namespace) {
    return "  (namespace unknown — cannot locate session log)\n";
  }

  const sessionsDir = join(process.env.HOME || "/", ".jarvis", "sessions");
  const logDir = existsSync(sessionsDir) ? sessionsDir : undefined;

  if (!logDir) {
    return "  (session logs directory not found)\n";
  }

  try {
    const entries = readdirSync(logDir, { withFileTypes: true });
    const logFiles = entries
      .filter((e) => e.isFile() && e.name.startsWith(`${namespace}-`) && e.name.endsWith(".log"))
      .sort((a, b) => {
        const aTime = statSync(join(logDir, a.name)).mtimeMs;
        const bTime = statSync(join(logDir, b.name)).mtimeMs;
        return bTime - aTime; // Most recent first
      });

    if (logFiles.length === 0) {
      return "  (no session logs found for namespace)\n";
    }

    const latestLog = logFiles[0];
    if (!latestLog) {
      return "  (no session logs found for namespace)\n";
    }

    const logPath = join(logDir, latestLog.name);
    const content = readFileSync(logPath, "utf8");
    const lines = content.split("\n");
    const tail = lines.slice(Math.max(0, lines.length - 40));

    const result: string[] = [];
    result.push(`  Path: ${logPath}`);
    result.push(`  (last 40 lines):`);
    tail.forEach((line) => {
      if (line.length > 0) {
        result.push(`  ${line}`);
      }
    });

    return `${result.join("\n")}\n`;
  } catch (err) {
    return `  (error: ${err instanceof Error ? err.message : String(err)})\n`;
  }
}

function renderSuggestedMoves(projectRoot: string, worktreeName: string, worktreePath: string): string {
  try {
    const input = buildSuggestedMovesInput(projectRoot, worktreeName, worktreePath);
    const lines = getSuggestedMoves(input);
    if (lines.length === 0) {
      return "  (no suggestions available)\n";
    }
    return `${lines.map((line) => `  ${line}`).join("\n")}\n`;
  } catch (err) {
    return `  (error: ${err instanceof Error ? err.message : String(err)})\n`;
  }
}

function buildSuggestedMovesInput(
  projectRoot: string,
  worktreeName: string,
  worktreePath: string,
): SuggestedMovesInput {
  const specMarkerPath = join(worktreePath, ".active-spec-path");
  const specPath = existsSync(specMarkerPath) ? readFileSync(specMarkerPath, "utf8").trim() : undefined;

  const dirtyKind = computeDirtyKind(worktreePath);
  const unpushed = computeUnpushed(worktreePath);
  const prState = computePrState(worktreePath);
  const specComplete = computeSpecComplete(specPath);
  const scopedAbandonEligible =
    prState !== "unknown" &&
    checkScopedAbandonPreflight({
      projectRoot,
      worktreePath,
      deps: { isMergedPr, findMatchingOpenPrs },
    }).eligible;

  return {
    dirtyKind,
    unpushed,
    prState,
    specComplete,
    worktreePath,
    worktreeName,
    scopedAbandonEligible,
    specPath,
  };
}

function computeDirtyKind(worktreePath: string): DirtyKind {
  try {
    const porcelain = execSync("git status --porcelain", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });

    if (porcelain.trim().length === 0) {
      return "clean";
    }

    const lines = porcelain.split("\n").filter((l) => l.length > 0);
    const hasUntracked = lines.some((l) => l.startsWith("??"));
    const hasModified = lines.some((l) => !l.startsWith("??"));

    if (hasModified && hasUntracked) {
      return "mixed";
    }
    if (hasModified) {
      return "modified";
    }
    if (hasUntracked) {
      return "untracked-only";
    }
    return "clean";
  } catch {
    return "clean";
  }
}

function computeUnpushed(worktreePath: string): number {
  try {
    const output = execSync("git log @{u}.. --oneline", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });
    const lines = output
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    return lines.length;
  } catch {
    return 0;
  }
}

function computePrState(worktreePath: string): PrState {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();

    const output = execSync(`gh pr view "${branch}" --json state -q .state`, {
      stdio: "pipe",
      encoding: "utf8",
    }).trim();

    const state = output.toUpperCase() as "DRAFT" | "OPEN" | "MERGED" | "CLOSED";
    if (["DRAFT", "OPEN", "MERGED", "CLOSED"].includes(state)) {
      return state;
    }
    return "unknown";
  } catch {
    return "none";
  }
}

function computeSpecComplete(specPath: string | undefined): boolean {
  if (!specPath || !existsSync(specPath)) {
    return false;
  }

  try {
    const unchecked = countUnchecked(specPath);
    if (unchecked > 0) {
      return false;
    }

    if (basename(specPath) === "index.md") {
      const activeSubspecPath = getActiveLinkedSubspecPath(specPath);
      if (activeSubspecPath && existsSync(activeSubspecPath)) {
        const criteria = snapshotAcceptanceCriteria(activeSubspecPath);
        const unmet = criteria.filter((c) => !c.checked);
        if (unmet.length > 0) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

const suggestedMovesRules: Array<{
  match: (input: SuggestedMovesInput) => boolean;
  format: (input: SuggestedMovesInput) => string[];
}> = [
  // Rule 1: clean + unpushed > 0 + prState in {none, DRAFT, OPEN}
  {
    match: (input) =>
      input.dirtyKind === "clean" && input.unpushed > 0 && ["none", "DRAFT", "OPEN"].includes(input.prState),
    format: (input) => [`1. git -C ${input.worktreePath} push`],
  },

  // Rule 2: clean + prState = MERGED
  {
    match: (input) => input.dirtyKind === "clean" && input.prState === "MERGED",
    format: (_input) => [`1. PR is merged. Safe to remove with: jarvis1 cleanup`],
  },

  // Rule 3: untracked-only (in spec dir) + suggested push
  {
    match: (input) => {
      if (input.dirtyKind !== "untracked-only" || !input.specPath || input.prState === "MERGED") {
        return false;
      }

      try {
        const porcelain = execSync("git status --porcelain", {
          cwd: input.worktreePath,
          stdio: "pipe",
          encoding: "utf8",
        });
        const lines = porcelain.split("\n").filter((l) => l.length > 0);

        // Check if all untracked files are under the spec directory
        const specDir = dirname(input.specPath);
        return lines.every((l) => {
          const filePath = l.substring(3).trim();
          return filePath.startsWith(specDir);
        });
      } catch {
        return false;
      }
    },
    format: (input) => {
      try {
        const porcelain = execSync("git status --porcelain", {
          cwd: input.worktreePath,
          stdio: "pipe",
          encoding: "utf8",
        });
        const lines = porcelain
          .split("\n")
          .filter((l) => l.length > 0)
          .map((l) => l.substring(3).trim());

        const files = lines.join(" ");
        return [
          `1. git -C ${input.worktreePath} add ${files} && git -C ${input.worktreePath} commit -m "seed spec"`,
          `2. git -C ${input.worktreePath} push`,
        ];
      } catch {
        return [];
      }
    },
  },

  // Rule 4: dirty porcelain + prState = MERGED
  {
    match: (input) => ["modified", "mixed", "untracked-only"].includes(input.dirtyKind) && input.prState === "MERGED",
    format: (input) => [
      `1. PR is merged but this tree has uncommitted work — probably orphaned.`,
      `2. Inspect: git -C ${input.worktreePath} diff`,
      `3. Discard: jarvis1 cleanup`,
    ],
  },

  // Rule 5: modified or mixed + specComplete = true
  {
    match: (input) => ["modified", "mixed"].includes(input.dirtyKind) && input.specComplete === true,
    format: (input) => [
      `1. Spec checklists are complete. Commit and push so the PR reflects:`,
      `   git -C ${input.worktreePath} add -A && git -C ${input.worktreePath} commit && git -C ${input.worktreePath} push`,
    ],
  },

  // Rule 6: modified or mixed + specComplete = false
  {
    match: (input) => ["modified", "mixed"].includes(input.dirtyKind) && input.specComplete === false,
    format: (input) => {
      const discardLine =
        input.scopedAbandonEligible && input.prState !== "unknown"
          ? `3. Discard: jarvis1 cleanup --abandon ${input.worktreeName}`
          : `3. Discard: git -C ${input.worktreePath} reset --hard && git -C ${input.worktreePath} clean -fd`;
      return [
        `1. Inspect: git -C ${input.worktreePath} diff`,
        `2. Resume: jarvis1 run ${input.specPath || "(spec path unknown)"}`,
        discardLine,
      ];
    },
  },

  // Rule 7: clean + incomplete + closed/none PR + abandon-eligible
  {
    match: (input) =>
      input.dirtyKind === "clean" &&
      input.specComplete === false &&
      ["CLOSED", "none"].includes(input.prState) &&
      input.scopedAbandonEligible,
    format: (input) => [`1. Retire this worktree: jarvis1 cleanup --abandon ${input.worktreeName}`],
  },
];

function defaultSuggestedMove(input: SuggestedMovesInput): string[] {
  return [`1. Inspect: git -C ${input.worktreePath} diff and the session log above`];
}

function buildNamespace(specPath: string): string {
  // Extract project key and spec name
  // This is a simplified version - would need actual project resolution
  const specName = getSpecDisplayName(specPath);
  // For now, return just the spec name
  // Full implementation would need project context
  return specName;
}

function getSpecDisplayName(specPath: string): string {
  if (basename(specPath) === "index.md") {
    return basename(dirname(specPath));
  }
  return basename(specPath);
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
    const output = execSync("git rev-list --left-right --count @{u}...HEAD", {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });
    const [behind, ahead] = output.trim().split("\t");
    return `${ahead}/${behind}`;
  } catch {
    return "-";
  }
}

function getSpecProgress(_worktreePath: string): string {
  // Stub for now - will be filled in by subspec 01
  return "-";
}

async function triageMarkReady(opts: TriageCommandOptions): Promise<number> {
  const label = "triage --mark-ready";
  const ctx = resolveTriageNamedWorktree(opts, label);
  if (!ctx.ok) {
    return ctx.code;
  }
  const { worktreePath, branch, specPath } = ctx;

  if (specPath === undefined) {
    opts.io.stderr(`${label}: no spec found for branch ${branch}\n`);
    return 1;
  }

  if (!isSpecComplete(specPath)) {
    opts.io.stderr(`${label}: incomplete run — use \`jarvis1 run ${specPath}\` to continue, not finalize\n`);
    return 1;
  }

  const ghRunner = opts.ghRunner ?? createDefaultGhRunner();
  const prState = ghRunner.getPrState(branch);

  const baseCurrent = await (opts.checkBaseCurrent ?? checkBaseCurrentForFinalize)({
    branch,
    cwd: worktreePath,
    hasOpenPr: prState !== null,
  });
  if (baseCurrent.status === "behind") {
    opts.io.stderr(`${label}: behind base, resolve then re-invoke\n`);
    return 1;
  }

  if (prState && !prState.isDraft) {
    opts.io.stderr(`${label}: PR is not in DRAFT state (current state: ${prState.state}). Cannot promote.\n`);
    return 1;
  }

  const commitResult = (
    opts.commitAndPushDirty ?? ((wp: string) => commitAndPushFinalizeDirtyWorktree(wp, opts.pushCurrent ?? pushCurrent))
  )(worktreePath);
  if (!commitResult.ok) {
    if (commitResult.reason === "still-dirty") {
      opts.io.stderr(`${label}: worktree still dirty after finalize commit\n`);
    } else if (commitResult.reason === "commit-failed") {
      const message = commitResult.message ?? "commit failed";
      opts.io.stderr(`${label}: failed to finalize commit\n${message}\n`);
    } else {
      const message = commitResult.message ?? "push failed";
      opts.io.stderr(`${label}: failed to push finalize commit\n${message}\n`);
    }
    return 1;
  }

  const baseBranch = await getBaseBranch(worktreePath);

  if (!prState) {
    try {
      await (opts.ensureDraftPr ?? ensureDraftPr)({
        branch,
        base: baseBranch,
        title: getIndexTitle(specPath),
        bodyGenerator: () => generatePrBody(specPath, null as never, worktreePath, "template", baseBranch),
        footer: renderAttributionSummary({ cwd: worktreePath, base: baseBranch }),
        cwd: worktreePath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.io.stderr(`${label}: failed to open draft PR\n${message}\n`);
      return 1;
    }
  }

  const gateError = triageRunReadyGate(
    opts,
    worktreePath,
    resolveReadyCommand(opts),
    resolveFixCommand(opts),
    "triage-mark-ready",
    baseBranch,
  );
  if (gateError) {
    opts.io.stderr(`${label}: ready gate failed\n${gateError.message}\n`);
    return 1;
  }

  try {
    (opts.prReady ?? ghPrReadyDefault)(branch, worktreePath);
    opts.io.stdout(`${label}: PR promoted to ready\n`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.io.stderr(`${label}: failed to mark PR ready\n${message}\n`);
    return 1;
  }
}

function commitAndPushFinalizeDirtyWorktree(
  worktreePath: string,
  pushCurrentFn: typeof pushCurrent,
): CommitAndPushDirtyResult {
  const pushOrFail = (): CommitAndPushDirtyResult => {
    try {
      pushCurrentFn({ cwd: worktreePath, firstPush: !hasUpstream(worktreePath) });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: "push-failed", message };
    }
  };

  if (computeDirtyKind(worktreePath) === "clean") {
    return computeUnpushed(worktreePath) === 0 ? { ok: true } : pushOrFail();
  }

  try {
    execFileSync("git", ["add", "-A"], { cwd: worktreePath, stdio: "pipe" });
    execFileSync("git", ["commit", "-F", "-"], {
      cwd: worktreePath,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      input: appendAgentTrailer("chore: complete-but-dirty commit", "completion-ready"),
    });
    const porcelain = execFileSync("git", ["status", "--porcelain"], {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
    if (porcelain !== "") {
      return { ok: false, reason: "still-dirty" };
    }
    return pushOrFail();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "commit-failed", message };
  }
}

function resolveWorktreeLocalSpecPath(opts: {
  projectRoot: string;
  worktreePath: string;
  markerSpecPath: string;
}): string {
  const prepared = prepareActiveSpecPath({
    projectRoot: opts.projectRoot,
    agentWorkingDir: opts.worktreePath,
    specPath: opts.markerSpecPath,
  });
  return findRelocatedSpecFile(prepared, opts.worktreePath);
}

type DeriveSpecResult =
  | { ok: true; specPath: string }
  | { ok: false; reason: "no-match" }
  | { ok: false; reason: "zero-md" | "multiple-md"; dirPath: string };

function resolveSpecDir(dirPath: string): DeriveSpecResult {
  const indexPath = join(dirPath, "index.md");
  if (existsSync(indexPath)) {
    return { ok: true, specPath: indexPath };
  }
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return { ok: false, reason: "zero-md", dirPath };
  }
  const mdFiles = entries.filter((e) => e.endsWith(".md"));
  const [onlyMd] = mdFiles;
  if (mdFiles.length === 1 && onlyMd) {
    return { ok: true, specPath: join(dirPath, onlyMd) };
  }
  if (mdFiles.length === 0) {
    return { ok: false, reason: "zero-md", dirPath };
  }
  return { ok: false, reason: "multiple-md", dirPath };
}

function deriveSpecPathFromBranch(
  branch: string,
  projectRoot: string,
  configuredTargetDir: string,
  worktreePath?: string,
): DeriveSpecResult {
  const isPlan = branch.startsWith("plan/");
  const specName = isPlan ? branch.slice("plan/".length) : branch;

  for (const homeDir of [...new Set([configuredTargetDir, "v1/spec", "v2/spec"])]) {
    const specRoot = join(projectRoot, homeDir);
    if (!existsSync(specRoot)) continue;

    const candidates = [join(specRoot, specName), join(specRoot, `${specName}.md`)];
    if (isPlan) {
      try {
        const timestamped = readdirSync(specRoot)
          .filter((e) => e !== "completed")
          .filter((e) => stripPlanSpecTimestampPrefix(e) === specName)
          .sort()[0];
        if (timestamped !== undefined) candidates.push(join(specRoot, timestamped));
      } catch {
        // skip unreadable home
      }
    }

    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      try {
        if (statSync(candidate).isDirectory()) return resolveSpecDir(candidate);
        if (candidate.endsWith(".md")) return { ok: true, specPath: candidate };
      } catch {
        // skip unreadable entry
      }
    }
  }

  // For plan branches, fall back to scanning the worktree's target dirs
  if (isPlan && worktreePath) {
    for (const homeDir of [...new Set([configuredTargetDir, "v1/spec", "v2/spec"])]) {
      const specRoot = join(worktreePath, homeDir);
      if (!existsSync(specRoot)) continue;

      const candidates = [join(specRoot, specName), join(specRoot, `${specName}.md`)];
      try {
        const timestamped = readdirSync(specRoot)
          .filter((e) => e !== "completed")
          .filter((e) => stripPlanSpecTimestampPrefix(e) === specName)
          .sort()[0];
        if (timestamped !== undefined) candidates.push(join(specRoot, timestamped));
      } catch {
        // skip unreadable home
      }

      for (const candidate of candidates) {
        if (!existsSync(candidate)) continue;
        try {
          if (statSync(candidate).isDirectory()) return resolveSpecDir(candidate);
          if (candidate.endsWith(".md")) return { ok: true, specPath: candidate };
        } catch {
          // skip unreadable entry
        }
      }
    }
  }

  return { ok: false, reason: "no-match" };
}

function resolvePlanTargetDir(opts: TriageCommandOptions): string {
  try {
    const fullConfig = loadConfig(opts.config);
    for (const project of Object.values(fullConfig.projects)) {
      if (project.root === opts.projectRoot) {
        return resolvePlanFlags(fullConfig, project).targetDir;
      }
    }
    return resolvePlanFlags(fullConfig, undefined).targetDir;
  } catch {
    return "spec";
  }
}

type TriageNamedWorktree =
  | { ok: true; worktreePath: string; branch: string; specPath: string | undefined }
  | { ok: false; code: number };

function resolveTriageNamedWorktree(opts: TriageCommandOptions, label: string): TriageNamedWorktree {
  const isMerge = label === "triage --merge";
  const refuse = (message: string, mergeClass?: "unknown worktree" | "plan PR" | "implementation PR") => {
    if (isMerge && mergeClass !== undefined) {
      emitMergeRefusal(opts.io, mergeClass, message);
    } else {
      opts.io.stderr(`${label}: ${message}\n`);
    }
  };

  const worktreeName = opts.worktreeName;
  const worktreePath =
    opts.worktreePath ?? (worktreeName === undefined ? undefined : join(opts.projectRoot, ".worktree", worktreeName));
  if (!worktreePath) {
    refuse("internal error - no worktree name", isMerge ? "unknown worktree" : undefined);
    return { ok: false, code: 1 };
  }

  if (!existsSync(worktreePath)) {
    refuse(`unknown worktree: ${worktreeName ?? worktreePath}`, isMerge ? "unknown worktree" : undefined);
    return { ok: false, code: 1 };
  }

  let branch: string;
  try {
    branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
  } catch {
    refuse("unable to get branch name", isMerge ? "unknown worktree" : undefined);
    return { ok: false, code: 1 };
  }

  const mergeClass = isMerge ? (branch.startsWith("plan/") ? "plan PR" : "implementation PR") : undefined;

  let specPath: string | undefined;

  const specMarkerPath = join(worktreePath, ".active-spec-path");
  if (existsSync(specMarkerPath)) {
    let markerSpecPath: string;
    try {
      markerSpecPath = readFileSync(specMarkerPath, "utf8").trim();
    } catch {
      refuse("unable to read .active-spec-path marker", mergeClass);
      return { ok: false, code: 1 };
    }

    if (!markerSpecPath) {
      refuse("spec file not found: (unknown)", mergeClass);
      return { ok: false, code: 1 };
    }

    const resolvedPath = resolveWorktreeLocalSpecPath({
      projectRoot: opts.projectRoot,
      worktreePath,
      markerSpecPath,
    });
    if (!existsSync(resolvedPath)) {
      refuse(`spec file not found: ${resolvedPath}`, mergeClass);
      return { ok: false, code: 1 };
    }
    specPath = resolvedPath;
  } else {
    const targetDir = resolvePlanTargetDir(opts);
    const derived = deriveSpecPathFromBranch(branch, opts.projectRoot, targetDir, worktreePath);
    if (!derived.ok) {
      if (derived.reason === "no-match") {
        if (!isMerge) {
          refuse(`no spec found for branch ${branch}`);
          return { ok: false, code: 1 };
        }
      } else if (derived.reason === "zero-md") {
        refuse(`spec directory has no markdown files: ${derived.dirPath}`, mergeClass);
        return { ok: false, code: 1 };
      } else {
        refuse(`spec directory is ambiguous (multiple .md files, no index.md): ${derived.dirPath}`, mergeClass);
        return { ok: false, code: 1 };
      }
    } else {
      const relocatedPath = resolveWorktreeLocalSpecPath({
        projectRoot: opts.projectRoot,
        worktreePath,
        markerSpecPath: derived.specPath,
      });
      specPath = existsSync(relocatedPath) ? relocatedPath : derived.specPath;
    }
  }

  const lockPath = resolveTriageLockPath(opts, worktreePath, branch);
  if (existsSync(lockPath)) {
    try {
      const lock: WorktreeLock = JSON.parse(readFileSync(lockPath, "utf8"));
      if (isProcessAlive(lock.pid)) {
        refuse(`worktree is locked by live run (PID ${lock.pid}). Cannot proceed.`, mergeClass);
        return { ok: false, code: 1 };
      }
    } catch {
      // Ignore lock file read errors
    }
  }

  return { ok: true, worktreePath, branch, specPath };
}

function resolveTriageLockPath(opts: TriageCommandOptions, worktreePath: string, branch: string): string {
  const project = findProjectMatchForPath(opts.projectRoot, opts.config);
  if (project !== undefined) {
    const configDir = opts.config?.dir ?? CONFIG_DIR;
    const externalHome = resolve(configDir, "worktrees", project.key);
    const relativePath = relative(externalHome, resolve(worktreePath));
    if (relativePath !== "" && relativePath !== ".." && !relativePath.startsWith("../")) {
      return join(configDir, "worktree-locks", project.key, branch, ".jarvis.lock");
    }
  }
  return getWorktreeLockPath(worktreePath);
}

function resolveReadyCommand(opts: TriageCommandOptions): string | undefined {
  try {
    const fullConfig = loadConfig(opts.config);
    for (const project of Object.values(fullConfig.projects)) {
      if (project.root === opts.projectRoot) {
        return project.readyCommand;
      }
    }
  } catch {
    // Ignore config loading errors, use default readyCommand
  }
  return undefined;
}

function resolveFixCommand(opts: TriageCommandOptions): string | undefined {
  try {
    const fullConfig = loadConfig(opts.config);
    for (const project of Object.values(fullConfig.projects)) {
      if (project.root === opts.projectRoot) {
        return project.fixCommand;
      }
    }
  } catch {
    // Ignore config loading errors, use default fixCommand
  }
  return undefined;
}

function resolveReadyGateTimeoutMs(opts: TriageCommandOptions): number {
  try {
    return loadConfig(opts.config).iterationTimeoutMs;
  } catch {
    return DEFAULT_CONFIG.iterationTimeoutMs;
  }
}

function triageRunReadyGate(
  opts: TriageCommandOptions,
  worktreePath: string,
  readyCommand: string | undefined,
  fixCommand: string | undefined,
  agentLabel: string,
  baseBranch: string,
): Error | null {
  const timeoutMs = resolveReadyGateTimeoutMs(opts);
  const defaultRunGate = (cwd: string, cmd?: string, fixCmd?: string, gateTimeoutMs = timeoutMs) => {
    runReadyGateWithTier({
      cwd,
      agentLabel,
      timeoutMs: gateTimeoutMs,
      baseBranch,
      ...(cmd !== undefined ? { readyCommand: cmd } : {}),
      ...(fixCmd !== undefined ? { fixCommand: fixCmd } : {}),
    });
  };
  try {
    (opts.runGate ?? defaultRunGate)(worktreePath, readyCommand, fixCommand, timeoutMs);
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

function ghPrReadyDefault(branch: string, cwd: string): void {
  withSyncTransientRetry(
    () => {
      execFileSync("gh", ["pr", "ready", branch], { cwd, stdio: "pipe" });
    },
    { op: "gh pr ready", isPrReady: true },
  );
}

function ghAdminMergeDefault(branch: string, cwd: string): void {
  withSyncTransientRetry(
    () => {
      execFileSync("gh", ["pr", "merge", branch, "--admin", "--squash"], { cwd, stdio: "pipe" });
    },
    { op: "gh pr merge", isPrReady: false },
  );
}

function nonHumanOnlyAcceptanceComplete(specPath: string): boolean {
  return existsSync(specPath) && snapshotAcceptanceCriteria(specPath).every((c) => c.humanOnly || c.checked);
}

function specCompletionPaths(specPath: string): string[] | null {
  if (!specPath || !existsSync(specPath)) {
    return null;
  }
  try {
    if (basename(specPath) !== "index.md") {
      return [specPath];
    }
    const parsed = parseSpec(readFileSync(specPath, "utf8"));
    const paths =
      parsed.linkedSubspecs.length === 0
        ? [specPath]
        : parsed.linkedSubspecs.map((linked) => resolve(dirname(specPath), linked.path));
    return paths;
  } catch {
    return null;
  }
}

/** Exported for cleanup reuse (same non-human-only linked-subspec semantics). */
export function isSpecComplete(specPath: string): boolean {
  const paths = specCompletionPaths(specPath);
  if (paths === null) {
    return false;
  }
  return paths.every(nonHumanOnlyAcceptanceComplete);
}

/** Reports whether the spec at `specPath` has any non-human-only acceptance criteria across its linked subspecs (or the sole spec file). Returns `false` when the spec path cannot be resolved. Exported for cleanup reuse to detect vacuous-complete specs while an in-flight owner exists. */
export function specHasNonHumanOnlyAcceptanceCriteria(specPath: string): boolean {
  const paths = specCompletionPaths(specPath);
  if (paths === null) {
    return false;
  }
  return paths.some((p) => existsSync(p) && snapshotAcceptanceCriteria(p).some((c) => !c.humanOnly));
}

const MERGE_FLAKE_RECOVERY_STDOUT = "triage --merge: local ready flake recovered (CI green at HEAD); proceeding";
const READY_TEST_STEP_MARKERS = ["ready: parallel test failed", "ready: serial test failed"] as const;
const PROBE_SIGNAL_TIMEOUT_EXIT_CODES = new Set([124, 130, 143]);
const RECOVERY_PROBE_SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

/** Map an `execFileSync` failure to a probe exit code (signal/timeout parity with `scripts/ready.ts`). */
export function recoveryProbeExitFromExecError(err: unknown): number {
  const procErr = err as NodeJS.ErrnoException & { status?: number | null; signal?: NodeJS.Signals | null };
  if (procErr.status != null) {
    return procErr.status;
  }
  if (procErr.signal != null) {
    const mapped = RECOVERY_PROBE_SIGNAL_EXIT_CODES[procErr.signal];
    if (mapped != null) {
      return mapped;
    }
  }
  return 1;
}

/** Default merge recovery probe runner (`bun test` via `execFileSync`). */
export function runRecoveryProbeWithExec(
  cwd: string,
  args: string[],
  execFn: typeof execFileSync = execFileSync,
): number {
  try {
    execFn("bun", args, { cwd, stdio: "pipe" });
    return 0;
  } catch (err) {
    return recoveryProbeExitFromExecError(err);
  }
}

export function extractFailingTestFilePaths(gateStderr: string): string[] {
  if (!gateStderr.includes("(fail)")) {
    return [];
  }
  const paths: string[] = [];
  const seen = new Set<string>();
  const atPathRe = /at (?:\S+ )?\(?([^():\n]+?\.(?:test|spec)\.[tj]sx?):\d+/g;
  for (const match of gateStderr.matchAll(atPathRe)) {
    const path = match[1];
    if (path === undefined || seen.has(path)) {
      continue;
    }
    seen.add(path);
    paths.push(path);
    if (paths.length >= 8) {
      break;
    }
  }
  return paths;
}

function defaultRunRecoveryProbe(cwd: string, args: string[]): number {
  return runRecoveryProbeWithExec(cwd, args);
}

function tryRecoverMergeFlake(
  opts: TriageCommandOptions,
  worktreePath: string,
  gateError: Error,
  getChecksForSha: (sha: string) => CiCheckState[] | null,
): boolean {
  if (!(gateError instanceof ReadyCommandError)) {
    return false;
  }
  const gateStderr = gateError.message;
  if (
    gateStderr.includes("ready: deadline exceeded") ||
    !READY_TEST_STEP_MARKERS.some((marker) => gateStderr.includes(marker))
  ) {
    return false;
  }

  let headSha: string;
  try {
    headSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch {
    return false;
  }

  let headChecks: CiCheckState[] | null;
  try {
    headChecks = getChecksForSha(headSha);
  } catch {
    return false;
  }
  if (classifyCiChecks(headChecks).classification !== "green") {
    return false;
  }

  const runProbe = opts.runRecoveryProbe ?? defaultRunRecoveryProbe;
  const probeGreen = (exitCode: number): boolean => {
    if (exitCode !== 0) {
      return false;
    }
    opts.io.stdout(`${MERGE_FLAKE_RECOVERY_STDOUT}\n`);
    return true;
  };

  const probe1 = runProbe(worktreePath, ["test"]);
  if (probeGreen(probe1)) {
    return true;
  }
  if (PROBE_SIGNAL_TIMEOUT_EXIT_CODES.has(probe1)) {
    return false;
  }

  const failingPaths = extractFailingTestFilePaths(gateStderr);
  if (failingPaths.length === 0) {
    return false;
  }

  return probeGreen(runProbe(worktreePath, ["test", ...failingPaths]));
}

function waitForCiGreen(
  branch: string,
  getChecks: (branch: string) => CiCheckState[] | null,
  io: TriageIo,
  pollIntervalMs: number,
  timeoutMs: number,
): number {
  const mergeClass = branch.startsWith("plan/") ? "plan PR" : "implementation PR";
  const startTime = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { classification, failingCheck, pendingCheck } = classifyCiChecks(getChecks(branch));

    if (classification === "green") {
      io.stdout(`triage --merge: CI checks green, proceeding to merge\n`);
      return 0;
    }
    if (classification === "red") {
      emitMergeRefusal(io, mergeClass, `CI check failed: ${failingCheck}`);
      return 1;
    }
    if (Date.now() - startTime > timeoutMs) {
      emitMergeRefusal(io, mergeClass, `CI checks timed out. Still pending: ${pendingCheck}`);
      return 1;
    }
    sleepMs(pollIntervalMs);
  }
}

async function triageMerge(opts: TriageCommandOptions): Promise<number> {
  const label = "triage --merge";
  const ctx = resolveTriageNamedWorktree(opts, label);
  if (!ctx.ok) {
    return ctx.code;
  }
  const { worktreePath, branch, specPath } = ctx;
  const mergeClass = branch.startsWith("plan/") ? "plan PR" : "implementation PR";

  const findOpenPrs = opts.mergeTargetSeams?.findMatchingOpenPrs ?? findMatchingOpenPrs;
  try {
    const matchingOpenPrs = findOpenPrs(branch, opts.projectRoot);
    if (matchingOpenPrs.length > 1) {
      emitMergeRefusal(opts.io, mergeClass, `multiple open PRs match branch ${branch}`);
      return 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitMergeRefusal(opts.io, mergeClass, `failed to inspect PR state for branch ${branch}: ${message}`);
    return 1;
  }

  const ghRunner = opts.ghRunner ?? createDefaultGhRunner();
  const prState = ghRunner.getPrState(branch);
  if (!prState) {
    emitMergeRefusal(opts.io, mergeClass, `no PR found for branch ${branch}`);
    return 1;
  }

  if (prState.state === "MERGED" || prState.state === "CLOSED") {
    emitMergeRefusal(opts.io, mergeClass, `PR is already ${prState.state.toLowerCase()}. Cannot merge.`);
    return 1;
  }

  if (specPath !== undefined && !branch.startsWith("plan/") && !isSpecComplete(specPath)) {
    emitMergeRefusal(opts.io, mergeClass, "spec is not complete — linked subspecs have unchecked items");
    return 1;
  }

  const baseBranch = await getBaseBranch(worktreePath);
  const gateError = triageRunReadyGate(
    opts,
    worktreePath,
    resolveReadyCommand(opts),
    resolveFixCommand(opts),
    "triage-merge",
    baseBranch,
  );
  if (gateError) {
    const getChecksForSha = ghRunner.getChecksForSha ?? ((sha: string) => fetchCommitChecksForSha(worktreePath, sha));
    if (!tryRecoverMergeFlake(opts, worktreePath, gateError, getChecksForSha)) {
      emitMergeRefusal(opts.io, mergeClass, `ready gate failed\n${gateError.message}`);
      return 1;
    }
  }

  if (prState.isDraft) {
    try {
      (opts.prReady ?? ghPrReadyDefault)(branch, worktreePath);
      opts.io.stdout(`${label}: PR promoted to ready\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitMergeRefusal(opts.io, mergeClass, `failed to mark PR ready\n${message}`);
      return 1;
    }
  }

  const getChecks = ghRunner.getChecks ?? fetchGhPrChecks;
  const pollCode = waitForCiGreen(
    branch,
    getChecks,
    opts.io,
    opts.pollIntervalMs ?? MERGE_CI_POLL_INTERVAL_MS,
    opts.pollTimeoutMs ?? MERGE_CI_POLL_TIMEOUT_MS,
  );
  if (pollCode !== 0) {
    return pollCode;
  }

  try {
    (opts.adminMerge ?? ghAdminMergeDefault)(branch, worktreePath);
    opts.io.stdout(`${label}: PR merged successfully\n`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitMergeRefusal(opts.io, mergeClass, `failed to merge PR\n${message}`);
    return 1;
  }
}
