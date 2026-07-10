import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyChangedPaths, type ScopedTests } from "../../scripts/ci-test-scope.ts";
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

function readUntrackedPaths(cwd: string): string[] {
  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  return porcelain
    .split("\n")
    .filter((line) => line.startsWith("??"))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

/**
 * Classify test scope for the diff since `baseBranch`'s merge-base with HEAD, including uncommitted
 * working-tree changes and untracked files. Falls back to `"full"` when the merge-base can't be
 * resolved (mirrors CI's `RESOLVABLE=false` fallback).
 */
export function resolveReadyTestScope(cwd: string, baseBranch: string): ScopedTests {
  let mergeBase: string;
  try {
    mergeBase = execFileSync("git", ["merge-base", baseBranch, "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  } catch {
    return "full";
  }

  const diffOutput = execFileSync("git", ["diff", "--name-only", mergeBase], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  const diffPaths = diffOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const changedPaths = Array.from(new Set([...diffPaths, ...readUntrackedPaths(cwd)]));
  return classifyChangedPaths(changedPaths);
}

export type RunReadyAndCommitOpts = {
  cwd: string;
  timeoutMs: number;
  /** Ready pipeline tier; defaults to `full`. */
  tier?: ReadyTier;
  /** Test seam: agent label for the pre-ready fix commit trailer. */
  agentLabel?: string;
  /** Per-project override for `bun run ready`. Tokenized on whitespace; no shell. Receives `JARVIS_READY_TIER`. */
  readyCommand?: string;
  /** Base branch to scope the ready gate's test step to the diff since its merge-base. Omitted runs full, unscoped `bun run test`. */
  baseBranch?: string;
  /** Per-project override for `bun run fix`. Tokenized on whitespace; no shell. */
  fixCommand?: string;
  /** Seam for built-in `bun run fix` on `full` tier. Defaults to execFileSync call. */
  runFix?: (cwd: string) => void;
  /** Seam for just `bun run ready` (or `readyCommand`). Defaults to execFileSync call. */
  runReady?: (cwd: string, tier: ReadyTier) => void;
  /** Seam for pre-ready fix output: git add -A, git commit, idempotency re-check, and pushCurrent together. Called only on `full` when porcelain is non-empty after fix. */
  commitPreReadyFix?: (cwd: string, agentLabel: string) => void;
  /** Seam for post-verification output: git add -A, git commit, idempotency re-check, and pushCurrent together. Called only on `full` when porcelain is non-empty after green verification. */
  commitPostVerification?: (cwd: string, agentLabel: string) => void;
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

export class PostVerificationCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostVerificationCommitError";
  }
}

export class PostVerificationPushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostVerificationPushError";
  }
}

export class ReadyVerificationDirtyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadyVerificationDirtyError";
  }
}

function isExecTimeout(err: unknown): boolean {
  const out = err as NodeJS.ErrnoException & { signal?: NodeJS.Signals };
  return out.code === "ETIMEDOUT" && out.signal === "SIGTERM";
}

function commandTimeoutMessage(command: string, timeoutMs: number, agentLabel: string | undefined): string {
  return `${command} exceeded ${timeoutMs}ms budget (gate: ${agentLabel ?? ""})`;
}

export function postVerificationStillDirtyErrorMessage(branch: string, porcelain: string): string {
  return `post-verification commit succeeded but worktree is still dirty on branch ${branch}:\n${porcelain}\nDo not call gh pr ready. Inspect the branch and commit or discard the unexpected changes.`;
}

function readPorcelain(cwd: string): string {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

const PACKAGE_MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"]);

/** When tokens match `<pm> run [<flags>…] <script>`, return `<script>`; else `null`. */
export function parsePackageManagerRunScript(tokens: string[]): string | null {
  if (tokens.length < 3) {
    return null;
  }
  const [pm, run, ...rest] = tokens;
  if (pm === undefined || run === undefined || !PACKAGE_MANAGERS.has(pm) || run !== "run") {
    return null;
  }
  for (const token of rest) {
    if (!token.startsWith("-")) {
      return token;
    }
  }
  return null;
}

function packageJsonLacksScript(cwd: string, scriptName: string): boolean {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    return true;
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, unknown> };
    return typeof pkg.scripts?.[scriptName] !== "string";
  } catch {
    return true;
  }
}

function resolveAutofixTokens(fixCommand: string | undefined): string[] {
  return fixCommand !== undefined ? fixCommand.trim().split(/\s+/) : ["bun", "run", "fix"];
}

function displayAutofixCommand(fixCommand: string | undefined): string {
  return fixCommand ?? "bun run fix";
}

function shouldSkipAutofixForAbsentScript(cwd: string, tokens: string[]): boolean {
  const scriptName = parsePackageManagerRunScript(tokens);
  return scriptName !== null && packageJsonLacksScript(cwd, scriptName);
}

/** On `full` tier: run fix → commit-if-dirty → strict ready; on `fast`: verification only. */
export function runReadyAndCommit(opts: RunReadyAndCommitOpts): void {
  const tier = opts.tier ?? "full";
  const testScope = opts.baseBranch !== undefined ? resolveReadyTestScope(opts.cwd, opts.baseBranch) : undefined;
  const testScopeEnv = testScope !== undefined ? (testScope === "full" ? "full" : testScope.join(" ")) : undefined;

  const realRunFix = (cwd: string) => {
    const tokens = resolveAutofixTokens(opts.fixCommand);
    const displayCmd = displayAutofixCommand(opts.fixCommand);
    if (shouldSkipAutofixForAbsentScript(cwd, tokens)) {
      return;
    }
    const [head, ...args] = tokens;
    if (head === undefined) {
      throw new FixCommandError(`invalid fix command: ${displayCmd}`);
    }
    try {
      execFileSync(head, args, {
        cwd,
        env: { ...process.env },
        stdio: "pipe",
        timeout: opts.timeoutMs,
      });
    } catch (err) {
      if (isExecTimeout(err)) {
        throw new FixCommandError(commandTimeoutMessage(displayCmd, opts.timeoutMs, opts.agentLabel));
      }
      const out = err as NodeJS.ErrnoException & {
        stdout?: Buffer;
        stderr?: Buffer;
      };
      const captured = [out.stdout?.toString(), out.stderr?.toString()].filter(Boolean).join("\n").trim();
      throw new FixCommandError(captured ? `${displayCmd} failed:\n${captured}` : `${displayCmd} failed`);
    }
  };

  const realCommitPostVerification = (cwd: string, agentLabel: string) => {
    execFileSync("git", ["add", "-A"], { cwd, stdio: "pipe" });
    const commitMessage = appendAgentTrailer("chore: apply post-ready verification output", agentLabel);
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
      throw new PostVerificationCommitError(captured ? captured : "git commit failed");
    }

    const porcelain = readPorcelain(cwd);
    if (porcelain !== "") {
      const dirtyBranch = getCurrentBranch(cwd);
      throw new ReadyVerificationDirtyError(postVerificationStillDirtyErrorMessage(dirtyBranch, porcelain));
    }

    try {
      pushCurrent({ cwd, firstPush: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PostVerificationPushError(message);
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
        env: {
          ...process.env,
          JARVIS_READY_TIER: readyTier,
          ...(testScopeEnv !== undefined ? { JARVIS_READY_TEST_SCOPE: testScopeEnv } : {}),
        },
        stdio: "pipe",
        timeout: opts.timeoutMs,
      });
    } catch (err) {
      if (isExecTimeout(err)) {
        throw new ReadyCommandError(commandTimeoutMessage(displayCmd, opts.timeoutMs, opts.agentLabel));
      }
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
  const commitPostVerificationFn = opts.commitPostVerification ?? realCommitPostVerification;
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
      commitPostVerificationFn(opts.cwd, opts.agentLabel ?? "");
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
  fixCommand?: string;
  baseBranch?: string;
  timeoutMs: number;
  recordedGreenResult?: RecordedGreenResult;
  runFix?: (cwd: string) => void;
  runReady?: (cwd: string, tier: ReadyTier) => void;
  commitPreReadyFix?: (cwd: string, agentLabel: string) => void;
  commitPostVerification?: (cwd: string, agentLabel: string) => void;
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
    ...(opts.fixCommand !== undefined ? { fixCommand: opts.fixCommand } : {}),
    ...(opts.baseBranch !== undefined ? { baseBranch: opts.baseBranch } : {}),
    timeoutMs: opts.timeoutMs,
    ...(opts.runFix !== undefined ? { runFix: opts.runFix } : {}),
    ...(opts.runReady !== undefined ? { runReady: opts.runReady } : {}),
    ...(opts.commitPreReadyFix !== undefined ? { commitPreReadyFix: opts.commitPreReadyFix } : {}),
    ...(opts.commitPostVerification !== undefined ? { commitPostVerification: opts.commitPostVerification } : {}),
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
