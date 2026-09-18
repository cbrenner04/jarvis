// Exercises the real markdownlint-cli2 binary via recoverPlanStage's staged-lint path.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trackedMkdtempSync } from "../../../shared/tracked-temp-dir.test-support.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import {
  REVIEW_MD_LINT_FIXTURE_IDS,
  readReviewMdLintFixture,
  writeLintCleanPlanStage,
} from "./workflow-runner.test-support.ts";
import type { PlanStageRecoveryLanding } from "./workflow-runner-resume.ts";
import { recoverPlanStage } from "./workflow-runner-resume.ts";

function planWorktree(prefix: string): string {
  const worktree = trackedMkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd: worktree });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: worktree });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: worktree });
  execFileSync("git", ["commit", "--allow-empty", "-qm", "base"], { cwd: worktree });
  return worktree;
}

describe("recoverPlanStage (real markdownlint binary)", () => {
  // MD025 (a second top-level heading) is not autofixable, so it survives the `--fix` pass.
  test("refuses a recovered plan stage with a violation the autofix cannot repair", async () => {
    const worktreePath = planWorktree("recover-plan-stage-real-lint-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-real-lint");
    const branch = "recover-plan-stage-real-lint";
    const stepId = "plan";
    const specPath = "spec/2026-real-lint";

    writeLintCleanPlanStage(stage, "00-first.md");
    writeFileSync(
      join(stage, "00-first.md"),
      readReviewMdLintFixture(REVIEW_MD_LINT_FIXTURE_IDS.planMd025ViolationSubspec),
      "utf8",
    );

    const recoveryLanding: PlanStageRecoveryLanding = {
      stepId: "plan-review",
      behavior: "review",
      verdictPath: join(stage, "verdict-plan.md"),
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
    };

    await withStateStore(async (store) => {
      const runId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch,
        specPath,
        stepId,
        workflowSnapshot: {
          invocationId: "recover-plan-stage-real-lint-inv",
          steps: [{ stepId, role: "plan", expectedArtifactPath: ".jarvis-plan-stage", agents: ["claude"] }],
        },
      });
      const attemptId = store.recordAttemptStart(runId);
      store.commitCompletionBoundary({ attemptId, runStatus: "blocked", outcomeKind: "contract_miss" });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding,
        stateStore: store,
      });

      expect(outcome).toMatchObject({
        ok: false,
        code: "plan_stage_invalid",
        message: expect.stringContaining("MD025"),
      });
      expect(existsSync(durable)).toBe(false);
    });
  });
});
