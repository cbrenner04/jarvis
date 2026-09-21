import { existsSync } from "node:fs";
import type { InvocationBinding } from "../../../shared/invocation/execute.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import {
  type AgentModelConfig,
  resolveExecutableRole,
  resolveInvocationBindings,
} from "../config/agent-model-config.ts";
import {
  getExternalWorktreePath,
  withExternalWorktree as realWithExternalWorktree,
  WorktreeMaterializationError,
} from "../execution/external-worktree.ts";
import {
  type AnyWorkflowStep,
  executeWorkflow,
  LinkedIndexReadError,
  workflowTelemetryLabel,
} from "../execution/workflow-runner.ts";
import {
  type IntentFinalizationResumeDeps,
  REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS,
  resolveReviewMutationLineageContext,
  resumeReviewMutationFinalization,
} from "../execution/workflow-runner-resume.ts";
import type { RpcHandler } from "../ipc/server.ts";
import { type LogSink, openLogSink } from "../persistence/log-stream.ts";
import {
  isTerminalRunStatus,
  type Run,
  type RunStatus,
  type StateStore,
  type WorkflowSnapshot,
} from "../persistence/state-store.ts";
import {
  type ActiveRun,
  checkWorktreeClaimed,
  type OwnershipKey,
  previewWorkflowStartClaimAdmissionRefusal,
  productionAgentBindingFactory,
  settleKilledWorkflowOwnership,
  type WorktreeOwnership,
  workflowStartOwnershipKey,
} from "./daemon.ts";
import { daemonFailureDetail, type RunControlHandlerContext } from "./daemon-run-control-context.ts";
import type { RunLifecycleHandlers } from "./daemon-run-lifecycle-handlers.ts";
import { findTerminalLogRecord } from "./run-operator-error.ts";
import { armRunTimeout, fireRunTimeout, runTimeoutExhaustedRefusal } from "./run-time-budget.ts";
import { resolveInvocationEntryRunId, settleStagesForEntryRun } from "./stage-settlement-owner.ts";

type WorkflowStartResult =
  | { kind: "response"; result: unknown }
  | { kind: "error"; code: string; message: string }
  | Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }>;

/** Resolves a refusal to return before any spawn, or `undefined` once the resumed row is admitted. */
type ResumeRunAdmission = () => Promise<{ kind: "error"; code: string; message: string } | undefined>;

type WorkflowStartLifecycle = {
  key: OwnershipKey;
  ownership: WorktreeOwnership;
  activeKey: string;
  activeRun: ActiveRun;
  admit: () =>
    | { kind: "admitted" }
    | { kind: "refused"; result: Awaited<WorkflowStartResult> }
    | Promise<{ kind: "admitted" } | { kind: "refused"; result: Awaited<WorkflowStartResult> }>;
  execute: (onSettled: () => void) => WorkflowStartResult;
  rollbackAdmission?: () => void;
  settle?: () => void;
};

export type WorkflowStartAdmission = {
  handleWorkflowStart: (steps: AnyWorkflowStep[]) => WorkflowStartResult;
  resumeLinkedWorkflowStart: (
    steps: AnyWorkflowStep[],
    workflowSnapshot: WorkflowSnapshot,
    admitRun?: ResumeRunAdmission,
    rollbackRunAdmission?: () => void,
    settleStagesAfterResume?: (runId: string) => void,
  ) => WorkflowStartResult;
  admitWorkflowStart: (lifecycle: WorkflowStartLifecycle) => Promise<Awaited<WorkflowStartResult>>;
  check_workflow_start_claim: RpcHandler;
};

type WorkflowAdmissionHandlerDeps = {
  resumeFinalizationOnly: RunLifecycleHandlers["resumeFinalizationOnly"];
};

type ImplementRecoverMutationRepairParams = {
  agents?: readonly string[];
  agentModelConfig?: AgentModelConfig;
  stepRules?: string;
  iterationTimeoutMs?: number;
  iterationCeilingMs?: number;
  idleOutputMs?: number;
};

function isSettledRunStatus(status: RunStatus): boolean {
  return isTerminalRunStatus(status) || status === "paused";
}

/** Settled-marker cause for one workflow invocation. Killed wins: an aborted workflow also rejects into `.catch`. */
function resolveWorkflowInvocationSettledCause(
  hasKilledRuns: boolean,
  workflowSettledFailed: boolean,
  timedOut: boolean,
): "completed" | "failed" | "killed" {
  if (hasKilledRuns) return "killed";
  if (workflowSettledFailed || timedOut) return "failed";
  return "completed";
}

/** Best-effort like stage settlement: the owning `finally` can outlive the store at shutdown. */
function writeWorkflowInvocationSettledMarkerBestEffort(
  store: StateStore,
  entryRunId: string,
  cause: "completed" | "failed" | "killed",
): void {
  try {
    store.writeWorkflowInvocationSettledMarker(entryRunId, cause, Date.now());
  } catch (markerError) {
    console.error(`Workflow invocation settled marker write for ${entryRunId} failed:`, markerError);
  }
}

/** Validate and resolve `implement.recover`'s optional mutation-repair params into resume deps. */
function buildImplementRecoverMutationRepairDeps(repair: ImplementRecoverMutationRepairParams | undefined):
  | {
      bindings: readonly InvocationBinding[];
      stepRules: string;
      iterationTimeoutMs?: number;
      iterationCeilingMs?: number;
      idleOutputMs?: number;
    }
  | undefined {
  if (
    repair === undefined ||
    !Array.isArray(repair.agents) ||
    repair.agentModelConfig === undefined ||
    typeof repair.stepRules !== "string"
  ) {
    return undefined;
  }
  return {
    bindings: resolveInvocationBindings(
      resolveExecutableRole("implement"),
      repair.agents,
      repair.agentModelConfig,
      productionAgentBindingFactory(),
    ),
    stepRules: repair.stepRules,
    ...(repair.iterationTimeoutMs !== undefined ? { iterationTimeoutMs: repair.iterationTimeoutMs } : {}),
    ...(repair.iterationCeilingMs !== undefined ? { iterationCeilingMs: repair.iterationCeilingMs } : {}),
    ...(repair.idleOutputMs !== undefined ? { idleOutputMs: repair.idleOutputMs } : {}),
  };
}

/** Map a finalization-resume outcome to `implement.recover`'s admitted/not-admitted response shape. */
function mapImplementRecoverOutcome(
  outcome: { kind: "response"; result: unknown } | { kind: "error"; code: string; message: string },
): { kind: "response"; result: unknown } | { kind: "error"; code: string; message: string } {
  if (outcome.kind === "error") return outcome;
  const result = outcome.result as { ok?: unknown; message?: unknown; prNumber?: unknown; prUrl?: unknown };
  return {
    kind: "response",
    result:
      result.ok === true
        ? {
            kind: "admitted",
            ok: true,
            ...(typeof result.prNumber === "number" ? { prNumber: result.prNumber } : {}),
            ...(typeof result.prUrl === "string" ? { prUrl: result.prUrl } : {}),
          }
        : {
            kind: "admitted",
            ok: false,
            message: typeof result.message === "string" ? result.message : "Recovery finalization failed",
          },
  };
}

/** A workflow's step rows settled: queue any slot-contention refusal among them for re-drive. */
function enqueueSlotRedrives(ctx: RunControlHandlerContext, runIds: Iterable<string>): void {
  for (const runId of runIds) ctx.slotRedrive.enqueue(runId);
}

export function createWorkflowStartAdmission(ctx: RunControlHandlerContext): WorkflowStartAdmission {
  const registry = ctx.registry;
  const activeRuns = ctx.activeRuns;
  const store = ctx.store;
  const {
    logsPath,
    operatorSessionId,
    reportReviewProgress,
    clearLiveReviewProgress,
    workflowPromisesByEntryRunId,
    checkMemoryHeadroom,
  } = ctx;

  const settleFailedWorkflowRun = (runId: string, message: string, logSink: LogSink | undefined): void => {
    let alreadySettled = false;
    try {
      const run = store.loadRun(runId);
      alreadySettled = run !== null && isSettledRunStatus(run.status);
    } catch {
      // best-effort read; store may already be closed (daemon shutdown races the last workflow)
    }
    if (!alreadySettled) {
      try {
        store.commitTerminalRunSettlement({
          runId,
          status: "failed",
          terminalCause: "invocation_failure",
          terminalFailureDetail: daemonFailureDetail("error", message),
        });
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

  const startWorkflowRun = (
    steps: AnyWorkflowStep[],
    _claimRunId: string,
    abortController: AbortController,
    settleWorkflowStart: () => void,
    freshDispatch = true,
    workflowSnapshot?: WorkflowSnapshot,
    settleStagesAfterResume?: (runId: string) => void,
  ): Promise<{ kind: "response"; result: unknown } | { kind: "error"; code: string; message: string }> => {
    return new Promise((resolve) => {
      const workflowRunIds = new Set<string>();
      let entryRunId: string | undefined;
      let canonicalEntryRunId: string | undefined;
      let workflowInvocationId: string | undefined;
      let workflowSettledFailed = false;
      let trackPromiseResolve: (() => void) | undefined;
      const trackPromise = new Promise<void>((res) => {
        trackPromiseResolve = () => res();
      });
      const logSink = logsPath !== undefined ? openLogSink(logsPath) : undefined;
      const telemetry =
        operatorSessionId !== undefined ? { operatorSessionId, workflow: workflowTelemetryLabel(steps) } : undefined;
      const stepsForExecution = steps.map((step) => ({ ...step, signal: abortController.signal }));
      const firstStepInvocationId = steps[0]?.behavior === "write" ? steps[0].workflowInvocationId : undefined;
      const budgetMs = ctx.runTimeout?.budgetMs?.(workflowStartOwnershipKey(steps).project);
      const runTimeout = armRunTimeout({
        store,
        budgetKey: firstStepInvocationId,
        budgetMs,
        runIds: () => workflowRunIds,
        ...(ctx.runTimeout?.timers !== undefined ? { timers: ctx.runTimeout.timers } : {}),
        ...(ctx.runTimeout?.settlementBoundMs !== undefined
          ? { settlementBoundMs: ctx.runTimeout.settlementBoundMs }
          : {}),
        onTimeout: (consumedMs) =>
          fireRunTimeout({
            store,
            abortController,
            runIds: workflowRunIds,
            logSink,
            budgetMs: budgetMs ?? 0,
            consumedMs,
          }),
      });
      const execute = async () => {
        const firstStep = stepsForExecution[0];
        if (firstStep?.behavior === "write" && firstStep.role === "implement" && firstStep.linkedIndexRouting) {
          await (firstStep.withExternalWorktree ?? realWithExternalWorktree)(firstStep.worktree, () => undefined);
        }
        return executeWorkflow({
          steps: stepsForExecution,
          stateStore: store,
          freshDispatch,
          ...(workflowSnapshot !== undefined ? { workflowSnapshot } : {}),
          ...(logSink !== undefined ? { logSink } : {}),
          ...(telemetry !== undefined ? { telemetry } : {}),
          onReviewDebateProgress: reportReviewProgress,
          onStepRunCreated: (stepIndex, runId) => {
            workflowRunIds.add(runId);
            activeRuns.set(runId, { kind: "workflow", runId, abortController });
            // Linked-implement link and shrink rows also report step 0; only the first is the entry.
            if (stepIndex === 0 && entryRunId === undefined) {
              entryRunId = runId;
              canonicalEntryRunId = resolveInvocationEntryRunId(store, runId);
              workflowInvocationId = store.loadRun(runId)?.workflowSnapshot?.invocationId;
              runTimeout.bindKey(workflowInvocationId ?? runId);
              workflowPromisesByEntryRunId.set(canonicalEntryRunId, trackPromise);
              resolve({ kind: "response", result: { runId } });
            }
          },
        });
      };
      execute()
        .then((result) => {
          // A workflow that returns a non-`complete` outcome is not an exception, so the catch
          // below never sees it — and before this, the result was simply discarded. The entry run
          // could then sit durably `completed` (its write loop settles the row before the
          // publication tail runs) with no commit tail, no PR and no diagnostic. The runner now
          // settles the owning step row itself; this logs the workflow-level verdict so the
          // operator can see which step ended the workflow and why.
          if (result.kind === "complete") return;
          workflowSettledFailed = true;
          const detail = result.routingFailure ?? result.invocationFailureMessage ?? result.kind;
          console.error(
            `Workflow ended ${result.kind} (${workflowTelemetryLabel(steps)}) at step ${String(result.stepIndex)} ${result.stepId}: ${detail}`,
          );
        })
        .catch((err) => {
          workflowSettledFailed = true;
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
          runTimeout.settle();
          logSink?.close();
          const killedWorkflowRuns = [...workflowRunIds].filter((runId) => {
            const activeRun = activeRuns.get(runId);
            return activeRun?.kind === "workflow" && activeRun.pendingKill;
          });
          for (const runId of workflowRunIds) activeRuns.delete(runId);
          settleKilledWorkflowOwnership({
            killedRunIds: killedWorkflowRuns,
            releaseRegistry: settleWorkflowStart,
            stateStore: store,
          });
          enqueueSlotRedrives(ctx, workflowRunIds);
          if (workflowInvocationId !== undefined) {
            clearLiveReviewProgress(workflowInvocationId);
          }
          if (entryRunId !== undefined) {
            const settlementEntryRunId = canonicalEntryRunId ?? entryRunId;
            workflowPromisesByEntryRunId.delete(settlementEntryRunId);
            // Terminal event: the invocation is no longer live, so its durable rows settle every
            // linked stage now — whether or not anything still awaits the promise. Best-effort by
            // design: this runs in a promise `finally` that can outlive the store (daemon shutdown
            // races the last workflow), and a store that is gone has nothing left to settle. The
            // daemon-start sweep settles anything missed here.
            try {
              if (settleStagesAfterResume !== undefined) {
                settleStagesAfterResume(settlementEntryRunId);
              } else {
                settleStagesForEntryRun(
                  {
                    store,
                    isEntryRunLive: () => false,
                    loadLogRecords: ctx.logReader === undefined ? undefined : (id) => ctx.logReader?.tail(id) ?? [],
                  },
                  settlementEntryRunId,
                );
              }
            } catch (settlementError) {
              console.error(`Stage settlement after terminal run ${settlementEntryRunId} failed:`, settlementError);
            }
            const settledCause = resolveWorkflowInvocationSettledCause(
              killedWorkflowRuns.length > 0,
              workflowSettledFailed,
              runTimeout.timedOut(),
            );
            writeWorkflowInvocationSettledMarkerBestEffort(store, settlementEntryRunId, settledCause);
          }
          trackPromiseResolve?.();
        });
    });
  };

  /** Shared ownership, memory, and lifecycle boundary for every daemon workflow execution. */
  const admitWorkflowStart = async (lifecycle: WorkflowStartLifecycle): Promise<Awaited<WorkflowStartResult>> => {
    const existingWorkflowClaim = registry.get(lifecycle.key);
    if (existingWorkflowClaim?.workflow === true && activeRuns.get(existingWorkflowClaim.runId)?.kind !== "workflow") {
      registry.release(lifecycle.key, existingWorkflowClaim.runId);
    }
    const claimError = previewWorkflowStartClaimAdmissionRefusal(store, registry, activeRuns, lifecycle.key);
    if (claimError) return claimError;
    if (!checkMemoryHeadroom()) {
      return {
        kind: "error",
        code: "insufficient_memory",
        message: "Insufficient memory headroom to start workflow",
      };
    }

    let registryClaimed = false;
    let activeRegistered = false;
    let released = false;
    const releaseCommonAdmission = (): void => {
      if (released) return;
      released = true;
      if (activeRegistered && activeRuns.get(lifecycle.activeKey) === lifecycle.activeRun) {
        activeRuns.delete(lifecycle.activeKey);
      }
      if (registryClaimed) registry.release(lifecycle.key, lifecycle.ownership.runId);
    };
    const finishAdmission = (hook?: () => void): void => {
      try {
        hook?.();
      } finally {
        releaseCommonAdmission();
      }
    };

    try {
      registry.claim(lifecycle.key, lifecycle.ownership);
      registryClaimed = true;
      activeRuns.set(lifecycle.activeKey, lifecycle.activeRun);
      activeRegistered = true;
      const admission = lifecycle.admit();
      const resolvedAdmission = admission instanceof Promise ? await admission : admission;
      if (resolvedAdmission.kind === "refused") {
        finishAdmission(lifecycle.rollbackAdmission);
        return resolvedAdmission.result;
      }
      const executeResult = lifecycle.execute(() => finishAdmission(lifecycle.settle));
      const resolvedExecute = executeResult instanceof Promise ? await executeResult : executeResult;
      if (resolvedExecute.kind === "error") {
        finishAdmission(lifecycle.rollbackAdmission);
      }
      return resolvedExecute;
    } catch (error) {
      finishAdmission(lifecycle.rollbackAdmission);
      throw error;
    }
  };

  const handleWorkflowStart = (steps: AnyWorkflowStep[]): WorkflowStartResult => {
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
    const exhausted =
      firstStep?.behavior === "write" && firstStep.workflowInvocationId !== undefined
        ? runTimeoutExhaustedRefusal(
            store,
            firstStep.workflowInvocationId,
            ctx.runTimeout?.budgetMs?.(firstStep.worktree.projectName),
          )
        : undefined;
    if (exhausted) return exhausted;
    const workflowKey = workflowStartOwnershipKey(steps);
    const worktreePath = firstStep?.behavior === "write" ? getExternalWorktreePath(firstStep.worktree) : "";
    const claimRunId = crypto.randomUUID();
    const abortController = new AbortController();
    return admitWorkflowStart({
      key: workflowKey,
      ownership: { runId: claimRunId, worktreePath, workflow: true },
      activeKey: claimRunId,
      activeRun: { kind: "workflow", runId: claimRunId, abortController },
      admit: () => ({ kind: "admitted" }),
      execute: (onSettled) => startWorkflowRun(steps, claimRunId, abortController, onSettled),
    });
  };

  /**
   * Re-enter `executeWorkflow`'s linked/shrink/review/publication sequencing for an
   * already-admitted linked-implement invocation, reusing its persisted `workflowSnapshot` (so the
   * resumed run keeps its original `invocationId`) instead of minting a fresh one. Unlike
   * `handleWorkflowStart`, dispatch is not fresh: `prepareWorkflowStep`/`prepareRun` reenter each
   * step's existing durable row by `stepId` rather than creating new ones.
   */
  const resumeLinkedWorkflowStart = (
    steps: AnyWorkflowStep[],
    workflowSnapshot: WorkflowSnapshot,
    admitRun?: ResumeRunAdmission,
    rollbackRunAdmission?: () => void,
    settleStagesAfterResume?: (runId: string) => void,
  ): WorkflowStartResult => {
    const workflowKey = workflowStartOwnershipKey(steps);
    const firstStep = steps[0];
    const worktreePath = firstStep?.behavior === "write" ? getExternalWorktreePath(firstStep.worktree) : "";
    const claimRunId = crypto.randomUUID();
    const abortController = new AbortController();
    return admitWorkflowStart({
      key: workflowKey,
      ownership: { runId: claimRunId, worktreePath, workflow: true },
      activeKey: claimRunId,
      activeRun: { kind: "workflow", runId: claimRunId, abortController },
      // Admitted after the claim checks, before any spawn: a refusal leaves the row untouched.
      admit: async () => {
        const refusal = await admitRun?.();
        return refusal ? { kind: "refused", result: refusal } : { kind: "admitted" };
      },
      // An execute error after an applied admission restores the row's pre-admission status.
      ...(rollbackRunAdmission !== undefined ? { rollbackAdmission: rollbackRunAdmission } : {}),
      execute: (onSettled) =>
        startWorkflowRun(
          steps,
          claimRunId,
          abortController,
          onSettled,
          false,
          workflowSnapshot,
          settleStagesAfterResume,
        ),
    });
  };

  const check_workflow_start_claim: RpcHandler = (frame) => {
    const params = frame.params as { project?: string; branch?: string } | undefined;
    if (typeof params?.project !== "string" || typeof params?.branch !== "string") {
      return { kind: "error", code: "invalid_params", message: "project and branch required" };
    }
    const key: OwnershipKey = { project: params.project, branch: params.branch };
    const refusal = previewWorkflowStartClaimAdmissionRefusal(store, registry, activeRuns, key);
    if (refusal) {
      return refusal;
    }
    return { kind: "response", result: { ok: true } };
  };

  return { handleWorkflowStart, resumeLinkedWorkflowStart, admitWorkflowStart, check_workflow_start_claim };
}

export function createImplementRecoverHandler(
  ctx: RunControlHandlerContext,
  deps: WorkflowAdmissionHandlerDeps,
): RpcHandler {
  const registry = ctx.registry;
  const store = ctx.store;
  const logReader = ctx.logReader;
  const { resumeFinalizationOnly } = deps;

  type ImplementRecoverParams = {
    project?: string;
    branch?: string;
    specPath?: string;
    detach?: boolean;
    mutationRepair?: ImplementRecoverMutationRepairParams;
  };
  type ImplementRecoverResult =
    | { kind: "response"; result: unknown }
    | { kind: "error"; code: string; message: string };

  /** Attempt recovery against a single lineage row; returns undefined to let the caller try the next row. */
  const tryImplementRecoverRow = async (
    row: Run,
    params: ImplementRecoverParams & { project: string; branch: string; specPath: string },
    key: OwnershipKey,
  ): Promise<ImplementRecoverResult | undefined> => {
    const resolved = resolveReviewMutationLineageContext(row, store);
    if (!resolved.ok || resolved.context.specPath !== params.specPath) return undefined;
    const run = store.loadRun(row.id);
    if (!run) return undefined;
    const terminalRecord = logReader ? findTerminalLogRecord(logReader.tail(run.id)) : undefined;
    const outcomeKind =
      terminalRecord?.event.kind === "loop_finished" ? terminalRecord.event.loopOutcomeKind : undefined;
    if (outcomeKind === undefined || !REVIEW_MUTATION_RESUMABLE_OUTCOME_KINDS.has(outcomeKind)) {
      return { kind: "response", result: { kind: "not_admitted" } };
    }

    if (!existsSync(resolved.context.worktreePath)) {
      return {
        kind: "error",
        code: "implement.recovery_target_missing",
        message: `Recovery worktree missing: ${resolved.context.worktreePath}`,
      };
    }
    try {
      await realAsyncSubprocessRunner.runAsync(
        "git",
        ["rev-parse", "--verify", `refs/heads/${resolved.context.branch}`],
        resolved.context.worktreePath,
        { stdio: "ignore" },
      );
    } catch {
      return {
        kind: "error",
        code: "implement.recovery_target_missing",
        message: `Recovery branch missing: ${resolved.context.branch}`,
      };
    }

    const claimError = checkWorktreeClaimed(registry, key);
    if (claimError) return claimError;
    const mutationRepair = buildImplementRecoverMutationRepairDeps(params.mutationRepair);
    const execute = (resumeDeps: IntentFinalizationResumeDeps) =>
      resumeReviewMutationFinalization(run, store, terminalRecord, {
        ...resumeDeps,
        ...(mutationRepair ? { mutationRepair } : {}),
      });
    if (params.detach === true) {
      void resumeFinalizationOnly(run, key, execute, true);
      return { kind: "response", result: { kind: "admitted", ok: true } };
    }
    return mapImplementRecoverOutcome(await resumeFinalizationOnly(run, key, execute, true));
  };

  return async (frame) => {
    if (ctx.retiring) {
      return { kind: "error", code: "daemon_superseded", message: "Daemon is retiring and not accepting new work" };
    }
    const params = frame.params as ImplementRecoverParams | undefined;
    if (
      typeof params?.project !== "string" ||
      typeof params.branch !== "string" ||
      typeof params.specPath !== "string"
    ) {
      return { kind: "error", code: "invalid_params", message: "project, branch, and specPath required" };
    }

    const key: OwnershipKey = { project: params.project, branch: params.branch };
    const validatedParams = { ...params, project: params.project, branch: params.branch, specPath: params.specPath };
    for (const row of store.findReviewMutationLineageRows(key)) {
      const rowResult = await tryImplementRecoverRow(row, validatedParams, key);
      if (rowResult !== undefined) return rowResult;
    }
    return { kind: "response", result: { kind: "not_admitted" } };
  };
}
