import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { implementReviewPromptProfile } from "../../../shared/prompts/review-implement.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { createFakeWithExternalWorktree, createJarvisHome, withStateStore } from "../testing/write-fixtures.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import { landPublication } from "./publication-landing.ts";
import {
  createBindingFactory,
  createImplementBodySummaryStep,
  createIntentWorktreeHarness,
  createLazyIntentWorktreeHarness,
  createShrinkTestStep,
  createStep,
  createStepInput,
  DEFAULT_AGENT_MODEL_CONFIG,
  doneBindingFactory,
  errorBindingFactory,
  IMPLEMENT_BODY_SPEC_PATH,
  loadTelemetryRows,
  okTokenBindingFactory,
  roots,
  TestLogSink,
  TWO_AGENTS,
} from "./workflow-runner.test-support.ts";
import {
  executeWorkflow,
  type ReviewWorkflowStep,
  resolveWorkflowPreset,
  type WriteWorkflowStep,
} from "./workflow-runner.ts";

describe("intent publication input consumption", () => {
  test("keeps the registered file through failures, maps Git deletion into its completion diff, and consumes no-Git sources", async () => {
    const source = createIntentWorktreeHarness("input-source").workspace;
    const worktree = createIntentWorktreeHarness("input-worktree").workspace;
    for (const root of [source, worktree]) {
      mkdirSync(join(root, "queue"));
      writeFileSync(join(root, "queue", "seed.md"), "seed\n");
      execFileSync("git", ["add", "queue"], { cwd: root });
      execFileSync("git", ["commit", "-qm", "seed"], { cwd: root });
    }
    const inputs = { sourceRoot: source, paths: [join(source, "queue/seed.md")], consumeFrom: "worktree" as const };
    await expect(
      landPublication(
        {
          kind: "intent-stage",
          output: { durableDir: "ready-intents" },
          stagingDir: ".jarvis-intent-stage",
          invocationId: "i",
          baseRef: "HEAD",
          inputs,
        },
        worktree,
      ),
    ).rejects.toThrow("missing");
    expect(existsSync(join(source, "queue/seed.md"))).toBe(true);
    mkdirSync(join(worktree, ".jarvis-intent-stage"));
    writeFileSync(join(worktree, ".jarvis-intent-stage", "one.md"), "---\nname: one\n---\n\n## Prerequisites\n");
    await landPublication(
      {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "i",
        baseRef: "HEAD",
        inputs,
      },
      worktree,
    );
    expect(execFileSync("git", ["diff", "--name-only"], { cwd: worktree, encoding: "utf8" })).toContain(
      "queue/seed.md",
    );
    expect(existsSync(join(source, "queue/seed.md"))).toBe(true);

    const noGitSource = mkdtempSync(join(tmpdir(), "intent-no-git-source-"));
    const noGitWorktree = createIntentWorktreeHarness("input-no-git").workspace;
    writeFileSync(join(noGitSource, "seed.md"), "seed\n");
    mkdirSync(join(noGitWorktree, ".jarvis-intent-stage"));
    writeFileSync(join(noGitWorktree, ".jarvis-intent-stage", "two.md"), "---\nname: two\n---\n\n## Prerequisites\n");
    await landPublication(
      {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "no-git",
        baseRef: "HEAD",
        inputs: { sourceRoot: noGitSource, paths: [join(noGitSource, "seed.md")], consumeFrom: "source" },
      },
      noGitWorktree,
    );
    expect(existsSync(join(noGitSource, "seed.md"))).toBe(false);
  });

  test("lands the byte-identical ready intent before consuming plan inputs", async () => {
    const source = createIntentWorktreeHarness("plan-input-source").workspace;
    const worktree = createIntentWorktreeHarness("plan-input-worktree").workspace;
    const intent = "---\nname: plan\n---\n\n## Prerequisites\n\nkeep bytes\n";
    for (const root of [source, worktree]) {
      mkdirSync(join(root, "ready-intents"));
      writeFileSync(join(root, "ready-intents/plan.md"), intent);
      execFileSync("git", ["add", "ready-intents"], { cwd: root });
      execFileSync("git", ["commit", "-qm", "ready intent"], { cwd: root });
    }
    mkdirSync(join(worktree, ".jarvis-plan-stage"));
    writeFileSync(join(worktree, ".jarvis-plan-stage/index.md"), "# Plan\n\n- [ ] [First](./00-first.md)\n");
    writeFileSync(join(worktree, ".jarvis-plan-stage/intent.md"), intent);
    writeFileSync(join(worktree, ".jarvis-plan-stage/00-first.md"), "# First\n");
    await landPublication(
      {
        kind: "plan-tree",
        stagingDir: ".jarvis-plan-stage",
        durablePath: "spec/plan",
        inputs: { sourceRoot: source, paths: [join(source, "ready-intents/plan.md")], consumeFrom: "worktree" },
      },
      worktree,
    );
    expect(readFileSync(join(worktree, "spec/plan/intent.md"), "utf8")).toBe(intent);
    expect(existsSync(join(source, "ready-intents/plan.md"))).toBe(true);
    expect(execFileSync("git", ["diff", "--name-only"], { cwd: worktree, encoding: "utf8" })).toContain(
      "ready-intents/plan.md",
    );
  });

  test("retains no-Git ready intents until a complete plan tree lands", async () => {
    const source = mkdtempSync(join(tmpdir(), "plan-no-git-source-"));
    const workspace = createIntentWorktreeHarness("plan-no-git").workspace;
    const intentPath = join(source, "plan.md");
    writeFileSync(intentPath, "intent\n");
    const landing = {
      kind: "plan-tree" as const,
      stagingDir: ".jarvis-plan-stage",
      durablePath: "plans/plan",
      inputs: { sourceRoot: source, paths: [intentPath], consumeFrom: "source" as const },
    };
    // Draft, review, and validation failures never reach this landing boundary.
    expect(existsSync(intentPath)).toBe(true);
    await expect(landPublication(landing, workspace)).rejects.toThrow("missing");
    expect(existsSync(intentPath)).toBe(true);
    mkdirSync(join(workspace, ".jarvis-plan-stage"));
    writeFileSync(join(workspace, ".jarvis-plan-stage/index.md"), "# Plan\n\n- [ ] [First](./00-first.md)\n");
    writeFileSync(join(workspace, ".jarvis-plan-stage/intent.md"), "intent\n");
    writeFileSync(join(workspace, ".jarvis-plan-stage/00-first.md"), "# First\n");
    mkdirSync(join(workspace, "plans/plan"), { recursive: true });
    writeFileSync(join(workspace, "plans/plan/index.md"), "# collision\n");
    await expect(landPublication(landing, workspace)).rejects.toThrow("different contents");
    expect(existsSync(intentPath)).toBe(true);
    writeFileSync(join(workspace, "plans/plan/index.md"), "# Plan\n\n- [ ] [First](./00-first.md)\n");
    writeFileSync(join(workspace, "plans/plan/intent.md"), "intent\n");
    writeFileSync(join(workspace, "plans/plan/00-first.md"), "# First\n");
    await landPublication(landing, workspace);
    expect(existsSync(intentPath)).toBe(false);
  });
});

describe("resolveWorkflowPreset step shape", () => {
  test("builds a workflow step and preserves loop-control fields", () => {
    const signal = new AbortController().signal;
    const pauseSignal = new AbortController().signal;

    const step = createStepInput({
      stepId: "step-1",
      role: "implement",
      maxIterations: 3,
      signal,
      pauseSignal,
    });

    if (step.behavior !== "write") throw new Error("Expected a write step");

    expect(step.stepId).toBe("step-1");
    expect(step.role).toBe("implement");
    expect(step.maxIterations).toBe(3);
    expect(step.signal).toBe(signal);
    expect(step.pauseSignal).toBe(pauseSignal);
  });
});

describe("resolveWorkflowPreset", () => {
  test("resolves write-write to concrete workflow steps", () => {
    const steps = resolveWorkflowPreset("write-write", [
      createStep({ stepId: "step-1", role: "implement" }),
      createStep({ stepId: "step-2", role: "implement" }),
    ]);

    expect(steps).toHaveLength(2);
    expect(steps[0]?.stepId).toBe("step-1");
    expect(steps[1]?.stepId).toBe("step-2");
  });

  test("throws on unknown preset name", () => {
    expect(() =>
      resolveWorkflowPreset("unknown-preset" as "write-write", [createStep({ stepId: "step-1", role: "implement" })]),
    ).toThrow('Unknown workflow preset: "unknown-preset"');
  });

  test("throws on wrong preset step count", () => {
    expect(() => resolveWorkflowPreset("write-write", [createStep({ stepId: "step-1", role: "implement" })])).toThrow(
      'Workflow preset "write-write" requires 2 steps, received 1',
    );
  });

  test("resolves implement to a single step with pinned role and promptId", () => {
    const steps = resolveWorkflowPreset("implement", [
      createStep({ stepId: "step-1", role: "placeholder", promptId: "placeholder.prompt" }),
    ]);

    expect(steps).toHaveLength(1);
    expect(steps[0]?.behavior).toBe("write");
    expect((steps[0] as WriteWorkflowStep).role).toBe("implement");
    expect((steps[0] as WriteWorkflowStep).promptId).toBe("patch.prompt.body");
  });

  test("resolves implement to two steps with pinned role and promptId", () => {
    const steps = resolveWorkflowPreset("implement", [
      createStep({ stepId: "step-1", role: "placeholder", promptId: "placeholder.prompt" }),
      createStep({ stepId: "step-2", role: "placeholder", promptId: "placeholder.prompt" }),
    ]);

    expect(steps).toHaveLength(2);
    expect(steps[0]?.behavior).toBe("write");
    expect((steps[0] as WriteWorkflowStep).role).toBe("implement");
    expect((steps[0] as WriteWorkflowStep).promptId).toBe("patch.prompt.body");
    expect(steps[1]?.behavior).toBe("write");
    expect((steps[1] as WriteWorkflowStep).role).toBe("implement");
    expect((steps[1] as WriteWorkflowStep).promptId).toBe("patch.prompt.body");
  });

  test("throws on zero implement preset steps", () => {
    expect(() => resolveWorkflowPreset("implement", [])).toThrow(
      'Workflow preset "implement" requires 1 or 2 steps, received 0',
    );
  });

  test("throws on three implement preset steps", () => {
    expect(() =>
      resolveWorkflowPreset("implement", [
        createStep({ stepId: "step-1", role: "implement" }),
        createStep({ stepId: "step-2", role: "implement" }),
        createStep({ stepId: "step-3", role: "implement" }),
      ]),
    ).toThrow('Workflow preset "implement" requires 1 or 2 steps, received 3');
  });

  test("retains exact cardinality for write-write preset", () => {
    expect(() => resolveWorkflowPreset("write-write", [createStep({ stepId: "step-1", role: "implement" })])).toThrow(
      'Workflow preset "write-write" requires 2 steps, received 1',
    );

    expect(() =>
      resolveWorkflowPreset("write-write", [
        createStep({ stepId: "step-1", role: "implement" }),
        createStep({ stepId: "step-2", role: "implement" }),
        createStep({ stepId: "step-3", role: "implement" }),
      ]),
    ).toThrow('Workflow preset "write-write" requires 2 steps, received 3');
  });

  test("retains exact cardinality for intent preset", () => {
    // Preset resolution counts authored write steps only (one for intent), not
    // builder-appended review; see workflow-runner.md § Authoring helper and presets.
    expect(() => resolveWorkflowPreset("intent", [])).toThrow('Workflow preset "intent" requires 1 steps, received 0');

    expect(() =>
      resolveWorkflowPreset("intent", [
        createStep({ stepId: "step-1", role: "plan" }),
        createStep({ stepId: "step-2", role: "plan" }),
      ]),
    ).toThrow('Workflow preset "intent" requires 1 steps, received 2');
  });

  test("retains exact cardinality for plan preset", () => {
    expect(() => resolveWorkflowPreset("plan", [])).toThrow('Workflow preset "plan" requires 1 steps, received 0');

    expect(() =>
      resolveWorkflowPreset("plan", [
        createStep({ stepId: "step-1", role: "plan" }),
        createStep({ stepId: "step-2", role: "plan" }),
      ]),
    ).toThrow('Workflow preset "plan" requires 1 steps, received 2');
  });
});

describe("executeWorkflow", () => {
  test("rejects empty steps array", async () => {
    try {
      await executeWorkflow({ steps: [] });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(String(e)).toContain("at least one step");
    }
  });

  test("rejects duplicate stepIds", async () => {
    const step1 = createStep({ stepId: "step-1", role: "implement" });
    const step2 = createStep({ stepId: "step-1", role: "implement" }); // duplicate

    try {
      await executeWorkflow({ steps: [step1, step2] });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(String(e)).toContain("Duplicate stepId");
    }
  });

  test("onStepRunCreated fires once step 0's run row is durably created, before the step completes", async () => {
    const step = createStep({ stepId: "step-1", role: "implement" });
    const fired: Array<{ stepIndex: number; runId: string; rowExisted: boolean }> = [];

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        onStepRunCreated: (stepIndex, runId) => {
          fired.push({ stepIndex, runId, rowExisted: store.loadRun(runId) !== null });
        },
      });

      // Fires for the implement step's own run, then again for the hidden shrink run.
      // The shrink run is the actual publishing boundary, so it's the one reflected in result.runId.
      expect(fired).toHaveLength(2);
      expect(fired[0]?.stepIndex).toBe(0);
      expect(fired[0]?.runId).not.toBe(result.runId);
      expect(fired[0]?.rowExisted).toBe(true);
      expect(fired[1]?.stepIndex).toBe(0);
      expect(fired[1]?.runId).toBe(result.runId);
      expect(fired[1]?.rowExisted).toBe(true);
    });
  });

  test("onStepRunCreated does not fire when executeWorkflow rejects before step 0's row is created", async () => {
    const step1 = createStep({ stepId: "step-1", role: "implement" });
    const step2 = createStep({ stepId: "step-1", role: "implement" }); // duplicate
    let fired = false;

    try {
      await executeWorkflow({ steps: [step1, step2], onStepRunCreated: () => (fired = true) });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(String(e)).toContain("Duplicate stepId");
    }
    expect(fired).toBe(false);
  });

  test("runs single step to completion", async () => {
    const step = createStep({ stepId: "step-1", role: "implement" });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
      });

      // The implement role triggers a hidden shrink pass, which is the true publishing
      // boundary, so result.runId matches the shrink run, not the implement run.
      const run = store.findRunByProjectBranch({
        project: "demo",
        branch: "workflow-run",
        stepId: "step-1~shrink",
      });
      expect(result.runId).toBe(run?.id ?? "");
      expect(result.runId).not.toBe("");
    });
  });

  test("runs the write-write preset end to end with per-step resolution, ordered advancement, fallback, and separate durable history", async () => {
    const home = createJarvisHome();
    roots.push(home.jarvisRoot);
    const events: string[] = [];
    const branchName = "write-write-proof";
    const sharedWorktree = {
      projectRoot: "/fake",
      projectName: "demo",
      branchName,
      baseRef: "HEAD",
      jarvisRoot: home.jarvisRoot,
    };
    const withExternalWorktree = createFakeWithExternalWorktree(home.jarvisRoot);
    const sharedAgentModelConfig: AgentModelConfig = {
      claude: {
        implement: {
          rungs: [
            { adapterModel: "M1", priceKey: "P1" },
            { adapterModel: "M2", priceKey: "P2" },
          ],
        },
        shrink: {
          rungs: [
            { adapterModel: "M1", priceKey: "P1" },
            { adapterModel: "M2", priceKey: "P2" },
          ],
        },
      },
      codex: {
        implement: {
          rungs: [{ adapterModel: "M3", priceKey: "P3" }],
        },
        shrink: {
          rungs: [{ adapterModel: "M3", priceKey: "P3" }],
        },
      },
    };

    function createProofBindingFactory(
      stepId: string,
      tokens: readonly string[],
    ): NonNullable<WriteWorkflowStep["createBinding"]> {
      let tokenIndex = 0;

      return createBindingFactory(
        async ({ agentId, adapterModel, cwd }) => {
          events.push(`invoke:${stepId}:${agentId}/${adapterModel}`);

          if (adapterModel === "M1" || adapterModel === "M2") {
            return { kind: "quota", stderr: "quota" } as const;
          }

          if (adapterModel === "M3") {
            writeFileSync(`${cwd}/proof.txt`, `${stepId}\n`, "utf8");
            return { kind: "ok", stdout: tokens[tokenIndex++] ?? "done", stderr: "" } as const;
          }

          throw new Error(`Unexpected fallback invocation for ${stepId}: ${agentId}/${adapterModel}`);
        },
        ({ agentId, adapterModel }) => {
          events.push(`resolve:${stepId}:${agentId}/${adapterModel}`);
        },
      );
    }

    const steps = resolveWorkflowPreset("write-write", [
      {
        ...createStep({
          stepId: "step-1",
          role: "implement",
          branchName,
          agents: TWO_AGENTS,
          agentModelConfig: sharedAgentModelConfig,
          createBinding: createProofBindingFactory("step-1", ["progress", "done"]),
        }),
        worktree: sharedWorktree,
        withExternalWorktree,
      },
      {
        ...createStep({
          stepId: "step-2",
          role: "implement",
          branchName,
          agents: TWO_AGENTS,
          agentModelConfig: sharedAgentModelConfig,
          createBinding: createProofBindingFactory("step-2", ["done"]),
        }),
        worktree: sharedWorktree,
        withExternalWorktree,
      },
    ]);

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps,
        stateStore: store,
      });

      expect(result.kind).toBe("complete");
      expect(result.stepIndex).toBe(1);
      expect(result.stepId).toBe("step-2");
      expect(events).toEqual([
        "resolve:step-1:claude/M1",
        "resolve:step-1:claude/M2",
        "resolve:step-1:codex/M3",
        "invoke:step-1:claude/M1",
        "invoke:step-1:claude/M2",
        "invoke:step-1:codex/M3",
        "invoke:step-1:claude/M1",
        "invoke:step-1:claude/M2",
        "invoke:step-1:codex/M3",
        "resolve:step-1:claude/M1",
        "resolve:step-1:claude/M2",
        "resolve:step-1:codex/M3",
        "invoke:step-1:claude/M1",
        "invoke:step-1:claude/M2",
        "invoke:step-1:codex/M3",
        "resolve:step-2:claude/M1",
        "resolve:step-2:claude/M2",
        "resolve:step-2:codex/M3",
        "invoke:step-2:claude/M1",
        "invoke:step-2:claude/M2",
        "invoke:step-2:codex/M3",
        "resolve:step-2:claude/M1",
        "resolve:step-2:claude/M2",
        "resolve:step-2:codex/M3",
        "invoke:step-2:claude/M1",
        "invoke:step-2:claude/M2",
        "invoke:step-2:codex/M3",
      ]);

      const run1 = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "step-1",
      });
      const run2 = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "step-2",
      });

      expect(run1?.id).not.toBe(run2?.id);
      expect(run1?.status).toBe("completed");
      expect(run2?.status).toBe("completed");
      expect(run1?.attemptCount).toBe(2);
      expect(run2?.attemptCount).toBe(1);
      expect(run1?.attempts.map((attempt) => attempt.outcomeKind)).toEqual(["progress", "done"]);
      expect(run2?.attempts.map((attempt) => attempt.outcomeKind)).toEqual(["done"]);
      expect(run1?.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
      expect(run2?.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1]);
    });
  });

  test("stops workflow when step ends blocked", async () => {
    const step1 = createStep({ stepId: "step-1", role: "implement", branchName: "blocked-run" });
    const step2 = createStep({
      stepId: "step-2",
      role: "implement",
      branchName: "blocked-run",
      createBinding: okTokenBindingFactory("blocked"),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step1, step2],
        stateStore: store,
      });

      expect(result.kind).toBe("blocked");
      expect(result.stepIndex).toBe(1);
      expect(result.stepId).toBe("step-2");

      // Step 1 should be completed
      const run1 = store.findRunByProjectBranch({
        project: "demo",
        branch: "blocked-run",
        stepId: "step-1",
      });
      expect(run1?.status).toBe("completed");

      // Step 2 should be blocked
      const run2 = store.findRunByProjectBranch({
        project: "demo",
        branch: "blocked-run",
        stepId: "step-2",
      });
      expect(run2?.status).toBe("blocked");
    });
  });

  test("blocked outcome retains the real git worktree, branch, registration, and uncommitted work", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "blocked-retain-project-"));
    roots.push(projectRoot);
    execFileSync("git", ["init", "-q"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
    writeFileSync(join(projectRoot, "spec.md"), "- [ ] work\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: projectRoot });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: projectRoot });

    const branchName = "blocked-real-run";

    const step = createStep({
      stepId: "step-1",
      role: "implement",
      branchName,
      createBinding: createBindingFactory(async ({ cwd }) => {
        writeFileSync(join(cwd, "uncommitted.txt"), "wip\n", "utf8");
        appendFileSync(join(cwd, "spec.md"), "\n## Blocker\n\nstuck\n", "utf8");
        return { kind: "ok", stdout: "blocked", stderr: "" } as const;
      }),
    });
    step.worktree = { ...step.worktree, projectRoot };
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("expected jarvisRoot to be set by createStep");
    roots.push(jarvisRoot);
    delete step.withExternalWorktree;

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
      });

      expect(result.kind).toBe("blocked");

      const worktreePath = getExternalWorktreePath({
        projectRoot,
        projectName: "demo",
        branchName,
        baseRef: "HEAD",
        jarvisRoot,
      });

      expect(existsSync(worktreePath)).toBe(true);
      expect(existsSync(join(worktreePath, "uncommitted.txt"))).toBe(true);

      const branchList = execFileSync("git", ["branch", "--list", branchName], { cwd: projectRoot }).toString();
      expect(branchList).toContain(branchName);

      const worktreeList = execFileSync("git", ["worktree", "list"], { cwd: projectRoot }).toString();
      expect(worktreeList).toContain(worktreePath);

      const run = store.findRunByProjectBranch({ project: "demo", branch: branchName, stepId: "step-1" });
      expect(run?.status).toBe("blocked");
      expect(run?.worktreePath).toBe(worktreePath);
    });
  });

  test("stops workflow on invocation_failure", async () => {
    const step1 = createStep({ stepId: "step-1", role: "implement", branchName: "failure-run" });
    const step2 = createStep({
      stepId: "step-2",
      role: "implement",
      branchName: "failure-run",
      createBinding: errorBindingFactory,
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step1, step2],
        stateStore: store,
      });

      expect(result.kind).toBe("invocation_failure");
      expect(result.stepIndex).toBe(1);
      expect(result.stepId).toBe("step-2");
    });
  });

  test("stops workflow on soft-stop (budget-exhausted)", async () => {
    const step1 = createStep({ stepId: "step-1", role: "implement", branchName: "budget-run", maxIterations: 1 });
    const step2 = createStep({
      stepId: "step-2",
      role: "implement",
      branchName: "budget-run",
      createBinding: okTokenBindingFactory("progress"),
      maxIterations: 1,
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step1, step2],
        stateStore: store,
      });

      expect(result.kind).toBe("budget-exhausted");
      expect(result.stepIndex).toBe(1);
      expect(result.stepId).toBe("step-2");
    });
  });

  test("resumes at first non-completed step", async () => {
    const stateDbPath = ":memory:";

    // First invocation: complete step 1, progress on step 2
    const step1First = createStep({ stepId: "step-1", role: "implement", branchName: "resume-test" });
    const step2First = createStep({
      stepId: "step-2",
      role: "implement",
      branchName: "resume-test",
      createBinding: okTokenBindingFactory("progress"),
      maxIterations: 1,
    });

    let store = openStateStore(stateDbPath);

    try {
      const result1 = await executeWorkflow({
        steps: [step1First, step2First],
        stateStore: store,
      });

      expect(result1.kind).toBe("budget-exhausted");
      expect(result1.stepIndex).toBe(1);

      store.close();

      // Second invocation: resume should skip step 1 and resume step 2
      store = openStateStore(stateDbPath);

      const step1Second = createStep({ stepId: "step-1", role: "implement", branchName: "resume-test" });
      const step2Second = createStep({ stepId: "step-2", role: "implement", branchName: "resume-test" });

      const result2 = await executeWorkflow({
        steps: [step1Second, step2Second],
        stateStore: store,
      });

      expect(result2.kind).toBe("complete");
      expect(result2.stepIndex).toBe(1);

      // Verify step 1's attempt history unchanged
      const run1 = store.findRunByProjectBranch({
        project: "demo",
        branch: "resume-test",
        stepId: "step-1",
      });
      const run2 = store.findRunByProjectBranch({
        project: "demo",
        branch: "resume-test",
        stepId: "step-2",
      });
      expect(run1?.attempts).toHaveLength(1); // Only one attempt from first invocation
      expect(run1?.workflowSnapshot?.invocationId).toBe(run2?.workflowSnapshot?.invocationId);
    } finally {
      store.close();
    }
  });

  test("tracks per-step attempt history independently", async () => {
    const step1 = createStep({
      stepId: "step-1",
      role: "implement",
      branchName: "history-test",
      iterationTimeoutMs: 123,
    });
    const step2 = createStep({
      stepId: "step-2",
      role: "implement",
      branchName: "history-test",
      iterationTimeoutMs: 123,
    });

    await withStateStore(async (store) => {
      await executeWorkflow({
        steps: [step1, step2],
        stateStore: store,
      });

      // Query each step independently
      const run1 = store.findRunByProjectBranch({
        project: "demo",
        branch: "history-test",
        stepId: "step-1",
      });
      const run2 = store.findRunByProjectBranch({
        project: "demo",
        branch: "history-test",
        stepId: "step-2",
      });

      expect(run1).not.toBeNull();
      expect(run2).not.toBeNull();
      expect(run1?.id).not.toBe(run2?.id);
      expect(run1?.stepId).toBe("step-1");
      expect(run2?.stepId).toBe("step-2");
      expect(run1?.attempts).toHaveLength(1);
      expect(run2?.attempts).toHaveLength(1);
      expect(run1?.workflowSnapshot).toEqual(run2?.workflowSnapshot);
      const stepConfig = {
        stepRules: "Return exactly one terminal token.",
        expectedArtifactPath: "proof.txt",
        agents: ["claude"],
        agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
        iterationTimeoutMs: 123,
      };
      expect(run1?.workflowSnapshot?.steps).toEqual([
        { stepId: "step-1", role: "implement", durable: true, ...stepConfig },
        { stepId: "step-2", role: "implement", durable: true, ...stepConfig },
      ]);
    });
  });

  test("resume and freshDispatch revise keep iterationCeilingMs on workflow snapshot steps", async () => {
    const stateDbPath = ":memory:";
    const bounds = { iterationTimeoutMs: 111, iterationCeilingMs: 222 };
    const implementStep = () =>
      createStep({
        stepId: "step-1",
        role: "implement",
        branchName: "bounds-resume",
        ...bounds,
      });

    let store = openStateStore(stateDbPath);
    try {
      await executeWorkflow({ steps: [implementStep()], stateStore: store });
      const runFirst = store.findRunByProjectBranch({
        project: "demo",
        branch: "bounds-resume",
        stepId: "step-1",
      });
      expect(runFirst?.workflowSnapshot?.steps[0]).toMatchObject(bounds);

      store.close();
      store = openStateStore(stateDbPath);

      await executeWorkflow({ steps: [implementStep()], stateStore: store });
      const runResume = store.findRunByProjectBranch({
        project: "demo",
        branch: "bounds-resume",
        stepId: "step-1",
      });
      expect(runResume?.workflowSnapshot?.steps[0]).toMatchObject(bounds);

      await executeWorkflow({ steps: [implementStep()], stateStore: store, freshDispatch: true });
      const runRevise = store.findRunByProjectBranch({
        project: "demo",
        branch: "bounds-resume",
        stepId: "step-1",
      });
      expect(runRevise?.workflowSnapshot?.steps[0]).toMatchObject(bounds);
      expect(runRevise?.workflowSnapshot?.invocationId).not.toBe(runResume?.workflowSnapshot?.invocationId);
    } finally {
      store.close();
    }
  });

  test("runs one hidden shrink pass after an implement step completes", async () => {
    const calls: string[] = [];
    const step = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "implement-shrink",
      agentModelConfig: {
        claude: {
          implement: { rungs: [{ adapterModel: "I1", priceKey: "I1" }] },
          shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
        },
      },
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: async ({ cwd, prompt }) => {
          calls.push(`${adapterModel}:${prompt.includes("Post-completion Shrink") ? "shrink-prompt" : "write-prompt"}`);
          writeFileSync(`${cwd}/proof.txt`, "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        },
        metadata: { agent: agentId, model: adapterModel },
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });

      expect(result.kind).toBe("complete");
      expect(calls).toEqual(["I1:write-prompt", "S1:shrink-prompt"]);
      expect(
        store.findRunByProjectBranch({ project: "demo", branch: "implement-shrink", stepId: "implement" })?.status,
      ).toBe("completed");
      expect(
        store.findRunByProjectBranch({ project: "demo", branch: "implement-shrink", stepId: "implement~shrink" })
          ?.status,
      ).toBe("completed");
    });
  });

  test("commits implement output before a shrink invocation error", async () => {
    const branchName = "shrink-invocation-error-commit";
    const { harness, step } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (shrink) return { kind: "error", exitCode: 1, stderr: "shrink invocation error" };
      writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });

      expect(result.kind).toBe("invocation_failure");
      expect(result.resumable).toBe(true);
      expect(
        store.findRunByProjectBranch({ project: "demo", branch: branchName, stepId: "implement~shrink" })?.status,
      ).toBe("paused");
      expect(execFileSync("git", ["show", "HEAD:proof.txt"], { cwd: harness.workspace, encoding: "utf8" })).toBe(
        "implemented\n",
      );
      expect(() => execFileSync("git", ["diff", "--quiet"], { cwd: harness.workspace })).not.toThrow();
    });
  });

  test("shrink/publication reset anchors at pre-implement HEAD when the last progress iteration already committed the clean tree", async () => {
    const branchName = "shrink-reset-pre-implement-anchor";
    let calls = 0;
    const { harness, step } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (shrink) return { kind: "ok", stdout: "done", stderr: "" };
      calls += 1;
      if (calls === 1) {
        writeFileSync(join(cwd, "iter-1.txt"), "x\n", "utf8");
        return { kind: "ok", stdout: "progress", stderr: "" };
      }
      if (calls === 2) {
        writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
        return { kind: "ok", stdout: "progress", stderr: "" };
      }
      // Third call: worktree is already clean (both prior iterations committed themselves).
      return { kind: "ok", stdout: "done", stderr: "" };
    });

    const preImplementHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: harness.workspace,
      encoding: "utf8",
    }).trim();

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      // The two progress-iteration commits are collapsed by the publication reset: only the
      // single publication commit remains on top of preImplementHead.
      expect(
        Number(
          execFileSync("git", ["rev-list", "--count", `${preImplementHead}..HEAD`], {
            cwd: harness.workspace,
            encoding: "utf8",
          }).trim(),
        ),
      ).toBe(1);
      const publishedParent = execFileSync("git", ["rev-parse", "HEAD^"], {
        cwd: harness.workspace,
        encoding: "utf8",
      }).trim();
      expect(publishedParent).toBe(preImplementHead);
    });
  });

  test("shrink/publication reset anchors at pre-implement HEAD when the worktree is materialized lazily by the implement step's first iteration", async () => {
    const branchName = "shrink-reset-lazy-worktree";
    const harness = createLazyIntentWorktreeHarness(branchName);
    let calls = 0;
    const step = createStep({
      stepId: "implement",
      role: "implement",
      branchName,
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: ({ cwd, prompt }) => {
          if (prompt.includes("Post-completion Shrink")) {
            return Promise.resolve({ kind: "ok", stdout: "done", stderr: "" } as const);
          }
          calls += 1;
          if (calls === 1) {
            writeFileSync(join(cwd, "iter-1.txt"), "x\n", "utf8");
            return Promise.resolve({ kind: "ok", stdout: "progress", stderr: "" } as const);
          }
          if (calls === 2) {
            writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
            return Promise.resolve({ kind: "ok", stdout: "progress", stderr: "" } as const);
          }
          // Third call: worktree is already clean (both prior iterations committed themselves).
          return Promise.resolve({ kind: "ok", stdout: "done", stderr: "" } as const);
        },
        metadata: { agent: agentId, model: adapterModel },
      }),
    });
    step.worktree = {
      projectRoot: harness.workspace,
      projectName: "demo",
      branchName,
      baseRef: "lazy-base",
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
      expect(calls).toBeGreaterThan(0);
      const preImplementHead = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], {
        cwd: harness.workspace,
        encoding: "utf8",
      }).trim();
      const publishedParent = execFileSync("git", ["rev-parse", "HEAD^"], {
        cwd: harness.workspace,
        encoding: "utf8",
      }).trim();
      expect(publishedParent).toBe(preImplementHead);
    });
  });

  test("resumes a shrink invocation error without re-invoking implement and publishes after shrink completes", async () => {
    const branchName = "resume-shrink-invocation-error";
    const calls: string[] = [];
    let shrinkAttempts = 0;
    const { harness, step } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (shrink) {
        calls.push("shrink");
        shrinkAttempts += 1;
        return shrinkAttempts === 1
          ? { kind: "error", exitCode: 1, stderr: "shrink invocation error" }
          : { kind: "ok", stdout: "done", stderr: "" };
      }
      calls.push("implement");
      writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });

    await withStateStore(async (store) => {
      const failed = await executeWorkflow({ steps: [step], stateStore: store });
      expect(failed).toMatchObject({ kind: "invocation_failure", resumable: true });

      const resumed = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionPublisher: async () => ({ pushSha: "published", prNumber: 1, prUrl: "https://example.test/pr/1" }),
        readyFinalizer: async () => {},
      });
      expect(resumed.kind).toBe("complete");
      expect(calls).toEqual(["implement", "shrink", "shrink"]);
      expect(
        store.findRunByProjectBranch({ project: "demo", branch: branchName, stepId: "implement~shrink" })?.status,
      ).toBe("completed");
      expect(execFileSync("git", ["show", "HEAD:proof.txt"], { cwd: harness.workspace, encoding: "utf8" })).toBe(
        "implemented\n",
      );
    });
  });

  test("runs shrink exactly once for a two-step resolved implement preset", async () => {
    const shrinkCalls: string[] = [];
    const stepConfig = {
      branchName: "implement-preset-shrink",
      promptPlaceholders: {
        SPEC_PATH: "spec.md",
        SIBLINGS_BLOCK: "",
        REPO_GUIDANCE: "",
        ACTIVE_SUBSPEC_PATH: "spec.md",
        ACTIVE_SUBSPEC_BODY: "",
        PATCH_RULES: "",
        TIMEOUT_CHECKPOINT_CONTEXT: "",
      },
      agentModelConfig: {
        claude: {
          implement: { rungs: [{ adapterModel: "I1", priceKey: "I1" }] },
          shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
        },
      },
      createBinding: ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: async ({ cwd, prompt }: { cwd: string; prompt: string }) => {
          if (prompt.includes("Post-completion Shrink")) shrinkCalls.push(adapterModel);
          writeFileSync(`${cwd}/proof.txt`, "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        },
        metadata: { agent: agentId, model: adapterModel },
      }),
    };
    const steps = resolveWorkflowPreset("implement", [
      createStep({ stepId: "step-1", role: "implement", ...stepConfig }),
      createStep({ stepId: "step-2", role: "implement", ...stepConfig }),
    ]);

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps, stateStore: store });

      expect(result.kind).toBe("complete");
      expect(shrinkCalls).toEqual(["S1"]);
      expect(
        store.findRunByProjectBranch({
          project: "demo",
          branch: "implement-preset-shrink",
          stepId: "step-1~shrink",
        }),
      ).toBeNull();
      expect(
        store.findRunByProjectBranch({
          project: "demo",
          branch: "implement-preset-shrink",
          stepId: "step-2~shrink",
        })?.status,
      ).toBe("completed");
    });
  });

  test("does not run shrink after non-complete implement outcomes", async () => {
    const cases = [
      { branchName: "shrink-skip-budget", binding: okTokenBindingFactory("progress"), maxIterations: 1 },
      { branchName: "shrink-skip-paused", binding: okTokenBindingFactory("progress"), pause: true },
      { branchName: "shrink-skip-blocked", binding: okTokenBindingFactory("blocked") },
      { branchName: "shrink-skip-contract", binding: okTokenBindingFactory("done") },
      { branchName: "shrink-skip-failure", binding: errorBindingFactory },
    ];

    for (const testCase of cases) {
      const pauseController = new AbortController();
      if (testCase.pause) pauseController.abort();
      const step = createStep({
        stepId: "implement",
        role: "implement",
        branchName: testCase.branchName,
        createBinding: testCase.binding,
        ...(testCase.maxIterations !== undefined ? { maxIterations: testCase.maxIterations } : {}),
        ...(testCase.pause ? { pauseSignal: pauseController.signal } : {}),
      });

      await withStateStore(async (store) => {
        const result = await executeWorkflow({ steps: [step], stateStore: store });

        expect(result.kind).not.toBe("complete");
        expect(
          store.findRunByProjectBranch({ project: "demo", branch: testCase.branchName, stepId: "implement~shrink" }),
        ).toBeNull();
      });
    }
  });

  test("shrink uses implement context with shrink role bindings and pinned prompt", async () => {
    const resolved: string[] = [];
    const prompts: string[] = [];
    const step = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "shrink-context",
      agents: ["claude", "codex"],
      agentModelConfig: {
        claude: {
          implement: { rungs: [{ adapterModel: "I1", priceKey: "I1" }] },
          shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
        },
        codex: {
          implement: { rungs: [{ adapterModel: "I2", priceKey: "I2" }] },
          shrink: { rungs: [{ adapterModel: "S2", priceKey: "S2" }] },
        },
      },
      createBinding: ({ agentId, adapterModel }) => {
        resolved.push(`${agentId}/${adapterModel}`);
        return {
          id: `${agentId}/${adapterModel}`,
          invoke: async ({ cwd, prompt }) => {
            prompts.push(prompt);
            writeFileSync(`${cwd}/proof.txt`, "ok\n", "utf8");
            return { kind: "ok", stdout: "done", stderr: "" } as const;
          },
          metadata: { agent: agentId, model: adapterModel },
        };
      },
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });

      expect(result.kind).toBe("complete");
      expect(resolved).toEqual(["claude/I1", "codex/I2", "claude/S1", "codex/S2"]);
      expect(prompts[1]).toContain("Post-completion Shrink");
      expect(prompts[1]).toContain("**Spec:** `spec.md`");
      expect(prompts[1]).toContain("proof.txt");
    });
  });

  test("shrink telemetry records role shrink on a distinct binding chain", async () => {
    const telemetryPath = join(mkdtempSync(join(tmpdir(), "workflow-shrink-telemetry-")), "telemetry.jsonl");
    const step = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "shrink-telemetry",
      agentModelConfig: {
        claude: {
          implement: { rungs: [{ adapterModel: "I1", priceKey: "I1" }] },
          shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
        },
      },
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: async ({ cwd }) => {
          writeFileSync(`${cwd}/proof.txt`, "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        },
        metadata: { agent: agentId, model: adapterModel },
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        telemetry: { operatorSessionId: "session-1", workflow: "implement", sinkPath: telemetryPath },
      });

      expect(result.kind).toBe("complete");
      const rows = loadTelemetryRows(telemetryPath);
      expect(rows.map((row) => row.role)).toEqual(["implement", "shrink"]);
      expect(rows.map((row) => row.step_id)).toEqual(["implement", "implement~shrink"]);
      expect(rows[0]?.binding_id).toBe("claude/I1");
      expect(rows[1]?.binding_id).toBe("claude/S1");
    });
  });

  test("multi-step workflow completion requires review-step evidence, not just step-0 completion", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "workflow-review-completion-"));
    let criticInvoked = false;
    let actuatorInvoked = false;
    const writeStep = createStep({ stepId: "step-1", role: "implement", branchName: "review-completion-test" });
    const reviewStep: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "step-1-review",
      project: "demo",
      branch: "review-completion-test",
      cwd,
      prompt: "critic prompt",
      verdictPath: join(cwd, "verdict.md"),
      maxCycles: 1,
      profile: implementReviewPromptProfile,
      profileContext: {
        stagingDir: cwd,
        verdictPath: join(cwd, "verdict.md"),
        specPath: join(cwd, "spec.md"),
        worktreePath: cwd,
        cwd,
        passNumber: 1,
        totalPasses: 1,
      },
      agents: { critic: ["claude"], actuator: ["claude"] },
      agentModelConfig: {
        claude: {
          critic: { rungs: [{ adapterModel: "C1", priceKey: "P1" }] },
          actuator: { rungs: [{ adapterModel: "A1", priceKey: "P1" }] },
        },
      },
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: async () => {
          if (adapterModel === "C1") criticInvoked = true;
          if (adapterModel === "A1") actuatorInvoked = true;
          return { kind: "ok", stdout: "apply verdict", stderr: "" } as const;
        },
        metadata: { agent: agentId, model: adapterModel },
      }),
    };

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [writeStep, reviewStep], stateStore: store });

      expect(result.kind).toBe("complete");
      expect(result.stepIndex).toBe(1);
      expect(result.stepId).toBe("step-1-review");

      const writeRun = store.findRunByProjectBranch({
        project: "demo",
        branch: "review-completion-test",
        stepId: "step-1",
      });

      expect(writeRun?.status).toBe("completed");
      expect(criticInvoked).toBe(true);
      expect(actuatorInvoked).toBe(true);
    });
  });

  test("shrink contract_miss appends contract_miss_detail on the hidden shrink run", async () => {
    const branchName = "shrink-contract-miss-detail";
    const shrinkStdout = "shrink miss diagnostic body";
    const { step } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (shrink) {
        rmSync(join(cwd, "proof.txt"), { force: true });
        return { kind: "ok", stdout: `${shrinkStdout}\ndone`, stderr: "" };
      }
      writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const logSink = new TestLogSink();

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });

      expect(result.kind).toBe("contract_miss");
      const implementRun = store.findRunByProjectBranch({ project: "demo", branch: branchName, stepId: "implement" });
      const shrinkRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement~shrink",
      });
      expect(implementRun).not.toBeNull();
      expect(shrinkRun).not.toBeNull();
      const implementRunId = implementRun?.id;
      const shrinkRunId = shrinkRun?.id;
      expect(implementRunId).toBeDefined();
      expect(shrinkRunId).toBeDefined();
      if (implementRunId === undefined || shrinkRunId === undefined) {
        throw new Error("expected implement and shrink runs");
      }

      const implementDetail = logSink
        .getEventsForRun(implementRunId)
        .find((event) => event.kind === "contract_miss_detail");
      expect(implementDetail).toBeUndefined();

      const shrinkDetail = logSink.getEventsForRun(shrinkRunId).find((event) => event.kind === "contract_miss_detail");
      expect(shrinkDetail).toMatchObject({
        kind: "contract_miss_detail",
        failedContractId: "artifact.exists",
        responseText: `${shrinkStdout}\ndone`,
      });
    });
  });

  test("post-commit shrink contract_miss is resumable", async () => {
    const branchName = "post-commit-shrink-contract-miss-resumable";
    const { step } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (shrink) {
        rmSync(join(cwd, "proof.txt"), { force: true });
        return { kind: "ok", stdout: "done", stderr: "" };
      }
      writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const logSink = new TestLogSink();

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });

      expect(result).toMatchObject({ kind: "contract_miss", resumable: true });
      const shrinkRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement~shrink",
      });
      expect(shrinkRun).not.toBeNull();
      expect(shrinkRun?.status).toBe("paused");
      const shrinkRunId = shrinkRun?.id;
      expect(shrinkRunId).toBeDefined();
      if (shrinkRunId === undefined) {
        throw new Error("expected shrink run id");
      }
      const terminal = logSink
        .getEventsForRun(shrinkRunId)
        .filter((event) => event.kind === "loop_finished")
        .at(-1);
      expect(terminal).toMatchObject({ loopOutcomeKind: "contract_miss", resumable: true });
    });
  });

  test("resume after post-commit shrink contract_miss retries shrink without implement", async () => {
    const branchName = "resume-post-commit-shrink-contract-miss";
    const calls: string[] = [];
    let shrinkAttempts = 0;
    const { harness, step } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (shrink) {
        calls.push("shrink");
        shrinkAttempts += 1;
        if (shrinkAttempts === 1) {
          rmSync(join(cwd, "proof.txt"), { force: true });
          return { kind: "ok", stdout: "done", stderr: "" };
        }
        writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" };
      }
      calls.push("implement");
      writeFileSync(join(cwd, "proof.txt"), "implemented\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });

    await withStateStore(async (store) => {
      const failed = await executeWorkflow({ steps: [step], stateStore: store });
      expect(failed).toMatchObject({ kind: "contract_miss", resumable: true });

      const resumed = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionPublisher: async () => ({ pushSha: "published", prNumber: 1, prUrl: "https://example.test/pr/1" }),
        readyFinalizer: async () => {},
      });
      expect(resumed.kind).toBe("complete");
      expect(calls).toEqual(["implement", "shrink", "shrink"]);
      expect(
        store.findRunByProjectBranch({ project: "demo", branch: branchName, stepId: "implement~shrink" })?.status,
      ).toBe("completed");
      expect(execFileSync("git", ["show", "HEAD:proof.txt"], { cwd: harness.workspace, encoding: "utf8" })).toBe(
        "implemented\n",
      );
    });
  });

  test("implement write-step contract_miss stays non-resumable", async () => {
    const branchName = "implement-contract-miss-non-resumable";
    const { step, workspace } = createImplementBodySummaryStep(branchName);
    const subspecPath = join(IMPLEMENT_BODY_SPEC_PATH, "00-first.md");
    writeFileSync(join(workspace, subspecPath), "# First\n\n## Acceptance criteria\n\n- [ ] ship it\n", "utf8");
    step.expectedArtifactPath = subspecPath;
    step.createBinding = doneBindingFactory;

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store });

      expect(result).toMatchObject({ kind: "contract_miss", resumable: false });
      expect(
        store.findRunByProjectBranch({ project: "demo", branch: branchName, stepId: "implement~shrink" }),
      ).toBeNull();
    });
  });

  test("post-commit shrink blocked with blocker text stays terminal", async () => {
    const branchName = "post-commit-shrink-blocked-terminal";
    const { step } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (shrink) {
        writeFileSync(join(cwd, "proof.txt"), "ok\n## Blocker\n\ngenuine shrink blocker\n", "utf8");
        return { kind: "ok", stdout: "blocked", stderr: "" };
      }
      writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const logSink = new TestLogSink();

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });

      expect(result).toMatchObject({ kind: "blocked", resumable: false });
      const shrinkRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement~shrink",
      });
      expect(shrinkRun).not.toBeNull();
      expect(shrinkRun?.status).toBe("blocked");
      const shrinkRunId = shrinkRun?.id;
      expect(shrinkRunId).toBeDefined();
      if (shrinkRunId === undefined) {
        throw new Error("expected shrink run id");
      }
      const terminal = logSink
        .getEventsForRun(shrinkRunId)
        .filter((event) => event.kind === "loop_finished")
        .at(-1);
      expect(terminal).toMatchObject({ loopOutcomeKind: "blocked", resumable: false });
    });
  });

  test("post-commit shrink missing_blocker stays resumable", async () => {
    const branchName = "post-commit-shrink-missing-blocker";
    const { step } = createShrinkTestStep(branchName, async ({ cwd, shrink }) => {
      if (shrink) return { kind: "ok", stdout: "blocked", stderr: "" };
      writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" };
    });
    const logSink = new TestLogSink();

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step], stateStore: store, logSink });

      expect(result).toMatchObject({ kind: "blocked", resumable: true });
      const shrinkRun = store.findRunByProjectBranch({
        project: "demo",
        branch: branchName,
        stepId: "implement~shrink",
      });
      expect(shrinkRun).not.toBeNull();
      expect(shrinkRun?.status).toBe("paused");
      const shrinkRunId = shrinkRun?.id;
      expect(shrinkRunId).toBeDefined();
      if (shrinkRunId === undefined) {
        throw new Error("expected shrink run id");
      }
      const terminal = logSink
        .getEventsForRun(shrinkRunId)
        .filter((event) => event.kind === "loop_finished")
        .at(-1);
      expect(terminal).toMatchObject({ resumable: true });
    });
  });

  // The spec asked for this guard inversion to be simulated via an
  // `invertPostCommitShrinkResumableGuardForTest` input field. That field was removed: it put a
  // test-only branch on the production settle path. `isPostCommitShrinkResumableOutcome` is a pure
  // exported predicate, so the inversion is a real source mutation — making its `contract_miss` arm
  // return false turns `post-commit shrink contract_miss is resumable` RED, which is the same proof
  // without the production branch.

  test("non-complete shrink outcome stops at the implement step without running later steps", async () => {
    const invoked: string[] = [];
    const step1 = createStep({
      stepId: "implement",
      role: "implement",
      branchName: "shrink-stops-workflow",
      agentModelConfig: {
        claude: {
          implement: { rungs: [{ adapterModel: "I1", priceKey: "I1" }] },
          shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
        },
      },
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        invoke: async ({ cwd }) => {
          invoked.push(adapterModel);
          if (adapterModel === "S1") return { kind: "ok", stdout: "blocked", stderr: "" } as const;
          writeFileSync(`${cwd}/proof.txt`, "ok\n", "utf8");
          return { kind: "ok", stdout: "done", stderr: "" } as const;
        },
        metadata: { agent: agentId, model: adapterModel },
      }),
    });
    const step2 = createStep({ stepId: "later", role: "implement", branchName: "shrink-stops-workflow" });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [step1, step2], stateStore: store });

      expect(result).toMatchObject({ kind: "blocked", resumable: true });
      expect(result.stepIndex).toBe(0);
      expect(result.stepId).toBe("implement");
      expect(invoked).toEqual(["I1", "S1"]);
      expect(
        store.findRunByProjectBranch({ project: "demo", branch: "shrink-stops-workflow", stepId: "implement~shrink" })
          ?.status,
      ).toBe("paused");
      expect(
        store.findRunByProjectBranch({ project: "demo", branch: "shrink-stops-workflow", stepId: "later" }),
      ).toBeNull();
    });
  });

  test("implement preset and workflow snapshots stay one authored step", async () => {
    const steps = resolveWorkflowPreset("implement", [
      createStep({
        stepId: "implement",
        role: "placeholder",
        promptPlaceholders: {
          SPEC_PATH: "spec.md",
          SIBLINGS_BLOCK: "",
          REPO_GUIDANCE: "",
          ACTIVE_SUBSPEC_PATH: "spec.md",
          ACTIVE_SUBSPEC_BODY: "",
          PATCH_RULES: "",
          TIMEOUT_CHECKPOINT_CONTEXT: "",
        },
      }),
    ]);

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps, stateStore: store });

      expect(result.kind).toBe("complete");
      expect(steps).toHaveLength(1);
      const run = store.findRunByProjectBranch({ project: "demo", branch: "workflow-run", stepId: "implement" });
      const shrinkRun = store.findRunByProjectBranch({
        project: "demo",
        branch: "workflow-run",
        stepId: "implement~shrink",
      });
      expect(run?.workflowSnapshot?.steps.map((step) => step.stepId)).toEqual(["implement"]);
      expect(shrinkRun?.workflowSnapshot?.steps.map((step) => step.stepId)).toEqual(["implement"]);
      expect(run?.workflowSnapshot?.reviewPasses).toBe(0);
      expect(shrinkRun?.workflowSnapshot?.reviewPasses).toBe(0);
    });
  });

  test("retains implement reviewBehavior on the workflow snapshot from the stamped write step", async () => {
    const steps = resolveWorkflowPreset("implement", [
      {
        ...createStep({
          stepId: "implement",
          role: "placeholder",
          promptPlaceholders: {
            SPEC_PATH: "spec.md",
            SIBLINGS_BLOCK: "",
            REPO_GUIDANCE: "",
            ACTIVE_SUBSPEC_PATH: "spec.md",
            ACTIVE_SUBSPEC_BODY: "",
            PATCH_RULES: "",
            TIMEOUT_CHECKPOINT_CONTEXT: "",
          },
        }),
        implementReviewBehavior: "light",
      },
    ]);

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps, stateStore: store });

      expect(result.kind).toBe("complete");
      const run = store.findRunByProjectBranch({ project: "demo", branch: "workflow-run", stepId: "implement" });
      expect(run?.workflowSnapshot?.reviewBehavior).toBe("light");
    });
  });

  test("workflow-step execution with empty agents returns no_binding", async () => {
    const step = createStep({
      stepId: "step-1",
      role: "implement",
      branchName: "no-binding",
      agents: [],
      agentModelConfig: {},
      createBinding: () => {
        throw new Error("should not build bindings");
      },
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
      });

      expect(result.kind).toBe("invocation_failure");
      const run = store.findRunByProjectBranch({
        project: "demo",
        branch: "no-binding",
        stepId: "step-1",
      });
      expect(run?.attempts[0]?.invocationFailureDetail?.failureKind).toBe("no_binding");
    });
  });
});
