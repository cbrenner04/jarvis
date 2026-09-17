// Exercises the real markdownlint-cli2 binary via resumePopulatedIntentPublication's staged-lint gate.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWorkflowRunnerResumeDepsWired } from "../testing/workflow-runner-resume-wiring.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import {
  REVIEW_MD_LINT_FIXTURE_IDS,
  readReviewMdLintFixture,
  seedFailedIntentReviewResumeRun,
  TestLogSink,
} from "./workflow-runner.test-support.ts";
import { resumePopulatedIntentPublication } from "./workflow-runner-resume.ts";

ensureWorkflowRunnerResumeDepsWired();

describe("resumePopulatedIntentPublication (real markdownlint binary)", () => {
  test("refuses to publish a staged intent with a real lint violation", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "intent-resume-real-lint-"));
    const stage = join(workspace, ".jarvis-intent-stage");
    mkdirSync(stage, { recursive: true });
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });
    writeFileSync(
      join(stage, "existing.md"),
      readReviewMdLintFixture(REVIEW_MD_LINT_FIXTURE_IDS.intentMd038Violation),
      "utf8",
    );
    let commits = 0;

    await withStateStore(async (store) => {
      const reviewRunId = seedFailedIntentReviewResumeRun(store, workspace, {
        branch: "intent/resume-real-lint",
        invocationId: "intent-resume-real-lint",
      });
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const logSink = new TestLogSink();
      const outcome = await resumePopulatedIntentPublication(run, store, {
        logSink,
        completionCommitter: async () => {
          commits += 1;
          return { commitSha: "commit-1" };
        },
        readyFinalizer: async () => {},
      });

      expect(outcome).toEqual({ ok: false, message: "staged markdown lint failed" });
      // resumable: true only for a real violation (an invocation error settles non-resumable).
      expect(logSink.getEventsForRun(reviewRunId).at(-1)).toMatchObject({ kind: "loop_finished", resumable: true });
      expect(commits).toBe(0);
      expect(store.loadRun(reviewRunId)?.attempts.at(-1)?.outcomeKind).toBe("landing_failed");
      expect(existsSync(join(workspace, "ready-intents", "existing.md"))).toBe(false);
    });
  });
});
