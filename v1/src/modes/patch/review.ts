import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { getCurrentBranch } from "../../../../shared/git.ts";
import { createAgent } from "../../agents/factory.ts";
import type { Agent, AgentName, AgentRunOptions } from "../../agents/types.ts";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import { type AgentEntry, type Config, resolveSubRoleAgentOrder } from "../../config.ts";
import { getBaseBranch, postPrComment, withSyncTransientRetry } from "../../gh.ts";
import { checkBaseCurrent, writeReadyFlipBlocked } from "../../git/base-current.ts";
import { checkPrExists } from "../../pr.ts";
import {
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessAuthRotateLine,
  harnessQuotaFallbackLenientLine,
} from "../../quota-harness-messages.ts";
import {
  getCurrentHeadSha,
  isTreeUnchangedSinceRecordedGreen,
  type ReadyTier,
  runReadyAndCommit,
  selectReadyTier,
} from "../../ready-gate.ts";
import type { CostSource, PatchTelemetryPhase, TelemetryKind, UsageSource } from "../../telemetry.ts";
import { extractUsageAndCost } from "../../telemetry-enrichment.ts";
import {
  isNonFastForwardPushError,
  pushCurrent,
  RebaseConflictError,
  reconcileActuatorCommit,
  tryConvergeNonFfActuatorPush,
} from "../../worktree.ts";
import { type RunReviewOptions, runReview } from "../review/run.ts";
import {
  type ReviewAdapter,
  type ReviewPassContext,
  type ReviewTelemetryEvent,
  ReviewTerminalError,
} from "../review/types.ts";
import { evaluateIdleWatchdog, sampleFileActivityIfNeeded } from "./idle-watchdog.ts";
import { type MaybeMarkReadyOpts, updatePrBody } from "./pr.ts";
import { buildReviewPrompt, buildVerdictActuatorPrompt, type ReviewPromptOpts } from "./prompt.ts";
import { DESCENDANT_POLL_INTERVAL_MS, DescendantTracker } from "./reap.ts";

/** Sentinel file a review agent writes (at the repo root) to signal a blocker. */
export const REVIEW_BLOCKER_FILE = ".jarvis-review-blocker";
export const PATCH_VERDICT_FILE = "verdict-patch.md";

export function detectSpecTreeEdits(specDir: string, cwd: string): string[] {
  // Return spec files modified or newly created since the last commit. Uses
  // porcelain status (not `git diff`) so untracked additions are caught too.
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });

    const specRelPath = relative(cwd, specDir);
    const verdictRelPath = relative(cwd, join(specDir, PATCH_VERDICT_FILE));
    return (
      output
        .split("\n")
        .filter((line) => line.length > 3)
        // Porcelain lines are `XY <path>`; drop the two status columns + space.
        .map((line) => line.slice(3).trim())
        .filter((file) => file !== verdictRelPath)
        .filter((file) => file === specRelPath || file.startsWith(`${specRelPath}/`))
    );
  } catch {
    return [];
  }
}

export function revertSpecTreeEdits(specDir: string, cwd: string): void {
  const editedFiles = detectSpecTreeEdits(specDir, cwd);
  if (editedFiles.length === 0) {
    return;
  }

  // Restore tracked files; `git clean` drops any untracked additions.
  try {
    for (const file of editedFiles) {
      try {
        execFileSync("git", ["checkout", "HEAD", "--", file], {
          cwd,
          stdio: "pipe",
        });
      } catch {
        // Untracked file: nothing to restore from HEAD; clean handles it below.
      }
      execFileSync("git", ["clean", "-fd", "--", file], {
        cwd,
        stdio: "pipe",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to revert spec-tree edits: ${message}`);
  }
}

function detectReviewerCodeEdits(specDir: string, cwd: string): string[] {
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });

    const specRelPath = relative(cwd, specDir);
    return output
      .split("\n")
      .filter((line) => line.length > 3)
      .map((line) => line.slice(3).trim())
      .filter((file) => file !== REVIEW_BLOCKER_FILE)
      .filter((file) => !file.startsWith(".jarvis-review-"))
      .filter((file) => file !== specRelPath && !file.startsWith(`${specRelPath}/`));
  } catch {
    return [];
  }
}

function revertReviewerCodeEdits(specDir: string, cwd: string): void {
  const editedFiles = detectReviewerCodeEdits(specDir, cwd);
  if (editedFiles.length === 0) {
    return;
  }

  try {
    for (const file of editedFiles) {
      try {
        execFileSync("git", ["checkout", "HEAD", "--", file], {
          cwd,
          stdio: "pipe",
        });
      } catch {
        // Untracked file: nothing to restore from HEAD; clean handles it below.
      }
      execFileSync("git", ["clean", "-fd", "--", file], {
        cwd,
        stdio: "pipe",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to revert reviewer code edits: ${message}`);
  }
}

// Read and remove the review-blocker sentinel file if the agent wrote one.
// Returns the blocker description, or null when no blocker was signalled. The
// file is deleted so it is never committed and does not leak into later passes.
export function consumeReviewBlocker(cwd: string): string | null {
  const sentinel = join(cwd, REVIEW_BLOCKER_FILE);
  if (!existsSync(sentinel)) {
    return null;
  }
  let content = "";
  try {
    content = readFileSync(sentinel, "utf8").trim();
  } catch {
    content = "";
  }
  try {
    rmSync(sentinel, { force: true });
  } catch {
    // best-effort
  }
  return content.length > 0 ? content : "(no blocker detail provided)";
}

export function commitReviewPass(
  passNumber: number,
  agentLabel: string,
  cwd: string,
  opts?: { branch?: string; base?: string; specPath?: string; prNarrative?: "template" | "agent" },
): void {
  // Check if there are any changes to commit
  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

  if (porcelain === "") {
    // No changes, skip commit
    return;
  }

  // Stage all changes
  execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });

  // Create commit message
  const commitMessage = appendAgentTrailer(`review: pass ${passNumber}`, agentLabel);

  // Commit
  execFileSync("git", ["commit", "-F", "-"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: commitMessage,
  });

  // Push
  pushCurrent({ cwd, firstPush: false });

  // Refresh PR footer if spec path is provided
  if (opts?.specPath && opts?.branch && opts?.base && opts?.prNarrative) {
    void updatePrBody({
      indexPath: opts.specPath,
      branch: opts.branch,
      base: opts.base,
      cwd,
      prNarrative: opts.prNarrative,
    }).catch(() => {
      // Ignore footer refresh errors, they're not critical
    });
  }
}

type PatchReviewLogTag = "harness" | "outbound" | "inbound_stdout" | "inbound_stderr";
type PatchReviewLogStream = "stdout" | "stderr" | null;
type PatchReviewLogAnnotations = Record<string, string | number | boolean | null>;

/** Patch review logging hook used by the shared review runner adapter. */
export type PatchReviewFanout = (
  tag: PatchReviewLogTag,
  text: string,
  stream: PatchReviewLogStream,
  annotations?: PatchReviewLogAnnotations,
) => void;

/** Patch review telemetry row writer. */
export type PatchReviewTelemetryWriter = (record: {
  agent: string;
  iteration: number;
  durationMs: number;
  kind: TelemetryKind;
  exitReason: string;
  patch_phase: PatchTelemetryPhase;
  configured_model?: string;
  usage?: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
  usage_source?: UsageSource;
  cost_usd?: number | null;
  cost_source?: CostSource;
}) => void;

/** Options for patch review routed through the shared review runner. */
export type PatchReviewPhaseOptions = {
  config: Config;
  cwd: string;
  specPath: string;
  reviewPassesOverride?: number;
  fanout: PatchReviewFanout;
  writeTelemetry: PatchReviewTelemetryWriter;
  agents?: Partial<Record<AgentName, Agent>>;
  iterationTimeoutMs: number;
  /** Test-only override for review-pass abort kill grace. */
  __testKillGraceMs?: number;
  /** Test seam: skip baseline and final ready gates. */
  skipGates?: boolean;
  /** Test seam for baseline `bun run ready`. */
  runBaselineGate?: (tier: ReadyTier) => void;
  /** Test seam for final `bun run ready` + `gh pr ready`. */
  runFinalGate?: (branch: string, tier: ReadyTier | "skip") => void;
  /** Test seam: check if PR exists for review-final readying. */
  checkPrExists?: MaybeMarkReadyOpts["checkPrExists"];
  /** Test seam: resolve/fetch/compare the PR base for review-final readying. */
  checkBaseCurrent?: MaybeMarkReadyOpts["checkBaseCurrent"];
  /** Test seam: override `gh pr ready` during review-final readying. */
  ghPrReady?: MaybeMarkReadyOpts["ghPrReady"];
  /** Test seam: override transient retry behavior for `gh pr ready`. */
  ghPrReadyRetryOpts?: MaybeMarkReadyOpts["ghPrReadyRetryOpts"];
  /** Test seam: operator-visible stderr sink for blocked review-final flips. */
  stderr?: MaybeMarkReadyOpts["stderr"];
  /** Test seam: fixed base branch instead of `getBaseBranch`. */
  baseBranch?: string;
  /** Test override: substitute agents for the resolved review actuator order by index. */
  actuatorAgents?: Agent[];
  /** Recorded green result from completion transition: reuse when tree unchanged, refresh on re-run. */
  recordedGreenResult?: {
    /** HEAD sha from completion transition ready gate (post-`runReadyAndCommit`). */
    headSha: string;
  };
  /** Refresh callback: called when baseline gate re-runs `ready` and succeeds, to update the recorded result. */
  refreshRecordedGreenResult?: (headSha: string) => void;
  /** Per-project override for `bun run ready`. Passed to `runReadyAndCommit` at baseline and final gate sites. */
  readyCommand?: string;
  /** True for `--resume-review`: baseline and final gates always use `full`. */
  resumeReview?: boolean;
  /** Test-only override for descendant reaping (reap.ts DescendantTracker.reap). */
  __testReapOverride?: (tracker: DescendantTracker) => number;
  /** Test-only: invoked after each descendant poll (spawn + interval). */
  __testAfterPollFn?: () => void;
  /** Test-only poll interval when `__testAfterPollFn` is set. */
  __testDescendantPollIntervalMs?: number;
  /** Patch worktree directory for idle watchdog file-activity scanning. */
  patchWorktreeDir?: string;
  /** Idle output timeout in milliseconds (0 to disable). */
  idleOutputTimeoutMs?: number | undefined;
};

type ReapOverride = PatchReviewPhaseOptions["__testReapOverride"];

function startDescendantPolling(
  tracker: DescendantTracker,
  pid: number,
  opts?: { afterPoll?: () => void; intervalMs?: number },
): NodeJS.Timeout {
  const intervalMs = opts?.intervalMs ?? DESCENDANT_POLL_INTERVAL_MS;
  tracker.poll(pid);
  opts?.afterPoll?.();
  const handle = setInterval(() => {
    try {
      tracker.poll(pid);
      opts?.afterPoll?.();
    } catch {
      // best-effort
    }
  }, intervalMs);
  handle.unref?.();
  return handle;
}

function stopDescendantPollingAndReap(
  tracker: DescendantTracker,
  pollRootPid: number | null,
  pollIntervalHandle: NodeJS.Timeout | null,
  reapOverride?: ReapOverride,
): void {
  if (pollIntervalHandle !== null) {
    clearInterval(pollIntervalHandle);
  }
  if (pollRootPid !== null) {
    tracker.poll(pollRootPid);
  }
  reapTrackedDescendants(tracker, reapOverride);
}

function reapTrackedDescendants(tracker: DescendantTracker, reapOverride?: ReapOverride): void {
  try {
    reapOverride ? reapOverride(tracker) : tracker.reap();
  } catch {
    // best-effort: reap failures are non-fatal
  }
}

/** Wrap an agent with per-pass iteration timeout and process-group abort. */
function withReviewPassTimeout(
  agent: Agent,
  opts: {
    timeoutMs: number;
    killGraceMs: number;
    reapOverride?: ReapOverride;
    afterPoll?: () => void;
    descendantPollIntervalMs?: number;
    patchWorktreeDir?: string;
    idleOutputTimeoutMs?: number;
    fanout?: (
      tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr",
      text: string,
      stream: "stdout" | "stderr" | null,
    ) => void;
  },
): Agent {
  return {
    name: agent.name,
    attributionLabel: () => agent.attributionLabel(),
    run: async (prompt: string, runOpts: AgentRunOptions) => {
      const passController = new AbortController();
      let watchdogPgid: number | null = null;
      const tracker = new DescendantTracker();
      let pollIntervalHandle: NodeJS.Timeout | null = null;
      const lastOutputAtMs = { current: null as number | null };
      let lastFileActivityAtMs: number | null = null;
      let idleTimeoutHandle: NodeJS.Timeout | null = null;

      const passTimeoutHandle = setTimeout(() => {
        if (watchdogPgid !== null) {
          try {
            process.kill(-watchdogPgid, "SIGTERM");
          } catch {
            // best-effort
          }
        }
        passController.abort("review-pass-timeout");
      }, opts.timeoutMs);

      // Arm idle watchdog if configured
      const armedAt = Date.now();
      const idleOutputTimeoutMs = opts.idleOutputTimeoutMs ?? 600000;
      const worktreeDir = opts.patchWorktreeDir ?? (typeof runOpts.cwd === "string" ? runOpts.cwd : process.cwd());
      if (idleOutputTimeoutMs > 0) {
        const scheduleIdleCheck = () => {
          idleTimeoutHandle = setTimeout(() => {
            const snapshotAt = Date.now();
            const lastOutputAgeMs = lastOutputAtMs.current === null ? null : snapshotAt - lastOutputAtMs.current;

            const sampledFileActivityAt = sampleFileActivityIfNeeded({
              lastOutputAgeMs,
              idleOutputTimeoutMs,
              now: snapshotAt,
              armedAt,
              workingDir: worktreeDir,
            });

            if (sampledFileActivityAt !== null) {
              lastFileActivityAtMs = sampledFileActivityAt;
            }

            const { shouldFire } = evaluateIdleWatchdog({
              now: snapshotAt,
              lastOutputAt: lastOutputAtMs.current,
              lastFileActivityAt: lastFileActivityAtMs,
              armedAt,
              idleOutputTimeoutMs,
            });

            if (shouldFire) {
              if (opts.fanout) {
                opts.fanout(
                  "harness",
                  `[watchdog] idle timeout fired after ${idleOutputTimeoutMs}ms; killing agent\n`,
                  "stderr",
                );
              }
              if (watchdogPgid !== null) {
                try {
                  process.kill(-watchdogPgid, "SIGTERM");
                } catch {
                  // best-effort
                }
              }
              passController.abort("idle-timeout");
            } else {
              scheduleIdleCheck();
            }
          }, 100);
          idleTimeoutHandle?.unref?.();
        };
        scheduleIdleCheck();
      }

      try {
        return await agent.run(prompt, {
          ...runOpts,
          signal: passController.signal,
          abortKillGraceMs: opts.killGraceMs,
          lastOutputAtMs,
          onSpawned: ({ pid }) => {
            watchdogPgid = pid;
            pollIntervalHandle = startDescendantPolling(tracker, pid, {
              ...(opts.afterPoll !== undefined ? { afterPoll: opts.afterPoll } : {}),
              ...(opts.descendantPollIntervalMs !== undefined ? { intervalMs: opts.descendantPollIntervalMs } : {}),
            });
          },
        });
      } finally {
        clearTimeout(passTimeoutHandle);
        if (idleTimeoutHandle !== null) {
          clearTimeout(idleTimeoutHandle);
        }
        stopDescendantPollingAndReap(tracker, watchdogPgid, pollIntervalHandle, opts.reapOverride);
      }
    },
  };
}

function getRoleArtifactPath(cwd: string, role: string, passNumber: number): string {
  return join(cwd, `.jarvis-review-${role}-${passNumber}`);
}

function createPatchReviewAdapter(args: {
  opts: PatchReviewPhaseOptions;
  specDir: string;
  branch: string;
  base: string;
}): ReviewAdapter {
  const { opts, specDir, branch, base } = args;
  const commitOpts = {
    specPath: opts.specPath,
    branch,
    base,
    prNarrative: opts.config.modes.patch.prNarrative ?? "template",
  };

  const recordPatchTelemetry = (event: ReviewTelemetryEvent, exitCode?: number): void => {
    const configuredModel = event.agentEntry.model;
    const telemetryMeta = { configured_model: configuredModel };
    const usageAndCost =
      (event.outcome === "ok" || event.outcome === "blocked") && event.result.kind === "ok"
        ? extractUsageAndCost(event.result, event.agent.name, configuredModel)
        : {};

    if (event.outcome === "quota") {
      opts.fanout("harness", "review: agent quota exhausted\n", "stderr");
    } else if (event.outcome === "error" || event.outcome === "model_config") {
      opts.fanout("harness", `review: pass ${event.passNumber} error (${event.result.kind})\n`, "stderr");
      if (event.result.kind !== "quota" && event.result.stderr.length > 0) {
        opts.fanout("harness", event.result.stderr, "stderr");
      }
    }

    let kind: TelemetryKind;
    let exitReason: string;
    switch (event.outcome) {
      case "ok":
        kind = "ok";
        exitReason = "ok";
        if (event.result.kind === "ok") {
          if (event.result.stdout.length > 0) {
            opts.fanout("inbound_stdout", event.result.stdout, null, { pass: event.passNumber });
          }
          if (event.result.stderr.length > 0) {
            opts.fanout("inbound_stderr", event.result.stderr, null, { pass: event.passNumber });
          }
        }
        break;
      case "blocked":
        kind = exitCode === 1 ? "error" : "blocked";
        exitReason = exitCode === 1 ? "review-blocker-commit-failed" : "blocker-detected";
        break;
      case "quota":
        kind = "quota";
        exitReason = "quota-exhausted";
        break;
      case "model_config":
        kind = "error";
        exitReason = "model_config";
        break;
      case "error":
        kind = "error";
        // Check if this is an idle timeout
        if (event.result.kind === "error" && event.result.stderr.includes("aborted: idle-timeout")) {
          exitReason = "watchdog-idle-timeout";
        } else {
          exitReason = event.result.kind;
        }
        break;
    }

    opts.writeTelemetry({
      agent: event.agent.name,
      iteration: event.passNumber,
      durationMs: event.durationMs,
      kind,
      exitReason,
      patch_phase: "review",
      ...usageAndCost,
      ...telemetryMeta,
    });
  };

  return {
    buildPrompt: async ({ passNumber, totalPasses, agentEntry, role, priorArtifact }) => {
      const displayRole = role ? ` (${role})` : "";
      opts.fanout("harness", `review: pass ${passNumber}/${totalPasses}${displayRole}\n`, "stdout");
      const promptOpts: ReviewPromptOpts = {
        specPath: opts.specPath,
        cwd: opts.cwd,
        passNumber,
        totalPasses,
        baseBranch: base,
      };
      if (role) {
        promptOpts.role = role;
      }
      if (priorArtifact) {
        promptOpts.priorArtifact = priorArtifact;
      }
      const prompt = buildReviewPrompt(promptOpts);
      const annotations: Record<string, string | number | boolean | null> = {
        pass: passNumber,
        agent: agentEntry.agent,
      };
      if (role) {
        annotations.role = role;
      }
      opts.fanout("outbound", prompt, null, annotations);
      return prompt;
    },
    enforceWriteBoundary: async (ctx) => {
      const editedSpecFiles = detectSpecTreeEdits(specDir, opts.cwd);
      if (editedSpecFiles.length > 0) {
        opts.fanout(
          "harness",
          `review: pass ${ctx.passNumber} edited spec files (reverting): ${editedSpecFiles.join(", ")}\n`,
          "stderr",
        );
        try {
          revertSpecTreeEdits(specDir, opts.cwd);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          opts.fanout("harness", `review: revert failed: ${message}\n`, "stderr");
          throw new ReviewTerminalError(message, 1);
        }
      }

      // Reviewer roles (adversary, advocate, adjudicator) are read-only on code; revert any code edits.
      if (ctx.role && ["adversary", "advocate", "adjudicator"].includes(ctx.role)) {
        const editedCodeFiles = detectReviewerCodeEdits(specDir, opts.cwd);
        if (editedCodeFiles.length === 0) {
          return;
        }
        opts.fanout(
          "harness",
          `review: pass ${ctx.passNumber} edited code files (reverting): ${editedCodeFiles.join(", ")}\n`,
          "stderr",
        );
        try {
          revertReviewerCodeEdits(specDir, opts.cwd);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          opts.fanout("harness", `review: failed to revert code edits: ${message}\n`, "stderr");
          throw new ReviewTerminalError(message, 1);
        }
      }
    },
    readBlocker: async () => consumeReviewBlocker(opts.cwd),
    handleBlocker: async (ctx) => {
      opts.fanout("harness", `review: pass ${ctx.passNumber} encountered blocker\n`, "stderr");
      let blockerCommitFailed = false;
      try {
        commitReviewPass(ctx.passNumber, ctx.agent.name, opts.cwd, commitOpts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.fanout("harness", `review: blocker commit failed: ${message}\n`, "stderr");
        blockerCommitFailed = true;
      }

      try {
        const prNum = checkPrExists(branch, opts.cwd);
        if (prNum) {
          const blockerComment = `## Review Pass ${ctx.passNumber} Blocker\n\n${ctx.blocker}`;
          await postPrComment(prNum, blockerComment, opts.cwd);
          opts.fanout("harness", "review: blocker reported in PR comment\n", "stdout");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.fanout("harness", `review: failed to post PR comment: ${message}\n`, "stderr");
      }

      if (blockerCommitFailed) {
        recordPatchTelemetry({ ...ctx, outcome: "blocked" }, 1);
        throw new ReviewTerminalError("review-blocker-commit-failed", 1, { telemetryRecorded: true });
      }

      return 7;
    },
    commitPass: async (ctx) => {
      // Store the artifact from this role for the next role to read.
      if (ctx.result.kind === "ok" && ctx.role) {
        const artifactPath = getRoleArtifactPath(opts.cwd, ctx.role, ctx.passNumber);
        try {
          writeFileSync(artifactPath, ctx.result.stdout, "utf8");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          opts.fanout("harness", `review: failed to store ${ctx.role} artifact: ${message}\n`, "stderr");
        }
      }

      try {
        // Use role-specific commit messages.
        const roleLabel =
          ctx.role && ["adversary", "advocate", "adjudicator"].includes(ctx.role)
            ? `review: ${ctx.role}`
            : `review: pass ${ctx.passNumber}`;

        // Stage all changes
        execFileSync("git", ["add", "-A"], { cwd: opts.cwd, stdio: "pipe" });

        // Check for changes (excluding temp artifact files)
        const porcelain = execFileSync("git", ["status", "--porcelain"], {
          cwd: opts.cwd,
          encoding: "utf8",
          stdio: "pipe",
        }).trim();

        const hasRealChanges = porcelain
          .split("\n")
          .filter((line) => line.length > 3)
          .map((line) => line.slice(3).trim())
          .some((file) => !file.startsWith(".jarvis-review-"));

        // Clean up temporary artifact files (don't commit them)
        if (ctx.role) {
          const artifactPath = getRoleArtifactPath(opts.cwd, ctx.role, ctx.passNumber);
          try {
            execFileSync("git", ["reset", "HEAD", "--", artifactPath], {
              cwd: opts.cwd,
              stdio: "pipe",
            });
            rmSync(artifactPath, { force: true });
          } catch {
            // best-effort
          }
        }

        if (!hasRealChanges) {
          // No changes (excluding temp files), skip commit
          return;
        }

        // Create commit message
        const commitMessage = appendAgentTrailer(roleLabel, ctx.agent.name);

        // Commit
        execFileSync("git", ["commit", "-F", "-"], {
          cwd: opts.cwd,
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
          input: commitMessage,
        });

        // Push
        pushCurrent({ cwd: opts.cwd, firstPush: false });

        // Refresh PR footer if spec path is provided
        if (opts.specPath && branch && base) {
          void updatePrBody({
            indexPath: opts.specPath,
            branch,
            base,
            cwd: opts.cwd,
            prNarrative: opts.config.modes.patch.prNarrative ?? "template",
          }).catch(() => {
            // Ignore footer refresh errors, they're not critical
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.fanout("harness", `review: commit failed: ${message}\n`, "stderr");
        const usageAndCost =
          ctx.result.kind === "ok" ? extractUsageAndCost(ctx.result, ctx.agent.name, ctx.agentEntry.model) : {};
        opts.writeTelemetry({
          agent: ctx.agent.name,
          iteration: ctx.passNumber,
          durationMs: ctx.durationMs,
          kind: "error",
          exitReason: "review-commit-failed",
          patch_phase: "review",
          configured_model: ctx.agentEntry.model,
          ...usageAndCost,
        });
        throw new ReviewTerminalError(message, 1, { telemetryRecorded: true });
      }
      opts.fanout("harness", `review: pass ${ctx.passNumber} completed\n`, "stdout");
    },
    recordTelemetry: async (event) => {
      recordPatchTelemetry(event, event.exitCode);
    },
  };
}

// Map review exit codes: preserve blocker (7) and interrupt (130), remap others to review-incomplete (11).
function mapReviewExitCode(exitCode: number): number {
  return exitCode === 7 || exitCode === 130 ? exitCode : 11;
}

/** Run patch review passes through the shared review runner. */
export async function runPatchReviewPhase(opts: PatchReviewPhaseOptions): Promise<number> {
  let idleTimeoutOccurred = false;
  if (!opts.skipGates) {
    opts.fanout("harness", "review: running baseline gate\n", "stdout");
    try {
      const tier: ReadyTier = opts.resumeReview
        ? "full"
        : selectReadyTier({
            cwd: opts.cwd,
            ...(opts.recordedGreenResult !== undefined ? { recordedGreenResult: opts.recordedGreenResult } : {}),
          });

      if (opts.runBaselineGate) {
        opts.runBaselineGate(tier);
      } else {
        runReadyAndCommit({
          cwd: opts.cwd,
          agentLabel: "review-baseline",
          tier,
          ...(opts.readyCommand !== undefined ? { readyCommand: opts.readyCommand } : {}),
        });
        if (tier === "full" && opts.refreshRecordedGreenResult) {
          opts.refreshRecordedGreenResult(getCurrentHeadSha(opts.cwd));
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.fanout("harness", `review baseline gate failed: ${message}\n`, "stderr");
      // NOTE: A red tree is a real error regardless of how review was entered.
      // This exit path (return 1) is reachable via --resume-review, which can
      // re-enter against a stale or red baseline tree. The return 1 path is
      // distinct from the review-execution failures (which return 11), and is
      // not remapped by mapReviewExitCode.
      return 1;
    }
  }

  const branch = getCurrentBranch(opts.cwd);
  const base = opts.baseBranch ?? (await getBaseBranch(opts.cwd));
  const specDir = dirname(opts.specPath);
  const killGraceMs = opts.__testKillGraceMs ?? 5000;
  const descendantPollIntervalMs =
    opts.__testAfterPollFn !== undefined && opts.__testDescendantPollIntervalMs !== undefined
      ? opts.__testDescendantPollIntervalMs
      : undefined;
  const idleOutputTimeoutMs =
    opts.idleOutputTimeoutMs !== undefined ? opts.idleOutputTimeoutMs : (opts.config.idleOutputTimeoutMs ?? 600000);
  const reviewPassTimeoutOpts = {
    timeoutMs: opts.iterationTimeoutMs,
    killGraceMs,
    idleOutputTimeoutMs,
    patchWorktreeDir: opts.patchWorktreeDir ?? opts.cwd,
    fanout: opts.fanout,
    ...(opts.__testReapOverride !== undefined ? { reapOverride: opts.__testReapOverride } : {}),
    ...(opts.__testAfterPollFn !== undefined ? { afterPoll: opts.__testAfterPollFn } : {}),
    ...(descendantPollIntervalMs !== undefined ? { descendantPollIntervalMs } : {}),
  };

  // Create actuator that runs the patch agent with the verdict
  const createActuator = (actuatorOrder: AgentEntry[], actuatorAgents?: Agent[]) => {
    return async (verdict: string, ctx: ReviewPassContext): Promise<void> => {
      if (!verdict?.trim()) {
        // Empty verdict: skip actuator invocation (existing no-change path)
        return;
      }

      opts.fanout("harness", `review: actuator running with verdict\n`, "stdout");

      // Write verdict to durable doc next to the spec
      const verdictPath = join(specDir, PATCH_VERDICT_FILE);
      try {
        writeFileSync(verdictPath, verdict, "utf8");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.fanout("harness", `review: failed to write verdict: ${message}\n`, "stderr");
        throw new ReviewTerminalError(message, 1);
      }

      // Build actuator prompt from the verdict
      const prompt = buildVerdictActuatorPrompt(verdict, opts.specPath);

      // The verdict actuator stays head-only even when its configured order has fallback rungs.
      const headEntry = actuatorOrder[0];
      const agent = actuatorAgents?.[0] ?? (headEntry ? opts.agents?.[headEntry.agent] : undefined);
      if (agent === undefined) {
        if (headEntry === undefined) {
          opts.fanout("harness", "review: actuator no agents available\n", "stderr");
          throw new ReviewTerminalError("actuator no agents available", 2);
        }
      }

      const resolvedAgent = agent ?? (headEntry ? createAgent(headEntry.agent, headEntry.model) : undefined);
      if (resolvedAgent === undefined) {
        opts.fanout("harness", "review: actuator no agents available\n", "stderr");
        throw new ReviewTerminalError("actuator no agents available", 2);
      }

      const configuredModel = headEntry?.model;
      const telemetryMeta = configuredModel ? { configured_model: configuredModel } : {};

      const actuatorController = new AbortController();
      const actuatorTimeoutHandle = setTimeout(() => {
        actuatorController.abort("actuator-timeout");
      }, opts.iterationTimeoutMs);

      const actuatorStartedMs = Date.now();
      const actuatorTracker = new DescendantTracker();
      let actuatorPollHandle: NodeJS.Timeout | null = null;
      let actuatorPgid: number | null = null;
      const actuatorLastOutputAtMs = { current: null as number | null };
      let actuatorLastFileActivityAtMs: number | null = null;
      let actuatorIdleTimeoutHandle: NodeJS.Timeout | null = null;

      // Arm idle watchdog for actuator if configured
      const actuatorArmedAt = Date.now();
      const actuatorIdleOutputTimeoutMs =
        opts.idleOutputTimeoutMs !== undefined ? opts.idleOutputTimeoutMs : (opts.config.idleOutputTimeoutMs ?? 600000);
      const actuatorWorktreeDir = opts.patchWorktreeDir ?? opts.cwd;
      if (actuatorIdleOutputTimeoutMs > 0) {
        const scheduleActuatorIdleCheck = () => {
          actuatorIdleTimeoutHandle = setTimeout(() => {
            const snapshotAt = Date.now();
            const lastOutputAgeMs =
              actuatorLastOutputAtMs.current === null ? null : snapshotAt - actuatorLastOutputAtMs.current;

            const sampledFileActivityAt = sampleFileActivityIfNeeded({
              lastOutputAgeMs,
              idleOutputTimeoutMs: actuatorIdleOutputTimeoutMs,
              now: snapshotAt,
              armedAt: actuatorArmedAt,
              workingDir: actuatorWorktreeDir,
            });

            if (sampledFileActivityAt !== null) {
              actuatorLastFileActivityAtMs = sampledFileActivityAt;
            }

            const { shouldFire } = evaluateIdleWatchdog({
              now: snapshotAt,
              lastOutputAt: actuatorLastOutputAtMs.current,
              lastFileActivityAt: actuatorLastFileActivityAtMs,
              armedAt: actuatorArmedAt,
              idleOutputTimeoutMs: actuatorIdleOutputTimeoutMs,
            });

            if (shouldFire) {
              opts.fanout(
                "harness",
                `[watchdog] idle timeout fired after ${actuatorIdleOutputTimeoutMs}ms; killing agent\n`,
                "stderr",
              );
              if (actuatorPgid !== null) {
                try {
                  process.kill(-actuatorPgid, "SIGTERM");
                } catch {
                  // best-effort
                }
              }
              actuatorController.abort("idle-timeout");
            } else {
              scheduleActuatorIdleCheck();
            }
          }, 100);
          actuatorIdleTimeoutHandle?.unref?.();
        };
        scheduleActuatorIdleCheck();
      }

      try {
        opts.fanout("outbound", prompt, null, {
          actuator: true,
          agent: resolvedAgent.name,
        });

        const result = await resolvedAgent.run(prompt, {
          cwd: opts.cwd,
          signal: actuatorController.signal,
          abortKillGraceMs: killGraceMs,
          lastOutputAtMs: actuatorLastOutputAtMs,
          onSpawned: ({ pid }) => {
            actuatorPgid = pid;
            actuatorPollHandle = startDescendantPolling(actuatorTracker, pid, {
              ...(opts.__testAfterPollFn !== undefined ? { afterPoll: opts.__testAfterPollFn } : {}),
              ...(descendantPollIntervalMs !== undefined ? { intervalMs: descendantPollIntervalMs } : {}),
            });
          },
        });

        const durationMs = Math.max(0, Date.now() - actuatorStartedMs);

        if (result.kind === "ok") {
          if (result.stdout.length > 0) {
            opts.fanout("inbound_stdout", result.stdout, null, { actuator: true });
          }
          if (result.stderr.length > 0) {
            opts.fanout("inbound_stderr", result.stderr, null, { actuator: true });
          }

          try {
            writeFileSync(verdictPath, verdict, "utf8");
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            opts.fanout("harness", `review: failed to restore verdict: ${message}\n`, "stderr");
            throw new ReviewTerminalError(message, 1);
          }

          // Revert spec edits (reviewers are read-only on spec)
          const editedSpecFiles = detectSpecTreeEdits(specDir, opts.cwd);
          if (editedSpecFiles.length > 0) {
            opts.fanout(
              "harness",
              `review: actuator edited spec files (reverting): ${editedSpecFiles.join(", ")}\n`,
              "stderr",
            );
            try {
              revertSpecTreeEdits(specDir, opts.cwd);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              opts.fanout("harness", `review: revert failed: ${message}\n`, "stderr");
              throw new ReviewTerminalError(message, 1);
            }
          }

          // Commit actuator changes
          const porcelain = execFileSync("git", ["status", "--porcelain"], {
            cwd: opts.cwd,
            encoding: "utf8",
            stdio: "pipe",
          }).trim();

          if (porcelain !== "") {
            try {
              execFileSync("git", ["add", "-A"], { cwd: opts.cwd, stdio: "pipe" });
              const commitMessage = appendAgentTrailer("review: actuator", resolvedAgent.name);
              execFileSync("git", ["commit", "-F", "-"], {
                cwd: opts.cwd,
                env: process.env,
                stdio: ["pipe", "pipe", "pipe"],
                input: commitMessage,
              });

              // Reconcile with remote before push
              try {
                reconcileActuatorCommit(opts.cwd);
              } catch (reconcileErr) {
                if (reconcileErr instanceof RebaseConflictError) {
                  opts.fanout("harness", `review: actuator rebase conflict: ${reconcileErr.message}\n`, "stderr");
                  const usageAndCost = extractUsageAndCost(result, resolvedAgent.name, configuredModel);
                  opts.writeTelemetry({
                    agent: resolvedAgent.name,
                    iteration: ctx.passNumber,
                    durationMs,
                    kind: "error",
                    exitReason: "actuator-rebase-conflict",
                    patch_phase: "review",
                    ...usageAndCost,
                    ...telemetryMeta,
                  });
                  throw new ReviewTerminalError(reconcileErr.message, 11, { telemetryRecorded: true });
                }
                // Other reconcile errors are non-fatal; fall through to push
              }

              pushCurrent({ cwd: opts.cwd, firstPush: false });

              // Refresh PR footer
              void updatePrBody({
                indexPath: opts.specPath,
                branch,
                base,
                cwd: opts.cwd,
                prNarrative: opts.config.modes.patch.prNarrative ?? "template",
              }).catch(() => {
                // Ignore footer refresh errors
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              const usageAndCost = extractUsageAndCost(result, resolvedAgent.name, configuredModel);

              // Check if this is a non-fast-forward push rejection
              if (isNonFastForwardPushError(message)) {
                try {
                  const convergenceResult = tryConvergeNonFfActuatorPush(opts.cwd, branch);
                  if (convergenceResult.converged) {
                    // Convergence succeeded; exit with 11 to trigger auto-ready
                    opts.fanout("harness", `review: actuator push rejected non-ff; converged to PR head\n`, "stdout");
                    opts.writeTelemetry({
                      agent: resolvedAgent.name,
                      iteration: ctx.passNumber,
                      durationMs,
                      kind: "error",
                      exitReason: "actuator-push-converged",
                      patch_phase: "review",
                      ...usageAndCost,
                      ...telemetryMeta,
                    });
                    throw new ReviewTerminalError("non-ff push converged", 11);
                  }
                  // Convergence failed; fall through to surface the original push error
                } catch (convergenceErr) {
                  // If the convergence itself threw an unexpected error, fall through
                  if (!(convergenceErr instanceof ReviewTerminalError)) {
                    // Unexpected error; fall through to surface the original push error
                  } else {
                    // Re-throw ReviewTerminalError (convergence succeeded and threw exit-11)
                    throw convergenceErr;
                  }
                }
              }

              // Non-ff convergence not attempted or failed; surface the original push error
              opts.fanout("harness", `review: actuator commit failed: ${message}\n`, "stderr");
              opts.writeTelemetry({
                agent: resolvedAgent.name,
                iteration: ctx.passNumber,
                durationMs,
                kind: "error",
                exitReason: "actuator-commit-failed",
                patch_phase: "review",
                ...usageAndCost,
                ...telemetryMeta,
              });
              throw new ReviewTerminalError(message, 1);
            }

            opts.fanout("harness", `review: actuator completed\n`, "stdout");
            opts.writeTelemetry({
              agent: resolvedAgent.name,
              iteration: ctx.passNumber,
              durationMs,
              kind: "ok",
              exitReason: "ok",
              patch_phase: "review",
              ...extractUsageAndCost(result, resolvedAgent.name, configuredModel),
              ...telemetryMeta,
            });
          } else {
            // No changes from actuator
            opts.fanout("harness", `review: actuator made no changes\n`, "stdout");
            opts.writeTelemetry({
              agent: resolvedAgent.name,
              iteration: ctx.passNumber,
              durationMs,
              kind: "ok",
              exitReason: "ok",
              patch_phase: "review",
              ...extractUsageAndCost(result, resolvedAgent.name, configuredModel),
              ...telemetryMeta,
            });
          }
        } else {
          opts.fanout("harness", `review: actuator error (${result.kind})\n`, "stderr");
          if (result.kind !== "quota" && result.stderr.length > 0) {
            opts.fanout("harness", result.stderr, "stderr");
          }
          const isIdleTimeout = result.kind === "error" && result.stderr.includes("aborted: idle-timeout");
          if (isIdleTimeout) {
            // The actuator writes via opts.writeTelemetry (not trackingWriteTelemetry),
            // so set the idle flag directly; the catch maps it to exit 8.
            idleTimeoutOccurred = true;
          }
          const exitCode = result.kind === "model_config" ? 3 : result.kind === "error" ? result.exitCode : 1;
          opts.writeTelemetry({
            agent: resolvedAgent.name,
            iteration: ctx.passNumber,
            durationMs,
            kind: result.kind === "quota" ? "quota" : result.kind === "model_config" ? "error" : "error",
            exitReason: isIdleTimeout ? "watchdog-idle-timeout" : result.kind,
            patch_phase: "review",
            ...telemetryMeta,
          });
          throw new ReviewTerminalError(`actuator failed: ${result.kind}`, exitCode);
        }
      } finally {
        clearTimeout(actuatorTimeoutHandle);
        if (actuatorIdleTimeoutHandle !== null) {
          clearTimeout(actuatorIdleTimeoutHandle);
        }
        stopDescendantPollingAndReap(actuatorTracker, actuatorPgid, actuatorPollHandle, opts.__testReapOverride);
      }
    };
  };

  try {
    const wrappedTelemetry = opts.writeTelemetry;
    const reviewPanelOrder = resolveSubRoleAgentOrder(opts.config, "reviewPanel");
    const reviewActuatorOrder = resolveSubRoleAgentOrder(opts.config, "reviewActuator");
    const trackingWriteTelemetry = (record: Parameters<typeof opts.writeTelemetry>[0]) => {
      if (record.exitReason === "watchdog-idle-timeout") {
        idleTimeoutOccurred = true;
      }
      wrappedTelemetry(record);
    };

    const runReviewOpts: RunReviewOptions = {
      config: opts.config,
      cwd: opts.cwd,
      adapter: createPatchReviewAdapter({
        opts: { ...opts, writeTelemetry: trackingWriteTelemetry },
        specDir,
        branch,
        base,
      }),
      ...(opts.reviewPassesOverride !== undefined ? { reviewPassesOverride: opts.reviewPassesOverride } : {}),
      reviewAgentOrder: reviewPanelOrder,
      loadAgent: ({ name, model }) => {
        const override = opts.agents?.[name as AgentName];
        const agent = override ?? createAgent(name as AgentName, model);
        return withReviewPassTimeout(agent, reviewPassTimeoutOpts);
      },
      onAllAgentsQuotaExhausted: (message) => {
        opts.fanout("harness", `${message}\n`, "stderr");
      },
      onQuotaRotation: (agent, spawnResult, classified) => {
        if (classified.kind !== "quota") {
          return;
        }
        let line: string;
        if (spawnResult.kind === "quota" && spawnResult.authFailure === true) {
          line = harnessAuthRotateLine(agent);
        } else if (spawnResult.kind === "quota") {
          line = HARNESS_QUOTA_FALLBACK_STRICT;
        } else {
          line = harnessQuotaFallbackLenientLine(spawnResult.kind === "error" ? spawnResult.exitCode : 0);
        }
        opts.fanout("harness", `${agent}: ${line}\n`, "stderr");
        if (spawnResult.kind === "error" && spawnResult.stderr.length > 0) {
          const stderr = spawnResult.stderr.endsWith("\n") ? spawnResult.stderr : `${spawnResult.stderr}\n`;
          opts.fanout("harness", stderr, "stderr");
        }
      },
    };

    runReviewOpts.actuator = createActuator(reviewActuatorOrder, opts.actuatorAgents);

    const reviewExitCode = await runReview(runReviewOpts);

    if (idleTimeoutOccurred) {
      return 11;
    }

    if (reviewExitCode !== 0) {
      return mapReviewExitCode(reviewExitCode);
    }
  } catch (err) {
    // An idle-watchdog abort surfaces as a thrown ReviewTerminalError (exit -1);
    // the telemetry record already set idleTimeoutOccurred, so map it to 11 here
    // (the return-path check above is skipped when the actuator throws).
    if (idleTimeoutOccurred) {
      return 11;
    }
    if (err instanceof ReviewTerminalError) {
      return mapReviewExitCode(err.exitCode);
    }
    throw err;
  }

  if (!opts.skipGates) {
    opts.fanout("harness", "review: running final ready\n", "stdout");
    try {
      const skipReady =
        opts.resumeReview !== true &&
        opts.recordedGreenResult !== undefined &&
        isTreeUnchangedSinceRecordedGreen({
          cwd: opts.cwd,
          recordedGreenHeadSha: opts.recordedGreenResult.headSha,
        });
      const prExists = (opts.checkPrExists ?? checkPrExists)(branch, opts.cwd);
      if (!prExists) {
        throw new Error(
          `cannot mark PR ready: no PR found for branch ${branch}. This should not happen after opening a draft PR.`,
        );
      }
      const baseCurrent = (opts.checkBaseCurrent ?? checkBaseCurrent)({ branch, cwd: opts.cwd });
      if (baseCurrent.status === "behind") {
        writeReadyFlipBlocked(
          opts.stderr ?? process.stderr.write.bind(process.stderr),
          branch,
          baseCurrent.baseRefName,
        );
        return 0;
      }

      if (opts.runFinalGate) {
        opts.runFinalGate(branch, skipReady ? "skip" : "full");
      } else if (skipReady) {
        const ghPrReadyFn =
          opts.ghPrReady ??
          ((readyBranch: string, cwd: string) => {
            withSyncTransientRetry(
              () => {
                execFileSync("gh", ["pr", "ready", readyBranch], {
                  cwd,
                  env: process.env,
                  stdio: "pipe",
                });
              },
              { op: "gh pr ready", isPrReady: true, ...opts.ghPrReadyRetryOpts },
            );
          });
        ghPrReadyFn(branch, opts.cwd);
      } else {
        runReadyAndCommit({
          cwd: opts.cwd,
          agentLabel: "review-final",
          tier: "full",
          ...(opts.readyCommand !== undefined ? { readyCommand: opts.readyCommand } : {}),
        });
        const ghPrReadyFn =
          opts.ghPrReady ??
          ((readyBranch: string, cwd: string) => {
            withSyncTransientRetry(
              () => {
                execFileSync("gh", ["pr", "ready", readyBranch], {
                  cwd,
                  env: process.env,
                  stdio: "pipe",
                });
              },
              { op: "gh pr ready", isPrReady: true, ...opts.ghPrReadyRetryOpts },
            );
          });
        ghPrReadyFn(branch, opts.cwd);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.fanout("harness", `review final ready failed: ${message}\n`, "stderr");
      return 1;
    }
  }

  return 0;
}
