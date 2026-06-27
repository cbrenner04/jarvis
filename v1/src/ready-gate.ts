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
  /** Test seam: agent label for the pre-ready fix commit trailer. */
  agentLabel?: string;
  /** Per-project override for `bun run ready`. Tokenized on whitespace; no shell. Receives `JARVIS_READY_TIER`. */
  readyCommand?: string;
  /** Seam for built-in `bun run fix` on `full` tier. Defaults to execFileSync call. */
  runFix?: (cwd: string) => void;
  /** Seam for just `bun run ready` (or `readyCommand`). Defaults to execFileSync call. */
  runReady?: (cwd: string, tier: ReadyTier) => void;
  /** Seam for pre-ready fix output: git add -A, git commit, idempotency re-check, and pushCurrent together. Called only on `full` when porcelain is non-empty after fix. */
  commitPreReadyFix?: (cwd: string, agentLabel: string) => void;
};

export class FixCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixCommandError";
  }
}

export class ReadyCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadyCommandError";
  }
}

export class PreReadyFixCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreReadyFixCommitError";
  }
}

export class PreReadyFixPushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreReadyFixPushError";
  }
}

export class ReadyVerificationDirtyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadyVerificationDirtyError";
  }
}

function readPorcelain(cwd: string): string {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

/** On `full` tier: run fix → commit-if-dirty → strict ready; on `fast`: verification only. */
export function runReadyAndCommit(opts: RunReadyAndCommitOpts): void {
  const tier = opts.tier ?? "full";

  const realRunFix = (cwd: string) => {
    try {
      execFileSync("bun", ["run", "fix"], {
        cwd,
        stdio: "pipe",
      });
    } catch (err) {
      const out = err as NodeJS.ErrnoException & {
        stdout?: Buffer;
        stderr?: Buffer;
      };
      const captured = [out.stdout?.toString(), out.stderr?.toString()].filter(Boolean).join("\n").trim();
      throw new FixCommandError(captured ? `bun run fix failed:\n${captured}` : "bun run fix failed");
    }
  };

  const realCommitPreReadyFix = (cwd: string, agentLabel: string) => {
    execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });
    const commitMessage = appendAgentTrailer("chore: apply pre-ready check:fix", agentLabel);
    try {
      execFileSync("git", ["commit", "-F", "-"], {
        cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        input: commitMessage,
      });
    } catch (err) {
      const out = err as NodeJS.ErrnoException & {
        stdout?: Buffer;
        stderr?: Buffer;
      };
      const captured = [out.stdout?.toString(), out.stderr?.toString()].filter(Boolean).join("\n").trim();
      throw new PreReadyFixCommitError(captured ? captured : "git commit failed");
    }

    const porcelain = readPorcelain(cwd);
    if (porcelain !== "") {
      const dirtyBranch = getCurrentBranch(cwd);
      throw new PreReadyFixCommitError(
        `pre-ready fix commit succeeded but worktree is still dirty on branch ${dirtyBranch}:\n${porcelain}\nDo not call gh pr ready. Inspect the branch and commit or discard the unexpected changes.`,
      );
    }

    try {
      pushCurrent({ cwd, firstPush: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PreReadyFixPushError(message);
    }
  };

  const realBunRunReady = (cwd: string, readyTier: ReadyTier) => {
    const tokens = opts.readyCommand !== undefined ? opts.readyCommand.trim().split(/\s+/) : ["bun", "run", "ready"];
    const [head, ...args] = tokens;
    const displayCmd = tokens.join(" ");
    if (head === undefined) {
      throw new ReadyCommandError(`invalid ready command: ${displayCmd}`);
    }
    try {
      execFileSync(head, args, {
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
      throw new ReadyCommandError(captured ? `${displayCmd} failed:\n${captured}` : `${displayCmd} failed`);
    }
  };

  const runFixFn = opts.runFix ?? realRunFix;
  const commitPreReadyFixFn = opts.commitPreReadyFix ?? realCommitPreReadyFix;
  const runReadyFn = opts.runReady ?? realBunRunReady;

  if (tier === "full") {
    runFixFn(opts.cwd);

    const porcelainAfterFix = readPorcelain(opts.cwd);
    if (porcelainAfterFix !== "") {
      commitPreReadyFixFn(opts.cwd, opts.agentLabel ?? "");
    }
  }

  runReadyFn(opts.cwd, tier);

  if (tier === "full") {
    const porcelainAfterReady = readPorcelain(opts.cwd);
    if (porcelainAfterReady !== "") {
      const dirtyBranch = getCurrentBranch(opts.cwd);
      throw new ReadyVerificationDirtyError(
        `verification returned green but worktree is still dirty on branch ${dirtyBranch}:\n${porcelainAfterReady}\nDo not call gh pr ready. Fold autofix into your readyCommand or discard the unexpected changes.`,
      );
    }
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
  runFix?: (cwd: string) => void;
  runReady?: (cwd: string, tier: ReadyTier) => void;
  commitPreReadyFix?: (cwd: string, agentLabel: string) => void;
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
    ...(opts.runFix !== undefined ? { runFix: opts.runFix } : {}),
    ...(opts.runReady !== undefined ? { runReady: opts.runReady } : {}),
    ...(opts.commitPreReadyFix !== undefined ? { commitPreReadyFix: opts.commitPreReadyFix } : {}),
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
