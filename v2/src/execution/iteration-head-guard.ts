import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { errorMessage } from "../../../shared/error-message.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { AgentHistoryRewriteRevertedEvent } from "../persistence/log-stream.ts";

type IterationHeadGuardOutcome =
  | { kind: "unchanged" }
  | { kind: "descendant" }
  | { kind: "reverted"; fromSha: string; toSha: string }
  | { kind: "revert_failed"; fromSha: string; toSha: string; message: string };

type GuardInput = {
  cwd: string;
  preSha: string;
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

/**
 * Pre-iteration `HEAD` read from the git dir on disk, or undefined when `cwd` is not a git
 * checkout or the ref is unresolvable (guard skipped). Synchronous and spawn-free so recording adds
 * no async gap between the loop's abort check and the agent's dispatch.
 */
export function readIterationHead(cwd: string): string | undefined {
  const gitDir = resolveGitDir(cwd);
  const head = gitDir === undefined ? undefined : readTrimmed(join(gitDir, "HEAD"));
  if (gitDir === undefined || head === undefined) return undefined;
  const sha = head.startsWith("ref: ") ? resolveRef(gitDir, head.slice(5).trim()) : head;
  return sha !== undefined && OBJECT_ID.test(sha) ? sha : undefined;
}

/**
 * After a settled write-step agent invocation: when `preSha` is no longer an ancestor of `HEAD`
 * (rebase/reset/amend of pre-iteration commits), `git reset --keep` back to it and log
 * `agent_history_rewrite_reverted`. A refused reset leaves the branch where the agent put it.
 */
export async function guardIterationHead(input: GuardInput): Promise<IterationHeadGuardOutcome> {
  const runner = input.runner ?? realAsyncSubprocessRunner;
  const { cwd, preSha } = input;
  const postSha = await git(runner, cwd, ["rev-parse", "HEAD"]);
  if (postSha === preSha) return { kind: "unchanged" };
  const mergeBase = await git(runner, cwd, ["merge-base", preSha, postSha]).catch(() => undefined);
  if (!isHistoryRewrite(preSha, postSha, mergeBase)) return { kind: "descendant" };
  try {
    await git(runner, cwd, ["reset", "--keep", preSha]);
  } catch (error) {
    return {
      kind: "revert_failed",
      fromSha: postSha,
      toSha: preSha,
      message: `Agent rewrote lane history (${preSha} -> ${postSha}); git reset --keep ${preSha} failed: ${errorMessage(error)}`,
    };
  }
  input.log({ kind: "agent_history_rewrite_reverted", fromSha: postSha, toSha: preSha });
  return { kind: "reverted", fromSha: postSha, toSha: preSha };
}
