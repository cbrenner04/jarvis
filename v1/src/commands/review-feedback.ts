import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createAgent } from "../agents/factory.ts";
import { applyQuotaFallbackWhenAllowed } from "../agents/quota.ts";
import type { Agent, AgentName, AgentResult } from "../agents/types.ts";
import { type Config, type ConfigOptions, loadConfig } from "../config.ts";
import { assertGhReady } from "../gh.ts";
import { checkPrExists } from "../pr.ts";
import {
  HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED,
  HARNESS_QUOTA_FALLBACK_STRICT,
  harnessQuotaFallbackLenientLine,
} from "../quota-harness-messages.ts";
import {
  type ActionableReviewFeedback,
  collectActionableReviewFeedback,
  readPatchRulesText,
  renderReviewPrompt,
} from "../review-feedback.ts";
import {
  ensurePatchWorktreeForExistingBranch,
  hasUpstream,
  pushCurrent,
} from "../worktree.ts";
import { acquireWorktreeLock, releaseWorktreeLock } from "../worktree-lock.ts";

export type ReviewIo = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type ReviewCommandOptions = {
  projectRoot: string;
  worktreeName: string;
  io: ReviewIo;
  config?: ConfigOptions;
  assertGhReadyFn?: () => Promise<void>;
  checkPrExistsFn?: (branch: string, cwd: string) => number | null;
  collectReviewFeedbackFn?: (args: {
    prNumber: number;
    cwd: string;
  }) => Promise<ActionableReviewFeedback>;
  readPatchRulesFn?: () => string;
  createAgentFn?: (agentName: AgentName, model: string) => Agent;
  loadConfigFn?: (opts?: ConfigOptions) => Config;
  ensurePatchWorktreeFn?: (
    projectRoot: string,
    name: string,
  ) => Promise<{ path: string; source: "origin" | "local" }>;
  commitAllFn?: (cwd: string, message: string) => void;
  pushCurrentFn?: (opts: { cwd: string; firstPush: boolean }) => void;
};

export async function reviewFeedbackCommand(
  opts: ReviewCommandOptions,
): Promise<number> {
  // Reject plan worktrees before any other checks
  if (opts.worktreeName.startsWith("plan-")) {
    opts.io.stderr(
      "jarvis1 review-feedback: plan worktrees are unsupported in v1; review-feedback only supports patch worktrees\n",
    );
    return 1;
  }

  // Load config immediately after plan-prefix guard
  const config = (opts.loadConfigFn ?? loadConfig)(opts.config);

  const worktreePath = join(opts.projectRoot, ".worktree", opts.worktreeName);

  // Auto-create worktree from branch if missing and git is enabled
  if (!existsSync(worktreePath)) {
    if (config.git === false) {
      // git disabled: use existing "unknown worktree" path
      opts.io.stderr(
        `jarvis1 review-feedback: unknown worktree ${JSON.stringify(opts.worktreeName)}\n`,
      );
      return 1;
    }

    // Attempt auto-create
    try {
      const result = await (
        opts.ensurePatchWorktreeFn ?? ensurePatchWorktreeForExistingBranch
      )(opts.projectRoot, opts.worktreeName);
      const sourceText =
        result.source === "origin"
          ? `from origin/${opts.worktreeName}`
          : `from local branch ${opts.worktreeName}`;
      opts.io.stdout(
        `jarvis1 review-feedback: worktree missing; creating .worktree/${opts.worktreeName} ${sourceText}\n`,
      );
    } catch (err) {
      opts.io.stderr(`jarvis1 review-feedback: ${(err as Error).message}\n`);
      return 1;
    }
  }

  const lockResult = acquireWorktreeLock(worktreePath);
  if (lockResult.kind === "busy") {
    const lockInfo = lockResult.existingLock;
    opts.io.stderr(
      `worktree is in use by process ${lockInfo.pid} (started at ${lockInfo.started_at})\n`,
    );
    return 9;
  }

  try {
    const branch = currentBranch(worktreePath);
    if (branch === "HEAD") {
      opts.io.stderr(
        "jarvis1 review-feedback: unsupported git state detached HEAD in target worktree\n",
      );
      return 1;
    }
    if (branch.startsWith("plan/")) {
      opts.io.stderr(
        "jarvis1 review-feedback: plan worktrees are unsupported in v1; review-feedback only supports patch worktrees\n",
      );
      return 1;
    }

    const status = gitStatusPorcelain(worktreePath);
    if (status.trim() !== "") {
      opts.io.stderr(
        "jarvis1 review-feedback: target worktree is not clean; inspect or clean it before running review-feedback\n",
      );
      return 1;
    }

    try {
      await (opts.assertGhReadyFn ?? assertGhReady)();
    } catch (err) {
      opts.io.stderr(`${(err as Error).message}\n`);
      return 1;
    }

    const prNumber = (opts.checkPrExistsFn ?? checkPrExists)(
      branch,
      worktreePath,
    );
    if (prNumber === null) {
      opts.io.stderr(
        `jarvis1 review-feedback: no open PR found for branch ${JSON.stringify(branch)}\n`,
      );
      return 1;
    }
    const feedback = await (
      opts.collectReviewFeedbackFn ?? collectActionableReviewFeedback
    )({
      prNumber,
      cwd: worktreePath,
    });
    if (
      feedback.inlineThreads.length === 0 &&
      feedback.topLevelComments.length === 0
    ) {
      opts.io.stdout("jarvis1 review-feedback: no open review comments\n");
      return 0;
    }
    const prompt = renderReviewPrompt({
      branch,
      prNumber,
      feedback,
      patchRulesText: (opts.readPatchRulesFn ?? readPatchRulesText)(),
    });
    opts.io.stdout(
      `jarvis1 review-feedback: collected ${feedback.inlineThreads.length} unresolved inline threads and ${feedback.topLevelComments.length} top-level comments for PR #${prNumber}\n`,
    );
    opts.io.stdout(
      `jarvis1 review-feedback: review prompt prepared (${prompt.length} chars)\n`,
    );

    const resolveAgent = opts.createAgentFn ?? createAgent;
    let success: {
      entry: (typeof config.modes.patch.agentOrder)[number];
      result: AgentResult;
    } | null = null;

    for (const entry of config.modes.patch.agentOrder) {
      const agent = resolveAgent(entry.agent, entry.model);
      const result = await agent.run(prompt, { cwd: worktreePath });
      if (result.kind === "ok") {
        success = { entry, result };
        break;
      }

      if (result.kind === "model_config") {
        opts.io.stderr(
          `${entry.agent}: configured patch model ${JSON.stringify(entry.model)} is not supported by this CLI/account\n`,
        );
        if (result.stderr.trim().length > 0) {
          opts.io.stderr(ensureTrailingNewline(result.stderr));
        }
        return 1;
      }

      if (result.kind === "quota") {
        opts.io.stderr(`${entry.agent}: ${HARNESS_QUOTA_FALLBACK_STRICT}\n`);
        if (result.stderr.trim().length > 0) {
          opts.io.stderr(ensureTrailingNewline(result.stderr));
        }
        continue;
      }

      const noProgress = gitStatusPorcelain(worktreePath).trim() === "";
      const classified = applyQuotaFallbackWhenAllowed(
        entry.agent,
        result,
        {
          quotaFallback: config.quotaFallback,
          weakQuotaExitCodes: config.weakQuotaExitCodes,
        },
        noProgress,
      );
      if (classified.kind === "quota") {
        opts.io.stderr(
          `${entry.agent}: ${harnessQuotaFallbackLenientLine(result.exitCode)}\n`,
        );
        if (result.stderr.trim().length > 0) {
          opts.io.stderr(ensureTrailingNewline(result.stderr));
        }
        continue;
      }

      if (result.stderr.trim().length > 0) {
        opts.io.stderr(ensureTrailingNewline(result.stderr));
      }
      return 1;
    }

    if (success === null) {
      opts.io.stderr(`${HARNESS_ALL_AGENTS_QUOTA_EXHAUSTED}\n`);
      return 1;
    }

    if (gitStatusPorcelain(worktreePath).trim() === "") {
      opts.io.stderr(
        "jarvis1 review-feedback: agent run completed with no file changes; no commit created\n",
      );
      return 1;
    }

    const commitAll = opts.commitAllFn ?? commitAllChanges;
    try {
      commitAll(worktreePath, "address PR review comments");
    } catch (err) {
      opts.io.stderr(
        `jarvis1 review-feedback: failed to commit review feedback changes: ${errorMessage(err)}\n`,
      );
      return 1;
    }

    try {
      (opts.pushCurrentFn ?? pushCurrent)({
        cwd: worktreePath,
        firstPush: !hasUpstream(worktreePath),
      });
    } catch (err) {
      opts.io.stderr(
        `jarvis1 review-feedback: push failed after commit creation: ${errorMessage(err)}\n`,
      );
      return 1;
    }

    opts.io.stdout(
      `jarvis1 review-feedback: committed and pushed review feedback updates via ${success.entry.agent}\n`,
    );
    return 0;
  } finally {
    releaseWorktreeLock(worktreePath);
  }
}

function currentBranch(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

function gitStatusPorcelain(cwd: string): string {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function commitAllChanges(cwd: string, message: string): void {
  execFileSync("git", ["add", "-A"], {
    cwd,
    stdio: "pipe",
  });
  execFileSync("git", ["commit", "-m", message], {
    cwd,
    stdio: "pipe",
  });
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}

function errorMessage(err: unknown): string {
  if (
    typeof err === "object" &&
    err !== null &&
    "stderr" in err &&
    Buffer.isBuffer((err as { stderr: unknown }).stderr)
  ) {
    const stderr = (err as { stderr: Buffer }).stderr.toString("utf8").trim();
    if (stderr.length > 0) return stderr;
  }
  return err instanceof Error ? err.message : String(err);
}
