import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { getExternalWorktreePath, withExternalWorktree } from "../execution/external-worktree.ts";
import type { PipelineDefinition, PipelineTerminalAction } from "../execution/pipeline-definition.ts";
import { PIPELINE_REGISTRY } from "../execution/pipeline-registry.ts";
import { ReadyGateError } from "../execution/ready-finalize.ts";
import { TerminalPublicationError } from "../execution/terminal-publication.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import { createBindingFactory, DEBATE_AGENT_MODEL_CONFIG } from "../execution/workflow-runner.test-support.ts";
import type { AnyWorkflowStep, ReviewDebateWorkflowStep, WriteWorkflowStep } from "../execution/workflow-runner.ts";
import { executeWorkflow, landReviewedPublicationOutput } from "../execution/workflow-runner.ts";
import type { WriteLoopOutcomeKind } from "../execution/write-loop.ts";
import { publishCompletionArtifacts } from "../execution/write-loop.ts";
import { DEFAULT_WRITE_STEP_RULES } from "../execution/write-loop-input.ts";
import type { IpcClient } from "../ipc/client.ts";
import { openLogReader, openLogSink, type PersistedRecord } from "../persistence/log-stream.ts";
import type {
  Pipeline,
  PipelineContext,
  PipelineStageRecord,
  Run,
  RunStatus,
  StateStore,
  WorkflowSnapshot,
} from "../persistence/state-store.ts";
import { analyzeFailedPipelineReopenShape, openStateStore } from "../persistence/state-store.ts";
import { removeOrchestrationStore } from "../persistence/state-store-on-disk.ts";
import { rollupWorkflowRunStatus } from "../persistence/workflow-run-status-rollup.ts";
import { spinUntilMicrotask } from "../testing/bounded-microtask-spin.ts";
import { writeHomeMachineConfig } from "../testing/cli-test-helpers.ts";
import { makeIpcClient } from "../testing/ipc-client-fake.ts";
import { flushBackgroundRuns } from "../testing/run-control.ts";
import {
  createMinimalDispatchWriteStep,
  DEFAULT_AGENT_MODEL_CONFIG,
  doneBindingFactory,
  doneWithArtifactBindingFactory,
  type MinimalDispatchWriteStep,
  writeStepFixtures,
} from "../testing/workflow-step-fixtures.ts";
import { createJarvisHome, trackedTempRoots } from "../testing/write-fixtures.ts";
import { createFakeWriteLoopExecutor } from "../testing/write-loop-executor.ts";
import { createRunControlHandlers, WorktreeOwnershipRegistry } from "./daemon.ts";
import {
  applyPipelineApprovalDecision,
  approvalGateBlocksProgress,
  approvalGatePermitsProgress,
  approvalGateSettlesRejected,
  approvalOutcomeBlocksActivation,
  approvalOutcomePermitsActivation,
  branchKeyFromDownstreamInput,
  commitPipelineApprovalDecision,
  continuePipeline,
  derivePipelineFailureDetail,
  derivePipelineState,
  findFailedStageForReopen,
  hasPipelineTerminalPublicationFailure,
  isPipelineContinuable,
  isReopenedFailedContinuation,
  type PipelineExecutionDeps,
  persistedContextLoadPermitsContinuation,
  recoverContinuablePipelines,
  reopenedFailurePermitsActivation,
  resumeApprovedGatePendingStrandApplies,
  resumeAwaitingClaimsOnly,
  resumeDeferredRefusalApplies,
  resumeFailedRequiresReopen,
  resumePipeline,
  resumeReopenedPendingContinuation,
  resumeTerminalRefusalReason,
  runPipeline,
} from "./pipeline-execution.ts";
import type {
  PipelineStageArtifact,
  PipelineWorkflowDispatch,
  PipelineWorkflowWait,
} from "./pipeline-stage-dispatch.ts";
import { stageArtifactKey } from "./pipeline-stage-dispatch.ts";
import {
  type PipelineStageResolutionResult,
  type PipelineStageResolveDeps,
  resolveStageWorkflowSteps,
  singleStageResolutionSteps,
} from "./pipeline-stage-resolve.ts";
import type { TerminalLogRecord } from "./run-operator-error.ts";
import { composeRunOperatorError } from "./run-operator-error.ts";

const PIPELINE_ID = "pipeline-1";
const baseContext: PipelineContext = { cwd: "/repo", seed: "seed text", configPath: "/fake/.jarvis/config.json" };
const persistedContext: PipelineContext = {
  cwd: "/persisted-repo",
  seed: "persisted seed",
  configPath: "/fake/.jarvis/config.json",
};
const PRIOR_OWNER = "11111:1000000";
const CURRENT_OWNER = "22222:2000000";
const { createWriteStep } = writeStepFixtures();

const APPROVAL_GATE_DEFINITION: PipelineDefinition = {
  name: "p",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

function pipelineTestDeps(store: StateStore, dispatchOrder: number[]) {
  return {
    store,
    dispatch: (async (steps: AnyWorkflowStep[]) => {
      dispatchOrder.push(stageIndexOf(steps));
      return {
        ok: true as const,
        entryRunId: `run-${stageIndexOf(steps)}`,
        invocationId: `inv-${stageIndexOf(steps)}`,
      };
    }) as PipelineWorkflowDispatch,
    wait: (async () => "completed") as PipelineWorkflowWait,
    resolveStage: resolveStageStub(),
  };
}

/**
 * Collapse numeric wall-clock fields to a sentinel while preserving null-vs-number,
 * so structural stage comparisons don't flake when two builds straddle a millisecond.
 */
function normalizeStageClocks(stages: PipelineStageRecord[]): PipelineStageRecord[] {
  const mark = (value: number | null) => (typeof value === "number" ? -1 : value);
  return stages.map((stage) => ({
    ...stage,
    startedAt: mark(stage.startedAt),
    endedAt: mark(stage.endedAt),
    decidedAt: mark(stage.decidedAt),
  }));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function stageIndexOf(steps: AnyWorkflowStep[]): number {
  const step = steps[0];
  if (step?.behavior !== "write") {
    throw new Error("dispatch stub expects a write step");
  }
  const stageIndex = (step as MinimalDispatchWriteStep).stageIndex;
  if (stageIndex === undefined) {
    throw new Error("dispatch stub step missing stageIndex");
  }
  return stageIndex;
}

function noopStaleResetPreflightBundle(): NonNullable<PipelineExecutionDeps["staleResetPreflight"]> {
  return {
    cliDeps: {} as CliDeps,
    io: { stdout: () => {}, stderr: () => {} },
    connectClient: async () => ({ close: () => {} }) as IpcClient,
  };
}

function fakeStore(
  definition: PipelineDefinition,
  runs: Record<string, Partial<Run>> = {},
  options: {
    context?: PipelineContext | null;
    ownerIdentity?: string | null;
    currentIdentity?: string;
    terminalPublicationFailure?: Pipeline["terminalPublicationFailure"];
    terminalPublicationSucceededAt?: Pipeline["terminalPublicationSucceededAt"];
  } = {},
): { store: StateStore; stages: () => PipelineStageRecord[] } {
  const stages: PipelineStageRecord[] = definition.stages.map((stage, index) => ({
    id: `row-${index}`,
    pipelineId: PIPELINE_ID,
    stageId: stage.stageId,
    branchKey: "default",
    position: index,
    status: "pending",
    workflowInvocationId: null,
    startedAt: null,
    endedAt: null,
    artifact: null,
    failureDetail: null,
    decidedAt: null,
  }));

  let ownerIdentity = options.ownerIdentity ?? options.currentIdentity ?? CURRENT_OWNER;
  const pipelineContext = options.context === undefined ? baseContext : options.context;
  const currentIdentity = options.currentIdentity ?? CURRENT_OWNER;
  let terminalPublicationFailure = options.terminalPublicationFailure ?? null;
  let terminalPublicationSucceededAt = options.terminalPublicationSucceededAt ?? null;
  const admissionRows = new Map<string, string>();
  const admissionKey = (args: { pipelineId: string; stageId: string; branchKey?: string }) =>
    `${args.pipelineId}:${args.stageId}:${args.branchKey ?? "default"}`;

  const store = {
    loadPipeline: (id: string) =>
      id === PIPELINE_ID
        ? ({
            id: PIPELINE_ID,
            name: definition.name,
            createdAt: 0,
            ownerIdentity,
            status: "active",
            definition,
            context: pipelineContext,
            terminalPublicationFailure,
            terminalPublicationSucceededAt,
            stages: stages.map((s) => ({ ...s })),
          } as Pipeline & {
            stages: PipelineStageRecord[];
          })
        : null,
    updateStage: (args: { stageId: string; branchKey?: string; patch: Record<string, unknown> }) => {
      const branchKey = args.branchKey ?? "default";
      const record = stages.find((s) => s.stageId === args.stageId && s.branchKey === branchKey);
      if (!record) throw new Error(`unknown stage ${args.stageId} (branch ${branchKey})`);
      Object.assign(record, args.patch);
    },
    createPipelineStageBranch: (args: { pipelineId: string; stageId: string; branchKey: string }) => {
      if (args.pipelineId !== PIPELINE_ID) throw new Error(`Pipeline ${args.pipelineId} not found`);
      const defaultSibling = stages.find((s) => s.stageId === args.stageId && s.branchKey === "default");
      if (!defaultSibling) throw new Error(`Stage ${args.stageId} not found in pipeline ${args.pipelineId}`);
      if (stages.some((s) => s.stageId === args.stageId && s.branchKey === args.branchKey)) {
        throw new Error(
          `Branch ${args.branchKey} already exists for stage ${args.stageId} in pipeline ${args.pipelineId}`,
        );
      }
      const id = `row-${args.stageId}-${args.branchKey}`;
      stages.push({
        id,
        pipelineId: PIPELINE_ID,
        stageId: args.stageId,
        branchKey: args.branchKey,
        position: defaultSibling.position,
        status: "pending",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
        decidedAt: null,
      });
      return id;
    },
    claimPipelineContinuation: (args: { pipelineId: string; priorOwnerIdentity: string | null }) => {
      if (args.pipelineId !== PIPELINE_ID) {
        return { kind: "refused" as const, pipelineId: args.pipelineId, reason: "pipeline_not_found" as const };
      }
      if (ownerIdentity !== args.priorOwnerIdentity) {
        return { kind: "refused" as const, pipelineId: args.pipelineId, reason: "stale_owner" as const };
      }
      if (ownerIdentity === currentIdentity) {
        return { kind: "applied" as const, pipelineId: args.pipelineId };
      }
      ownerIdentity = currentIdentity;
      return { kind: "applied" as const, pipelineId: args.pipelineId };
    },
    commitApprovalBoundary: (args: { stageRecordId: string }) => {
      const record = stages.find((s) => s.id === args.stageRecordId);
      if (!record) {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "stage_not_found" as const };
      }
      const authored = definition.stages[record.position];
      if (authored?.kind !== "approval") {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "not_approval_stage" as const };
      }
      if (record.status !== "pending") {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "status_not_pending" as const };
      }
      record.status = "awaiting";
      return { kind: "applied" as const, stageRecordId: args.stageRecordId };
    },
    commitApprovalDecision: (args: { stageRecordId: string; decision: "approved" | "rejected" }) => {
      if (args.decision !== "approved" && args.decision !== "rejected") {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "invalid_decision" as const };
      }
      const record = stages.find((s) => s.id === args.stageRecordId);
      if (!record) {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "stage_not_found" as const };
      }
      const authored = definition.stages[record.position];
      if (authored?.kind !== "approval") {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "not_approval_stage" as const };
      }
      if (record.status !== "awaiting") {
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "status_not_awaiting" as const };
      }
      record.status = args.decision;
      return { kind: "applied" as const, stageRecordId: args.stageRecordId };
    },
    loadRun: (runId: string) => {
      const run = runs[runId];
      return run ? ({ id: runId, attempts: [], ...run } as unknown as Run & { attempts: [] }) : null;
    },
    findRunsByInvocationId: (invocationId: string) =>
      Object.entries(runs)
        .filter(([, run]) => run.workflowSnapshot?.invocationId === invocationId)
        .map(([id, run]) => ({ id, attempts: [], ...run }) as unknown as Run),
    listPipelines: () => {
      const pipeline = store.loadPipeline(PIPELINE_ID);
      return pipeline ? [pipeline] : [];
    },
    reopenFailedPipeline: (args: { pipelineId: string; branchKey?: string }) => {
      if (args.pipelineId !== PIPELINE_ID) {
        return { kind: "refused" as const, pipelineId: args.pipelineId, reason: "pipeline_not_found" as const };
      }
      const shape = analyzeFailedPipelineReopenShape(stages, args.branchKey);
      if (shape.kind === "invalid") {
        return { kind: "refused" as const, pipelineId: args.pipelineId, reason: shape.reason };
      }
      const failedRecord = stages.find((stage) => stage.id === shape.failedStageRecordId);
      if (!failedRecord || failedRecord.status !== "failed") {
        return { kind: "refused" as const, pipelineId: args.pipelineId, reason: "reopen_lost" as const };
      }
      Object.assign(failedRecord, {
        status: "pending",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
      });
      for (const suffixId of shape.suffixStageRecordIds) {
        const suffix = stages.find((stage) => stage.id === suffixId);
        if (!suffix || suffix.status !== "skipped") {
          return { kind: "refused" as const, pipelineId: args.pipelineId, reason: "reopen_lost" as const };
        }
        Object.assign(suffix, {
          status: "pending",
          workflowInvocationId: null,
          startedAt: null,
          endedAt: null,
          artifact: null,
          failureDetail: null,
        });
      }
      return { kind: "applied" as const, stageRecordId: shape.failedStageRecordId };
    },
    commitTerminalPublicationFailure: (args: {
      pipelineId: string;
      terminalAction: PipelineTerminalAction;
      failure: { operation: string; message: string };
      prNumber?: number;
      prUrl?: string;
    }) => {
      if (
        args.pipelineId !== PIPELINE_ID ||
        terminalPublicationFailure !== null ||
        terminalPublicationSucceededAt !== null
      ) {
        return;
      }
      terminalPublicationFailure = {
        terminalAction: args.terminalAction,
        failure: args.failure,
        ...(args.prNumber !== undefined ? { prNumber: args.prNumber } : {}),
        ...(args.prUrl !== undefined ? { prUrl: args.prUrl } : {}),
      };
    },
    commitTerminalPublicationSuccess: (args: { pipelineId: string }) => {
      if (
        args.pipelineId !== PIPELINE_ID ||
        terminalPublicationFailure !== null ||
        terminalPublicationSucceededAt !== null
      ) {
        return;
      }
      terminalPublicationSucceededAt = Date.now();
    },
    claimPipelineStageAdmission: (args: { pipelineId: string; stageId: string; branchKey?: string }) => {
      const key = admissionKey(args);
      const existing = admissionRows.get(key);
      if (existing === undefined) {
        admissionRows.set(key, currentIdentity);
        return { kind: "applied" as const };
      }
      return { kind: "refused" as const, reason: "claim_lost" as const };
    },
    releasePipelineStageAdmission: (args: { pipelineId: string; stageId: string; branchKey?: string }) => {
      const key = admissionKey(args);
      const existing = admissionRows.get(key);
      if (existing === undefined) return { kind: "applied" as const };
      if (existing !== currentIdentity) {
        return { kind: "refused" as const, reason: "stale_holder" as const };
      }
      admissionRows.delete(key);
      return { kind: "applied" as const };
    },
    loadPipelineStageAdmission: (args: { pipelineId: string; stageId: string; branchKey?: string }) => {
      const holder = admissionRows.get(admissionKey(args));
      if (holder === undefined) return { kind: "absent" as const };
      return { kind: "present" as const, holderIdentity: holder };
    },
  } as unknown as StateStore;

  return { store, stages: () => stages };
}

function resolveStageStub(): (
  definition: PipelineDefinition,
  stageIndex: number,
  context: PipelineContext,
  stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
  deps?: PipelineStageResolveDeps,
) => Promise<PipelineStageResolutionResult> {
  return async (_definition, stageIndex) => ({ ok: true, steps: [createMinimalDispatchWriteStep({ stageIndex })] });
}

const RESTART_SWEEP_DEFINITION: PipelineDefinition = {
  name: "restart-sweep-p",
  terminalAction: "ready",
  stages: [
    { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
  ],
};

const DEFERRED_FINAL_STAGE_DEFINITION: PipelineDefinition = {
  name: "deferred-final-stage-p",
  terminalAction: "ready",
  stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
};

const DEFERRED_FINAL_PR = { prNumber: 98, prUrl: "https://example.com/pr/98" } as const;

function deferredFinalEntryRun(
  entryRunId: string,
  snapshot: WorkflowSnapshot,
  pr: { prNumber: number; prUrl: string } = DEFERRED_FINAL_PR,
): Record<string, Partial<Run>> {
  return {
    [entryRunId]: {
      specPath: "spec/s1.md",
      stepId: "s1-entry",
      status: "completed",
      workflowSnapshot: snapshot,
      worktreePath: "/repo/worktree",
      branch: "feature-branch",
      specRef: "main",
      ...pr,
    },
  };
}

function deferredMarkerDetail(entryRunId: string, rollupStatus: RunStatus) {
  return {
    code: "settlement_deferred" as const,
    reason: "entry_run_still_live" as const,
    entryRunId,
    rollupStatus,
  };
}

function restartSweepEntrySnapshot(invocationId: string): WorkflowSnapshot {
  return {
    invocationId,
    steps: [
      { stepId: "s1-entry", role: "intent", durable: true },
      { stepId: "s1-review", role: "review", behavior: "review", durable: true },
    ],
  };
}

function restartSweepRollupWedgeRuns(
  entryRunId: string,
  reviewRunId: string,
  invocationId: string,
  reviewStatus: RunStatus,
): Record<string, Partial<Run>> {
  const snapshot = restartSweepEntrySnapshot(invocationId);
  return {
    [entryRunId]: { specPath: "spec/s1.md", stepId: "s1-entry", status: "completed", workflowSnapshot: snapshot },
    [reviewRunId]: { stepId: "s1-review", status: reviewStatus, workflowSnapshot: snapshot },
  };
}

function restartSweepTerminalLogFor(entryRunId: string) {
  const terminalRecord: PersistedRecord = {
    runId: entryRunId,
    seq: 1,
    ts: "2026-01-01T00:00:00.000Z",
    event: {
      kind: "loop_finished",
      loopOutcomeKind: "completion_commit_failed" as WriteLoopOutcomeKind,
      iterationsConsumed: 1,
      resumable: true,
    },
  };
  return {
    terminalRecord,
    loadLogRecords: (runId: string) => (runId === entryRunId ? [terminalRecord] : []),
  };
}

/** Rolls up from seeded sibling step-run rows, mirroring `waitForWorkflowEntryRun` in production. */
function restartSweepWait(runs: Record<string, Partial<Run>>): PipelineWorkflowWait {
  return async (entryRunId) => {
    const entryRunPartial = runs[entryRunId];
    if (!entryRunPartial) return "failed";
    const entryRun = { id: entryRunId, attempts: [], ...entryRunPartial } as unknown as Run;
    const workflowSnapshot = entryRun.workflowSnapshot ?? null;
    const siblingRuns = Object.entries(runs)
      .filter(([, run]) => run.workflowSnapshot?.invocationId === workflowSnapshot?.invocationId)
      .map(([id, run]) => ({ id, attempts: [], ...run }) as unknown as Run);
    return rollupWorkflowRunStatus({ entryRun, workflowSnapshot, siblingRuns, isLive: false });
  };
}

describe("runPipeline", () => {
  test("red ready gate settlement names the gate command and bounded output", async () => {
    // @mutate v2/src/daemon/run-operator-error.ts "...(event.readyGateCommand !== undefined" -> "...(false"
    const definition: PipelineDefinition = {
      name: "ready-gate-detail",
      stages: [{ stageId: "s1", kind: "workflow", workflow: "implement", review: "none" }],
    };
    const store = openStateStore(":memory:");
    const pipelineId = store.createPipeline({ definition, context: baseContext });
    const logDir = mkdtempSync(join(tmpdir(), "pipeline-ready-gate-detail-"));
    const logsPath = join(logDir, "logs.jsonl");
    const logSink = openLogSink(logsPath);
    const step = createWriteStep("implement", "ready-gate-detail", doneWithArtifactBindingFactory, {
      readyCommand: "bun run ready",
      maxIterations: 1,
    });
    let entryRunId: string | undefined;

    try {
      await runPipeline(pipelineId, {
        store,
        context: baseContext,
        resolveStage: async () => ({ ok: true, steps: [step] }),
        dispatch: async (steps) => {
          const result = await executeWorkflow({
            steps,
            stateStore: store,
            logSink,
            completionCommitter: async () => ({ commitSha: "commit-1" }),
            completionPublisher: async () => ({}),
            runFixCommand: async () => {},
            readyFinalizer: async (input) => {
              expect(input.readyCommand).toBe("bun run ready");
              throw new ReadyGateError("bun run ready", 1, 'Script not found "ready"');
            },
          });
          entryRunId = result.runId;
          return { ok: true, entryRunId: result.runId, invocationId: "ready-gate-detail" };
        },
        wait: async (runId) => store.loadRun(runId)?.status ?? "failed",
        loadLogRecords: (runId) => openLogReader(logsPath).tail(runId),
      });

      expect(entryRunId).toBeDefined();
      const stage = store.loadPipeline(pipelineId)?.stages.find((candidate) => candidate.stageId === "s1");
      expect(stage?.status).toBe("failed");
      const message = (stage?.failureDetail as { message?: string } | null)?.message;
      expect(message).toContain("bun run ready");
      expect(message).toContain('Script not found "ready"');
    } finally {
      logSink.close();
      store.close();
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  test("dispatches workflow stages in authored order, only after the preceding stage succeeds", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, {
      "run-0": { specPath: "spec/s1.md" },
      "run-1": { specPath: "spec/s2.md" },
    });

    const dispatchOrder: number[] = [];
    const stage0Wait = deferred<RunStatus>();
    let stage0WaitCalled = false;
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      const index = stageIndexOf(steps);
      dispatchOrder.push(index);
      return { ok: true, entryRunId: `run-${index}`, invocationId: `inv-${index}` };
    };
    const wait: PipelineWorkflowWait = async (entryRunId) => {
      if (entryRunId === "run-0") {
        stage0WaitCalled = true;
        return stage0Wait.promise;
      }
      return "completed";
    };

    const donePromise = runPipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait,
      context: baseContext,
      resolveStage: resolveStageStub(),
    });

    await spinUntilMicrotask(() => stage0WaitCalled, "stage0WaitCalled");

    expect(dispatchOrder).toEqual([0]);
    expect(stages().find((s) => s.stageId === "s2")?.status).toBe("pending");

    stage0Wait.resolve("completed");
    await donePromise;

    expect(dispatchOrder).toEqual([0, 1]);
    expect(stages().map((s) => s.status)).toEqual(["succeeded", "succeeded"]);
  });

  test("a stage that settles failed settles the pipeline failed and skips every later stage undispatched", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "s3", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      const index = stageIndexOf(steps);
      dispatchOrder.push(index);
      if (index === 1) {
        return { ok: false, code: "worktree_claimed", message: "claimed" };
      }
      return { ok: true, entryRunId: `run-${index}`, invocationId: `inv-${index}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, { store, dispatch, wait, context: baseContext, resolveStage: resolveStageStub() });

    expect(dispatchOrder).toEqual([0, 1]);
    const byId = new Map(stages().map((s) => [s.stageId, s]));
    expect(byId.get("s1")?.status).toBe("succeeded");
    expect(byId.get("s2")?.status).toBe("failed");
    expect(byId.get("s3")?.status).toBe("skipped");
  });

  test("a pipeline whose next stage is an approval stage persists awaiting and leaves later stages pending", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      const index = stageIndexOf(steps);
      dispatchOrder.push(index);
      return { ok: true, entryRunId: `run-${index}`, invocationId: `inv-${index}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, { store, dispatch, wait, context: baseContext, resolveStage: resolveStageStub() });

    expect(dispatchOrder).toEqual([0]);
    const byId = new Map(stages().map((s) => [s.stageId, s]));
    expect(byId.get("s1")?.status).toBe("succeeded");
    expect(byId.get("gate")?.status).toBe("awaiting");
    expect(byId.get("gate")?.id).toBe("row-1");
    expect(byId.get("s3")?.status).toBe("pending");

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("awaiting-approval");
  });

  test("continues past an approved gate and dispatches the next workflow stage", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, {
      "run-0": { specPath: "spec/s1.md" },
      "run-2": { specPath: "spec/s3.md" },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, { store, dispatch, wait, context: baseContext, resolveStage: resolveStageStub() });

    expect(dispatchOrder).toEqual([0, 2]);
    const byId = new Map(stages().map((s) => [s.stageId, s]));
    expect(byId.get("gate")?.status).toBe("approved");
    expect(byId.get("s3")?.status).toBe("succeeded");
  });

  test("stops at a rejected gate without dispatching later stages", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "rejected" } });

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, { store, dispatch, wait, context: baseContext, resolveStage: resolveStageStub() });

    expect(dispatchOrder).toEqual([0]);
    const byId = new Map(stages().map((s) => [s.stageId, s]));
    expect(byId.get("gate")?.status).toBe("rejected");
    expect(byId.get("s3")?.status).toBe("pending");
    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("rejected");
  });

  test("blocks at an already-awaiting gate without rewriting its row", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });

    let boundaryCalls = 0;
    const instrumentedStore = {
      ...store,
      commitApprovalBoundary: (args: { stageRecordId: string }) => {
        boundaryCalls += 1;
        return store.commitApprovalBoundary(args);
      },
    };

    const dispatch: PipelineWorkflowDispatch = async () => ({
      ok: true,
      entryRunId: "run-0",
      invocationId: "inv-0",
    });
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, {
      store: instrumentedStore,
      dispatch,
      wait,
      context: baseContext,
      resolveStage: resolveStageStub(),
    });

    expect(boundaryCalls).toBe(0);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("awaiting");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");
  });

  test("a refused boundary write reloads the addressed row and blocks at awaiting without dispatching the suffix", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });

    const racingStore = {
      ...store,
      commitApprovalBoundary: (args: { stageRecordId: string }) => {
        store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });
        return { kind: "refused" as const, stageRecordId: args.stageRecordId, reason: "status_not_pending" as const };
      },
    };

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, {
      store: racingStore,
      dispatch,
      wait,
      context: baseContext,
      resolveStage: resolveStageStub(),
    });

    expect(dispatchOrder).toEqual([0]);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("awaiting");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");
  });

  test("a refused boundary write with an unexpected status settles failed without skipping the suffix", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "running" } });

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    await runPipeline(PIPELINE_ID, { store, dispatch, wait, context: baseContext, resolveStage: resolveStageStub() });

    expect(dispatchOrder).toEqual([0]);
    const byId = new Map(stages().map((s) => [s.stageId, s]));
    expect(byId.get("gate")?.status).toBe("failed");
    expect(byId.get("s3")?.status).toBe("pending");
    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("failed");
  });
});

describe("pipeline context loader at execution", () => {
  const singleStageDefinition: PipelineDefinition = {
    name: "p",
    stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
  };
  const malformedContext = { cwd: "/repo", seed: "legacy inline seed" } as PipelineContext;
  const admittedContext: PipelineContext = {
    cwd: "/admitted-repo",
    configPath: "/admission/.jarvis/config.json",
    seed: "admitted-seed",
  };
  const callerOverrideContext: PipelineContext = {
    cwd: "/caller-override",
    configPath: "/caller/.jarvis/config.json",
    seed: "ignored",
  };

  test.each([
    { label: "runPipeline", useContinuation: false, storeOptions: {} as { ownerIdentity?: string } },
    { label: "continuePipeline", useContinuation: true, storeOptions: { ownerIdentity: PRIOR_OWNER } },
  ])("$label fails the pending workflow stage with pipeline-context-loader and does not dispatch when persisted context lacks configPath", async ({
    useContinuation,
    storeOptions,
  }) => {
    const { store, stages } = fakeStore(singleStageDefinition, {}, { context: malformedContext, ...storeOptions });
    let dispatchCalled = false;
    const dispatch = async () => {
      dispatchCalled = true;
      return { ok: true as const, entryRunId: "run-0", invocationId: "inv-0" };
    };
    const deps = { store, dispatch, wait: async () => "completed" as const, resolveStage: resolveStageStub() };

    const outcome = useContinuation
      ? await continuePipeline(PIPELINE_ID, deps)
      : await runPipeline(PIPELINE_ID, { ...deps, context: malformedContext });

    if (useContinuation) {
      expect(outcome).toEqual({ kind: "continued", pipelineId: PIPELINE_ID });
    }
    expect(dispatchCalled).toBe(false);
    const stage = stages().find((candidate) => candidate.stageId === "s1");
    expect(stage?.status).toBe("failed");
    const message = (stage?.failureDetail as { message?: string } | null)?.message;
    expect(message).toMatch(/^pipeline-context-loader:/);
    if (!useContinuation) expect(message).toContain("configPath");
  });

  test("fresh runPipeline and continuePipeline pass equal cwd and configPath into stage resolution from durable context", async () => {
    const continuationDefinition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };

    let freshResolution: Pick<PipelineContext, "cwd" | "configPath"> | undefined;
    const { store: freshStore } = fakeStore(continuationDefinition, {}, { context: admittedContext });
    await runPipeline(PIPELINE_ID, {
      store: freshStore,
      dispatch: async () => ({ ok: true, entryRunId: "run-0", invocationId: "inv-0" }),
      wait: async () => "completed",
      context: callerOverrideContext,
      resolveStage: async (_definition, _stageIndex, context) => {
        freshResolution = { cwd: context.cwd, configPath: context.configPath };
        return { ok: false, error: "stop after capture" };
      },
    });

    const { store: contStore } = fakeStore(
      continuationDefinition,
      { "run-2": { specPath: "spec/s3.md" } },
      { context: admittedContext, ownerIdentity: PRIOR_OWNER },
    );
    contStore.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
    });
    contStore.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });

    let continuationResolution: Pick<PipelineContext, "cwd" | "configPath"> | undefined;
    await continuePipeline(PIPELINE_ID, {
      store: contStore,
      dispatch: async () => ({ ok: true, entryRunId: "run-2", invocationId: "inv-2" }),
      wait: async () => "completed",
      context: callerOverrideContext,
      resolveStage: async (_definition, stageIndex, context) => {
        if (stageIndex === 2) continuationResolution = { cwd: context.cwd, configPath: context.configPath };
        return { ok: true, steps: [createMinimalDispatchWriteStep({ stageIndex })] };
      },
    });

    expect(freshResolution).toEqual({ cwd: admittedContext.cwd, configPath: admittedContext.configPath });
    expect(continuationResolution).toEqual(freshResolution);
  });
});

describe("continuePipeline", () => {
  const definition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "gate", kind: "approval" },
      { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
    ],
  };
  test("after restart dispatches the eligible later stage from persisted context and predecessor artifact without caller context", async () => {
    const { store, stages } = fakeStore(
      definition,
      { "run-2": { specPath: "spec/s3.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });

    let resolvedContext: PipelineContext | undefined;
    const resolveStage = async (
      _definition: PipelineDefinition,
      stageIndex: number,
      context: PipelineContext,
    ): Promise<PipelineStageResolutionResult> => {
      if (stageIndex === 2) resolvedContext = context;
      return { ok: true, steps: [createMinimalDispatchWriteStep({ stageIndex })] };
    };

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    const outcome = await continuePipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait,
      context: { cwd: "/caller-should-be-ignored", seed: "ignored", configPath: "/fake/.jarvis/config.json" },
      resolveStage,
    });

    expect(outcome).toEqual({ kind: "continued", pipelineId: PIPELINE_ID });
    expect(dispatchOrder).toEqual([2]);
    expect(resolvedContext).toEqual(persistedContext);
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("succeeded");
  });

  test("claims one live owner before dispatch and refuses a losing claim without a second dispatch", async () => {
    const { store, stages } = fakeStore(
      definition,
      { "run-2": { specPath: "spec/s3.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });

    let claimCalls = 0;
    const claimOnceStore = {
      ...store,
      claimPipelineContinuation: (args: { pipelineId: string; priorOwnerIdentity: string | null }) => {
        claimCalls += 1;
        if (claimCalls === 1) return store.claimPipelineContinuation(args);
        return { kind: "refused" as const, pipelineId: PIPELINE_ID, reason: "claim_lost" as const };
      },
    };

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async () => "completed";

    const first = await continuePipeline(PIPELINE_ID, {
      store: claimOnceStore,
      dispatch,
      wait,
      resolveStage: resolveStageStub(),
    });
    const beforeSecond = stages().map((s) => ({ stageId: s.stageId, status: s.status }));
    const second = await continuePipeline(PIPELINE_ID, {
      store: claimOnceStore,
      dispatch,
      wait,
      resolveStage: resolveStageStub(),
    });

    expect(first).toEqual({ kind: "continued", pipelineId: PIPELINE_ID });
    expect(second).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "claim_refused" });
    expect(dispatchOrder).toEqual([2]);
    expect(stages().map((s) => ({ stageId: s.stageId, status: s.status }))).toEqual(beforeSecond);
  });

  test("two concurrent continuations dispatch a given stage row exactly once", async () => {
    const singleStageDefinition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
    };
    const { store: baseStore, stages } = fakeStore(
      singleStageDefinition,
      { "run-0": { specPath: "spec/s1.md", status: "in-progress" } },
      { context: persistedContext, ownerIdentity: CURRENT_OWNER },
    );

    let dispatchCount = 0;
    const dispatchEntered = deferred<void>();
    const dispatchRelease = deferred<void>();
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCount += 1;
      dispatchEntered.resolve();
      await dispatchRelease.promise;
      return { ok: true, entryRunId: "run-0", invocationId: "inv-0" };
    };

    const waitEntered = deferred<void>();
    const waitDeferred = deferred<RunStatus>();
    const wait: PipelineWorkflowWait = async () => {
      waitEntered.resolve();
      return waitDeferred.promise;
    };

    const deps = { store: baseStore, dispatch, wait, resolveStage: resolveStageStub() };
    const first = continuePipeline(PIPELINE_ID, deps);
    await dispatchEntered.promise;

    const second = continuePipeline(PIPELINE_ID, deps);
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatchCount).toBe(1);

    dispatchRelease.resolve();
    await waitEntered.promise;

    const s1MidFlight = stages().find((stage) => stage.stageId === "s1");
    expect(s1MidFlight?.status).toBe("running");
    expect(s1MidFlight?.workflowInvocationId).toBe("run-0");
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (claim.kind === \"refused\") {" -> "if (false) {"

    waitDeferred.resolve("completed");
    await Promise.all([first, second]);

    const s1 = stages().find((stage) => stage.stageId === "s1");
    expect(s1?.status).toBe("succeeded");
    expect(s1?.failureDetail).toBeNull();
    expect(s1?.workflowInvocationId).toBe("run-0");
    expect(s1?.artifact).toMatchObject({ entryRunId: "run-0", invocationId: "inv-0", specPath: "spec/s1.md" });
  });

  test("re-settles a deferred running stage when continuePipeline runs after the linked entry run terminals", async () => {
    const entryRunId = "run-deferred-resettle";
    const terminalRecord: PersistedRecord = {
      runId: entryRunId,
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      event: {
        kind: "loop_finished",
        loopOutcomeKind: "completion_commit_failed" as WriteLoopOutcomeKind,
        iterationsConsumed: 1,
        resumable: true,
      },
    };
    const singleStageDefinition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
    };
    const { store, stages } = fakeStore(
      singleStageDefinition,
      { [entryRunId]: { specPath: "spec/s1.md", status: "failed" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: {
        status: "running",
        workflowInvocationId: entryRunId,
        failureDetail: {
          code: "settlement_deferred",
          reason: "entry_run_still_live",
          entryRunId,
          rollupStatus: "failed",
        },
      },
    });

    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "should-not-dispatch" };
    };
    const wait: PipelineWorkflowWait = async () => "failed";
    const loadLogRecords = () => [terminalRecord];

    const outcome = await continuePipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait,
      resolveStage: resolveStageStub(),
      loadLogRecords,
    });

    expect(outcome).toEqual({ kind: "continued", pipelineId: PIPELINE_ID });
    expect(dispatchCalled).toBe(false);
    const s1 = stages().find((stage) => stage.stageId === "s1");
    expect(s1?.status).toBe("failed");
    const entryRun = store.loadRun(entryRunId);
    if (entryRun === null) throw new Error("expected entry run");
    expect(s1?.failureDetail).toEqual(composeRunOperatorError(entryRun, terminalRecord as TerminalLogRecord));
    expect(s1?.failureDetail).not.toEqual({
      reason: "harness_failure",
      retryable: false,
      nextAction: "stop",
    });
  });

  test("refuses continuation when persisted context is absent and dispatches nothing", async () => {
    const { store, stages } = fakeStore(definition, {}, { context: null, ownerIdentity: PRIOR_OWNER });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: "run-x", invocationId: "inv-x" };
    };

    const outcome = await continuePipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });

    expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "missing_context" });
    expect(dispatchOrder).toEqual([]);
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");
  });

  test("refuses continuation when the ownership claim is lost and dispatches nothing", async () => {
    const { store, stages } = fakeStore(definition, {}, { context: persistedContext, ownerIdentity: PRIOR_OWNER });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" } },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });

    const racingStore = {
      ...store,
      claimPipelineContinuation: () => ({
        kind: "refused" as const,
        pipelineId: PIPELINE_ID,
        reason: "claim_lost" as const,
      }),
    };

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: "run-x", invocationId: "inv-x" };
    };

    const outcome = await continuePipeline(PIPELINE_ID, {
      store: racingStore,
      dispatch,
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });

    expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "claim_refused" });
    expect(dispatchOrder).toEqual([]);
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");
  });
});

describe("continuation execution guards", () => {
  test("inverting persisted-context guard fails restart continuation regression", () => {
    expect(persistedContextLoadPermitsContinuation(baseContext)).toBe(true);
    expect(persistedContextLoadPermitsContinuation(null)).toBe(false);
    expect(persistedContextLoadPermitsContinuation({ cwd: "/repo", seed: "seed text" } as PipelineContext)).toBe(false);
    expect(!persistedContextLoadPermitsContinuation(baseContext)).toBe(false);
  });

  test("continuation eligibility refuses incomplete non-null context before claim or dispatch", async () => {
    const malformedContext = { cwd: "/repo", seed: "legacy inline seed" } as PipelineContext;
    const singleStageDefinition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
    };
    const { store } = fakeStore(singleStageDefinition, {}, { context: malformedContext, ownerIdentity: PRIOR_OWNER });
    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(isPipelineContinuable(pipeline)).toBe(false);

    const dispatchOrder: number[] = [];
    const { continued } = await recoverContinuablePipelines(
      store,
      {
        store,
        dispatch: async (steps) => {
          dispatchOrder.push(stageIndexOf(steps));
          return { ok: true, entryRunId: "run-x", invocationId: "inv-x" };
        },
        wait: async () => "completed",
        resolveStage: resolveStageStub(),
      },
      async () => false,
    );
    expect(continued).toBe(0);
    expect(dispatchOrder).toEqual([]);
  });
});

describe("pipeline activation after restart", () => {
  const reopenDefinition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      { stageId: "s3", kind: "workflow", workflow: "implement", review: "light" },
    ],
  };
  function pipelineWithApprovalGate(gateStatus: string) {
    const { store, stages } = fakeStore(
      APPROVAL_GATE_DEFINITION,
      { "run-2": { specPath: "spec/s3.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: gateStatus } });
    return { store, stages };
  }

  test("does not activate awaiting or rejected approvals after restart reconciliation", async () => {
    for (const gateStatus of ["awaiting", "rejected"] as const) {
      const { store } = pipelineWithApprovalGate(gateStatus);
      const pipeline = store.loadPipeline(PIPELINE_ID);
      if (!pipeline) throw new Error("expected pipeline");
      expect(isPipelineContinuable(pipeline)).toBe(false);

      const dispatchOrder: number[] = [];
      const dispatch: PipelineWorkflowDispatch = async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-x", invocationId: "inv-x" };
      };

      const { continued } = await recoverContinuablePipelines(
        store,
        { store, dispatch, wait: async () => "completed", resolveStage: resolveStageStub() },
        async () => false,
      );
      expect(continued).toBe(0);
      expect(dispatchOrder).toEqual([]);
    }
  });

  test("activates an approved approval continuation under one live owner after restart", async () => {
    const { store, stages } = pipelineWithApprovalGate("approved");

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };

    const { continued } = await recoverContinuablePipelines(
      store,
      { store, dispatch, wait: async () => "completed", resolveStage: resolveStageStub() },
      async () => false,
    );

    expect(continued).toBe(1);
    expect(dispatchOrder).toEqual([2]);
    expect(stages().find((s) => s.stageId === "s1")?.workflowInvocationId).toBe("inv-1");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("succeeded");
  });

  test("restart sweep settles a deferred stage whose entry run completed while the daemon was down", async () => {
    const entryRunId = "run-restart-sweep-1";
    const reviewRunId = "run-restart-sweep-1-review";
    const snapshot = restartSweepEntrySnapshot("inv-restart-sweep-1");
    const runs: Record<string, Partial<Run>> = {
      [entryRunId]: { specPath: "spec/s1.md", stepId: "s1-entry", status: "completed", workflowSnapshot: snapshot },
      [reviewRunId]: { stepId: "s1-review", status: "completed", workflowSnapshot: snapshot },
    };
    const { store, stages } = fakeStore(RESTART_SWEEP_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: {
        status: "running",
        workflowInvocationId: entryRunId,
        failureDetail: deferredMarkerDetail(entryRunId, "failed"),
      },
    });

    let terminalPublicationCalls = 0;
    const executeTerminalPublication = async () => {
      terminalPublicationCalls += 1;
      return { prNumber: 99, prUrl: "https://example.com/pr/99" };
    };
    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      const runId = "run-restart-sweep-2";
      runs[runId] = {
        specPath: "spec/s2.md",
        worktreePath: "/repo/worktree",
        branch: "feature-branch",
        specRef: "main",
        status: "completed",
      };
      return { ok: true, entryRunId: runId, invocationId: "inv-restart-sweep-2" };
    };

    const { continued } = await recoverContinuablePipelines(
      store,
      { store, dispatch, wait: restartSweepWait(runs), resolveStage: resolveStageStub(), executeTerminalPublication },
      async () => false,
    );

    expect(continued).toBe(1);
    const s1 = stages().find((s) => s.stageId === "s1");
    expect(s1?.status).toBe("succeeded");
    expect(s1?.failureDetail).toBeNull();
    expect(s1?.artifact).toMatchObject({ entryRunId, specPath: "spec/s1.md" });
    expect(stages().find((s) => s.stageId === "s2")?.status).toBe("succeeded");
    expect(dispatchOrder).toEqual([1]);
    expect(terminalPublicationCalls).toBe(1);
    // @mutate v2/src/daemon/pipeline-execution.ts "if (!isPipelineContinuable(pipeline) && !hasRedrivableDeferredSettlement(store, pipeline, reconciledEntryRunIds)) continue;" -> "if (!isPipelineContinuable(pipeline)) continue;"
  });

  test("restart sweep preserves PR evidence through final deferred settlement for terminal publication", async () => {
    const entryRunId = "run-restart-sweep-final-pr";
    const reviewRunId = "run-restart-sweep-final-pr-review";
    const snapshot = restartSweepEntrySnapshot("inv-restart-sweep-final-pr");
    const runs: Record<string, Partial<Run>> = {
      ...deferredFinalEntryRun(entryRunId, snapshot),
      [reviewRunId]: { stepId: "s1-review", status: "completed", workflowSnapshot: snapshot },
    };
    const { store, stages } = fakeStore(DEFERRED_FINAL_STAGE_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: {
        status: "running",
        workflowInvocationId: entryRunId,
        failureDetail: deferredMarkerDetail(entryRunId, "failed"),
      },
    });

    let terminalPublicationCalls = 0;
    const capturedInputs: unknown[] = [];
    const executeTerminalPublication = async (input: unknown) => {
      capturedInputs.push(input);
      terminalPublicationCalls += 1;
      return DEFERRED_FINAL_PR;
    };

    const { continued } = await recoverContinuablePipelines(
      store,
      {
        store,
        dispatch: async () => {
          throw new Error("final deferred settlement must not redispatch");
        },
        wait: restartSweepWait(runs),
        resolveStage: resolveStageStub(),
        executeTerminalPublication,
      },
      async () => false,
    );

    expect(continued).toBe(1);
    const s1 = stages().find((s) => s.stageId === "s1");
    expect(s1?.status).toBe("succeeded");
    expect(s1?.artifact).toMatchObject({ entryRunId, ...DEFERRED_FINAL_PR });
    expect(capturedInputs).toEqual([
      {
        terminalAction: "ready",
        worktreePath: "/repo/worktree",
        branch: "feature-branch",
        baseRef: "main",
        ...DEFERRED_FINAL_PR,
      },
    ]);
    expect(terminalPublicationCalls).toBe(1);
  });

  test("restart sweep fails final deferred settlement when a ready pipeline's completed entry run lacks publication PR evidence", async () => {
    const entryRunId = "run-restart-sweep-missing-pr";
    const reviewRunId = "run-restart-sweep-missing-pr-review";
    const snapshot = restartSweepEntrySnapshot("inv-restart-sweep-missing-pr");
    const runs: Record<string, Partial<Run>> = {
      [entryRunId]: { specPath: "spec/s1.md", stepId: "s1-entry", status: "completed", workflowSnapshot: snapshot },
      [reviewRunId]: { stepId: "s1-review", status: "completed", workflowSnapshot: snapshot },
    };
    const { store, stages } = fakeStore(DEFERRED_FINAL_STAGE_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: {
        status: "running",
        workflowInvocationId: entryRunId,
        failureDetail: deferredMarkerDetail(entryRunId, "failed"),
      },
    });

    let terminalPublicationCalls = 0;
    const { continued } = await recoverContinuablePipelines(
      store,
      {
        store,
        dispatch: async () => {
          throw new Error("deferred settlement must not redispatch");
        },
        wait: restartSweepWait(runs),
        resolveStage: resolveStageStub(),
        executeTerminalPublication: async () => {
          terminalPublicationCalls += 1;
          return DEFERRED_FINAL_PR;
        },
      },
      async () => false,
    );

    expect(continued).toBe(1);
    const s1 = stages().find((s) => s.stageId === "s1");
    expect(s1?.status).toBe("failed");
    expect(s1?.failureDetail).toEqual({
      code: "completion_publication_missing_pr_evidence",
      message: `completion publication left no confirmed PR evidence on linked entry run ${entryRunId}`,
    });
    expect(terminalPublicationCalls).toBe(0);
    expect(store.loadPipeline(PIPELINE_ID)?.terminalPublicationFailure).toBeNull();
  });

  test("restart sweep fails a deferred stage whose entry run ended failed", async () => {
    const entryRunId = "run-restart-sweep-fail-1";
    const reviewRunId = "run-restart-sweep-fail-1-review";
    const runs = restartSweepRollupWedgeRuns(entryRunId, reviewRunId, "inv-restart-sweep-fail-1", "failed");
    const { store, stages } = fakeStore(RESTART_SWEEP_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: {
        status: "running",
        workflowInvocationId: entryRunId,
        failureDetail: deferredMarkerDetail(entryRunId, "in-progress"),
      },
    });

    const { terminalRecord, loadLogRecords } = restartSweepTerminalLogFor(entryRunId);

    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "should-not-dispatch" };
    };
    let terminalPublicationCalls = 0;
    const executeTerminalPublication = async () => {
      terminalPublicationCalls += 1;
      return { prNumber: 99, prUrl: "https://example.com/pr/99" };
    };

    const { continued } = await recoverContinuablePipelines(
      store,
      {
        store,
        dispatch,
        wait: restartSweepWait(runs),
        resolveStage: resolveStageStub(),
        executeTerminalPublication,
        loadLogRecords,
      },
      async () => false,
    );

    expect(continued).toBe(1);
    expect(dispatchCalled).toBe(false);
    const s1 = stages().find((s) => s.stageId === "s1");
    expect(s1?.status).toBe("failed");
    const entryRun = store.loadRun(entryRunId);
    if (entryRun === null) throw new Error("expected entry run");
    expect(s1?.failureDetail).toEqual(composeRunOperatorError(entryRun, terminalRecord as TerminalLogRecord));
    expect(stages().find((s) => s.stageId === "s2")?.status).toBe("skipped");
    expect(terminalPublicationCalls).toBe(0);
  });

  test("restart sweep fails a running stage whose entry run ended failed without a deferred marker", async () => {
    const entryRunId = "run-restart-sweep-unsettled-fail-1";
    const reviewRunId = "run-restart-sweep-unsettled-fail-1-review";
    const runs = restartSweepRollupWedgeRuns(entryRunId, reviewRunId, "inv-restart-sweep-unsettled-fail-1", "failed");
    const { store, stages } = fakeStore(RESTART_SWEEP_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "running", workflowInvocationId: entryRunId },
    });

    const { terminalRecord, loadLogRecords } = restartSweepTerminalLogFor(entryRunId);

    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "should-not-dispatch" };
    };
    let terminalPublicationCalls = 0;
    const executeTerminalPublication = async () => {
      terminalPublicationCalls += 1;
      return { prNumber: 99, prUrl: "https://example.com/pr/99" };
    };

    const { continued } = await recoverContinuablePipelines(
      store,
      {
        store,
        dispatch,
        wait: restartSweepWait(runs),
        resolveStage: resolveStageStub(),
        executeTerminalPublication,
        loadLogRecords,
      },
      async () => false,
    );

    expect(continued).toBe(1);
    expect(dispatchCalled).toBe(false);
    const s1 = stages().find((s) => s.stageId === "s1");
    expect(s1?.status).toBe("failed");
    const entryRun = store.loadRun(entryRunId);
    if (entryRun === null) throw new Error("expected entry run");
    expect(s1?.failureDetail).toEqual(composeRunOperatorError(entryRun, terminalRecord as TerminalLogRecord));
    expect(stages().find((s) => s.stageId === "s2")?.status).toBe("skipped");
    expect(terminalPublicationCalls).toBe(0);
    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("failed");
    // @mutate v2/src/daemon/pipeline-execution.ts "const unsettledEntryRunId = unsettledTerminalStageEntryRunId(store, stage);" -> "const unsettledEntryRunId = undefined;"
  });

  test("restart sweep leaves a deferred stage whose entry run is still live untouched", async () => {
    const entryRunId = "run-restart-sweep-live";
    const runs: Record<string, Partial<Run>> = {
      [entryRunId]: { specPath: "spec/s1.md", status: "in-progress" },
    };
    const { store, stages } = fakeStore(RESTART_SWEEP_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: {
        status: "running",
        workflowInvocationId: entryRunId,
        startedAt: 12345,
        failureDetail: deferredMarkerDetail(entryRunId, "in-progress"),
      },
    });
    const before = structuredClone(stages());

    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "should-not-dispatch" };
    };

    const { continued } = await recoverContinuablePipelines(
      store,
      { store, dispatch, wait: restartSweepWait(runs), resolveStage: resolveStageStub() },
      async () => false,
    );

    expect(continued).toBe(0);
    expect(dispatchCalled).toBe(false);
    expect(stages()).toEqual(before);
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (isLiveEntryRun(store, deferredEntryRunId)) return undefined;" -> "if (false) return undefined;"
  });

  test("restart sweep leaves a running stage without a deferred marker untouched", async () => {
    const entryRunId = "run-restart-sweep-no-marker";
    const reviewRunId = "run-restart-sweep-no-marker-review";
    const runs = restartSweepRollupWedgeRuns(entryRunId, reviewRunId, "inv-restart-sweep-no-marker", "completed");
    const { store, stages } = fakeStore(RESTART_SWEEP_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "running", workflowInvocationId: entryRunId },
    });
    const before = structuredClone(stages());

    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "should-not-dispatch" };
    };

    const { continued } = await recoverContinuablePipelines(
      store,
      { store, dispatch, wait: restartSweepWait(runs), resolveStage: resolveStageStub() },
      async () => false,
    );

    expect(continued).toBe(0);
    expect(dispatchCalled).toBe(false);
    expect(stages()).toEqual(before);
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (rollupStatus !== \"failed\") return undefined;" -> "if (false) return undefined;"
  });

  test("restart sweep leaves an unsettled stage whose entry run is still live untouched", async () => {
    const entryRunId = "run-restart-sweep-unsettled-live";
    const shrinkRunId = "run-restart-sweep-unsettled-live-shrink";
    const snapshot = restartSweepEntrySnapshot("inv-restart-sweep-unsettled-live");
    const runs: Record<string, Partial<Run>> = {
      [entryRunId]: { specPath: "spec/s1.md", stepId: "s1-entry", status: "in-progress", workflowSnapshot: snapshot },
      [shrinkRunId]: { stepId: "implement~shrink", status: "failed", workflowSnapshot: snapshot },
    };
    const { store, stages } = fakeStore(RESTART_SWEEP_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "running", workflowInvocationId: entryRunId, startedAt: 12345 },
    });
    const before = structuredClone(stages());

    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "should-not-dispatch" };
    };

    const { continued } = await recoverContinuablePipelines(
      store,
      { store, dispatch, wait: restartSweepWait(runs), resolveStage: resolveStageStub() },
      async () => false,
    );

    expect(continued).toBe(0);
    expect(dispatchCalled).toBe(false);
    expect(stages()).toEqual(before);
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "if (isLiveEntryRun(store, linkedEntryRunId)) return undefined;" -> "if (false) return undefined;"
  });

  test("restart sweep leaves an unsettled stage whose entry run was just reconciled untouched", async () => {
    const entryRunId = "run-restart-sweep-unsettled-reconciled";
    const reviewRunId = "run-restart-sweep-unsettled-reconciled-review";
    const runs = restartSweepRollupWedgeRuns(
      entryRunId,
      reviewRunId,
      "inv-restart-sweep-unsettled-reconciled",
      "failed",
    );
    const { store, stages } = fakeStore(RESTART_SWEEP_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "running", workflowInvocationId: entryRunId },
    });
    const before = structuredClone(stages());

    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "should-not-dispatch" };
    };

    const { continued } = await recoverContinuablePipelines(
      store,
      { store, dispatch, wait: restartSweepWait(runs), resolveStage: resolveStageStub() },
      async () => false,
      new Set([entryRunId]),
    );

    expect(continued).toBe(0);
    expect(dispatchCalled).toBe(false);
    expect(stages()).toEqual(before);
    // @mutate v2/src/daemon/pipeline-execution.ts "if (reconciledEntryRunIds.has(redrivableEntryRunId)) return false;" -> "if (false) return false;"
  });

  test("restart sweep leaves a deferred stage whose entry run was just reconciled untouched", async () => {
    const entryRunId = "run-restart-sweep-reconciled";
    const runs: Record<string, Partial<Run>> = {
      [entryRunId]: { specPath: "spec/s1.md", status: "killed" },
    };
    const { store, stages } = fakeStore(RESTART_SWEEP_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: {
        status: "running",
        workflowInvocationId: entryRunId,
        failureDetail: deferredMarkerDetail(entryRunId, "in-progress"),
      },
    });
    const before = structuredClone(stages());

    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "should-not-dispatch" };
    };

    const { continued } = await recoverContinuablePipelines(
      store,
      { store, dispatch, wait: restartSweepWait(runs), resolveStage: resolveStageStub() },
      async () => false,
      new Set([entryRunId]),
    );

    expect(continued).toBe(0);
    expect(dispatchCalled).toBe(false);
    expect(stages()).toEqual(before);
    // @mutate v2/src/daemon/pipeline-execution.ts "if (reconciledEntryRunIds.has(redrivableEntryRunId)) return false;" -> "if (false) return false;"
  });

  test("resume reopens and redispatches after an unsettled terminally failed stage", async () => {
    const entryRunId = "run-resume-unsettled-fail-1";
    const reviewRunId = "run-resume-unsettled-fail-1-review";
    const runs = restartSweepRollupWedgeRuns(entryRunId, reviewRunId, "inv-resume-unsettled-fail-1", "failed");
    const { store, stages } = fakeStore(RESTART_SWEEP_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "running", workflowInvocationId: entryRunId },
    });

    const { terminalRecord, loadLogRecords } = restartSweepTerminalLogFor(entryRunId);

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      const runId = "run-resume-unsettled-fail-2";
      runs[runId] = {
        specPath: "spec/s2.md",
        worktreePath: "/repo/worktree",
        branch: "feature-branch",
        specRef: "main",
        status: "completed",
      };
      return { ok: true, entryRunId: runId, invocationId: "inv-resume-unsettled-fail-2" };
    };

    const deps = {
      store,
      dispatch,
      wait: restartSweepWait(runs),
      resolveStage: resolveStageStub(),
      loadLogRecords,
    };

    const firstOutcome = await resumePipeline(PIPELINE_ID, deps);
    expect(firstOutcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
    const s1AfterSettle = stages().find((s) => s.stageId === "s1");
    expect(s1AfterSettle?.status).toBe("failed");
    const entryRun = store.loadRun(entryRunId);
    if (entryRun === null) throw new Error("expected entry run");
    expect(s1AfterSettle?.failureDetail).toEqual(
      composeRunOperatorError(entryRun, terminalRecord as TerminalLogRecord),
    );
    const pipelineAfterSettle = store.loadPipeline(PIPELINE_ID);
    if (!pipelineAfterSettle) throw new Error("expected pipeline");
    expect(derivePipelineState(pipelineAfterSettle)).toBe("failed");
    expect(dispatchOrder).toEqual([]);

    const secondOutcome = await resumePipeline(PIPELINE_ID, deps);
    expect(secondOutcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
    expect(stages().find((s) => s.stageId === "s1")?.status).toBe("succeeded");
    expect(stages().find((s) => s.stageId === "s2")?.status).toBe("succeeded");
    expect(dispatchOrder).toEqual([0, 1]);
    // @mutate v2/src/daemon/pipeline-execution.ts "return hasRedrivableDeferredSettlement(store, pipeline, NO_RECONCILED_ENTRY_RUNS);" -> "return false;"
  });

  test("after an applied reopen dispatches only the reopened failed stage and preserves predecessor evidence", async () => {
    const { store, stages } = fakeStore(
      reopenDefinition,
      { "run-1": { specPath: "spec/s2.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s2",
      patch: { status: "pending", workflowInvocationId: null, endedAt: null, failureDetail: null, artifact: null },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "pending" } });

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(isPipelineContinuable(pipeline)).toBe(true);

    const dispatchOrder: number[] = [];
    const stage1Wait = deferred<RunStatus>();
    let stage1WaitCalled = false;
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return { ok: true, entryRunId: `run-${stageIndexOf(steps)}`, invocationId: `inv-${stageIndexOf(steps)}` };
    };
    const wait: PipelineWorkflowWait = async (entryRunId) => {
      if (entryRunId === "run-1") {
        stage1WaitCalled = true;
        return stage1Wait.promise;
      }
      return "completed";
    };

    const activation = recoverContinuablePipelines(
      store,
      { store, dispatch, wait, resolveStage: resolveStageStub() },
      async () => false,
    );

    await spinUntilMicrotask(() => stage1WaitCalled, "stage1WaitCalled");

    expect(dispatchOrder).toEqual([1]);
    const byId = new Map(stages().map((s) => [s.stageId, s]));
    expect(byId.get("s1")?.workflowInvocationId).toBe("inv-1");
    expect(byId.get("s1")?.artifact).toEqual({ specPath: "spec/s1.md" });
    expect(byId.get("s3")?.status).toBe("pending");

    stage1Wait.resolve("completed");
    const { continued } = await activation;
    expect(continued).toBe(1);
    expect(byId.get("s2")?.status).toBe("succeeded");
  });

  test("does not activate a failed pipeline before reopen is applied", async () => {
    const { store } = fakeStore(reopenDefinition, {}, { context: persistedContext, ownerIdentity: PRIOR_OWNER });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "failed" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "skipped" } });

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(isPipelineContinuable(pipeline)).toBe(false);

    const dispatchOrder: number[] = [];
    const { continued } = await recoverContinuablePipelines(
      store,
      {
        store,
        dispatch: async (steps) => {
          dispatchOrder.push(stageIndexOf(steps));
          return { ok: true, entryRunId: "run-x", invocationId: "inv-x" };
        },
        wait: async () => "completed",
        resolveStage: resolveStageStub(),
      },
      async () => false,
    );
    expect(continued).toBe(0);
    expect(dispatchOrder).toEqual([]);
  });

  test("a duplicate activation request changes no stage row and produces no additional dispatch", async () => {
    const { store, stages } = pipelineWithApprovalGate("approved");

    let claimCalls = 0;
    const claimOnceStore = {
      ...store,
      claimPipelineContinuation: (args: { pipelineId: string; priorOwnerIdentity: string | null }) => {
        claimCalls += 1;
        if (claimCalls === 1) return store.claimPipelineContinuation(args);
        return { kind: "refused" as const, pipelineId: PIPELINE_ID, reason: "claim_lost" as const };
      },
    };

    const dispatchOrder: number[] = [];
    const deps = {
      store: claimOnceStore,
      dispatch: (async (steps: AnyWorkflowStep[]) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-2", invocationId: "inv-2" };
      }) as PipelineWorkflowDispatch,
      wait: (async () => "completed") as PipelineWorkflowWait,
      resolveStage: resolveStageStub(),
    };

    const first = await recoverContinuablePipelines(claimOnceStore, deps, async () => false);
    const beforeSecond = stages().map((s) => ({ stageId: s.stageId, status: s.status }));
    const second = await recoverContinuablePipelines(claimOnceStore, deps, async () => false);

    expect(first.continued).toBe(1);
    expect(second.continued).toBe(0);
    expect(dispatchOrder).toEqual([2]);
    expect(stages().map((s) => ({ stageId: s.stageId, status: s.status }))).toEqual(beforeSecond);
  });
});

describe("activation eligibility guards", () => {
  const definition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "gate", kind: "approval" },
      { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
    ],
  };

  function pipelineWithGateStatus(gateStatus: string): Pipeline & { stages: PipelineStageRecord[] } {
    const { store } = fakeStore(definition, {}, { context: baseContext });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: gateStatus } });
    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    return pipeline;
  }

  test("inverting approval activation eligibility guard fails approved activation regression", () => {
    const approved = pipelineWithGateStatus("approved");
    expect(approvalOutcomePermitsActivation(approved)).toBe(true);
    expect(approvalOutcomeBlocksActivation("awaiting")).toBe(true);
    expect(approvalOutcomeBlocksActivation("rejected")).toBe(true);
    expect(approvalOutcomeBlocksActivation("approved")).toBe(false);
    expect(approvalOutcomePermitsActivation(pipelineWithGateStatus("awaiting"))).toBe(false);
    expect(approvalOutcomePermitsActivation(pipelineWithGateStatus("rejected"))).toBe(false);
  });

  test("inverting reopen activation eligibility guard fails reopened activation regression", () => {
    const reopenDefinition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store } = fakeStore(reopenDefinition, {}, { context: baseContext });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "pending" } });
    const reopened = store.loadPipeline(PIPELINE_ID);
    if (!reopened) throw new Error("expected pipeline");
    expect(reopenedFailurePermitsActivation(reopened)).toBe(true);

    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "failed" } });
    const failed = store.loadPipeline(PIPELINE_ID);
    if (!failed) throw new Error("expected pipeline");
    expect(reopenedFailurePermitsActivation(failed)).toBe(false);
  });

  test("an approval stage immediately before the pending workflow stage blocks reopened continuation", () => {
    const { store } = fakeStore(definition, {}, { context: baseContext });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "pending" } });
    const gated = store.loadPipeline(PIPELINE_ID);
    if (!gated) throw new Error("expected pipeline");
    expect(isReopenedFailedContinuation(gated)).toBe(false);

    const ungatedDefinition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s3", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const ungated = fakeStore(ungatedDefinition, {}, { context: baseContext });
    ungated.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    ungated.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "pending" } });
    const reopened = ungated.store.loadPipeline(PIPELINE_ID);
    if (!reopened) throw new Error("expected pipeline");
    expect(isReopenedFailedContinuation(reopened)).toBe(true);
  });
});

describe("approval execution guards", () => {
  test("inverting approval-stop guard fails awaiting block regression", () => {
    expect(approvalGateBlocksProgress("awaiting")).toBe(true);
    expect(!approvalGateBlocksProgress("awaiting")).toBe(false);
  });

  test("inverting approved-continue guard fails approved continue regression", () => {
    expect(approvalGatePermitsProgress("approved")).toBe(true);
    expect(!approvalGatePermitsProgress("approved")).toBe(false);
  });

  test("inverting rejected-settlement guard fails rejected settlement regression", () => {
    expect(approvalGateSettlesRejected("rejected")).toBe(true);
    expect(!approvalGateSettlesRejected("rejected")).toBe(false);
  });
});

describe("pipeline approval decisions", () => {
  test("blocks at awaiting until pipeline_approve applies a matching decision", async () => {
    const { store, stages } = fakeStore(APPROVAL_GATE_DEFINITION, {
      "run-0": { specPath: "spec/s1.md" },
      "run-2": { specPath: "spec/s3.md" },
    });
    const dispatchOrder: number[] = [];
    const deps = pipelineTestDeps(store, dispatchOrder);

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    expect(dispatchOrder).toEqual([0]);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("awaiting");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");

    const approveOutcome = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", deps);
    expect(approveOutcome).toEqual({ kind: "applied", pipelineId: PIPELINE_ID, stageId: "gate", decision: "approved" });
    await flushBackgroundRuns();

    expect(dispatchOrder).toEqual([0, 2]);
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("succeeded");
  });

  test("pipeline_approve advances to the next workflow stage and pipeline_reject settles rejected", async () => {
    const { store } = fakeStore(APPROVAL_GATE_DEFINITION, {
      "run-0": { specPath: "spec/s1.md" },
      "run-2": { specPath: "spec/s3.md" },
    });
    const approveOrder: number[] = [];
    const approveDeps = pipelineTestDeps(store, approveOrder);
    await runPipeline(PIPELINE_ID, { ...approveDeps, context: baseContext });
    const approveOutcome = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", approveDeps);
    expect(approveOutcome.kind).toBe("applied");
    await flushBackgroundRuns();
    expect(approveOrder).toEqual([0, 2]);
    const approvedPipeline = store.loadPipeline(PIPELINE_ID);
    if (!approvedPipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(approvedPipeline)).toBe("succeeded");

    const rejectStore = fakeStore(APPROVAL_GATE_DEFINITION, { "run-0": { specPath: "spec/s1.md" } });
    const rejectOrder: number[] = [];
    const rejectDeps = pipelineTestDeps(rejectStore.store, rejectOrder);
    await runPipeline(PIPELINE_ID, { ...rejectDeps, context: baseContext });
    const rejectOutcome = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "rejected", rejectDeps);
    expect(rejectOutcome).toEqual({ kind: "applied", pipelineId: PIPELINE_ID, stageId: "gate", decision: "rejected" });
    await flushBackgroundRuns();
    expect(rejectOrder).toEqual([0]);
    expect(rejectStore.stages().find((s) => s.stageId === "s3")?.status).toBe("pending");
    const rejectedPipeline = rejectStore.store.loadPipeline(PIPELINE_ID);
    if (!rejectedPipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(rejectedPipeline)).toBe("rejected");
  });

  test("refuses wrong stageId, non-approval target, non-awaiting row, and duplicate decisions without dispatch", async () => {
    const { store, stages } = fakeStore(APPROVAL_GATE_DEFINITION, { "run-0": { specPath: "spec/s1.md" } });
    const dispatchOrder: number[] = [];
    const deps = pipelineTestDeps(store, dispatchOrder);
    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });

    const wrongStage = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "missing",
      decision: "approved",
    });
    expect(wrongStage).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      stageId: "missing",
      reason: "stage_not_found",
    });

    const nonApproval = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      decision: "approved",
    });
    expect(nonApproval).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      reason: "not_approval_stage",
    });

    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });
    const nonAwaiting = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      decision: "approved",
    });
    expect(nonAwaiting).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      reason: "status_not_awaiting",
    });

    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });
    const first = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", deps);
    expect(first.kind).toBe("applied");
    await flushBackgroundRuns();

    const duplicate = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      decision: "rejected",
    });
    expect(duplicate).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      reason: "status_not_awaiting",
    });
    expect(dispatchOrder).toEqual([0, 2]);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("approved");
  });

  test("after store close/reopen, awaiting stays until RPC reject", async () => {
    const dbPath = join(tmpdir(), `jarvis-approval-reject-rpc-${process.pid}-${Date.now()}.db`);
    const seedStore = openStateStore(dbPath, { currentIdentity: PRIOR_OWNER });
    const pipelineId = seedStore.createPipeline({ definition: APPROVAL_GATE_DEFINITION, context: persistedContext });
    seedStore.updateStage({
      pipelineId,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    seedStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
    seedStore.close();

    const reopenedStore = openStateStore(dbPath, {
      currentIdentity: CURRENT_OWNER,
      isOwnerAlive: async () => false,
    });
    await reopenedStore.reconcilePipelines();
    const rejectReopenedPipeline = reopenedStore.loadPipeline(pipelineId);
    if (!rejectReopenedPipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(rejectReopenedPipeline)).toBe("awaiting-approval");

    const fakeExecutor = createFakeWriteLoopExecutor();
    const handlers = createRunControlHandlers({
      stateStore: reopenedStore,
      writeLoopExecutor: fakeExecutor.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async (_definition, stageIndex) => ({
        ok: true,
        steps: [createMinimalDispatchWriteStep({ stageIndex })],
      }),
    });
    const rejectResponse = await handlers.pipeline_reject(
      { kind: "request", id: "reject", method: "pipeline_reject", params: { pipelineId, stageId: "gate" } },
      new AbortController().signal,
    );
    expect(rejectResponse).toEqual({
      kind: "response",
      result: { kind: "applied", pipelineId, stageId: "gate", decision: "rejected" },
    });
    expect(reopenedStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s3")?.status).toBe(
      "pending",
    );
    reopenedStore.close();
  });

  test("after store close/reopen, RPC approve continues from persisted context", async () => {
    const dbPath = join(tmpdir(), `jarvis-approval-approve-rpc-${process.pid}-${Date.now()}.db`);
    const seedStore = openStateStore(dbPath, { currentIdentity: PRIOR_OWNER });
    const pipelineId = seedStore.createPipeline({ definition: APPROVAL_GATE_DEFINITION, context: persistedContext });
    seedStore.updateStage({
      pipelineId,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    seedStore.updateStage({ pipelineId, stageId: "gate", patch: { status: "awaiting" } });
    seedStore.close();

    const reopenedStore = openStateStore(dbPath, {
      currentIdentity: CURRENT_OWNER,
      isOwnerAlive: async () => false,
    });
    await reopenedStore.reconcilePipelines();
    const approveReopenedPipeline = reopenedStore.loadPipeline(pipelineId);
    if (!approveReopenedPipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(approveReopenedPipeline)).toBe("awaiting-approval");

    const fakeExecutor = createFakeWriteLoopExecutor();
    const stage3Step: AnyWorkflowStep = createWriteStep("stage-3", "pipeline-branch", doneWithArtifactBindingFactory, {
      suppressShrink: true,
    });
    const handlers = createRunControlHandlers({
      stateStore: reopenedStore,
      writeLoopExecutor: fakeExecutor.executor,
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      resolveStage: async (_definition, stageIndex) => ({
        ok: true,
        steps: stageIndex === 2 ? [stage3Step] : [createMinimalDispatchWriteStep({ stageIndex })],
      }),
    });
    const approveResponse = await handlers.pipeline_approve(
      { kind: "request", id: "approve", method: "pipeline_approve", params: { pipelineId, stageId: "gate" } },
      new AbortController().signal,
    );
    expect(approveResponse).toEqual({
      kind: "response",
      result: { kind: "applied", pipelineId, stageId: "gate", decision: "approved" },
    });

    fakeExecutor.settleAll();
    const deadline = Date.now() + 5000;
    while (
      reopenedStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "s3")?.status !== "succeeded" &&
      Date.now() < deadline
    ) {
      await flushBackgroundRuns();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await flushBackgroundRuns();
    const after = reopenedStore.loadPipeline(pipelineId);
    expect(after?.stages.find((stage) => stage.stageId === "s3")?.status).toBe("succeeded");
    expect(after?.context).toEqual(persistedContext);
    reopenedStore.close();
  });

  test("inverting first-writer and refused-decision guards fails duplicate and refused regression", async () => {
    const { store } = fakeStore(APPROVAL_GATE_DEFINITION, { "run-0": { specPath: "spec/s1.md" } });
    const dispatchOrder: number[] = [];
    const deps = pipelineTestDeps(store, dispatchOrder);
    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });

    const refused = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      decision: "approved",
    });
    expect(refused.kind).toBe("refused");
    expect(dispatchOrder).toEqual([0]);

    applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", deps);
    await flushBackgroundRuns();
    const duplicate = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      decision: "rejected",
    });
    expect(duplicate.kind).toBe("refused");
    expect(dispatchOrder).toEqual([0, 2]);
    expect(!approvalGateBlocksProgress("awaiting")).toBe(false);
    expect(!approvalGatePermitsProgress("approved")).toBe(false);
    expect(!approvalGateSettlesRejected("rejected")).toBe(false);
  });
});

describe("derivePipelineState", () => {
  const definition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
    ],
  };

  function pipelineWith(statuses: Record<string, string>): Pipeline & { stages: PipelineStageRecord[] } {
    return {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      context: null,
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      dismissedAt: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        branchKey: "default",
        position: index,
        status: statuses[stage.stageId] ?? "pending",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
        decidedAt: null,
      })),
    };
  }

  test("findFailedStageForReopen selects the failed workflow stage and honors branch scope", () => {
    // Unscoped: returns the failed stage. `status === "failed"` flipped to `!==` selects succeeded s1;
    // `branchScope === undefined` flipped to `!==` drops all stages.
    const found = findFailedStageForReopen(pipelineWith({ s1: "succeeded", s2: "failed" }), undefined);
    expect(found?.stageId).toBe("s2");
    expect(found?.status).toBe("failed");
    expect(findFailedStageForReopen(pipelineWith({ s1: "succeeded", s2: "succeeded" }), undefined)).toBeUndefined();
    // Branch-scoped to a non-matching lane returns nothing; `record.branchKey === branchScope` flipped
    // to `!==` would instead match every "default"-lane stage.
    expect(findFailedStageForReopen(pipelineWith({ s1: "failed", s2: "failed" }), "other")).toBeUndefined();
    expect(findFailedStageForReopen(pipelineWith({ s1: "succeeded", s2: "failed" }), "default")?.stageId).toBe("s2");
  });

  test("reports succeeded only once every authored stage in order has succeeded, including no pending approval gate", () => {
    expect(derivePipelineState(pipelineWith({ s1: "succeeded", s2: "pending" }))).toBe("pending");
    expect(derivePipelineState(pipelineWith({ s1: "succeeded", s2: "succeeded" }))).toBe("succeeded");
  });

  test("reports awaiting-approval when the first unsatisfied approval row reads awaiting", () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
      ],
    };
    const pipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      context: null,
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      dismissedAt: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        branchKey: "default",
        position: index,
        status: stage.stageId === "s1" ? "succeeded" : "awaiting",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
        decidedAt: null,
      })),
    };
    expect(derivePipelineState(pipeline)).toBe("awaiting-approval");
  });

  test("reports pending when an approved gate is followed by an undispatched workflow stage", () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const pipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      context: null,
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      dismissedAt: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        branchKey: "default",
        position: index,
        status: stage.stageId === "s1" ? "succeeded" : stage.stageId === "gate" ? "approved" : "pending",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
        decidedAt: null,
      })),
    };
    expect(derivePipelineState(pipeline)).toBe("pending");
  });

  test("reports awaiting-approval when every workflow stage succeeded and the next stage is an undispatched approval gate", () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
      ],
    };
    const pipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      context: null,
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      dismissedAt: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        branchKey: "default",
        position: index,
        status: stage.stageId === "s1" ? "succeeded" : "pending",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
        decidedAt: null,
      })),
    };
    expect(derivePipelineState(pipeline)).toBe("awaiting-approval");
  });

  test("reports failed when an approval row reads failed", () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
      ],
    };
    const pipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      context: null,
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      dismissedAt: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        branchKey: "default",
        position: index,
        status: stage.stageId === "s1" ? "succeeded" : "failed",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
        decidedAt: null,
      })),
    };
    expect(derivePipelineState(pipeline)).toBe("failed");
  });

  test("reports failed when any workflow stage row reads failed", () => {
    expect(derivePipelineState(pipelineWith({ s1: "succeeded", s2: "failed" }))).toBe("failed");
  });

  test("reports running when any workflow stage row reads running", () => {
    expect(derivePipelineState(pipelineWith({ s1: "succeeded", s2: "running" }))).toBe("running");
  });

  test("reports pending when the loop has not yet reached a dispatchable stage", () => {
    expect(derivePipelineState(pipelineWith({}))).toBe("pending");
  });

  test("walks durable position order, not definition array index", () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "plan", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "implement", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const pipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      context: null,
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      dismissedAt: null,
      stages: [
        {
          id: "row-implement",
          pipelineId: PIPELINE_ID,
          stageId: "implement",
          branchKey: "default",
          position: 0,
          status: "pending",
          workflowInvocationId: null,
          startedAt: null,
          endedAt: null,
          artifact: null,
          failureDetail: null,
          decidedAt: null,
        },
        {
          id: "row-gate",
          pipelineId: PIPELINE_ID,
          stageId: "gate",
          branchKey: "default",
          position: 1,
          status: "awaiting",
          workflowInvocationId: null,
          startedAt: null,
          endedAt: null,
          artifact: null,
          failureDetail: null,
          decidedAt: null,
        },
        {
          id: "row-plan",
          pipelineId: PIPELINE_ID,
          stageId: "plan",
          branchKey: "default",
          position: 2,
          status: "succeeded",
          workflowInvocationId: null,
          startedAt: null,
          endedAt: null,
          artifact: null,
          failureDetail: null,
          decidedAt: null,
        },
      ],
    };

    expect(derivePipelineState(pipeline)).toBe("pending");
  });

  test("reports rejected when any approval stage row reads rejected", () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
      ],
    };
    const pipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      context: null,
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      dismissedAt: null,
      stages: definition.stages.map((stage, index) => ({
        id: `row-${index}`,
        pipelineId: PIPELINE_ID,
        stageId: stage.stageId,
        branchKey: "default",
        position: index,
        status: stage.stageId === "s1" ? "succeeded" : "rejected",
        workflowInvocationId: null,
        startedAt: null,
        endedAt: null,
        artifact: null,
        failureDetail: null,
        decidedAt: null,
      })),
    };
    expect(derivePipelineState(pipeline)).toBe("rejected");
  });

  test("reports interrupted when any stage row reads interrupted", () => {
    expect(
      derivePipelineState({
        ...pipelineWith({ s1: "succeeded", s2: "succeeded" }),
        status: "interrupted",
      }),
    ).toBe("succeeded");

    const definition: PipelineDefinition = {
      name: "p",
      stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }],
    };
    const pipeline: Pipeline & { stages: PipelineStageRecord[] } = {
      id: PIPELINE_ID,
      name: definition.name,
      createdAt: 0,
      ownerIdentity: null,
      status: "active",
      definition,
      context: null,
      terminalPublicationFailure: null,
      terminalPublicationSucceededAt: null,
      dismissedAt: null,
      stages: [
        {
          id: "row-0",
          pipelineId: PIPELINE_ID,
          stageId: "s1",
          branchKey: "default",
          position: 0,
          status: "interrupted",
          workflowInvocationId: null,
          startedAt: null,
          endedAt: null,
          artifact: null,
          failureDetail: null,
          decidedAt: null,
        },
      ],
    };
    expect(derivePipelineState(pipeline)).toBe("interrupted");
  });
});

describe("resumePipeline", () => {
  const reopenDefinition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      { stageId: "s3", kind: "workflow", workflow: "implement", review: "light" },
    ],
  };

  function failedPipeline(options: { reopened?: boolean } = {}) {
    const { store, stages } = fakeStore(
      reopenDefinition,
      { "run-1": { specPath: "spec/s2.md" }, "run-2": { specPath: "spec/s3.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    if (options.reopened) {
      store.updateStage({
        pipelineId: PIPELINE_ID,
        stageId: "s2",
        patch: { status: "pending", workflowInvocationId: null, endedAt: null, failureDetail: null, artifact: null },
      });
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "pending" } });
    } else {
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "failed" } });
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "skipped" } });
    }
    return { store, stages };
  }

  test("re-dispatches only the failed continuation stage and preserves predecessor invocation IDs", async () => {
    for (const reopened of [false, true] as const) {
      const { store, stages } = failedPipeline({ reopened });
      const dispatchOrder: number[] = [];
      const stage1Wait = deferred<RunStatus>();
      let stage1WaitCalled = false;
      const resume = resumePipeline(PIPELINE_ID, {
        ...pipelineTestDeps(store, dispatchOrder),
        wait: async (entryRunId) => {
          if (entryRunId === "run-1") {
            stage1WaitCalled = true;
            return stage1Wait.promise;
          }
          return "completed";
        },
      });
      await spinUntilMicrotask(() => stage1WaitCalled, "stage1WaitCalled");
      expect(dispatchOrder).toEqual([1]);
      expect(stages().find((s) => s.stageId === "s1")?.workflowInvocationId).toBe("inv-1");
      stage1Wait.resolve("completed");
      const outcome = await resume;
      expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
      expect(stages().find((s) => s.stageId === "s2")?.status).toBe("succeeded");
    }
  });

  test("on awaiting-approval preserves awaiting on the gate and dispatches no later workflow stage", async () => {
    const { store, stages } = fakeStore(
      APPROVAL_GATE_DEFINITION,
      { "run-2": { specPath: "spec/s3.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(isPipelineContinuable(pipeline)).toBe(false);

    const dispatchOrder: number[] = [];
    const outcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(store, dispatchOrder));
    expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
    expect(dispatchOrder).toEqual([]);
    expect(stages().find((s) => s.stageId === "gate")?.status).toBe("awaiting");
    expect(stages().find((s) => s.stageId === "s3")?.status).toBe("pending");

    const { continued } = await recoverContinuablePipelines(
      store,
      pipelineTestDeps(store, dispatchOrder),
      async () => false,
    );
    expect(continued).toBe(0);
    expect(dispatchOrder).toEqual([]);
  });

  function setupApprovedGatePendingLinear(store: StateStore): void {
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "approved" } });
  }

  test("admits unscoped and explicit-default resume on an approved-gate pending successor strand", async () => {
    for (const branchKey of [undefined, "default"] as const) {
      const { store, stages } = fakeStore(
        APPROVAL_GATE_DEFINITION,
        { "run-2": { specPath: "spec/s3.md" } },
        { context: persistedContext, ownerIdentity: PRIOR_OWNER },
      );
      setupApprovedGatePendingLinear(store);
      const pipeline = store.loadPipeline(PIPELINE_ID);
      if (!pipeline) throw new Error("expected pipeline");
      expect(derivePipelineState(pipeline)).toBe("pending");
      expect(resumeApprovedGatePendingStrandApplies(pipeline)).toBe(true);

      const dispatchOrder: number[] = [];
      const outcome = await resumePipeline(
        PIPELINE_ID,
        pipelineTestDeps(store, dispatchOrder),
        branchKey === undefined ? {} : { branchKey },
      );
      expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
      expect(dispatchOrder).toEqual([2]);
      const successor = stages().find((stage) => stage.stageId === "s3");
      expect(successor?.workflowInvocationId).toBe("run-2");
      expect(successor?.status).toBe("succeeded");
      // @mutate v2/src/daemon/pipeline-execution.ts "if (!resumeAwaitingClaimsOnly(derivedState) && resumeApprovedGatePendingStrandApplies(pipeline)) {" -> "if (false) {"
    }
  });

  test("unscoped and explicit-default resume do not dispatch under aggregate awaiting-approval", async () => {
    for (const branchKey of [undefined, "default"] as const) {
      const { store, stages } = fakeStore(
        FAN_OUT_PIPELINE_DEFINITION,
        {
          "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
          "run-beta-plan": { specPath: "spec/beta/plan.md" },
        },
        { context: persistedContext, ownerIdentity: PRIOR_OWNER },
      );
      const intentArtifact: PipelineStageArtifact = {
        entryRunId: "run-intent",
        specPath: "ready-intents",
        downstreamInputs: [...FAN_OUT_DOWNSTREAM],
      };
      store.updateStage({
        pipelineId: PIPELINE_ID,
        stageId: "intent",
        patch: { status: "succeeded", artifact: intentArtifact, workflowInvocationId: "run-intent" },
      });
      for (const branchKeyName of FAN_OUT_BRANCH_KEYS) {
        store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "gate", branchKey: branchKeyName });
        store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "plan", branchKey: branchKeyName });
        store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "implement", branchKey: branchKeyName });
      }
      for (const stageId of ["gate", "plan", "implement"] as const) {
        store.updateStage({ pipelineId: PIPELINE_ID, stageId, branchKey: "default", patch: { status: "skipped" } });
      }
      store.updateStage({
        pipelineId: PIPELINE_ID,
        stageId: "gate",
        branchKey: "alpha",
        patch: { status: "awaiting" },
      });
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", branchKey: "beta", patch: { status: "approved" } });
      const before = stages().map((stage) => ({ ...stage }));
      const pipeline = store.loadPipeline(PIPELINE_ID);
      if (!pipeline) throw new Error("expected pipeline");
      expect(derivePipelineState(pipeline)).toBe("awaiting-approval");
      expect(resumeApprovedGatePendingStrandApplies(pipeline)).toBe(true);

      const dispatchOrder: number[] = [];
      const outcome = await resumePipeline(
        PIPELINE_ID,
        pipelineTestDeps(store, dispatchOrder),
        branchKey === undefined ? {} : { branchKey },
      );
      expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
      expect(dispatchOrder).toEqual([]);
      expect(stages().map((stage) => ({ ...stage }))).toEqual(before);
      expect(
        stages().find((stage) => stage.stageId === "plan" && stage.branchKey === "beta")?.workflowInvocationId,
      ).toBeNull();
      // @mutate v2/src/daemon/pipeline-execution.ts "if (!resumeAwaitingClaimsOnly(derivedState) && resumeApprovedGatePendingStrandApplies(pipeline)) {" -> "if (resumeApprovedGatePendingStrandApplies(pipeline)) {"
    }
  });

  test("unscoped resume dispatches an approved-gate pending strand without scoping to a failed sibling", async () => {
    for (const branchKey of [undefined, "default"] as const) {
      const { store, stages } = fakeStore(
        FAN_OUT_PIPELINE_DEFINITION,
        { "run-beta-plan": { specPath: "spec/beta/plan.md" } },
        { context: persistedContext, ownerIdentity: PRIOR_OWNER },
      );
      const intentArtifact: PipelineStageArtifact = {
        entryRunId: "run-intent",
        specPath: "ready-intents",
        downstreamInputs: [...FAN_OUT_DOWNSTREAM],
      };
      store.updateStage({
        pipelineId: PIPELINE_ID,
        stageId: "intent",
        patch: { status: "succeeded", artifact: intentArtifact, workflowInvocationId: "run-intent" },
      });
      for (const branchKeyName of FAN_OUT_BRANCH_KEYS) {
        store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "gate", branchKey: branchKeyName });
        store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "plan", branchKey: branchKeyName });
        store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "implement", branchKey: branchKeyName });
      }
      for (const stageId of ["gate", "plan", "implement"] as const) {
        store.updateStage({ pipelineId: PIPELINE_ID, stageId, branchKey: "default", patch: { status: "skipped" } });
      }
      store.updateStage({
        pipelineId: PIPELINE_ID,
        stageId: "plan",
        branchKey: "alpha",
        patch: { status: "failed" },
      });
      store.updateStage({
        pipelineId: PIPELINE_ID,
        stageId: "implement",
        branchKey: "alpha",
        patch: { status: "skipped" },
      });
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", branchKey: "beta", patch: { status: "approved" } });
      const alphaPlanBefore = stages().find((stage) => stage.stageId === "plan" && stage.branchKey === "alpha");
      const pipeline = store.loadPipeline(PIPELINE_ID);
      if (!pipeline) throw new Error("expected pipeline");
      expect(derivePipelineState(pipeline)).toBe("pending");
      expect(resumeApprovedGatePendingStrandApplies(pipeline)).toBe(true);

      const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
      const dispatch: PipelineWorkflowDispatch = async (steps) => {
        const step = steps[0] as unknown as { stageId: string; branchKey?: string };
        dispatchLog.push({ stageId: step.stageId, branchKey: step.branchKey ?? "default" });
        return { ok: true, entryRunId: "run-beta-plan", invocationId: "inv-beta-plan" };
      };
      const wait: PipelineWorkflowWait = async (entryRunId) => {
        if (entryRunId === "run-beta-plan") return "completed";
        throw new Error(`unexpected wait for ${entryRunId}`);
      };
      const resolveStage = async (
        _definition: PipelineDefinition,
        stageIndex: number,
        _context: PipelineContext,
        _stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
        deps?: PipelineStageResolveDeps,
      ): Promise<PipelineStageResolutionResult> => {
        if (stageIndex === 2) {
          return {
            ok: true,
            steps: [
              {
                ...createMinimalDispatchWriteStep({
                  stageIndex,
                  ...(deps?.branchKey === undefined ? {} : { branchKey: deps.branchKey }),
                }),
                stageId: "plan",
              },
            ] as unknown as AnyWorkflowStep[],
          };
        }
        return { ok: true, steps: [] };
      };

      const outcome = await resumePipeline(
        PIPELINE_ID,
        { store, dispatch, wait, resolveStage },
        branchKey === undefined ? {} : { branchKey },
      );
      expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
      expect(dispatchLog).toEqual([{ stageId: "plan", branchKey: "beta" }]);
      expect(
        stages().find((stage) => stage.stageId === "plan" && stage.branchKey === "beta")?.workflowInvocationId,
      ).toBe("run-beta-plan");
      expect(stages().find((stage) => stage.stageId === "plan" && stage.branchKey === "alpha")).toEqual(
        alphaPlanBefore,
      );
      // @mutate v2/src/daemon/pipeline-execution.ts "return continueAfterAdmission(continuationBranchKey, undefined);" -> "return continueAfterAdmission();"
    }
  });

  test("unscoped and explicit-default resume do not dispatch under aggregate running", async () => {
    for (const branchKey of [undefined, "default"] as const) {
      const { store, stages } = fakeStore(
        FAN_OUT_PIPELINE_DEFINITION,
        {
          "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
          "run-alpha-plan": { specPath: "spec/alpha/plan.md" },
        },
        { context: persistedContext, ownerIdentity: PRIOR_OWNER },
      );
      const intentArtifact: PipelineStageArtifact = {
        entryRunId: "run-intent",
        specPath: "ready-intents",
        downstreamInputs: [...FAN_OUT_DOWNSTREAM],
      };
      store.updateStage({
        pipelineId: PIPELINE_ID,
        stageId: "intent",
        patch: { status: "succeeded", artifact: intentArtifact, workflowInvocationId: "run-intent" },
      });
      for (const branchKeyName of FAN_OUT_BRANCH_KEYS) {
        store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "gate", branchKey: branchKeyName });
        store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "plan", branchKey: branchKeyName });
        store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "implement", branchKey: branchKeyName });
      }
      for (const stageId of ["gate", "plan", "implement"] as const) {
        store.updateStage({ pipelineId: PIPELINE_ID, stageId, branchKey: "default", patch: { status: "skipped" } });
      }
      store.updateStage({
        pipelineId: PIPELINE_ID,
        stageId: "plan",
        branchKey: "alpha",
        patch: { status: "running", workflowInvocationId: "run-alpha-plan" },
      });
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", branchKey: "beta", patch: { status: "approved" } });
      const before = stages().map((stage) => ({ ...stage }));
      const pipeline = store.loadPipeline(PIPELINE_ID);
      if (!pipeline) throw new Error("expected pipeline");
      expect(derivePipelineState(pipeline)).toBe("running");
      expect(resumeApprovedGatePendingStrandApplies(pipeline)).toBe(true);

      const dispatchOrder: number[] = [];
      const outcome = await resumePipeline(
        PIPELINE_ID,
        pipelineTestDeps(store, dispatchOrder),
        branchKey === undefined ? {} : { branchKey },
      );
      expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "pipeline_not_resumable" });
      expect(dispatchOrder).toEqual([]);
      expect(stages().map((stage) => ({ ...stage }))).toEqual(before);
      // @mutate v2/src/daemon/pipeline-execution.ts "if (derivedState === \"running\") {" -> "if (false) {"
    }
  });

  test("refuses terminal succeeded and rejected pipelines without stage dispatch", async () => {
    const succeeded = fakeStore(reopenDefinition, {}, { context: persistedContext });
    succeeded.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    succeeded.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "succeeded" } });
    succeeded.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "succeeded" } });

    const rejected = fakeStore(APPROVAL_GATE_DEFINITION, {}, { context: persistedContext });
    rejected.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    rejected.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "rejected" } });

    for (const [store, reason] of [
      [succeeded.store, "pipeline_terminal_succeeded"],
      [rejected.store, "pipeline_terminal_rejected"],
    ] as const) {
      const dispatchOrder: number[] = [];
      const before = store.loadPipeline(PIPELINE_ID)?.stages.map((stage) => ({
        stageId: stage.stageId,
        status: stage.status,
      }));
      const outcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(store, dispatchOrder));
      expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason });
      expect(dispatchOrder).toEqual([]);
      expect(
        store.loadPipeline(PIPELINE_ID)?.stages.map((stage) => ({ stageId: stage.stageId, status: stage.status })),
      ).toEqual(before);
    }
  });

  test("returns reopen refusal for ineligible failed shapes without stage dispatch", async () => {
    const { store, stages } = fakeStore(
      reopenDefinition,
      {},
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "failed" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "failed" } });

    const dispatchOrder: number[] = [];
    const before = stages().map((stage) => ({ stageId: stage.stageId, status: stage.status }));
    const outcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(store, dispatchOrder));
    expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "multiple_failed_stages" });
    expect(dispatchOrder).toEqual([]);
    expect(stages().map((stage) => ({ stageId: stage.stageId, status: stage.status }))).toEqual(before);
  });

  test("refuses derived running, pending, and interrupted pipelines without stage dispatch", async () => {
    const running = fakeStore(reopenDefinition, {}, { context: persistedContext });
    running.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "running" } });

    const pending = fakeStore(reopenDefinition, {}, { context: persistedContext });
    const pendingPipeline = pending.store.loadPipeline(PIPELINE_ID);
    if (!pendingPipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pendingPipeline)).toBe("pending");

    const interrupted = fakeStore(reopenDefinition, {}, { context: persistedContext });
    interrupted.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "interrupted" } });

    for (const store of [running.store, pending.store, interrupted.store]) {
      const dispatchOrder: number[] = [];
      const before = store.loadPipeline(PIPELINE_ID)?.stages.map((stage) => ({
        stageId: stage.stageId,
        status: stage.status,
      }));
      const outcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(store, dispatchOrder));
      expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "pipeline_not_resumable" });
      expect(dispatchOrder).toEqual([]);
      expect(
        store.loadPipeline(PIPELINE_ID)?.stages.map((stage) => ({ stageId: stage.stageId, status: stage.status })),
      ).toEqual(before);
    }
  });

  test("on awaiting-approval returns missing_context and claim_refused without stage dispatch", async () => {
    const missingContext = fakeStore(APPROVAL_GATE_DEFINITION, {}, { context: null, ownerIdentity: PRIOR_OWNER });
    missingContext.store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", workflowInvocationId: "inv-1" },
    });
    missingContext.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });
    const missingDispatch: number[] = [];
    const missingOutcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(missingContext.store, missingDispatch));
    expect(missingOutcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "missing_context" });
    expect(missingDispatch).toEqual([]);

    const claimRefused = fakeStore(
      APPROVAL_GATE_DEFINITION,
      {},
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    claimRefused.store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: { status: "succeeded", workflowInvocationId: "inv-1" },
    });
    claimRefused.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });
    claimRefused.store.claimPipelineContinuation = () => ({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      reason: "claim_lost",
    });
    const claimDispatch: number[] = [];
    const claimOutcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(claimRefused.store, claimDispatch));
    expect(claimOutcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "claim_refused" });
    expect(claimDispatch).toEqual([]);
  });

  test("inverting resume guards fails regression coverage", () => {
    const { store } = failedPipeline({ reopened: true });
    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    const derivedState = derivePipelineState(pipeline);

    expect(resumeTerminalRefusalReason("succeeded")).toBe("pipeline_terminal_succeeded");
    expect(!resumeTerminalRefusalReason("succeeded")).toBe(false);
    expect(resumeTerminalRefusalReason("rejected")).toBe("pipeline_terminal_rejected");
    expect(!resumeTerminalRefusalReason("rejected")).toBe(false);

    expect(resumeAwaitingClaimsOnly("awaiting-approval")).toBe(true);
    expect(!resumeAwaitingClaimsOnly("awaiting-approval")).toBe(false);

    expect(resumeFailedRequiresReopen("failed")).toBe(true);
    expect(!resumeFailedRequiresReopen("failed")).toBe(false);

    expect(resumeDeferredRefusalApplies("running", pipeline)).toBe(true);
    expect(!resumeDeferredRefusalApplies("running", pipeline)).toBe(false);
    expect(resumeDeferredRefusalApplies("pending", pipeline)).toBe(false);
    expect(resumeReopenedPendingContinuation(derivedState, pipeline)).toBe(true);
    expect(!resumeReopenedPendingContinuation(derivedState, pipeline)).toBe(false);
  });

  test("after store close/reopen continues failed and awaiting pipelines from persisted context", async () => {
    const dbPath = join(tmpdir(), `jarvis-pipeline-resume-${process.pid}-${Date.now()}.db`);

    removeOrchestrationStore(dbPath);
    const failedSeed = openStateStore(dbPath, { currentIdentity: PRIOR_OWNER });
    const failedPipelineId = failedSeed.createPipeline({ definition: reopenDefinition, context: persistedContext });
    failedSeed.updateStage({
      pipelineId: failedPipelineId,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    failedSeed.updateStage({ pipelineId: failedPipelineId, stageId: "s2", patch: { status: "failed" } });
    failedSeed.updateStage({ pipelineId: failedPipelineId, stageId: "s3", patch: { status: "skipped" } });
    failedSeed.close();

    const failedStore = openStateStore(dbPath, { currentIdentity: CURRENT_OWNER, isOwnerAlive: async () => false });
    await failedStore.reconcilePipelines();
    const failedDispatch: number[] = [];
    const failedStageWait = deferred<RunStatus>();
    let failedStageEntryRunId: string | undefined;
    let failedStageWaitCalled = false;
    const failedResume = resumePipeline(failedPipelineId, {
      store: failedStore,
      dispatch: async (steps) => {
        const index = stageIndexOf(steps);
        failedDispatch.push(index);
        const entryRunId = failedStore.createRun({
          project: "pipeline-project",
          specRef: "main",
          worktreePath: "/tmp/worktree",
          branch: `branch-${failedDispatch.length}`,
          specPath: `spec/s${index}.md`,
        });
        if (index === 1) failedStageEntryRunId = entryRunId;
        return { ok: true, entryRunId, invocationId: `inv-${index}` };
      },
      wait: async (entryRunId) => {
        if (entryRunId === failedStageEntryRunId) {
          failedStageWaitCalled = true;
          return failedStageWait.promise;
        }
        return "completed";
      },
      resolveStage: resolveStageStub(),
    });
    await spinUntilMicrotask(() => failedStageWaitCalled, "failedStageWaitCalled");
    expect(failedDispatch).toEqual([1]);
    expect(
      failedStore.loadPipeline(failedPipelineId)?.stages.find((stage) => stage.stageId === "s1")?.workflowInvocationId,
    ).toBe("inv-1");
    failedStageWait.resolve("completed");
    const failedOutcome = await failedResume;
    expect(failedOutcome).toEqual({ kind: "resumed", pipelineId: failedPipelineId });
    failedStore.close();

    removeOrchestrationStore(dbPath);
    const awaitingSeed = openStateStore(dbPath, { currentIdentity: PRIOR_OWNER });
    const awaitingPipelineId = awaitingSeed.createPipeline({
      definition: APPROVAL_GATE_DEFINITION,
      context: persistedContext,
    });
    awaitingSeed.updateStage({
      pipelineId: awaitingPipelineId,
      stageId: "s1",
      patch: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
    });
    awaitingSeed.updateStage({ pipelineId: awaitingPipelineId, stageId: "gate", patch: { status: "awaiting" } });
    awaitingSeed.close();

    const awaitingStore = openStateStore(dbPath, { currentIdentity: CURRENT_OWNER, isOwnerAlive: async () => false });
    await awaitingStore.reconcilePipelines();
    const awaitingDispatch: number[] = [];
    const awaitingOutcome = await resumePipeline(awaitingPipelineId, {
      store: awaitingStore,
      dispatch: async (steps) => {
        awaitingDispatch.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-x", invocationId: "inv-x" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
    });
    expect(awaitingOutcome).toEqual({ kind: "resumed", pipelineId: awaitingPipelineId });
    expect(awaitingDispatch).toEqual([]);
    expect(
      awaitingStore.loadPipeline(awaitingPipelineId)?.stages.find((stage) => stage.stageId === "gate")?.status,
    ).toBe("awaiting");
    expect(awaitingStore.loadPipeline(awaitingPipelineId)?.ownerIdentity).toBe(CURRENT_OWNER);
    awaitingStore.close();
  });

  test("resume drives settlement for a stage wedged behind a durably terminal entry run", async () => {
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "...(entryRun.prNumber != null ? { prNumber: entryRun.prNumber } : {})," -> "...(false ? { prNumber: entryRun.prNumber } : {}),"
    const entryRunId = "run-resume-settle-1";
    const reviewRunId = "run-resume-settle-1-review";
    const snapshot = restartSweepEntrySnapshot("inv-resume-settle-1");
    const runs: Record<string, Partial<Run>> = {
      ...deferredFinalEntryRun(entryRunId, snapshot),
      [reviewRunId]: { stepId: "s1-review", status: "completed", workflowSnapshot: snapshot },
    };
    const { store, stages } = fakeStore(DEFERRED_FINAL_STAGE_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: {
        status: "running",
        workflowInvocationId: entryRunId,
        failureDetail: deferredMarkerDetail(entryRunId, "failed"),
      },
    });

    let terminalPublicationCalls = 0;
    const capturedInputs: unknown[] = [];
    const executeTerminalPublication = async (input: unknown) => {
      capturedInputs.push(input);
      terminalPublicationCalls += 1;
      return DEFERRED_FINAL_PR;
    };

    const outcome = await resumePipeline(PIPELINE_ID, {
      store,
      dispatch: async () => {
        throw new Error("final deferred settlement must not redispatch");
      },
      wait: restartSweepWait(runs),
      resolveStage: resolveStageStub(),
      executeTerminalPublication,
    });

    expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
    const s1 = stages().find((s) => s.stageId === "s1");
    expect(s1?.status).toBe("succeeded");
    expect(s1?.failureDetail).toBeNull();
    expect(s1?.artifact).toMatchObject({
      entryRunId,
      specPath: "spec/s1.md",
      ...DEFERRED_FINAL_PR,
    });
    expect(capturedInputs).toEqual([
      {
        terminalAction: "ready",
        worktreePath: "/repo/worktree",
        branch: "feature-branch",
        baseRef: "main",
        ...DEFERRED_FINAL_PR,
      },
    ]);
    expect(terminalPublicationCalls).toBe(1);
    // @mutate v2/src/daemon/pipeline-execution.ts "if (resumeDrivesDeferredSettlement(store, derivedState, pipeline)) return continueAfterAdmission();" -> "if (false) return continueAfterAdmission();"
  });

  test("deferred settlement fails when a ready pipeline's completed entry run lacks publication PR evidence", async () => {
    // @mutate v2/src/daemon/pipeline-stage-dispatch.ts "code: \"completion_publication_missing_pr_evidence\"" -> "code: \"ignored\""
    const definition: PipelineDefinition = {
      name: "missing-publication-evidence",
      terminalAction: "ready",
      stages: [{ stageId: "implement", kind: "workflow", workflow: "implement", review: "light" }],
    };
    const entryRunId = "run-resume-missing-pr";
    const runs: Record<string, Partial<Run>> = {
      [entryRunId]: { specPath: "spec/implement.md", status: "completed" },
    };
    const { store, stages } = fakeStore(definition, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "implement",
      patch: {
        status: "running",
        workflowInvocationId: entryRunId,
        failureDetail: deferredMarkerDetail(entryRunId, "failed"),
      },
    });

    let terminalPublicationCalls = 0;
    const outcome = await resumePipeline(PIPELINE_ID, {
      store,
      dispatch: async () => {
        throw new Error("deferred settlement must not redispatch");
      },
      wait: restartSweepWait(runs),
      resolveStage: resolveStageStub(),
      executeTerminalPublication: async () => {
        terminalPublicationCalls += 1;
        return TERMINAL_PR;
      },
    });

    expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
    const implement = stages().find((stage) => stage.stageId === "implement");
    expect(implement?.status).toBe("failed");
    expect(implement?.failureDetail).toEqual({
      code: "completion_publication_missing_pr_evidence",
      message: `completion publication left no confirmed PR evidence on linked entry run ${entryRunId}`,
    });
    expect(terminalPublicationCalls).toBe(0);
    expect(store.loadPipeline(PIPELINE_ID)?.terminalPublicationFailure).toBeNull();
  });

  test("deferred settlement fails when a merge pipeline's completed entry run lacks publication PR evidence", async () => {
    const definition: PipelineDefinition = {
      name: "missing-publication-evidence-merge",
      terminalAction: "merge",
      stages: [{ stageId: "implement", kind: "workflow", workflow: "implement", review: "light" }],
    };
    const entryRunId = "run-resume-missing-pr-merge";
    const runs: Record<string, Partial<Run>> = {
      [entryRunId]: { specPath: "spec/implement.md", status: "completed" },
    };
    const { store, stages } = fakeStore(definition, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "implement",
      patch: {
        status: "running",
        workflowInvocationId: entryRunId,
        failureDetail: deferredMarkerDetail(entryRunId, "failed"),
      },
    });

    let terminalPublicationCalls = 0;
    const outcome = await resumePipeline(PIPELINE_ID, {
      store,
      dispatch: async () => {
        throw new Error("deferred settlement must not redispatch");
      },
      wait: restartSweepWait(runs),
      resolveStage: resolveStageStub(),
      executeTerminalPublication: async () => {
        terminalPublicationCalls += 1;
        return TERMINAL_PR;
      },
    });

    expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
    const implement = stages().find((stage) => stage.stageId === "implement");
    expect(implement?.status).toBe("failed");
    expect(implement?.failureDetail).toEqual({
      code: "completion_publication_missing_pr_evidence",
      message: `completion publication left no confirmed PR evidence on linked entry run ${entryRunId}`,
    });
    expect(terminalPublicationCalls).toBe(0);
    expect(store.loadPipeline(PIPELINE_ID)?.terminalPublicationFailure).toBeNull();
  });

  test("resume still refuses a running pipeline whose deferred stage entry run is genuinely live", async () => {
    const entryRunId = "run-resume-live-1";
    const runs: Record<string, Partial<Run>> = {
      [entryRunId]: { specPath: "spec/s1.md", status: "in-progress" },
    };
    const { store, stages } = fakeStore(RESTART_SWEEP_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: {
        status: "running",
        workflowInvocationId: entryRunId,
        startedAt: 12345,
        failureDetail: deferredMarkerDetail(entryRunId, "in-progress"),
      },
    });
    const before = structuredClone(stages());

    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "should-not-dispatch" };
    };

    const outcome = await resumePipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait: restartSweepWait(runs),
      resolveStage: resolveStageStub(),
    });

    expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "pipeline_not_resumable" });
    expect(dispatchCalled).toBe(false);
    expect(stages()).toEqual(before);
    // @mutate v2/src/daemon/pipeline-execution.ts "return hasRedrivableDeferredSettlement(store, pipeline, NO_RECONCILED_ENTRY_RUNS);" -> "return true;"
  });

  test("resume still refuses an interrupted pipeline carrying a redrivable deferred stage", async () => {
    const entryRunId = "run-resume-interrupted-1";
    const reviewRunId = "run-resume-interrupted-1-review";
    const snapshot = restartSweepEntrySnapshot("inv-resume-interrupted-1");
    const runs: Record<string, Partial<Run>> = {
      [entryRunId]: { specPath: "spec/s1.md", stepId: "s1-entry", status: "completed", workflowSnapshot: snapshot },
      [reviewRunId]: { stepId: "s1-review", status: "completed", workflowSnapshot: snapshot },
    };
    const { store, stages } = fakeStore(RESTART_SWEEP_DEFINITION, runs, {
      context: persistedContext,
      ownerIdentity: PRIOR_OWNER,
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "s1",
      patch: {
        status: "running",
        workflowInvocationId: entryRunId,
        failureDetail: deferredMarkerDetail(entryRunId, "failed"),
      },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "interrupted" } });

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("interrupted");

    const before = structuredClone(stages());

    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "should-not-dispatch" };
    };

    const outcome = await resumePipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait: restartSweepWait(runs),
      resolveStage: resolveStageStub(),
    });

    expect(outcome).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "pipeline_not_resumable" });
    expect(dispatchCalled).toBe(false);
    expect(stages()).toEqual(before);
    // @mutate v2/src/daemon/pipeline-execution.ts "if (derivedState !== \"running\") return false;" -> "if (false) return false;"
  });
});

describe("resumePipeline branch scope", () => {
  const RESUME_BRANCH_FAILED = "resume-target";
  const RESUME_BRANCH_AWAITING = "resume-awaiting";
  const RESUME_BRANCH_RUNNING = "resume-running";
  const RESUME_BRANCH_REJECTED = "resume-rejected";
  const RESUME_BRANCH_KEYS = [
    RESUME_BRANCH_FAILED,
    RESUME_BRANCH_AWAITING,
    RESUME_BRANCH_RUNNING,
    RESUME_BRANCH_REJECTED,
  ] as const;

  /**
   * Production-shaped fan-out fixture: a branch row (gate included) at every post-split
   * position for four siblings — the target branch has a replayable `failed` implement row,
   * one sibling sits at its own `awaiting` gate, one is mid-`implement` (`running`), and one
   * has its own gate `rejected`. `setupFanOutAlphaLiveLinked` cannot express this shape (its
   * gate row stays default-keyed and pending).
   */
  function setupBranchResumeFixture(store: StateStore): void {
    const intentArtifact: PipelineStageArtifact = {
      entryRunId: "run-intent",
      specPath: "ready-intents",
      downstreamInputs: RESUME_BRANCH_KEYS.map((key) => `ready-intents/${key}.md`),
    };
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "intent",
      patch: { status: "succeeded", artifact: intentArtifact, workflowInvocationId: "run-intent" },
    });
    for (const branchKey of RESUME_BRANCH_KEYS) {
      store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "gate", branchKey });
      store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "plan", branchKey });
      store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "implement", branchKey });
    }
    for (const stageId of ["gate", "plan", "implement"] as const) {
      store.updateStage({ pipelineId: PIPELINE_ID, stageId, branchKey: "default", patch: { status: "skipped" } });
    }

    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      branchKey: RESUME_BRANCH_FAILED,
      patch: { status: "approved" },
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "plan",
      branchKey: RESUME_BRANCH_FAILED,
      patch: { status: "succeeded", artifact: { entryRunId: "run-target-plan", specPath: "spec/target/plan.md" } },
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "implement",
      branchKey: RESUME_BRANCH_FAILED,
      patch: { status: "failed" },
    });

    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      branchKey: RESUME_BRANCH_AWAITING,
      patch: { status: "awaiting" },
    });

    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      branchKey: RESUME_BRANCH_RUNNING,
      patch: { status: "approved" },
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "plan",
      branchKey: RESUME_BRANCH_RUNNING,
      patch: { status: "succeeded", artifact: { entryRunId: "run-running-plan", specPath: "spec/running/plan.md" } },
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "implement",
      branchKey: RESUME_BRANCH_RUNNING,
      patch: { status: "running", workflowInvocationId: "run-running-implement" },
    });

    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      branchKey: RESUME_BRANCH_REJECTED,
      patch: { status: "rejected" },
    });
  }

  test("branch-scoped resume reopens and dispatches only the named failed branch", async () => {
    const { store, stages } = fakeStore(
      FAN_OUT_PIPELINE_DEFINITION,
      { "run-target-implement": { specPath: "spec/target/implement.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    setupBranchResumeFixture(store);
    const before = stages().map((stage) => ({ ...stage }));

    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      const step = steps[0] as unknown as { stageId: string; branchKey?: string };
      dispatchLog.push({ stageId: step.stageId, branchKey: step.branchKey ?? "default" });
      return { ok: true, entryRunId: "run-target-implement", invocationId: "inv-target-implement" };
    };
    const wait: PipelineWorkflowWait = async (entryRunId) => {
      if (entryRunId === "run-target-implement") return "completed";
      throw new Error(`unexpected wait for ${entryRunId}`);
    };
    const resolveStage = async (
      _definition: PipelineDefinition,
      stageIndex: number,
      _context: PipelineContext,
      _stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
      deps?: PipelineStageResolveDeps,
    ): Promise<PipelineStageResolutionResult> => ({
      ok: true,
      steps: [
        {
          ...createMinimalDispatchWriteStep({
            stageIndex,
            ...(deps?.branchKey === undefined ? {} : { branchKey: deps.branchKey }),
          }),
          stageId: "implement",
        },
      ] as unknown as AnyWorkflowStep[],
    });

    // Keystone checkpoint: rebinding branchScope to undefined restores whole-pipeline admission on the aggregate
    // fan-out state (a live `running` sibling), which refuses the whole resume instead of admitting this branch.
    // @mutate v2/src/daemon/pipeline-execution.ts "const branchScope = options.branchKey === DEFAULT_PIPELINE_STAGE_BRANCH_KEY ? undefined : options.branchKey;" -> "const branchScope = undefined;"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (branchScope !== undefined) {" -> "if (false) {"
    // @mutate v2/src/daemon/pipeline-execution.ts "const reopen = store.reopenFailedPipeline({ pipelineId, branchKey: branchScope });" -> "const reopen = store.reopenFailedPipeline({ pipelineId });"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (branchKey.trim() === \"\") return { kind: \"refused\", detail: { reason: \"branch_not_found\" } };" -> "if (true) return { kind: \"refused\", detail: { reason: \"branch_not_found\" } };"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (findFanOutSplit(pipeline) === null) return { kind: \"refused\", detail: { reason: \"branch_not_found\" } };" -> "if (true) return { kind: \"refused\", detail: { reason: \"branch_not_found\" } };"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (boundary === BRANCH_ADMISSION_BOUNDARY_NOT_FOUND) {" -> "if (true) {"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (!branchSuffixRowsPresent(pipeline, boundary, branchKey)) {" -> "if (true) {"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (hasDefault && hasNamed) return position;" -> "if (true) return position;"
    const outcome = await resumePipeline(
      PIPELINE_ID,
      { store, dispatch, wait, resolveStage },
      { branchKey: RESUME_BRANCH_FAILED },
    );

    expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
    expect(dispatchLog).toEqual([{ stageId: "implement", branchKey: RESUME_BRANCH_FAILED }]);

    const after = stages();
    for (const snapshot of before) {
      if (snapshot.stageId === "implement" && snapshot.branchKey === RESUME_BRANCH_FAILED) continue;
      expect(after.find((stage) => stage.id === snapshot.id)).toEqual(snapshot);
    }
    const implementAfter = stageRecord(after, "implement", RESUME_BRANCH_FAILED);
    expect(implementAfter?.status).toBe("succeeded");
    expect(implementAfter?.artifact).toEqual({
      entryRunId: "run-target-implement",
      invocationId: "inv-target-implement",
      specPath: "spec/target/implement.md",
    });
  });

  test("branch-scoped resume refuses the named branch gate, an unknown branch, and a branch without a replayable failure", async () => {
    const { store, stages } = fakeStore(
      FAN_OUT_PIPELINE_DEFINITION,
      {},
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    setupBranchResumeFixture(store);
    const before = stages().map((stage) => ({ ...stage }));
    const dispatchOrder: number[] = [];
    const deps = pipelineTestDeps(store, dispatchOrder);

    // @mutate v2/src/daemon/pipeline-execution.ts "if (scan.kind === \"gate_awaiting\") {" -> "if (scan.kind === \"gate_rejected\") {"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (scan.kind === \"gate_rejected\") {" -> "if (scan.kind === \"gate_awaiting\") {"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (record.status === \"failed\") return { kind: \"resumable\" };" -> "if (true) return { kind: \"resumable\" };"
    // @mutate v2/src/daemon/pipeline-execution.ts "return { kind: \"not_resumable\", status: record.status };" -> "return { kind: \"resumable\" };"
    const awaitingOutcome = await resumePipeline(PIPELINE_ID, deps, { branchKey: RESUME_BRANCH_AWAITING });
    expect(awaitingOutcome).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      branchKey: RESUME_BRANCH_AWAITING,
      reason: "branch_awaiting_approval",
      stageId: "gate",
    });

    const rejectedOutcome = await resumePipeline(PIPELINE_ID, deps, { branchKey: RESUME_BRANCH_REJECTED });
    expect(rejectedOutcome).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      branchKey: RESUME_BRANCH_REJECTED,
      reason: "branch_rejected",
      stageId: "gate",
    });

    const unknownOutcome = await resumePipeline(PIPELINE_ID, deps, { branchKey: "unknown-branch" });
    expect(unknownOutcome).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      branchKey: "unknown-branch",
      reason: "branch_not_found",
    });

    const whitespaceOutcome = await resumePipeline(PIPELINE_ID, deps, { branchKey: "   " });
    expect(whitespaceOutcome).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      branchKey: "   ",
      reason: "branch_not_found",
    });

    const runningOutcome = await resumePipeline(PIPELINE_ID, deps, { branchKey: RESUME_BRANCH_RUNNING });
    expect(runningOutcome).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      branchKey: RESUME_BRANCH_RUNNING,
      reason: "branch_not_resumable",
      status: "running",
    });

    expect(dispatchOrder).toEqual([]);
    expect(stages().map((stage) => ({ ...stage }))).toEqual(before);

    const noSplit = fakeStore(APPROVAL_GATE_DEFINITION, {}, { context: persistedContext, ownerIdentity: PRIOR_OWNER });
    noSplit.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
    const noSplitBefore = noSplit.stages().map((stage) => ({ ...stage }));
    const noSplitDispatch: number[] = [];
    const noSplitOutcome = await resumePipeline(PIPELINE_ID, pipelineTestDeps(noSplit.store, noSplitDispatch), {
      branchKey: "gamma",
    });
    expect(noSplitOutcome).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      branchKey: "gamma",
      reason: "branch_not_found",
    });
    expect(noSplitDispatch).toEqual([]);
    expect(noSplit.stages().map((stage) => ({ ...stage }))).toEqual(noSplitBefore);
  });

  test("resume branchKey default aliases the unscoped path", async () => {
    const aliasDefinition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "s3", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };

    function buildFailed() {
      const { store, stages } = fakeStore(
        aliasDefinition,
        { "run-1": { specPath: "spec/s2.md" }, "run-2": { specPath: "spec/s3.md" } },
        { context: persistedContext, ownerIdentity: PRIOR_OWNER },
      );
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "succeeded" } });
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s2", patch: { status: "failed" } });
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s3", patch: { status: "skipped" } });
      return { store, stages };
    }

    const omittedFailed = buildFailed();
    const outcomeOmittedFailed = await resumePipeline(PIPELINE_ID, pipelineTestDeps(omittedFailed.store, []));
    const defaultFailed = buildFailed();
    const outcomeDefaultFailed = await resumePipeline(PIPELINE_ID, pipelineTestDeps(defaultFailed.store, []), {
      branchKey: "default",
    });
    expect(outcomeDefaultFailed).toEqual(outcomeOmittedFailed);
    // Normalize wall-clock timestamps: the two builds run ~1ms apart, so exact
    // startedAt/endedAt values can straddle a millisecond boundary. Alias equality
    // is structural, not temporal.
    expect(normalizeStageClocks(defaultFailed.stages())).toEqual(normalizeStageClocks(omittedFailed.stages()));

    function buildAwaiting() {
      const { store, stages } = fakeStore(
        APPROVAL_GATE_DEFINITION,
        {},
        { context: persistedContext, ownerIdentity: PRIOR_OWNER },
      );
      store.updateStage({
        pipelineId: PIPELINE_ID,
        stageId: "s1",
        patch: { status: "succeeded", workflowInvocationId: "inv-1" },
      });
      store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "awaiting" } });
      return { store, stages };
    }

    const omittedAwaiting = buildAwaiting();
    const outcomeOmittedAwaiting = await resumePipeline(PIPELINE_ID, pipelineTestDeps(omittedAwaiting.store, []));
    const defaultAwaiting = buildAwaiting();
    const outcomeDefaultAwaiting = await resumePipeline(PIPELINE_ID, pipelineTestDeps(defaultAwaiting.store, []), {
      branchKey: "default",
    });
    expect(outcomeDefaultAwaiting).toEqual(outcomeOmittedAwaiting);
    expect(normalizeStageClocks(defaultAwaiting.stages())).toEqual(normalizeStageClocks(omittedAwaiting.stages()));
  });

  const APPROVED_PENDING_BRANCH = "approved-pending-target";
  const APPROVED_PENDING_SIBLING = "approved-pending-sibling";

  function setupApprovedGatePendingBranchFixture(store: StateStore): void {
    const intentArtifact: PipelineStageArtifact = {
      entryRunId: "run-intent",
      specPath: "ready-intents",
      downstreamInputs: [APPROVED_PENDING_BRANCH, APPROVED_PENDING_SIBLING].map((key) => `ready-intents/${key}.md`),
    };
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "intent",
      patch: { status: "succeeded", artifact: intentArtifact, workflowInvocationId: "run-intent" },
    });
    for (const branchKey of [APPROVED_PENDING_BRANCH, APPROVED_PENDING_SIBLING]) {
      store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "gate", branchKey });
      store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "plan", branchKey });
      store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "implement", branchKey });
    }
    for (const stageId of ["gate", "plan", "implement"] as const) {
      store.updateStage({ pipelineId: PIPELINE_ID, stageId, branchKey: "default", patch: { status: "skipped" } });
    }
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      branchKey: APPROVED_PENDING_BRANCH,
      patch: { status: "approved" },
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      branchKey: APPROVED_PENDING_SIBLING,
      patch: { status: "awaiting" },
    });
  }

  test("branch-scoped resume continues an approved-gate pending strand without reopenFailedPipeline", async () => {
    const { store, stages } = fakeStore(
      FAN_OUT_PIPELINE_DEFINITION,
      { "run-target-plan": { specPath: "spec/target/plan.md" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    setupApprovedGatePendingBranchFixture(store);
    const before = stages().map((stage) => ({ ...stage }));
    let reopenCalled = false;
    const reopenFailedPipeline = store.reopenFailedPipeline.bind(store);
    store.reopenFailedPipeline = (args) => {
      reopenCalled = true;
      return reopenFailedPipeline(args);
    };

    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      const step = steps[0] as unknown as { stageId: string; branchKey?: string };
      dispatchLog.push({ stageId: step.stageId, branchKey: step.branchKey ?? "default" });
      return { ok: true, entryRunId: "run-target-plan", invocationId: "inv-target-plan" };
    };
    const wait: PipelineWorkflowWait = async (entryRunId) => {
      if (entryRunId === "run-target-plan") return "completed";
      throw new Error(`unexpected wait for ${entryRunId}`);
    };
    const resolveStage = async (
      _definition: PipelineDefinition,
      stageIndex: number,
      _context: PipelineContext,
      _stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
      deps?: PipelineStageResolveDeps,
    ): Promise<PipelineStageResolutionResult> => {
      if (stageIndex === 2) {
        return {
          ok: true,
          steps: [
            {
              ...createMinimalDispatchWriteStep({
                stageIndex,
                ...(deps?.branchKey === undefined ? {} : { branchKey: deps.branchKey }),
              }),
              stageId: "plan",
            },
          ] as unknown as AnyWorkflowStep[],
        };
      }
      if (stageIndex === 3) {
        return { ok: false, error: "test: implement stage intentionally fails to pin continuation state" };
      }
      return { ok: true, steps: [] };
    };

    const outcome = await resumePipeline(
      PIPELINE_ID,
      { store, dispatch, wait, resolveStage },
      { branchKey: APPROVED_PENDING_BRANCH },
    );

    expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
    expect(reopenCalled).toBe(false);
    expect(dispatchLog).toEqual([{ stageId: "plan", branchKey: APPROVED_PENDING_BRANCH }]);
    const after = stages();
    for (const snapshot of before) {
      if (
        snapshot.branchKey === APPROVED_PENDING_BRANCH &&
        (snapshot.stageId === "plan" || snapshot.stageId === "implement")
      ) {
        continue;
      }
      expect(after.find((stage) => stage.id === snapshot.id)).toEqual(snapshot);
    }
    const planAfter = stageRecord(after, "plan", APPROVED_PENDING_BRANCH);
    expect(planAfter?.status).toBe("succeeded");
    expect(planAfter?.workflowInvocationId).toBe("run-target-plan");
    // @mutate v2/src/daemon/pipeline-execution.ts "return { kind: \"admissible\", reopenFailed: false };" -> "return { kind: \"not_resumable\", status: record.status };"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (admission.reopenFailedStage) {" -> "if (true) {"
  });
});

const REAL_STORE_DB_PATH = join(tmpdir(), `jarvis-pipeline-activation-${process.pid}.sqlite`);

describe("post-reconcile activation on real store", () => {
  const PRIOR_IDENTITY = "11111:1000000";
  const CURRENT_IDENTITY = "22222:2000000";

  const reopenDefinition: PipelineDefinition = {
    name: "p",
    stages: [
      { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
      { stageId: "s2", kind: "workflow", workflow: "plan", review: "none" },
      { stageId: "s3", kind: "workflow", workflow: "implement", review: "light" },
    ],
  };

  function seedStages(
    dbPath: string,
    pipelineId: string,
    patches: Record<string, { status: string; artifact?: unknown; workflowInvocationId?: string | null }>,
  ): void {
    const raw = new Database(dbPath);
    try {
      for (const [stageId, patch] of Object.entries(patches)) {
        raw
          .prepare(
            `UPDATE pipeline_stages
             SET status = ?, artifact = ?, workflow_invocation_id = ?
             WHERE pipeline_id = ? AND stage_id = ?`,
          )
          .run(
            patch.status,
            patch.artifact === undefined ? null : JSON.stringify(patch.artifact),
            patch.workflowInvocationId ?? null,
            pipelineId,
            stageId,
          );
      }
    } finally {
      raw.close();
    }
  }

  function dispatchWithRuns(store: StateStore): PipelineWorkflowDispatch {
    let branchCounter = 0;
    return async (steps) => {
      const index = stageIndexOf(steps);
      const entryRunId = store.createRun({
        project: "pipeline-project",
        specRef: "main",
        worktreePath: "/tmp/worktree",
        branch: `branch-${branchCounter++}`,
        specPath: `spec/s${index}.md`,
      });
      return { ok: true, entryRunId, invocationId: `inv-${index}` };
    };
  }

  test("activates an approved gate after reconcilePipelines claims ownership and dispatches once", async () => {
    removeOrchestrationStore(REAL_STORE_DB_PATH);
    const seedStore = openStateStore(REAL_STORE_DB_PATH, { currentIdentity: PRIOR_IDENTITY });
    const pipelineId = seedStore.createPipeline({ definition: APPROVAL_GATE_DEFINITION, context: persistedContext });
    const gateRecord = seedStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "gate");
    if (!gateRecord) throw new Error("expected gate row");
    seedStages(REAL_STORE_DB_PATH, pipelineId, {
      s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
      gate: { status: "awaiting" },
    });
    expect(seedStore.commitApprovalDecision({ stageRecordId: gateRecord.id, decision: "approved" }).kind).toBe(
      "applied",
    );
    seedStore.close();

    const sweepStore = openStateStore(REAL_STORE_DB_PATH, {
      currentIdentity: CURRENT_IDENTITY,
      isOwnerAlive: async () => false,
    });
    await sweepStore.reconcilePipelines();
    const reconciled = sweepStore.loadPipeline(pipelineId);
    if (!reconciled) throw new Error("expected pipeline");
    expect(reconciled.status).toBe("interrupted");
    expect(isPipelineContinuable(reconciled)).toBe(true);

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return (await dispatchWithRuns(sweepStore)(steps)) as Awaited<ReturnType<PipelineWorkflowDispatch>>;
    };
    const { continued } = await recoverContinuablePipelines(
      sweepStore,
      { store: sweepStore, dispatch, wait: async () => "completed", resolveStage: resolveStageStub() },
      async () => false,
    );

    expect(continued).toBe(1);
    expect(dispatchOrder).toEqual([2]);
    const after = sweepStore.loadPipeline(pipelineId);
    expect(after?.status).toBe("active");
    expect(after?.ownerIdentity).toBe(CURRENT_IDENTITY);
    expect(after?.stages.find((stage) => stage.stageId === "s3")?.status).toBe("succeeded");
    sweepStore.close();
  });

  test("activates a reopened failed continuation after reconcilePipelines", async () => {
    removeOrchestrationStore(REAL_STORE_DB_PATH);
    const seedStore = openStateStore(REAL_STORE_DB_PATH, { currentIdentity: PRIOR_IDENTITY });
    const pipelineId = seedStore.createPipeline({ definition: reopenDefinition, context: persistedContext });
    seedStages(REAL_STORE_DB_PATH, pipelineId, {
      s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
      s2: { status: "failed" },
      s3: { status: "skipped" },
    });
    seedStore.close();

    const sweepStore = openStateStore(REAL_STORE_DB_PATH, {
      currentIdentity: CURRENT_IDENTITY,
      isOwnerAlive: async () => false,
    });
    await sweepStore.reconcilePipelines();
    expect(sweepStore.reopenFailedPipeline({ pipelineId }).kind).toBe("applied");
    const reconciled = sweepStore.loadPipeline(pipelineId);
    if (!reconciled) throw new Error("expected pipeline");
    expect(reconciled.status).toBe("interrupted");
    expect(isPipelineContinuable(reconciled)).toBe(true);

    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      dispatchOrder.push(stageIndexOf(steps));
      return (await dispatchWithRuns(sweepStore)(steps)) as Awaited<ReturnType<PipelineWorkflowDispatch>>;
    };
    const { continued } = await recoverContinuablePipelines(
      sweepStore,
      {
        store: sweepStore,
        dispatch,
        wait: async () => "completed",
        resolveStage: resolveStageStub(),
      },
      async () => false,
    );

    expect(continued).toBe(1);
    expect(dispatchOrder).toEqual([1, 2]);
    const after = sweepStore.loadPipeline(pipelineId);
    expect(after?.status).toBe("active");
    expect(after?.stages.find((stage) => stage.stageId === "s1")?.workflowInvocationId).toBe("inv-1");
    expect(after?.stages.find((stage) => stage.stageId === "s2")?.status).toBe("succeeded");
    expect(after?.stages.find((stage) => stage.stageId === "s3")?.status).toBe("succeeded");
    sweepStore.close();
  });

  test("a duplicate claim after reconcile produces no second dispatch", async () => {
    removeOrchestrationStore(REAL_STORE_DB_PATH);
    const seedStore = openStateStore(REAL_STORE_DB_PATH, { currentIdentity: PRIOR_IDENTITY });
    const pipelineId = seedStore.createPipeline({ definition: APPROVAL_GATE_DEFINITION, context: persistedContext });
    const gateRecord = seedStore.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "gate");
    if (!gateRecord) throw new Error("expected gate row");
    seedStages(REAL_STORE_DB_PATH, pipelineId, {
      s1: { status: "succeeded", artifact: { specPath: "spec/s1.md" }, workflowInvocationId: "inv-1" },
      gate: { status: "approved" },
    });
    seedStore.close();

    const sweepStore = openStateStore(REAL_STORE_DB_PATH, {
      currentIdentity: CURRENT_IDENTITY,
      isOwnerAlive: async () => false,
    });
    await sweepStore.reconcilePipelines();

    let claimCalls = 0;
    const originalClaim = sweepStore.claimPipelineContinuation.bind(sweepStore);
    sweepStore.claimPipelineContinuation = (args) => {
      claimCalls += 1;
      if (claimCalls === 1) return originalClaim(args);
      return { kind: "refused", pipelineId, reason: "claim_lost" };
    };

    const dispatchOrder: number[] = [];
    const deps = {
      store: sweepStore,
      dispatch: (async (steps: AnyWorkflowStep[]) => {
        dispatchOrder.push(stageIndexOf(steps));
        return (await dispatchWithRuns(sweepStore)(steps)) as Awaited<ReturnType<PipelineWorkflowDispatch>>;
      }) as PipelineWorkflowDispatch,
      wait: (async () => "completed") as PipelineWorkflowWait,
      resolveStage: resolveStageStub(),
    };

    const first = await recoverContinuablePipelines(sweepStore, deps, async () => false);
    const beforeSecond = sweepStore.loadPipeline(pipelineId)?.stages.map((stage) => ({
      stageId: stage.stageId,
      status: stage.status,
    }));
    const second = await recoverContinuablePipelines(sweepStore, deps, async () => false);

    expect(first.continued).toBe(1);
    expect(second.continued).toBe(0);
    expect(dispatchOrder).toEqual([2]);
    expect(
      sweepStore.loadPipeline(pipelineId)?.stages.map((stage) => ({ stageId: stage.stageId, status: stage.status })),
    ).toEqual(beforeSecond);
    sweepStore.close();
  });
});

const TERMINAL_PIPELINE_DEFINITION: PipelineDefinition = {
  name: "terminal-p",
  terminalAction: "ready",
  stages: [{ stageId: "implement", kind: "workflow", workflow: "implement", review: "light" }],
};

const TERMINAL_PR = { prNumber: 42, prUrl: "https://github.com/org/repo/pull/42" } as const;

function terminalImplementArtifact(entryRunId = "run-implement"): PipelineStageArtifact {
  return { entryRunId, specPath: "spec/implement.md", ...TERMINAL_PR };
}

function terminalImplementRun(): Partial<Run> {
  return {
    specRef: "main",
    worktreePath: "/repo/worktree",
    branch: "feature-branch",
    specPath: "spec/implement.md",
    ...TERMINAL_PR,
  };
}

function terminalPipelineDefinition(action: PipelineTerminalAction): PipelineDefinition {
  return { ...TERMINAL_PIPELINE_DEFINITION, terminalAction: action };
}

function terminalRunDeps(
  store: StateStore,
  executeTerminalPublication: NonNullable<PipelineExecutionDeps["executeTerminalPublication"]>,
): PipelineExecutionDeps {
  return {
    store,
    dispatch: async () => ({ ok: true, entryRunId: "run-implement", invocationId: "inv-implement" }),
    wait: async () => "completed",
    context: baseContext,
    resolveStage: resolveStageStub(),
    executeTerminalPublication,
  };
}

describe("pipeline terminal publication settlement", () => {
  test("settles each configured terminal action end to end", async () => {
    for (const terminalAction of ["leave-draft", "ready", "merge"] as const satisfies PipelineTerminalAction[]) {
      const definition = terminalPipelineDefinition(terminalAction);
      const { store, stages } = fakeStore(definition, { "run-implement": terminalImplementRun() });
      const settlement = deferred<void>();
      const capturedInputs: unknown[] = [];
      const executeTerminalPublication = async (input: unknown) => {
        capturedInputs.push(input);
        await settlement.promise;
        return TERMINAL_PR;
      };

      const runPromise = runPipeline(PIPELINE_ID, terminalRunDeps(store, executeTerminalPublication));

      await spinUntilMicrotask(
        () => stages().find((s) => s.stageId === "implement")?.status === "succeeded",
        "implement stage succeeded",
      );

      const midPipeline = store.loadPipeline(PIPELINE_ID);
      if (!midPipeline) throw new Error("expected pipeline");
      expect(derivePipelineState(midPipeline)).toBe("running");

      settlement.resolve();
      await runPromise;

      expect(capturedInputs).toEqual([
        {
          terminalAction,
          worktreePath: "/repo/worktree",
          branch: "feature-branch",
          baseRef: "main",
          ...TERMINAL_PR,
        },
      ]);
      const settled = store.loadPipeline(PIPELINE_ID);
      if (!settled) throw new Error("expected pipeline");
      expect(settled.terminalPublicationSucceededAt).not.toBeNull();
      expect(derivePipelineState(settled)).toBe("succeeded");
    }
  });

  test("continues pending terminal publication after restart", async () => {
    const definition = terminalPipelineDefinition("ready");
    const { store, stages } = fakeStore(
      definition,
      { "run-implement": terminalImplementRun() },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "implement",
      patch: { status: "succeeded", artifact: terminalImplementArtifact() },
    });

    const dispatchOrder: number[] = [];
    const executeTerminalPublication = async () => TERMINAL_PR;

    const outcome = await continuePipeline(PIPELINE_ID, {
      store,
      dispatch: async (steps) => {
        dispatchOrder.push(stageIndexOf(steps));
        return { ok: true, entryRunId: "run-implement", invocationId: "inv-implement" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
      executeTerminalPublication,
    });

    expect(outcome).toEqual({ kind: "continued", pipelineId: PIPELINE_ID });
    expect(dispatchOrder).toEqual([]);
    const settled = store.loadPipeline(PIPELINE_ID);
    if (!settled) throw new Error("expected pipeline");
    expect(settled.terminalPublicationSucceededAt).not.toBeNull();
    expect(derivePipelineState(settled)).toBe("succeeded");
    expect(stages().find((s) => s.stageId === "implement")?.status).toBe("succeeded");
  });

  test("settlement-pending pipeline with incomplete persisted context is not continuable and records terminal publication failure on continuation", async () => {
    const definition = terminalPipelineDefinition("ready");
    const malformedContext = { cwd: "/repo", seed: "legacy inline seed" } as PipelineContext;
    const { store } = fakeStore(
      definition,
      { "run-implement": terminalImplementRun() },
      { context: malformedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "implement",
      patch: { status: "succeeded", artifact: terminalImplementArtifact() },
    });

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(isPipelineContinuable(pipeline)).toBe(false);

    let terminalPublicationCalls = 0;
    const outcome = await continuePipeline(PIPELINE_ID, {
      store,
      dispatch: async () => {
        throw new Error("must not dispatch");
      },
      wait: async () => "completed",
      resolveStage: resolveStageStub(),
      executeTerminalPublication: async () => {
        terminalPublicationCalls += 1;
        return TERMINAL_PR;
      },
    });

    expect(outcome).toEqual({ kind: "continued", pipelineId: PIPELINE_ID });
    expect(terminalPublicationCalls).toBe(0);
    const settled = store.loadPipeline(PIPELINE_ID);
    if (!settled) throw new Error("expected pipeline");
    expect(settled.terminalPublicationFailure?.failure.message).toMatch(/^pipeline-context-loader:/);
    expect(settled.terminalPublicationSucceededAt).toBeNull();
    expect(derivePipelineState(settled)).toBe("failed");
  });

  test("does not invoke terminal publication when the stage walk stops early", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      terminalAction: "merge",
      stages: [
        { stageId: "s1", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "gate", kind: "approval" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };

    let terminalCalls = 0;
    const executeTerminalPublication = async () => {
      terminalCalls += 1;
      return {};
    };
    const dispatch: PipelineWorkflowDispatch = async (steps) => ({
      ok: true,
      entryRunId: `run-${stageIndexOf(steps)}`,
      invocationId: `inv-${stageIndexOf(steps)}`,
    });
    const wait: PipelineWorkflowWait = async () => "completed";
    const deps = {
      store: fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } }).store,
      dispatch,
      wait,
      context: baseContext,
      resolveStage: resolveStageStub(),
      executeTerminalPublication,
    };

    await runPipeline(PIPELINE_ID, deps);
    expect(terminalCalls).toBe(0);

    const awaiting = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    await runPipeline(PIPELINE_ID, { ...deps, store: awaiting.store });
    expect(terminalCalls).toBe(0);

    const rejected = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    rejected.store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", patch: { status: "rejected" } });
    await runPipeline(PIPELINE_ID, { ...deps, store: rejected.store });
    expect(terminalCalls).toBe(0);

    const failed = fakeStore(definition, { "run-0": { specPath: "spec/s1.md" } });
    const failingDispatch: PipelineWorkflowDispatch = async (steps) => {
      const index = stageIndexOf(steps);
      if (index === 0) return { ok: false, code: "worktree_claimed", message: "claimed" };
      return { ok: true, entryRunId: `run-${index}`, invocationId: `inv-${index}` };
    };
    await runPipeline(PIPELINE_ID, {
      ...deps,
      store: failed.store,
      dispatch: failingDispatch,
    });
    expect(terminalCalls).toBe(0);
  });

  test("fails a pipeline when its terminal action fails", async () => {
    const definition = terminalPipelineDefinition("ready");
    const { store, stages } = fakeStore(definition, { "run-implement": terminalImplementRun() });
    const failure = { operation: "gh pr ready", message: "ready flip failed", exitCode: 1 };
    const executeTerminalPublication = async () => {
      throw new TerminalPublicationError("ready", failure, TERMINAL_PR.prNumber, TERMINAL_PR.prUrl);
    };

    await runPipeline(PIPELINE_ID, terminalRunDeps(store, executeTerminalPublication));

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(pipeline.terminalPublicationFailure).toEqual({
      terminalAction: "ready",
      failure,
      ...TERMINAL_PR,
    });
    expect(stages().every((stage) => stage.status === "succeeded")).toBe(true);
    expect(derivePipelineState(pipeline)).toBe("failed");
    // In `hasPipelineTerminalPublicationFailure`, delete the `terminalPublicationFailure !== null` check or force `return false` turns this test RED.
    expect(hasPipelineTerminalPublicationFailure(pipeline)).toBe(true);
  });

  test("does not merge a pipeline after a red ready gate", async () => {
    const definition = terminalPipelineDefinition("merge");
    const { store, stages } = fakeStore(definition, { "run-implement": terminalImplementRun() });
    let mergeCalls = 0;
    const executeTerminalPublication = async () => {
      mergeCalls += 1;
      throw new TerminalPublicationError(
        "merge",
        { operation: "ready-gate", message: "gateFailureKind=failed_checks", exitCode: 1 },
        TERMINAL_PR.prNumber,
        TERMINAL_PR.prUrl,
      );
    };

    await runPipeline(PIPELINE_ID, terminalRunDeps(store, executeTerminalPublication));

    expect(mergeCalls).toBe(1);
    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(pipeline.terminalPublicationFailure?.terminalAction).toBe("merge");
    expect(derivePipelineState(pipeline)).toBe("failed");
    expect(stages().every((stage) => stage.status === "succeeded")).toBe(true);
  });

  test("records terminal publication failure when success commit throws", async () => {
    const definition = terminalPipelineDefinition("ready");
    const { store: inner, stages } = fakeStore(definition, { "run-implement": terminalImplementRun() });
    const store = {
      ...inner,
      commitTerminalPublicationSuccess: () => {
        throw new Error("success commit failed");
      },
    } as StateStore;

    await runPipeline(
      PIPELINE_ID,
      terminalRunDeps(store, async () => TERMINAL_PR),
    );

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(pipeline.terminalPublicationFailure).not.toBeNull();
    expect(pipeline.terminalPublicationSucceededAt).toBeNull();
    expect(stages().every((stage) => stage.status === "succeeded")).toBe(true);
    expect(derivePipelineState(pipeline)).toBe("failed");
  });
});

const FAN_OUT_DOWNSTREAM = ["ready-intents/alpha.md", "ready-intents/beta.md"] as const;
const FAN_OUT_BRANCH_KEYS = FAN_OUT_DOWNSTREAM.map(branchKeyFromDownstreamInput);

const FAN_OUT_PIPELINE_DEFINITION: PipelineDefinition = {
  name: "fan-out",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "gate", kind: "approval" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

const FAN_OUT_LINEAR_DEFINITION: PipelineDefinition = {
  name: "fan-out-linear",
  stages: [
    { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
    { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
    { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
  ],
};

function fanOutResolveStageStub(
  _options: { failBranchIndex?: number; failAtStageIndex?: number } = {},
): (
  definition: PipelineDefinition,
  stageIndex: number,
  context: PipelineContext,
  stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
  deps?: PipelineStageResolveDeps,
) => Promise<PipelineStageResolutionResult> {
  return async (definition, stageIndex, _context, stageArtifacts, deps) => {
    const stage = definition.stages[stageIndex];
    if (stage?.kind === "workflow" && stage.workflow === "plan") {
      return {
        ok: true,
        results: FAN_OUT_BRANCH_KEYS.map((branchKey) => ({
          steps: [createMinimalDispatchWriteStep({ stageIndex, branchKey })],
        })),
      };
    }
    const branchKey = deps?.branchKey ?? "default";
    const priorPlan = stageArtifacts.get(stageArtifactKey("plan", branchKey));
    const inferredBranchKey =
      typeof priorPlan?.entryRunId === "string" ? priorPlan.entryRunId.split("-")[1] : undefined;
    return {
      ok: true,
      steps: [createMinimalDispatchWriteStep({ stageIndex, branchKey: inferredBranchKey ?? branchKey })],
    };
  };
}

function stageRecord(
  stages: PipelineStageRecord[],
  stageId: string,
  branchKey = "default",
): PipelineStageRecord | undefined {
  return stages.find((stage) => stage.stageId === stageId && stage.branchKey === branchKey);
}

function setupFanOutAlphaLiveLinked(
  store: StateStore,
  alphaPatch: Record<string, unknown> = { status: "running", workflowInvocationId: "run-alpha-running" },
): void {
  const intentArtifact: PipelineStageArtifact = {
    entryRunId: "run-intent",
    specPath: "ready-intents",
    downstreamInputs: [...FAN_OUT_DOWNSTREAM],
  };
  store.updateStage({
    pipelineId: PIPELINE_ID,
    stageId: "intent",
    patch: { status: "succeeded", artifact: intentArtifact, workflowInvocationId: "run-intent" },
  });
  for (const branchKey of FAN_OUT_BRANCH_KEYS) {
    store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "plan", branchKey });
    store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "implement", branchKey });
  }
  for (const stageId of ["plan", "implement"] as const) {
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId,
      branchKey: "default",
      patch: { status: "skipped" },
    });
  }
  store.updateStage({
    pipelineId: PIPELINE_ID,
    stageId: "plan",
    branchKey: "alpha",
    patch: alphaPatch,
  });
}

const FAN_OUT_ALPHA_RUNNING_RUNS = {
  "run-intent": {
    specPath: "ready-intents",
    downstreamInputs: [...FAN_OUT_DOWNSTREAM],
    worktreePath: "/intent",
    branch: "intent/split",
  },
  "run-alpha-running": { specPath: "spec/alpha/plan.md", status: "in-progress" as const },
  "run-beta-1-2": { specPath: "spec/beta/plan.md" },
  "run-beta-2-4": { specPath: "spec/beta/implement.md" },
};

/** Wrap `store.updateStage` to record every dispatch (a write to `status: "running"`) into `dispatchLog`. */
function instrumentDispatchLog(
  store: StateStore,
  dispatchLog: Array<{ stageId: string; branchKey: string }>,
): StateStore {
  return {
    ...store,
    updateStage: (args: { stageId: string; branchKey?: string; patch: Record<string, unknown> }) => {
      if (args.patch.status === "running") {
        dispatchLog.push({ stageId: args.stageId, branchKey: args.branchKey ?? "default" });
      }
      return store.updateStage(args as Parameters<StateStore["updateStage"]>[0]);
    },
  } as StateStore;
}

function fanOutPipelineDeps(
  store: StateStore,
  dispatchLog: Array<{ stageId: string; branchKey: string }>,
  options: {
    failBranchIndex?: number;
    failAtStageIndex?: number;
    wait?: PipelineWorkflowWait;
  } = {},
) {
  const instrumentedStore = instrumentDispatchLog(store, dispatchLog);

  let branchRunCounter = 0;
  const dispatch: PipelineWorkflowDispatch = async (steps) => {
    const step = steps[0] as unknown as { stageIndex: number; branchKey?: string };
    const branchKey = step.branchKey ?? "default";
    if (step.stageIndex === 0) {
      return { ok: true, entryRunId: "run-intent", invocationId: "inv-intent" };
    }
    const shouldFail =
      options.failAtStageIndex === step.stageIndex &&
      options.failBranchIndex !== undefined &&
      branchKey === FAN_OUT_BRANCH_KEYS[options.failBranchIndex];
    if (shouldFail) {
      return { ok: false, code: "worktree_claimed", message: "claimed" };
    }
    branchRunCounter += 1;
    return {
      ok: true,
      entryRunId: `run-${branchKey}-${step.stageIndex}-${branchRunCounter}`,
      invocationId: `inv-${branchRunCounter}`,
    };
  };

  return {
    store: instrumentedStore,
    dispatch,
    wait: options.wait ?? (async () => "completed" as const),
    resolveStage: fanOutResolveStageStub({
      ...(options.failBranchIndex !== undefined ? { failBranchIndex: options.failBranchIndex } : {}),
      ...(options.failAtStageIndex !== undefined ? { failAtStageIndex: options.failAtStageIndex } : {}),
    }),
  };
}

/**
 * Synthesizes a run record for any dynamically-dispatched `run-<branch>-<stageIndex>-<counter>`
 * entry run so concurrent dispatch ordering never has to predict the exact counter value a
 * fixture's `runs` map would otherwise need to pre-populate.
 */
function withSyntheticPlanRunRecords(store: StateStore): StateStore {
  return {
    ...store,
    loadRun: (runId: string) => {
      const existing = store.loadRun(runId);
      if (existing) return existing;
      const match = /^run-(alpha|beta)-(\d+)-\d+$/.exec(runId);
      if (!match) return null;
      const [, branchKey, stageIndexRaw] = match;
      const stageName = stageIndexRaw === "1" ? "plan" : "implement";
      return { id: runId, attempts: [], specPath: `spec/${branchKey}/${stageName}.md` } as unknown as ReturnType<
        StateStore["loadRun"]
      >;
    },
  } as StateStore;
}

function fanOutSuffixRowSeedPipeline(
  definition: PipelineDefinition,
  rowStatuses: Record<string, Partial<PipelineStageRecord>>,
): Pipeline & { stages: PipelineStageRecord[] } {
  const stages: PipelineStageRecord[] = [
    {
      id: "r-intent",
      pipelineId: PIPELINE_ID,
      stageId: "intent",
      branchKey: "default",
      position: 0,
      status: "succeeded",
      workflowInvocationId: "inv-intent",
      startedAt: null,
      endedAt: null,
      artifact: {
        entryRunId: "run-intent",
        specPath: "ready-intents",
        downstreamInputs: [...FAN_OUT_DOWNSTREAM],
      },
      failureDetail: null,
      decidedAt: null,
    },
  ];

  for (const [stageId, position] of definition.stages
    .map((stage, index) => [stage.stageId, index] as const)
    .filter(([, index]) => index > 0)) {
    for (const branchKey of ["default", ...FAN_OUT_BRANCH_KEYS] as const) {
      const patch =
        branchKey === "default" ? { status: "skipped" as const } : (rowStatuses[`${stageId}/${branchKey}`] ?? {});
      stages.push({
        id: `r-${stageId}-${branchKey}`,
        pipelineId: PIPELINE_ID,
        stageId,
        branchKey,
        position,
        status: patch.status ?? "pending",
        workflowInvocationId: patch.workflowInvocationId ?? null,
        startedAt: patch.startedAt ?? null,
        endedAt: patch.endedAt ?? null,
        artifact: patch.artifact ?? null,
        failureDetail: patch.failureDetail ?? null,
        decidedAt: patch.decidedAt ?? null,
      });
    }
  }

  return {
    id: PIPELINE_ID,
    name: definition.name,
    createdAt: 0,
    ownerIdentity: null,
    status: "active",
    definition,
    context: null,
    terminalPublicationFailure: null,
    terminalPublicationSucceededAt: null,
    dismissedAt: null,
    stages,
  };
}

describe("derivePipelineState fan-out suffix settlement-first", () => {
  test("failed-plus-running fan-out rows derive running", () => {
    const pipeline = fanOutSuffixRowSeedPipeline(FAN_OUT_LINEAR_DEFINITION, {
      "plan/alpha": { status: "failed", endedAt: 1 },
      "plan/beta": { status: "running", workflowInvocationId: "run-beta-plan" },
    });

    // @mutate v2/src/daemon/pipeline-execution.ts "if (aggregation.anyRunning) return \"running\";" -> "if (false) return \"running\";"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (aggregation.anyFailed) return \"failed\";" -> "if (aggregation.anyFailed) return \"failed\"; if (false) return \"running\";"
    expect(derivePipelineState(pipeline)).toBe("running");
  });

  test("rejected-plus-running fan-out rows derive running", () => {
    const pipeline = fanOutSuffixRowSeedPipeline(FAN_OUT_PIPELINE_DEFINITION, {
      "gate/alpha": { status: "rejected", endedAt: 1 },
      "gate/beta": { status: "approved" },
      "plan/beta": { status: "running", workflowInvocationId: "run-beta-plan" },
    });

    // @mutate v2/src/daemon/pipeline-execution.ts "if (aggregation.anyRunning) return \"running\";" -> "if (false) return \"running\";"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (aggregation.anyRejected) return \"rejected\";" -> "if (aggregation.anyRejected) return \"rejected\"; if (false) return \"running\";"
    expect(derivePipelineState(pipeline)).toBe("running");
  });

  test("all-settled fan-out rows with at least one failure derive failed", () => {
    const pipeline = fanOutSuffixRowSeedPipeline(FAN_OUT_LINEAR_DEFINITION, {
      "plan/alpha": { status: "failed", endedAt: 1 },
      "plan/beta": { status: "succeeded", endedAt: 2 },
      "implement/alpha": { status: "skipped" },
      "implement/beta": { status: "succeeded", endedAt: 3 },
    });

    // @mutate v2/src/daemon/pipeline-execution.ts "if (aggregation.anyFailed) return \"failed\";" -> "if (false) return \"failed\";"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (record.status === \"pending\") {" -> "if (false && record.status === \"pending\") {"
    expect(derivePipelineState(pipeline)).toBe("failed");
  });

  test("failed branch with earlier reachable pending derives failed once siblings settle", () => {
    const pipeline = fanOutSuffixRowSeedPipeline(FAN_OUT_LINEAR_DEFINITION, {
      "plan/alpha": {},
      "implement/alpha": { status: "failed", endedAt: 1 },
      "plan/beta": { status: "succeeded", endedAt: 2 },
      "implement/beta": { status: "succeeded", endedAt: 3 },
    });

    // @mutate v2/src/daemon/pipeline-execution.ts "if (!(anyRejected || anyFailed)) {" -> "if (false) {"
    expect(derivePipelineState(pipeline)).toBe("failed");
  });

  test("failed branch plus sibling with approved gate and pending workflow derives pending", () => {
    const pipeline = fanOutSuffixRowSeedPipeline(FAN_OUT_PIPELINE_DEFINITION, {
      "plan/alpha": { status: "failed", endedAt: 1 },
      "gate/beta": { status: "approved" },
      "plan/beta": {},
    });

    // @mutate v2/src/daemon/pipeline-execution.ts "if (aggregation.anyActionablePending) return \"pending\";" -> "if (false) return \"pending\";"
    // @mutate v2/src/daemon/pipeline-execution.ts "if (record.status === \"pending\") {" -> "if (false && record.status === \"pending\") {"
    expect(derivePipelineState(pipeline)).toBe("pending");
  });
});

describe("pipeline branch fan-out execution", () => {
  test("after fan-out admission, default rows do not dispatch plan or implement while per-branch rows exist", async () => {
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
      "run-alpha-1-1": { specPath: "spec/alpha/plan.md" },
      "run-beta-1-2": { specPath: "spec/beta/plan.md" },
      "run-alpha-2-3": { specPath: "spec/alpha/implement.md" },
      "run-beta-2-4": { specPath: "spec/beta/implement.md" },
    });
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const deps = fanOutPipelineDeps(store, dispatchLog);

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });

    expect(dispatchLog.filter((entry) => entry.stageId === "plan" && entry.branchKey === "default")).toEqual([]);
    expect(dispatchLog.filter((entry) => entry.stageId === "implement" && entry.branchKey === "default")).toEqual([]);
    expect(stageRecord(stages(), "plan", "default")?.status).toBe("skipped");
    expect(stageRecord(stages(), "implement", "default")?.status).toBe("skipped");
    expect(
      dispatchLog
        .filter((entry) => entry.stageId === "plan")
        .map((entry) => entry.branchKey)
        .sort(),
    ).toEqual(["alpha", "beta"]);
    expect(!dispatchLog.some((entry) => entry.stageId === "plan" && entry.branchKey === "default")).toBe(true);
  });

  // Guard checkpoint: in runPipeline, assign `suffixBranchKeys = activeSplit.branchKeys` (drop
  // continuationBranchKey scoping) and remove the `branchSuffixPredecessorsSatisfied` skip in
  // `advanceFanOutStageResolution` — this test must go RED.
  test("approve-intent continuation dispatches only the approved branchKey", async () => {
    const { store, stages } = fakeStore(FAN_OUT_PIPELINE_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
      "run-beta-2-1": { specPath: "spec/beta/plan.md" },
      "run-beta-3-2": { specPath: "spec/beta/implement.md" },
    });
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const deps = fanOutPipelineDeps(store, dispatchLog);

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    expect(stageRecord(stages(), "gate", "alpha")?.status).toBe("awaiting");
    expect(stageRecord(stages(), "gate", "beta")?.status).toBe("awaiting");
    expect(dispatchLog.filter((entry) => entry.stageId === "plan")).toEqual([]);

    const approveBeta = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", deps, "beta");
    expect(approveBeta.kind).toBe("applied");
    await flushBackgroundRuns();

    expect(stageRecord(stages(), "gate", "alpha")?.status).toBe("awaiting");
    expect(stageRecord(stages(), "gate", "beta")?.status).toBe("approved");
    expect(stageRecord(stages(), "plan", "beta")?.status).toBe("succeeded");
    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("pending");
    expect(dispatchLog.filter((entry) => entry.stageId === "plan")).toEqual([{ stageId: "plan", branchKey: "beta" }]);
    expect(stageRecord(stages(), "plan", "alpha")?.status).not.toBe("running");
    expect(stageRecord(stages(), "implement", "alpha")?.status).toBe("pending");
  });

  test("approving both fan-out branches dispatches each successor on its own branchKey", async () => {
    const { store, stages } = fakeStore(FAN_OUT_PIPELINE_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
      "run-beta-2-1": { specPath: "spec/beta/plan.md" },
      "run-beta-3-2": { specPath: "spec/beta/implement.md" },
      "run-alpha-2-3": { specPath: "spec/alpha/plan.md" },
      "run-alpha-3-4": { specPath: "spec/alpha/implement.md" },
    });
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const deps = fanOutPipelineDeps(store, dispatchLog);

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });

    const approveBeta = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", deps, "beta");
    expect(approveBeta.kind).toBe("applied");
    await flushBackgroundRuns();

    expect(dispatchLog.filter((entry) => entry.stageId === "plan")).toEqual([{ stageId: "plan", branchKey: "beta" }]);
    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("pending");
    expect(stageRecord(stages(), "plan", "beta")?.status).toBe("succeeded");

    const approveAlpha = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", deps, "alpha");
    expect(approveAlpha.kind).toBe("applied");
    await flushBackgroundRuns();

    expect(
      dispatchLog.filter((entry) => entry.stageId === "plan").sort((a, b) => a.branchKey.localeCompare(b.branchKey)),
    ).toEqual([
      { stageId: "plan", branchKey: "alpha" },
      { stageId: "plan", branchKey: "beta" },
    ]);
    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("succeeded");
    expect(stageRecord(stages(), "implement", "alpha")?.status).toBe("succeeded");
    expect(stageRecord(stages(), "implement", "beta")?.status).toBe("succeeded");
  });

  test("pipeline approve and reject stay isolated per branchKey", async () => {
    const { store, stages } = fakeStore(FAN_OUT_PIPELINE_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
      "run-alpha-2-1": { specPath: "spec/alpha/plan.md" },
      "run-beta-2-2": { specPath: "spec/beta/plan.md" },
      "run-alpha-3-2": { specPath: "spec/alpha/implement.md" },
      "run-beta-3-4": { specPath: "spec/beta/implement.md" },
    });
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const deps = fanOutPipelineDeps(store, dispatchLog);

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    expect(stageRecord(stages(), "gate", "alpha")?.status).toBe("awaiting");
    expect(stageRecord(stages(), "gate", "beta")?.status).toBe("awaiting");

    const missingBranch = commitPipelineApprovalDecision({
      store,
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      decision: "approved",
    });
    expect(missingBranch).toEqual({
      kind: "refused",
      pipelineId: PIPELINE_ID,
      stageId: "gate",
      reason: "branch_key_required",
    });

    const approveAlpha = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", deps, "alpha");
    expect(approveAlpha.kind).toBe("applied");
    await flushBackgroundRuns();

    expect(stageRecord(stages(), "gate", "alpha")?.status).toBe("approved");
    expect(stageRecord(stages(), "gate", "beta")?.status).toBe("awaiting");
    expect(stageRecord(stages(), "implement", "alpha")?.status).toBe("succeeded");
    expect(stageRecord(stages(), "implement", "beta")?.status).toBe("pending");
    expect(!approvalGateBlocksProgress(stageRecord(stages(), "gate", "beta")?.status ?? "")).toBe(false);
  });

  test("mixed branch failure and success names the failed branchKey while the sibling still reaches terminal success", async () => {
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
      "run-beta-1-1": { specPath: "spec/beta/plan.md" },
      "run-beta-2-2": { specPath: "spec/beta/implement.md" },
    });
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const deps = fanOutPipelineDeps(store, dispatchLog, { failBranchIndex: 0, failAtStageIndex: 1 });

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("failed");
    expect(derivePipelineFailureDetail(pipeline)).toEqual({
      branchKeys: ["alpha"],
      message: "failed branches: alpha",
    });
    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("failed");
    expect(stageRecord(stages(), "implement", "beta")?.status).toBe("succeeded");
    expect(derivePipelineState(pipeline) === "succeeded").toBe(false);
    expect(derivePipelineFailureDetail(pipeline)?.branchKeys.includes("alpha")).toBe(true);
  });

  test("mixed branch rejection and success names the rejected branchKey without aborting the sibling", async () => {
    const { store, stages } = fakeStore(FAN_OUT_PIPELINE_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
      "run-beta-2-1": { specPath: "spec/beta/plan.md" },
      "run-beta-3-2": { specPath: "spec/beta/implement.md" },
    });
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const deps = fanOutPipelineDeps(store, dispatchLog);

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    const rejectAlpha = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "rejected", deps, "alpha");
    expect(rejectAlpha.kind).toBe("applied");
    const approveBeta = applyPipelineApprovalDecision(PIPELINE_ID, "gate", "approved", deps, "beta");
    expect(approveBeta.kind).toBe("applied");
    await flushBackgroundRuns();

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("rejected");
    expect(derivePipelineFailureDetail(pipeline)).toEqual({
      branchKeys: ["alpha"],
      message: "rejected branches: alpha",
    });
    expect(stageRecord(stages(), "implement", "beta")?.status).toBe("succeeded");
    expect(stageRecord(stages(), "implement", "alpha")?.status).toBe("pending");
    expect(derivePipelineState(pipeline) === "succeeded").toBe(false);
  });

  test("branch plan artifacts coexist and resolve independently per branchKey", async () => {
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
      "run-alpha-1-1": { specPath: "spec/alpha/plan.md" },
      "run-beta-1-2": { specPath: "spec/beta/plan.md" },
      "run-alpha-2-3": { specPath: "spec/alpha/implement.md" },
      "run-beta-2-4": { specPath: "spec/beta/implement.md" },
    });
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const deps = fanOutPipelineDeps(store, dispatchLog);

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });

    const alphaArtifact = stageRecord(stages(), "plan", "alpha")?.artifact as PipelineStageArtifact | null;
    const betaArtifact = stageRecord(stages(), "plan", "beta")?.artifact as PipelineStageArtifact | null;
    expect(alphaArtifact?.specPath).toBe("spec/alpha/plan.md");
    expect(betaArtifact?.specPath).toBe("spec/beta/plan.md");
    expect(alphaArtifact?.specPath).not.toBe(betaArtifact?.specPath);
    expect(stageRecord(stages(), "implement", "alpha")?.status).toBe("succeeded");
    expect(stageRecord(stages(), "implement", "beta")?.status).toBe("succeeded");
  });

  test("live-linked running stage row is not terminalized while its entry run is still live", async () => {
    const alphaStartedAt = 1_700_000_000_000;
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, FAN_OUT_ALPHA_RUNNING_RUNS);
    setupFanOutAlphaLiveLinked(store, {
      status: "running",
      workflowInvocationId: "run-alpha-running",
      startedAt: alphaStartedAt,
    });
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const alphaWait = deferred<RunStatus>();
    const deps = fanOutPipelineDeps(store, dispatchLog, {
      wait: async (entryRunId) => {
        if (entryRunId === "run-alpha-running") return alphaWait.promise;
        return "completed";
      },
    });

    const donePromise = runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    await flushBackgroundRuns();

    const alpha = stageRecord(stages(), "plan", "alpha");
    expect(alpha?.status).toBe("running");
    expect(alpha?.workflowInvocationId).toBe("run-alpha-running");
    expect(alpha?.startedAt).toBe(alphaStartedAt);
    expect(alpha?.endedAt).toBeNull();
    expect(alpha?.failureDetail).toBeNull();
    // @mutate v2/src/daemon/pipeline-execution.ts "if (entryRunId != null && isLiveEntryRun(store, entryRunId)) return entryRunId;" -> "if (false) return entryRunId;"

    alphaWait.resolve("completed");
    await donePromise;
    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("succeeded");
  });

  test("re-entry skips already-running fan-out branch rows without re-dispatch", async () => {
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, FAN_OUT_ALPHA_RUNNING_RUNS);
    setupFanOutAlphaLiveLinked(store);
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const deps = fanOutPipelineDeps(store, dispatchLog);

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    await flushBackgroundRuns();

    expect(dispatchLog.filter((entry) => entry.stageId === "plan" && entry.branchKey === "alpha")).toEqual([]);
    expect(dispatchLog.filter((entry) => entry.stageId === "plan" && entry.branchKey === "beta")).toEqual([
      { stageId: "plan", branchKey: "beta" },
    ]);
    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("succeeded");
  });

  test("running live-linked fan-out branch keeps its suffix un-skipped when adopt defers", async () => {
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, FAN_OUT_ALPHA_RUNNING_RUNS);
    setupFanOutAlphaLiveLinked(store);
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    // Non-completed rollup over the still-live alpha entry run makes adopt DEFER settlement,
    // so the alpha plan row stays running+linked when settleFanOutBranch runs. Its
    // `status === "running"` guard must keep the alpha implement suffix un-skipped; the
    // `=== "running"` operator flip would skip the suffix of a still-running branch.
    const deps = fanOutPipelineDeps(store, dispatchLog, {
      wait: async (entryRunId) => (entryRunId === "run-alpha-running" ? "in-progress" : "completed"),
    });

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    await flushBackgroundRuns();

    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("running");
    expect(stageRecord(stages(), "implement", "alpha")?.status).not.toBe("skipped");
  });

  test("fan-out re-entry with deferred-settlement admitted entry run does not terminalize until the run settles", async () => {
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, FAN_OUT_ALPHA_RUNNING_RUNS);
    setupFanOutAlphaLiveLinked(store);
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const alphaWait = deferred<RunStatus>();
    const deps = fanOutPipelineDeps(store, dispatchLog, {
      wait: async (entryRunId) => {
        if (entryRunId === "run-alpha-running") return alphaWait.promise;
        return "completed";
      },
    });

    const donePromise = runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    await flushBackgroundRuns();

    const alphaBeforeSettle = stageRecord(stages(), "plan", "alpha");
    expect(alphaBeforeSettle?.status).toBe("running");
    expect(alphaBeforeSettle?.workflowInvocationId).toBe("run-alpha-running");
    expect(alphaBeforeSettle?.endedAt).toBeNull();

    alphaWait.resolve("completed");
    await donePromise;
    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("succeeded");

    const { store: refusedStore, stages: refusedStages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
      "run-beta-1-1": { specPath: "spec/beta/plan.md" },
      "run-beta-2-2": { specPath: "spec/beta/implement.md" },
    });
    const refusedDispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    await runPipeline(PIPELINE_ID, {
      ...fanOutPipelineDeps(refusedStore, refusedDispatchLog, { failBranchIndex: 0, failAtStageIndex: 1 }),
      context: baseContext,
    });
    const refusedAlpha = stageRecord(refusedStages(), "plan", "alpha");
    expect(refusedAlpha?.status).toBe("failed");
    expect(refusedAlpha?.workflowInvocationId).toBeNull();
  });

  test("duplicate downstreamInputs branchKey fails admission", async () => {
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, {
      "run-intent": {
        specPath: "ready-intents",
        downstreamInputs: ["ready-intents/alpha.md", "subdir/alpha.md"],
      },
    });
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const deps = fanOutPipelineDeps(store, dispatchLog);

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });

    const intent = stageRecord(stages(), "intent");
    expect(intent?.status).toBe("failed");
    expect((intent?.failureDetail as { message: string } | null)?.message).toContain('duplicate branchKey "alpha"');
    expect(dispatchLog.filter((entry) => entry.stageId === "plan")).toEqual([]);
  });

  test("reopens a failed fan-out branch without malformed_continuation from reconciled default rows", async () => {
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
      "run-beta-1-1": { specPath: "spec/beta/plan.md" },
      "run-beta-2-2": { specPath: "spec/beta/implement.md" },
    });
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const deps = fanOutPipelineDeps(store, dispatchLog, { failBranchIndex: 0, failAtStageIndex: 1 });

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("failed");

    const reopen = store.reopenFailedPipeline({ pipelineId: PIPELINE_ID });
    expect(reopen.kind).toBe("applied");
    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("pending");
    expect(stageRecord(stages(), "implement", "alpha")?.status).toBe("pending");
    expect(stageRecord(stages(), "implement", "beta")?.status).toBe("succeeded");
  });

  test("fan-out with terminalAction fails closed instead of reporting succeeded", async () => {
    const definition: PipelineDefinition = { ...FAN_OUT_LINEAR_DEFINITION, terminalAction: "ready" };
    const { store, stages } = fakeStore(definition, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
      "run-alpha-1-1": { specPath: "spec/alpha/plan.md" },
      "run-beta-1-2": { specPath: "spec/beta/plan.md" },
      "run-alpha-2-3": {
        specRef: "main",
        worktreePath: "/alpha",
        branch: "alpha-branch",
        specPath: "spec/alpha/implement.md",
        prNumber: 1,
        prUrl: "https://example/pr/1",
      },
      "run-beta-2-4": {
        specRef: "main",
        worktreePath: "/beta",
        branch: "beta-branch",
        specPath: "spec/beta/implement.md",
        prNumber: 2,
        prUrl: "https://example/pr/2",
      },
    });
    const executeTerminalPublication = async () => {
      throw new Error("terminal publication should not run for fan-out");
    };
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const deps = {
      ...fanOutPipelineDeps(store, dispatchLog),
      executeTerminalPublication,
    };

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(stageRecord(stages(), "implement", "alpha")?.status).toBe("succeeded");
    expect(stageRecord(stages(), "implement", "beta")?.status).toBe("succeeded");
    expect(derivePipelineState(pipeline)).toBe("failed");
    expect(pipeline.terminalPublicationFailure?.failure.message).toContain("multi-branch terminal publication");
    expect(pipeline.terminalPublicationSucceededAt).toBeNull();
  });

  test("linear fan-out sibling plan stages reach running concurrently without worktree_claimed false positive", async () => {
    const { store: rawStore, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
    });
    const store = withSyntheticPlanRunRecords(rawStore);
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const alphaPlanWait = deferred<RunStatus>();
    const deps = fanOutPipelineDeps(store, dispatchLog, {
      wait: async (entryRunId) => (entryRunId.startsWith("run-alpha-1-") ? alphaPlanWait.promise : "completed"),
    });

    const donePromise = runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    await flushBackgroundRuns();

    // The alpha branch's plan dispatch is stuck awaiting its deferred entry-run wait; the beta
    // sibling's own plan dispatch must not be blocked behind it.
    expect(dispatchLog.some((entry) => entry.stageId === "plan" && entry.branchKey === "beta")).toBe(true);
    const alpha = stageRecord(stages(), "plan", "alpha");
    expect(alpha?.status).toBe("running");
    expect(alpha?.failureDetail).toBeNull();
    expect((alpha?.failureDetail as { code?: string } | null)?.code).not.toBe("worktree_claimed");
    const beta = stageRecord(stages(), "plan", "beta");
    expect(beta?.status).not.toBe("failed");
    expect((beta?.failureDetail as { code?: string } | null)?.code).not.toBe("worktree_claimed");
    // @mutate v2/src/daemon/pipeline-execution.ts "const branchOutcomes = await runConcurrently(branchDispatchTasks);" -> "const branchOutcomes = []; for (const task of branchDispatchTasks) branchOutcomes.push(await task());"

    alphaPlanWait.resolve("completed");
    await donePromise;

    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("succeeded");
    expect(stageRecord(stages(), "plan", "beta")?.status).toBe("succeeded");
    expect(stageRecord(stages(), "implement", "alpha")?.status).toBe("succeeded");
    expect(stageRecord(stages(), "implement", "beta")?.status).toBe("succeeded");
  });

  test("linear fan-out sibling suffix stages dispatch concurrently", async () => {
    const { store: rawStore, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
    });
    const store = withSyntheticPlanRunRecords(rawStore);
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const alphaImplementWait = deferred<RunStatus>();
    const deps = fanOutPipelineDeps(store, dispatchLog, {
      wait: async (entryRunId) => (entryRunId.startsWith("run-alpha-2-") ? alphaImplementWait.promise : "completed"),
    });

    const donePromise = runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    await flushBackgroundRuns();

    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("succeeded");
    expect(stageRecord(stages(), "plan", "beta")?.status).toBe("succeeded");
    const alphaImplement = stageRecord(stages(), "implement", "alpha");
    expect(alphaImplement?.status).toBe("running");
    // Alpha's implement dispatch is stuck awaiting its deferred entry-run wait; the beta
    // sibling's own suffix walk must not be blocked behind it.
    expect(dispatchLog.some((entry) => entry.stageId === "implement" && entry.branchKey === "beta")).toBe(true);
    // @mutate v2/src/daemon/pipeline-execution.ts "await runConcurrently(suffixDispatchTasks);" -> "for (const task of suffixDispatchTasks) await task();"

    alphaImplementWait.resolve("completed");
    await donePromise;

    expect(stageRecord(stages(), "implement", "alpha")?.status).toBe("succeeded");
    expect(stageRecord(stages(), "implement", "beta")?.status).toBe("succeeded");
  });

  function setupFanOutAlphaPlanStatus(store: StateStore, status: "succeeded" | "failed" | "skipped"): void {
    const alphaPlanPatch: Record<string, unknown> =
      status === "succeeded"
        ? {
            status: "succeeded",
            endedAt: Date.now(),
            artifact: { entryRunId: "run-alpha-preexisting", specPath: "spec/alpha/plan.md" },
          }
        : status === "failed"
          ? { status: "failed", endedAt: Date.now(), failureDetail: { message: "prior failure" } }
          : { status: "skipped" };
    setupFanOutAlphaLiveLinked(store, alphaPlanPatch);
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "implement",
      branchKey: "alpha",
      patch: { status: "skipped" },
    });
  }

  test.each([
    "succeeded",
    "failed",
    "skipped",
  ] as const)("a still-pending peer is dispatched when the dispatching branch's own fan-out row is already %s", async (alphaStatus) => {
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
    });
    setupFanOutAlphaPlanStatus(store, alphaStatus);
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const deps = fanOutPipelineDeps(store, dispatchLog);

    await runPipeline(PIPELINE_ID, { ...deps, context: baseContext });
    await flushBackgroundRuns();

    expect(dispatchLog.some((entry) => entry.stageId === "plan" && entry.branchKey === "beta")).toBe(true);
    expect(stageRecord(stages(), "plan", "beta")?.status).not.toBe("pending");
  });

  test("exactly one terminal write settles a peer row whose entry run is live at dispatch time", async () => {
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, FAN_OUT_ALPHA_RUNNING_RUNS);
    setupFanOutAlphaLiveLinked(store);
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const alphaWait = deferred<RunStatus>();
    const deps = fanOutPipelineDeps(store, dispatchLog, {
      wait: async (entryRunId) => (entryRunId === "run-alpha-running" ? alphaWait.promise : "completed"),
    });
    let terminalWritesForAlphaPlan = 0;
    const countingStore = {
      ...deps.store,
      updateStage: (args: { stageId: string; branchKey?: string; patch: Record<string, unknown> }) => {
        if (
          args.stageId === "plan" &&
          (args.branchKey ?? "default") === "alpha" &&
          (args.patch.status === "succeeded" || args.patch.status === "failed")
        ) {
          terminalWritesForAlphaPlan += 1;
        }
        return deps.store.updateStage(args as Parameters<StateStore["updateStage"]>[0]);
      },
    } as StateStore;

    const donePromise = runPipeline(PIPELINE_ID, { ...deps, store: countingStore, context: baseContext });
    await flushBackgroundRuns();
    alphaWait.resolve("completed");
    await donePromise;

    expect(terminalWritesForAlphaPlan).toBe(1);
    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("succeeded");
  });

  test("two sibling branch failures both surface and no stage row is written once the pipeline walk settles", async () => {
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
    });
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const instrumentedStore = instrumentDispatchLog(store, dispatchLog);
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      const step = steps[0] as unknown as { stageIndex: number; branchKey?: string };
      if (step.stageIndex === 0) return { ok: true, entryRunId: "run-intent", invocationId: "inv-intent" };
      return { ok: false, code: "worktree_claimed", message: `claimed for ${step.branchKey}` };
    };
    const deps: PipelineExecutionDeps = {
      store: instrumentedStore,
      dispatch,
      wait: async () => "completed" as const,
      resolveStage: fanOutResolveStageStub(),
      context: baseContext,
    };

    await runPipeline(PIPELINE_ID, deps);
    await flushBackgroundRuns();

    const pipeline = store.loadPipeline(PIPELINE_ID);
    if (!pipeline) throw new Error("expected pipeline");
    expect(derivePipelineState(pipeline)).toBe("failed");
    expect(derivePipelineFailureDetail(pipeline)?.branchKeys.slice().sort()).toEqual(["alpha", "beta"]);
    expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("failed");
    expect(stageRecord(stages(), "plan", "beta")?.status).toBe("failed");

    const snapshotAfterDone = JSON.stringify(stages());
    await flushBackgroundRuns(3);
    expect(JSON.stringify(stages())).toBe(snapshotAfterDone);
  });

  test("a losing branch's wait on a peer's fan-out claim yields to the macrotask queue and is bounded, settling a named failure when the peer never advances", async () => {
    const { store, stages } = fakeStore(FAN_OUT_LINEAR_DEFINITION, {
      "run-intent": { specPath: "ready-intents", downstreamInputs: [...FAN_OUT_DOWNSTREAM] },
    });
    const dispatchLog: Array<{ stageId: string; branchKey: string }> = [];
    const baseDeps = fanOutPipelineDeps(store, dispatchLog);
    const deps: PipelineExecutionDeps = {
      ...baseDeps,
      context: baseContext,
      peerClaimTimeoutMs: 20,
      dispatch: async (steps) => {
        const step = steps[0] as unknown as { stageIndex: number; branchKey?: string };
        if (step.stageIndex === 1 && step.branchKey === "beta") {
          // Beta's own dispatch never resolves. Alpha always wins the claim race (first in
          // branch-key order) and never finishes dispatching every admitted branch, so its
          // claim never releases — beta's own suffix walk must not wait on it forever.
          return new Promise<never>(() => {});
        }
        return baseDeps.dispatch(steps);
      },
    };

    let macrotaskFired = false;
    setTimeout(() => {
      macrotaskFired = true;
    }, 0);
    let macrotaskFiredWhilePeerStillPending = false;

    void runPipeline(PIPELINE_ID, deps);

    const deadline = Date.now() + 2000;
    while (stageRecord(stages(), "plan", "beta")?.status !== "failed" && Date.now() < deadline) {
      // The 0ms timer armed above fires while alpha's claim is still outstanding — proof the
      // cross-branch wait yields to the macrotask queue rather than busy-spinning the event loop.
      if (macrotaskFired) macrotaskFiredWhilePeerStillPending = true;
      await flushBackgroundRuns();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(macrotaskFiredWhilePeerStillPending).toBe(true);
    const beta = stageRecord(stages(), "plan", "beta");
    expect(beta?.status).toBe("failed");
    expect((beta?.failureDetail as { message?: string } | null)?.message).toContain("timed out");
    expect(stageRecord(stages(), "implement", "beta")?.status).toBe("skipped");
  });
});

describe("reopened pipeline continuation", () => {
  test("reconstructs failed-plan reset policy after a lost resume claim", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(
      definition,
      { "run-plan": { specPath: "spec/plan" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "intent", patch: { status: "succeeded" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "plan", patch: { status: "failed" } });
    const claimRefusal = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "claimPipelineContinuation") {
          return () => ({ kind: "refused" as const, reason: "claimed" });
        }
        return Reflect.get(target, property, receiver);
      },
    }) as StateStore;
    const initial = await resumePipeline(PIPELINE_ID, {
      ...pipelineTestDeps(claimRefusal, []),
    });

    expect(initial).toEqual({ kind: "refused", pipelineId: PIPELINE_ID, reason: "claim_refused" });
    expect(stageRecord(stages(), "plan")?.failureDetail).toMatchObject({
      code: "pipeline_reopened_stage_reset",
      stageId: "plan",
      branchKey: "default",
      flags: { skipDirtyWorktreeGate: true, skipLandedCriteriaGate: false },
    });

    let resetFlags: unknown;
    const resumed = await continuePipeline(PIPELINE_ID, {
      store,
      dispatch: async () => ({ ok: true, entryRunId: "run-plan", invocationId: "inv-plan" }),
      wait: async () => "completed",
      resolveStage: async (_definition, index, _context, _artifacts, deps) => {
        resetFlags = deps?.staleReset?.flags;
        return {
          ok: true,
          steps: [createMinimalDispatchWriteStep({ stageIndex: index })],
        };
      },
      staleResetPreflight: noopStaleResetPreflightBundle(),
    });

    expect(resumed).toEqual({ kind: "continued", pipelineId: PIPELINE_ID });
    expect(resetFlags).toEqual({ skipDirtyWorktreeGate: true, skipLandedCriteriaGate: false });
    expect(stageRecord(stages(), "plan")?.status).toBe("succeeded");
  });

  test("reconstructs failed-plan reset policy after daemon restart continuation", async () => {
    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
    const { store, stages } = fakeStore(
      definition,
      { "run-plan": { specPath: "spec/plan" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "intent", patch: { status: "succeeded" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "plan", patch: { status: "failed" } });
    const reopen = store.reopenFailedPipeline({ pipelineId: PIPELINE_ID });
    expect(reopen.kind).toBe("applied");
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "plan",
      patch: {
        failureDetail: {
          code: "pipeline_reopened_stage_reset",
          stageId: "plan",
          branchKey: "default",
          flags: { skipDirtyWorktreeGate: true, skipLandedCriteriaGate: false },
        },
      },
    });

    let resetFlags: unknown;
    const { continued } = await recoverContinuablePipelines(
      store,
      {
        store,
        dispatch: async () => ({ ok: true, entryRunId: "run-plan", invocationId: "inv-plan" }),
        wait: async () => "completed",
        resolveStage: async (_definition, index, _context, _artifacts, deps) => {
          resetFlags = deps?.staleReset?.flags;
          return {
            ok: true,
            steps: [createMinimalDispatchWriteStep({ stageIndex: index })],
          };
        },
        staleResetPreflight: noopStaleResetPreflightBundle(),
      },
      async () => false,
    );

    expect(continued).toBe(1);
    expect(resetFlags).toEqual({ skipDirtyWorktreeGate: true, skipLandedCriteriaGate: false });
    expect(stageRecord(stages(), "plan")?.status).toBe("succeeded");
  });
});

describe("pipeline workflow-stage stale-reset preflight", () => {
  let tmp: string;
  let projectRoot: string;
  let jarvisRoot: string;
  const intentBranch = "intent/improve-api";
  const planBranch = "plan/improve-api";
  const implementBranch = "implement/improve-api";
  const readyIntentRel = "spec/ready-intents/feature.md";
  const readyIntentContent = "---\nname: feature\n---\n\n## Prerequisites\n\n- none\n";

  function staleResetBundle(
    rpc: { client: ReturnType<typeof makeIpcClient> },
    io: Io = { stdout: () => {}, stderr: () => {} },
  ) {
    return {
      cliDeps: { jarvisRoot, subprocessRunner: realAsyncSubprocessRunner } as unknown as CliDeps,
      io,
      connectClient: async () => rpc.client,
    };
  }

  function managedWorktree(branchName: string, baseRef: string): NonNullable<WriteWorkflowStep["worktree"]> {
    return {
      projectRoot,
      projectName: "demo",
      branchName,
      baseRef,
      jarvisRoot,
    };
  }

  async function materializeWorktree(branchName: string, baseRef = "HEAD"): Promise<string> {
    await realAsyncSubprocessRunner.runAsync("git", ["branch", branchName, baseRef], projectRoot);
    const worktreePath = join(jarvisRoot, "worktrees", "demo", branchName);
    mkdirSync(dirname(worktreePath), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", worktreePath, branchName], projectRoot);
    return worktreePath;
  }

  async function seedIntentReadyIntent(intentWorktree: string): Promise<void> {
    mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(intentWorktree, readyIntentRel), readyIntentContent, "utf8");
    for (const downstream of FAN_OUT_DOWNSTREAM) {
      mkdirSync(dirname(join(intentWorktree, downstream)), { recursive: true });
      writeFileSync(join(intentWorktree, downstream), readyIntentContent, "utf8");
    }
    await realAsyncSubprocessRunner.runAsync("git", ["add", "-A"], intentWorktree);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-qm", "ready-intent"], intentWorktree);
  }

  function intentSteps(): AnyWorkflowStep[] {
    return [
      createWriteStep("intent", intentBranch, doneBindingFactory, {
        role: "plan",
        promptId: "intent.prompt.split",
        stepRules: DEFAULT_WRITE_STEP_RULES,
        worktree: managedWorktree(intentBranch, "HEAD"),
        specPath: "spec/ready-intents",
        expectedArtifactPath: ".jarvis-intent-stage",
        publishCompletion: false,
        landing: {
          kind: "intent-stage",
          baseRef: "HEAD",
          inputs: { sourceRoot: projectRoot, paths: [], consumeFrom: "worktree" },
          output: { durableDir: "spec/ready-intents" },
          stagingDir: ".jarvis-intent-stage",
          invocationId: "intent-invocation",
        },
      }),
    ];
  }

  function planSteps(baseRef: string, specPath = "spec/plan"): AnyWorkflowStep[] {
    return [
      createWriteStep("plan", planBranch, doneBindingFactory, {
        role: "plan",
        promptId: "plan.prompt",
        stepRules: DEFAULT_WRITE_STEP_RULES,
        worktree: managedWorktree(planBranch, baseRef),
        specPath,
        expectedArtifactPath: ".jarvis-plan-stage",
        publishCompletion: true,
        landing: {
          kind: "plan-tree",
          stagingDir: ".jarvis-plan-stage",
          durablePath: "spec/plan",
          inputs: { sourceRoot: projectRoot, paths: [readyIntentRel], consumeFrom: "worktree" },
        },
      }),
    ];
  }

  function implementReviewStep(baseRef: string): ReviewDebateWorkflowStep {
    return {
      behavior: "review-debate",
      stepId: "review",
      project: "demo",
      branch: implementBranch,
      cwd: join(jarvisRoot, "worktrees", "demo", implementBranch),
      prompts: { adversary: "review", advocate: "review", adjudicator: "review" },
      verdictPath: "spec/plan/verdict-patch.md",
      maxCycles: 1,
      agents: { adversary: ["claude"], advocate: ["claude"], adjudicator: ["claude"], actuator: ["claude"] },
      agentModelConfig: DEBATE_AGENT_MODEL_CONFIG,
      landing: {
        kind: "plan-tree",
        stagingDir: ".jarvis-plan-stage",
        durablePath: "spec/plan",
        inputs: { sourceRoot: projectRoot, paths: ["spec/plan/index.md"], consumeFrom: "worktree" },
      },
    };
  }

  function implementSteps(baseRef: string): AnyWorkflowStep[] {
    return [
      createWriteStep("implement", implementBranch, doneBindingFactory, {
        role: "implement",
        promptId: "implement.prompt",
        stepRules: DEFAULT_WRITE_STEP_RULES,
        worktree: managedWorktree(implementBranch, baseRef),
        specPath: "spec/plan/index.md",
        expectedArtifactPath: "spec/plan/index.md",
      }),
      implementReviewStep(baseRef),
    ];
  }

  function intentDefinition(): PipelineDefinition {
    return { name: "p", stages: [{ stageId: "s1", kind: "workflow", workflow: "intent", review: "none" }] };
  }

  function planChainDefinition(): PipelineDefinition {
    return {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
      ],
    };
  }

  function implementChainDefinition(): PipelineDefinition {
    return {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
  }

  function intentArtifact(): PipelineStageArtifact {
    return { entryRunId: "run-intent", specPath: readyIntentRel };
  }

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "jarvis-pipeline-stale-reset-"));
    projectRoot = join(tmp, "project");
    jarvisRoot = join(tmp, "jarvis-home");
    mkdirSync(projectRoot, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["init"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "t@t.com"], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "T"], projectRoot);
    writeFileSync(join(projectRoot, "README.md"), "seed\n", "utf8");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "Initial"], projectRoot);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function resolveStageWithFixedIntentSteps(
    definition: PipelineDefinition,
    index: number,
    context: PipelineContext,
    stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
    deps?: PipelineStageResolveDeps,
  ): Promise<PipelineStageResolutionResult> {
    return resolveStageWorkflowSteps(definition, index, context, stageArtifacts, {
      ...deps,
      builders: {
        ...WORKFLOW_PRESET_BUILDERS,
        intent: async () => ({
          ok: true as const,
          steps: intentSteps(),
          identity: {
            invocationId: "intent-invocation",
            project: "demo",
            slug: "improve-api",
            branch: intentBranch,
            seedFingerprint: "fp",
          },
        }),
      },
    });
  }

  function fixedPlanStepResolver(specPath = "spec/plan") {
    return function resolveStageWithFixedPlanSteps(
      definition: PipelineDefinition,
      index: number,
      context: PipelineContext,
      stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
      deps?: PipelineStageResolveDeps,
    ): Promise<PipelineStageResolutionResult> {
      return resolveStageWorkflowSteps(definition, index, context, stageArtifacts, {
        ...deps,
        loadRun: (runId) =>
          runId === "run-intent"
            ? { worktreePath: join(jarvisRoot, "worktrees", "demo", intentBranch), branch: intentBranch }
            : null,
        builders: {
          ...WORKFLOW_PRESET_BUILDERS,
          plan: async () => ({
            ok: true as const,
            steps: planSteps(intentBranch, specPath),
            identity: {
              invocationId: "plan-invocation",
              project: "demo",
              name: "improve-api",
              slug: "improve-api",
              branch: planBranch,
              seedFingerprint: "fp",
            },
          }),
        },
      });
    };
  }

  const resolveStageWithFixedPlanSteps = fixedPlanStepResolver();

  function resolveStageWithFixedImplementSteps(
    definition: PipelineDefinition,
    index: number,
    context: PipelineContext,
    stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
    deps?: PipelineStageResolveDeps,
  ): Promise<PipelineStageResolutionResult> {
    return resolveStageWorkflowSteps(definition, index, context, stageArtifacts, {
      ...deps,
      loadRun: (runId) => {
        if (runId === "run-intent") {
          return { worktreePath: join(jarvisRoot, "worktrees", "demo", intentBranch), branch: intentBranch };
        }
        if (runId === "run-plan") {
          return { worktreePath: join(jarvisRoot, "worktrees", "demo", planBranch), branch: planBranch };
        }
        return null;
      },
      builders: {
        ...WORKFLOW_PRESET_BUILDERS,
        implement: async () => ({
          ok: true as const,
          steps: implementSteps(planBranch),
          identity: {
            invocationId: "implement-invocation",
            project: "demo",
            slug: "improve-api",
            branch: implementBranch,
            seedFingerprint: "fp",
          },
        }),
      },
    });
  }

  function resolveFanOutPlanSteps(
    definition: PipelineDefinition,
    index: number,
    context: PipelineContext,
    stageArtifacts: ReadonlyMap<string, PipelineStageArtifact>,
    deps?: PipelineStageResolveDeps,
  ): Promise<PipelineStageResolutionResult> {
    const intentWorktree = join(jarvisRoot, "worktrees", "demo", intentBranch);
    return resolveStageWorkflowSteps(definition, index, context, stageArtifacts, {
      ...deps,
      loadRun: (runId) => (runId === "run-intent" ? { worktreePath: intentWorktree, branch: intentBranch } : null),
      builders: {
        ...WORKFLOW_PRESET_BUILDERS,
        plan: async (input) => {
          const branchKey = branchKeyFromDownstreamInput(
            "readyIntent" in input && typeof input.readyIntent === "string" ? input.readyIntent : "",
          );
          const branchName = `plan/${branchKey}`;
          return {
            ok: true as const,
            steps: [
              {
                behavior: "write",
                stepId: "plan",
                role: "plan",
                worktree: managedWorktree(branchName, intentBranch),
                specPath: "spec/plan",
              },
            ] as unknown as AnyWorkflowStep[],
            identity: {
              invocationId: `plan-${branchKey}`,
              project: "demo",
              name: branchKey,
              slug: branchKey,
              branch: branchName,
              seedFingerprint: "fp",
            },
          };
        },
      },
    });
  }

  /** An in-process daemon RPC client wired to real `list`/`check_workflow_start_claim` handlers
   * against a fresh real `StateStore` — not a loopback socket connection. */
  function daemonRpcClient(): { client: ReturnType<typeof makeIpcClient>; close: () => void } {
    const stateStore = openStateStore(join(tmp, `state-${crypto.randomUUID()}.sqlite`));
    const logsPath = join(tmp, `logs-${crypto.randomUUID()}.jsonl`);
    const handlers = createRunControlHandlers({
      stateStore,
      writeLoopExecutor: async () => {},
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      settleDelayMs: 0,
      registry: new WorktreeOwnershipRegistry(),
      logsPath,
      logReader: openLogReader(logsPath),
    });
    const client = makeIpcClient([], { gated: true, deferred: true });
    const send = client.send.bind(client);
    client.send = (frame: unknown): void => {
      send(frame);
      const request = frame as { id?: string; method?: string; params?: unknown };
      if (typeof request.id !== "string" || typeof request.method !== "string") return;
      const requestId = request.id;
      const handler = request.method === "list" ? handlers.list : handlers.check_workflow_start_claim;
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
    return {
      client,
      close: () => {
        handlers.close();
        stateStore.close();
      },
    };
  }

  // @mutate v2/src/daemon/pipeline-workflow-preparation.ts "maybeResetStaleWorkspace" -> "noopStaleReset"
  test("pipeline intent-stage re-dispatch resets a poisoned worktree before the write step", async () => {
    const worktreePath = await materializeWorktree(intentBranch);
    writeFileSync(join(worktreePath, ".jarvis-intent-review-verdict.md"), "verdict\n", "utf8");
    writeFileSync(join(worktreePath, ".jarvis-intent-review-verdict.md.owner"), "foreign-invocation\n", "utf8");

    const { store, stages } = fakeStore(
      intentDefinition(),
      { "run-s1": { specPath: "spec/ready-intents" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "failed" } });

    const rpc = daemonRpcClient();
    const dispatchOrder: number[] = [];
    const dispatch: PipelineWorkflowDispatch = async () => {
      expect(existsSync(worktreePath)).toBe(false);
      expect(existsSync(join(worktreePath, ".jarvis-intent-review-verdict.md"))).toBe(false);
      dispatchOrder.push(1);
      return { ok: true, entryRunId: "run-s1", invocationId: "inv-s1" };
    };

    try {
      const outcome = await resumePipeline(PIPELINE_ID, {
        store,
        dispatch,
        wait: async () => "completed",
        resolveStage: resolveStageWithFixedIntentSteps,
        staleResetPreflight: staleResetBundle(rpc),
      });

      expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
      expect(dispatchOrder).toEqual([1]);
      expect(stages().find((s) => s.stageId === "s1")?.status).toBe("succeeded");
      const list = await realAsyncSubprocessRunner.runAsync("git", ["worktree", "list"], projectRoot);
      expect(list).not.toContain(worktreePath);
    } finally {
      rpc.close();
    }
  });

  // @mutate v2/src/daemon/pipeline-execution.ts "if (!staleReset.ok) {" -> "if (false) {"
  test("pipeline intent-stage stale-reset refusal fails stage without dispatch", async () => {
    const worktreePath = await materializeWorktree(intentBranch);
    writeFileSync(join(worktreePath, "README.md"), "dirty\n", "utf8");

    const { store, stages } = fakeStore(
      intentDefinition(),
      {},
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "failed" } });

    const rpc = daemonRpcClient();
    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "run-s1", invocationId: "inv-s1" };
    };

    try {
      const outcome = await resumePipeline(PIPELINE_ID, {
        store,
        dispatch,
        wait: async () => "completed",
        resolveStage: resolveStageWithFixedIntentSteps,
        staleResetPreflight: staleResetBundle(rpc),
      });

      expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
      expect(dispatchCalled).toBe(false);
      const record = stages().find((s) => s.stageId === "s1");
      expect(record?.status).toBe("failed");
      expect((record?.failureDetail as { message?: string } | null)?.message).toContain(
        "Cannot re-run incomplete spec",
      );
      expect(existsSync(worktreePath)).toBe(true);
    } finally {
      rpc.close();
    }
  });

  test("whole-pipeline failed plan resume retires dirty draft and rematerializes from base before writer dispatch", async () => {
    const intentWorktree = await materializeWorktree(intentBranch);
    await seedIntentReadyIntent(intentWorktree);
    const planWorktree = await materializeWorktree(planBranch, intentBranch);
    writeFileSync(join(planWorktree, "README.md"), "dirty\n", "utf8");

    const { store, stages } = fakeStore(
      planChainDefinition(),
      {
        "run-intent": { specPath: readyIntentRel, worktreePath: intentWorktree, branch: intentBranch },
        "run-plan": { specPath: "spec/plan" },
      },
      { context: { ...persistedContext, cwd: projectRoot }, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "intent",
      patch: { status: "succeeded", artifact: intentArtifact() },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "plan", patch: { status: "failed" } });

    const rpc = daemonRpcClient();
    const dispatchOrder: string[] = [];
    const dispatch: PipelineWorkflowDispatch = async () => {
      expect(existsSync(planWorktree)).toBe(false);
      dispatchOrder.push("reset");
      await withExternalWorktree(managedWorktree(planBranch, intentBranch), async ({ path }) => {
        dispatchOrder.push("dispatch");
        expect(path).toBe(planWorktree);
        expect(existsSync(join(path, ".jarvis-plan-stage"))).toBe(false);
        const [head, base] = await Promise.all([
          realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "HEAD"], path),
          realAsyncSubprocessRunner.runAsync("git", ["rev-parse", intentBranch], projectRoot),
        ]);
        expect(head.trim()).toBe(base.trim());
      });
      return { ok: true, entryRunId: "run-plan", invocationId: "inv-plan" };
    };

    try {
      const outcome = await resumePipeline(PIPELINE_ID, {
        store,
        dispatch,
        wait: async () => "completed",
        resolveStage: resolveStageWithFixedPlanSteps,
        staleResetPreflight: staleResetBundle(rpc),
      });

      expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
      expect(dispatchOrder).toEqual(["reset", "dispatch"]);
      const record = stageRecord(stages(), "plan");
      expect(record?.status).toBe("succeeded");
      expect(existsSync(planWorktree)).toBe(true);
    } finally {
      rpc.close();
    }
  });

  test("failed plan resume fails closed when stale-reset preparation cannot connect", async () => {
    const intentWorktree = await materializeWorktree(intentBranch);
    await seedIntentReadyIntent(intentWorktree);
    const planWorktree = await materializeWorktree(planBranch, intentBranch);
    mkdirSync(join(planWorktree, ".jarvis-plan-stage"), { recursive: true });
    writeFileSync(join(planWorktree, ".jarvis-plan-stage", "draft.md"), "draft\n", { flag: "w" });
    const { store, stages } = fakeStore(
      planChainDefinition(),
      { "run-intent": { specPath: readyIntentRel, worktreePath: intentWorktree, branch: intentBranch } },
      { context: { ...persistedContext, cwd: projectRoot }, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "intent",
      patch: { status: "succeeded", artifact: intentArtifact() },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "plan", patch: { status: "failed" } });
    let dispatched = false;

    const outcome = await resumePipeline(PIPELINE_ID, {
      store,
      dispatch: async () => {
        dispatched = true;
        return { ok: true, entryRunId: "run-plan", invocationId: "inv-plan" };
      },
      wait: async () => "completed",
      resolveStage: resolveStageWithFixedPlanSteps,
      staleResetPreflight: {
        ...staleResetBundle({ client: makeIpcClient([], { gated: true, deferred: true }) }),
        connectClient: async () => {
          throw new Error("EMFILE: too many open files");
        },
      },
    });

    expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
    expect(dispatched).toBe(false);
    expect(existsSync(planWorktree)).toBe(true);
    expect((stageRecord(stages(), "plan")?.failureDetail as { message?: string } | null)?.message).toContain(
      "could not open daemon control socket",
    );
  });

  test("branch-scoped failed plan resume retires only the named dirty lane before dispatch", async () => {
    const intentWorktree = await materializeWorktree(intentBranch);
    await seedIntentReadyIntent(intentWorktree);
    const targetWorktree = await materializeWorktree(planBranch, intentBranch);
    mkdirSync(join(targetWorktree, ".jarvis-plan-stage"), { recursive: true });
    writeFileSync(join(targetWorktree, ".jarvis-plan-stage", "draft.md"), "draft\n", { flag: "w" });

    const intentArtifactWithFanOut: PipelineStageArtifact = {
      entryRunId: "run-intent",
      specPath: FAN_OUT_DOWNSTREAM[0],
      downstreamInputs: [...FAN_OUT_DOWNSTREAM],
    };
    const { store, stages } = fakeStore(
      FAN_OUT_PIPELINE_DEFINITION,
      {
        "run-intent": { specPath: "ready-intents", worktreePath: intentWorktree, branch: intentBranch },
        "run-alpha": { specPath: "spec/plan" },
      },
      { context: { ...persistedContext, cwd: projectRoot }, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "intent",
      patch: { status: "succeeded", artifact: intentArtifactWithFanOut, workflowInvocationId: "run-intent" },
    });
    for (const branchKey of FAN_OUT_BRANCH_KEYS) {
      for (const stageId of ["gate", "plan", "implement"] as const) {
        store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId, branchKey });
      }
    }
    for (const stageId of ["gate", "plan", "implement"] as const) {
      store.updateStage({ pipelineId: PIPELINE_ID, stageId, patch: { status: "skipped" } });
    }
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", branchKey: "alpha", patch: { status: "approved" } });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "plan", branchKey: "alpha", patch: { status: "failed" } });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "implement",
      branchKey: "alpha",
      patch: { status: "skipped" },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "gate", branchKey: "beta", patch: { status: "awaiting" } });

    const rpc = daemonRpcClient();
    const dispatchLog: string[] = [];
    try {
      const outcome = await resumePipeline(
        PIPELINE_ID,
        {
          store,
          dispatch: async () => {
            expect(existsSync(targetWorktree)).toBe(false);
            await withExternalWorktree(managedWorktree(planBranch, intentBranch), async ({ path }) => {
              const [head, base] = await Promise.all([
                realAsyncSubprocessRunner.runAsync("git", ["rev-parse", "HEAD"], path),
                realAsyncSubprocessRunner.runAsync("git", ["rev-parse", intentBranch], projectRoot),
              ]);
              expect(head.trim()).toBe(base.trim());
              dispatchLog.push("alpha");
            });
            return { ok: true, entryRunId: "run-alpha", invocationId: "inv-alpha" };
          },
          wait: async () => "completed",
          resolveStage: resolveStageWithFixedPlanSteps,
          staleResetPreflight: staleResetBundle(rpc),
        },
        { branchKey: "alpha" },
      );

      expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
      expect(dispatchLog).toEqual(["alpha"]);
      expect(stageRecord(stages(), "plan", "alpha")?.status).toBe("succeeded");
      expect(stageRecord(stages(), "gate", "beta")?.status).toBe("awaiting");
    } finally {
      rpc.close();
    }
  });

  test.each([
    "live worktree claim",
    "operator blocker",
    "harness-only blocker",
    "mixed blockers",
    "non-descendant HEAD",
  ] as const)("failed plan resume preserves %s despite both reset overrides", async (guard) => {
    const intentWorktree = await materializeWorktree(intentBranch);
    await seedIntentReadyIntent(intentWorktree);
    const planWorktree = await materializeWorktree(planBranch, intentBranch);
    mkdirSync(join(planWorktree, ".jarvis-plan-stage"), { recursive: true });
    writeFileSync(join(planWorktree, ".jarvis-plan-stage", "draft.md"), "draft\n", "utf8");
    if (guard === "operator blocker") {
      writeFileSync(
        join(planWorktree, ".jarvis-plan-stage", "intent.md"),
        "# Intent\n\n## Blocker\n\noperator decision required\n",
        "utf8",
      );
    }
    if (guard === "harness-only blocker") {
      writeFileSync(
        join(planWorktree, ".jarvis-plan-stage", "intent.md"),
        "# Intent\n\n## Blocker\n\nArtifact contract check failed: plan.draft.shape\n",
        "utf8",
      );
    }
    if (guard === "mixed blockers") {
      writeFileSync(
        join(planWorktree, ".jarvis-plan-stage", "intent.md"),
        "# Intent\n\n## Blocker\n\nArtifact contract check failed: plan.draft.shape\n\n## Blocker\n\noperator decision required\n",
        "utf8",
      );
    }
    if (guard === "live worktree claim") {
      const lockPath = join(jarvisRoot, "worktree-locks", "demo", planBranch, ".jarvis.lock");
      mkdirSync(dirname(lockPath), { recursive: true });
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid }), "utf8");
    }
    if (guard === "non-descendant HEAD") {
      await realAsyncSubprocessRunner.runAsync("git", ["checkout", "--orphan", "divergent-plan"], planWorktree);
      await realAsyncSubprocessRunner.runAsync("git", ["rm", "-rf", "."], planWorktree);
      writeFileSync(join(planWorktree, "divergent.md"), "divergent\n", "utf8");
      await realAsyncSubprocessRunner.runAsync("git", ["add", "."], planWorktree);
      await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "divergent"], planWorktree);
      mkdirSync(join(planWorktree, ".jarvis-plan-stage"), { recursive: true });
      writeFileSync(join(planWorktree, ".jarvis-plan-stage", "draft.md"), "draft\n", "utf8");
    }

    const { store, stages } = fakeStore(
      planChainDefinition(),
      {
        "run-intent": { specPath: readyIntentRel, worktreePath: intentWorktree, branch: intentBranch },
        "run-plan": { specPath: "spec/plan" },
      },
      { context: { ...persistedContext, cwd: projectRoot }, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "intent",
      patch: { status: "succeeded", artifact: intentArtifact() },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "plan", patch: { status: "failed" } });

    let stderr = "";
    let dispatchCalled = false;
    const rpc = daemonRpcClient();
    try {
      const outcome = await resumePipeline(
        PIPELINE_ID,
        {
          store,
          dispatch: async () => {
            dispatchCalled = true;
            return { ok: true, entryRunId: "run-plan", invocationId: "inv-plan" };
          },
          wait: async () => "completed",
          resolveStage: resolveStageWithFixedPlanSteps,
          staleResetPreflight: staleResetBundle(rpc, {
            stdout: () => {},
            stderr: (text) => {
              stderr += text;
            },
          }),
        },
        { resetDespiteDirty: true, resetDespiteLandedCriteria: true },
      );

      expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
      if (guard === "harness-only blocker") {
        expect(dispatchCalled).toBe(true);
        expect(stageRecord(stages(), "plan")?.status).toBe("succeeded");
        return;
      }
      expect(dispatchCalled).toBe(false);
      expect(existsSync(planWorktree)).toBe(true);
      const detail = (stageRecord(stages(), "plan")?.failureDetail as { message?: string } | null)?.message ?? "";
      const expected =
        guard === "live worktree claim"
          ? "worktree lock"
          : guard === "operator blocker"
            ? "operator blocker"
            : guard === "mixed blockers"
              ? "operator blocker"
              : "not a descendant";
      expect(stderr).toContain(expected);
      expect(detail).toContain(expected);
    } finally {
      rpc.close();
    }
  });

  test("failed plan auto-dirty reset preserves landed-criteria refusal", async () => {
    mkdirSync(join(projectRoot, "spec", "plan"), { recursive: true });
    writeFileSync(
      join(projectRoot, "spec", "plan", "index.md"),
      "# Plan\n\n## Acceptance criteria\n\n- [ ] Keep work\n",
      "utf8",
    );
    await realAsyncSubprocessRunner.runAsync("git", ["add", "."], projectRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-m", "plan base"], projectRoot);
    const intentWorktree = await materializeWorktree(intentBranch);
    await seedIntentReadyIntent(intentWorktree);
    const planWorktree = await materializeWorktree(planBranch, intentBranch);
    writeFileSync(
      join(planWorktree, "spec", "plan", "index.md"),
      "# Plan\n\n## Acceptance criteria\n\n- [x] Keep work\n",
      "utf8",
    );

    const { store, stages } = fakeStore(
      planChainDefinition(),
      { "run-intent": { specPath: readyIntentRel, worktreePath: intentWorktree, branch: intentBranch } },
      { context: { ...persistedContext, cwd: projectRoot }, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "intent",
      patch: { status: "succeeded", artifact: intentArtifact() },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "plan", patch: { status: "failed" } });
    let stderr = "";
    let dispatched = false;
    const rpc = daemonRpcClient();
    try {
      const outcome = await resumePipeline(PIPELINE_ID, {
        store,
        dispatch: async () => {
          dispatched = true;
          return { ok: true, entryRunId: "run-plan", invocationId: "inv-plan" };
        },
        wait: async () => "completed",
        resolveStage: fixedPlanStepResolver("spec/plan/index.md"),
        staleResetPreflight: staleResetBundle(rpc, {
          stdout: () => {},
          stderr: (text) => {
            stderr += text;
          },
        }),
      });

      expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
      expect(dispatched).toBe(false);
      expect(existsSync(planWorktree)).toBe(true);
      expect(stderr).toContain("acceptance criteria ticked");
      expect((stageRecord(stages(), "plan")?.failureDetail as { message?: string })?.message).toContain(
        "acceptance criteria ticked",
      );
    } finally {
      rpc.close();
    }
  });

  // @mutate v2/src/daemon/pipeline-execution.ts "if (injection === undefined) return { ok: true };" -> "if (true) return { ok: true };"
  test("pipeline implement-stage stale-reset refusal fails stage without dispatch", async () => {
    const intentWorktree = await materializeWorktree(intentBranch);
    await seedIntentReadyIntent(intentWorktree);
    const planWorktree = await materializeWorktree(planBranch, intentBranch);
    const implementWorktree = await materializeWorktree(implementBranch, "main");
    writeFileSync(join(implementWorktree, "README.md"), "dirty\n", "utf8");

    const { store, stages } = fakeStore(
      implementChainDefinition(),
      {
        "run-intent": { specPath: readyIntentRel, worktreePath: intentWorktree, branch: intentBranch },
        "run-plan": { specPath: "spec/plan/index.md", worktreePath: planWorktree, branch: planBranch },
      },
      { context: { ...persistedContext, cwd: projectRoot }, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "intent",
      patch: { status: "succeeded", artifact: intentArtifact() },
    });
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "plan",
      patch: { status: "succeeded", artifact: { entryRunId: "run-plan", specPath: "spec/plan/index.md" } },
    });
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "implement", patch: { status: "failed" } });

    const rpc = daemonRpcClient();
    let dispatchCalled = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatchCalled = true;
      return { ok: true, entryRunId: "run-implement", invocationId: "inv-implement" };
    };

    try {
      const outcome = await resumePipeline(PIPELINE_ID, {
        store,
        dispatch,
        wait: async () => "completed",
        resolveStage: resolveStageWithFixedImplementSteps,
        staleResetPreflight: staleResetBundle(rpc),
      });

      expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
      expect(dispatchCalled).toBe(false);
      const record = stageRecord(stages(), "implement");
      expect(record?.status).toBe("failed");
      expect((record?.failureDetail as { message?: string } | null)?.message).toContain(
        "Cannot re-run incomplete spec",
      );
      expect(existsSync(implementWorktree)).toBe(true);
    } finally {
      rpc.close();
    }
  });

  // @mutate v2/src/daemon/pipeline-execution.ts "const staleReset = await runSharedStaleResetPreflight(" -> "const staleReset = { ok: true } as const; void runSharedStaleResetPreflight("
  test("pipeline fan-out stale-reset refusal fails branch without dispatch", async () => {
    const intentWorktree = await materializeWorktree(intentBranch);
    await seedIntentReadyIntent(intentWorktree);
    const alphaPlanBranch = "plan/alpha";
    const alphaPlanWorktree = await materializeWorktree(alphaPlanBranch, intentBranch);
    writeFileSync(join(alphaPlanWorktree, "README.md"), "dirty\n", "utf8");

    const intentArtifactWithFanOut: PipelineStageArtifact = {
      entryRunId: "run-intent",
      specPath: FAN_OUT_DOWNSTREAM[0] ?? "ready-intents/alpha.md",
      downstreamInputs: [...FAN_OUT_DOWNSTREAM],
    };
    const { store, stages } = fakeStore(
      FAN_OUT_LINEAR_DEFINITION,
      { "run-intent": { specPath: "ready-intents", worktreePath: intentWorktree, branch: intentBranch } },
      { context: { ...persistedContext, cwd: projectRoot }, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({
      pipelineId: PIPELINE_ID,
      stageId: "intent",
      patch: { status: "succeeded", artifact: intentArtifactWithFanOut, workflowInvocationId: "run-intent" },
    });
    for (const branchKey of FAN_OUT_BRANCH_KEYS) {
      store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "plan", branchKey });
      store.createPipelineStageBranch({ pipelineId: PIPELINE_ID, stageId: "implement", branchKey });
    }
    for (const stageId of ["plan", "implement"] as const) {
      store.updateStage({
        pipelineId: PIPELINE_ID,
        stageId,
        branchKey: "default",
        patch: { status: "skipped" },
      });
    }

    const rpc = daemonRpcClient();
    const dispatchLog: string[] = [];
    const dispatch: PipelineWorkflowDispatch = async (steps) => {
      const branchName = steps[0]?.behavior === "write" ? steps[0].worktree?.branchName : undefined;
      if (branchName !== undefined) dispatchLog.push(branchName);
      return { ok: true, entryRunId: `run-${branchName ?? "plan"}`, invocationId: `inv-${branchName ?? "plan"}` };
    };

    try {
      await runPipeline(PIPELINE_ID, {
        store,
        dispatch,
        wait: async () => "completed",
        context: { ...persistedContext, cwd: projectRoot },
        resolveStage: resolveFanOutPlanSteps,
        staleResetPreflight: staleResetBundle(rpc),
      });

      expect(dispatchLog).not.toContain(alphaPlanBranch);
      const alphaRecord = stageRecord(stages(), "plan", "alpha");
      expect(alphaRecord?.status).toBe("failed");
      expect((alphaRecord?.failureDetail as { message?: string } | null)?.message).toContain(
        "Cannot re-run incomplete spec",
      );
      expect(existsSync(alphaPlanWorktree)).toBe(true);
    } finally {
      rpc.close();
    }
  });

  test("intent-stage preflight fails open when the daemon cannot open its own control socket", async () => {
    const worktreePath = await materializeWorktree(intentBranch);
    writeFileSync(join(worktreePath, ".jarvis-intent-review-verdict.md"), "verdict\n", "utf8");

    const { store, stages } = fakeStore(
      intentDefinition(),
      { "run-s1": { specPath: "spec/ready-intents" } },
      { context: persistedContext, ownerIdentity: PRIOR_OWNER },
    );
    store.updateStage({ pipelineId: PIPELINE_ID, stageId: "s1", patch: { status: "failed" } });

    let dispatched = false;
    const dispatch: PipelineWorkflowDispatch = async () => {
      dispatched = true;
      return { ok: true, entryRunId: "run-s1", invocationId: "inv-s1" };
    };

    const outcome = await resumePipeline(PIPELINE_ID, {
      store,
      dispatch,
      wait: async () => "completed",
      resolveStage: resolveStageWithFixedIntentSteps,
      staleResetPreflight: {
        ...staleResetBundle({ client: makeIpcClient([], { gated: true, deferred: true }) }),
        connectClient: async () => {
          throw new Error("EMFILE: too many open files");
        },
      },
    });

    expect(outcome).toEqual({ kind: "resumed", pipelineId: PIPELINE_ID });
    expect(dispatched).toBe(true);
    expect(stages().find((s) => s.stageId === "s1")?.status).toBe("succeeded");
    expect(existsSync(worktreePath)).toBe(true);
  });

  test("createRunControlHandlers wires staleResetPreflight against the daemon socket when daemonSocketPath is set", async () => {
    const stateStore = openStateStore(join(tmp, `state-wiring-${crypto.randomUUID()}.sqlite`));
    const marker = makeIpcClient([], { gated: true, deferred: true });
    let connectedTo: string | undefined;
    const handlers = createRunControlHandlers({
      stateStore,
      writeLoopExecutor: async () => {},
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      settleDelayMs: 0,
      registry: new WorktreeOwnershipRegistry(),
      daemonSocketPath: "/marker-daemon.sock",
      connectStaleResetClient: async (socketPath) => {
        connectedTo = socketPath;
        return marker;
      },
    });
    try {
      const built = handlers.pipelineExecutionDeps();
      expect(built.staleResetPreflight).toBeDefined();
      const client = await built.staleResetPreflight?.connectClient();
      expect(connectedTo).toBe("/marker-daemon.sock");
      expect(client).toBe(marker);
    } finally {
      handlers.close();
      stateStore.close();
    }
  });

  test("createRunControlHandlers leaves staleResetPreflight unwired without daemonSocketPath", () => {
    const stateStore = openStateStore(join(tmp, `state-nowire-${crypto.randomUUID()}.sqlite`));
    const handlers = createRunControlHandlers({
      stateStore,
      writeLoopExecutor: async () => {},
      failureReporter: () => {},
      hasMemoryHeadroom: () => true,
      settleDelayMs: 0,
      registry: new WorktreeOwnershipRegistry(),
    });
    try {
      expect(handlers.pipelineExecutionDeps().staleResetPreflight).toBeUndefined();
    } finally {
      handlers.close();
      stateStore.close();
    }
  });
});

describe("pipeline chained plan and implement publication baseRef", () => {
  const { roots, cleanup } = trackedTempRoots();
  let previousJarvisHome: string | undefined;

  afterEach(() => {
    cleanup();
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
  });

  function initGitRepo(root: string): void {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  }

  test("chained pipeline plan and implement publication target repository default branch", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pipeline-publication-base-ref-"));
    roots.push(repoRoot);
    initGitRepo(repoRoot);
    writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: repoRoot });

    const defaultBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const intentBranch = "intent/feature";
    const planBranch = "plan/feature";
    const readyIntentRel = "spec/ready-intents/feature.md";
    const readyIntentContent = "---\nname: feature\n---\n\n## Prerequisites\n\n- none\n";
    const intentWorktree = join(repoRoot, ".jarvis-worktrees", intentBranch);
    mkdirSync(intentWorktree, { recursive: true });
    execFileSync("git", ["branch", intentBranch], { cwd: repoRoot });
    execFileSync("git", ["worktree", "add", intentWorktree, intentBranch], { cwd: repoRoot });
    mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(intentWorktree, readyIntentRel), readyIntentContent, "utf8");
    execFileSync("git", ["add", "-A"], { cwd: intentWorktree });
    execFileSync("git", ["commit", "-qm", "intent"], { cwd: intentWorktree });
    mkdirSync(join(repoRoot, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(repoRoot, readyIntentRel), readyIntentContent, "utf8");
    execFileSync("git", ["add", "-A"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-qm", "ready-intent on main"], { cwd: repoRoot });

    const planSpecDir = "spec/feature";
    const planSpecRel = `${planSpecDir}/index.md`;
    const planWorktree = join(repoRoot, ".jarvis-worktrees", planBranch);
    mkdirSync(planWorktree, { recursive: true });
    execFileSync("git", ["branch", planBranch], { cwd: repoRoot });
    execFileSync("git", ["worktree", "add", planWorktree, planBranch], { cwd: repoRoot });
    mkdirSync(join(planWorktree, planSpecDir), { recursive: true });
    writeFileSync(join(planWorktree, planSpecRel), "# Feature\n\n- [ ] [Work](./00-work.md)\n", "utf8");
    writeFileSync(
      join(planWorktree, `${planSpecDir}/00-work.md`),
      "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n",
      "utf8",
    );
    execFileSync("git", ["add", "-A"], { cwd: planWorktree });
    execFileSync("git", ["commit", "-qm", "plan"], { cwd: planWorktree });
    expect(planBranch).not.toBe(defaultBranch);

    previousJarvisHome = process.env.JARVIS_HOME;
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    process.env.JARVIS_HOME = jarvisRoot;
    const configPath = writeHomeMachineConfig({ projects: { demo: { root: repoRoot } } });

    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const context: PipelineContext = { cwd: repoRoot, configPath, seed: "unused" };
    const store = openStateStore(":memory:");
    const pipelineId = store.createPipeline({ definition, context });
    const intentRunId = store.createRun({
      project: "demo",
      specRef: defaultBranch,
      worktreePath: intentWorktree,
      branch: intentBranch,
      specPath: readyIntentRel,
    });
    store.updateStage({
      pipelineId,
      stageId: "intent",
      patch: {
        status: "succeeded",
        artifact: { entryRunId: intentRunId, specPath: readyIntentRel },
        workflowInvocationId: intentRunId,
      },
    });

    const publicationCaptures: Array<{ stageId: "plan" | "implement"; baseRef: string }> = [];
    let prCounter = 0;

    try {
      await runPipeline(pipelineId, {
        store,
        context,
        resolveStage: resolveStageWorkflowSteps,
        dispatch: async (steps) => {
          const writeStep = steps.find((candidate): candidate is WriteWorkflowStep => candidate.behavior === "write");
          if (writeStep === undefined) throw new Error("expected write step");
          const stageId = writeStep.role === "plan" ? "plan" : "implement";
          expect(writeStep.worktree.baseRef).toBe(defaultBranch);

          const worktreePath =
            stageId === "plan"
              ? planWorktree
              : (
                  await withExternalWorktree(writeStep.worktree, async ({ path }) => {
                    writeFileSync(join(path, "README.md"), "implement\n", "utf8");
                    execFileSync("git", ["add", "README.md"], { cwd: path });
                    execFileSync("git", ["commit", "-qm", "implement seed"], { cwd: path });
                    return path;
                  })
                ).worktree.path;

          const entryRunId = store.createRun({
            project: writeStep.worktree.projectName,
            specRef: writeStep.worktree.baseRef,
            worktreePath,
            branch: writeStep.worktree.branchName,
            specPath: stageId === "plan" ? planSpecDir : writeStep.specPath,
            stepId: writeStep.stepId,
          });
          const attemptId = store.recordAttemptStart(entryRunId);
          const publication = await publishCompletionArtifacts(
            {
              skipReadyFinalization: true,
              completionPublisher: async (input) => {
                publicationCaptures.push({ stageId, baseRef: input.baseRef });
                prCounter += 1;
                return {
                  pushSha: "deadbeef",
                  prNumber: prCounter,
                  prUrl: `https://example.test/pr/${prCounter}`,
                };
              },
              readyFinalizer: async () => {},
            },
            {
              worktreePath,
              baseRef: writeStep.worktree.baseRef,
              branch: writeStep.worktree.branchName,
              specPath: stageId === "plan" ? planSpecDir : writeStep.specPath,
            },
          );
          if (publication.kind !== "success") {
            throw new Error(
              publication.kind === "completion_commit_failed"
                ? (publication.error?.message ?? publication.kind)
                : publication.kind,
            );
          }
          store.commitCompletionBoundary({
            attemptId,
            runStatus: "completed",
            outcomeKind: "done",
            completionAgent: "claude",
          });
          store.setPrEvidence(entryRunId, prCounter, `https://example.test/pr/${prCounter}`);
          return { ok: true as const, entryRunId, invocationId: `inv-${stageId}` };
        },
        wait: async (entryRunId) => store.loadRun(entryRunId)?.status ?? "failed",
      });

      expect(publicationCaptures).toEqual([
        { stageId: "plan", baseRef: defaultBranch },
        { stageId: "implement", baseRef: defaultBranch },
      ]);
      expect(store.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "plan")?.status).toBe(
        "succeeded",
      );
      expect(store.loadPipeline(pipelineId)?.stages.find((stage) => stage.stageId === "implement")?.status).toBe(
        "succeeded",
      );
    } finally {
      store.close();
    }
  });

  test("chained implement resolution lands spec progress on the default-branch worktree during workflow execution", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pipeline-chained-spec-landing-"));
    roots.push(repoRoot);
    initGitRepo(repoRoot);
    writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-qm", "base"], { cwd: repoRoot });

    const defaultBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const intentBranch = "intent/feature";
    const planBranch = "plan/feature";
    const readyIntentRel = "spec/ready-intents/feature.md";
    const readyIntentContent = "---\nname: feature\n---\n\n## Prerequisites\n\n- none\n";
    const intentWorktree = join(repoRoot, ".jarvis-worktrees", intentBranch);
    mkdirSync(intentWorktree, { recursive: true });
    execFileSync("git", ["branch", intentBranch], { cwd: repoRoot });
    execFileSync("git", ["worktree", "add", intentWorktree, intentBranch], { cwd: repoRoot });
    mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(intentWorktree, readyIntentRel), readyIntentContent, "utf8");
    execFileSync("git", ["add", "-A"], { cwd: intentWorktree });
    execFileSync("git", ["commit", "-qm", "intent"], { cwd: intentWorktree });
    mkdirSync(join(repoRoot, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(repoRoot, readyIntentRel), readyIntentContent, "utf8");
    execFileSync("git", ["add", "-A"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-qm", "ready-intent on main"], { cwd: repoRoot });

    const planSpecDir = "spec/feature";
    const planSpecRel = `${planSpecDir}/index.md`;
    const planWorktree = join(repoRoot, ".jarvis-worktrees", planBranch);
    mkdirSync(planWorktree, { recursive: true });
    execFileSync("git", ["branch", planBranch], { cwd: repoRoot });
    execFileSync("git", ["worktree", "add", planWorktree, planBranch], { cwd: repoRoot });
    mkdirSync(join(planWorktree, planSpecDir), { recursive: true });
    writeFileSync(join(planWorktree, planSpecRel), "# Feature\n\n- [ ] [Work](./00-work.md)\n", "utf8");
    writeFileSync(
      join(planWorktree, `${planSpecDir}/00-work.md`),
      "# Work\n\n## Acceptance criteria\n\n- [ ] Work\n",
      "utf8",
    );
    execFileSync("git", ["add", "-A"], { cwd: planWorktree });
    execFileSync("git", ["commit", "-qm", "plan"], { cwd: planWorktree });

    previousJarvisHome = process.env.JARVIS_HOME;
    const { jarvisRoot } = createJarvisHome();
    roots.push(join(jarvisRoot, ".."));
    process.env.JARVIS_HOME = jarvisRoot;
    const configPath = writeHomeMachineConfig({ projects: { demo: { root: repoRoot } } });

    const definition: PipelineDefinition = {
      name: "p",
      stages: [
        { stageId: "intent", kind: "workflow", workflow: "intent", review: "none" },
        { stageId: "plan", kind: "workflow", workflow: "plan", review: "none" },
        { stageId: "implement", kind: "workflow", workflow: "implement", review: "light" },
      ],
    };
    const context: PipelineContext = { cwd: repoRoot, configPath, seed: "unused" };
    const store = openStateStore(":memory:");
    const intentRunId = store.createRun({
      project: "demo",
      specRef: defaultBranch,
      worktreePath: intentWorktree,
      branch: intentBranch,
      specPath: readyIntentRel,
    });
    const planRunId = store.createRun({
      project: "demo",
      specRef: defaultBranch,
      worktreePath: planWorktree,
      branch: planBranch,
      specPath: planSpecDir,
    });

    try {
      const resolved = await resolveStageWorkflowSteps(
        definition,
        2,
        context,
        new Map([
          [stageArtifactKey("intent"), { entryRunId: intentRunId, specPath: readyIntentRel }],
          [stageArtifactKey("plan"), { entryRunId: planRunId, specPath: planSpecDir }],
        ]),
        {
          builders: WORKFLOW_PRESET_BUILDERS,
          loadRun: (runId) => (runId === planRunId ? { worktreePath: planWorktree, branch: planBranch } : null),
        },
      );
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      const writeStep = singleStageResolutionSteps(resolved).find(
        (step): step is WriteWorkflowStep => step.behavior === "write",
      );
      expect(writeStep).toBeDefined();
      expect(writeStep?.specReadRoot).toBe(planWorktree);
      expect(writeStep?.worktree.baseRef).toBe(defaultBranch);

      const subspecPath = join(planWorktree, `${planSpecDir}/00-work.md`);
      writeStep!.createBinding = createBindingFactory(async () => {
        writeFileSync(subspecPath, "# Work\n\n## Acceptance criteria\n\n- [x] Work\n", "utf8");
        return { kind: "ok", stdout: "done", stderr: "" } as const;
      });

      const result = await executeWorkflow({
        steps: singleStageResolutionSteps(resolved),
        stateStore: store,
        completionCommitter: async () => ({ commitSha: "commit-1" }),
        completionPublisher: async () => ({}),
        readyFinalizer: async () => {},
      });
      expect(result.kind).toBe("complete");

      const implementWorktreePath = getExternalWorktreePath(writeStep!.worktree);
      expect(readFileSync(join(implementWorktreePath, planSpecRel), "utf8")).toContain("- [x]");
      expect(readFileSync(join(implementWorktreePath, `${planSpecDir}/00-work.md`), "utf8")).toContain("- [x] Work");
    } finally {
      store.close();
    }
  });
});

describe("pipeline plan stage ready-intent consumption", () => {
  const { roots, cleanup } = trackedTempRoots();
  afterEach(cleanup);

  let previousJarvisHome: string | undefined;
  let jarvisRoot: string;
  let repoRoot: string;
  let configPath: string;
  let intentBranch: string;
  let intentWorktree: string;
  let planBranch: string;
  const readyIntentRel = "spec/ready-intents/feature.md";
  const intentContent = "---\nname: feature\n---\n\n## Prerequisites\n\n- none\n";

  beforeEach(async () => {
    previousJarvisHome = process.env.JARVIS_HOME;
    ({ jarvisRoot } = createJarvisHome());
    roots.push(join(jarvisRoot, ".."));
    process.env.JARVIS_HOME = jarvisRoot;

    repoRoot = mkdtempSync(join(tmpdir(), "pipeline-plan-ready-intent-"));
    roots.push(repoRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["init", "-q"], repoRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.email", "t@t.com"], repoRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["config", "user.name", "T"], repoRoot);
    writeFileSync(join(repoRoot, "README.md"), "base\n", "utf8");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "-A"], repoRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-qm", "base"], repoRoot);

    intentBranch = "intent/feature";
    intentWorktree = join(repoRoot, ".jarvis-worktrees", intentBranch);
    mkdirSync(intentWorktree, { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["branch", intentBranch], repoRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", intentWorktree, intentBranch], repoRoot);
    mkdirSync(join(intentWorktree, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(intentWorktree, readyIntentRel), intentContent, "utf8");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "-A"], intentWorktree);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-qm", "intent ready-intent"], intentWorktree);

    mkdirSync(join(repoRoot, "spec", "ready-intents"), { recursive: true });
    writeFileSync(join(repoRoot, readyIntentRel), intentContent, "utf8");
    await realAsyncSubprocessRunner.runAsync("git", ["add", "-A"], repoRoot);
    await realAsyncSubprocessRunner.runAsync("git", ["commit", "-qm", "ready-intent on main"], repoRoot);

    planBranch = "plan/feature";
    await realAsyncSubprocessRunner.runAsync("git", ["branch", planBranch, "main"], repoRoot);

    configPath = writeHomeMachineConfig({ projects: { demo: { root: repoRoot } } });
  });

  afterEach(() => {
    if (previousJarvisHome === undefined) delete process.env.JARVIS_HOME;
    else process.env.JARVIS_HOME = previousJarvisHome;
  });

  test("pipeline plan stage landing deletes consumed ready-intent from plan worktree", async () => {
    // @mutate v2/src/execution/publication-workflow-steps.ts "paths: [resolve(project.root, input.readyIntent)]," -> "paths: [join(input.cwd, input.readyIntent)],"
    const definition = PIPELINE_REGISTRY["full-review"];
    if (definition === undefined) throw new Error("expected full-review pipeline");
    const planStageIndex = definition.stages.findIndex((stage) => stage.stageId === "plan");
    if (planStageIndex < 0) throw new Error("expected plan stage");

    const resolved = await resolveStageWorkflowSteps(
      definition,
      planStageIndex,
      { cwd: repoRoot, configPath, seed: "unused" },
      new Map([[stageArtifactKey("intent"), { entryRunId: "run-intent", specPath: readyIntentRel }]]),
      {
        builders: WORKFLOW_PRESET_BUILDERS,
        loadRun: () => ({ worktreePath: intentWorktree, branch: intentBranch }),
      },
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const steps = singleStageResolutionSteps(resolved);
    const writeStep = steps.find((step): step is WriteWorkflowStep => step.behavior === "write");
    const reviewStep = steps.find((step) => step.behavior === "review-debate");
    if (!writeStep || reviewStep?.behavior !== "review-debate")
      throw new Error("expected plan write and review-debate steps");
    if (writeStep.landing?.kind !== "plan-tree" || reviewStep.landing?.kind !== "plan-tree") {
      throw new Error("expected plan-tree landing");
    }

    const planWorktree = getExternalWorktreePath(writeStep.worktree);
    mkdirSync(dirname(planWorktree), { recursive: true });
    await realAsyncSubprocessRunner.runAsync("git", ["worktree", "add", planWorktree, planBranch], repoRoot);
    expect(existsSync(join(planWorktree, readyIntentRel))).toBe(true);

    const stageDir = join(planWorktree, ".jarvis-plan-stage");
    mkdirSync(stageDir, { recursive: true });
    writeFileSync(join(stageDir, "index.md"), "# Plan\n\n- [ ] [First](./00-first.md)\n", "utf8");
    writeFileSync(join(stageDir, "intent.md"), intentContent, "utf8");
    writeFileSync(join(stageDir, "00-first.md"), "# First\n", "utf8");
    const verdictPath = join(stageDir, "verdict-plan.md");
    writeFileSync(verdictPath, "ok\n", "utf8");

    const landed = await landReviewedPublicationOutput(planWorktree, reviewStep.landing, verdictPath);
    expect(landed.ok).toBe(true);

    expect(existsSync(join(planWorktree, readyIntentRel))).toBe(false);
    expect(execFileSync("git", ["diff", "--name-only"], { cwd: planWorktree, encoding: "utf8" })).toContain(
      readyIntentRel,
    );
  });
});
