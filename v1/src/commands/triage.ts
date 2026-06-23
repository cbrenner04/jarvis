import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ConfigOptions } from "../config.ts";
import { countUnchecked, getActiveLinkedSubspecPath, getFirstUncheckedTask } from "../modes/patch/completion.ts";
import { snapshotAcceptanceCriteria } from "../modes/patch/subspec.ts";
import { getWorktreeLockPath, isProcessAlive, type WorktreeLock } from "../worktree-lock.ts";

export type TriageIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type TriageGhRunner = {
  getPrState: (branch: string) => { state: string; isDraft: boolean } | null;
};

export type TriageCommandOptions = {
  projectRoot: string;
  io: TriageIo;
  config?: ConfigOptions;
  worktreeName?: string;
  ghRunner?: TriageGhRunner;
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
    const prState = getPrState(worktreeName);
    const specProgress = getSpecProgress(worktreePath);

    io.stdout(`${worktreeName}\t\t${dirtyStatus}\t\t${aheadBehind}\t\t${prState}\t\t${specProgress}\n`);

    const { isLanded, isDraft, prStateRaw } = classifyWorktree(worktreePath, worktreeName, ghRunner);
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
  };
}

function classifyWorktree(
  worktreePath: string,
  worktreeName: string,
  ghRunner: TriageGhRunner,
): { isLanded: boolean; isDraft?: boolean; prStateRaw?: string } {
  // Plan worktrees are never landed
  if (worktreeName.startsWith("plan-")) {
    return { isLanded: false };
  }

  // Check PR state
  const prStateResult = ghRunner.getPrState(worktreeName);
  if (!prStateResult || prStateResult.state !== "MERGED") {
    const result: { isLanded: boolean; isDraft?: boolean; prStateRaw?: string } = {
      isLanded: false,
    };
    if (prStateResult?.isDraft !== undefined) {
      result.isDraft = prStateResult.isDraft;
    }
    if (prStateResult?.state !== undefined) {
      result.prStateRaw = prStateResult.state.toLowerCase();
    }
    return result;
  }

  // Check if tree is clean
  const dirtyKind = computeDirtyKind(worktreePath);
  if (dirtyKind !== "clean") {
    const result: { isLanded: boolean; isDraft?: boolean; prStateRaw?: string } = {
      isLanded: false,
    };
    if (prStateResult.isDraft !== undefined) {
      result.isDraft = prStateResult.isDraft;
    }
    result.prStateRaw = prStateResult.state.toLowerCase();
    return result;
  }

  // Check if there are unpushed commits
  const unpushed = computeUnpushed(worktreePath);
  if (unpushed > 0) {
    const result: { isLanded: boolean; isDraft?: boolean; prStateRaw?: string } = {
      isLanded: false,
    };
    if (prStateResult.isDraft !== undefined) {
      result.isDraft = prStateResult.isDraft;
    }
    result.prStateRaw = prStateResult.state.toLowerCase();
    return result;
  }

  // All conditions met: PR is merged, tree is clean, no unpushed commits
  const result: { isLanded: boolean; isDraft?: boolean; prStateRaw?: string } = {
    isLanded: true,
  };
  if (prStateResult.isDraft !== undefined) {
    result.isDraft = prStateResult.isDraft;
  }
  result.prStateRaw = prStateResult.state.toLowerCase();
  return result;
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
      io.stdout(`  ${status.name}\t${reportedState}${draftMarker}\n`);
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

function getSpecProgress(_worktreePath: string): string {
  // Stub for now - will be filled in by subspec 01
  return "-";
}
