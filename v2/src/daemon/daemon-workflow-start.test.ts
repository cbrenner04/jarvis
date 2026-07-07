import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationBinding, InvocationResult } from "../../../shared/invocation/execute.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import type { AnyWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import { createRunControlHandlers } from "./daemon.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";

const { roots } = trackedTempRoots();

const DEFAULT_AGENT_MODEL_CONFIG = {
  claude: {
    implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
  },
};

function createBindingFactory(
  invoke: (binding: { agentId: string; adapterModel: string; cwd: string }) => Promise<InvocationResult>,
): NonNullable<WriteWorkflowStep["createBinding"]> {
  return ({ agentId, adapterModel }: { agentId: string; adapterModel: string }) => {
    return {
      id: `${agentId}/${adapterModel}`,
      invoke: ({ cwd }: Parameters<InvocationBinding["invoke"]>[0]) => invoke({ agentId, adapterModel, cwd }),
      metadata: { agent: agentId, model: adapterModel },
    } satisfies InvocationBinding;
  };
}

const doneBindingFactory = createBindingFactory(async () => ({ kind: "ok", stdout: "done", stderr: "" }) as const);

function createWriteStep(stepId: string, branchName: string): WriteWorkflowStep {
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
    createBinding: doneBindingFactory,
    withExternalWorktree: createFakeWithExternalWorktree(home.jarvisRoot),
    stepId,
  };
}

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let memoryHeadroom: boolean;
let handlers: ReturnType<typeof createRunControlHandlers>;

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

async function flushBackgroundRuns(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-state-${process.pid}-${Date.now()}-${Math.random()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();
  memoryHeadroom = true;

  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
  });
});

afterEach(async () => {
  fakeExecutor.abortAll();
  await flushBackgroundRuns();
  try {
    stateStore.close();
  } catch {
    // already closed
  }
});

test("start rejects when both input and steps are supplied", async () => {
  const response = await handlers.start(
    requestFrame("s1", "start", {
      input: { worktree: {}, specPath: "", stepRules: "", expectedArtifactPath: "", bindings: [] },
      steps: [createWriteStep("step-1", "b1")],
    }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "error", code: "invalid_params", message: expect.any(String) });
});

test("start rejects when neither input nor steps are supplied", async () => {
  const response = await handlers.start(requestFrame("s1", "start", {}), new AbortController().signal);
  expect(response).toEqual({ kind: "error", code: "invalid_params", message: expect.any(String) });
});

test("start rejects an empty steps array", async () => {
  const response = await handlers.start(requestFrame("s1", "start", { steps: [] }), new AbortController().signal);
  expect(response).toEqual({ kind: "error", code: "invalid_params", message: expect.any(String) });
});

test("start with steps dispatches to executeWorkflow and returns step 0's runId", async () => {
  const steps: AnyWorkflowStep[] = [createWriteStep("step-1", "workflow-branch")];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("response");
  const runId = response.kind === "response" ? (response.result as { runId?: string }).runId : undefined;
  expect(runId).toBeTruthy();

  await flushBackgroundRuns();
  const run = runId ? stateStore.loadRun(runId) : null;
  expect(run?.project).toBe("demo");
  expect(run?.branch).toBe("workflow-branch");
});

test("start with steps returns an error rather than hanging when executeWorkflow fails before step 0's row is created", async () => {
  const duplicateStepId = "dup";
  const steps: AnyWorkflowStep[] = [createWriteStep(duplicateStepId, "b1"), createWriteStep(duplicateStepId, "b2")];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.message).toContain(duplicateStepId);
  }
});

test("start with steps is rejected insufficient_memory rather than queued when headroom is unavailable", async () => {
  memoryHeadroom = false;
  const steps: AnyWorkflowStep[] = [createWriteStep("step-1", "b1")];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response).toEqual({ kind: "error", code: "insufficient_memory", message: expect.any(String) });
});
