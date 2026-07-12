import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationBinding, InvocationResult } from "../../../shared/invocation/execute.ts";
import type {
  AnyWorkflowStep,
  HumanWorkflowStep,
  ReviewDebateWorkflowStep,
  WriteWorkflowStep,
} from "../execution/workflow-runner.ts";
import { openLogReader } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { mockWriteLoopInput, startRunDirect, listRunsDirect } from "../testing/run-control.ts";
import { createFakeWithExternalWorktree, createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";

const { roots } = trackedTempRoots();

const DEFAULT_AGENT_MODEL_CONFIG = {
  claude: {
    implement: { rungs: [{ adapterModel: "M1", priceKey: "P1" }] },
    shrink: { rungs: [{ adapterModel: "S1", priceKey: "P1" }] },
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

const doneWithArtifactBindingFactory = createBindingFactory(async ({ cwd }) => {
  writeFileSync(join(cwd, "proof.txt"), "done\n", "utf8");
  return { kind: "ok", stdout: "done", stderr: "" } as const;
});

// Never settles, so the step's write loop stays live for the duration of the test.
const neverResolvingBindingFactory = createBindingFactory(() => new Promise<InvocationResult>(() => {}));

const DEBATE_AGENT_MODEL_CONFIG = {
  claude: {
    adversary: { rungs: [{ adapterModel: "ADV", priceKey: "p-adv" }] },
    advocate: { rungs: [{ adapterModel: "ADVOC", priceKey: "p-advoc" }] },
    adjudicator: { rungs: [{ adapterModel: "ADJ", priceKey: "p-adj" }] },
    actuator: { rungs: [{ adapterModel: "ACT", priceKey: "p-act" }] },
  },
};

function createDebateStep(stepId: string, branch: string): ReviewDebateWorkflowStep {
  return {
    behavior: "review-debate",
    stepId,
    cwd: "/fake",
    project: "demo",
    branch,
    prompts: { adversary: "find issues", advocate: "argue merits", adjudicator: "settle it" },
    maxCycles: 1,
    agents: { adversary: ["claude"], advocate: ["claude"], adjudicator: ["claude"], actuator: ["claude"] },
    agentModelConfig: DEBATE_AGENT_MODEL_CONFIG,
    verdictPath: join(mkdtempSync(join(tmpdir(), "daemon-workflow-start-")), "verdict.md"),
  };
}

function createWriteStep(
  stepId: string,
  branchName: string,
  createBinding: NonNullable<WriteWorkflowStep["createBinding"]> = doneBindingFactory,
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

test("start with steps reports isLive on list while the workflow step is executing", async () => {
  const steps: AnyWorkflowStep[] = [createWriteStep("step-1", "workflow-live-branch", neverResolvingBindingFactory)];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("response");
  const runId = response.kind === "response" ? (response.result as { runId?: string }).runId : undefined;
  expect(runId).toBeTruthy();

  await flushBackgroundRuns();
  const row = (await listRunsDirect(handlers))?.find((run) => run.runId === runId);
  expect(row).toMatchObject({ status: "in-progress", isLive: true });
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

test("start with steps appends observability log events when logsPath is configured", async () => {
  const logsPath = join(tmpdir(), `jarvis-workflow-logs-${process.pid}-${Date.now()}.jsonl`);
  const invalidTokenFactory = createBindingFactory(
    async () => ({ kind: "ok", stdout: "prose without a terminal token", stderr: "" }) as const,
  );
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    logsPath,
    operatorSessionId: "workflow-log-test",
  });

  const steps: AnyWorkflowStep[] = [createWriteStep("step-1", "workflow-log-branch", invalidTokenFactory)];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response.kind).toBe("response");
  const runId = response.kind === "response" ? (response.result as { runId?: string }).runId : undefined;
  expect(runId).toBeTruthy();

  await flushBackgroundRuns();
  const records = openLogReader(logsPath).tail(runId as string);
  expect(records.map((record) => record.event.kind)).toEqual([
    "iteration_started",
    "boundary_committed",
    "invalid_token_detail",
    "loop_finished",
  ]);
  const detail = records.find((record) => record.event.kind === "invalid_token_detail");
  expect(detail?.event).toMatchObject({
    kind: "invalid_token_detail",
    tokenText: "prose without a terminal token",
  });
  rmSync(logsPath, { force: true });
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

test("start with steps is rejected worktree_claimed when a live bare run holds the (project, branch)", async () => {
  await startRunDirect(handlers, mockWriteLoopInput({ projectName: "demo", branchName: "workflow-branch" }));

  const steps: AnyWorkflowStep[] = [createWriteStep("step-1", "workflow-branch")];
  const response = await handlers.start(requestFrame("s2", "start", { steps }), new AbortController().signal);
  expect(response).toEqual({ kind: "error", code: "worktree_claimed", message: expect.any(String) });
});

test("start with steps is rejected worktree_claimed when the (project, branch) already has a queued run", async () => {
  memoryHeadroom = false;
  await startRunDirect(handlers, mockWriteLoopInput({ projectName: "demo", branchName: "workflow-branch" }));

  const steps: AnyWorkflowStep[] = [createWriteStep("step-1", "workflow-branch")];
  const response = await handlers.start(requestFrame("s2", "start", { steps }), new AbortController().signal);
  expect(response).toEqual({ kind: "error", code: "worktree_claimed", message: expect.any(String) });
});

test("start with steps derives the ownership key from flat project/branch when the first step is a human step", async () => {
  await startRunDirect(handlers, mockWriteLoopInput({ projectName: "demo", branchName: "human-branch" }));

  const humanStep: HumanWorkflowStep = { behavior: "human", stepId: "gate", project: "demo", branch: "human-branch" };
  const steps: AnyWorkflowStep[] = [humanStep];
  const response = await handlers.start(requestFrame("s2", "start", { steps }), new AbortController().signal);
  expect(response).toEqual({ kind: "error", code: "worktree_claimed", message: expect.any(String) });
});

test("kill rejects a workflow-started run's step-0 runId with run_not_active", async () => {
  const steps: AnyWorkflowStep[] = [createWriteStep("step-1", "workflow-branch")];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  const runId = response.kind === "response" ? (response.result as { runId?: string }).runId : undefined;
  expect(runId).toBeTruthy();

  const killResponse = await handlers.kill(requestFrame("k1", "kill", { runId }), new AbortController().signal);
  expect(killResponse).toEqual({ kind: "error", code: "run_not_active", message: expect.any(String) });
});

test("pause rejects a workflow-started run's step-0 runId with run_not_active", async () => {
  const steps: AnyWorkflowStep[] = [createWriteStep("step-1", "workflow-branch")];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  const runId = response.kind === "response" ? (response.result as { runId?: string }).runId : undefined;
  expect(runId).toBeTruthy();

  const pauseResponse = await handlers.pause(requestFrame("p1", "pause", { runId }), new AbortController().signal);
  expect(pauseResponse).toEqual({ kind: "error", code: "run_not_active", message: expect.any(String) });
});

test("kill/pause reject a later step's runId once onStepRunCreated has tracked it", async () => {
  const steps: AnyWorkflowStep[] = [
    createWriteStep("step-1", "workflow-branch", doneWithArtifactBindingFactory),
    createWriteStep("step-2", "workflow-branch"),
  ];
  await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);

  let step2Run = null;
  for (let attempt = 0; attempt < 20 && !step2Run; attempt++) {
    await flushBackgroundRuns();
    step2Run = stateStore.findRunByProjectBranch({ project: "demo", branch: "workflow-branch", stepId: "step-2" });
  }
  expect(step2Run?.id).toBeTruthy();
  const step2RunId = step2Run?.id as string;

  const killResponse = await handlers.kill(
    requestFrame("k2", "kill", { runId: step2RunId }),
    new AbortController().signal,
  );
  expect(killResponse).toEqual({ kind: "error", code: "run_not_active", message: expect.any(String) });

  const pauseResponse = await handlers.pause(
    requestFrame("p2", "pause", { runId: step2RunId }),
    new AbortController().signal,
  );
  expect(pauseResponse).toEqual({ kind: "error", code: "run_not_active", message: expect.any(String) });
});

test("start with steps is rejected worktree_claimed when a live workflow run holds the (project, branch)", async () => {
  const liveSteps: AnyWorkflowStep[] = [createWriteStep("step-1", "workflow-branch", neverResolvingBindingFactory)];
  const liveResponse = await handlers.start(
    requestFrame("s1", "start", { steps: liveSteps }),
    new AbortController().signal,
  );
  expect(liveResponse.kind).toBe("response");
  await flushBackgroundRuns();

  const steps: AnyWorkflowStep[] = [createWriteStep("step-1", "workflow-branch")];
  const response = await handlers.start(requestFrame("s2", "start", { steps }), new AbortController().signal);
  expect(response).toEqual({ kind: "error", code: "worktree_claimed", message: expect.any(String) });
});

test("start with input is rejected worktree_claimed when a live workflow run holds the (project, branch)", async () => {
  const liveSteps: AnyWorkflowStep[] = [createWriteStep("step-1", "workflow-branch", neverResolvingBindingFactory)];
  const liveResponse = await handlers.start(
    requestFrame("s1", "start", { steps: liveSteps }),
    new AbortController().signal,
  );
  expect(liveResponse.kind).toBe("response");
  await flushBackgroundRuns();

  const response = await handlers.start(
    requestFrame("s2", "start", { input: mockWriteLoopInput({ projectName: "demo", branchName: "workflow-branch" }) }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "error", code: "worktree_claimed", message: expect.any(String) });
});

test("start with steps is rejected invalid_params when the first step is review-debate", async () => {
  const steps: AnyWorkflowStep[] = [createDebateStep("debate-1", "debate-branch")];
  const response = await handlers.start(requestFrame("s1", "start", { steps }), new AbortController().signal);
  expect(response).toEqual({ kind: "error", code: "invalid_params", message: expect.any(String) });
});
