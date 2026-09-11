import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { makeIpcClient } from "../testing/ipc-client-fake.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createPipelineHandlers } from "./daemon-pipeline-handlers.ts";
import { createRunControlHandlerContext } from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";
import { createWorkflowStartAdmission } from "./daemon-workflow-admission-handlers.ts";
import { derivePipelineState } from "./pipeline-execution.ts";
import type { PipelineStageResolutionResult } from "./pipeline-stage-resolve.ts";

const ADMISSION_CONTEXT = {
  cwd: "/fake",
  seed: "seed text",
  configPath: "/fake/.jarvis/config.json",
};

const SINGLE_STAGE_DEFINITION: PipelineDefinition = {
  name: "list-projection",
  stages: [{ stageId: "only", kind: "workflow", workflow: "intent", review: "none" }],
};

let dbPath: string;
let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-pipeline-handlers-${process.pid}-${Date.now()}.db`);
  stateStore = openStateStore(dbPath);
  fakeExecutor = createFakeWriteLoopExecutor();
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

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

function pipelineHandlers(
  resolveStage: (
    definition: PipelineDefinition,
    stageIndex: number,
  ) => Promise<PipelineStageResolutionResult> = async () => ({
    ok: true,
    steps: [],
  }),
) {
  const ctx = createRunControlHandlerContext({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage,
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const lifecycle = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: workflowStart.handleWorkflowStart,
  });
  return createPipelineHandlers(ctx, {
    pipelineDispatch: lifecycle.pipelineDispatch,
    pipelineWait: lifecycle.pipelineWait,
    admitWorkflowStart: workflowStart.admitWorkflowStart,
    resolveStage,
  });
}

/** Admits a single-stage pipeline; `terminal: true` settles it `succeeded`. `createdAt` overrides the durable row directly. */
function seedPipeline(store: StateStore, overrides: { createdAt?: number; terminal?: boolean } = {}): string {
  const pipelineId = store.createPipeline({
    definition: SINGLE_STAGE_DEFINITION,
    context: ADMISSION_CONTEXT,
  });
  if (overrides.terminal === true) {
    store.updateStage({
      pipelineId,
      stageId: "only",
      patch: { status: "succeeded", workflowInvocationId: `inv-${pipelineId}`, endedAt: Date.now() },
    });
  }
  if (overrides.createdAt !== undefined) {
    const db = new Database(dbPath);
    db.prepare("UPDATE pipelines SET created_at = ? WHERE id = ?").run(overrides.createdAt, pipelineId);
    db.close();
  }
  return pipelineId;
}

test("pipeline_start refuses context missing configPath without creating pipeline rows", async () => {
  const handlers = pipelineHandlers();

  const response = await handlers.pipeline_start(
    requestFrame("no-config", "pipeline_start", {
      definition: SINGLE_STAGE_DEFINITION,
      context: { cwd: "/fake", seed: "seed text" },
    }),
    new AbortController().signal,
  );

  expect(response).toEqual({
    kind: "error",
    code: "invalid_params",
    message: "missing required field: configPath",
  });
  expect(stateStore.listPipelines()).toEqual([]);
});

test("pipeline_start admits valid context and returns durable pipelineId", async () => {
  const handlers = pipelineHandlers();

  const response = await handlers.pipeline_start(
    requestFrame("admit", "pipeline_start", {
      definition: SINGLE_STAGE_DEFINITION,
      context: ADMISSION_CONTEXT,
    }),
    new AbortController().signal,
  );

  expect(response).toEqual({ kind: "response", result: { pipelineId: expect.any(String) } });
  const pipelineId = (response as { result: { pipelineId: string } }).result.pipelineId;
  const admitted = stateStore.loadPipeline(pipelineId);
  if (!admitted) throw new Error("expected pipeline to exist");
  expect(admitted.context).toEqual(ADMISSION_CONTEXT);
});

test("pipeline_list projects admitted pipelines with derived state", async () => {
  const handlers = pipelineHandlers();
  const pipelineId = stateStore.createPipeline({
    definition: SINGLE_STAGE_DEFINITION,
    context: ADMISSION_CONTEXT,
  });

  const response = await handlers.pipeline_list(requestFrame("l1", "pipeline_list"), new AbortController().signal);
  expect(response.kind).toBe("response");
  const pipelines = (response as { result: { pipelines: Array<{ pipelineId: string; state: string }> } }).result
    .pipelines;
  expect(pipelines).toHaveLength(1);
  expect(pipelines[0]?.pipelineId).toBe(pipelineId);
  const loaded = stateStore.loadPipeline(pipelineId);
  if (!loaded) throw new Error("expected pipeline");
  expect(pipelines[0]?.state).toBe(derivePipelineState(loaded));
});

test("pipeline_list omits dismissed pipelines unless includeDismissed is true", async () => {
  const handlers = pipelineHandlers();
  const pipelineId = stateStore.createPipeline({
    definition: SINGLE_STAGE_DEFINITION,
    context: ADMISSION_CONTEXT,
  });
  stateStore.dismissPipeline({ pipelineId });

  const defaultList = await handlers.pipeline_list(requestFrame("l2", "pipeline_list"), new AbortController().signal);
  expect((defaultList as { result: { pipelines: unknown[] } }).result.pipelines).toEqual([]);

  const includeDismissed = await handlers.pipeline_list(
    requestFrame("l3", "pipeline_list", { includeDismissed: true }),
    new AbortController().signal,
  );
  expect((includeDismissed as { result: { pipelines: Array<{ pipelineId: string }> } }).result.pipelines).toHaveLength(
    1,
  );
});

type ListedPipeline = { pipelineId: string; state: string; createdAt: number };

async function listPipelinesDirect(
  handlers: ReturnType<typeof pipelineHandlers>,
  params?: unknown,
): Promise<ListedPipeline[]> {
  const response = await handlers.pipeline_list(
    requestFrame("l", "pipeline_list", params),
    new AbortController().signal,
  );
  return (response as { result: { pipelines: ListedPipeline[] } }).result.pipelines;
}

const GATE_DEFINITION: PipelineDefinition = {
  name: "gate-only",
  stages: [{ stageId: "gate", kind: "approval" }],
};

/** Approval-stage pipeline left at its default `pending` row status derives `awaiting-approval`. */
function seedAwaitingApprovalPipeline(store: StateStore, createdAt: number): string {
  const pipelineId = store.createPipeline({ definition: GATE_DEFINITION, context: ADMISSION_CONTEXT });
  const db = new Database(dbPath);
  db.prepare("UPDATE pipelines SET created_at = ? WHERE id = ?").run(createdAt, pipelineId);
  db.close();
  return pipelineId;
}

function seedRunningPipeline(store: StateStore, createdAt: number): string {
  const pipelineId = seedPipeline(store, { createdAt });
  store.updateStage({
    pipelineId,
    stageId: "only",
    patch: { status: "running", workflowInvocationId: `inv-${pipelineId}` },
  });
  return pipelineId;
}

test("pipeline_list retains only the 50 newest terminal pipelines plus every non-terminal pipeline", async () => {
  const handlers = pipelineHandlers();
  const terminalIds: string[] = [];
  for (let index = 0; index < 55; index++) {
    terminalIds.push(seedPipeline(stateStore, { terminal: true, createdAt: index }));
  }
  const pendingId = seedPipeline(stateStore, { createdAt: -1000 });
  const runningId = seedRunningPipeline(stateStore, -1001);
  const awaitingApprovalId = seedAwaitingApprovalPipeline(stateStore, -1002);

  const listed = await listPipelinesDirect(handlers);
  const listedTerminalIds = new Set(listed.filter((row) => row.state === "succeeded").map((row) => row.pipelineId));

  expect(listedTerminalIds.size).toBe(50);
  for (let index = 5; index < 55; index++) {
    expect(listedTerminalIds.has(terminalIds[index] as string)).toBe(true);
  }
  for (let index = 0; index < 5; index++) {
    expect(listedTerminalIds.has(terminalIds[index] as string)).toBe(false);
    expect(stateStore.loadPipeline(terminalIds[index] as string)).not.toBeNull();
  }
  expect(listed.find((row) => row.pipelineId === pendingId)?.state).toBe("pending");
  expect(listed.find((row) => row.pipelineId === runningId)?.state).toBe("running");
  expect(listed.find((row) => row.pipelineId === awaitingApprovalId)?.state).toBe("awaiting-approval");
});

test("pipeline_list sinceMs returns a terminal pipeline beyond the default cap, newest-first", async () => {
  const handlers = pipelineHandlers();
  for (let index = 0; index < 55; index++) {
    seedPipeline(stateStore, { terminal: true, createdAt: index });
  }
  const evictedId = seedPipeline(stateStore, { terminal: true, createdAt: -1 });

  const defaultListed = await listPipelinesDirect(handlers);
  expect(defaultListed.some((row) => row.pipelineId === evictedId)).toBe(false);

  const sinceListed = await listPipelinesDirect(handlers, { sinceMs: -1 });
  expect(sinceListed.some((row) => row.pipelineId === evictedId)).toBe(true);
  const createdAtOrder = sinceListed.map((row) => row.createdAt);
  expect(createdAtOrder).toEqual([...createdAtOrder].sort((a, b) => b - a));
});

test("pipeline_list breaks createdAt ties by pipelineId descending, deterministically across calls", async () => {
  const handlers = pipelineHandlers();
  const tiedAt = 42;
  const tiedIds: string[] = [];
  for (let index = 0; index < 5; index++) {
    tiedIds.push(seedPipeline(stateStore, { createdAt: tiedAt }));
  }
  const expectedOrder = [...tiedIds].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  const first = await listPipelinesDirect(handlers);
  const second = await listPipelinesDirect(handlers);

  expect(first.map((row) => row.pipelineId)).toEqual(expectedOrder);
  expect(second.map((row) => row.pipelineId)).toEqual(expectedOrder);
});

test("pipeline_list state filter returns matching terminal pipelines beyond the cap and composes with sinceMs", async () => {
  const handlers = pipelineHandlers();
  for (let index = 0; index < 55; index++) {
    seedPipeline(stateStore, { terminal: true, createdAt: index });
  }
  const pendingId = seedPipeline(stateStore, { createdAt: -1 });

  const stateListed = await listPipelinesDirect(handlers, { state: "succeeded" });
  expect(stateListed).toHaveLength(55);
  expect(stateListed.some((row) => row.pipelineId === pendingId)).toBe(false);

  const composedListed = await listPipelinesDirect(handlers, { sinceMs: 50, state: "succeeded" });
  expect(composedListed).toHaveLength(5);
  expect(composedListed.every((row) => row.createdAt >= 50)).toBe(true);
});

test("a pipeline evicted from the default projection is still returned in full by loadPipeline", async () => {
  const handlers = pipelineHandlers();
  for (let index = 0; index < 55; index++) {
    seedPipeline(stateStore, { terminal: true, createdAt: index });
  }
  const evictedId = seedPipeline(stateStore, { terminal: true, createdAt: -1 });

  await listPipelinesDirect(handlers);
  await listPipelinesDirect(handlers, { sinceMs: -1 });

  const loaded = stateStore.loadPipeline(evictedId);
  expect(loaded).not.toBeNull();
  expect(loaded?.stages).toHaveLength(1);
});

test("a dismissed terminal pipeline consumes no retention slot and is hidden in default and sinceMs modes", async () => {
  const handlers = pipelineHandlers();
  // The dismissed pipeline is deliberately NOT the oldest: it sits mid-pack among 51 terminals.
  // If dismissal filtering ran after retention, the 50-newest slice would include it and then strip
  // it, leaving 49 rows — so the length assertion below is what discriminates the two orderings.
  // With it seeded oldest, both orderings return the same 50 and the test proves nothing.
  const dismissedId = seedPipeline(stateStore, { terminal: true, createdAt: 25 });
  stateStore.dismissPipeline({ pipelineId: dismissedId });
  for (let index = 0; index < 50; index++) {
    seedPipeline(stateStore, { terminal: true, createdAt: index });
  }

  const defaultListed = await listPipelinesDirect(handlers);
  expect(defaultListed).toHaveLength(50);
  expect(defaultListed.some((row) => row.pipelineId === dismissedId)).toBe(false);

  const sinceListed = await listPipelinesDirect(handlers, { sinceMs: -1 });
  expect(sinceListed.some((row) => row.pipelineId === dismissedId)).toBe(false);

  // includeDismissed alone does not bypass the terminal cap: with the dismissed pipeline counted,
  // 51 terminals compete for 50 slots and the oldest ages out under the 50-newest retention rule.
  const includeDismissedListed = await listPipelinesDirect(handlers, { includeDismissed: true });
  expect(includeDismissedListed).toHaveLength(50);
  expect(includeDismissedListed.some((row) => row.pipelineId === dismissedId)).toBe(true);

  const includeDismissedSinceListed = await listPipelinesDirect(handlers, { includeDismissed: true, sinceMs: -1 });
  expect(includeDismissedSinceListed.some((row) => row.pipelineId === dismissedId)).toBe(true);
});

test("pipeline_list refuses a non-finite sinceMs instead of returning the whole unbounded history", async () => {
  const handlers = pipelineHandlers();
  for (let index = 0; index < 51; index++) {
    seedPipeline(stateStore, { terminal: true, createdAt: index });
  }

  // `createdAt < NaN` is false for every row, so an unvalidated NaN takes the filtered bypass and
  // returns all 51 — the unbounded payload retention exists to remove.
  for (const sinceMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const response = await handlers.pipeline_list(
      requestFrame("l1", "pipeline_list", { sinceMs }),
      new AbortController().signal,
    );
    expect(response).toEqual({
      kind: "error",
      code: "invalid_params",
      message: "sinceMs must be a finite number",
    });
  }

  expect(await listPipelinesDirect(handlers)).toHaveLength(50);
});

test("pipeline_list refuses an unrecognized state instead of answering with an empty list", async () => {
  const handlers = pipelineHandlers();
  seedPipeline(stateStore, { terminal: true, createdAt: 1 });

  // A typo must not read to the operator as "no pipelines".
  const response = await handlers.pipeline_list(
    requestFrame("l2", "pipeline_list", { state: "suceeded" }),
    new AbortController().signal,
  );

  expect(response).toEqual({
    kind: "error",
    code: "invalid_params",
    message: "state must be one of succeeded, failed, rejected, interrupted, awaiting-approval, running, pending",
  });
});

test("pipeline_owner accepts a nonempty string pipelineId", async () => {
  const handlers = pipelineHandlers();
  const pipelineId = stateStore.createPipeline({
    definition: SINGLE_STAGE_DEFINITION,
    context: ADMISSION_CONTEXT,
  });

  const response = await handlers.pipeline_owner(
    requestFrame("o1", "pipeline_owner", { pipelineId }),
    new AbortController().signal,
  );

  expect(response).toEqual({ kind: "response", result: { kind: "owner", pipelineId } });
});

test("pipelineExecutionDeps omits loadLogRecords without logReader", () => {
  const handlers = pipelineHandlers();
  expect(handlers.pipelineExecutionDeps()).not.toHaveProperty("loadLogRecords");
});

test("pipelineExecutionDeps omits executeTerminalPublication without injectable dep", () => {
  const handlers = pipelineHandlers();
  expect(handlers.pipelineExecutionDeps()).not.toHaveProperty("executeTerminalPublication");
});

test("pipelineExecutionDeps wires executeTerminalPublication from deps", () => {
  const executeTerminalPublication = async () => ({ prNumber: 1 });
  const ctx = createRunControlHandlerContext({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const lifecycle = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: workflowStart.handleWorkflowStart,
  });
  const handlers = createPipelineHandlers(ctx, {
    pipelineDispatch: lifecycle.pipelineDispatch,
    pipelineWait: lifecycle.pipelineWait,
    admitWorkflowStart: workflowStart.admitWorkflowStart,
    executeTerminalPublication,
  });
  expect(handlers.pipelineExecutionDeps().executeTerminalPublication).toBe(executeTerminalPublication);
});

test("pipelineExecutionDeps omits staleResetPreflight without daemonSocketPath", () => {
  const handlers = pipelineHandlers();
  expect(handlers.pipelineExecutionDeps()).not.toHaveProperty("staleResetPreflight");
});

test("pipelineExecutionDeps wires staleResetPreflight when daemonSocketPath is set", async () => {
  const marker = makeIpcClient([], { gated: true, deferred: true });
  let connectedTo: string | undefined;
  const ctx = createRunControlHandlerContext({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const lifecycle = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: workflowStart.handleWorkflowStart,
  });
  const handlers = createPipelineHandlers(ctx, {
    pipelineDispatch: lifecycle.pipelineDispatch,
    pipelineWait: lifecycle.pipelineWait,
    admitWorkflowStart: workflowStart.admitWorkflowStart,
    daemonSocketPath: "/marker-daemon.sock",
    connectStaleResetClient: async (socketPath) => {
      connectedTo = socketPath;
      return marker;
    },
  });
  const built = handlers.pipelineExecutionDeps();
  expect(built.staleResetPreflight).toBeDefined();
  const client = await built.staleResetPreflight?.connectClient();
  expect(connectedTo).toBe("/marker-daemon.sock");
  expect(client).toBe(marker);
});

test("pipelineExecutionDeps wires loadLogRecords from logReader", () => {
  const tailCalls: string[] = [];
  const mockLogReader = {
    tail: (runId: string) => {
      tailCalls.push(runId);
      return [];
    },
    async *follow() {},
  };
  const ctx = createRunControlHandlerContext({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    logReader: mockLogReader,
  });
  const workflowStart = createWorkflowStartAdmission(ctx);
  const lifecycle = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart: workflowStart.handleWorkflowStart,
  });
  const handlers = createPipelineHandlers(ctx, {
    pipelineDispatch: lifecycle.pipelineDispatch,
    pipelineWait: lifecycle.pipelineWait,
    admitWorkflowStart: workflowStart.admitWorkflowStart,
  });
  const deps = handlers.pipelineExecutionDeps();
  expect(deps.loadLogRecords).toBeDefined();
  deps.loadLogRecords?.("run-42");
  expect(tailCalls).toEqual(["run-42"]);
});

test("pipeline_recover refuses resolution for an unknown pipeline", async () => {
  const handlers = pipelineHandlers();

  const response = await handlers.pipeline_recover(
    requestFrame("r1", "pipeline_recover", { pipelineId: "unknown-pipeline", branchKey: "branch-a" }),
    new AbortController().signal,
  );

  expect(response).toEqual({
    kind: "response",
    result: {
      kind: "resolution_refused",
      pipelineId: "unknown-pipeline",
      branchKey: "branch-a",
      reason: "pipeline_not_found",
      message: "pipeline unknown-pipeline not found",
    },
  });
});

test("pipeline_approve and pipeline_reject require pipelineId and stageId", async () => {
  const handlers = pipelineHandlers();

  for (const params of [{}, { pipelineId: "p1" }, { stageId: "gate" }]) {
    const approve = await handlers.pipeline_approve(
      requestFrame("approve-missing", "pipeline_approve", params),
      new AbortController().signal,
    );
    expect(approve).toEqual({
      kind: "error",
      code: "invalid_params",
      message: "pipelineId and stageId required",
    });

    const reject = await handlers.pipeline_reject(
      requestFrame("reject-missing", "pipeline_reject", params),
      new AbortController().signal,
    );
    expect(reject).toEqual({
      kind: "error",
      code: "invalid_params",
      message: "pipelineId and stageId required",
    });
  }

  const approve = await handlers.pipeline_approve(
    requestFrame("approve-unknown", "pipeline_approve", { pipelineId: "missing", stageId: "gate" }),
    new AbortController().signal,
  );
  expect(approve).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId: "missing", stageId: "gate", reason: "pipeline_not_found" },
  });
});

test("pipeline_resume requires pipelineId", async () => {
  const handlers = pipelineHandlers();

  for (const params of [{}, { pipelineId: "" }]) {
    const response = await handlers.pipeline_resume(
      requestFrame("resume-missing", "pipeline_resume", params),
      new AbortController().signal,
    );
    expect(response).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId required" });
  }

  const response = await handlers.pipeline_resume(
    requestFrame("resume-unknown", "pipeline_resume", { pipelineId: "missing-pipeline" }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId: "missing-pipeline", reason: "pipeline_not_found" },
  });
});

test("pipeline_resume forwards branchKey to resumePipeline when provided", async () => {
  const handlers = pipelineHandlers();
  const pipelineId = stateStore.createPipeline({
    definition: SINGLE_STAGE_DEFINITION,
    context: ADMISSION_CONTEXT,
  });
  stateStore.updateStage({
    pipelineId,
    stageId: "only",
    patch: { status: "succeeded", workflowInvocationId: "inv-1" },
  });

  const response = await handlers.pipeline_resume(
    requestFrame("resume-branch", "pipeline_resume", { pipelineId, branchKey: "unknown-branch" }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId, branchKey: "unknown-branch", reason: "branch_not_found" },
  });
});

test("pipeline_resume rejects malformed branchKey with invalid_params", async () => {
  const handlers = pipelineHandlers();

  for (const branchKey of ["", "   "]) {
    const response = await handlers.pipeline_resume(
      requestFrame("resume-blank", "pipeline_resume", { pipelineId: "any-pipeline", branchKey }),
      new AbortController().signal,
    );
    expect(response).toEqual({
      kind: "error",
      code: "invalid_params",
      message: "branchKey must be a non-blank string",
    });
  }

  const nonStringResponse = await handlers.pipeline_resume(
    requestFrame("resume-non-string", "pipeline_resume", { pipelineId: "any-pipeline", branchKey: 5 }),
    new AbortController().signal,
  );
  expect(nonStringResponse).toEqual({
    kind: "error",
    code: "invalid_params",
    message: "branchKey must be a non-blank string",
  });
});
