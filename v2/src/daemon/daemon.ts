import { dirname, join } from "node:path";
import { getExecutableTreeDigest } from "../../../shared/executable-tree.ts";
import { getCurrentHeadAsync } from "../../../shared/git.ts";
import {
  createResolvedAgentBinding,
  type ResolvedAgentBinding,
  type ResolvedAgentBindingOptions,
} from "../../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { type AsyncSubprocessRunner, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import {
  type AgentModelConfig,
  isLoadError,
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
import { connectIpcClient } from "../ipc/client.ts";
import { createRpcTransport } from "../ipc/rpc-transport.ts";
import {
  DaemonSocketBindFailureError,
  formatDaemonBindFailureLogLine,
  type IpcServer,
  type RpcHandler,
  removeUnansweredSocketPath,
  startIpcServer,
} from "../ipc/server";
import { daemonPathsByDigest, jarvisHome } from "../paths.ts";
import {
  type LogReader,
  type LogSink,
  type LoopFinishedEvent,
  openLogReader,
  openLogSink,
} from "../persistence/log-stream.ts";
import { isTerminalRunStatus, openStateStore, type RunStatus, type StateStore } from "../persistence/state-store.ts";
import { DEFAULT_HANDOFF_FALLBACK_MS } from "./daemon-changeover.ts";
import {
  type DrainObserver,
  observePredecessorDrain,
  observeRunOwnership,
  unionLiveRunIds,
} from "./daemon-drain-observer.ts";
import { startDaemon } from "./daemon-lifecycle.ts";
import {
  createNotificationListHandler,
  createNotificationWaitHandler,
  NotificationWaitRegistry,
} from "./daemon-notification-wait.ts";
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
import { reconcileOrphanedRuns } from "./daemon-run-reconciliation.ts";
import { createTailStreamHandler } from "./daemon-tail-stream.ts";
import { createImplementRecoverHandler, createWorkflowStartAdmission } from "./daemon-workflow-admission-handlers.ts";
import {
  NOTIFICATION_SWEEP_INTERVAL_MS,
  type NotificationSinkSpawner,
  runNotificationSweep,
  runNotificationSweepIntervalTick,
} from "./operator-notification-sweep.ts";
import type { KillSurvivor } from "./run-kill-outcome.ts";
import type { RunOperatorError } from "./run-operator-error.ts";
import { startStableDigestTrigger } from "./stable-digest-trigger.ts";

export { reconcileOrphanedRuns };

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
      abortController: AbortController;
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
  return activeRun.kind === "write-loop" || activeRun.kind === "workflow" || activeRun.kind === "finalization";
}

/** Whether `kill`'s force path may settle `status`: any non-terminal status, `killed` included. */
export function forceSettleStatusAdmitsRun(status: RunStatus): boolean {
  return !isTerminalRunStatus(status);
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

/** Signal every verifier process group recorded on any of `runIds`; returns the signalled ids. */
export function signalRecordedVerifierProcessGroups(store: StateStore, runIds: Iterable<string>): number[] {
  const signalled = new Set<number>();
  for (const runId of runIds) {
    for (const pgid of store.verifierProcessGroups(runId)) {
      if (signalled.has(pgid)) continue;
      signalled.add(pgid);
      signalReadyGateProcessGroup(pgid);
    }
  }
  return [...signalled];
}

/** Processes still alive in any of `pgids`, each with its current parent pid (`ps -A -o pid=,ppid=,pgid=`). */
export async function observeProcessGroupSurvivors(
  pgids: readonly number[],
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<KillSurvivor[]> {
  if (pgids.length === 0) return [];
  const wanted = new Set(pgids);
  let table: string;
  try {
    table = await runner.runAsync("ps", ["-A", "-o", "pid=,ppid=,pgid="], ".");
  } catch {
    return [];
  }
  const survivors: KillSurvivor[] = [];
  for (const line of table.split("\n")) {
    const [pid, ppid, pgid] = line
      .trim()
      .split(/\s+/)
      .map((field) => Number.parseInt(field, 10));
    if (pid === undefined || pgid === undefined || !Number.isInteger(pid) || !wanted.has(pgid)) continue;
    survivors.push({ pid, ppid: ppid !== undefined && Number.isInteger(ppid) ? ppid : null });
  }
  return survivors;
}

/** Signal a recorded process group with SIGTERM then SIGKILL after the shared 50ms grace. */
export function signalReadyGateProcessGroup(pgid: number): void {
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    // already gone (ESRCH) or not permitted (EPERM); treat as already-dead.
  }
  setTimeout(() => {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      // already gone (ESRCH) or not permitted (EPERM); treat as already-dead.
    }
  }, 50).unref?.();
}

/**
 * Reap every recorded finalization verifier process group (ready gate, required integration,
 * diff-derived mutation verifier, runtime smoke probe, base-ref reproduction probe) whose owning
 * run is not live, clearing exactly the swept id so sibling groups recorded later stay bound.
 */
export async function sweepOrphanReadyGateGroups(store: StateStore): Promise<void> {
  for (const { runId, readyGatePgid } of await store.listReadyGateSweepCandidates()) {
    signalReadyGateProcessGroup(readyGatePgid);
    store.clearVerifierProcessGroup(runId, readyGatePgid);
  }
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
export function shouldShutdownNow(
  shutdownRequested: boolean,
  isRetiring: boolean,
  hasActiveRuns: boolean,
  handoffPending = false,
): boolean {
  return shutdownRequested || (isRetiring && !hasActiveRuns && !handoffPending);
}

/**
 * Wires the drain-exit check on an interval: once `shouldShutdown` reads true (see
 * {@link shouldShutdownNow}), it closes the daemon and exits — an outgoing generation whose
 * active-run set empties while retiring exits on its own, owning nothing public. Extracted from
 * `startDaemonRuntime` so the wiring itself, not just the guard, is exercisable against a real
 * `close()`/socket-file outcome without spinning up a full daemon.
 */
export function startDrainExitLoop(deps: {
  shouldShutdown: () => boolean;
  close: () => Promise<void>;
  processExit: (code: number) => void;
  intervalMs?: number;
}): { stop: () => void } {
  const timer = setInterval(() => {
    if (deps.shouldShutdown()) {
      void deps
        .close()
        .then(() => {
          deps.processExit(0);
        })
        .catch((err: unknown) => {
          console.error("Error during shutdown:", err);
          deps.processExit(1);
        });
    }
  }, deps.intervalMs ?? 100);
  return { stop: () => clearInterval(timer) };
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

export type WriteLoopBindingSourceDeps = {
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
export function productionAgentBindingFactory(
  deps: WriteLoopBindingSourceDeps = {},
): (binding: ResolvedAgentBinding) => InvocationBinding {
  const opts: ResolvedAgentBindingOptions = {
    codexSandboxMode: readCodexSandboxMode(deps.machineConfigPath),
  };
  if (deps.bindingSpawn !== undefined) opts.spawn = deps.bindingSpawn;
  if (deps.codexSessionsDir !== undefined) {
    opts.codexSessionsDir = deps.codexSessionsDir;
  }
  return (binding) => createResolvedAgentBinding(binding, opts);
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

/** Same loader path as fresh write-step admission (`loadWorkflowSteps`). */
function loadAgentModelConfigForWriteLoopAgents(
  agents: readonly string[],
  deps: WriteLoopBindingSourceDeps,
): AgentModelConfig {
  const profile = resolveMachineProfile(deps.machineConfigPath);
  const loaded = loadMachineProfileModels(profile, agents, {
    machinesDir: deps.machinesDir,
  });
  if (isLoadError(loaded)) {
    throw new Error(`Failed to load agent model config: ${loaded.errors.join(", ")}`);
  }
  return loaded;
}

function resolveWriteLoopAgentModelConfig(
  context: NonNullable<WriteLoopInput["bindingResolution"]>,
  deps: WriteLoopBindingSourceDeps,
): AgentModelConfig {
  if (deps.forceSnapshotAgentModelConfig) {
    return context.agentModelConfig;
  }
  return loadAgentModelConfigForWriteLoopAgents(context.agents, deps);
}

/**
 * Bindings crossing a JSON boundary must arrive as `bindingResolution` context and be
 * re-resolved here; serialized binding husks (post-JSON objects without `invoke`) are
 * rejected rather than stubbed.
 */
export function resolveWriteLoopBindings(
  input: WriteLoopInput,
  deps: WriteLoopBindingSourceDeps = {},
): ResolvedWriteLoopInput {
  const context = input.bindingResolution;
  if (context !== undefined) {
    try {
      const agentModelConfig = resolveWriteLoopAgentModelConfig(context, deps);
      return {
        ok: true,
        input: {
          ...input,
          bindings: resolveInvocationBindings(
            resolveExecutableRole(context.role),
            context.agents,
            agentModelConfig,
            productionAgentBindingFactory(deps),
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

type RunControlHandlerDeps = RunControlHandlerContextDeps;

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

/** Mutated by {@link promoteQueuedRunImpl} on each promotion; shared across calls. */
export type PromotionSettleState = { suppressedUntil: number };

export type PromoteQueuedRunDeps = {
  store: StateStore;
  registry: WorktreeOwnershipRegistry;
  checkMemoryHeadroom: () => boolean;
  settleDelayMs: () => number;
  settleState: PromotionSettleState;
  spawnWriteLoop: (key: OwnershipKey, runId: string, worktreePath: string, input: WriteLoopInput) => void;
  writeLoopBindingSourceDeps?: WriteLoopBindingSourceDeps;
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
  const {
    store,
    registry,
    checkMemoryHeadroom,
    settleDelayMs,
    settleState,
    spawnWriteLoop,
    writeLoopBindingSourceDeps = {},
  } = deps;
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

    const resolved = resolveWriteLoopBindings(run.queuedInput, writeLoopBindingSourceDeps);
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
 * @returns Handler map — lifecycle (`start`, `list`, `list_owned`, `pause`, `resume`, `kill`, `wait`, `dismiss`,
 *   `undismiss`), workflow admission (`check_workflow_start_claim`, `implement.recover`),
 *   pipeline (`pipeline_start`, `pipeline_approve`, `pipeline_reject`, `pipeline_resume`,
 *   `pipeline_recover`, `pipeline_dismiss`, `pipeline_undismiss`, `pipeline_list`,
 *   `pipeline_wait`, `pipeline_owner`, `continueContinuablePipelines`), test seam (`pipelineExecutionDeps`),
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
    listOwned: listOwnedHandler,
    liveRunIds: liveRunIdsHandler,
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

  const notificationWaitRegistry = deps.notificationWaitRegistry ?? new NotificationWaitRegistry();
  const notification_wait = createNotificationWaitHandler(ctx.store, notificationWaitRegistry);
  const notification_list = createNotificationListHandler(ctx.store);
  const wakeNotificationWaiters = (): void => {
    notificationWaitRegistry.wakeFromStore(ctx.store);
  };

  const handlersOut = {
    start: startHandler,
    "implement.recover": implementRecoverHandler,
    check_workflow_start_claim: checkWorkflowStartClaimHandler,
    list: listHandler,
    list_owned: listOwnedHandler,
    live_run_ids: liveRunIdsHandler,
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
    pipeline_owner: pipeline.pipeline_owner,
    notification_wait,
    notification_list,
    continueContinuablePipelines: pipeline.continueContinuablePipelines,
    /** Non-RPC seam: exposes the built pipeline-execution deps so tests can assert stale-reset wiring. */
    pipelineExecutionDeps: pipeline.pipelineExecutionDeps,
    /** Records a review step's currently-executing or terminal role/outcome. */
    reportReviewDebateProgress: reportReviewProgress,
    /** Clears live review progress for an invocation; frozen terminal snapshots are retained. */
    clearLiveReviewDebateProgress: clearLiveReviewProgress,
    /** Wakes armed `notification_wait` callers after a ledger delivery observation. */
    wakeNotificationWaiters,
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

type ChangeoverHandlerDeps = {
  /** The daemon's own private successor-only endpoint; `undefined` means it has nothing to hand off. */
  getPrivateSocketPath: () => string | undefined;
  /** Cuts admission for new `start`/`resume` calls; reuses the existing retiring state. */
  setRetiring: () => void;
  /** Releases the public listener; invoked only after the reply is queued for write. */
  closePublicServer: () => Promise<void>;
};

type HandoffState = "pending" | "committed" | "rolled_back";

type HandoffTransaction = {
  id: string;
  state: HandoffState;
  releasePromise: Promise<void>;
  rollbackPromise?: Promise<RpcHandlerResult>;
  /** Set by `scheduleFallback` once the transaction exists; a failed fallback rollback reschedules it. */
  fallbackTimer?: ReturnType<typeof setTimeout>;
};

type RpcHandlerResult = Awaited<ReturnType<RpcHandler>>;

type HandoffHandlersDeps = ChangeoverHandlerDeps & {
  /** Reopens admission only after the public listener has rebound; skipped when superseded. */
  setAdmitting: () => void;
  /** True once this generation has been superseded (via `supersede` or `changeover`), before or
   * during the pending handoff — rollback must not reopen admission for it. */
  wasSuperseded: () => boolean;
  /** Rebinds the stable public listener. */
  bindPublicServer: () => Promise<void>;
  /** True only when a daemon answers at the stable public address. */
  probePublicServer: () => Promise<boolean>;
  /** Bounds an unanswered handoff. Defaults to `DEFAULT_HANDOFF_FALLBACK_MS`. */
  fallbackMs?: number;
};

/**
 * True when `handoffId` still names the transaction identified by `activeId`/`activeState` — a
 * fallback timer firing after that transaction settled, or after a new transaction replaced it,
 * must not act. Extracted so both call sites in `resolveFallback` (before and after the async
 * probe) share one guard and are directly testable without a real timer.
 */
export function isHandoffStillPending(
  activeId: string | undefined,
  activeState: HandoffState | undefined,
  handoffId: string,
): boolean {
  return activeId === handoffId && activeState === "pending";
}

/**
 * The liveness-fallback verdict: commit when a daemon answers live at the stable public address,
 * roll back otherwise. Extracted so the choice is directly testable without a real timer or probe.
 */
export function fallbackVerdict(publicDaemonLive: boolean): "commit" | "rollback" {
  return publicDaemonLive ? "commit" : "rollback";
}

function handoffIdentity(frame: Parameters<RpcHandler>[0]): string | undefined {
  const params = frame.params;
  if (typeof params !== "object" || params === null) return undefined;
  const handoffId = (params as { handoffId?: unknown }).handoffId;
  return typeof handoffId === "string" && handoffId.length > 0 ? handoffId : undefined;
}

function handoffResponse(state: Exclude<HandoffState, "pending">): RpcHandlerResult {
  return { kind: "response", result: { ok: true, state } };
}

function handoffMismatch(): RpcHandlerResult {
  return {
    kind: "error",
    code: "handoff_identity_mismatch",
    message: "handoff identity does not match the active transaction",
  };
}

/** Owns the reversible interval between accepted changeover and successor readiness. */
function createHandoffHandlers(deps: HandoffHandlersDeps): {
  changeover: RpcHandler;
  handoff_commit: RpcHandler;
  handoff_rollback: RpcHandler;
  isPending: () => boolean;
  close: () => void;
} {
  let transaction: HandoffTransaction | undefined;
  let closed = false;

  const clearFallback = (active: HandoffTransaction): void => {
    if (active.fallbackTimer !== undefined) clearTimeout(active.fallbackTimer);
  };

  const rollback = (active: HandoffTransaction): Promise<RpcHandlerResult> => {
    if (active.state === "committed") return Promise.resolve(handoffResponse("committed"));
    if (active.state === "rolled_back") return Promise.resolve(handoffResponse("rolled_back"));
    if (active.rollbackPromise !== undefined) return active.rollbackPromise;
    const rollbackPromise = (async (): Promise<RpcHandlerResult> => {
      await active.releasePromise;
      try {
        await deps.bindPublicServer();
      } catch (error) {
        delete active.rollbackPromise;
        const message = error instanceof Error ? error.message : String(error);
        return { kind: "error", code: "handoff_rollback_failed", message };
      }
      active.state = "rolled_back";
      clearFallback(active);
      if (!deps.wasSuperseded()) deps.setAdmitting();
      return handoffResponse("rolled_back");
    })();
    active.rollbackPromise = rollbackPromise;
    return rollbackPromise;
  };

  const commit = async (active: HandoffTransaction): Promise<RpcHandlerResult> => {
    if (active.rollbackPromise !== undefined) return active.rollbackPromise;
    if (active.state === "rolled_back") return handoffResponse("rolled_back");
    if (active.state === "committed") return handoffResponse("committed");
    active.state = "committed";
    clearFallback(active);
    return handoffResponse("committed");
  };

  const scheduleFallback = (active: HandoffTransaction, handoffId: string): void => {
    if (closed) return;
    active.fallbackTimer = setTimeout(() => {
      void resolveFallback(handoffId);
    }, deps.fallbackMs ?? DEFAULT_HANDOFF_FALLBACK_MS);
  };

  const resolveFallback = async (handoffId: string): Promise<void> => {
    const active = transaction;
    if (closed || active === undefined || !isHandoffStillPending(active.id, active.state, handoffId)) return;
    let publicDaemonLive = false;
    try {
      publicDaemonLive = await deps.probePublicServer();
    } catch {
      publicDaemonLive = false;
    }
    if (closed || transaction !== active || !isHandoffStillPending(transaction.id, transaction.state, handoffId)) {
      return;
    }
    const result = fallbackVerdict(publicDaemonLive) === "commit" ? await commit(active) : await rollback(active);
    if (result.kind === "error") {
      console.error(`Daemon handoff fallback failed: ${result.message}`);
      // A failed rollback (rebind still failing) must not strand the transaction pending forever:
      // reschedule another attempt on the same cadence until one of them resolves it.
      if (transaction === active && isHandoffStillPending(transaction.id, transaction.state, handoffId)) {
        scheduleFallback(active, handoffId);
      }
    }
  };

  const changeover: RpcHandler = () => {
    const privateSocketPath = deps.getPrivateSocketPath();
    if (privateSocketPath === undefined) {
      return {
        kind: "error",
        code: "no_private_endpoint",
        message: "daemon has no private successor endpoint to hand off to",
      };
    }
    if (transaction?.state === "pending") {
      return { kind: "response", result: { ok: true, privateSocketPath, handoffId: transaction.id } };
    }
    if (transaction?.state === "committed") {
      return { kind: "error", code: "handoff_committed", message: "daemon handoff is already committed" };
    }

    deps.setRetiring();
    const handoffId = crypto.randomUUID();
    let releaseDone: (() => void) | undefined;
    const releasePromise = new Promise<void>((resolve) => {
      releaseDone = resolve;
    });
    const active: HandoffTransaction = { id: handoffId, state: "pending", releasePromise };
    scheduleFallback(active, handoffId);
    transaction = active;
    setImmediate(() => {
      deps.closePublicServer().then(releaseDone, releaseDone);
    });
    return { kind: "response", result: { ok: true, privateSocketPath, handoffId } };
  };

  const settle = (resolution: "commit" | "rollback"): RpcHandler => {
    return async (frame) => {
      const active = transaction;
      const handoffId = handoffIdentity(frame);
      if (active === undefined || handoffId === undefined || active.id !== handoffId) return handoffMismatch();
      return resolution === "commit" ? commit(active) : rollback(active);
    };
  };

  return {
    changeover,
    handoff_commit: settle("commit"),
    handoff_rollback: settle("rollback"),
    isPending: () => transaction?.state === "pending",
    close: () => {
      closed = true;
      if (transaction !== undefined) clearFallback(transaction);
    },
  };
}

/**
 * `changeover` RPC: an incoming generation asks the current public-address occupant to hand off.
 * Admission is cut off synchronously before the reply is built, so no work can be admitted after
 * the successor is told to take the address. The public listener is released only after this
 * response is written — `setImmediate` runs after the synchronous frame write in `dispatchRequest`'s
 * `.then()` (`v2/src/ipc/server.ts`), so a caller can never observe a released address before it can
 * see this reply's private endpoint.
 */
export function createChangeoverHandler(deps: ChangeoverHandlerDeps): RpcHandler {
  return () => {
    const privateSocketPath = deps.getPrivateSocketPath();
    if (privateSocketPath === undefined) {
      return {
        kind: "error",
        code: "no_private_endpoint",
        message: "daemon has no private successor endpoint to hand off to",
      };
    }
    deps.setRetiring();
    setImmediate(() => {
      deps.closePublicServer().catch(() => {
        // Release failure leaves the address occupied; the successor's own wait-for-release
        // times out and fails startup rather than unlinking a live peer's socket.
      });
    });
    return { kind: "response", result: { ok: true, privateSocketPath } };
  };
}

type DaemonStartupDeps = {
  logsPath?: string;
  openLogSink?: typeof openLogSink;
  startIpcServer?: typeof startIpcServer;
  recoverReconciledRuns?: typeof recoverReconciledRuns;
  enumerateOtherDaemonSockets?: EnumerateOtherDaemonSockets;
  supersedePeerDaemon?: SupersedePeerDaemon;
  readNotificationSinkCommand?: () => string | undefined;
  notificationSpawnSink?: NotificationSinkSpawner;
  writeLoopBindingSourceDeps?: WriteLoopBindingSourceDeps;
  writeLoopExecutor?: RunControlHandlerContextDeps["writeLoopExecutor"];
  hasMemoryHeadroom?: () => boolean;
  /** Defaults to `process.exit`. */
  processExit?: (code: number) => never;
  /** Digest-keyed private endpoint bound before the public `socketPath`. */
  privateSocketPath?: string;
  /**
   * The outgoing generation's private endpoint, learned from a successful `changeover` reply.
   * When set, this daemon polls it for the predecessor's live run set (see
   * `daemon-drain-observer.ts`) so `list` keeps reporting those runs live until it drains. Every
   * live legacy digest-keyed peer discovered via `enumerateOtherDaemonSockets` is drained the
   * same way, without needing to be named here.
   */
  predecessorSocketPath?: string;
  observePredecessorDrain?: typeof observePredecessorDrain;
  /** Direct-predecessor-only ownership routing; never fed legacy peer sockets. Defaults to `observeRunOwnership`. */
  observeRunOwnership?: typeof observeRunOwnership;
  /** Bounds incumbent fallback resolution while no successor verdict arrives. Defaults to `DEFAULT_HANDOFF_FALLBACK_MS`. */
  handoffFallbackMs?: number;
  /**
   * Opts this runtime into autonomous self-handoff sampling. Off by default so embedded/test
   * runtimes never spawn a real successor; only the production entrypoint sets it.
   */
  enableSelfHandoff?: boolean;
  /** Digest sampler for self-handoff triggering; defaults to sampling this process's own executable tree. */
  sampleExecutableDigest?: () => Promise<string>;
  /**
   * Starts and awaits a self-handoff successor for an observed digest; defaults to the real
   * `startDaemon` spawn -> changeover -> readiness -> commit/rollback path against a digest-keyed
   * private endpoint. A rejection propagates unchanged, same as any other `startHandoff` failure.
   */
  startSelfHandoffSuccessor?: (loaded: string, observed: string) => Promise<"committed" | "rolled_back">;
  /** Self-handoff sampling interval; defaults to 30s. Same injection seam as `startDrainExitLoop`'s `intervalMs`. */
  selfHandoffSamplingIntervalMs?: number;
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

/**
 * Every drain observer this generation owns: the real handoff predecessor (if any) plus one per
 * live legacy digest-keyed peer discovered on the same address space (see
 * 03-legacy-keyed-daemon-migration.md). Combined via `unionLiveRunIds` for `externalLiveRunIds`.
 */
function buildDrainObservers(
  predecessorSocketPath: string | undefined,
  legacyPeerSocketPaths: readonly string[],
  observeDrain: typeof observePredecessorDrain,
): DrainObserver[] {
  // The predecessor's private socket is itself digest-keyed, so enumeration finds it again as a
  // "legacy" peer; observing it twice doubled the polling load on the handing-off incumbent.
  const socketPaths =
    predecessorSocketPath === undefined
      ? legacyPeerSocketPaths
      : [predecessorSocketPath, ...legacyPeerSocketPaths.filter((path) => path !== predecessorSocketPath)];
  return socketPaths.map((peerSocketPath) => observeDrain(peerSocketPath));
}

async function daemonAnswersAt(socketPath: string): Promise<boolean> {
  try {
    const client = await connectIpcClient(socketPath);
    const transport = createRpcTransport(client);
    try {
      await transport.request("health", undefined, { timeoutMs: 500 });
      return true;
    } finally {
      transport.close();
    }
  } catch {
    return false;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: startup wires handoff rollback, listeners, and recovery in one ordered sequence
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

  await sweepOrphanReadyGateGroups(store);

  const executeProductionWriteLoop = async (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal) => {
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

  const observeDrain = startupDeps.observePredecessorDrain ?? observePredecessorDrain;
  // A live pre-stable digest-keyed daemon has no public address and no handoff RPC, so it is
  // treated as a legacy outgoing generation: its keyed socket becomes a private successor-only
  // endpoint, drained the same way as a real handoff predecessor (see 03-legacy-keyed-daemon-
  // migration.md). Enumeration is pure and synchronous, so this is safe before either server binds.
  const enumerateSockets = startupDeps.enumerateOtherDaemonSockets ?? enumerateOtherDaemonSockets;
  const legacyPeerSocketPaths = enumerateSockets(jarvisHome(), startupDeps.privateSocketPath ?? socketPath);
  const drainObservers = buildDrainObservers(startupDeps.predecessorSocketPath, legacyPeerSocketPaths, observeDrain);
  // Ownership routing feeds `list`'s authoritative-owner-row merge and is direct-predecessor only:
  // never fed from `legacyPeerSocketPaths`, unlike `drainObservers` above.
  const ownershipDirectory = (startupDeps.observeRunOwnership ?? observeRunOwnership)(
    startupDeps.predecessorSocketPath,
  );

  const {
    reportReviewDebateProgress: _reportReviewDebateProgress,
    clearLiveReviewDebateProgress: _clearLiveReviewDebateProgress,
    wakeNotificationWaiters,
    close: _closeRunControlHandlers,
    continueContinuablePipelines,
    setRetiring: setRetiringRaw,
    hasActiveRuns,
    isRetiring,
    pipelineExecutionDeps: _pipelineExecutionDeps,
    context: runControlContext,
    ...runControlHandlers
  } = createRunControlHandlers({
    stateStore: store,
    logReader: logReaderInstance,
    logsPath,
    operatorSessionId,
    writeLoopExecutor: startupDeps.writeLoopExecutor ?? executeProductionWriteLoop,
    failureReporter: createRunExecutionFailureReporter(logsPath),
    // Load-bearing: this is the only production wire that enables the pipeline intent-stage
    // stale-reset preflight. Removing it silently reverts the daemon to constructing no bundle
    // (the historical no-op); the unit test injects `daemonSocketPath` directly and cannot catch that.
    daemonSocketPath: socketPath,
    reconciledRunIds,
    externalLiveRunIds: () => unionLiveRunIds(drainObservers),
    // Unset (never even called) with no direct predecessor: `list` then skips substitution
    // entirely, matching the documented no-predecessor fast path exactly (see
    // `daemon-run-lifecycle-handlers.ts`'s `listHandler`). A configured-but-currently-empty
    // directory still wires `ownerRow` through, since it can populate later.
    ...(startupDeps.predecessorSocketPath === undefined ? {} : { ownerRow: ownershipDirectory.ownerRow }),
    ...(startupDeps.hasMemoryHeadroom === undefined ? {} : { hasMemoryHeadroom: startupDeps.hasMemoryHeadroom }),
    ...(startupDeps.writeLoopBindingSourceDeps === undefined
      ? {}
      : { writeLoopBindingSourceDeps: startupDeps.writeLoopBindingSourceDeps }),
  });

  // The self-handoff sampling loop's per-tick `isRetiring()` check (below) is the sampling cutoff:
  // it fires on any admission cut, client-initiated or self-triggered, without permanently
  // stopping the interval, so a rollback that reopens admission lets sampling resume and retry.
  // `close()` is the only place that permanently stops it, at real teardown.
  let selfHandoffTrigger: { stop(): void } | undefined;
  const setRetiring = setRetiringRaw;

  // Recorded separately from `retiring`: a handoff's own `changeover` sets `retiring` too, but only
  // a real `supersede` must stop rollback from reopening admission (see `wasSuperseded` below).
  let superseded = false;
  const supersedHandler: RpcHandler = () => {
    superseded = true;
    setRetiring();
    return { kind: "response", result: { ok: true } };
  };

  let server: IpcServer;
  let privateServer: IpcServer | undefined;
  const bindIpcServer = startupDeps.startIpcServer ?? startIpcServer;
  let handlers: Record<string, RpcHandler>;

  const handoffHandlers = createHandoffHandlers({
    getPrivateSocketPath: () => startupDeps.privateSocketPath,
    setRetiring,
    closePublicServer: () => server.close(),
    setAdmitting: () => {
      runControlContext.retiring = false;
    },
    wasSuperseded: () => superseded,
    bindPublicServer: async () => {
      try {
        server = await bindIpcServer(socketPath, handlers, tailStreamHandler);
      } catch (error) {
        // Rollback runs only after the successor failed to commit; a dead successor's leftover socket
        // file (unanswered) is reclaimable, a live answering daemon never is.
        if (!(await removeUnansweredSocketPath(socketPath, daemonAnswersAt))) throw error;
        server = await bindIpcServer(socketPath, handlers, tailStreamHandler);
      }
    },
    probePublicServer: () => daemonAnswersAt(socketPath),
    ...(startupDeps.handoffFallbackMs === undefined ? {} : { fallbackMs: startupDeps.handoffFallbackMs }),
  });

  handlers = {
    health: healthHandler,
    status: statusHandler,
    shutdown: shutdownHandler,
    supersede: supersedHandler,
    changeover: handoffHandlers.changeover,
    handoff_commit: handoffHandlers.handoff_commit,
    handoff_rollback: handoffHandlers.handoff_rollback,
    ...runControlHandlers,
  };

  try {
    if (startupDeps.privateSocketPath !== undefined) {
      privateServer = await bindIpcServer(startupDeps.privateSocketPath, handlers, tailStreamHandler);
    }
    server = await bindIpcServer(socketPath, handlers, tailStreamHandler);
  } catch (err) {
    if (err instanceof DaemonSocketBindFailureError) {
      console.error(formatDaemonBindFailureLogLine(err));
      process.exit(1);
    }
    console.error(`Failed to start IPC server on ${socketPath}:`, err);
    process.exit(1);
  }

  // Cut admission on each legacy peer after our server is listening, best-effort and
  // non-blocking. A peer that does not answer is skipped rather than failing startup; drain
  // observation above already tracks its live run set regardless of whether this RPC lands.
  const supersedePeer = startupDeps.supersedePeerDaemon ?? supersedePeerDaemon;
  (async () => {
    for (const peerSocketPath of legacyPeerSocketPaths) {
      await supersedePeer(peerSocketPath);
    }
  })().catch(() => {
    // Ignore errors: the supersede pass is best-effort.
  });

  const recoveryLogSink = createLogSink(logsPath);
  try {
    await store.reconcilePipelines();
    const recovery = await (startupDeps.recoverReconciledRuns ?? recoverReconciledRuns)(
      reconciledRunIds,
      store,
      recoveryLogSink,
      runControlHandlers.resume,
    );
    recoveryStatus = { ...recoveryStatus, pending: false, resumed: recovery?.resumed ?? 0 };
    // Runs reconciled by this startup are excluded from the sweep's settlement by id: resuming one
    // does not register it anywhere the sweep can observe, and its durable row still reads the
    // terminal status reconciliation wrote, so settling from that row would fail its stage out from
    // under a run that is actively resuming.
    await continueContinuablePipelines();
  } finally {
    recoveryLogSink.close();
  }

  const readSink = startupDeps.readNotificationSinkCommand ?? (() => readNotificationSinkCommand());
  const notificationSweepDeps = {
    store,
    readSinkCommand: readSink,
    wakeNotificationWaiters,
    ...(startupDeps.notificationSpawnSink === undefined ? {} : { spawnSink: startupDeps.notificationSpawnSink }),
  };
  const notificationSweepState = { sweepInProgress: false };
  runNotificationSweep(notificationSweepDeps);
  const notificationSweepTimer = setInterval(() => {
    runNotificationSweepIntervalTick(notificationSweepState, notificationSweepDeps);
  }, NOTIFICATION_SWEEP_INTERVAL_MS);
  notificationSweepTimer.unref();

  // Autonomous self-handoff: a merged source change leaves this daemon's loaded executable digest
  // stably diverged from the tree on disk, so it starts its own successor with no client request.
  // Skipped when the loaded digest is unknown — there is no baseline to diverge from.
  const sampleExecutableDigest =
    startupDeps.sampleExecutableDigest ?? (() => getExecutableTreeDigest(import.meta.dir, realAsyncSubprocessRunner));
  const spawnSelfHandoffSuccessor =
    startupDeps.startSelfHandoffSuccessor ??
    (async (_loaded: string, observed: string): Promise<"committed" | "rolled_back"> => {
      // Paths derive from this daemon's own public socket directory, not module-level jarvis-home
      // constants, so a daemon bound under another home hands off within that home.
      const home = dirname(socketPath);
      await startDaemon(socketPath, {
        pidPath: join(home, "daemon.pid"),
        logPath: join(home, "daemon.log"),
        privateSocketPath: daemonPathsByDigest(observed, home).socketPath,
      });
      return "committed";
    });
  if (startupDeps.enableSelfHandoff === true && loadedExecutableDigest !== "unknown") {
    selfHandoffTrigger = startStableDigestTrigger(loadedExecutableDigest, {
      sample: sampleExecutableDigest,
      startHandoff: async (loaded, observed) => {
        // A client-initiated handoff already cut admission and is negotiating with its own
        // successor; spawning a second successor here would race it for the same private
        // socket. Treated the same as any other `startHandoff` non-commit outcome.
        if (handoffHandlers.isPending()) return "rolled_back";
        console.error(`Self-handoff triggered: loaded digest ${loaded}, observed digest ${observed}`);
        try {
          return await spawnSelfHandoffSuccessor(loaded, observed);
        } catch (error) {
          // `startDaemon` kills a successor that never committed; without this line that death is silent.
          console.error("Self-handoff failed:", error);
          throw error;
        }
      },
      scheduleSampling: (onTick) => {
        const timer = setInterval(() => {
          if (isRetiring()) return;
          void onTick();
        }, startupDeps.selfHandoffSamplingIntervalMs ?? 30_000);
        timer.unref?.();
        return { stop: () => clearInterval(timer) };
      },
    });
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
    drainExitLoop.stop();
    clearInterval(notificationSweepTimer);
    selfHandoffTrigger?.stop();
    process.off("SIGTERM", signalHandler);
    process.off("SIGINT", signalHandler);
    handoffHandlers.close();
    _closeRunControlHandlers();
    for (const observer of drainObservers) observer.stop();
    ownershipDirectory.stop();
    await server.close();
    if (privateServer !== undefined) {
      await privateServer.close();
    }
    if (!logReader) {
      const closeable = logReaderInstance as { close?: () => void };
      closeable.close?.();
    }
    if (!stateStore) {
      store.close();
    }
  };

  // Extracted (`startDrainExitLoop`) so both directions of the retiring/active-runs guard, and
  // the wiring that closes and exits once it flips, are unit-testable without a real timer (the
  // deterministic-daemon-test guard forbids one) or a full daemon.
  const drainExitLoop = startDrainExitLoop({
    shouldShutdown: () =>
      shouldShutdownNow(shutdownRequested, isRetiring(), hasActiveRuns(), handoffHandlers.isPending()),
    close,
    processExit,
  });

  console.error(`Daemon running on socket ${socketPath} with PID ${process.pid}`);
  return { close };
}
