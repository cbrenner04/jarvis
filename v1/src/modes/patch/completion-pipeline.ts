import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parseSpec } from "../../../../shared/spec-parser.ts";
import type { Agent } from "../../agents/types.ts";
import { getBaseBranch } from "../../gh.ts";
import { checkPrExists, ensureDraftPr, readBranchCommits, renderAttributionSummary } from "../../pr.ts";
import { generateTemplateNarrative } from "../../pr-shared.ts";
import { runReadyAndCommit } from "../../ready-gate.ts";
import { resolveReviewPasses } from "../../config.ts";
import { hasUpstream, pushCurrent, worktreeCompletionBlocker } from "../../worktree.ts";
import { countUnchecked, findBlockerInLinkedSubspecs } from "./completion.ts";
import { buildPrBody, generatePrDescription, maybeMarkReady, updatePrBody } from "./pr.ts";
import type { AcceptanceCriterion } from "./subspec.ts";
import { runPatchReviewPhase } from "./review.ts";
import { accumulateImplementationTouchedFiles, runPatchShrinkPhase } from "./shrink.ts";

export type CompletionReadyGateResult = { kind: "green" } | { kind: "red"; failureText: string };

type CompletionLoopbackSignal = {
  failureText: string;
};

type IterationContextForCompletion = {
  preflight: {
    specPath: string;
    gitEnabled: boolean;
    agentWorkingDir: string;
    cfg: any;
  };
  logging: {
    fanout: any;
    writeTelemetry: (record: any) => void;
    patchIterationsCompletedForSummary: () => number;
    implementationTouchedFiles: Set<string>;
  };
  opts: {
    runCompletionReadyGate?: (cwd: string) => CompletionReadyGateResult;
    skipGhCheck?: boolean;
    reviewPasses?: number;
    resumeReview?: boolean;
    agents?: any;
    __testKillGraceMs?: number;
  };
  activeAgents: Agent[];
  state: {
    iteration: number;
    completionLoopbackSignal: CompletionLoopbackSignal | null;
    previousCompletionFailureText: string | null;
    draftPrEnsured: boolean;
    completionTransitionReadyResult?: {
      headSha: string;
    };
  };
};

function normalizeReadyFailureText(text: string): string {
  let normalized = text;

  // Strip absolute worktree paths: replace with [WORKTREE_PATH]
  normalized = normalized.replace(/\/[\w\-./]+\/\.worktree\/[\w\-./]+/g, "[WORKTREE_PATH]");

  // Strip durations like "1234ms", "5.67s", etc.
  normalized = normalized.replace(/\b\d+(?:\.\d+)?(?:ms|s|m|h)\b/g, "[DURATION]");

  // Strip wall-clock timings like "12:34:56"
  normalized = normalized.replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, "[TIME]");

  // Strip dates like "2026-06-17", "June 17", etc.
  normalized = normalized.replace(
    /\b(?:\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2})\b/gi,
    "[DATE]",
  );

  // Strip deadline/timeout messaging like "deadline in 12m34s"
  normalized = normalized.replace(/deadline\s+in\s+\d+[mshd](?:\d+[mshd])?/gi, "[DEADLINE]");

  // Strip numeric IDs and hashes
  normalized = normalized.replace(/\b[0-9a-f]{7,}\b/g, "[HASH]");

  return normalized;
}

function isReadyFailureUnchanged(previousText: string | null, currentText: string): boolean {
  if (previousText === null) {
    return false;
  }
  const normalizedPrevious = normalizeReadyFailureText(previousText);
  const normalizedCurrent = normalizeReadyFailureText(currentText);
  return normalizedPrevious === normalizedCurrent;
}

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

async function runCompletionReadyGate(ctx: IterationContextForCompletion): Promise<CompletionReadyGateResult> {
  const { preflight, logging, opts } = ctx;
  logging.fanout("harness", "completion: running ready gate\n", "stdout");

  if (opts.runCompletionReadyGate !== undefined) {
    const result = opts.runCompletionReadyGate(preflight.agentWorkingDir);
    if (result.kind === "red") {
      logging.fanout("harness", `completion: ready gate failed: ${result.failureText}\n`, "stderr");
    }
    return result;
  }

  try {
    runReadyAndCommit({
      cwd: preflight.agentWorkingDir,
      agentLabel: "completion-ready",
      tier: "full",
    });
    return { kind: "green" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logging.fanout("harness", `completion: ready gate failed: ${message}\n`, "stderr");
    return { kind: "red", failureText: message };
  }
}

async function tryFinishSpecIfDone(ctx: IterationContextForCompletion): Promise<number | null> {
  const { preflight, logging } = ctx;
  if (countUnchecked(preflight.specPath) !== 0) {
    return null;
  }
  if (preflight.gitEnabled) {
    const blocker = worktreeCompletionBlocker(preflight.agentWorkingDir);
    if (blocker !== undefined) {
      const worktreeName = basename(preflight.agentWorkingDir);
      logging.fanout(
        "harness",
        `spec checklists are complete, but ${blocker}\n\nCommit and push from the worktree so the PR updates. Worktree: ${preflight.agentWorkingDir}\n\nRun \`jarvis1 triage ${worktreeName}\` to inspect state and see suggested next moves.\n`,
        "stderr",
      );
      return 6;
    }
  }
  logging.fanout("harness", "spec complete\n", "stdout");

  const reviewPasses = resolveReviewPasses(preflight.cfg, ctx.opts.reviewPasses);
  const implementationIterations = logging.patchIterationsCompletedForSummary();
  const shouldRunShrink =
    preflight.gitEnabled && implementationIterations > 0 && preflight.cfg.modes.patch.shrink !== "off";
  // Review runs when: (1) normal completion with at least one iteration, OR (2) review resume is active
  const shouldRunReview =
    preflight.gitEnabled && reviewPasses > 0 && (implementationIterations > 0 || ctx.opts.resumeReview === true);
  const shouldRunCompletionReadyGate = preflight.gitEnabled && implementationIterations > 0;

  // Run completion ready gate before shrink and review
  if (shouldRunCompletionReadyGate) {
    const gateResult = await runCompletionReadyGate(ctx);
    if (gateResult.kind === "red") {
      // Red completion ready gate.
      // Check if this is a stuck-red stop: failure unchanged and no new checkbox/blocker
      const hasNewBlocker = findBlockerInLinkedSubspecs(preflight.specPath) !== undefined;
      const isStuckRed =
        ctx.state.previousCompletionFailureText !== null &&
        isReadyFailureUnchanged(ctx.state.previousCompletionFailureText, gateResult.failureText) &&
        countUnchecked(preflight.specPath) === 0 &&
        !hasNewBlocker;

      if (isStuckRed) {
        // Stuck-red stop: the failure is unchanged, no new checkbox, no new blocker
        const worktreeName = basename(preflight.agentWorkingDir);
        logging.fanout(
          "harness",
          `bun run ready failed:\n${gateResult.failureText}\n\nThe failure is unchanged after fix-up iteration and no new work was ticked. The issue persists.\n\nWorktree: ${preflight.agentWorkingDir}\n\nRun \`jarvis1 triage ${worktreeName}\` to inspect state and see suggested next moves.\n`,
          "stderr",
        );
        logging.writeTelemetry({
          agent: "harness",
          iteration: ctx.state.iteration,
          durationMs: 0,
          kind: "ok",
          exitReason: "ready-stuck-red",
          record_role: "run_terminal",
        });
        // Clear the loop-back signal so the caller returns exit 10 instead of
        // treating the still-set signal as another fix-up loop.
        ctx.state.completionLoopbackSignal = null;
        return 10;
      }

      // Red but failure changed: loop back for another fix-up iteration
      ctx.state.previousCompletionFailureText = gateResult.failureText;
      ctx.state.completionLoopbackSignal = { failureText: gateResult.failureText };
      return null;
    }
    // Green: the gate passed. Clear any loop-back signal and previous failure text
    // so the caller finalizes completion instead of looping again.
    ctx.state.completionLoopbackSignal = null;
    ctx.state.previousCompletionFailureText = null;
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
        }).trim();
        ctx.state.completionTransitionReadyResult = { headSha };
      } catch {
        // No HEAD sha available (e.g. not a git worktree in tests): skip
        // recording; downstream gates fall back to running ready themselves.
      }
    }
  }

  // Rewrite PR body once in the completion pipeline, before shrink/review
  if (preflight.gitEnabled && ctx.state.draftPrEnsured && implementationIterations > 0) {
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
        config: preflight.cfg,
        cwd: preflight.agentWorkingDir,
        specPath: preflight.specPath,
        allowlist: logging.implementationTouchedFiles,
        fanout,
        writeTelemetry,
        ...(ctx.opts.agents !== undefined ? { agents: ctx.opts.agents } : {}),
        iterationTimeoutMs: preflight.cfg.iterationTimeoutMs,
        ...(ctx.opts.__testKillGraceMs !== undefined ? { __testKillGraceMs: ctx.opts.__testKillGraceMs } : {}),
        ...(ctx.state.completionTransitionReadyResult !== undefined
          ? { recordedGreenResult: ctx.state.completionTransitionReadyResult }
          : {}),
        refreshRecordedGreenResult: (headSha: string) => {
          ctx.state.completionTransitionReadyResult = { headSha };
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fanout("harness", `shrink phase error: ${message}\n`, "stderr");
    }
  }

  if (shouldRunReview) {
    const { fanout, writeTelemetry } = ctx.logging;
    let reviewExitCode: number;
    try {
      reviewExitCode = await runPatchReviewPhase({
        config: preflight.cfg,
        cwd: preflight.agentWorkingDir,
        specPath: preflight.specPath,
        ...(ctx.opts.reviewPasses !== undefined ? { reviewPassesOverride: ctx.opts.reviewPasses } : {}),
        fanout,
        writeTelemetry,
        ...(ctx.opts.agents !== undefined ? { agents: ctx.opts.agents } : {}),
        iterationTimeoutMs: preflight.cfg.iterationTimeoutMs,
        ...(ctx.opts.__testKillGraceMs !== undefined ? { __testKillGraceMs: ctx.opts.__testKillGraceMs } : {}),
        actuatorAgents: ctx.activeAgents,
        ...(ctx.opts.resumeReview === true ? { resumeReview: true } : {}),
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
      reviewExitCode = 1;
    }
    if (reviewExitCode !== 0) {
      return reviewExitCode;
    }
  } else if (preflight.gitEnabled) {
    try {
      maybeMarkReady({
        indexPath: preflight.specPath,
        cwd: preflight.agentWorkingDir,
        agentLabel: "patch-complete",
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
  tryFinishSpecIfDone,
  runCompletionReadyGate,
  generatePrBody,
  diffAcceptanceCriteria,
  getIndexTitle,
  getCurrentBranch,
  lookupPrUrl,
};
export type { CompletionLoopbackSignal };
