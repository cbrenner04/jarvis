import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunControlHandlers } from "../daemon/daemon.ts";
import { createStablePipelineDecisionHandlers } from "../daemon/daemon-stable-run-routing.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { connectIpcClient, type IpcClient } from "../ipc/client.ts";
import { type IpcServer, type RpcHandler, startIpcServer } from "../ipc/server.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { captureIo, cliMain } from "../testing/cli-test-helpers.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { doneWithArtifactBindingFactory, writeStepFixtures } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";

const { createWriteStep } = writeStepFixtures();

const PREDECESSOR_IDENTITY = "predecessor-generation";
const SUCCESSOR_IDENTITY = "successor-generation";
const PREDECESSOR_SOCKET_PATH = "/private/verb-routing-predecessor.sock";

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

function tempDbPath(label: string): string {
  return join(tmpdir(), `jarvis-verb-stable-routing-${label}-${process.pid}-${Date.now()}-${Math.random()}.db`);
}

function reopenAsAliveSuccessor(dbPath: string): StateStore {
  return openStateStore(dbPath, {
    currentIdentity: SUCCESSOR_IDENTITY,
    isOwnerAlive: async (identity) => identity === PREDECESSOR_IDENTITY,
  });
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
  const worktreePath = "/fake/worktree/stable-verb-recover";
  const branch = "plan/stable-verb-recover";
  const specPath = "spec/stable-verb-recover";
  const entryRunId = seedBlockedPlanDraftRun(store, {
    project: "demo",
    branch,
    worktreePath,
    specPath,
    stepId: "plan",
    invocationId: "stable-verb-recover-inv",
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

function seedLivePipeline(store: StateStore): string {
  const pipelineId = store.createPipeline({ definition: APPROVAL_DEFINITION, context: ADMISSION_CONTEXT });
  store.updateStage({ pipelineId, stageId: "s1", patch: { status: "running", workflowInvocationId: "inv-live" } });
  return pipelineId;
}

/** Answers exactly one `pipeline_owner` request as the draining direct predecessor still
 * recognizing itself as owner — matches `daemon-stable-run-routing.test.ts`'s `ownerClient` shape,
 * minimized to what `queryPredecessorPipelineOwner` reads. */
function predecessorOwnerClient(): IpcClient {
  let requestId: string | undefined;
  return {
    send(frame: unknown): void {
      requestId = (frame as { id?: string }).id;
    },
    async nextFrame() {
      await Promise.resolve();
      if (requestId === undefined) throw new Error("request not sent");
      return { kind: "response", id: requestId, result: { kind: "owner", ownerIdentity: PREDECESSOR_IDENTITY } };
    },
    close(): void {},
  };
}

const servers: IpcServer[] = [];
const dbPaths: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const dbPath of dbPaths.splice(0)) {
    rmSync(dbPath, { force: true });
  }
});

function stableSocketPath(): string {
  const scratch = join(process.cwd(), ".scratch");
  mkdirSync(scratch, { recursive: true });
  return join(scratch, `verb-routing-stable-${process.pid}-${crypto.randomUUID()}.sock`);
}

test("every pipeline verb reaches its pipeline through the stable address across a live draining-predecessor handoff", async () => {
  const dbPath = tempDbPath("handoff");
  dbPaths.push(dbPath);

  const seedStore = openStateStore(dbPath, { currentIdentity: PREDECESSOR_IDENTITY });
  const approvePipelineId = seedAwaitingGatePipeline(seedStore);
  const rejectPipelineId = seedAwaitingGatePipeline(seedStore);
  const resumePipelineId = seedApprovedGatePendingPipeline(seedStore);
  const recoverPipelineId = seedBlockedRecoverablePipeline(seedStore);
  const dismissPipelineId = seedLivePipeline(seedStore);
  const undismissPipelineId = seedLivePipeline(seedStore);
  seedStore.dismissPipeline({ pipelineId: undismissPipelineId });
  const entryRunId = seedStore
    .loadPipeline(recoverPipelineId)
    ?.stages.find((stage) => stage.stageId === "plan")?.workflowInvocationId;
  if (entryRunId === null || entryRunId === undefined) throw new Error("missing seeded entryRunId");
  seedStore.close();

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
    recoveryAttempt: async () => ({
      ok: true as const,
      kind: "complete" as const,
      stepIndex: 0,
      stepId: "plan-review",
      runId: entryRunId,
      iterationsConsumed: 1,
      resumable: false,
    }),
  });

  let predecessorQueries = 0;
  const decisionHandlers = createStablePipelineDecisionHandlers(
    {
      pipeline_approve: successorHandlers.pipeline_approve,
      pipeline_reject: successorHandlers.pipeline_reject,
      pipeline_resume: successorHandlers.pipeline_resume,
      pipeline_recover: successorHandlers.pipeline_recover,
    },
    {
      store,
      predecessorSocketPath: PREDECESSOR_SOCKET_PATH,
      connectOwnerClient: async () => {
        predecessorQueries += 1;
        return predecessorOwnerClient();
      },
    },
  );

  const stableHandlers: Record<string, RpcHandler> = {
    pipeline_list: successorHandlers.pipeline_list,
    pipeline_wait: successorHandlers.pipeline_wait,
    pipeline_dismiss: successorHandlers.pipeline_dismiss,
    pipeline_undismiss: successorHandlers.pipeline_undismiss,
    ...decisionHandlers,
  };
  const stablePath = stableSocketPath();
  const server = await startIpcServer(stablePath, stableHandlers);
  servers.push(server);

  const cliDeps = { connectIpcClient, socketPath: stablePath, socketDiscovery: async () => [] };

  const approveCap = captureIo();
  const approveCode = await cliMain(
    ["pipeline", "approve", approvePipelineId, "gate", "default"],
    approveCap.io,
    cliDeps,
  );
  expect(approveCap.read().stderr).not.toContain("pipeline_no_live_owner");
  expect(approveCode).toBe(0);
  await flushBackgroundRuns();
  await waitFor(
    () => store.loadPipeline(approvePipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "succeeded",
  );

  const rejectCap = captureIo();
  const rejectCode = await cliMain(["pipeline", "reject", rejectPipelineId, "gate", "default"], rejectCap.io, cliDeps);
  expect(rejectCap.read().stderr).not.toContain("pipeline_no_live_owner");
  expect(rejectCode).toBe(0);

  const resumeCap = captureIo();
  const resumeCode = await cliMain(["pipeline", "resume", resumePipelineId], resumeCap.io, cliDeps);
  expect(resumeCap.read().stderr).not.toContain("pipeline_no_live_owner");
  expect(resumeCode).toBe(0);
  await flushBackgroundRuns();
  await waitFor(
    () => store.loadPipeline(resumePipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "succeeded",
  );

  const recoverCap = captureIo();
  const recoverCode = await cliMain(["pipeline", "recover", recoverPipelineId, "default"], recoverCap.io, cliDeps);
  expect(recoverCap.read().stderr).not.toContain("pipeline_no_live_owner");
  expect(recoverCode).toBe(0);
  await flushBackgroundRuns();

  const dismissCap = captureIo();
  const dismissCode = await cliMain(["pipeline", "dismiss", dismissPipelineId], dismissCap.io, cliDeps);
  expect(dismissCap.read().stderr).not.toContain("pipeline_no_live_owner");
  expect(dismissCode).toBe(0);

  const undismissCap = captureIo();
  const undismissCode = await cliMain(["pipeline", "undismiss", undismissPipelineId], undismissCap.io, cliDeps);
  expect(undismissCap.read().stderr).not.toContain("pipeline_no_live_owner");
  expect(undismissCode).toBe(0);

  const waitCap = captureIo();
  const waitCode = await cliMain(["pipeline", "wait", approvePipelineId], waitCap.io, cliDeps);
  expect(waitCap.read().stderr).not.toContain("pipeline_no_live_owner");
  expect(waitCap.read().stdout).toBe(`${JSON.stringify({ kind: "terminal", state: "succeeded" })}\n`);
  expect(waitCode).toBe(0);

  // Every decision verb actually claimed a live predecessor's pipeline rather than finding it
  // already local — proves this exercised the handoff, not an incidental local-ownership path.
  expect(predecessorQueries).toBe(4);
  expect(store.loadPipeline(approvePipelineId)?.ownerIdentity).toBe(SUCCESSOR_IDENTITY);
  expect(store.loadPipeline(rejectPipelineId)?.ownerIdentity).toBe(SUCCESSOR_IDENTITY);
  expect(store.loadPipeline(resumePipelineId)?.ownerIdentity).toBe(SUCCESSOR_IDENTITY);
  expect(store.loadPipeline(recoverPipelineId)?.ownerIdentity).toBe(SUCCESSOR_IDENTITY);
  // dismiss/undismiss have no ownership gate at all, so they never claim the predecessor's pipeline.
  expect(store.loadPipeline(dismissPipelineId)?.ownerIdentity).toBe(PREDECESSOR_IDENTITY);
  expect(store.loadPipeline(undismissPipelineId)?.ownerIdentity).toBe(PREDECESSOR_IDENTITY);

  await flushBackgroundRuns();
  store.close();
});

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}
