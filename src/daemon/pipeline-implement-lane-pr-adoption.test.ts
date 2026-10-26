import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { GitHubOperationError } from "../execution/github-operations.ts";
import { IMPLEMENT_SPEC_ALREADY_COMPLETE_ERROR } from "../execution/implement-workflow-steps.ts";
import { openStateStore, type PipelineContext, type StateStore } from "../persistence/state-store.ts";
import { operatorFailureRecordFromUnknown } from "../shared/operator-failure-record.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../shared/subprocess.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import { createJarvisHome } from "../testing/write-fixtures.ts";
import { continuePipeline } from "./pipeline-execution.ts";
import { resolveStageWorkflowSteps } from "./pipeline-stage-resolve.ts";

const PIPELINE_ID = "pipeline-hand-published";

const CHAINED_DEFINITION: PipelineDefinition = {
  name: "hand-published",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

function initGitRepo(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
}

type HandFinishedFixture = {
  repoRoot: string;
  configPath: string;
  context: PipelineContext;
  store: StateStore;
  pipelineId: string;
  planRunId: string;
  planWorktree: string;
  planBranch: string;
  laneBranch: string;
  defaultBranch: string;
};

function ghPrListRunner(
  projectRoot: string,
  rows: Array<{ number: number; url: string; state: "OPEN" | "MERGED" | "CLOSED" }>,
): AsyncSubprocessRunner {
  return {
    runAsync: async (cmd, args, cwd) => {
      if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
        return JSON.stringify(rows.map((row) => ({ ...row, baseRefName: "main", isDraft: false })));
      }
      return realAsyncSubprocessRunner.runAsync(cmd, args, cwd ?? projectRoot);
    },
  };
}

function setupHandFinishedImplement(completeSpec: boolean): HandFinishedFixture {
  const repoRoot = trackedMkdtempSync(join(tmpdir(), "hand-published-lane-"));
  initGitRepo(repoRoot);
  writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repoRoot });
  const defaultBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();

  const readyIntentRel = "spec/ready-intents/feature.md";
  const intentBranch = "intent/feature";
  const intentWorktree = join(repoRoot, ".jarvis-worktrees", intentBranch);
  mkdirSync(intentWorktree, { recursive: true });
  execFileSync("git", ["branch", intentBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", intentWorktree, intentBranch], { cwd: repoRoot });
  mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
  writeFileSync(join(intentWorktree, readyIntentRel), "---\nname: feature\n---\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: intentWorktree });
  execFileSync("git", ["commit", "-qm", "intent"], { cwd: intentWorktree });

  const planBranch = "plan/feature";
  const planSpecDir = "spec/feature";
  const planWorktree = join(repoRoot, ".jarvis-worktrees", planBranch);
  mkdirSync(planWorktree, { recursive: true });
  execFileSync("git", ["branch", planBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", planWorktree, planBranch], { cwd: repoRoot });
  mkdirSync(join(planWorktree, planSpecDir), { recursive: true });
  const box = completeSpec ? "x" : " ";
  writeFileSync(
    join(planWorktree, `${planSpecDir}/index.md`),
    `# Feature\n\n- [${box}] [Work](./00-work.md)\n`,
    "utf8",
  );
  writeFileSync(
    join(planWorktree, `${planSpecDir}/00-work.md`),
    `# Work\n\n## Acceptance criteria\n\n- [${box}] Work\n`,
    "utf8",
  );
  execFileSync("git", ["add", "-A"], { cwd: planWorktree });
  execFileSync("git", ["commit", "-qm", "plan"], { cwd: planWorktree });

  const previousJarvisHome = process.env.JARVIS_HOME;
  const { jarvisRoot } = createJarvisHome();
  process.env.JARVIS_HOME = jarvisRoot;
  const configPath = writeHomeMachineConfig({ projects: { demo: { root: repoRoot, specs: "repo" } } });

  const context: PipelineContext = { cwd: repoRoot, configPath, seed: "unused" };
  const store = openStateStore(":memory:");
  const pipelineId = store.createPipeline({ definition: CHAINED_DEFINITION, context });
  const intentRunId = store.createRun({
    project: "demo",
    specRef: defaultBranch,
    worktreePath: intentWorktree,
    branch: intentBranch,
    specPath: readyIntentRel,
  });
  const planRunId = store.createRun({
    project: "demo",
    specRef: defaultBranch,
    worktreePath: planWorktree,
    branch: planBranch,
    specPath: planSpecDir,
  });
  store.updateStage({
    pipelineId,
    stageId: "intent",
    patch: { status: "succeeded", artifact: { entryRunId: intentRunId, specPath: readyIntentRel } },
  });
  store.updateStage({
    pipelineId,
    stageId: "plan",
    patch: {
      status: "succeeded",
      artifact: { entryRunId: planRunId, specPath: planSpecDir },
      workflowInvocationId: planRunId,
    },
  });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    patch: { status: "pending" },
  });

  return {
    repoRoot,
    configPath,
    context,
    store,
    pipelineId,
    planRunId,
    planWorktree,
    planBranch,
    laneBranch: "feature",
    defaultBranch,
    dispose: () => {
      store.close();
      process.env.JARVIS_HOME = previousJarvisHome;
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(join(jarvisRoot, ".."), { recursive: true, force: true });
    },
  } as HandFinishedFixture & { dispose: () => void };
}

describe("hand-published implement lane PR adoption", () => {
  test("adopts one open PR and settles implement succeeded with a completed entry run", async () => {
    const fixture = setupHandFinishedImplement(true) as HandFinishedFixture & { dispose: () => void };
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
    const fixture = setupHandFinishedImplement(true) as HandFinishedFixture & { dispose: () => void };
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
    const fixture = setupHandFinishedImplement(true) as HandFinishedFixture & { dispose: () => void };
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
    const fixture = setupHandFinishedImplement(true) as HandFinishedFixture & { dispose: () => void };
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
    const fixture = setupHandFinishedImplement(true) as HandFinishedFixture & { dispose: () => void };
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
    const fixture = setupHandFinishedImplement(true) as HandFinishedFixture & { dispose: () => void };
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
