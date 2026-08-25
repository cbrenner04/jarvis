import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  InvocationBinding,
  InvocationCompletedRecord,
  InvocationResult,
} from "../../../shared/invocation/execute.ts";
import { resolveHarnessRoot } from "../../../shared/markdownlint-repair.ts";
import { implementReviewPromptProfile } from "../../../shared/prompts/review-implement.ts";
import { intentReviewPromptProfile } from "../../../shared/prompts/review-intent.ts";
import { planReviewPromptProfile } from "../../../shared/prompts/review-plan.ts";
import { exitCodeForWriteResult } from "../cli/run-completion.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import {
  createRunControlHandlers,
  resetWriteLoopBindingSourceDepsForTests,
  setWriteLoopBindingSourceDepsForTests,
} from "../daemon/daemon.ts";
import { stageArtifactKey } from "../daemon/pipeline-stage-dispatch.ts";
import { resolveStageWorkflowSteps } from "../daemon/pipeline-stage-resolve.ts";
import { composeRunOperatorError, findTerminalLogRecord } from "../daemon/run-operator-error.ts";
import {
  type LogEvent,
  type LogSink,
  openLogReader,
  openLogSink,
  type PersistedRecord,
} from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import {
  createFakeWithExternalWorktree,
  createJarvisHome,
  trackedTempRoots,
  withStateStore,
} from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import { createCompletionPublisher } from "./completion-publisher.ts";
import type { ExternalWorktree, WithExternalWorktreeResult } from "./external-worktree.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { configuredIntentDurableDir, intentHandoffSpecPath } from "./intent-output.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";
import type { PipelineDefinition } from "./pipeline-definition.ts";
import { landPublication, type PublicationLanding } from "./publication-landing.ts";
import { buildPlanWorkflowSteps, validateReadyIntent } from "./publication-workflow-steps.ts";
import { baseRefProbeFailsSeam, gateFailureOutput, initGateScopeWorktree } from "./ready-finalize.test.ts";
import {
  formatReadyGateOutOfScopeDetail,
  ReadyFlipError,
  ReadyGateError,
  SurvivingMutationError,
} from "./ready-finalize.ts";
import { nonEmptyDiscoveryReason } from "./runtime-smoke-verifier.ts";
import type { WorkBoundaryRecordedRecord } from "./work-boundary-telemetry.ts";
import type { LoadedWorkflowStep, WorkflowSourceStep } from "./workflow-loader.ts";
import {
  config,
  createBindingFactory,
  createDebateBindingFactory,
  createDebateStep,
  createImplementBodySummaryStep,
  createIntentWorktreeHarness,
  createLazyIntentWorktreeHarness,
  createReviewDebateActuatorFailureBindingFactory,
  createShrinkTestStep,
  createStep,
  createStepInput,
  DEBATE_AGENT_MODEL_CONFIG,
  DEFAULT_AGENT_MODEL_CONFIG,
  debateVerdictPath,
  doneBindingFactory,
  errorBindingFactory,
  externalWorktreeBinding,
  hasHarnessMarkdownlintForReview,
  IMPLEMENT_BODY_SPEC_PATH,
  initGitWorkspace,
  installWorkflowRunnerResumeProfile,
  LINT_CLEAN_INTENT_EXAMPLE_MD,
  loadTelemetryRows,
  loadWorkBoundaryRows,
  MISSING_CODEX_IMPLEMENT_CONFIG,
  NO_STEP_ROLES_CONFIG,
  okTokenBindingFactory,
  REVIEW_MD_LINT_FIXTURES,
  REVIEW_MD_LINT_HARNESS_ROOT,
  reviewedIntentStep,
  roots,
  seedCompletedWriteRun,
  seedFailedIntentReviewResumeRun,
  seedLandedIntentFiles,
  skipReviewWithoutHarnessMarkdownlint,
  stageReviewedIntent,
  TestLogSink,
  TWO_AGENTS,
  VALID_TWO_AGENT_CONFIG,
  writeLintCleanIntentStageFile,
  writeLintCleanPlanStage,
} from "./workflow-runner.test-support.ts";
import {
  executeWorkflow,
  isPostCommitReviewRetryableFailureKind,
  LinkedIndexReadError,
  type ReviewDebateWorkflowStep,
  type ReviewWorkflowStep,
  recoverPlanStage,
  resolveIntentFinalizationResumeContext,
  resolveReviewMutationResumeContext,
  resolveWorkflowPreset,
  resumePopulatedIntentPublication,
  resumeReviewMutationFinalization,
  type WorkflowStepInput,
  type WriteWorkflowStep,
} from "./workflow-runner.ts";
import { findFirstMarkdownOnlyFenceViolation } from "./write-loop.ts";

describe("executeWorkflow load-time role validation", () => {
  test("rejects role-validation failures as aggregated per-agent misses before durable state change", async () => {
    const cases: Array<{
      name: string;
      branchName: string;
      stepRoleAgentBindings: () => WriteWorkflowStep[];
      expectedAggregatedError: { contains: string[]; notContains?: string[] };
    }> = [
      {
        name: "single missing role",
        branchName: "workflow-run",
        stepRoleAgentBindings: () => [
          createStep({
            stepId: "step-1",
            role: "unknown-role",
            agents: TWO_AGENTS,
            agentModelConfig: NO_STEP_ROLES_CONFIG,
          }),
        ],
        expectedAggregatedError: { contains: ["(step-1, unknown-role, claude)", "(step-1, unknown-role, codex)"] },
      },
      {
        name: "multiple missing step-role-agent bindings",
        branchName: "aggregate-misses",
        stepRoleAgentBindings: () => [
          createStep({
            stepId: "step-1",
            role: "implement",
            branchName: "aggregate-misses",
            agents: TWO_AGENTS,
            agentModelConfig: MISSING_CODEX_IMPLEMENT_CONFIG,
          }),
          createStep({
            stepId: "step-2",
            role: "unknown-role",
            branchName: "aggregate-misses",
            agents: TWO_AGENTS,
            agentModelConfig: NO_STEP_ROLES_CONFIG,
          }),
        ],
        expectedAggregatedError: {
          contains: ["(step-1, implement, codex)", "(step-2, unknown-role, claude)", "(step-2, unknown-role, codex)"],
        },
      },
      {
        name: "earlier agent has the role and a later fallback agent does not",
        branchName: "workflow-run",
        stepRoleAgentBindings: () => [
          createStep({
            stepId: "step-1",
            role: "implement",
            agents: TWO_AGENTS,
            agentModelConfig: MISSING_CODEX_IMPLEMENT_CONFIG,
          }),
        ],
        expectedAggregatedError: {
          contains: ["(step-1, implement, codex)"],
          notContains: ["(step-1, implement, claude)"],
        },
      },
    ];

    for (const testCase of cases) {
      await withStateStore(async (store) => {
        try {
          await executeWorkflow({ steps: testCase.stepRoleAgentBindings(), stateStore: store });
          expect.unreachable("Should have thrown");
        } catch (e) {
          const message = String(e);
          for (const expected of testCase.expectedAggregatedError.contains) expect(message).toContain(expected);
          for (const expected of testCase.expectedAggregatedError.notContains ?? [])
            expect(message).not.toContain(expected);
        }

        // Load failure leaves no durable trace for the step under test.
        const run = store.findRunByProjectBranch({ project: "demo", branch: testCase.branchName, stepId: "step-1" });
        expect(run).toBeNull();
      });
    }
  });

  test("treats inherited object properties as missing workflow role bindings", async () => {
    const step = createStep({
      stepId: "step-1",
      role: "toString",
      agents: TWO_AGENTS,
      agentModelConfig: NO_STEP_ROLES_CONFIG,
    });

    try {
      await executeWorkflow({ steps: [step] });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const message = String(e);
      expect(message).toContain("(step-1, toString, claude)");
      expect(message).toContain("(step-1, toString, codex)");
    }
  });

  test("revalidates the loaded step array on resume against resume-time config, including already-completed steps", async () => {
    const { stateDbPath } = createJarvisHome();
    const step1First = createStep({
      stepId: "step-1",
      role: "implement",
      branchName: "resume-revalidate",
      agents: TWO_AGENTS,
      agentModelConfig: VALID_TWO_AGENT_CONFIG,
    });
    const step2First = createStep({
      stepId: "step-2",
      role: "implement",
      branchName: "resume-revalidate",
      agents: TWO_AGENTS,
      agentModelConfig: VALID_TWO_AGENT_CONFIG,
      createBinding: okTokenBindingFactory("progress"),
      maxIterations: 1,
    });

    let store = openStateStore(stateDbPath);

    try {
      const firstResult = await executeWorkflow({
        steps: [step1First, step2First],
        stateStore: store,
      });
      expect(firstResult.kind).toBe("budget-exhausted");

      store.close();
      store = openStateStore(stateDbPath);

      const step1Second = createStep({
        stepId: "step-1",
        role: "implement",
        branchName: "resume-revalidate",
        agents: TWO_AGENTS,
        agentModelConfig: MISSING_CODEX_IMPLEMENT_CONFIG,
      });
      const step2Second = createStep({
        stepId: "step-2",
        role: "implement",
        branchName: "resume-revalidate",
        agents: TWO_AGENTS,
        agentModelConfig: MISSING_CODEX_IMPLEMENT_CONFIG,
      });

      try {
        await executeWorkflow({ steps: [step1Second, step2Second], stateStore: store });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const message = String(e);
        expect(message).toContain("(step-1, implement, codex)");
        expect(message).toContain("(step-2, implement, codex)");
      }

      // Already-completed step-1's attempt history is untouched by the rejected resume
      const run1 = store.findRunByProjectBranch({ project: "demo", branch: "resume-revalidate", stepId: "step-1" });
      expect(run1?.status).toBe("completed");
      expect(run1?.attempts).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});

describe("executeWorkflow telemetry", () => {
  test("appends work_boundary_recorded when workflow publication produces a commit", async () => {
    const telemetryPath = join(mkdtempSync(join(tmpdir(), "workflow-boundary-telemetry-")), "telemetry.jsonl");
    const writeStep = createStep({
      stepId: "step-1",
      role: "implement",
      branchName: "boundary-workflow",
      createBinding: doneBindingFactory,
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [writeStep],
        stateStore: store,
        telemetry: { operatorSessionId: "session-1", workflow: "demo-workflow", sinkPath: telemetryPath },
        completionCommitter: async () => ({ commitSha: "wf-commit", filesChanged: 4 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result).toMatchObject({ kind: "complete", commitSha: "wf-commit" });

      // step-1 is implement, which triggers a hidden shrink pass (see workflow-runner.ts
      // runShrinkAfterImplementComplete). The shrink run is the actual publishing boundary,
      // so the telemetry row must carry the shrink run's attempt, not the implement run's.
      const implementRun = store.findRunByProjectBranch({
        project: "demo",
        branch: "boundary-workflow",
        stepId: "step-1",
      });
      const shrinkRun = store.findRunByProjectBranch({
        project: "demo",
        branch: "boundary-workflow",
        stepId: "step-1~shrink",
      });
      const implementAttemptId = implementRun?.attempts.at(-1)?.id;
      const shrinkAttemptId = shrinkRun?.attempts.at(-1)?.id;
      expect(shrinkAttemptId).toBeDefined();
      expect(implementAttemptId).toBeDefined();
      expect(implementAttemptId).not.toBe(shrinkAttemptId);

      const rows = loadWorkBoundaryRows(telemetryPath);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        schema_version: 1,
        record_kind: "work_boundary_recorded",
        run_id: shrinkRun?.id,
        attempt_id: shrinkAttemptId,
        outcome_kind: "done",
        run_status: "completed",
        commit_sha: "wf-commit",
        files_changed: 4,
      });
      expect(rows[0]).not.toHaveProperty("invocation_id");
    });
  });

  test("write and review-debate steps in the same call share operator_session_id/workflow and one shared sink", async () => {
    const telemetryPath = join(mkdtempSync(join(tmpdir(), "workflow-telemetry-")), "telemetry.jsonl");

    const writeStep = createStep({
      stepId: "step-1",
      role: "implement",
      branchName: "telemetry-workflow",
      createBinding: createBindingFactory(async ({ cwd }) => {
        writeFileSync(`${cwd}/proof.txt`, "ok\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" } as const;
      }),
    });

    const debateStep = createDebateStep({
      stepId: "step-2",
      verdictPath: debateVerdictPath(),
      branch: "telemetry-workflow",
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => {
        return { kind: "ok", stdout: adapterModel === "ADJ" ? "" : "ok", stderr: "" } as const;
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [writeStep, debateStep],
        stateStore: store,
        telemetry: { operatorSessionId: "session-1", workflow: "demo-workflow", sinkPath: telemetryPath },
      });

      expect(result.kind).toBe("complete");
      const rows = loadTelemetryRows(telemetryPath);

      const writeRows = rows.filter((row) => row.step_id === "step-1");
      const debateRows = rows.filter((row) => row.step_id === "step-2");
      expect(writeRows).toHaveLength(1);
      expect(debateRows).toHaveLength(3);

      for (const row of rows) {
        expect(row.operator_session_id).toBe("session-1");
        expect(row.workflow).toBe("demo-workflow");
        expect(row.schema_version).toBe(1);
        expect(row.record_kind).toBe("invocation_completed");
      }

      expect(writeRows[0]?.role).toBe("implement");
      expect(new Set(debateRows.map((row) => row.role))).toEqual(new Set(["adversary", "advocate", "adjudicator"]));
      expect(new Set(debateRows.map((row) => row.run_id)).size).toBe(1);
      expect(new Set(debateRows.map((row) => row.attempt_id)).size).toBe(1);

      // Full per-row field-set parity: both behaviors populate the same required context fields.
      const writeRow = writeRows[0];
      const debateRow = debateRows[0];
      expect(Object.keys(writeRow ?? {}).sort()).toEqual(Object.keys(debateRow ?? {}).sort());
      expect(writeRow?.project).toBe("demo");
      expect(writeRow?.branch).toBe("telemetry-workflow");
      expect(writeRow?.spec_ref).toBe("HEAD");
      expect(typeof writeRow?.worktree_path).toBe("string");
      expect(writeRow?.worktree_path).toContain("telemetry-workflow");
      expect(debateRow?.project).toBe("demo");
      expect(debateRow?.branch).toBe("telemetry-workflow");
      expect(debateRow?.spec_ref).toBe("");
      expect(debateRow?.worktree_path).toBe("/fake");
    });
  });

  test("review-debate rows share one run_id and attempt_id across multiple cycles and roles", async () => {
    const telemetryPath = join(mkdtempSync(join(tmpdir(), "workflow-telemetry-cycles-")), "telemetry.jsonl");

    let adjudicatorCalls = 0;
    const createBinding = createDebateBindingFactory(async ({ adapterModel }) => {
      if (adapterModel === "ADJ") {
        adjudicatorCalls += 1;
        // First cycle: non-empty verdict runs the actuator and continues to cycle 2.
        // Second cycle: empty verdict stops the loop after the adjudicator.
        return { kind: "ok", stdout: adjudicatorCalls === 1 ? "apply this fix" : "", stderr: "" } as const;
      }
      return { kind: "ok", stdout: "ok", stderr: "" } as const;
    });

    const step = createDebateStep({
      stepId: "debate-1",
      verdictPath: debateVerdictPath(),
      maxCycles: 2,
      createBinding,
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        telemetry: { operatorSessionId: "session-1", workflow: "demo-workflow", sinkPath: telemetryPath },
      });

      expect(result.kind).toBe("complete");
      const rows = loadTelemetryRows(telemetryPath);

      // Cycle 1: adversary, advocate, adjudicator, actuator. Cycle 2: adversary, advocate, adjudicator (empty verdict stops before actuator).
      expect(rows).toHaveLength(7);
      expect(new Set(rows.map((row) => row.run_id)).size).toBe(1);
      expect(new Set(rows.map((row) => row.attempt_id)).size).toBe(1);
    });
  });

  test("omitting telemetry from executeWorkflow emits no rows for either step behavior", async () => {
    const telemetryPath = join(mkdtempSync(join(tmpdir(), "workflow-telemetry-")), "telemetry.jsonl");

    const writeStep = createStep({
      stepId: "step-1",
      role: "implement",
      branchName: "telemetry-omitted",
    });
    const debateStep = createDebateStep({
      stepId: "step-2",
      verdictPath: debateVerdictPath(),
      branch: "telemetry-omitted",
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => {
        return { kind: "ok", stdout: adapterModel === "ADJ" ? "" : "ok", stderr: "" } as const;
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [writeStep, debateStep], stateStore: store });

      expect(result.kind).toBe("complete");
      expect(() => readFileSync(telemetryPath, "utf8")).toThrow();
    });
  });

  test("implement workflow publication receives shrink-authored narrative when present", async () => {
    const capturedPublisherInputs: Array<{ narrative?: string }> = [];

    const implementStep = createStep({
      stepId: "implement-1",
      role: "implement",
      branchName: "shrink-with-narrative",
      creationTitle: "implement: narrative-test",
      createBinding: createBindingFactory(async ({ cwd, adapterModel }) => {
        if (adapterModel === "shrink-model") {
          const scratchDir = join(cwd, ".scratch");
          mkdirSync(scratchDir, { recursive: true });
          writeFileSync(
            join(scratchDir, "shrink-narrative.md"),
            "Refactored module X to simplify Y.\nAll tests pass and git diff is clean.",
            "utf8",
          );
        }
        writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" } as const;
      }),
      agentModelConfig: {
        claude: {
          implement: { rungs: [{ adapterModel: "impl-model", priceKey: "impl-model" }] },
          shrink: { rungs: [{ adapterModel: "shrink-model", priceKey: "shrink-model" }] },
        },
      },
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: resolveWorkflowPreset("implement", [implementStep]),
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-123" }),
        completionPublisher: async (input) => {
          capturedPublisherInputs.push({
            ...(input.narrative !== undefined ? { narrative: input.narrative } : {}),
          });
          return { prNumber: 42 };
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(capturedPublisherInputs).toHaveLength(1);
      expect(capturedPublisherInputs[0]?.narrative).toBe(
        "Refactored module X to simplify Y.\nAll tests pass and git diff is clean.",
      );
    });
  });

  test("implement workflow publication succeeds when narrative file is absent", async () => {
    const capturedPublisherInputs: Array<{ narrative?: string }> = [];

    const implementStep = createStep({
      stepId: "implement-1",
      role: "implement",
      branchName: "shrink-no-narrative",
      creationTitle: "implement: no-narrative",
      createBinding: doneBindingFactory,
      agentModelConfig: {
        claude: {
          implement: { rungs: [{ adapterModel: "impl", priceKey: "impl" }] },
          shrink: { rungs: [{ adapterModel: "shrink", priceKey: "shrink" }] },
        },
      },
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: resolveWorkflowPreset("implement", [implementStep]),
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-123" }),
        completionPublisher: async (input) => {
          capturedPublisherInputs.push({
            ...(input.narrative !== undefined ? { narrative: input.narrative } : {}),
          });
          return { prNumber: 42 };
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(capturedPublisherInputs).toHaveLength(1);
      expect(capturedPublisherInputs[0]?.narrative).toBeUndefined();
    });
  });
});
