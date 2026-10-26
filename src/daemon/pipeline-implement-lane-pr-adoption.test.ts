import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GitHubOperationError } from "../execution/github-operations.ts";
import { IMPLEMENT_SPEC_ALREADY_COMPLETE_ERROR } from "../execution/implement-workflow-steps.ts";
import { operatorFailureRecordFromUnknown } from "../shared/operator-failure-record.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../shared/subprocess.ts";
import {
  continueHandFinishedImplement,
  ghPrListRunner,
  handFinishedImplementStage,
  setupHandFinishedImplement,
} from "./pipeline-implement-lane-pr-adoption.test-support.ts";

describe("hand-published implement lane PR adoption", () => {
  test("adopts one open PR and settles implement succeeded with a completed entry run", async () => {
    const fixture = setupHandFinishedImplement(true);
    try {
      execFileSync("git", ["branch", fixture.laneBranch, fixture.planBranch], { cwd: fixture.repoRoot });
      await continueHandFinishedImplement(
        fixture,
        ghPrListRunner(fixture.repoRoot, [{ number: 42, url: "https://example.test/pr/42", state: "OPEN" }]),
      );
      const implement = handFinishedImplementStage(fixture);
      expect(implement?.status).toBe("succeeded");
      const artifact = implement?.artifact as { entryRunId?: string; prNumber?: number; prUrl?: string };
      expect(artifact.prNumber).toBe(42);
      expect(artifact.prUrl).toBe("https://example.test/pr/42");
      const entryRun = artifact.entryRunId === undefined ? null : fixture.store.loadRun(artifact.entryRunId);
      expect(entryRun?.status).toBe("completed");
      expect(entryRun?.branch).toBe(fixture.laneBranch);
      expect((artifact as { forkTipSha?: string }).forkTipSha).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      fixture.dispose();
    }
  });

  test("adopts one merged PR when no open PR exists", async () => {
    const fixture = setupHandFinishedImplement(true);
    try {
      await continueHandFinishedImplement(
        fixture,
        ghPrListRunner(fixture.repoRoot, [{ number: 7, url: "https://example.test/pr/7", state: "MERGED" }]),
      );
      expect((handFinishedImplementStage(fixture)?.artifact as { prNumber?: number }).prNumber).toBe(7);
    } finally {
      fixture.dispose();
    }
  });

  test("refuses unpublished lane commits with retryable failure naming resume", async () => {
    const fixture = setupHandFinishedImplement(true);
    try {
      execFileSync("git", ["branch", fixture.laneBranch, fixture.planBranch], { cwd: fixture.repoRoot });
      const laneWorktree = join(fixture.repoRoot, ".jarvis-worktrees", fixture.laneBranch);
      mkdirSync(laneWorktree, { recursive: true });
      execFileSync("git", ["worktree", "add", laneWorktree, fixture.laneBranch], { cwd: fixture.repoRoot });
      writeFileSync(join(laneWorktree, "hand-finished.txt"), "done\n", "utf8");
      execFileSync("git", ["add", "hand-finished.txt"], { cwd: laneWorktree });
      execFileSync("git", ["commit", "-qm", "hand finish"], { cwd: laneWorktree });

      await continueHandFinishedImplement(fixture, ghPrListRunner(fixture.repoRoot, []));
      const implement = handFinishedImplementStage(fixture);
      expect(implement?.status).toBe("failed");
      const commitCount = Number(
        execFileSync("git", ["rev-list", "--count", `${fixture.defaultBranch}..${fixture.laneBranch}`], {
          cwd: fixture.repoRoot,
          encoding: "utf8",
        }).trim(),
      );
      const observation = operatorFailureRecordFromUnknown(implement?.failureDetail)?.observation ?? "";
      expect(observation).toContain(fixture.laneBranch);
      expect(observation).toContain(`${commitCount} commit(s)`);
      expect(observation).toContain("jarvis pipeline resume");
      expect(operatorFailureRecordFromUnknown(implement?.failureDetail)?.retryable).toBe(true);
      expect(
        fixture.store.listRuns().some((run) => run.status === "completed" && run.branch === fixture.laneBranch),
      ).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  test("refuses ambiguous merged pull requests without creating an adoption run", async () => {
    const fixture = setupHandFinishedImplement(true);
    try {
      await continueHandFinishedImplement(
        fixture,
        ghPrListRunner(fixture.repoRoot, [
          { number: 3, url: "https://example.test/pr/3", state: "MERGED" },
          { number: 4, url: "https://example.test/pr/4", state: "MERGED" },
        ]),
      );
      const implement = handFinishedImplementStage(fixture);
      expect(implement?.status).toBe("failed");
      const observation = operatorFailureRecordFromUnknown(implement?.failureDetail)?.observation ?? "";
      expect(observation).toContain("#3");
      expect(observation).toContain("#4");
      expect(operatorFailureRecordFromUnknown(implement?.failureDetail)?.retryable).toBe(true);
      expect(fixture.store.listRuns().filter((run) => run.branch === fixture.laneBranch)).toHaveLength(0);
    } finally {
      fixture.dispose();
    }
  });

  test("refuses ambiguous open pull requests without creating an adoption run", async () => {
    const fixture = setupHandFinishedImplement(true);
    try {
      await continueHandFinishedImplement(
        fixture,
        ghPrListRunner(fixture.repoRoot, [
          { number: 1, url: "https://example.test/pr/1", state: "OPEN" },
          { number: 2, url: "https://example.test/pr/2", state: "OPEN" },
        ]),
      );
      const observation =
        operatorFailureRecordFromUnknown(handFinishedImplementStage(fixture)?.failureDetail)?.observation ?? "";
      expect(observation).toContain("#1");
      expect(observation).toContain("#2");
      expect(fixture.store.listRuns().filter((run) => run.branch === fixture.laneBranch)).toHaveLength(0);
    } finally {
      fixture.dispose();
    }
  });

  test("refuses when pull request lookup fails", async () => {
    const fixture = setupHandFinishedImplement(true);
    try {
      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args, cwd) => {
          if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
            throw new GitHubOperationError("pr-list", "network", "connect refused", "", "connect refused", undefined);
          }
          return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? fixture.repoRoot);
        },
      };
      await continueHandFinishedImplement(fixture, runner);
      const failure = operatorFailureRecordFromUnknown(handFinishedImplementStage(fixture)?.failureDetail);
      expect(failure?.retryable).toBe(true);
      expect(failure?.observation).toContain("connect refused");
      expect(fixture.store.listRuns().filter((run) => run.branch === fixture.laneBranch)).toHaveLength(0);
    } finally {
      fixture.dispose();
    }
  });

  test("refuses when lane branch commit count fails with retryable failure", async () => {
    const fixture = setupHandFinishedImplement(true);
    try {
      execFileSync("git", ["branch", fixture.laneBranch, fixture.planBranch], { cwd: fixture.repoRoot });
      const runner: AsyncSubprocessRunner = {
        runAsync: async (cmd, args, cwd) => {
          if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
            return "[]";
          }
          if (cmd === "git" && args[0] === "rev-list" && args[1] === "--count") {
            throw new Error("broken ref");
          }
          return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? fixture.repoRoot);
        },
      };
      await continueHandFinishedImplement(fixture, runner);
      const failure = operatorFailureRecordFromUnknown(handFinishedImplementStage(fixture)?.failureDetail);
      expect(failure?.retryable).toBe(true);
      expect(failure?.observation).toContain("broken ref");
      expect(fixture.store.listRuns().filter((run) => run.branch === fixture.laneBranch)).toHaveLength(0);
    } finally {
      fixture.dispose();
    }
  });

  test("leaves already_complete failure when the tree is complete with no PR and no unpublished commits", async () => {
    const fixture = setupHandFinishedImplement(true);
    try {
      await continueHandFinishedImplement(fixture, ghPrListRunner(fixture.repoRoot, []));
      expect(operatorFailureRecordFromUnknown(handFinishedImplementStage(fixture)?.failureDetail)?.observation).toBe(
        IMPLEMENT_SPEC_ALREADY_COMPLETE_ERROR,
      );
    } finally {
      fixture.dispose();
    }
  });
});
