import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InvocationBinding, InvocationResult } from "../../../shared/invocation/execute.ts";
import type { WriteWorkflowStep } from "../execution/workflow-runner.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "./write-fixtures.ts";

export const DEFAULT_AGENT_MODEL_CONFIG = {
  claude: {
    implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
    shrink: { rungs: [{ adapterModel: "S1", priceKey: "P1" }] },
  },
};

export function createBindingFactory(
  invoke: (binding: {
    agentId: string;
    adapterModel: string;
    cwd: string;
    signal: AbortSignal | undefined;
  }) => Promise<InvocationResult>,
): NonNullable<WriteWorkflowStep["createBinding"]> {
  return ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => {
    return {
      id: `${agentId}/${adapterModel}`,
      invoke: ({ cwd, signal }: Parameters<InvocationBinding["invoke"]>[0]) =>
        invoke({ agentId, adapterModel, cwd, signal }),
      metadata: { agent: agentId, model: adapterModel },
    } satisfies InvocationBinding;
  };
}

export const doneBindingFactory = createBindingFactory(
  async () => ({ kind: "ok", stdout: "done", stderr: "" }) as const,
);

export const doneWithArtifactBindingFactory = createBindingFactory(async ({ cwd }) => {
  writeFileSync(join(cwd, "proof.txt"), "done\n", "utf8");
  return { kind: "ok", stdout: "done", stderr: "" } as const;
});

/**
 * Never settles on its own, so the step's write loop stays live for the duration of the test.
 * Reacts to `signal` so tests that abort or watchdog-timeout it still observe quiescence
 * (a settled, rejected invocation) rather than hanging the write loop indefinitely.
 */
export const neverResolvingBindingFactory = createBindingFactory(
  ({ signal }) =>
    new Promise<InvocationResult>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
);

/** Call once per test file; wires temp-root cleanup and returns a write-step builder. */
export function writeStepFixtures(): {
  roots: string[];
  createWriteStep: (
    stepId: string,
    branchName: string,
    createBinding?: NonNullable<WriteWorkflowStep["createBinding"]>,
    overrides?: Partial<WriteWorkflowStep>,
  ) => WriteWorkflowStep;
} {
  const { roots } = trackedTempRoots();

  function createWriteStep(
    stepId: string,
    branchName: string,
    createBinding: NonNullable<WriteWorkflowStep["createBinding"]> = doneBindingFactory,
    overrides: Partial<WriteWorkflowStep> = {},
  ): WriteWorkflowStep {
    const home = createJarvisHome();
    roots.push(home.jarvisRoot);
    return {
      behavior: "write",
      worktree: {
        projectRoot: "/fake",
        projectName: "demo",
        branchName,
        baseRef: "HEAD",
        jarvisRoot: home.jarvisRoot,
      },
      specPath: "spec.md",
      stepRules: "Return exactly one terminal token.",
      expectedArtifactPath: "proof.txt",
      role: "implement",
      agents: ["claude"],
      agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
      createBinding,
      withExternalWorktree: createFakeWithExternalWorktree(home.jarvisRoot),
      stepId,
      ...overrides,
    };
  }

  return { roots, createWriteStep };
}
