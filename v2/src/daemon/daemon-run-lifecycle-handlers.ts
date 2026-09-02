import { join } from "node:path";
import {
  FILTERED_LIST_DEFAULT_LIMIT,
  type ListRpcParams,
  listRpcRequestIsFiltered,
  runMatchesListRpcParams,
} from "../commands/run-list-rpc.ts";
import { readIterationCeilingMs } from "../config/machine-config-loader.ts";
import { getExternalWorktreePath } from "../execution/external-worktree.ts";
import type { InvocationFailureDetail, InvocationFailureKind } from "../execution/invocation-failure.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import {
  type IntentFinalizationResumeDeps,
  resolveExhaustedRedResumeContext,
  resolveIntentFinalizationResumeContext,
  resolveReviewMutationResumeContext,
  resolveWriteOutOfScopeResumeContext,
  resumePopulatedIntentPublication,
  resumeReviewMutationFinalization,
} from "../execution/workflow-runner-resume.ts";
import {
  findLandingContractRepromptFromLog,
  findStagedMarkdownLintRepromptFromLog,
  findSurvivingMutationRepromptFromLog,
  type WriteLoopInput,
} from "../execution/write-loop.ts";
import type { RpcHandler } from "../ipc/server.ts";
import { jarvisHome } from "../paths.ts";
import {
  type LogReader,
  type LogSink,
  type LoopFinishedEvent,
  openLogSink,
  type PersistedRecord,
  truncateLogText,
} from "../persistence/log-stream.ts";
import {
  type Attempt,
  isTerminalRunStatus,
  type Run,
  type RunStatus,
  type StateStore,
  type WorkflowSnapshot,
} from "../persistence/state-store.ts";
import { rollupWorkflowRunStatus } from "../persistence/workflow-run-status-rollup.ts";
import {
  type ActiveRun,
  activeRunAcceptsKill,
  checkWorktreeClaimed,
  forceSettleAdmitsRun,
  forceSettleStatusAdmitsRun,
  type LoadedRun,
  type OwnershipKey,
  projectWorkflowEntryResult,
  promoteQueuedRunImpl,
  type ResolvedWriteLoopInput,
  resolveWriteLoopBindings,
  runListTerminalFinishAtMs,
  settleGuardedKill,
  type WaitRunCompletionResult,
  workflowInvocationIsLive,
} from "./daemon.ts";
import type { RunControlHandlerContext } from "./daemon-run-control-context.ts";
import type { PipelineWorkflowDispatch, PipelineWorkflowWait } from "./pipeline-stage-dispatch.ts";
import {
  composeRunOperatorError,
  findTerminalLogRecord,
  isResumeAdmitted,
  type RunOperatorError,
  type TerminalLogRecord,
  terminalResumeRefusalMessage,
} from "./run-operator-error.ts";
import { workflowRowSnapshot } from "./workflow-list-snapshot.ts";
export type LifecycleStartResult =
  | { kind: "response"; result: unknown }
  | { kind: "error"; code: string; message: string }
  | Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }>;

export type RunLifecycleHandlerDeps = {
  handleWorkflowStart: (steps: AnyWorkflowStep[]) => LifecycleStartResult;
  pipelineDispatch?: PipelineWorkflowDispatch;
  pipelineWait?: PipelineWorkflowWait;
};

export type RunLifecycleHandlers = {
  start: RpcHandler;
  list: RpcHandler;
  pause: RpcHandler;
  resume: RpcHandler;
  kill: RpcHandler;
  wait: RpcHandler;
  dismiss: RpcHandler;
  undismiss: RpcHandler;
  pipelineDispatch: PipelineWorkflowDispatch;
  pipelineWait: PipelineWorkflowWait;
  resumeFinalizationOnly: (
    run: LoadedRun,
    key: OwnershipKey,
    execute: (deps: IntentFinalizationResumeDeps) => Promise<{ ok: true } | { ok: false; message: string }>,
    failureAsResponse?: boolean,
  ) => Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }>;
};

const LIST_TERMINAL_RUN_LIMIT = 50;

function ownershipKeyString(key: OwnershipKey): string {
  return `${key.project}:${key.branch}`;
}

function worktreeClaimedMessage(key: OwnershipKey): string {
  return `Worktree already claimed for project=${key.project}, branch=${key.branch}`;
}

/** Terminal or paused — any status with no live write loop to disturb. */
function isSettledRunStatus(status: RunStatus): boolean {
  return isTerminalRunStatus(status) || status === "paused";
}

function daemonFailureDetail(failureKind: InvocationFailureKind, message: string): InvocationFailureDetail {
  return { failureKind, bindingAttempts: [], message: truncateLogText(message) };
}

/** Filter durable rows before list pays per-row loadRun/tail cost. Durable store is unchanged. */
function retainListedRuns(runs: Run[]): Run[] {
  const keptIds = new Set<string>();
  const keptInvocationIds = new Set<string>();
  let terminalKept = 0;

  for (const run of runs) {
    const invocationId = run.workflowSnapshot?.invocationId;
    if (!isTerminalRunStatus(run.status)) {
      keptIds.add(run.id);
      if (invocationId !== undefined) keptInvocationIds.add(invocationId);
      continue;
    }
    if (terminalKept < LIST_TERMINAL_RUN_LIMIT) {
      keptIds.add(run.id);
      terminalKept++;
      if (invocationId !== undefined) keptInvocationIds.add(invocationId);
    }
  }

  for (const run of runs) {
    if (keptIds.has(run.id)) continue;
    if (!isTerminalRunStatus(run.status)) continue;
    const invocationId = run.workflowSnapshot?.invocationId;
    if (invocationId !== undefined && keptInvocationIds.has(invocationId)) {
      keptIds.add(run.id);
    }
  }

  return runs.filter((run) => keptIds.has(run.id));
}
function reconstructDirectWriteResume(run: Run): ResolvedWriteLoopInput {
  if (run.status !== "paused") return { ok: false, message: "direct write resume requires a paused run" };
  const input = run.queuedInput;
  if (!input) return { ok: false, message: "run has no durable direct-write resume context" };
  const {
    initialIterationsConsumed: _initialIterationsConsumed,
    mutationDirectiveReprompt: _mutationDirectiveReprompt,
    guardCheckpointReprompt: _guardCheckpointReprompt,
    keystoneDirectiveReprompt: _keystoneDirectiveReprompt,
    ...baseInput
  } = input as WriteLoopInput & Record<string, unknown>;
  return resolveWriteLoopBindings(baseInput);
}

function reconstructWriteResume(run: Run, logRecords?: readonly PersistedRecord[]): ResolvedWriteLoopInput {
  const snapshot = run.workflowSnapshot;
  if (!snapshot) return reconstructDirectWriteResume(run);
  const stepId = run.stepId;
  const hiddenShrink = stepId?.endsWith("~shrink") === true;
  const step = snapshot?.steps.find(
    (candidate) => candidate.stepId === stepId || (hiddenShrink && candidate.stepId === stepId.slice(0, -7)),
  );

  if (!stepId || !step) return { ok: false, message: "run has no matching workflow snapshot step" };
  if (step.behavior === "review" || step.behavior === "review-debate") {
    return { ok: false, message: `step "${step.stepId}" is not an executable write step` };
  }
  if (step.stepRules?.trim() === "") return { ok: false, message: "snapshot step has empty rules" };
  if (step.expectedArtifactPath?.trim() === "") return { ok: false, message: "snapshot step has empty artifact path" };
  if (!step.stepRules || !step.expectedArtifactPath || !step.agents?.length || !step.agentModelConfig) {
    return { ok: false, message: "snapshot step is missing write resume context" };
  }

  const landingContractReprompt = findLandingContractRepromptFromLog(logRecords);
  const stagedMarkdownLintReprompt = findStagedMarkdownLintRepromptFromLog(logRecords);
  const survivingMutationReprompt =
    run.status === "paused" ? findSurvivingMutationRepromptFromLog(logRecords) : undefined;
  return resolveWriteLoopBindings({
    worktree: {
      projectRoot: run.worktreePath,
      projectName: run.project,
      branchName: run.branch,
      baseRef: run.specRef,
    },
    specPath: run.specPath,
    stepRules: step.stepRules,
    expectedArtifactPath: step.expectedArtifactPath,
    bindings: [],
    bindingResolution: {
      role: hiddenShrink ? "shrink" : step.role,
      agents: step.agents,
      agentModelConfig: step.agentModelConfig,
    },
    stepId,
    workflowSnapshot: snapshot,
    resumeReentry: true,
    ...(step.promptId !== undefined ? { promptId: step.promptId } : {}),
    ...(step.promptPlaceholders !== undefined ? { promptPlaceholders: step.promptPlaceholders } : {}),
    ...(step.iterationTimeoutMs === undefined ? {} : { iterationTimeoutMs: step.iterationTimeoutMs }),
    iterationCeilingMs: step.iterationCeilingMs ?? readIterationCeilingMs(join(jarvisHome(), "config.json")),
    ...(step.idleOutputMs === undefined ? {} : { idleOutputMs: step.idleOutputMs }),
    ...(landingContractReprompt !== undefined ? { landingContractReprompt } : {}),
    ...(stagedMarkdownLintReprompt !== undefined ? { stagedMarkdownLintReprompt } : {}),
    ...(survivingMutationReprompt !== undefined ? { survivingMutationReprompt } : {}),
  });
}
/** Confirmed publication evidence, so `completed` is falsifiable from `run list` alone. */
function runListPrEvidence(run: Run): { prNumber?: number; prUrl?: string } {
  return {
    ...(run.prNumber !== undefined && run.prNumber !== null ? { prNumber: run.prNumber } : {}),
    ...(run.prUrl !== undefined && run.prUrl !== null ? { prUrl: run.prUrl } : {}),
  };
}

function runListReviewFields(snapshot: WorkflowSnapshot | undefined): {
  reviewPasses?: number;
  reviewBehavior?: string;
} {
  return {
    ...(snapshot?.reviewPasses !== undefined ? { reviewPasses: snapshot.reviewPasses } : {}),
    ...(snapshot?.reviewBehavior !== undefined ? { reviewBehavior: snapshot.reviewBehavior } : {}),
  };
}
const UNSUPPORTED_RESUME_ERROR = {
  reason: "unsupported_resume_context",
  retryable: false,
  nextAction: "stop",
} as const;

/**
 * A review/review-debate row's `landing_failed` is only resumable through
 * {@link resumePopulatedIntentPublication}, not the write-loop reconstruction below — it needs a
 * populated `.jarvis-intent-stage/` and the sibling durable write step's row. Out of scope (empty
 * or missing stage, non-review rows) falls through to the existing write-step reconstruction,
 * which still refuses a review-behavior row.
 */
function isIntentFinalizationResumable(run: Run & { attempts?: Attempt[] }, store: StateStore): boolean {
  return resolveIntentFinalizationResumeContext({ ...run, attempts: run.attempts ?? [] }, store).ok;
}

/**
 * A review/review-debate row's `surviving_mutation_failed` is only resumable through
 * {@link resumeReviewMutationFinalization}, not the write-loop reconstruction below — the durable
 * write step already committed, so only mutation re-verification, the ready gate, and publication
 * need to run again.
 */
function isReviewMutationResumable(
  run: Run & { attempts?: Attempt[] },
  store: StateStore,
  terminalRecord: TerminalLogRecord | undefined,
): boolean {
  return resolveReviewMutationResumeContext({ ...run, attempts: run.attempts ?? [] }, store, terminalRecord).ok;
}

function resumeContextForRun(
  run: Run & { attempts?: Attempt[] },
  store: StateStore,
  terminalRecord?: TerminalLogRecord,
  intentFinalizationResumable?: boolean,
  logRecords?: PersistedRecord[],
): ResolvedWriteLoopInput | undefined {
  // Admission is derived from the advertised row contract: if nextAction is
  // "resume", snapshot reconstruction proceeds; otherwise undefined.
  if (!isResumeAdmitted(run, terminalRecord)) return undefined;
  if (intentFinalizationResumable ?? isIntentFinalizationResumable(run, store)) return undefined;
  if (
    isReviewMutationResumable(run, store, terminalRecord) ||
    resolveExhaustedRedResumeContext({ ...run, attempts: run.attempts ?? [] }, store, terminalRecord).ok ||
    resolveWriteOutOfScopeResumeContext({ ...run, attempts: run.attempts ?? [] }, store, terminalRecord).ok
  ) {
    return undefined;
  }
  return reconstructWriteResume(run, logRecords);
}

function resumeContextForTerminalRecord(
  run: (Run & { attempts?: Attempt[] }) | undefined,
  store: StateStore,
  terminalRecord: TerminalLogRecord | undefined,
  intentFinalizationResumable?: boolean,
  logRecords?: PersistedRecord[],
): ResolvedWriteLoopInput | undefined {
  if (!run) return undefined;
  return resumeContextForRun(run, store, terminalRecord, intentFinalizationResumable, logRecords);
}

function runListRowError(
  run: Parameters<typeof composeRunOperatorError>[0] | undefined,
  resumeContext: ResolvedWriteLoopInput | undefined,
  terminalRecord: TerminalLogRecord | undefined,
  logRecords?: PersistedRecord[],
) {
  if (!run) return undefined;
  if (resumeContext?.ok === false) {
    return UNSUPPORTED_RESUME_ERROR;
  }
  return composeRunOperatorError(run, terminalRecord, logRecords);
}

function workflowEntrySnapshot(run: LoadedRun | undefined): WorkflowSnapshot | undefined {
  const snapshot = run?.workflowSnapshot;
  if (snapshot === null || snapshot === undefined) return undefined;
  return run?.stepId === snapshot.steps[0]?.stepId ? snapshot : undefined;
}

function workflowReviewMutationOwner(
  entryRun: LoadedRun,
  rollupStatus: RunStatus,
  siblingRuns: LoadedRun[],
  reader: LogReader | undefined,
): { run: LoadedRun; terminalRecord: PersistedRecord & { event: LoopFinishedEvent } } | undefined {
  if (rollupStatus !== "failed" || entryRun.status === rollupStatus) return undefined;
  let owner: { run: LoadedRun; terminalRecord: PersistedRecord & { event: LoopFinishedEvent } } | undefined;
  for (const sibling of siblingRuns) {
    if (sibling.status !== "failed") continue;
    const terminalRecord = findTerminalLogRecord(reader?.tail(sibling.id) ?? []);
    if (
      terminalRecord?.event.kind !== "loop_finished" ||
      (terminalRecord.event.loopOutcomeKind !== "surviving_mutation_failed" &&
        terminalRecord.event.loopOutcomeKind !== "mutation_repair_exhausted")
    ) {
      continue;
    }
    if (owner === undefined || terminalRecord.ts > owner.terminalRecord.ts) {
      owner = { run: sibling, terminalRecord: terminalRecord as PersistedRecord & { event: LoopFinishedEvent } };
    }
  }
  return owner;
}

type StartResult =
  | { kind: "response"; result: unknown }
  | { kind: "error"; code: string; message: string }
  | Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }>;

export function createRunLifecycleHandlers(
  ctx: RunControlHandlerContext,
  deps: RunLifecycleHandlerDeps,
): RunLifecycleHandlers {
  const {
    registry,
    activeRuns,
    waitAbortControllers,
    workflowPromisesByEntryRunId,
    store,
    logReader,
    writeLoopExecutor,
    failureReporter,
    intentFinalizationResumeDeps,
    checkMemoryHeadroom,
    settleDelayMs,
    settleState,
  } = ctx;
  const logsPath = ctx.logsPath;
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: wait-completion result assembly branches on status, record, and resume context
  const resultFrom = (runId: string, runStatus: RunStatus, record?: TerminalLogRecord): WaitRunCompletionResult => {
    const logTail = logReader?.tail(runId) ?? [];
    const run = store.loadRun(runId);
    const resumeContext = run ? resumeContextForRun(run, store, record) : undefined;
    const error =
      run && resumeContext?.ok === false
        ? UNSUPPORTED_RESUME_ERROR
        : run
          ? composeRunOperatorError(run, record, logTail)
          : undefined;
    const unsupportedResume = resumeContext?.ok === false;
    const loopFinishedEvent = record?.event.kind === "loop_finished" ? record.event : undefined;
    const loopOutcomeKind = run?.terminalCause ?? loopFinishedEvent?.loopOutcomeKind;
    const base: WaitRunCompletionResult =
      loopOutcomeKind === undefined
        ? { runStatus }
        : {
            runStatus,
            loopOutcomeKind,
            ...(loopFinishedEvent?.loopOutcomeKind === loopOutcomeKind
              ? { iterationsConsumed: loopFinishedEvent.iterationsConsumed }
              : {}),
            resumable: unsupportedResume ? false : run != null && isResumeAdmitted(run, record),
          };
    const withError = error === undefined ? base : { ...base, error };
    return runStatus === "blocked" && run ? { ...withError, worktreePath: run.worktreePath } : withError;
  };

  const workflowEntryResult = (
    entryRun: LoadedRun,
    snapshot: WorkflowSnapshot,
    rollupStatus: RunStatus,
  ): WaitRunCompletionResult => {
    const entryRecord = findTerminalLogRecord(logReader?.tail(entryRun.id) ?? []);
    const siblingRuns = store
      .findRunsByInvocationId(snapshot.invocationId)
      .map((run) => store.loadRun(run.id))
      .filter((run): run is LoadedRun => run !== undefined);
    const owner = workflowReviewMutationOwner(entryRun, rollupStatus, siblingRuns, logReader);
    if (owner === undefined) {
      return resultFrom(entryRun.id, rollupStatus, entryRecord);
    }

    // Built from the owner row's own operator error, not `resultFrom`: `resultFrom`'s
    // unsupported-resume masking answers "can this exact row be resumed?", which for a
    // review-step owner is always no and would blank out the mutation reason/detail below.
    // Entry resumability is projected separately via `entryCanResume`, so that masking
    // does not apply here.
    const ownerError = composeRunOperatorError(owner.run, owner.terminalRecord, logReader?.tail(owner.run.id) ?? []);
    const entryResult: WaitRunCompletionResult = {
      runStatus: rollupStatus,
      loopOutcomeKind: owner.terminalRecord.event.loopOutcomeKind,
      iterationsConsumed: owner.terminalRecord.event.iterationsConsumed,
      resumable: isResumeAdmitted(owner.run, owner.terminalRecord),
      ...(ownerError === undefined ? {} : { error: ownerError }),
    };
    const entryIntentFinalizationResumable = isIntentFinalizationResumable(entryRun, store);
    const entryResumeContext = resumeContextForTerminalRecord(
      entryRun,
      store,
      entryRecord,
      entryIntentFinalizationResumable,
    );
    const entryCanResume = entryResumeContext?.ok === true || entryIntentFinalizationResumable;
    return projectWorkflowEntryResult(entryResult, entryCanResume);
  };

  const spawnWriteLoop = (key: OwnershipKey, runId: string, worktreePath: string, input: WriteLoopInput): void => {
    const ks = ownershipKeyString(key);
    const abortController = new AbortController();
    const pauseController = new AbortController();
    activeRuns.set(ks, { kind: "write-loop", runId, key, abortController, pauseController });

    registry.claim(key, { runId, worktreePath });

    (async () => {
      try {
        await writeLoopExecutor(input, abortController.signal, pauseController.signal);
      } catch (reason) {
        try {
          const run = store.loadRun(runId);
          if (run && !isSettledRunStatus(run.status)) {
            const message = reason instanceof Error ? reason.message : String(reason);
            store.commitTerminalRunSettlement({
              runId,
              status: "failed",
              terminalCause: "invocation_failure",
              terminalFailureDetail: daemonFailureDetail("error", message),
            });
          }
        } catch {
          // best-effort persist; cleanup still runs
        }
        try {
          await failureReporter(runId, reason);
        } catch {
          // reporter failure does not block cleanup or roll back status
        }
      } finally {
        activeRuns.delete(ks);
        registry.release(key);
        promoteQueuedRun();
      }
    })();
  };

  const promoteQueuedRun = (bypassSettleDelay = false): void => {
    if (ctx.retiring) {
      return;
    }
    promoteQueuedRunImpl(
      { store, registry: registry, checkMemoryHeadroom, settleDelayMs, settleState, spawnWriteLoop },
      bypassSettleDelay,
    );
  };

  const handleWriteLoopStart = (rawInput: WriteLoopInput): StartResult => {
    const resolved = resolveWriteLoopBindings(rawInput);
    if (!resolved.ok) {
      return { kind: "error", code: "invalid_params", message: resolved.message };
    }
    const input = resolved.input;
    const key: OwnershipKey = {
      project: input.worktree.projectName,
      branch: input.worktree.branchName,
    };

    // Already queued for this (project, branch)? Never queue a second entry behind it.
    if (store.hasQueuedRun(key)) {
      return {
        kind: "error",
        code: "worktree_claimed",
        message: worktreeClaimedMessage(key),
      };
    }

    // Claimed by a live run? Reject rather than queue behind or admit a second live run.
    const claimError = checkWorktreeClaimed(registry, key);
    if (claimError) {
      return claimError;
    }

    const worktreePath = getExternalWorktreePath(input.worktree);

    if (!checkMemoryHeadroom()) {
      const runId = store.createRun({
        project: key.project,
        specRef: input.worktree.baseRef,
        worktreePath,
        branch: key.branch,
        specPath: input.specPath,
        status: "queued",
        queuedInput: input,
        ...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
        ...(input.workflowSnapshot !== undefined ? { workflowSnapshot: input.workflowSnapshot } : {}),
      });
      // Memory may have recovered between the check above and this row being
      // persisted; recheck once immediately rather than waiting for a later exit.
      promoteQueuedRun(true);
      return { kind: "response", result: { runId } };
    }

    const runId = store.createRun({
      project: key.project,
      specRef: input.worktree.baseRef,
      worktreePath,
      branch: key.branch,
      specPath: input.specPath,
      queuedInput: input,
      ...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
      ...(input.workflowSnapshot !== undefined ? { workflowSnapshot: input.workflowSnapshot } : {}),
    });

    spawnWriteLoop(key, runId, worktreePath, input);
    promoteQueuedRun();

    return { kind: "response", result: { runId } };
  };

  const startHandler: RpcHandler = (frame) => {
    if (ctx.retiring) {
      return { kind: "error", code: "daemon_superseded", message: "Daemon is retiring and not accepting new work" };
    }
    const params = frame.params as { input?: WriteLoopInput; steps?: AnyWorkflowStep[] } | undefined;
    const hasInput = params?.input !== undefined;
    const hasSteps = params?.steps !== undefined;

    if (hasInput === hasSteps) {
      return { kind: "error", code: "invalid_params", message: "Provide exactly one of input or steps" };
    }

    return hasSteps
      ? deps.handleWorkflowStart(params?.steps as AnyWorkflowStep[])
      : handleWriteLoopStart(params?.input as WriteLoopInput);
  };

  /** Index every durable run's full row, grouping workflow step rows by invocation. */
  const indexListedRuns = (
    durableRuns: Run[],
  ): { fullRuns: Map<string, LoadedRun>; workflowRuns: Map<string, Map<string, LoadedRun>> } => {
    const fullRuns = new Map<string, LoadedRun>();
    const workflowRuns = new Map<string, Map<string, LoadedRun>>();

    for (const durableRun of durableRuns) {
      const fullRun = store.loadRun(durableRun.id);
      if (!fullRun) continue;
      fullRuns.set(durableRun.id, fullRun);
      const snapshot = fullRun.workflowSnapshot;
      const stepId = fullRun.stepId;
      if (snapshot === null || snapshot === undefined || stepId === null || stepId === undefined) continue;
      let steps = workflowRuns.get(snapshot.invocationId);
      if (!steps) {
        steps = new Map<string, LoadedRun>();
        workflowRuns.set(snapshot.invocationId, steps);
      }
      steps.set(stepId, fullRun);
    }

    return { fullRuns, workflowRuns };
  };

  const reportedRunStatus = (run: Run, fullRun: LoadedRun | undefined): RunStatus => {
    const entrySnapshot = workflowEntrySnapshot(fullRun);
    if (entrySnapshot === undefined) return run.status;
    const workflowStillLive = workflowInvocationIsLive(workflowPromisesByEntryRunId.has(run.id), activeRuns.values());
    return rollupWorkflowRunStatus({
      entryRun: run,
      workflowSnapshot: entrySnapshot,
      siblingRuns: store.findRunsByInvocationId(entrySnapshot.invocationId),
      isLive: workflowStillLive,
    });
  };

  const workflowEntryRollupStatus = (
    fullRun: LoadedRun,
    workflowRuns: Map<string, Map<string, LoadedRun>>,
  ): RunStatus => {
    const snapshot = fullRun.workflowSnapshot;
    if (snapshot === null || snapshot === undefined) return fullRun.status;
    const entryStepId = snapshot.steps[0]?.stepId;
    if (entryStepId === undefined) return fullRun.status;
    const entryFullRun = workflowRuns.get(snapshot.invocationId)?.get(entryStepId);
    if (entryFullRun === undefined) return fullRun.status;
    const workflowStillLive = workflowInvocationIsLive(
      workflowPromisesByEntryRunId.has(entryFullRun.id),
      activeRuns.values(),
    );
    return rollupWorkflowRunStatus({
      entryRun: entryFullRun,
      workflowSnapshot: snapshot,
      siblingRuns: store.findRunsByInvocationId(snapshot.invocationId),
      isLive: workflowStillLive,
    });
  };

  const runListRowWorkflowField = (
    fullRun: LoadedRun | undefined,
    snapshot: LoadedRun["workflowSnapshot"] | undefined,
    workflowRuns: Map<string, Map<string, LoadedRun>>,
    liveRunIds: Set<string>,
  ) => {
    if (fullRun === undefined || snapshot === undefined) return {};
    return {
      workflow: workflowRowSnapshot(
        fullRun,
        workflowRuns,
        liveRunIds,
        ctx.reviewDebateProgressByInvocation,
        workflowEntryRollupStatus(fullRun, workflowRuns),
      ),
    };
  };

  const buildRunListRow = (
    run: Run,
    fullRun: LoadedRun | undefined,
    isLive: boolean,
    reportedStatus: RunStatus,
    workflowRuns: Map<string, Map<string, LoadedRun>>,
    liveRunIds: Set<string>,
  ) => {
    const snapshot = fullRun?.workflowSnapshot ?? undefined;
    const logTail = logReader?.tail(run.id) ?? [];
    const terminalRecord = findTerminalLogRecord(logTail);
    const entrySnapshot = workflowEntrySnapshot(fullRun);
    const entryResult =
      entrySnapshot === undefined || fullRun === undefined
        ? undefined
        : workflowEntryResult(fullRun, entrySnapshot, reportedStatus);
    const rowOutcome =
      entryResult ?? (fullRun !== undefined ? resultFrom(run.id, reportedStatus, terminalRecord) : undefined);
    const error =
      rowOutcome?.error ??
      runListRowError(fullRun, resumeContextForTerminalRecord(fullRun, store, terminalRecord), terminalRecord, logTail);
    const {
      runStatus: _entryRunStatus,
      error: _entryError,
      worktreePath: _entryWorktreePath,
      ...entryOutcomeFields
    } = rowOutcome ?? { runStatus: reportedStatus };

    const finishedAtMs =
      isTerminalRunStatus(reportedStatus) && fullRun !== undefined
        ? runListTerminalFinishAtMs(fullRun.attempts, fullRun.reconciledAt, fullRun.finishedAt)
        : undefined;

    return {
      runId: run.id,
      project: run.project,
      branch: run.branch,
      createdAt: run.createdAt,
      status: reportedStatus,
      isLive,
      ...entryOutcomeFields,
      ...(error !== undefined ? { error } : {}),
      ...runListReviewFields(snapshot),
      ...(fullRun?.stepId !== null && fullRun?.stepId !== undefined ? { stepId: fullRun.stepId } : {}),
      ...runListRowWorkflowField(fullRun, snapshot, workflowRuns, liveRunIds),
      ...(reportedStatus === "blocked" ? { worktreePath: run.worktreePath } : {}),
      ...runListPrEvidence(run),
      ...(finishedAtMs !== undefined ? { finishedAtMs } : {}),
      dismissedAt: run.dismissedAt ?? null,
    };
  };

  const listHandler: RpcHandler = (frame) => {
    const listParams = frame.params as ListRpcParams | undefined;
    const includeDismissed = listParams?.includeDismissed === true;
    const isNotDismissed = (run: Run): boolean => includeDismissed || (run.dismissedAt ?? null) === null;
    const applyRetention = (runs: Run[]): Run[] =>
      listRpcRequestIsFiltered(listParams)
        ? runs
            .filter((run) => runMatchesListRpcParams(run, listParams))
            .slice(0, listParams?.limit ?? FILTERED_LIST_DEFAULT_LIMIT)
        : retainListedRuns(runs);
    // Dismissal filter runs ahead of retention/filtered slicing: a dismissed run must not
    // consume a terminal-retention slot or a filtered-limit slot.
    const projectedRuns = applyRetention(store.listRuns().filter(isNotDismissed));
    const liveRunIds = new Set<string>();

    for (const activeRun of activeRuns.values()) {
      liveRunIds.add(activeRun.runId);
    }

    // Fold in dismissed siblings so the workflow index sees a complete invocation even when one
    // step run was filtered out above; siblings are indexed, not themselves listed.
    const indexInputRuns = new Map(projectedRuns.map((run) => [run.id, run]));
    for (const run of projectedRuns) {
      const fullRun = store.loadRun(run.id);
      const invocationId = fullRun?.workflowSnapshot?.invocationId;
      if (invocationId === undefined) continue;
      for (const sibling of store.findRunsByInvocationId(invocationId)) {
        if (!indexInputRuns.has(sibling.id)) indexInputRuns.set(sibling.id, sibling);
      }
    }
    const { fullRuns, workflowRuns } = indexListedRuns([...indexInputRuns.values()]);

    const runList = projectedRuns.map((run) => {
      const fullRun = fullRuns.get(run.id);
      const isLive = run.status === "in-progress" && liveRunIds.has(run.id);
      const reportedStatus = reportedRunStatus(run, fullRun);

      return buildRunListRow(run, fullRun, isLive, reportedStatus, workflowRuns, liveRunIds);
    });

    return { kind: "response", result: { runs: runList } };
  };

  const handleRunDismissalHandler =
    (mode: "dismiss" | "undismiss"): RpcHandler =>
    (frame) => {
      const params = frame.params as { runId?: unknown } | undefined;
      const runId = typeof params?.runId === "string" ? params.runId : "";
      if (runId.length === 0) {
        return { kind: "error", code: "invalid_params", message: "runId required" };
      }
      const dismissal = mode === "dismiss" ? store.dismissRun(runId) : store.undismissRun(runId);
      if (dismissal.kind === "refused") {
        return { kind: "response", result: dismissal };
      }
      // biome-ignore lint/style/noNonNullAssertion: dismissal returned non-refused, so the run is present
      const run = store.loadRun(runId)!;
      return { kind: "response", result: { ...dismissal, status: run.status } };
    };

  const dismissRunHandler = handleRunDismissalHandler("dismiss");
  const undismissRunHandler = handleRunDismissalHandler("undismiss");

  const pauseHandler: RpcHandler = (frame) => {
    const params = frame.params as { runId?: string } | undefined;
    if (!params?.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    const ks = ownershipKeyString({ project: run.project, branch: run.branch });
    const activeRun = activeRuns.get(ks) ?? activeRuns.get(runId);
    if (activeRun && activeRun.runId === runId && activeRun.kind === "write-loop") {
      activeRun.pauseController.abort();
      return { kind: "response", result: { ok: true } };
    }

    return { kind: "error", code: "run_not_active", message: `Run ${runId} is not currently active` };
  };

  const killHandler: RpcHandler = async (frame) => {
    const params = frame.params as { runId?: string; force?: boolean } | undefined;
    if (!params?.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    const ks = ownershipKeyString({ project: run.project, branch: run.branch });
    const activeRun = activeRuns.get(ks) ?? activeRuns.get(runId);
    if (activeRunAcceptsKill(activeRun, runId)) {
      activeRun.abortController.abort();
      if (activeRun.kind === "workflow") {
        activeRun.pendingKill = true;
        return { kind: "response", result: { ok: true } };
      }
      settleGuardedKill(store, runId);
      return { kind: "response", result: { ok: true } };
    }

    if (await forceSettleAdmitsRun(store, runId, run.status, params?.force)) {
      const admittedRun = store.loadRun(runId);
      if (admittedRun !== null && forceSettleStatusAdmitsRun(admittedRun.status)) {
        settleGuardedKill(store, runId);
        return { kind: "response", result: { ok: true } };
      }
    }

    return { kind: "error", code: "run_not_active", message: `Run ${runId} is not currently active` };
  };

  const resumePausedRun = (
    run: LoadedRun,
    key: OwnershipKey,
    runId: string,
  ): { kind: "response"; result: unknown } | { kind: "error"; code: string; message: string } => {
    const reconstructed = reconstructWriteResume(run, logReader?.tail(runId));
    if (!reconstructed.ok) {
      return {
        kind: "error",
        code: "resume_unsupported",
        message: reconstructed.message,
      };
    }
    const claimError = checkWorktreeClaimed(registry, key);
    if (claimError) return claimError;
    spawnWriteLoop(key, runId, run.worktreePath, reconstructed.input);
    return { kind: "response", result: { ok: true } };
  };

  const resumeFinalizationOnly = async (
    run: LoadedRun,
    key: OwnershipKey,
    execute: (deps: IntentFinalizationResumeDeps) => Promise<{ ok: true } | { ok: false; message: string }>,
    failureAsResponse = false,
  ): Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }> => {
    const claimError = checkWorktreeClaimed(registry, key);
    if (claimError) return claimError;
    registry.claim(key, { runId: run.id, worktreePath: run.worktreePath });
    const logSink = logsPath !== undefined ? openLogSink(logsPath) : undefined;
    const activeKey = ownershipKeyString(key);
    activeRuns.set(activeKey, { kind: "finalization", runId: run.id });
    try {
      const resumeDeps: IntentFinalizationResumeDeps = {
        ...intentFinalizationResumeDeps,
        ...(logSink !== undefined ? { logSink } : {}),
      };
      const outcome = await execute(resumeDeps);
      if (!outcome.ok) {
        if (failureAsResponse) return { kind: "response", result: outcome };
        return { kind: "error", code: "internal_error", message: outcome.message };
      }
      return { kind: "response", result: outcome };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attemptId = store.recordAttemptStart(run.id);
      store.commitCompletionBoundary({
        attemptId,
        runStatus: "failed",
        outcomeKind: "invocation_failure",
        invocationFailureDetail: { failureKind: "error", bindingAttempts: [], message },
      });
      logSink?.append(run.id, {
        kind: "loop_finished",
        loopOutcomeKind: "invocation_failure",
        iterationsConsumed: 0,
        resumable: false,
      });
      return { kind: "error", code: "internal_error", message };
    } finally {
      activeRuns.delete(activeKey);
      logSink?.close();
      registry.release(key);
    }
  };

  const resumeIntentFinalizationPublication = (
    run: LoadedRun,
    key: OwnershipKey,
  ): Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }> =>
    resumeFinalizationOnly(run, key, (deps) => resumePopulatedIntentPublication(run, store, deps));

  const resumeReviewMutationPublication = (
    run: LoadedRun,
    terminalRecord: TerminalLogRecord | undefined,
    key: OwnershipKey,
  ): Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }> =>
    resumeFinalizationOnly(run, key, (resumeDeps) =>
      resumeReviewMutationFinalization(run, store, terminalRecord, resumeDeps),
    );

  function terminalResumeBlocked(
    run: LoadedRun,
    runId: string,
  ): { kind: "error"; code: string; message: string } | undefined {
    const terminalRecord = logReader ? findTerminalLogRecord(logReader.tail(runId)) : undefined;
    const refusal = terminalResumeRefusalMessage(run, terminalRecord);
    if (refusal) {
      return { kind: "error", code: "terminal_run", message: refusal };
    }
    return undefined;
  }

  const resumeHandler: RpcHandler = async (frame) => {
    if (ctx.retiring) {
      return { kind: "error", code: "daemon_superseded", message: "Daemon is retiring and not accepting new work" };
    }
    const params = frame.params as { runId?: string } | undefined;
    if (!params?.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    // Checked ahead of the generic terminal-resume gate below: these two admission predicates carry
    // their own `status === "failed"` + row-shape checks, and the outcomes they admit
    // (`surviving_mutation_failed`, `ready_gate_failed`, `ready_gate_out_of_scope`,
    // `completion_commit_failed`, populated-intent
    // `landing_failed`) are not resumable under the generic operator-error mapping — deferring to
    // that gate first would wrongly strand a row this code can actually resume.
    if (isIntentFinalizationResumable(run, store)) {
      return resumeIntentFinalizationPublication(run, { project: run.project, branch: run.branch });
    }

    const terminalRecord = logReader ? findTerminalLogRecord(logReader.tail(runId)) : undefined;

    if (
      isReviewMutationResumable(run, store, terminalRecord) ||
      resolveExhaustedRedResumeContext(run, store, terminalRecord).ok ||
      resolveWriteOutOfScopeResumeContext(run, store, terminalRecord).ok
    ) {
      return resumeReviewMutationPublication(run, terminalRecord, { project: run.project, branch: run.branch });
    }

    const terminalError = terminalResumeBlocked(run, runId);
    if (terminalError) {
      return terminalError;
    }

    if (run.status === "paused") {
      const key: OwnershipKey = { project: run.project, branch: run.branch };
      return resumePausedRun(run, key, runId);
    }

    const logRecords = logReader?.tail(runId);
    const reconstructed = resumeContextForTerminalRecord(run, store, terminalRecord, undefined, logRecords);
    if (!reconstructed?.ok) {
      return {
        kind: "error",
        code: "resume_unsupported",
        message: reconstructed?.message ?? `Cannot resume a ${run.status} run`,
      };
    }
    const key: OwnershipKey = { project: run.project, branch: run.branch };
    const claimError = checkWorktreeClaimed(registry, key);
    if (claimError) return claimError;
    spawnWriteLoop(key, runId, run.worktreePath, reconstructed.input);

    return { kind: "response", result: { ok: true } };
  };

  const waitForWorkflowEntryRun = async (
    run: LoadedRun,
    snapshot: WorkflowSnapshot,
  ): Promise<{ kind: "response"; result: unknown }> => {
    const workflowPromise = workflowPromisesByEntryRunId.get(run.id);
    if (workflowPromise !== undefined) {
      await workflowPromise;
    }
    const rollupStatus = rollupWorkflowRunStatus({
      entryRun: run,
      workflowSnapshot: snapshot,
      siblingRuns: store.findRunsByInvocationId(snapshot.invocationId),
      isLive: false,
    });
    return { kind: "response", result: workflowEntryResult(run, snapshot, rollupStatus) };
  };

  /** Wait on a non-entry run: settle from the durable status, else follow the log to its terminal record. */
  const waitForLogTerminalRecord = async (
    reader: LogReader,
    run: LoadedRun,
    signal: AbortSignal,
  ): Promise<{ kind: "response"; result: unknown }> => {
    const runId = run.id;
    const records = reader.tail(runId);
    const subscribeSeq = records.at(-1)?.seq ?? 0;
    if (run.status !== "in-progress") {
      return { kind: "response", result: resultFrom(runId, run.status, findTerminalLogRecord(records)) };
    }

    const followController = new AbortController();
    waitAbortControllers.add(followController);
    const onExternalAbort = () => followController.abort();
    signal.addEventListener("abort", onExternalAbort, { once: true });

    try {
      if (signal.aborted) {
        throw new Error("wait aborted");
      }
      for await (const record of reader.follow(runId, followController.signal)) {
        if (record.seq <= subscribeSeq) continue;
        if (record.event.kind !== "loop_finished" && record.event.kind !== "run_execution_failed") continue;
        const terminalRecord = record as TerminalLogRecord;
        const runStatus = store.loadRun(runId)?.status ?? "failed";
        return { kind: "response", result: resultFrom(runId, runStatus, terminalRecord) };
      }
      throw new Error("wait aborted");
    } finally {
      signal.removeEventListener("abort", onExternalAbort);
      waitAbortControllers.delete(followController);
    }
  };

  const waitHandler: RpcHandler = async (frame, signal) => {
    if (!logReader) {
      return { kind: "error", code: "internal_error", message: "wait requires logReader" };
    }
    const params = frame.params as { runId?: string } | undefined;
    if (!params?.runId || typeof params.runId !== "string") {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    const entrySnapshot = workflowEntrySnapshot(run);
    return entrySnapshot !== undefined
      ? waitForWorkflowEntryRun(run, entrySnapshot)
      : waitForLogTerminalRecord(logReader, run, signal);
  };

  /** Thin closure around `handleWorkflowStart`, the seam `pipeline-stage-dispatch.ts` calls to dispatch a stage. */
  const defaultPipelineDispatch: PipelineWorkflowDispatch = async (steps) => {
    const started = await deps.handleWorkflowStart(steps);
    if (started.kind === "error") {
      return { ok: false, code: started.code, message: started.message };
    }
    const { runId } = started.result as { runId: string };
    const run = store.loadRun(runId);
    const invocationId = run?.workflowSnapshot?.invocationId;
    return { ok: true, entryRunId: runId, ...(invocationId !== undefined ? { invocationId } : {}) };
  };

  /** Thin closure around the `wait` machinery, reporting only the terminal rollup status. */
  const defaultPipelineWait: PipelineWorkflowWait = async (entryRunId) => {
    const run = store.loadRun(entryRunId);
    if (!run) return "failed";
    const entrySnapshot = workflowEntrySnapshot(run);
    if (entrySnapshot === undefined) return run.status;
    const outcome = await waitForWorkflowEntryRun(run, entrySnapshot);
    return (outcome.result as WaitRunCompletionResult).runStatus;
  };
  const pipelineDispatch = deps.pipelineDispatch ?? defaultPipelineDispatch;
  const pipelineWait = deps.pipelineWait ?? defaultPipelineWait;

  return {
    start: startHandler,
    list: listHandler,
    pause: pauseHandler,
    resume: resumeHandler,
    kill: killHandler,
    wait: waitHandler,
    dismiss: dismissRunHandler,
    undismiss: undismissRunHandler,
    pipelineDispatch,
    pipelineWait,
    resumeFinalizationOnly,
  };
}
