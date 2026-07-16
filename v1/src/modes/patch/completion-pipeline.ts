import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseSpec } from "../../../../shared/spec-parser.ts";
import type { Agent } from "../../agents/types.ts";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import { resolveReviewPasses } from "../../config.ts";
import { getBaseBranch } from "../../gh.ts";
import { checkPrExists, readBranchCommits } from "../../pr.ts";
import { type DiffStat, generateTemplateNarrative } from "../../pr-shared.ts";
import {
  FixCommandError,
  PostVerificationCommitError,
  PostVerificationPushError,
  PreReadyFixCommitError,
  PreReadyFixPushError,
  ReadyCommandError,
  ReadyCommandTimeoutError,
  ReadyVerificationDirtyError,
  runReadyAndCommit,
} from "../../ready-gate.ts";
import { pushCurrent, worktreeCompletionBlocker } from "../../worktree.ts";
import { countUnchecked } from "./completion.ts";
import { GIT_SUBPROCESS_OPTS } from "./git-subprocess.ts";
import { buildPrBody, generatePrDescription, maybeMarkReady, updatePrBody } from "./pr.ts";
import { runPatchReviewPhase } from "./review.ts";
import type { CompletionReadyGateResult, IterationContext } from "./run.ts";
import { runPatchShrinkPhase, ShrinkTerminalError } from "./shrink.ts";
import type { AcceptanceCriterion } from "./subspec.ts";

function diffAcceptanceCriteria(before: AcceptanceCriterion[], after: AcceptanceCriterion[]): AcceptanceCriterion[] {
  const beforeByText = new Map(before.map((c) => [c.text, c.checked]));
  const newlyChecked: AcceptanceCriterion[] = [];
  for (const c of after) {
    if (c.checked && beforeByText.get(c.text) === false) {
      newlyChecked.push(c);
    }
  }
  return newlyChecked;
}

function getIndexTitle(indexPath: string): string {
  const content = readFileSync(indexPath, "utf8");
  const match = content.match(/^#\s+(.+)$/m);
  if (!match?.[1]) {
    if (basename(indexPath) === "index.md") {
      return basename(dirname(indexPath));
    }
    return basename(indexPath);
  }
  return match[1].trim();
}

function getCurrentBranch(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    ...GIT_SUBPROCESS_OPTS,
  }).trim();
}

function lookupPrUrl(branch: string, cwd: string): string | null {
  // First check if a PR exists; if not, return null silently
  const prNumber = checkPrExists(branch, cwd);
  if (!prNumber) {
    return null;
  }

  // PR exists, so look up the URL
  const output = execFileSync("gh", ["pr", "view", branch, "--json", "url", "-q", ".url"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  const url = output.trim();
  return url || null;
}

function readDiffStats(cwd: string, base: string): DiffStat[] {
  try {
    const output = execFileSync("git", ["diff", "--numstat", `${base}...HEAD`], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      ...GIT_SUBPROCESS_OPTS,
    });
    const diffs: DiffStat[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line) continue;
      const [addedStr, removedStr, path] = line.split("\t");
      if (path === undefined || addedStr === undefined || removedStr === undefined) continue;
      // Handle binary files: "-" means not applicable
      const added = addedStr === "-" ? 0 : parseInt(addedStr, 10);
      const removed = removedStr === "-" ? 0 : parseInt(removedStr, 10);
      if (Number.isNaN(added) || Number.isNaN(removed)) continue;
      diffs.push({ added, removed, path });
    }
    return diffs;
  } catch {
    return [];
  }
}

async function generatePrBody(
  specPath: string,
  agent: Agent,
  cwd: string,
  prNarrative: "template" | "agent",
  base: string,
  runOptions?: Parameters<typeof generatePrDescription>[0]["runOptions"],
): Promise<string> {
  let narrative: string;

  if (prNarrative === "template") {
    narrative = generateTemplateNarrative({
      getSubspecTitles: () => {
        const indexContent = readFileSync(specPath, "utf8");
        const parsed = parseSpec(indexContent);
        return parsed.linkedSubspecs.map((s) => s.text);
      },
      getCommitSubjects: () => {
        const commits = readBranchCommits({ cwd, base });
        return commits.map((c) => c.subject);
      },
      getDiffStats: () => readDiffStats(cwd, base),
      getSubspecBodies: () => {
        const indexContent = readFileSync(specPath, "utf8");
        const parsed = parseSpec(indexContent);
        const indexDir = dirname(specPath);
        return parsed.linkedSubspecs.map((s) => {
          const subspecPath = join(indexDir, s.path);
          try {
            return readFileSync(subspecPath, "utf8");
          } catch {
            return "";
          }
        });
      },
    });
  } else {
    const generated = await generatePrDescription({
      specPath,
      agent,
      cwd,
      ...(runOptions === undefined ? {} : { runOptions }),
    });
    narrative = generated ?? "(no narrative generated)";
  }

  return buildPrBody({
    indexPath: specPath,
    narrative,
  });
}

/**
 * Commit and push a complete-but-dirty worktree.
 * Returns true if successfully committed and pushed with a clean worktree.
 * Returns false if the worktree is still dirty after the commit (unexpected state).
 */
function commitAndPushCompleteDirtyWorktree(cwd: string): boolean {
  execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe", ...GIT_SUBPROCESS_OPTS });
  const commitMessage = appendAgentTrailer("chore: complete-but-dirty commit", "completion-ready");
  execFileSync("git", ["commit", "-F", "-"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: commitMessage,
    ...GIT_SUBPROCESS_OPTS,
  });

  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    ...GIT_SUBPROCESS_OPTS,
  }).trim();

  if (porcelain !== "") {
    return false;
  }

  pushCurrent({ cwd, firstPush: false });
  return true;
}

async function runCompletionReadyGate(
  ctx: IterationContext,
  readyCommand?: string,
  fixCommand?: string,
): Promise<CompletionReadyGateResult> {
  const { preflight, logging, opts } = ctx;
  logging.fanout("harness", "completion: running ready gate\n", "stdout");

  const baseBranch = await getBaseBranch(preflight.agentWorkingDir);
  if (opts.runCompletionReadyGate !== undefined) {
    return opts.runCompletionReadyGate(preflight.agentWorkingDir);
  }
  try {
    runReadyAndCommit({
      cwd: preflight.agentWorkingDir,
      agentLabel: "completion-ready",
      tier: "full",
      timeoutMs: preflight.cfg.iterationTimeoutMs,
      baseBranch,
      ...(readyCommand !== undefined ? { readyCommand } : {}),
      ...(fixCommand !== undefined ? { fixCommand } : {}),
    });
    return { kind: "green" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ReadyCommandTimeoutError) {
      return { kind: "red", failureText: message, verificationRed: false };
    }
    if (err instanceof ReadyCommandError) {
      logging.fanout("harness", `completion: ready gate failed: ${message}\n`, "stderr");
      return { kind: "red", failureText: message, verificationRed: true };
    }
    if (
      err instanceof FixCommandError ||
      err instanceof PreReadyFixCommitError ||
      err instanceof PreReadyFixPushError ||
      err instanceof PostVerificationCommitError ||
      err instanceof PostVerificationPushError ||
      err instanceof ReadyVerificationDirtyError
    ) {
      return { kind: "red", failureText: message, verificationRed: false };
    }
    return { kind: "red", failureText: message, verificationRed: false };
  }
}

async function tryFinishSpecIfDone(ctx: IterationContext): Promise<number | null> {
  const { preflight, logging } = ctx;
  if (countUnchecked(preflight.specPath) !== 0) {
    return null;
  }
  if (preflight.gitEnabled) {
    const blocker = worktreeCompletionBlocker(preflight.agentWorkingDir);
    if (blocker !== undefined) {
      // Try to commit and push the complete-but-dirty worktree
      try {
        const committed = commitAndPushCompleteDirtyWorktree(preflight.agentWorkingDir);
        if (!committed) {
          // Worktree still dirty after commit (unexpected)
          const worktreeName = basename(preflight.agentWorkingDir);
          logging.fanout(
            "harness",
            `spec checklists are complete, but ${blocker}\n\nCommit and push from the worktree so the PR updates. Worktree: ${preflight.agentWorkingDir}\n\nRun \`jarvis1 triage ${worktreeName}\` to inspect state and see suggested next moves.\n`,
            "stderr",
          );
          return 6;
        }
        // Successfully committed and pushed; fall through to normal completion
      } catch (err) {
        // Commit/push failed
        const worktreeName = basename(preflight.agentWorkingDir);
        const message = err instanceof Error ? err.message : String(err);
        logging.fanout(
          "harness",
          `spec checklists are complete, but failed to commit and push: ${message}\n\nWorktree: ${preflight.agentWorkingDir}\n\nRun \`jarvis1 triage ${worktreeName}\` to inspect state and see suggested next moves.\n`,
          "stderr",
        );
        return 6;
      }
    }
  }
  logging.fanout("harness", "spec complete\n", "stdout");

  const readyCommand = preflight.cfg.projects[preflight.project.key]?.readyCommand;
  const fixCommand = preflight.cfg.projects[preflight.project.key]?.fixCommand;
  const reviewPasses = resolveReviewPasses(preflight.cfg, ctx.opts.reviewPasses);
  const implementationIterations = logging.patchIterationsCompletedForSummary();
  const hasImplementationIterations = implementationIterations > 0 || ctx.state.hadNonHumanImplementationIteration;
  const shouldRunShrink =
    preflight.gitEnabled && hasImplementationIterations && preflight.cfg.modes.patch.shrink !== "off";
  // Review runs when: (1) normal completion with at least one iteration, OR (2) review resume is active
  const shouldRunReview =
    preflight.gitEnabled && reviewPasses > 0 && (hasImplementationIterations || ctx.opts.resumeReview === true);
  const shouldRunCompletionReadyGate = preflight.gitEnabled && ctx.state.hadNonHumanImplementationIteration;

  // Run completion ready gate before shrink and review
  if (shouldRunCompletionReadyGate) {
    const gateResult = await runCompletionReadyGate(ctx, readyCommand, fixCommand);
    if (gateResult.kind === "red") {
      if (gateResult.verificationRed !== true) {
        const worktreeName = basename(preflight.agentWorkingDir);
        logging.fanout(
          "harness",
          `${gateResult.failureText}\n\nThe completion ready gate failed after readiness passed, so Jarvis did not retry or enter fix-up. Sync the branch state, then rerun.\n\nWorktree: ${preflight.agentWorkingDir}\n\nRun \`jarvis1 triage ${worktreeName}\` to inspect state and see suggested next moves.\n`,
          "stderr",
        );
        return 6;
      }
      logging.fanout("harness", `${gateResult.failureText}\n`, "stderr");
      return 10;
    }
    // This single completion gate doubles as the completion-transition ready
    // gate: on green, record the result keyed to HEAD sha + clean worktree so
    // the downstream shrink, review, and maybeMarkReady phases reuse it instead
    // of re-running `bun run ready`.
    if (preflight.gitEnabled && existsSync(join(preflight.agentWorkingDir, ".git"))) {
      try {
        const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: preflight.agentWorkingDir,
          encoding: "utf8",
          stdio: "pipe",
          ...GIT_SUBPROCESS_OPTS,
        }).trim();
        ctx.state.completionTransitionReadyResult = { headSha };
      } catch {
        // No HEAD sha available (e.g. not a git worktree in tests): skip
        // recording; downstream gates fall back to running ready themselves.
      }
    }
  }

  // Rewrite PR body once in the completion pipeline, before shrink/review
  if (preflight.gitEnabled && ctx.state.draftPrEnsured && hasImplementationIterations) {
    try {
      const branch = getCurrentBranch(preflight.agentWorkingDir);
      const base = await getBaseBranch(preflight.agentWorkingDir);
      const prNarrative = preflight.cfg.modes.patch.prNarrative ?? "template";
      const agent = ctx.activeAgents[0];
      await updatePrBody({
        indexPath: preflight.specPath,
        branch,
        base,
        cwd: preflight.agentWorkingDir,
        prNarrative,
        ...(agent !== undefined ? { agent } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logging.fanout("harness", `warning: completion phase PR body rewrite failed: ${message}\n`, "stderr");
    }
  }

  if (shouldRunShrink) {
    const { fanout, writeTelemetry } = ctx.logging;
    try {
      await runPatchShrinkPhase({
        config: preflight.subRoleResolutionCfg,
        cwd: preflight.agentWorkingDir,
        specPath: preflight.specPath,
        allowlist: logging.implementationTouchedFiles,
        fanout,
        writeTelemetry,
        ...(ctx.opts.agents !== undefined ? { agents: ctx.opts.agents } : {}),
        iterationTimeoutMs: preflight.cfg.iterationTimeoutMs,
        ...(ctx.opts.__testKillGraceMs !== undefined ? { __testKillGraceMs: ctx.opts.__testKillGraceMs } : {}),
        patchWorktreeDir: preflight.agentWorkingDir,
        idleOutputTimeoutMs: preflight.cfg.idleOutputTimeoutMs,
        ...(readyCommand !== undefined ? { readyCommand } : {}),
        ...(fixCommand !== undefined ? { fixCommand } : {}),
        ...(ctx.state.completionTransitionReadyResult !== undefined
          ? { recordedGreenResult: ctx.state.completionTransitionReadyResult }
          : {}),
        refreshRecordedGreenResult: (headSha: string) => {
          ctx.state.completionTransitionReadyResult = { headSha };
        },
      });
    } catch (err) {
      if (err instanceof ShrinkTerminalError) {
        return err.exitCode;
      }
      const message = err instanceof Error ? err.message : String(err);
      fanout("harness", `shrink phase error: ${message}\n`, "stderr");
    }
  }

  if (shouldRunReview) {
    const { fanout, writeTelemetry } = ctx.logging;
    let reviewExitCode: number;
    try {
      reviewExitCode = await runPatchReviewPhase({
        config: preflight.subRoleResolutionCfg,
        cwd: preflight.agentWorkingDir,
        specPath: preflight.specPath,
        ...(ctx.opts.reviewPasses !== undefined ? { reviewPassesOverride: ctx.opts.reviewPasses } : {}),
        fanout,
        writeTelemetry,
        ...(ctx.opts.agents !== undefined ? { agents: ctx.opts.agents } : {}),
        iterationTimeoutMs: preflight.cfg.iterationTimeoutMs,
        ...(ctx.opts.__testKillGraceMs !== undefined ? { __testKillGraceMs: ctx.opts.__testKillGraceMs } : {}),
        ...(ctx.opts.resumeReview === true ? { resumeReview: true } : {}),
        patchWorktreeDir: preflight.agentWorkingDir,
        idleOutputTimeoutMs: preflight.cfg.idleOutputTimeoutMs,
        ...(readyCommand !== undefined ? { readyCommand } : {}),
        ...(fixCommand !== undefined ? { fixCommand } : {}),
        ...(ctx.state.completionTransitionReadyResult !== undefined
          ? { recordedGreenResult: ctx.state.completionTransitionReadyResult }
          : {}),
        refreshRecordedGreenResult: (headSha: string) => {
          ctx.state.completionTransitionReadyResult = { headSha };
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fanout("harness", `review phase error: ${message}\n`, "stderr");
      reviewExitCode = 11;
    }
    if (reviewExitCode !== 0) {
      if (reviewExitCode === 11) {
        // Auto-ready on review-incomplete if the tree is unchanged since completion gate green
        try {
          await maybeMarkReady({
            indexPath: preflight.specPath,
            cwd: preflight.agentWorkingDir,
            agentLabel: "review-incomplete",
            timeoutMs: preflight.cfg.iterationTimeoutMs,
            ...(readyCommand !== undefined ? { readyCommand } : {}),
            ...(fixCommand !== undefined ? { fixCommand } : {}),
            ...(ctx.state.completionTransitionReadyResult !== undefined
              ? { recordedGreenResult: ctx.state.completionTransitionReadyResult }
              : {}),
            refreshRecordedGreenResult: (headSha: string) => {
              ctx.state.completionTransitionReadyResult = { headSha };
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logging.fanout("harness", `warning: failed to mark PR ready: ${message}\n`, "stderr");
        }
        const worktreeName = basename(preflight.agentWorkingDir);
        logging.fanout(
          "harness",
          `review did not complete. Recover with \`jarvis1 run --resume-review\` or manual finalize.\n\nWorktree: ${preflight.agentWorkingDir}\n\nRun \`jarvis1 triage ${worktreeName}\` to inspect state and see suggested next moves.\n`,
          "stderr",
        );
      }
      return reviewExitCode;
    }
  } else if (preflight.gitEnabled) {
    try {
      await maybeMarkReady({
        indexPath: preflight.specPath,
        cwd: preflight.agentWorkingDir,
        agentLabel: "patch-complete",
        timeoutMs: preflight.cfg.iterationTimeoutMs,
        autoIntegrateBase: true,
        ...(readyCommand !== undefined ? { readyCommand } : {}),
        ...(fixCommand !== undefined ? { fixCommand } : {}),
        ...(ctx.state.completionTransitionReadyResult !== undefined
          ? { recordedGreenResult: ctx.state.completionTransitionReadyResult }
          : {}),
        refreshRecordedGreenResult: (headSha: string) => {
          ctx.state.completionTransitionReadyResult = { headSha };
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logging.fanout("harness", `warning: failed to mark PR ready: ${message}\n`, "stderr");
    }
  }

  // Try to look up and print the PR URL
  if (preflight.gitEnabled) {
    try {
      const branch = getCurrentBranch(preflight.agentWorkingDir);
      const url = lookupPrUrl(branch, preflight.agentWorkingDir);
      if (url) {
        logging.fanout("harness", `${url}\n`, "stdout");
      }
    } catch (error) {
      logging.fanout(
        "harness",
        `warning: failed to look up PR URL: ${error instanceof Error ? error.message : String(error)}\n`,
        "stdout",
      );
    }
  }

  return 0;
}

export {
  diffAcceptanceCriteria,
  generatePrBody,
  getCurrentBranch,
  getIndexTitle,
  lookupPrUrl,
  runCompletionReadyGate,
  tryFinishSpecIfDone,
};
