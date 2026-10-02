import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { errorMessage } from "../../../shared/error-message.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { AgentHistoryRewriteRevertedEvent } from "../persistence/log-stream.ts";

/** `HEAD` as recorded on disk: its SHA and symbolic ref (undefined when detached). */
export type IterationHead = { sha: string; ref: string | undefined };

type IterationHeadGuardOutcome =
  | { kind: "unchanged" }
  | { kind: "descendant" }
  | { kind: "reverted"; fromSha: string; toSha: string }
  | { kind: "guard_failed"; message: string };

type GuardInput = {
  cwd: string;
  pre: IterationHead;
  log: (event: AgentHistoryRewriteRevertedEvent) => void;
  runner?: AsyncSubprocessRunner;
};

async function git(runner: AsyncSubprocessRunner, cwd: string, args: string[]): Promise<string> {
  return (await runner.runAsync("git", args, cwd)).trim();
}

/** Pure: a move is a rewrite unless `HEAD` is unchanged or the pre-iteration SHA is its merge base. */
export function isHistoryRewrite(preSha: string, postSha: string, mergeBase: string | undefined): boolean {
  return preSha !== postSha && mergeBase !== preSha;
}

const OBJECT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

function readTrimmed(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8").trim() : undefined;
}

/** `.git` directory, or the `gitdir:` target of a linked worktree's `.git` file. */
function resolveGitDir(cwd: string): string | undefined {
  const dotGit = join(cwd, ".git");
  const stat = statSync(dotGit, { throwIfNoEntry: false });
  if (stat === undefined) return undefined;
  if (stat.isDirectory()) return dotGit;
  const target = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1];
  return target === undefined ? undefined : resolve(cwd, target.trim());
}

function resolveRef(gitDir: string, ref: string): string | undefined {
  const commonPointer = readTrimmed(join(gitDir, "commondir"));
  const commonDir = commonPointer === undefined ? gitDir : resolve(gitDir, commonPointer);
  const loose = readTrimmed(join(gitDir, ref)) ?? readTrimmed(join(commonDir, ref));
  if (loose !== undefined) return loose;
  const packed = readTrimmed(join(commonDir, "packed-refs")) ?? "";
  return packed
    .split("\n")
    .map((line) => line.split(" "))
    .find(([, name]) => name === ref)?.[0];
}

function readHeadFromDisk(cwd: string): IterationHead | undefined {
  const gitDir = resolveGitDir(cwd);
  const head = gitDir === undefined ? undefined : readTrimmed(join(gitDir, "HEAD"));
  if (gitDir === undefined || head === undefined) return undefined;
  const ref = head.startsWith("ref: ") ? head.slice(5).trim() : undefined;
  const sha = ref === undefined ? head : resolveRef(gitDir, ref);
  return sha !== undefined && OBJECT_ID.test(sha) ? { sha, ref } : undefined;
}

/**
 * `HEAD` read from the git dir on disk, or undefined when `cwd` is not a git checkout or `HEAD` is
 * unreadable or unresolvable (guard skipped). Synchronous and spawn-free so recording adds no async
 * gap between the loop's abort check and the agent's dispatch.
 */
export function readIterationHead(cwd: string): IterationHead | undefined {
  try {
    return readHeadFromDisk(cwd);
  } catch {
    return undefined;
  }
}

function describeRef(ref: string | undefined): string {
  return ref ?? "detached HEAD";
}

async function checkIterationHead(
  input: GuardInput,
  runner: AsyncSubprocessRunner,
): Promise<IterationHeadGuardOutcome> {
  const { cwd, pre } = input;
  const post = readHeadFromDisk(cwd);
  if (post === undefined) {
    return { kind: "guard_failed", message: `post-iteration HEAD is unreadable (pre-iteration ${pre.sha})` };
  }
  if (post.ref !== pre.ref) {
    return {
      kind: "guard_failed",
      message: `Agent moved HEAD off ${describeRef(pre.ref)} (${pre.sha}) to ${describeRef(post.ref)} (${post.sha}); not reverting`,
    };
  }
  if (post.sha === pre.sha) return { kind: "unchanged" };
  const mergeBase = await git(runner, cwd, ["merge-base", pre.sha, post.sha]).catch(() => undefined);
  if (!isHistoryRewrite(pre.sha, post.sha, mergeBase)) return { kind: "descendant" };
  try {
    await git(runner, cwd, ["reset", "--keep", pre.sha]);
  } catch (error) {
    return {
      kind: "guard_failed",
      message: `Agent rewrote lane history (${pre.sha} -> ${post.sha}); git reset --keep ${pre.sha} failed: ${errorMessage(error)}`,
    };
  }
  input.log({ kind: "agent_history_rewrite_reverted", fromSha: post.sha, toSha: pre.sha });
  return { kind: "reverted", fromSha: post.sha, toSha: pre.sha };
}

/**
 * After a settled write-step agent invocation: when the pre-iteration SHA is no longer an ancestor
 * of `HEAD` (rebase/reset/amend), `git reset --keep` back to it and log
 * `agent_history_rewrite_reverted`. A changed branch, unreadable `HEAD`, refused reset, or any git
 * failure returns `guard_failed` and leaves the branch where the agent put it.
 */
export async function guardIterationHead(input: GuardInput): Promise<IterationHeadGuardOutcome> {
  try {
    return await checkIterationHead(input, input.runner ?? realAsyncSubprocessRunner);
  } catch (error) {
    return {
      kind: "guard_failed",
      message: `Iteration head guard failed (pre-iteration ${input.pre.sha}): ${errorMessage(error)}`,
    };
  }
}
