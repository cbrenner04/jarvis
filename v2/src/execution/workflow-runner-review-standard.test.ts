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

describe("executeWorkflow review dispatch", () => {
  test("resolves role orders independently and reports a fresh non-durable run", async () => {
    const calls: string[] = [];
    const progress: string[] = [];
    const telemetryPath = join(mkdtempSync(join(tmpdir(), "workflow-review-telemetry-")), "telemetry.jsonl");
    const step: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review-1",
      project: "demo",
      branch: "review-only",
      cwd: "/fake",
      prompt: "inspect",
      verdictPath: join(mkdtempSync(join(tmpdir(), "workflow-review-")), "verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async ({ prompt }) => {
          calls.push(`${agentId}:${prompt}`);
          return { kind: "ok" as const, stdout: agentId === "claude" ? "fix" : "done", stderr: "" };
        },
      }),
    };
    const fired: Array<{ index: number; runId: string; durable: boolean }> = [];

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        onStepRunCreated: (index, runId) => fired.push({ index, runId, durable: store.loadRun(runId) !== null }),
        onReviewDebateProgress: (_invocationId, _stepId, update) => progress.push(`${update.status}:${update.role}`),
        telemetry: { operatorSessionId: "session-1", workflow: "demo-workflow", sinkPath: telemetryPath },
      });

      expect(result).toMatchObject({ kind: "complete", resumable: false, iterationsConsumed: 1 });
      expect(calls).toEqual(["claude:inspect", "codex:fix"]);
      expect(fired).toHaveLength(1);
      expect(fired[0]).toMatchObject({ index: 0, runId: result.runId, durable: false });
      expect(store.listRuns()).toHaveLength(0);
      expect(progress).toEqual(["in_progress:critic", "in_progress:actuator", "completed:actuator"]);
      expect(loadTelemetryRows(telemetryPath)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workflow: "demo-workflow",
            step_id: "review-1",
            run_id: result.runId,
            role: "critic",
          }),
          expect.objectContaining({
            workflow: "demo-workflow",
            step_id: "review-1",
            run_id: result.runId,
            role: "actuator",
          }),
        ]),
      );
    });
  });

  test("propagates review idleOutputMs through non-durable profile review dispatch", async () => {
    const captured = new Map<number, string[]>();

    for (const idleOutputMs of [12_345, 0]) {
      const roles: string[] = [];
      const step: ReviewWorkflowStep = {
        behavior: "review",
        stepId: `profile-review-idle-${idleOutputMs}`,
        project: "demo",
        branch: "review-only",
        cwd: "/fake",
        prompt: "inspect",
        verdictPath: join(mkdtempSync(join(tmpdir(), "workflow-profile-review-idle-")), "verdict.md"),
        maxCycles: 1,
        idleOutputMs,
        agents: { critic: ["claude"], actuator: ["codex"] },
        agentModelConfig: config,
        createBinding: ({ agentId, adapterModel }) => ({
          id: `${agentId}/${adapterModel}`,
          metadata: { agent: agentId, model: adapterModel },
          invoke: async ({ idleOutputMs: observedIdleOutputMs }) => {
            expect(observedIdleOutputMs).toBe(idleOutputMs);
            roles.push(adapterModel);
            return { kind: "ok", stdout: adapterModel === "critic" ? "apply this fix" : "done", stderr: "" } as const;
          },
        }),
      };

      await withStateStore(async (store) => {
        expect((await executeWorkflow({ steps: [step], stateStore: store })).kind).toBe("complete");
      });
      captured.set(idleOutputMs, roles);
    }

    expect(captured).toEqual(
      new Map([
        [12_345, ["critic", "actuator"]],
        [0, ["critic", "actuator"]],
      ]),
    );
  });

  test("propagates review idleOutputMs through standard review dispatch", async () => {
    const captured = new Map<number, string[]>();

    for (const idleOutputMs of [12_345, 0]) {
      const workspace = mkdtempSync(join(tmpdir(), "workflow-standard-review-idle-"));
      stageReviewedIntent(workspace);
      const roles: string[] = [];
      const step = reviewedIntentStep(workspace, {
        branch: `intent/review-idle-${idleOutputMs}`,
        idleOutputMs,
        createBinding: ({ agentId, adapterModel }) => ({
          id: `${agentId}/${adapterModel}`,
          metadata: { agent: agentId, model: adapterModel },
          invoke: async ({ idleOutputMs: observedIdleOutputMs }) => {
            expect(observedIdleOutputMs).toBe(idleOutputMs);
            roles.push(adapterModel);
            return { kind: "ok", stdout: adapterModel === "critic" ? "apply this fix" : "done", stderr: "" } as const;
          },
        }),
      });

      await withStateStore(async (store) => {
        expect((await executeWorkflow({ steps: [step], stateStore: store })).kind).toBe("complete");
      });
      captured.set(idleOutputMs, roles);
    }

    expect(captured).toEqual(
      new Map([
        [12_345, ["critic", "actuator"]],
        [0, ["critic", "actuator"]],
      ]),
    );
  });

  test("uses the review idle fallback only for an unstamped step", async () => {
    const observed: number[] = [];

    for (const idleOutputMs of [undefined, 0] as const) {
      const step: ReviewWorkflowStep = {
        behavior: "review",
        stepId: `review-idle-fallback-${idleOutputMs ?? "absent"}`,
        project: "demo",
        branch: "review-only",
        cwd: "/fake",
        prompt: "inspect",
        verdictPath: join(mkdtempSync(join(tmpdir(), "workflow-review-idle-fallback-")), "verdict.md"),
        maxCycles: 1,
        ...(idleOutputMs === undefined ? {} : { idleOutputMs }),
        agents: { critic: ["claude"], actuator: ["codex"] },
        agentModelConfig: config,
        createBinding: ({ agentId, adapterModel }) => ({
          id: `${agentId}/${adapterModel}`,
          metadata: { agent: agentId, model: adapterModel },
          invoke: async ({ idleOutputMs: observedIdleOutputMs }) => {
            observed.push(observedIdleOutputMs ?? -1);
            return { kind: "ok", stdout: "", stderr: "" } as const;
          },
        }),
      };

      await withStateStore(async (store) => {
        expect((await executeWorkflow({ steps: [step], stateStore: store })).kind).toBe("complete");
      });
    }

    expect(observed).toEqual([90_000, 0]);
  });

  test("persists reviewed-intent review as a durable snapshot step", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-snapshot-"));
    stageReviewedIntent(workspace);
    const step = reviewedIntentStep(workspace, { branch: "intent/snapshot", maxCycles: 0 });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });

      expect(store.loadRun(result.runId)?.workflowSnapshot?.steps).toEqual([
        { stepId: "review", role: "", behavior: "review", durable: true },
      ]);
    });
  });

  test("runs reviewed-intent review and landing only in the split workspace", async () => {
    const operatorCheckout = mkdtempSync(join(tmpdir(), "reviewed-intent-operator-"));
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-workspace-"));
    stageReviewedIntent(workspace);
    const durableDir = join(workspace, "ready-intents");
    const verdictPath = join(workspace, ".jarvis-intent-review-verdict.md");
    const observedCwds: string[] = [];
    const observedPrompts: string[] = [];
    writeFileSync(join(operatorCheckout, "unrelated-dirty.txt"), "keep\n", "utf8");

    const step: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "intent/example",
      cwd: workspace,
      prompt: "inspect",
      verdictPath,
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      profile: intentReviewPromptProfile,
      profileContext: { stagingDir: join(workspace, ".jarvis-intent-stage"), verdictPath },
      landing: {
        kind: "intent-stage",
        output: { durableDir },
        stagingDir: join(workspace, ".jarvis-intent-stage"),
        invocationId: "invocation-1",
        baseRef: "none",
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async ({ cwd, prompt }) => {
          observedCwds.push(cwd);
          observedPrompts.push(prompt);
          if (agentId === "codex") {
            const stage = join(cwd, ".jarvis-intent-stage");
            mkdirSync(stage, { recursive: true });
            writeFileSync(
              join(stage, "example.md"),
              "---\nname: example\n---\n\n# Example\n\n## Prerequisites\n",
              "utf8",
            );
            return { kind: "ok" as const, stdout: "applied", stderr: "" };
          }
          return { kind: "ok" as const, stdout: "apply", stderr: "" };
        },
      }),
    };

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });
      expect(result).toMatchObject({ kind: "complete", iterationsConsumed: 1 });

      const runRow = store.loadRun(result.runId);
      expect(runRow).toMatchObject({
        specRef: "none",
        specPath: join(workspace, ".jarvis-intent-stage"),
      });
    });

    expect(observedCwds).toEqual([workspace, workspace]);
    expect(observedPrompts[0]).toContain("<<<STAGED_INTENT_BEGIN>>>");
    expect(observedPrompts[1]).toContain("apply");
    expect(readFileSync(join(operatorCheckout, "unrelated-dirty.txt"), "utf8")).toBe("keep\n");
    expect(readFileSync(join(durableDir, "example.md"), "utf8")).toContain("# Example");
    expect(existsSync(verdictPath)).toBe(false);
  });

  test("fails reviewed intent without critic verdict evidence before landing", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-evidence-"));
    stageReviewedIntent(workspace);
    const step = reviewedIntentStep(workspace, { branch: "intent/evidence", maxCycles: 0 });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });
      expect(result).toMatchObject({ kind: "invocation_failure", iterationsConsumed: 0 });
      expect(result.invocationFailureMessage).toContain("critic invocation did not produce a verdict");
      expect(store.loadRun(result.runId)?.attempts.at(-1)?.invocationFailureDetail?.message).toBe(
        result.invocationFailureMessage,
      );
      expect(existsSync(join(workspace, "ready-intents"))).toBe(false);
    });
  });

  test("fails a missing reviewed-intent workspace before invoking the critic", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-missing-"));
    let calls = 0;
    const step = reviewedIntentStep(workspace, {
      branch: "intent/missing",
      createBinding: ({ agentId }) => ({
        id: agentId,
        invoke: async () => {
          calls += 1;
          return { kind: "ok" as const, stdout: "", stderr: "" };
        },
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });
      expect(result.invocationFailureMessage).toContain("staged workspace is missing or empty");
      expect(store.loadRun(result.runId)?.attempts.at(-1)?.invocationFailureDetail?.message).toBe(
        result.invocationFailureMessage,
      );
    });
    expect(calls).toBe(0);
  });

  test("reports exhausted reviewed-intent critic bindings", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-exhausted-"));
    stageReviewedIntent(workspace);
    const step = reviewedIntentStep(workspace, {
      branch: "intent/exhausted",
      createBinding: ({ agentId }) => ({
        id: agentId,
        invoke: async () => ({ kind: "quota" as const, stderr: "quota" }),
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });
      expect(result.invocationFailureMessage).toContain("configured critic bindings exhausted (quota)");
      expect(store.loadRun(result.runId)?.attempts.at(-1)?.invocationFailureDetail?.message).toBe(
        result.invocationFailureMessage,
      );
    });
  });

  function criticOnlyStep(overrides: Partial<ReviewWorkflowStep>): ReviewWorkflowStep {
    return {
      behavior: "review",
      stepId: "review-guard",
      project: "demo",
      branch: "review-guard",
      cwd: "/fake",
      prompt: "inspect",
      verdictPath: join(mkdtempSync(join(tmpdir(), "workflow-review-guard-")), "verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      ...overrides,
    };
  }

  function criticBinding(invoke: InvocationBinding["invoke"]): NonNullable<ReviewWorkflowStep["createBinding"]> {
    return ({ agentId, adapterModel }) => ({
      id: `${agentId}/${adapterModel}`,
      metadata: { agent: agentId, model: adapterModel },
      invoke,
    });
  }

  test("settles a timed-out critic as non-resumable (exhausted) on both the non-durable and reviewed-intent paths", async () => {
    const boundMs = 5;
    const hangingCritic = criticBinding(
      ({ signal }) =>
        new Promise<InvocationResult>((resolve) => {
          signal?.addEventListener("abort", () => resolve({ kind: "error", exitCode: 1, stderr: "aborted" }), {
            once: true,
          });
        }),
    );
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-timeout-"));
    stageReviewedIntent(workspace);

    await withStateStore(async (store) => {
      expect(
        await executeWorkflow({
          steps: [criticOnlyStep({ roleTimeoutMs: boundMs, createBinding: hangingCritic })],
          stateStore: store,
        }),
      ).toMatchObject({ kind: "invocation_failure", resumable: false });

      const durable = await executeWorkflow({
        steps: [
          reviewedIntentStep(workspace, {
            branch: "intent/timeout",
            roleTimeoutMs: boundMs,
            createBinding: hangingCritic,
          }),
        ],
        stateStore: store,
      });
      expect(durable).toMatchObject({ kind: "invocation_failure", resumable: false });
      expect(store.loadRun(durable.runId)?.attempts.at(-1)?.invocationFailureDetail).toMatchObject({
        failureKind: "timeout",
        role: "critic",
        boundMs,
        exhaustedRoleTimeout: true,
      });
    });
  });

  test("keeps a non-timeout critic failure non-resumable on both the non-durable and reviewed-intent paths", async () => {
    const failingCritic = criticBinding(async () => ({ kind: "error", exitCode: 1, stderr: "boom" }) as const);
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-error-"));
    stageReviewedIntent(workspace);

    await withStateStore(async (store) => {
      expect(
        await executeWorkflow({ steps: [criticOnlyStep({ createBinding: failingCritic })], stateStore: store }),
      ).toMatchObject({ kind: "invocation_failure", resumable: false });

      const durable = await executeWorkflow({
        steps: [reviewedIntentStep(workspace, { branch: "intent/error", createBinding: failingCritic })],
        stateStore: store,
      });
      expect(durable).toMatchObject({ kind: "invocation_failure", resumable: false });
      expect(store.loadRun(durable.runId)?.attempts.at(-1)?.invocationFailureDetail).toMatchObject({
        failureKind: "error",
      });
    });
  });

  test("accepts an empty critic verdict without invoking the actuator", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-empty-verdict-"));
    stageReviewedIntent(workspace);
    const calls: string[] = [];
    const step = reviewedIntentStep(workspace, {
      branch: "intent/empty-verdict",
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => {
          calls.push(agentId);
          return { kind: "ok" as const, stdout: "", stderr: "" };
        },
      }),
    });

    await withStateStore(async (store) => {
      expect(await executeWorkflow({ steps: [step], stateStore: store })).toMatchObject({ kind: "complete" });
    });
    expect(calls).toEqual(["claude"]);
  });

  test("emits iteration_started and loop_finished around a durable reviewed-intent review", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-log-"));
    stageReviewedIntent(workspace);
    const _durableDir = join(workspace, "ready-intents");
    const step: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "intent/example",
      cwd: workspace,
      prompt: "inspect",
      verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: join(workspace, ".jarvis-intent-stage"),
        invocationId: "invocation-1",
        baseRef: "none",
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async ({ cwd }) => {
          if (agentId === "codex") {
            const stage = join(cwd, ".jarvis-intent-stage");
            mkdirSync(stage, { recursive: true });
            writeFileSync(
              join(stage, "example.md"),
              "---\nname: example\n---\n\n# Example\n\n## Prerequisites\n",
              "utf8",
            );
            return { kind: "ok" as const, stdout: "applied", stderr: "" };
          }
          return { kind: "ok" as const, stdout: "apply", stderr: "" };
        },
      }),
    };

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
      expect(result).toMatchObject({ kind: "complete", iterationsConsumed: 1 });

      const events = logSink.getEventsForRun(result.runId);
      expect(events[0]).toMatchObject({ kind: "iteration_started" });
      expect(events.at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "complete",
        resumable: false,
      });
    });
  });

  test("restores a reviewed-intent boundary violation in the split workspace", async () => {
    const operatorCheckout = mkdtempSync(join(tmpdir(), "reviewed-intent-operator-"));
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-workspace-"));
    stageReviewedIntent(workspace);
    writeFileSync(join(operatorCheckout, "unrelated-dirty.txt"), "keep\n", "utf8");

    const step: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "intent/example",
      cwd: workspace,
      prompt: "inspect",
      verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: join(workspace, ".jarvis-intent-stage"),
        invocationId: "invocation-1",
        baseRef: "none",
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async ({ cwd }) => {
          if (agentId === "claude") writeFileSync(join(cwd, "rogue.txt"), "no\n", "utf8");
          return { kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" };
        },
      }),
    };

    let result!: Awaited<ReturnType<typeof executeWorkflow>>;
    await withStateStore(async (store) => {
      result = await executeWorkflow({ steps: [step], stateStore: store });
      expect(store.loadRun(result.runId)?.attempts.at(-1)?.invocationFailureDetail?.message).toBe(
        result.invocationFailureMessage,
      );
    });

    expect(result).toMatchObject({ kind: "invocation_failure", iterationsConsumed: 1 });
    expect(result.invocationFailureMessage).toContain("modified files outside");
    expect(result.invocationFailureMessage).toContain("rogue.txt");
    expect(existsSync(join(workspace, "rogue.txt"))).toBe(false);
    expect(readFileSync(join(operatorCheckout, "unrelated-dirty.txt"), "utf8")).toBe("keep\n");
  });

  test("emits iteration_started and loop_finished on a durable reviewed-intent invocation_failure", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-log-fail-"));
    stageReviewedIntent(workspace);
    const step: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "intent/example",
      cwd: workspace,
      prompt: "inspect",
      verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: join(workspace, ".jarvis-intent-stage"),
        invocationId: "invocation-1",
        baseRef: "none",
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async ({ cwd }) => {
          if (agentId === "claude") writeFileSync(join(cwd, "rogue.txt"), "no\n", "utf8");
          return { kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" };
        },
      }),
    };

    const logSink = new TestLogSink();
    let result!: Awaited<ReturnType<typeof executeWorkflow>>;
    await withStateStore(async (store) => {
      result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
    });

    expect(result).toMatchObject({ kind: "invocation_failure", iterationsConsumed: 1 });
    const events = logSink.getEventsForRun(result.runId);
    expect(events[0]).toMatchObject({ kind: "iteration_started" });
    expect(events.at(-1)).toMatchObject({
      kind: "loop_finished",
      loopOutcomeKind: "invocation_failure",
      resumable: true,
    });
  });
});
