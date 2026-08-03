import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { AnyWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { createBindingFactory, writeStepFixtures } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor, type FakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers, type OwnershipKey } from "./daemon.ts";
import {
  destinationDistinctFromPredecessor,
  predecessorOwnershipKey,
  resolveStageWorkflowSteps,
  type PipelineStageResolutionResult,
  workflowStageOwnershipKey,
} from "./pipeline-stage-resolve.ts";
import { runPipeline } from "./pipeline-execution.ts";
import type { PipelineStageArtifact } from "./pipeline-stage-dispatch.ts";

const { createWriteStep } = writeStepFixtures();

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

function controllableBindingFactory(): {
  factory: NonNullable<WriteWorkflowStep["createBinding"]>;
  settle: () => void;
} {
  let settleFn: (() => void) | undefined;
  const factory = createBindingFactory(
    ({ cwd }) =>
      new Promise<InvocationResult>((resolve) => {
        settleFn = () => {
          writeFileSync(join(cwd, "proof.txt"), "done\n", "utf8");
          resolve({ kind: "ok", stdout: "done", stderr: "" } as const);
        };
      }),
  );
  return { factory, settle: () => settleFn?.() };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

function initGitRepo(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
}

function createFanOutRepo(): {
  repoRoot: string;
  configPath: string;
  intentBranch: string;
  intentWorktree: string;
  readyA: string;
  readyB: string;
} {
  const repoRoot = mkdtempSync(join(tmpdir(), "jarvis-fan-out-approval-repo-"));
  initGitRepo(repoRoot);
  writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repoRoot });

  const intentBranch = "intent/split";
  const intentWorktree = join(repoRoot, ".jarvis-worktrees", intentBranch);
  const readyA = "spec/ready-intents/alpha.md";
  const readyB = "spec/ready-intents/beta.md";
  execFileSync("git", ["branch", intentBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", intentWorktree, intentBranch], { cwd: repoRoot });
  mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
  writeFileSync(join(intentWorktree, readyA), "---\nname: alpha\n---\n## Prerequisites\n", "utf8");
  writeFileSync(join(intentWorktree, readyB), "---\nname: beta\n---\n## Prerequisites\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: intentWorktree });
  execFileSync("git", ["commit", "-qm", "intent"], { cwd: intentWorktree });

  const configPath = writeHomeMachineConfig({ projects: { demo: { root: repoRoot } } });
  return { repoRoot, configPath, intentBranch, intentWorktree, readyA, readyB };
}

const FAN_OUT_LINEAR_DEFINITION: PipelineDefinition = {
  name: "fan-out-linear",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

const ADMISSION_CONTEXT = {
  cwd: "/fake",
  seed: "seed text",
  configPath: "/fake/.jarvis/config.json",
};

const APPROVAL_DEFINITION: PipelineDefinition = {
  name: "approval",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

let stateStore: StateStore;
let fakeExecutor: FakeWriteLoopExecutor;
let handlers: ReturnType<typeof createRunControlHandlers>;

beforeEach(() => {
  stateStore = openStateStore(
    join(tmpdir(), `jarvis-pipeline-approval-${process.pid}-${Date.now()}-${Math.random()}.db`),
  );
  fakeExecutor = createFakeWriteLoopExecutor();
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => ({ ok: true, steps: [] }),
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

test("missing or empty pipelineId or stageId returns invalid_params", async () => {
  for (const params of [
    {},
    { pipelineId: "p1" },
    { stageId: "gate" },
    { pipelineId: "", stageId: "gate" },
    { pipelineId: "p1", stageId: "" },
  ]) {
    const approve = await handlers.pipeline_approve(
      requestFrame("a", "pipeline_approve", params),
      new AbortController().signal,
    );
    expect(approve).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId and stageId required" });

    const reject = await handlers.pipeline_reject(
      requestFrame("r", "pipeline_reject", params),
      new AbortController().signal,
    );
    expect(reject).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId and stageId required" });
  }
});

test("setRetiring rejects approve and reject with daemon_superseded", async () => {
  handlers.setRetiring();

  const approve = await handlers.pipeline_approve(
    requestFrame("a", "pipeline_approve", { pipelineId: "p1", stageId: "gate" }),
    new AbortController().signal,
  );
  expect(approve).toEqual({
    kind: "error",
    code: "daemon_superseded",
    message: "Daemon is retiring and not accepting new work",
  });

  const reject = await handlers.pipeline_reject(
    requestFrame("r", "pipeline_reject", { pipelineId: "p1", stageId: "gate" }),
    new AbortController().signal,
  );
  expect(reject).toEqual({
    kind: "error",
    code: "daemon_superseded",
    message: "Daemon is retiring and not accepting new work",
  });
});

test("pipeline_approve returns after the durable write before async continuation runs", async () => {
  const stage1 = controllableBindingFactory();
  const stage3 = controllableBindingFactory();
  const stage1Step: AnyWorkflowStep = createWriteStep("stage-1", "pipeline-branch", stage1.factory, {
    suppressShrink: true,
  });
  const stage3Step: AnyWorkflowStep = createWriteStep("stage-3", "pipeline-branch", stage3.factory, {
    suppressShrink: true,
  });

  const resolveStage = async (
    _definition: PipelineDefinition,
    stageIndex: number,
  ): Promise<PipelineStageResolutionResult> => ({
    ok: true,
    steps: [stageIndex === 0 ? stage1Step : stage3Step],
  });

  const approvalHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage,
  });

  const startResponse = await approvalHandlers.pipeline_start(
    requestFrame("start", "pipeline_start", { definition: APPROVAL_DEFINITION, context: ADMISSION_CONTEXT }),
    new AbortController().signal,
  );
  expect(startResponse.kind).toBe("response");
  const pipelineId = (startResponse as { result: { pipelineId: string } }).result.pipelineId;

  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s1")?.status === "running",
  );
  stage1.settle();
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "gate")?.status === "awaiting",
  );

  const approveResponse = await approvalHandlers.pipeline_approve(
    requestFrame("approve", "pipeline_approve", { pipelineId, stageId: "gate" }),
    new AbortController().signal,
  );
  expect(approveResponse).toEqual({
    kind: "response",
    result: { kind: "applied", pipelineId, stageId: "gate", decision: "approved" },
  });
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "gate")?.status).toBe("approved");
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status).toBe("pending");

  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "running",
  );
  stage3.settle();
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status === "succeeded",
  );
  await flushBackgroundRuns();
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s3")?.status).toBe("succeeded");
});

test("pipeline_approve returns refused envelope for unknown pipeline", async () => {
  const response = await handlers.pipeline_approve(
    requestFrame("approve", "pipeline_approve", { pipelineId: "missing", stageId: "gate" }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId: "missing", stageId: "gate", reason: "pipeline_not_found" },
  });
});

test("pipeline_reject returns refused envelope for non-awaiting gate", async () => {
  const stage1 = controllableBindingFactory();
  const stage1Step: AnyWorkflowStep = createWriteStep("stage-1", "pipeline-branch", stage1.factory, {
    suppressShrink: true,
  });
  const approvalHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => ({ ok: true, steps: [stage1Step] }),
  });

  const startResponse = await approvalHandlers.pipeline_start(
    requestFrame("start", "pipeline_start", { definition: APPROVAL_DEFINITION, context: ADMISSION_CONTEXT }),
    new AbortController().signal,
  );
  expect(startResponse.kind).toBe("response");
  const pipelineId = (startResponse as { result: { pipelineId: string } }).result.pipelineId;

  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "s1")?.status === "running",
  );
  stage1.settle();
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "gate")?.status === "awaiting",
  );

  const approveResponse = await approvalHandlers.pipeline_approve(
    requestFrame("approve", "pipeline_approve", { pipelineId, stageId: "gate" }),
    new AbortController().signal,
  );
  expect(approveResponse.kind).toBe("response");
  await flushBackgroundRuns();

  const rejectResponse = await approvalHandlers.pipeline_reject(
    requestFrame("reject", "pipeline_reject", { pipelineId, stageId: "gate" }),
    new AbortController().signal,
  );
  expect(rejectResponse).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId, stageId: "gate", reason: "status_not_awaiting" },
  });
});

test("concurrent approved sibling branches own destination worktrees", async () => {
  const localStore = openStateStore(
    join(tmpdir(), `jarvis-fan-out-concurrent-${process.pid}-${Date.now()}-${Math.random()}.db`),
  );
  const localExecutor = createFakeWriteLoopExecutor();
  try {
  const { repoRoot, configPath, intentBranch, intentWorktree, readyA, readyB } = createFanOutRepo();
  const context = { cwd: repoRoot, configPath, seed: "split alpha and beta" };
  const planWaits = new Map<string, ReturnType<typeof deferred<"completed">>>();
  const barrierSlots: Array<{ ownershipKey: OwnershipKey; steps: readonly AnyWorkflowStep[] }> = [];
  let releaseBarrier: () => void = () => undefined;
  const admissionBarrier = new Promise<void>((resolve) => {
    releaseBarrier = () => resolve();
  });

  const baseHandlers = createRunControlHandlers({
    stateStore: localStore,
    writeLoopExecutor: localExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    onPipelineWorkflowStartAdmission: async ({ steps, ownershipKey }) => {
      if (!ownershipKey.branch.startsWith("plan/")) return;
      barrierSlots.push({ ownershipKey, steps });
      if (barrierSlots.length === 2) {
        const predecessor = predecessorOwnershipKey("demo", intentBranch);
        expect(new Set(barrierSlots.map((slot) => `${slot.ownershipKey.project}:${slot.ownershipKey.branch}`)).size).toBe(
          2,
        );
        for (const slot of barrierSlots) {
          expect(destinationDistinctFromPredecessor(slot.ownershipKey, predecessor)).toBe(true);
          expect(workflowStageOwnershipKey(slot.steps).branch).not.toBe(intentBranch);
          const writeStep = slot.steps.find((step) => step.behavior === "write");
          if (writeStep?.behavior === "write" && writeStep.landing?.kind === "plan-tree") {
            const inputPath = writeStep.landing.inputs?.paths?.[0];
            expect(inputPath).toBeDefined();
            expect(existsSync(inputPath as string)).toBe(true);
            expect((inputPath as string).startsWith(intentWorktree)).toBe(true);
          }
        }
        releaseBarrier();
      }
      await admissionBarrier;
    },
    pipelineWait: async (entryRunId) => {
      const run = localStore.loadRun(entryRunId);
      if (run?.branch?.startsWith("plan/")) {
        const pending = deferred<"completed">();
        planWaits.set(entryRunId, pending);
        return pending.promise;
      }
      if (run?.branch?.startsWith("implement/")) {
        return "completed";
      }
      localStore.setRunSpecPath(entryRunId, "spec/ready-intents");
      localStore.setRunDownstreamInputs(entryRunId, [readyA, readyB]);
      return "completed";
    },
  });

  const intentRunId = localStore.createRun({
    project: "demo",
    branch: intentBranch,
    worktreePath: intentWorktree,
    specPath: "spec/ready-intents",
    status: "completed",
    specRef: "main",
    stepId: "intent",
  });
  localStore.setRunDownstreamInputs(intentRunId, [readyA, readyB]);
  const intentArtifact: PipelineStageArtifact = {
    entryRunId: intentRunId,
    specPath: "spec/ready-intents",
    downstreamInputs: [readyA, readyB],
  };
  const pipelineId = localStore.createPipeline({ definition: FAN_OUT_LINEAR_DEFINITION, context });
  localStore.updateStage({
    pipelineId,
    stageId: "intent",
    patch: { status: "succeeded", artifact: intentArtifact, workflowInvocationId: intentRunId },
  });

  const runPromise = runPipeline(pipelineId, {
    store: localStore,
    context,
    dispatch: baseHandlers.pipelineDispatch,
    wait: baseHandlers.pipelineWait,
    resolveStage: resolveStageWorkflowSteps,
  });

  await waitFor(() => barrierSlots.length === 2, 15000);
  await waitFor(() => {
    const pipeline = localStore.loadPipeline(pipelineId);
    return (
      pipeline?.stages.find((stage) => stage.stageId === "plan" && stage.branchKey === "alpha")?.status === "running" &&
      pipeline?.stages.find((stage) => stage.stageId === "plan" && stage.branchKey === "beta")?.status === "running"
    );
  }, 15000);

  const pipelineAtAdmission = localStore.loadPipeline(pipelineId);
  expect(pipelineAtAdmission?.stages.find((stage) => stage.stageId === "plan" && stage.branchKey === "alpha")?.status).toBe(
    "running",
  );
  expect(pipelineAtAdmission?.stages.find((stage) => stage.stageId === "plan" && stage.branchKey === "beta")?.status).toBe(
    "running",
  );

  for (const pending of planWaits.values()) pending.resolve("completed");
  localExecutor.settleAll();
  await runPromise;
  await flushBackgroundRuns();
  // @mutate v2/src/daemon/pipeline-stage-resolve.ts "chainedInputRoot: prior.worktreePath," -> "chainedInputRoot: undefined,"
  } finally {
    localExecutor.abortAll();
    localStore.close();
  }
}, 20000);
