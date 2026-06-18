import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { getCurrentBranch } from "../../../../shared/git.ts";
import { createAgent } from "../../agents/factory.ts";
import type { Agent, AgentName, AgentRunOptions } from "../../agents/types.ts";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import type { Config } from "../../config.ts";
import { getBaseBranch, postPrComment } from "../../gh.ts";
import { checkPrExists } from "../../pr.ts";
import { HARNESS_QUOTA_FALLBACK_STRICT, harnessQuotaFallbackLenientLine } from "../../quota-harness-messages.ts";
import { getCurrentHeadSha, isTreeUnchangedSinceRecordedGreen } from "../../ready-gate.ts";
import type { CostSource, PatchTelemetryPhase, TelemetryKind, UsageSource } from "../../telemetry.ts";
import { extractUsageAndCost } from "../../telemetry-enrichment.ts";
import { pushCurrent } from "../../worktree.ts";
import { type RunReviewOptions, runReview } from "../review/run.ts";
import {
  type ReviewAdapter,
  type ReviewPassContext,
  type ReviewTelemetryEvent,
  ReviewTerminalError,
} from "../review/types.ts";
import { runReadyAndCommit, updatePrBody } from "./pr.ts";
import { buildReviewPrompt, buildVerdictActuatorPrompt, type ReviewPromptOpts } from "./prompt.ts";

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
  opts?: { branch?: string; base?: string; specPath?: string },
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
  if (opts?.specPath && opts?.branch && opts?.base) {
    void updatePrBody({
      indexPath: opts.specPath,
      branch: opts.branch,
      base: opts.base,
      cwd,
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
  runBaselineGate?: () => void;
  /** Test seam for final `bun run ready` + `gh pr ready`. */
  runFinalGate?: (branch: string) => void;
  /** Test seam: fixed base branch instead of `getBaseBranch`. */
  baseBranch?: string;
  /** Actuator context: the active patch agents to use for verdict execution. */
  actuatorAgents?: Agent[];
  /** Recorded green result from completion transition: reuse when tree unchanged, refresh on re-run. */
  recordedGreenResult?: {
    /** HEAD sha from completion transition ready gate (post-`runReadyAndCommit`). */
    headSha: string;
  };
  /** Refresh callback: called when baseline gate re-runs `ready` and succeeds, to update the recorded result. */
  refreshRecordedGreenResult?: (headSha: string) => void;
};

/** Wrap an agent with per-pass iteration timeout and process-group abort. */
function withReviewPassTimeout(agent: Agent, opts: { timeoutMs: number; killGraceMs: number }): Agent {
  return {
    name: agent.name,
    attributionLabel: () => agent.attributionLabel(),
    run: async (prompt: string, runOpts: AgentRunOptions) => {
      const passController = new AbortController();
      let watchdogPgid: number | null = null;
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

      try {
        return await agent.run(prompt, {
          ...runOpts,
          signal: passController.signal,
          abortKillGraceMs: opts.killGraceMs,
          onSpawned: ({ pid }) => {
            watchdogPgid = pid;
          },
        });
      } finally {
        clearTimeout(passTimeoutHandle);
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
  const commitOpts = { specPath: opts.specPath, branch, base };

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
        exitReason = event.result.kind;
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

/** Run patch review passes through the shared review runner. */
export async function runPatchReviewPhase(opts: PatchReviewPhaseOptions): Promise<number> {
  if (!opts.skipGates) {
    opts.fanout("harness", "review: running baseline gate\n", "stdout");
    try {
      // Check if tree is unchanged and we can reuse the recorded green result
      const treeUnchanged =
        opts.recordedGreenResult !== undefined &&
        isTreeUnchangedSinceRecordedGreen({
          cwd: opts.cwd,
          recordedGreenHeadSha: opts.recordedGreenResult.headSha,
        });

      if (treeUnchanged) {
        opts.fanout(
          "harness",
          "review: tree unchanged since completion transition, reusing recorded green result\n",
          "stdout",
        );
      } else {
        // Tree changed or no recorded result: run ready and refresh the result on success
        if (opts.runBaselineGate) {
          opts.runBaselineGate();
        } else {
          runReadyAndCommit({
            cwd: opts.cwd,
            agentLabel: "review-baseline",
          });
        }
        // On success, refresh the recorded result
        if (opts.refreshRecordedGreenResult) {
          const newHeadSha = getCurrentHeadSha(opts.cwd);
          opts.refreshRecordedGreenResult(newHeadSha);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.fanout("harness", `review baseline gate failed: ${message}\n`, "stderr");
      // NOTE: On the completion path, the completion `ready` gate (run.ts:1574)
      // runs before shrink/review and ensures `ready` is green. This exit path
      // (return 1) is unreachable on the completion path — it is a backstop for
      // non-completion paths. The completion path's sole response to red `ready`
      // is the stuck-red stop (exit 10 in run.ts:1601) after fix-up iterations.
      return 1;
    }
  }

  const branch = getCurrentBranch(opts.cwd);
  const base = opts.baseBranch ?? (await getBaseBranch(opts.cwd));
  const specDir = dirname(opts.specPath);
  const killGraceMs = opts.__testKillGraceMs ?? 5000;

  // Create actuator that runs the patch agent with the verdict
  const createActuator = (patchAgents: Agent[]) => {
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

      // Run the first available patch agent
      const agent = patchAgents[0];
      if (agent === undefined) {
        opts.fanout("harness", "review: actuator no agents available\n", "stderr");
        throw new ReviewTerminalError("actuator no agents available", 2);
      }

      const configuredModel = opts.config.modes.patch.agentOrder[0]?.model;
      const telemetryMeta = configuredModel ? { configured_model: configuredModel } : {};

      const actuatorController = new AbortController();
      const actuatorTimeoutHandle = setTimeout(() => {
        actuatorController.abort("actuator-timeout");
      }, opts.iterationTimeoutMs);

      const actuatorStartedMs = Date.now();
      let _actuatorPgid: number | null = null;

      try {
        opts.fanout("outbound", prompt, null, {
          actuator: true,
          agent: agent.name,
        });

        const result = await agent.run(prompt, {
          cwd: opts.cwd,
          signal: actuatorController.signal,
          abortKillGraceMs: killGraceMs,
          onSpawned: ({ pid }) => {
            _actuatorPgid = pid;
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
              const commitMessage = appendAgentTrailer("review: actuator", agent.name);
              execFileSync("git", ["commit", "-F", "-"], {
                cwd: opts.cwd,
                env: process.env,
                stdio: ["pipe", "pipe", "pipe"],
                input: commitMessage,
              });
              pushCurrent({ cwd: opts.cwd, firstPush: false });

              // Refresh PR footer
              void updatePrBody({
                indexPath: opts.specPath,
                branch,
                base,
                cwd: opts.cwd,
              }).catch(() => {
                // Ignore footer refresh errors
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              opts.fanout("harness", `review: actuator commit failed: ${message}\n`, "stderr");
              const usageAndCost = extractUsageAndCost(result, agent.name, configuredModel);
              opts.writeTelemetry({
                agent: agent.name,
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
              agent: agent.name,
              iteration: ctx.passNumber,
              durationMs,
              kind: "ok",
              exitReason: "ok",
              patch_phase: "review",
              ...extractUsageAndCost(result, agent.name, configuredModel),
              ...telemetryMeta,
            });
          } else {
            // No changes from actuator
            opts.fanout("harness", `review: actuator made no changes\n`, "stdout");
            opts.writeTelemetry({
              agent: agent.name,
              iteration: ctx.passNumber,
              durationMs,
              kind: "ok",
              exitReason: "ok",
              patch_phase: "review",
              ...extractUsageAndCost(result, agent.name, configuredModel),
              ...telemetryMeta,
            });
          }
        } else {
          opts.fanout("harness", `review: actuator error (${result.kind})\n`, "stderr");
          if (result.kind !== "quota" && result.stderr.length > 0) {
            opts.fanout("harness", result.stderr, "stderr");
          }
          const exitCode = result.kind === "model_config" ? 3 : result.kind === "error" ? result.exitCode : 1;
          opts.writeTelemetry({
            agent: agent.name,
            iteration: ctx.passNumber,
            durationMs,
            kind: result.kind === "quota" ? "quota" : result.kind === "model_config" ? "error" : "error",
            exitReason: result.kind,
            patch_phase: "review",
            ...telemetryMeta,
          });
          throw new ReviewTerminalError(`actuator failed: ${result.kind}`, exitCode);
        }
      } finally {
        clearTimeout(actuatorTimeoutHandle);
      }
    };
  };

  try {
    const runReviewOpts: RunReviewOptions = {
      config: opts.config,
      cwd: opts.cwd,
      adapter: createPatchReviewAdapter({ opts, specDir, branch, base }),
      ...(opts.reviewPassesOverride !== undefined ? { reviewPassesOverride: opts.reviewPassesOverride } : {}),
      loadAgent: ({ name, model }) => {
        const override = opts.agents?.[name as AgentName];
        const agent = override ?? createAgent(name as AgentName, model);
        return withReviewPassTimeout(agent, {
          timeoutMs: opts.iterationTimeoutMs,
          killGraceMs,
        });
      },
      onAllAgentsQuotaExhausted: (message) => {
        opts.fanout("harness", `${message}\n`, "stderr");
      },
      onQuotaRotation: (agent, spawnResult, classified) => {
        if (classified.kind !== "quota") {
          return;
        }
        const line =
          spawnResult.kind === "quota"
            ? HARNESS_QUOTA_FALLBACK_STRICT
            : harnessQuotaFallbackLenientLine(spawnResult.kind === "error" ? spawnResult.exitCode : 0);
        opts.fanout("harness", `${agent}: ${line}\n`, "stderr");
        if (spawnResult.kind === "error" && spawnResult.stderr.length > 0) {
          const stderr = spawnResult.stderr.endsWith("\n") ? spawnResult.stderr : `${spawnResult.stderr}\n`;
          opts.fanout("harness", stderr, "stderr");
        }
      },
    };

    if (opts.actuatorAgents) {
      runReviewOpts.actuator = createActuator(opts.actuatorAgents);
    }

    const reviewExitCode = await runReview(runReviewOpts);

    if (reviewExitCode !== 0) {
      return reviewExitCode;
    }
  } catch (err) {
    if (err instanceof ReviewTerminalError) {
      return err.exitCode;
    }
    throw err;
  }

  if (!opts.skipGates) {
    opts.fanout("harness", "review: running final ready\n", "stdout");
    try {
      if (opts.runFinalGate) {
        opts.runFinalGate(branch);
      } else {
        runReadyAndCommit({
          cwd: opts.cwd,
          agentLabel: "review-final",
        });
        execFileSync("gh", ["pr", "ready", branch], {
          cwd: opts.cwd,
          env: process.env,
          stdio: "pipe",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.fanout("harness", `review final ready failed: ${message}\n`, "stderr");
      return 1;
    }
  }

  return 0;
}
