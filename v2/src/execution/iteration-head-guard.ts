import { existsSync } from "node:fs";
import { join } from "node:path";
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

/** Pre-iteration `HEAD`, or undefined when `cwd` is not a git checkout (guard skipped). */
export async function readIterationHead(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string | undefined> {
  if (!existsSync(join(cwd, ".git"))) return undefined;
  return git(runner, cwd, ["rev-parse", "HEAD"]).catch(() => undefined);
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
