import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
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
});
