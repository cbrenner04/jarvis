import { readdirSync } from "node:fs";
import { join } from "node:path";
import { getExecutableTreeDigest } from "../../../shared/executable-tree.ts";
import { getCurrentHeadAsync } from "../../../shared/git.ts";
import { createResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import {
  FILTERED_LIST_DEFAULT_LIMIT,
  type ListRpcParams,
  listRpcRequestIsFiltered,
  runMatchesListRpcParams,
} from "../commands/run-list-rpc.ts";
import { resolveExecutableRole, resolveInvocationBindings } from "../config/agent-model-config.ts";
import { readIterationCeilingMs, resolveMachineProfile } from "../config/machine-config-loader.ts";
import {
  getExternalWorktreePath,
  withExternalWorktree as realWithExternalWorktree,
  WorktreeMaterializationError,
} from "../execution/external-worktree.ts";
import {
  type AnyWorkflowStep,
  executeWorkflow,
  LinkedIndexReadError,
  type ReviewProgress,
  workflowTelemetryLabel,
} from "../execution/workflow-runner.ts";
import { applyOperatorSessionId, executeWriteLoop, type WriteLoopInput } from "../execution/write-loop.ts";
import { connectIpcClient } from "../ipc/client";
import { createRpcTransport } from "../ipc/rpc-transport";
import { type IpcServer, type RpcHandler, type StreamHandler, startIpcServer } from "../ipc/server";
import { jarvisHome } from "../paths.ts";
import {
  type LogReader,
  type LogSink,
  type LoopFinishedEvent,
  openLogReader,
  openLogSink,
  type PersistedRecord,
} from "../persistence/log-stream.ts";
import {
  type Attempt,
  isTerminalRunStatus,
  openStateStore,
  type Run,
  type RunStatus,
  type StateStore,
  type WorkflowSnapshot,
} from "../persistence/state-store.ts";
import { hasMemoryHeadroom, loadSettleDelayMs } from "./memory-watermark.ts";
import {
  composeRunOperatorError,
  findTerminalLogRecord,
  isResumeAdmitted,
  type RunOperatorError,
  type TerminalLogRecord,
  terminalResumeRefusalMessage,
} from "./run-operator-error.ts";
import { workflowRowSnapshot } from "./workflow-list-snapshot.ts";
import { rollupWorkflowRunStatus } from "./workflow-run-status-rollup.ts";

type WorktreeOwnership = {
  runId: string;
  worktreePath: string;
  /** Workflow claims are validated against daemon-local workflow liveness. */
  workflow?: true;
};

export type OwnershipKey = {
  project: string;
  branch: string;
};

type ActiveRun =
  | {
      kind: "write-loop";
      runId: string;
      key: OwnershipKey;
      abortController: AbortController;
      pauseController: AbortController;
    }
  | {
      kind: "workflow";
      runId: string;
    };

export class DaemonDoubleClaimError extends Error {
  constructor(key: OwnershipKey) {
    super(worktreeClaimedMessage(key));
    this.name = "DaemonDoubleClaimError";
  }
}

function ownershipKeyString(key: OwnershipKey): string {
  return `${key.project}:${key.branch}`;
}

function worktreeClaimedMessage(key: OwnershipKey): string {
  return `Worktree already claimed for project=${key.project}, branch=${key.branch}`;
}

const LIST_TERMINAL_RUN_LIMIT = 50;

/** Marks orphaned runs before IPC is exposed. Review-debate rows are interrupted. */
export async function reconcileOrphanedRuns(
  stateStore: StateStore,
  logSink: LogSink,
  logReader?: LogReader,
): Promise<string[]> {
  const reconciledRunIds: string[] = [];
  for (const runId of await stateStore.beginRunReconciliation()) {
    const run = stateStore.loadRun(runId);
    const eventPersisted = logReader
      ?.tail(runId)
      .some(
        (record) =>
          record.event.kind === "run_reconciled" &&
          record.event.runStatus === run?.status &&
          record.event.reason === "daemon_restart",
      );
    if ((run?.status === "killed" || run?.status === "interrupted") && !eventPersisted) {
      logSink.append(runId, { kind: "run_reconciled", runStatus: run.status, reason: "daemon_restart" });
    }
    stateStore.finishRunReconciliation(runId);
    reconciledRunIds.push(runId);
  }
  return reconciledRunIds;
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

export class WorktreeOwnershipRegistry {
  private registry = new Map<string, WorktreeOwnership>();

  claim(key: OwnershipKey, ownership: WorktreeOwnership): void {
    const ks = ownershipKeyString(key);
    if (this.registry.has(ks)) {
      throw new DaemonDoubleClaimError(key);
    }
    this.registry.set(ks, ownership);
  }

  release(key: OwnershipKey, runId?: string): void {
    const ks = ownershipKeyString(key);
    if (runId !== undefined && this.registry.get(ks)?.runId !== runId) {
      return;
    }
    this.registry.delete(ks);
  }

  get(key: OwnershipKey): WorktreeOwnership | undefined {
    return this.registry.get(ownershipKeyString(key));
  }

  isClaimed(key: OwnershipKey): boolean {
    return this.registry.has(ownershipKeyString(key));
  }
}

/**
 * `(project, branch)` ownership key for a workflow start, derived from its first
 * step. A `write` step carries `worktree.projectName`/`worktree.branchName`;
 * review steps carry flat `project`/`branch` fields.
 */
export function workflowStartOwnershipKey(steps: AnyWorkflowStep[]): OwnershipKey {
  const firstStep = steps[0];
  if (!firstStep) {
    throw new Error("workflowStartOwnershipKey requires a non-empty steps array");
  }
  return firstStep.behavior === "write"
    ? { project: firstStep.worktree.projectName, branch: firstStep.worktree.branchName }
    : { project: firstStep.project, branch: firstStep.branch };
}

/**
 * The daemon shuts down when a stop was explicitly requested, or when it is
 * retiring (superseded) and no run is still active. A retiring daemon with an
 * active run stays up until that run settles.
 */
export function shouldShutdownNow(shutdownRequested: boolean, isRetiring: boolean, hasActiveRuns: boolean): boolean {
  return shutdownRequested || (isRetiring && !hasActiveRuns);
}

/**
 * Returns a `worktree_claimed` error result when a live run already holds
 * `key`, or `undefined` when the worktree is free to claim.
 */
export function checkWorktreeClaimed(
  registry: WorktreeOwnershipRegistry,
  key: OwnershipKey,
): { kind: "error"; code: "worktree_claimed"; message: string } | undefined {
  if (!registry.isClaimed(key)) {
    return undefined;
  }
  return {
    kind: "error",
    code: "worktree_claimed",
    message: worktreeClaimedMessage(key),
  };
}

/** Terminal or paused — any status with no live write loop to disturb. */
function isSettledRunStatus(status: RunStatus): boolean {
  return isTerminalRunStatus(status) || status === "paused";
}

/**
 * Production failure reporter: opens the log sink and appends one
 * `run_execution_failed` event. Used by {@link startDaemon}; exported for tests.
 */
export function createRunExecutionFailureReporter(logsPath: string): (runId: string, reason: unknown) => Promise<void> {
  return async (runId, _reason) => {
    const logSink = openLogSink(logsPath);
    try {
      logSink.append(runId, { kind: "run_execution_failed" });
    } finally {
      logSink.close();
    }
  };
}

export type ResolvedWriteLoopInput = { ok: true; input: WriteLoopInput } | { ok: false; message: string };

/**
 * Bindings crossing a JSON boundary must arrive as `bindingResolution` context and be
 * re-resolved here; serialized binding husks (post-JSON objects without `invoke`) are
 * rejected rather than stubbed.
 */
export function resolveWriteLoopBindings(input: WriteLoopInput): ResolvedWriteLoopInput {
  const context = input.bindingResolution;
  if (context !== undefined) {
    try {
      return {
        ok: true,
        input: {
          ...input,
          bindings: resolveInvocationBindings(
            resolveExecutableRole(context.role),
            context.agents,
            context.agentModelConfig,
            createResolvedAgentBinding,
          ),
        },
      };
    } catch (err) {
      return { ok: false, message: `Unable to resolve bindings: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const hasHusk = input.bindings.some(
    (binding) =>
      typeof binding !== "object" || binding === null || typeof (binding as { invoke?: unknown }).invoke !== "function",
  );
  if (input.bindings.length > 0 && hasHusk) {
    return {
      ok: false,
      message: "input carries serialized bindings without bindingResolution (role, agents, agentModelConfig)",
    };
  }

  return { ok: true, input };
}

function reconstructWriteResume(run: Run): ResolvedWriteLoopInput {
  const snapshot = run.workflowSnapshot;
  const stepId = run.stepId;
  const hiddenShrink = stepId?.endsWith("~shrink") === true;
  const step = snapshot?.steps.find(
    (candidate) => candidate.stepId === stepId || (hiddenShrink && candidate.stepId === stepId.slice(0, -7)),
  );

  if (!snapshot || !stepId || !step) return { ok: false, message: "run has no matching workflow snapshot step" };
  if (step.behavior === "review" || step.behavior === "review-debate") {
    return { ok: false, message: `step "${step.stepId}" is not an executable write step` };
  }
  if (step.stepRules?.trim() === "") return { ok: false, message: "snapshot step has empty rules" };
  if (step.expectedArtifactPath?.trim() === "") return { ok: false, message: "snapshot step has empty artifact path" };
  if (!step.stepRules || !step.expectedArtifactPath || !step.agents?.length || !step.agentModelConfig) {
    return { ok: false, message: "snapshot step is missing write resume context" };
  }

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
    ...(step.iterationTimeoutMs === undefined ? {} : { iterationTimeoutMs: step.iterationTimeoutMs }),
    iterationCeilingMs: step.iterationCeilingMs ?? readIterationCeilingMs(join(jarvisHome(), "config.json")),
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

function resumeContextForRun(
  run: Run & { attempts?: Attempt[] },
  terminalRecord?: TerminalLogRecord,
): ResolvedWriteLoopInput | undefined {
  // Admission is derived from the advertised row contract: if nextAction is
  // "resume", snapshot reconstruction proceeds; otherwise undefined.
  return isResumeAdmitted(run, terminalRecord) ? reconstructWriteResume(run) : undefined;
}

function resumeContextForTerminalRecord(
  run: (Run & { attempts?: Attempt[] }) | undefined,
  terminalRecord: TerminalLogRecord | undefined,
): ResolvedWriteLoopInput | undefined {
  if (!run) return undefined;
  return resumeContextForRun(run, terminalRecord);
}

function runListRowError(
  run: Parameters<typeof composeRunOperatorError>[0] | undefined,
  resumeContext: ResolvedWriteLoopInput | undefined,
  terminalRecord: TerminalLogRecord | undefined,
) {
  if (!run) return undefined;
  if (resumeContext?.ok === false) {
    return UNSUPPORTED_RESUME_ERROR;
  }
  return composeRunOperatorError(run, terminalRecord);
}

function runListFinishedAtMs(reportedStatus: RunStatus, fullRun: LoadedRun | undefined): number | undefined {
  if (!isTerminalRunStatus(reportedStatus) || fullRun === undefined) return undefined;
  let finishedAtMs: number | undefined;
  for (const attempt of fullRun.attempts) {
    if (attempt.completedAt === null) continue;
    if (finishedAtMs === undefined || attempt.completedAt > finishedAtMs) {
      finishedAtMs = attempt.completedAt;
    }
  }
  return finishedAtMs;
}

/**
 * Injectable dependencies for {@link createRunControlHandlers}.
 *
 * - `stateStore`: durable run rows — `createRun` on start, `listRuns`/`loadRun` on
 *   list/pause/resume/kill, `setRunStatus` on kill and spawn-boundary failure capture.
 * - `writeLoopExecutor`: write-loop body only; factory owns claim/release and
 *   fire-and-forget spawn. Log-sink open/close stays in {@link startDaemon}'s
 *   production wrapper. Executor rejections do not propagate to RPC callers.
 * - `failureReporter`: invoked on spawn-boundary executor rejection with the original
 *   rejection value; awaited before ownership release. Sync or async.
 */
export type RunControlHandlerDeps = {
  stateStore: StateStore;
  logReader?: LogReader;
  /** When set, workflow `start` passes a log sink into `executeWorkflow`. */
  logsPath?: string;
  /** Daemon session id stamped on workflow telemetry; required when `logsPath` is set. */
  operatorSessionId?: string;
  writeLoopExecutor: (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal) => Promise<void>;
  failureReporter: (runId: string, reason: unknown) => void | Promise<void>;
  /** `revise`'s dirty-worktree gate; defaults to a real `git status --porcelain` check. */
  /** `start`'s memory-watermark admission check; defaults to the real free-memory reader. */
  hasMemoryHeadroom?: () => boolean;
  /** Delay (ms) after promoting a queued run before the next promotion re-checks headroom; defaults to configured `memory.settleDelayMs`. */
  settleDelayMs?: number;
  /** Test seam for pre-existing daemon-memory ownership. */
  registry?: WorktreeOwnershipRegistry;
};

export type WaitRunCompletionResult = {
  runStatus: RunStatus;
  loopOutcomeKind?: LoopFinishedEvent["loopOutcomeKind"];
  iterationsConsumed?: number;
  resumable?: boolean;
  error?: RunOperatorError;
  /** Surviving worktree path; present when `runStatus` is `blocked`. */
  worktreePath?: string;
};

export type LoadedRun = NonNullable<ReturnType<StateStore["loadRun"]>>;

/** A workflow's step-0 row — the one whose reported status rolls up the whole workflow. */
function workflowEntrySnapshot(run: LoadedRun | undefined): WorkflowSnapshot | undefined {
  const snapshot = run?.workflowSnapshot;
  if (snapshot === null || snapshot === undefined) return undefined;
  return run?.stepId === snapshot.steps[0]?.stepId ? snapshot : undefined;
}

function workflowSurvivingMutationOwner(
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
      terminalRecord.event.loopOutcomeKind !== "surviving_mutation_failed"
    ) {
      continue;
    }
    if (owner === undefined || terminalRecord.ts > owner.terminalRecord.ts) {
      owner = { run: sibling, terminalRecord: terminalRecord as PersistedRecord & { event: LoopFinishedEvent } };
    }
  }
  return owner;
}

export function projectWorkflowEntryResult(
  entryResult: WaitRunCompletionResult | undefined,
  entryCanResume: boolean,
): WaitRunCompletionResult {
  return {
    runStatus: entryResult?.runStatus ?? "failed",
    ...(entryResult?.loopOutcomeKind !== undefined
      ? {
          loopOutcomeKind: entryResult.loopOutcomeKind,
          ...(entryResult.iterationsConsumed === undefined
            ? {}
            : { iterationsConsumed: entryResult.iterationsConsumed }),
          ...(entryResult.resumable === undefined ? {} : { resumable: entryCanResume ? entryResult.resumable : false }),
        }
      : {}),
    ...(entryResult?.error === undefined
      ? {}
      : { error: entryCanResume ? entryResult.error : { ...entryResult.error, retryable: false, nextAction: "stop" } }),
  };
}

export type { WorkflowStepListStatus } from "./workflow-list-snapshot.ts";
export { stoppedOutcomeForRun } from "./workflow-list-snapshot.ts";

/** Mutated by {@link promoteQueuedRunImpl} on each promotion; shared across calls. */
export type PromotionSettleState = { suppressedUntil: number };

export type PromoteQueuedRunDeps = {
  store: StateStore;
  registry: WorktreeOwnershipRegistry;
  checkMemoryHeadroom: () => boolean;
  settleDelayMs: () => number;
  settleState: PromotionSettleState;
  spawnWriteLoop: (key: OwnershipKey, runId: string, worktreePath: string, input: WriteLoopInput) => void;
};

/**
 * FIFO-with-skip promotion: the oldest `queued` run whose `(project, branch)`
 * is unclaimed is promoted into free headroom. Skips (rather than stops on)
 * a queued run whose key is currently claimed, trying the next-oldest
 * instead. Promotes at most one run per call; a settle delay after each
 * promotion suppresses further promotions until it elapses, except when
 * `bypassSettleDelay` is set (the one-time immediate recheck `start`
 * performs on the row it just queued).
 */
export function promoteQueuedRunImpl(deps: PromoteQueuedRunDeps, bypassSettleDelay = false): void {
  const { store, registry, checkMemoryHeadroom, settleDelayMs, settleState, spawnWriteLoop } = deps;
  if (!bypassSettleDelay && Date.now() < settleState.suppressedUntil) {
    return;
  }
  // A write loop's fire-and-forget settle path can promote after shutdown (or
  // test teardown) has closed the store; skip rather than throw on a closed DB.
  if (store.isClosed()) {
    return;
  }

  for (const run of store.listQueuedRuns()) {
    const key: OwnershipKey = { project: run.project, branch: run.branch };
    if (registry.isClaimed(key)) {
      continue;
    }
    if (!checkMemoryHeadroom()) {
      return;
    }

    if (!run.queuedInput) {
      continue;
    }

    const resolved = resolveWriteLoopBindings(run.queuedInput);
    if (!resolved.ok) {
      store.setRunStatus(run.id, "failed");
      continue;
    }

    store.setRunStatus(run.id, "in-progress");
    spawnWriteLoop(key, run.id, run.worktreePath, resolved.input);
    settleState.suppressedUntil = Date.now() + settleDelayMs();
    return;
  }
}

/**
 * Run-control handler factory for `start`/`list`/`pause`/`resume`/`kill`.
 *
 * @param deps - {@link RunControlHandlerDeps}
 * @returns `{ start, list, pause, resume, kill }` — each an {@link RpcHandler}.
 *   Handlers signal rejections via `{ kind: "error", code, message }`; they do not throw.
 * @throws Never — factory and handlers are non-throwing at the RPC boundary.
 * @invariant Each invocation gets a fresh `WorktreeOwnershipRegistry` and `activeRuns` map.
 * @invariant Write loops spawn fire-and-forget; settlement always releases registry and
 *   active-run entries. Spawn-boundary executor rejections best-effort persist `failed`,
 *   await `failureReporter`, then release — they do not propagate to RPC callers.
 */
export function createRunControlHandlers(deps: RunControlHandlerDeps) {
  const _registry = deps.registry ?? new WorktreeOwnershipRegistry();
  const activeRuns = new Map<string, ActiveRun>();
  const waitAbortControllers = new Set<AbortController>();
  let retiring = false;
  /**
   * Live/terminal role progress for review steps, keyed by `invocationId` then
   * `stepId` — mirroring `runsByWorkflowInvocation`'s scoping so two concurrent invocations
   * sharing a `stepId` don't collide. Tracked in-memory only — a review step has
   * no durable run row, so this map is the sole source for its `list` row, populated via
   * `reportReviewDebateProgress`.
   */
  const reviewDebateProgressByInvocation = new Map<string, Map<string, ReviewProgress>>();
  const reportReviewProgress = (invocationId: string, stepId: string, progress: ReviewProgress): void => {
    let steps = reviewDebateProgressByInvocation.get(invocationId);
    if (!steps) {
      steps = new Map<string, ReviewProgress>();
      reviewDebateProgressByInvocation.set(invocationId, steps);
    }
    steps.set(stepId, progress);
  };
  // Tracks `executeWorkflow` promises by entry run id (step 0), allowing wait to await the full workflow
  const workflowPromisesByEntryRunId = new Map<string, Promise<void>>();
  const { stateStore: store, logReader, writeLoopExecutor, failureReporter, logsPath, operatorSessionId } = deps;
  const checkMemoryHeadroom = deps.hasMemoryHeadroom ?? (() => hasMemoryHeadroom(resolveMachineProfile()));
  const injectedSettleDelayMs = deps.settleDelayMs;
  const settleDelayMs: () => number =
    injectedSettleDelayMs !== undefined
      ? () => injectedSettleDelayMs
      : () => loadSettleDelayMs(resolveMachineProfile());
  const settleState: PromotionSettleState = { suppressedUntil: 0 };

  const resultFrom = (runId: string, runStatus: RunStatus, record?: TerminalLogRecord): WaitRunCompletionResult => {
    const run = store.loadRun(runId);
    const resumeContext = run ? resumeContextForRun(run, record) : undefined;
    const unsupportedResume = resumeContext?.ok === false;
    const composed = run && !unsupportedResume ? composeRunOperatorError(run, record) : undefined;
    const error = unsupportedResume ? UNSUPPORTED_RESUME_ERROR : composed;
    const admittedResumable = composed?.nextAction === "resume";
    const base: WaitRunCompletionResult =
      record?.event.kind === "loop_finished"
        ? {
            runStatus,
            loopOutcomeKind: record.event.loopOutcomeKind,
            iterationsConsumed: record.event.iterationsConsumed,
            resumable: admittedResumable,
          }
        : { runStatus };
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
    const owner = workflowSurvivingMutationOwner(entryRun, rollupStatus, siblingRuns, logReader);
    if (owner === undefined) {
      return resultFrom(entryRun.id, rollupStatus, entryRecord);
    }

    // Built from the owner row's own operator error, not `resultFrom`: `resultFrom`'s
    // unsupported-resume masking answers "can this exact row be resumed?", which for a
    // review-step owner is always no and would blank out the mutation reason/detail below.
    // Entry resumability is projected separately via `entryCanResume`, so that masking
    // does not apply here.
    const ownerError = composeRunOperatorError(owner.run, owner.terminalRecord);
    const entryResult: WaitRunCompletionResult = {
      runStatus: rollupStatus,
      loopOutcomeKind: owner.terminalRecord.event.loopOutcomeKind,
      iterationsConsumed: owner.terminalRecord.event.iterationsConsumed,
      resumable: ownerError?.nextAction === "resume",
      ...(ownerError === undefined ? {} : { error: ownerError }),
    };
    const entryResumeContext = resumeContextForTerminalRecord(entryRun, entryRecord);
    const entryCanResume = entryResumeContext?.ok === true;
    return projectWorkflowEntryResult(entryResult, entryCanResume);
  };

  const spawnWriteLoop = (key: OwnershipKey, runId: string, worktreePath: string, input: WriteLoopInput): void => {
    const ks = ownershipKeyString(key);
    const abortController = new AbortController();
    const pauseController = new AbortController();
    activeRuns.set(ks, { kind: "write-loop", runId, key, abortController, pauseController });

    _registry.claim(key, { runId, worktreePath });

    (async () => {
      try {
        await writeLoopExecutor(input, abortController.signal, pauseController.signal);
      } catch (reason) {
        try {
          const run = store.loadRun(runId);
          if (run && !isSettledRunStatus(run.status)) {
            store.setRunStatus(runId, "failed");
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
        _registry.release(key);
        promoteQueuedRun();
      }
    })();
  };

  const promoteQueuedRun = (bypassSettleDelay = false): void => {
    if (retiring) {
      return;
    }
    promoteQueuedRunImpl(
      { store, registry: _registry, checkMemoryHeadroom, settleDelayMs, settleState, spawnWriteLoop },
      bypassSettleDelay,
    );
  };

  /**
   * Demote one non-terminal workflow run to `failed` and record why. Both steps are
   * best-effort and independent: a persist fault must not skip the log append, and an
   * append fault must not roll back the demote. Already-settled runs keep their status
   * but still get the log record — a workflow can die after its step runs completed
   * (e.g. in a review step or publication), and that failure must stay visible.
   */
  const settleFailedWorkflowRun = (runId: string, message: string, logSink: LogSink | undefined): void => {
    const run = store.loadRun(runId);
    if (!(run && isSettledRunStatus(run.status))) {
      try {
        store.setRunStatus(runId, "failed");
      } catch {
        // best-effort persist; append still runs
      }
    }
    try {
      logSink?.append(runId, { kind: "run_execution_failed", message });
    } catch {
      // append failure does not roll back the demote
    }
  };

  /**
   * Start a multi-step workflow: dispatch to `executeWorkflow` and resolve once step 0's
   * run row is durably created, letting the workflow continue running in the background.
   * A failure before that row exists (e.g. invalid step shape) settles the promise with
   * an error instead of hanging. `workflowKey` stays claimed in `_registry` for the whole
   * run (not just until step 0 resolves) so a later start on the same `(project, branch)`
   * is blocked until this workflow finishes or fails.
   */
  const startWorkflowRun = (
    steps: AnyWorkflowStep[],
    workflowKey: OwnershipKey,
    claimRunId: string,
  ): Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }> => {
    return new Promise((resolve) => {
      const workflowRunIds = new Set<string>();
      let entryRunId: string | undefined;
      let trackPromiseResolve: (() => void) | undefined;
      const trackPromise = new Promise<void>((res) => {
        trackPromiseResolve = () => res();
      });
      const logSink = logsPath !== undefined ? openLogSink(logsPath) : undefined;
      const telemetry =
        operatorSessionId !== undefined ? { operatorSessionId, workflow: workflowTelemetryLabel(steps) } : undefined;
      const execute = async () => {
        const firstStep = steps[0];
        if (firstStep?.behavior === "write" && firstStep.role === "implement" && firstStep.linkedIndexRouting) {
          await (firstStep.withExternalWorktree ?? realWithExternalWorktree)(firstStep.worktree, () => undefined);
        }
        return executeWorkflow({
          steps,
          stateStore: store,
          freshDispatch: true,
          ...(logSink !== undefined ? { logSink } : {}),
          ...(telemetry !== undefined ? { telemetry } : {}),
          onReviewDebateProgress: reportReviewProgress,
          onStepRunCreated: (stepIndex, runId) => {
            workflowRunIds.add(runId);
            activeRuns.set(runId, { kind: "workflow", runId });
            if (stepIndex === 0) {
              entryRunId = runId;
              workflowPromisesByEntryRunId.set(runId, trackPromise);
              resolve({ kind: "response", result: { runId } });
            }
          },
        });
      };
      execute()
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Workflow execution failed (${workflowTelemetryLabel(steps)}): ${message}`);
          if (workflowRunIds.size === 0) {
            resolve({
              kind: "error",
              code:
                err instanceof WorktreeMaterializationError
                  ? "worktree_materialization_failed"
                  : err instanceof LinkedIndexReadError
                    ? "routing_read_failed"
                    : "invalid_params",
              message,
            });
          }
          for (const runId of workflowRunIds) {
            settleFailedWorkflowRun(runId, message, logSink);
          }
        })
        .finally(() => {
          logSink?.close();
          for (const runId of workflowRunIds) activeRuns.delete(runId);
          activeRuns.delete(claimRunId);
          if (entryRunId !== undefined) {
            workflowPromisesByEntryRunId.delete(entryRunId);
          }
          _registry.release(workflowKey, claimRunId);
          trackPromiseResolve?.();
        });
    });
  };

  type StartResult =
    | { kind: "response"; result: unknown }
    | { kind: "error"; code: string; message: string }
    | Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }>;

  const handleWorkflowStart = (steps: AnyWorkflowStep[]): StartResult => {
    if (steps.length === 0) {
      return { kind: "error", code: "invalid_params", message: "steps must not be empty" };
    }
    const firstStep = steps[0];
    if (firstStep?.behavior === "review-debate") {
      return {
        kind: "error",
        code: "invalid_params",
        message: "Workflow start's first step must not be review-debate: it has no durable run row",
      };
    }
    if (firstStep?.behavior === "write" && firstStep.workflowInvocationId !== undefined) {
      const existing = store.findRunByProjectBranch({
        project: firstStep.worktree.projectName,
        branch: firstStep.worktree.branchName,
        stepId: firstStep.stepId,
      });
      if (
        existing?.workflowSnapshot?.invocationId !== undefined &&
        existing.workflowSnapshot.invocationId !== firstStep.workflowInvocationId &&
        !isTerminalRunStatus(existing.status)
      ) {
        return {
          kind: "error",
          code: "worktree_claimed",
          message: "intent: existing workflow is owned by another invocation; resume the recorded invocation",
        };
      }
    }
    const workflowKey = workflowStartOwnershipKey(steps);
    if (store.hasQueuedRun(workflowKey)) {
      return {
        kind: "error",
        code: "worktree_claimed",
        message: worktreeClaimedMessage(workflowKey),
      };
    }
    const existingWorkflowClaim = _registry.get(workflowKey);
    if (existingWorkflowClaim?.workflow === true && activeRuns.get(existingWorkflowClaim.runId)?.kind !== "workflow") {
      _registry.release(workflowKey);
    }
    const workflowClaimError = checkWorktreeClaimed(_registry, workflowKey);
    if (workflowClaimError) {
      return workflowClaimError;
    }
    if (!checkMemoryHeadroom()) {
      return {
        kind: "error",
        code: "insufficient_memory",
        message: "Insufficient memory headroom to start workflow",
      };
    }
    const worktreePath = firstStep?.behavior === "write" ? getExternalWorktreePath(firstStep.worktree) : "";
    const claimRunId = crypto.randomUUID();
    _registry.claim(workflowKey, { runId: claimRunId, worktreePath, workflow: true });
    activeRuns.set(claimRunId, { kind: "workflow", runId: claimRunId });
    return startWorkflowRun(steps, workflowKey, claimRunId);
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
    const claimError = checkWorktreeClaimed(_registry, key);
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
      ...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
      ...(input.workflowSnapshot !== undefined ? { workflowSnapshot: input.workflowSnapshot } : {}),
    });

    spawnWriteLoop(key, runId, worktreePath, input);
    promoteQueuedRun();

    return { kind: "response", result: { runId } };
  };

  const startHandler: RpcHandler = (frame) => {
    if (retiring) {
      return { kind: "error", code: "daemon_superseded", message: "Daemon is retiring and not accepting new work" };
    }
    const params = frame.params as { input?: WriteLoopInput; steps?: AnyWorkflowStep[] } | undefined;
    const hasInput = params?.input !== undefined;
    const hasSteps = params?.steps !== undefined;

    if (hasInput === hasSteps) {
      return { kind: "error", code: "invalid_params", message: "Provide exactly one of input or steps" };
    }

    return hasSteps
      ? handleWorkflowStart(params?.steps as AnyWorkflowStep[])
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

  /** Status reported for a listed row: workflow entry rows roll up, everything else is durable. */
  const reportedRunStatus = (run: Run, fullRun: LoadedRun | undefined): RunStatus => {
    const entrySnapshot = workflowEntrySnapshot(fullRun);
    if (entrySnapshot === undefined) return run.status;
    return rollupWorkflowRunStatus({
      entryRun: run,
      workflowSnapshot: entrySnapshot,
      siblingRuns: store.findRunsByInvocationId(entrySnapshot.invocationId),
      isLive: workflowPromisesByEntryRunId.has(run.id),
    });
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
    const terminalRecord = findTerminalLogRecord(logReader?.tail(run.id) ?? []);
    const entrySnapshot = workflowEntrySnapshot(fullRun);
    const entryResult =
      entrySnapshot === undefined || fullRun === undefined
        ? undefined
        : workflowEntryResult(fullRun, entrySnapshot, reportedStatus);
    const error =
      entryResult?.error ??
      runListRowError(fullRun, resumeContextForTerminalRecord(fullRun, terminalRecord), terminalRecord);
    const {
      runStatus: _entryRunStatus,
      error: _entryError,
      worktreePath: _entryWorktreePath,
      ...entryOutcomeFields
    } = entryResult ?? { runStatus: reportedStatus };

    const finishedAtMs = runListFinishedAtMs(reportedStatus, fullRun);

    return {
      runId: run.id,
      project: run.project,
      branch: run.branch,
      status: reportedStatus,
      isLive,
      ...entryOutcomeFields,
      ...(error !== undefined ? { error } : {}),
      ...runListReviewFields(snapshot),
      ...(fullRun?.stepId !== null && fullRun?.stepId !== undefined ? { stepId: fullRun.stepId } : {}),
      ...(fullRun !== undefined && snapshot !== undefined
        ? { workflow: workflowRowSnapshot(fullRun, workflowRuns, liveRunIds, reviewDebateProgressByInvocation) }
        : {}),
      ...(reportedStatus === "blocked" ? { worktreePath: run.worktreePath } : {}),
      ...runListPrEvidence(run),
      ...(finishedAtMs !== undefined ? { finishedAtMs } : {}),
    };
  };

  const listHandler: RpcHandler = (frame) => {
    const listParams = frame.params as ListRpcParams | undefined;
    let durableRuns = store.listRuns();
    if (listRpcRequestIsFiltered(listParams)) {
      durableRuns = durableRuns
        .filter((run) => runMatchesListRpcParams(run, listParams))
        .slice(0, listParams?.limit ?? FILTERED_LIST_DEFAULT_LIMIT);
    } else {
      durableRuns = retainListedRuns(durableRuns);
    }
    const liveRunIds = new Set<string>();

    for (const activeRun of activeRuns.values()) {
      liveRunIds.add(activeRun.runId);
    }

    const { fullRuns, workflowRuns } = indexListedRuns(durableRuns);

    const runList = durableRuns.map((run) => {
      const fullRun = fullRuns.get(run.id);
      const isLive = run.status === "in-progress" && liveRunIds.has(run.id);
      const reportedStatus = reportedRunStatus(run, fullRun);

      return buildRunListRow(run, fullRun, isLive, reportedStatus, workflowRuns, liveRunIds);
    });

    return { kind: "response", result: { runs: runList } };
  };

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

  const killHandler: RpcHandler = (frame) => {
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
      activeRun.abortController.abort();
      store.commitGuardedKill(runId);
      return { kind: "response", result: { ok: true } };
    }

    return { kind: "error", code: "run_not_active", message: `Run ${runId} is not currently active` };
  };

  const resumePausedRun = (
    run: LoadedRun,
    key: OwnershipKey,
    runId: string,
  ): { kind: "response"; result: unknown } | { kind: "error"; code: string; message: string } => {
    const reconstructed = reconstructWriteResume(run);
    if (!reconstructed.ok) {
      return {
        kind: "error",
        code: "resume_unsupported",
        message: reconstructed.message,
      };
    }
    const claimError = checkWorktreeClaimed(_registry, key);
    if (claimError) return claimError;
    spawnWriteLoop(key, runId, run.worktreePath, reconstructed.input);
    return { kind: "response", result: { ok: true } };
  };

  function terminalResumeBlocked(
    run: LoadedRun,
    runId: string,
  ): { kind: "error"; code: string; message: string } | undefined {
    const terminalRecord = logReader ? findTerminalLogRecord(logReader.tail(runId)) : undefined;
    const refusalMessage = terminalResumeRefusalMessage(run, terminalRecord);
    if (refusalMessage !== undefined) {
      return { kind: "error", code: "terminal_run", message: refusalMessage };
    }
    return undefined;
  }

  const resumeHandler: RpcHandler = async (frame) => {
    if (retiring) {
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

    const terminalError = terminalResumeBlocked(run, runId);
    if (terminalError) {
      return terminalError;
    }

    if (run.status === "paused") {
      const key: OwnershipKey = { project: run.project, branch: run.branch };
      return resumePausedRun(run, key, runId);
    }

    const terminalRecord = logReader ? findTerminalLogRecord(logReader.tail(runId)) : undefined;
    const reconstructed = resumeContextForTerminalRecord(run, terminalRecord);
    if (!reconstructed?.ok) {
      return {
        kind: "error",
        code: "resume_unsupported",
        message: reconstructed?.message ?? `Cannot resume a ${run.status} run`,
      };
    }
    const key: OwnershipKey = { project: run.project, branch: run.branch };
    const claimError = checkWorktreeClaimed(_registry, key);
    if (claimError) return claimError;
    spawnWriteLoop(key, runId, run.worktreePath, reconstructed.input);

    return { kind: "response", result: { ok: true } };
  };

  /**
   * Wait on a workflow entry run: await the in-flight workflow promise if the workflow is still
   * live, then report the rollup status over its sibling step rows.
   */
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

  const hasActiveRuns = (): boolean => activeRuns.size > 0;

  const setRetiring = (): void => {
    retiring = true;
  };

  const isRetiring = (): boolean => retiring;

  return {
    start: startHandler,
    list: listHandler,
    pause: pauseHandler,
    resume: resumeHandler,
    kill: killHandler,
    wait: waitHandler,
    /** Records a review step's currently-executing or terminal role/outcome. */
    reportReviewDebateProgress: reportReviewProgress,
    /** Aborts every in-flight `wait` follow loop so it unwinds. */
    close: (): void => {
      for (const controller of waitAbortControllers) {
        controller.abort();
      }
      waitAbortControllers.clear();
    },
    /** Whether daemon has any active runs (write loops or workflows). */
    hasActiveRuns,
    /** Set the daemon to retiring state, rejecting new starts and resumes. */
    setRetiring,
    /** Whether daemon is currently retiring. */
    isRetiring,
  };
}

/**
 * Injectable dependencies for {@link createTailStreamHandler}.
 *
 * `loadRun` and `follow`/`onData` failures propagate to IPC as error `stream-end`.
 */
export type TailStreamHandlerDeps = {
  stateStore: StateStore;
  logReader: LogReader;
};

function parseTailStreamParams(payload: unknown): { runId: string; afterSeq: number } | undefined {
  const params = typeof payload === "string" && payload ? JSON.parse(payload) : payload;
  if (typeof params !== "object" || params === null) return undefined;
  const runId = (params as { runId?: unknown }).runId;
  if (typeof runId !== "string") return undefined;
  const afterSeq = (params as { afterSeq?: unknown }).afterSeq;
  const parsedAfterSeq = typeof afterSeq === "number" && afterSeq >= 0 ? afterSeq : 0;
  return { runId, afterSeq: parsedAfterSeq };
}

async function streamRunLogRecords(
  deps: TailStreamHandlerDeps,
  runId: string,
  afterSeq: number,
  onData: (record: PersistedRecord) => void,
  signal: AbortSignal,
): Promise<void> {
  const run = deps.stateStore.loadRun(runId);
  if (!run) return;

  const replay = deps.logReader.tail(runId);
  let subscribeSeq = afterSeq;
  for (const record of replay) {
    if (signal.aborted) return;
    if (record.seq <= afterSeq) continue;
    onData(record);
    subscribeSeq = record.seq;
  }

  if (run.status !== "in-progress") return;

  for await (const record of deps.logReader.follow(runId, signal)) {
    if (signal.aborted) break;
    if (record.seq <= subscribeSeq) continue;
    onData(record);
  }
}

/**
 * Tail-log stream handler factory for IPC `stream-open` on run logs.
 *
 * @param deps - {@link TailStreamHandlerDeps}
 * @throws N/A at factory call — returned handler may throw/reject on string-payload `JSON.parse`,
 *   `loadRun`, `follow`, or `onData` failures; IPC server maps those to error `stream-end`.
 */
export function createTailStreamHandler(deps: TailStreamHandlerDeps): StreamHandler {
  return async (_streamId, payload, onData, onClose, signal) => {
    const params = parseTailStreamParams(payload);
    if (!params || !deps.stateStore.loadRun(params.runId)) {
      onClose();
      return;
    }

    try {
      await streamRunLogRecords(deps, params.runId, params.afterSeq, onData, signal);
    } finally {
      onClose();
    }
  };
}

export type EnumerateOtherDaemonSockets = (jarvisHomeDir: string, ownSocketPath: string) => string[];

export type SupersedePeerDaemon = (socketPath: string) => Promise<void>;

export type DaemonStartupDeps = {
  logsPath?: string;
  openLogSink?: typeof openLogSink;
  startIpcServer?: typeof startIpcServer;
  recoverReconciledRuns?: typeof recoverReconciledRuns;
  enumerateOtherDaemonSockets?: EnumerateOtherDaemonSockets;
  supersedePeerDaemon?: SupersedePeerDaemon;
  /** Defaults to `process.exit`. */
  processExit?: (code: number) => never;
};

export async function recoverReconciledRuns(
  runIds: readonly string[],
  stateStore: StateStore,
  logSink: LogSink,
  resume: RpcHandler,
): Promise<{ resumed: number }> {
  let resumed = 0;
  for (const runId of runIds) {
    const response = await resume(
      { kind: "request", id: `restart-recovery-${runId}`, method: "resume", params: { runId } },
      new AbortController().signal,
    );
    if (response.kind === "response") {
      logSink.append(runId, { kind: "run_recovery", outcome: "resumed" });
      resumed += 1;
      continue;
    }
    // Missing snapshot context remains a safe, inspectable killed row.
    if (response.code === "resume_unsupported") continue;

    const message = `Automatic restart recovery admission failed: ${response.message}`;
    try {
      stateStore.setRunStatus(runId, "failed");
    } catch {
      // Log the diagnostic even if persistence is unavailable.
    }
    try {
      logSink.append(runId, { kind: "run_recovery", outcome: "failed", message });
    } catch {
      // One bad recovery log must not prevent other admissions.
    }
  }
  return { resumed };
}

/**
 * Default implementation: enumerate `daemon-*.sock` files in jarvisHome,
 * excluding the daemon's own socket path.
 */
export function enumerateOtherDaemonSockets(jarvisHomeDir: string, ownSocketPath: string): string[] {
  try {
    const entries = readdirSync(jarvisHomeDir);
    return entries
      .filter((entry) => entry.match(/^daemon-[a-f0-9]{16}\.sock$/))
      .map((entry) => join(jarvisHomeDir, entry))
      .filter((path) => path !== ownSocketPath);
  } catch {
    return [];
  }
}

/**
 * Default implementation: connect to a peer daemon socket and send `supersede`.
 * Errors are ignored (socket unreachable, RPC error, etc.).
 */
export async function supersedePeerDaemon(socketPath: string): Promise<void> {
  try {
    const client = await connectIpcClient(socketPath);
    const transport = createRpcTransport(client);
    try {
      await transport.request("supersede", undefined, { timeoutMs: 1_000 });
    } finally {
      transport.close();
    }
  } catch {
    // Ignore all errors: unreachable socket, RPC failure, timeout, etc.
  }
}

export async function startDaemonRuntime(
  socketPath: string,
  stateStore?: StateStore,
  logReader?: LogReader,
  startupDeps: DaemonStartupDeps = {},
): Promise<{ close: () => Promise<void> }> {
  const store = stateStore ?? openStateStore();
  const logsPath = startupDeps.logsPath ?? join(jarvisHome(), "state", "logs.jsonl");
  const logReaderInstance = logReader ?? openLogReader(logsPath);
  const createLogSink = startupDeps.openLogSink ?? openLogSink;
  const processExit = startupDeps.processExit ?? process.exit;
  const reconciliationLogSink = createLogSink(logsPath);
  let reconciledRunIds: string[];
  try {
    reconciledRunIds = await reconcileOrphanedRuns(store, reconciliationLogSink, logReaderInstance);
  } finally {
    reconciliationLogSink.close();
  }
  let shutdownRequested = false;
  const operatorSessionId = crypto.randomUUID();

  let loadedRevision: string;
  let loadedExecutableDigest: string;
  try {
    loadedRevision = await getCurrentHeadAsync(import.meta.dir, realAsyncSubprocessRunner);
    loadedExecutableDigest = await getExecutableTreeDigest(import.meta.dir, realAsyncSubprocessRunner);
  } catch {
    loadedRevision = "unknown";
    loadedExecutableDigest = "unknown";
  }

  const writeLoopExecutor = async (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal) => {
    const logSink = openLogSink(logsPath);
    try {
      await executeWriteLoop({
        ...applyOperatorSessionId(input, operatorSessionId),
        stateStore: store,
        logSink,
        signal,
        pauseSignal,
      });
    } finally {
      logSink.close();
    }
  };

  const tailStreamHandler = createTailStreamHandler({ stateStore: store, logReader: logReaderInstance });

  const healthHandler: RpcHandler = () => {
    return { kind: "response", result: { ok: true } };
  };

  let recoveryStatus = { pending: true, reconciled: reconciledRunIds.length, resumed: 0 };
  const statusHandler: RpcHandler = () => {
    return {
      kind: "response",
      result: { state: "running", loadedRevision, loadedExecutableDigest, recovery: recoveryStatus },
    };
  };

  const shutdownHandler: RpcHandler = () => {
    shutdownRequested = true;
    return { kind: "response", result: { ok: true } };
  };

  const {
    reportReviewDebateProgress: _reportReviewDebateProgress,
    close: _closeRunControlHandlers,
    setRetiring,
    hasActiveRuns,
    isRetiring,
    ...runControlHandlers
  } = createRunControlHandlers({
    stateStore: store,
    logReader: logReaderInstance,
    logsPath,
    operatorSessionId,
    writeLoopExecutor,
    failureReporter: createRunExecutionFailureReporter(logsPath),
  });

  const supersedHandler: RpcHandler = () => {
    setRetiring();
    return { kind: "response", result: { ok: true } };
  };

  const handlers: Record<string, RpcHandler> = {
    health: healthHandler,
    status: statusHandler,
    shutdown: shutdownHandler,
    supersede: supersedHandler,
    ...runControlHandlers,
  };

  let server: IpcServer;

  try {
    server = await (startupDeps.startIpcServer ?? startIpcServer)(socketPath, handlers, tailStreamHandler);
  } catch (err) {
    console.error(`Failed to start IPC server on ${socketPath}:`, err);
    process.exit(1);
  }

  // Send supersede to peer daemons after our server is listening, best-effort and non-blocking.
  const enumerateSockets = startupDeps.enumerateOtherDaemonSockets ?? enumerateOtherDaemonSockets;
  const supersedePeer = startupDeps.supersedePeerDaemon ?? supersedePeerDaemon;
  (async () => {
    const peerSockets = enumerateSockets(jarvisHome(), socketPath);
    for (const peerSocket of peerSockets) {
      await supersedePeer(peerSocket);
    }
  })().catch(() => {
    // Ignore errors: the supersede pass is best-effort.
  });

  const recoveryLogSink = createLogSink(logsPath);
  try {
    const recovery = await (startupDeps.recoverReconciledRuns ?? recoverReconciledRuns)(
      reconciledRunIds,
      store,
      recoveryLogSink,
      runControlHandlers.resume,
    );
    recoveryStatus = { ...recoveryStatus, pending: false, resumed: recovery?.resumed ?? 0 };
  } finally {
    recoveryLogSink.close();
  }

  const signalHandler = () => {
    shutdownRequested = true;
  };

  process.on("SIGTERM", signalHandler);
  process.on("SIGINT", signalHandler);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(checkShutdown);
    process.off("SIGTERM", signalHandler);
    process.off("SIGINT", signalHandler);
    _closeRunControlHandlers();
    await server.close();
    if (!logReader) {
      const closeable = logReaderInstance as { close?: () => void };
      closeable.close?.();
    }
    if (!stateStore) {
      store.close();
    }
  };

  // Extracted so both directions of the retiring/active-runs guard are unit-testable
  // without a real timer (the deterministic-daemon-test guard forbids one).
  const checkShutdown = setInterval(() => {
    const shouldShutdown = shouldShutdownNow(shutdownRequested, isRetiring(), hasActiveRuns());
    if (shouldShutdown) {
      void close()
        .then(() => {
          processExit(0);
        })
        .catch((err: unknown) => {
          console.error("Error during shutdown:", err);
          processExit(1);
        });
    }
  }, 100);

  console.error(`Daemon running on socket ${socketPath} with PID ${process.pid}`);
  return { close };
}
