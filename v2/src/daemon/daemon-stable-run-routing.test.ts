import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { IpcClient } from "../ipc/client.ts";
import type { RpcHandler } from "../ipc/server.ts";
import type { IpcFrame } from "../ipc/types.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { doneWithArtifactBindingFactory, writeStepFixtures } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
import {
  createStablePipelineDecisionHandlers,
  createStablePipelineListHandler,
  createStableRunHandlers,
} from "./daemon-stable-run-routing.ts";
import { PIPELINE_OWNER_RPC_TIMEOUT_MS, PIPELINE_UNREACHABLE_OWNER_RECOVERY } from "./pipeline-daemon-resolution.ts";
import type { PipelineSnapshot } from "./pipeline-observation.ts";

const { createWriteStep } = writeStepFixtures();

type Reply = { kind: "response"; result: unknown } | { kind: "error"; code: string; message: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function ownerClient(reply?: Reply, sendError?: Error) {
  const next = deferred<IpcFrame>();
  const afterReply = deferred<IpcFrame>();
  void next.promise.catch(() => undefined);
  void afterReply.promise.catch(() => undefined);
  const sent: unknown[] = [];
  let closeCount = 0;
  let requestId: string | undefined;
  let delivered = false;
  const client: IpcClient = {
    send(frame) {
      if (sendError !== undefined) throw sendError;
      sent.push(frame);
      requestId = (frame as { id?: string }).id;
      if (reply !== undefined && requestId !== undefined) {
        next.resolve({ ...reply, id: requestId } as IpcFrame);
      }
    },
    nextFrame: () => {
      if (!delivered) {
        delivered = true;
        return next.promise;
      }
      return afterReply.promise;
    },
    close() {
      closeCount += 1;
      const error = new Error("connection closed");
      next.reject(error);
      afterReply.reject(error);
    },
  };
  return {
    client,
    sent,
    closeCount: () => closeCount,
    respond(replyFrame: Reply) {
      if (requestId === undefined) throw new Error("request not sent");
      next.resolve({ ...replyFrame, id: requestId } as IpcFrame);
    },
  };
}

async function waitUntilSent(owner: ReturnType<typeof ownerClient>): Promise<void> {
  for (let turn = 0; turn < 10 && owner.sent.length === 0; turn += 1) await Promise.resolve();
  expect(owner.sent).toHaveLength(1);
}

function localHandlers(calls: string[]): Record<"wait" | "pause" | "kill", RpcHandler> {
  const local =
    (method: string): RpcHandler =>
    (frame) => {
      calls.push(method);
      return { kind: "response", result: { local: true, params: frame.params } };
    };
  return { wait: local("wait"), pause: local("pause"), kill: local("kill") };
}

function frame(method: "wait" | "pause" | "kill", params: unknown = { runId: "run-1" }) {
  return { kind: "request", id: `request-${method}`, method, params } as const;
}

async function rejectsConnect(): Promise<never> {
  throw new Error("must not connect");
}

const PREDECESSOR_SOCKET_PATH = "/private/predecessor.sock";

describe("stable run unary routing", () => {
  test("defers initial-empty ownership until refresh and routes to the direct owner", async () => {
    const refresh = deferred<boolean>();
    const owner = ownerClient({ kind: "response", result: { settled: true } });
    const localCalls: string[] = [];
    const handlers = createStableRunHandlers(localHandlers(localCalls), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: () => refresh.promise,
      connectOwnerClient: async () => owner.client,
    });

    const pending = handlers.wait(frame("wait"), new AbortController().signal);
    await Promise.resolve();
    expect(localCalls).toEqual([]);
    expect(owner.sent).toEqual([]);
    refresh.resolve(true);

    expect(await pending).toEqual({ kind: "response", result: { settled: true } });
    expect(owner.sent[0]).toMatchObject({ kind: "request", method: "wait", params: { runId: "run-1" } });
    expect(owner.closeCount()).toBe(1);
  });

  test("a transiently cleared snapshot refreshes to the owner without local refusal", async () => {
    let refreshes = 0;
    const owner = ownerClient({ kind: "response", result: { ok: true } });
    const localCalls: string[] = [];
    const handlers = createStableRunHandlers(localHandlers(localCalls), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => {
        refreshes += 1;
        return true;
      },
      connectOwnerClient: async () => owner.client,
    });

    expect(await handlers.kill(frame("kill"), new AbortController().signal)).toEqual({
      kind: "response",
      result: { ok: true },
    });
    expect(refreshes).toBe(1);
    expect(localCalls).toEqual([]);
  });

  test("a route-loss ownership refresh falls back to local handling instead of erroring", async () => {
    const localCalls: string[] = [];
    const handlers = createStableRunHandlers(localHandlers(localCalls), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => {
        throw new Error("ownership refresh failed");
      },
      connectOwnerClient: rejectsConnect,
    });

    expect(await handlers.wait(frame("wait"), new AbortController().signal)).toMatchObject({
      kind: "response",
      result: { local: true },
    });
    expect(localCalls).toEqual(["wait"]);
  });

  test("current owner wins and definitively unowned requests stay local", async () => {
    const localCalls: string[] = [];
    let resolves = 0;
    const local = localHandlers(localCalls);
    const current = createStableRunHandlers(local, {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => true,
      resolvePredecessorOwner: async () => {
        resolves += 1;
        return true;
      },
      connectOwnerClient: rejectsConnect,
    });
    const unowned = createStableRunHandlers(local, {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => {
        resolves += 1;
        return false;
      },
      connectOwnerClient: rejectsConnect,
    });

    await current.pause(frame("pause"), new AbortController().signal);
    await unowned.kill(frame("kill"), new AbortController().signal);
    expect(localCalls).toEqual(["pause", "kill"]);
    expect(resolves).toBe(1);
  });

  test("rechecks current ownership after refresh before forwarding", async () => {
    const refresh = deferred<boolean>();
    const localCalls: string[] = [];
    let localOwner = false;
    const handlers = createStableRunHandlers(localHandlers(localCalls), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => localOwner,
      resolvePredecessorOwner: () => refresh.promise,
      connectOwnerClient: rejectsConnect,
    });

    const pending = handlers.wait(frame("wait"), new AbortController().signal);
    localOwner = true;
    refresh.resolve(true);
    expect(await pending).toMatchObject({ kind: "response", result: { local: true } });
    expect(localCalls).toEqual(["wait"]);
  });

  test("pause preserves complete params and owner application errors unchanged", async () => {
    const owner = ownerClient({ kind: "error", code: "owner_refusal", message: "owner says no" });
    const handlers = createStableRunHandlers(localHandlers([]), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => true,
      connectOwnerClient: async () => owner.client,
    });
    const params = { runId: "run-1", futureField: { preserved: true } };

    expect(await handlers.pause(frame("pause", params), new AbortController().signal)).toEqual({
      kind: "error",
      code: "owner_refusal",
      message: "owner says no",
    });
    expect(owner.sent[0]).toMatchObject({ method: "pause", params });
    expect(owner.closeCount()).toBe(1);
  });

  test("closes private transports after send failure and caller cancellation", async () => {
    const sendFailure = ownerClient(undefined, new Error("send failed"));
    const cancelled = ownerClient();
    const clients = [sendFailure, cancelled];
    const handlers = createStableRunHandlers(localHandlers([]), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => true,
      connectOwnerClient: async () => {
        const next = clients.shift();
        if (next === undefined) throw new Error("missing client");
        return next.client;
      },
    });

    await expect(handlers.kill(frame("kill"), new AbortController().signal)).rejects.toThrow("IPC connection lost");
    expect(sendFailure.closeCount()).toBe(1);

    const controller = new AbortController();
    const pending = handlers.wait(frame("wait"), controller.signal);
    await waitUntilSent(cancelled);
    controller.abort();
    await expect(pending).rejects.toThrow("IPC connection lost");
    expect(cancelled.closeCount()).toBe(1);
  });

  test("an already-cancelled request closes its private transport without sending", async () => {
    const owner = ownerClient();
    const handlers = createStableRunHandlers(localHandlers([]), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => true,
      connectOwnerClient: async () => owner.client,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(handlers.wait(frame("wait"), controller.signal)).rejects.toThrow("request aborted");
    expect(owner.sent).toEqual([]);
    expect(owner.closeCount()).toBe(1);
  });

  test("concurrent waits own independent transports and cancellation closes only its wait", async () => {
    const first = ownerClient();
    const second = ownerClient();
    const clients = [first, second];
    const handlers = createStableRunHandlers(localHandlers([]), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      ownsRunLocally: () => false,
      resolvePredecessorOwner: async () => true,
      connectOwnerClient: async () => {
        const next = clients.shift();
        if (next === undefined) throw new Error("missing client");
        return next.client;
      },
    });
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    const firstWait = handlers.wait(frame("wait", { runId: "run-1" }), firstAbort.signal);
    const secondWait = handlers.wait(frame("wait", { runId: "run-2" }), secondAbort.signal);
    await waitUntilSent(first);
    await waitUntilSent(second);

    firstAbort.abort();
    await expect(firstWait).rejects.toThrow("IPC connection lost");
    expect(first.closeCount()).toBe(1);
    expect(second.closeCount()).toBe(0);
    second.respond({ kind: "response", result: { runStatus: "completed" } });
    expect(await secondWait).toEqual({ kind: "response", result: { runStatus: "completed" } });
    expect(second.closeCount()).toBe(1);
  });
});

function pipelineSnapshot(pipelineId: string, overrides: Partial<PipelineSnapshot> = {}): PipelineSnapshot {
  return {
    pipelineId,
    name: `name-${pipelineId}`,
    state: "running",
    terminalPublicationSucceededAt: null,
    terminalPublicationFailure: null,
    createdAt: 0,
    finishedAtMs: null,
    dismissedAt: null,
    stages: [],
    ...overrides,
  };
}

function pipelineListFrame(params?: unknown) {
  return { kind: "request", id: "pipeline_list-1", method: "pipeline_list", params } as const;
}

function localPipelineListHandler(pipelines: readonly PipelineSnapshot[]): RpcHandler {
  return () => ({ kind: "response", result: { pipelines } });
}

async function rejectsPredecessorConnect(): Promise<never> {
  throw new Error("connection refused");
}

describe("stable pipeline_list predecessor merge", () => {
  test("merges predecessor pipelines with local, local wins id collisions unchanged", async () => {
    const localP1 = pipelineSnapshot("p1", { name: "local-p1", dismissedAt: 5 });
    const localP2 = pipelineSnapshot("p2", { name: "local-only" });
    const predecessorP1 = pipelineSnapshot("p1", { name: "predecessor-p1" });
    const predecessorP3 = pipelineSnapshot("p3", { name: "predecessor-only" });
    const predecessor = ownerClient({
      kind: "response",
      result: { pipelines: [predecessorP1, predecessorP3] },
    });
    const handler = createStablePipelineListHandler(localPipelineListHandler([localP1, localP2]), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: async () => predecessor.client,
    });

    const reply = await handler(pipelineListFrame(), new AbortController().signal);

    expect(reply.kind).toBe("response");
    const pipelines = (reply as { kind: "response"; result: { pipelines: PipelineSnapshot[] } }).result.pipelines;
    expect(pipelines).toHaveLength(3);
    // Local wins the id collision, unchanged (same dismissedAt/state as the local snapshot).
    expect(pipelines.find((snapshot) => snapshot.pipelineId === "p1")).toEqual(localP1);
    expect(pipelines.find((snapshot) => snapshot.pipelineId === "p2")).toEqual(localP2);
    expect(pipelines.find((snapshot) => snapshot.pipelineId === "p3")).toEqual(predecessorP3);
    expect((reply as { result: { degraded?: unknown } }).result.degraded).toBeUndefined();
  });

  test("an unreachable predecessor yields local-only pipelines with degraded: true, not an error", async () => {
    const localP1 = pipelineSnapshot("p1");
    const handler = createStablePipelineListHandler(localPipelineListHandler([localP1]), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: rejectsPredecessorConnect,
    });

    const reply = await handler(pipelineListFrame(), new AbortController().signal);

    expect(reply).toEqual({ kind: "response", result: { pipelines: [localP1], degraded: true } });
  });

  test("a predecessor exceeding its own query timeout degrades like unreachable and replies within the outer CLI timeout", async () => {
    const localP1 = pipelineSnapshot("p1");
    const hungPredecessor = ownerClient();
    const handler = createStablePipelineListHandler(localPipelineListHandler([localP1]), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: async () => hungPredecessor.client,
    });

    const startedAt = Date.now();
    const reply = await handler(pipelineListFrame(), new AbortController().signal);
    expect(Date.now() - startedAt).toBeLessThan(PIPELINE_OWNER_RPC_TIMEOUT_MS);
    expect(reply).toEqual({ kind: "response", result: { pipelines: [localP1], degraded: true } });
  });

  test("forwards includeDismissed and sinceMs unchanged, and sinceMs: 0 keeps a predecessor-only terminal pipeline", async () => {
    const predecessorTerminal = pipelineSnapshot("p-terminal", {
      state: "succeeded",
      dismissedAt: 10,
      finishedAtMs: 10,
    });
    const predecessor = ownerClient({ kind: "response", result: { pipelines: [predecessorTerminal] } });
    const handler = createStablePipelineListHandler(localPipelineListHandler([]), {
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: async () => predecessor.client,
    });

    const reply = await handler(
      pipelineListFrame({ includeDismissed: true, sinceMs: 0 }),
      new AbortController().signal,
    );

    expect(predecessor.sent[0]).toMatchObject({
      method: "pipeline_list",
      params: { includeDismissed: true, sinceMs: 0 },
    });
    expect(reply).toEqual({ kind: "response", result: { pipelines: [predecessorTerminal] } });
  });
});

const PREDECESSOR_IDENTITY = "predecessor-generation";
const SUCCESSOR_IDENTITY = "successor-generation";

const APPROVAL_DEFINITION: PipelineDefinition = {
  name: "approval",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

const RECOVER_DEFINITION: PipelineDefinition = {
  name: "recover",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "debate" },
  ],
};

const ADMISSION_CONTEXT = { cwd: "/fake", seed: "seed text", configPath: "/fake/.jarvis/config.json" };

function decisionFrame(id: string, method: string, params: unknown) {
  return { kind: "request", id, method, params } as const;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

/** Seeds durable rows under a `predecessor` identity, then closes that connection — matching this
 * repo's cross-generation test convention (`daemon-pipeline-owner.test.ts`) of sequential
 * open/close rather than two simultaneous connections to the same db file. Pair with
 * `reopenAsAliveSuccessor` to continue as the incoming generation. */
function seedAsPredecessor(dbPath: string, seed: (store: StateStore) => string): string {
  const seedStore = openStateStore(dbPath, { currentIdentity: PREDECESSOR_IDENTITY });
  const pipelineId = seed(seedStore);
  seedStore.close();
  return pipelineId;
}

function reopenAsAliveSuccessor(dbPath: string): StateStore {
  return openStateStore(dbPath, {
    currentIdentity: SUCCESSOR_IDENTITY,
    isOwnerAlive: async (identity) => identity === PREDECESSOR_IDENTITY,
  });
}

function tempDbPath(label: string): string {
  return join(tmpdir(), `jarvis-stable-pipeline-decision-${label}-${process.pid}-${Date.now()}-${Math.random()}.db`);
}

function seedAwaitingGatePipeline(store: StateStore): string {
  const pipelineId = store.createPipeline({ definition: APPROVAL_DEFINITION, context: ADMISSION_CONTEXT });
  store.updateStage({ pipelineId, stageId: "s1", patch: { status: "succeeded", workflowInvocationId: "inv-1" } });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
  return pipelineId;
}

function seedApprovedGatePendingPipeline(store: StateStore): string {
  const pipelineId = store.createPipeline({ definition: APPROVAL_DEFINITION, context: ADMISSION_CONTEXT });
  store.updateStage({ pipelineId, stageId: "s1", patch: { status: "succeeded", workflowInvocationId: "inv-1" } });
  store.updateStage({ pipelineId, stageId: "gate", patch: { status: "approved" } });
  return pipelineId;
}

/** Durable run row for a blocked plan-draft — the shape a recovery target's linked entry run resolves to. */
function seedBlockedPlanDraftRun(
  store: StateStore,
  args: {
    project: string;
    branch: string;
    worktreePath: string;
    specPath: string;
    stepId: string;
    invocationId: string;
  },
): string {
  const runId = store.createRun({
    project: args.project,
    specRef: "HEAD",
    worktreePath: args.worktreePath,
    branch: args.branch,
    specPath: args.specPath,
    stepId: args.stepId,
    workflowSnapshot: {
      invocationId: args.invocationId,
      steps: [
        {
          stepId: args.stepId,
          role: "plan",
          expectedArtifactPath: ".jarvis-plan-stage",
          agents: ["claude"],
          landingInputs: { sourceRoot: args.worktreePath, paths: [], consumeFrom: "worktree" },
        },
        { stepId: "plan-review", role: "", behavior: "review" },
      ],
    },
  });
  const attemptId = store.recordAttemptStart(runId);
  store.commitCompletionBoundary({ attemptId, runStatus: "blocked", outcomeKind: "contract_miss" });
  return runId;
}

function seedBlockedRecoverablePipeline(store: StateStore): string {
  const worktreePath = "/fake/worktree/stable-recover";
  const branch = "plan/stable-recover";
  const specPath = "spec/stable-recover";
  const entryRunId = seedBlockedPlanDraftRun(store, {
    project: "demo",
    branch,
    worktreePath,
    specPath,
    stepId: "plan",
    invocationId: "stable-recover-inv",
  });
  const pipelineId = store.createPipeline({ definition: RECOVER_DEFINITION, context: ADMISSION_CONTEXT });
  store.updateStage({
    pipelineId,
    stageId: "intent",
    patch: { status: "succeeded", workflowInvocationId: "run-intent" },
  });
  store.updateStage({
    pipelineId,
    stageId: "plan",
    patch: { status: "failed", workflowInvocationId: entryRunId, failureDetail: { message: "blocked" } },
  });
  return pipelineId;
}

function completeRecoveryOutcome(entryRunId: string) {
  return {
    ok: true as const,
    kind: "complete" as const,
    stepIndex: 0,
    stepId: "plan-review",
    runId: entryRunId,
    iterationsConsumed: 1,
    resumable: false,
  };
}

type PipelineOwnershipStore = Pick<
  StateStore,
  "currentOwnerIdentity" | "loadPipeline" | "adoptOrphanedPipeline" | "claimPipelineContinuation"
>;

function wrapDecisionHandlers(
  handlers: ReturnType<typeof createRunControlHandlers>,
  deps: {
    store: PipelineOwnershipStore;
    predecessorSocketPath: string | undefined;
    connectOwnerClient: (socketPath: string) => Promise<IpcClient>;
  },
) {
  return createStablePipelineDecisionHandlers(
    {
      pipeline_approve: handlers.pipeline_approve,
      pipeline_reject: handlers.pipeline_reject,
      pipeline_resume: handlers.pipeline_resume,
      pipeline_recover: handlers.pipeline_recover,
    },
    deps,
  );
}

function ownsPredecessorReply(): Reply {
  return { kind: "response", result: { kind: "owner", ownerIdentity: PREDECESSOR_IDENTITY } };
}

describe("stable pipeline decision-verb ownership claim", () => {
  test("a pipeline already owned by this generation proceeds without querying any predecessor", async () => {
    const dbPath = tempDbPath("already-owned");
    const store = openStateStore(dbPath, { currentIdentity: SUCCESSOR_IDENTITY });
    const pipelineId = seedAwaitingGatePipeline(store);
    const successorHandlers = createRunControlHandlers({
      stateStore: store,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async (_definition, stageIndex) => ({
        ok: true,
        steps: stageIndex === 2 ? [createWriteStep("s3-write", "pipeline-branch", doneWithArtifactBindingFactory)] : [],
      }),
    });
    let connectCalls = 0;
    const wrapped = wrapDecisionHandlers(successorHandlers, {
      store,
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: async () => {
        connectCalls += 1;
        throw new Error("must not connect: already owned locally");
      },
    });

    const response = await wrapped.pipeline_approve(
      decisionFrame("approve", "pipeline_approve", { pipelineId, stageId: "gate", branchKey: "default" }),
      new AbortController().signal,
    );

    expect(response).toEqual({
      kind: "response",
      result: { kind: "applied", pipelineId, stageId: "gate", decision: "approved" },
    });
    expect(connectCalls).toBe(0);
    await waitFor(() => store.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "succeeded");
    await flushBackgroundRuns();
    store.close();
  });

  test("pipeline_approve claims a live draining predecessor's pipeline before dispatching the successor stage", async () => {
    const dbPath = tempDbPath("approve");
    const pipelineId = seedAsPredecessor(dbPath, seedAwaitingGatePipeline);
    const store = reopenAsAliveSuccessor(dbPath);
    const successorHandlers = createRunControlHandlers({
      stateStore: store,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async (_definition, stageIndex) => ({
        ok: true,
        steps: stageIndex === 2 ? [createWriteStep("s3-write", "pipeline-branch", doneWithArtifactBindingFactory)] : [],
      }),
    });
    const predecessor = ownerClient(ownsPredecessorReply());
    const wrapped = wrapDecisionHandlers(successorHandlers, {
      store,
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: async () => predecessor.client,
    });

    const response = await wrapped.pipeline_approve(
      decisionFrame("approve", "pipeline_approve", { pipelineId, stageId: "gate", branchKey: "default" }),
      new AbortController().signal,
    );

    expect(response).toEqual({
      kind: "response",
      result: { kind: "applied", pipelineId, stageId: "gate", decision: "approved" },
    });
    // Proves the claim actually queried the predecessor first, not merely that ownership ended up
    // here as an incidental side effect of the local handler's own unrelated continuation claim.
    expect(predecessor.sent).toHaveLength(1);
    expect(store.loadPipeline(pipelineId)?.ownerIdentity).toBe(SUCCESSOR_IDENTITY);
    await waitFor(() => store.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "succeeded");
    await flushBackgroundRuns();
    store.close();
  });

  test("pipeline_reject claims a live draining predecessor's pipeline before applying the decision", async () => {
    const dbPath = tempDbPath("reject");
    const pipelineId = seedAsPredecessor(dbPath, seedAwaitingGatePipeline);
    const store = reopenAsAliveSuccessor(dbPath);
    const successorHandlers = createRunControlHandlers({
      stateStore: store,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async () => ({ ok: true, steps: [] }),
    });
    const predecessor = ownerClient(ownsPredecessorReply());
    const wrapped = wrapDecisionHandlers(successorHandlers, {
      store,
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: async () => predecessor.client,
    });

    const response = await wrapped.pipeline_reject(
      decisionFrame("reject", "pipeline_reject", { pipelineId, stageId: "gate", branchKey: "default" }),
      new AbortController().signal,
    );

    expect(response).toEqual({
      kind: "response",
      result: { kind: "applied", pipelineId, stageId: "gate", decision: "rejected" },
    });
    expect(predecessor.sent).toHaveLength(1);
    expect(store.loadPipeline(pipelineId)?.ownerIdentity).toBe(SUCCESSOR_IDENTITY);
    store.close();
  });

  test("pipeline_resume claims a live draining predecessor's pipeline before dispatching the successor stage", async () => {
    const dbPath = tempDbPath("resume");
    const pipelineId = seedAsPredecessor(dbPath, seedApprovedGatePendingPipeline);
    const store = reopenAsAliveSuccessor(dbPath);
    const successorHandlers = createRunControlHandlers({
      stateStore: store,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async (_definition, stageIndex) => ({
        ok: true,
        steps: stageIndex === 2 ? [createWriteStep("s3-write", "pipeline-branch", doneWithArtifactBindingFactory)] : [],
      }),
    });
    const predecessor = ownerClient(ownsPredecessorReply());
    const wrapped = wrapDecisionHandlers(successorHandlers, {
      store,
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: async () => predecessor.client,
    });

    const response = await wrapped.pipeline_resume(
      decisionFrame("resume", "pipeline_resume", { pipelineId }),
      new AbortController().signal,
    );

    expect(response).toEqual({ kind: "response", result: { kind: "resumed", pipelineId } });
    expect(predecessor.sent).toHaveLength(1);
    await waitFor(() => store.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "succeeded");
    expect(store.loadPipeline(pipelineId)?.ownerIdentity).toBe(SUCCESSOR_IDENTITY);
    await flushBackgroundRuns();
    store.close();
  });

  test("pipeline_recover claims a live draining predecessor's pipeline before admitting recovery", async () => {
    const dbPath = tempDbPath("recover");
    const pipelineId = seedAsPredecessor(dbPath, seedBlockedRecoverablePipeline);
    const store = reopenAsAliveSuccessor(dbPath);
    const entryRunId = store.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "plan")?.workflowInvocationId;
    if (entryRunId === null || entryRunId === undefined) throw new Error("missing seeded entryRunId");
    let settleAttempt!: () => void;
    const attemptSettled = new Promise<void>((resolve) => {
      settleAttempt = resolve;
    });
    const successorHandlers = createRunControlHandlers({
      stateStore: store,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      recoveryAttempt: async () => {
        const outcome = completeRecoveryOutcome(entryRunId);
        settleAttempt();
        return outcome;
      },
    });
    const predecessor = ownerClient(ownsPredecessorReply());
    const wrapped = wrapDecisionHandlers(successorHandlers, {
      store,
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: async () => predecessor.client,
    });

    const response = await wrapped.pipeline_recover(
      decisionFrame("recover", "pipeline_recover", { pipelineId, branchKey: "default" }),
      new AbortController().signal,
    );

    expect(response).toEqual({
      kind: "response",
      result: { kind: "admitted", pipelineId, branchKey: "default", stageId: "plan", entryRunId },
    });
    expect(predecessor.sent).toHaveLength(1);
    expect(store.loadPipeline(pipelineId)?.ownerIdentity).toBe(SUCCESSOR_IDENTITY);
    await attemptSettled;
    await flushBackgroundRuns(5);
    expect(store.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "plan")?.status).toBe("succeeded");
    store.close();
  });

  test("two concurrent decision-verb calls race the ownership claim; exactly one wins and the successor stage dispatches once", async () => {
    const dbPath = tempDbPath("concurrency");
    const pipelineId = seedAsPredecessor(dbPath, seedAwaitingGatePipeline);
    const store = reopenAsAliveSuccessor(dbPath);
    const successorHandlers = createRunControlHandlers({
      stateStore: store,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async (_definition, stageIndex) => ({
        ok: true,
        steps: stageIndex === 2 ? [createWriteStep("s3-write", "pipeline-branch", doneWithArtifactBindingFactory)] : [],
      }),
    });

    let predecessorQueries = 0;
    const claimOutcomes: Array<{ kind: string; reason?: string }> = [];
    const claimTrackingStore: PipelineOwnershipStore = {
      currentOwnerIdentity: () => store.currentOwnerIdentity(),
      loadPipeline: (id) => store.loadPipeline(id),
      adoptOrphanedPipeline: (id) => store.adoptOrphanedPipeline(id),
      claimPipelineContinuation: (args) => {
        const outcome = store.claimPipelineContinuation(args);
        claimOutcomes.push(outcome);
        return outcome;
      },
    };
    const wrapped = wrapDecisionHandlers(successorHandlers, {
      store: claimTrackingStore,
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: async () => {
        predecessorQueries += 1;
        return ownerClient(ownsPredecessorReply()).client;
      },
    });

    const [r1, r2] = await Promise.all([
      wrapped.pipeline_approve(
        decisionFrame("a1", "pipeline_approve", { pipelineId, stageId: "gate", branchKey: "default" }),
        new AbortController().signal,
      ),
      wrapped.pipeline_approve(
        decisionFrame("a2", "pipeline_approve", { pipelineId, stageId: "gate", branchKey: "default" }),
        new AbortController().signal,
      ),
    ]);

    // Exactly one ownership claim applies; the concurrent loser hits `claimPipelineContinuation`'s
    // existing CAS-loss path (`stale_owner`/`claim_lost`) and re-resolves against the winner's row.
    expect(claimOutcomes).toHaveLength(2);
    expect(claimOutcomes.filter((outcome) => outcome.kind === "applied")).toHaveLength(1);
    const lost = claimOutcomes.filter((outcome) => outcome.kind === "refused");
    expect(lost).toHaveLength(1);
    expect(lost[0]?.reason === "stale_owner" || lost[0]?.reason === "claim_lost").toBe(true);
    expect(predecessorQueries).toBe(2);
    expect(store.loadPipeline(pipelineId)?.ownerIdentity).toBe(SUCCESSOR_IDENTITY);

    // Both callers proceed to the pre-existing, untouched local handler; its own approval CAS —
    // not the ownership claim above — is what dedupes the decision itself and the dispatch it triggers.
    const responses = [r1, r2] as Array<{ kind: string; result?: { kind?: string; reason?: string } }>;
    const applied = responses.filter((response) => response.result?.kind === "applied");
    const refused = responses.filter((response) => response.result?.kind === "refused");
    expect(applied).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.result?.reason).toBe("status_not_awaiting");

    await waitFor(() => store.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "succeeded");
    await flushBackgroundRuns();
    store.close();
  });

  test("a claim that still loses on retry refuses after exactly one retry, never proceeding on the initial loss", async () => {
    const dbPath = tempDbPath("persistent-claim-loss");
    const pipelineId = seedAsPredecessor(dbPath, seedAwaitingGatePipeline);
    const store = reopenAsAliveSuccessor(dbPath);
    const successorHandlers = createRunControlHandlers({
      stateStore: store,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async () => ({ ok: true, steps: [] }),
    });
    let claimCalls = 0;
    const alwaysLosingStore: PipelineOwnershipStore = {
      currentOwnerIdentity: () => store.currentOwnerIdentity(),
      loadPipeline: (id) => store.loadPipeline(id),
      adoptOrphanedPipeline: (id) => store.adoptOrphanedPipeline(id),
      claimPipelineContinuation: (args) => {
        claimCalls += 1;
        return { kind: "refused", pipelineId: args.pipelineId, reason: "stale_owner" };
      },
    };
    let predecessorQueries = 0;
    const wrapped = wrapDecisionHandlers(successorHandlers, {
      store: alwaysLosingStore,
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: async () => {
        predecessorQueries += 1;
        return ownerClient(ownsPredecessorReply()).client;
      },
    });

    const response = await wrapped.pipeline_approve(
      decisionFrame("approve", "pipeline_approve", { pipelineId, stageId: "gate", branchKey: "default" }),
      new AbortController().signal,
    );

    // A claim that keeps losing (never "applied") must retry once, then refuse — not proceed on
    // the first loss, which would leave the local handler running against a pipeline this
    // generation was never actually granted.
    expect(response).toEqual({
      kind: "error",
      code: "pipeline_no_live_owner",
      message: `Pipeline ${pipelineId} has no reachable live owner; ${PIPELINE_UNREACHABLE_OWNER_RECOVERY}.`,
    });
    expect(claimCalls).toBe(2);
    expect(predecessorQueries).toBe(2);
    expect(store.loadPipeline(pipelineId)?.ownerIdentity).toBe(PREDECESSOR_IDENTITY);
    store.close();
  });

  test("an unreachable predecessor during the confirming query refuses without ever adopting", async () => {
    const dbPath = tempDbPath("unreachable");
    const pipelineId = seedAsPredecessor(dbPath, seedAwaitingGatePipeline);
    const store = reopenAsAliveSuccessor(dbPath);
    const successorHandlers = createRunControlHandlers({
      stateStore: store,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async () => ({ ok: true, steps: [] }),
    });
    const wrapped = wrapDecisionHandlers(successorHandlers, {
      store,
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: async () => {
        throw new Error("connection refused");
      },
    });

    const response = await wrapped.pipeline_approve(
      decisionFrame("approve", "pipeline_approve", { pipelineId, stageId: "gate", branchKey: "default" }),
      new AbortController().signal,
    );

    expect(response).toEqual({
      kind: "error",
      code: "pipeline_no_live_owner",
      message: `Pipeline ${pipelineId} has no reachable live owner; ${PIPELINE_UNREACHABLE_OWNER_RECOVERY}.`,
    });
    expect(store.loadPipeline(pipelineId)?.ownerIdentity).toBe(PREDECESSOR_IDENTITY);
    store.close();
  });

  test("a genuinely ownerless pipeline with no predecessor configured refuses without connecting anywhere", async () => {
    const dbPath = tempDbPath("no-predecessor");
    const pipelineId = seedAsPredecessor(dbPath, seedAwaitingGatePipeline);
    const store = reopenAsAliveSuccessor(dbPath);
    const successorHandlers = createRunControlHandlers({
      stateStore: store,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async () => ({ ok: true, steps: [] }),
    });
    let connectCalls = 0;
    const wrapped = wrapDecisionHandlers(successorHandlers, {
      store,
      predecessorSocketPath: undefined,
      connectOwnerClient: async () => {
        connectCalls += 1;
        throw new Error("must not connect: no predecessor configured");
      },
    });

    const response = await wrapped.pipeline_approve(
      decisionFrame("approve", "pipeline_approve", { pipelineId, stageId: "gate", branchKey: "default" }),
      new AbortController().signal,
    );

    expect(response).toEqual({
      kind: "error",
      code: "pipeline_no_live_owner",
      message: `Pipeline ${pipelineId} has no reachable live owner; ${PIPELINE_UNREACHABLE_OWNER_RECOVERY}.`,
    });
    expect(connectCalls).toBe(0);
    expect(store.loadPipeline(pipelineId)?.ownerIdentity).toBe(PREDECESSOR_IDENTITY);
    store.close();
  });

  test("a predecessor answering anything but a matching owner refuses without claiming, querying exactly once", async () => {
    for (const reply of [
      { kind: "response", result: { kind: "not_owner" } } as Reply,
      { kind: "response", result: { kind: "owner", ownerIdentity: "someone-else" } } as Reply,
    ]) {
      const dbPath = tempDbPath(`mismatch-${reply.kind}-${Math.random()}`);
      const pipelineId = seedAsPredecessor(dbPath, seedAwaitingGatePipeline);
      const store = reopenAsAliveSuccessor(dbPath);
      const successorHandlers = createRunControlHandlers({
        stateStore: store,
        writeLoopExecutor: createFakeWriteLoopExecutor().executor,
        failureReporter: () => {},
        hasMemoryHeadroom: () => true,
        resolveStage: async () => ({ ok: true, steps: [] }),
      });
      const predecessor = ownerClient(reply);
      const wrapped = wrapDecisionHandlers(successorHandlers, {
        store,
        predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
        connectOwnerClient: async () => predecessor.client,
      });

      const response = await wrapped.pipeline_approve(
        decisionFrame("approve", "pipeline_approve", { pipelineId, stageId: "gate", branchKey: "default" }),
        new AbortController().signal,
      );

      expect(response).toEqual({
        kind: "error",
        code: "pipeline_no_live_owner",
        message: `Pipeline ${pipelineId} has no reachable live owner; ${PIPELINE_UNREACHABLE_OWNER_RECOVERY}.`,
      });
      expect(predecessor.sent).toHaveLength(1);
      expect(store.loadPipeline(pipelineId)?.ownerIdentity).toBe(PREDECESSOR_IDENTITY);
      store.close();
    }
  });
});
