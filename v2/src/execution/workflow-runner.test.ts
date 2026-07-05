import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding, InvocationResult } from "../../../shared/invocation/execute.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import {
  defineWorkflowStep,
  executeWorkflow,
  resolveWorkflowPreset,
  type HumanWorkflowStep,
  type WorkflowStepInput,
  type WriteWorkflowStep,
} from "./workflow-runner.ts";

const { roots } = trackedTempRoots();
const DEFAULT_AGENT_MODEL_CONFIG = {
  claude: {
    implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
  },
};
const TWO_AGENTS = ["claude", "codex"] as const;
const VALID_TWO_AGENT_CONFIG: AgentModelConfig = {
  claude: { implement: { rungs: [{ adapterModel: "claude-implement", priceKey: "claude-implement" }] } },
  codex: { implement: { rungs: [{ adapterModel: "codex-implement", priceKey: "codex-implement" }] } },
};
const MISSING_CODEX_IMPLEMENT_CONFIG: AgentModelConfig = {
  claude: { implement: { rungs: [{ adapterModel: "claude-implement", priceKey: "claude-implement" }] } },
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

function quotaUntilDoneBindingFactory(invocations: string[]) {
  return createBindingFactory(async ({ agentId, adapterModel, cwd }) => {
    invocations.push(`${agentId}/${adapterModel}`);
    if (adapterModel === "M1" || adapterModel === "M2") {
      return { kind: "quota", stderr: "quota" } as const;
    }
    writeFileSync(`${cwd}/proof.txt`, "ok\n", "utf8");
    return { kind: "ok", stdout: "done", stderr: "" } as const;
  });
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

describe("defineWorkflowStep", () => {
  test("builds a workflow step and preserves loop-control fields", () => {
    const signal = new AbortController().signal;
    const pauseSignal = new AbortController().signal;

    const step = defineWorkflowStep(
      createStepInput({
        stepId: "step-1",
        role: "implement",
        maxIterations: 3,
        signal,
        pauseSignal,
      }),
    );

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

  test("runs single step to completion", async () => {
    const step = createStep({ stepId: "step-1", role: "implement" });
    const store = openStateStore(":memory:");

    try {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
      });

      expect(result.kind).toBe("complete");
      expect(result.stepIndex).toBe(0);
      expect(result.stepId).toBe("step-1");
      expect(result.iterationsConsumed).toBeGreaterThan(0);
      expect(result.resumable).toBe(false);

      // One-step equivalence: runId matches the step's actual run, not empty
      const run = store.findRunByProjectBranch({
        project: "demo",
        branch: "workflow-run",
        stepId: "step-1",
      });
      expect(result.runId).toBe(run?.id ?? "");
      expect(result.runId).not.toBe("");
    } finally {
      store.close();
    }
  });

  test("runs two-step workflow to completion", async () => {
    const store = openStateStore(":memory:");
    const steps = resolveWorkflowPreset("write-write", [
      createStep({ stepId: "step-1", role: "implement", branchName: "two-step" }),
      createStep({ stepId: "step-2", role: "implement", branchName: "two-step" }),
    ]);

    try {
      const result = await executeWorkflow({
        steps,
        stateStore: store,
      });

      expect(result.kind).toBe("complete");
      expect(result.stepIndex).toBe(1);
      expect(result.stepId).toBe("step-2");

      // Verify each step has independent attempt history
      const run1 = store.findRunByProjectBranch({
        project: "demo",
        branch: "two-step",
        stepId: "step-1",
      });
      const run2 = store.findRunByProjectBranch({
        project: "demo",
        branch: "two-step",
        stepId: "step-2",
      });

      expect(run1).not.toBeNull();
      expect(run2).not.toBeNull();
      expect(run1?.id).not.toBe(run2?.id);
      expect(run1?.status).toBe("completed");
      expect(run2?.status).toBe("completed");
    } finally {
      store.close();
    }
  });

  test("runs the write-write preset end to end with per-step resolution, ordered advancement, fallback, and separate durable history", async () => {
    const store = openStateStore(":memory:");
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
      },
      codex: {
        implement: {
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

    try {
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
    } finally {
      store.close();
    }
  });

  test("stops workflow when step ends blocked", async () => {
    const store = openStateStore(":memory:");
    const step1 = createStep({ stepId: "step-1", role: "implement", branchName: "blocked-run" });
    const step2 = createStep({
      stepId: "step-2",
      role: "implement",
      branchName: "blocked-run",
      createBinding: okTokenBindingFactory("blocked"),
    });

    try {
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
    } finally {
      store.close();
    }
  });

  test("stops workflow on invocation_failure", async () => {
    const store = openStateStore(":memory:");
    const step1 = createStep({ stepId: "step-1", role: "implement", branchName: "failure-run" });
    const step2 = createStep({
      stepId: "step-2",
      role: "implement",
      branchName: "failure-run",
      createBinding: errorBindingFactory,
    });

    try {
      const result = await executeWorkflow({
        steps: [step1, step2],
        stateStore: store,
      });

      expect(result.kind).toBe("invocation_failure");
      expect(result.stepIndex).toBe(1);
      expect(result.stepId).toBe("step-2");
    } finally {
      store.close();
    }
  });

  test("stops workflow on soft-stop (budget-exhausted)", async () => {
    const store = openStateStore(":memory:");
    const step1 = createStep({ stepId: "step-1", role: "implement", branchName: "budget-run", maxIterations: 1 });
    const step2 = createStep({
      stepId: "step-2",
      role: "implement",
      branchName: "budget-run",
      createBinding: okTokenBindingFactory("progress"),
      maxIterations: 1,
    });

    try {
      const result = await executeWorkflow({
        steps: [step1, step2],
        stateStore: store,
      });

      expect(result.kind).toBe("budget-exhausted");
      expect(result.stepIndex).toBe(1);
      expect(result.stepId).toBe("step-2");
    } finally {
      store.close();
    }
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
    const store = openStateStore(":memory:");

    const step1 = createStep({ stepId: "step-1", role: "implement", branchName: "history-test" });
    const step2 = createStep({ stepId: "step-2", role: "implement", branchName: "history-test" });

    try {
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
      expect(run1?.workflowSnapshot?.steps).toEqual([
        { stepId: "step-1", role: "implement" },
        { stepId: "step-2", role: "implement" },
      ]);
    } finally {
      store.close();
    }
  });

  test("workflow-step execution reaches shared invocation with resolver-produced implement bindings", async () => {
    const store = openStateStore(":memory:");
    const invocations: string[] = [];
    const step = createStep({
      stepId: "step-1",
      role: "implement",
      branchName: "binding-order",
      agents: ["claude", "codex"],
      agentModelConfig: {
        claude: {
          implement: {
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
        },
      },
      createBinding: quotaUntilDoneBindingFactory(invocations),
    });

    try {
      const result = await executeWorkflow({
        steps: [step],
        stateStore: store,
      });

      expect(result.kind).toBe("complete");
      expect(invocations).toEqual(["claude/M1", "claude/M2", "codex/M3"]);
    } finally {
      store.close();
    }
  });

  test("workflow-step execution with empty agents returns no_binding", async () => {
    const store = openStateStore(":memory:");
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

    try {
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
    } finally {
      store.close();
    }
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

describe("executeWorkflow human steps", () => {
  test("converges to awaiting-human without running a write loop", async () => {
    const store = openStateStore(":memory:");
    const writeStep = createStep({ stepId: "step-1", role: "implement", branchName: "human-workflow" });
    const humanStep = createHumanStep({ stepId: "step-2" });

    try {
      const result = await executeWorkflow({ steps: [writeStep, humanStep], stateStore: store });

      expect(result.kind).toBe("awaiting-human");
      expect(result.stepIndex).toBe(1);
      expect(result.stepId).toBe("step-2");
      expect(result.resumable).toBe(false);

      const run = store.findRunByProjectBranch({ project: "demo", branch: "human-workflow", stepId: "step-2" });
      expect(run?.status).toBe("awaiting-human");
      expect(run?.attempts).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("appends no ## Blocker section to a prior step's spec on reaching a human step", async () => {
    const store = openStateStore(":memory:");
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

    try {
      await executeWorkflow({ steps: [writeStep, humanStep], stateStore: store });

      const specPath = join(home.jarvisRoot, "worktrees", "demo", "human-no-blocker", "spec.md");
      expect(readFileSync(specPath, "utf8")).not.toContain("## Blocker");
    } finally {
      store.close();
    }
  });

  test("a completed human step advances the workflow", async () => {
    const store = openStateStore(":memory:");
    const writeStep = createStep({ stepId: "step-1", role: "implement", branchName: "human-advance" });
    const humanStep = createHumanStep({ stepId: "step-2", branch: "human-advance" });
    const finalStep = createStep({ stepId: "step-3", role: "implement", branchName: "human-advance" });

    try {
      const firstResult = await executeWorkflow({ steps: [writeStep, humanStep, finalStep], stateStore: store });
      expect(firstResult.kind).toBe("awaiting-human");

      store.setRunStatus(firstResult.runId, "completed");

      const secondResult = await executeWorkflow({ steps: [writeStep, humanStep, finalStep], stateStore: store });
      expect(secondResult.kind).toBe("complete");
      expect(secondResult.stepIndex).toBe(2);
      expect(secondResult.stepId).toBe("step-3");
    } finally {
      store.close();
    }
  });
});

describe("defineWorkflowStep human steps", () => {
  test("accepts a human-behavior input and returns the corresponding step shape", () => {
    const step = defineWorkflowStep(createHumanStep({ stepId: "gate-1" }));

    expect(step.behavior).toBe("human");
    expect(step.stepId).toBe("gate-1");
  });
});

describe("executeWorkflow load-time role validation", () => {
  test("rejects a role absent from loaded config as aggregated per-agent misses before durable state change", async () => {
    const step = createStep({
      stepId: "step-1",
      role: "unknown-role",
      agents: TWO_AGENTS,
      agentModelConfig: NO_STEP_ROLES_CONFIG,
    });
    const store = openStateStore(":memory:");

    try {
      try {
        await executeWorkflow({ steps: [step], stateStore: store });
        expect.unreachable("Should have thrown");
      } catch (e) {
        const message = String(e);
        expect(message).toContain("(step-1, unknown-role, claude)");
        expect(message).toContain("(step-1, unknown-role, codex)");
      }

      const run = store.findRunByProjectBranch({ project: "demo", branch: "workflow-run", stepId: "step-1" });
      expect(run).toBeNull();
    } finally {
      store.close();
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

  test("aggregates multiple missing step-role-agent bindings in one load failure", async () => {
    const step1 = createStep({
      stepId: "step-1",
      role: "implement",
      branchName: "aggregate-misses",
      agents: TWO_AGENTS,
      agentModelConfig: MISSING_CODEX_IMPLEMENT_CONFIG,
    });
    const step2 = createStep({
      stepId: "step-2",
      role: "unknown-role",
      branchName: "aggregate-misses",
      agents: TWO_AGENTS,
      agentModelConfig: NO_STEP_ROLES_CONFIG,
    });

    try {
      await executeWorkflow({ steps: [step1, step2] });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const message = String(e);
      expect(message).toContain("(step-1, implement, codex)");
      expect(message).toContain("(step-2, unknown-role, claude)");
      expect(message).toContain("(step-2, unknown-role, codex)");
    }
  });

  test("fails workflow load when an earlier agent has the role and a later fallback agent does not", async () => {
    const step = createStep({
      stepId: "step-1",
      role: "implement",
      agents: TWO_AGENTS,
      agentModelConfig: MISSING_CODEX_IMPLEMENT_CONFIG,
    });

    try {
      await executeWorkflow({ steps: [step] });
      expect.unreachable("Should have thrown");
    } catch (e) {
      const message = String(e);
      expect(message).toContain("(step-1, implement, codex)");
      expect(message).not.toContain("(step-1, implement, claude)");
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

    await expect(executeWorkflow({ steps: [writeStep, humanStep] })).rejects.toThrow(
      "(step-2, no-such-step)",
    );
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
    const store = openStateStore(":memory:");
    const writeStep = createStep({ stepId: "step-1", role: "implement", branchName: "on-revise-valid" });
    const humanStep = createHumanStep({
      stepId: "step-2",
      branch: "on-revise-valid",
      onRevise: { repeatStepId: "step-1", maxRevisions: 1 },
    });

    try {
      const result = await executeWorkflow({ steps: [writeStep, humanStep], stateStore: store });
      expect(result.kind).toBe("awaiting-human");
    } finally {
      store.close();
    }
  });
});

describe("executeWorkflow revising re-convergence", () => {
  test("stays revising until the revision run reaches a terminal outcome, then re-converges to awaiting-human", async () => {
    const store = openStateStore(":memory:");
    const writeStep = createStep({ stepId: "step-1", role: "implement", branchName: "revising-workflow" });
    const humanStep = createHumanStep({
      stepId: "step-2",
      branch: "revising-workflow",
      onRevise: { repeatStepId: "step-1", maxRevisions: 2 },
    });

    try {
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
    } finally {
      store.close();
    }
  });
});
