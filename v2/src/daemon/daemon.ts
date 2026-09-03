import { join } from "node:path";
import { getExecutableTreeDigest } from "../../../shared/executable-tree.ts";
import { getCurrentHeadAsync } from "../../../shared/git.ts";
import {
  createResolvedAgentBinding,
  type ResolvedAgentBinding,
  type ResolvedAgentBindingOptions,
} from "../../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import {
  type AgentModelConfig,
  type LoadError,
  resolveExecutableRole,
  resolveInvocationBindings,
} from "../config/agent-model-config.ts";
import {
  readCodexSandboxMode,
  readNotificationSinkCommand,
  resolveMachineProfile,
} from "../config/machine-config-loader.ts";
import { loadMachineProfileModels } from "../config/machine-profile-loader.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import { applyOperatorSessionId, executeWriteLoop, type WriteLoopInput } from "../execution/write-loop.ts";
import { type IpcServer, type RpcHandler, startIpcServer } from "../ipc/server";
import { jarvisHome } from "../paths.ts";
import {
  type LogReader,
  type LogSink,
  type LoopFinishedEvent,
  openLogReader,
  openLogSink,
} from "../persistence/log-stream.ts";
import {
  isTerminalRunStatus,
  openStateStore,
  type Run,
  type RunStatus,
  type StateStore,
} from "../persistence/state-store.ts";
import {
  type EnumerateOtherDaemonSockets,
  enumerateOtherDaemonSockets,
  type SupersedePeerDaemon,
  supersedePeerDaemon,
} from "./daemon-peer-socket.ts";
import { createPipelineHandlers } from "./daemon-pipeline-handlers.ts";
import {
  createRunControlHandlerContext,
  daemonFailureDetail,
  ownershipKeyString,
  type RunControlHandlerContextDeps,
} from "./daemon-run-control-context.ts";
import { createRunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";
import { createTailStreamHandler } from "./daemon-tail-stream.ts";
import { createImplementRecoverHandler, createWorkflowStartAdmission } from "./daemon-workflow-admission-handlers.ts";
import {
  NOTIFICATION_SWEEP_INTERVAL_MS,
  type NotificationSinkSpawner,
  runNotificationSweep,
} from "./operator-notification-sweep.ts";
import { type RunOperatorError } from "./run-operator-error.ts";

export type WorktreeOwnership = {
  runId: string;
  worktreePath: string;
  /** Workflow claims are validated against daemon-local workflow liveness. */
  workflow?: true;
};

export type OwnershipKey = {
  project: string;
  branch: string;
};

export type ActiveRun =
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
      abortController: AbortController;
      pendingKill?: true;
    }
  | {
      kind: "finalization";
      runId: string;
    }
  | {
      kind: "recovery";
      runId: string;
    };

/**
 * Whether `kill` may abort the named durable run id (write-loop or live workflow row).
 *
 * Authorization is liveness and identity only — deliberately no stall, idle-age, or progress
 * predicate. Four prior attempts gated kill on a stall discriminant and all failed because every
 * such signal coincides with the run terminating, so no `(live ∧ reapable)` state was observable.
 */
export function activeRunAcceptsKill(
  activeRun: ActiveRun | undefined,
  runId: string,
): activeRun is ActiveRun & { abortController: AbortController } {
  if (!activeRun || activeRun.runId !== runId) return false;
  return activeRun.kind === "write-loop" || activeRun.kind === "workflow";
}

/** Whether `kill`'s force path may settle `status`: any non-terminal status, `killed` included. */
export function forceSettleStatusAdmitsRun(status: RunStatus): boolean {
  return !isTerminalRunStatus(status);
}

function reconciliationTerminalStatus(run: Run): "killed" | "interrupted" | undefined {
  if (isTerminalRunStatus(run.status)) return undefined;
  const isReviewDebate = run.workflowSnapshot?.steps.some(
    (step) => step.stepId === run.stepId && step.behavior === "review-debate",
  );
  return isReviewDebate ? "interrupted" : "killed";
}

export function settleGuardedKill(store: StateStore, runId: string): void {
  const run = store.loadRun(runId);
  if (!run || isTerminalRunStatus(run.status)) return;
  store.commitTerminalRunSettlement({ runId, status: "killed" });
}

/**
 * Whether `kill`'s force path may settle a row: `force` must be set, the row must be
 * non-terminal, and its owner must be this process or provably dead — refuses a
 * different still-live owner.
 */
export async function forceSettleAdmitsRun(
  store: StateStore,
  runId: string,
  status: RunStatus,
  force: boolean | undefined,
): Promise<boolean> {
  if (force !== true) return false;
  if (!forceSettleStatusAdmitsRun(status)) return false;
  return store.forceKillOwnerAdmits(runId);
}

export class DaemonDoubleClaimError extends Error {
  constructor(key: OwnershipKey) {
    super(worktreeClaimedMessage(key));
    this.name = "DaemonDoubleClaimError";
  }
}

function worktreeClaimedMessage(key: OwnershipKey): string {
  return `Worktree already claimed for project=${key.project}, branch=${key.branch}`;
}

/** Marks orphaned runs before IPC is exposed. Review-debate rows are interrupted. */
export async function reconcileOrphanedRuns(
  stateStore: StateStore,
  logSink: LogSink,
  logReader?: LogReader,
): Promise<string[]> {
  const reconciledRunIds: string[] = [];
  for (const runId of await stateStore.beginRunReconciliation()) {
    let run = stateStore.loadRun(runId);
    const terminalStatus = run === null ? undefined : reconciliationTerminalStatus(run);
    if (terminalStatus !== undefined) {
      stateStore.commitTerminalRunSettlement({ runId, status: terminalStatus });
      run = stateStore.loadRun(runId);
    }
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
 * True when a workflow entry run's invocation is still live: its promise is tracked *and* at least
 * one tracked row is a workflow row.
 *
 * A `write-loop` row must not satisfy this — it belongs to an unrelated ad-hoc run, and counting it
 * would report a settled workflow entry as still running.
 */
export function workflowInvocationIsLive(
  hasTrackedEntryPromise: boolean,
  trackedRuns: Iterable<{ kind: string }>,
): boolean {
  if (!hasTrackedEntryPromise) return false;
  for (const row of trackedRuns) {
    if (row.kind === "workflow") return true;
  }
  return false;
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

/** Same workflow `start` claim predicate as after stale workflow reclaim, without registry mutation. */
export function previewWorkflowStartClaimAdmissionRefusal(
  store: Pick<StateStore, "hasQueuedRun">,
  registry: WorktreeOwnershipRegistry,
  activeRuns: Map<string, ActiveRun>,
  key: OwnershipKey,
): { kind: "error"; code: "worktree_claimed"; message: string } | undefined {
  if (store.hasQueuedRun(key)) {
    return {
      kind: "error",
      code: "worktree_claimed",
      message: worktreeClaimedMessage(key),
    };
  }
  const existingWorkflowClaim = registry.get(key);
  if (existingWorkflowClaim?.workflow === true && activeRuns.get(existingWorkflowClaim.runId)?.kind !== "workflow") {
    return undefined;
  }
  return checkWorktreeClaimed(registry, key);
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

type WriteLoopBindingSourceDeps = {
  machineConfigPath?: string;
  machinesDir?: string;
  /** When true, replay `bindingResolution.agentModelConfig` (guard tests only). */
  forceSnapshotAgentModelConfig?: boolean;
  /** Injected into production binding options so tests can observe spawned argv (tests only). */
  bindingSpawn?: ResolvedAgentBindingOptions["spawn"];
  /** Redirects Codex session snapshotting away from `~/.codex` (tests only). */
  codexSessionsDir?: string;
};

/**
 * Production binding factory. Stamps the configured Codex sandbox mode onto every write/implement
 * binding so both fresh and rehydrated resolution paths select the operator-trusted sandbox.
 */
export function productionAgentBindingFactory(): (binding: ResolvedAgentBinding) => InvocationBinding {
  const opts: ResolvedAgentBindingOptions = {
    codexSandboxMode: readCodexSandboxMode(writeLoopBindingSourceDeps.machineConfigPath),
  };
  if (writeLoopBindingSourceDeps.bindingSpawn !== undefined) opts.spawn = writeLoopBindingSourceDeps.bindingSpawn;
  if (writeLoopBindingSourceDeps.codexSessionsDir !== undefined) {
    opts.codexSessionsDir = writeLoopBindingSourceDeps.codexSessionsDir;
  }
  return (binding) => createResolvedAgentBinding(binding, opts);
}

let writeLoopBindingSourceDeps: WriteLoopBindingSourceDeps = {};

export function setWriteLoopBindingSourceDepsForTests(deps: WriteLoopBindingSourceDeps): void {
  writeLoopBindingSourceDeps = deps;
}

export function resetWriteLoopBindingSourceDepsForTests(): void {
  writeLoopBindingSourceDeps = {};
}

/** Release workflow registry claim and persist deferred kills in settlement order. */
export function settleKilledWorkflowOwnership(args: {
  killedRunIds: readonly string[];
  releaseRegistry: () => void;
  stateStore: StateStore;
}): void {
  for (const runId of args.killedRunIds) settleGuardedKill(args.stateStore, runId);
  args.releaseRegistry();
}

export function runWithWriteLoopMachineConfigPath<T>(machineConfigPath: string | undefined, fn: () => T): T {
  const prior = writeLoopBindingSourceDeps;
  writeLoopBindingSourceDeps = machineConfigPath === undefined ? prior : { ...prior, machineConfigPath };
  try {
    return fn();
  } finally {
    writeLoopBindingSourceDeps = prior;
  }
}

function isLoadError(value: AgentModelConfig | LoadError): value is LoadError {
  return "errors" in value && Array.isArray(value.errors);
}

/** Same loader path as fresh write-step admission (`loadWorkflowSteps` / `jarvis write`). */
function loadAgentModelConfigForWriteLoopAgents(agents: readonly string[]): AgentModelConfig {
  const profile = resolveMachineProfile(writeLoopBindingSourceDeps.machineConfigPath);
  const loaded = loadMachineProfileModels(profile, agents, {
    machinesDir: writeLoopBindingSourceDeps.machinesDir,
  });
  if (isLoadError(loaded)) {
    throw new Error(`Failed to load agent model config: ${loaded.errors.join(", ")}`);
  }
  return loaded;
}

function resolveWriteLoopAgentModelConfig(context: NonNullable<WriteLoopInput["bindingResolution"]>): AgentModelConfig {
  if (writeLoopBindingSourceDeps.forceSnapshotAgentModelConfig) {
    return context.agentModelConfig;
  }
  return loadAgentModelConfigForWriteLoopAgents(context.agents);
}

/**
 * Bindings crossing a JSON boundary must arrive as `bindingResolution` context and be
 * re-resolved here; serialized binding husks (post-JSON objects without `invoke`) are
 * rejected rather than stubbed.
 */
export function resolveWriteLoopBindings(input: WriteLoopInput): ResolvedWriteLoopInput {
  const context = input.bindingResolution;
  if (context !== undefined) {
    try {
      const agentModelConfig = resolveWriteLoopAgentModelConfig(context);
      return {
        ok: true,
        input: {
          ...input,
          bindings: resolveInvocationBindings(
            resolveExecutableRole(context.role),
            context.agents,
            agentModelConfig,
            productionAgentBindingFactory(),
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

export function runListTerminalFinishAtMs(
  attempts: Array<{ completedAt: number | null }>,
  reconciledAt: number | null | undefined,
  finishedAt: number | null | undefined,
): number | undefined {
  let finishedAtMs: number | undefined;
  if (finishedAt != null) {
    finishedAtMs = finishedAt;
  }
  for (const attempt of attempts) {
    if (attempt.completedAt === null) continue;
    if (finishedAtMs === undefined || attempt.completedAt > finishedAtMs) {
      finishedAtMs = attempt.completedAt;
    }
  }
  if (reconciledAt != null) {
    if (finishedAtMs === undefined || reconciledAt > finishedAtMs) {
      finishedAtMs = reconciledAt;
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
/**
 * Read bound for the intent-stage stale-reset preflight's self-RPCs (`list`, `check_workflow_start_claim`).
 * These are fast local handlers; the bound only exists so a wedged reply can't hang the preflight
 * indefinitely (`connectIpcClient`'s own 5s bound covers connect, not reply). On timeout the preflight
 * fails open (see `runSharedStaleResetPreflight`). Defined in `daemon-pipeline-handlers.ts`.
 */

export type RunControlHandlerDeps = RunControlHandlerContextDeps;

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
      : {
          error:
            entryCanResume || entryResult.error.reason === "mutation_repair_exhausted"
              ? entryResult.error
              : { ...entryResult.error, retryable: false, nextAction: "stop" },
        }),
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
      store.commitTerminalRunSettlement({
        runId: run.id,
        status: "failed",
        terminalCause: "invocation_failure",
        terminalFailureDetail: daemonFailureDetail("model_config", resolved.message),
      });
      continue;
    }

    store.setRunStatus(run.id, "in-progress");
    spawnWriteLoop(key, run.id, run.worktreePath, resolved.input);
    settleState.suppressedUntil = Date.now() + settleDelayMs();
    return;
  }
}

/**
 * Run-control handler factory: lifecycle, workflow admission, pipeline RPCs, and control seams.
 *
 * @param deps - {@link RunControlHandlerDeps}
 * @returns Handler map — lifecycle (`start`, `list`, `pause`, `resume`, `kill`, `wait`, `dismiss`,
 *   `undismiss`), workflow admission (`check_workflow_start_claim`, `implement.recover`),
 *   pipeline (`pipeline_start`, `pipeline_approve`, `pipeline_reject`, `pipeline_resume`,
 *   `pipeline_recover`, `pipeline_dismiss`, `pipeline_undismiss`, `pipeline_list`,
 *   `pipeline_wait`, `continueContinuablePipelines`), test seam (`pipelineExecutionDeps`),
 *   review-progress hooks, `close`/`hasActiveRuns`/`setRetiring`/`isRetiring`, and shared
 *   `context`. Each RPC handler signals rejections via `{ kind: "error", code, message }`; they do
 *   not throw.
 * @throws Never — factory and handlers are non-throwing at the RPC boundary.
 * @invariant Each invocation gets a fresh `activeRuns` map; `deps.registry` is injectable and
 *   otherwise defaults to a new `WorktreeOwnershipRegistry`.
 * @invariant Write loops spawn fire-and-forget; settlement always releases registry and
 *   active-run entries. Spawn-boundary executor rejections best-effort settle `failed`,
 *   await `failureReporter`, then release — they do not propagate to RPC callers.
 */
export function createRunControlHandlers(deps: RunControlHandlerDeps) {
  const ctx = createRunControlHandlerContext(deps);
  const activeRuns = ctx.activeRuns;
  const waitAbortControllers = ctx.waitAbortControllers;
  const reportReviewProgress = ctx.reportReviewProgress;
  const clearLiveReviewProgress = ctx.clearLiveReviewProgress;

  const workflowStart = createWorkflowStartAdmission(ctx);
  const {
    handleWorkflowStart,
    admitWorkflowStart,
    check_workflow_start_claim: checkWorkflowStartClaimHandler,
  } = workflowStart;

  const lifecycle = createRunLifecycleHandlers(ctx, {
    handleWorkflowStart,
    ...(deps.pipelineDispatch !== undefined ? { pipelineDispatch: deps.pipelineDispatch } : {}),
    ...(deps.pipelineWait !== undefined ? { pipelineWait: deps.pipelineWait } : {}),
  });
  const {
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
  } = lifecycle;

  const implementRecoverHandler = createImplementRecoverHandler(ctx, {
    resumeFinalizationOnly: lifecycle.resumeFinalizationOnly,
  });

  const pipeline = createPipelineHandlers(ctx, {
    pipelineDispatch,
    pipelineWait,
    admitWorkflowStart,
    ...(deps.resolveStage !== undefined ? { resolveStage: deps.resolveStage } : {}),
    ...(deps.recoveryAttempt !== undefined ? { recoveryAttempt: deps.recoveryAttempt } : {}),
    ...(deps.recoveryLogSinkFactory !== undefined ? { recoveryLogSinkFactory: deps.recoveryLogSinkFactory } : {}),
    ...(deps.executeTerminalPublication !== undefined
      ? { executeTerminalPublication: deps.executeTerminalPublication }
      : {}),
    ...(deps.daemonSocketPath !== undefined ? { daemonSocketPath: deps.daemonSocketPath } : {}),
    ...(deps.connectStaleResetClient !== undefined ? { connectStaleResetClient: deps.connectStaleResetClient } : {}),
    ...(deps.staleResetCliDeps !== undefined ? { staleResetCliDeps: deps.staleResetCliDeps } : {}),
    ...(deps.reconciledRunIds !== undefined ? { reconciledRunIds: deps.reconciledRunIds } : {}),
  });

  const hasActiveRuns = (): boolean => activeRuns.size > 0;

  const setRetiring = (): void => {
    ctx.retiring = true;
  };

  const isRetiring = (): boolean => ctx.retiring;

  const handlersOut = {
    start: startHandler,
    "implement.recover": implementRecoverHandler,
    check_workflow_start_claim: checkWorkflowStartClaimHandler,
    list: listHandler,
    pause: pauseHandler,
    resume: resumeHandler,
    kill: killHandler,
    wait: waitHandler,
    dismiss: dismissRunHandler,
    undismiss: undismissRunHandler,
    pipeline_start: pipeline.pipeline_start,
    pipeline_approve: pipeline.pipeline_approve,
    pipeline_reject: pipeline.pipeline_reject,
    pipeline_resume: pipeline.pipeline_resume,
    pipeline_recover: pipeline.pipeline_recover,
    pipeline_dismiss: pipeline.pipeline_dismiss,
    pipeline_undismiss: pipeline.pipeline_undismiss,
    pipeline_list: pipeline.pipeline_list,
    pipeline_wait: pipeline.pipeline_wait,
    continueContinuablePipelines: pipeline.continueContinuablePipelines,
    /** Non-RPC seam: exposes the built pipeline-execution deps so tests can assert stale-reset wiring. */
    pipelineExecutionDeps: pipeline.pipelineExecutionDeps,
    /** Records a review step's currently-executing or terminal role/outcome. */
    reportReviewDebateProgress: reportReviewProgress,
    /** Clears live review progress for an invocation; frozen terminal snapshots are retained. */
    clearLiveReviewDebateProgress: clearLiveReviewProgress,
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
    context: ctx,
  };
  return handlersOut;
}

export type DaemonStartupDeps = {
  logsPath?: string;
  openLogSink?: typeof openLogSink;
  startIpcServer?: typeof startIpcServer;
  recoverReconciledRuns?: typeof recoverReconciledRuns;
  enumerateOtherDaemonSockets?: EnumerateOtherDaemonSockets;
  supersedePeerDaemon?: SupersedePeerDaemon;
  readNotificationSinkCommand?: () => string | undefined;
  notificationSpawnSink?: NotificationSinkSpawner;
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
      stateStore.commitTerminalRunSettlement({
        runId,
        status: "failed",
        terminalCause: "invocation_failure",
        terminalFailureDetail: daemonFailureDetail("error", message),
      });
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
    clearLiveReviewDebateProgress: _clearLiveReviewDebateProgress,
    close: _closeRunControlHandlers,
    continueContinuablePipelines,
    setRetiring,
    hasActiveRuns,
    isRetiring,
    pipelineExecutionDeps: _pipelineExecutionDeps,
    context: _runControlContext,
    ...runControlHandlers
  } = createRunControlHandlers({
    stateStore: store,
    logReader: logReaderInstance,
    logsPath,
    operatorSessionId,
    writeLoopExecutor,
    failureReporter: createRunExecutionFailureReporter(logsPath),
    // Load-bearing: this is the only production wire that enables the pipeline intent-stage
    // stale-reset preflight. Removing it silently reverts the daemon to constructing no bundle
    // (the historical no-op); the unit test injects `daemonSocketPath` directly and cannot catch that.
    daemonSocketPath: socketPath,
    reconciledRunIds,
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
    await continueContinuablePipelines();
    await store.reconcilePipelines();
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

  const readSink = startupDeps.readNotificationSinkCommand ?? (() => readNotificationSinkCommand());
  const notificationSweepDeps = {
    store,
    readSinkCommand: readSink,
    ...(startupDeps.notificationSpawnSink === undefined ? {} : { spawnSink: startupDeps.notificationSpawnSink }),
  };
  runNotificationSweep(notificationSweepDeps);
  const notificationSweepTimer = setInterval(() => {
    runNotificationSweep(notificationSweepDeps);
  }, NOTIFICATION_SWEEP_INTERVAL_MS);
  notificationSweepTimer.unref();

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
    clearInterval(notificationSweepTimer);
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
