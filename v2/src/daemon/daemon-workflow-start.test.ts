import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  implementReviewProfile,
  intentReviewProfile,
  planReviewProfile,
} from "../../../shared/prompts/review-profile.ts";
import type { AnyWorkflowStep, ReviewDebateWorkflowStep, ReviewWorkflowStep } from "../execution/workflow-runner.ts";
import { openLogReader } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, listRunsDirect, mockWriteLoopInput, startRunDirect } from "../testing/run-control.ts";
import {
  createBindingFactory,
  doneBindingFactory,
  doneWithArtifactBindingFactory,
  neverResolvingBindingFactory,
  writeStepFixtures,
} from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers, WorktreeOwnershipRegistry } from "./daemon.ts";

const { createWriteStep } = writeStepFixtures();

const DEBATE_AGENT_MODEL_CONFIG = {
  claude: {
    adversary: { rungs: [{ adapterModel: "ADV", priceKey: "p-adv" }] },
    advocate: { rungs: [{ adapterModel: "ADVOC", priceKey: "p-advoc" }] },
    adjudicator: { rungs: [{ adapterModel: "ADJ", priceKey: "p-adj" }] },
    actuator: { rungs: [{ adapterModel: "ACT", priceKey: "p-act" }] },
  },
};

const REVIEW_AGENT_MODEL_CONFIG = {
  claude: {
    critic: { rungs: [{ adapterModel: "CRIT", priceKey: "p-crit" }] },
    ...DEBATE_AGENT_MODEL_CONFIG.claude,
  },
};

function createReviewBindingFactory(prompts: string[]): NonNullable<ReviewWorkflowStep["createBinding"]> {
  return ({ agentId, adapterModel }) => ({
    id: `${agentId}/${adapterModel}`,
    invoke: async ({ prompt }) => {
      prompts.push(prompt);
      return { kind: "ok", stdout: "apply this verdict", stderr: "" } as const;
    },
    metadata: { agent: agentId, model: adapterModel },
  });
}

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

async function waitDirect(handlers: ReturnType<typeof createRunControlHandlers>, runId: string) {
  return handlers.wait({ kind: "request", id: "w1", method: "wait", params: { runId } }, new AbortController().signal);
}

/** Polls until `predicate` holds, so a slow step fails on its own assertion rather than on a sleep. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let memoryHeadroom: boolean;
let handlers: ReturnType<typeof createRunControlHandlers>;
let registry: WorktreeOwnershipRegistry;

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

beforeEach(() => {
  stateStore = openStateStore(join(tmpdir(), `jarvis-state-${process.pid}-${Date.now()}-${Math.random()}.db`));
  fakeExecutor = createFakeWriteLoopExecutor();
  memoryHeadroom = true;
  registry = new WorktreeOwnershipRegistry();

  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => memoryHeadroom,
    registry,
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

test("start reports routing_read_failed for an unreadable linked index", async () => {
  const step = createWriteStep("step-1", "routing-read-failed");
  step.specPath = "missing-index.md";
  step.linkedIndexRouting = true;
  const response = await handlers.start(requestFrame("s1", "start", { steps: [step] }), new AbortController().signal);

  expect(response.kind).toBe("error");
  if (response.kind === "error") {
    expect(response.code).toBe("routing_read_failed");
    expect(typeof response.message).toBe("string");
    expect(response.message.includes("/fake/missing-index.md")).toBe(true);
    expect(response.message.includes("ENOENT")).toBe(true);
  }
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

test("workflow timeout releases liveness and worktree ownership", async () => {
  const logsPath = join(tmpdir(), `jarvis-workflow-timeout-${process.pid}-${Date.now()}.jsonl`);
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    logsPath,
    logReader: openLogReader(logsPath),
    operatorSessionId: "workflow-timeout-test",
  });
  const step = createWriteStep("step-1", "workflow-timeout", neverResolvingBindingFactory);
  step.iterationTimeoutMs = 5;
  const response = await handlers.start(requestFrame("s1", "start", { steps: [step] }), new AbortController().signal);
  const runId = response.kind === "response" ? (response.result as { runId?: string }).runId : undefined;

  // Fixed delay for elapsed-time timeout behavior (iteration timeout at 5ms).
  // This test verifies timeout enforcement and cannot be replaced with condition polling.
  await new Promise((resolve) => setTimeout(resolve, 25));
  const row = (await listRunsDirect(handlers))?.find((run) => run.runId === runId);
  expect(row).toMatchObject({ status: "failed", isLive: false });
  expect(row?.workflow?.steps[0]).toMatchObject({ status: "stopped", terminalOutcome: "iteration_timeout" });
  expect(await waitDirect(handlers, runId as string)).toMatchObject({
    kind: "response",
    result: { runStatus: "failed", loopOutcomeKind: "iteration_timeout" },
  });

  const restarted = await handlers.start(requestFrame("s2", "start", { steps: [step] }), new AbortController().signal);
  expect(restarted.kind).toBe("response");
  await new Promise((resolve) => setTimeout(resolve, 25));
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

test("JSON-round-tripped review profiles rehydrate renderers for every domain and behavior", async () => {
  const profiles = [intentReviewProfile, planReviewProfile, implementReviewProfile] as const;

  for (const profile of profiles) {
    const prompts: string[] = [];
    const cwd = mkdtempSync(join(tmpdir(), `daemon-review-${profile.domain}-`));
    const bindingFactory = createReviewBindingFactory(prompts);
    const light: ReviewWorkflowStep = {
      behavior: "review",
      stepId: `${profile.domain}-light`,
      project: "demo",
      branch: `${profile.domain}-branch`,
      cwd,
      prompt: "fallback critic",
      verdictPath: join(cwd, "light-verdict.md"),
      maxCycles: 1,
      profile: profile as NonNullable<ReviewWorkflowStep["profile"]>,
      profileContext: {
        stagingDir: cwd,
        verdictPath: join(cwd, "light-verdict.md"),
        specPath: join(cwd, "spec.md"),
        worktreePath: cwd,
        cwd,
        passNumber: 1,
        totalPasses: 1,
      },
      agents: { critic: ["claude"], actuator: ["claude"] },
      agentModelConfig: REVIEW_AGENT_MODEL_CONFIG,
      createBinding: bindingFactory,
    };
    const debate: ReviewDebateWorkflowStep = {
      behavior: "review-debate",
      stepId: `${profile.domain}-debate`,
      project: "demo",
      branch: `${profile.domain}-branch`,
      cwd,
      prompts: { adversary: "fallback adversary", advocate: "fallback advocate", adjudicator: "fallback adjudicator" },
      verdictPath: join(cwd, "debate-verdict.md"),
      maxCycles: 1,
      profile: profile as NonNullable<ReviewDebateWorkflowStep["profile"]>,
      profileContext: light.profileContext,
      agents: { adversary: ["claude"], advocate: ["claude"], adjudicator: ["claude"], actuator: ["claude"] },
      agentModelConfig: REVIEW_AGENT_MODEL_CONFIG,
      createBinding: bindingFactory,
    };
    const write = createWriteStep(`${profile.domain}-write`, `${profile.domain}-branch`);
    const serialized = JSON.parse(JSON.stringify([write, light, debate])) as AnyWorkflowStep[];
    for (const [index, step] of serialized.entries()) {
      step.createBinding = index === 0 ? doneWithArtifactBindingFactory : bindingFactory;
    }
    if (serialized[0]?.behavior === "write" && write.withExternalWorktree !== undefined)
      serialized[0].withExternalWorktree = write.withExternalWorktree;

    const response = await handlers.start(
      requestFrame(profile.domain, "start", { steps: serialized }),
      new AbortController().signal,
    );
    expect(response.kind).toBe("response");
    const runId = (response as { result: { runId: string } }).result.runId;
    await waitDirect(handlers, runId);
    // `runId` is step 0's; the review steps run under their own ids, so poll for their prompts.
    await waitFor(() => prompts.length === 6);

    expect(stateStore.loadRun(runId)?.status).toBe("completed");
    expect(prompts.length).toBe(6);
    expect(prompts[0]).not.toBe("fallback critic");
    expect(prompts[1]?.trim().length).toBeGreaterThan(0);
    expect(prompts.slice(2, 5).every((prompt) => !prompt.startsWith("fallback"))).toBe(true);
    expect(prompts[5]?.trim().length).toBeGreaterThan(0);
  }
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
    "token_reprompt",
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

test("start with steps reclaims a non-live workflow claim for the same (project, branch)", async () => {
  const key = { project: "demo", branch: "workflow-branch" };
  registry.claim(key, { runId: "orphaned-workflow", worktreePath: "/unchanged", workflow: true });

  const response = await handlers.start(
    requestFrame("s1", "start", { steps: [createWriteStep("step-1", "workflow-branch")] }),
    new AbortController().signal,
  );

  expect(response.kind).toBe("response");
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

test("intent request against a non-terminal prior run of another invocation is rejected", async () => {
  // First, start an intent workflow with a specific invocation ID (use neverResolvingBindingFactory to keep it non-terminal)
  const firstInvocationId = crypto.randomUUID();
  const firstStep = createWriteStep("step-1", "intent-branch", neverResolvingBindingFactory);
  firstStep.workflowInvocationId = firstInvocationId;
  const firstResponse = await handlers.start(
    requestFrame("s1", "start", { steps: [firstStep] }),
    new AbortController().signal,
  );
  expect(firstResponse.kind).toBe("response");
  await flushBackgroundRuns();

  // Now try to start the same step with a different invocation ID; should be rejected
  const secondInvocationId = crypto.randomUUID();
  const secondStep = createWriteStep("step-1", "intent-branch", doneBindingFactory);
  secondStep.workflowInvocationId = secondInvocationId;
  const secondResponse = await handlers.start(
    requestFrame("s2", "start", { steps: [secondStep] }),
    new AbortController().signal,
  );
  expect(secondResponse.kind).toBe("error");
  expect((secondResponse as { code?: string }).code).toBe("worktree_claimed");
  expect((secondResponse as { message?: string }).message).toContain("owned by another invocation");
});

test("intent request against a terminal prior run of another invocation creates a new run", async () => {
  // First, create a completed run with a specific invocation ID
  const firstInvocationId = crypto.randomUUID();
  const firstStep = createWriteStep("step-1", "terminal-intent-branch", doneBindingFactory);
  firstStep.workflowInvocationId = firstInvocationId;
  const firstResponse = await handlers.start(
    requestFrame("s1", "start", { steps: [firstStep] }),
    new AbortController().signal,
  );
  expect(firstResponse.kind).toBe("response");
  const firstRunId = (firstResponse as { result: { runId: string } }).result.runId;
  await flushBackgroundRuns();

  // Now try to start the same step with a different invocation ID; should succeed (creates new run)
  const secondInvocationId = crypto.randomUUID();
  const secondStep = createWriteStep("step-1", "terminal-intent-branch", doneBindingFactory);
  secondStep.workflowInvocationId = secondInvocationId;
  const secondResponse = await handlers.start(
    requestFrame("s2", "start", { steps: [secondStep] }),
    new AbortController().signal,
  );
  expect(secondResponse.kind).toBe("response");
  const secondRunId = (secondResponse as { result: { runId: string } }).result.runId;

  // Verify the new run ID is different from the first
  expect(secondRunId).not.toBe(firstRunId);
});
