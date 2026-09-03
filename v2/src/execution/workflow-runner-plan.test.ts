import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import { planReviewPromptProfile } from "../../../shared/prompts/review-plan.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { createJarvisHome, withStateStore } from "../testing/write-fixtures.ts";
import { buildPlanWorkflowSteps } from "./publication-workflow-steps.ts";
import type { LoadedWorkflowStep, WorkflowSourceStep } from "./workflow-loader.ts";
import {
  createBindingFactory,
  createDebateBindingFactory,
  createDebateStep,
  createIntentWorktreeHarness,
  createStep,
  DEBATE_AGENT_MODEL_CONFIG,
  roots,
  seedCompletedWriteRun,
  TestLogSink,
  writeLintCleanPlanStage,
} from "./workflow-runner.test-support.ts";
import { executeWorkflow, type ReviewWorkflowStep, type WriteWorkflowStep } from "./workflow-runner.ts";

describe("executeWorkflow plan review dispatch", () => {
  const config: AgentModelConfig = {
    claude: { critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] } },
    codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
  };
  const reviewedPlanLandingStep = (
    root: string,
    stage: string,
    durable: string,
    branch: string,
    invoke: (agentId: string) => Promise<InvocationResult>,
  ): ReviewWorkflowStep => ({
    behavior: "review",
    stepId: "plan-review",
    project: "demo",
    branch,
    cwd: root,
    prompt: "",
    verdictPath: join(stage, "verdict-plan.md"),
    maxCycles: 1,
    agents: { critic: ["claude"], actuator: ["codex"] },
    agentModelConfig: config,
    profile: planReviewPromptProfile,
    profileContext: { specPath: stage, worktreePath: root },
    landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
    createBinding: ({ agentId }) => ({
      id: agentId,
      metadata: { agent: agentId, model: agentId },
      invoke: async () => invoke(agentId),
    }),
  });

  test("renders live draft context, persists verdict, and publishes actuator edits", async () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-plan-review-"));
    const specDir = join(root, "spec", "2026-test-reviewed");
    mkdirSync(specDir, { recursive: true });
    const subspecPath = join(specDir, "01-test.md");
    writeFileSync(join(specDir, "intent.md"), "Intent body", "utf8");
    writeFileSync(join(specDir, "index.md"), "# Index", "utf8");
    writeFileSync(subspecPath, "# Before", "utf8");
    const verdictPath = join(specDir, "verdict-plan.md");
    const criticPrompts: string[] = [];
    const actuatorPrompts: string[] = [];

    const step: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "plan-review",
      project: "demo",
      branch: "plan-reviewed",
      cwd: root,
      prompt: "",
      verdictPath,
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      profile: planReviewPromptProfile,
      profileContext: { specPath: specDir, worktreePath: root },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async ({ prompt }) => {
          if (agentId === "claude") {
            criticPrompts.push(prompt);
            return { kind: "ok" as const, stdout: "Clarify acceptance criteria", stderr: "" };
          }
          actuatorPrompts.push(prompt);
          writeFileSync(subspecPath, "# After review", "utf8");
          return { kind: "ok" as const, stdout: "done", stderr: "" };
        },
      }),
    };

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });

      expect(result).toMatchObject({ kind: "complete", iterationsConsumed: 1, resumable: false });
      expect(readFileSync(verdictPath, "utf8")).toBe("Clarify acceptance criteria");
      expect(readFileSync(subspecPath, "utf8")).toBe("# After review");
      expect(criticPrompts[0]).toContain("Intent body");
      expect(criticPrompts[0]).toContain("# Index");
      expect(criticPrompts[0]).not.toContain("builder-time");
      expect(actuatorPrompts[0]).toContain("Clarify acceptance criteria");
      expect(actuatorPrompts[0]).toContain("Intent body");
    });
  });

  test("lands a reviewed light plan tree without publishing its verdict", async () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-reviewed-plan-landing-"));
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed");
    writeLintCleanPlanStage(stage, "01-test.md", "# Before\n");
    const step = reviewedPlanLandingStep(root, stage, durable, "plan-reviewed-landing", async (agentId) => {
      if (agentId === "codex") writeFileSync(join(stage, "01-test.md"), "# After review\n", "utf8");
      return { kind: "ok", stdout: agentId === "claude" ? "Apply edit" : "done", stderr: "" };
    });

    await withStateStore(async (store) => {
      expect(await executeWorkflow({ steps: [step], stateStore: store })).toMatchObject({ kind: "complete" });
    });

    expect(existsSync(stage)).toBe(false);
    expect(existsSync(join(durable, "index.md"))).toBe(true);
    expect(existsSync(join(durable, "intent.md"))).toBe(true);
    expect(readFileSync(join(durable, "01-test.md"), "utf8")).toBe("# After review\n");
    expect(existsSync(join(durable, "verdict-plan.md"))).toBe(false);
  });

  test("retains the staged plan and verdict when deferred landing fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-reviewed-plan-landing-failure-"));
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed");
    mkdirSync(durable, { recursive: true });
    writeLintCleanPlanStage(stage, "01-test.md", "# Staged\n");
    writeFileSync(join(durable, "01-test.md"), "# Different", "utf8");
    const verdictPath = join(stage, "verdict-plan.md");
    let criticCalls = 0;
    const step = reviewedPlanLandingStep(root, stage, durable, "plan-reviewed-landing-failure", async (agentId) => {
      if (agentId === "claude") criticCalls += 1;
      return { kind: "ok", stdout: agentId === "claude" ? "Keep verdict" : "done", stderr: "" };
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });
      expect(result).toMatchObject({ kind: "invocation_failure", resumable: true });
      expect(existsSync(stage)).toBe(true);
      expect(readFileSync(verdictPath, "utf8")).toBe("Keep verdict");
      rmSync(join(durable, "01-test.md"));
      expect(await executeWorkflow({ steps: [step], stateStore: store })).toMatchObject({
        kind: "complete",
        iterationsConsumed: 0,
      });
    });

    expect(existsSync(stage)).toBe(false);
    expect(existsSync(join(durable, "verdict-plan.md"))).toBe(false);
    expect(criticCalls).toBe(1);
  });

  test("fresh plan review dispatches do not reuse a completed landing checkpoint", async () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-reviewed-plan-fresh-"));
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed");
    let criticCalls = 0;
    const stagePlan = () => {
      writeLintCleanPlanStage(stage, "01-test.md", "# Test\n");
    };
    const step = reviewedPlanLandingStep(root, stage, durable, "plan-reviewed-fresh", async (agentId) => {
      if (agentId === "claude") criticCalls += 1;
      return { kind: "ok", stdout: agentId === "claude" ? "" : "done", stderr: "" };
    });

    await withStateStore(async (store) => {
      stagePlan();
      expect(await executeWorkflow({ steps: [step], stateStore: store })).toMatchObject({ kind: "complete" });
      stagePlan();
      expect(await executeWorkflow({ steps: [step], stateStore: store, freshDispatch: true })).toMatchObject({
        kind: "complete",
      });
    });

    expect(criticCalls).toBe(2);
  });

  test("reuses a completed debate landing checkpoint on retry but not on a fresh dispatch", async () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-reviewed-debate-fresh-"));
    roots.push(root);
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed-debate-fresh");
    let adjudicatorCalls = 0;
    const stagePlan = () => {
      writeLintCleanPlanStage(stage, "01-test.md", "# Test\n");
      writeFileSync(join(stage, "verdict-plan.md"), "", "utf8");
    };
    const step = createDebateStep({
      stepId: "review-debate",
      cwd: root,
      verdictPath: join(stage, "verdict-plan.md"),
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => {
        if (adapterModel === "ADJ") adjudicatorCalls += 1;
        return { kind: "ok", stdout: adapterModel === "ADJ" ? "" : "ok", stderr: "" } as const;
      }),
    });

    await withStateStore(async (store) => {
      stagePlan();
      expect(await executeWorkflow({ steps: [step], stateStore: store })).toMatchObject({ kind: "complete" });
      expect(adjudicatorCalls).toBe(1);

      // A retry re-enters the completed checkpoint and must not re-invoke the debate roles.
      expect(await executeWorkflow({ steps: [step], stateStore: store })).toMatchObject({ kind: "complete" });
      expect(adjudicatorCalls).toBe(1);

      // A fresh dispatch is a new invocation and must run the debate again.
      stagePlan();
      expect(await executeWorkflow({ steps: [step], stateStore: store, freshDispatch: true })).toMatchObject({
        kind: "complete",
      });
      expect(adjudicatorCalls).toBe(2);
    });
  });

  test("lands a reviewed debate plan tree without publishing its empty verdict", async () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-reviewed-plan-debate-landing-"));
    roots.push(root);
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed-debate");
    writeLintCleanPlanStage(stage, "01-test.md", "# Before\n");
    const verdictPath = join(stage, "verdict-plan.md");
    writeFileSync(verdictPath, "", "utf8");
    const step = createDebateStep({
      stepId: "review-debate",
      cwd: root,
      verdictPath,
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => {
        return { kind: "ok", stdout: adapterModel === "ADJ" ? "" : "ok", stderr: "" } as const;
      }),
    });

    await withStateStore(async (store) => {
      expect(await executeWorkflow({ steps: [step], stateStore: store })).toMatchObject({ kind: "complete" });
    });

    expect(existsSync(stage)).toBe(false);
    expect(existsSync(join(durable, "index.md"))).toBe(true);
    expect(existsSync(join(durable, "intent.md"))).toBe(true);
    expect(readFileSync(join(durable, "01-test.md"), "utf8")).toBe("# Before\n");
    expect(existsSync(join(durable, "verdict-plan.md"))).toBe(false);
  });

  test("lands default plan tree when review passes are omitted", async () => {
    const previousJarvisHome = process.env.JARVIS_HOME;
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    process.env.JARVIS_HOME = jarvisRoot;
    try {
      const projectRoot = mkdtempSync(join(tmpdir(), "plan-default-landing-project-"));
      roots.push(projectRoot);
      const readyIntentRel = "v2/spec/ready-intents/default-plan.md";
      const intentContent = "---\nname: default-plan\n---\n\n# Default Plan\n\n## Prerequisites\n\n- none\n";
      mkdirSync(join(projectRoot, "v2/spec/ready-intents"), { recursive: true });
      writeFileSync(join(projectRoot, readyIntentRel), intentContent);
      const configPath = join(projectRoot, "config.json");
      writeFileSync(configPath, JSON.stringify({ projects: { demo: { root: projectRoot, git: false } } }));

      const loadPlanWorkflowSteps = (steps: readonly WorkflowSourceStep[]): LoadedWorkflowStep[] =>
        steps.map((step) =>
          step.behavior === "write"
            ? {
                ...step,
                agents: ["claude"],
                agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
              }
            : step.behavior === "review"
              ? { ...step, agents: { critic: ["claude"], actuator: ["claude"] }, agentModelConfig: {} }
              : {
                  ...step,
                  agents: {
                    adversary: ["claude"],
                    advocate: ["claude"],
                    adjudicator: ["claude"],
                    actuator: ["claude"],
                  },
                  agentModelConfig: DEBATE_AGENT_MODEL_CONFIG,
                },
        );

      const built = await buildPlanWorkflowSteps(
        { cwd: projectRoot, readyIntent: readyIntentRel, configPath },
        {
          readReadyIntent: (path) => ({ ok: true as const, name: "default-plan", content: readFileSync(path, "utf8") }),
          loadWorkflowSteps: loadPlanWorkflowSteps,
        },
      );
      if (!built.ok) throw new Error(built.error);
      const write = built.steps[0];
      const debate = built.steps[1];
      if (write?.behavior !== "write" || debate?.behavior !== "review-debate") {
        throw new Error("expected plan write plus review-debate steps");
      }

      const planRoot = write.worktree.git === false ? write.worktree.localPath : undefined;
      if (planRoot === undefined) throw new Error("expected git-disabled plan root");
      const stage = join(planRoot, ".jarvis-plan-stage");
      const durable = write.specPath;

      write.withExternalWorktree = async (_args, run) => {
        mkdirSync(planRoot, { recursive: true });
        const value = await run({ path: planRoot, reused: false });
        return { worktree: { path: planRoot, reused: false }, lock: { kind: "acquired" }, value };
      };
      write.publishCompletion = false;
      write.createBinding = () => ({
        id: "plan-draft",
        metadata: { agent: "claude", model: "plan" },
        invoke: async () => {
          mkdirSync(stage, { recursive: true });
          writeFileSync(join(stage, "index.md"), "# Index\n\n- [ ] [00 - First](./00-first.md)\n", "utf8");
          writeFileSync(join(stage, "intent.md"), intentContent, "utf8");
          writeFileSync(join(stage, "00-first.md"), "# First\n\n## Acceptance criteria\n\n- [ ] criterion\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" };
        },
      });

      debate.createBinding = createDebateBindingFactory(async ({ adapterModel }) => ({
        kind: "ok",
        stdout: adapterModel === "ADJ" ? "" : "ok",
        stderr: "",
      }));

      await withStateStore(async (store) => {
        expect(await executeWorkflow({ steps: [write, debate], stateStore: store })).toMatchObject({
          kind: "complete",
        });
      });

      expect(existsSync(stage)).toBe(false);
      expect(existsSync(join(durable, "index.md"))).toBe(true);
      expect(existsSync(join(durable, "intent.md"))).toBe(true);
      expect(existsSync(join(durable, "00-first.md"))).toBe(true);
    } finally {
      if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
      else process.env.JARVIS_HOME = previousJarvisHome;
    }
  });

  test("a git-backed plan workflow commits staged progress in-flight and the landing commit removes staging artifacts", async () => {
    const branchName = "plan-git-backed-staging";
    const harness = createIntentWorktreeHarness(branchName);
    const stage = join(harness.workspace, ".jarvis-plan-stage");
    const durable = join(harness.workspace, "spec", "git-backed-plan");
    let calls = 0;

    const step = createStep({
      stepId: "plan",
      role: "plan",
      branchName,
      specPath: "spec/git-backed-plan",
      expectedArtifactPath: ".jarvis-plan-stage",
      landing: {
        kind: "plan-tree",
        stagingDir: ".jarvis-plan-stage",
        durablePath: "spec/git-backed-plan",
      },
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
      createBinding: createBindingFactory(async ({ cwd }) => {
        calls += 1;
        mkdirSync(join(cwd, ".jarvis-plan-stage"), { recursive: true });
        writeFileSync(join(cwd, ".jarvis-plan-stage", "index.md"), "# Index\n\n- [ ] [First](./00-first.md)\n", "utf8");
        writeFileSync(join(cwd, ".jarvis-plan-stage", "intent.md"), "Intent\n", "utf8");
        if (calls === 1) return { kind: "ok", stdout: "progress", stderr: "" } as const;
        writeFileSync(join(cwd, ".jarvis-plan-stage", "00-first.md"), "# First\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" } as const;
      }),
    });
    // A fixed base sha, not the literal "HEAD" sentinel: the completion tail's content-vs-base
    // gate diffs the completion commit against this ref after it has already moved HEAD forward.
    const preRunHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: harness.workspace, encoding: "utf8" }).trim();
    step.worktree = {
      projectRoot: harness.workspace,
      projectName: "demo",
      branchName,
      baseRef: preRunHead,
      git: false,
      localPath: harness.workspace,
    };
    step.withExternalWorktree = harness.withExternalWorktree;

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
    });

    // The progress iteration committed the partially-staged files in-flight, ahead of the
    // landing/publication commit, which removes the staging dir. Only an in-flight commit
    // can leave the staging dir present in a commit's tree.
    const commitsInRange = execFileSync("git", ["rev-list", `${preRunHead}..HEAD`], {
      cwd: harness.workspace,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    const stagedInSomeCommit = commitsInRange.some((sha) =>
      execFileSync("git", ["ls-tree", "-r", "--name-only", sha], {
        cwd: harness.workspace,
        encoding: "utf8",
      })
        .split("\n")
        .some((path) => path.startsWith(".jarvis-plan-stage/")),
    );
    expect(stagedInSomeCommit).toBe(true);

    expect(existsSync(stage)).toBe(false);
    expect(existsSync(join(durable, "index.md"))).toBe(true);
    const trackedFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
      cwd: harness.workspace,
      encoding: "utf8",
    });
    expect(trackedFiles).not.toContain(".jarvis-plan-stage");
  });

  test("retains the staged plan and verdict when a review-debate deferred landing fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-reviewed-plan-debate-landing-failure-"));
    roots.push(root);
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed-debate");
    mkdirSync(durable, { recursive: true });
    writeLintCleanPlanStage(stage, "01-test.md", "# Staged\n");
    writeFileSync(join(durable, "01-test.md"), "# Different", "utf8");
    const verdictPath = join(stage, "verdict-plan.md");
    const step = createDebateStep({
      stepId: "review-debate",
      cwd: root,
      verdictPath,
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: durable },
      createBinding: createDebateBindingFactory(
        async ({ adapterModel }) =>
          ({ kind: "ok", stdout: adapterModel === "ADJ" ? "apply this fix" : "ok", stderr: "" }) as const,
      ),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });
      expect(result).toMatchObject({ kind: "invocation_failure", resumable: true });
      expect(store.loadRun(result.runId)).toMatchObject({ status: "failed", attemptCount: 1 });
    });

    // Stage is retained (never consumed) and the verdict is restored, not cleaned up.
    expect(existsSync(stage)).toBe(true);
    expect(existsSync(join(durable, "index.md"))).toBe(false);
    expect(existsSync(verdictPath)).toBe(true);
  });

  // A review-debate last step must be treated as review-last so post-loop eager landing of the
  // completion (write) step's tree is suppressed; the review step's own deferred landing is
  // authoritative. Isolated via distinct durable targets: only the review step's deferred landing
  // should run. If the write step's landing were eager-applied, it would hit the already-consumed
  // stage and fail (pre-publication) instead of completing.
  test("treats a review-debate last step as review-last and skips eager landing of the write step's tree", async () => {
    const harness = createIntentWorktreeHarness("reviewed-plan-debate-defer");
    const workspace = harness.workspace;
    const stage = join(workspace, ".jarvis-plan-stage");
    const reviewDurable = join(workspace, "spec", "2026-reviewed-debate");
    const writeDurable = join(workspace, "spec", "2026-eager-write");
    writeLintCleanPlanStage(stage, "01-test.md", "# Before\n");
    const verdictPath = join(stage, "verdict-plan.md");

    const writeStep = createStep({
      stepId: "plan",
      role: "plan",
      branchName: "reviewed-plan-debate-defer",
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: writeDurable },
      publishCompletion: false,
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
    });
    writeStep.worktree = {
      projectRoot: workspace,
      projectName: "demo",
      branchName: "reviewed-plan-debate-defer",
      baseRef: "HEAD",
      git: false,
      localPath: workspace,
    };
    writeStep.withExternalWorktree = harness.withExternalWorktree;
    writeStep.createBinding = createBindingFactory(async ({ cwd }) => {
      writeLintCleanPlanStage(join(cwd, ".jarvis-plan-stage"), "01-test.md", "# Before\n");
      writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });

    const debateStep = createDebateStep({
      stepId: "review-debate",
      branch: "reviewed-plan-debate-defer",
      cwd: workspace,
      verdictPath,
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: reviewDurable },
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => {
        if (adapterModel === "ACT") writeFileSync(join(stage, "01-test.md"), "# After review\n", "utf8");
        return { kind: "ok", stdout: adapterModel === "ADJ" ? "apply this fix" : "ok", stderr: "" } as const;
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [writeStep, debateStep], stateStore: store });
      expect(result).toMatchObject({ kind: "complete" });
    });

    // Only the review step's deferred landing ran; the write step's landing was never eager-applied.
    expect(existsSync(stage)).toBe(false);
    expect(readFileSync(join(reviewDurable, "01-test.md"), "utf8")).toBe("# After review\n");
    expect(existsSync(join(reviewDurable, "verdict-plan.md"))).toBe(false);
    expect(existsSync(writeDurable)).toBe(false);
  });

  test("pre-publication landing failure settles failed with landing cause before loop_finished", async () => {
    const invocationId = "plan-pre-publication-landing";
    const { workspace, withExternalWorktree } = createIntentWorktreeHarness(invocationId);
    const baseStep = createStep({
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      branchName: invocationId,
      specPath: "ready-intents",
      expectedArtifactPath: ".jarvis-intent-stage",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId,
        baseRef: "HEAD",
      },
      workflowInvocationId: invocationId,
      withExternalWorktree,
      agentModelConfig: { claude: { plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] } } },
    });
    const step: WriteWorkflowStep = {
      ...baseStep,
      worktree: { ...baseStep.worktree, git: false, localPath: workspace },
    };
    const stagingDir = join(workspace, ".jarvis-intent-stage");
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, "valid.md"), "---\nname: valid\n---\n\n# Valid\n\n## Prerequisites\n", "utf8");
    writeFileSync(join(stagingDir, "source.ts"), "export {};\n", "utf8");
    const logSink = new TestLogSink();

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, workspace, invocationId);
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({}),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("pre-publication");
      const settledRow = store.loadRun(result.runId);
      expect(settledRow).toMatchObject({
        status: "failed",
        terminalCause: "landing_failed",
        terminalFailureDetail: {
          failureKind: "error",
          bindingAttempts: [],
          message: expect.stringContaining("expected only markdown files"),
        },
      });
      expect(
        logSink
          .getEventsForRun(result.runId)
          .filter((event) => event.kind === "loop_finished")
          .at(-1),
      ).toMatchObject({ kind: "loop_finished", loopOutcomeKind: "landing_failed", resumable: true });
    });
  });
});
