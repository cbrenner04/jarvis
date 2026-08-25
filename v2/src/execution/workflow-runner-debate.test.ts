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

describe("executeWorkflow review-debate dispatch", () => {
  test("dispatches a review-debate step, resolving each role's agents order to that role's bindings", async () => {
    const events: string[] = [];
    const createBinding = createDebateBindingFactory(
      async ({ agentId, adapterModel }) => {
        events.push(`invoke:${agentId}/${adapterModel}`);
        return { kind: "ok", stdout: adapterModel === "ADJ" ? "apply this fix" : "ok", stderr: "" } as const;
      },
      ({ agentId, adapterModel }) => {
        events.push(`resolve:${agentId}/${adapterModel}`);
      },
    );

    const step = createDebateStep({ stepId: "debate-1", verdictPath: debateVerdictPath(), createBinding });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });

      expect(result.kind).toBe("complete");
      expect(result.resumable).toBe(false);
      const run = store.loadRun(result.runId);
      expect(run).toMatchObject({
        project: "demo",
        branch: "review-debate-workflow",
        stepId: "debate-1",
        status: "completed",
      });
      expect(run?.attempts).toHaveLength(1);
      expect(run?.workflowSnapshot?.steps).toContainEqual({
        stepId: "debate-1",
        role: "",
        behavior: "review-debate",
        durable: true,
      });
      expect(events).toEqual([
        "resolve:claude/ADV",
        "resolve:claude/ADVOC",
        "resolve:claude/ADJ",
        "resolve:claude/ACT",
        "invoke:claude/ADV",
        "invoke:claude/ADVOC",
        "invoke:claude/ADJ",
        "invoke:claude/ACT",
      ]);
    });
  });

  test("propagates review idleOutputMs through full review-debate dispatch", async () => {
    const captured = new Map<number, string[]>();

    for (const idleOutputMs of [12_345, 0]) {
      const roles: string[] = [];
      const step = createDebateStep({
        stepId: `debate-idle-${idleOutputMs}`,
        verdictPath: debateVerdictPath(),
        idleOutputMs,
        createBinding: ({ agentId, adapterModel }) => ({
          id: `${agentId}/${adapterModel}`,
          metadata: { agent: agentId, model: adapterModel },
          invoke: async ({ idleOutputMs: observedIdleOutputMs }) => {
            expect(observedIdleOutputMs).toBe(idleOutputMs);
            roles.push(adapterModel);
            return { kind: "ok", stdout: adapterModel === "ADJ" ? "apply this fix" : "ok", stderr: "" } as const;
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
        [12_345, ["ADV", "ADVOC", "ADJ", "ACT"]],
        [0, ["ADV", "ADVOC", "ADJ", "ACT"]],
      ]),
    );
  });

  test("fails role validation for a review-debate step missing an (agent, role) entry, before any run", async () => {
    const step = createDebateStep({
      stepId: "debate-1",
      verdictPath: debateVerdictPath(),
      agents: { adversary: ["claude"], advocate: ["codex"], adjudicator: ["claude"], actuator: ["claude"] },
    });

    await withStateStore(async (store) => {
      try {
        await executeWorkflow({ steps: [step], stateStore: store });
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(String(e)).toContain("(debate-1, advocate, codex)");
      }
    });
  });

  test("reports kind: complete, resumable: false for a single-step review-debate workflow that completes all cycles", async () => {
    const createBinding = createDebateBindingFactory(
      async ({ adapterModel }) =>
        ({ kind: "ok", stdout: adapterModel === "ADJ" ? "apply this fix" : "ok", stderr: "" }) as const,
    );
    const step = createDebateStep({ stepId: "debate-1", verdictPath: debateVerdictPath(), createBinding });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });

      expect(result).toMatchObject({ kind: "complete", stepIndex: 0, stepId: "debate-1", resumable: false });
    });
  });

  test("reports kind: invocation_failure, resumable: false when a role invocation aborts a cycle", async () => {
    const createBinding = createDebateBindingFactory(async ({ adapterModel }) =>
      adapterModel === "ADV"
        ? ({ kind: "error", exitCode: 1, stderr: "boom" } as const)
        : ({ kind: "ok", stdout: "ok", stderr: "" } as const),
    );
    const step = createDebateStep({ stepId: "debate-1", verdictPath: debateVerdictPath(), createBinding });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });

      expect(result).toMatchObject({ kind: "invocation_failure", stepIndex: 0, stepId: "debate-1", resumable: false });
      expect(store.loadRun(result.runId)).toMatchObject({ status: "failed", attemptCount: 1 });
      expect(store.loadRun(result.runId)?.attempts.at(-1)?.invocationFailureDetail).toEqual({
        failureKind: "error",
        bindingAttempts: [],
        message: "review: adversary invocation failed (error)",
      });
      expect(store.loadRun(result.runId)?.attempts.at(-1)?.invocationFailureDetail?.boundMs).toBeUndefined();
    });
  });

  test("persists attributed timeout detail when a review-debate actuator exceeds its bound", async () => {
    const boundMs = 5;
    const step = createDebateStep({
      stepId: "debate-timeout",
      verdictPath: debateVerdictPath(),
      roleTimeoutMs: boundMs,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: ({ signal }) =>
          adapterModel === "ACT"
            ? new Promise<InvocationResult>((resolve) =>
                signal?.addEventListener("abort", () => resolve({ kind: "error", exitCode: 1, stderr: "aborted" }), {
                  once: true,
                }),
              )
            : Promise.resolve(
                adapterModel === "ADJ"
                  ? ({ kind: "ok", stdout: "apply this fix", stderr: "" } as const)
                  : ({ kind: "ok", stdout: "ok", stderr: "" } as const),
              ),
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });

      expect(result).toMatchObject({
        kind: "invocation_failure",
        stepIndex: 0,
        stepId: "debate-timeout",
        resumable: false,
      });
      expect(store.loadRun(result.runId)?.attempts.at(-1)?.invocationFailureDetail).toEqual({
        failureKind: "timeout",
        bindingAttempts: [{ bindingId: "claude/ACT", resultKind: "timeout", agent: "claude", model: "ACT" }],
        role: "actuator",
        agent: "claude",
        model: "ACT",
        boundMs,
        exhaustedRoleTimeout: true,
        message: `review: actuator exceeded ${boundMs}ms bound (agent=claude, model=ACT)`,
      });
    });
  });

  test("persists one in-progress debate attempt across roles and creates a fresh row for fresh dispatch", async () => {
    await withStateStore(async (store) => {
      let observed: unknown;
      const createBinding = createDebateBindingFactory(async ({ adapterModel }) => {
        observed = store.listRuns().find((run) => run.stepId === "debate-durable")
          ? store.loadRun(store.listRuns().find((run) => run.stepId === "debate-durable")?.id ?? "")
          : null;
        return { kind: "ok", stdout: adapterModel === "ADJ" ? "" : "ok", stderr: "" } as const;
      });
      const step = createDebateStep({ stepId: "debate-durable", verdictPath: debateVerdictPath(), createBinding });

      const first = await executeWorkflow({ steps: [step], stateStore: store });
      expect(observed).toMatchObject({ status: "in-progress", attempts: [{ status: "in-progress" }] });
      const second = await executeWorkflow({ steps: [step], stateStore: store, freshDispatch: true });
      expect(second.runId).not.toBe(first.runId);
      expect(store.listRuns().filter((run) => run.stepId === "debate-durable")).toHaveLength(2);
    });
  });

  function debateIntentStep(
    workspace: string,
    branch: string,
    overrides: Partial<Omit<ReviewDebateWorkflowStep, "behavior">> = {},
  ): ReviewDebateWorkflowStep {
    return createDebateStep({
      stepId: "review",
      branch,
      cwd: workspace,
      verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
      landing: {
        kind: "intent-stage",
        output: { durableDir: join(workspace, "ready-intents") },
        stagingDir: join(workspace, ".jarvis-intent-stage"),
        invocationId: "invocation-debate",
        baseRef: "none",
      },
      createBinding: createDebateBindingFactory(
        async ({ adapterModel }) =>
          ({ kind: "ok", stdout: adapterModel === "ADJ" ? "apply this fix" : "ok", stderr: "" }) as const,
      ),
      ...overrides,
    });
  }

  test("promotes, cleans up, and traces a debate-last intent workflow the same as light review", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-debate-"));
    const stage = join(workspace, ".jarvis-intent-stage");
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "example.md"), "---\nname: example\n---\n\n# Example\n\n## Prerequisites\n", "utf8");
    const durableDir = join(workspace, "ready-intents");
    const verdictPath = join(workspace, ".jarvis-intent-review-verdict.md");
    const step = debateIntentStep(workspace, "intent/debate-example");

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
      expect(result).toMatchObject({ kind: "complete" });
      const finalizationEvents = logSink
        .getEventsForRun(result.runId)
        .filter((event) => event.kind === "intent_finalization");
      expect(finalizationEvents.length).toBeGreaterThan(0);
      expect(finalizationEvents[0]).toMatchObject({ phase: "review_landing", branch: "intent/debate-example" });
    });

    expect(readFileSync(join(durableDir, "example.md"), "utf8")).toContain("# Example");
    expect(existsSync(stage)).toBe(false);
    expect(existsSync(verdictPath)).toBe(false);
    expect(existsSync(`${verdictPath}.owner`)).toBe(false);
  });

  test("settles a debate-last intent workflow's landing failure the same as light review, with a trace", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-debate-fail-"));
    const stage = join(workspace, ".jarvis-intent-stage");
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "example.md"), "---\nname: example\n---\n\n# Example\n\n## Prerequisites\n", "utf8");
    const durableDir = join(workspace, "ready-intents");
    mkdirSync(durableDir, { recursive: true });
    writeFileSync(join(durableDir, "example.md"), "different\n", "utf8");
    const step = debateIntentStep(workspace, "intent/debate-collision");

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
      expect(result).toMatchObject({ kind: "invocation_failure", resumable: true });
      const finalizationEvents = logSink
        .getEventsForRun(result.runId)
        .filter((event) => event.kind === "intent_finalization");
      expect(finalizationEvents.length).toBeGreaterThan(0);
      expect((finalizationEvents.at(-1) as { stopReason?: string }).stopReason).toBeTruthy();
    });
    expect(existsSync(join(stage, "example.md"))).toBe(true);
  });

  test("settles post-review finalization failure without invocation_failure when all roles succeeded", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-debate-landing-detail-"));
    const stage = join(workspace, ".jarvis-intent-stage");
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "example.md"), "---\nname: example\n---\n\n# Example\n\n## Prerequisites\n", "utf8");
    const durableDir = join(workspace, "ready-intents");
    mkdirSync(durableDir, { recursive: true });
    writeFileSync(join(durableDir, "example.md"), "different\n", "utf8");
    const step = debateIntentStep(workspace, "intent/debate-landing-detail");

    await withStateStore(async (store) => {
      // Every debate role (adversary/advocate/adjudicator) returns "ok"; the failure happens
      // only in the post-role landing step, so it must not be classified generically.
      const result = await executeWorkflow({ steps: [step], stateStore: store });
      expect(result).toMatchObject({ kind: "invocation_failure", resumable: true });
      const checkpoint = store.findRunByProjectBranch({
        project: "demo",
        branch: "intent/debate-landing-detail",
        stepId: "review",
      });
      expect(checkpoint?.attempts.at(-1)?.invocationFailureDetail?.failureKind).toBe("landing");
    });
  });

  test("settles workflow-tail finalization failure without invocation_failure when all roles succeeded", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-tail-failure-"));
    const withExternalWorktree = externalWorktreeBinding(workspace);
    const stagingDir = join(workspace, ".jarvis-intent-stage");
    const durableDir = join(workspace, "ready-intents");
    const baseWriteStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "intent-tail-failure",
      specPath: "ready-intents",
      expectedArtifactPath: ".jarvis-intent-stage",
      landing: {
        kind: "intent-stage",
        output: { durableDir },
        stagingDir,
        invocationId: "invocation-debate",
        baseRef: "none",
      },
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
      creationTitle: "intent: tail-failure",
      withExternalWorktree,
      createBinding: createBindingFactory(async ({ cwd }) => {
        mkdirSync(join(cwd, ".jarvis-intent-stage"), { recursive: true });
        writeFileSync(
          join(cwd, ".jarvis-intent-stage", "example.md"),
          "---\nname: example\n---\n\n# Example\n\n## Prerequisites\n",
          "utf8",
        );
        return { kind: "ok" as const, stdout: "done", stderr: "" };
      }),
    });
    const writeStep: WriteWorkflowStep = {
      ...baseWriteStep,
      worktree: { ...baseWriteStep.worktree, git: false, localPath: workspace },
    };
    const reviewStep = debateIntentStep(workspace, "intent-tail-failure");
    const logSink = new TestLogSink();

    await withStateStore(async (store) => {
      // All debate roles return "ok" and the review step's own landing succeeds (promotion is
      // complete); the failure is injected only in the post-review workflow-completion tail
      // (commit/push/PR), which must not be classified as `invocation_failure`.
      const result = await executeWorkflow({
        steps: [writeStep, reviewStep],
        stateStore: store,
        logSink,
        completionCommitter: async () => {
          throw new Error("commit tail exploded");
        },
      });

      expect(result.kind).not.toBe("invocation_failure");
      expect(result.kind).toBe("completion_commit_failed");
      expect(store.loadRun(result.runId)?.status).toBe("failed");

      // Mutation checkpoint: the terminal `loop_finished` record must carry the same
      // `completionCommitError` the workflow result returns, not merely permit it in the schema.
      // @mutate v2/src/execution/workflow-runner.ts "completionCommitError: completionCommitErrorMessage," -> ""
      const loopFinished = logSink.getEventsForRun(result.runId).filter((event) => event.kind === "loop_finished");
      expect(loopFinished.at(-1)).toMatchObject({
        loopOutcomeKind: "completion_commit_failed",
        completionCommitError: result.completionCommitError,
      });
    });

    expect(readFileSync(join(durableDir, "example.md"), "utf8")).toContain("# Example");
  });
});

describe("executeWorkflow linked implement routing", () => {
  test("throws a typed error when the routing index cannot be read", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "linked-routing-unreadable-"));
    roots.push(projectRoot);
    const step = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "linked-routing-unreadable",
      specPath: "spec/index.md",
      linkedIndexRouting: true,
    });
    step.worktree = { ...step.worktree, projectRoot };

    await withStateStore(async (store) => {
      try {
        await executeWorkflow({ steps: [step], stateStore: store });
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LinkedIndexReadError);
        expect(error).toMatchObject({ indexPath: join(getExternalWorktreePath(step.worktree), "spec/index.md") });
        expect((error as Error).message).toContain("ENOENT");
      }
    });
  });

  test("reads index from project root when worktree is absent and advances checkbox in worktree only", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "linked-routing-project-"));
    roots.push(projectRoot);
    const specDir = join(projectRoot, "spec");
    mkdirSync(specDir, { recursive: true });
    const projectRootIndexContent = "- [ ] [Sub](./sub.md)\n";
    writeFileSync(join(specDir, "index.md"), projectRootIndexContent, "utf8");
    writeFileSync(join(specDir, "sub.md"), "# Sub\n\n## Acceptance criteria\n\n- [ ] criterion\n", "utf8");

    const home = createJarvisHome();
    roots.push(home.jarvisRoot);
    const branchName = "linked-routing-first-launch";
    const worktreePath = join(home.jarvisRoot, "worktrees", "demo", branchName);
    expect(existsSync(worktreePath)).toBe(false);

    const implementStep: WriteWorkflowStep = {
      ...createStep({
        stepId: "implement",
        role: "implement",
        branchName,
        specPath: "spec/index.md",
        expectedArtifactPath: "spec/index.md",
        createBinding: createBindingFactory(async ({ cwd }) => {
          writeFileSync(join(cwd, "spec", "sub.md"), "# Sub\n\n## Acceptance criteria\n\n- [x] criterion\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        }),
      }),
      worktree: {
        projectRoot,
        projectName: "demo",
        branchName,
        baseRef: "HEAD",
        jarvisRoot: home.jarvisRoot,
      },
      withExternalWorktree: async <T>(
        args: { branchName: string; projectName: string },
        run: (worktree: ExternalWorktree) => Promise<T> | T,
      ): Promise<WithExternalWorktreeResult<T>> => {
        const wtPath = join(home.jarvisRoot, "worktrees", args.projectName, args.branchName);
        const existed = existsSync(wtPath);
        mkdirSync(wtPath, { recursive: true });
        if (!existed) {
          cpSync(specDir, join(wtPath, "spec"), { recursive: true });
        }
        const value = await run({ path: wtPath, reused: existed });
        return { worktree: { path: wtPath, reused: existed }, lock: { kind: "acquired" }, value };
      },
      linkedIndexRouting: true,
    };

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [implementStep], stateStore: store });

      expect(result.kind).toBe("complete");
      expect(existsSync(worktreePath)).toBe(true);
      expect(readFileSync(join(specDir, "index.md"), "utf8")).toBe(projectRootIndexContent);
      expect(readFileSync(join(worktreePath, "spec", "index.md"), "utf8")).toContain("- [x]");
    });
  });
});

describe("executeWorkflow implement patch review", () => {
  function createPatchReviewDebateStep(args: {
    branchName: string;
    jarvisRoot: string;
    verdictPath: string;
    cwd: string;
    createBinding?: ReviewDebateWorkflowStep["createBinding"];
    roleTimeoutMs?: number;
    idleOutputMs?: number;
    maxCycles?: number;
  }): ReviewDebateWorkflowStep {
    return {
      behavior: "review-debate",
      stepId: "implement-review",
      project: "demo",
      branch: args.branchName,
      cwd: args.cwd,
      prompts: {
        adversary: "implement.prompt.review.adversary",
        advocate: "implement.prompt.review.advocate",
        adjudicator: "implement.prompt.review.adjudicator",
      },
      verdictPath: args.verdictPath,
      maxCycles: args.maxCycles ?? 1,
      agents: { adversary: ["claude"], advocate: ["claude"], adjudicator: ["claude"], actuator: ["claude"] },
      agentModelConfig: DEBATE_AGENT_MODEL_CONFIG,
      profile: implementReviewPromptProfile,
      profileContext: { specPath: "index.md", cwd: args.cwd, baseBranch: "HEAD", passNumber: 1, totalPasses: 1 },
      ...(args.roleTimeoutMs !== undefined ? { roleTimeoutMs: args.roleTimeoutMs } : {}),
      ...(args.idleOutputMs !== undefined ? { idleOutputMs: args.idleOutputMs } : {}),
      ...(args.createBinding !== undefined ? { createBinding: args.createBinding } : {}),
    };
  }

  test("runs shrink before appended patch review and overwrites verdict-patch.md each cycle", async () => {
    const calls: string[] = [];
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "implement-patch-review",
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: async ({ cwd: worktreeCwd, prompt }) => {
          calls.push(prompt.includes("Post-completion Shrink") ? "shrink" : "implement");
          writeFileSync(`${worktreeCwd}/proof.txt`, "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        },
        metadata: { agent: agentId, model: adapterModel },
      }),
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );
    const verdictPath = join(worktreePath, "verdict-patch.md");

    const reviewStep = createPatchReviewDebateStep({
      branchName: implementStep.worktree.branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath,
      cwd: worktreePath,
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => {
        calls.push(`review:${adapterModel}`);
        return { kind: "ok", stdout: adapterModel === "ADJ" ? "fix it" : "ok", stderr: "" } as const;
      }),
    });
    reviewStep.profileContext = {
      specPath: "spec.md",
      cwd: reviewStep.cwd,
      baseBranch: "HEAD",
      passNumber: 1,
      totalPasses: 1,
    };

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [implementStep, reviewStep], stateStore: store });

      expect(result.kind).toBe("complete");
      expect(calls.indexOf("implement")).toBeLessThan(calls.indexOf("shrink"));
      expect(calls.indexOf("shrink")).toBeLessThan(calls.indexOf("review:ADV"));
      expect(readFileSync(verdictPath, "utf8")).toBe("fix it");
      const run = store.findRunByProjectBranch({
        project: "demo",
        branch: implementStep.worktree.branchName,
        stepId: "implement",
      });
      expect(run?.workflowSnapshot?.reviewPasses).toBe(reviewStep.maxCycles);
    });
  });

  test("skips appended patch review when linked index is already complete", async () => {
    const reviewCalls: string[] = [];
    const branchName = "implement-review-skip";
    const implementStep = {
      ...createStep({
        stepId: "implement",
        role: "implement",
        branchName,
        specPath: "index.md",
        expectedArtifactPath: "index.md",
      }),
      linkedIndexRouting: true,
    };
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      branchName,
    );
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, "index.md"), "- [x] [Sub](./sub.md)\n", "utf8");
    writeFileSync(join(worktreePath, "sub.md"), "# Sub\n", "utf8");

    const reviewStep = createPatchReviewDebateStep({
      branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      createBinding: createDebateBindingFactory(async () => {
        reviewCalls.push("review");
        return { kind: "ok", stdout: "ok", stderr: "" } as const;
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [implementStep, reviewStep], stateStore: store });

      expect(result.kind).toBe("complete");
      expect(reviewCalls).toEqual([]);
    });
  });

  test("routes to the second linked subspec by criteria when the first is criteria-complete with an unchecked index box, pinning that selection across the write loop", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "resolvePinnedLinkedSubspec(worktreeIndexPath, worktreePath, routing.active.index)" -> "resolveActiveLinkedSubspec(worktreeIndexPath, worktreePath)"
    const reviewCalls: string[] = [];
    const branchName = "linked-routing-criteria-second";
    const implementStep = {
      ...createStep({
        stepId: "implement",
        role: "implement",
        branchName,
        specPath: "index.md",
        expectedArtifactPath: "index.md",
        createBinding: createBindingFactory(async ({ cwd }) => {
          writeFileSync(join(cwd, "two.md"), "# Two\n\n## Acceptance criteria\n\n- [x] Done\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        }),
      }),
      linkedIndexRouting: true,
    };
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      branchName,
    );
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, "index.md"), "- [ ] [One](./one.md)\n- [ ] [Two](./two.md)\n", "utf8");
    writeFileSync(join(worktreePath, "one.md"), "# One\n\n## Acceptance criteria\n\n- [x] Done\n", "utf8");
    writeFileSync(join(worktreePath, "two.md"), "# Two\n\n## Acceptance criteria\n\n- [ ] Todo\n", "utf8");

    const reviewStep = createPatchReviewDebateStep({
      branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      createBinding: createDebateBindingFactory(async () => {
        reviewCalls.push("review");
        return { kind: "ok", stdout: "ok", stderr: "" } as const;
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [implementStep, reviewStep], stateStore: store });

      expect(result.kind).toBe("complete");
      // Review only runs once implementReviewEligible is true, which the outer loop sets only
      // when the pinned second link's completion is terminal — proving the write loop targeted
      // and completed the second (not the first, criteria-complete) subspec.
      expect(reviewCalls.length).toBeGreaterThan(0);
      expect(readFileSync(join(worktreePath, "index.md"), "utf8")).toBe(
        "- [ ] [One](./one.md)\n- [x] [Two](./two.md)\n",
      );
    });
  });

  test("stops at review invocation_failure without treating it as workflow complete", async () => {
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "implement-review-fail",
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );

    const reviewStep = createPatchReviewDebateStep({
      branchName: implementStep.worktree.branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      createBinding: createDebateBindingFactory(async ({ adapterModel }) =>
        adapterModel === "ADV"
          ? ({ kind: "error", exitCode: 1, stderr: "boom" } as const)
          : ({ kind: "ok", stdout: "ok", stderr: "" } as const),
      ),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [implementStep, reviewStep], stateStore: store });

      expect(result).toMatchObject({
        kind: "invocation_failure",
        stepIndex: 1,
        stepId: "implement-review",
        resumable: false,
      });
    });
  });

  test("commits review actuator edits with the same completion committer as implement", async () => {
    const published: Array<{ specPath: string; agent: string }> = [];
    const committedVerdicts: string[] = [];
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "implement-review-commit",
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );

    const reviewStep = createPatchReviewDebateStep({
      branchName: implementStep.worktree.branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => {
        if (adapterModel === "ACT") {
          writeFileSync(join(worktreePath, "review-edit.txt"), "applied\n", "utf8");
        }
        return {
          kind: "ok",
          stdout: adapterModel === "ADJ" ? "apply review edit" : "done",
          stderr: "",
        } as const;
      }),
    });
    reviewStep.profileContext = {
      specPath: "spec.md",
      cwd: reviewStep.cwd,
      baseBranch: "HEAD",
      passNumber: 1,
      totalPasses: 1,
    };

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: async (input) => {
          published.push({ specPath: input.specPath, agent: input.agent });
          committedVerdicts.push(readFileSync(join(worktreePath, "verdict-patch.md"), "utf8"));
          return { commitSha: "review-commit", filesChanged: 1 };
        },
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result).toMatchObject({ kind: "complete", commitSha: "review-commit" });
      expect(published.at(-1)).toEqual({ specPath: "spec.md", agent: "claude" });
      expect(committedVerdicts.at(-1)).toBe("apply review edit");
    });
  });

  test("labels debate review commits by workflow pass", async () => {
    // @mutate v2/src/execution/completion-commit.ts "return `review-debate(${step.pass}): ${title}`;" -> "return title;"
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "debate-review-labels-pass",
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );

    const reviewStep = createPatchReviewDebateStep({
      branchName: implementStep.worktree.branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => {
        if (adapterModel === "ACT") {
          writeFileSync(join(worktreePath, "review-edit.txt"), "applied\n", "utf8");
        }
        return {
          kind: "ok",
          stdout: adapterModel === "ADJ" ? "apply review edit" : "done",
          stderr: "",
        } as const;
      }),
    });
    reviewStep.profileContext = {
      specPath: "spec.md",
      cwd: reviewStep.cwd,
      baseBranch: "HEAD",
      passNumber: 1,
      totalPasses: 1,
    };

    const commits: Array<{ title: string; step: unknown }> = [];
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: async (input) => {
          commits.push({ title: input.title, step: input.step });
          return { commitSha: "review-commit", filesChanged: 1 };
        },
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result).toMatchObject({ kind: "complete", commitSha: "review-commit" });
      expect(commits.at(-1)).toEqual({
        title: "review-debate(1): spec.md",
        step: { kind: "review-debate", pass: 1 },
      });
    });
  });

  test("settles a surviving-mutation failure on the durable review-debate step's own row, not the implement step's", async () => {
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "implement-review-durable-settle",
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );

    const reviewStep = createPatchReviewDebateStep({
      branchName: implementStep.worktree.branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => ({
        kind: "ok",
        stdout: adapterModel === "ADJ" ? "" : "ok",
        stderr: "",
      })),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "implement-commit-sha", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new SurvivingMutationError("operator-flip: === → !==", "src/guard.ts", 17);
        },
      });

      expect(result.kind).toBe("surviving_mutation_failed");
      const reviewRun = store.findRunByProjectBranch({
        project: "demo",
        branch: implementStep.worktree.branchName,
        stepId: "implement-review",
      });
      const implementRun = store.findRunByProjectBranch({
        project: "demo",
        branch: implementStep.worktree.branchName,
        stepId: "implement",
      });
      expect(reviewRun).not.toBeNull();
      expect(reviewRun?.id).toBe(result.runId);
      expect(implementRun?.id).not.toBe(result.runId);
      expect(store.loadRun(result.runId)?.status).toBe("failed");
    });
  });

  test("settles review-debate timeout after committed implement write step as exhausted, non-resumable, and preserves commit and verdict", async () => {
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "implement-review-timeout",
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );
    const boundMs = 5;
    const reviewStep = createPatchReviewDebateStep({
      branchName: implementStep.worktree.branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      roleTimeoutMs: boundMs,
      createBinding: createReviewDebateActuatorFailureBindingFactory("timeout"),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "implement-commit-sha", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result).toMatchObject({
        kind: "invocation_failure",
        stepIndex: 1,
        stepId: "implement-review",
        resumable: false,
      });
      expect(readFileSync(join(worktreePath, "verdict-patch.md"), "utf8")).toBe("apply this fix");
      expect(store.loadRun(result.runId)?.attempts.at(-1)?.invocationFailureDetail).toMatchObject({
        failureKind: "timeout",
        role: "actuator",
        boundMs,
        exhaustedRoleTimeout: true,
        bindingAttempts: [{ resultKind: "timeout", agent: "claude", model: "ACT" }],
      });
    });
  });

  function createTrackedReviewDebateBindingFactory(
    calls: string[],
    actuatorFailureKind: "timeout" | "stall" | undefined,
    actuatorPrompts?: string[],
  ): NonNullable<ReviewDebateWorkflowStep["createBinding"]> {
    return ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => ({
      id: `${agentId}/${adapterModel}`,
      metadata: { agent: agentId, model: adapterModel },
      invoke: ({ signal, prompt }) => {
        calls.push(adapterModel);
        if (adapterModel === "ACT") actuatorPrompts?.push(prompt);
        if (adapterModel !== "ACT") {
          return Promise.resolve(
            adapterModel === "ADJ"
              ? ({ kind: "ok", stdout: "apply this fix", stderr: "" } as const)
              : ({ kind: "ok", stdout: "ok", stderr: "" } as const),
          );
        }
        if (actuatorFailureKind === "stall") {
          return Promise.resolve({ kind: "stall", stderr: "no output" } as const);
        }
        if (actuatorFailureKind === "timeout") {
          return new Promise<InvocationResult>((resolve) => {
            signal?.addEventListener("abort", () => resolve({ kind: "error", exitCode: 1, stderr: "aborted" }), {
              once: true,
            });
          });
        }
        return Promise.resolve({ kind: "ok", stdout: "actuated", stderr: "" } as const);
      },
    });
  }

  function runActuatorOnlyRetryTest(failureKind: "stall"): void {
    test(`re-dispatching after review-debate actuator ${failureKind} retries only the actuator, skipping write, shrink, and debate roles`, async () => {
      const branchName = `implement-review-${failureKind}-actuator-only`;
      const writeCalls: string[] = [];
      const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
        writeCalls.push(shrink ? "shrink" : "implement");
        if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" };
      });
      const worktreePath = harness.workspace;
      const boundMs = 5;
      const debateCalls: string[] = [];
      const actuatorPrompts: string[] = [];
      const reviewStep = createPatchReviewDebateStep({
        branchName,
        jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
        verdictPath: join(worktreePath, "verdict-patch.md"),
        cwd: worktreePath,
        roleTimeoutMs: boundMs,
        createBinding: createTrackedReviewDebateBindingFactory(debateCalls, failureKind, actuatorPrompts),
      });

      await withStateStore(async (store) => {
        const firstResult = await executeWorkflow({
          steps: [implementStep, reviewStep],
          stateStore: store,
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
        });

        expect(firstResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: true });
        expect(writeCalls).toEqual(["implement", "shrink"]);
        expect(debateCalls).toEqual(["ADV", "ADVOC", "ADJ", "ACT"]);

        const firstReviewRun = store.findRunByProjectBranch({
          project: "demo",
          branch: branchName,
          stepId: "implement-review",
        });
        expect(firstReviewRun?.attempts.length).toBe(1);
        const verdictBefore = readFileSync(join(worktreePath, "verdict-patch.md"), "utf8");

        writeCalls.length = 0;
        debateCalls.length = 0;

        const secondResult = await executeWorkflow({
          steps: [implementStep, reviewStep],
          stateStore: store,
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
        });

        expect(secondResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: true });
        expect(writeCalls).toEqual([]);
        expect(debateCalls).toEqual(["ACT"]);
        expect(readFileSync(join(worktreePath, "verdict-patch.md"), "utf8")).toBe(verdictBefore);

        const secondReviewRun = store.findRunByProjectBranch({
          project: "demo",
          branch: branchName,
          stepId: "implement-review",
        });
        expect(secondReviewRun?.id).toBe(firstReviewRun?.id);
        expect(secondReviewRun?.attempts.length).toBe(2);

        // Prompt parity: the retried actuator goes through the same configured
        // `profile.render.actuator` template as the first attempt, fed the unchanged verdict.
        expect(actuatorPrompts).toHaveLength(2);
        expect(actuatorPrompts[1]).toBe(actuatorPrompts[0]);
        expect(actuatorPrompts[1]).toContain(verdictBefore);
      });
    });
  }

  runActuatorOnlyRetryTest("stall");

  test("propagates review idleOutputMs through actuator-only debate retry", async () => {
    const captured = new Map<number, number[]>();

    for (const idleOutputMs of [12_345, 0]) {
      const branchName = `implement-review-idle-retry-${idleOutputMs}`;
      const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
        if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" };
      });
      const calls: string[] = [];
      const retryIdleOutputMs: number[] = [];
      let retried = false;
      const reviewStep = createPatchReviewDebateStep({
        branchName,
        jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
        verdictPath: join(harness.workspace, "verdict-patch.md"),
        cwd: harness.workspace,
        idleOutputMs,
        createBinding: ({ agentId, adapterModel }) => ({
          id: `${agentId}/${adapterModel}`,
          metadata: { agent: agentId, model: adapterModel },
          invoke: async ({ idleOutputMs: observedIdleOutputMs }) => {
            calls.push(adapterModel);
            if (retried) retryIdleOutputMs.push(observedIdleOutputMs ?? -1);
            if (adapterModel !== "ACT") {
              return {
                kind: "ok",
                stdout: adapterModel === "ADJ" ? "apply this fix" : "ok",
                stderr: "",
              } as const;
            }
            return { kind: "stall", stderr: "no output" } as const;
          },
        }),
      });

      await withStateStore(async (store) => {
        await executeWorkflow({
          steps: [implementStep, reviewStep],
          stateStore: store,
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
        });
        calls.length = 0;
        retried = true;
        await executeWorkflow({
          steps: [implementStep, reviewStep],
          stateStore: store,
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({}),
          readyFinalizer: async () => {},
        });
      });

      expect(calls).toEqual(["ACT"]);
      captured.set(idleOutputMs, retryIdleOutputMs);
    }

    expect(captured).toEqual(
      new Map([
        [12_345, [12_345]],
        [0, [0]],
      ]),
    );
  });

  test("exhausted review-debate actuator timeout is not actuator-only-retry eligible; re-dispatch replays the full debate on a fresh row", async () => {
    const branchName = "implement-review-timeout-not-actuator-only";
    const writeCalls: string[] = [];
    const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      writeCalls.push(shrink ? "shrink" : "implement");
      if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const worktreePath = harness.workspace;
    const boundMs = 5;
    const debateCalls: string[] = [];
    const reviewStep = createPatchReviewDebateStep({
      branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      roleTimeoutMs: boundMs,
      createBinding: createTrackedReviewDebateBindingFactory(debateCalls, "timeout"),
    });

    await withStateStore(async (store) => {
      const firstResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(firstResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });

      const firstReviewRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement-review",
      });

      writeCalls.length = 0;
      debateCalls.length = 0;

      const secondResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(secondResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });
      // Not actuator-only: the full debate chain replays, not just the actuator.
      expect(debateCalls).toEqual(["ADV", "ADVOC", "ADJ", "ACT"]);

      const secondReviewRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement-review",
      });
      expect(secondReviewRun?.id).not.toBe(firstReviewRun?.id);
    });
  });

  test("re-dispatching after actuator stall with verdictPath removed fails naming verdictPath", async () => {
    const branchName = "implement-review-stall-missing-verdict";
    const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const worktreePath = harness.workspace;
    const verdictPath = join(worktreePath, "verdict-patch.md");
    const boundMs = 5;
    const reviewStep = createPatchReviewDebateStep({
      branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath,
      cwd: worktreePath,
      roleTimeoutMs: boundMs,
      createBinding: createReviewDebateActuatorFailureBindingFactory("stall"),
    });

    await withStateStore(async (store) => {
      const firstResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(firstResult).toMatchObject({ kind: "invocation_failure", resumable: true });

      rmSync(verdictPath);
      const secondResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(secondResult).toMatchObject({ kind: "invocation_failure", resumable: false });
      expect(secondResult.invocationFailureMessage).toContain(verdictPath);
    });
  });

  test("re-dispatching after actuator stall with verdictPath emptied fails naming verdictPath", async () => {
    const branchName = "implement-review-stall-empty-verdict";
    const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const worktreePath = harness.workspace;
    const verdictPath = join(worktreePath, "verdict-patch.md");
    const boundMs = 5;
    const reviewStep = createPatchReviewDebateStep({
      branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath,
      cwd: worktreePath,
      roleTimeoutMs: boundMs,
      createBinding: createReviewDebateActuatorFailureBindingFactory("stall"),
    });

    await withStateStore(async (store) => {
      const firstResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(firstResult).toMatchObject({ kind: "invocation_failure", resumable: true });

      writeFileSync(verdictPath, "   \n", "utf8");
      const secondResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(secondResult).toMatchObject({ kind: "invocation_failure", resumable: false });
      expect(secondResult.invocationFailureMessage).toContain(verdictPath);
    });
  });

  test("re-dispatching after review-debate actuator stall succeeds on retry, completing the step", async () => {
    const branchName = "implement-review-stall-actuator-succeeds";
    const writeCalls: string[] = [];
    const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      writeCalls.push(shrink ? "shrink" : "implement");
      if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const worktreePath = harness.workspace;
    const boundMs = 5;
    const debateCalls: string[] = [];
    const actuatorPrompts: string[] = [];
    let actuatorAttempts = 0;
    const reviewStep = createPatchReviewDebateStep({
      branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      roleTimeoutMs: boundMs,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: ({ prompt }) => {
          debateCalls.push(adapterModel);
          if (adapterModel !== "ACT") {
            return Promise.resolve(
              adapterModel === "ADJ"
                ? ({ kind: "ok", stdout: "apply this fix", stderr: "" } as const)
                : ({ kind: "ok", stdout: "ok", stderr: "" } as const),
            );
          }
          actuatorPrompts.push(prompt);
          actuatorAttempts += 1;
          if (actuatorAttempts === 1) {
            return Promise.resolve({ kind: "stall", stderr: "no output" } as const);
          }
          return Promise.resolve({ kind: "ok", stdout: "actuated", stderr: "" } as const);
        },
      }),
    });

    await withStateStore(async (store) => {
      const firstResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(firstResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: true });

      const firstReviewRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement-review",
      });
      const verdictBefore = readFileSync(join(worktreePath, "verdict-patch.md"), "utf8");

      writeCalls.length = 0;
      debateCalls.length = 0;

      const secondResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(secondResult).toMatchObject({
        kind: "complete",
        stepIndex: 1,
        resumable: false,
      });
      expect(writeCalls).toEqual([]);
      expect(debateCalls).toEqual(["ACT"]);
      expect(readFileSync(join(worktreePath, "verdict-patch.md"), "utf8")).toBe(verdictBefore);

      const secondReviewRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement-review",
      });
      expect(secondReviewRun?.id).toBe(firstReviewRun?.id);
      expect(secondReviewRun?.status).toBe("completed");
      expect(secondReviewRun?.attempts.length).toBe(2);
      expect(secondReviewRun?.attempts.at(-1)?.completionAgent).toBe("claude");

      expect(actuatorPrompts).toHaveLength(2);
      expect(actuatorPrompts[1]).toBe(actuatorPrompts[0]);
      expect(actuatorPrompts[1]).toContain(verdictBefore);
    });
  });

  test("re-dispatching after a debate-role failure replays the full debate, not actuator-only", async () => {
    const branchName = "implement-review-adversary-timeout-redispatch";
    const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const worktreePath = harness.workspace;
    const boundMs = 5;
    const debateCalls: string[] = [];
    const reviewStep = createPatchReviewDebateStep({
      branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      roleTimeoutMs: boundMs,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: ({ signal }) => {
          debateCalls.push(adapterModel);
          if (adapterModel !== "ADV") {
            return Promise.resolve(
              adapterModel === "ADJ"
                ? ({ kind: "ok", stdout: "apply this fix", stderr: "" } as const)
                : ({ kind: "ok", stdout: "ok", stderr: "" } as const),
            );
          }
          return new Promise<InvocationResult>((resolve) => {
            signal?.addEventListener("abort", () => resolve({ kind: "error", exitCode: 1, stderr: "aborted" }), {
              once: true,
            });
          });
        },
      }),
    });

    await withStateStore(async (store) => {
      const firstResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(firstResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });
      expect(debateCalls).toEqual(["ADV"]);
      expect(store.loadRun(firstResult.runId)?.attempts.at(-1)?.invocationFailureDetail?.role).not.toBe("actuator");

      debateCalls.length = 0;
      const secondResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(secondResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });
      // Debate-role failures are not actuator-only eligible; the full debate replays.
      expect(debateCalls).toEqual(["ADV"]);
      // Distinguishing property from the actuator-only path: a fresh run row per re-dispatch.
      expect(secondResult.runId).not.toBe(firstResult.runId);
    });
  });

  test("multi-cycle review never takes actuator-only admission, even on a last-cycle actuator failure", async () => {
    const branchName = "implement-review-multi-cycle-actuator-timeout";
    const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (!shrink) writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const worktreePath = harness.workspace;
    const boundMs = 5;
    const debateCalls: string[] = [];
    const reviewStep = createPatchReviewDebateStep({
      branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      roleTimeoutMs: boundMs,
      maxCycles: 2,
      createBinding: createTrackedReviewDebateBindingFactory(debateCalls, "timeout"),
    });

    await withStateStore(async (store) => {
      const firstResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(firstResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });
      expect(debateCalls).toEqual(["ADV", "ADVOC", "ADJ", "ACT"]);
      expect(store.loadRun(firstResult.runId)?.attempts.at(-1)?.invocationFailureDetail).toMatchObject({
        role: "actuator",
        failureKind: "timeout",
      });

      debateCalls.length = 0;
      const secondResult = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(secondResult).toMatchObject({ kind: "invocation_failure", stepIndex: 1, resumable: false });
      // maxCycles > 1 rules out actuator-only admission; the full debate replays on a fresh row.
      expect(debateCalls).toEqual(["ADV", "ADVOC", "ADJ", "ACT"]);
      expect(secondResult.runId).not.toBe(firstResult.runId);
    });
  });

  test("post-commit review retryability settle admits non-exhausted timeout and stall", () => {
    for (const failureKind of ["timeout", "stall"] as const) {
      expect(isPostCommitReviewRetryableFailureKind({ failureKind })).toBe(true);
    }
    const timeoutOnly = (failureKind: InvocationFailureKind) => failureKind === "timeout";
    expect(isPostCommitReviewRetryableFailureKind({ failureKind: "stall" })).not.toBe(timeoutOnly("stall"));
    expect(isPostCommitReviewRetryableFailureKind({ failureKind: "error" })).toBe(false);
    expect(isPostCommitReviewRetryableFailureKind({ failureKind: "timeout", exhaustedRoleTimeout: true })).toBe(false);
  });

  test("settles review-debate stall after committed implement write step with resumable=true and preserves commit and verdict", async () => {
    const branchName = "implement-review-stall";
    const { harness, step: implementStep } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (shrink) return { kind: "ok", stdout: "done", stderr: "" };
      writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const worktreePath = harness.workspace;
    const reviewStep = createPatchReviewDebateStep({
      branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      createBinding: createReviewDebateActuatorFailureBindingFactory("stall"),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result).toMatchObject({
        kind: "invocation_failure",
        stepIndex: 1,
        stepId: "implement-review",
        resumable: true,
      });
      expect(execFileSync("git", ["show", "HEAD:proof.txt"], { cwd: worktreePath, encoding: "utf8" })).toBe(
        "implemented\n",
      );
      expect(readFileSync(join(worktreePath, "verdict-patch.md"), "utf8")).toBe("apply this fix");
      expect(store.loadRun(result.runId)?.attempts.at(-1)?.invocationFailureDetail).toMatchObject({
        failureKind: "stall",
        message: "review: actuator invocation failed (stall)",
      });
    });
  });

  test("non-timeout review-debate failures remain resumable=false", async () => {
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "implement-review-error",
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );

    const reviewStep = createPatchReviewDebateStep({
      branchName: implementStep.worktree.branchName,
      jarvisRoot: implementStep.worktree.jarvisRoot ?? "",
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      createBinding: createDebateBindingFactory(async ({ adapterModel }) =>
        adapterModel === "ADV"
          ? ({ kind: "error", exitCode: 1, stderr: "boom" } as const)
          : ({ kind: "ok", stdout: "ok", stderr: "" } as const),
      ),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "implement-commit-sha", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result).toMatchObject({
        kind: "invocation_failure",
        stepIndex: 1,
        stepId: "implement-review",
        resumable: false,
      });
    });
  });
});
