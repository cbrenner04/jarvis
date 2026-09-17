import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import { planReviewPromptProfile } from "../../../shared/prompts/review-plan.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { openStateStore } from "../persistence/state-store.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import {
  initGitWorkspace,
  REVIEW_MD_LINT_FIXTURE_IDS,
  readReviewMdLintFixture,
  writeLintCleanPlanStage,
} from "./workflow-runner.test-support.ts";
import type { ReviewWorkflowStep } from "./workflow-runner.ts";
import { DEFAULT_STAGED_MARKDOWN_LINT_RUNNER, planRecoveryLanding } from "./workflow-runner-resume.test-support.ts";
import { recoverPlanStage } from "./workflow-runner-resume.ts";

describe("recoverPlanStage review-failed admission", () => {
  const PLAN_REVIEW_CONFIG: AgentModelConfig = {
    claude: {
      critic: {
        rungs: [
          { adapterModel: "critic-1", priceKey: "critic-1" },
          { adapterModel: "critic-2", priceKey: "critic-2" },
        ],
      },
    },
    codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
  };

  function planWorktree(prefix: string): string {
    const worktree = initGitWorkspace(prefix);
    execFileSync("git", ["commit", "--allow-empty", "-qm", "base"], { cwd: worktree });
    return worktree;
  }

  function planReviewStep(args: {
    worktreePath: string;
    stage: string;
    durable: string;
    branch: string;
    invoke: (agentId: string, adapterModel: string) => Promise<InvocationResult>;
    idleOutputMs?: number;
  }): ReviewWorkflowStep {
    return {
      behavior: "review",
      stepId: "plan-review",
      project: "demo",
      branch: args.branch,
      cwd: args.worktreePath,
      prompt: "",
      verdictPath: join(args.stage, "verdict-plan.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: PLAN_REVIEW_CONFIG,
      profile: planReviewPromptProfile,
      profileContext: { specPath: args.stage, worktreePath: args.worktreePath },
      landing: {
        kind: "plan-tree",
        stagingDir: ".jarvis-plan-stage",
        durablePath: args.durable,
      },
      ...(args.idleOutputMs !== undefined ? { idleOutputMs: args.idleOutputMs } : {}),
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async () => args.invoke(agentId, adapterModel),
      }),
    };
  }

  function sharedPlanSnapshot(invocationId: string) {
    return {
      invocationId,
      steps: [
        { stepId: "plan", role: "plan", expectedArtifactPath: ".jarvis-plan-stage", agents: ["claude"] },
        { stepId: "plan-review", role: "", behavior: "review" as const },
      ],
    };
  }

  function seedCompletedPlanWriteRun(
    store: ReturnType<typeof openStateStore>,
    args: {
      project: string;
      branch: string;
      worktreePath: string;
      specPath: string;
      stepId: string;
      invocationId: string;
      outcomeKind?: "done" | "no-work" | "progress";
    },
  ): string {
    const runId = store.createRun({
      project: args.project,
      specRef: "HEAD",
      worktreePath: args.worktreePath,
      branch: args.branch,
      specPath: args.specPath,
      stepId: args.stepId,
      workflowSnapshot: sharedPlanSnapshot(args.invocationId),
    });
    const attemptId = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({
      attemptId,
      runStatus: "completed",
      outcomeKind: args.outcomeKind ?? "done",
    });
    return runId;
  }

  function seedFailedPlanReviewRun(
    store: ReturnType<typeof openStateStore>,
    args: {
      project: string;
      branch: string;
      worktreePath: string;
      stepId: string;
      invocationId: string;
      outcomeKind: "idle_output_timeout" | "invocation_failure" | "landing_failed" | "iteration_timeout";
      invocationFailureDetail?: {
        failureKind: "quota" | "error" | "landing";
        bindingAttempts: [];
        message?: string;
      };
    },
  ): string {
    const runId = store.createRun({
      project: args.project,
      specRef: "",
      worktreePath: args.worktreePath,
      branch: args.branch,
      specPath: ".jarvis-plan-stage",
      stepId: args.stepId,
      workflowSnapshot: sharedPlanSnapshot(args.invocationId),
    });
    const attemptId = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({
      attemptId,
      runStatus: "failed",
      outcomeKind: args.outcomeKind,
      ...(args.invocationFailureDetail !== undefined ? { invocationFailureDetail: args.invocationFailureDetail } : {}),
    });
    return runId;
  }

  test("preserves a review-failed staged draft without redrafting", async () => {
    const worktreePath = planWorktree("recover-review-failed-keystone-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-review-failed-recovered");
    const branch = "recover-review-failed-keystone";
    const stepId = "plan";
    const specPath = "spec/2026-review-failed-recovered";
    const invocationId = "recover-review-failed-keystone-inv";
    const subspecBody = readReviewMdLintFixture(REVIEW_MD_LINT_FIXTURE_IDS.planMd012CleanSubspec);
    writeLintCleanPlanStage(stage, "00-first.md");
    writeFileSync(join(stage, "00-first.md"), subspecBody, "utf8");

    await withStateStore(async (store) => {
      const runId = seedCompletedPlanWriteRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId,
      });
      seedFailedPlanReviewRun(store, {
        project: "demo",
        branch,
        worktreePath,
        stepId: "plan-review",
        invocationId,
        outcomeKind: "idle_output_timeout",
      });

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("recovery must not dispatch a review role");
        },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(reviewStep),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("complete");
      expect(readFileSync(join(durable, "00-first.md"), "utf8")).toBe(subspecBody);
      expect(readFileSync(join(durable, "intent.md"), "utf8")).not.toContain("## Blocker");
    });
  });

  test("refuses review-failed recovery for ineligible write, staging, blocker, live-claim, and review-sibling shapes", async () => {
    const worktreePath = planWorktree("recover-review-failed-refusal-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-review-failed-refusal");
    const branch = "recover-review-failed-refusal";
    const stepId = "plan";
    const specPath = "spec/2026-review-failed-refusal";
    const invocationId = "recover-review-failed-refusal-inv";
    writeLintCleanPlanStage(stage, "00-first.md");

    const spyReviewStep = (): ReviewWorkflowStep =>
      planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run on a refused recovery");
        },
      });

    await withStateStore(async (store) => {
      const completedWriteId = seedCompletedPlanWriteRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId,
      });
      seedFailedPlanReviewRun(store, {
        project: "demo",
        branch,
        worktreePath,
        stepId: "plan-review",
        invocationId,
        outcomeKind: "idle_output_timeout",
      });

      const failedWriteId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch,
        specPath,
        stepId,
        workflowSnapshot: sharedPlanSnapshot(`${invocationId}-failed-write`),
      });
      const failedWriteAttempt = store.recordAttemptStart(failedWriteId);
      store.commitCompletionBoundary({
        attemptId: failedWriteAttempt,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
      });

      const failedWriteOutcome = await recoverPlanStage({
        runId: failedWriteId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(spyReviewStep()),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });
      expect(failedWriteOutcome).toMatchObject({ ok: false, code: "unrelated_plan_stage" });

      const inProgressWriteId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch: `${branch}-in-progress`,
        specPath,
        stepId,
        workflowSnapshot: sharedPlanSnapshot(`${invocationId}-in-progress`),
        status: "in-progress",
      });
      const inProgressOutcome = await recoverPlanStage({
        runId: inProgressWriteId,
        project: "demo",
        branch: `${branch}-in-progress`,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(spyReviewStep()),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });
      expect(inProgressOutcome).toMatchObject({ ok: false, code: "unrelated_plan_stage" });

      rmSync(stage, { recursive: true, force: true });
      const missingStageOutcome = await recoverPlanStage({
        runId: completedWriteId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(spyReviewStep()),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });
      expect(missingStageOutcome).toMatchObject({ ok: false, code: "unrelated_plan_stage" });
      writeLintCleanPlanStage(stage, "00-first.md");

      writeFileSync(join(stage, "index.md"), "# Broken\n", "utf8");
      const invalidStageOutcome = await recoverPlanStage({
        runId: completedWriteId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(spyReviewStep()),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });
      expect(invalidStageOutcome).toMatchObject({ ok: false, code: "plan_stage_invalid" });
      writeLintCleanPlanStage(stage, "00-first.md");

      writeFileSync(join(stage, "intent.md"), "---\nname: test\n---\n\n## Blocker\n\noperator stop\n", "utf8");
      const blockerOutcome = await recoverPlanStage({
        runId: completedWriteId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(spyReviewStep()),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });
      expect(blockerOutcome).toMatchObject({ ok: false, code: "operator_blocker" });
      writeFileSync(join(stage, "intent.md"), "---\nname: test\n---\n", "utf8");

      const liveRunId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch,
        specPath: "spec/live",
        stepId: "implement",
        workflowSnapshot: {
          invocationId: "live-inv",
          steps: [{ stepId: "implement", role: "implement", expectedArtifactPath: "proof.txt" }],
        },
        status: "in-progress",
      });
      void liveRunId;
      const liveClaimOutcome = await recoverPlanStage({
        runId: completedWriteId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(spyReviewStep()),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });
      expect(liveClaimOutcome).toMatchObject({ ok: false, code: "unrelated_plan_stage" });

      const inProgressReviewId = store.createRun({
        project: "demo",
        specRef: "",
        worktreePath,
        branch,
        specPath: ".jarvis-plan-stage",
        stepId: "plan-review",
        workflowSnapshot: sharedPlanSnapshot(invocationId),
        status: "in-progress",
      });
      const inProgressReviewAttempt = store.recordAttemptStart(inProgressReviewId);
      void inProgressReviewAttempt;
      const nonTerminalReviewOutcome = await recoverPlanStage({
        runId: completedWriteId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        recoveryLanding: planRecoveryLanding(spyReviewStep()),
        stateStore: store,
        runner: DEFAULT_STAGED_MARKDOWN_LINT_RUNNER,
      });
      expect(nonTerminalReviewOutcome).toMatchObject({ ok: false, code: "unrelated_plan_stage" });
    });
  });
});
