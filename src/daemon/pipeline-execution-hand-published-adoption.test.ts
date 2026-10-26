import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { IMPLEMENT_SPEC_ALREADY_COMPLETE_ERROR } from "../execution/implement-workflow-steps.ts";
import { operatorFailureRecordFromUnknown } from "../shared/operator-failure-record.ts";
import {
  continueHandFinishedImplement,
  ghPrListRunner,
  handFinishedImplementStage,
  setupHandFinishedImplement,
} from "./pipeline-implement-lane-pr-adoption.test-support.ts";

describe("pipeline execution hand-published implement adoption", () => {
  test("already_complete on implement runs adoption before dispatch", async () => {
    const fixture = setupHandFinishedImplement(true);
    try {
      execFileSync("git", ["branch", fixture.laneBranch, fixture.planBranch], { cwd: fixture.repoRoot });
      await continueHandFinishedImplement(
        fixture,
        ghPrListRunner(fixture.repoRoot, [{ number: 42, url: "https://example.test/pr/42", state: "OPEN" }]),
      );
      expect(handFinishedImplementStage(fixture)?.status).toBe("succeeded");
      expect((handFinishedImplementStage(fixture)?.artifact as { prNumber?: number }).prNumber).toBe(42);
    } finally {
      fixture.dispose();
    }
  });

  test("failed hand-published adoption settles implement failed with adoption message", async () => {
    // `adoption.kind === "failed"` flipped to `!==` falls through to resolution.error instead of adoption.message.
    const fixture = setupHandFinishedImplement(true);
    try {
      await continueHandFinishedImplement(
        fixture,
        ghPrListRunner(fixture.repoRoot, [
          { number: 1, url: "https://example.test/pr/1", state: "OPEN" },
          { number: 2, url: "https://example.test/pr/2", state: "OPEN" },
        ]),
      );
      const implement = handFinishedImplementStage(fixture);
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
