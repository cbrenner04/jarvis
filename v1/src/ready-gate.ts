import { execFileSync } from "node:child_process";
import { appendAgentTrailer } from "./commit-trailer.ts";
import { getCurrentBranch } from "../../shared/git.ts";
import { pushCurrent } from "./worktree.ts";

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

  // Check if worktree is clean
  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

  return porcelain === "";
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

/** Run `bun run ready` and commit/push any `check:fix` output before proceeding. */
export function runReadyAndCommit(opts: RunReadyAndCommitOpts): void {
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
      const captured = [out.stdout?.toString(), out.stderr?.toString()].filter(Boolean).join("\n").trim();
      throw new Error(captured ? `bun run ready failed:\n${captured}` : `bun run ready failed`);
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

  runReadyFn(opts.cwd);

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
 * Get the current HEAD sha.
 */
export function getCurrentHeadSha(cwd: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}
