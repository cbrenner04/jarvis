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

describe("executeWorkflow implement patch light review", () => {
  const LIGHT_REVIEW_AGENT_MODEL_CONFIG: AgentModelConfig = {
    claude: {
      critic: { rungs: [{ adapterModel: "CRIT", priceKey: "p-crit" }] },
      actuator: { rungs: [{ adapterModel: "ACT", priceKey: "p-act" }] },
    },
  };

  function createLightReviewBindingFactory(
    invoke: (binding: {
      agentId: string;
      adapterModel: string;
      prompt: string;
      cwd: string;
    }) => Promise<InvocationResult>,
  ): NonNullable<ReviewWorkflowStep["createBinding"]> {
    return ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => ({
      id: `${agentId}/${adapterModel}`,
      invoke: ({ prompt, cwd }) => invoke({ agentId, adapterModel, prompt, cwd }),
      metadata: { agent: agentId, model: adapterModel },
    });
  }

  function createPatchLightReviewStep(args: {
    branchName: string;
    verdictPath: string;
    cwd: string;
    createBinding?: ReviewWorkflowStep["createBinding"];
    maxCycles?: number;
  }): ReviewWorkflowStep {
    return {
      behavior: "review",
      stepId: "implement-review",
      project: "demo",
      branch: args.branchName,
      cwd: args.cwd,
      prompt: "implement.prompt.review.critic",
      verdictPath: args.verdictPath,
      maxCycles: args.maxCycles ?? 1,
      agents: { critic: ["claude"], actuator: ["claude"] },
      agentModelConfig: LIGHT_REVIEW_AGENT_MODEL_CONFIG,
      profile: implementReviewPromptProfile,
      profileContext: { specPath: "index.md", cwd: "/fake", baseBranch: "HEAD", passNumber: 1, totalPasses: 1 },
      ...(args.createBinding !== undefined ? { createBinding: args.createBinding } : {}),
    };
  }

  test("runs critic-actuator cycles with rendered patch prompts and retains reviewPasses", async () => {
    const prompts: string[] = [];
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "implement-patch-light-review",
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: async ({ prompt, cwd }) => {
          prompts.push(prompt.includes("Post-completion Shrink") ? "shrink" : "implement");
          writeFileSync(`${cwd}/proof.txt`, "ok\n", "utf8");
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
    const actuatorPrompts: string[] = [];
    const reviewStep = createPatchLightReviewStep({
      branchName: implementStep.worktree.branchName,
      verdictPath,
      cwd: worktreePath,
      maxCycles: 2,
      createBinding: createLightReviewBindingFactory(async ({ adapterModel, prompt, cwd }) => {
        if (adapterModel === "CRIT") {
          prompts.push("critic");
          if (prompts.filter((entry) => entry === "critic").length === 1) {
            writeFileSync(join(cwd, "critic-edit.txt"), "oops\n");
            return { kind: "ok", stdout: "fix it", stderr: "" } as const;
          }
          return { kind: "ok", stdout: "", stderr: "" } as const;
        }
        actuatorPrompts.push(prompt);
        return { kind: "ok", stdout: "done", stderr: "" } as const;
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
      expect(prompts.indexOf("implement")).toBeLessThan(prompts.indexOf("shrink"));
      expect(prompts.some((entry) => entry === "critic")).toBe(true);
      expect(actuatorPrompts[0]).toContain("Review Actuator Rules");
      expect(actuatorPrompts[0]).toContain("fix it");
      expect(readFileSync(join(worktreePath, "critic-edit.txt"), "utf8")).toBe("oops\n");
      expect(readFileSync(verdictPath, "utf8")).toBe("");
      const run = store.findRunByProjectBranch({
        project: "demo",
        branch: implementStep.worktree.branchName,
        stepId: "implement",
      });
      expect(run?.workflowSnapshot?.reviewPasses).toBe(2);
    });
  });

  test("labels a light review mutation commit by workflow pass", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "isReviewLastStep && lastResult.reviewPass !== undefined" -> "false"
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "light-review-labels-pass",
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );
    const reviewStep = createPatchLightReviewStep({
      branchName: implementStep.worktree.branchName,
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      createBinding: createLightReviewBindingFactory(async ({ adapterModel }) => {
        if (adapterModel === "CRIT") return { kind: "ok", stdout: "fix it", stderr: "" } as const;
        return { kind: "ok", stdout: "done", stderr: "" } as const;
      }),
    });

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
      expect(commits.at(-1)).toEqual({ title: "review(1): spec.md", step: { kind: "review", pass: 1 } });
    });
  });

  test("skips patch light review when linked index is already complete", async () => {
    const reviewCalls: string[] = [];
    const branchName = "implement-light-review-skip";
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

    const reviewStep = createPatchLightReviewStep({
      branchName,
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      createBinding: createLightReviewBindingFactory(async () => {
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

  test("fails role validation before invocation when critic or actuator bindings are missing", async () => {
    const step: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "implement-review",
      project: "demo",
      branch: "implement-light-review-invalid",
      cwd: "/fake",
      prompt: "implement.prompt.review.critic",
      verdictPath: "/fake/verdict.md",
      maxCycles: 1,
      agents: { critic: ["codex"], actuator: ["codex"] },
      agentModelConfig: { codex: {} },
      profile: implementReviewPromptProfile,
      profileContext: { specPath: "spec.md", cwd: "/fake", baseBranch: "HEAD", passNumber: 1, totalPasses: 1 },
    };

    await withStateStore(async (store) => {
      await expect(executeWorkflow({ steps: [step], stateStore: store })).rejects.toThrow(
        "(implement-review, critic, codex), (implement-review, actuator, codex)",
      );
      expect(store.listRuns()).toHaveLength(0);
    });
  });

  function createPassingLightReviewStep(branchName: string, worktreePath: string): ReviewWorkflowStep {
    return createPatchLightReviewStep({
      branchName,
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      createBinding: createLightReviewBindingFactory(async () => ({ kind: "ok", stdout: "", stderr: "" }) as const),
    });
  }

  test("redirects a failed publication tail to the implement step's shrink row when the last step is a non-durable review", async () => {
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "publish-light-review-shrink",
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );
    const reviewStep = createPassingLightReviewStep(implementStep.worktree.branchName, worktreePath);
    const logSink = new TestLogSink();

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new SurvivingMutationError("operator-flip: === → !==", "src/guard.ts", 17);
        },
      });

      expect(result.kind).toBe("surviving_mutation_failed");
      expect(result.resumable).toBe(true);

      const shrinkRun = store.findRunByProjectBranch({
        project: "demo",
        branch: implementStep.worktree.branchName,
        stepId: "implement~shrink",
      });
      expect(shrinkRun).not.toBeNull();
      expect(shrinkRun?.id).toBe(result.runId);
      expect(store.loadRun(result.runId)?.status).toBe("failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "surviving_mutation_failed",
        resumable: true,
        survivingMutation: "operator-flip: === → !==",
        survivingMutationSourceFile: "src/guard.ts",
        survivingMutationSourceLine: 17,
      });
    });
  });

  test("wait on the redirected durable row reports surviving_mutation_failed with resume detail", async () => {
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "publish-light-review-wait",
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );
    const reviewStep = createPassingLightReviewStep(implementStep.worktree.branchName, worktreePath);
    const logsPath = join(mkdtempSync(join(tmpdir(), "workflow-redirect-wait-")), "logs.jsonl");
    const logSink = openLogSink(logsPath);

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new SurvivingMutationError("operator-flip: === → !==", "src/guard.ts", 17);
        },
      });

      expect(result.kind).toBe("surviving_mutation_failed");
      installWorkflowRunnerResumeProfile();
      const handlers = createRunControlHandlers({
        stateStore: store,
        logReader: openLogReader(logsPath),
        writeLoopExecutor: async () => undefined,
        failureReporter: () => undefined,
        hasMemoryHeadroom: () => true,
        settleDelayMs: 0,
      });
      try {
        const frame = await handlers.wait(
          { kind: "request", id: "wait", method: "wait", params: { runId: result.runId } },
          new AbortController().signal,
        );
        expect(frame.kind).toBe("response");
        if (frame.kind !== "response") throw new Error("not a response");
        expect(frame.result).toMatchObject({
          runStatus: "failed",
          error: {
            reason: "surviving_mutation_failed",
            retryable: true,
            nextAction: "resume",
            survivingMutation: "operator-flip: === → !==",
            survivingMutationSourceFile: "src/guard.ts",
            survivingMutationSourceLine: 17,
          },
        });
      } finally {
        handlers.close();
        resetWriteLoopBindingSourceDepsForTests();
      }
    });
  });

  test("redirects a failed publication tail to the implement step's own row when no shrink row exists", async () => {
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "publish-light-review-no-shrink",
      suppressShrink: true,
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );
    const reviewStep = createPassingLightReviewStep(implementStep.worktree.branchName, worktreePath);

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new SurvivingMutationError("operator-flip: === → !==", "src/guard.ts", 17);
        },
      });

      expect(result.kind).toBe("surviving_mutation_failed");
      const shrinkRun = store.findRunByProjectBranch({
        project: "demo",
        branch: implementStep.worktree.branchName,
        stepId: "implement~shrink",
      });
      expect(shrinkRun).toBeNull();
      const implementRun = store.findRunByProjectBranch({
        project: "demo",
        branch: implementStep.worktree.branchName,
        stepId: "implement",
      });
      expect(implementRun).not.toBeNull();
      expect(implementRun?.id).toBe(result.runId);
      expect(store.loadRun(result.runId)?.status).toBe("failed");
    });
  });

  test("settles the redirected durable row completed when a non-durable review's publication succeeds", async () => {
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "publish-light-review-success",
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );
    const reviewStep = createPassingLightReviewStep(implementStep.worktree.branchName, worktreePath);

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      const shrinkRun = store.findRunByProjectBranch({
        project: "demo",
        branch: implementStep.worktree.branchName,
        stepId: "implement~shrink",
      });
      expect(shrinkRun).not.toBeNull();
      expect(shrinkRun?.id).toBe(result.runId);
      expect(store.loadRun(result.runId)?.status).toBe("completed");
    });
  });

  test("labels only review passes that commit changes", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "isReviewLastStep && lastResult.reviewPass !== undefined" -> "isReviewLastStep"
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "light-review-no-label-approval",
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );
    const reviewStep = createPassingLightReviewStep(implementStep.worktree.branchName, worktreePath);
    const reviewCommits: Array<{ title: string; step: unknown }> = [];
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: async (input) => {
          reviewCommits.push({ title: input.title, step: input.step });
          return { commitSha: "commit-1" };
        },
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(reviewCommits.at(-1)).toEqual({ title: "spec.md", step: undefined });
    });

    const writeOnlyStep = createStep({
      stepId: "write",
      role: "implement",
      branchName: "light-review-no-label-write-only",
      suppressShrink: true,
    });
    const writeOnlyCommits: Array<{ title: string; step: unknown }> = [];
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [writeOnlyStep],
        stateStore: store,
        completionCommitter: async (input) => {
          writeOnlyCommits.push({ title: input.title, step: input.step });
          return { commitSha: "commit-2" };
        },
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(writeOnlyCommits.at(-1)).toEqual({ title: "spec.md", step: undefined });
    });
  });

  test("attributes a delayed review publication to its last mutating pass", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "return { pass: index + 1, agent: actuatorAgent(cycle as Extract<C, { kind: \"completed\" }>) };" -> "return { pass: cycles.length, agent: actuatorAgent(cycle as Extract<C, { kind: \"completed\" }>) };"
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "light-review-delayed-attribution",
    });
    const worktreePath = join(
      implementStep.worktree.jarvisRoot ?? "",
      "worktrees",
      implementStep.worktree.projectName,
      implementStep.worktree.branchName,
    );
    const reviewStep = createPatchLightReviewStep({
      branchName: implementStep.worktree.branchName,
      verdictPath: join(worktreePath, "verdict-patch.md"),
      cwd: worktreePath,
      maxCycles: 2,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: (() => {
          let criticCalls = 0;
          return async ({ prompt, cwd }: { prompt: string; cwd: string }) => {
            if (adapterModel === "CRIT") {
              criticCalls += 1;
              if (criticCalls === 1) {
                writeFileSync(join(cwd, "critic-edit.txt"), "oops\n", "utf8");
                return { kind: "ok", stdout: "fix it", stderr: "" } as const;
              }
              return { kind: "ok", stdout: "", stderr: "" } as const;
            }
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          };
        })(),
        metadata: { agent: adapterModel === "ACT" ? "pass-1-actuator" : agentId, model: adapterModel },
      }),
    });

    const commits: Array<{ title: string; step: unknown; agent: string }> = [];
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        completionCommitter: async (input) => {
          commits.push({ title: input.title, step: input.step, agent: input.agent });
          return { commitSha: "review-commit", filesChanged: 1 };
        },
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result).toMatchObject({ kind: "complete", commitSha: "review-commit" });
      expect(commits.at(-1)).toEqual({
        title: "review(1): spec.md",
        step: { kind: "review", pass: 1 },
        agent: "pass-1-actuator",
      });
    });
  });
});

describe("executeWorkflow review actuator staged Markdown lint", () => {
  test("review actuator staged Markdown lint violation blocks completion before landing", async () => {
    // @mutate v2/src/execution/reviewed-staged-markdown-lint.ts "if (result.kind === \"clean\") return { kind: \"pass\" };" -> "if (true) return { kind: \"pass\" };"
    if (
      skipReviewWithoutHarnessMarkdownlint(
        "review actuator staged Markdown lint violation blocks completion before landing",
      )
    ) {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "workflow-review-md-lint-block-"));
    roots.push(root);
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed-md-lint-block");
    const violationBytes = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-violation-subspec.md"), "utf8");
    writeLintCleanPlanStage(stage);

    const step = createDebateStep({
      stepId: "review-debate-md-lint-block",
      cwd: root,
      branch: "review-md-lint-block",
      verdictPath: join(stage, "verdict-plan.md"),
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
      stagedMarkdownLintMaxReprompts: 0,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async ({ cwd }) => {
          if (adapterModel === "ACT") {
            writeFileSync(join(cwd, ".jarvis-plan-stage", "00-one.md"), violationBytes, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          }
          return adapterModel === "ADJ"
            ? ({ kind: "ok", stdout: "apply fix", stderr: "" } as const)
            : ({ kind: "ok", stdout: "ok", stderr: "" } as const);
        },
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });
      expect(result.kind).toBe("landing_failed");
      expect(store.loadRun(result.runId)?.attempts.at(-1)?.outcomeKind).toBe("landing_failed");
      expect(store.loadRun(result.runId)?.attempts.some((attempt) => attempt.outcomeKind === "done")).toBe(false);
      expect(existsSync(durable)).toBe(false);
      expect(existsSync(join(stage, "00-one.md"))).toBe(true);
      expect(readFileSync(join(stage, "00-one.md"), "utf8")).toBe(violationBytes);
    });
  });

  test("review actuator staged Markdown lint violation reprompts before completion", async () => {
    if (
      skipReviewWithoutHarnessMarkdownlint("review actuator staged Markdown lint violation reprompts before completion")
    ) {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "workflow-review-md-lint-reprompt-"));
    roots.push(root);
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed-md-lint-reprompt");
    const violationBytes = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-violation-subspec.md"), "utf8");
    const cleanSubspec = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-clean-subspec.md"), "utf8");
    writeLintCleanPlanStage(stage);
    let actuatorInvocations = 0;
    let repromptPrompt = "";

    const step = createDebateStep({
      stepId: "review-debate-md-lint-reprompt",
      cwd: root,
      branch: "review-md-lint-reprompt",
      verdictPath: join(stage, "verdict-plan.md"),
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
      stagedMarkdownLintMaxReprompts: 2,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async ({ cwd, prompt }) => {
          if (adapterModel === "ACT") {
            actuatorInvocations += 1;
            const stageDir = join(cwd, ".jarvis-plan-stage");
            if (actuatorInvocations === 1) {
              writeFileSync(join(stageDir, "00-one.md"), violationBytes, "utf8");
            } else {
              repromptPrompt = prompt;
              writeFileSync(join(stageDir, "00-one.md"), cleanSubspec, "utf8");
            }
            return { kind: "ok", stdout: "done", stderr: "" };
          }
          return adapterModel === "ADJ"
            ? ({ kind: "ok", stdout: "apply fix", stderr: "" } as const)
            : ({ kind: "ok", stdout: "ok", stderr: "" } as const);
        },
      }),
    });

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
      expect(result.kind).toBe("complete");
      expect(actuatorInvocations).toBe(2);
      expect(existsSync(join(durable, "00-one.md"))).toBe(true);
      const reprompt = logSink
        .getEventsForRun(result.runId)
        .find((event) => event.kind === "staged_markdown_lint_reprompt");
      expect(reprompt).toMatchObject({
        kind: "staged_markdown_lint_reprompt",
        ruleId: "MD038",
        offendingFile: ".jarvis-plan-stage/00-one.md",
      });
      expect(repromptPrompt).toContain("MD038");
      expect(repromptPrompt).toContain(".jarvis-plan-stage/00-one.md");
      expect(repromptPrompt).toContain(".jarvis-plan-stage");
    });
  });

  test("review actuator staged Markdown lint exhaustion settles landing_failed with preserved stage", async () => {
    if (
      skipReviewWithoutHarnessMarkdownlint(
        "review actuator staged Markdown lint exhaustion settles landing_failed with preserved stage",
      )
    ) {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "workflow-review-md-lint-exhaust-"));
    roots.push(root);
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed-md-lint-exhaust");
    const violationBytes = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-violation-subspec.md"), "utf8");
    writeLintCleanPlanStage(stage);

    const step = createDebateStep({
      stepId: "review-debate-md-lint-exhaust",
      cwd: root,
      branch: "review-md-lint-exhaust",
      verdictPath: join(stage, "verdict-plan.md"),
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
      stagedMarkdownLintMaxReprompts: 2,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async ({ cwd }) => {
          if (adapterModel === "ACT") {
            writeFileSync(join(cwd, ".jarvis-plan-stage", "00-one.md"), violationBytes, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          }
          return adapterModel === "ADJ"
            ? ({ kind: "ok", stdout: "apply fix", stderr: "" } as const)
            : ({ kind: "ok", stdout: "ok", stderr: "" } as const);
        },
      }),
    });

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
      expect(result.kind).toBe("landing_failed");
      expect(result.resumable).toBe(true);
      expect(store.loadRun(result.runId)?.attempts.at(-1)?.outcomeKind).toBe("landing_failed");
      expect(store.loadRun(result.runId)?.attempts.some((attempt) => attempt.outcomeKind === "done")).toBe(false);
      expect(existsSync(durable)).toBe(false);
      expect(readFileSync(join(stage, "00-one.md"), "utf8")).toBe(violationBytes);
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "landing_failed",
        resumable: true,
      });
    });
  });

  test("review actuator staged Markdown lint exhaustion checkpoint re-entry completes after hand-fix", async () => {
    if (
      skipReviewWithoutHarnessMarkdownlint(
        "review actuator staged Markdown lint exhaustion checkpoint re-entry completes after hand-fix",
      )
    ) {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "workflow-review-md-lint-exhaust-recover-"));
    roots.push(root);
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed-md-lint-exhaust-recover");
    const violationBytes = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-violation-subspec.md"), "utf8");
    const cleanSubspec = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-clean-subspec.md"), "utf8");
    writeLintCleanPlanStage(stage);
    let adjudicatorCalls = 0;
    let actuatorCalls = 0;

    const step = createDebateStep({
      stepId: "review-debate-md-lint-exhaust-recover",
      cwd: root,
      branch: "review-md-lint-exhaust-recover",
      verdictPath: join(stage, "verdict-plan.md"),
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
      stagedMarkdownLintMaxReprompts: 2,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async ({ cwd }) => {
          if (adapterModel === "ADJ") adjudicatorCalls += 1;
          if (adapterModel === "ACT") {
            actuatorCalls += 1;
            writeFileSync(join(cwd, ".jarvis-plan-stage", "00-one.md"), violationBytes, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          }
          return { kind: "ok", stdout: "ok", stderr: "" };
        },
      }),
    });

    await withStateStore(async (store) => {
      const failed = await executeWorkflow({ steps: [step], stateStore: store });
      expect(failed).toMatchObject({ kind: "landing_failed", resumable: true });
      expect(store.loadRun(failed.runId)?.attempts.at(-1)?.outcomeKind).toBe("landing_failed");
      const roleCallsAfterFirstPass = adjudicatorCalls + actuatorCalls;

      writeFileSync(join(stage, "00-one.md"), cleanSubspec, "utf8");
      const recovered = await executeWorkflow({ steps: [step], stateStore: store });
      expect(recovered).toMatchObject({ kind: "complete", iterationsConsumed: 0 });
      expect(adjudicatorCalls + actuatorCalls).toBe(roleCallsAfterFirstPass);
      expect(existsSync(join(durable, "00-one.md"))).toBe(true);
    });
  });

  test("review actuator staged Markdown lint blocks a checkpoint re-entry landing", async () => {
    // @mutate v2/src/execution/reviewed-staged-markdown-lint.ts "if (result.kind === \"clean\") return { kind: \"pass\" };" -> "if (true) return { kind: \"pass\" };"
    if (
      skipReviewWithoutHarnessMarkdownlint("review actuator staged Markdown lint blocks a checkpoint re-entry landing")
    ) {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "workflow-review-md-lint-checkpoint-"));
    roots.push(root);
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed-md-lint-checkpoint");
    const violationBytes = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-violation-subspec.md"), "utf8");
    mkdirSync(durable, { recursive: true });
    writeLintCleanPlanStage(stage, "01-test.md");
    writeFileSync(join(stage, "verdict-plan.md"), "", "utf8");
    writeFileSync(join(durable, "01-test.md"), "# Different", "utf8");
    let adjudicatorCalls = 0;
    let actuatorCalls = 0;

    const step = createDebateStep({
      stepId: "review-debate-md-lint-checkpoint",
      cwd: root,
      branch: "review-md-lint-checkpoint",
      verdictPath: join(stage, "verdict-plan.md"),
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
      stagedMarkdownLintMaxReprompts: 0,
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => {
        if (adapterModel === "ADJ") adjudicatorCalls += 1;
        if (adapterModel === "ACT") actuatorCalls += 1;
        return { kind: "ok", stdout: adapterModel === "ADJ" ? "apply fix" : "ok", stderr: "" } as const;
      }),
    });

    await withStateStore(async (store) => {
      const failed = await executeWorkflow({ steps: [step], stateStore: store });
      expect(failed).toMatchObject({ kind: "invocation_failure", resumable: true });
      expect(adjudicatorCalls).toBe(1);
      const roleCallsAfterFirstPass = adjudicatorCalls + actuatorCalls;

      rmSync(join(durable, "01-test.md"));
      writeFileSync(join(stage, "01-test.md"), violationBytes, "utf8");
      const retried = await executeWorkflow({ steps: [step], stateStore: store });
      expect(retried).toMatchObject({ kind: "landing_failed", resumable: true, iterationsConsumed: 0 });
      expect(adjudicatorCalls + actuatorCalls).toBe(roleCallsAfterFirstPass);
      expect(store.loadRun(retried.runId)?.attempts.at(-1)?.outcomeKind).toBe("landing_failed");
      expect(store.loadRun(retried.runId)?.attempts.some((attempt) => attempt.outcomeKind === "done")).toBe(false);
      expect(existsSync(join(durable, "01-test.md"))).toBe(false);
      expect(readFileSync(join(stage, "01-test.md"), "utf8")).toBe(violationBytes);
    });
  });

  test("review actuator staged Markdown lint reprompts on checkpoint re-entry landing", async () => {
    if (
      skipReviewWithoutHarnessMarkdownlint(
        "review actuator staged Markdown lint reprompts on checkpoint re-entry landing",
      )
    ) {
      return;
    }

    const root = mkdtempSync(join(tmpdir(), "workflow-review-md-lint-checkpoint-reprompt-"));
    roots.push(root);
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed-md-lint-checkpoint-reprompt");
    const violationBytes = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-violation-subspec.md"), "utf8");
    const cleanSubspec = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-clean-subspec.md"), "utf8");
    mkdirSync(durable, { recursive: true });
    writeLintCleanPlanStage(stage, "01-test.md");
    writeFileSync(join(stage, "verdict-plan.md"), "", "utf8");
    writeFileSync(join(durable, "01-test.md"), "# Different", "utf8");
    let adjudicatorCalls = 0;
    let actuatorCalls = 0;
    let repromptPrompt = "";

    const step = createDebateStep({
      stepId: "review-debate-md-lint-checkpoint-reprompt",
      cwd: root,
      branch: "review-md-lint-checkpoint-reprompt",
      verdictPath: join(stage, "verdict-plan.md"),
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
      stagedMarkdownLintMaxReprompts: 2,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async ({ cwd, prompt }) => {
          if (adapterModel === "ADJ") adjudicatorCalls += 1;
          if (adapterModel === "ACT") {
            actuatorCalls += 1;
            const stageDir = join(cwd, ".jarvis-plan-stage");
            if (actuatorCalls > 1) {
              repromptPrompt = prompt;
              writeFileSync(join(stageDir, "01-test.md"), cleanSubspec, "utf8");
            }
            return { kind: "ok", stdout: "done", stderr: "" };
          }
          return { kind: "ok", stdout: "ok", stderr: "" };
        },
      }),
    });

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const failed = await executeWorkflow({ steps: [step], stateStore: store, logSink });
      expect(failed).toMatchObject({ kind: "invocation_failure", resumable: true });
      expect(adjudicatorCalls).toBe(1);
      const roleCallsAfterFirstPass = adjudicatorCalls + actuatorCalls;

      rmSync(join(durable, "01-test.md"));
      writeFileSync(join(stage, "01-test.md"), violationBytes, "utf8");
      expect(existsSync(join(durable, "01-test.md"))).toBe(false);

      const retried = await executeWorkflow({ steps: [step], stateStore: store, logSink });
      expect(retried).toMatchObject({ kind: "complete", iterationsConsumed: 0 });
      expect(adjudicatorCalls + actuatorCalls).toBe(roleCallsAfterFirstPass + 1);
      expect(adjudicatorCalls).toBe(1);
      expect(existsSync(join(durable, "01-test.md"))).toBe(true);
      const reprompt = logSink
        .getEventsForRun(retried.runId)
        .find((event) => event.kind === "staged_markdown_lint_reprompt");
      expect(reprompt).toMatchObject({
        kind: "staged_markdown_lint_reprompt",
        ruleId: "MD038",
        offendingFile: ".jarvis-plan-stage/01-test.md",
      });
      expect(repromptPrompt).toContain("MD038");
      expect(repromptPrompt).toContain(".jarvis-plan-stage/01-test.md");
      expect(repromptPrompt).toContain(".jarvis-plan-stage");
    });
  });

  test("intent publication resume admits lint-exhausted landing_failed and completes after hand-fix", async () => {
    if (
      skipReviewWithoutHarnessMarkdownlint(
        "intent publication resume admits lint-exhausted landing_failed and completes after hand-fix",
      )
    ) {
      return;
    }

    const workspace = mkdtempSync(join(tmpdir(), "intent-resume-md-lint-exhaust-admit-"));
    const withExternalWorktree = externalWorktreeBinding(workspace);
    const violationBytes = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "intent-md038-violation.md"), "utf8");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });
    let criticCalls = 0;
    let actuatorCalls = 0;

    const writeStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "intent/resume-md-lint-exhaust-admit",
      specPath: "ready-intents",
      expectedArtifactPath: ".jarvis-intent-stage",
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
      creationTitle: "intent: resume-md-lint-exhaust-admit",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "intent-resume-md-lint-exhaust-admit",
        baseRef: "none",
      },
      withExternalWorktree,
      createBinding: createBindingFactory(async ({ cwd }) => {
        writeLintCleanIntentStageFile(join(cwd, ".jarvis-intent-stage"));
        return { kind: "ok" as const, stdout: "done", stderr: "" };
      }),
    });
    const reviewStep = createDebateStep({
      stepId: "review",
      cwd: workspace,
      branch: "intent/resume-md-lint-exhaust-admit",
      verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
      landing: {
        kind: "intent-stage",
        output: { durableDir: join(workspace, "ready-intents") },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "intent-resume-md-lint-exhaust-admit",
        baseRef: "none",
      },
      stagedMarkdownLintMaxReprompts: 2,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async ({ cwd }) => {
          if (adapterModel === "ADV" || adapterModel === "ADVOC") criticCalls += 1;
          if (adapterModel === "ACT") {
            actuatorCalls += 1;
            writeFileSync(join(cwd, ".jarvis-intent-stage", "existing.md"), violationBytes, "utf8");
            return { kind: "ok", stdout: "done", stderr: "" };
          }
          return adapterModel === "ADJ"
            ? ({ kind: "ok", stdout: "apply fix", stderr: "" } as const)
            : ({ kind: "ok", stdout: "ok", stderr: "" } as const);
        },
      }),
    });

    await withStateStore(async (store) => {
      const failed = await executeWorkflow({ steps: [writeStep, reviewStep], stateStore: store });
      expect(failed).toMatchObject({ kind: "landing_failed", resumable: true });
      const reviewRun = store.findRunByProjectBranch({
        project: "demo",
        branch: "intent/resume-md-lint-exhaust-admit",
        stepId: "review",
      });
      if (!reviewRun) throw new Error("expected review run");
      expect(reviewRun.attempts.at(-1)?.outcomeKind).toBe("landing_failed");
      const roleCallsAfterFirstPass = criticCalls + actuatorCalls;
      expect(resolveIntentFinalizationResumeContext(reviewRun, store)).toMatchObject({ ok: true });

      writeFileSync(join(workspace, ".jarvis-intent-stage", "existing.md"), LINT_CLEAN_INTENT_EXAMPLE_MD, "utf8");
      const outcome = await resumePopulatedIntentPublication(reviewRun, store, {
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({ pushSha: "deadbeef", prNumber: 7, prUrl: "https://example.test/pr/7" }),
        readyFinalizer: async () => {},
      });
      expect(outcome).toMatchObject({ ok: true });
      expect(criticCalls + actuatorCalls).toBe(roleCallsAfterFirstPass);
      expect(store.loadRun(reviewRun.id)?.status).toBe("completed");
      expect(existsSync(join(workspace, "ready-intents", "existing.md"))).toBe(true);
    });
  });

  test("intent publication resume re-lints staged Markdown and settles landing_failed on violation", async () => {
    if (
      skipReviewWithoutHarnessMarkdownlint(
        "intent publication resume re-lints staged Markdown and settles landing_failed on violation",
      )
    ) {
      return;
    }

    const workspace = mkdtempSync(join(tmpdir(), "intent-resume-md-lint-"));
    const violationBytes = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "intent-md038-violation.md"), "utf8");
    writeLintCleanIntentStageFile(join(workspace, ".jarvis-intent-stage"));
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });
    let actuatorCalls = 0;

    await withStateStore(async (store) => {
      const base = {
        project: "demo",
        specRef: "main",
        worktreePath: workspace,
        branch: "intent/resume-md-lint",
        workflowSnapshot: {
          invocationId: "intent-resume-md-lint",
          creationTitle: "intent: resume-md-lint",
          steps: [
            {
              stepId: "intent",
              role: "plan",
              durable: true,
              expectedArtifactPath: ".jarvis-intent-stage",
              agents: ["claude"],
            },
            { stepId: "review", role: "", durable: true, behavior: "review" as const },
          ],
        },
      };
      store.createRun({ ...base, specPath: "ready-intents", stepId: "intent" });
      const reviewRunId = store.createRun({ ...base, specPath: ".jarvis-intent-stage", stepId: "review" });
      store.setRunStatus(reviewRunId, "failed");
      const seedAttemptId = store.recordAttemptStart(reviewRunId);
      store.commitCompletionBoundary({
        attemptId: seedAttemptId,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
        invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: "landing failed" },
      });
      writeFileSync(join(workspace, ".jarvis-intent-stage", "existing.md"), violationBytes, "utf8");
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const logSink = new TestLogSink();
      const outcome = await resumePopulatedIntentPublication(run, store, {
        logSink,
        completionCommitter: async () => {
          actuatorCalls += 1;
          return { commitSha: "commit-1" };
        },
        completionPublisher: createCompletionPublisher(),
        readyFinalizer: async () => {},
      });

      expect(outcome).toMatchObject({ ok: false });
      expect(actuatorCalls).toBe(0);
      const settled = store.loadRun(reviewRunId);
      expect(settled?.status).toBe("failed");
      expect(settled?.attempts.at(-1)?.outcomeKind).toBe("landing_failed");
      expect(settled?.attempts.some((attempt) => attempt.outcomeKind === "done")).toBe(false);
      expect(existsSync(join(workspace, ".jarvis-intent-stage", "existing.md"))).toBe(true);
      expect(readFileSync(join(workspace, ".jarvis-intent-stage", "existing.md"), "utf8")).toBe(violationBytes);
      expect(existsSync(join(workspace, "ready-intents", "existing.md"))).toBe(false);
      expect(logSink.getEventsForRun(reviewRunId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "landing_failed",
        resumable: true,
      });
    });
  });
});
