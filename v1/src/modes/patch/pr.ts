import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Agent } from "../../agents/types.ts";
import { appendAgentTrailer } from "../../commit-trailer.ts";
import {
  checkPrExists,
  extractNarrative,
  NARRATIVE_END_MARKER,
  NARRATIVE_START_MARKER,
  renderAttributionSummary,
} from "../../pr.ts";
import { pushCurrent } from "../../worktree.ts";
import { buildPrDescriptionPrompt } from "./pr-description-prompt.ts";
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

/**
 * Generate the PR description by calling the model with the PR description prompt.
 * Returns the model's response containing Description + Decisions section.
 *
 * Validates that the response contains the expected shape. Returns null if
 * generation fails or validation fails.
 */
export async function generatePrDescription(opts: {
  specPath: string;
  agent: Agent;
  cwd: string;
}): Promise<string | null> {
  try {
    const specContent = readFileSync(opts.specPath, "utf8");
    const prompt = buildPrDescriptionPrompt({
      specPath: opts.specPath,
      specContext: specContent,
    });

    const result = await opts.agent.run(prompt, {
      cwd: opts.cwd,
    });

    if (result.kind !== "ok") {
      return null;
    }

    const description = result.stdout.trim();
    if (!description.includes("Decisions:")) {
      return null;
    }

    return description;
  } catch {
    return null;
  }
}

export type UpdatePrBodyOpts = {
  indexPath: string;
  branch: string;
  base: string;
  cwd: string;
  agent?: Agent;
  /** Test seam: fetch the current PR body. Defaults to `gh pr view`. */
  fetchPrBody?: (branch: string, cwd: string) => string;
  /** Test seam: write the new PR body. Defaults to `gh pr edit --body-file -`. */
  writePrBody?: (branch: string, body: string, cwd: string) => void;
  /** Test seam: render the attribution footer. Defaults to `renderAttribution`. */
  renderFooter?: (opts: { cwd: string; base: string }) => string;
};

/**
 * Rewrite the PR body for `branch` from scratch: fetch the current body,
 * preserve the narrative section between markers (if present and non-empty),
 * rebuild the deterministic header from `indexPath`, render the attribution
 * footer from git trailers, and pipe the assembled body to `gh pr edit --body-file -`.
 *
 * When the narrative block is empty or missing and an agent is provided,
 * regenerate the narrative. Otherwise, preserve existing narrative verbatim.
 *
 * Throws on `gh` failure; callers wrap with try/catch and warn-and-continue.
 */
export async function updatePrBody(opts: UpdatePrBodyOpts): Promise<void> {
  const fetchPrBody = opts.fetchPrBody ?? defaultFetchPrBody;
  const writePrBody = opts.writePrBody ?? defaultWritePrBody;
  const renderFooter = opts.renderFooter ?? renderAttributionSummary;

  const currentBody = fetchPrBody(opts.branch, opts.cwd);
  let narrative = extractNarrative(currentBody);

  if (!narrative && opts.agent) {
    narrative = await generatePrDescription({
      specPath: opts.indexPath,
      agent: opts.agent,
      cwd: opts.cwd,
    });
  }

  const header = buildPrBody({ indexPath: opts.indexPath, narrative: null });
  let headerAndNarrative = header;
  if (narrative) {
    headerAndNarrative += `\n\n${NARRATIVE_START_MARKER}\n${narrative}\n${NARRATIVE_END_MARKER}`;
  }
  const footer = renderFooter({ cwd: opts.cwd, base: opts.base });
  const newBody =
    footer === ""
      ? headerAndNarrative
      : `${headerAndNarrative}\n\n---\n\n${footer}`;
  writePrBody(opts.branch, newBody, opts.cwd);
}

function defaultFetchPrBody(branch: string, cwd: string): string {
  return execFileSync(
    "gh",
    ["pr", "view", branch, "--json", "body", "-q", ".body"],
    { cwd, env: process.env, stdio: "pipe", encoding: "utf8" },
  );
}

function defaultWritePrBody(branch: string, body: string, cwd: string): void {
  execFileSync("gh", ["pr", "edit", branch, "--body-file", "-"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    input: body,
  });
}

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

  const realGhPrReady = (branch: string, cwd: string) => {
    execFileSync("gh", ["pr", "ready", branch], {
      cwd,
      env: process.env,
      stdio: "pipe",
    });
  };

  // Four-seam sequence
  const runReadyFn = opts.runReady ?? realBunRunReady;
  const commitCheckFixFn = opts.commitCheckFix ?? realCommitCheckFix;
  const ghPrReadyFn = opts.ghPrReady ?? realGhPrReady;

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

  ghPrReadyFn(branch, opts.cwd);
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
