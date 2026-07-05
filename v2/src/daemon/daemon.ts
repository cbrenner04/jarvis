import { homedir } from "node:os";
import { join } from "node:path";
import { isWorktreeDirty } from "../../../shared/git.ts";
import { createAgentBindings, createResolvedAgentBinding } from "../../../shared/invocation/agents.ts";
import { resolveExecutableRole, resolveInvocationBindings } from "../config/agent-model-config.ts";
import { getExternalWorktreePath } from "../execution/external-worktree.ts";
import { nextRevisionNumber, revisionStepId } from "../execution/revision-step-id.ts";
import { latestRevisionRun, type ReviewDebateProgress } from "../execution/workflow-runner.ts";
import { executeWriteLoop, type WriteLoopInput } from "../execution/write-loop.ts";
import { type IpcServer, type RpcHandler, type StreamHandler, startIpcServer } from "../ipc/server";
import { type LogReader, type LoopFinishedEvent, openLogReader, openLogSink } from "../persistence/log-stream.ts";
import { openStateStore, type StateStore } from "../persistence/state-store.ts";
import type { RunStatus, WorkflowSnapshot, WorkflowSnapshotStep } from "../persistence/state-store-types.ts";
import {
  composeRunOperatorError,
  findTerminalLogRecord,
  type RunOperatorError,
  type TerminalLogRecord,
} from "./run-operator-error.ts";

export type WorktreeOwnership = {
  runId: string;
  worktreePath: string;
};

export type OwnershipKey = {
  project: string;
  branch: string;
};

export type ActiveRun = {
  runId: string;
  key: OwnershipKey;
  abortController: AbortController;
  pauseController: AbortController;
};

export class DaemonDoubleClaimError extends Error {
  constructor(key: OwnershipKey) {
    super(`Worktree already claimed for project=${key.project}, branch=${key.branch}`);
    this.name = "DaemonDoubleClaimError";
  }
}

export class DaemonRunRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "DaemonRunRejectedError";
  }
}

function ownershipKeyString(key: OwnershipKey): string {
  return `${key.project}:${key.branch}`;
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

  release(key: OwnershipKey): void {
    this.registry.delete(ownershipKeyString(key));
  }

  get(key: OwnershipKey): WorktreeOwnership | undefined {
    return this.registry.get(ownershipKeyString(key));
  }

  isClaimed(key: OwnershipKey): boolean {
    return this.registry.has(ownershipKeyString(key));
  }
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return (
    status === "completed" || status === "blocked" || status === "killed" || status === "paused" || status === "failed"
  );
}

/**
 * Statuses that mean a `~rN` revision run is no longer in flight, whether it
 * reached a normal write-loop terminal outcome or was killed by an operator.
 * A killed revision must not permanently strand its human step in `"revising"`.
 */
const REVISION_INACTIVE_STATUSES: readonly RunStatus[] = ["completed", "failed", "blocked", "killed"];

type RevisionWriteLoopInputResult =
  | { kind: "ok"; input: WriteLoopInput }
  | { kind: "error"; code: string; message: string };

/**
 * Rebuild the repeated step's `WriteLoopInput` for a revision attempt: reuses its
 * durably-snapshotted `stepRules`/`expectedArtifactPath`/`agents`/`agentModelConfig`
 * (appending a supplied `prompt` to `stepRules` rather than replacing it) instead of
 * fabricating an empty write-loop config.
 */
function buildRevisionWriteLoopInput(
  repeatedStepConfig: WorkflowSnapshotStep,
  repeatedRun: LoadedRun,
  stepId: string,
  prompt: string | undefined,
): RevisionWriteLoopInputResult {
  const agents = repeatedStepConfig.agents ?? [];
  let bindings: WriteLoopInput["bindings"] = [];
  try {
    if (agents.length > 0) {
      bindings = resolveInvocationBindings(
        resolveExecutableRole(repeatedStepConfig.role),
        agents,
        repeatedStepConfig.agentModelConfig ?? {},
        createResolvedAgentBinding,
      );
    }
  } catch (err) {
    return {
      kind: "error",
      code: "revise_unsupported",
      message: `Unable to resolve bindings for repeated step "${repeatedStepConfig.stepId}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const baseStepRules = repeatedStepConfig.stepRules ?? "";
  const stepRules = prompt ? (baseStepRules ? `${baseStepRules}\n\n${prompt}` : prompt) : baseStepRules;

  return {
    kind: "ok",
    input: {
      worktree: {
        projectRoot: repeatedRun.worktreePath,
        projectName: repeatedRun.project,
        branchName: repeatedRun.branch,
        baseRef: repeatedRun.specRef,
      },
      specPath: repeatedRun.specPath,
      stepRules,
      expectedArtifactPath: repeatedStepConfig.expectedArtifactPath ?? "",
      bindings,
      stepId,
    },
  };
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

function normalizeBindings(input: WriteLoopInput): WriteLoopInput {
  const bindingIds = input.bindings
    .map((binding) => {
      if (typeof binding !== "object" || binding === null) return null;
      const id = "id" in binding ? binding.id : undefined;
      return typeof id === "string" ? id : null;
    })
    .filter((id): id is string => id !== null);

  const hasLiveBindings = input.bindings.every(
    (binding) =>
      typeof binding === "object" && binding !== null && "invoke" in binding && typeof binding.invoke === "function",
  );

  if (hasLiveBindings || bindingIds.length === 0) {
    return input;
  }

  return {
    ...input,
    bindings: createAgentBindings(bindingIds),
  };
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
  writeLoopExecutor: (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal) => Promise<void>;
  failureReporter: (runId: string, reason: unknown) => void | Promise<void>;
  /** `revise`'s dirty-worktree gate; defaults to a real `git status --porcelain` check. */
  isWorktreeDirty?: (worktreePath: string) => boolean;
};

export type WaitRunCompletionResult = {
  runStatus: RunStatus;
  loopOutcomeKind?: LoopFinishedEvent["loopOutcomeKind"];
  iterationsConsumed?: number;
  resumable?: boolean;
  error?: RunOperatorError;
};

type Waiter = {
  minSeq: number;
  resolve: (value: WaitRunCompletionResult) => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal;
  abortListener: () => void;
};

type WaitFanout = {
  controller: AbortController;
  waiters: Set<Waiter>;
};

type LoadedRun = NonNullable<ReturnType<StateStore["loadRun"]>>;

type WorkflowStepListStatus = "pending" | "in_progress" | "completed" | "stopped";
type WorkflowStepTerminalOutcome =
  | "complete"
  | "blocked"
  | "contract_miss"
  | "invocation_failure"
  | "budget-exhausted"
  | "paused"
  | "killed"
  | "awaiting-human";

type WorkflowStepListSnapshot = {
  stepId: string;
  role: string;
  status: WorkflowStepListStatus;
  attemptCount: number;
  terminalOutcome?: WorkflowStepTerminalOutcome;
};

/**
 * Live/terminal role progress for `review-debate` steps, keyed by `stepId`. Tracked
 * in-memory only — a `review-debate` step has no durable run row, so this map is the
 * sole source for its `list` row, populated via {@link reportReviewDebateProgress}.
 */
export const reviewDebateProgressByStepId = new Map<string, ReviewDebateProgress>();

/** Records a `review-debate` step's currently-executing or terminal role/outcome. */
export function reportReviewDebateProgress(stepId: string, progress: ReviewDebateProgress): void {
  reviewDebateProgressByStepId.set(stepId, progress);
}

function workflowRowSnapshot(
  run: LoadedRun,
  runsByWorkflowInvocation: ReadonlyMap<string, Map<string, LoadedRun>>,
  liveRunIds: ReadonlySet<string>,
): { steps: WorkflowStepListSnapshot[] } | undefined {
  const snapshot = run.workflowSnapshot;
  if (snapshot === null || snapshot === undefined) return undefined;

  const workflowRuns = runsByWorkflowInvocation.get(snapshot.invocationId) ?? new Map<string, LoadedRun>();
  return {
    steps: snapshot.steps.map((step) => workflowStepSnapshot(step, workflowRuns.get(step.stepId), liveRunIds)),
  };
}

function workflowStepSnapshot(
  step: WorkflowSnapshot["steps"][number],
  run: LoadedRun | undefined,
  liveRunIds: ReadonlySet<string>,
): WorkflowStepListSnapshot {
  if (step.behavior === "review-debate") {
    const progress = reviewDebateProgressByStepId.get(step.stepId);
    if (!progress) {
      return { stepId: step.stepId, role: step.role, status: "pending", attemptCount: 0 };
    }
    if (progress.status === "in_progress") {
      return { stepId: step.stepId, role: progress.role, status: "in_progress", attemptCount: 0 };
    }
    return {
      stepId: step.stepId,
      role: progress.role,
      status: progress.status,
      attemptCount: 0,
      terminalOutcome: progress.terminalOutcome,
    };
  }

  if (!run) {
    return { stepId: step.stepId, role: step.role, status: "pending", attemptCount: 0 };
  }

  const attemptCount = run.attempts.length;
  if (run.status === "completed") {
    return {
      stepId: step.stepId,
      role: step.role,
      status: "completed",
      attemptCount,
      terminalOutcome: "complete",
    };
  }

  if (run.status === "in-progress" && liveRunIds.has(run.id)) {
    return {
      stepId: step.stepId,
      role: step.role,
      status: "in_progress",
      attemptCount,
    };
  }

  return {
    stepId: step.stepId,
    role: step.role,
    status: "stopped",
    attemptCount,
    terminalOutcome: stoppedOutcomeForRun(run),
  };
}

function stoppedOutcomeForRun(run: LoadedRun): Exclude<WorkflowStepTerminalOutcome, "complete"> {
  if (run.status === "blocked") {
    return run.attempts[run.attempts.length - 1]?.outcomeKind === "contract_miss" ? "contract_miss" : "blocked";
  }
  if (run.status === "budget-soft-stopped") return "budget-exhausted";
  if (run.status === "paused") return "paused";
  if (run.status === "killed") return "killed";
  if (run.status === "awaiting-human") return "awaiting-human";
  return "invocation_failure";
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
  const _registry = new WorktreeOwnershipRegistry();
  const activeRuns = new Map<string, ActiveRun>();
  const waitFanouts = new Map<string, WaitFanout>();
  const { stateStore: store, logReader, writeLoopExecutor, failureReporter } = deps;
  const checkWorktreeDirty = deps.isWorktreeDirty ?? isWorktreeDirty;

  const resultFrom = (runId: string, runStatus: RunStatus, record?: TerminalLogRecord): WaitRunCompletionResult => {
    const run = store.loadRun(runId);
    const error = run ? composeRunOperatorError(run, record) : undefined;
    const base: WaitRunCompletionResult =
      record?.event.kind === "loop_finished"
        ? {
            runStatus,
            loopOutcomeKind: record.event.loopOutcomeKind,
            iterationsConsumed: record.event.iterationsConsumed,
            resumable: record.event.resumable,
          }
        : { runStatus };
    return error === undefined ? base : { ...base, error };
  };

  const detachWaiter = (runId: string, waiter: Waiter): void => {
    waiter.signal.removeEventListener("abort", waiter.abortListener);
    const fanout = waitFanouts.get(runId);
    if (!fanout) return;
    fanout.waiters.delete(waiter);
    if (fanout.waiters.size === 0) {
      fanout.controller.abort();
      waitFanouts.delete(runId);
    }
  };

  const resolveWaiters = (runId: string, record: TerminalLogRecord): void => {
    const fanout = waitFanouts.get(runId);
    if (!fanout) return;
    const run = store.loadRun(runId);
    const runStatus = run?.status ?? "failed";
    for (const waiter of Array.from(fanout.waiters)) {
      if (record.seq <= waiter.minSeq) continue;
      detachWaiter(runId, waiter);
      waiter.resolve(resultFrom(runId, runStatus, record));
    }
  };

  const ensureWaitFanout = (runId: string): WaitFanout => {
    const existing = waitFanouts.get(runId);
    if (existing) return existing;

    const fanout: WaitFanout = { controller: new AbortController(), waiters: new Set() };
    waitFanouts.set(runId, fanout);
    (async () => {
      try {
        if (!logReader) return;
        for await (const record of logReader.follow(runId, fanout.controller.signal)) {
          if (record.event.kind === "loop_finished" || record.event.kind === "run_execution_failed") {
            resolveWaiters(runId, record as TerminalLogRecord);
          }
          if (fanout.waiters.size === 0) break;
        }
      } catch (err) {
        for (const waiter of Array.from(fanout.waiters)) {
          detachWaiter(runId, waiter);
          waiter.reject(err);
        }
      } finally {
        fanout.controller.abort();
        waitFanouts.delete(runId);
      }
    })();
    return fanout;
  };

  const spawnWriteLoop = (key: OwnershipKey, runId: string, worktreePath: string, input: WriteLoopInput): void => {
    const ks = ownershipKeyString(key);
    const abortController = new AbortController();
    const pauseController = new AbortController();
    activeRuns.set(ks, { runId, key, abortController, pauseController });

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
      }
    })();
  };

  const startHandler: RpcHandler = (frame) => {
    const params = frame.params as { input?: WriteLoopInput } | undefined;
    if (!params?.input) {
      return { kind: "error", code: "invalid_params", message: "Missing input" };
    }

    const input = normalizeBindings(params.input as WriteLoopInput);
    const key: OwnershipKey = {
      project: input.worktree.projectName,
      branch: input.worktree.branchName,
    };

    // Check per-(project, branch) guard first (more specific than the global guard).
    if (_registry.isClaimed(key)) {
      return {
        kind: "error",
        code: "worktree_claimed",
        message: `Worktree already claimed for project=${key.project}, branch=${key.branch}`,
      };
    }

    // Check single in-flight run guard (global; a different (project, branch) still rejects).
    if (activeRuns.size > 0) {
      return {
        kind: "error",
        code: "run_in_progress",
        message: "A run is already in progress; at most one in-flight run globally",
      };
    }

    const worktreePath = getExternalWorktreePath(input.worktree);
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

    return { kind: "response", result: { runId } };
  };

  const listHandler: RpcHandler = () => {
    const durableRuns = store.listRuns();
    const fullRuns = new Map<string, LoadedRun>();
    const workflowRuns = new Map<string, Map<string, LoadedRun>>();
    const liveRunIds = new Set<string>();

    for (const activeRun of activeRuns.values()) {
      liveRunIds.add(activeRun.runId);
    }

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

    const runList = durableRuns.map((run) => {
      const ks = ownershipKeyString({ project: run.project, branch: run.branch });
      const isLive = activeRuns.get(ks)?.runId === run.id;
      const fullRun = fullRuns.get(run.id);
      const records = logReader?.tail(run.id) ?? [];
      const error = fullRun ? composeRunOperatorError(fullRun, findTerminalLogRecord(records)) : undefined;
      return {
        runId: run.id,
        project: run.project,
        branch: run.branch,
        status: run.status,
        isLive,
        ...(error !== undefined ? { error } : {}),
        ...(fullRun?.workflowSnapshot !== undefined && fullRun?.workflowSnapshot !== null
          ? { workflow: workflowRowSnapshot(fullRun, workflowRuns, liveRunIds) }
          : {}),
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
    const activeRun = activeRuns.get(ks);
    if (activeRun && activeRun.runId === runId) {
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
    const activeRun = activeRuns.get(ks);
    if (activeRun && activeRun.runId === runId) {
      activeRun.abortController.abort();
      store.setRunStatus(runId, "killed");
      return { kind: "response", result: { ok: true } };
    }

    return { kind: "error", code: "run_not_active", message: `Run ${runId} is not currently active` };
  };

  function reviseAwaitingHuman(
    run: LoadedRun,
    prompt: string | undefined,
  ): { kind: "response"; result: unknown } | { kind: "error"; code: string; message: string } {
    const onRevise = run.workflowSnapshot?.steps.find((step) => step.stepId === run.stepId)?.onRevise;
    if (!onRevise) {
      return { kind: "error", code: "revise_unsupported", message: "No onRevise configured for this human step" };
    }

    const repeatedStepConfig = run.workflowSnapshot?.steps.find((step) => step.stepId === onRevise.repeatStepId);
    if (!repeatedStepConfig) {
      return {
        kind: "error",
        code: "revise_unsupported",
        message: `No workflow snapshot config found for repeated step "${onRevise.repeatStepId}"`,
      };
    }

    const repeatedRun = store.findRunByProjectBranch({
      project: run.project,
      branch: run.branch,
      stepId: onRevise.repeatStepId,
    });
    if (!repeatedRun) {
      return {
        kind: "error",
        code: "revise_unsupported",
        message: `No run found for repeated step "${onRevise.repeatStepId}"`,
      };
    }

    const revisionRuns = store.findRevisionRuns({
      project: run.project,
      branch: run.branch,
      repeatStepId: onRevise.repeatStepId,
    });
    const n = nextRevisionNumber(
      revisionRuns.map((revisionRun) => revisionRun.stepId),
      onRevise.repeatStepId,
    );
    if (n > onRevise.maxRevisions) {
      return {
        kind: "error",
        code: "revise_exhausted",
        message: `Revision budget (${onRevise.maxRevisions}) exhausted for step "${onRevise.repeatStepId}"`,
      };
    }

    if (!checkWorktreeDirty(repeatedRun.worktreePath) && !prompt) {
      return {
        kind: "error",
        code: "revise_requires_input",
        message: "revise requires either a dirty worktree or a prompt",
      };
    }

    const key: OwnershipKey = { project: repeatedRun.project, branch: repeatedRun.branch };
    if (_registry.isClaimed(key)) {
      return {
        kind: "error",
        code: "worktree_claimed",
        message: `Worktree already claimed for project=${key.project}, branch=${key.branch}`,
      };
    }
    if (activeRuns.size > 0) {
      return {
        kind: "error",
        code: "run_in_progress",
        message: "A run is already in progress; at most one in-flight run globally",
      };
    }

    const stepId = revisionStepId(onRevise.repeatStepId, n);
    const built = buildRevisionWriteLoopInput(repeatedStepConfig, repeatedRun, stepId, prompt);
    if (built.kind === "error") {
      return built;
    }

    const revisionRunId = store.createRun({
      project: repeatedRun.project,
      specRef: repeatedRun.specRef,
      worktreePath: repeatedRun.worktreePath,
      branch: repeatedRun.branch,
      specPath: repeatedRun.specPath,
      stepId,
      ...(repeatedRun.workflowSnapshot ? { workflowSnapshot: repeatedRun.workflowSnapshot } : {}),
    });

    store.setRunStatus(run.id, "revising");
    spawnWriteLoop(key, revisionRunId, repeatedRun.worktreePath, built.input);

    return { kind: "response", result: { ok: true, stepId } };
  }

  /**
   * A `"revising"` run re-converges to `awaiting-human` once its `~rN` revision
   * run is no longer active (terminal outcome, or killed). Returns the reloaded
   * run on reconvergence, or `undefined` if the revision is still in flight.
   */
  function reconvergeRevisingRun(run: LoadedRun): LoadedRun | undefined {
    const onRevise = run.workflowSnapshot?.steps.find((step) => step.stepId === run.stepId)?.onRevise;
    if (!onRevise) return undefined;

    const revisionRuns = store.findRevisionRuns({
      project: run.project,
      branch: run.branch,
      repeatStepId: onRevise.repeatStepId,
    });
    const latest = latestRevisionRun(revisionRuns, onRevise.repeatStepId);
    if (!latest || !REVISION_INACTIVE_STATUSES.includes(latest.status)) {
      return undefined;
    }

    store.setRunStatus(run.id, "awaiting-human");
    return store.loadRun(run.id) ?? undefined;
  }

  function resumeAwaitingHuman(
    run: LoadedRun,
    decision: string | undefined,
    prompt: string | undefined,
  ): { kind: "response"; result: unknown } | { kind: "error"; code: string; message: string } {
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
      if (activeRun && activeRun.runId === run.id) {
        activeRun.abortController.abort();
      }
      store.setRunStatus(run.id, "killed");
      return { kind: "response", result: { ok: true } };
    }

    if (decision === "revise") {
      return reviseAwaitingHuman(run, prompt);
    }

    return { kind: "error", code: "invalid_params", message: `Unknown decision: ${decision}` };
  }

  const resumeHandler: RpcHandler = (frame) => {
    const params = frame.params as { runId?: string; decision?: string; prompt?: string } | undefined;
    if (!params?.runId) {
      return { kind: "error", code: "invalid_params", message: "Missing runId" };
    }

    const runId = params.runId as string;
    const run = store.loadRun(runId);
    if (!run) {
      return { kind: "error", code: "unknown_run", message: `Run ${runId} not found` };
    }

    if (run.status === "awaiting-human") {
      return resumeAwaitingHuman(run, params.decision, params.prompt);
    }

    if (run.status === "revising") {
      const reconverged = reconvergeRevisingRun(run);
      if (!reconverged) {
        return {
          kind: "error",
          code: "revise_in_progress",
          message: `Run ${runId} is revising; wait for it to re-converge to awaiting-human`,
        };
      }
      return resumeAwaitingHuman(reconverged, params.decision, params.prompt);
    }

    if (params.decision !== undefined) {
      return { kind: "error", code: "invalid_params", message: "decision is only valid for awaiting-human runs" };
    }

    // Reject terminal statuses
    if (run.status === "completed" || run.status === "failed" || run.status === "blocked") {
      return { kind: "error", code: "terminal_run", message: `Cannot resume a ${run.status} run` };
    }

    const key: OwnershipKey = { project: run.project, branch: run.branch };

    // Check per-(project, branch) guard first (more specific than the global guard).
    if (_registry.isClaimed(key)) {
      return {
        kind: "error",
        code: "worktree_claimed",
        message: `Worktree already claimed for project=${key.project}, branch=${key.branch}`,
      };
    }

    // Check single in-flight run guard (global; a different (project, branch) still rejects).
    if (activeRuns.size > 0) {
      return {
        kind: "error",
        code: "run_in_progress",
        message: "A run is already in progress; at most one in-flight run globally",
      };
    }

    // Reconstruct WriteLoopInput from the run and spawn write loop via injected executor
    const input: WriteLoopInput = {
      worktree: {
        projectRoot: run.worktreePath,
        projectName: run.project,
        branchName: run.branch,
        baseRef: run.specRef,
      },
      specPath: run.specPath,
      stepRules: "", // These should be reconstructed from the calling context
      expectedArtifactPath: "", // These should be reconstructed from the calling context
      bindings: [],
    };

    spawnWriteLoop(key, runId, run.worktreePath, input);

    return { kind: "response", result: { ok: true } };
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

    const records = logReader.tail(runId);
    const subscribeSeq = records.at(-1)?.seq ?? 0;
    if (run.status !== "in-progress") {
      return { kind: "response", result: resultFrom(runId, run.status, findTerminalLogRecord(records)) };
    }

    return {
      kind: "response",
      result: await new Promise<WaitRunCompletionResult>((resolve, reject) => {
        const waiter: Waiter = {
          minSeq: subscribeSeq,
          resolve,
          reject,
          signal,
          abortListener: () => {
            detachWaiter(runId, waiter);
            reject(new Error("wait aborted"));
          },
        };
        if (signal.aborted) {
          reject(new Error("wait aborted"));
          return;
        }
        signal.addEventListener("abort", waiter.abortListener, { once: true });
        ensureWaitFanout(runId).waiters.add(waiter);
      }),
    };
  };

  return {
    start: startHandler,
    list: listHandler,
    pause: pauseHandler,
    resume: resumeHandler,
    kill: killHandler,
    wait: waitHandler,
  };
}

/**
 * Injectable dependencies for {@link createTailStreamHandler}.
 *
 * - `stateStore`: durable run rows — `loadRun` gates unknown runs; falsy closes without calling
 *   `follow`. Guard paths are non-throwing; `loadRun` rejections propagate to IPC.
 * - `logReader`: persisted log events — `follow` replays and streams appends only after a truthy
 *   `loadRun`. `follow` and `onData` failures propagate to IPC as error `stream-end`.
 *
 * @throws N/A — deps bag only; the factory does not throw at construction.
 * @invariant Handler never invokes `logReader.follow` without a prior truthy `loadRun`.
 * @invariant Malformed payload and unknown-run guard paths close synchronously without `follow`.
 */
export type TailStreamHandlerDeps = {
  stateStore: StateStore;
  logReader: LogReader;
};

/**
 * Tail-log stream handler factory for IPC `stream-open` on run logs.
 *
 * @param deps - {@link TailStreamHandlerDeps}
 * @returns A {@link StreamHandler} — replays persisted events and streams live appends for known runs.
 * @throws N/A at factory call — returned handler may throw/reject on string-payload `JSON.parse`,
 *   `loadRun`, `follow`, or `onData` failures; IPC server maps those to error `stream-end`.
 * @invariant Validates `loadRun` before calling `follow`; unknown or malformed `runId` closes without data.
 * @invariant Guard paths (malformed/missing `runId`, unknown run) invoke `onClose` once synchronously
 *   and never call `follow`.
 * @invariant Follow path invokes `onClose` in `finally` after `follow` completes or aborts.
 */
export function createTailStreamHandler(deps: TailStreamHandlerDeps): StreamHandler {
  return async (_streamId, payload, onData, onClose, signal) => {
    const params = typeof payload === "string" && payload ? JSON.parse(payload) : payload;
    if (!params?.runId || typeof params.runId !== "string") {
      onClose();
      return;
    }

    const runId = params.runId;
    if (!deps.stateStore.loadRun(runId)) {
      onClose();
      return;
    }

    try {
      for await (const record of deps.logReader.follow(runId, signal)) {
        if (signal.aborted) break;
        onData(record);
      }
    } finally {
      onClose();
    }
  };
}

export async function startDaemon(socketPath: string, stateStore?: StateStore, logReader?: LogReader): Promise<void> {
  const store = stateStore ?? openStateStore();
  const logsPath = join(homedir(), ".jarvis", "state", "logs.jsonl");
  const logReaderInstance = logReader ?? openLogReader(logsPath);
  let shutdownRequested = false;

  const writeLoopExecutor = async (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal) => {
    const logSink = openLogSink(logsPath);
    try {
      await executeWriteLoop({
        ...input,
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

  const handlers: Record<string, RpcHandler> = {
    health: healthHandler,
    status: statusHandler,
    shutdown: shutdownHandler,
    ...createRunControlHandlers({
      stateStore: store,
      logReader: logReaderInstance,
      writeLoopExecutor,
      failureReporter: createRunExecutionFailureReporter(logsPath),
    }),
  };

  let server: IpcServer;

  try {
    server = await startIpcServer(socketPath, handlers, tailStreamHandler);
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
