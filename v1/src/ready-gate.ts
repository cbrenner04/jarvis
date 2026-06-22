import { execFileSync } from "node:child_process";
import { getCurrentBranch } from "../../shared/git.ts";
import { appendAgentTrailer } from "./commit-trailer.ts";
import { pushCurrent } from "./worktree.ts";

/** Harness-selected `scripts/ready.ts` tier. */
export type ReadyTier = "fast" | "full";

/** HEAD sha recorded after a successful `full` ready gate. */
export type RecordedGreenResult = {
  headSha: string;
};

/**
 * Check if the tree is unchanged since the recorded green result.
 * Tree is unchanged only when current HEAD sha equals the recorded sha AND the worktree is clean.
 */
export function isTreeUnchangedSinceRecordedGreen(opts: { cwd: string; recordedGreenHeadSha?: string }): boolean {
  if (opts.recordedGreenHeadSha === undefined) {
    return false;
  }

  if (getCurrentHeadSha(opts.cwd) !== opts.recordedGreenHeadSha) {
    return false;
  }

  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

  return porcelain === "";
}

/**
 * Pick `fast` when HEAD and porcelain match the recorded green carrier; otherwise `full`.
 * Callers that must not reuse (e.g. `--resume-review`) pass no carrier or force `full` upstream.
 */
export function selectReadyTier(opts: { cwd: string; recordedGreenResult?: RecordedGreenResult }): ReadyTier {
  if (
    opts.recordedGreenResult !== undefined &&
    isTreeUnchangedSinceRecordedGreen({
      cwd: opts.cwd,
      recordedGreenHeadSha: opts.recordedGreenResult.headSha,
    })
  ) {
    return "fast";
  }
  return "full";
}

export type RunReadyAndCommitOpts = {
  cwd: string;
  /** Ready pipeline tier; defaults to `full`. */
  tier?: ReadyTier;
  /** Test seam: agent label for the commit trailer. Threaded to the `commitCheckFix` seam. */
  agentLabel?: string;
  /** Per-project override for `bun run ready`. Tokenized on whitespace; no shell. Receives `JARVIS_READY_TIER`. */
  readyCommand?: string;
  /** Seam for just `bun run ready`. Defaults to execFileSync call. */
  runReady?: (cwd: string, tier: ReadyTier) => void;
  /** Seam for dirty-check, git add -A, git commit, idempotency re-check, and pushCurrent together. Called only after a `full` tier when tree is dirty. */
  commitCheckFix?: (cwd: string, agentLabel: string) => void;
};

/** Run `bun run ready` (or the configured `readyCommand`) at `tier` and, on `full` only, commit/push any `check:fix` output. */
export function runReadyAndCommit(opts: RunReadyAndCommitOpts): void {
  const tier = opts.tier ?? "full";

  const realBunRunReady = (cwd: string, readyTier: ReadyTier) => {
    const tokens = opts.readyCommand !== undefined ? opts.readyCommand.trim().split(/\s+/) : ["bun", "run", "ready"];
    const [head, ...args] = tokens;
    const displayCmd = tokens.join(" ");
    try {
      execFileSync(head!, args, {
        cwd,
        env: { ...process.env, JARVIS_READY_TIER: readyTier },
        stdio: "pipe",
      });
    } catch (err) {
      const out = err as NodeJS.ErrnoException & {
        stdout?: Buffer;
        stderr?: Buffer;
      };
      const captured = [out.stdout?.toString(), out.stderr?.toString()].filter(Boolean).join("\n").trim();
      throw new Error(captured ? `${displayCmd} failed:\n${captured}` : `${displayCmd} failed`);
    }
  };

  const realCommitCheckFix = (cwd: string, agentLabel: string) => {
    execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });
    const commitMessage = appendAgentTrailer("chore: apply pre-ready check:fix", agentLabel);
    execFileSync("git", ["commit", "-F", "-"], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      input: commitMessage,
    });

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

    pushCurrent({ cwd, firstPush: false });
  };

  const runReadyFn = opts.runReady ?? realBunRunReady;
  const commitCheckFixFn = opts.commitCheckFix ?? realCommitCheckFix;

  runReadyFn(opts.cwd, tier);

  if (tier !== "full") {
    return;
  }

  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

  if (porcelain !== "") {
    commitCheckFixFn(opts.cwd, opts.agentLabel ?? "");
  }
}

/**
 * Run ready at the tier selected from `recordedGreenResult`, refreshing the carrier on `full` success.
 * Returns the tier invoked.
 */
export function runReadyGateWithTier(opts: {
  cwd: string;
  agentLabel: string;
  readyCommand?: string;
  recordedGreenResult?: RecordedGreenResult;
  runReady?: (cwd: string, tier: ReadyTier) => void;
  commitCheckFix?: (cwd: string, agentLabel: string) => void;
  refreshRecordedGreenResult?: (headSha: string) => void;
}): ReadyTier {
  const tier = selectReadyTier({
    cwd: opts.cwd,
    ...(opts.recordedGreenResult !== undefined ? { recordedGreenResult: opts.recordedGreenResult } : {}),
  });
  runReadyAndCommit({
    cwd: opts.cwd,
    tier,
    agentLabel: opts.agentLabel,
    ...(opts.readyCommand !== undefined ? { readyCommand: opts.readyCommand } : {}),
    ...(opts.runReady !== undefined ? { runReady: opts.runReady } : {}),
    ...(opts.commitCheckFix !== undefined ? { commitCheckFix: opts.commitCheckFix } : {}),
  });
  if (tier === "full" && opts.refreshRecordedGreenResult !== undefined) {
    opts.refreshRecordedGreenResult(getCurrentHeadSha(opts.cwd));
  }
  return tier;
}

/**
 * Get the current HEAD sha.
 */
export function getCurrentHeadSha(cwd: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}
