import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunControlHandlers, resetWriteLoopBindingSourceDepsForTests } from "../daemon/daemon.ts";
import { stageArtifactKey } from "../daemon/pipeline-stage-dispatch.ts";
import { resolveStageWorkflowSteps } from "../daemon/pipeline-stage-resolve.ts";
import { composeRunOperatorError, findTerminalLogRecord } from "../daemon/run-operator-error.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import type { openStateStore } from "../persistence/state-store.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import { createCompletionPublisher } from "./completion-publisher.ts";
import { configuredIntentDurableDir, intentHandoffSpecPath } from "./intent-output.ts";
import type { PipelineDefinition } from "./pipeline-definition.ts";
import type { PublicationLanding } from "./publication-landing.ts";
import { validateReadyIntent } from "./publication-workflow-steps.ts";
import { createReadyFinalizer, ReadyGateError, SurvivingMutationError } from "./ready-finalize.ts";
import {
  config,
  createBindingFactory,
  createDebateBindingFactory,
  createDebateStep,
  createIntentWorktreeHarness,
  createStep,
  DEFAULT_AGENT_MODEL_CONFIG,
  externalWorktreeBinding,
  initGitWorkspace,
  installWorkflowRunnerResumeProfile,
  seedFailedIntentReviewResumeRun,
  stageReviewedIntent,
  TestLogSink,
  writeLintCleanIntentStageFile,
} from "./workflow-runner.test-support.ts";
import {
  executeWorkflow,
  type ReviewDebateWorkflowStep,
  type ReviewWorkflowStep,
  resolveIntentFinalizationResumeContext,
  resolveReviewMutationResumeContext,
  resumePopulatedIntentPublication,
  resumeReviewMutationFinalization,
  type WriteWorkflowStep,
} from "./workflow-runner.ts";
import { findFirstMarkdownOnlyFenceViolation } from "./write-loop.ts";

describe("executeWorkflow review dispatch", () => {
  test("retries reviewed-intent landing without rerunning review and persists its cause", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-retry-"));
    stageReviewedIntent(workspace);
    const durableDir = join(workspace, "ready-intents");
    const staged = "---\nname: example\n---\n\n# Example\n\n## Prerequisites\n";
    mkdirSync(durableDir, { recursive: true });
    writeFileSync(join(durableDir, "example.md"), "different\n", "utf8");
    let criticCalls = 0;
    let actuatorCalls = 0;
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
          if (agentId === "claude") criticCalls += 1;
          if (agentId === "codex") {
            actuatorCalls += 1;
            const stage = join(cwd, ".jarvis-intent-stage");
            mkdirSync(stage, { recursive: true });
            writeFileSync(join(stage, "example.md"), staged, "utf8");
          }
          return { kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" };
        },
      }),
    };

    await withStateStore(async (store) => {
      const failed = await executeWorkflow({ steps: [step], stateStore: store });
      expect(failed).toMatchObject({ kind: "invocation_failure", resumable: true });
      const checkpoint = store.findRunByProjectBranch({ project: "demo", branch: "intent/example", stepId: "review" });
      expect(checkpoint?.attempts.at(-1)?.invocationFailureDetail).toEqual({
        failureKind: "landing",
        message:
          "intent: ready-intents/example.md already exists with different contents; rerun to retry pre-publication",
        bindingAttempts: [],
      });

      rmSync(join(durableDir, "example.md"));
      const retried = await executeWorkflow({ steps: [step], stateStore: store });
      expect(retried).toMatchObject({ kind: "complete", iterationsConsumed: 0 });
      expect(
        store.findRunByProjectBranch({ project: "demo", branch: "intent/example", stepId: "review" })?.status,
      ).toBe("completed");
    });

    expect(criticCalls).toBe(1);
    expect(actuatorCalls).toBe(1);
  });

  test("re-entering a reviewed-intent landing checkpoint emits its own start and terminal log events", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-log-resume-"));
    stageReviewedIntent(workspace);
    const durableDir = join(workspace, "ready-intents");
    const staged = "---\nname: example\n---\n\n# Example\n\n## Prerequisites\n";
    mkdirSync(durableDir, { recursive: true });
    writeFileSync(join(durableDir, "example.md"), "different\n", "utf8");
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
            writeFileSync(join(stage, "example.md"), staged, "utf8");
          }
          return { kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" };
        },
      }),
    };

    const firstLogSink = new TestLogSink();
    const resumeLogSink = new TestLogSink();
    await withStateStore(async (store) => {
      const failed = await executeWorkflow({ steps: [step], stateStore: store, logSink: firstLogSink });
      expect(failed).toMatchObject({ kind: "invocation_failure", resumable: true });

      rmSync(join(durableDir, "example.md"));
      const retried = await executeWorkflow({ steps: [step], stateStore: store, logSink: resumeLogSink });
      expect(retried).toMatchObject({ kind: "complete", iterationsConsumed: 0 });

      const resumeEvents = resumeLogSink.getEventsForRun(retried.runId);
      expect(resumeEvents[0]).toMatchObject({ kind: "iteration_started" });
      expect(resumeEvents.at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "complete",
        resumable: false,
      });
    });
  });

  test("daemon resume retries landing failure without re-invoking write step", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "daemon-resume-landing-"));
    stageReviewedIntent(workspace);
    const durableDir = join(workspace, "ready-intents");
    const staged = "---\nname: example\n---\n\n# Example\n\n## Prerequisites\n";
    mkdirSync(durableDir, { recursive: true });
    writeFileSync(join(durableDir, "example.md"), "different\n", "utf8");
    let actuatorCalls = 0;
    const step: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "intent/landing-retry",
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
            actuatorCalls += 1;
            const stage = join(cwd, ".jarvis-intent-stage");
            mkdirSync(stage, { recursive: true });
            writeFileSync(join(stage, "example.md"), staged, "utf8");
          }
          return { kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" };
        },
      }),
    };

    const firstLogSink = new TestLogSink();
    const resumeLogSink = new TestLogSink();
    await withStateStore(async (store) => {
      const failed = await executeWorkflow({ steps: [step], stateStore: store, logSink: firstLogSink });
      expect(failed).toMatchObject({ kind: "invocation_failure", resumable: true });
      expect(actuatorCalls).toBe(1);

      rmSync(join(durableDir, "example.md"));
      const retried = await executeWorkflow({ steps: [step], stateStore: store, logSink: resumeLogSink });
      expect(retried).toMatchObject({ kind: "complete", iterationsConsumed: 0 });
      expect(actuatorCalls).toBe(1);

      const resumeEvents = resumeLogSink.getEventsForRun(retried.runId);
      const iterationStartedEvents = resumeEvents.filter((e) => e.kind === "iteration_started");
      expect(iterationStartedEvents).toHaveLength(1);
    });
  });

  test("resumes intent finalization from a populated stage without review re-invocation", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "intent-finalize-resume-"));
    const withExternalWorktree = externalWorktreeBinding(workspace);
    const durableDir = join(workspace, "ready-intents");
    mkdirSync(durableDir, { recursive: true });
    writeFileSync(join(durableDir, "example.md"), "different\n", "utf8");

    let splitCalls = 0;
    let criticCalls = 0;
    let actuatorCalls = 0;

    const baseStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "intent/finalize-resume",
      specPath: "ready-intents",
      expectedArtifactPath: ".jarvis-intent-stage",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "intent-finalize-resume",
        baseRef: "none",
      },
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
      creationTitle: "intent: finalize-resume",
      withExternalWorktree,
      createBinding: createBindingFactory(async ({ cwd }) => {
        splitCalls += 1;
        writeLintCleanIntentStageFile(join(cwd, ".jarvis-intent-stage"), "example.md");
        return { kind: "ok" as const, stdout: "done", stderr: "" };
      }),
    });
    const writeStep: WriteWorkflowStep = {
      ...baseStep,
      worktree: { ...baseStep.worktree, git: false, localPath: workspace },
    };
    const landing: PublicationLanding = {
      kind: "intent-stage",
      output: { durableDir: "ready-intents" },
      stagingDir: ".jarvis-intent-stage",
      invocationId: "intent-finalize-resume",
      baseRef: "none",
    };
    const reviewStep: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "intent/finalize-resume",
      cwd: workspace,
      prompt: "inspect",
      verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      landing,
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => {
          if (agentId === "claude") criticCalls += 1;
          if (agentId === "codex") actuatorCalls += 1;
          return { kind: "ok" as const, stdout: "done", stderr: "" };
        },
      }),
    };

    const logsPath = join(mkdtempSync(join(tmpdir(), "intent-finalize-resume-log-")), "logs.jsonl");
    const logSink = openLogSink(logsPath);

    await withStateStore(async (store) => {
      const failed = await executeWorkflow({ steps: [writeStep, reviewStep], stateStore: store, logSink });
      expect(failed).toMatchObject({ kind: "invocation_failure", resumable: true });
      expect(splitCalls).toBe(1);
      expect(criticCalls).toBe(1);
      expect(actuatorCalls).toBe(1);

      const reviewRun = store.findRunByProjectBranch({
        project: "demo",
        branch: "intent/finalize-resume",
        stepId: "review",
      });
      if (!reviewRun) throw new Error("expected a durable review row");

      // Clear the collision so promotion can succeed on resume, then republish through the
      // daemon's populated-stage resume path — never `spawnWriteLoop`.
      rmSync(join(durableDir, "example.md"));
      installWorkflowRunnerResumeProfile();
      let writeLoopExecutorCalls = 0;
      let commitCalls = 0;
      let publishCalls = 0;
      const handlers = createRunControlHandlers({
        stateStore: store,
        logReader: openLogReader(logsPath),
        writeLoopExecutor: async () => {
          writeLoopExecutorCalls += 1;
        },
        failureReporter: () => undefined,
        hasMemoryHeadroom: () => true,
        settleDelayMs: 0,
        intentFinalizationResumeDeps: {
          completionCommitter: async () => {
            commitCalls += 1;
            return { commitSha: "deadbeef", filesChanged: 1 };
          },
          completionPublisher: async () => {
            publishCalls += 1;
            return { pushSha: "deadbeef", prNumber: 42, prUrl: "https://example.test/pr/42" };
          },
          readyFinalizer: async () => undefined,
        },
      });
      try {
        const frame = await handlers.resume(
          { kind: "request", id: "resume-intent-finalize", method: "resume", params: { runId: reviewRun.id } },
          new AbortController().signal,
        );
        expect(frame.kind).toBe("response");

        expect(splitCalls).toBe(1);
        expect(criticCalls).toBe(1);
        expect(actuatorCalls).toBe(1);
        expect(writeLoopExecutorCalls).toBe(0);
        expect(commitCalls).toBe(1);
        expect(publishCalls).toBe(1);

        expect(store.loadRun(reviewRun.id)?.status).toBe("completed");
        expect(readFileSync(join(durableDir, "example.md"), "utf8")).toContain("Prerequisites");
        expect(existsSync(join(workspace, ".jarvis-intent-stage", "example.md"))).toBe(false);
      } finally {
        handlers.close();
        resetWriteLoopBindingSourceDepsForTests();
      }
    });
  });

  test("persists the review-debate step's real baseRef so resume publishes against it, not an empty specRef", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "intent-finalize-debate-baseref-"));
    const withExternalWorktree = externalWorktreeBinding(workspace);
    const durableDir = join(workspace, "ready-intents");
    mkdirSync(durableDir, { recursive: true });
    // Pre-existing conflicting content forces the debate step's deferred landing to fail.
    writeFileSync(join(durableDir, "example.md"), "different\n", "utf8");

    const baseStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "intent/finalize-debate-baseref",
      specPath: "ready-intents",
      expectedArtifactPath: ".jarvis-intent-stage",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "intent-finalize-debate-baseref",
        baseRef: "none",
      },
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
      creationTitle: "intent: finalize-debate-baseref",
      withExternalWorktree,
      createBinding: createBindingFactory(async ({ cwd }) => {
        writeLintCleanIntentStageFile(join(cwd, ".jarvis-intent-stage"), "example.md");
        return { kind: "ok" as const, stdout: "done", stderr: "" };
      }),
    });
    const writeStep: WriteWorkflowStep = {
      ...baseStep,
      worktree: { ...baseStep.worktree, git: false, localPath: workspace },
    };

    const debateStep = createDebateStep({
      stepId: "review-debate",
      cwd: workspace,
      project: "demo",
      branch: "intent/finalize-debate-baseref",
      verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "intent-finalize-debate-baseref",
        baseRef: "debate-real-base-ref",
      },
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => ({
        kind: "ok" as const,
        stdout: adapterModel === "ADJ" ? "" : "ok",
        stderr: "",
      })),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [writeStep, debateStep], stateStore: store });
      expect(result).toMatchObject({ kind: "invocation_failure", resumable: true });

      const debateRun = store.findRunByProjectBranch({
        project: "demo",
        branch: "intent/finalize-debate-baseref",
        stepId: "review-debate",
      });
      if (!debateRun) throw new Error("expected a durable review-debate row");
      expect(debateRun.specRef).toBe("debate-real-base-ref");

      const resolved = resolveIntentFinalizationResumeContext(debateRun, store);
      expect(resolved).toMatchObject({ ok: true, context: { baseRef: "debate-real-base-ref" } });
    });
  });

  test("settles a visible failure, not a no-op, when resume can't resolve a completion agent", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "intent-finalize-resume-no-agent-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(join(workspace, ".jarvis-intent-stage", "example.md"), "content\n", "utf8");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });

    await withStateStore(async (store) => {
      const reviewRunId = seedFailedIntentReviewResumeRun(store, workspace, {
        branch: "intent/no-agent",
        invocationId: "intent-no-agent",
        intentAgents: [],
      });
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const outcome = await resumePopulatedIntentPublication(run, store);

      expect(outcome).toMatchObject({ ok: false });
      const settled = store.loadRun(reviewRunId);
      expect(settled?.status).toBe("failed");
      expect(settled?.attempts.at(-1)?.invocationFailureDetail?.message).toContain("completion agent");
    });
  });

  test("intent-resume committer-throw failure logs the same completionCommitError as the resume outcome", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "intent-finalize-resume-commit-throw-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeLintCleanIntentStageFile(join(workspace, ".jarvis-intent-stage"), "example.md");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });

    await withStateStore(async (store) => {
      const reviewRunId = seedFailedIntentReviewResumeRun(store, workspace, {
        branch: "intent/commit-throw",
        invocationId: "intent-commit-throw",
      });
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const logSink = new TestLogSink();
      const outcome = await resumePopulatedIntentPublication(run, store, {
        logSink,
        completionCommitter: async () => {
          throw new Error("commit exploded");
        },
      });

      expect(outcome).toMatchObject({ ok: false, message: "commit exploded" });
      const terminal = logSink.getEventsForRun(reviewRunId).find((event) => event.kind === "loop_finished");
      expect(terminal).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "completion_commit_failed",
        completionCommitError: "commit exploded",
      });
      // @mutate v2/src/execution/workflow-runner.ts "completionCommitError: intentResumeCommitErrorMessage" -> ""
    });
  });

  test("retains workflow step across publication and finalization resume", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "const reviewPass = reviewCompletionPass(run);" -> "const reviewPass = undefined;"
    const workspace = mkdtempSync(join(tmpdir(), "intent-finalize-resume-step-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeLintCleanIntentStageFile(join(workspace, ".jarvis-intent-stage"), "example.md");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });

    await withStateStore(async (store) => {
      const base = {
        project: "demo",
        specRef: "main",
        worktreePath: workspace,
        branch: "intent/finalize-resume-step",
        workflowSnapshot: {
          invocationId: "intent-finalize-resume-step",
          creationTitle: "intent: finalize-resume-step",
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

      // An earlier dispatch's mutating pass 1 landed and persisted its classification durably.
      const firstAttemptId = store.recordAttemptStart(reviewRunId);
      store.commitCompletionBoundary({
        attemptId: firstAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "claude",
        completionReviewPass: 1,
      });

      // A later, separate dispatch on the same row fails at landing; the row demotes to failed,
      // but the earlier mutating pass's classification remains on record for recovery to read.
      store.setRunStatus(reviewRunId, "failed");
      const secondAttemptId = store.recordAttemptStart(reviewRunId);
      store.commitCompletionBoundary({
        attemptId: secondAttemptId,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
        invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: "landing failed" },
      });

      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");

      const resolved = resolveIntentFinalizationResumeContext(run, store);
      expect(resolved).toMatchObject({ ok: true, context: { behavior: "review", reviewPass: 1 } });

      const commits: Array<{ title: string; step: unknown }> = [];
      const outcome = await resumePopulatedIntentPublication(run, store, {
        completionCommitter: async (input) => {
          commits.push({ title: input.title, step: input.step });
          return { commitSha: "commit-1" };
        },
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(outcome).toMatchObject({ ok: true });
      expect(commits.at(-1)).toEqual({
        title: "review(1): intent: finalize-resume-step",
        step: { kind: "review", pass: 1 },
      });
    });
  });

  test("intent-resume publication push failure logs the same completionCommitError as the resume outcome", async () => {
    const workspace = initGitWorkspace("intent-finalize-resume-pub-fail-");
    writeFileSync(join(workspace, "README"), "base\n", "utf8");
    execFileSync("git", ["add", "README"], { cwd: workspace });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
    execFileSync("git", ["branch", "-M", "main"], { cwd: workspace });
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeLintCleanIntentStageFile(join(workspace, ".jarvis-intent-stage"), "example.md");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });

    try {
      await withStateStore(async (store) => {
        const reviewRunId = seedFailedIntentReviewResumeRun(store, workspace, {
          branch: "intent/pub-fail",
          invocationId: "intent-pub-fail",
        });
        const run = store.loadRun(reviewRunId);
        if (!run) throw new Error("expected review run");
        const logSink = new TestLogSink();
        const failingGit = async (_cwd: string, args: readonly string[]) => {
          if (args[0] === "push") throw new Error("failed to push some refs to origin");
          return "";
        };
        const outcome = await resumePopulatedIntentPublication(run, store, {
          logSink,
          completionCommitter: async () => ({ commitSha: "commit-1" }),
          completionPublisher: createCompletionPublisher({ git: failingGit }),
          readyFinalizer: async () => {},
        });

        expect(outcome).toMatchObject({ ok: false });
        expect(outcome.ok === false ? outcome.message : "").toContain("failed to push");
        const terminal = logSink.getEventsForRun(reviewRunId).find((event) => event.kind === "loop_finished");
        expect(terminal).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "completion_commit_failed",
          completionCommitError: outcome.ok === false ? outcome.message : undefined,
        });
        // @mutate v2/src/execution/workflow-runner.ts "completionCommitError: intentResumePublicationCommitError" -> ""
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("resume publication push uses explicit refspec without upstream detection", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "intent-finalize-resume-explicit-push-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeLintCleanIntentStageFile(join(workspace, ".jarvis-intent-stage"), "example.md");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });

    try {
      await withStateStore(async (store) => {
        const branch = "intent/explicit-push";
        const reviewRunId = seedFailedIntentReviewResumeRun(store, workspace, {
          branch,
          invocationId: "intent-explicit-push",
        });
        const run = store.loadRun(reviewRunId);
        if (!run) throw new Error("expected review run");
        const gitCalls: string[][] = [];
        const outcome = await resumePopulatedIntentPublication(run, store, {
          completionCommitter: async () => ({ commitSha: "commit-1" }),
          completionPublisher: createCompletionPublisher({
            subprocessRunner: {
              runAsync: async () => "deadbeef\trefs/heads/main\n",
            },
            git: async (_cwd, args) => {
              gitCalls.push([...args]);
              if (args[0] === "rev-parse" && args[1] === "HEAD") return "deadbeef";
              return "";
            },
            gh: async (_cwd, args) => {
              if (args[0] === "pr" && args[1] === "list") return JSON.stringify([]);
              if (args[0] === "pr" && args[1] === "create") return "#3";
              if (args[0] === "pr" && args[1] === "view") {
                return JSON.stringify({ number: 3, url: "https://example.test/pr/3", baseRefName: "main" });
              }
              return "";
            },
            delay: async () => {},
            fetchPrBody: async () => "",
            writePrBody: async () => {},
            renderFooter: async () => "",
          }),
          readyFinalizer: async () => {},
        });

        expect(outcome).toMatchObject({ ok: true, prNumber: 3, prUrl: "https://example.test/pr/3" });
        expect(gitCalls.filter(([command]) => command === "push")).toEqual([
          ["push", "origin", `HEAD:refs/heads/${branch}`],
        ]);
        expect(gitCalls.some((args) => args.some((arg) => arg.includes("@{u}")))).toBe(false);
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("intent-finalization resume skips the ready gate but completes the remaining finalization tail", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "inertResumeWriteLoopInput(context, context.durableDir, deps, context.landing, writeSibling)" -> "inertResumeWriteLoopInput(context, context.durableDir, deps, undefined, writeSibling)"
    const workspace = mkdtempSync(join(tmpdir(), "intent-finalize-resume-ready-gate-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeLintCleanIntentStageFile(join(workspace, ".jarvis-intent-stage"), "example.md");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });

    await withStateStore(async (store) => {
      const reviewRunId = seedFailedIntentReviewResumeRun(store, workspace, {
        branch: "intent/ready-gate",
        invocationId: "intent-ready-gate",
      });
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const logSink = new TestLogSink();
      const calls: string[] = [];
      const outcome = await resumePopulatedIntentPublication(run, store, {
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        runFixCommand: async () => {},
        readyFinalizer: createReadyFinalizer({
          runReadyGate: async () => {
            calls.push("gate");
            throw new ReadyGateError("bun run intent-ready", 1, "intent gate red");
          },
          runMutationVerification: async () => {
            calls.push("mutation");
          },
          runRuntimeSmokeVerification: async () => {
            calls.push("smoke");
            return { kind: "observed-clean" };
          },
          ghReadyFlip: async () => {
            calls.push("flip");
          },
        }),
      });

      expect(outcome).toMatchObject({ ok: true });
      expect(calls).toEqual(["mutation", "smoke", "flip"]);
      expect(logSink.getEventsForRun(reviewRunId).findLast((event) => event.kind === "loop_finished")).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "complete",
        resumable: false,
      });
    });
  });

  test("intent-finalization resume uses write-sibling stamped fix and ready commands", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "const readyCommand = writeSibling?.queuedInput?.readyCommand ?? writeSibling?.snapshotStep?.readyCommand;" -> "const readyCommand = undefined;"
    const workspace = mkdtempSync(join(tmpdir(), "intent-finalize-resume-stamped-commands-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeLintCleanIntentStageFile(join(workspace, ".jarvis-intent-stage"), "example.md");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });

    await withStateStore(async (store) => {
      const reviewRunId = seedFailedIntentReviewResumeRun(store, workspace, {
        branch: "intent/stamped-commands",
        invocationId: "intent-stamped-commands",
        intentStepConfig: { fixCommand: "make fix", readyCommand: "make test" },
      });
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      let finalizerReadyCommand: string | undefined;
      const outcome = await resumePopulatedIntentPublication(run, store, {
        completionCommitter: async () => ({ commitSha: "commit-1", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async (input) => {
          finalizerReadyCommand = input.readyCommand;
        },
      });

      expect(outcome).toMatchObject({ ok: true });
      expect(finalizerReadyCommand).toBe("make test");
    });
  });

  test("review-last light intent completion records file handoff on the step-0 entry run", async () => {
    const { workspace, withExternalWorktree } = createIntentWorktreeHarness("intent-file-handoff-review-last");
    const invocationId = "intent-file-handoff-review-last";
    const baseWriteStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "intent-file-handoff-review-last",
      specPath: "ready-intents",
      expectedArtifactPath: ".jarvis-intent-stage",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId,
        baseRef: "none",
      },
      creationTitle: "intent: handoff-review-last",
      workflowInvocationId: invocationId,
      withExternalWorktree,
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
      createBinding: createBindingFactory(async ({ cwd }) => {
        mkdirSync(join(cwd, ".jarvis-intent-stage"), { recursive: true });
        writeFileSync(
          join(cwd, ".jarvis-intent-stage", "handoff.md"),
          "---\nname: handoff\n---\n\n# Handoff\n\n## Prerequisites\n",
          "utf8",
        );
        return { kind: "ok" as const, stdout: "done", stderr: "" };
      }),
    });
    const writeStep: WriteWorkflowStep = {
      ...baseWriteStep,
      worktree: { ...baseWriteStep.worktree, git: false, localPath: workspace },
    };
    const reviewStep: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "intent-file-handoff-review-last",
      cwd: workspace,
      prompt: "review",
      verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: {
        claude: { critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] } },
        codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
      },
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId,
        baseRef: "none",
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => ({ kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" }),
      }),
    };

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [writeStep, reviewStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
      const intentRun = store.findRunByProjectBranch({
        project: "demo",
        branch: "intent-file-handoff-review-last",
        stepId: "intent",
      });
      expect(intentRun?.specPath).toBe("ready-intents/handoff.md");
      expect(intentRun?.specPath).not.toBe("ready-intents");
      expect(intentHandoffSpecPath(workspace, "ready-intents", ["handoff.md"])).toBe("ready-intents/handoff.md");
    });
  });

  test("resolveIntentFinalizationResumeContext derives durableDir from a file handoff path", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "intent-finalize-file-handoff-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(join(workspace, ".jarvis-intent-stage", "example.md"), "content\n", "utf8");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });
    writeFileSync(
      join(workspace, "ready-intents", "example.md"),
      "---\nname: example\n---\n\n# Example\n\n## Prerequisites\n",
      "utf8",
    );

    await withStateStore(async (store) => {
      const base = {
        project: "demo",
        specRef: "main",
        worktreePath: workspace,
        branch: "intent/file-handoff",
        workflowSnapshot: {
          invocationId: "intent-file-handoff",
          creationTitle: "intent: file-handoff",
          steps: [
            { stepId: "intent", role: "plan", durable: true, expectedArtifactPath: ".jarvis-intent-stage", agents: [] },
            { stepId: "review", role: "", durable: true, behavior: "review" as const },
          ],
        },
      };
      store.createRun({ ...base, specPath: "ready-intents/example.md", stepId: "intent" });
      const reviewRunId = store.createRun({ ...base, specPath: ".jarvis-intent-stage", stepId: "review" });
      store.setRunStatus(reviewRunId, "failed");
      const attemptId = store.recordAttemptStart(reviewRunId);
      store.commitCompletionBoundary({
        attemptId,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
        invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: "landing failed" },
      });

      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const writeRun = store.findRunByProjectBranch({
        project: "demo",
        branch: "intent/file-handoff",
        stepId: "intent",
      });
      if (!writeRun) throw new Error("expected write run");
      const resolved = resolveIntentFinalizationResumeContext(run, store);
      expect(resolved).toMatchObject({
        ok: true,
        context: {
          durableDir: "ready-intents",
          landing: { output: { durableDir: "ready-intents" } },
        },
      });
      if (!resolved.ok) throw new Error("expected resolved resume context");
      expect(resolved.context.durableDir).toBe(configuredIntentDurableDir(workspace, writeRun.specPath));
      expect(resolved.context.landing.output.durableDir).toBe(configuredIntentDurableDir(workspace, writeRun.specPath));
      expect(resolved.context.durableDir).not.toBe(writeRun.specPath);
    });
  });

  test("single-file intent handoff specPath passes plan-stage ready-intent validation", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "intent-pipeline-handoff-"));
    const withExternalWorktree = externalWorktreeBinding(workspace);
    const baseStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "intent-pipeline-handoff",
      specPath: "ready-intents",
      expectedArtifactPath: ".jarvis-intent-stage",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "intent-pipeline-handoff",
        baseRef: "none",
      },
      creationTitle: "intent: pipeline-handoff",
      withExternalWorktree,
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
      createBinding: createBindingFactory(async ({ cwd }) => {
        mkdirSync(join(cwd, ".jarvis-intent-stage"), { recursive: true });
        writeFileSync(
          join(cwd, ".jarvis-intent-stage", "pipeline.md"),
          "---\nname: pipeline\n---\n\n# Pipeline\n\n## Prerequisites\n",
          "utf8",
        );
        return { kind: "ok" as const, stdout: "done", stderr: "" };
      }),
    });
    const step: WriteWorkflowStep = {
      ...baseStep,
      worktree: { ...baseStep.worktree, git: false, localPath: workspace },
    };

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
      const entryRun = store.loadRun(result.runId);
      expect(entryRun?.specPath).toBe("ready-intents/pipeline.md");
      expect(entryRun?.specPath).not.toBe("ready-intents");
      expect(validateReadyIntent(join(workspace, entryRun?.specPath ?? ""))).toMatchObject({ ok: true });

      const definition: PipelineDefinition = {
        name: "p",
        stages: [
          { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
          { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
        ],
      };
      const planResolution = await resolveStageWorkflowSteps(
        definition,
        1,
        { cwd: workspace, configPath: "/fake/.jarvis/config.json", seed: "seed" },
        new Map([[stageArtifactKey("intent"), { entryRunId: result.runId, specPath: entryRun?.specPath ?? "" }]]),
        {
          loadRun: (runId) => (runId === result.runId ? { worktreePath: workspace, branch: "intent/test" } : null),
          builders: {
            implement: async () => ({ ok: false as const, error: "unexpected" }),
            intent: async () => ({ ok: false as const, error: "unexpected" }),
            "intent-reviewed": async () => ({ ok: false as const, error: "unexpected" }),
            plan: async () => ({ ok: true, steps: [{ behavior: "write" } as never], identity: {} as never }),
            "plan-reviewed": async () => ({ ok: false as const, error: "unexpected" }),
            "plan-reviewed-light": async () => ({ ok: false as const, error: "unexpected" }),
          },
        },
      );
      expect(planResolution.ok).toBe(true);
      expect(validateReadyIntent(join(workspace, "ready-intents"))).toMatchObject({ ok: false });
    });
  });

  test("admits populated-intent landing_failed even when the write sibling is not completed (unchanged from before the review-mutation tail)", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "intent-finalize-write-not-completed-"));
    mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
    writeFileSync(join(workspace, ".jarvis-intent-stage", "example.md"), "content\n", "utf8");
    mkdirSync(join(workspace, "ready-intents"), { recursive: true });

    await withStateStore(async (store) => {
      const base = {
        project: "demo",
        specRef: "main",
        worktreePath: workspace,
        branch: "intent/write-not-completed",
        workflowSnapshot: {
          invocationId: "intent-write-not-completed",
          creationTitle: "intent: write-not-completed",
          steps: [
            { stepId: "intent", role: "plan", durable: true, expectedArtifactPath: ".jarvis-intent-stage", agents: [] },
            { stepId: "review", role: "", durable: true, behavior: "review" as const },
          ],
        },
      };
      // The write row is left `in-progress`, never marked `completed` — the prior, pre-review-
      // mutation-tail resolver never required that, and this path must still not require it.
      store.createRun({ ...base, specPath: "ready-intents", stepId: "intent" });
      const reviewRunId = store.createRun({ ...base, specPath: ".jarvis-intent-stage", stepId: "review" });
      store.setRunStatus(reviewRunId, "failed");
      const attemptId = store.recordAttemptStart(reviewRunId);
      store.commitCompletionBoundary({
        attemptId,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
        invocationFailureDetail: { failureKind: "landing", bindingAttempts: [], message: "landing failed" },
      });

      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const resolved = resolveIntentFinalizationResumeContext(run, store);
      expect(resolved).toMatchObject({ ok: true });
    });
  });

  test("a settled review-mutation resume failure emits a loop_finished whose resumable field agrees with this resolver's own admission", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "review-mutation-settle-agrees-"));
    const logsPath = join(workspace, "resume.jsonl");
    try {
      await withStateStore(async (store) => {
        const snapshot = {
          invocationId: "review-mutation-settle-agrees",
          creationTitle: "implement: settle-agrees",
          steps: [
            {
              stepId: "implement",
              role: "implement",
              stepRules: "implement rules",
              expectedArtifactPath: "artifact",
              // No configured agents and no recorded `completionAgent` anywhere below: resolution
              // can't attribute the publication commit, so resume must settle a visible
              // `invocation_failure` — an outcome excluded from `REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS`.
              agents: [] as string[],
              agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
            },
            { stepId: "implement-review", role: "", durable: true, behavior: "review" as const },
          ],
        };
        const base = {
          project: "demo",
          specRef: "main",
          worktreePath: workspace,
          branch: "review-mutation/settle-agrees",
        };
        const writeRunId = store.createRun({
          ...base,
          specPath: "spec.md",
          stepId: "implement",
          workflowSnapshot: snapshot,
        });
        store.setRunStatus(writeRunId, "completed");
        const writeAttemptId = store.recordAttemptStart(writeRunId);
        store.commitCompletionBoundary({ attemptId: writeAttemptId, runStatus: "completed", outcomeKind: "done" });

        const reviewRunId = store.createRun({
          ...base,
          specPath: "spec.md",
          stepId: "implement-review",
          workflowSnapshot: snapshot,
        });
        store.setRunStatus(reviewRunId, "failed");

        const seedSink = openLogSink(logsPath);
        seedSink.append(reviewRunId, {
          kind: "loop_finished",
          loopOutcomeKind: "surviving_mutation_failed",
          iterationsConsumed: 0,
          resumable: true,
        });
        seedSink.close();

        const run = store.loadRun(reviewRunId);
        if (!run) throw new Error("expected review run");
        const terminalRecord = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));

        const logSink = openLogSink(logsPath);
        const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, { logSink });
        logSink.close();
        expect(outcome).toMatchObject({ ok: false });

        const settledRecords = openLogReader(logsPath).tail(reviewRunId);
        const settledTerminal = findTerminalLogRecord(settledRecords);
        if (settledTerminal?.event.kind !== "loop_finished") throw new Error("expected a settled loop_finished");
        expect(settledTerminal.event.loopOutcomeKind).toBe("invocation_failure");
        expect(settledTerminal.event.resumable).toBe(false);

        // The same predicate this resolver would apply on a subsequent resume agrees: it refuses too.
        const settledRun = store.loadRun(reviewRunId);
        if (!settledRun) throw new Error("expected settled review run");
        const reResolved = resolveReviewMutationResumeContext(settledRun, store, settledTerminal);
        expect(reResolved).toMatchObject({ ok: false });
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("resuming a review row's surviving_mutation_failed actually re-runs the ready finalizer (mutation reverification)", async () => {
    const workspace = initGitWorkspace("review-mutation-resume-reverify-");
    const logsPath = join(workspace, "resume.jsonl");
    try {
      writeFileSync(join(workspace, "spec.md"), "# Spec\n\n## Acceptance criteria\n\n- [x] complete\n", "utf8");
      execFileSync("git", ["add", "spec.md"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
      const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
      execFileSync("git", ["branch", "-M", "main"], { cwd: workspace });
      await withStateStore(async (store) => {
        const snapshot = reviewMutationWorkflowSnapshot("review-mutation-reverify", "implement: reverify");
        const project = "demo";
        const branch = "review-mutation/reverify";

        // A completed `implement~link-1` row — the shape a linked-implement workflow's terminal
        // pass actually persists, never a bare `implement` row. Its fields are the only ones the
        // finalizer should honor.
        const writeRunId = store.createRun({
          project,
          specRef: baseRef,
          worktreePath: workspace,
          branch,
          specPath: "spec.md",
          stepId: "implement~link-1",
          workflowSnapshot: snapshot,
        });
        store.setRunStatus(writeRunId, "completed");
        const writeAttemptId = store.recordAttemptStart(writeRunId);
        store.commitCompletionBoundary({
          attemptId: writeAttemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });

        // The review row carries deliberately conflicting worktree/ref/agent fields of its own —
        // reconstruction must source from the selected write-row sibling instead, never these.
        const reviewRunId = store.createRun({
          project,
          specRef: "conflicting-base-ref",
          worktreePath: join(workspace, "conflicting-review-worktree"),
          branch,
          specPath: "conflicting-spec.md",
          stepId: "implement-review",
          workflowSnapshot: snapshot,
        });
        const reviewAttemptId = store.recordAttemptStart(reviewRunId);
        store.commitCompletionBoundary({
          attemptId: reviewAttemptId,
          runStatus: "failed",
          outcomeKind: "invocation_failure",
          invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message: "prior attempt" },
          completionAgent: "conflicting-review-agent",
        });

        const seedSink = openLogSink(logsPath);
        seedSink.append(reviewRunId, {
          kind: "loop_finished",
          loopOutcomeKind: "surviving_mutation_failed",
          iterationsConsumed: 0,
          resumable: true,
          survivingMutation: "operator-flip: === → !==",
          survivingMutationSourceFile: "src/guard.ts",
          survivingMutationSourceLine: 17,
        });
        seedSink.close();

        const run = store.loadRun(reviewRunId);
        if (!run) throw new Error("expected review run");
        const terminalRecord = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));

        const resolved = resolveReviewMutationResumeContext(run, store, terminalRecord);
        expect(resolved).toMatchObject({
          ok: true,
          context: { worktreePath: workspace, baseRef, specPath: "spec.md", completionAgent: "codex" },
        });

        let finalizerCalls = 0;
        const prompts: string[] = [];
        const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({ pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" }),
          readyFinalizer: async (input) => {
            finalizerCalls += 1;
            expect(input.worktreePath).toBe(workspace);
            expect(input.baseRef).toBe(baseRef);
            if (finalizerCalls === 1) {
              throw new SurvivingMutationError("operator-flip: === → !==", "src/guard.ts", 17);
            }
            if (finalizerCalls <= 3) throw new ReadyGateError("bun run ready", 1, "still red");
            return undefined;
          },
          runFixCommand: async () => {},
          mutationRepair: {
            bindings: [
              {
                id: "current-implement-binding",
                metadata: { agent: "current-agent", model: "current-model" },
                invoke: async ({ prompt, cwd }) => {
                  prompts.push(prompt);
                  writeFileSync(join(cwd, "repair-proof.txt"), "repaired\n", "utf8");
                  return { kind: "ok", stdout: "done", stderr: "" };
                },
              },
            ],
            stepRules: "repair rules",
            iterationTimeoutMs: 1_000,
            iterationCeilingMs: 2_000,
          },
        });

        expect(outcome).toMatchObject({ ok: true });
        expect(finalizerCalls).toBe(4);
        expect(store.loadRun(reviewRunId)?.status).toBe("completed");
        expect(prompts).toHaveLength(2);
        expect(prompts[0]).toContain("Mutation: operator-flip: === → !==");
        expect(prompts[0]).not.toContain("patch.prompt.body");
        expect(prompts[1]).toContain("The ready gate failed:");
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("review-mutation resume republication settles completed with PR evidence atomically", async () => {
    // @mutate v2/src/execution/workflow-runner.ts restoring standalone `setPrEvidence` before terminal `setRunStatus` on the resume publication success tail turns the test RED.
    const workspace = initGitWorkspace("review-mutation-repub-atomic-");
    const logsPath = join(workspace, "resume.jsonl");
    try {
      writeFileSync(join(workspace, "spec.md"), "# Spec\n\n## Acceptance criteria\n\n- [x] complete\n", "utf8");
      execFileSync("git", ["add", "spec.md"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
      const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
      execFileSync("git", ["branch", "-M", "main"], { cwd: workspace });
      const prNumber = 7;
      const prUrl = "https://example.test/pr/7";

      await withStateStore(async (store) => {
        const snapshot = reviewMutationWorkflowSnapshot("review-mutation-repub-atomic", "implement: repub-atomic");
        const base = {
          project: "demo",
          specRef: baseRef,
          worktreePath: workspace,
          branch: "review-mutation/repub-atomic",
          specPath: "spec.md",
          workflowSnapshot: snapshot,
        };
        const writeRunId = store.createRun({ ...base, stepId: "implement" });
        store.setRunStatus(writeRunId, "completed");
        const writeAttemptId = store.recordAttemptStart(writeRunId);
        store.commitCompletionBoundary({
          attemptId: writeAttemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });

        const reviewRunId = store.createRun({ ...base, stepId: "implement-review" });
        store.setRunStatus(reviewRunId, "failed");
        const seedSink = openLogSink(logsPath);
        seedSink.append(reviewRunId, {
          kind: "loop_finished",
          loopOutcomeKind: "completion_commit_failed",
          iterationsConsumed: 0,
          resumable: true,
          completionCommitError: "publish failed",
        });
        seedSink.close();

        const run = store.loadRun(reviewRunId);
        if (!run) throw new Error("expected review run");
        const terminalRecord = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
        const logSink = openLogSink(logsPath);
        const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
          logSink,
          completionCommitter: createCompletionCommitter(),
          completionPublisher: async () => ({ pushSha: "deadbeef", prNumber, prUrl }),
          readyFinalizer: async () => {},
        });
        logSink.close();

        expect(outcome).toMatchObject({ ok: true, prNumber, prUrl });
        const settledRow = store.loadRun(reviewRunId);
        expect(settledRow).toMatchObject({
          status: "completed",
          prNumber,
          prUrl,
          terminalCause: "complete",
        });
        expect(settledRow?.finishedAt).not.toBeNull();
        const terminal = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
        expect(terminal?.event).toMatchObject({ kind: "loop_finished", loopOutcomeKind: "complete" });
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("mutation repair stops at its bound and reports a non-retryable operator error", async () => {
    const workspace = initGitWorkspace("review-mutation-repair-exhausted-");
    const logsPath = join(workspace, "resume.jsonl");
    try {
      writeFileSync(join(workspace, "spec.md"), "# Spec\n\n## Acceptance criteria\n\n- [x] complete\n", "utf8");
      execFileSync("git", ["add", "spec.md"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
      execFileSync("git", ["branch", "-M", "main"], { cwd: workspace });
      await withStateStore(async (store) => {
        const snapshot = reviewMutationWorkflowSnapshot("repair-exhausted", "implement: repair-exhausted");
        const base = {
          project: "demo",
          specRef: "main",
          worktreePath: workspace,
          branch: "repair-exhausted",
          specPath: "spec.md",
          workflowSnapshot: snapshot,
        };
        const writeRunId = store.createRun({ ...base, stepId: "implement" });
        const writeAttemptId = store.recordAttemptStart(writeRunId);
        store.commitCompletionBoundary({
          attemptId: writeAttemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });
        const reviewRunId = store.createRun({ ...base, stepId: "implement-review" });
        const reviewAttemptId = store.recordAttemptStart(reviewRunId);
        store.commitCompletionBoundary({
          attemptId: reviewAttemptId,
          runStatus: "failed",
          outcomeKind: "invocation_failure",
          invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message: "prior mutation" },
        });
        const seedSink = openLogSink(logsPath);
        seedSink.append(reviewRunId, {
          kind: "loop_finished",
          loopOutcomeKind: "surviving_mutation_failed",
          iterationsConsumed: 0,
          resumable: true,
        });
        seedSink.close();
        const run = store.loadRun(reviewRunId);
        if (!run) throw new Error("expected review run");
        const terminalRecord = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
        const logSink = openLogSink(logsPath);
        let prompts = 0;
        const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
          logSink,
          completionCommitter: async () => ({ commitSha: "deadbeef", filesChanged: 1 }),
          completionPublisher: async () => ({ pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" }),
          readyFinalizer: async () => {
            throw new SurvivingMutationError("operator-flip: === → !==", "src/guard.ts", 17);
          },
          mutationRepair: {
            bindings: [
              {
                id: "current-implement-binding",
                metadata: { agent: "current-agent", model: "current-model" },
                invoke: async ({ cwd }) => {
                  prompts += 1;
                  writeFileSync(join(cwd, `repair-${prompts}.txt`), "repaired\n", "utf8");
                  return { kind: "ok", stdout: "done", stderr: "" };
                },
              },
            ],
            stepRules: "repair rules",
            iterationTimeoutMs: 1_000,
            iterationCeilingMs: 2_000,
          },
        });
        logSink.close();

        expect(outcome).toMatchObject({ ok: false, message: "Mutation survived every repair attempt" });
        expect(prompts).toBe(3);
        const settledRun = store.loadRun(reviewRunId);
        const settledTerminal = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
        expect(settledTerminal?.event).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "mutation_repair_exhausted",
          resumable: false,
        });
        expect(composeRunOperatorError(settledRun ?? { status: "failed" }, settledTerminal)).toMatchObject({
          reason: "mutation_repair_exhausted",
          retryable: false,
          nextAction: "inspect_spec",
        });
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("labels mutation-repair commits", async () => {
    // @mutate v2/src/execution/workflow-runner.ts "step: mutationRepairStep," -> ""
    const workspace = initGitWorkspace("review-mutation-repair-label-");
    const logsPath = join(workspace, "resume.jsonl");
    try {
      writeFileSync(join(workspace, "spec.md"), "# Spec\n\n## Acceptance criteria\n\n- [x] complete\n", "utf8");
      execFileSync("git", ["add", "spec.md"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
      execFileSync("git", ["branch", "-M", "main"], { cwd: workspace });
      await withStateStore(async (store) => {
        const snapshot = reviewMutationWorkflowSnapshot("mutation-repair-label", "implement: label");
        const base = {
          project: "demo",
          specRef: "main",
          worktreePath: workspace,
          branch: "mutation-repair-label",
          specPath: "spec.md",
          workflowSnapshot: snapshot,
        };
        const writeRunId = store.createRun({ ...base, stepId: "implement" });
        const writeAttemptId = store.recordAttemptStart(writeRunId);
        store.commitCompletionBoundary({
          attemptId: writeAttemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });
        const reviewRunId = store.createRun({ ...base, stepId: "implement-review" });
        const reviewAttemptId = store.recordAttemptStart(reviewRunId);
        store.commitCompletionBoundary({
          attemptId: reviewAttemptId,
          runStatus: "failed",
          outcomeKind: "invocation_failure",
          invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message: "prior mutation" },
        });
        const seedSink = openLogSink(logsPath);
        seedSink.append(reviewRunId, {
          kind: "loop_finished",
          loopOutcomeKind: "surviving_mutation_failed",
          iterationsConsumed: 0,
          resumable: true,
          survivingMutation: "operator-flip: === → !==",
          survivingMutationSourceFile: "src/guard.ts",
          survivingMutationSourceLine: 17,
        });
        seedSink.close();
        const run = store.loadRun(reviewRunId);
        if (!run) throw new Error("expected review run");
        const terminalRecord = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));

        const commits: Array<{ title: string; step: unknown }> = [];
        let finalizerCalls = 0;
        const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
          completionCommitter: async (input) => {
            commits.push({ title: input.title, step: input.step });
            return createCompletionCommitter()(input);
          },
          completionPublisher: async () => ({ pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" }),
          readyFinalizer: async () => {
            finalizerCalls += 1;
            if (finalizerCalls === 1) throw new SurvivingMutationError("operator-flip: === → !==", "src/guard.ts", 17);
            return undefined;
          },
          runFixCommand: async () => {},
          mutationRepair: {
            bindings: [
              {
                id: "current-implement-binding",
                metadata: { agent: "current-agent", model: "current-model" },
                invoke: async ({ cwd }) => {
                  writeFileSync(join(cwd, "repair-proof.txt"), "repaired\n", "utf8");
                  return { kind: "ok", stdout: "done", stderr: "" };
                },
              },
            ],
            stepRules: "repair rules",
            iterationTimeoutMs: 1_000,
            iterationCeilingMs: 2_000,
          },
        });

        expect(outcome).toMatchObject({ ok: true });
        const repairCommit = commits.find((c) => c.step !== undefined);
        expect(repairCommit?.step).toEqual({ kind: "mutation-repair" });
        expect((repairCommit?.title as string).startsWith("mutation-repair: ")).toBe(true);
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test.each([
    "blocked",
    "unsettled",
  ] as const)("mutation repair %s stops without publishing a repaired commit", async (mode) => {
    const workspace = initGitWorkspace(`review-mutation-repair-${mode}-`);
    const logsPath = join(workspace, "resume.jsonl");
    try {
      writeFileSync(join(workspace, "spec.md"), "# Spec\n\n## Acceptance criteria\n\n- [x] complete\n", "utf8");
      execFileSync("git", ["add", "spec.md"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
      execFileSync("git", ["branch", "-M", "main"], { cwd: workspace });
      await withStateStore(async (store) => {
        const snapshot = reviewMutationWorkflowSnapshot(`repair-${mode}`, `implement: repair-${mode}`);
        const base = {
          project: "demo",
          specRef: "main",
          worktreePath: workspace,
          branch: `repair-${mode}`,
          specPath: "spec.md",
          workflowSnapshot: snapshot,
        };
        const writeRunId = store.createRun({ ...base, stepId: "implement" });
        const writeAttemptId = store.recordAttemptStart(writeRunId);
        store.commitCompletionBoundary({
          attemptId: writeAttemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });
        const reviewRunId = store.createRun({ ...base, stepId: "implement-review" });
        const reviewAttemptId = store.recordAttemptStart(reviewRunId);
        store.commitCompletionBoundary({
          attemptId: reviewAttemptId,
          runStatus: "failed",
          outcomeKind: "invocation_failure",
          invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message: "prior mutation" },
        });
        const seedSink = openLogSink(logsPath);
        seedSink.append(reviewRunId, {
          kind: "loop_finished",
          loopOutcomeKind: "surviving_mutation_failed",
          iterationsConsumed: 0,
          resumable: true,
        });
        seedSink.close();
        const run = store.loadRun(reviewRunId);
        if (!run) throw new Error("expected review run");
        const terminalRecord = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
        let commits = 0;
        let publishes = 0;
        let repairs = 0;
        const logSink = openLogSink(logsPath);
        const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
          logSink,
          completionCommitter: async () => ({ commitSha: `deadbeef-${++commits}`, filesChanged: 1 }),
          completionPublisher: async () => {
            publishes += 1;
            return { pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" };
          },
          readyFinalizer: async () => {
            throw new SurvivingMutationError("operator-flip: === → !==", "src/guard.ts", 17);
          },
          mutationRepair: {
            bindings: [
              {
                id: "current-implement-binding",
                metadata: { agent: "current-agent", model: "current-model" },
                invoke: async ({ signal }) => {
                  repairs += 1;
                  if (mode === "blocked") {
                    appendFileSync(join(workspace, "spec.md"), "\n## Blocker\n\nrepair blocked\n", "utf8");
                    return { kind: "ok", stdout: "blocked", stderr: "" };
                  }
                  if (signal === undefined) throw new Error("expected repair abort signal");
                  return await new Promise((resolve) => {
                    signal.addEventListener("abort", () => resolve({ kind: "ok", stdout: "done", stderr: "" }), {
                      once: true,
                    });
                  });
                },
              },
            ],
            stepRules: "repair rules",
            iterationTimeoutMs: mode === "unsettled" ? 1 : 1_000,
            iterationCeilingMs: mode === "unsettled" ? 2 : 2_000,
          },
        });
        logSink.close();

        expect(outcome).toMatchObject({ ok: false });
        expect(repairs).toBe(1);
        expect(commits).toBe(1);
        expect(publishes).toBe(1);
        expect(findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId))?.event).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "mutation_repair_exhausted",
          resumable: false,
        });
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  describe("review-mutation recovery repair fence", () => {
    function initReviewMutationRepairFenceWorktree(workspace: string): string {
      mkdirSync(join(workspace, "v2", "src"), { recursive: true });
      writeFileSync(join(workspace, "spec.md"), "- [ ] work\n", "utf8");
      writeFileSync(join(workspace, "proof.txt"), "ok\n", "utf8");
      writeFileSync(join(workspace, "v2/src/untouched.test.ts"), "export {}\n", "utf8");
      execFileSync("git", ["add", "-A"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "seed"], { cwd: workspace });
      const baseRef = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: workspace,
        encoding: "utf8",
      }).trim();
      writeFileSync(join(workspace, "proof.txt"), "done\n", "utf8");
      execFileSync("git", ["add", "proof.txt"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "iteration"], { cwd: workspace });
      return baseRef;
    }

    async function seedReviewMutationRepairFenceResume(
      workspace: string,
      store: ReturnType<typeof openStateStore>,
      logsPath: string,
    ) {
      const snapshot = reviewMutationWorkflowSnapshot("review-mutation-repair-fence", "implement: repair-fence");
      const branch = "review-mutation/repair-fence";
      const baseRef = initReviewMutationRepairFenceWorktree(workspace);
      const base = {
        project: "demo",
        specRef: baseRef,
        worktreePath: workspace,
        branch,
        specPath: "spec.md",
        workflowSnapshot: snapshot,
      };
      const writeRunId = store.createRun({ ...base, stepId: "implement" });
      store.setRunStatus(writeRunId, "completed");
      const writeAttemptId = store.recordAttemptStart(writeRunId);
      store.commitCompletionBoundary({
        attemptId: writeAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex",
      });
      store.setReadyGateRepairFence(writeRunId, {
        allowedPaths: ["proof.txt"],
        offendingPath: "v2/src/untouched.test.ts",
        outcomeKind: "completion_commit_failed",
      });
      const reviewRunId = store.createRun({ ...base, stepId: "implement-review" });
      const reviewAttemptId = store.recordAttemptStart(reviewRunId);
      store.commitCompletionBoundary({
        attemptId: reviewAttemptId,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
        invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message: "prior mutation" },
      });
      const seedSink = openLogSink(logsPath);
      seedSink.append(reviewRunId, {
        kind: "loop_finished",
        loopOutcomeKind: "surviving_mutation_failed",
        iterationsConsumed: 0,
        resumable: true,
      });
      seedSink.close();
      writeFileSync(join(workspace, "v2/src/untouched.test.ts"), "changed\n", "utf8");
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const terminalRecord = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
      return { run, terminalRecord, writeRunId, reviewRunId };
    }

    test("rejected repair path cannot be swept into review-mutation recovery commit or publish", async () => {
      const workspace = initGitWorkspace("review-mutation-repair-fence-");
      const logsPath = join(tmpdir(), `review-mutation-repair-fence-${randomUUID()}.jsonl`);
      try {
        await withStateStore(async (store) => {
          const { run, terminalRecord } = await seedReviewMutationRepairFenceResume(workspace, store, logsPath);
          let commitCalls = 0;
          let publishCalls = 0;
          const logSink = openLogSink(logsPath);
          const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            logSink,
            completionCommitter: async () => {
              commitCalls += 1;
              return { commitSha: "deadbeef", filesChanged: 1 };
            },
            completionPublisher: async () => {
              publishCalls += 1;
              return { pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" };
            },
            readyFinalizer: async () => {},
          });
          logSink.close();

          expect(outcome).toMatchObject({ ok: false });
          expect(outcome.ok === false ? outcome.message : "").toContain("v2/src/untouched.test.ts");
          expect(commitCalls).toBe(0);
          expect(publishCalls).toBe(0);
          const settledTerminal = findTerminalLogRecord(openLogReader(logsPath).tail(run.id));
          expect(settledTerminal?.event).toMatchObject({
            kind: "loop_finished",
            loopOutcomeKind: "completion_commit_failed",
            resumable: true,
            completionCommitError: outcome.ok === false ? outcome.message : undefined,
          });
          // @mutate v2/src/execution/workflow-runner.ts "completionCommitError: reviewMutationResumeCommitErrorMessage" -> ""
        });
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });

    test("review-mutation-resume publication push failure logs the same completionCommitError as the resume outcome", async () => {
      const workspace = initGitWorkspace("review-mutation-resume-pub-fail-");
      const logsPath = join(workspace, "resume.jsonl");
      try {
        writeFileSync(join(workspace, "spec.md"), "# Spec\n\n## Acceptance criteria\n\n- [x] complete\n", "utf8");
        execFileSync("git", ["add", "spec.md"], { cwd: workspace });
        execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
        const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
        execFileSync("git", ["branch", "-M", "main"], { cwd: workspace });

        await withStateStore(async (store) => {
          const snapshot = reviewMutationWorkflowSnapshot("review-mutation-pub-fail", "implement: pub-fail");
          const base = {
            project: "demo",
            specRef: baseRef,
            worktreePath: workspace,
            branch: "review-mutation/pub-fail",
            specPath: "spec.md",
            workflowSnapshot: snapshot,
          };
          const writeRunId = store.createRun({ ...base, stepId: "implement" });
          store.setRunStatus(writeRunId, "completed");
          const writeAttemptId = store.recordAttemptStart(writeRunId);
          store.commitCompletionBoundary({
            attemptId: writeAttemptId,
            runStatus: "completed",
            outcomeKind: "done",
            completionAgent: "codex",
          });

          const reviewRunId = store.createRun({ ...base, stepId: "implement-review" });
          const reviewAttemptId = store.recordAttemptStart(reviewRunId);
          store.commitCompletionBoundary({
            attemptId: reviewAttemptId,
            runStatus: "failed",
            outcomeKind: "invocation_failure",
            invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message: "prior mutation" },
          });
          const seedSink = openLogSink(logsPath);
          seedSink.append(reviewRunId, {
            kind: "loop_finished",
            loopOutcomeKind: "surviving_mutation_failed",
            iterationsConsumed: 0,
            resumable: true,
          });
          seedSink.close();

          const run = store.loadRun(reviewRunId);
          if (!run) throw new Error("expected review run");
          const terminalRecord = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
          const logSink = openLogSink(logsPath);
          const failingGit = async (_cwd: string, args: readonly string[]) => {
            if (args[0] === "push") throw new Error("failed to push some refs to origin");
            return "";
          };
          const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            logSink,
            completionCommitter: createCompletionCommitter(),
            completionPublisher: createCompletionPublisher({ git: failingGit }),
            readyFinalizer: async () => {},
          });
          logSink.close();

          expect(outcome).toMatchObject({ ok: false });
          expect(outcome.ok === false ? outcome.message : "").toContain("failed to push");
          const settledTerminal = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
          expect(settledTerminal?.event).toMatchObject({
            kind: "loop_finished",
            loopOutcomeKind: "completion_commit_failed",
            completionCommitError: outcome.ok === false ? outcome.message : undefined,
          });
          // @mutate v2/src/execution/workflow-runner.ts "completionCommitError: reviewMutationPublicationCommitError" -> ""
        });
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });

    test("review-mutation recovery fence regression fails when guard is bypassed", async () => {
      const workspace = initGitWorkspace("review-mutation-repair-fence-bypass-");
      const logsPath = join(tmpdir(), `review-mutation-repair-fence-bypass-${randomUUID()}.jsonl`);
      try {
        await withStateStore(async (store) => {
          const { run, terminalRecord } = await seedReviewMutationRepairFenceResume(workspace, store, logsPath);

          let fencedCommitCalls = 0;
          const fenced = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            completionCommitter: async () => {
              fencedCommitCalls += 1;
              return { commitSha: "deadbeef", filesChanged: 1 };
            },
            completionPublisher: async () => ({ pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" }),
            readyFinalizer: async () => {},
          });
          expect(fenced).toMatchObject({ ok: false });
          expect(fencedCommitCalls).toBe(0);

          let bypassedCommitCalls = 0;
          const bypassed = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            completionCommitter: async () => {
              bypassedCommitCalls += 1;
              return { commitSha: "deadbeef", filesChanged: 1 };
            },
            completionPublisher: async () => ({ pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" }),
            readyFinalizer: async () => {},
            bypassPersistedReadyGateRepairFenceForTest: true,
          });
          expect(bypassed).toMatchObject({ ok: true });
          expect(bypassedCommitCalls).toBeGreaterThan(0);
        });
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });
  });

  describe("review-mutation recovery markdown-only fence", () => {
    const MARKDOWN_OUTPUT_ROOTS = ["ready-intents", ".jarvis-intent-stage"] as const;

    function initReviewMutationMarkdownOnlyFenceWorktree(workspace: string): string {
      mkdirSync(join(workspace, "ready-intents"), { recursive: true });
      mkdirSync(join(workspace, ".jarvis-intent-stage"), { recursive: true });
      mkdirSync(join(workspace, "v2", "src"), { recursive: true });
      writeFileSync(join(workspace, "ready-intents", "seed.md"), "# seed\n", "utf8");
      writeFileSync(join(workspace, ".jarvis-intent-stage", "draft.md"), "# draft\n", "utf8");
      writeFileSync(join(workspace, "v2/src/untouched.test.ts"), "export {}\n", "utf8");
      execFileSync("git", ["add", "-A"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "seed"], { cwd: workspace });
      const baseRef = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: workspace,
        encoding: "utf8",
      }).trim();
      writeFileSync(join(workspace, "ready-intents", "seed.md"), "ok\n", "utf8");
      writeFileSync(join(workspace, "v2/src/untouched.test.ts"), "iteration\n", "utf8");
      execFileSync("git", ["add", "-A"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "iteration"], { cwd: workspace });
      return baseRef;
    }

    async function seedReviewMutationMarkdownOnlyFenceResume(
      workspace: string,
      store: ReturnType<typeof openStateStore>,
      logsPath: string,
    ) {
      const snapshot = reviewMutationWorkflowSnapshot(
        "review-mutation-markdown-only-fence",
        "implement: markdown-only-fence",
      );
      const branch = "review-mutation/markdown-only-fence";
      const baseRef = initReviewMutationMarkdownOnlyFenceWorktree(workspace);
      const base = {
        project: "demo",
        specRef: baseRef,
        worktreePath: workspace,
        branch,
        specPath: "ready-intents",
        workflowSnapshot: snapshot,
      };
      const writeRunId = store.createRun({ ...base, stepId: "implement" });
      store.setRunStatus(writeRunId, "completed");
      const writeAttemptId = store.recordAttemptStart(writeRunId);
      store.commitCompletionBoundary({
        attemptId: writeAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex",
      });
      store.setReadyGateRepairFence(writeRunId, {
        allowedPaths: ["ready-intents/seed.md", "v2/src/untouched.test.ts"],
        markdownOnly: true,
        markdownOutputRoots: [...MARKDOWN_OUTPUT_ROOTS],
        offendingPath: "v2/src/untouched.test.ts",
        outcomeKind: "completion_commit_failed",
      });
      const reviewRunId = store.createRun({ ...base, stepId: "implement-review" });
      const reviewAttemptId = store.recordAttemptStart(reviewRunId);
      store.commitCompletionBoundary({
        attemptId: reviewAttemptId,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
        invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message: "prior mutation" },
      });
      const seedSink = openLogSink(logsPath);
      seedSink.append(reviewRunId, {
        kind: "loop_finished",
        loopOutcomeKind: "surviving_mutation_failed",
        iterationsConsumed: 0,
        resumable: true,
      });
      seedSink.close();
      writeFileSync(join(workspace, "v2/src/untouched.test.ts"), "changed\n", "utf8");
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const terminalRecord = findTerminalLogRecord(openLogReader(logsPath).tail(reviewRunId));
      return { run, terminalRecord, writeRunId, reviewRunId };
    }

    test("rejected non-markdown path cannot be swept into review-mutation recovery commit or publish", async () => {
      const workspace = initGitWorkspace("review-mutation-markdown-only-fence-");
      const logsPath = join(tmpdir(), `review-mutation-markdown-only-fence-${randomUUID()}.jsonl`);
      try {
        await withStateStore(async (store) => {
          const { run, terminalRecord } = await seedReviewMutationMarkdownOnlyFenceResume(workspace, store, logsPath);
          let commitCalls = 0;
          let publishCalls = 0;
          const logSink = openLogSink(logsPath);
          const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            logSink,
            completionCommitter: async () => {
              commitCalls += 1;
              return { commitSha: "deadbeef", filesChanged: 1 };
            },
            completionPublisher: async () => {
              publishCalls += 1;
              return { pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" };
            },
            readyFinalizer: async () => {},
          });
          logSink.close();

          expect(outcome).toMatchObject({ ok: false });
          expect(outcome.ok === false ? outcome.message : "").toContain(
            "Ready-gate repair stages path outside markdown workflow output roots:",
          );
          expect(outcome.ok === false ? outcome.message : "").toContain("v2/src/untouched.test.ts");
          expect(commitCalls).toBe(0);
          expect(publishCalls).toBe(0);
          const settledTerminal = findTerminalLogRecord(openLogReader(logsPath).tail(run.id));
          expect(settledTerminal?.event).toMatchObject({
            kind: "loop_finished",
            loopOutcomeKind: "completion_commit_failed",
            resumable: true,
          });
        });
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });

    test("review-mutation recovery markdown-only fence regression fails when guard is bypassed", async () => {
      const workspace = initGitWorkspace("review-mutation-markdown-only-fence-bypass-");
      const logsPath = join(tmpdir(), `review-mutation-markdown-only-fence-bypass-${randomUUID()}.jsonl`);
      try {
        await withStateStore(async (store) => {
          const { run, terminalRecord, writeRunId } = await seedReviewMutationMarkdownOnlyFenceResume(
            workspace,
            store,
            logsPath,
          );
          const persisted = store.loadRun(writeRunId);
          expect(persisted?.readyGateRepairFence?.markdownOutputRoots).toEqual(
            expect.arrayContaining([...MARKDOWN_OUTPUT_ROOTS]),
          );
          // Mutation checkpoint: remove `.endsWith(".md")` / under-root rejection in
          // `findFirstMarkdownOnlyFenceViolation`.
          const withoutMarkdownFence = findFirstMarkdownOnlyFenceViolation(
            ["v2/src/untouched.test.ts"],
            persisted?.readyGateRepairFence?.markdownOutputRoots ?? [],
          );
          expect(withoutMarkdownFence).toBe("v2/src/untouched.test.ts");

          let fencedCommitCalls = 0;
          const fenced = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            completionCommitter: async () => {
              fencedCommitCalls += 1;
              return { commitSha: "deadbeef", filesChanged: 1 };
            },
            completionPublisher: async () => ({ pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" }),
            readyFinalizer: async () => {},
          });
          expect(fenced).toMatchObject({ ok: false });
          expect(fencedCommitCalls).toBe(0);

          let bypassedCommitCalls = 0;
          const bypassed = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            completionCommitter: async () => {
              bypassedCommitCalls += 1;
              return { commitSha: "deadbeef", filesChanged: 1 };
            },
            completionPublisher: async () => ({ pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" }),
            readyFinalizer: async () => {},
            bypassPersistedReadyGateRepairFenceForTest: true,
          });
          expect(bypassed).toMatchObject({ ok: true });
          expect(bypassedCommitCalls).toBeGreaterThan(0);
        });
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });

    test("review-mutation recovery fails closed when persisted markdown roots are missing on markdown-only run", async () => {
      const workspace = initGitWorkspace("review-mutation-markdown-only-fence-missing-roots-");
      const logsPath = join(tmpdir(), `review-mutation-markdown-only-fence-missing-roots-${randomUUID()}.jsonl`);
      try {
        await withStateStore(async (store) => {
          const { run, terminalRecord, writeRunId } = await seedReviewMutationMarkdownOnlyFenceResume(
            workspace,
            store,
            logsPath,
          );
          const persisted = store.loadRun(writeRunId);
          store.setReadyGateRepairFence(writeRunId, {
            allowedPaths: [...(persisted?.readyGateRepairFence?.allowedPaths ?? [])],
            markdownOnly: true,
            ...(persisted?.readyGateRepairFence?.offendingPath !== undefined
              ? { offendingPath: persisted.readyGateRepairFence.offendingPath }
              : {}),
            outcomeKind: "completion_commit_failed",
          });

          let commitCalls = 0;
          let publishCalls = 0;
          const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            completionCommitter: async () => {
              commitCalls += 1;
              return { commitSha: "deadbeef", filesChanged: 1 };
            },
            completionPublisher: async () => {
              publishCalls += 1;
              return { pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" };
            },
            readyFinalizer: async () => {},
          });

          expect(outcome).toMatchObject({ ok: false });
          expect(outcome.ok === false ? outcome.message : "").toContain(
            "Ready-gate repair fence could not reconstruct persisted markdown workflow output roots",
          );
          expect(commitCalls).toBe(0);
          expect(publishCalls).toBe(0);

          let bypassedCommitCalls = 0;
          const bypassed = await resumeReviewMutationFinalization(run, store, terminalRecord, {
            completionCommitter: async () => {
              bypassedCommitCalls += 1;
              return { commitSha: "deadbeef", filesChanged: 1 };
            },
            completionPublisher: async () => ({ pushSha: "deadbeef", prNumber: 3, prUrl: "https://example.test/pr/3" }),
            readyFinalizer: async () => {},
            bypassPersistedReadyGateRepairFenceForTest: true,
          });
          expect(bypassed).toMatchObject({ ok: true });
          expect(bypassedCommitCalls).toBeGreaterThan(0);
        });
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });
  });

  function publicationRepairIntroducedMutationSteps(branchName: string): {
    implementStep: WriteWorkflowStep;
    reviewStep: ReviewDebateWorkflowStep;
    verifyCalls: () => number;
    implementInvocations: () => number;
    mutation: string;
    sourceFile: string;
    sourceLine: number;
  } {
    let verifyCalls = 0;
    let implementInvocations = 0;
    const mutation = "operator-flip: === → !==";
    const sourceFile = "src/guard.ts";
    const sourceLine = 17;
    const implementStep = createStep({
      stepId: "implement",
      role: "implement",
      promptId: "patch.prompt.body",
      branchName,
      verifyDiffDerivedMutations: async () => {
        verifyCalls += 1;
        return {
          kind: "pass",
          runBase: "HEAD",
          inspectedPaths: [],
          candidateCount: 0,
          acceptedSites: [],
        };
      },
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: async ({ cwd }) => {
          implementInvocations += 1;
          writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
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
    const reviewStep = createDebateStep({
      stepId: "implement-review",
      branch: branchName,
      cwd: worktreePath,
      verdictPath: join(worktreePath, "verdict-patch.md"),
      profileContext: { specPath: "spec.md", cwd: worktreePath, baseBranch: "HEAD", passNumber: 1, totalPasses: 1 },
      prompts: {
        adversary: "implement.prompt.review.adversary",
        advocate: "implement.prompt.review.advocate",
        adjudicator: "implement.prompt.review.adjudicator",
      },
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => ({
        kind: "ok",
        stdout: adapterModel === "ADJ" ? "" : "ok",
        stderr: "",
      })),
    });
    return {
      implementStep,
      reviewStep,
      verifyCalls: () => verifyCalls,
      implementInvocations: () => implementInvocations,
      mutation,
      sourceFile,
      sourceLine,
    };
  }

  test("publication-time repair-introduced surviving mutation settles surviving_mutation_failed", async () => {
    const branchName = "publication-repair-mutation-settle";
    const { implementStep, reviewStep, verifyCalls, mutation, sourceFile, sourceLine } =
      publicationRepairIntroducedMutationSteps(branchName);
    const logSink = new TestLogSink();

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "implement-commit-sha", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new SurvivingMutationError(mutation, sourceFile, sourceLine);
        },
      });

      expect(result.kind).toBe("surviving_mutation_failed");
      expect(result.resumable).toBe(true);
      expect(verifyCalls()).toBe(1);

      const reviewRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement-review",
      });
      const implementRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement",
      });
      expect(reviewRun).not.toBeNull();
      expect(reviewRun?.id).toBe(result.runId);
      expect(implementRun?.status).toBe("completed");
      expect(store.loadRun(result.runId)?.status).toBe("failed");
      expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
        kind: "loop_finished",
        loopOutcomeKind: "surviving_mutation_failed",
        resumable: true,
        survivingMutation: mutation,
        survivingMutationSourceFile: sourceFile,
        survivingMutationSourceLine: sourceLine,
      });

      const run = store.loadRun(result.runId);
      if (!run) throw new Error("expected review run");
      const terminalRecord = findTerminalLogRecord(logSink.tail(result.runId));
      expect(resolveReviewMutationResumeContext(run, store, terminalRecord)).toMatchObject({ ok: true });
    });
  });

  test("publication-time repair-introduced surviving mutation does not reprompt implement", async () => {
    const branchName = "publication-repair-mutation-no-reprompt";
    const { implementStep, reviewStep, verifyCalls, implementInvocations, mutation, sourceFile, sourceLine } =
      publicationRepairIntroducedMutationSteps(branchName);
    const logSink = new TestLogSink();

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [implementStep, reviewStep],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "implement-commit-sha", filesChanged: 1 }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new SurvivingMutationError(mutation, sourceFile, sourceLine);
        },
      });

      expect(result.kind).toBe("surviving_mutation_failed");
      expect(verifyCalls()).toBe(1);
      const invocationsAfterPublicationFailure = implementInvocations();

      const implementRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement",
      });
      expect(implementRun?.status).toBe("completed");
      expect(logSink.getEventsForRun(implementRun?.id ?? "").map((event) => event.kind)).not.toContain(
        "surviving_mutation_reprompt",
      );
      expect(logSink.getEventsForRun(result.runId).map((event) => event.kind)).not.toContain(
        "surviving_mutation_reprompt",
      );
      expect(implementInvocations()).toBe(invocationsAfterPublicationFailure);

      const run = store.loadRun(result.runId);
      if (!run) throw new Error("expected review run");
      const terminalRecord = findTerminalLogRecord(logSink.tail(result.runId));
      expect(resolveReviewMutationResumeContext(run, store, terminalRecord)).toMatchObject({ ok: true });
      expect(composeRunOperatorError(run, terminalRecord)).toMatchObject({
        reason: "surviving_mutation_failed",
        retryable: true,
        nextAction: "resume",
      });
    });
  });

  function reviewMutationWorkflowSnapshot(
    invocationId: string,
    creationTitle: string,
    reviewStep: { stepId: string; role: string; durable?: boolean; behavior: "review" } = {
      stepId: "implement-review",
      role: "",
      durable: true,
      behavior: "review",
    },
  ) {
    return {
      invocationId,
      creationTitle,
      steps: [
        {
          stepId: "implement",
          role: "implement",
          stepRules: "implement rules",
          expectedArtifactPath: "artifact",
          agents: ["codex"],
          agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
        },
        reviewStep,
      ],
    };
  }

  function survivingMutationTerminalRecord(
    runId: string,
    loopOutcomeKind: "surviving_mutation_failed" | "runtime_smoke_failed" = "surviving_mutation_failed",
  ) {
    return {
      ts: new Date().toISOString(),
      seq: 1,
      runId,
      event: {
        kind: "loop_finished" as const,
        loopOutcomeKind,
        iterationsConsumed: 0,
        resumable: true,
      },
    };
  }

  function reviewMutationSiblingFixture(
    store: ReturnType<typeof openStateStore>,
    overrides: { writeStepId: string; writeStatus: "in-progress" | "completed" },
  ) {
    const snapshot = reviewMutationWorkflowSnapshot("review-mutation-guard", "implement: guard");
    const base = { project: "demo", specRef: "main", worktreePath: "/fake/guard", branch: "review-mutation/guard" };
    const writeRunId = store.createRun({
      ...base,
      specPath: "spec.md",
      stepId: overrides.writeStepId,
      workflowSnapshot: snapshot,
    });
    store.setRunStatus(writeRunId, overrides.writeStatus);
    const reviewRunId = store.createRun({
      ...base,
      specPath: "spec.md",
      stepId: "implement-review",
      workflowSnapshot: snapshot,
    });
    store.setRunStatus(reviewRunId, "failed");
    return { writeRunId, reviewRunId, run: store.loadRun(reviewRunId) };
  }

  test("review-mutation resume retains ready gate terminal evidence", async () => {
    const workspace = initGitWorkspace("review-mutation-ready-gate-");
    try {
      writeFileSync(join(workspace, "spec.md"), "# Spec\n", "utf8");
      execFileSync("git", ["add", "spec.md"], { cwd: workspace });
      execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
      const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();
      await withStateStore(async (store) => {
        const snapshot = reviewMutationWorkflowSnapshot("review-mutation-ready-gate", "implement: ready gate");
        const base = {
          project: "demo",
          specRef: baseRef,
          worktreePath: workspace,
          branch: "review-mutation/ready-gate",
          specPath: "spec.md",
          workflowSnapshot: snapshot,
        };
        const writeRunId = store.createRun({ ...base, stepId: "implement" });
        const writeAttemptId = store.recordAttemptStart(writeRunId);
        store.commitCompletionBoundary({
          attemptId: writeAttemptId,
          runStatus: "completed",
          outcomeKind: "done",
          completionAgent: "codex",
        });
        const reviewRunId = store.createRun({ ...base, stepId: "implement-review" });
        store.setRunStatus(reviewRunId, "failed");
        const run = store.loadRun(reviewRunId);
        if (!run) throw new Error("expected review run");
        const terminalRecord = survivingMutationTerminalRecord(reviewRunId);
        const logSink = new TestLogSink();
        const outcome = await resumeReviewMutationFinalization(run, store, terminalRecord, {
          logSink,
          completionCommitter: async () => ({ commitSha: "deadbeef", filesChanged: 1 }),
          completionPublisher: async () => ({}),
          runFixCommand: async () => {},
          readyFinalizer: async (input) => {
            expect(input.skipReadyGate).toBe(false);
            throw new ReadyGateError("bun run review-ready", 1, "review gate red");
          },
        });

        expect(outcome).toMatchObject({ ok: false });
        expect(logSink.getEventsForRun(reviewRunId).at(-1)).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: "ready_gate_failed",
          readyGateCommand: "bun run review-ready",
          readyGateOutput: "review gate red",
        });
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("rejects admission when the only write-step sibling is a linked pass that never completed", async () => {
    await withStateStore(async (store) => {
      const { run } = reviewMutationSiblingFixture(store, {
        writeStepId: "implement~link-1",
        writeStatus: "in-progress",
      });
      if (!run) throw new Error("expected review run");
      const resolved = resolveReviewMutationResumeContext(run, store, survivingMutationTerminalRecord(run.id));
      expect(resolved).toMatchObject({ ok: false });
    });
  });

  test("excludes a non-durable light implement-review row sharing the durable review stepId from admission", async () => {
    await withStateStore(async (store) => {
      // `durable: false` — the shape a light review step's snapshot entry actually carries
      // (production always stamps an explicit boolean; never omits it): a light review sharing
      // the review stepId is not a recovery target.
      const snapshot = reviewMutationWorkflowSnapshot("review-mutation-light", "implement: light", {
        stepId: "implement-review",
        role: "",
        durable: false,
        behavior: "review",
      });
      const base = { project: "demo", specRef: "main", worktreePath: "/fake/light", branch: "review-mutation/light" };
      const writeRunId = store.createRun({
        ...base,
        specPath: "spec.md",
        stepId: "implement",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(writeRunId, "completed");
      const writeAttemptId = store.recordAttemptStart(writeRunId);
      store.commitCompletionBoundary({
        attemptId: writeAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex",
      });
      const reviewRunId = store.createRun({
        ...base,
        specPath: "spec.md",
        stepId: "implement-review",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(reviewRunId, "failed");
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const resolved = resolveReviewMutationResumeContext(run, store, survivingMutationTerminalRecord(run.id));
      expect(resolved).toMatchObject({ ok: false });
    });
  });

  test("rejects re-admission of a runtime_smoke_failed row settled by this same resume tail (inverted: would wrongly re-admit)", async () => {
    await withStateStore(async (store) => {
      const { run } = reviewMutationSiblingFixture(store, { writeStepId: "implement", writeStatus: "completed" });
      if (!run) throw new Error("expected review run");
      const resolved = resolveReviewMutationResumeContext(
        run,
        store,
        survivingMutationTerminalRecord(run.id, "runtime_smoke_failed"),
      );
      expect(resolved).toMatchObject({ ok: false });
    });
  });

  test("rejects admission when no write-step sibling row exists at all", async () => {
    await withStateStore(async (store) => {
      const snapshot = reviewMutationWorkflowSnapshot("review-mutation-missing-sibling", "implement: missing");
      const base = {
        project: "demo",
        specRef: "main",
        worktreePath: "/fake/missing",
        branch: "review-mutation/missing",
      };
      // No "implement" (or "implement~link-*") row is ever created — only the review row exists.
      const reviewRunId = store.createRun({
        ...base,
        specPath: "spec.md",
        stepId: "implement-review",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(reviewRunId, "failed");
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const resolved = resolveReviewMutationResumeContext(run, store, survivingMutationTerminalRecord(run.id));
      expect(resolved).toMatchObject({ ok: false });
    });
  });

  test("rejects a completed write-step candidate from a different invocation sharing the same stepId (inverted: would wrongly cross-admit)", async () => {
    await withStateStore(async (store) => {
      const snapshot = reviewMutationWorkflowSnapshot(
        "review-mutation-cross-invocation",
        "implement: cross-invocation",
      );
      const foreignSnapshot = { ...snapshot, invocationId: "review-mutation-cross-invocation-OTHER" };
      const base = {
        project: "demo",
        specRef: "main",
        worktreePath: "/fake/cross-invocation",
        branch: "review-mutation/cross-invocation",
      };
      // A completed "implement" row exists, but tagged with a different invocationId in its own
      // snapshot — findRunsByInvocationId(reviewRun's invocationId) must not surface it.
      const writeRunId = store.createRun({
        ...base,
        specPath: "spec.md",
        stepId: "implement",
        workflowSnapshot: foreignSnapshot,
      });
      store.setRunStatus(writeRunId, "completed");
      const writeAttemptId = store.recordAttemptStart(writeRunId);
      store.commitCompletionBoundary({
        attemptId: writeAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex",
      });
      const reviewRunId = store.createRun({
        ...base,
        specPath: "spec.md",
        stepId: "implement-review",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(reviewRunId, "failed");
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const resolved = resolveReviewMutationResumeContext(run, store, survivingMutationTerminalRecord(run.id));
      expect(resolved).toMatchObject({ ok: false });
    });
  });

  test("rejects a completed write-step candidate from a different project/branch sharing the invocation id (inverted: would wrongly cross-admit)", async () => {
    await withStateStore(async (store) => {
      const snapshot = reviewMutationWorkflowSnapshot("review-mutation-cross-branch", "implement: cross-branch");
      // A completed "implement" row for the same invocationId, but a different branch — must not
      // be treated as this review row's sibling.
      const writeRunId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath: "/fake/cross-branch-other",
        branch: "review-mutation/cross-branch-OTHER",
        specPath: "spec.md",
        stepId: "implement",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(writeRunId, "completed");
      const writeAttemptId = store.recordAttemptStart(writeRunId);
      store.commitCompletionBoundary({
        attemptId: writeAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex",
      });
      const reviewRunId = store.createRun({
        project: "demo",
        specRef: "main",
        worktreePath: "/fake/cross-branch",
        branch: "review-mutation/cross-branch",
        specPath: "spec.md",
        stepId: "implement-review",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(reviewRunId, "failed");
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const terminalRecord = {
        ts: new Date().toISOString(),
        seq: 1,
        runId: run.id,
        event: {
          kind: "loop_finished" as const,
          loopOutcomeKind: "surviving_mutation_failed" as const,
          iterationsConsumed: 0,
          resumable: true,
        },
      };
      const resolved = resolveReviewMutationResumeContext(run, store, terminalRecord);
      expect(resolved).toMatchObject({ ok: false });
    });
  });

  test("a rejected row is refused before any attempt is recorded or any committer/publisher/ready-finalizer dep is invoked", async () => {
    await withStateStore(async (store) => {
      // Write sibling never completed: admission must fail here, before `resumeReviewMutationFinalization`
      // ever reaches its commit/mutation-reverify/ready-gate/publish tail.
      const { run } = reviewMutationSiblingFixture(store, { writeStepId: "implement", writeStatus: "in-progress" });
      if (!run) throw new Error("expected review run");
      const attemptsBefore = run.attempts.length;

      let committerCalled = false;
      let publisherCalled = false;
      let readyFinalizerCalled = false;
      const outcome = await resumeReviewMutationFinalization(run, store, survivingMutationTerminalRecord(run.id), {
        completionCommitter: async () => {
          committerCalled = true;
          throw new Error("committer must not be invoked on rejected admission");
        },
        completionPublisher: async () => {
          publisherCalled = true;
          throw new Error("publisher must not be invoked on rejected admission");
        },
        readyFinalizer: async () => {
          readyFinalizerCalled = true;
          throw new Error("ready finalizer must not be invoked on rejected admission");
        },
      });

      expect(outcome).toMatchObject({ ok: false });
      expect(committerCalled).toBe(false);
      expect(publisherCalled).toBe(false);
      expect(readyFinalizerCalled).toBe(false);
      const settled = store.loadRun(run.id);
      expect(settled?.attempts.length).toBe(attemptsBefore);
    });
  });

  test("among multiple completed linked-write candidates, resolves the one with the latest completed-boundary timestamp", async () => {
    await withStateStore(async (store) => {
      const snapshot = reviewMutationWorkflowSnapshot("review-mutation-tie-break", "implement: tie-break");
      const base = { project: "demo", specRef: "main", branch: "review-mutation/tie-break" };
      const earlierRunId = store.createRun({
        ...base,
        worktreePath: "/fake/tie-break-earlier",
        specPath: "spec-earlier.md",
        stepId: "implement~link-1",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(earlierRunId, "completed");
      const earlierAttemptId = store.recordAttemptStart(earlierRunId);
      store.commitCompletionBoundary({
        attemptId: earlierAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex-earlier",
      });

      // Force a distinct millisecond boundary so the two completion timestamps differ without
      // relying on a fixed sleep duration.
      const boundary = Date.now();
      while (Date.now() === boundary) {
        /* busy-wait for the next millisecond */
      }

      const laterRunId = store.createRun({
        ...base,
        worktreePath: "/fake/tie-break-later",
        specPath: "spec-later.md",
        stepId: "implement~link-2",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(laterRunId, "completed");
      const laterAttemptId = store.recordAttemptStart(laterRunId);
      store.commitCompletionBoundary({
        attemptId: laterAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex-later",
      });

      const reviewRunId = store.createRun({
        ...base,
        worktreePath: "/fake/tie-break-review",
        specPath: "spec.md",
        stepId: "implement-review",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(reviewRunId, "failed");
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const resolved = resolveReviewMutationResumeContext(run, store, survivingMutationTerminalRecord(run.id));
      expect(resolved).toMatchObject({
        ok: true,
        context: { specPath: "spec-later.md", worktreePath: "/fake/tie-break-later", completionAgent: "codex-later" },
      });
    });
  });

  test("selects on attempt-completion order even when it contradicts row-creation order", async () => {
    await withStateStore(async (store) => {
      const snapshot = reviewMutationWorkflowSnapshot("review-mutation-out-of-order", "implement: out of order");
      const base = { project: "demo", specRef: "main", branch: "review-mutation/out-of-order" };
      // Created first, completed *last* — the winner by completion order, the loser by creation order.
      const firstCreatedId = store.createRun({
        ...base,
        worktreePath: "/fake/out-of-order-first-created",
        specPath: "spec-first-created.md",
        stepId: "implement~link-1",
        workflowSnapshot: snapshot,
      });
      const created = Date.now();
      while (Date.now() === created) {
        /* busy-wait so the two rows carry distinct creation timestamps */
      }
      const secondCreatedId = store.createRun({
        ...base,
        worktreePath: "/fake/out-of-order-second-created",
        specPath: "spec-second-created.md",
        stepId: "implement~link-2",
        workflowSnapshot: snapshot,
      });

      store.setRunStatus(secondCreatedId, "completed");
      const secondAttemptId = store.recordAttemptStart(secondCreatedId);
      store.commitCompletionBoundary({
        attemptId: secondAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex-second-created",
      });

      // Force a distinct millisecond so the two completion timestamps differ.
      const boundary = Date.now();
      while (Date.now() === boundary) {
        /* busy-wait for the next millisecond */
      }

      store.setRunStatus(firstCreatedId, "completed");
      const firstAttemptId = store.recordAttemptStart(firstCreatedId);
      store.commitCompletionBoundary({
        attemptId: firstAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex-first-created",
      });

      const reviewRunId = store.createRun({
        ...base,
        worktreePath: "/fake/out-of-order-review",
        specPath: "spec.md",
        stepId: "implement-review",
        workflowSnapshot: snapshot,
      });
      store.setRunStatus(reviewRunId, "failed");
      const run = store.loadRun(reviewRunId);
      if (!run) throw new Error("expected review run");
      const resolved = resolveReviewMutationResumeContext(run, store, survivingMutationTerminalRecord(run.id));
      // Attempt completion, not `createdAt`, decides: skipping uncompleted attempts must leave a real
      // completion timestamp behind, or this falls back to creation order and picks the wrong row.
      expect(resolved).toMatchObject({
        ok: true,
        context: {
          specPath: "spec-first-created.md",
          worktreePath: "/fake/out-of-order-first-created",
          completionAgent: "codex-first-created",
        },
      });
    });
  });
});
