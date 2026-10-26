import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GitHubOperationError } from "../execution/github-operations.ts";
import { IMPLEMENT_SPEC_ALREADY_COMPLETE_ERROR } from "../execution/implement-workflow-steps.ts";
import { operatorFailureRecordFromUnknown } from "../shared/operator-failure-record.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../shared/subprocess.ts";
import { continuePipeline } from "./pipeline-execution.ts";
import { ghPrListRunner, setupHandFinishedImplement } from "./pipeline-implement-lane-pr-adoption.test-support.ts";
import { resolveStageWorkflowSteps } from "./pipeline-stage-resolve.ts";

describe("hand-published implement lane PR adoption", () => {
  test("adopts one open PR and settles implement succeeded with a completed entry run", async () => {
    const fixture = setupHandFinishedImplement(true);
    try {
      execFileSync("git", ["branch", fixture.laneBranch, fixture.planBranch], { cwd: fixture.repoRoot });
      const runner = ghPrListRunner(fixture.repoRoot, [
        { number: 42, url: "https://example.test/pr/42", state: "OPEN" },
      ]);
      await continuePipeline(fixture.pipelineId, {
        store: fixture.store,
        context: fixture.context,
        resolveStage: resolveStageWorkflowSteps,
        subprocessRunner: runner,
        dispatch: async () => ({ ok: false as const, code: "unexpected", message: "should not dispatch" }),
        wait: async () => "failed",
      });
      const implement = fixture.store
        .loadPipeline(fixture.pipelineId)
        ?.stages.find((row) => row.stageId === "implement");
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
      const runner = ghPrListRunner(fixture.repoRoot, [
        { number: 7, url: "https://example.test/pr/7", state: "MERGED" },
      ]);
      await continuePipeline(fixture.pipelineId, {
        store: fixture.store,
        context: fixture.context,
        resolveStage: resolveStageWorkflowSteps,
        subprocessRunner: runner,
        dispatch: async () => ({ ok: false as const, code: "unexpected", message: "should not dispatch" }),
        wait: async () => "failed",
      });
      const implement = fixture.store
        .loadPipeline(fixture.pipelineId)
        ?.stages.find((row) => row.stageId === "implement");
      expect(implement?.status).toBe("succeeded");
      expect((implement?.artifact as { prNumber?: number }).prNumber).toBe(7);
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

      const runner = ghPrListRunner(fixture.repoRoot, []);
      await continuePipeline(fixture.pipelineId, {
        store: fixture.store,
        context: fixture.context,
        resolveStage: resolveStageWorkflowSteps,
        subprocessRunner: runner,
        dispatch: async () => ({ ok: false as const, code: "unexpected", message: "should not dispatch" }),
        wait: async () => "failed",
      });
      const implement = fixture.store
        .loadPipeline(fixture.pipelineId)
        ?.stages.find((row) => row.stageId === "implement");
      expect(implement?.status).toBe("failed");
      const observation = operatorFailureRecordFromUnknown(implement?.failureDetail)?.observation ?? "";
      expect(observation).toContain(fixture.laneBranch);
      expect(observation).toContain("jarvis pipeline resume");
      expect(operatorFailureRecordFromUnknown(implement?.failureDetail)?.retryable).toBe(true);
      expect(
        fixture.store.listRuns().some((run) => run.status === "completed" && run.branch === fixture.laneBranch),
      ).toBe(false);
    } finally {
      fixture.dispose();
    }
  });

  test("refuses ambiguous open pull requests without creating an adoption run", async () => {
    const fixture = setupHandFinishedImplement(true);
    try {
      const runner = ghPrListRunner(fixture.repoRoot, [
        { number: 1, url: "https://example.test/pr/1", state: "OPEN" },
        { number: 2, url: "https://example.test/pr/2", state: "OPEN" },
      ]);
      await continuePipeline(fixture.pipelineId, {
        store: fixture.store,
        context: fixture.context,
        resolveStage: resolveStageWorkflowSteps,
        subprocessRunner: runner,
        dispatch: async () => ({ ok: false as const, code: "unexpected", message: "should not dispatch" }),
        wait: async () => "failed",
      });
      const implement = fixture.store
        .loadPipeline(fixture.pipelineId)
        ?.stages.find((row) => row.stageId === "implement");
      expect(implement?.status).toBe("failed");
      const observation = operatorFailureRecordFromUnknown(implement?.failureDetail)?.observation ?? "";
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
      await continuePipeline(fixture.pipelineId, {
        store: fixture.store,
        context: fixture.context,
        resolveStage: resolveStageWorkflowSteps,
        subprocessRunner: runner,
        dispatch: async () => ({ ok: false as const, code: "unexpected", message: "should not dispatch" }),
        wait: async () => "failed",
      });
      const implement = fixture.store
        .loadPipeline(fixture.pipelineId)
        ?.stages.find((row) => row.stageId === "implement");
      expect(implement?.status).toBe("failed");
      expect(operatorFailureRecordFromUnknown(implement?.failureDetail)?.retryable).toBe(true);
      expect(operatorFailureRecordFromUnknown(implement?.failureDetail)?.observation).toContain("connect refused");
      expect(fixture.store.listRuns().filter((run) => run.branch === fixture.laneBranch)).toHaveLength(0);
    } finally {
      fixture.dispose();
    }
  });

  test("leaves already_complete failure when the tree is complete with no PR and no unpublished commits", async () => {
    const fixture = setupHandFinishedImplement(true);
    try {
      const runner = ghPrListRunner(fixture.repoRoot, []);
      await continuePipeline(fixture.pipelineId, {
        store: fixture.store,
        context: fixture.context,
        resolveStage: resolveStageWorkflowSteps,
        subprocessRunner: runner,
        dispatch: async () => ({ ok: false as const, code: "unexpected", message: "should not dispatch" }),
        wait: async () => "failed",
      });
      const implement = fixture.store
        .loadPipeline(fixture.pipelineId)
        ?.stages.find((row) => row.stageId === "implement");
      expect(implement?.status).toBe("failed");
      expect(operatorFailureRecordFromUnknown(implement?.failureDetail)?.observation).toBe(
        IMPLEMENT_SPEC_ALREADY_COMPLETE_ERROR,
      );
    } finally {
      fixture.dispose();
    }
  });
});
