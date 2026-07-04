import { describe, expect, test } from "bun:test";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { openStateStore } from "../persistence/state-store.ts";
import { simulatedBindings } from "../testing/bindings.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { executeWorkflow, type WorkflowStep } from "./workflow-runner.ts";

const { roots } = trackedTempRoots();
const agents = ["claude", "codex"] as const;
const validAgentModelConfig: AgentModelConfig = {
  claude: { implement: { rungs: [{ adapterModel: "claude-implement", priceKey: "claude-implement" }] } },
  codex: { implement: { rungs: [{ adapterModel: "codex-implement", priceKey: "codex-implement" }] } },
};
const missingCodexImplementConfig: AgentModelConfig = {
  claude: { implement: { rungs: [{ adapterModel: "claude-implement", priceKey: "claude-implement" }] } },
  codex: {},
};
const noStepRolesConfig: AgentModelConfig = {
  claude: {},
  codex: {},
};

function createStep(
  overrides: Partial<Omit<WorkflowStep, "worktree">> & { stepId: string; role: string; branchName?: string },
): WorkflowStep {
  const home = createJarvisHome();
  roots.push(home.jarvisRoot);
  const { branchName, ...rest } = overrides;
  return {
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
    bindings: simulatedBindings(["done"], { artifactPath: "proof.txt", emitArtifact: true }),
    withExternalWorktree: createFakeWithExternalWorktree(home.jarvisRoot),
    ...rest,
  };
}

describe("executeWorkflow", () => {
  test("rejects empty steps array", async () => {
    try {
      await executeWorkflow({ steps: [], agents, agentModelConfig: validAgentModelConfig });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(String(e)).toContain("at least one step");
    }
  });

  test("rejects duplicate stepIds", async () => {
    const step1 = createStep({ stepId: "step-1", role: "implement" });
    const step2 = createStep({ stepId: "step-1", role: "implement" }); // duplicate

    try {
      await executeWorkflow({ steps: [step1, step2], agents, agentModelConfig: validAgentModelConfig });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(String(e)).toContain("Duplicate stepId");
    }
  });

  test("accepts valid loaded step arrays", async () => {
    const step = createStep({ stepId: "step-1", role: "implement" });
    const store = openStateStore(":memory:");

    try {
      const result = await executeWorkflow({
        steps: [step],
        agents,
        agentModelConfig: validAgentModelConfig,
        stateStore: store,
      });

      expect(result.kind).toBe("complete");
    } finally {
      store.close();
    }
  });

  test("rejects a role absent from loaded config as aggregated per-agent misses before durable state change", async () => {
    const step = createStep({ stepId: "step-1", role: "unknown-role" });
    const store = openStateStore(":memory:");

    try {
      await executeWorkflow({
        steps: [step],
        agents,
        agentModelConfig: noStepRolesConfig,
        stateStore: store,
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(String(e)).toContain("(step-1, unknown-role, claude)");
      expect(String(e)).toContain("(step-1, unknown-role, codex)");
      const run = store.findRunByProjectBranch({
        project: "demo",
        branch: "workflow-run",
        stepId: "step-1",
      });
      expect(run).toBeNull();
    } finally {
      store.close();
    }
  });

  test("aggregates multiple missing step-role-agent bindings in one load failure", async () => {
    const step1 = createStep({ stepId: "step-1", role: "implement", branchName: "aggregate-misses" });
    const step2 = createStep({ stepId: "step-2", role: "unknown-role", branchName: "aggregate-misses" });

    try {
      await executeWorkflow({
        steps: [step1, step2],
        agents,
        agentModelConfig: missingCodexImplementConfig,
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(String(e)).toContain("(step-1, implement, codex)");
      expect(String(e)).toContain("(step-2, unknown-role, claude)");
      expect(String(e)).toContain("(step-2, unknown-role, codex)");
    }
  });

  test("fails workflow load when an earlier agent has the role and a later fallback agent does not", async () => {
    const step = createStep({ stepId: "step-1", role: "implement" });

    try {
      await executeWorkflow({
        steps: [step],
        agents,
        agentModelConfig: missingCodexImplementConfig,
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(String(e)).toContain("(step-1, implement, codex)");
      expect(String(e)).not.toContain("(step-1, implement, claude)");
    }
  });

  test("runs single step to completion", async () => {
    const step = createStep({ stepId: "step-1", role: "implement" });
    const store = openStateStore(":memory:");

    try {
      const result = await executeWorkflow({
        steps: [step],
        agents,
        agentModelConfig: validAgentModelConfig,
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
    const step1 = createStep({ stepId: "step-1", role: "implement", branchName: "two-step" });
    const step2 = createStep({ stepId: "step-2", role: "implement", branchName: "two-step" });

    try {
      const result = await executeWorkflow({
        steps: [step1, step2],
        agents,
        agentModelConfig: validAgentModelConfig,
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

  test("stops workflow when step ends blocked", async () => {
    const store = openStateStore(":memory:");
    const step1 = createStep({ stepId: "step-1", role: "implement", branchName: "blocked-run" });
    const step2 = createStep({
      stepId: "step-2",
      role: "implement",
      branchName: "blocked-run",
      bindings: simulatedBindings(["blocked"], { artifactPath: "proof.txt", emitArtifact: false }),
    });

    try {
      const result = await executeWorkflow({
        steps: [step1, step2],
        agents,
        agentModelConfig: validAgentModelConfig,
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
      bindings: simulatedBindings(["error"], { artifactPath: "proof.txt", emitArtifact: false }),
    });

    try {
      const result = await executeWorkflow({
        steps: [step1, step2],
        agents,
        agentModelConfig: validAgentModelConfig,
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
      bindings: simulatedBindings(["progress"], { artifactPath: "proof.txt", emitArtifact: false }),
      maxIterations: 1,
    });

    try {
      const result = await executeWorkflow({
        steps: [step1, step2],
        agents,
        agentModelConfig: validAgentModelConfig,
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
      bindings: simulatedBindings(["progress"], { artifactPath: "proof.txt", emitArtifact: false }),
      maxIterations: 1,
    });

    let store = openStateStore(stateDbPath);

    try {
      const result1 = await executeWorkflow({
        steps: [step1First, step2First],
        agents,
        agentModelConfig: validAgentModelConfig,
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
        agents,
        agentModelConfig: validAgentModelConfig,
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
      expect(run1?.attempts).toHaveLength(1); // Only one attempt from first invocation
    } finally {
      store.close();
    }
  });

  test("revalidates the loaded step array on resume against resume-time config", async () => {
    let store = openStateStore(":memory:");
    const step1 = createStep({ stepId: "step-1", role: "implement", branchName: "resume-revalidate" });
    const step2 = createStep({
      stepId: "step-2",
      role: "implement",
      branchName: "resume-revalidate",
      bindings: simulatedBindings(["progress"], { artifactPath: "proof.txt", emitArtifact: false }),
      maxIterations: 1,
    });

    try {
      const firstResult = await executeWorkflow({
        steps: [step1, step2],
        agents,
        agentModelConfig: validAgentModelConfig,
        stateStore: store,
      });

      expect(firstResult.kind).toBe("budget-exhausted");

      const initialRun2 = store.findRunByProjectBranch({
        project: "demo",
        branch: "resume-revalidate",
        stepId: "step-2",
      });
      expect(initialRun2?.attempts).toHaveLength(1);

      try {
        await executeWorkflow({
          steps: [
            createStep({ stepId: "step-1", role: "implement", branchName: "resume-revalidate" }),
            createStep({ stepId: "step-2", role: "implement", branchName: "resume-revalidate" }),
          ],
          agents,
          agentModelConfig: missingCodexImplementConfig,
          stateStore: store,
        });
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect(String(e)).toContain("(step-1, implement, codex)");
        expect(String(e)).toContain("(step-2, implement, codex)");
      }

      const resumedRun2 = store.findRunByProjectBranch({
        project: "demo",
        branch: "resume-revalidate",
        stepId: "step-2",
      });
      expect(resumedRun2?.attempts).toHaveLength(1);
      expect(resumedRun2?.status).toBe("budget-soft-stopped");
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
        agents,
        agentModelConfig: validAgentModelConfig,
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
    } finally {
      store.close();
    }
  });
});
