import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createAgent } from "../../agents/factory.ts";
import type { Agent, AgentName, AgentRunOptions } from "../../agents/types.ts";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import type { Config } from "../../config.ts";
import { getBaseBranch, postPrComment } from "../../gh.ts";
import { checkPrExists } from "../../pr.ts";
import type { CostSource, PatchTelemetryPhase, TelemetryKind, UsageSource } from "../../telemetry.ts";
import { extractUsageAndCost } from "../../telemetry-enrichment.ts";
import { pushCurrent } from "../../worktree.ts";
import { runReview } from "../review/run.ts";
import type { ReviewAdapter, ReviewAttemptContext, ReviewTelemetryEvent } from "../review/types.ts";
import { runReadyAndCommit, updatePrBody } from "./pr.ts";
import { buildReviewPrompt } from "./prompt.ts";

/** Sentinel file a review agent writes (at the repo root) to signal a blocker. */
export const REVIEW_BLOCKER_FILE = ".jarvis-review-blocker";

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
    return (
      output
        .split("\n")
        .filter((line) => line.length > 3)
        // Porcelain lines are `XY <path>`; drop the two status columns + space.
        .map((line) => line.slice(3).trim())
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
    }
    execFileSync("git", ["clean", "-fd", "--", relative(cwd, specDir)], {
      cwd,
      stdio: "pipe",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to revert spec-tree edits: ${message}`);
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
  reviewPasses: number;
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
};

class PatchReviewTerminalError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

function getCurrentBranch(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

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

function createPatchReviewAdapter(args: {
  opts: PatchReviewPhaseOptions;
  specDir: string;
  branch: string;
  base: string;
}): ReviewAdapter {
  const { opts, specDir, branch, base } = args;

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
      default:
        kind = "error";
        exitReason = "error";
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
    buildPrompt: async ({ passNumber, totalPasses, agentEntry }) => {
      opts.fanout("harness", `review: pass ${passNumber}/${totalPasses}\n`, "stdout");
      const prompt = buildReviewPrompt({
        specPath: opts.specPath,
        cwd: opts.cwd,
        passNumber,
        totalPasses,
        baseBranch: base,
      });
      opts.fanout("outbound", prompt, null, {
        pass: passNumber,
        agent: agentEntry.agent,
      });
      return prompt;
    },
    enforceWriteBoundary: async (ctx) => {
      const editedSpecFiles = detectSpecTreeEdits(specDir, opts.cwd);
      if (editedSpecFiles.length === 0) {
        return;
      }
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
        throw new PatchReviewTerminalError(message, 1);
      }
    },
    readBlocker: async () => consumeReviewBlocker(opts.cwd),
    handleBlocker: async (ctx) => {
      opts.fanout("harness", `review: pass ${ctx.passNumber} encountered blocker\n`, "stderr");
      let blockerCommitFailed = false;
      try {
        commitReviewPass(ctx.passNumber, ctx.agent.name, opts.cwd, {
          specPath: opts.specPath,
          branch,
          base,
        });
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
        throw new PatchReviewTerminalError("review-blocker-commit-failed", 1);
      }

      return 7;
    },
    commitPass: async (ctx) => {
      try {
        commitReviewPass(ctx.passNumber, ctx.agent.name, opts.cwd, {
          specPath: opts.specPath,
          branch,
          base,
        });
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
        throw new PatchReviewTerminalError(message, 1);
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
      if (opts.runBaselineGate) {
        opts.runBaselineGate();
      } else {
        runReadyAndCommit({
          cwd: opts.cwd,
          agentLabel: "review-baseline",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.fanout("harness", `review baseline gate failed: ${message}\n`, "stderr");
      return 1;
    }
  }

  const branch = getCurrentBranch(opts.cwd);
  const base = opts.baseBranch ?? (await getBaseBranch(opts.cwd));
  const specDir = dirname(opts.specPath);
  const killGraceMs = opts.__testKillGraceMs ?? 5000;

  try {
    const reviewExitCode = await runReview({
      config: opts.config,
      cwd: opts.cwd,
      adapter: createPatchReviewAdapter({ opts, specDir, branch, base }),
      reviewPassesOverride: opts.reviewPasses,
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
    });

    if (reviewExitCode !== 0) {
      return reviewExitCode;
    }
  } catch (err) {
    if (err instanceof PatchReviewTerminalError) {
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
