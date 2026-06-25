import { execFileSync, execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ConfigOptions } from "../config.ts";
import { loadConfig } from "../config.ts";
import { countUnchecked, getActiveLinkedSubspecPath, getFirstUncheckedTask } from "../modes/patch/completion.ts";
import { snapshotAcceptanceCriteria } from "../modes/patch/subspec.ts";
import { getWorktreeLockPath, isProcessAlive, type WorktreeLock } from "../worktree-lock.ts";
import { runReadyGateWithTier } from "../ready-gate.ts";
import { withSyncTransientRetry } from "../gh.ts";
import { parseSpec } from "../../../shared/spec-parser.ts";

export type TriageIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type TriageGhRunner = {
  getPrState: (branch: string) => { state: string; isDraft: boolean } | null;
  getMergeGateState?: (branch: string) => { mergeStateStatus: string } | null;
};

export type TriageCommandOptions = {
  projectRoot: string;
  io: TriageIo;
  config?: ConfigOptions;
  worktreeName?: string;
  markReady?: boolean;
  ghRunner?: TriageGhRunner;
  /** Test seam: run the ready gate. Defaults to runReadyGateWithTier. */
  runGate?: (cwd: string, readyCommand?: string) => void;
  /** Test seam: mark PR ready. Defaults to gh pr ready with retry. */
  prReady?: (branch: string, cwd: string) => void;
};

export type DirtyKind = "clean" | "untracked-only" | "modified" | "mixed";
export type PrState = "none" | "DRAFT" | "OPEN" | "MERGED" | "CLOSED" | "unknown";

export type SuggestedMovesInput = {
  dirtyKind: DirtyKind;
  unpushed: number;
  prState: PrState;
  specComplete: boolean;
  worktreePath: string;
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

export function triageCommand(opts: TriageCommandOptions): number {
  const worktreeDir = join(opts.projectRoot, ".worktree");

  // Named form: drill-down for a specific worktree
  if (opts.worktreeName !== undefined) {
    if (opts.markReady) {
      return triageMarkReady(opts);
    }
    return triageDrillDown(worktreeDir, opts.worktreeName, opts.io);
  }

  // No-arg form: list all worktrees with summary
  const ghRunner = opts.ghRunner || createDefaultGhRunner();
  return triageListWorktrees(worktreeDir, opts.io, ghRunner);
}

type WorktreeStatus = {
  name: string;
  dirtyStatus: string;
  aheadBehind: string;
  prState: string;
  specProgress: string;
  isLanded: boolean;
  isDraft?: boolean;
  prStateRaw?: string;
  gateState?: string;
};

function triageListWorktrees(worktreeDir: string, io: TriageIo, ghRunner: TriageGhRunner): number {
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

  const statuses: WorktreeStatus[] = [];

  for (const worktreeName of worktrees) {
    const worktreePath = join(worktreeDir, worktreeName);
    const dirtyStatus = getDirtyStatusSummary(worktreePath);
    const aheadBehind = getAheadBehind(worktreePath);
    const prStateResult = ghRunner.getPrState(worktreeName);
    const prState = formatPrStateForDisplay(prStateResult);
    const specProgress = getSpecProgress(worktreePath);

    io.stdout(`${worktreeName}\t\t${dirtyStatus}\t\t${aheadBehind}\t\t${prState}\t\t${specProgress}\n`);

    const { isLanded, isDraft, prStateRaw } = classifyWorktree(worktreePath, worktreeName, ghRunner, prStateResult);
    const status: WorktreeStatus = {
      name: worktreeName,
      dirtyStatus,
      aheadBehind,
      prState,
      specProgress,
      isLanded,
    };
    if (isDraft !== undefined) {
      status.isDraft = isDraft;
    }
    if (prStateRaw !== undefined) {
      status.prStateRaw = prStateRaw;
    }

    // Fetch merge gate state for outstanding entries
    if (!isLanded && ghRunner.getMergeGateState) {
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
  };
}

function classifyWorktree(
  worktreePath: string,
  worktreeName: string,
  ghRunner: TriageGhRunner,
  prStateResult?: { state: string; isDraft: boolean } | null,
): { isLanded: boolean; isDraft?: boolean; prStateRaw?: string } {
  // Plan worktrees are never landed
  if (worktreeName.startsWith("plan-")) {
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
      io.stdout(`  ${status.name}\t${reportedState}${draftMarker}${gateStateMarker}\n`);
    }
  }
}

function triageDrillDown(worktreeDir: string, worktreeName: string, io: TriageIo): number {
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
  const suggestedContent = safeRun(() => renderSuggestedMoves(worktreePath));
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

function renderSuggestedMoves(worktreePath: string): string {
  try {
    const input = buildSuggestedMovesInput(worktreePath);
    const lines = getSuggestedMoves(input);
    if (lines.length === 0) {
      return "  (no suggestions available)\n";
    }
    return `${lines.map((line) => `  ${line}`).join("\n")}\n`;
  } catch (err) {
    return `  (error: ${err instanceof Error ? err.message : String(err)})\n`;
  }
}

function buildSuggestedMovesInput(worktreePath: string): SuggestedMovesInput {
  const specMarkerPath = join(worktreePath, ".active-spec-path");
  const specPath = existsSync(specMarkerPath) ? readFileSync(specMarkerPath, "utf8").trim() : undefined;

  const dirtyKind = computeDirtyKind(worktreePath);
  const unpushed = computeUnpushed(worktreePath);
  const prState = computePrState(worktreePath);
  const specComplete = computeSpecComplete(specPath);

  return {
    dirtyKind,
    unpushed,
    prState,
    specComplete,
    worktreePath,
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
      if (input.dirtyKind !== "untracked-only" || !input.specPath) {
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

  // Rule 4: modified or mixed + prState = MERGED
  {
    match: (input) => ["modified", "mixed"].includes(input.dirtyKind) && input.prState === "MERGED",
    format: (input) => [
      `1. PR is merged but this tree has uncommitted work — probably orphaned.`,
      `2. Inspect: git -C ${input.worktreePath} diff`,
      `3. Discard: git -C ${input.worktreePath} stash && jarvis1 cleanup`,
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
    format: (input) => [
      `1. Inspect: git -C ${input.worktreePath} diff`,
      `2. Resume: jarvis1 run ${input.specPath || "(spec path unknown)"}`,
      `3. Discard: git -C ${input.worktreePath} reset --hard && git -C ${input.worktreePath} clean -fd`,
    ],
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

function triageMarkReady(opts: TriageCommandOptions): number {
  const worktreeDir = join(opts.projectRoot, ".worktree");
  const worktreeName = opts.worktreeName;
  if (!worktreeName) {
    opts.io.stderr(`triage --mark-ready: internal error - no worktree name\n`);
    return 1;
  }

  const worktreePath = join(worktreeDir, worktreeName);

  if (!existsSync(worktreePath)) {
    opts.io.stderr(`triage --mark-ready: unknown worktree: ${worktreeName}\n`);
    return 1;
  }

  // Get the branch name
  let branch: string;
  try {
    branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
  } catch {
    opts.io.stderr(`triage --mark-ready: unable to get branch name\n`);
    return 1;
  }

  // Get the spec path from .active-spec-path marker (before PR check)
  const specMarkerPath = join(worktreePath, ".active-spec-path");
  let specPath: string | undefined;
  if (existsSync(specMarkerPath)) {
    try {
      specPath = readFileSync(specMarkerPath, "utf8").trim();
    } catch {
      opts.io.stderr(`triage --mark-ready: unable to read .active-spec-path marker\n`);
      return 1;
    }
  } else {
    opts.io.stderr(`triage --mark-ready: .active-spec-path marker not found (pre-marker worktree)\n`);
    return 1;
  }

  if (!specPath || !existsSync(specPath)) {
    opts.io.stderr(`triage --mark-ready: spec file not found: ${specPath || "(unknown)"}\n`);
    return 1;
  }

  // Check if the worktree is locked by a live run PID
  const lockPath = getWorktreeLockPath(worktreePath);
  if (existsSync(lockPath)) {
    try {
      const raw = readFileSync(lockPath, "utf8");
      const lock: WorktreeLock = JSON.parse(raw);
      if (isProcessAlive(lock.pid)) {
        opts.io.stderr(`triage --mark-ready: worktree is locked by live run (PID ${lock.pid}). Cannot proceed.\n`);
        return 1;
      }
    } catch {
      // Ignore lock file read errors
    }
  }

  // Pre-check order: (a) PR exists, (b) PR is DRAFT, (c) spec complete
  const ghRunner = opts.ghRunner || createDefaultGhRunner();
  const prState = ghRunner.getPrState(branch);
  if (!prState) {
    opts.io.stderr(`triage --mark-ready: no PR found for branch ${branch}\n`);
    return 1;
  }

  if (!prState.isDraft) {
    opts.io.stderr(
      `triage --mark-ready: PR is not in DRAFT state (current state: ${prState.state}). Cannot promote.\n`,
    );
    return 1;
  }

  // Check if spec is complete (treating single-file specs as complete if no unchecked items)
  const specComplete = isSpecComplete(specPath);
  if (!specComplete) {
    opts.io.stderr(`triage --mark-ready: spec is not complete — linked subspecs have unchecked items\n`);
    return 1;
  }

  // Resolve the readyCommand from the project config
  let readyCommand: string | undefined;
  try {
    const fullConfig = loadConfig(opts.config);
    for (const project of Object.values(fullConfig.projects)) {
      if (project.root === opts.projectRoot) {
        readyCommand = project.readyCommand;
        break;
      }
    }
  } catch {
    // Ignore config loading errors, use default readyCommand
  }

  // Re-run the completion ready gate once with no recorded green carrier
  const realRunGate = (cwd: string, cmd?: string) => {
    runReadyGateWithTier({
      cwd,
      agentLabel: "triage-mark-ready",
      ...(cmd !== undefined ? { readyCommand: cmd } : {}),
    });
  };

  const runGateFn = opts.runGate ?? realRunGate;
  let gateError: Error | null = null;
  try {
    runGateFn(worktreePath, readyCommand);
  } catch (err) {
    gateError = err instanceof Error ? err : new Error(String(err));
  }

  if (gateError) {
    const message = gateError.message || String(gateError);
    opts.io.stderr(`triage --mark-ready: ready gate failed\n${message}\n`);
    return 1;
  }

  // Mark the PR ready with retry wrapper
  const realPrReady = (branch: string, cwd: string) => {
    withSyncTransientRetry(
      () => {
        execFileSync("gh", ["pr", "ready", branch], {
          cwd,
          stdio: "pipe",
        });
      },
      {
        op: "gh pr ready",
        isPrReady: true,
      },
    );
  };

  const prReadyFn = opts.prReady ?? realPrReady;
  try {
    prReadyFn(branch, worktreePath);
    opts.io.stdout(`triage --mark-ready: PR promoted to ready\n`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.io.stderr(`triage --mark-ready: failed to mark PR ready\n${message}\n`);
    return 1;
  }
}

function isSpecComplete(specPath: string): boolean {
  if (!specPath || !existsSync(specPath)) {
    return false;
  }

  try {
    const unchecked = countUnchecked(specPath);
    if (unchecked > 0) {
      return false;
    }

    if (basename(specPath) === "index.md") {
      // For index specs, check if linked subspecs are complete
      const indexContent = readFileSync(specPath, "utf8");
      const parsed = parseSpec(indexContent);
      const linked = parsed.linkedSubspecs;

      if (linked.length === 0) {
        // Single-file or malformed spec with no linked subspecs: treat as complete if no unchecked items
        return true;
      }

      // For index specs with linked subspecs, all must be checked
      return linked.every((item: { checked: boolean }) => item.checked);
    }

    // Single-file spec: complete if no unchecked items
    return true;
  } catch {
    return false;
  }
}
