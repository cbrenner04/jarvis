import { describe, expect, test } from "bun:test";
import type { StateStore, WorkflowSnapshot } from "../persistence/state-store.ts";
import { withStateStore } from "../testing/write-fixtures.ts";
import { createStep, DEFAULT_AGENT_MODEL_CONFIG } from "./workflow-runner.test-support.ts";
import { executeWorkflow } from "./workflow-runner.ts";

const invocationId = "lease-invocation";

function seedInvocationRows(store: StateStore, branch: string, stepId: string, role: string): string[] {
  const snapshot: WorkflowSnapshot = {
    invocationId,
    steps: [
      {
        stepId,
        role,
        durable: true,
        stepRules: "rules",
        expectedArtifactPath: "proof.txt",
        agents: ["claude"],
        agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
        leaseFromSha: "prior-sha",
      },
    ],
  };
  const base = { project: "demo", specRef: "HEAD", worktreePath: "/fake", branch, specPath: "spec.md" };
  return [
    store.createRun({ ...base, stepId, workflowSnapshot: snapshot }),
    store.createRun({ ...base, stepId: `${stepId}~link-0`, workflowSnapshot: snapshot }),
  ];
}

function recordedLeases(store: StateStore, runIds: readonly string[]): (string | undefined)[] {
  return runIds.map((runId) => store.loadRun(runId)?.workflowSnapshot?.steps[0]?.leaseFromSha);
}

describe("reused workflow snapshot lease restamp", () => {
  test("a non-rebased re-dispatch clears the prior lease on every row of the invocation", async () => {
    await withStateStore(async (store) => {
      const runIds = seedInvocationRows(store, "lease-clear", "implement", "implement");

      await executeWorkflow({
        steps: [createStep({ stepId: "implement", role: "implement", branchName: "lease-clear" })],
        stateStore: store,
      });

      expect(recordedLeases(store, runIds)).toEqual([undefined, undefined]);
    });
  });

  test("a rebased re-dispatch restamps its recorded pre-rebase SHA on every row of the invocation", async () => {
    await withStateStore(async (store) => {
      const runIds = seedInvocationRows(store, "lease-restamp", "implement", "implement");

      await executeWorkflow({
        steps: [
          createStep({ stepId: "implement", role: "implement", branchName: "lease-restamp", leaseFromSha: "new-sha" }),
        ],
        stateStore: store,
      });

      expect(recordedLeases(store, runIds)).toEqual(["new-sha", "new-sha"]);
    });
  });

  test("a refused dispatch (worktree claim held by a live run) leaves the live run's lease untouched", async () => {
    await withStateStore(async (store) => {
      const runIds = seedInvocationRows(store, "lease-refused", "implement", "implement");
      const refused = createStep({
        stepId: "implement",
        role: "implement",
        branchName: "lease-refused",
        leaseFromSha: "intruder-sha",
        withExternalWorktree: async () => {
          throw new Error("worktree claimed by a live run");
        },
      });

      await expect(executeWorkflow({ steps: [refused], stateStore: store })).rejects.toThrow(
        "worktree claimed by a live run",
      );

      expect(recordedLeases(store, runIds)).toEqual(["prior-sha", "prior-sha"]);
    });
  });
});
