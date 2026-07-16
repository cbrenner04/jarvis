import { join } from "node:path";
import { isWorktreeDirtyAsync } from "../../../shared/git.ts";
import { createResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import { resolveExecutableRole, resolveInvocationBindings } from "../config/agent-model-config.ts";
import { resolveMachineProfile } from "../config/machine-config-loader.ts";
import { getExternalWorktreePath } from "../execution/external-worktree.ts";
import {
  type AnyWorkflowStep,
  executeWorkflow,
  LinkedIndexReadError,
  type ReviewProgress,
  workflowTelemetryLabel,
} from "../execution/workflow-runner.ts";
import { applyOperatorSessionId, executeWriteLoop, type WriteLoopInput } from "../execution/write-loop.ts";
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
  openStateStore,
  type Run,
  type RunStatus,
  type StateStore,
  type WorkflowSnapshot,
} from "../persistence/state-store.ts";
import { type ReviseReconvergeDeps, reconvergeRevisingRun, reviseAwaitingHuman } from "./daemon-revise.ts";
import { hasMemoryHeadroom, loadSettleDelayMs } from "./memory-watermark.ts";
import {
  composeRunOperatorError,
  findTerminalLogRecord,
  type RunOperatorError,
  type TerminalLogRecord,
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

const TERMINAL_LIST_STATUSES: ReadonlySet<RunStatus> = new Set(["completed", "failed", "blocked", "killed"]);
/** Marks runs whose recorded owner is gone as killed before IPC is exposed. */
export async function reconcileOrphanedRuns(
  stateStore: StateStore,
  logSink: LogSink,
  logReader?: LogReader,
): Promise<void> {
  for (const runId of await stateStore.beginRunReconciliation()) {
    const run = stateStore.loadRun(runId);
    const eventPersisted = logReader
      ?.tail(runId)
      .some(
        (record) =>
          record.event.kind === "run_reconciled" &&
          record.event.runStatus === "killed" &&
          record.event.reason === "daemon_restart",
      );
    if (run?.status === "killed" && !eventPersisted) {
      logSink.append(runId, { kind: "run_reconciled", runStatus: "killed", reason: "daemon_restart" });
    }
    stateStore.finishRunReconciliation(runId);
  }
}

function isTerminalListStatus(status: RunStatus): boolean {
  return TERMINAL_LIST_STATUSES.has(status);
}

/** Filter durable rows before list pays per-row loadRun/tail cost. Durable store is unchanged. */
function retainListedRuns(runs: Run[]): Run[] {
  const keptIds = new Set<string>();
  const keptInvocationIds = new Set<string>();
  let terminalKept = 0;

  for (const run of runs) {
    const invocationId = run.workflowSnapshot?.invocationId;
    if (!isTerminalListStatus(run.status)) {
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
    if (!isTerminalListStatus(run.status)) continue;
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
 * step. A `write` step carries `worktree.projectName`/`worktree.branchName`; `human`
 * and `review-debate` steps carry flat `project`/`branch` fields.
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

function isTerminalRunStatus(status: RunStatus): boolean {
  return (
    status === "completed" || status === "blocked" || status === "killed" || status === "paused" || status === "failed"
  );
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
  const step = snapshot?.steps.find((candidate) => candidate.stepId === stepId);

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
    bindingResolution: { role: step.role, agents: step.agents, agentModelConfig: step.agentModelConfig },
    stepId,
    workflowSnapshot: snapshot,
    ...(step.iterationTimeoutMs === undefined ? {} : { iterationTimeoutMs: step.iterationTimeoutMs }),
  });
}

function resumeContextForRun(run: Run, loopOutcomeKind?: string): ResolvedWriteLoopInput | undefined {
  const resumableStatus = run.status === "paused" || run.status === "budget-soft-stopped" || run.status === "killed";
  const publicationRetry =
    run.status === "completed" &&
    (loopOutcomeKind === "completion_commit_failed" || loopOutcomeKind === "ready_finalize_failed");
  return resumableStatus || publicationRetry ? reconstructWriteResume(run) : undefined;
}

function resumeContextForTerminalRecord(
  run: Run | undefined,
  terminalRecord: TerminalLogRecord | undefined,
): ResolvedWriteLoopInput | undefined {
  if (!run) return undefined;
  const loopOutcomeKind =
    terminalRecord?.event.kind === "loop_finished" ? terminalRecord.event.loopOutcomeKind : undefined;
  return resumeContextForRun(run, loopOutcomeKind);
}

function runListRowError(
  run: Parameters<typeof composeRunOperatorError>[0] | undefined,
  resumeContext: ResolvedWriteLoopInput | undefined,
  terminalRecord: TerminalLogRecord | undefined,
) {
  if (!run) return undefined;
  if (resumeContext?.ok === false) {
    return { reason: "unsupported_resume_context" as const, retryable: false, nextAction: "stop" as const };
  }
  return composeRunOperatorError(run, terminalRecord);
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
  isWorktreeDirty?: (worktreePath: string) => Promise<boolean>;
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
  const checkWorktreeDirty = deps.isWorktreeDirty ?? isWorktreeDirtyAsync;
  const checkMemoryHeadroom = deps.hasMemoryHeadroom ?? (() => hasMemoryHeadroom(resolveMachineProfile()));
  const injectedSettleDelayMs = deps.settleDelayMs;
  const settleDelayMs: () => number =
    injectedSettleDelayMs !== undefined
      ? () => injectedSettleDelayMs
      : () => loadSettleDelayMs(resolveMachineProfile());
  const settleState: PromotionSettleState = { suppressedUntil: 0 };

  const resultFrom = (runId: string, runStatus: RunStatus, record?: TerminalLogRecord): WaitRunCompletionResult => {
    const run = store.loadRun(runId);
    const resumeContext = run
      ? resumeContextForRun(run, record?.event.kind === "loop_finished" ? record.event.loopOutcomeKind : undefined)
      : undefined;
    const error =
      run && resumeContext?.ok === false
        ? { reason: "unsupported_resume_context" as const, retryable: false, nextAction: "stop" as const }
        : run
          ? composeRunOperatorError(run, record)
          : undefined;
    const unsupportedResume = resumeContext?.ok === false;
    const base: WaitRunCompletionResult =
      record?.event.kind === "loop_finished"
        ? {
            runStatus,
            loopOutcomeKind: record.event.loopOutcomeKind,
            iterationsConsumed: record.event.iterationsConsumed,
            resumable: unsupportedResume ? false : record.event.resumable,
          }
        : { runStatus };
    const withError = error === undefined ? base : { ...base, error };
    return runStatus === "blocked" && run ? { ...withError, worktreePath: run.worktreePath } : withError;
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
          if (run && !isTerminalRunStatus(run.status)) {
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

  const promoteQueuedRun = (bypassSettleDelay = false): void =>
    promoteQueuedRunImpl(
      { store, registry: _registry, checkMemoryHeadroom, settleDelayMs, settleState, spawnWriteLoop },
      bypassSettleDelay,
    );

  /**
   * Demote one non-terminal workflow run to `failed` and record why. Both steps are
   * best-effort and independent: a persist fault must not skip the log append, and an
   * append fault must not roll back the demote.
   */
  const settleFailedWorkflowRun = (runId: string, message: string, logSink: LogSink | undefined): void => {
    const run = store.loadRun(runId);
    if (run && isTerminalRunStatus(run.status)) return;
    try {
      store.setRunStatus(runId, "failed");
    } catch {
      // best-effort persist; append still runs
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
      executeWorkflow({
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
      })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          if (workflowRunIds.size === 0) {
            resolve({
              kind: "error",
              code: err instanceof LinkedIndexReadError ? "routing_read_failed" : "invalid_params",
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
        !TERMINAL_LIST_STATUSES.has(existing.status)
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
    if (
      existingWorkflowClaim?.workflow === true &&
      activeRuns.get(existingWorkflowClaim.runId)?.kind !== "workflow"
    ) {
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

  const listHandler: RpcHandler = () => {
    const durableRuns = retainListedRuns(store.listRuns());
    const liveRunIds = new Set<string>();

    for (const activeRun of activeRuns.values()) {
      liveRunIds.add(activeRun.runId);
    }

    const { fullRuns, workflowRuns } = indexListedRuns(durableRuns);

    const runList = durableRuns.map((run) => {
      const fullRun = fullRuns.get(run.id);
      const isLive = run.status === "in-progress" && liveRunIds.has(run.id);
      const records = logReader?.tail(run.id) ?? [];
      const terminalRecord = findTerminalLogRecord(records);
      const resumeContext = resumeContextForTerminalRecord(fullRun, terminalRecord);
      const error = runListRowError(fullRun, resumeContext, terminalRecord);
      const reportedStatus = reportedRunStatus(run, fullRun);
      const snapshot = fullRun?.workflowSnapshot ?? undefined;

      return {
        runId: run.id,
        project: run.project,
        branch: run.branch,
        status: reportedStatus,
        isLive,
        ...(error !== undefined ? { error } : {}),
        ...(snapshot?.reviewPasses !== undefined ? { reviewPasses: snapshot.reviewPasses } : {}),
        ...(snapshot?.reviewBehavior !== undefined ? { reviewBehavior: snapshot.reviewBehavior } : {}),
        ...(fullRun !== undefined && snapshot !== undefined
          ? { workflow: workflowRowSnapshot(fullRun, workflowRuns, liveRunIds, reviewDebateProgressByInvocation) }
          : {}),
        ...(reportedStatus === "blocked" ? { worktreePath: run.worktreePath } : {}),
      };
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

  const reviseReconvergeDeps: ReviseReconvergeDeps = {
    store,
    registry: _registry,
    checkWorktreeDirty,
    spawnWriteLoop,
    checkWorktreeClaimed,
  };

  const humanDecisionAdmission = new Map<string, Promise<unknown>>();

  function withHumanDecisionAdmission<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const prev = humanDecisionAdmission.get(runId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(work);
    humanDecisionAdmission.set(runId, next);
    next
      .catch(() => {})
      .finally(() => {
        if (humanDecisionAdmission.get(runId) === next) {
          humanDecisionAdmission.delete(runId);
        }
      });
    return next;
  }

  async function resumeAwaitingHumanDecision(
    run: LoadedRun,
    decision: string | undefined,
    prompt: string | undefined,
  ): Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }> {
    if (decision === undefined) {
      return { kind: "error", code: "invalid_params", message: "Missing decision for awaiting-human run" };
    }

    if (decision === "approve") {
      store.setRunStatus(run.id, "completed");
      return { kind: "response", result: { ok: true } };
    }

    if (decision === "abort") {
      const ks = ownershipKeyString({ project: run.project, branch: run.branch });
      const activeRun = activeRuns.get(ks);
      if (activeRun && activeRun.runId === run.id && activeRun.kind === "write-loop") {
        activeRun.abortController.abort();
      }
      store.commitGuardedKill(run.id);
      return { kind: "response", result: { ok: true } };
    }

    if (decision === "revise") {
      return await reviseAwaitingHuman(reviseReconvergeDeps, run, prompt);
    }

    return { kind: "error", code: "invalid_params", message: `Unknown decision: ${decision}` };
  }

  async function resumeAwaitingHuman(
    run: LoadedRun,
    decision: string | undefined,
    prompt: string | undefined,
  ): Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }> {
    return withHumanDecisionAdmission(run.id, async () => {
      const current = store.loadRun(run.id);
      if (!current) {
        return { kind: "error", code: "unknown_run", message: `Run ${run.id} not found` };
      }
      if (current.status !== "awaiting-human") {
        if (current.status === "revising") {
          return {
            kind: "error",
            code: "revise_in_progress",
            message: `Run ${run.id} is revising; wait for it to re-converge to awaiting-human`,
          };
        }
        return {
          kind: "error",
          code: "invalid_params",
          message: `Run ${run.id} is not awaiting a human decision`,
        };
      }
      return resumeAwaitingHumanDecision(current, decision, prompt);
    });
  }

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
    const retryCompletionPublication =
      run.status === "completed" &&
      terminalRecord?.event.kind === "loop_finished" &&
      (terminalRecord.event.loopOutcomeKind === "completion_commit_failed" ||
        terminalRecord.event.loopOutcomeKind === "ready_finalize_failed");

    // A completed durable boundary is idempotent, except a failed external publication.
    if (
      (run.status === "completed" && !retryCompletionPublication) ||
      run.status === "failed" ||
      run.status === "blocked"
    ) {
      return { kind: "error", code: "terminal_run", message: `Cannot resume a ${run.status} run` };
    }
    return undefined;
  }

  /** Human-loop resume dispatch. Returns undefined when `run` is not in a human-loop status. */
  async function resumeHumanLoopRun(
    run: Parameters<typeof resumeAwaitingHuman>[0],
    runId: string,
    params: { decision?: string; prompt?: string },
  ): Promise<Awaited<ReturnType<typeof resumeAwaitingHuman>> | undefined> {
    if (run.status === "awaiting-human") {
      return await resumeAwaitingHuman(run, params.decision, params.prompt);
    }
    if (run.status !== "revising") return undefined;

    const reconverged = reconvergeRevisingRun(reviseReconvergeDeps, run);
    if (!reconverged) {
      return {
        kind: "error",
        code: "revise_in_progress",
        message: `Run ${runId} is revising; wait for it to re-converge to awaiting-human`,
      };
    }
    return await resumeAwaitingHuman(reconverged, params.decision, params.prompt);
  }

  const resumeHandler: RpcHandler = async (frame) => {
    const params = frame.params as { runId?: string; decision?: string; prompt?: string } | undefined;
    if (!params?.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    const humanResume = await resumeHumanLoopRun(run, runId, params);
    if (humanResume) return humanResume;

    if (params.decision !== undefined) {
      return { kind: "error", code: "invalid_params", message: "decision is only valid for awaiting-human runs" };
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
    reader: LogReader,
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
    const terminalRecord = findTerminalLogRecord(reader.tail(run.id));
    return { kind: "response", result: resultFrom(run.id, rollupStatus, terminalRecord) };
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
      ? waitForWorkflowEntryRun(logReader, run, entrySnapshot)
      : waitForLogTerminalRecord(logReader, run, signal);
  };

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

function parseTailStreamRunId(payload: unknown): string | undefined {
  const params = typeof payload === "string" && payload ? JSON.parse(payload) : payload;
  if (typeof params !== "object" || params === null) return undefined;
  const runId = (params as { runId?: unknown }).runId;
  return typeof runId === "string" ? runId : undefined;
}

async function streamRunLogRecords(
  deps: TailStreamHandlerDeps,
  runId: string,
  onData: (record: PersistedRecord) => void,
  signal: AbortSignal,
): Promise<void> {
  const run = deps.stateStore.loadRun(runId);
  if (!run) return;

  const replay = deps.logReader.tail(runId);
  for (const record of replay) {
    if (signal.aborted) return;
    onData(record);
  }

  if (run.status !== "in-progress") return;

  const subscribeSeq = replay.at(-1)?.seq ?? 0;
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
    const runId = parseTailStreamRunId(payload);
    if (!runId || !deps.stateStore.loadRun(runId)) {
      onClose();
      return;
    }

    try {
      await streamRunLogRecords(deps, runId, onData, signal);
    } finally {
      onClose();
    }
  };
}

export type DaemonStartupDeps = {
  logsPath?: string;
  openLogSink?: typeof openLogSink;
  startIpcServer?: typeof startIpcServer;
};

export async function startDaemon(
  socketPath: string,
  stateStore?: StateStore,
  logReader?: LogReader,
  startupDeps: DaemonStartupDeps = {},
): Promise<void> {
  const store = stateStore ?? openStateStore();
  const logsPath = startupDeps.logsPath ?? join(jarvisHome(), "state", "logs.jsonl");
  const logReaderInstance = logReader ?? openLogReader(logsPath);
  const createLogSink = startupDeps.openLogSink ?? openLogSink;
  const reconciliationLogSink = createLogSink(logsPath);
  try {
    await reconcileOrphanedRuns(store, reconciliationLogSink, logReaderInstance);
  } finally {
    reconciliationLogSink.close();
  }
  let shutdownRequested = false;
  const operatorSessionId = crypto.randomUUID();

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

  const statusHandler: RpcHandler = () => {
    return { kind: "response", result: { state: "running" } };
  };

  const shutdownHandler: RpcHandler = () => {
    shutdownRequested = true;
    return { kind: "response", result: { ok: true } };
  };

  const {
    reportReviewDebateProgress: _reportReviewDebateProgress,
    close: _closeRunControlHandlers,
    ...runControlHandlers
  } = createRunControlHandlers({
    stateStore: store,
    logReader: logReaderInstance,
    logsPath,
    operatorSessionId,
    writeLoopExecutor,
    failureReporter: createRunExecutionFailureReporter(logsPath),
  });

  const handlers: Record<string, RpcHandler> = {
    health: healthHandler,
    status: statusHandler,
    shutdown: shutdownHandler,
    ...runControlHandlers,
  };

  let server: IpcServer;

  try {
    server = await (startupDeps.startIpcServer ?? startIpcServer)(socketPath, handlers, tailStreamHandler);
  } catch (err) {
    console.error(`Failed to start IPC server on ${socketPath}:`, err);
    process.exit(1);
  }

  const signalHandler = () => {
    shutdownRequested = true;
  };

  process.on("SIGTERM", signalHandler);
  process.on("SIGINT", signalHandler);

  const checkShutdown = setInterval(() => {
    if (shutdownRequested) {
      clearInterval(checkShutdown);
      (async () => {
        try {
          await server.close();
          if (!logReader) {
            const closeable = logReaderInstance as { close?: () => void };
            closeable.close?.();
          }
          if (!stateStore) {
            store.close();
          }
          process.exit(0);
        } catch (err) {
          console.error("Error during shutdown:", err);
          process.exit(1);
        }
      })();
    }
  }, 100);

  console.error(`Daemon running on socket ${socketPath} with PID ${process.pid}`);
}
