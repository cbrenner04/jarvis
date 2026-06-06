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
import { appendTelemetryLine, type TelemetryKind } from "../../telemetry.ts";
import { createPromptWorktree, pushCurrent } from "../../worktree.ts";
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
    opts.io.stderr("jarvis1: repo resolution failed: not inside any project registered with `jarvis1 init`\n");
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

  const runStartedAt = new Date();
  const runStartedMs = Date.now();
  let exitCode = 0;
  let exitReason = "success";
  let telemetryKind: TelemetryKind = "ok";
  let agentUsed: Agent | undefined;
  let configuredModel: string | undefined;
  let watchdogPgid: number | null = null;
  let watchdogFired = false;

  try {
    const basePrompt = buildPrompt(opts.promptText);

    // Load agents
    const agents: Agent[] = [];
    for (const entry of cfg.modes.prompt.agentOrder) {
      agents.push(createAgent(entry.agent, entry.model));
    }

    if (agents.length === 0) {
      opts.io.stderr("jarvis1: no agents configured\n");
      exitCode = 1;
      exitReason = "no-agents-configured";
      return exitCode;
    }

    // Try agents in order
    let agentUsedLocal: Agent | undefined;
    let agentOutput = "";
    let agentSuccess = false;
    let watchdogKillHandle: NodeJS.Timeout | null = null;

    for (const agent of agents) {
      opts.io.stderr(`jarvis1: invoking ${agent.name}...\n`);

      // Look up configured model for this agent
      const agentConfigEntry = cfg.modes.prompt.agentOrder.find((entry) => entry.agent === agent.name);
      configuredModel = agentConfigEntry?.model;

      // Setup watchdog timeout
      watchdogPgid = null;
      watchdogFired = false;
      watchdogKillHandle = setTimeout(() => {
        watchdogFired = true;
        const pgid = watchdogPgid;
        if (pgid !== null) {
          opts.io.stderr(
            `[watchdog] iteration timeout fired after ${cfg.iterationTimeoutMs}ms; killing agent pgid ${pgid}\n`,
          );
          try {
            process.kill(-pgid, "SIGTERM");
          } catch {
            // Process may have already exited
          }
        }
        watchdogKillHandle = setTimeout(() => {
          if (pgid !== null) {
            try {
              process.kill(-pgid, "SIGKILL");
            } catch {
              // Process may have already exited
            }
          }
        }, 5000);
        if (watchdogKillHandle) {
          watchdogKillHandle.unref();
        }
      }, cfg.iterationTimeoutMs);
      if (watchdogKillHandle) {
        watchdogKillHandle.unref();
      }

      let result = await agent.run(basePrompt, {
        cwd: worktreePath,
        onSpawned: (child) => {
          watchdogPgid = child.pid;
        },
      });

      // Clear watchdog timeout
      if (watchdogKillHandle) {
        clearTimeout(watchdogKillHandle);
        watchdogKillHandle = null;
      }

      if (watchdogFired) {
        exitCode = 8;
        exitReason = "watchdog-iteration-timeout";
        telemetryKind = "timeout";
        agentUsedLocal = agent;
        break;
      }

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
        exitCode = 2;
        exitReason = "all-agents-quota";
        telemetryKind = "quota";
        agentUsedLocal = agent;
        break;
      }

      if (result.kind === "ok") {
        agentUsedLocal = agent;
        agentOutput = result.stdout;
        agentSuccess = true;
        telemetryKind = "ok";
        break;
      }

      if (result.kind === "model_config") {
        opts.io.stderr(`${result.stderr}\n`);
        telemetryKind = "model_config";
        continue; // Try next agent
      }

      // Last agent failed
      opts.io.stderr(`agent failed: ${result.stderr}\n`);
      exitCode = 3;
      exitReason = "agent-failure";
      telemetryKind = "error";
      agentUsedLocal = agent;
      break;
    }

    agentUsed = agentUsedLocal;

    if (exitCode === 2 || exitCode === 3 || exitCode === 8) {
      return exitCode;
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
      execFileSync(
        "gh",
        [
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
        ],
        {
          cwd: worktreePath,
          stdio: "pipe",
        },
      );
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

    // Write telemetry
    const durationMs = Date.now() - runStartedMs;
    const telemetryPath = cfg.telemetryPath ?? null;
    const namespace = `${project.key}:prompt`;

    appendTelemetryLine(telemetryPath, {
      ts: runStartedAt.toISOString(),
      namespace,
      agent: agentUsed?.name ?? "unknown",
      iteration: 1,
      duration_ms: durationMs,
      kind: telemetryKind,
      exit_reason: exitReason,
      mode: "prompt",
      ...(configuredModel !== undefined ? { configured_model: configuredModel } : {}),
    });
  }
}
