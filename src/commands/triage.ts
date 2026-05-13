import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  countUnchecked,
  getActiveLinkedSubspecPath,
  getFirstUncheckedTask,
} from "../completion.ts";
import type { ConfigOptions } from "../config.ts";
import { snapshotAcceptanceCriteria } from "../subspec.ts";

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

  let exitCode = 0;

  // Identity section
  io.stdout("Identity\n");
  const identityContent = safeRun(() => renderIdentity(worktreePath));
  io.stdout(identityContent);
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
    lines.push(
      `  (error: ${err instanceof Error ? err.message : String(err)})`,
    );
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
  const specPath = existsSync(specMarkerPath)
    ? readFileSync(specMarkerPath, "utf8").trim()
    : undefined;

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
    const output = execSync(
      `gh pr view "${branchName}" --json state,url,isDraft,updatedAt,title -q '.state + " - " + .title'`,
      {
        stdio: "pipe",
        encoding: "utf8",
      },
    ).trim();
    const [state, ...titleParts] = output.split(" - ");
    const title = titleParts.join(" - ");

    try {
      const fullOutput = execSync(
        `gh pr view "${branchName}" --json state,url,isDraft,updatedAt,title`,
        {
          stdio: "pipe",
          encoding: "utf8",
        },
      );
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
      return `  ${output}\n`;
    }
  } catch {
    return "  (no PR)\n";
  }
}

function renderSessionLog(worktreePath: string): string {
  const specMarkerPath = join(worktreePath, ".active-spec-path");
  const specPath = existsSync(specMarkerPath)
    ? readFileSync(specMarkerPath, "utf8").trim()
    : undefined;

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
      .filter(
        (e) =>
          e.isFile() &&
          e.name.startsWith(`${namespace}-`) &&
          e.name.endsWith(".log"),
      )
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
  // Stub for now - will be filled in by subspec 02
  return "  (pending)\n";
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

function getSpecProgress(worktreePath: string): string {
  // Stub for now - will be filled in by subspec 01
  return "-";
}
