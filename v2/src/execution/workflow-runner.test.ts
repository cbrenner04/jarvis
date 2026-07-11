import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  InvocationBinding,
  InvocationCompletedRecord,
  InvocationResult,
} from "../../../shared/invocation/execute.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { openStateStore } from "../persistence/state-store.ts";
import {
  createFakeWithExternalWorktree,
  createJarvisHome,
  trackedTempRoots,
  withStateStore,
} from "../testing/write-fixtures.ts";
import type { WorkBoundaryRecordedRecord } from "./work-boundary-telemetry.ts";
import {
  executeWorkflow,
  type HumanWorkflowStep,
  type ReviewDebateWorkflowStep,
  type ReviewWorkflowStep,
  resolveWorkflowPreset,
  type WorkflowStepInput,
  type WriteWorkflowStep,
} from "./workflow-runner.ts";

const { roots } = trackedTempRoots();
const DEFAULT_AGENT_MODEL_CONFIG = {
  claude: {
    implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
    shrink: { rungs: [{ adapterModel: "S1", priceKey: "S1" }] },
  },
};
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
  return createBindingFactory(async () => ({ kind: "ok", stdout, stderr: "" }) as const);
}

const errorBindingFactory = createBindingFactory(
  async () => ({ kind: "error", exitCode: 1, stderr: "error" }) as const,
);

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

  test("throws on wrong implement preset step count", () => {
    expect(() =>
      resolveWorkflowPreset("implement", [
        createStep({ stepId: "step-1", role: "implement" }),
        createStep({ stepId: "step-2", role: "implement" }),
      ]),
    ).toThrow('Workflow preset "implement" requires 1 steps, received 2');
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
    const step1 = createStep({ stepId: "step-1", role: "implement", branchName: "history-test" });
    const step2 = createStep({ stepId: "step-2", role: "implement", branchName: "history-test" });

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
      };
      expect(run1?.workflowSnapshot?.steps).toEqual([
        { stepId: "step-1", role: "implement", ...stepConfig },
        { stepId: "step-2", role: "implement", ...stepConfig },
      ]);
    });
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

function createHumanStep(overrides: Partial<HumanWorkflowStep> & { stepId: string }): HumanWorkflowStep {
  return {
    behavior: "human",
    project: "demo",
    branch: "human-workflow",
    ...overrides,
  };
}

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

describe("executeWorkflow human steps", () => {
  test("converges to awaiting-human without running a write loop", async () => {
    const writeStep = createStep({ stepId: "step-1", role: "implement", branchName: "human-workflow" });
    const humanStep = createHumanStep({ stepId: "step-2" });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [writeStep, humanStep], stateStore: store });

      expect(result.kind).toBe("awaiting-human");
      expect(result.stepIndex).toBe(1);
      expect(result.stepId).toBe("step-2");
      expect(result.resumable).toBe(false);

      const run = store.findRunByProjectBranch({ project: "demo", branch: "human-workflow", stepId: "step-2" });
      expect(run?.status).toBe("awaiting-human");
      expect(run?.attempts).toHaveLength(0);
    });
  });

  test("appends no ## Blocker section to a prior step's spec on reaching a human step", async () => {
    const home = createJarvisHome();
    roots.push(home.jarvisRoot);
    const writeStep = {
      ...createStep({ stepId: "step-1", role: "implement", branchName: "human-no-blocker" }),
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName: "human-no-blocker",
        baseRef: "HEAD",
        jarvisRoot: home.jarvisRoot,
      },
      withExternalWorktree: createFakeWithExternalWorktree(home.jarvisRoot),
    };
    const humanStep = createHumanStep({ stepId: "step-2", branch: "human-no-blocker" });

    await withStateStore(async (store) => {
      await executeWorkflow({ steps: [writeStep, humanStep], stateStore: store });

      const specPath = join(home.jarvisRoot, "worktrees", "demo", "human-no-blocker", "spec.md");
      expect(readFileSync(specPath, "utf8")).not.toContain("## Blocker");
    });
  });

  test("a completed human step advances the workflow", async () => {
    const writeStep = createStep({ stepId: "step-1", role: "implement", branchName: "human-advance" });
    const humanStep = createHumanStep({ stepId: "step-2", branch: "human-advance" });
    const finalStep = createStep({ stepId: "step-3", role: "implement", branchName: "human-advance" });

    await withStateStore(async (store) => {
      const firstResult = await executeWorkflow({ steps: [writeStep, humanStep, finalStep], stateStore: store });
      expect(firstResult.kind).toBe("awaiting-human");

      store.setRunStatus(firstResult.runId, "completed");

      const secondResult = await executeWorkflow({ steps: [writeStep, humanStep, finalStep], stateStore: store });
      expect(secondResult.kind).toBe("complete");
      expect(secondResult.stepIndex).toBe(2);
      expect(secondResult.stepId).toBe("step-3");
    });
  });

  test("publishes after a completed human step with the prior shrink binding and write context", async () => {
    const writeStep = createStep({ stepId: "step-1", role: "implement", branchName: "human-publication" });
    const humanStep = createHumanStep({ stepId: "step-2", branch: "human-publication" });
    const published: Array<{ specPath: string; agent: string }> = [];

    await withStateStore(async (store) => {
      const first = await executeWorkflow({ steps: [writeStep, humanStep], stateStore: store });
      store.setRunStatus(first.runId, "completed");

      const result = await executeWorkflow({
        steps: [writeStep, humanStep],
        stateStore: store,
        completionCommitter: (input) => {
          published.push({ specPath: input.specPath, agent: input.agent });
          return { commitSha: "commit-1" };
        },
        completionPublisher: async () => {
          return {};
        },
        readyFinalizer: async () => {},
      });

      expect(result).toMatchObject({ kind: "complete", commitSha: "commit-1" });
      expect(published).toEqual([{ specPath: "spec.md", agent: "claude" }]);
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
    });
  });
});

describe("executeWorkflow review dispatch", () => {
  const config: AgentModelConfig = {
    claude: { critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] } },
    codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
  };

  test("resolves role orders independently and reports a fresh non-durable run", async () => {
    const calls: string[] = [];
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
      });

      expect(result).toMatchObject({ kind: "complete", resumable: false, iterationsConsumed: 1 });
      expect(calls).toEqual(["claude:inspect", "codex:fix"]);
      expect(fired).toHaveLength(1);
      expect(fired[0]).toMatchObject({ index: 0, runId: result.runId, durable: false });
      expect(store.listRuns()).toHaveLength(0);
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
});

describe("human step shape", () => {
  test("accepts a human-behavior input and returns the corresponding step shape", () => {
    const step = createHumanStep({ stepId: "gate-1" });

    expect(step.behavior).toBe("human");
    expect(step.stepId).toBe("gate-1");
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

describe("executeWorkflow onRevise validation", () => {
  test("rejects a missing repeatStepId", async () => {
    const writeStep = createStep({ stepId: "step-1", role: "implement", branchName: "on-revise-missing" });
    const humanStep = createHumanStep({
      stepId: "step-2",
      branch: "on-revise-missing",
      onRevise: { repeatStepId: "no-such-step", maxRevisions: 1 },
    });

    await expect(executeWorkflow({ steps: [writeStep, humanStep] })).rejects.toThrow("(step-2, no-such-step)");
  });

  test("rejects a self-referencing repeatStepId", async () => {
    const humanStep = createHumanStep({
      stepId: "step-1",
      branch: "on-revise-self",
      onRevise: { repeatStepId: "step-1", maxRevisions: 1 },
    });

    await expect(executeWorkflow({ steps: [humanStep] })).rejects.toThrow("(step-1, step-1)");
  });

  test("rejects a forward-referencing repeatStepId", async () => {
    const humanStep = createHumanStep({
      stepId: "step-1",
      branch: "on-revise-forward",
      onRevise: { repeatStepId: "step-2", maxRevisions: 1 },
    });
    const writeStep = createStep({ stepId: "step-2", role: "implement", branchName: "on-revise-forward" });

    await expect(executeWorkflow({ steps: [humanStep, writeStep] })).rejects.toThrow("(step-1, step-2)");
  });

  test("accepts a valid earlier repeatStepId", async () => {
    const writeStep = createStep({ stepId: "step-1", role: "implement", branchName: "on-revise-valid" });
    const humanStep = createHumanStep({
      stepId: "step-2",
      branch: "on-revise-valid",
      onRevise: { repeatStepId: "step-1", maxRevisions: 1 },
    });

    await withStateStore(async (store) => {
      const result = await executeWorkflow({ steps: [writeStep, humanStep], stateStore: store });
      expect(result.kind).toBe("awaiting-human");
    });
  });

  test("a changed onRevise config is not reused from a stale snapshot borrowed from an earlier step", async () => {
    const branchName = "on-revise-stale-snapshot";

    const step1First = createStep({ stepId: "step-1", role: "implement", branchName });
    const step2First = createStep({
      stepId: "step-2",
      role: "implement",
      branchName,
      createBinding: okTokenBindingFactory("progress"),
      maxIterations: 1,
    });
    const humanStepFirst = createHumanStep({
      stepId: "step-3",
      branch: branchName,
      onRevise: { repeatStepId: "step-1", maxRevisions: 1 },
    });

    await withStateStore(async (store) => {
      // step-2 soft-stops on budget, so step-3 (human) is never reached and never gets its own run row.
      const firstResult = await executeWorkflow({
        steps: [step1First, step2First, humanStepFirst],
        stateStore: store,
      });
      expect(firstResult.kind).toBe("budget-exhausted");
      expect(firstResult.stepIndex).toBe(1);
      const step1Run = store.findRunByProjectBranch({ project: "demo", branch: branchName, stepId: "step-1" });
      const originalInvocationId = step1Run?.workflowSnapshot?.invocationId;

      // Second invocation: step-2 now completes, step-3 is reached for the first time with a changed onRevise.
      const step1Second = createStep({ stepId: "step-1", role: "implement", branchName });
      const step2Second = createStep({ stepId: "step-2", role: "implement", branchName });
      const humanStepSecond = createHumanStep({
        stepId: "step-3",
        branch: branchName,
        onRevise: { repeatStepId: "step-1", maxRevisions: 7 },
      });

      const secondResult = await executeWorkflow({
        steps: [step1Second, step2Second, humanStepSecond],
        stateStore: store,
      });
      expect(secondResult.kind).toBe("awaiting-human");
      expect(secondResult.stepId).toBe("step-3");

      const step3Run = store.loadRun(secondResult.runId);
      expect(step3Run?.workflowSnapshot?.steps.find((step) => step.stepId === "step-3")?.onRevise?.maxRevisions).toBe(
        7,
      );
      expect(step3Run?.workflowSnapshot?.invocationId).not.toBe(originalInvocationId);
    });
  });
});

describe("executeWorkflow revising re-convergence", () => {
  test("stays revising until the revision run reaches a terminal outcome, then re-converges to awaiting-human", async () => {
    const writeStep = createStep({ stepId: "step-1", role: "implement", branchName: "revising-workflow" });
    const humanStep = createHumanStep({
      stepId: "step-2",
      branch: "revising-workflow",
      onRevise: { repeatStepId: "step-1", maxRevisions: 2 },
    });

    await withStateStore(async (store) => {
      const firstResult = await executeWorkflow({ steps: [writeStep, humanStep], stateStore: store });
      expect(firstResult.kind).toBe("awaiting-human");

      // Simulate a daemon-spawned revision write loop in flight.
      store.setRunStatus(firstResult.runId, "revising");
      const revisionRunId = store.createRun({
        project: "demo",
        specRef: "HEAD",
        worktreePath: "/fake",
        branch: "revising-workflow",
        specPath: "spec.md",
        stepId: "step-1~r1",
      });

      const stillRevising = await executeWorkflow({ steps: [writeStep, humanStep], stateStore: store });
      expect(stillRevising.kind).toBe("revising");
      expect(stillRevising.runId).toBe(firstResult.runId);

      store.setRunStatus(revisionRunId, "completed");

      const reconverged = await executeWorkflow({ steps: [writeStep, humanStep], stateStore: store });
      expect(reconverged.kind).toBe("awaiting-human");
      expect(reconverged.runId).toBe(firstResult.runId);

      const humanRun = store.loadRun(firstResult.runId);
      expect(humanRun?.status).toBe("awaiting-human");
    });
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
        completionCommitter: () => ({ commitSha: "wf-commit", filesChanged: 4 }),
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
});
