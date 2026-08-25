import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import {
  config,
  createBindingFactory,
  createIntentWorktreeHarness,
  createStep,
  externalWorktreeBinding,
  reviewedIntentStep,
  stageReviewedIntent,
  TestLogSink,
} from "./workflow-runner.test-support.ts";
import { executeWorkflow, type ReviewWorkflowStep, type WriteWorkflowStep } from "./workflow-runner.ts";

describe("executeWorkflow review dispatch", () => {
  test("aggregates missing critic and actuator bindings before durable state", async () => {
    const step: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review-1",
      project: "demo",
      branch: "review-invalid",
      cwd: "/fake",
      prompt: "inspect",
      verdictPath: "/fake/verdict.md",
      maxCycles: 1,
      agents: { critic: ["codex"], actuator: ["claude"] },
      agentModelConfig: config,
    };

    await withStateStore(async (store) => {
      await expect(executeWorkflow({ steps: [step], stateStore: store })).rejects.toThrow(
        "(review-1, critic, codex), (review-1, actuator, claude)",
      );
      expect(store.listRuns()).toHaveLength(0);
    });
  });

  test("falls through quota independently for critic and actuator orders", async () => {
    const calls: string[] = [];
    const step: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review-fallback",
      project: "demo",
      branch: "review-fallback",
      cwd: "/fake",
      prompt: "inspect",
      verdictPath: join(mkdtempSync(join(tmpdir(), "workflow-review-")), "verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude", "codex"], actuator: ["claude", "codex"] },
      agentModelConfig: {
        claude: {
          critic: {
            rungs: [
              { adapterModel: "critic-1", priceKey: "critic-1" },
              { adapterModel: "critic-2", priceKey: "critic-2" },
            ],
          },
          actuator: { rungs: [{ adapterModel: "actuator-1", priceKey: "actuator-1" }] },
        },
        codex: {
          critic: { rungs: [{ adapterModel: "critic-3", priceKey: "critic-3" }] },
          actuator: { rungs: [{ adapterModel: "actuator-2", priceKey: "actuator-2" }] },
        },
      },
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async () => {
          calls.push(adapterModel);
          if (["critic-1", "critic-2", "actuator-1"].includes(adapterModel)) {
            return { kind: "quota" as const, stderr: "quota" };
          }
          return { kind: "ok" as const, stdout: adapterModel.startsWith("critic") ? "fix" : "done", stderr: "" };
        },
      }),
    };

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });

      expect(result).toMatchObject({ kind: "complete", iterationsConsumed: 1, resumable: false });
      expect(calls).toEqual(["critic-1", "critic-2", "critic-3", "actuator-1", "actuator-2"]);
    });
  });

  test("accounts for failed critic cycles and suppresses later steps", async () => {
    const step: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review-failed",
      project: "demo",
      branch: "review-failed",
      cwd: "/fake",
      prompt: "inspect",
      verdictPath: join(mkdtempSync(join(tmpdir(), "workflow-review-")), "verdict.md"),
      maxCycles: 3,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => ({ kind: "error" as const, exitCode: 1, stderr: "failed" }),
      }),
    };
    const later = createStep({
      stepId: "later",
      role: "plan",
      branchName: "review-failed",
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "plan", priceKey: "plan" }] } } },
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step, later], stateStore: store });

      expect(result).toMatchObject({ kind: "invocation_failure", stepIndex: 0, iterationsConsumed: 1 });
      expect(store.findRunByProjectBranch({ project: "demo", branch: "review-failed", stepId: "later" })).toBeNull();
    });
  });

  test("fires the synthesized run callback before role execution and does not reuse review-only identity", async () => {
    const step = (branch: string, calls: string[]): ReviewWorkflowStep => ({
      behavior: "review",
      stepId: "review-only",
      project: "demo",
      branch,
      cwd: "/fake",
      prompt: "inspect",
      verdictPath: join(mkdtempSync(join(tmpdir(), "workflow-review-")), "verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async ({ prompt }) => {
          calls.push(`${agentId}:${prompt}`);
          return { kind: "ok" as const, stdout: agentId === "claude" ? "" : "done", stderr: "" };
        },
      }),
    });

    const runIds: string[] = [];
    const calls: string[] = [];
    await withStateStore(async (store) => {
      const first = await executeWorkflow({
        steps: [step("review-only", calls)],
        stateStore: store,
        onStepRunCreated: (_index, runId) => {
          runIds.push(runId);
          expect(calls).toHaveLength(0);
        },
      });
      const second = await executeWorkflow({ steps: [step("review-only", calls)], stateStore: store });

      expect(first.kind).toBe("complete");
      expect(first.resumable).toBe(false);
      expect(second.runId).not.toBe(first.runId);
      expect(runIds[0]).toBe(first.runId);
      expect(calls).toEqual(["claude:inspect", "claude:inspect"]);
    });
  });

  test("a review step without a durable run row appends no log events", async () => {
    const step: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review-only",
      project: "demo",
      branch: "review-no-log",
      cwd: "/fake",
      prompt: "inspect",
      verdictPath: join(mkdtempSync(join(tmpdir(), "workflow-review-")), "verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => ({ kind: "ok" as const, stdout: agentId === "claude" ? "" : "done", stderr: "" }),
      }),
    };

    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });
      expect(result.kind).toBe("complete");
      expect(logSink.events).toHaveLength(0);
    });
  });

  test("marks ordinary plan review non-durable while reusing its mixed-workflow snapshot", async () => {
    const calls: string[] = [];
    const makeReview = (): ReviewWorkflowStep => ({
      behavior: "review",
      stepId: "review-1",
      project: "demo",
      branch: "mixed-review",
      cwd: "/fake",
      prompt: "inspect",
      verdictPath: join(mkdtempSync(join(tmpdir(), "workflow-review-")), "verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => {
          calls.push(agentId);
          return { kind: "ok" as const, stdout: "", stderr: "" };
        },
      }),
    });
    const makeWrite = () =>
      createStep({
        stepId: "write-1",
        role: "plan",
        branchName: "mixed-review",
        agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "plan", priceKey: "plan" }] } } },
      });

    await withStateStore(async (store) => {
      const first = await executeWorkflow({ steps: [makeReview(), makeWrite()], stateStore: store });
      const writeRun = store.findRunByProjectBranch({ project: "demo", branch: "mixed-review", stepId: "write-1" });
      expect(first.kind).toBe("complete");
      expect(writeRun?.workflowSnapshot?.steps.map((entry) => [entry.stepId, entry.behavior, entry.durable])).toEqual([
        ["review-1", "review", false],
        ["write-1", undefined, true],
      ]);

      const second = await executeWorkflow({ steps: [makeReview(), makeWrite()], stateStore: store });
      expect(second.kind).toBe("complete");
      expect(
        store.findRunByProjectBranch({ project: "demo", branch: "mixed-review", stepId: "write-1" })?.attempts,
      ).toHaveLength(1);
      expect(calls).toHaveLength(2);
    });
  });

  /** A git-enabled write step (intent split) feeding a durable reviewed-intent review step. */
  function twoFileIntentWorkflow(
    branchName: string,
    reviewOverrides: {
      criticStdout: string;
      actuator?: (cwd: string) => void | Promise<void>;
    },
  ): {
    harness: ReturnType<typeof createIntentWorktreeHarness>;
    durableDir: string;
    stagingDir: string;
    verdictPath: string;
    calls: string[];
    writeStep: WriteWorkflowStep;
    reviewStep: ReviewWorkflowStep;
  } {
    const harness = createIntentWorktreeHarness(branchName);
    const workspace = harness.workspace;
    const durableDir = join(workspace, "ready-intents");
    const stagingDir = join(workspace, ".jarvis-intent-stage");
    const verdictPath = join(workspace, ".jarvis-intent-review-verdict.md");
    const splitConfig: AgentModelConfig = {
      claude: {
        plan: { rungs: [{ adapterModel: "split", priceKey: "split" }] },
        critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] },
      },
      codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
    };
    const calls: string[] = [];

    const writeStep: WriteWorkflowStep = {
      behavior: "write",
      stepId: "split",
      role: "plan",
      worktree: {
        projectRoot: workspace,
        projectName: "demo",
        branchName,
        baseRef: "HEAD",
        git: false,
        localPath: workspace,
      },
      withExternalWorktree: harness.withExternalWorktree,
      specPath: durableDir,
      expectedArtifactPath: ".jarvis-intent-stage",
      stepRules: "Return exactly one terminal token.",
      promptId: "intent.prompt.split",
      promptPlaceholders: {
        SEED_LABEL: "inline",
        SEED_CONTENT: "Split into ready intents for review-last landing test",
      },
      agents: ["claude"],
      agentModelConfig: splitConfig,
      creationTitle: `intent: ${branchName}`,
      createBinding: () => ({
        id: "claude/split",
        metadata: { agent: "claude", model: "split" },
        invoke: async ({ cwd }) => {
          calls.push("split");
          mkdirSync(join(cwd, ".jarvis-intent-stage"), { recursive: true });
          writeFileSync(
            join(cwd, ".jarvis-intent-stage", "one.md"),
            "---\nname: one\n---\n\n# One\n\n## Prerequisites\n",
            "utf8",
          );
          writeFileSync(
            join(cwd, ".jarvis-intent-stage", "two.md"),
            "---\nname: two\n---\n\n# Two\n\n## Prerequisites\n",
            "utf8",
          );
          return { kind: "ok" as const, stdout: "done", stderr: "" };
        },
      }),
    };

    const reviewStep: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: branchName,
      cwd: workspace,
      prompt: "inspect",
      verdictPath,
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: splitConfig,
      landing: {
        kind: "intent-stage",
        output: { durableDir },
        stagingDir,
        invocationId: "invocation-two-file",
        baseRef: "HEAD",
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async ({ cwd }) => {
          calls.push(agentId);
          if (agentId === "codex" && reviewOverrides.actuator) await reviewOverrides.actuator(cwd);
          return agentId === "claude"
            ? { kind: "ok" as const, stdout: reviewOverrides.criticStdout, stderr: "" }
            : { kind: "ok" as const, stdout: "done", stderr: "" };
        },
      }),
    };

    return { harness, durableDir, stagingDir, verdictPath, calls, writeStep, reviewStep };
  }

  test("promotes two staged intents through a full reviewed intent workflow", async () => {
    const branchName = "intent-two-file-promote";
    const { harness, durableDir, stagingDir, verdictPath, writeStep, reviewStep } = twoFileIntentWorkflow(branchName, {
      criticStdout: "looks good",
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [writeStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result).toMatchObject({ kind: "complete" });
      expect(result.commitSha).toBeDefined();
    });

    expect(readFileSync(join(durableDir, "one.md"), "utf8")).toContain("# One");
    expect(readFileSync(join(durableDir, "two.md"), "utf8")).toContain("# Two");
    expect(existsSync(stagingDir)).toBe(false);
    expect(existsSync(verdictPath)).toBe(false);
    expect(existsSync(`${verdictPath}.owner`)).toBe(false);

    const log = execFileSync("git", ["log", "--name-only", "-1", "HEAD"], {
      cwd: harness.workspace,
      encoding: "utf8",
    });
    expect(log).toContain("ready-intents/one.md");
    expect(log).toContain("ready-intents/two.md");
  });

  test("review-last deferred landing does not reprompt on already-valid staging", async () => {
    const branchName = "intent-review-last-no-reprompt";
    const { harness, durableDir, stagingDir, writeStep, reviewStep } = twoFileIntentWorkflow(branchName, {
      criticStdout: "looks good",
    });
    const logSink = new TestLogSink();

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [writeStep, reviewStep],
        stateStore: store,
        logSink,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result).toMatchObject({ kind: "complete" });
    });

    expect(readFileSync(join(durableDir, "one.md"), "utf8")).toContain("# One");
    expect(existsSync(stagingDir)).toBe(false);
    const repromptEvents = logSink.events.filter((entry) => entry.event.kind === "landing_contract_reprompt");
    expect(repromptEvents).toHaveLength(0);
    expect(harness.workspace).toBeDefined();
  });

  test("write-last intent completion with N=2 records downstreamInputs on the step-0 entry run", async () => {
    const branchName = "intent-multi-handoff-write-last";
    const { writeStep } = twoFileIntentWorkflow(branchName, { criticStdout: "looks good" });
    writeStep.stepId = "intent";
    writeStep.landing = {
      kind: "intent-stage",
      output: { durableDir: "ready-intents" },
      stagingDir: ".jarvis-intent-stage",
      invocationId: "multi-write-last",
      baseRef: "HEAD",
    };

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [writeStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(result).toMatchObject({ kind: "complete" });
      const intentRun = store.findRunByProjectBranch({ project: "demo", branch: branchName, stepId: "intent" });
      expect(intentRun?.specPath).toBe("ready-intents");
      // Mutation checkpoint: workflow-runner.test.ts write-last multi-file downstreamInputs
      expect(intentRun?.downstreamInputs).toEqual(["ready-intents/one.md", "ready-intents/two.md"]);
    });
  });

  test("review-last intent completion with N=2 records downstreamInputs on the step-0 entry run", async () => {
    const branchName = "intent-multi-handoff-review-last";
    const { writeStep, reviewStep } = twoFileIntentWorkflow(branchName, { criticStdout: "looks good" });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [writeStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(result).toMatchObject({ kind: "complete" });
      const writeRun = store.findRunByProjectBranch({ project: "demo", branch: branchName, stepId: "split" });
      expect(writeRun?.specPath).toBe("ready-intents");
      // Mutation checkpoint: workflow-runner.test.ts review-last multi-file downstreamInputs
      expect(writeRun?.downstreamInputs).toEqual(["ready-intents/one.md", "ready-intents/two.md"]);
    });
  });

  test("write-last intent completion with N=1 clears stale downstreamInputs on the step-0 entry run", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "intent-clear-stale-downstream-"));
    const withExternalWorktree = externalWorktreeBinding(workspace);
    const branchName = "intent-clear-stale-downstream";
    const staleInputs = ["ready-intents/one.md", "ready-intents/two.md"];
    const baseStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName,
      specPath: "ready-intents",
      expectedArtifactPath: ".jarvis-intent-stage",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "intent-clear-stale-downstream",
        baseRef: "none",
      },
      creationTitle: "intent: clear-stale-downstream",
      withExternalWorktree,
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
      createBinding: createBindingFactory(async ({ cwd }) => {
        mkdirSync(join(cwd, ".jarvis-intent-stage"), { recursive: true });
        writeFileSync(
          join(cwd, ".jarvis-intent-stage", "single.md"),
          "---\nname: single\n---\n\n# Single\n\n## Prerequisites\n",
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
        onStepRunCreated: (_stepIndex, runId) => {
          store.setRunDownstreamInputs(runId, staleInputs);
        },
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
      const intentRun = store.findRunByProjectBranch({ project: "demo", branch: branchName, stepId: "intent" });
      expect(intentRun?.specPath).toBe("ready-intents/single.md");
      // Mutation checkpoint: workflow-runner.test.ts single-file stale downstreamInputs clear
      expect(intentRun?.downstreamInputs).toBeUndefined();
    });
  });

  function commitTrackedIntentReviewLayout(workspace: string, verdictPath: string): void {
    writeFileSync(verdictPath, "", "utf8");
    execFileSync("git", ["add", "-A"], { cwd: workspace });
    execFileSync("git", ["commit", "-qm", "track intent staging and verdict shell"], { cwd: workspace });
  }

  test("completes reviewed-intent review when actuator edits a tracked file under staging", async () => {
    const stagingOne = join(".jarvis-intent-stage", "one.md");
    const { harness, durableDir, verdictPath, writeStep, reviewStep } = twoFileIntentWorkflow(
      "intent-actuator-staging-edit",
      {
        criticStdout: "looks good",
        actuator: (cwd) => {
          const file = join(cwd, stagingOne);
          writeFileSync(
            file,
            readFileSync(file, "utf8").replace("## Prerequisites\n", "## Prerequisites\n\n- reviewed edit\n"),
            "utf8",
          );
        },
      },
    );

    await withStateStore(async (store) => {
      const writeResult = await executeWorkflow({
        steps: [writeStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(writeResult).toMatchObject({ kind: "complete" });
      commitTrackedIntentReviewLayout(harness.workspace, verdictPath);

      const result = await executeWorkflow({
        steps: [reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(result).toMatchObject({ kind: "complete" });
    });

    expect(readFileSync(join(durableDir, "one.md"), "utf8")).toContain("- reviewed edit");
  });

  test("promotes staged intents when the critic returns an empty verdict", async () => {
    const branchName = "intent-empty-verdict-promote";
    const { harness, durableDir, stagingDir, verdictPath, calls, writeStep, reviewStep } = twoFileIntentWorkflow(
      branchName,
      { criticStdout: "" },
    );

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [writeStep, reviewStep],
        stateStore: store,
        completionCommitter: createCompletionCommitter(),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result).toMatchObject({ kind: "complete" });
      expect(result.commitSha).toBeDefined();
    });

    expect(calls).toEqual(["split", "claude"]);
    expect(readFileSync(join(durableDir, "one.md"), "utf8")).toContain("# One");
    expect(readFileSync(join(durableDir, "two.md"), "utf8")).toContain("# Two");
    expect(existsSync(stagingDir)).toBe(false);
    expect(existsSync(verdictPath)).toBe(false);

    const log = execFileSync("git", ["log", "--name-only", "-1", "HEAD"], {
      cwd: harness.workspace,
      encoding: "utf8",
    });
    expect(log).toContain("ready-intents/one.md");
    expect(log).toContain("ready-intents/two.md");
  });

  test("records intent finalization trace on success and when promotion stops short", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-trace-"));
    stageReviewedIntent(workspace);
    const durableDir = join(workspace, "ready-intents");
    const successStep = reviewedIntentStep(workspace, {
      branch: "intent/trace-success",
      landing: {
        kind: "intent-stage",
        output: { durableDir },
        stagingDir: join(workspace, ".jarvis-intent-stage"),
        invocationId: "invocation-trace",
        baseRef: "none",
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => ({ kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" }),
      }),
    });

    const successLogSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [successStep], stateStore: store, logSink: successLogSink });
      expect(result).toMatchObject({ kind: "complete" });
      const finalizationEvents = successLogSink
        .getEventsForRun(result.runId)
        .filter((event) => event.kind === "intent_finalization");
      expect(finalizationEvents.length).toBeGreaterThan(0);
      for (const event of finalizationEvents) {
        expect(event).toMatchObject({ branch: "intent/trace-success" });
        expect((event as { stopReason?: string }).stopReason).toBeUndefined();
      }
    });

    // Short-circuit: durableDir already carries a conflicting file, so landing throws before
    // promotion and the trace records why.
    const failWorkspace = mkdtempSync(join(tmpdir(), "reviewed-intent-trace-fail-"));
    stageReviewedIntent(failWorkspace);
    const failDurableDir = join(failWorkspace, "ready-intents");
    mkdirSync(failDurableDir, { recursive: true });
    writeFileSync(join(failDurableDir, "existing.md"), "different\n", "utf8");
    const failStep = reviewedIntentStep(failWorkspace, {
      branch: "intent/trace-fail",
      landing: {
        kind: "intent-stage",
        output: { durableDir: failDurableDir },
        stagingDir: join(failWorkspace, ".jarvis-intent-stage"),
        invocationId: "invocation-trace-fail",
        baseRef: "none",
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => ({ kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" }),
      }),
    });

    const failLogSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [failStep], stateStore: store, logSink: failLogSink });
      expect(result).toMatchObject({ kind: "invocation_failure" });
      const finalizationEvents = failLogSink
        .getEventsForRun(result.runId)
        .filter((event) => event.kind === "intent_finalization");
      expect(finalizationEvents.length).toBeGreaterThan(0);
      expect(finalizationEvents.at(-1)).toMatchObject({ branch: "intent/trace-fail" });
      expect((finalizationEvents.at(-1) as { stopReason?: string }).stopReason).toBeTruthy();
    });
    // Landing failed before promotion: the staged file stays put, nothing is lost.
    expect(existsSync(join(failWorkspace, ".jarvis-intent-stage", "existing.md"))).toBe(true);
  });

  test("does not emit done boundary before intent finalization finishes", async () => {
    // Same landing-conflict shape as the trace test above: landing throws before promotion
    // completes. The review step's own completion boundary must not already have recorded
    // `done` / `completed` when that happens — committing that boundary before landing leaves a
    // stray completed attempt in the run's history even though the run settles
    // `invocation_failure` with the stage still populated.
    const workspace = mkdtempSync(join(tmpdir(), "reviewed-intent-boundary-order-"));
    stageReviewedIntent(workspace);
    const durableDir = join(workspace, "ready-intents");
    mkdirSync(durableDir, { recursive: true });
    writeFileSync(join(durableDir, "existing.md"), "different\n", "utf8");
    const step = reviewedIntentStep(workspace, {
      branch: "intent/boundary-order",
      landing: {
        kind: "intent-stage",
        output: { durableDir },
        stagingDir: join(workspace, ".jarvis-intent-stage"),
        invocationId: "invocation-boundary-order",
        baseRef: "none",
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => ({ kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" }),
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });

      expect(result).toMatchObject({ kind: "invocation_failure" });
      const run = store.loadRun(result.runId);
      expect(run?.status).toBe("failed");
      expect(run?.attempts.some((attempt) => attempt.outcomeKind === "done")).toBe(false);
    });
    // Landing failed before promotion: the staged file stays put, nothing is lost.
    expect(existsSync(join(workspace, ".jarvis-intent-stage", "existing.md"))).toBe(true);
  });
});
