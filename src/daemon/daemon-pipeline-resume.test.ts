import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { AnyWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import { DEFAULT_WRITE_STEP_RULES } from "../execution/write-loop-input.ts";
import { openLogReader, openLogSink } from "../persistence/log-stream.ts";
import {
  openStateStore,
  type PipelineContext,
  type PipelineStageRecord,
  type StateStore,
  type WorkflowSnapshot,
} from "../persistence/state-store.ts";
import type { InvocationResult } from "../shared/invocation/execute.ts";
import { realAsyncSubprocessRunner } from "../shared/subprocess.ts";
import { trackedMkdtempSync } from "../shared/tracked-temp-dir.test-support.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import { makeIpcClient } from "../testing/ipc-client-fake.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import {
  createBindingFactory,
  DEFAULT_AGENT_MODEL_CONFIG,
  doneBindingFactory,
  writeStepFixtures,
} from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import type { WriteLoopBindingSourceDeps } from "./daemon.ts";
import { createRunControlHandlers } from "./daemon.ts";
import { derivePipelineState } from "./pipeline-execution.ts";
import { resolveFailedImplementResumeTarget } from "./pipeline-resume-resumable-implement.ts";
import type { PipelineStageArtifact } from "./pipeline-stage-dispatch.ts";
import {
  type PipelineStageResolutionResult,
  type PipelineStageResolveDeps,
  resolveStageWorkflowSteps,
} from "./pipeline-stage-resolve.ts";

const APPROVAL_DEFINITION: PipelineDefinition = {
  name: "approval",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

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

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

const ADMISSION_CONTEXT = {
  cwd: "/fake",
  seed: "seed text",
  configPath: "/fake/.jarvis/config.json",
};

const REOPEN_DEFINITION: PipelineDefinition = {
  name: "reopen",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

const FAN_OUT_PIPELINE_DEFINITION: PipelineDefinition = {
  name: "fan-out",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

const CHAINED_PLAN_RESUME_DEFINITION: PipelineDefinition = {
  name: "chained-plan-resume",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

const CHAINED_IMPLEMENT_RESUME_DEFINITION: PipelineDefinition = {
  name: "chained-implement-resume",
  stages: [
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

function initGitRepo(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
}

function initChainedRepoBase(): string {
  const repoRoot = trackedMkdtempSync(join(tmpdir(), "pipeline-resume-chained-repo-"));
  initGitRepo(repoRoot);
  writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: repoRoot });
  return repoRoot;
}

function addIntentHandoff(repoRoot: string): {
  intentBranch: string;
  intentWorktree: string;
  readyIntentRel: string;
} {
  const intentBranch = "intent/feature";
  const readyIntentRel = "spec/ready-intents/feature.md";
  const intentWorktree = join(repoRoot, ".jarvis-worktrees", intentBranch);
  mkdirSync(intentWorktree, { recursive: true });
  execFileSync("git", ["branch", intentBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", intentWorktree, intentBranch], { cwd: repoRoot });
  mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
  writeFileSync(join(intentWorktree, readyIntentRel), "---\nname: feature\n---\n## Prerequisites\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: intentWorktree });
  execFileSync("git", ["commit", "-qm", "intent"], { cwd: intentWorktree });
  return { intentBranch, intentWorktree, readyIntentRel };
}

function addPlanHandoff(repoRoot: string): {
  planBranch: string;
  planWorktree: string;
  planSpecDir: string;
} {
  const planBranch = "plan/feature";
  const planSpecDir = "spec/feature";
  const planWorktree = join(repoRoot, ".jarvis-worktrees", planBranch);
  mkdirSync(planWorktree, { recursive: true });
  execFileSync("git", ["branch", planBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", planWorktree, planBranch], { cwd: repoRoot });
  mkdirSync(join(planWorktree, planSpecDir), { recursive: true });
  writeFileSync(join(planWorktree, `${planSpecDir}/index.md`), "# Feature\n\n- [ ] [Work](./00-work.md)\n", "utf8");
  writeFileSync(
    join(planWorktree, `${planSpecDir}/00-work.md`),
    "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n",
    "utf8",
  );
  execFileSync("git", ["add", "-A"], { cwd: planWorktree });
  execFileSync("git", ["commit", "-qm", "plan"], { cwd: planWorktree });
  return { planBranch, planWorktree, planSpecDir };
}

const RESUME_BRANCH_TARGET = "resume-target";
const RESUME_BRANCH_SIBLING_A = "resume-sibling-a";
const RESUME_BRANCH_SIBLING_B = "resume-sibling-b";
const RESUME_BRANCH_KEYS = [RESUME_BRANCH_TARGET, RESUME_BRANCH_SIBLING_A, RESUME_BRANCH_SIBLING_B] as const;

/**
 * Production-shaped fan-out fixture against the real state store: a succeeded intent with three
 * downstream branches, branch rows at every post-split position (gate included), `default`
 * post-split rows `skipped`, the target branch resumable at `plan` (gate `approved`, plan
 * `failed`), and both siblings still at their own `awaiting` gate.
 */
function setupFanOutResumeFixture(store: StateStore, pipelineId: string): void {
  const intentArtifact: PipelineStageArtifact = {
    entryRunId: "run-intent",
    specPath: "ready-intents",
    downstreamInputs: RESUME_BRANCH_KEYS.map((key) => `ready-intents/${key}.md`),
  };
  store.updateStage({
    pipelineId,
    stageId: "intent",
    patch: { status: "succeeded", artifact: intentArtifact, workflowInvocationId: "run-intent" },
  });
  for (const branchKey of RESUME_BRANCH_KEYS) {
    store.createPipelineStageBranch({ pipelineId, stageId: "gate", branchKey });
    store.createPipelineStageBranch({ pipelineId, stageId: "plan", branchKey });
    store.createPipelineStageBranch({ pipelineId, stageId: "implement", branchKey });
  }
  for (const stageId of ["gate", "plan", "implement"] as const) {
    store.updateStage({
      pipelineId,
      stageId,
      branchKey: "default",
      patch: { status: "skipped", skipProvenance: "terminal" },
    });
  }
  store.updateStage({ pipelineId, stageId: "gate", branchKey: RESUME_BRANCH_TARGET, patch: { status: "approved" } });
  store.updateStage({ pipelineId, stageId: "plan", branchKey: RESUME_BRANCH_TARGET, patch: { status: "failed" } });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    branchKey: RESUME_BRANCH_TARGET,
    patch: { status: "skipped", skipProvenance: "provisional" },
  });
  store.updateStage({
    pipelineId,
    stageId: "gate",
    branchKey: RESUME_BRANCH_SIBLING_A,
    patch: { status: "awaiting" },
  });
  store.updateStage({
    pipelineId,
    stageId: "gate",
    branchKey: RESUME_BRANCH_SIBLING_B,
    patch: { status: "awaiting" },
  });
}

function setupFanOutResumePipeline(store: StateStore): { pipelineId: string; before: PipelineStageRecord[] } {
  const pipelineId = store.createPipeline({ definition: FAN_OUT_PIPELINE_DEFINITION, context: ADMISSION_CONTEXT });
  setupFanOutResumeFixture(store, pipelineId);
  const before = store.loadPipeline(pipelineId)?.stages.map((stage) => ({ ...stage })) ?? [];
  return { pipelineId, before };
}

const APPROVED_PENDING_BRANCH = "approved-pending-target";
const APPROVED_PENDING_SIBLING = "approved-pending-sibling";

function setupApprovedGatePendingFanOutFixture(store: StateStore, pipelineId: string): void {
  const intentArtifact: PipelineStageArtifact = {
    entryRunId: "run-intent",
    specPath: "ready-intents",
    downstreamInputs: [APPROVED_PENDING_BRANCH, APPROVED_PENDING_SIBLING].map((key) => `ready-intents/${key}.md`),
  };
  store.updateStage({
    pipelineId,
    stageId: "intent",
    patch: { status: "succeeded", artifact: intentArtifact, workflowInvocationId: "run-intent" },
  });
  for (const branchKey of [APPROVED_PENDING_BRANCH, APPROVED_PENDING_SIBLING]) {
    store.createPipelineStageBranch({ pipelineId, stageId: "gate", branchKey });
    store.createPipelineStageBranch({ pipelineId, stageId: "plan", branchKey });
    store.createPipelineStageBranch({ pipelineId, stageId: "implement", branchKey });
  }
  for (const stageId of ["gate", "plan", "implement"] as const) {
    store.updateStage({
      pipelineId,
      stageId,
      branchKey: "default",
      patch: { status: "skipped", skipProvenance: "terminal" },
    });
  }
  store.updateStage({
    pipelineId,
    stageId: "gate",
    branchKey: APPROVED_PENDING_BRANCH,
    patch: { status: "approved" },
  });
  store.updateStage({
    pipelineId,
    stageId: "gate",
    branchKey: APPROVED_PENDING_SIBLING,
    patch: { status: "awaiting" },
  });
}

function setupApprovedGatePendingFanOutPipeline(store: StateStore): {
  pipelineId: string;
  before: PipelineStageRecord[];
} {
  const pipelineId = store.createPipeline({ definition: FAN_OUT_PIPELINE_DEFINITION, context: ADMISSION_CONTEXT });
  setupApprovedGatePendingFanOutFixture(store, pipelineId);
  const before = store.loadPipeline(pipelineId)?.stages.map((stage) => ({ ...stage })) ?? [];
  return { pipelineId, before };
}

let stateStore: StateStore;
let dbPath: string;
let handlers: ReturnType<typeof createRunControlHandlers>;

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-pipeline-resume-${process.pid}-${Date.now()}-${Math.random()}.db`);
  stateStore = openStateStore(dbPath);
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async (_definition, stageIndex) => ({
      ok: true,
      steps: [{ behavior: "write", stageIndex }] as never,
    }),
  });
});

afterEach(async () => {
  await flushBackgroundRuns();
  try {
    stateStore.close();
  } catch {
    // already closed
  }
});

test("missing or empty pipelineId returns invalid_params", async () => {
  for (const params of [{}, { pipelineId: "" }]) {
    const response = await handlers.pipeline_resume(
      requestFrame("r", "pipeline_resume", params),
      new AbortController().signal,
    );
    expect(response).toEqual({ kind: "error", code: "invalid_params", message: "pipelineId required" });
  }
});

test("setRetiring rejects resume with daemon_superseded", async () => {
  handlers.setRetiring();
  const response = await handlers.pipeline_resume(
    requestFrame("r", "pipeline_resume", { pipelineId: "p1" }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "error",
    code: "daemon_superseded",
    message: "Daemon is retiring and not accepting new work",
  });
});

test("resume returns after admission before async continuation runs", async () => {
  const stage2 = controllableBindingFactory();
  const stage2Step: AnyWorkflowStep = createWriteStep("stage-2", "pipeline-branch", stage2.factory, {
    suppressShrink: true,
  });
  const resolveStage = async (
    _definition: PipelineDefinition,
    stageIndex: number,
  ): Promise<PipelineStageResolutionResult> => ({
    ok: true,
    steps: stageIndex === 1 ? [stage2Step] : [],
  });

  const resumeHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage,
  });

  const pipelineId = stateStore.createPipeline({ definition: REOPEN_DEFINITION, context: ADMISSION_CONTEXT });
  stateStore.updateStage({ pipelineId, stageId: "s1", patch: { status: "succeeded", workflowInvocationId: "inv-1" } });
  stateStore.updateStage({ pipelineId, stageId: "s2", patch: { status: "failed" } });

  const response = await resumeHandlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { kind: "resumed", pipelineId } });
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s2")?.status).toBe("pending");

  stage2.settle();
  await waitFor(
    () => stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s2")?.status === "succeeded",
  );
  await flushBackgroundRuns();
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s2")?.status).toBe("succeeded");
});

test("pipeline_resume on awaiting-approval returns missing_context without dispatch", async () => {
  const pipelineId = stateStore.createPipeline({ definition: APPROVAL_DEFINITION, context: ADMISSION_CONTEXT });
  stateStore.updateStage({
    pipelineId,
    stageId: "s1",
    patch: { status: "succeeded", workflowInvocationId: "inv-1" },
  });
  stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
  const raw = new Database(dbPath);
  try {
    raw.prepare("UPDATE pipelines SET context = NULL WHERE id = ?").run(pipelineId);
  } finally {
    raw.close();
  }

  const response = await handlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId, reason: "missing_context" },
  });
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s3")?.status).toBe("pending");
});

test("pipeline_resume on awaiting-approval returns claim_refused without dispatch", async () => {
  const pipelineId = stateStore.createPipeline({ definition: APPROVAL_DEFINITION, context: ADMISSION_CONTEXT });
  stateStore.updateStage({
    pipelineId,
    stageId: "s1",
    patch: { status: "succeeded", workflowInvocationId: "inv-1" },
  });
  stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });

  const claimRefusingStore = Object.create(stateStore) as StateStore;
  claimRefusingStore.claimPipelineContinuation = () => ({
    kind: "refused",
    pipelineId,
    reason: "claim_lost",
  });
  const claimHandlers = createRunControlHandlers({
    stateStore: claimRefusingStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => ({ ok: true, steps: [] }),
  });

  const response = await claimHandlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId, reason: "claim_refused" },
  });
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "gate")?.status).toBe(
    "awaiting",
  );
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s3")?.status).toBe("pending");
});

test("pipeline_resume lists resumable failed plan branch keys when branch key is omitted", async () => {
  const { pipelineId, before } = setupFanOutResumePipeline(stateStore);
  const pipeline = stateStore.loadPipeline(pipelineId);
  if (!pipeline) throw new Error("expected pipeline");
  expect(derivePipelineState(pipeline)).toBe("awaiting-approval");

  const response = await handlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: {
      kind: "refused",
      pipelineId,
      reason: "branch_resume_required",
      branchKeys: [RESUME_BRANCH_TARGET],
    },
  });
  expect(stateStore.loadPipeline(pipelineId)?.stages.map((stage) => ({ ...stage }))).toEqual(before);
});

test("pipeline_resume admits unscoped and explicit-default approved-gate pending strands", async () => {
  for (const branchKey of [undefined, "default"] as const) {
    const pipelineId = stateStore.createPipeline({ definition: APPROVAL_DEFINITION, context: ADMISSION_CONTEXT });
    stateStore.updateStage({
      pipelineId,
      stageId: "s1",
      patch: { status: "succeeded", workflowInvocationId: "inv-1", artifact: { specPath: "spec/s1.md" } },
    });
    stateStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "approved" } });

    const plan = controllableBindingFactory();
    const resumeHandlers = createRunControlHandlers({
      stateStore,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async (_definition, stageIndex) => ({
        ok: true,
        steps:
          stageIndex === 2 ? [createWriteStep("plan", "pipeline-plan", plan.factory, { suppressShrink: true })] : [],
      }),
    });

    const response = await resumeHandlers.pipeline_resume(
      requestFrame("resume", "pipeline_resume", {
        pipelineId,
        ...(branchKey === undefined ? {} : { branchKey }),
      }),
      new AbortController().signal,
    );
    expect(response).toEqual({ kind: "response", result: { kind: "resumed", pipelineId } });
    await waitFor(
      () => stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s3")?.status === "running",
    );
    plan.settle();
    await waitFor(
      () => stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s3")?.status === "succeeded",
    );
    await flushBackgroundRuns();
    expect(
      stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s3")?.workflowInvocationId,
    ).not.toBeNull();
    resumeHandlers.close();
  }
});

test("pipeline_resume branchKey replays only the named branch while sibling gates stay awaiting", async () => {
  const { pipelineId, before } = setupFanOutResumePipeline(stateStore);

  const plan = controllableBindingFactory();
  const dispatchLog: Array<{ stageIndex: number; branchKey: string }> = [];
  const resolveStage = async (
    _definition: PipelineDefinition,
    stageIndex: number,
    _context: PipelineContext,
    _stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
    deps?: PipelineStageResolveDeps,
  ): Promise<PipelineStageResolutionResult> => {
    const branchKey = deps?.branchKey ?? "default";
    dispatchLog.push({ stageIndex, branchKey });
    if (stageIndex === 2) {
      return {
        ok: true,
        steps: [createWriteStep(`plan-${branchKey}`, branchKey, plan.factory, { suppressShrink: true })],
      };
    }
    // Branch reopen also reopens the target's skipped `implement` row, so continuation reaches
    // it once `plan` succeeds. Fail it deliberately so the reopened suffix's landing state is
    // observable below, rather than leaving it silently unpinned.
    return { ok: false, error: "test: implement stage intentionally fails to pin reopened suffix state" };
  };

  const resumeHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage,
  });

  // Keystone checkpoint: dropping the forwarded branch scope derives unscoped admission on the
  // aggregate fan-out state (two siblings still `awaiting`), which claims awaiting-approval
  // instead of reopening and dispatching the target branch's failed `plan` stage.
  const response = await resumeHandlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId, branchKey: RESUME_BRANCH_TARGET }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { kind: "resumed", pipelineId } });

  // (1) Synchronously on the response, before any settle: the target branch's plan row is reopened.
  const afterAdmission = stateStore.loadPipeline(pipelineId)?.stages ?? [];
  expect(
    afterAdmission.find((stage) => stage.stageId === "plan" && stage.branchKey === RESUME_BRANCH_TARGET)?.status,
  ).toBe("pending");
  const intentBefore = before.find((stage) => stage.stageId === "intent" && stage.branchKey === "default");
  expect(afterAdmission.find((stage) => stage.stageId === "intent" && stage.branchKey === "default")).toEqual(
    intentBefore,
  );

  // (2) Settle the target branch's dispatched step and drain background work.
  await waitFor(
    () =>
      stateStore
        .loadPipeline(pipelineId)
        ?.stages.find((stage) => stage.stageId === "plan" && stage.branchKey === RESUME_BRANCH_TARGET)?.status ===
      "running",
  );
  plan.settle();
  await waitFor(
    () =>
      stateStore
        .loadPipeline(pipelineId)
        ?.stages.find((stage) => stage.stageId === "plan" && stage.branchKey === RESUME_BRANCH_TARGET)?.status ===
      "succeeded",
  );
  await flushBackgroundRuns();

  const after = stateStore.loadPipeline(pipelineId)?.stages ?? [];
  const planAfter = after.find((stage) => stage.stageId === "plan" && stage.branchKey === RESUME_BRANCH_TARGET);
  expect(planAfter?.status).toBe("succeeded");
  expect(planAfter?.artifact).toEqual({
    entryRunId: planAfter?.workflowInvocationId,
    invocationId: expect.any(String),
    specPath: "spec.md",
  });
  expect(dispatchLog).toContainEqual({ stageIndex: 2, branchKey: RESUME_BRANCH_TARGET });
  expect(dispatchLog.some((entry) => entry.branchKey !== RESUME_BRANCH_TARGET)).toBe(false);

  // The reopened `implement` row (was `skipped`) is reached once `plan` succeeds and lands
  // `failed` per the stub above, proving the target branch's whole suffix was reopened, not
  // just its immediately-failed stage.
  expect(dispatchLog).toContainEqual({ stageIndex: 3, branchKey: RESUME_BRANCH_TARGET });
  const implementAfter = after.find(
    (stage) => stage.stageId === "implement" && stage.branchKey === RESUME_BRANCH_TARGET,
  );
  expect(implementAfter?.status).toBe("failed");
  expect(implementAfter?.failureDetail).toEqual({
    expectation: "workflow stage resolves and dispatches",
    observation: "test: implement stage intentionally fails to pin reopened suffix state",
    retryable: false,
    referencedPaths: [],
  });

  // (3) Both siblings stay untouched at their own awaiting gate, and the shared intent row is unchanged.
  for (const branchKey of [RESUME_BRANCH_SIBLING_A, RESUME_BRANCH_SIBLING_B]) {
    for (const stageId of ["gate", "plan", "implement"] as const) {
      const beforeRow = before.find((stage) => stage.stageId === stageId && stage.branchKey === branchKey);
      const afterRow = after.find((stage) => stage.stageId === stageId && stage.branchKey === branchKey);
      expect(afterRow).toEqual(beforeRow);
    }
    expect(after.find((stage) => stage.stageId === "gate" && stage.branchKey === branchKey)?.status).toBe("awaiting");
  }
  const intentAfter = after.find((stage) => stage.stageId === "intent" && stage.branchKey === "default");
  expect(intentAfter).toEqual(intentBefore);
  expect(intentAfter?.status).toBe("succeeded");
  expect(intentAfter?.workflowInvocationId).toBe("run-intent");
});

test("pipeline_resume continues an approved-gate pending strand on the named branch without reopenFailedPipeline", async () => {
  const { pipelineId, before } = setupApprovedGatePendingFanOutPipeline(stateStore);
  let reopenCalled = false;
  const reopenFailedPipeline = stateStore.reopenFailedPipeline.bind(stateStore);
  stateStore.reopenFailedPipeline = (args) => {
    reopenCalled = true;
    return reopenFailedPipeline(args);
  };

  const plan = controllableBindingFactory();
  const dispatchLog: Array<{ stageIndex: number; branchKey: string }> = [];
  const resolveStage = async (
    _definition: PipelineDefinition,
    stageIndex: number,
    _context: PipelineContext,
    _stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
    deps?: PipelineStageResolveDeps,
  ): Promise<PipelineStageResolutionResult> => {
    const branchKey = deps?.branchKey ?? "default";
    dispatchLog.push({ stageIndex, branchKey });
    if (stageIndex === 2) {
      return {
        ok: true,
        steps: [createWriteStep(`plan-${branchKey}`, branchKey, plan.factory, { suppressShrink: true })],
      };
    }
    return { ok: false, error: "test: implement stage intentionally fails to pin continuation state" };
  };

  const resumeHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage,
  });

  const response = await resumeHandlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId, branchKey: APPROVED_PENDING_BRANCH }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { kind: "resumed", pipelineId } });
  expect(reopenCalled).toBe(false);

  await waitFor(
    () =>
      stateStore
        .loadPipeline(pipelineId)
        ?.stages.find((stage) => stage.stageId === "plan" && stage.branchKey === APPROVED_PENDING_BRANCH)?.status ===
      "running",
  );
  plan.settle();
  await waitFor(
    () =>
      stateStore
        .loadPipeline(pipelineId)
        ?.stages.find((stage) => stage.stageId === "plan" && stage.branchKey === APPROVED_PENDING_BRANCH)?.status ===
      "succeeded",
  );
  await flushBackgroundRuns();

  const after = stateStore.loadPipeline(pipelineId)?.stages ?? [];
  expect(dispatchLog).toEqual([
    { stageIndex: 2, branchKey: APPROVED_PENDING_BRANCH },
    { stageIndex: 3, branchKey: APPROVED_PENDING_BRANCH },
  ]);
  expect(
    after.find((stage) => stage.stageId === "plan" && stage.branchKey === APPROVED_PENDING_BRANCH)
      ?.workflowInvocationId,
  ).not.toBeNull();
  for (const snapshot of before) {
    if (
      snapshot.branchKey === APPROVED_PENDING_BRANCH &&
      (snapshot.stageId === "plan" || snapshot.stageId === "implement")
    ) {
      continue;
    }
    expect(after.find((stage) => stage.id === snapshot.id)).toEqual(snapshot);
  }
  expect(after.find((stage) => stage.stageId === "gate" && stage.branchKey === APPROVED_PENDING_SIBLING)?.status).toBe(
    "awaiting",
  );
  resumeHandlers.close();
});

test("pipeline_resume refuses the named branch's own awaiting gate without dispatch", async () => {
  const { pipelineId, before } = setupFanOutResumePipeline(stateStore);

  const response = await handlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId, branchKey: RESUME_BRANCH_SIBLING_A }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: {
      kind: "refused",
      pipelineId,
      branchKey: RESUME_BRANCH_SIBLING_A,
      reason: "branch_awaiting_approval",
      stageId: "gate",
    },
  });
  expect(stateStore.loadPipeline(pipelineId)?.stages.map((stage) => ({ ...stage }))).toEqual(before);
});

test("pipeline_resume rejects allowLanePrRepublish false without resume side effects", async () => {
  const { pipelineId, before } = setupFanOutResumePipeline(stateStore);

  const response = await handlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId, allowLanePrRepublish: false }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "error",
    code: "invalid_params",
    message: "allowLanePrRepublish must be true when present",
  });
  expect(stateStore.loadPipeline(pipelineId)?.stages.map((stage) => ({ ...stage }))).toEqual(before);
});

test("pipeline_resume returns a branch_not_found refusal, not invalid_params, for an unknown well-formed branchKey", async () => {
  const { pipelineId, before } = setupFanOutResumePipeline(stateStore);

  const response = await handlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId, branchKey: "unknown-branch" }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId, branchKey: "unknown-branch", reason: "branch_not_found" },
  });
  expect(stateStore.loadPipeline(pipelineId)?.stages.map((stage) => ({ ...stage }))).toEqual(before);
});

test("pipeline_resume rejects malformed branchKey with invalid_params", async () => {
  const { pipelineId, before } = setupFanOutResumePipeline(stateStore);

  // Mutation checkpoint: neutering the blank/non-string clause admits the malformed key past the
  // handler. For "" and "   " it resurfaces as resumePipeline's own branch_not_found refusal
  // result frame in place of this invalid_params error frame; for the non-string case it makes
  // the handler fault (params.branchKey.trim() throws) instead of returning invalid_params.
  for (const branchKey of ["", "   "]) {
    const response = await handlers.pipeline_resume(
      requestFrame("resume", "pipeline_resume", { pipelineId, branchKey }),
      new AbortController().signal,
    );
    expect(response).toEqual({
      kind: "error",
      code: "invalid_params",
      message: "branchKey must be a non-blank string",
    });
  }

  const nonStringResponse = await handlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId, branchKey: 5 }),
    new AbortController().signal,
  );
  expect(nonStringResponse).toEqual({
    kind: "error",
    code: "invalid_params",
    message: "branchKey must be a non-blank string",
  });

  expect(stateStore.loadPipeline(pipelineId)?.stages.map((stage) => ({ ...stage }))).toEqual(before);

  // Mutation checkpoint: neutering the presence clause trips the guard even when branchKey is
  // omitted, turning every existing unscoped pipeline_resume test in this file red. Pin it here
  // too, rather than relying solely on the other unscoped tests in this file, so the checkpoint
  // is self-sufficient against test relocation.
  const terminalPipelineId = stateStore.createPipeline({ definition: REOPEN_DEFINITION, context: ADMISSION_CONTEXT });
  stateStore.updateStage({
    pipelineId: terminalPipelineId,
    stageId: "s1",
    patch: { status: "succeeded", workflowInvocationId: "inv-1" },
  });
  stateStore.updateStage({
    pipelineId: terminalPipelineId,
    stageId: "s2",
    patch: { status: "succeeded", workflowInvocationId: "inv-2" },
  });
  const omittedResponse = await handlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId: terminalPipelineId }),
    new AbortController().signal,
  );
  expect(omittedResponse).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId: terminalPipelineId, reason: "pipeline_terminal_succeeded" },
  });

  handlers.setRetiring();
  const retiringResponse = await handlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId, branchKey: 5 }),
    new AbortController().signal,
  );
  expect(retiringResponse).toEqual({
    kind: "error",
    code: "daemon_superseded",
    message: "Daemon is retiring and not accepting new work",
  });
});

test("pipeline_resume forwards a non-blank branchKey unchanged, not trimmed", async () => {
  const { pipelineId, before } = setupFanOutResumePipeline(stateStore);

  // A padded key is non-blank, so it passes handler validation and forwards untrimmed; it must
  // not match the identically-named branch, proving the handler does not trim before forwarding.
  const paddedBranchKey = ` ${RESUME_BRANCH_TARGET} `;
  const paddedResponse = await handlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId, branchKey: paddedBranchKey }),
    new AbortController().signal,
  );
  expect(paddedResponse).toEqual({
    kind: "response",
    result: { kind: "refused", pipelineId, branchKey: paddedBranchKey, reason: "branch_not_found" },
  });
  expect(stateStore.loadPipeline(pipelineId)?.stages.map((stage) => ({ ...stage }))).toEqual(before);

  // `branchKey: "default"` aliases omission in the library, taking the unscoped aggregate path:
  // this fixture carries a resumable failed `plan` lane while siblings await their gates, so
  // unscoped resume lists that branch instead of claiming awaiting-approval.
  const defaultAliasResponse = await handlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId, branchKey: "default" }),
    new AbortController().signal,
  );
  expect(defaultAliasResponse).toEqual({
    kind: "response",
    result: {
      kind: "refused",
      pipelineId,
      reason: "branch_resume_required",
      branchKeys: [RESUME_BRANCH_TARGET],
    },
  });
  expect(stateStore.loadPipeline(pipelineId)?.stages.map((stage) => ({ ...stage }))).toEqual(before);
});

test.each([
  { scope: "unscoped", resetDespiteDirty: true, resetDespiteLandedCriteria: false },
  { scope: "branch", resetDespiteDirty: true, resetDespiteLandedCriteria: false },
  { scope: "unscoped", resetDespiteDirty: false, resetDespiteLandedCriteria: true },
  { scope: "branch", resetDespiteDirty: false, resetDespiteLandedCriteria: true },
] as const)("pipeline_resume threads independent stale-reset flags ($scope dirty=$resetDespiteDirty landed=$resetDespiteLandedCriteria)", async ({
  scope,
  resetDespiteDirty,
  resetDespiteLandedCriteria,
}) => {
  let pipelineId: string;
  let branchKey: string | undefined;
  if (scope === "branch") {
    ({ pipelineId } = setupFanOutResumePipeline(stateStore));
    branchKey = RESUME_BRANCH_TARGET;
    stateStore.updateStage({
      pipelineId,
      stageId: "plan",
      branchKey,
      patch: { status: "succeeded", artifact: { entryRunId: "run-target-plan", specPath: "spec/target" } },
    });
    stateStore.updateStage({ pipelineId, stageId: "implement", branchKey, patch: { status: "failed" } });
  } else {
    const definition: PipelineDefinition = {
      name: "resume-reset-flags",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    pipelineId = stateStore.createPipeline({ definition, context: ADMISSION_CONTEXT });
    stateStore.updateStage({ pipelineId, stageId: "intent", patch: { status: "succeeded" } });
    stateStore.updateStage({ pipelineId, stageId: "implement", patch: { status: "failed" } });
  }

  const captured: Array<{ skipDirtyWorktreeGate: boolean; skipLandedCriteriaGate: boolean }> = [];
  const flagHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    daemonSocketPath: "/unused-pipeline-resume-flags.sock",
    resolveStage: async (_definition, _stageIndex, _context, _artifacts, deps) => {
      if (deps?.staleReset?.flags !== undefined) captured.push(deps.staleReset.flags);
      return { ok: false, error: "captured reset flags" };
    },
  });
  const response = await flagHandlers.pipeline_resume(
    requestFrame("resume-flags", "pipeline_resume", {
      pipelineId,
      ...(branchKey !== undefined ? { branchKey } : {}),
      resetDespiteDirty,
      resetDespiteLandedCriteria,
    }),
    new AbortController().signal,
  );

  expect(response).toEqual({ kind: "response", result: { kind: "resumed", pipelineId } });
  await waitFor(() => captured.length > 0);
  expect(captured).toEqual([
    {
      skipDirtyWorktreeGate: resetDespiteDirty,
      skipLandedCriteriaGate: resetDespiteLandedCriteria,
    },
  ]);
  flagHandlers.close();
});

test("pipeline_resume dispatches chained plan and implement stages after prior worktree removal when input lives on durable branch", async () => {
  const priorJarvisHome = process.env.JARVIS_HOME;
  const jarvisRoot = trackedMkdtempSync(join(tmpdir(), "pipeline-resume-jarvis-home-"));
  process.env.JARVIS_HOME = jarvisRoot;
  const fakeExecutor = createFakeWriteLoopExecutor();
  const planRepoRoot = initChainedRepoBase();
  const planHandoff = addIntentHandoff(planRepoRoot);
  const planConfigPath = writeHomeMachineConfig({ projects: { demo: { root: planRepoRoot } } });
  const planAdmissionContext: PipelineContext = { cwd: planRepoRoot, configPath: planConfigPath, seed: "unused" };
  const implementRepoRoot = initChainedRepoBase();
  const implementHandoff = addPlanHandoff(implementRepoRoot);
  const implementConfigPath = writeHomeMachineConfig({ projects: { demo: { root: implementRepoRoot } } });
  const implementAdmissionContext: PipelineContext = {
    cwd: implementRepoRoot,
    configPath: implementConfigPath,
    seed: "unused",
  };
  const { intentBranch, intentWorktree, readyIntentRel } = planHandoff;
  const { planBranch, planWorktree, planSpecDir } = implementHandoff;

  const resumeHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: fakeExecutor.executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: (definition, stageIndex, context, stageArtifacts, deps) =>
      resolveStageWorkflowSteps(definition, stageIndex, context, stageArtifacts, {
        ...deps,
        builders: WORKFLOW_PRESET_BUILDERS,
      }),
    settleDelayMs: 0,
  });

  try {
    const intentRunId = stateStore.createRun({
      project: "demo",
      specRef: "main",
      worktreePath: intentWorktree,
      branch: intentBranch,
      specPath: readyIntentRel,
      status: "completed",
    });
    const planRunId = stateStore.createRun({
      project: "demo",
      specRef: "main",
      worktreePath: planWorktree,
      branch: planBranch,
      specPath: planSpecDir,
      status: "completed",
    });

    const planPipelineId = stateStore.createPipeline({
      definition: CHAINED_PLAN_RESUME_DEFINITION,
      context: planAdmissionContext,
    });
    stateStore.updateStage({
      pipelineId: planPipelineId,
      stageId: "intent",
      patch: {
        status: "succeeded",
        workflowInvocationId: intentRunId,
        artifact: { entryRunId: intentRunId, specPath: readyIntentRel },
      },
    });
    stateStore.updateStage({
      pipelineId: planPipelineId,
      stageId: "plan",
      patch: {
        status: "failed",
        failureDetail: {
          message: `pipeline-stage-resolve: downstream input ${readyIntentRel} not found in prior worktree`,
        },
      },
    });
    rmSync(intentWorktree, { recursive: true, force: true });

    const planResponse = await resumeHandlers.pipeline_resume(
      requestFrame("resume-plan", "pipeline_resume", { pipelineId: planPipelineId }),
      new AbortController().signal,
    );
    expect(planResponse).toEqual({ kind: "response", result: { kind: "resumed", pipelineId: planPipelineId } });
    await waitFor(() => {
      const record = stateStore.loadPipeline(planPipelineId)?.stages.find((stage) => stage.stageId === "plan");
      return record?.status === "running" || record?.workflowInvocationId !== null;
    });
    const planStage = stateStore.loadPipeline(planPipelineId)?.stages.find((stage) => stage.stageId === "plan");
    expect(planStage?.status === "pending" || planStage?.status === "running").toBe(true);
    expect(planStage?.workflowInvocationId).not.toBeNull();
    fakeExecutor.settleAll();
    await flushBackgroundRuns();

    const implementPipelineId = stateStore.createPipeline({
      definition: CHAINED_IMPLEMENT_RESUME_DEFINITION,
      context: implementAdmissionContext,
    });
    stateStore.updateStage({
      pipelineId: implementPipelineId,
      stageId: "plan",
      patch: {
        status: "succeeded",
        workflowInvocationId: planRunId,
        artifact: { entryRunId: planRunId, specPath: planSpecDir },
      },
    });
    stateStore.updateStage({
      pipelineId: implementPipelineId,
      stageId: "implement",
      patch: {
        status: "failed",
        failureDetail: {
          message: `pipeline-stage-resolve: expected index at ${planSpecDir}/index.md in prior worktree`,
        },
      },
    });
    rmSync(planWorktree, { recursive: true, force: true });

    const implementResponse = await resumeHandlers.pipeline_resume(
      requestFrame("resume-implement", "pipeline_resume", { pipelineId: implementPipelineId }),
      new AbortController().signal,
    );
    expect(implementResponse).toEqual({
      kind: "response",
      result: { kind: "resumed", pipelineId: implementPipelineId },
    });
    await waitFor(() => {
      const record = stateStore
        .loadPipeline(implementPipelineId)
        ?.stages.find((stage) => stage.stageId === "implement");
      return record?.status === "running" || record?.workflowInvocationId !== null;
    });
    const implementStage = stateStore
      .loadPipeline(implementPipelineId)
      ?.stages.find((stage) => stage.stageId === "implement");
    expect(implementStage?.status === "pending" || implementStage?.status === "running").toBe(true);
    expect(implementStage?.workflowInvocationId).not.toBeNull();
    fakeExecutor.settleAll();
    await flushBackgroundRuns();
  } finally {
    if (priorJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = priorJarvisHome;
    rmSync(jarvisRoot, { recursive: true, force: true });
    rmSync(planRepoRoot, { recursive: true, force: true });
    rmSync(implementRepoRoot, { recursive: true, force: true });
  }
});

async function materializeManagedWorktree(
  repoRoot: string,
  jarvisRoot: string,
  branchName: string,
  baseRef: string,
): Promise<string> {
  try {
    await realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "--verify", branchName], repoRoot);
  } catch {
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branchName, baseRef], repoRoot);
  }
  const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
  mkdirSync(dirname(worktreePath), { recursive: true });
  if (!existsSync(worktreePath)) {
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branchName], repoRoot);
  }
  return worktreePath;
}

async function seedChainedPlanPreflightWorktrees(
  repoRoot: string,
  jarvisRoot: string,
): Promise<{
  intentBranch: string;
  intentWorktree: string;
  readyIntentRel: string;
  planBranch: string;
  planWorktree: string;
  planSpecDir: string;
}> {
  const intentBranch = "intent/feature";
  const readyIntentRel = "spec/ready-intents/feature.md";
  const planBranch = "plan/feature";
  const planSpecDir = "spec/feature";
  const intentWorktree = await materializeManagedWorktree(repoRoot, jarvisRoot, intentBranch, "HEAD");
  mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
  writeFileSync(join(intentWorktree, readyIntentRel), "---\nname: feature\n---\n## Prerequisites\n", "utf8");
  await realAsyncSubprocessRunner.runAsync("git", ["add", "-A"], intentWorktree);
  await realAsyncSubprocessRunner.runAsync("git", ["commit", "-qm", "intent"], intentWorktree);
  const planWorktree = await materializeManagedWorktree(repoRoot, jarvisRoot, planBranch, intentBranch);
  mkdirSync(join(planWorktree, planSpecDir), { recursive: true });
  writeFileSync(join(planWorktree, `${planSpecDir}/index.md`), "# Feature\n\n- [ ] [Work](./00-work.md)\n", "utf8");
  writeFileSync(
    join(planWorktree, `${planSpecDir}/00-work.md`),
    "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n",
    "utf8",
  );
  await realAsyncSubprocessRunner.runAsync("git", ["add", "-A"], planWorktree);
  await realAsyncSubprocessRunner.runAsync("git", ["commit", "-qm", "plan"], planWorktree);
  return { intentBranch, intentWorktree, readyIntentRel, planBranch, planWorktree, planSpecDir };
}

function createChainedPlanPreflightResolveStage(args: {
  repoRoot: string;
  jarvisRoot: string;
  intentBranch: string;
  planBranch: string;
  readyIntentRel: string;
  planSpecDir: string;
  intentRunId: string;
}) {
  return (
    definition: PipelineDefinition,
    stageIndex: number,
    context: PipelineContext,
    stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
    deps?: PipelineStageResolveDeps,
  ): Promise<PipelineStageResolutionResult> => {
    const managedWorktree = (branchName: string, baseRef: string) => ({
      projectRoot: args.repoRoot,
      projectName: "demo" as const,
      branchName,
      baseRef,
      jarvisRoot: args.jarvisRoot,
    });
    return resolveStageWorkflowSteps(definition, stageIndex, context, stageArtifacts, {
      ...deps,
      loadRun: (runId) =>
        runId === args.intentRunId
          ? { worktreePath: join(args.jarvisRoot, "worktrees", "demo", args.intentBranch), branch: args.intentBranch }
          : null,
      builders: {
        ...WORKFLOW_PRESET_BUILDERS,
        plan: async () => ({
          ok: true as const,
          steps: [
            createWriteStep("plan", args.planBranch, doneBindingFactory, {
              role: "plan",
              promptId: "plan.prompt",
              stepRules: DEFAULT_WRITE_STEP_RULES,
              worktree: managedWorktree(args.planBranch, args.intentBranch),
              specPath: args.planSpecDir,
              expectedArtifactPath: ".jarvis-plan-stage",
              publishCompletion: true,
              landing: {
                kind: "plan-tree",
                stagingDir: ".jarvis-plan-stage",
                durablePath: args.planSpecDir,
                inputs: { sourceRoot: args.repoRoot, paths: [args.readyIntentRel], consumeFrom: "worktree" },
              },
            }),
          ],
          identity: {
            invocationId: "plan-invocation",
            project: "demo",
            name: "feature",
            slug: "feature",
            branch: args.planBranch,
            seedFingerprint: "fp",
          },
        }),
      },
    });
  };
}

function wireStaleResetRpcClient(getHandlers: () => ReturnType<typeof createRunControlHandlers>): {
  connectClient: () => Promise<ReturnType<typeof makeIpcClient>>;
  close: () => void;
} {
  const connectClient = async (): Promise<ReturnType<typeof makeIpcClient>> => {
    const client = makeIpcClient([], { gated: true, deferred: true });
    const send = client.send.bind(client);
    client.send = (frame: unknown): void => {
      send(frame);
      const request = frame as { id?: string; method?: string; params?: unknown };
      if (typeof request.id !== "string" || typeof request.method !== "string") return;
      const requestId = request.id;
      const resumeHandlers = getHandlers();
      const handler = request.method === "list" ? resumeHandlers.list : resumeHandlers.check_workflow_start_claim;
      void Promise.resolve(
        handler(
          { kind: "request", id: requestId, method: request.method, params: request.params },
          new AbortController().signal,
        ),
      )
        .then((response) => client.push({ ...response, id: requestId }))
        .catch((error: unknown) =>
          client.push({
            kind: "error",
            id: requestId,
            code: "internal_error",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
    };
    return client;
  };
  return { connectClient, close: () => {} };
}

test.each([
  {
    label: "dirty worktree",
    needle: "Cannot re-run incomplete spec",
    prepare: async (planWorktree: string) => {
      writeFileSync(join(planWorktree, "README.md"), "dirty\n", "utf8");
    },
  },
  {
    label: "lane not descended from base",
    needle: "Cannot re-run incomplete spec",
    prepare: async (_planWorktree: string, intentWorktree: string, _intentBranch: string) => {
      writeFileSync(join(intentWorktree, "advance.md"), "advance\n", "utf8");
      await realAsyncSubprocessRunner.runAsync("git", ["add", "."], intentWorktree);
      await realAsyncSubprocessRunner.runAsync("git", ["commit", "-qm", "advance"], intentWorktree);
    },
  },
  {
    label: "landed-criteria drift",
    needle: "Cannot re-run incomplete spec",
    prepare: async (planWorktree: string, _intentWorktree: string, _intentBranch: string, planSpecDir: string) => {
      mkdirSync(join(planWorktree, planSpecDir), { recursive: true });
      writeFileSync(
        join(planWorktree, `${planSpecDir}/index.md`),
        "# Feature\n\n## Acceptance criteria\n\n- [x] Keep work\n",
        "utf8",
      );
    },
  },
  {
    label: "operator blocker on reopened plan",
    needle: "Cannot redraft failed plan stage",
    prepare: async (planWorktree: string, intentWorktree: string, _intentBranch: string, _planSpecDir: string) => {
      mkdirSync(join(intentWorktree, ".jarvis-plan-stage"), { recursive: true });
      writeFileSync(
        join(intentWorktree, ".jarvis-plan-stage", "intent.md"),
        "# Intent\n\n## Blocker\n\noperator decision required\n",
        "utf8",
      );
      await realAsyncSubprocessRunner.runAsync("git", ["add", "-A"], intentWorktree);
      await realAsyncSubprocessRunner.runAsync("git", ["commit", "-qm", "blocker"], intentWorktree);
      mkdirSync(join(planWorktree, ".jarvis-plan-stage"), { recursive: true });
      writeFileSync(
        join(planWorktree, ".jarvis-plan-stage", "intent.md"),
        "# Intent\n\n## Blocker\n\noperator decision required\n",
        "utf8",
      );
    },
  },
] as const)("pipeline_resume returns resume_dispatch_refused for %s without dispatch", async ({
  label,
  needle,
  prepare,
}) => {
  const priorJarvisHome = process.env.JARVIS_HOME;
  const jarvisRoot = trackedMkdtempSync(join(tmpdir(), "pipeline-resume-preflight-"));
  process.env.JARVIS_HOME = jarvisRoot;
  const repoRoot = initChainedRepoBase();
  const { intentBranch, intentWorktree, readyIntentRel, planBranch, planWorktree, planSpecDir } =
    await seedChainedPlanPreflightWorktrees(repoRoot, jarvisRoot);
  await prepare(planWorktree, intentWorktree, intentBranch, planSpecDir);
  const configPath = writeHomeMachineConfig({ projects: { demo: { root: repoRoot } } });
  const admissionContext: PipelineContext = { cwd: repoRoot, configPath, seed: "unused" };
  let dispatchCalls = 0;
  let resumeHandlers!: ReturnType<typeof createRunControlHandlers>;
  const intentRunId = stateStore.createRun({
    project: "demo",
    specRef: "main",
    worktreePath: intentWorktree,
    branch: intentBranch,
    specPath: readyIntentRel,
    status: "completed",
  });
  resumeHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: createChainedPlanPreflightResolveStage({
      repoRoot,
      jarvisRoot,
      intentBranch,
      planBranch,
      readyIntentRel,
      planSpecDir,
      intentRunId,
    }),
    pipelineDispatch: async () => {
      dispatchCalls += 1;
      return { ok: true, entryRunId: "run-plan", invocationId: "inv-plan" };
    },
    daemonSocketPath: "/preflight.sock",
    connectStaleResetClient: async () => wireStaleResetRpcClient(() => resumeHandlers).connectClient(),
    settleDelayMs: 0,
  });
  const pipelineId = stateStore.createPipeline({
    definition: CHAINED_PLAN_RESUME_DEFINITION,
    context: admissionContext,
  });
  stateStore.updateStage({
    pipelineId,
    stageId: "intent",
    patch: {
      status: "succeeded",
      workflowInvocationId: intentRunId,
      artifact: { entryRunId: intentRunId, specPath: readyIntentRel },
    },
  });
  stateStore.updateStage({ pipelineId, stageId: "plan", patch: { status: "failed" } });
  try {
    const response = await resumeHandlers.pipeline_resume(
      requestFrame(`resume-preflight-${label}`, "pipeline_resume", { pipelineId }),
      new AbortController().signal,
    );
    expect(response.kind).toBe("error");
    if (response.kind !== "error") return;
    expect(response.code).toBe("resume_dispatch_refused");
    expect(response.message).toContain(needle);
    expect(dispatchCalls).toBe(0);
    expect(stateStore.loadPipeline(pipelineId)?.stages.find((s) => s.stageId === "plan")?.status).toBe("pending");
  } finally {
    resumeHandlers.close();
    if (priorJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = priorJarvisHome;
    rmSync(jarvisRoot, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

const IMPLEMENT_IN_PLACE_DEFINITION: PipelineDefinition = {
  name: "implement-in-place",
  stages: [
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

const IMPLEMENT_GATE_COMMAND = "bun run test:agent";

function implementInPlaceSnapshot(invocationId: string): WorkflowSnapshot {
  return {
    invocationId,
    steps: [
      {
        stepId: "implement",
        role: "implement",
        stepRules: "implement rules",
        expectedArtifactPath: "spec/feature/index.md",
        agents: ["claude"],
        agentModelConfig: DEFAULT_AGENT_MODEL_CONFIG,
        durable: true,
      },
    ],
  };
}

function seedImplementGateRefusedSibling(
  store: StateStore,
  worktreePath: string,
  branch: string,
  invocationId: string,
): { entryRunId: string; causeRunId: string } {
  const snapshot = implementInPlaceSnapshot(invocationId);
  const entryRunId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath,
    branch,
    specPath: "spec/feature/index.md",
    stepId: "implement",
    status: "completed",
    workflowSnapshot: snapshot,
  });
  const causeRunId = store.createRun({
    project: "demo",
    specRef: "main",
    worktreePath,
    branch,
    specPath: "spec/feature/index.md",
    stepId: "implement~shrink",
    workflowSnapshot: snapshot,
  });
  const attemptId = store.recordAttemptStart(causeRunId);
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "gate_invocation_refused",
    terminalCause: "gate_invocation_refused",
    gateRefusalRecoveryState: {
      cause: "ceiling_headroom",
      gateCommand: IMPLEMENT_GATE_COMMAND,
      slotRedriveCount: 0,
    },
  });
  return { entryRunId, causeRunId };
}

function appendGateRefusalLog(_store: StateStore, causeRunId: string): string {
  const logsPath = join(tmpdir(), `pipeline-resume-log-${causeRunId}.jsonl`);
  const sink = openLogSink(logsPath);
  sink.append(causeRunId, {
    kind: "loop_finished",
    loopOutcomeKind: "gate_invocation_refused",
    iterationsConsumed: 1,
    resumable: true,
    gateCommand: IMPLEMENT_GATE_COMMAND,
  });
  sink.close();
  return logsPath;
}

function implementResumeBindingDeps(): { jarvisRoot: string; bindingDeps: WriteLoopBindingSourceDeps } {
  const jarvisRoot = trackedMkdtempSync(join(tmpdir(), "pipeline-resume-implement-jarvis-"));
  const machinesDir = join(jarvisRoot, "machines");
  mkdirSync(machinesDir, { recursive: true });
  const rung = (adapterModel: string) => ({ rungs: [{ adapterModel, priceKey: adapterModel }] });
  writeFileSync(
    join(machinesDir, "implement-resume.json"),
    JSON.stringify({
      models: {
        claude: {
          plan: rung("plan"),
          implement: rung("M1"),
          shrink: rung("S1"),
          adversary: rung("adv"),
          critic: rung("crit"),
          advocate: rung("advoc"),
          adjudicator: rung("adj"),
          actuator: rung("act"),
          routing: rung("act"),
        },
      },
    }),
  );
  writeFileSync(
    join(jarvisRoot, "config.json"),
    JSON.stringify({ machineProfile: "implement-resume", agents: ["claude"] }),
  );
  return {
    jarvisRoot,
    bindingDeps: { machineConfigPath: join(jarvisRoot, "config.json"), machinesDir },
  };
}

function gitWorktreePaths(repoRoot: string): string[] {
  const out = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  return out
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => realpathSync(resolve(line.slice("worktree ".length))));
}

/** Advance `planBranch` past `implementWorktree`'s HEAD so re-dispatch stale-reset would rematerialize. */
function advancePlanBasePastImplementWorktree(
  repoRoot: string,
  planWorktree: string,
  planBranch: string,
  implementWorktree: string,
): void {
  writeFileSync(join(planWorktree, "base-advance.md"), "advance\n", "utf8");
  execFileSync("git", ["add", "base-advance.md"], { cwd: planWorktree });
  execFileSync("git", ["commit", "-qm", "advance base"], { cwd: planWorktree });
  const worktreeHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: implementWorktree, encoding: "utf8" }).trim();
  let baseIsAncestor = true;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", planBranch, worktreeHead], { cwd: repoRoot });
  } catch {
    baseIsAncestor = false;
  }
  expect(baseIsAncestor).toBe(false);
}

function setupAdvancedBaseImplementWorktree(): {
  repoRoot: string;
  implementWorktree: string;
  branch: string;
} {
  const repoRoot = initChainedRepoBase();
  const planBranch = "plan/implement-in-place-base";
  const planWorktree = join(repoRoot, ".jarvis-worktrees", planBranch);
  mkdirSync(dirname(planWorktree), { recursive: true });
  execFileSync("git", ["branch", planBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", planWorktree, planBranch], { cwd: repoRoot });
  mkdirSync(join(planWorktree, "spec", "feature"), { recursive: true });
  writeFileSync(join(planWorktree, "spec/feature/index.md"), "# Feature\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: planWorktree });
  execFileSync("git", ["commit", "-qm", "plan"], { cwd: planWorktree });

  const branch = "implement/in-place-lane";
  const implementWorktree = join(repoRoot, ".jarvis-worktrees", branch);
  execFileSync("git", ["branch", branch, planBranch], { cwd: repoRoot });
  execFileSync("git", ["worktree", "add", implementWorktree, branch], { cwd: repoRoot });
  writeFileSync(join(implementWorktree, "spec/feature/00-work.md"), "# Work\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: implementWorktree });
  execFileSync("git", ["commit", "-qm", "implement checkpoint"], { cwd: implementWorktree });
  advancePlanBasePastImplementWorktree(repoRoot, planWorktree, planBranch, implementWorktree);
  return { repoRoot, implementWorktree, branch };
}

function setupImplementInPlacePipeline(
  store: StateStore,
  worktreePath: string,
  branch: string,
  invocationId: string,
): { pipelineId: string; entryRunId: string; causeRunId: string } {
  const { entryRunId, causeRunId } = seedImplementGateRefusedSibling(store, worktreePath, branch, invocationId);
  const pipelineId = store.createPipeline({
    definition: IMPLEMENT_IN_PLACE_DEFINITION,
    context: ADMISSION_CONTEXT,
  });
  store.updateStage({
    pipelineId,
    stageId: "plan",
    patch: {
      status: "succeeded",
      workflowInvocationId: "run-plan",
      artifact: { entryRunId: "run-plan", specPath: "spec" },
    },
  });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    patch: { status: "failed", workflowInvocationId: entryRunId },
  });
  return { pipelineId, entryRunId, causeRunId };
}

test("pipeline_resume resumes a gate-refused implement shrink sibling in place without stage re-dispatch", async () => {
  const priorJarvisHome = process.env.JARVIS_HOME;
  const { jarvisRoot, bindingDeps } = implementResumeBindingDeps();
  process.env.JARVIS_HOME = jarvisRoot;
  const { repoRoot, implementWorktree, branch } = setupAdvancedBaseImplementWorktree();
  const implementWorktreeResolved = realpathSync(implementWorktree);
  const worktreesBefore = gitWorktreePaths(repoRoot);
  expect(worktreesBefore.some((path) => path === implementWorktreeResolved)).toBe(true);
  let resolveStageCalls = 0;
  let executorCalls = 0;
  const fakeExecutor = createFakeWriteLoopExecutor();
  const { pipelineId, entryRunId, causeRunId } = setupImplementInPlacePipeline(
    stateStore,
    implementWorktree,
    branch,
    "inv-implement-in-place-unscoped",
  );
  const logsPath = appendGateRefusalLog(stateStore, causeRunId);
  const pipelineBeforeResume = stateStore.loadPipeline(pipelineId);
  if (!pipelineBeforeResume) throw new Error("pipeline missing");
  const target = resolveFailedImplementResumeTarget(stateStore, pipelineBeforeResume, undefined, (runId) =>
    openLogReader(logsPath).tail(runId),
  );
  expect(target?.causeRun.id).toBe(causeRunId);
  expect(target?.entryRunId).toBe(entryRunId);
  expect(causeRunId).not.toBe(entryRunId);
  const resumeHandlers = createRunControlHandlers({
    stateStore,
    logsPath,
    writeLoopBindingSourceDeps: bindingDeps,
    writeLoopExecutor: async (input, signal) => {
      executorCalls += 1;
      await fakeExecutor.executor(input, signal);
    },
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => {
      resolveStageCalls += 1;
      return { ok: false, error: "must not re-dispatch implement stage" };
    },
  });
  const invocationIdBefore = stateStore
    .loadPipeline(pipelineId)
    ?.stages.find((s) => s.stageId === "implement")?.workflowInvocationId;

  const response = await resumeHandlers.pipeline_resume(
    requestFrame("resume-implement-in-place", "pipeline_resume", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { kind: "resumed", pipelineId } });
  expect(stateStore.loadRun(entryRunId)?.status).toBe("completed");
  const implementStage = stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "implement");
  expect(implementStage?.workflowInvocationId).toBe(entryRunId);
  expect(implementStage?.workflowInvocationId).toBe(invocationIdBefore);
  expect(implementStage?.status).toBe("running");
  await waitFor(() => executorCalls > 0);
  expect(stateStore.loadRun(causeRunId)?.status).toBe("in-progress");
  expect(resolveStageCalls).toBe(0);
  expect(gitWorktreePaths(repoRoot)).toEqual(worktreesBefore);
  resumeHandlers.close();
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(jarvisRoot, { recursive: true, force: true });
  if (priorJarvisHome === undefined) delete process.env.JARVIS_HOME;
  else process.env.JARVIS_HOME = priorJarvisHome;
});

test("pipeline_resume branchKey resumes only the target implement lane in place", async () => {
  const priorJarvisHome = process.env.JARVIS_HOME;
  const { jarvisRoot, bindingDeps } = implementResumeBindingDeps();
  process.env.JARVIS_HOME = jarvisRoot;
  const worktreePath = trackedMkdtempSync(join(tmpdir(), "pipeline-resume-implement-branch-"));
  mkdirSync(worktreePath, { recursive: true });
  const branch = RESUME_BRANCH_TARGET;
  let resolveStageCalls = 0;
  let executorCalls = 0;
  const fakeExecutor = createFakeWriteLoopExecutor();
  const { pipelineId } = setupFanOutResumePipeline(stateStore);
  const { entryRunId, causeRunId } = seedImplementGateRefusedSibling(
    stateStore,
    worktreePath,
    branch,
    "inv-implement-branch-target",
  );
  const logsPath = appendGateRefusalLog(stateStore, causeRunId);
  const resumeHandlers = createRunControlHandlers({
    stateStore,
    logsPath,
    writeLoopBindingSourceDeps: bindingDeps,
    writeLoopExecutor: async (input, signal) => {
      executorCalls += 1;
      await fakeExecutor.executor(input, signal);
    },
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => {
      resolveStageCalls += 1;
      return { ok: false, error: "must not re-dispatch" };
    },
  });
  stateStore.updateStage({
    pipelineId,
    stageId: "plan",
    branchKey: branch,
    patch: {
      status: "succeeded",
      workflowInvocationId: "run-plan-target",
      artifact: { entryRunId: "run-plan-target", specPath: "spec/target" },
    },
  });
  stateStore.updateStage({
    pipelineId,
    stageId: "implement",
    branchKey: branch,
    patch: { status: "failed", workflowInvocationId: entryRunId },
  });
  const siblingStagesBefore = stateStore
    .loadPipeline(pipelineId)
    ?.stages.filter((stage) => stage.branchKey !== branch)
    .map((stage) => ({ ...stage }));

  const response = await resumeHandlers.pipeline_resume(
    requestFrame("resume-implement-branch", "pipeline_resume", { pipelineId, branchKey: branch }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { kind: "resumed", pipelineId } });
  expect(stateStore.loadRun(entryRunId)?.status).toBe("completed");
  expect(
    stateStore
      .loadPipeline(pipelineId)
      ?.stages.find((stage) => stage.stageId === "implement" && stage.branchKey === branch)?.workflowInvocationId,
  ).toBe(entryRunId);
  await waitFor(() => executorCalls > 0);
  expect(stateStore.loadRun(causeRunId)?.status).toBe("in-progress");
  expect(resolveStageCalls).toBe(0);
  const siblingStagesAfter = stateStore
    .loadPipeline(pipelineId)
    ?.stages.filter((stage) => stage.branchKey !== branch)
    .map((stage) => ({ ...stage }));
  expect(siblingStagesAfter).toEqual(siblingStagesBefore);
  resumeHandlers.close();
  rmSync(worktreePath, { recursive: true, force: true });
  rmSync(jarvisRoot, { recursive: true, force: true });
  if (priorJarvisHome === undefined) delete process.env.JARVIS_HOME;
  else process.env.JARVIS_HOME = priorJarvisHome;
});

test("pipeline_resume resumes a qualifying implement row on a dismissed pipeline", async () => {
  const priorJarvisHome = process.env.JARVIS_HOME;
  const { jarvisRoot, bindingDeps } = implementResumeBindingDeps();
  process.env.JARVIS_HOME = jarvisRoot;
  const worktreePath = trackedMkdtempSync(join(tmpdir(), "pipeline-resume-implement-dismissed-"));
  mkdirSync(worktreePath, { recursive: true });
  const branch = "feature/implement-dismissed";
  const resumeHandlers = createRunControlHandlers({
    stateStore,
    writeLoopBindingSourceDeps: bindingDeps,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => ({ ok: false, error: "must not re-dispatch" }),
  });
  const { pipelineId, entryRunId } = setupImplementInPlacePipeline(
    stateStore,
    worktreePath,
    branch,
    "inv-implement-dismissed",
  );
  stateStore.dismissPipeline({ pipelineId });
  const response = await resumeHandlers.pipeline_resume(
    requestFrame("resume-implement-dismissed", "pipeline_resume", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({ kind: "response", result: { kind: "resumed", pipelineId } });
  await waitFor(
    () =>
      stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "implement")?.status === "running",
  );
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "implement")?.status).toBe(
    "running",
  );
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "implement")).toMatchObject({
    workflowInvocationId: entryRunId,
  });
  resumeHandlers.close();
  rmSync(worktreePath, { recursive: true, force: true });
  rmSync(jarvisRoot, { recursive: true, force: true });
  if (priorJarvisHome === undefined) delete process.env.JARVIS_HOME;
  else process.env.JARVIS_HOME = priorJarvisHome;
});

test("pipeline_resume refuses run-resume admission for a qualifying row without re-dispatch", async () => {
  const worktreePath = trackedMkdtempSync(join(tmpdir(), "pipeline-resume-implement-refused-"));
  mkdirSync(worktreePath, { recursive: true });
  const branch = "feature/implement-refused";
  let resolveStageCalls = 0;
  const resumeHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    resolveStage: async () => {
      resolveStageCalls += 1;
      return { ok: true, steps: [{ behavior: "write" }] as never };
    },
  });
  const { pipelineId, entryRunId, causeRunId } = setupImplementInPlacePipeline(
    stateStore,
    worktreePath,
    branch,
    "inv-implement-refused",
  );
  const stageBefore = stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "implement");
  const response = await resumeHandlers.pipeline_resume(
    requestFrame("resume-implement-refused", "pipeline_resume", { pipelineId }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: {
      kind: "refused",
      pipelineId,
      reason: "resume_unsupported",
      message: expect.stringMatching(/.+/),
    },
  });
  expect(stateStore.loadRun(causeRunId)?.status).toBe("failed");
  expect(stateStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "implement")).toMatchObject({
    status: "failed",
    workflowInvocationId: entryRunId,
  });
  expect(stageBefore?.workflowInvocationId).toBe(entryRunId);
  expect(resolveStageCalls).toBe(0);
  resumeHandlers.close();
  rmSync(worktreePath, { recursive: true, force: true });
});
