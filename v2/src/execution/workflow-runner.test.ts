import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
import { implementReviewPromptProfile } from "../../../shared/prompts/review-implement.ts";
import { intentReviewPromptProfile } from "../../../shared/prompts/review-intent.ts";
import { planReviewPromptProfile } from "../../../shared/prompts/review-plan.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import {
  createRunControlHandlers,
  resetWriteLoopBindingSourceDepsForTests,
  setWriteLoopBindingSourceDepsForTests,
} from "../daemon/daemon.ts";
import { type LogEvent, type LogSink, openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore } from "../persistence/state-store.ts";
import {
  createFakeWithExternalWorktree,
  createJarvisHome,
  trackedTempRoots,
  withStateStore,
} from "../testing/write-fixtures.ts";
import { createCompletionCommitter } from "./completion-commit.ts";
import type { ExternalWorktree, WithExternalWorktreeResult } from "./external-worktree.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import type { InvocationFailureKind } from "./invocation-failure.ts";
import { landPublication } from "./publication-landing.ts";
import { buildPlanWorkflowSteps } from "./publication-workflow-steps.ts";
import { ReadyFlipError, ReadyGateError, SurvivingMutationError } from "./ready-finalize.ts";
import { nonEmptyDiscoveryReason } from "./runtime-smoke-verifier.ts";
import type { WorkBoundaryRecordedRecord } from "./work-boundary-telemetry.ts";
import type { LoadedWorkflowStep, WorkflowSourceStep } from "./workflow-loader.ts";
import {
  executeWorkflow,
  isPostCommitReviewRetryableFailureKind,
  LinkedIndexReadError,
  type ReviewDebateWorkflowStep,
  type ReviewWorkflowStep,
  resolveWorkflowPreset,
  type WorkflowStepInput,
  type WriteWorkflowStep,
} from "./workflow-runner.ts";

const { roots } = trackedTempRoots();

/** Test log sink that captures all events. */
class TestLogSink implements LogSink {
  events: Array<{ runId: string; event: LogEvent }> = [];

  append(runId: string, event: LogEvent): void {
    this.events.push({ runId, event });
  }

  close(): void {
    // no-op
  }

  getEventsForRun(runId: string): LogEvent[] {
    return this.events.filter((e) => e.runId === runId).map((e) => e.event);
  }
}
const DEFAULT_AGENT_MODEL_CONFIG = {
  claude: {
    implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
    shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
  },
};

function installWorkflowRunnerResumeProfile(): void {
  const profileHome = mkdtempSync(join(tmpdir(), "jarvis-workflow-runner-profile-"));
  const machinesDir = join(profileHome, "machines");
  const profileName = "workflow-runner-profile";
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string, priceKey: string) => ({ rungs: [{ adapterModel, priceKey }] });
  const claudeRoles = {
    plan: rung("plan", "plan"),
    implement: rung("M1", "P1"),
    shrink: rung("S1", "S1"),
    adversary: rung("adv", "adv"),
    critic: rung("crit", "crit"),
    advocate: rung("advoc", "advoc"),
    adjudicator: rung("adj", "adj"),
    actuator: rung("act", "act"),
  };
  writeFileSync(join(machinesDir, `${profileName}.json`), JSON.stringify({ models: { claude: claudeRoles } }));
  writeFileSync(join(profileHome, "config.json"), JSON.stringify({ machineProfile: profileName, agents: ["claude"] }));
  setWriteLoopBindingSourceDepsForTests({
    machineConfigPath: join(profileHome, "config.json"),
    machinesDir,
  });
}
const TWO_AGENTS = ["claude", "codex"] as const;
const VALID_TWO_AGENT_CONFIG: AgentModelConfig = {
  claude: {
    implement: { rungs: [{ adapterModel: "claude-implement", priceKey: "claude-implement" }] },
    shrink: { rungs: [{ adapterModel: "claude-shrink", priceKey: "claude-shrink" }] },
  },
  codex: {
    implement: { rungs: [{ adapterModel: "codex-implement", priceKey: "codex-implement" }] },
    shrink: { rungs: [{ adapterModel: "codex-shrink", priceKey: "codex-shrink" }] },
  },
};
const MISSING_CODEX_IMPLEMENT_CONFIG: AgentModelConfig = {
  claude: {
    implement: { rungs: [{ adapterModel: "claude-implement", priceKey: "claude-implement" }] },
    shrink: { rungs: [{ adapterModel: "claude-shrink", priceKey: "claude-shrink" }] },
  },
  codex: {},
};
const NO_STEP_ROLES_CONFIG: AgentModelConfig = {
  claude: {},
  codex: {},
};

function createBindingFactory(
  invoke: (binding: { agentId: string; adapterModel: string; cwd: string }) => Promise<InvocationResult>,
  onResolve?: (binding: { agentId: string; adapterModel: string }) => void,
): NonNullable<WriteWorkflowStep["createBinding"]> {
  return ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => {
    onResolve?.({ agentId, adapterModel });
    return {
      id: `${agentId}/${adapterModel}`,
      invoke: ({ cwd }: Parameters<InvocationBinding["invoke"]>[0]) => invoke({ agentId, adapterModel, cwd }),
      metadata: { agent: agentId, model: adapterModel },
    } satisfies InvocationBinding;
  };
}

const doneBindingFactory = createBindingFactory(async ({ cwd }) => {
  writeFileSync(`${cwd}/proof.txt`, "ok\n", "utf8");
  return { kind: "ok", stdout: "done", stderr: "" } as const;
});

function okTokenBindingFactory(stdout: string) {
  return createBindingFactory(async ({ cwd }) => {
    if (stdout === "blocked") {
      const specPath = join(cwd, "spec.md");
      if (existsSync(specPath)) {
        appendFileSync(specPath, "\n## Blocker\n\nblocked\n", "utf8");
      }
    }
    return { kind: "ok", stdout, stderr: "" } as const;
  });
}

const errorBindingFactory = createBindingFactory(
  async () => ({ kind: "error", exitCode: 1, stderr: "error" }) as const,
);

function initGitWorkspace(prefix: string) {
  const workspace = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: workspace });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: workspace });
  return workspace;
}

function externalWorktreeBinding(
  workspace: string,
): <T>(
  _args: { branchName: string; projectName: string },
  run: (worktree: ExternalWorktree) => Promise<T> | T,
) => Promise<WithExternalWorktreeResult<T>> {
  return async <T>(
    _args: { branchName: string; projectName: string },
    run: (worktree: ExternalWorktree) => Promise<T> | T,
  ): Promise<WithExternalWorktreeResult<T>> => ({
    worktree: { path: workspace, reused: false },
    lock: { kind: "acquired" },
    value: await run({ path: workspace, reused: false }),
  });
}

function createIntentWorktreeHarness(branchName: string) {
  const workspace = initGitWorkspace(`intent-workflow-${branchName}-`);
  writeFileSync(join(workspace, "base.txt"), "base\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: workspace });
  return {
    workspace,
    withExternalWorktree: externalWorktreeBinding(workspace),
  };
}

const IMPLEMENT_BODY_SPEC_PATH = "spec/2026-01-01-implement-body";

function createImplementBodySummaryStep(branchName: string) {
  const workspace = initGitWorkspace(`implement-body-summary-${branchName}-`);
  const specDir = join(workspace, IMPLEMENT_BODY_SPEC_PATH);
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "index.md"), "# Implement body\n\n- [ ] [00 - First](./00-first.md)\n", "utf8");
  writeFileSync(join(specDir, "00-first.md"), "# First\n\nImplement the feature.\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "base spec"], { cwd: workspace });
  const baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();

  mkdirSync(join(workspace, "v2", "src"), { recursive: true });
  writeFileSync(join(workspace, "v2", "src", "feature.ts"), "export const feature = 1;\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "add feature"], { cwd: workspace });

  const step = createStep({
    stepId: "implement",
    role: "implement",
    promptId: "patch.prompt.body",
    branchName,
    specPath: IMPLEMENT_BODY_SPEC_PATH,
  });
  step.worktree = {
    projectRoot: workspace,
    projectName: "demo",
    branchName,
    baseRef,
    git: false,
    localPath: workspace,
  };
  step.withExternalWorktree = externalWorktreeBinding(workspace);
  return { step, workspace };
}

function createShrinkTestStep(
  branchName: string,
  invoke: (args: { cwd: string; shrink: boolean }) => Promise<InvocationResult>,
) {
  const harness = createIntentWorktreeHarness(branchName);
  const step = createStep({
    stepId: "implement",
    role: "implement",
    branchName,
    createBinding: ({ agentId, adapterModel }) => ({
      id: `${agentId}/${adapterModel}`,
      invoke: ({ cwd, prompt }) => invoke({ cwd, shrink: prompt.includes("Post-completion Shrink") }),
      metadata: { agent: agentId, model: adapterModel },
    }),
  });
  step.worktree = {
    projectRoot: harness.workspace,
    projectName: "demo",
    branchName,
    baseRef: "HEAD",
    git: false,
    localPath: harness.workspace,
  };
  step.withExternalWorktree = harness.withExternalWorktree;
  return { harness, step };
}

function seedLandedIntentFiles(workspace: string, invocationId: string, files: readonly string[]): void {
  const durableDir = join(workspace, "ready-intents");
  mkdirSync(durableDir, { recursive: true });
  for (const name of files) {
    writeFileSync(
      join(durableDir, name),
      `---\nname: ${name.replace(/\.md$/, "")}\n---\n\n# ${name}\n\n## Prerequisites\n`,
      "utf8",
    );
  }
  mkdirSync(join(workspace, ".git"), { recursive: true });
  writeFileSync(
    join(workspace, ".git", "jarvis-intent-output.json"),
    `${JSON.stringify({ [invocationId]: [...files] })}\n`,
    "utf8",
  );
}

function seedCompletedWriteRun(
  store: ReturnType<typeof openStateStore>,
  step: WriteWorkflowStep,
  workspace: string,
  invocationId: string,
): string {
  const runId = store.createRun({
    project: step.worktree.projectName,
    specRef: "",
    worktreePath: workspace,
    branch: step.worktree.branchName,
    specPath: step.specPath,
    stepId: step.stepId,
    workflowSnapshot: {
      invocationId,
      steps: [
        {
          stepId: step.stepId,
          role: step.role,
          stepRules: step.stepRules,
          expectedArtifactPath: step.expectedArtifactPath,
          agents: step.agents,
          agentModelConfig: step.agentModelConfig,
        },
      ],
      ...(step.creationTitle !== undefined ? { creationTitle: step.creationTitle } : {}),
    },
  });
  const attemptId = store.recordAttemptStart(runId);
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "completed",
    outcomeKind: "done",
    completionAgent: "claude",
  });
  return runId;
}

function createStep(
  overrides: Partial<Omit<WriteWorkflowStep, "worktree" | "behavior">> & {
    stepId: string;
    role: string;
    branchName?: string;
  },
): WriteWorkflowStep {
  const home = createJarvisHome();
  roots.push(home.jarvisRoot);
  const { branchName, ...rest } = overrides;
  return {
    behavior: "write",
    worktree: {
      projectRoot: "/fake",
      projectName: "demo",
      branchName: branchName ?? "workflow-run",
      baseRef: "HEAD",
      jarvisRoot: home.jarvisRoot,
    },
    specPath: "spec.md",
    stepRules: "Return exactly one terminal token.",
    expectedArtifactPath: "proof.txt",
    agents: ["claude"],
    agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
    createBinding: doneBindingFactory,
    withExternalWorktree: createFakeWithExternalWorktree(home.jarvisRoot),
    ...rest,
  };
}

function createStepInput(
  overrides: Partial<Omit<WriteWorkflowStep, "worktree" | "behavior">> & {
    stepId: string;
    role: string;
    branchName?: string;
  },
): WorkflowStepInput {
  return createStep(overrides);
}

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
    writeFileSync(join(worktree, ".jarvis-plan-stage/index.md"), "# Plan\n");
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
    writeFileSync(join(workspace, ".jarvis-plan-stage/index.md"), "# Plan\n");
    writeFileSync(join(workspace, ".jarvis-plan-stage/intent.md"), "intent\n");
    writeFileSync(join(workspace, ".jarvis-plan-stage/00-first.md"), "# First\n");
    mkdirSync(join(workspace, "plans/plan"), { recursive: true });
    writeFileSync(join(workspace, "plans/plan/index.md"), "# collision\n");
    await expect(landPublication(landing, workspace)).rejects.toThrow("different contents");
    expect(existsSync(intentPath)).toBe(true);
    writeFileSync(join(workspace, "plans/plan/index.md"), "# Plan\n");
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

      expect(result.kind).toBe("blocked");
      expect(result.stepIndex).toBe(0);
      expect(result.stepId).toBe("implement");
      expect(invoked).toEqual(["I1", "S1"]);
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

const DEBATE_AGENT_MODEL_CONFIG: AgentModelConfig = {
  claude: {
    adversary: { rungs: [{ adapterModel: "ADV", priceKey: "p-adv" }] },
    advocate: { rungs: [{ adapterModel: "ADVOC", priceKey: "p-advoc" }] },
    adjudicator: { rungs: [{ adapterModel: "ADJ", priceKey: "p-adj" }] },
    actuator: { rungs: [{ adapterModel: "ACT", priceKey: "p-act" }] },
  },
};

function createDebateBindingFactory(
  invoke: (binding: { agentId: string; adapterModel: string }) => Promise<InvocationResult>,
  onResolve?: (binding: { agentId: string; adapterModel: string }) => void,
): NonNullable<ReviewDebateWorkflowStep["createBinding"]> {
  return ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => {
    onResolve?.({ agentId, adapterModel });
    return {
      id: `${agentId}/${adapterModel}`,
      invoke: () => invoke({ agentId, adapterModel }),
      metadata: { agent: agentId, model: adapterModel },
    } satisfies InvocationBinding;
  };
}

function createReviewDebateActuatorFailureBindingFactory(
  actuatorFailure: "timeout" | "stall",
): NonNullable<ReviewDebateWorkflowStep["createBinding"]> {
  return ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => ({
    id: `${agentId}/${adapterModel}`,
    metadata: { agent: agentId, model: adapterModel },
    invoke: ({ signal }) => {
      if (adapterModel !== "ACT") {
        return Promise.resolve(
          adapterModel === "ADJ"
            ? ({ kind: "ok", stdout: "apply this fix", stderr: "" } as const)
            : ({ kind: "ok", stdout: "ok", stderr: "" } as const),
        );
      }
      if (actuatorFailure === "stall") {
        return Promise.resolve({ kind: "stall", stderr: "no output" } as const);
      }
      return new Promise<InvocationResult>((resolve) => {
        signal?.addEventListener("abort", () => resolve({ kind: "error", exitCode: 1, stderr: "aborted" }), {
          once: true,
        });
      });
    },
  });
}

function debateVerdictPath(): string {
  return join(mkdtempSync(join(tmpdir(), "workflow-review-debate-")), "verdict.md");
}

function createDebateStep(
  overrides: Partial<Omit<ReviewDebateWorkflowStep, "behavior">> & { stepId: string; verdictPath: string },
): ReviewDebateWorkflowStep {
  return {
    behavior: "review-debate",
    cwd: "/fake",
    project: "demo",
    branch: "review-debate-workflow",
    prompts: { adversary: "find issues", advocate: "argue merits", adjudicator: "settle it" },
    maxCycles: 1,
    agents: { adversary: ["claude"], advocate: ["claude"], adjudicator: ["claude"], actuator: ["claude"] },
    agentModelConfig: DEBATE_AGENT_MODEL_CONFIG,
    profile: implementReviewPromptProfile,
    profileContext: { specPath: "index.md", cwd: "/fake", baseBranch: "HEAD", passNumber: 1, totalPasses: 1 },
    ...overrides,
  };
}

function loadTelemetryRows(path: string): InvocationCompletedRecord[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as InvocationCompletedRecord);
}

function loadWorkBoundaryRows(path: string): WorkBoundaryRecordedRecord[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WorkBoundaryRecordedRecord)
    .filter((row) => row.record_kind === "work_boundary_recorded");
}

describe("executeWorkflow fresh dispatch", () => {
  test("creates a new run row for a completed step when freshDispatch is set", async () => {
    const stateDbPath = ":memory:";
    const store = openStateStore(stateDbPath);

    try {
      // First invocation: complete step 1
      const step1First = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-test" });

      const result1 = await executeWorkflow({
        steps: [step1First],
        stateStore: store,
      });

      expect(result1.kind).toBe("complete");
      expect(result1.stepId).toBe("step-1");

      const run1First = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-test",
        stepId: "step-1",
      });
      const runId1First = run1First?.id;

      // Second invocation without freshDispatch: should reuse the completed run
      const step1Second = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-test" });

      const result2 = await executeWorkflow({
        steps: [step1Second],
        stateStore: store,
      });

      expect(result2.kind).toBe("complete");
      const run1Second = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-test",
        stepId: "step-1",
      });
      expect(run1Second?.id).toBe(runId1First); // Same run

      // Third invocation with freshDispatch: should create a new run
      const step1Third = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-test" });

      const result3 = await executeWorkflow({
        steps: [step1Third],
        stateStore: store,
        freshDispatch: true,
      });

      expect(result3.kind).toBe("complete");
      const run1Third = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-test",
        stepId: "step-1",
      });
      expect(run1Third?.id).not.toBe(runId1First); // Different run
      expect(run1Third?.attempts).toHaveLength(1); // One attempt in the new run
    } finally {
      store.close();
    }
  });

  test("creates new run rows for both steps in a two-step preset when freshDispatch is set", async () => {
    const stateDbPath = ":memory:";
    const store = openStateStore(stateDbPath);

    try {
      // First invocation: complete both steps
      const step1First = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-preset" });
      const step2First = createStep({ stepId: "step-2", role: "implement", branchName: "fresh-dispatch-preset" });

      const result1 = await executeWorkflow({
        steps: [step1First, step2First],
        stateStore: store,
      });

      expect(result1.kind).toBe("complete");

      const run1First = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-preset",
        stepId: "step-1",
      });
      const run2First = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-preset",
        stepId: "step-2",
      });
      const runId1First = run1First?.id;
      const runId2First = run2First?.id;
      const invocationId1First = run1First?.workflowSnapshot?.invocationId;

      // Second invocation with freshDispatch: should create new runs for both steps
      const step1Second = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-preset" });
      const step2Second = createStep({ stepId: "step-2", role: "implement", branchName: "fresh-dispatch-preset" });

      const result2 = await executeWorkflow({
        steps: [step1Second, step2Second],
        stateStore: store,
        freshDispatch: true,
      });

      expect(result2.kind).toBe("complete");

      const run1Second = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-preset",
        stepId: "step-1",
      });
      const run2Second = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-preset",
        stepId: "step-2",
      });
      expect(run1Second?.id).not.toBe(runId1First); // Step 1 new run
      expect(run2Second?.id).not.toBe(runId2First); // Step 2 new run
      expect(run1Second?.workflowSnapshot?.invocationId).not.toBe(invocationId1First); // New invocationId
      expect(run1Second?.workflowSnapshot?.invocationId).toBe(run2Second?.workflowSnapshot?.invocationId); // Same invocationId for both
    } finally {
      store.close();
    }
  });

  test("reuses run rows within the same execution when freshDispatch is set (shrink step)", async () => {
    const stateDbPath = ":memory:";
    const store = openStateStore(stateDbPath);

    try {
      // First invocation: complete implement step with shrink
      const step1First = createStep({
        stepId: "step-1",
        role: "implement",
        branchName: "fresh-dispatch-shrink",
        suppressShrink: false,
      });

      const result1 = await executeWorkflow({
        steps: [step1First],
        stateStore: store,
      });

      expect(result1.kind).toBe("complete");

      const run1First = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-shrink",
        stepId: "step-1",
      });
      const runShrinkFirst = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-shrink",
        stepId: "step-1~shrink",
      });
      const runId1First = run1First?.id;
      const runIdShrinkFirst = runShrinkFirst?.id;

      // Second invocation with freshDispatch: should create new run but reuse shrink run within this execution
      const step1Second = createStep({
        stepId: "step-1",
        role: "implement",
        branchName: "fresh-dispatch-shrink",
        suppressShrink: false,
      });

      const result2 = await executeWorkflow({
        steps: [step1Second],
        stateStore: store,
        freshDispatch: true,
      });

      expect(result2.kind).toBe("complete");

      const run1Second = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-shrink",
        stepId: "step-1",
      });
      const runShrinkSecond = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-shrink",
        stepId: "step-1~shrink",
      });
      expect(run1Second?.id).not.toBe(runId1First); // Implement step has new run
      expect(runShrinkSecond?.id).not.toBe(runIdShrinkFirst); // Shrink step also has new run (created within same execution)
    } finally {
      store.close();
    }
  });

  test("mints a new invocationId when freshDispatch is set", async () => {
    const stateDbPath = ":memory:";
    const store = openStateStore(stateDbPath);

    try {
      // First invocation
      const step1First = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-invocation" });

      await executeWorkflow({
        steps: [step1First],
        stateStore: store,
      });

      const run1First = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-invocation",
        stepId: "step-1",
      });
      const invocationId1First = run1First?.workflowSnapshot?.invocationId;

      // Second invocation with freshDispatch
      const step1Second = createStep({ stepId: "step-1", role: "implement", branchName: "fresh-dispatch-invocation" });

      await executeWorkflow({
        steps: [step1Second],
        stateStore: store,
        freshDispatch: true,
      });

      const run1Second = store.findRunByProjectBranch({
        project: "demo",
        branch: "fresh-dispatch-invocation",
        stepId: "step-1",
      });
      const invocationId1Second = run1Second?.workflowSnapshot?.invocationId;

      expect(invocationId1Second).not.toBe(invocationId1First);
    } finally {
      store.close();
    }
  });

  test("preserves resume behavior when freshDispatch is absent", async () => {
    const stateDbPath = ":memory:";
    const store = openStateStore(stateDbPath);

    try {
      // First invocation: complete step 1, progress on step 2
      const step1First = createStep({ stepId: "step-1", role: "implement", branchName: "resume-preserved" });
      const step2First = createStep({
        stepId: "step-2",
        role: "implement",
        branchName: "resume-preserved",
        createBinding: okTokenBindingFactory("progress"),
        maxIterations: 1,
      });

      const result1 = await executeWorkflow({
        steps: [step1First, step2First],
        stateStore: store,
      });

      expect(result1.kind).toBe("budget-exhausted");
      expect(result1.stepIndex).toBe(1);

      const run1First = store.findRunByProjectBranch({
        project: "demo",
        branch: "resume-preserved",
        stepId: "step-1",
      });
      const invocationId1First = run1First?.workflowSnapshot?.invocationId;

      // Second invocation without freshDispatch: should resume at step 2
      const step1Second = createStep({ stepId: "step-1", role: "implement", branchName: "resume-preserved" });
      const step2Second = createStep({ stepId: "step-2", role: "implement", branchName: "resume-preserved" });

      const result2 = await executeWorkflow({
        steps: [step1Second, step2Second],
        stateStore: store,
        // freshDispatch is NOT set
      });

      expect(result2.kind).toBe("complete");
      expect(result2.stepIndex).toBe(1);

      const run1Second = store.findRunByProjectBranch({
        project: "demo",
        branch: "resume-preserved",
        stepId: "step-1",
      });
      expect(run1Second?.workflowSnapshot?.invocationId).toBe(invocationId1First); // Same invocationId
      expect(run1Second?.attempts).toHaveLength(1); // Only one attempt (from first invocation)
    } finally {
      store.close();
    }
  });
});

describe("executeWorkflow completion publication", () => {
  test("classifies completion publication, ready-gate, and ready-flip failures in results and loop_finished", async () => {
    const cases: Array<{
      kind: "completion_commit_failed" | "ready_gate_failed" | "ready_flip_failed";
      publish: () => Promise<{ pushSha?: string; prNumber?: number }>;
      finalize: () => Promise<void>;
      expectedResumable: boolean;
    }> = [
      {
        kind: "completion_commit_failed",
        publish: async () => {
          throw new Error("publish failed");
        },
        finalize: async () => {},
        expectedResumable: true,
      },
      {
        kind: "completion_commit_failed",
        publish: async () => ({ pushSha: "abc123def456" }),
        finalize: async () => {
          throw new Error("should not finalize when PR evidence is missing");
        },
        expectedResumable: true,
      },
      {
        kind: "ready_gate_failed",
        publish: async () => ({}),
        finalize: async () => {
          throw new ReadyGateError("bun run ready", 1, "red");
        },
        expectedResumable: true,
      },
      {
        kind: "ready_flip_failed",
        publish: async () => ({}),
        finalize: async () => {
          throw new Error("gh pr ready failed");
        },
        expectedResumable: false,
      },
    ];

    for (const testCase of cases) {
      const step = createStep({
        stepId: `publish-${testCase.kind}`,
        role: "implement",
        branchName: `publish-${testCase.kind}`,
      });
      const logSink = new TestLogSink();
      await withStateStore(async (store) => {
        const result = await executeWorkflow({
          steps: [step],
          stateStore: store,
          logSink,
          completionCommitter: async () => ({ commitSha: "commit-1" }),
          completionPublisher: testCase.publish,
          readyFinalizer: testCase.finalize,
        });
        expect(result.kind).toBe(testCase.kind);
        expect(result.resumable).toBe(testCase.expectedResumable);
        expect(logSink.getEventsForRun(result.runId).at(-1)).toMatchObject({
          kind: "loop_finished",
          loopOutcomeKind: testCase.kind,
          resumable: testCase.expectedResumable,
        });
        if (testCase.kind === "completion_commit_failed" || testCase.kind === "ready_gate_failed") {
          expect(store.loadRun(result.runId)?.status).toBe("failed");
        }
      });
    }
  });

  test("settles surviving_mutation_failed as durable failed with resumable terminal details after completion boundary", async () => {
    const step = createStep({
      stepId: "publish-surviving-mutation",
      role: "implement",
      branchName: "publish-surviving-mutation",
    });
    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
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
      expect(result.survivingMutation).toBe("operator-flip: === → !==");
      expect(result.survivingMutationSourceFile).toBe("src/guard.ts");
      expect(result.survivingMutationSourceLine).toBe(17);
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

  test("persists a successful not-runnable runtime smoke outcome after workflow completion", async () => {
    const step = createStep({
      stepId: "publish-runtime-smoke-not-runnable",
      role: "implement",
      branchName: "publish-runtime-smoke-not-runnable",
    });
    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => ({
          runtimeSmokeOutcome: {
            kind: "not-runnable",
            inspectedPaths: ["v2/src/execution/write-loop.ts", "shared/subprocess.ts"],
            discoveryReason: nonEmptyDiscoveryReason("no changed runnable entrypoint found"),
          },
        }),
      });
      expect(result.kind).toBe("complete");
      expect(logSink.getEventsForRun(result.runId)).toContainEqual({
        kind: "runtime_smoke_outcome",
        outcome: "not-runnable",
        inspectedPaths: ["v2/src/execution/write-loop.ts", "shared/subprocess.ts"],
        discoveryReason: "no changed runnable entrypoint found",
      });
    });
  });

  test("persists a successful not-runnable runtime smoke outcome when the ready flip fails", async () => {
    const step = createStep({
      stepId: "publish-runtime-smoke-flip-failure",
      role: "implement",
      branchName: "publish-runtime-smoke-flip-failure",
    });
    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new ReadyFlipError(new Error("gh pr ready failed"), {
            kind: "not-runnable",
            inspectedPaths: ["v2/src/execution/write-loop.ts"],
            discoveryReason: nonEmptyDiscoveryReason("no changed runnable entrypoint found"),
          });
        },
      });

      expect(result.kind).toBe("ready_flip_failed");
      expect(logSink.getEventsForRun(result.runId)).toContainEqual({
        kind: "runtime_smoke_outcome",
        outcome: "not-runnable",
        inspectedPaths: ["v2/src/execution/write-loop.ts"],
        discoveryReason: "no changed runnable entrypoint found",
      });
    });
  });

  test("surfaces PR number when flip failure occurs after successful publication", async () => {
    const step = createStep({
      stepId: "flip-with-pr",
      role: "implement",
      branchName: "flip-with-pr",
    });
    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({ prNumber: 42 }),
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });
      expect(result.kind).toBe("ready_flip_failed");
      expect(result.resumable).toBe(false);
      expect(result.readyFlipPrNumber).toBe(42);
      expect(result.readyFlipError).toBeDefined();
    });
  });

  test("omits PR number when flip failure occurs but publication returned no PR", async () => {
    const step = createStep({
      stepId: "flip-no-pr",
      role: "implement",
      branchName: "flip-no-pr",
    });
    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });
      expect(result.kind).toBe("ready_flip_failed");
      expect(result.resumable).toBe(false);
      expect(result.readyFlipPrNumber).toBeUndefined();
      expect(result.readyFlipError).toBeDefined();
    });
  });

  test("routes a red ready gate through bounded repair before settlement", async () => {
    const step = createStep({
      stepId: "gate-repair",
      role: "implement",
      branchName: "gate-repair",
    });
    const logSink = new TestLogSink();
    let gateCalls = 0;
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          gateCalls += 1;
          if (gateCalls === 1) throw new ReadyGateError("bun run ready", 1, "tests failed");
        },
      });
      expect(result.kind).toBe("complete");
      expect(gateCalls).toBe(2);
      expect(logSink.getEventsForRun(result.runId)).toContainEqual({
        kind: "ready_gate_repair",
        attempt: 1,
        gateExitCode: 1,
      });
    });
  });

  test("caps ready gate repairs and settles as ready_gate_failed when exhausted", async () => {
    let invocations = 0;
    const trackingBindingFactory = createBindingFactory(async ({ cwd }) => {
      invocations += 1;
      writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" } as const;
    });
    const step = createStep({
      stepId: "gate-exhausted",
      role: "implement",
      branchName: "gate-exhausted",
      createBinding: trackingBindingFactory,
    });
    const logSink = new TestLogSink();
    let gateCalls = 0;
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          gateCalls += 1;
          throw new ReadyGateError("bun run ready", 2, `failure ${gateCalls}`);
        },
      });
      expect(result.kind).toBe("ready_gate_failed");
      expect(result.resumable).toBe(true);
      expect(invocations).toBe(5);
      expect(gateCalls).toBe(4);
      const events = logSink.getEventsForRun(result.runId);
      expect(events.filter((event) => event.kind === "ready_gate_repair")).toHaveLength(3);
    });
  });

  test("skips repair when ready-flip failure occurs (non-ReadyGateError)", async () => {
    const step = createStep({
      stepId: "flip-no-repair",
      role: "implement",
      branchName: "flip-no-repair",
    });
    const logSink = new TestLogSink();
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          throw new Error("gh pr ready failed");
        },
      });
      expect(result.kind).toBe("ready_flip_failed");
      expect(result.resumable).toBe(false);
      const events = logSink.getEventsForRun(result.runId);
      expect(events.filter((event) => event.kind === "ready_gate_repair")).toHaveLength(0);
    });
  });

  test("repair iterations count toward workflow iterationsConsumed", async () => {
    const trackingBindingFactory = createBindingFactory(async ({ cwd }) => {
      writeFileSync(join(cwd, "proof.txt"), "ok\n", "utf8");
      return { kind: "ok", stdout: "done", stderr: "" } as const;
    });
    const step = createStep({
      stepId: "repair-counting",
      role: "implement",
      branchName: "repair-counting",
      createBinding: trackingBindingFactory,
    });
    const logSink = new TestLogSink();
    let gateCalls = 0;
    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        logSink,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {
          gateCalls += 1;
          if (gateCalls <= 2) throw new ReadyGateError("bun run ready", 1, "red");
        },
      });
      expect(result.kind).toBe("complete");
      expect(result.iterationsConsumed).toBe(4);
    });
  });

  test("retains a supplied title for completion-publication retry", async () => {
    const stateDbPath = ":memory:";
    const firstStep = createStep({
      stepId: "intent",
      role: "implement",
      branchName: "intent-title-retry",
      specPath: "spec/index.md",
    });
    const retryStep = createStep({
      stepId: "intent",
      role: "implement",
      branchName: "intent-title-retry",
      specPath: "spec/index.md",
    });
    const titles: unknown[] = [];
    const store = openStateStore(stateDbPath);
    const jarvisRoot = firstStep.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");

    mkdirSync(join(jarvisRoot, "worktrees", "demo", "intent-title-retry", "spec"), { recursive: true });
    writeFileSync(
      join(jarvisRoot, "worktrees", "demo", "intent-title-retry", "spec", "index.md"),
      "# Workflow title\n",
      "utf8",
    );

    try {
      const first = await executeWorkflow({
        steps: [firstStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          throw new Error("publish failed");
        },
      });
      expect(first.kind).toBe("completion_commit_failed");

      const retried = await executeWorkflow({
        steps: [retryStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(retried.kind).toBe("complete");
      expect(titles).toEqual(["Workflow title", "Workflow title"]);
    } finally {
      store.close();
    }
  });

  test("publishes a supplied title after a reviewed workflow completes", async () => {
    const writeStep = createStep({
      stepId: "intent",
      role: "implement",
      branchName: "reviewed-intent-title",
      creationTitle: "intent: reviewed-seed",
    });
    const reviewStep: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "reviewed-intent-title",
      cwd: "/fake",
      prompt: "review",
      verdictPath: join(mkdtempSync(join(tmpdir(), "workflow-review-title-")), "verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: {
        claude: { critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] } },
        codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
      },
      createBinding: ({ agentId, adapterModel }) => ({
        id: `${agentId}/${adapterModel}`,
        metadata: { agent: agentId, model: adapterModel },
        invoke: async () => ({ kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" }),
      }),
    };
    const titles: unknown[] = [];

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [writeStep, reviewStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(titles).toEqual(["intent: reviewed-seed"]);
    });
  });

  test("publishes intent-run body summary from the landed durable dir", async () => {
    const invocationId = "intent-body-summary-inv";
    const summaries: Array<string | undefined> = [];
    const { workspace, withExternalWorktree } = createIntentWorktreeHarness("intent-body-summary");
    const baseStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "intent-body-summary",
      specPath: "ready-intents",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId,
        baseRef: "none",
      },
      creationTitle: "intent: seed-subject",
      workflowInvocationId: invocationId,
      withExternalWorktree,
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const step: WriteWorkflowStep = {
      ...baseStep,
      worktree: { ...baseStep.worktree, git: false, localPath: workspace },
    };

    await withStateStore(async (store) => {
      seedLandedIntentFiles(workspace, invocationId, ["alpha.md", "beta.md"]);
      seedCompletedWriteRun(store, step, workspace, invocationId);

      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(summaries).toEqual(["intent: seed-subject\n- alpha.md\n- beta.md"]);
    });
  });

  test("re-derives the same intent-run body summary on completion-publication retry", async () => {
    const invocationId = "intent-body-summary-retry";
    const summaries: Array<string | undefined> = [];
    const { workspace, withExternalWorktree } = createIntentWorktreeHarness("intent-body-summary-retry");
    const baseStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "intent-body-summary-retry",
      specPath: "ready-intents",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId,
        baseRef: "none",
      },
      creationTitle: "intent: seed-subject",
      workflowInvocationId: invocationId,
      withExternalWorktree,
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const step: WriteWorkflowStep = {
      ...baseStep,
      worktree: { ...baseStep.worktree, git: false, localPath: workspace },
    };

    await withStateStore(async (store) => {
      seedLandedIntentFiles(workspace, invocationId, ["one.md"]);
      seedCompletedWriteRun(store, step, workspace, invocationId);

      const failed = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          throw new Error("publish failed");
        },
      });
      expect(failed.kind).toBe("completion_commit_failed");

      const retried = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(retried.kind).toBe("complete");
      expect(summaries).toEqual(["intent: seed-subject\n- one.md", "intent: seed-subject\n- one.md"]);
    });
  });

  test("publishes reviewed-intent body summary after review-last landing", async () => {
    const { workspace, withExternalWorktree } = createIntentWorktreeHarness("reviewed-intent-body-summary");
    const invocationId = "reviewed-intent-body-summary";
    const summaries: Array<string | undefined> = [];
    const baseWriteStep = createStep({
      stepId: "intent",
      role: "plan",
      branchName: "reviewed-intent-body-summary",
      specPath: "ready-intents",
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId,
        baseRef: "none",
      },
      creationTitle: "intent: reviewed-seed",
      workflowInvocationId: invocationId,
      withExternalWorktree,
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const writeStep: WriteWorkflowStep = {
      ...baseWriteStep,
      worktree: { ...baseWriteStep.worktree, git: false, localPath: workspace },
    };
    const reviewStep: ReviewWorkflowStep = {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "reviewed-intent-body-summary",
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
        stagingDir: join(workspace, ".jarvis-intent-stage"),
        invocationId,
        baseRef: "HEAD",
      },
      createBinding: ({ agentId }) => ({
        id: agentId,
        metadata: { agent: agentId, model: agentId },
        invoke: async () => ({ kind: "ok" as const, stdout: agentId === "claude" ? "apply" : "done", stderr: "" }),
      }),
    };

    await withStateStore(async (store) => {
      seedLandedIntentFiles(workspace, invocationId, ["reviewed.md"]);
      seedCompletedWriteRun(store, writeStep, workspace, invocationId);
      const reviewRunId = store.createRun({
        project: "demo",
        specRef: "",
        worktreePath: workspace,
        branch: "reviewed-intent-body-summary",
        specPath: "",
        stepId: "review",
      });
      const reviewAttemptId = store.recordAttemptStart(reviewRunId);
      store.commitCompletionBoundary({
        attemptId: reviewAttemptId,
        runStatus: "completed",
        outcomeKind: "done",
        completionAgent: "codex",
      });

      const result = await executeWorkflow({
        steps: [writeStep, reviewStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(summaries).toEqual(["intent: reviewed-seed\n- reviewed.md"]);
    });
  });

  test("plan workflow publishes draft PR with index.md H1 as title", async () => {
    const step = createStep({
      stepId: "plan",
      role: "plan",
      branchName: "plan-title-test",
      specPath: "spec/2026-01-01T00-00-00Z-test-plan/index.md",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const titles: unknown[] = [];
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");

    mkdirSync(join(jarvisRoot, "worktrees", "demo", "plan-title-test", "spec", "2026-01-01T00-00-00Z-test-plan"), {
      recursive: true,
    });
    writeFileSync(
      join(jarvisRoot, "worktrees", "demo", "plan-title-test", "spec", "2026-01-01T00-00-00Z-test-plan", "index.md"),
      "# My feature plan\n\nContent here.",
      "utf8",
    );

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(titles).toEqual(["My feature plan"]);
    });
  });

  test("plan workflow with a bare spec-directory specPath publishes index.md H1 as title", async () => {
    // plan-workflow-steps.ts sets specPath to the spec directory itself, not a path ending in index.md.
    const step = createStep({
      stepId: "plan",
      role: "plan",
      branchName: "plan-title-dir-test",
      specPath: "spec/2026-01-01T00-00-00Z-test-plan-dir",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const titles: unknown[] = [];
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");

    mkdirSync(
      join(jarvisRoot, "worktrees", "demo", "plan-title-dir-test", "spec", "2026-01-01T00-00-00Z-test-plan-dir"),
      {
        recursive: true,
      },
    );
    writeFileSync(
      join(
        jarvisRoot,
        "worktrees",
        "demo",
        "plan-title-dir-test",
        "spec",
        "2026-01-01T00-00-00Z-test-plan-dir",
        "index.md",
      ),
      "# My directory-sourced plan\n\nContent here.",
      "utf8",
    );

    await withStateStore(async (store) => {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(titles).toEqual(["My directory-sourced plan"]);
    });
  });

  test("plan workflow retry retains original index.md H1 title when index cannot be re-read", async () => {
    const stateDbPath = ":memory:";
    const firstStep = createStep({
      stepId: "plan",
      role: "plan",
      branchName: "plan-title-retry",
      specPath: "spec/2026-01-01T00-00-00Z-test-retry/index.md",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const retryStep = createStep({
      stepId: "plan",
      role: "plan",
      branchName: "plan-title-retry",
      specPath: "spec/2026-01-01T00-00-00Z-test-retry/index.md",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const titles: unknown[] = [];
    const store = openStateStore(stateDbPath);
    const jarvisRoot = firstStep.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");

    mkdirSync(join(jarvisRoot, "worktrees", "demo", "plan-title-retry", "spec", "2026-01-01T00-00-00Z-test-retry"), {
      recursive: true,
    });
    writeFileSync(
      join(jarvisRoot, "worktrees", "demo", "plan-title-retry", "spec", "2026-01-01T00-00-00Z-test-retry", "index.md"),
      "# Plan for retry test\n\nContent.",
      "utf8",
    );

    try {
      const first = await executeWorkflow({
        steps: [firstStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          throw new Error("publish failed");
        },
      });
      expect(first.kind).toBe("completion_commit_failed");

      // Delete the index.md so it cannot be re-read on retry
      const indexPath = join(
        jarvisRoot,
        "worktrees",
        "demo",
        "plan-title-retry",
        "spec",
        "2026-01-01T00-00-00Z-test-retry",
        "index.md",
      );
      const fs = await import("node:fs");
      fs.unlinkSync(indexPath);

      const retried = await executeWorkflow({
        steps: [retryStep],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          titles.push(input.creationTitle);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(retried.kind).toBe("complete");
      expect(titles).toEqual(["Plan for retry test", "Plan for retry test"]);
    } finally {
      store.close();
    }
  });

  test("publishes spec-run body summary from index.md H1 and checklist", async () => {
    const summaries: Array<string | undefined> = [];
    const step = createStep({
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      branchName: "plan-body-summary",
      specPath: "spec/2026-01-01T00-00-00Z-plan-body",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");
    const worktreePath = join(jarvisRoot, "worktrees", "demo", "plan-body-summary");

    const specDir = join(worktreePath, "spec", "2026-01-01T00-00-00Z-plan-body");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, "index.md"),
      "# Plan body summary\n\n- [ ] [00 - First](./00-first.md)\n- [x] [01 - Second](./01-second.md)\n",
      "utf8",
    );

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, worktreePath, "plan-body-summary-inv");
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result.kind).toBe("complete");
      expect(summaries).toEqual(["## Subspecs\n- 00 - First\n- 01 - Second"]);
    });
  });

  test("re-derives the same spec-run body summary on completion-publication retry", async () => {
    const summaries: Array<string | undefined> = [];
    const step = createStep({
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      branchName: "plan-body-summary-retry",
      specPath: "spec/2026-01-01T00-00-00Z-plan-retry",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");
    const worktreePath = join(jarvisRoot, "worktrees", "demo", "plan-body-summary-retry");
    const specDir = join(worktreePath, "spec", "2026-01-01T00-00-00Z-plan-retry");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# Retry plan\n\n- [ ] [00 - Only](./00-only.md)\n", "utf8");

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, worktreePath, "plan-body-summary-retry-inv");

      const failed = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          throw new Error("publish failed");
        },
      });
      expect(failed.kind).toBe("completion_commit_failed");

      const retried = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(retried.kind).toBe("complete");
      expect(summaries).toEqual(["## Subspecs\n- 00 - Only", "## Subspecs\n- 00 - Only"]);
    });
  });

  test("refreshes spec-run body summary when index checklist changes", async () => {
    const summaries: Array<string | undefined> = [];
    const step = createStep({
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      branchName: "plan-body-summary-refresh",
      specPath: "spec/2026-01-01T00-00-00Z-plan-refresh",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");
    const worktreePath = join(jarvisRoot, "worktrees", "demo", "plan-body-summary-refresh");
    const indexPath = join(worktreePath, "spec", "2026-01-01T00-00-00Z-plan-refresh", "index.md");
    mkdirSync(join(worktreePath, "spec", "2026-01-01T00-00-00Z-plan-refresh"), { recursive: true });
    writeFileSync(indexPath, "# Refresh plan\n\n- [ ] [00 - Alpha](./00-alpha.md)\n", "utf8");

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, worktreePath, "plan-body-summary-refresh-inv");

      await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          throw new Error("publish failed");
        },
      });

      writeFileSync(
        indexPath,
        "# Refresh plan\n\n- [ ] [00 - Alpha](./00-alpha.md)\n- [ ] [01 - Beta](./01-beta.md)\n",
        "utf8",
      );

      const retried = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(retried.kind).toBe("complete");
      expect(summaries).toEqual(["## Subspecs\n- 00 - Alpha", "## Subspecs\n- 00 - Alpha\n- 01 - Beta"]);
    });
  });

  test("publishes H1-only spec-run summary when index has no checklist items", async () => {
    const summaries: Array<string | undefined> = [];
    const step = createStep({
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      branchName: "plan-body-summary-h1-only",
      specPath: "spec/2026-01-01T00-00-00Z-plan-h1",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");
    const worktreePath = join(jarvisRoot, "worktrees", "demo", "plan-body-summary-h1-only");
    const specDir = join(worktreePath, "spec", "2026-01-01T00-00-00Z-plan-h1");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, "index.md"), "# H1 only plan\n\nDraft prose.\n", "utf8");

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, worktreePath, "plan-body-summary-h1-only-inv");
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
      expect(summaries).toEqual(["(no content)"]);
    });
  });

  test("publishes no spec-run summary when index.md is missing", async () => {
    const summaries: Array<string | undefined> = [];
    const step = createStep({
      stepId: "plan",
      role: "plan",
      promptId: "plan.prompt.draft",
      branchName: "plan-body-summary-missing",
      specPath: "spec/2026-01-01T00-00-00Z-plan-missing",
      agentModelConfig: {
        claude: {
          plan: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
        },
      },
    });
    const jarvisRoot = step.worktree.jarvisRoot;
    if (jarvisRoot === undefined) throw new Error("missing test jarvis root");
    const worktreePath = join(jarvisRoot, "worktrees", "demo", "plan-body-summary-missing");

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, worktreePath, "plan-body-summary-missing-inv");
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
      expect(summaries).toEqual(["(no content)"]);
    });
  });

  test("implement workflow completion publishes spec-run body summary", async () => {
    const summaries: Array<string | undefined> = [];
    const specTemplates: boolean[] = [];
    const { step, workspace } = createImplementBodySummaryStep("implement-body-summary");

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, workspace, "implement-body-summary-inv");
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          specTemplates.push(input.specTemplate === true);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");
      expect(specTemplates).toEqual([true]);
      const summary = summaries[0];
      expect(summary).toContain("## Subspecs");
      expect(summary).toContain("- 00 - First — Implement the feature.");
      expect(summary).toContain("## Commits");
      expect(summary).toContain("- add feature");
      expect(summary).toContain("## Risk cues\n- no test changes");
      expect(summary).toContain("## Change summary");
      expect(summary).toContain("v2/src");
    });
  });

  test("re-derives the same implement spec-run body summary on completion-publication retry", async () => {
    const summaries: Array<string | undefined> = [];
    const specTemplates: boolean[] = [];
    const { step, workspace } = createImplementBodySummaryStep("implement-body-summary-retry");

    await withStateStore(async (store) => {
      seedCompletedWriteRun(store, step, workspace, "implement-body-summary-retry-inv");

      const failed = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          specTemplates.push(input.specTemplate === true);
          throw new Error("publish failed");
        },
      });
      expect(failed.kind).toBe("completion_commit_failed");

      const retried = await executeWorkflow({
        steps: [step],
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async (input) => {
          summaries.push(input.bodySummary);
          specTemplates.push(input.specTemplate === true);
          return {};
        },
        readyFinalizer: async () => {},
      });
      expect(retried.kind).toBe("complete");
      expect(specTemplates).toEqual([true, true]);
      expect(summaries[0]).toBe(summaries[1]);
    });
  });
});

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
    maxCycles?: number;
  }): ReviewDebateWorkflowStep {
    return {
      behavior: "review-debate",
      stepId: "implement-review",
      project: "demo",
      branch: args.branchName,
      cwd: args.cwd,
      prompts: {
        adversary: "patch.prompt.review.adversary",
        advocate: "patch.prompt.review.advocate",
        adjudicator: "patch.prompt.review.adjudicator",
      },
      verdictPath: args.verdictPath,
      maxCycles: args.maxCycles ?? 1,
      agents: { adversary: ["claude"], advocate: ["claude"], adjudicator: ["claude"], actuator: ["claude"] },
      agentModelConfig: DEBATE_AGENT_MODEL_CONFIG,
      profile: implementReviewPromptProfile,
      profileContext: { specPath: "index.md", cwd: args.cwd, baseBranch: "HEAD", passNumber: 1, totalPasses: 1 },
      ...(args.roleTimeoutMs !== undefined ? { roleTimeoutMs: args.roleTimeoutMs } : {}),
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
      prompt: "patch.prompt.review.critic",
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
      prompt: "patch.prompt.review.critic",
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
});

describe("executeWorkflow review dispatch", () => {
  const config: AgentModelConfig = {
    claude: { critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] } },
    codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
  };

  function stageReviewedIntent(workspace: string): void {
    const stage = join(workspace, ".jarvis-intent-stage");
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "existing.md"), "---\nname: existing\n---\n\n## Prerequisites\n", "utf8");
  }

  function reviewedIntentStep(workspace: string, overrides: Partial<ReviewWorkflowStep> = {}): ReviewWorkflowStep {
    return {
      behavior: "review",
      stepId: "review",
      project: "demo",
      branch: "intent/review",
      cwd: workspace,
      prompt: "inspect",
      verdictPath: join(workspace, ".jarvis-intent-review-verdict.md"),
      maxCycles: 1,
      agents: { critic: ["claude"], actuator: ["codex"] },
      agentModelConfig: config,
      landing: {
        kind: "intent-stage",
        output: { durableDir: "ready-intents" },
        stagingDir: ".jarvis-intent-stage",
        invocationId: "invocation-1",
        baseRef: "none",
      },
      ...overrides,
    };
  }

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
});

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

  test("lands a reviewed light plan tree with its final verdict", async () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-reviewed-plan-landing-"));
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed");
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "index.md"), "# Index", "utf8");
    writeFileSync(join(stage, "intent.md"), "Intent", "utf8");
    writeFileSync(join(stage, "01-test.md"), "# Before", "utf8");
    const step = reviewedPlanLandingStep(root, stage, durable, "plan-reviewed-landing", async (agentId) => {
      if (agentId === "codex") writeFileSync(join(stage, "01-test.md"), "# After review", "utf8");
      return { kind: "ok", stdout: agentId === "claude" ? "Apply edit" : "done", stderr: "" };
    });

    await withStateStore(async (store) => {
      expect(await executeWorkflow({ steps: [step], stateStore: store })).toMatchObject({ kind: "complete" });
    });

    expect(existsSync(stage)).toBe(false);
    expect(existsSync(join(durable, "index.md"))).toBe(true);
    expect(existsSync(join(durable, "intent.md"))).toBe(true);
    expect(readFileSync(join(durable, "01-test.md"), "utf8")).toBe("# After review");
    expect(readFileSync(join(durable, "verdict-plan.md"), "utf8")).toBe("Apply edit");
  });

  test("retains the staged plan and verdict when deferred landing fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-reviewed-plan-landing-failure-"));
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed");
    mkdirSync(stage, { recursive: true });
    mkdirSync(durable, { recursive: true });
    writeFileSync(join(stage, "index.md"), "# Index", "utf8");
    writeFileSync(join(stage, "intent.md"), "Intent", "utf8");
    writeFileSync(join(stage, "01-test.md"), "# Staged", "utf8");
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
    expect(readFileSync(join(durable, "verdict-plan.md"), "utf8")).toBe("Keep verdict");
    expect(criticCalls).toBe(1);
  });

  test("fresh plan review dispatches do not reuse a completed landing checkpoint", async () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-reviewed-plan-fresh-"));
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed");
    let criticCalls = 0;
    const stagePlan = () => {
      mkdirSync(stage, { recursive: true });
      writeFileSync(join(stage, "index.md"), "# Index", "utf8");
      writeFileSync(join(stage, "intent.md"), "Intent", "utf8");
      writeFileSync(join(stage, "01-test.md"), "# Test", "utf8");
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
      mkdirSync(stage, { recursive: true });
      writeFileSync(join(stage, "index.md"), "# Index", "utf8");
      writeFileSync(join(stage, "intent.md"), "Intent", "utf8");
      writeFileSync(join(stage, "01-test.md"), "# Test", "utf8");
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

  test("lands a reviewed debate plan tree with its final empty verdict", async () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-reviewed-plan-debate-landing-"));
    roots.push(root);
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed-debate");
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "index.md"), "# Index", "utf8");
    writeFileSync(join(stage, "intent.md"), "Intent", "utf8");
    writeFileSync(join(stage, "01-test.md"), "# Before", "utf8");
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
    expect(readFileSync(join(durable, "01-test.md"), "utf8")).toBe("# Before");
    expect(readFileSync(join(durable, "verdict-plan.md"), "utf8")).toBe("");
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
      const intentContent = "---\nname: default-plan\n---\n\n## Prerequisites\n\n- none\n";
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
          writeFileSync(join(stage, "index.md"), "# Index\n", "utf8");
          writeFileSync(join(stage, "intent.md"), intentContent, "utf8");
          writeFileSync(join(stage, "00-first.md"), "# First\n", "utf8");
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

  test("retains the staged plan and verdict when a review-debate deferred landing fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-reviewed-plan-debate-landing-failure-"));
    roots.push(root);
    const stage = join(root, ".jarvis-plan-stage");
    const durable = join(root, "spec", "2026-reviewed-debate");
    mkdirSync(stage, { recursive: true });
    mkdirSync(durable, { recursive: true });
    writeFileSync(join(stage, "index.md"), "# Index", "utf8");
    writeFileSync(join(stage, "intent.md"), "Intent", "utf8");
    writeFileSync(join(stage, "01-test.md"), "# Staged", "utf8");
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
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "index.md"), "# Index", "utf8");
    writeFileSync(join(stage, "intent.md"), "Intent", "utf8");
    writeFileSync(join(stage, "01-test.md"), "# Before", "utf8");
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

    const debateStep = createDebateStep({
      stepId: "review-debate",
      branch: "reviewed-plan-debate-defer",
      cwd: workspace,
      verdictPath,
      landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: reviewDurable },
      createBinding: createDebateBindingFactory(async ({ adapterModel }) => {
        if (adapterModel === "ACT") writeFileSync(join(stage, "01-test.md"), "# After review", "utf8");
        return { kind: "ok", stdout: adapterModel === "ADJ" ? "apply this fix" : "ok", stderr: "" } as const;
      }),
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [writeStep, debateStep], stateStore: store });
      expect(result).toMatchObject({ kind: "complete" });
    });

    // Only the review step's deferred landing ran; the write step's landing was never eager-applied.
    expect(existsSync(stage)).toBe(false);
    expect(readFileSync(join(reviewDurable, "01-test.md"), "utf8")).toBe("# After review");
    expect(readFileSync(join(reviewDurable, "verdict-plan.md"), "utf8")).toBe("apply this fix");
    expect(existsSync(writeDurable)).toBe(false);
  });
});

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
