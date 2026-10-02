import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import { runLoop, TestLogSink } from "./write-loop.test-support.ts";

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
}

/** Lane worktree at the managed path, one commit past `main`; returns the pre-iteration tip. */
function initLaneWorktree(jarvisRoot: string, branchName: string): { worktreePath: string; preSha: string } {
  const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
  mkdirSync(worktreePath, { recursive: true });
  git(worktreePath, ["init", "-b", "main"]);
  git(worktreePath, ["config", "user.email", "test@example.com"]);
  git(worktreePath, ["config", "user.name", "Test User"]);
  writeFileSync(join(worktreePath, "spec.md"), "- [ ] work\n");
  writeFileSync(join(worktreePath, ".gitignore"), ".reused\n");
  git(worktreePath, ["add", "-A"]);
  git(worktreePath, ["commit", "-m", "seed"]);
  git(worktreePath, ["checkout", "-b", branchName]);
  writeFileSync(join(worktreePath, "lane.txt"), "lane\n");
  git(worktreePath, ["add", "lane.txt"]);
  git(worktreePath, ["commit", "-m", "lane"]);
  return { worktreePath, preSha: git(worktreePath, ["rev-parse", "HEAD"]) };
}

describe("awaitIteration history-rewrite guard", () => {
  test("settled implement iteration with a rebasing agent restores pre-iteration HEAD and logs the revert", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const branchName = "head-guard-lane";
    const { worktreePath, preSha } = initLaneWorktree(jarvisRoot, branchName);
    const logSink = new TestLogSink();
    let rewrittenSha = "";

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      baseRef: "main",
      publishCompletion: false,
      completionCommitter: createCompletionCommitter(),
      logSink,
      bindings: [
        {
          id: "sim.1",
          metadata: { agent: "sim-agent-1", model: "sim-model-1" },
          invoke: async ({ cwd }) => {
            git(cwd, ["checkout", "main"]);
            writeFileSync(join(cwd, "main-2.txt"), "main-2\n");
            git(cwd, ["add", "main-2.txt"]);
            git(cwd, ["commit", "-m", "main-2"]);
            git(cwd, ["checkout", branchName]);
            git(cwd, ["rebase", "main"]);
            rewrittenSha = git(cwd, ["rev-parse", "HEAD"]);
            writeFileSync(join(cwd, "proof.txt"), "ok\n");
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          },
        },
      ],
    });

    expect(rewrittenSha).not.toBe("");
    expect(rewrittenSha).not.toBe(preSha);
    const reverts = logSink
      .getEventsForRun(result.runId)
      .filter((event) => event.kind === "agent_history_rewrite_reverted");
    expect(reverts).toEqual([{ kind: "agent_history_rewrite_reverted", fromSha: rewrittenSha, toSha: preSha }]);
    expect(git(worktreePath, ["merge-base", preSha, "HEAD"])).toBe(preSha);
    expect(git(worktreePath, ["rev-list", "HEAD"]).split("\n")).not.toContain(rewrittenSha);
    expect(result.kind).toBe("complete");
  });

  test("refused reset --keep settles resumable completion_commit_failed naming both SHAs without publishing", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const branchName = "head-guard-conflict";
    const { worktreePath, preSha } = initLaneWorktree(jarvisRoot, branchName);
    let rewrittenSha = "";
    let publishCalls = 0;

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      baseRef: "main",
      completionCommitter: createCompletionCommitter(),
      completionPublisher: async () => {
        publishCalls += 1;
        return {};
      },
      bindings: [
        {
          id: "sim.1",
          metadata: { agent: "sim-agent-1", model: "sim-model-1" },
          invoke: async ({ cwd }) => {
            git(cwd, ["checkout", "main"]);
            writeFileSync(join(cwd, "main-2.txt"), "main-2\n");
            git(cwd, ["add", "main-2.txt"]);
            git(cwd, ["commit", "-m", "main-2"]);
            git(cwd, ["checkout", branchName]);
            git(cwd, ["rebase", "main"]);
            rewrittenSha = git(cwd, ["rev-parse", "HEAD"]);
            writeFileSync(join(cwd, "main-2.txt"), "conflicting\n");
            writeFileSync(join(cwd, "proof.txt"), "ok\n");
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          },
        },
      ],
    });

    expect(result.kind).toBe("completion_commit_failed");
    expect(result.resumable).toBe(true);
    expect(result.completionCommitError).toContain(preSha);
    expect(result.completionCommitError).toContain(rewrittenSha);
    expect(publishCalls).toBe(0);
    expect(git(worktreePath, ["rev-parse", "HEAD"])).toBe(rewrittenSha);
  });

  test("write.mutation-repair iterations are not guarded", async () => {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const branchName = "head-guard-mutation-repair";
    const { worktreePath } = initLaneWorktree(jarvisRoot, branchName);
    const logSink = new TestLogSink();
    let rewrittenSha = "";

    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      baseRef: "main",
      publishCompletion: false,
      promptId: "write.mutation-repair",
      promptPlaceholders: {
        SURVIVING_MUTATION: "m",
        SOURCE_FILE: "proof.txt",
        SOURCE_LINE: "1",
        DUAL_CONSTRAINT_DETAIL: "",
        MUTATION_COVERAGE_FIX_DETAIL: "",
      },
      completionCommitter: createCompletionCommitter(),
      logSink,
      bindings: [
        {
          id: "sim.1",
          metadata: { agent: "sim-agent-1", model: "sim-model-1" },
          invoke: async ({ cwd }) => {
            git(cwd, ["checkout", "main"]);
            writeFileSync(join(cwd, "main-2.txt"), "main-2\n");
            git(cwd, ["add", "main-2.txt"]);
            git(cwd, ["commit", "-m", "main-2"]);
            git(cwd, ["checkout", branchName]);
            git(cwd, ["rebase", "main"]);
            rewrittenSha = git(cwd, ["rev-parse", "HEAD"]);
            writeFileSync(join(cwd, "proof.txt"), "ok\n");
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          },
        },
      ],
    });

    expect(rewrittenSha).not.toBe("");
    const kinds = logSink.getEventsForRun(result.runId).map((event) => event.kind);
    expect(kinds).not.toContain("agent_history_rewrite_reverted");
    expect(git(worktreePath, ["rev-list", "HEAD"]).split("\n")).toContain(rewrittenSha);
  });

  async function runFailingGuardLoop(branchName: string, agentAction: (cwd: string) => void) {
    const { jarvisRoot, stateDbPath } = createJarvisHome();
    const { worktreePath, preSha } = initLaneWorktree(jarvisRoot, branchName);
    let publishCalls = 0;
    const result = await runLoop({
      jarvisRoot,
      stateDbPath,
      branchName,
      baseRef: "main",
      completionCommitter: createCompletionCommitter(),
      completionPublisher: async () => {
        publishCalls += 1;
        return {};
      },
      bindings: [
        {
          id: "sim.1",
          metadata: { agent: "sim-agent-1", model: "sim-model-1" },
          invoke: async ({ cwd }) => {
            agentAction(cwd);
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          },
        },
      ],
    });
    return { result, publishCalls, worktreePath, preSha };
  }

  test("agent switching branches settles resumable completion_commit_failed naming both refs without resetting", async () => {
    const branchName = "head-guard-switch";
    const run = await runFailingGuardLoop(branchName, (cwd) => {
      git(cwd, ["checkout", "main"]);
      writeFileSync(join(cwd, "proof.txt"), "ok\n");
    });
    const mainSha = git(run.worktreePath, ["rev-parse", "main"]);

    expect(run.result.kind).toBe("completion_commit_failed");
    expect(run.result.resumable).toBe(true);
    for (const part of [`refs/heads/${branchName}`, "refs/heads/main", run.preSha, mainSha]) {
      expect(run.result.completionCommitError).toContain(part);
    }
    expect(run.publishCalls).toBe(0);
    expect(git(run.worktreePath, ["rev-parse", `refs/heads/${branchName}`])).toBe(run.preSha);
  });

  test("unresolvable post-iteration HEAD settles resumable completion_commit_failed instead of throwing", async () => {
    const run = await runFailingGuardLoop("head-guard-orphan", (cwd) => {
      git(cwd, ["checkout", "--orphan", "orphan"]);
    });

    expect(run.result.kind).toBe("completion_commit_failed");
    expect(run.result.resumable).toBe(true);
    expect(run.result.completionCommitError).toContain("unreadable");
    expect(run.result.completionCommitError).toContain(run.preSha);
    expect(run.publishCalls).toBe(0);
  });
});
