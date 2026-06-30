import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createAgent } from "../../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../../agents/quota.ts";
import type { Agent, AgentName } from "../../agents/types.ts";
import type { Io } from "../../cli.ts";
import { readGitOriginUrl } from "../../commands/init.ts";
import {
  type AgentEntry,
  type ConfigOptions,
  findProjectMatchForPath,
  loadConfig,
  setProjectOrigin,
} from "../../config.ts";
import { assertGhReady, getBaseBranch } from "../../gh.ts";
import { buildEffectivePromptAgentEntries } from "../../parse-agent-flag.ts";
import {
  HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessAuthRotateLine,
  harnessQuotaFallbackLenientLine,
} from "../../quota-harness-messages.ts";
import { promptSummary } from "../../run-summary.ts";
import { appendTelemetryLine, type TelemetryKind } from "../../telemetry.ts";
import { extractUsageAndCost, type UsageCostFields } from "../../telemetry-enrichment.ts";
import { createPromptWorktree, pushCurrent } from "../../worktree.ts";
import { acquireWorktreeLock, releaseWorktreeLock } from "../../worktree-lock.ts";
import { DESCENDANT_POLL_INTERVAL_MS, DescendantTracker } from "../patch/reap.ts";
import { buildPrompt } from "./prompt.ts";

export type PromptRunOptions = {
  promptText: string;
  io: Io;
  projectPath: string;
  config: ConfigOptions | undefined;
  pinnedAgent?: AgentEntry;
  skipGhCheck?: boolean | undefined;
  agents?: Partial<Record<AgentName, Agent>>;
  /**
   * Test-only override for the orphan-reap entry point. Lets an induced reap
   * failure be injected deterministically to prove the run's exit code is
   * unaffected. Production callers must not set this.
   */
  __testReapFn?: (tracker: DescendantTracker) => void;
  /** Test-only: invoked after each descendant poll (spawn + interval). */
  __testAfterPollFn?: () => void;
  /** Test-only poll interval when `__testAfterPollFn` is set. */
  __testDescendantPollIntervalMs?: number;
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
  return `${text.slice(0, maxLen - 3)}...`;
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
  const telemetryPath = cfg.telemetryPath ?? null;
  const namespace = `${project.key}:prompt`;
  let exitCode = 0;
  let exitReason = "success";
  let telemetryKind: TelemetryKind = "ok";
  let agentUsed: Agent | undefined;
  let configuredModel: string | undefined;
  let watchdogPgid: number | null = null;
  let watchdogFired = false;
  let usageAndCost: UsageCostFields = {};
  let telemetryWritten = false;

  try {
    const basePrompt = buildPrompt(opts.promptText);

    const effectiveEntries = buildEffectivePromptAgentEntries(opts.pinnedAgent, cfg.modes.prompt.agentOrder);

    if (effectiveEntries.length === 0) {
      opts.io.stderr("jarvis1: no agents configured\n");
      exitCode = 1;
      exitReason = "no-agents-configured";
      return exitCode;
    }

    let agentUsedLocal: Agent | undefined;
    let agentOutput = "";
    let agentSuccess = false;
    let watchdogKillHandle: NodeJS.Timeout | null = null;
    let attemptedAgentCount = 0;
    let quotaAttemptCount = 0;
    let sawNonQuotaFallthrough = false;

    for (let agentIndex = 0; agentIndex < effectiveEntries.length; agentIndex += 1) {
      const entry = effectiveEntries[agentIndex];
      if (entry === undefined) {
        continue;
      }
      const agent = opts.agents?.[entry.agent] ?? createAgent(entry.agent, entry.model);
      const isLastAgent = agentIndex === effectiveEntries.length - 1;
      attemptedAgentCount += 1;
      opts.io.stderr(`jarvis1: invoking ${agent.name}...\n`);

      configuredModel = entry.model;

      const descendantTracker = new DescendantTracker();
      const descendantPollIntervalMs =
        opts.__testAfterPollFn !== undefined && opts.__testDescendantPollIntervalMs !== undefined
          ? opts.__testDescendantPollIntervalMs
          : DESCENDANT_POLL_INTERVAL_MS;
      let descendantPollHandle: NodeJS.Timeout | null = null;
      try {
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

        const rawResult = await agent.run(basePrompt, {
          cwd: worktreePath,
          onSpawned: (child) => {
            watchdogPgid = child.pid;
            // Record descendants immediately, then keep sampling while the agent
            // runs so escapees are captured before their lineage is severed.
            descendantTracker.poll(child.pid);
            opts.__testAfterPollFn?.();
            descendantPollHandle = setInterval(() => {
              descendantTracker.poll(child.pid);
              opts.__testAfterPollFn?.();
            }, descendantPollIntervalMs);
            descendantPollHandle.unref();
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

        const result = applyQuotaFallbackWhenAllowed(
          agent.name,
          rawResult,
          {
            quotaFallback: cfg.quotaFallback,
            weakQuotaExitCodes: cfg.weakQuotaExitCodes,
          },
          true,
        );

        if (result.kind === "quota") {
          agentUsedLocal = agent;
          quotaAttemptCount += 1;
          if (rawResult.kind === "error") {
            opts.io.stderr(`${agent.name}: ${harnessQuotaFallbackLenientLine(rawResult.exitCode)}\n`);
          } else if (rawResult.kind === "quota" && rawResult.authFailure === true) {
            opts.io.stderr(`${agent.name}: ${harnessAuthRotateLine(agent.name)}\n`);
          } else {
            opts.io.stderr(`${agent.name}: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`);
          }
          if (result.stderr.length > 0) {
            opts.io.stderr(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
          }
          if (isLastAgent) {
            if (quotaAttemptCount === attemptedAgentCount && !sawNonQuotaFallthrough) {
              opts.io.stderr(`${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`);
              exitCode = 2;
              exitReason = "all-agents-quota";
              telemetryKind = "quota";
            } else {
              exitCode = 3;
              exitReason = "agent-failure";
              telemetryKind = "error";
            }
          }
          continue;
        }

        if (result.kind === "ok") {
          agentUsedLocal = agent;
          agentOutput = result.stdout;
          agentSuccess = true;
          telemetryKind = "ok";
          usageAndCost = extractUsageAndCost(result, agent.name, configuredModel);
          break;
        }

        if (result.kind === "model_config") {
          sawNonQuotaFallthrough = true;
          agentUsedLocal = agent;
          opts.io.stderr(`${result.stderr}\n`);
          if (isLastAgent) {
            exitCode = 3;
            exitReason = "agent-failure";
            telemetryKind = "error";
          }
          continue;
        }

        opts.io.stderr(`agent failed: ${result.stderr}\n`);
        exitCode = 3;
        exitReason = "agent-failure";
        telemetryKind = "error";
        agentUsedLocal = agent;
        break;
      } finally {
        // Stop sampling, take one final snapshot, and reap descendants that escaped
        // the process group kill. Best-effort: never throws, never affects the exit
        // code.
        if (descendantPollHandle !== null) {
          clearInterval(descendantPollHandle);
        }
        if (watchdogPgid !== null) {
          descendantTracker.poll(watchdogPgid);
        }
        try {
          (opts.__testReapFn ?? ((tracker) => tracker.reap()))(descendantTracker);
        } catch {
          // best-effort
        }
      }
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
      // No-diff case: print response, telemetry, and summary
      opts.io.stdout(agentOutput);

      // Write enriched telemetry before summary reads it
      const durationMs = Date.now() - runStartedMs;

      appendTelemetryLine(telemetryPath, {
        ts: runStartedAt.toISOString(),
        namespace,
        agent: agentUsed.name,
        iteration: 1,
        duration_ms: durationMs,
        kind: telemetryKind,
        exit_reason: exitReason,
        mode: "prompt",
        ...(configuredModel !== undefined ? { configured_model: configuredModel } : {}),
        ...usageAndCost,
      });
      telemetryWritten = true;

      // Emit summary and outcome
      const summary = promptSummary({
        telemetryPath,
        namespace,
        startTs: runStartedAt.toISOString(),
        exitReason,
        durationMs,
      });
      opts.io.stdout(summary);
      opts.io.stdout("No changes were made.\n");

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

    let prUrl: string | undefined;
    try {
      const ghOutput = execFileSync(
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
          encoding: "utf8",
        },
      ).trim();
      prUrl = ghOutput;
    } catch (err) {
      opts.io.stderr(`gh pr create failed: ${(err as Error).message}\n`);
      return 1;
    }

    // Capture duration after PR creation
    const durationMs = Date.now() - runStartedMs;

    // Write enriched telemetry before summary reads it
    appendTelemetryLine(telemetryPath, {
      ts: runStartedAt.toISOString(),
      namespace,
      agent: agentUsed.name,
      iteration: 1,
      duration_ms: durationMs,
      kind: telemetryKind,
      exit_reason: exitReason,
      mode: "prompt",
      ...(configuredModel !== undefined ? { configured_model: configuredModel } : {}),
      ...usageAndCost,
    });
    telemetryWritten = true;

    // Emit summary and outcome with PR URL
    const summary = promptSummary({
      telemetryPath,
      namespace,
      startTs: runStartedAt.toISOString(),
      exitReason,
      durationMs,
    });
    opts.io.stdout(summary);
    if (prUrl) {
      opts.io.stdout(`PR created: ${prUrl}\n`);
    }

    return 0;
  } finally {
    try {
      releaseWorktreeLock(worktreePath);
    } catch (err) {
      opts.io.stderr(`warning: failed to release lock: ${(err as Error).message}\n`);
    }

    // Write telemetry only if success termini didn't already write it
    if (!telemetryWritten) {
      const durationMs = Date.now() - runStartedMs;

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
}
