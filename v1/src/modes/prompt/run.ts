import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent } from "../../agents/types.ts";
import type { Io } from "../../cli.ts";
import { readGitOriginUrl } from "../../commands/init.ts";
import {
  type Config,
  type ConfigOptions,
  findProjectMatchForPath,
  loadConfig,
  setProjectOrigin,
} from "../../config.ts";
import { assertGhReady, getBaseBranch } from "../../gh.ts";
import { harnessQuotaFallbackLenientLine } from "../../quota-harness-messages.ts";
import {
  createPromptWorktree,
  pushCurrent,
} from "../../worktree.ts";
import { acquireWorktreeLock, releaseWorktreeLock } from "../../worktree-lock.ts";
import { buildPrompt } from "./prompt.ts";

export type PromptRunOptions = {
  promptText: string;
  io: Io;
  projectPath: string;
  config: ConfigOptions | undefined;
  skipGhCheck?: boolean | undefined;
};

function generateNonce(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function iso8601DateTime(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}`;
}

function extractFirstLine(text: string): string {
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return "";
}

function ellipsizeIfNeeded(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.slice(0, maxLen - 3) + "...";
}

export async function promptCommand(opts: PromptRunOptions): Promise<number> {
  const cfg = loadConfig(opts.config);

  if (!cfg.git) {
    opts.io.stderr("jarvis1: prompt mode requires git to be enabled\n");
    return 1;
  }

  // Resolve project and preflight checks
  const project = findProjectMatchForPath(opts.projectPath, opts.config);
  if (project === undefined) {
    opts.io.stderr(
      "jarvis1: repo resolution failed: not inside any project registered with `jarvis1 init`\n",
    );
    return 1;
  }

  const projectRoot = resolve(project.root);

  // Update origin if needed
  try {
    const origin = readGitOriginUrl(projectRoot);
    if (origin !== undefined) {
      setProjectOrigin(project.key, origin, opts.config);
    }
  } catch {
    // Ignore errors reading origin
  }

  // Check gh
  if (!opts.skipGhCheck) {
    try {
      await assertGhReady();
    } catch (err) {
      opts.io.stderr(`${(err as Error).message}\n`);
      return 1;
    }
  }

  // Generate worktree name
  const timestamp = iso8601DateTime();
  const nonce = generateNonce();

  // Create worktree
  let worktreePath: string;
  try {
    worktreePath = await createPromptWorktree({
      projectRoot,
      timestamp,
      nonce,
    });
  } catch (err) {
    opts.io.stderr(`failed to create worktree: ${(err as Error).message}\n`);
    return 1;
  }

  // Acquire lock
  try {
    const lockResult = acquireWorktreeLock(worktreePath);
    if (lockResult.kind === "busy") {
      opts.io.stderr(
        `worktree is in use by process ${lockResult.existingLock.pid} (started at ${lockResult.existingLock.started_at})\n`,
      );
      return 1;
    }
  } catch (err) {
    opts.io.stderr(`failed to acquire lock: ${(err as Error).message}\n`);
    return 1;
  }

  try {
    const basePrompt = buildPrompt(opts.promptText);
    const cfg = loadConfig(opts.config);

    // Load agents
    const agents: Agent[] = [];
    for (const entry of cfg.modes.prompt.agentOrder) {
      agents.push(createAgent(entry.agent, entry.model));
    }

    if (agents.length === 0) {
      opts.io.stderr("jarvis1: no agents configured\n");
      return 1;
    }

    // Try agents in order
    let agentUsed: Agent | undefined;
    let agentOutput = "";
    let agentSuccess = false;

    for (const agent of agents) {
      opts.io.stderr(`jarvis1: invoking ${agent.name}...\n`);
      let result = await agent.run(basePrompt, { cwd: worktreePath });

      // Apply quota fallback
      result = applyQuotaFallbackWhenAllowed(
        agent.name,
        result,
        {
          quotaFallback: cfg.quotaFallback,
          weakQuotaExitCodes: cfg.weakQuotaExitCodes,
        },
        true, // allowLenientWeakQuotaFallback
      );

      if (result.kind === "quota") {
        opts.io.stderr(`${result.stderr}\n`);
        return 2; // All agents quota
      }

      if (result.kind === "ok") {
        agentUsed = agent;
        agentOutput = result.stdout;
        agentSuccess = true;
        break;
      }

      if (result.kind === "model_config") {
        opts.io.stderr(`${result.stderr}\n`);
        continue; // Try next agent
      }

      // Last agent failed
      opts.io.stderr(`agent failed: ${result.stderr}\n`);
      break;
    }

    if (!agentSuccess || !agentUsed) {
      return 3;
    }

    // Check if there are diffs
    const statusOutput = execFileSync("git", ["status", "--porcelain"], {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    const hasDiffs = statusOutput.length > 0;

    if (!hasDiffs) {
      // No-diff case: print response and exit
      opts.io.stdout(agentOutput);
      return 0;
    }

    // Diff case: commit, push, and open PR
    const commitSubject = ellipsizeIfNeeded(extractFirstLine(opts.promptText), 72);
    const commitBody = `${opts.promptText}\n\nJarvis-Agent: ${agentUsed.attributionLabel()}`;

    try {
      execFileSync("git", ["add", "-A"], { cwd: worktreePath, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", `${commitSubject}\n\n${commitBody}`], {
        cwd: worktreePath,
        stdio: "pipe",
      });
    } catch (err) {
      opts.io.stderr(`commit failed: ${(err as Error).message}\n`);
      return 1;
    }

    // Push
    try {
      pushCurrent({ cwd: worktreePath, firstPush: true });
    } catch (err) {
      opts.io.stderr(`push failed: ${(err as Error).message}\n`);
      return 1;
    }

    // Open PR
    const baseBranch = await getBaseBranch(projectRoot);
    const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    const prBody = `${opts.promptText}\n\n---\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`;

    try {
      execFileSync("gh", [
        "pr",
        "create",
        "--draft",
        "--base",
        baseBranch,
        "--head",
        currentBranch,
        "--title",
        commitSubject,
        "--body",
        prBody,
      ], {
        cwd: worktreePath,
        stdio: "pipe",
      });
    } catch (err) {
      opts.io.stderr(`gh pr create failed: ${(err as Error).message}\n`);
      return 1;
    }

    return 0;
  } finally {
    try {
      releaseWorktreeLock(worktreePath);
    } catch (err) {
      opts.io.stderr(`warning: failed to release lock: ${(err as Error).message}\n`);
    }
  }
}
