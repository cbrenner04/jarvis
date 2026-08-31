import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationResult } from "../../../shared/invocation/execute.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { AnyWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import {
  openStateStore,
  type PipelineContext,
  type PipelineStageRecord,
  type StateStore,
} from "../persistence/state-store.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import { createBindingFactory, writeStepFixtures } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers } from "./daemon.ts";
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
  const repoRoot = mkdtempSync(join(tmpdir(), "pipeline-resume-chained-repo-"));
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
    store.updateStage({ pipelineId, stageId, branchKey: "default", patch: { status: "skipped" } });
  }
  store.updateStage({ pipelineId, stageId: "gate", branchKey: RESUME_BRANCH_TARGET, patch: { status: "approved" } });
  store.updateStage({ pipelineId, stageId: "plan", branchKey: RESUME_BRANCH_TARGET, patch: { status: "failed" } });
  store.updateStage({
    pipelineId,
    stageId: "implement",
    branchKey: RESUME_BRANCH_TARGET,
    patch: { status: "skipped" },
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
  // @mutate v2/src/daemon/daemon.ts "...(branchKey !== undefined ? { branchKey } : {})," -> "...(false ? { branchKey } : {}),"
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
    message: "test: implement stage intentionally fails to pin reopened suffix state",
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
  // @mutate v2/src/daemon/daemon.ts "if (params.branchKey !== undefined && (typeof params.branchKey !== \"string\" || params.branchKey.trim() === \"\")) {" -> "if (false) {"
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
  // @mutate v2/src/daemon/daemon.ts "if (params.branchKey !== undefined && (typeof params.branchKey !== \"string\" || params.branchKey.trim() === \"\")) {" -> "if (true && (typeof params.branchKey !== \"string\" || params.branchKey.trim() === \"\")) {"
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
  // this fixture's siblings are still `awaiting` their own gates, so unscoped resume claims
  // ownership and returns `resumed` without reopening or dispatching any branch — unlike the
  // branch-scoped `branch_not_found` refusal above.
  const defaultAliasResponse = await handlers.pipeline_resume(
    requestFrame("resume", "pipeline_resume", { pipelineId, branchKey: "default" }),
    new AbortController().signal,
  );
  expect(defaultAliasResponse).toEqual({ kind: "response", result: { kind: "resumed", pipelineId } });
  expect(stateStore.loadPipeline(pipelineId)?.stages.map((stage) => ({ ...stage }))).toEqual(before);
});

test("pipeline_resume dispatches chained plan and implement stages after prior worktree removal when input lives on durable branch", async () => {
  const priorJarvisHome = process.env.JARVIS_HOME;
  const jarvisRoot = mkdtempSync(join(tmpdir(), "pipeline-resume-jarvis-home-"));
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
