import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ConfigOptions } from "../config.ts";
import { assertGhReady } from "../gh.ts";
import { checkPrExists } from "../pr.ts";
import {
  collectActionableReviewFeedback,
  readPatchRulesText,
  renderReviewPrompt,
  type ActionableReviewFeedback,
} from "../review-feedback.ts";
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
};

export async function reviewCommand(opts: ReviewCommandOptions): Promise<number> {
  const worktreePath = join(opts.projectRoot, ".worktree", opts.worktreeName);
  if (!existsSync(worktreePath)) {
    opts.io.stderr(
      `jarvis review: unknown worktree ${JSON.stringify(opts.worktreeName)}\n`,
    );
    return 1;
  }
  if (opts.worktreeName.startsWith("plan-")) {
    opts.io.stderr(
      "jarvis review: plan worktrees are unsupported in v1; review mode only supports patch worktrees\n",
    );
    return 1;
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
        "jarvis review: unsupported git state detached HEAD in target worktree\n",
      );
      return 1;
    }
    if (branch.startsWith("plan/")) {
      opts.io.stderr(
        "jarvis review: plan worktrees are unsupported in v1; review mode only supports patch worktrees\n",
      );
      return 1;
    }

    const status = gitStatusPorcelain(worktreePath);
    if (status.trim() !== "") {
      opts.io.stderr(
        "jarvis review: target worktree is not clean; inspect or clean it before running review\n",
      );
      return 1;
    }

    try {
      await (opts.assertGhReadyFn ?? assertGhReady)();
    } catch (err) {
      opts.io.stderr(`${(err as Error).message}\n`);
      return 1;
    }

    const prNumber = (opts.checkPrExistsFn ?? checkPrExists)(branch, worktreePath);
    if (prNumber === null) {
      opts.io.stderr(
        `jarvis review: no open PR found for branch ${JSON.stringify(branch)}\n`,
      );
      return 1;
    }
    const feedback = await (opts.collectReviewFeedbackFn ??
      collectActionableReviewFeedback)({
      prNumber,
      cwd: worktreePath,
    });
    if (
      feedback.inlineThreads.length === 0 &&
      feedback.topLevelComments.length === 0
    ) {
      opts.io.stdout("jarvis review: no open review comments\n");
      return 0;
    }
    const prompt = renderReviewPrompt({
      branch,
      prNumber,
      feedback,
      patchRulesText: (opts.readPatchRulesFn ?? readPatchRulesText)(),
    });
    opts.io.stdout(
      `jarvis review: collected ${feedback.inlineThreads.length} unresolved inline threads and ${feedback.topLevelComments.length} top-level comments for PR #${prNumber}\n`,
    );
    opts.io.stdout(`jarvis review: review prompt prepared (${prompt.length} chars)\n`);
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
