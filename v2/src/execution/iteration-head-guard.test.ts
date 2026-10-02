import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import type { AgentHistoryRewriteRevertedEvent } from "../persistence/log-stream.ts";
import { guardIterationHead, isHistoryRewrite, readIterationHead } from "./iteration-head-guard.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return result.stdout.trim();
}

function commit(cwd: string, file: string, content = `${file}\n`): string {
  writeFileSync(join(cwd, file), content);
  git(cwd, ["add", file]);
  git(cwd, ["commit", "-m", file]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

/** Lane repo with `lane` checked out one commit past `main`; returns the pre-iteration lane tip. */
function laneRepo(): { cwd: string; preSha: string } {
  const cwd = trackedMkdtempSync(join(tmpdir(), "iteration-head-guard-"));
  roots.push(cwd);
  git(cwd, ["init", "-b", "main"]);
  commit(cwd, "base.txt");
  git(cwd, ["checkout", "-b", "lane"]);
  const preSha = commit(cwd, "lane.txt");
  return { cwd, preSha };
}

/** Agent stand-in: advance `main`, then rebase the lane onto it. */
function rebaseOntoMovedBase(cwd: string): void {
  git(cwd, ["checkout", "main"]);
  commit(cwd, "main-2.txt");
  git(cwd, ["checkout", "lane"]);
  git(cwd, ["rebase", "main"]);
}

async function guard(cwd: string, preSha: string) {
  const events: AgentHistoryRewriteRevertedEvent[] = [];
  const outcome = await guardIterationHead({ cwd, preSha, log: (event) => events.push(event) });
  return { outcome, events };
}

describe("isHistoryRewrite", () => {
  test("non-ancestor move is a rewrite", () => {
    expect(isHistoryRewrite("pre", "post", "base")).toBe(true);
    expect(isHistoryRewrite("pre", "post", undefined)).toBe(true);
  });

  test("unchanged or descendant HEAD is not a rewrite", () => {
    expect(isHistoryRewrite("pre", "pre", "pre")).toBe(false);
    expect(isHistoryRewrite("pre", "post", "pre")).toBe(false);
  });
});

describe("readIterationHead", () => {
  test("reads a loose branch ref and skips a non-git directory", () => {
    const { cwd, preSha } = laneRepo();
    expect(readIterationHead(cwd)).toBe(preSha);
    const plain = trackedMkdtempSync(join(tmpdir(), "iteration-head-plain-"));
    roots.push(plain);
    expect(readIterationHead(plain)).toBeUndefined();
  });

  test("reads packed refs, detached HEAD, and a linked worktree's HEAD", () => {
    const { cwd, preSha } = laneRepo();
    git(cwd, ["pack-refs", "--all"]);
    expect(readIterationHead(cwd)).toBe(preSha);
    const linked = join(cwd, "..", `${basename(cwd)}-linked`);
    roots.push(linked);
    git(cwd, ["worktree", "add", "-b", "linked", linked, "main"]);
    expect(readIterationHead(linked)).toBe(git(cwd, ["rev-parse", "main"]));
    const linkedSha = commit(linked, "linked.txt");
    expect(readIterationHead(linked)).toBe(linkedSha);
    git(cwd, ["checkout", "--detach", "main"]);
    expect(readIterationHead(cwd)).toBe(git(cwd, ["rev-parse", "main"]));
  });
});

describe("guardIterationHead", () => {
  test("rebase onto a moved base restores the pre-iteration SHA and keeps a non-conflicting edit", async () => {
    const { cwd, preSha } = laneRepo();
    rebaseOntoMovedBase(cwd);
    const rewritten = git(cwd, ["rev-parse", "HEAD"]);
    writeFileSync(join(cwd, "lane.txt"), "uncommitted\n");
    expect(rewritten).not.toBe(preSha);

    const { outcome, events } = await guard(cwd, preSha);

    expect(outcome).toEqual({ kind: "reverted", fromSha: rewritten, toSha: preSha });
    expect(events).toEqual([{ kind: "agent_history_rewrite_reverted", fromSha: rewritten, toSha: preSha }]);
    expect(git(cwd, ["rev-parse", "HEAD"])).toBe(preSha);
    expect(git(cwd, ["rev-parse", "refs/heads/lane"])).toBe(preSha);
    expect(readFileSync(join(cwd, "lane.txt"), "utf8")).toBe("uncommitted\n");
  });

  test("descendant HEAD (agent commit) performs no reset and emits no rewrite event", async () => {
    const { cwd, preSha } = laneRepo();
    const agentCommit = commit(cwd, "agent.txt");

    const { outcome, events } = await guard(cwd, preSha);

    expect(outcome).toEqual({ kind: "descendant" });
    expect(events).toEqual([]);
    expect(git(cwd, ["rev-parse", "HEAD"])).toBe(agentCommit);
  });

  test("unchanged HEAD performs no reset and emits no rewrite event", async () => {
    const { cwd, preSha } = laneRepo();
    writeFileSync(join(cwd, "lane.txt"), "dirty\n");

    const { outcome, events } = await guard(cwd, preSha);

    expect(outcome).toEqual({ kind: "unchanged" });
    expect(events).toEqual([]);
    expect(git(cwd, ["rev-parse", "HEAD"])).toBe(preSha);
    expect(readFileSync(join(cwd, "lane.txt"), "utf8")).toBe("dirty\n");
  });

  test("reset --keep conflict yields a failure naming both SHAs with the branch ref unchanged", async () => {
    const { cwd, preSha } = laneRepo();
    rebaseOntoMovedBase(cwd);
    const rewritten = git(cwd, ["rev-parse", "HEAD"]);
    writeFileSync(join(cwd, "main-2.txt"), "conflicting local edit\n");

    const { outcome, events } = await guard(cwd, preSha);

    expect(outcome.kind).toBe("revert_failed");
    if (outcome.kind !== "revert_failed") throw new Error("expected revert_failed");
    expect(outcome.fromSha).toBe(rewritten);
    expect(outcome.toSha).toBe(preSha);
    expect(outcome.message).toContain(rewritten);
    expect(outcome.message).toContain(preSha);
    expect(events).toEqual([]);
    expect(git(cwd, ["rev-parse", "refs/heads/lane"])).toBe(rewritten);
    expect(readFileSync(join(cwd, "main-2.txt"), "utf8")).toBe("conflicting local edit\n");
  });
});
