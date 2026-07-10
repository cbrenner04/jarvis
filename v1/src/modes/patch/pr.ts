import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getCurrentBranch } from "../../../../shared/git.ts";
import { parseSpec } from "../../../../shared/spec-parser.ts";
import type { Agent, AgentRunOptions } from "../../agents/types.ts";
import { getBaseBranch, type SyncTransientRetryOptions, withSyncTransientRetry } from "../../gh.ts";
import { tryAutoIntegrateBase } from "../../git/auto-integrate-base.ts";
import { type BaseCurrentCheckResult, checkBaseCurrent, writeReadyFlipBlocked } from "../../git/base-current.ts";
import { checkPrExists, extractNarrative, NARRATIVE_END_MARKER, NARRATIVE_START_MARKER } from "../../pr.ts";
import { updatePrBody as updatePrBodyShared } from "../../pr-module.ts";
import { type DiffStat, generateNarrativeViaAgent, PR_DESCRIPTION_CONTEXT_MAX_CHARS } from "../../pr-shared.ts";
import {
  type ReadyTier,
  type RunReadyAndCommitOpts,
  runReadyAndCommit,
  runReadyGateWithTier,
} from "../../ready-gate.ts";
import { GIT_SUBPROCESS_OPTS } from "./git-subprocess.ts";
import { buildPrDescriptionPrompt } from "./pr-description-prompt.ts";

export { NARRATIVE_END_MARKER, NARRATIVE_START_MARKER };

export function buildPrBody(opts: { indexPath: string; narrative: string | null }): string {
  const indexContent = readFileSync(opts.indexPath, "utf8");
  const parsedIndex = parseSpec(indexContent);

  const lines: string[] = [];
  if (parsedIndex.h1) {
    lines.push(`# ${parsedIndex.h1}`);
  }

  let body = lines.join("\n");

  if (opts.narrative !== null) {
    const narrativeBlock = `${NARRATIVE_START_MARKER}\n${opts.narrative}\n${NARRATIVE_END_MARKER}`;
    body = body === "" ? narrativeBlock : `${body}\n\n${narrativeBlock}`;
  }

  const humanVerifyItems = collectUncheckedHumanOnlyCriteria(opts.indexPath, parsedIndex);
  if (humanVerifyItems.length > 0) {
    const checklist = buildHumanVerifyChecklist(humanVerifyItems);
    body = body === "" ? checklist : `${body}\n\n${checklist}`;
  }

  return body;
}

type HumanVerifyItem = {
  criterion: string;
  subspecPath: string;
};

function collectUncheckedHumanOnlyCriteria(
  indexPath: string,
  parsedIndex: ReturnType<typeof parseSpec>,
): HumanVerifyItem[] {
  const items: HumanVerifyItem[] = [];
  const indexDir = dirname(indexPath);

  for (const subspec of parsedIndex.linkedSubspecs) {
    // Skip external links
    if (/^[a-z][a-z0-9+.-]*:/i.test(subspec.path)) {
      continue;
    }

    const subspecPath = resolve(indexDir, subspec.path);
    if (!existsSync(subspecPath)) {
      continue;
    }

    const subspecContent = readFileSync(subspecPath, "utf8");
    const parsedSubspec = parseSpec(subspecContent);

    for (const criterion of parsedSubspec.acceptanceCriteria) {
      if (!criterion.checked && criterion.humanOnly) {
        items.push({
          criterion: criterion.text,
          subspecPath: subspec.path,
        });
      }
    }
  }

  return items;
}

function buildHumanVerifyChecklist(items: HumanVerifyItem[]): string {
  const lines: string[] = ["## Human verification checklist"];
  for (const item of items) {
    lines.push(`- [ ] ${item.criterion} ([${item.subspecPath}](${item.subspecPath}))`);
  }
  return lines.join("\n");
}

export { extractNarrative };

/**
 * Generate the PR description by calling the model with the PR description prompt.
 * Returns the model's response containing Description + Decisions section, marked as generated.
 * Returns null if generation fails or validation fails.
 */
export async function generatePrDescription(opts: {
  specPath: string;
  agent: Agent;
  cwd: string;
  runOptions?: Partial<Omit<AgentRunOptions, "cwd">>;
}): Promise<string | null> {
  const genOpts: Parameters<typeof generateNarrativeViaAgent>[0] = {
    buildPrompt: () =>
      buildPrDescriptionPrompt({
        specPath: opts.specPath,
        specContext: buildSpecContext(opts.specPath),
      }),
    agent: opts.agent,
    cwd: opts.cwd,
  };
  if (opts.runOptions !== undefined) {
    genOpts.runOptions = opts.runOptions;
  }
  return generateNarrativeViaAgent(genOpts);
}

function buildSpecContext(indexPath: string): string {
  const indexContent = readFileSync(indexPath, "utf8");
  const sections = [`## index.md\n\n${indexContent.trim()}`];
  const parsed = parseSpec(indexContent);
  for (const subspec of parsed.linkedSubspecs) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(subspec.path)) {
      continue;
    }
    const subspecPath = resolve(dirname(indexPath), subspec.path);
    if (!existsSync(subspecPath)) {
      continue;
    }
    sections.push(`## ${subspec.path}\n\n${readFileSync(subspecPath, "utf8").trim()}`);
  }
  return truncateContext(sections.join("\n\n"));
}

function truncateContext(context: string): string {
  if (context.length <= PR_DESCRIPTION_CONTEXT_MAX_CHARS) {
    return context;
  }
  return `${context.slice(0, PR_DESCRIPTION_CONTEXT_MAX_CHARS)}\n\n[truncated]`;
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

export type UpdatePrBodyOpts = {
  indexPath: string;
  branch: string;
  base: string;
  cwd: string;
  prNarrative?: "template" | "agent";
  agent?: Agent;
  runOptions?: Partial<Omit<AgentRunOptions, "cwd">>;
  /** Test seam: fetch the current PR body. Defaults to `gh pr view`. */
  fetchPrBody?: (branch: string, cwd: string) => string;
  /** Test seam: write the new PR body. Defaults to `gh pr edit --body-file -`. */
  writePrBody?: (branch: string, body: string, cwd: string) => void;
  /** Test seam: render the attribution footer. Defaults to `renderAttributionSummary`. */
  renderFooter?: (opts: { cwd: string; base: string }) => string;
  /** Test seam: get diff stats for change summary. Defaults to `git diff --numstat base...HEAD`. */
  getDiffStats?: (cwd: string, base: string) => DiffStat[];
  /** Test seam: get subspec bodies for why lines. Defaults to reading from index-linked subspecs. */
  getSubspecBodies?: () => string[];
  /** Test seam: get commit subjects. Defaults to git branch commits. */
  getCommitSubjects?: () => string[];
};

/**
 * Rewrite the PR body for `branch` from scratch: fetch the current body,
 * preserve/regenerate the narrative section between markers (if present),
 * rebuild the deterministic header from `indexPath`, render the attribution
 * footer from git trailers, and pipe the assembled body to `gh pr edit --body-file -`.
 *
 * Behavior depends on `prNarrative`:
 * - `template`: regenerate narrative from index subspecs + commits
 * - `agent`: if narrative is empty/missing/marked-generated, regenerate via agent
 *
 * Throws on `gh` failure; callers wrap with try/catch and warn-and-continue.
 */
export async function updatePrBody(opts: UpdatePrBodyOpts): Promise<void> {
  const getDiffStatsFn: (cwd: string, base: string) => DiffStat[] =
    opts.getDiffStats ?? ((cwd: string, base: string) => readDiffStats(cwd, base));
  const getSubspecBodiesFn: () => string[] =
    opts.getSubspecBodies ??
    (() => {
      const indexContent = readFileSync(opts.indexPath, "utf8");
      const parsed = parseSpec(indexContent);
      const indexDir = dirname(opts.indexPath);
      return parsed.linkedSubspecs.map((s) => {
        const subspecPath = join(indexDir, s.path);
        try {
          return readFileSync(subspecPath, "utf8");
        } catch {
          return "";
        }
      });
    });

  const sharedOpts: Parameters<typeof updatePrBodyShared>[0] = {
    branch: opts.branch,
    base: opts.base,
    cwd: opts.cwd,
    buildHeader: () => buildPrBody({ indexPath: opts.indexPath, narrative: null }),
    getSubspecTitles: () => {
      const indexContent = readFileSync(opts.indexPath, "utf8");
      const parsed = parseSpec(indexContent);
      return parsed.linkedSubspecs.map((s) => s.text);
    },
    buildPrompt: () =>
      buildPrDescriptionPrompt({
        specPath: opts.indexPath,
        specContext: buildSpecContext(opts.indexPath),
      }),
    getDiffStats: () => getDiffStatsFn(opts.cwd, opts.base),
    getSubspecBodies: getSubspecBodiesFn,
    getCommitSubjects: opts.getCommitSubjects,
  };

  if (opts.prNarrative !== undefined) {
    sharedOpts.prNarrative = opts.prNarrative;
  }
  if (opts.agent !== undefined) {
    sharedOpts.agent = opts.agent;
  }
  if (opts.runOptions !== undefined) {
    sharedOpts.runOptions = opts.runOptions;
  }
  if (opts.fetchPrBody !== undefined) {
    sharedOpts.fetchPrBody = opts.fetchPrBody;
  }
  if (opts.writePrBody !== undefined) {
    sharedOpts.writePrBody = opts.writePrBody;
  }
  if (opts.renderFooter !== undefined) {
    sharedOpts.renderFooter = opts.renderFooter;
  }
  return updatePrBodyShared(sharedOpts);
}

export function extractSubspecTitle(subspecPath: string): string {
  // Extract just the filename without extension as a fallback title
  const parts = subspecPath.split("/");
  const filename = parts[parts.length - 1] ?? subspecPath;
  return filename.replace(/\.md$/, "");
}

export type { RunReadyAndCommitOpts };
export { runReadyAndCommit };

export type MaybeMarkReadyOpts = {
  indexPath: string;
  cwd: string;
  timeoutMs: number;
  /** Test seam: fixed base branch instead of `getBaseBranch`. */
  baseBranch?: string;
  /** Test seam: bypass getCurrentBranch when set. Used by pr.test.ts to avoid real git. */
  branchName?: string;
  /** Test seam: agent label for the pre-ready fix commit trailer. Threaded to the `commitPreReadyFix` seam. */
  agentLabel?: string;
  /** Test seam: check if PR exists. Defaults to `checkPrExists`. */
  checkPrExists?: (branch: string, cwd: string) => boolean;
  /** Test seam: resolve/fetch/compare the PR base. Defaults to `checkBaseCurrent`. */
  checkBaseCurrent?: (opts: { branch: string; cwd: string }) => BaseCurrentCheckResult;
  /** Short-circuit seam: stubs the entire ready + commit + gh-pr-ready sequence. When present, skips all other seams. */
  markReady?: (branch: string, cwd: string) => void;
  /** Per-project override for `bun run ready`. Passed to `runReadyGateWithTier`. */
  readyCommand?: string;
  /** Per-project override for `bun run fix`. Passed to `runReadyGateWithTier`. */
  fixCommand?: string;
  /** Seam for built-in `bun run fix` on `full` tier. Used by tests when markReady is absent. */
  runFix?: (cwd: string) => void;
  /** Seam for verification only (`bun run ready` or `readyCommand`). Used by tests when markReady is absent. */
  runReady?: (cwd: string, tier: ReadyTier) => void;
  /** Seam for pre-ready fix commit/push on `full` tier when porcelain is non-empty after fix. */
  commitPreReadyFix?: (cwd: string, agentLabel: string) => void;
  /** Seam for the `gh pr ready <branch>` shell-out. Used by tests to verify it is/isn't called. Defaults to execFileSync call wrapped with retry. */
  ghPrReady?: (branch: string, cwd: string) => void;
  /** Seam for retry behavior: exec, sleep, onRetry callbacks. Injected into the retry wrapper below ghPrReady. */
  ghPrReadyRetryOpts?: Partial<SyncTransientRetryOptions>;
  /** Recorded green result from completion transition: reuse when tree unchanged, refresh on re-run. */
  recordedGreenResult?: {
    /** HEAD sha from completion transition ready gate (post-`runReadyAndCommit`). */
    headSha: string;
  };
  /** Refresh callback: called when ready re-runs and succeeds, to update the recorded result. */
  refreshRecordedGreenResult?: (headSha: string) => void;
  /** Test seam: operator-visible stderr sink for blocked flips. Defaults to `process.stderr.write`. */
  stderr?: (s: string) => void;
  /** When true at enabled sites, attempt conflict-free `origin/<base>` merge before ready flip. */
  autoIntegrateBase?: boolean;
  /** Test seam: override auto-integrate helper. */
  tryAutoIntegrateBase?: typeof tryAutoIntegrateBase;
};

export async function maybeMarkReady(opts: MaybeMarkReadyOpts): Promise<void> {
  if (!linkedSubspecsAreComplete(readFileSync(opts.indexPath, "utf8"))) {
    return;
  }

  const branch = opts.branchName ?? getCurrentBranch(opts.cwd);
  const checkPr = opts.checkPrExists ?? checkPrExists;
  const prExists = checkPr(branch, opts.cwd);
  if (!prExists) {
    throw new Error(
      `cannot mark PR ready: no PR found for branch ${branch}. This should not happen after opening a draft PR.`,
    );
  }

  const baseCurrent = (opts.checkBaseCurrent ?? checkBaseCurrent)({ branch, cwd: opts.cwd });
  if (baseCurrent.status === "behind") {
    if (opts.autoIntegrateBase === true) {
      const integrate = opts.tryAutoIntegrateBase ?? tryAutoIntegrateBase;
      integrate({
        branch,
        cwd: opts.cwd,
        baseRefName: baseCurrent.baseRefName,
        agentLabel: opts.agentLabel ?? "",
        timeoutMs: opts.timeoutMs,
        ...(opts.readyCommand !== undefined ? { readyCommand: opts.readyCommand } : {}),
        ...(opts.fixCommand !== undefined ? { fixCommand: opts.fixCommand } : {}),
        ...(opts.runFix !== undefined ? { runFix: opts.runFix } : {}),
        ...(opts.runReady !== undefined ? { runReady: opts.runReady } : {}),
        ...(opts.commitPreReadyFix !== undefined ? { commitPreReadyFix: opts.commitPreReadyFix } : {}),
        ...(opts.ghPrReady !== undefined ? { ghPrReady: opts.ghPrReady } : {}),
        ...(opts.ghPrReadyRetryOpts !== undefined ? { ghPrReadyRetryOpts: opts.ghPrReadyRetryOpts } : {}),
        ...(opts.stderr !== undefined ? { stderr: opts.stderr } : {}),
        ...(opts.refreshRecordedGreenResult !== undefined
          ? { refreshRecordedGreenResult: opts.refreshRecordedGreenResult }
          : {}),
      });
      return;
    }
    writeReadyFlipBlocked(opts.stderr ?? process.stderr.write.bind(process.stderr), branch, baseCurrent.baseRefName);
    return;
  }

  // Short-circuit: if markReady is provided, use it and skip all other seams
  if (opts.markReady) {
    opts.markReady(branch, opts.cwd);
    return;
  }

  const retryGhPrReady = (branch: string, cwd: string) => {
    withSyncTransientRetry(
      () => {
        execFileSync("gh", ["pr", "ready", branch], {
          cwd,
          env: process.env,
          stdio: "pipe",
        });
      },
      {
        op: "gh pr ready",
        isPrReady: true,
        ...opts.ghPrReadyRetryOpts,
      },
    );
  };

  // Run ready at the tier selected from the recorded green carrier, then flip draft→ready.
  const baseBranch = opts.baseBranch ?? (await getBaseBranch(opts.cwd));
  runReadyGateWithTier({
    cwd: opts.cwd,
    agentLabel: opts.agentLabel ?? "",
    timeoutMs: opts.timeoutMs,
    baseBranch,
    ...(opts.readyCommand !== undefined ? { readyCommand: opts.readyCommand } : {}),
    ...(opts.fixCommand !== undefined ? { fixCommand: opts.fixCommand } : {}),
    ...(opts.recordedGreenResult !== undefined ? { recordedGreenResult: opts.recordedGreenResult } : {}),
    ...(opts.runFix !== undefined ? { runFix: opts.runFix } : {}),
    ...(opts.runReady !== undefined ? { runReady: opts.runReady } : {}),
    ...(opts.commitPreReadyFix !== undefined ? { commitPreReadyFix: opts.commitPreReadyFix } : {}),
    ...(opts.refreshRecordedGreenResult !== undefined
      ? { refreshRecordedGreenResult: opts.refreshRecordedGreenResult }
      : {}),
  });

  const ghPrReadyFn = opts.ghPrReady ?? retryGhPrReady;
  ghPrReadyFn(branch, opts.cwd);
}

function linkedSubspecsAreComplete(indexContent: string): boolean {
  const linked = parseSpec(indexContent).linkedSubspecs;
  if (linked.length === 0) {
    return false;
  }
  return linked.every((item) => item.checked);
}
