import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import { planReviewPromptProfile } from "../../../shared/prompts/review-plan.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { openStateStore } from "../persistence/state-store.ts";
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
  doneBindingFactory,
  initGitWorkspace,
  REVIEW_MD_LINT_FIXTURES,
  roots,
  seedCompletedWriteRun,
  skipReviewWithoutHarnessMarkdownlint,
  TestLogSink,
  writeLintCleanPlanStage,
} from "./workflow-runner.test-support.ts";
import { executeWorkflow, type ReviewWorkflowStep, type WriteWorkflowStep } from "./workflow-runner.ts";
import { recoverPlanStage } from "./workflow-runner-resume.ts";

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

describe("recoverPlanStage", () => {
  const PLAN_REVIEW_CONFIG: AgentModelConfig = {
    claude: { critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] } },
    codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
  };
  const PLAN_WRITE_AGENT_MODEL_CONFIG: AgentModelConfig = {
    claude: { plan: { rungs: [{ adapterModel: "plan", priceKey: "plan" }] } },
  };

  const harnessPlanBlocker = (reason: string) => `\n## Blocker\n\nArtifact contract check failed: ${reason}\n`;

  function planWorktree(prefix: string): string {
    const worktree = initGitWorkspace(prefix);
    // Recovery's commit tail needs a real HEAD to commit against.
    execFileSync("git", ["commit", "--allow-empty", "-qm", "base"], { cwd: worktree });
    return worktree;
  }

  function noGitPlanWorktree(prefix: string): string {
    return mkdtempSync(join(tmpdir(), prefix));
  }

  function planWriteStep(args: {
    stepId: string;
    branch: string;
    worktreePath: string;
    specPath: string;
  }): WriteWorkflowStep {
    return {
      behavior: "write",
      stepId: args.stepId,
      role: "plan",
      promptId: "plan.prompt.draft",
      stepRules: "Return exactly one terminal token.",
      worktree: {
        projectRoot: args.worktreePath,
        projectName: "demo",
        branchName: args.branch,
        baseRef: "HEAD",
        git: false,
        localPath: args.worktreePath,
      },
      specPath: args.specPath,
      expectedArtifactPath: ".jarvis-plan-stage",
      agents: ["claude"],
      agentModelConfig: PLAN_WRITE_AGENT_MODEL_CONFIG,
      createBinding: doneBindingFactory,
    };
  }

  function seedBlockedPlanDraftRun(
    store: ReturnType<typeof openStateStore>,
    args: {
      project: string;
      branch: string;
      worktreePath: string;
      specPath: string;
      stepId: string;
      invocationId: string;
      outcomeKind: "contract_miss" | "blocked";
      expectedArtifactPath?: string;
    },
  ): string {
    const runId = store.createRun({
      project: args.project,
      specRef: "HEAD",
      worktreePath: args.worktreePath,
      branch: args.branch,
      specPath: args.specPath,
      stepId: args.stepId,
      workflowSnapshot: {
        invocationId: args.invocationId,
        steps: [
          {
            stepId: args.stepId,
            role: "plan",
            expectedArtifactPath: args.expectedArtifactPath ?? ".jarvis-plan-stage",
          },
        ],
      },
    });
    const attemptId = store.recordAttemptStart(runId);
    store.commitCompletionBoundary({ attemptId, runStatus: "blocked", outcomeKind: args.outcomeKind });
    return runId;
  }

  function planReviewStep(args: {
    worktreePath: string;
    stage: string;
    durable: string;
    branch: string;
    invoke: (agentId: string) => Promise<InvocationResult>;
    inputs?: { sourceRoot: string; paths: string[]; consumeFrom: "worktree" | "source" };
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
        ...(args.inputs !== undefined ? { inputs: args.inputs } : {}),
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => args.invoke(agentId),
      }),
    };
  }

  function seedSourceReadyIntent(prefix: string): { sourceRoot: string; path: string } {
    const sourceRoot = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(sourceRoot, "ready-intents"), { recursive: true });
    const path = join(sourceRoot, "ready-intents", "test.md");
    writeFileSync(path, "---\nname: test\n---\n\n## Prerequisites\n", "utf8");
    return { sourceRoot, path };
  }

  /** Byte-for-byte snapshot of a staging directory's top-level files, for retention assertions. */
  function readStageFiles(stage: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const name of readdirSync(stage)) {
      result[name] = readFileSync(join(stage, name), "utf8");
    }
    return result;
  }

  test("recovers an operator-edited plan stage through publication without redrafting", async () => {
    const worktreePath = planWorktree("recover-plan-stage-keystone-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-recovered-plan");
    const branch = "recover-plan-stage-keystone";
    const stepId = "plan";
    const specPath = "spec/2026-recovered-plan";
    const reason = "`## Decisions` bullet is outside the allowed union";

    writeLintCleanPlanStage(stage, "00-first.md");
    writeFileSync(join(stage, "00-first.md"), "# Draft with an out-of-union Decisions bullet\n", "utf8");
    writeFileSync(join(stage, "intent.md"), `---\nname: test\n---\n${harnessPlanBlocker(reason)}`, "utf8");
    const { sourceRoot, path: sourceReadyIntent } = seedSourceReadyIntent("recover-plan-stage-keystone-source-");

    const correctedSubspecBody = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md012-clean-subspec.md"), "utf8");
    const actuatorPrompts: string[] = [];

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-keystone-inv",
        outcomeKind: "contract_miss",
      });
      const logSink = new TestLogSink();
      logSink.append(runId, {
        kind: "contract_miss_detail",
        attemptId: "attempt-1",
        failedContractId: "plan.decisions-shape",
        responseText: "done",
        failureReason: reason,
      });

      // Operator corrects the staged subspec that tripped the contract miss.
      writeFileSync(join(stage, "00-first.md"), correctedSubspecBody, "utf8");

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async (agentId) => {
          if (agentId === "codex") actuatorPrompts.push("actuator");
          return { kind: "ok", stdout: agentId === "claude" ? "Looks good" : "done", stderr: "" };
        },
        inputs: { sourceRoot, paths: [sourceReadyIntent], consumeFrom: "source" },
      });

      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        steps: [reviewStep],
        stateStore: store,
        logSink,
      });

      // @mutate v2/src/execution/workflow-runner.ts "return { ok: true, ...result, ...(commit.commitSha !== undefined ? { commitSha: commit.commitSha } : {}) };" -> "return { ok: false, code: \"missing_plan_context\", message: \"reverted\" };"
      // @mutate v2/src/execution/workflow-runner.ts "if (!existsSync(join(run.worktreePath, \".git\"))) {" -> "if (true) {"
      // @mutate v2/src/execution/workflow-runner.ts "return content.endsWith(expected) ? { kind: \"harness\", text: expected } : { kind: \"operator\" };" -> "return { kind: \"operator\" };"
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("complete");
      expect(actuatorPrompts).toEqual(["actuator"]);
      expect(readFileSync(join(durable, "00-first.md"), "utf8")).toBe(correctedSubspecBody);
      expect(readFileSync(join(durable, "intent.md"), "utf8")).not.toContain("## Blocker");
      expect(existsSync(sourceReadyIntent)).toBe(false);

      const writeRun = store.loadRun(runId);
      expect(writeRun?.status).toBe("blocked");
      expect(writeRun?.attempts.length).toBe(1);
    });
  });

  test("recovered plan publication commits only durable output", async () => {
    const worktreePath = planWorktree("recover-plan-stage-commit-clean-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-commit-clean");
    const branch = "recover-plan-stage-commit-clean";
    const stepId = "plan";
    const specPath = "spec/2026-commit-clean";
    const reason = "`## Decisions` bullet is outside the allowed union";

    writeLintCleanPlanStage(stage, "00-first.md");
    writeFileSync(join(stage, "00-first.md"), "# Draft with an out-of-union Decisions bullet\n", "utf8");
    writeFileSync(join(stage, "intent.md"), `---\nname: test\n---\n${harnessPlanBlocker(reason)}`, "utf8");

    // Ready-intent lives inside this worktree (not an external source root) so its consumption
    // deletion lands in the same commit range as the durable landing.
    mkdirSync(join(worktreePath, "ready-intents"), { recursive: true });
    const readyIntentPath = join(worktreePath, "ready-intents", "test.md");
    writeFileSync(readyIntentPath, "---\nname: test\n---\n\n## Prerequisites\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: worktreePath });
    execFileSync("git", ["commit", "-qm", "seed ready-intent"], { cwd: worktreePath });

    const correctedSubspecBody = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md012-clean-subspec.md"), "utf8");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-commit-clean-inv",
        outcomeKind: "contract_miss",
      });
      const logSink = new TestLogSink();
      logSink.append(runId, {
        kind: "contract_miss_detail",
        attemptId: "attempt-1",
        failedContractId: "plan.decisions-shape",
        responseText: "done",
        failureReason: reason,
      });

      // Operator corrects the staged subspec that tripped the contract miss.
      writeFileSync(join(stage, "00-first.md"), correctedSubspecBody, "utf8");

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async (agentId) => ({ kind: "ok", stdout: agentId === "claude" ? "Looks good" : "done", stderr: "" }),
        inputs: { sourceRoot: worktreePath, paths: [readyIntentPath], consumeFrom: "worktree" },
      });

      const preRunHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreePath, encoding: "utf8" }).trim();

      // @mutate v2/src/execution/workflow-runner.ts "if (landingStep === undefined || landingStep.landing?.kind !== \"plan-tree\") {" -> "if (true) {"
      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        steps: [reviewStep],
        stateStore: store,
        logSink,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("complete");
      expect(outcome.commitSha).toBeDefined();
      expect(readFileSync(join(durable, "00-first.md"), "utf8")).toBe(correctedSubspecBody);
      expect(readFileSync(join(durable, "intent.md"), "utf8")).not.toContain("## Blocker");
      expect(existsSync(join(durable, "verdict-plan.md"))).toBe(false);
      expect(existsSync(readyIntentPath)).toBe(false);

      const commitsInRange = execFileSync("git", ["rev-list", `${preRunHead}..HEAD`], {
        cwd: worktreePath,
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter(Boolean);
      expect(commitsInRange.length).toBeGreaterThan(0);
      for (const sha of commitsInRange) {
        const tracked = execFileSync("git", ["ls-tree", "-r", "--name-only", sha], {
          cwd: worktreePath,
          encoding: "utf8",
        });
        expect(tracked).not.toContain(".jarvis-plan-stage");
        expect(tracked).not.toContain("verdict-plan.md");
        expect(tracked).not.toContain(".owner");
        expect(tracked).not.toContain(".jarvis-plan-backup");
      }

      const finalTracked = execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
        cwd: worktreePath,
        encoding: "utf8",
      });
      expect(finalTracked).toContain("spec/2026-commit-clean/00-first.md");
      expect(finalTracked).toContain("spec/2026-commit-clean/index.md");
      expect(finalTracked).toContain("spec/2026-commit-clean/intent.md");
      expect(finalTracked).not.toContain("ready-intents/test.md");
    });
  });

  test("admits corrected plan stage despite a non-resumable stop", async () => {
    for (const outcomeKind of ["contract_miss", "blocked"] as const) {
      const worktreePath = planWorktree(`recover-plan-stage-nonresumable-${outcomeKind}-`);
      const stage = join(worktreePath, ".jarvis-plan-stage");
      const durable = join(worktreePath, "spec", `2026-recovered-${outcomeKind}`);
      const branch = `recover-plan-stage-nonresumable-${outcomeKind}`;
      const stepId = "plan";
      const specPath = `spec/2026-recovered-${outcomeKind}`;
      writeLintCleanPlanStage(stage, "00-first.md");

      await withStateStore(async (store) => {
        const runId = seedBlockedPlanDraftRun(store, {
          project: "demo",
          branch,
          worktreePath,
          specPath,
          stepId,
          invocationId: `recover-plan-stage-nonresumable-${outcomeKind}-inv`,
          outcomeKind,
        });

        // Ordinary resume stays refused: replaying the same write step through `executeWorkflow`
        // still reports the idempotent terminal outcome with `resumable: false`.
        const writeStep = planWriteStep({ stepId, branch, worktreePath, specPath });
        const ordinaryResume = await executeWorkflow({ steps: [writeStep], stateStore: store });
        expect(ordinaryResume).toMatchObject({ kind: outcomeKind, resumable: false });

        const reviewStep = planReviewStep({
          worktreePath,
          stage,
          durable,
          branch,
          invoke: async (agentId) => ({ kind: "ok", stdout: agentId === "claude" ? "ok" : "done", stderr: "" }),
        });

        // @mutate v2/src/execution/workflow-runner.ts "(outcomeKind !== \"contract_miss\" && outcomeKind !== \"blocked\")" -> "true"
        // @mutate v2/src/execution/workflow-runner.ts "run.status !== \"blocked\" ||" -> "true ||"
        const outcome = await recoverPlanStage({
          runId,
          project: "demo",
          branch,
          worktreePath,
          writeStepId: stepId,
          steps: [reviewStep],
          stateStore: store,
        });

        expect(outcome.ok).toBe(true);
        if (outcome.ok) expect(outcome.kind).toBe("complete");
      });
    }
  });

  test("refuses recovery with missing or mismatched plan context", async () => {
    const worktreePath = planWorktree("recover-plan-stage-refusal-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-refusal");
    const branch = "recover-plan-stage-refusal";
    const stepId = "plan";
    const specPath = "spec/2026-refusal";
    writeLintCleanPlanStage(stage, "00-first.md");
    const { path: sourceReadyIntent } = seedSourceReadyIntent("recover-plan-stage-refusal-source-");

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
      // Missing captured context: no persisted run for the named runId at all.
      // @mutate v2/src/execution/workflow-runner.ts "if (!run || !run.workflowSnapshot || !run.stepId) {" -> "if (false) {"
      const missing = await recoverPlanStage({
        runId: "does-not-exist",
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        steps: [spyReviewStep()],
        stateStore: store,
      });
      expect(missing).toMatchObject({ ok: false, code: "missing_plan_context" });

      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-refusal-inv",
        outcomeKind: "contract_miss",
      });

      // Run/step identity mismatch: the captured branch disagrees with the persisted run.
      // @mutate v2/src/execution/workflow-runner.ts "run.branch !== request.branch ||" -> "false ||"
      const mismatched = await recoverPlanStage({
        runId,
        project: "demo",
        branch: "some-other-branch",
        worktreePath,
        writeStepId: stepId,
        steps: [spyReviewStep()],
        stateStore: store,
      });
      expect(mismatched).toMatchObject({ ok: false, code: "stage_identity_mismatch" });

      // Unrelated populated stage: a different, also-blocked workflow step's row shares the same
      // worktree/branch and coincidentally sees the populated plan stage, but its own captured
      // step never identified a plan-draft artifact.
      // @mutate v2/src/execution/workflow-runner.ts "writeStep?.expectedArtifactPath !== PLAN_STAGE_DIR" -> "false"
      const unrelatedRunId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath,
        branch,
        specPath,
        stepId: "implement",
        workflowSnapshot: {
          invocationId: "unrelated-inv",
          steps: [{ stepId: "implement", role: "implement", expectedArtifactPath: "proof.txt" }],
        },
      });
      const unrelatedAttemptId = store.recordAttemptStart(unrelatedRunId);
      store.commitCompletionBoundary({ attemptId: unrelatedAttemptId, runStatus: "blocked", outcomeKind: "blocked" });
      const unrelated = await recoverPlanStage({
        runId: unrelatedRunId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: "implement",
        steps: [spyReviewStep()],
        stateStore: store,
      });
      expect(unrelated).toMatchObject({ ok: false, code: "unrelated_plan_stage" });

      expect(existsSync(sourceReadyIntent)).toBe(true);
      expect(existsSync(stage)).toBe(true);
      expect(existsSync(durable)).toBe(false);
    });
  });

  test("retains operator blockers and removes only captured harness blockers during recovery", async () => {
    const matchReason = "harness contract reason";

    // A proven, exactly-matching harness blocker is stripped before landing and never blocks
    // admission.
    {
      const worktreePath = planWorktree("recover-plan-stage-blocker-match-");
      const stage = join(worktreePath, ".jarvis-plan-stage");
      const durable = join(worktreePath, "spec", "2026-blocker-match");
      const branch = "recover-plan-stage-blocker-match";
      const stepId = "plan";
      const specPath = "spec/2026-blocker-match";
      writeLintCleanPlanStage(stage, "00-first.md");
      writeFileSync(join(stage, "intent.md"), `---\nname: test\n---\n${harnessPlanBlocker(matchReason)}`, "utf8");

      await withStateStore(async (store) => {
        const runId = seedBlockedPlanDraftRun(store, {
          project: "demo",
          branch,
          worktreePath,
          specPath,
          stepId,
          invocationId: "recover-plan-stage-blocker-match-inv",
          outcomeKind: "contract_miss",
        });
        const logSink = new TestLogSink();
        logSink.append(runId, {
          kind: "contract_miss_detail",
          attemptId: "attempt-1",
          failedContractId: "plan.decisions-shape",
          responseText: "done",
          failureReason: matchReason,
        });

        const reviewStep = planReviewStep({
          worktreePath,
          stage,
          durable,
          branch,
          invoke: async (agentId) => ({ kind: "ok", stdout: agentId === "claude" ? "ok" : "done", stderr: "" }),
        });

        // @mutate v2/src/execution/workflow-runner.ts "if (extractBlockerBody(content) === undefined) return { kind: \"none\" };" -> "return { kind: \"none\" };"
        const outcome = await recoverPlanStage({
          runId,
          project: "demo",
          branch,
          worktreePath,
          writeStepId: stepId,
          steps: [reviewStep],
          stateStore: store,
          logSink,
        });

        expect(outcome).toMatchObject({ ok: true, kind: "complete" });
        expect(existsSync(join(durable, "intent.md"))).toBe(true);
        expect(readFileSync(join(durable, "intent.md"), "utf8")).not.toContain("## Blocker");
      });
    }

    // A changed reason no longer proves harness authorship: the blocker is retained and refused.
    {
      const worktreePath = planWorktree("recover-plan-stage-blocker-changed-");
      const stage = join(worktreePath, ".jarvis-plan-stage");
      const durable = join(worktreePath, "spec", "2026-blocker-changed");
      const branch = "recover-plan-stage-blocker-changed";
      const stepId = "plan";
      const specPath = "spec/2026-blocker-changed";
      writeLintCleanPlanStage(stage, "00-first.md");
      const stagedIntent = `---\nname: test\n---\n${harnessPlanBlocker(matchReason)}`;
      writeFileSync(join(stage, "intent.md"), stagedIntent, "utf8");

      await withStateStore(async (store) => {
        const runId = seedBlockedPlanDraftRun(store, {
          project: "demo",
          branch,
          worktreePath,
          specPath,
          stepId,
          invocationId: "recover-plan-stage-blocker-changed-inv",
          outcomeKind: "contract_miss",
        });
        const logSink = new TestLogSink();
        logSink.append(runId, {
          kind: "contract_miss_detail",
          attemptId: "attempt-1",
          failedContractId: "plan.decisions-shape",
          responseText: "done",
          failureReason: "a different reason than what is staged",
        });

        const reviewStep = planReviewStep({
          worktreePath,
          stage,
          durable,
          branch,
          invoke: async () => {
            throw new Error("review must not run on a refused recovery");
          },
        });

        // @mutate v2/src/execution/workflow-runner.ts "return content.endsWith(expected) ? { kind: \"harness\", text: expected } : { kind: \"operator\" };" -> "return { kind: \"harness\", text: expected };"
        const outcome = await recoverPlanStage({
          runId,
          project: "demo",
          branch,
          worktreePath,
          writeStepId: stepId,
          steps: [reviewStep],
          stateStore: store,
          logSink,
        });

        expect(outcome).toMatchObject({ ok: false, code: "operator_blocker" });
        expect(readFileSync(join(stage, "intent.md"), "utf8")).toBe(stagedIntent);
        expect(existsSync(durable)).toBe(false);
      });
    }

    // A genuinely `blocked`-kind stop never carries harness metadata: any blocker present is
    // agent/operator-authored, retained and refused.
    {
      const worktreePath = planWorktree("recover-plan-stage-blocker-agent-");
      const stage = join(worktreePath, ".jarvis-plan-stage");
      const durable = join(worktreePath, "spec", "2026-blocker-agent");
      const branch = "recover-plan-stage-blocker-agent";
      const stepId = "plan";
      const specPath = "spec/2026-blocker-agent";
      writeLintCleanPlanStage(stage, "00-first.md");
      const stagedIntent = "---\nname: test\n---\n\n## Blocker\n\nNeed clarification on scope.\n";
      writeFileSync(join(stage, "intent.md"), stagedIntent, "utf8");

      await withStateStore(async (store) => {
        const runId = seedBlockedPlanDraftRun(store, {
          project: "demo",
          branch,
          worktreePath,
          specPath,
          stepId,
          invocationId: "recover-plan-stage-blocker-agent-inv",
          outcomeKind: "blocked",
        });

        const reviewStep = planReviewStep({
          worktreePath,
          stage,
          durable,
          branch,
          invoke: async () => {
            throw new Error("review must not run on a refused recovery");
          },
        });

        const outcome = await recoverPlanStage({
          runId,
          project: "demo",
          branch,
          worktreePath,
          writeStepId: stepId,
          steps: [reviewStep],
          stateStore: store,
        });

        expect(outcome).toMatchObject({ ok: false, code: "operator_blocker" });
        expect(readFileSync(join(stage, "intent.md"), "utf8")).toBe(stagedIntent);
      });
    }
  });

  test("refuses Git-disabled plan-stage recovery", async () => {
    const worktreePath = noGitPlanWorktree("recover-plan-stage-no-git-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-no-git");
    const branch = "recover-plan-stage-no-git";
    const stepId = "plan";
    const specPath = "spec/2026-no-git";
    writeLintCleanPlanStage(stage, "00-first.md");
    const { sourceRoot, path: sourceReadyIntent } = seedSourceReadyIntent("recover-plan-stage-no-git-source-");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-no-git-inv",
        outcomeKind: "contract_miss",
      });

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run when recovery refuses Git-disabled mode");
        },
        inputs: { sourceRoot, paths: [sourceReadyIntent], consumeFrom: "source" },
      });

      // @mutate v2/src/execution/workflow-runner.ts "if (!existsSync(join(run.worktreePath, \".git\"))) {" -> "if (false) {"
      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        steps: [reviewStep],
        stateStore: store,
      });

      expect(outcome).toMatchObject({ ok: false, code: "recovery_requires_git" });
      expect(existsSync(stage)).toBe(true);
      expect(existsSync(sourceReadyIntent)).toBe(true);
      expect(existsSync(durable)).toBe(false);
    });
  });

  test("rejects an uncorrected recovered plan stage without side effects", async () => {
    const worktreePath = planWorktree("recover-plan-stage-uncorrected-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-uncorrected");
    const branch = "recover-plan-stage-uncorrected";
    const stepId = "plan";
    const specPath = "spec/2026-uncorrected";
    const reason = "`## Decisions` bullet is outside the allowed union";

    writeLintCleanPlanStage(stage, "00-first.md");
    const rogueBody = "# Extra\n\n## Decisions\n\n- Out-of-union addition\n";
    writeFileSync(join(stage, "01-second.md"), rogueBody, "utf8");
    writeFileSync(join(stage, "intent.md"), `---\nname: test\n---\n${harnessPlanBlocker(reason)}`, "utf8");
    const { sourceRoot, path: sourceReadyIntent } = seedSourceReadyIntent("recover-plan-stage-uncorrected-source-");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-uncorrected-inv",
        outcomeKind: "contract_miss",
      });
      const logSink = new TestLogSink();
      logSink.append(runId, {
        kind: "contract_miss_detail",
        attemptId: "attempt-1",
        failedContractId: "plan.decisions-shape",
        responseText: "done",
        failureReason: reason,
      });

      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async () => {
          throw new Error("review must not run on an uncorrected recovered plan stage");
        },
        inputs: { sourceRoot, paths: [sourceReadyIntent], consumeFrom: "source" },
      });

      // @mutate v2/src/execution/workflow-runner.ts "const contract = revalidateStagedPlanContract(stagingDir);" -> "const contract = { ok: true } as const;"
      // @mutate v2/src/execution/workflow-runner.ts "return { ok: false, code: \"plan_stage_invalid\", message: contract.reason };" -> "return { ok: false, code: \"plan_stage_invalid\", message: \"reverted\" };"
      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        steps: [reviewStep],
        stateStore: store,
        logSink,
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("unreachable");
      expect(outcome.code).toBe("plan_stage_invalid");
      expect(outcome.message).toContain("01-second.md");
      expect(readFileSync(join(stage, "01-second.md"), "utf8")).toBe(rogueBody);
      expect(existsSync(sourceReadyIntent)).toBe(true);
      expect(existsSync(durable)).toBe(false);

      const writeRun = store.loadRun(runId);
      expect(writeRun?.status).toBe("blocked");
      expect(writeRun?.attempts.length).toBe(1);
    });
  });

  test("retains each invalid recovered plan-stage snapshot before effects", async () => {
    type Scenario = {
      label: string;
      setup: (stage: string) => void;
      reasonContains: string;
      requiresMarkdownlint?: boolean;
    };
    const scenarios: Scenario[] = [
      {
        label: "shape",
        setup: (stage) => {
          mkdirSync(stage, { recursive: true });
          writeFileSync(join(stage, "intent.md"), "---\nname: test\n---\n", "utf8");
        },
        reasonContains: "plan.draft.shape",
      },
      {
        label: "normalizer",
        setup: (stage) => {
          writeLintCleanPlanStage(stage, "00-first.md");
          writeFileSync(
            join(stage, "index.md"),
            "# Index\n\n- [ ] [One](./00-first.md)\n- [ ] [One again](./00-first.md)\n",
            "utf8",
          );
        },
        reasonContains: "more than once",
      },
      {
        label: "staged-markdown",
        setup: (stage) => {
          writeLintCleanPlanStage(stage, "00-first.md");
          const violationBytes = readFileSync(join(REVIEW_MD_LINT_FIXTURES, "plan-md038-violation-subspec.md"), "utf8");
          writeFileSync(join(stage, "00-first.md"), violationBytes, "utf8");
        },
        reasonContains: "MD038",
        requiresMarkdownlint: true,
      },
      {
        label: "landing",
        setup: (stage) => {
          writeLintCleanPlanStage(stage, "00-first.md");
          rmSync(join(stage, "intent.md"));
        },
        reasonContains: "invalid shape",
      },
    ];

    for (const scenario of scenarios) {
      if (
        scenario.requiresMarkdownlint &&
        skipReviewWithoutHarnessMarkdownlint(`retains recovered plan-stage snapshot: ${scenario.label}`)
      ) {
        continue;
      }

      const worktreePath = planWorktree(`recover-plan-stage-invalid-${scenario.label}-`);
      const stage = join(worktreePath, ".jarvis-plan-stage");
      const durable = join(worktreePath, "spec", `2026-invalid-${scenario.label}`);
      const branch = `recover-plan-stage-invalid-${scenario.label}`;
      const stepId = "plan";
      const specPath = `spec/2026-invalid-${scenario.label}`;
      scenario.setup(stage);
      const snapshot = readStageFiles(stage);
      const { sourceRoot, path: sourceReadyIntent } = seedSourceReadyIntent(
        `recover-plan-stage-invalid-${scenario.label}-source-`,
      );

      await withStateStore(async (store) => {
        const runId = seedBlockedPlanDraftRun(store, {
          project: "demo",
          branch,
          worktreePath,
          specPath,
          stepId,
          invocationId: `recover-plan-stage-invalid-${scenario.label}-inv`,
          outcomeKind: "contract_miss",
        });

        const reviewStep = planReviewStep({
          worktreePath,
          stage,
          durable,
          branch,
          invoke: async () => {
            throw new Error("review must not run on an invalid recovered plan stage");
          },
          inputs: { sourceRoot, paths: [sourceReadyIntent], consumeFrom: "source" },
        });

        // @mutate v2/src/execution/workflow-runner.ts "const contract = revalidateStagedPlanContract(stagingDir);" -> "const contract = { ok: true } as const;"
        // @mutate v2/src/execution/workflow-runner.ts "if (lint.kind === \"violation\") {" -> "if (false) {"
        const outcome = await recoverPlanStage({
          runId,
          project: "demo",
          branch,
          worktreePath,
          writeStepId: stepId,
          steps: [reviewStep],
          stateStore: store,
        });

        expect(outcome.ok).toBe(false);
        if (outcome.ok) throw new Error("unreachable");
        expect(outcome.code).toBe("plan_stage_invalid");
        expect(outcome.message).toContain(scenario.reasonContains);
      });

      expect(readStageFiles(stage)).toEqual(snapshot);
      expect(existsSync(sourceReadyIntent)).toBe(true);
      expect(existsSync(durable)).toBe(false);
    }
  });

  test("revalidates a review-mutated recovered plan stage before landing", async () => {
    const worktreePath = planWorktree("recover-plan-stage-review-mutated-");
    const stage = join(worktreePath, ".jarvis-plan-stage");
    const durable = join(worktreePath, "spec", "2026-review-mutated");
    const branch = "recover-plan-stage-review-mutated";
    const stepId = "plan";
    const specPath = "spec/2026-review-mutated";

    writeLintCleanPlanStage(stage, "00-first.md");
    const { sourceRoot, path: sourceReadyIntent } = seedSourceReadyIntent("recover-plan-stage-review-mutated-source-");

    await withStateStore(async (store) => {
      const runId = seedBlockedPlanDraftRun(store, {
        project: "demo",
        branch,
        worktreePath,
        specPath,
        stepId,
        invocationId: "recover-plan-stage-review-mutated-inv",
        outcomeKind: "contract_miss",
      });

      // The mutated index below duplicates a link rather than dropping one: `landPublication`'s
      // own unlinked-numbered-subspec guard would already catch a dropped link, so a duplicate
      // link is what isolates this checkpoint's normalizer re-check from that landing guard.
      const mutatedIndex = "# Index\n\n- [ ] [One](./00-first.md)\n- [ ] [One again](./00-first.md)\n";
      const reviewStep = planReviewStep({
        worktreePath,
        stage,
        durable,
        branch,
        invoke: async (agentId) => {
          if (agentId === "codex") {
            writeFileSync(join(stage, "index.md"), mutatedIndex, "utf8");
          }
          return { kind: "ok", stdout: agentId === "claude" ? "Looks good" : "done", stderr: "" };
        },
        inputs: { sourceRoot, paths: [sourceReadyIntent], consumeFrom: "source" },
      });

      // @mutate v2/src/execution/workflow-runner.ts "if (step.revalidateStagedPlanBeforeLanding === true && landing.kind === \"plan-tree\") {" -> "if (false) {"
      // @mutate v2/src/execution/workflow-runner.ts "? { ...step, revalidateStagedPlanBeforeLanding: true }" -> "? { ...step }"
      const outcome = await recoverPlanStage({
        runId,
        project: "demo",
        branch,
        worktreePath,
        writeStepId: stepId,
        steps: [reviewStep],
        stateStore: store,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.kind).toBe("invocation_failure");
      const failedRun = store.loadRun(outcome.runId);
      expect(failedRun?.attempts.at(-1)?.invocationFailureDetail?.message).toContain("more than once");
      expect(readFileSync(join(stage, "index.md"), "utf8")).toBe(mutatedIndex);
      expect(existsSync(sourceReadyIntent)).toBe(true);
      expect(existsSync(durable)).toBe(false);
    });
  });
});
