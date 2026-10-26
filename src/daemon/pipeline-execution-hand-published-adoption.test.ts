import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { IMPLEMENT_SPEC_ALREADY_COMPLETE_ERROR } from "../execution/implement-workflow-steps.ts";
import { operatorFailureRecordFromUnknown } from "../shared/operator-failure-record.ts";
import { continuePipeline } from "./pipeline-execution.ts";
import { ghPrListRunner, setupHandFinishedImplement } from "./pipeline-implement-lane-pr-adoption.test-support.ts";
import { resolveStageWorkflowSteps } from "./pipeline-stage-resolve.ts";

describe("pipeline execution hand-published implement adoption", () => {
  test("already_complete on implement runs adoption before dispatch", async () => {
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
      expect((implement?.artifact as { prNumber?: number }).prNumber).toBe(42);
    } finally {
      fixture.dispose();
    }
  });

  test("failed hand-published adoption settles implement failed with adoption message", async () => {
    // `adoption.kind === "failed"` flipped to `!==` falls through to resolution.error instead of adoption.message.
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
      expect(observation).not.toBe(IMPLEMENT_SPEC_ALREADY_COMPLETE_ERROR);
      expect(operatorFailureRecordFromUnknown(implement?.failureDetail)?.retryable).toBe(true);
    } finally {
      fixture.dispose();
    }
  });
});
