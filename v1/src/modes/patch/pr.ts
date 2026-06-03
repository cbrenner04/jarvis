import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import {
  checkPrExists,
  extractNarrative,
  NARRATIVE_END_MARKER,
  NARRATIVE_START_MARKER,
  renderAttributionSummary,
  type UpdatePrBodyOpts as SharedUpdatePrBodyOpts,
  updatePrBody as sharedUpdatePrBody,
} from "../../pr.ts";
import { pushCurrent } from "../../worktree.ts";
import { parsePatchSpec } from "./spec.ts";

export { NARRATIVE_END_MARKER, NARRATIVE_START_MARKER };

export function buildPrBody(opts: {
  indexPath: string;
  narrative: string | null;
}): string {
  const indexContent = readFileSync(opts.indexPath, "utf8");
  const parsedIndex = parsePatchSpec(indexContent);

  const lines: string[] = [];
  if (parsedIndex.h1) {
    lines.push(`# ${parsedIndex.h1}`);
  }

  let body = lines.join("\n");

  if (opts.narrative !== null) {
    const narrativeBlock = `${NARRATIVE_START_MARKER}\n${opts.narrative}\n${NARRATIVE_END_MARKER}`;
    body = body === "" ? narrativeBlock : `${body}\n\n${narrativeBlock}`;
  }

  return body;
}

export { extractNarrative };

export type UpdatePrBodyOpts = {
  indexPath: string;
  branch: string;
  base: string;
  cwd: string;
  /** Test seam: fetch the current PR body. Defaults to `gh pr view`. */
  fetchPrBody?: (branch: string, cwd: string) => string;
  /** Test seam: write the new PR body. Defaults to `gh pr edit --body-file -`. */
  writePrBody?: (branch: string, body: string, cwd: string) => void;
  /** Test seam: render the attribution footer. Defaults to `renderAttribution`. */
  renderFooter?: (opts: { cwd: string; base: string }) => string;
};

/**
 * Rewrite the PR body for `branch` from scratch: fetch the current body,
 * preserve the narrative section between markers (if present), rebuild the
 * deterministic header from `indexPath`, render the attribution footer from
 * git trailers, and pipe the assembled body to `gh pr edit --body-file -`.
 *
 * Throws on `gh` failure; callers wrap with try/catch and warn-and-continue.
 */
export function updatePrBody(opts: UpdatePrBodyOpts): void {
  const sharedOpts: SharedUpdatePrBodyOpts = {
    headerBuilder: () =>
      buildPrBody({ indexPath: opts.indexPath, narrative: null }),
    branch: opts.branch,
    base: opts.base,
    cwd: opts.cwd,
  };
  if (opts.fetchPrBody) {
    sharedOpts.fetchPrBody = opts.fetchPrBody;
  }
  if (opts.writePrBody) {
    sharedOpts.writePrBody = opts.writePrBody;
  }
  if (opts.renderFooter) {
    sharedOpts.renderFooter = opts.renderFooter;
  } else {
    sharedOpts.renderFooter = ({ cwd, base }) =>
      renderAttributionSummary({ cwd, base });
  }
  sharedUpdatePrBody(sharedOpts);
}

export type RunReadyAndCommitOpts = {
  cwd: string;
  /** Test seam: agent label for the commit trailer. Threaded to the `commitCheckFix` seam. */
  agentLabel?: string;
  /** Seam for just `bun run ready`. Defaults to execFileSync call. */
  runReady?: (cwd: string) => void;
  /** Seam for dirty-check, git add -A, git commit, idempotency re-check, and pushCurrent together. Called only when tree is dirty after runReady. */
  commitCheckFix?: (cwd: string, agentLabel: string) => void;
};

export type MaybeMarkReadyOpts = {
  indexPath: string;
  cwd: string;
  /** Test seam: agent label for the commit trailer. Threaded to the `commitCheckFix` seam. */
  agentLabel?: string;
  /** Test seam: check if PR exists. Defaults to `checkPrExists`. */
  checkPrExists?: (branch: string, cwd: string) => boolean;
  /** Short-circuit seam: stubs the entire ready + commit + gh-pr-ready sequence. When present, skips all other seams. */
  markReady?: (branch: string, cwd: string) => void;
  /** Seam for just `bun run ready`. Used by tests when markReady is absent. Defaults to execFileSync call. */
  runReady?: (cwd: string) => void;
  /** Seam for dirty-check, git add -A, git commit, idempotency re-check, and pushCurrent together. Called only when markReady is absent and tree is dirty after runReady. */
  commitCheckFix?: (cwd: string, agentLabel: string) => void;
  /** Seam for the `gh pr ready <branch>` shell-out. Used by tests to verify it is/isn't called. Defaults to execFileSync call. */
  ghPrReady?: (branch: string, cwd: string) => void;
};

export function runReadyAndCommit(opts: RunReadyAndCommitOpts): void {
  // Default implementations
  const realBunRunReady = (cwd: string) => {
    try {
      execFileSync("bun", ["run", "ready"], {
        cwd,
        env: process.env,
        stdio: "pipe",
      });
    } catch (err) {
      const out = err as NodeJS.ErrnoException & {
        stdout?: Buffer;
        stderr?: Buffer;
      };
      const captured = [out.stdout?.toString(), out.stderr?.toString()]
        .filter(Boolean)
        .join("\n")
        .trim();
      throw new Error(
        captured
          ? `bun run ready failed:\n${captured}`
          : `bun run ready failed`,
      );
    }
  };

  const realCommitCheckFix = (cwd: string, agentLabel: string) => {
    execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });
    const commitMessage = appendAgentTrailer(
      "chore: apply pre-ready check:fix",
      agentLabel,
    );
    execFileSync("git", ["commit", "-F", "-"], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      input: commitMessage,
    });

    // Idempotency guard: re-check for dirty state
    const porcelain = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
    if (porcelain !== "") {
      const dirtyBranch = getCurrentBranch(cwd);
      throw new Error(
        `pre-ready check:fix commit succeeded but worktree is still dirty on branch ${dirtyBranch}:\n${porcelain}\nDo not call gh pr ready. Inspect the branch and commit or discard the unexpected changes.`,
      );
    }

    // Push after successful commit
    pushCurrent({ cwd, firstPush: false });
  };

  const runReadyFn = opts.runReady ?? realBunRunReady;
  const commitCheckFixFn = opts.commitCheckFix ?? realCommitCheckFix;

  runReadyFn(opts.cwd);

  // Check for dirty state after running ready
  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

  if (porcelain !== "") {
    commitCheckFixFn(opts.cwd, opts.agentLabel ?? "");
  }
}

export function maybeMarkReady(opts: MaybeMarkReadyOpts): void {
  if (!linkedSubspecsAreComplete(readFileSync(opts.indexPath, "utf8"))) {
    return;
  }

  const branch = getCurrentBranch(opts.cwd);
  const checkPr = opts.checkPrExists ?? checkPrExists;
  const prExists = checkPr(branch, opts.cwd);
  if (!prExists) {
    throw new Error(
      `cannot mark PR ready: no PR found for branch ${branch}. This should not happen after opening a draft PR.`,
    );
  }

  // Short-circuit: if markReady is provided, use it and skip all other seams
  if (opts.markReady) {
    opts.markReady(branch, opts.cwd);
    return;
  }

  const realGhPrReady = (branch: string, cwd: string) => {
    execFileSync("gh", ["pr", "ready", branch], {
      cwd,
      env: process.env,
      stdio: "pipe",
    });
  };

  // Run ready and commit logic
  runReadyAndCommit({
    cwd: opts.cwd,
    ...(opts.agentLabel !== undefined ? { agentLabel: opts.agentLabel } : {}),
    ...(opts.runReady !== undefined ? { runReady: opts.runReady } : {}),
    ...(opts.commitCheckFix !== undefined
      ? { commitCheckFix: opts.commitCheckFix }
      : {}),
  });

  // Then mark ready
  const ghPrReadyFn = opts.ghPrReady ?? realGhPrReady;
  ghPrReadyFn(branch, opts.cwd);
}

export function generatePrBodyFromSpec(specIndexPath: string): string {
  const specDir = dirname(specIndexPath);
  const indexContent = readFileSync(specIndexPath, "utf8");
  const parsedIndex = parsePatchSpec(indexContent);

  let body = parsedIndex.h1 ? `# ${parsedIndex.h1}\n\n` : "";

  const linkedForBody = parsedIndex.linkedSubspecs.filter(
    (linked) => !linked.path.endsWith(".md"),
  );

  if (linkedForBody.length > 0) {
    body += "## Subspecs\n\n";
    for (const linked of linkedForBody) {
      const h1 = extractFirstHeadingFromSpec(resolve(specDir, linked.path));
      if (h1) {
        body += `- ${h1}\n`;
      }
    }
  }

  return body;
}

function extractFirstHeadingFromSpec(specPath: string): string | null {
  try {
    const content = readFileSync(specPath, "utf8");
    return parsePatchSpec(content).h1 ?? null;
  } catch {
    return null;
  }
}

function linkedSubspecsAreComplete(indexContent: string): boolean {
  const linked = parsePatchSpec(indexContent).linkedSubspecs;
  if (linked.length === 0) {
    return false;
  }
  return linked.every((item) => item.checked);
}

function getCurrentBranch(cwd: string): string {
  const output = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });
  return output.trim();
}
