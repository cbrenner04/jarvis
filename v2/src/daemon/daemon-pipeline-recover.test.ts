import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planReviewPromptProfile } from "../../../shared/prompts/review-plan.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { AnyWorkflowStep, ReviewWorkflowStep } from "../execution/workflow-runner.ts";
import { recoverPlanStage } from "../execution/workflow-runner-resume.ts";
import { ensureWorkflowRunnerResumeDepsWired } from "../testing/workflow-runner-resume-wiring.ts";

ensureWorkflowRunnerResumeDepsWired();

import type { LogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import { flushBackgroundRuns, mockWriteLoopInput } from "../testing/run-control.ts";
import { createBindingFactory, writeStepFixtures } from "../testing/workflow-step-fixtures.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers, shouldShutdownNow, WorktreeOwnershipRegistry } from "./daemon.ts";
import {
  admitAndRecoverPipelineBranchStage,
  type PipelineStageRecoveryAttempt,
  type PipelineStageRecoveryExecutionDeps,
} from "./pipeline-stage-recovery.ts";

const { createWriteStep } = writeStepFixtures();

function requestFrame(id: string, method: string, params?: unknown) {
  return { kind: "request" as const, id, method, params };
}

const CONTEXT = { cwd: "/fake", seed: "seed text", configPath: "/fake/.jarvis/config.json" };

const FAN_OUT_DEFINITION: PipelineDefinition = {
  name: "full-review",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "light" },
    { stageId: "approve-intent", kind: "approval" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "debate" },
    { stageId: "approve-plan", kind: "approval" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "debate" },
  ],
};

const SINGLE_DEFINITION: PipelineDefinition = {
  name: "solo",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "debate" },
  ],
};

const BRANCH_KEYS = ["branch-a", "branch-b", "branch-c"];
const PLAN_REVIEW_CONFIG: AgentModelConfig = {
  claude: { critic: { rungs: [{ adapterModel: "critic", priceKey: "critic" }] } },
  codex: { actuator: { rungs: [{ adapterModel: "actuator", priceKey: "actuator" }] } },
};
const RECOVERY_MD_LINT_FIXTURES = join(
  import.meta.dir,
  "..",
  "execution",
  "fixtures",
  "write-loop-staged-markdown-lint",
);

/** Durable run row for a branch's blocked plan-draft — the shape a recovery target's linked entry run resolves to. */
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
      steps: [{ stepId: args.stepId, role: "plan", expectedArtifactPath: ".jarvis-plan-stage" }],
    },
  });
  const attemptId = store.recordAttemptStart(runId);
  store.commitCompletionBoundary({ attemptId, runStatus: "blocked", outcomeKind: "contract_miss" });
  return runId;
}

/** Production-shaped `full-review` fan-out: three branches, `targetBranchKey`'s plan row `failed` and linked to `entryRunId`. */
function seedFanOutPipeline(store: StateStore, args: { targetBranchKey: string; entryRunId: string }): string {
  const pipelineId = store.createPipeline({ definition: FAN_OUT_DEFINITION, context: CONTEXT });
  store.updateStage({
    pipelineId,
    stageId: "intent",
    patch: {
      status: "succeeded",
      workflowInvocationId: "run-intent",
      artifact: {
        entryRunId: "run-intent",
        specPath: "ready-intents/index.md",
        downstreamInputs: BRANCH_KEYS.map((key) => `ready-intents/${key}.md`),
      },
    },
  });
  for (const branchKey of BRANCH_KEYS) {
    store.createPipelineStageBranch({ pipelineId, stageId: "approve-intent", branchKey });
    store.createPipelineStageBranch({ pipelineId, stageId: "plan", branchKey });
    store.createPipelineStageBranch({ pipelineId, stageId: "approve-plan", branchKey });
    store.createPipelineStageBranch({ pipelineId, stageId: "implement", branchKey });
  }
  for (const stageId of ["approve-intent", "plan", "approve-plan", "implement"] as const) {
    store.updateStage({ pipelineId, stageId, branchKey: "default", patch: { status: "skipped" } });
  }
  for (const branchKey of BRANCH_KEYS) {
    store.updateStage({ pipelineId, stageId: "approve-intent", branchKey, patch: { status: "approved" } });
  }
  store.updateStage({
    pipelineId,
    stageId: "plan",
    branchKey: args.targetBranchKey,
    patch: { status: "failed", workflowInvocationId: args.entryRunId, failureDetail: { message: "blocked" } },
  });
  // Mirrors the real failure cascade: a failed workflow stage skips the rest of that branch's suffix.
  for (const stageId of ["approve-plan", "implement"] as const) {
    store.updateStage({ pipelineId, stageId, branchKey: args.targetBranchKey, patch: { status: "skipped" } });
  }
  return pipelineId;
}

/** Typed `ReviewWorkflowStep` for plan-stage recovery: `plan-tree` landing, per-role `agents`, `createBinding`, and `verdictPath` under `stage`. Use when resolution or recover handlers need a full review step after a write step, not a cast partial. */
function planReviewStep(args: {
  worktreePath: string;
  stage: string;
  durable: string;
  branch: string;
}): ReviewWorkflowStep {
  return {
    behavior: "review",
    stepId: "plan-review",
    project: "demo",
    branch: args.branch,
    cwd: args.worktreePath,
    prompt: "",
    verdictPath: join(args.stage, "verdict-plan.md"),
    maxCycles: 1,
    agents: { critic: ["claude"], actuator: ["codex"] },
    agentModelConfig: PLAN_REVIEW_CONFIG,
    profile: planReviewPromptProfile,
    profileContext: { specPath: args.stage, worktreePath: args.worktreePath },
    landing: { kind: "plan-tree", stagingDir: ".jarvis-plan-stage", durablePath: args.durable },
    createBinding: ({ agentId }) => ({
      id: agentId,
      metadata: { agent: agentId, model: agentId },
      invoke: async () => ({
        kind: "ok" as const,
        stdout: agentId === "claude" ? "Looks good" : "done",
        stderr: "",
      }),
    }),
  };
}

function createPlanWorktree(prefix: string): string {
  const worktreePath = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd: worktreePath });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: worktreePath });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: worktreePath });
  execFileSync("git", ["commit", "--allow-empty", "-qm", "base"], { cwd: worktreePath });
  return worktreePath;
}

function writeCorrectedPlanStage(stage: string): string {
  const subspecFile = "00-first.md";
  const correctedBody = readFileSync(join(RECOVERY_MD_LINT_FIXTURES, "plan-md012-clean-subspec.md"), "utf8");
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "intent.md"), "---\nname: test\n---\n", "utf8");
  writeFileSync(join(stage, "index.md"), `# Index\n\n- [ ] [One](./${subspecFile})\n`, "utf8");
  writeFileSync(join(stage, subspecFile), correctedBody, "utf8");
  return correctedBody;
}

function completeOutcome(entryRunId: string) {
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

function recoveryStageResolver(args: { branch: string; worktreePath: string; specPath: string }) {
  return async () => ({
    ok: true as const,
    results: BRANCH_KEYS.map(() => ({
      steps: [
        createWriteStep("plan", args.branch),
        planReviewStep({
          worktreePath: args.worktreePath,
          stage: join(args.worktreePath, ".jarvis-plan-stage"),
          durable: join(args.worktreePath, args.specPath),
          branch: args.branch,
        }),
      ],
    })),
  });
}

function recoveryStageRecord(store: StateStore, pipelineId: string, branchKey = "branch-a") {
  return store
    .loadPipeline(pipelineId)
    ?.stages.find((stage) => stage.stageId === "plan" && stage.branchKey === branchKey);
}

let stateStore: StateStore;
let dbPath: string;
let handlers: ReturnType<typeof createRunControlHandlers>;

beforeEach(() => {
  dbPath = join(tmpdir(), `jarvis-pipeline-recover-${process.pid}-${Date.now()}-${Math.random()}.db`);
  stateStore = openStateStore(dbPath);
  handlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
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

test("pipeline_recover admits and lands a corrected non-first fan-out branch without redrafting", async () => {
  const worktreePath = createPlanWorktree("jarvis-pipeline-recover-branch-b-");
  const stage = join(worktreePath, ".jarvis-plan-stage");
  const correctedBody = writeCorrectedPlanStage(stage);
  const specPath = "spec/2026-recover-branch-b";
  const durable = join(worktreePath, specPath);
  const branch = "plan/recover-branch-b";
  const entryRunId = seedBlockedPlanDraftRun(stateStore, {
    project: "demo",
    branch,
    worktreePath,
    specPath,
    stepId: "plan",
    invocationId: "recover-branch-b-inv",
  });
  const pipelineId = seedFanOutPipeline(stateStore, { targetBranchKey: "branch-b", entryRunId });
  const before = stateStore.loadPipeline(pipelineId);
  const siblingRowsBefore = before?.stages.filter(
    (stageRow) => stageRow.branchKey === "branch-a" || stageRow.branchKey === "branch-c",
  );

  const draftAgentInvocations: string[] = [];
  const dispatchCalls: AnyWorkflowStep[][] = [];
  let staleResetConnections = 0;
  let settleAttempt!: () => void;
  const attemptSettled = new Promise<void>((resolve) => {
    settleAttempt = resolve;
  });
  const recoverHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    daemonSocketPath: "/unused-pipeline-recover-reset.sock",
    connectStaleResetClient: async () => {
      staleResetConnections += 1;
      throw new Error("pipeline_recover must not invoke stale reset");
    },
    pipelineDispatch: async (steps) => {
      dispatchCalls.push(steps);
      return { ok: true, entryRunId: "unexpected-run", invocationId: "unexpected-inv" };
    },
    pipelineWait: async () => "completed",
    recoveryAttempt: async (request) => {
      try {
        return await recoverPlanStage(request);
      } finally {
        settleAttempt();
      }
    },
    resolveStage: async () => ({
      ok: true,
      results: BRANCH_KEYS.map((branchKey) => ({
        steps: [
          createWriteStep(
            `plan-${branchKey}`,
            `plan/${branchKey}`,
            createBindingFactory(async () => {
              draftAgentInvocations.push(branchKey);
              return { kind: "ok", stdout: "done", stderr: "" };
            }),
          ),
          branchKey === "branch-b"
            ? planReviewStep({ worktreePath, stage, durable, branch })
            : planReviewStep({
                worktreePath: `${worktreePath}-${branchKey}`,
                stage: `${stage}-${branchKey}`,
                durable: `${durable}-${branchKey}`,
                branch: `plan/${branchKey}`,
              }),
        ],
      })),
    }),
  });

  const response = await recoverHandlers.pipeline_recover(
    requestFrame("r", "pipeline_recover", {
      pipelineId,
      branchKey: "branch-b",
      resetDespiteDirty: true,
      resetDespiteLandedCriteria: true,
    }),
    new AbortController().signal,
  );

  expect(response).toEqual({
    kind: "response",
    result: { kind: "admitted", pipelineId, branchKey: "branch-b", stageId: "plan", entryRunId },
  });
  await attemptSettled;
  await flushBackgroundRuns(5);
  expect(recoverHandlers.hasActiveRuns()).toBe(false);
  expect(draftAgentInvocations).toEqual([]);
  expect(dispatchCalls).toEqual([]);
  expect(staleResetConnections).toBe(0);
  expect(readFileSync(join(durable, "00-first.md"), "utf8")).toBe(correctedBody);

  const pipeline = stateStore.loadPipeline(pipelineId);
  const planRow = pipeline?.stages.find((stageRow) => stageRow.stageId === "plan" && stageRow.branchKey === "branch-b");
  expect(planRow?.status).toBe("succeeded");
  expect(planRow?.workflowInvocationId).toBe(entryRunId);
  const approvePlanRow = pipeline?.stages.find(
    (stageRow) => stageRow.stageId === "approve-plan" && stageRow.branchKey === "branch-b",
  );
  expect(approvePlanRow?.status).toBe("awaiting");
  const siblingRowsAfter = pipeline?.stages.filter(
    (stageRow) => stageRow.branchKey === "branch-a" || stageRow.branchKey === "branch-c",
  );
  expect(siblingRowsAfter).toEqual(siblingRowsBefore);
});

test("pipeline_recover admits one branch and advances it without redrafting", async () => {
  const draftAgentInvocations: string[] = [];
  const worktreePath = "/fake/worktree/branch-a";
  const branch = "plan/recover-branch-a";
  const specPath = "spec/2026-recover-branch-a";
  const durable = join(worktreePath, specPath);

  const entryRunId = seedBlockedPlanDraftRun(stateStore, {
    project: "demo",
    branch,
    worktreePath,
    specPath,
    stepId: "plan",
    invocationId: "recover-inv",
  });
  const pipelineId = seedFanOutPipeline(stateStore, { targetBranchKey: "branch-a", entryRunId });

  const before = stateStore.loadPipeline(pipelineId);
  const siblingRowsBefore = before?.stages.filter((s) => s.branchKey === "branch-b" || s.branchKey === "branch-c");

  const dispatchCalls: AnyWorkflowStep[][] = [];
  const deps: PipelineStageRecoveryExecutionDeps = {
    store: stateStore,
    dispatch: async (steps) => {
      dispatchCalls.push(steps);
      return { ok: true, entryRunId: "unexpected-run", invocationId: "unexpected-inv" };
    },
    wait: async () => "completed",
    resolveStage: async () => ({
      ok: true,
      results: BRANCH_KEYS.map(() => ({
        steps: [
          createWriteStep(
            "plan",
            branch,
            createBindingFactory(async () => {
              draftAgentInvocations.push("claude");
              return { kind: "ok", stdout: "done", stderr: "" };
            }),
          ),
          planReviewStep({ worktreePath, stage: join(worktreePath, ".jarvis-plan-stage"), durable, branch }),
        ],
      })),
    }),
    attempt: async () => completeOutcome(entryRunId),
  };

  // Fails against pre-fix code: no `pipeline_recover`/admission-and-recovery seam exists to invoke.
  const outcome = await admitAndRecoverPipelineBranchStage({ pipelineId, branchKey: "branch-a" }, deps, {
    detachContinuation: false,
  });

  // Keystone checkpoint: neutering the detached-recovery dispatch (`await run;` -> `void run;`)
  // returns before the attempt/settlement/continuation finish, restoring an admission-only
  // no-op — the settlement assertions below observe the still-`failed` row and go RED.
  // @mutate v2/src/daemon/pipeline-stage-recovery.ts "await run;" -> "void run;"
  expect(outcome).toEqual({ kind: "admitted", pipelineId, branchKey: "branch-a", stageId: "plan", entryRunId });
  expect(draftAgentInvocations).toEqual([]);
  expect(dispatchCalls).toEqual([]);

  const pipeline = stateStore.loadPipeline(pipelineId);
  const planRow = pipeline?.stages.find((s) => s.stageId === "plan" && s.branchKey === "branch-a");
  expect(planRow?.status).toBe("succeeded");
  expect(planRow?.workflowInvocationId).toBe(entryRunId);

  const approvePlanRow = pipeline?.stages.find((s) => s.stageId === "approve-plan" && s.branchKey === "branch-a");
  expect(approvePlanRow?.status).toBe("awaiting");
  const implementRow = pipeline?.stages.find((s) => s.stageId === "implement" && s.branchKey === "branch-a");
  expect(implementRow?.status).toBe("pending");

  const siblingRowsAfter = pipeline?.stages.filter((s) => s.branchKey === "branch-b" || s.branchKey === "branch-c");
  expect(siblingRowsAfter).toEqual(siblingRowsBefore);
});

test("pipeline_recover refuses invalid params, an unresolvable target, and a retiring daemon", async () => {
  const INVALID_PARAMS_ERROR = {
    kind: "error",
    code: "invalid_params",
    message: "pipelineId and branchKey required",
  } as const;
  let validationMemoryChecks = 0;
  const validationHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => {
      validationMemoryChecks += 1;
      return false;
    },
  });
  // Each fixture below isolates exactly one added guard condition (the other field is a
  // syntactically valid, non-existent placeholder) so that guard's own mutation — and no
  // other guard's — turns this test red.
  const nonExistentPipelineNotStringResponse = await validationHandlers.pipeline_recover(
    requestFrame("r", "pipeline_recover", { pipelineId: 42, branchKey: "valid-branch" }),
    new AbortController().signal,
  );
  // @mutate v2/src/daemon/daemon.ts "      typeof params?.pipelineId !== \"string\" ||" -> "      false ||"
  expect(nonExistentPipelineNotStringResponse).toEqual(INVALID_PARAMS_ERROR);

  const emptyPipelineIdResponse = await validationHandlers.pipeline_recover(
    requestFrame("r", "pipeline_recover", { pipelineId: "", branchKey: "valid-branch" }),
    new AbortController().signal,
  );
  // @mutate v2/src/daemon/daemon.ts "params.pipelineId.length === 0 ||" -> "false ||"
  expect(emptyPipelineIdResponse).toEqual(INVALID_PARAMS_ERROR);

  const nonExistentBranchNotStringResponse = await validationHandlers.pipeline_recover(
    requestFrame("r", "pipeline_recover", { pipelineId: "valid-pipeline", branchKey: 42 }),
    new AbortController().signal,
  );
  // @mutate v2/src/daemon/daemon.ts "typeof params?.branchKey !== \"string\" ||" -> "false ||"
  expect(nonExistentBranchNotStringResponse).toEqual(INVALID_PARAMS_ERROR);

  const emptyBranchKeyResponse = await validationHandlers.pipeline_recover(
    requestFrame("r", "pipeline_recover", { pipelineId: "valid-pipeline", branchKey: "" }),
    new AbortController().signal,
  );
  // @mutate v2/src/daemon/daemon.ts "params.branchKey.length === 0" -> "false"
  expect(emptyBranchKeyResponse).toEqual(INVALID_PARAMS_ERROR);

  const unresolvedResponse = await validationHandlers.pipeline_recover(
    requestFrame("r", "pipeline_recover", { pipelineId: "unknown-pipeline", branchKey: "branch-a" }),
    new AbortController().signal,
  );
  expect(unresolvedResponse).toEqual({
    kind: "response",
    result: {
      kind: "resolution_refused",
      pipelineId: "unknown-pipeline",
      branchKey: "branch-a",
      reason: "pipeline_not_found",
      message: "pipeline unknown-pipeline not found",
    },
  });
  expect(validationMemoryChecks).toBe(0);

  const worktreePath = "/fake/worktree/branch-claimed";
  const branch = "plan/worktree-claimed";
  const specPath = "spec/2026-worktree-claimed";
  const entryRunId = seedBlockedPlanDraftRun(stateStore, {
    project: "demo",
    branch,
    worktreePath,
    specPath,
    stepId: "plan",
    invocationId: "worktree-claimed-inv",
  });
  const pipelineId = seedFanOutPipeline(stateStore, { targetBranchKey: "branch-a", entryRunId });

  const registry = new WorktreeOwnershipRegistry();
  registry.claim({ project: "demo", branch }, { runId: "other-run", worktreePath });
  const dispatchCalls: AnyWorkflowStep[][] = [];
  const claimedHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    registry,
    pipelineDispatch: async (steps) => {
      dispatchCalls.push(steps);
      return { ok: true, entryRunId: "unexpected-run", invocationId: "unexpected-inv" };
    },
    resolveStage: recoveryStageResolver({ branch, worktreePath, specPath }),
  });

  // @mutate v2/src/daemon/daemon-workflow-admission-handlers.ts "const claimError = previewWorkflowStartClaimAdmissionRefusal(store, registry, activeRuns, lifecycle.key);" -> "const claimError = undefined;"
  const claimedResponse = await claimedHandlers.pipeline_recover(
    requestFrame("r", "pipeline_recover", { pipelineId, branchKey: "branch-a" }),
    new AbortController().signal,
  );
  expect(claimedResponse).toEqual({
    kind: "error",
    code: "worktree_claimed",
    message: `Worktree already claimed for project=demo, branch=${branch}`,
  });
  expect(dispatchCalls).toEqual([]);
  const pipelineAfterClaim = stateStore.loadPipeline(pipelineId);
  const planRowAfterClaim = pipelineAfterClaim?.stages.find((s) => s.stageId === "plan" && s.branchKey === "branch-a");
  expect(planRowAfterClaim?.status).toBe("failed");
  expect(planRowAfterClaim?.workflowInvocationId).toBe(entryRunId);

  handlers.setRetiring();
  // @mutate v2/src/daemon/daemon.ts "if (retiring === true) {" -> "if (false) {"
  const retiringResponse = await handlers.pipeline_recover(
    requestFrame("r", "pipeline_recover", { pipelineId, branchKey: "branch-a" }),
    new AbortController().signal,
  );
  expect(retiringResponse).toEqual({
    kind: "error",
    code: "daemon_superseded",
    message: "Daemon is retiring and not accepting new work",
  });
  const pipelineAfterRetiring = stateStore.loadPipeline(pipelineId);
  const planRowAfterRetiring = pipelineAfterRetiring?.stages.find(
    (s) => s.stageId === "plan" && s.branchKey === "branch-a",
  );
  expect(planRowAfterRetiring?.status).toBe("failed");
});

test("live workflow starts and recovery share ownership and memory refusal precedence", async () => {
  let recoveryAttemptCalls = 0;
  const seedTarget = (label: string) => {
    const branch = `plan/shared-admission-${label}`;
    const worktreePath = `/fake/worktree/shared-admission-${label}`;
    const specPath = `spec/shared-admission-${label}`;
    const entryRunId = seedBlockedPlanDraftRun(stateStore, {
      project: "demo",
      branch,
      worktreePath,
      specPath,
      stepId: "plan",
      invocationId: `shared-admission-${label}-inv`,
    });
    const pipelineId = seedFanOutPipeline(stateStore, { targetBranchKey: "branch-a", entryRunId });
    return { branch, worktreePath, specPath, pipelineId };
  };
  const runPair = async (
    label: string,
    setup: (args: {
      registry: WorktreeOwnershipRegistry;
      branch: string;
      handlers: ReturnType<typeof createRunControlHandlers>;
    }) => Promise<void> | void,
    expectedCode: "worktree_claimed" | "insufficient_memory",
  ) => {
    const target = seedTarget(label);
    const key = { project: "demo", branch: target.branch };
    const registry = new WorktreeOwnershipRegistry();
    let memoryChecks = 0;
    const sharedHandlers = createRunControlHandlers({
      stateStore,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => {},
      registry,
      hasMemoryHeadroom: () => {
        memoryChecks += 1;
        return false;
      },
      resolveStage: recoveryStageResolver(target),
      recoveryAttempt: async () => {
        recoveryAttemptCalls += 1;
        throw new Error("early refusal must not run recovery");
      },
    });
    await setup({ registry, branch: target.branch, handlers: sharedHandlers });
    memoryChecks = 0;
    const stageBefore = recoveryStageRecord(stateStore, target.pipelineId);
    const admissionBefore = stateStore.loadPipelineStageAdmission({
      pipelineId: target.pipelineId,
      stageId: "plan",
      branchKey: "branch-a",
    });

    const liveStart = await sharedHandlers.start(
      requestFrame(`start-${label}`, "start", { steps: [createWriteStep("plan", target.branch)] }),
      new AbortController().signal,
    );
    const recovery = await sharedHandlers.pipeline_recover(
      requestFrame(`recover-${label}`, "pipeline_recover", { pipelineId: target.pipelineId, branchKey: "branch-a" }),
      new AbortController().signal,
    );

    expect(liveStart).toEqual({ kind: "error", code: expectedCode, message: expect.any(String) });
    expect(recovery).toEqual({ kind: "error", code: expectedCode, message: expect.any(String) });
    expect(recoveryStageRecord(stateStore, target.pipelineId)).toEqual(stageBefore);
    expect(
      stateStore.loadPipelineStageAdmission({ pipelineId: target.pipelineId, stageId: "plan", branchKey: "branch-a" }),
    ).toEqual(admissionBefore);
    expect(sharedHandlers.hasActiveRuns()).toBe(false);
    return { key, registry, memoryChecks };
  };

  const queued = await runPair(
    "queued",
    async ({ branch, handlers: queuedHandlers }) => {
      const queued = await queuedHandlers.start(
        requestFrame("queue-owner", "start", {
          input: mockWriteLoopInput({ projectName: "demo", branchName: branch }),
        }),
        new AbortController().signal,
      );
      expect(queued.kind).toBe("response");
    },
    "worktree_claimed",
  );
  expect(queued.memoryChecks).toBe(0);
  expect(queued.registry.get(queued.key)).toBeUndefined();

  const owner = { runId: "existing-live-owner", worktreePath: "/existing/live-owner" };
  const live = await runPair(
    "live",
    ({ registry, branch }) => registry.claim({ project: "demo", branch }, owner),
    "worktree_claimed",
  );
  expect(live.memoryChecks).toBe(0);
  expect(live.registry.get(live.key)).toEqual(owner);

  const stale = await runPair(
    "stale-workflow",
    ({ registry, branch }) =>
      registry.claim(
        { project: "demo", branch },
        { runId: "stale-workflow-owner", worktreePath: "/stale/workflow", workflow: true },
      ),
    "insufficient_memory",
  );
  expect(stale.memoryChecks).toBe(2);
  expect(stale.registry.get(stale.key)).toBeUndefined();

  const free = await runPair("free-memory", () => {}, "insufficient_memory");
  expect(free.memoryChecks).toBe(2);
  expect(free.registry.get(free.key)).toBeUndefined();
  expect(recoveryAttemptCalls).toBe(0);
});

test("recovery lifecycle admission refusal and exceptions roll back common acquisition", async () => {
  const branch = "plan/recovery-admission-rollback";
  const worktreePath = "/fake/worktree/recovery-admission-rollback";
  const specPath = "spec/recovery-admission-rollback";
  const entryRunId = seedBlockedPlanDraftRun(stateStore, {
    project: "demo",
    branch,
    worktreePath,
    specPath,
    stepId: "plan",
    invocationId: "recovery-admission-rollback-inv",
  });
  const pipelineId = seedFanOutPipeline(stateStore, { targetBranchKey: "branch-a", entryRunId });
  const stageAdmission = { pipelineId, stageId: "plan", branchKey: "branch-a" };
  const stageBefore = recoveryStageRecord(stateStore, pipelineId);
  let recoveryAttemptCalls = 0;

  const invoke = async (args: {
    registry: WorktreeOwnershipRegistry;
    logState: { opened: number; closed: number };
    logFactory?: () => LogSink;
  }) => {
    const rollbackHandlers = createRunControlHandlers({
      stateStore,
      writeLoopExecutor: createFakeWriteLoopExecutor().executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      registry: args.registry,
      logsPath: "/unused/recovery-admission.log",
      recoveryLogSinkFactory:
        args.logFactory ??
        (() => {
          args.logState.opened += 1;
          return {
            append: () => {},
            close: () => {
              args.logState.closed += 1;
            },
          };
        }),
      recoveryAttempt: async () => {
        recoveryAttemptCalls += 1;
        throw new Error("admission refusal must not run recovery");
      },
      resolveStage: recoveryStageResolver({ branch, worktreePath, specPath }),
    });
    const result = rollbackHandlers.pipeline_recover(
      requestFrame("recover-rollback", "pipeline_recover", { pipelineId, branchKey: "branch-a" }),
      new AbortController().signal,
    );
    return { rollbackHandlers, result };
  };
  const expectCommonReleased = (
    rollbackHandlers: ReturnType<typeof createRunControlHandlers>,
    registry: WorktreeOwnershipRegistry,
  ) => {
    expect(registry.get({ project: "demo", branch })).toBeUndefined();
    expect(rollbackHandlers.context.activeRuns.get(`demo:${branch}`)).toBeUndefined();
    expect(rollbackHandlers.hasActiveRuns()).toBe(false);
    expect(recoveryStageRecord(stateStore, pipelineId)).toEqual(stageBefore);
  };

  expect(stateStore.claimPipelineStageAdmission(stageAdmission)).toEqual({ kind: "applied" });
  const refusedRegistry = new WorktreeOwnershipRegistry();
  const refusedLog = { opened: 0, closed: 0 };
  const refused = await invoke({ registry: refusedRegistry, logState: refusedLog });
  expect(await refused.result).toEqual({
    kind: "response",
    result: { kind: "stage_claimed", pipelineId, branchKey: "branch-a", stageId: "plan" },
  });
  expectCommonReleased(refused.rollbackHandlers, refusedRegistry);
  expect(refusedLog).toEqual({ opened: 1, closed: 1 });
  expect(stateStore.loadPipelineStageAdmission(stageAdmission).kind).toBe("present");
  stateStore.releasePipelineStageAdmission(stageAdmission);

  const originalClaimAdmission = stateStore.claimPipelineStageAdmission.bind(stateStore);
  stateStore.claimPipelineStageAdmission = (args) => {
    const outcome = originalClaimAdmission(args);
    if (outcome.kind === "applied") throw new Error("claim admission failed after acquisition");
    return outcome;
  };
  const claimRegistry = new WorktreeOwnershipRegistry();
  const claimLog = { opened: 0, closed: 0 };
  const claimFailure = await invoke({ registry: claimRegistry, logState: claimLog });
  await expect(claimFailure.result).rejects.toThrow("claim admission failed after acquisition");
  stateStore.claimPipelineStageAdmission = originalClaimAdmission;
  expectCommonReleased(claimFailure.rollbackHandlers, claimRegistry);
  expect(claimLog).toEqual({ opened: 1, closed: 1 });
  expect(stateStore.loadPipelineStageAdmission(stageAdmission)).toEqual({ kind: "absent" });

  const logRegistry = new WorktreeOwnershipRegistry();
  const logState = { opened: 0, closed: 0 };
  const logFailure = await invoke({
    registry: logRegistry,
    logState,
    logFactory: () => {
      logState.opened += 1;
      throw new Error("log admission failed");
    },
  });
  await expect(logFailure.result).rejects.toThrow("log admission failed");
  expectCommonReleased(logFailure.rollbackHandlers, logRegistry);
  expect(logState).toEqual({ opened: 1, closed: 0 });
  expect(stateStore.loadPipelineStageAdmission(stageAdmission)).toEqual({ kind: "absent" });
  expect(recoveryAttemptCalls).toBe(0);
});

test("losing recovery to a concurrent dispatch claim leaves the winner admission intact", async () => {
  const branch = "plan/concurrent-dispatch-claim";
  const worktreePath = "/fake/worktree/concurrent-dispatch-claim";
  const specPath = "spec/concurrent-dispatch-claim";
  const entryRunId = seedBlockedPlanDraftRun(stateStore, {
    project: "demo",
    branch,
    worktreePath,
    specPath,
    stepId: "plan",
    invocationId: "concurrent-dispatch-claim-inv",
  });
  const pipelineId = seedFanOutPipeline(stateStore, { targetBranchKey: "branch-a", entryRunId });
  const stageAdmission = { pipelineId, stageId: "plan", branchKey: "branch-a" };
  const dispatchStore = openStateStore(dbPath, { currentIdentity: "dispatch-holder" });

  const originalClaimAdmission = stateStore.claimPipelineStageAdmission.bind(stateStore);
  let recoveryClaimAttempted = false;
  stateStore.claimPipelineStageAdmission = (args) => {
    recoveryClaimAttempted = true;
    const dispatchWin = dispatchStore.claimPipelineStageAdmission(args);
    expect(dispatchWin).toEqual({ kind: "applied" });
    return originalClaimAdmission(args);
  };

  const rollbackHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    recoveryAttempt: async () => {
      throw new Error("concurrent refusal must not run recovery");
    },
    resolveStage: recoveryStageResolver({ branch, worktreePath, specPath }),
  });
  const response = await rollbackHandlers.pipeline_recover(
    requestFrame("recover-concurrent", "pipeline_recover", { pipelineId, branchKey: "branch-a" }),
    new AbortController().signal,
  );

  expect(recoveryClaimAttempted).toBe(true);
  expect(response).toEqual({
    kind: "response",
    result: { kind: "stage_claimed", pipelineId, branchKey: "branch-a", stageId: "plan" },
  });
  expect(dispatchStore.loadPipelineStageAdmission(stageAdmission)).toEqual({
    kind: "present",
    holderIdentity: "dispatch-holder",
  });
  expect(rollbackHandlers.hasActiveRuns()).toBe(false);

  dispatchStore.releasePipelineStageAdmission(stageAdmission);
  dispatchStore.close();
});

test("pipeline_recover preserves an operator blocker on the named fan-out branch", async () => {
  const worktreePath = "/fake/worktree/operator-blocker-branch-b";
  const branch = "plan/operator-blocker-branch-b";
  const specPath = "spec/2026-operator-blocker-branch-b";
  const entryRunId = seedBlockedPlanDraftRun(stateStore, {
    project: "demo",
    branch,
    worktreePath,
    specPath,
    stepId: "plan",
    invocationId: "operator-blocker-branch-b-inv",
  });
  const pipelineId = seedFanOutPipeline(stateStore, { targetBranchKey: "branch-b", entryRunId });
  const before = stateStore.loadPipeline(pipelineId);
  const siblingRowsBefore = before?.stages.filter(
    (stageRow) => stageRow.branchKey === "branch-a" || stageRow.branchKey === "branch-c",
  );
  const dispatchCalls: AnyWorkflowStep[][] = [];
  const blockerHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    pipelineDispatch: async (steps) => {
      dispatchCalls.push(steps);
      return { ok: true, entryRunId: "unexpected-run", invocationId: "unexpected-inv" };
    },
    pipelineWait: async () => "completed",
    resolveStage: recoveryStageResolver({ branch, worktreePath, specPath }),
    recoveryAttempt: async () => ({
      ok: false,
      code: "operator_blocker",
      message: "staged plan carries an operator-authored blocker",
    }),
  });

  const response = await blockerHandlers.pipeline_recover(
    requestFrame("r", "pipeline_recover", { pipelineId, branchKey: "branch-b" }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "admitted", pipelineId, branchKey: "branch-b", stageId: "plan", entryRunId },
  });
  await flushBackgroundRuns(5);

  const pipeline = stateStore.loadPipeline(pipelineId);
  const planRow = pipeline?.stages.find((stageRow) => stageRow.stageId === "plan" && stageRow.branchKey === "branch-b");
  expect(planRow?.status).toBe("failed");
  expect(planRow?.workflowInvocationId).toBe(entryRunId);
  expect(planRow?.failureDetail).toEqual({
    code: "operator_blocker",
    message: "staged plan carries an operator-authored blocker",
  });
  expect(dispatchCalls).toEqual([]);
  const siblingRowsAfter = pipeline?.stages.filter(
    (stageRow) => stageRow.branchKey === "branch-a" || stageRow.branchKey === "branch-c",
  );
  expect(siblingRowsAfter).toEqual(siblingRowsBefore);
});

test("a retiring daemon waits for an in-flight detached recovery", async () => {
  const worktreePath = "/fake/worktree/branch-a";
  const branch = "plan/wait-recovery";
  const specPath = "spec/2026-wait-recovery";
  const entryRunId = seedBlockedPlanDraftRun(stateStore, {
    project: "demo",
    branch,
    worktreePath,
    specPath,
    stepId: "plan",
    invocationId: "wait-recovery-inv",
  });
  const pipelineId = seedFanOutPipeline(stateStore, { targetBranchKey: "branch-a", entryRunId });

  let settleAttempt: (() => void) | undefined;
  const recoveryAttempt: PipelineStageRecoveryAttempt = () =>
    new Promise((resolve) => {
      settleAttempt = () => resolve(completeOutcome(entryRunId));
    });

  const waitHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    recoveryAttempt,
    resolveStage: async () => ({
      ok: true,
      results: BRANCH_KEYS.map(() => ({
        steps: [
          createWriteStep("plan", branch),
          planReviewStep({
            worktreePath,
            stage: join(worktreePath, ".jarvis-plan-stage"),
            durable: join(worktreePath, specPath),
            branch,
          }),
        ],
      })),
    }),
  });

  const response = await waitHandlers.pipeline_recover(
    requestFrame("r", "pipeline_recover", { pipelineId, branchKey: "branch-a" }),
    new AbortController().signal,
  );
  expect(response).toEqual({
    kind: "response",
    result: { kind: "admitted", pipelineId, branchKey: "branch-a", stageId: "plan", entryRunId },
  });

  // Mutation checkpoint: removing common `activeRuns` registration leaves `hasActiveRuns()` false while detached.
  // @mutate v2/src/daemon/daemon.ts "activeRuns.set(lifecycle.activeKey, lifecycle.activeRun);" -> "void lifecycle.activeKey;"
  // The attempt has not settled: hasActiveRuns() stays true, and retirement waits rather than shutting down.
  expect(waitHandlers.hasActiveRuns()).toBe(true);
  expect(waitHandlers.context.activeRuns.get(`demo:${branch}`)).toEqual({ kind: "recovery", runId: entryRunId });
  waitHandlers.setRetiring();
  expect(shouldShutdownNow(false, waitHandlers.isRetiring(), waitHandlers.hasActiveRuns())).toBe(false);

  settleAttempt?.();
  await flushBackgroundRuns(5);

  expect(waitHandlers.hasActiveRuns()).toBe(false);
  expect(shouldShutdownNow(false, waitHandlers.isRetiring(), waitHandlers.hasActiveRuns())).toBe(true);

  const pipeline = stateStore.loadPipeline(pipelineId);
  const planRow = pipeline?.stages.find((s) => s.stageId === "plan" && s.branchKey === "branch-a");
  expect(planRow?.status).toBe("succeeded");
});

test("daemon restart continuation never auto-recovers a blocked plan stage", async () => {
  const worktreePath = "/fake/worktree/solo";
  const branch = "plan/restart-continuation";
  const specPath = "spec/2026-restart-continuation";
  const entryRunId = seedBlockedPlanDraftRun(stateStore, {
    project: "demo",
    branch,
    worktreePath,
    specPath,
    stepId: "plan",
    invocationId: "restart-continuation-inv",
  });
  const pipelineId = stateStore.createPipeline({ definition: SINGLE_DEFINITION, context: CONTEXT });
  stateStore.updateStage({
    pipelineId,
    stageId: "intent",
    patch: { status: "succeeded", workflowInvocationId: "run-intent-solo" },
  });
  stateStore.updateStage({
    pipelineId,
    stageId: "plan",
    patch: { status: "failed", workflowInvocationId: entryRunId, failureDetail: { message: "blocked" } },
  });

  let recoveryAttemptCalls = 0;
  const dispatchCalls: AnyWorkflowStep[][] = [];
  const restartHandlers = createRunControlHandlers({
    stateStore,
    writeLoopExecutor: createFakeWriteLoopExecutor().executor,
    failureReporter: () => {},
    hasMemoryHeadroom: () => true,
    recoveryAttempt: async () => {
      recoveryAttemptCalls += 1;
      throw new Error("continueContinuablePipelines must never invoke the recovery attempt seam");
    },
    pipelineDispatch: async (steps) => {
      dispatchCalls.push(steps);
      return { ok: true, entryRunId: "unexpected-run", invocationId: "unexpected-inv" };
    },
  });

  await restartHandlers.continueContinuablePipelines();

  expect(recoveryAttemptCalls).toBe(0);
  expect(dispatchCalls).toEqual([]);

  const pipeline = stateStore.loadPipeline(pipelineId);
  const planRow = pipeline?.stages.find((s) => s.stageId === "plan" && s.branchKey === "default");
  expect(planRow?.status).toBe("failed");
  expect(planRow?.workflowInvocationId).toBe(entryRunId);
});
