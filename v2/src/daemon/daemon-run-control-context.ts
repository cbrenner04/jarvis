import type { CliDeps } from "../cli/deps.ts";
import { resolveMachineProfile } from "../config/machine-config-loader.ts";
import type { InvocationFailureDetail, InvocationFailureKind } from "../execution/invocation-failure.ts";
import type { TerminalPublicationInput, TerminalPublicationResult } from "../execution/terminal-publication.ts";
import type { ReviewProgress } from "../execution/workflow-runner.ts";
import type { IntentFinalizationResumeDeps } from "../execution/workflow-runner-resume.ts";
import type { WriteLoopInput } from "../execution/write-loop.ts";
import type { IpcClient } from "../ipc/client";
import type { LogReader } from "../persistence/log-stream.ts";
import { truncateLogText } from "../persistence/log-stream.ts";
import type { StateStore } from "../persistence/state-store.ts";
import type { ActiveRun, OwnershipKey, PromotionSettleState, WorktreeOwnershipRegistry } from "./daemon.ts";
import { WorktreeOwnershipRegistry as WorktreeOwnershipRegistryImpl } from "./daemon.ts";
import { hasMemoryHeadroom, loadSettleDelayMs } from "./memory-watermark.ts";
import { bindPipelineWaitObserver, PipelineWaitObserver } from "./pipeline-observation.ts";
import type { PipelineWorkflowDispatch, PipelineWorkflowWait } from "./pipeline-stage-dispatch.ts";
import type { NotificationWaitRegistry } from "./daemon-notification-wait.ts";
import type { PipelineStageRecoveryAttempt } from "./pipeline-stage-recovery.ts";
import type { resolveStageWorkflowSteps } from "./pipeline-stage-resolve.ts";

export type RunControlHandlerContextDeps = {
  stateStore: StateStore;
  logReader?: LogReader;
  logsPath?: string;
  operatorSessionId?: string;
  writeLoopExecutor: (input: WriteLoopInput, signal: AbortSignal, pauseSignal: AbortSignal) => Promise<void>;
  failureReporter: (runId: string, reason: unknown) => void | Promise<void>;
  hasMemoryHeadroom?: () => boolean;
  settleDelayMs?: number;
  registry?: WorktreeOwnershipRegistry;
  intentFinalizationResumeDeps?: Omit<IntentFinalizationResumeDeps, "logSink">;
  resolveStage?: typeof resolveStageWorkflowSteps;
  pipelineDispatch?: PipelineWorkflowDispatch;
  pipelineWait?: PipelineWorkflowWait;
  recoveryAttempt?: PipelineStageRecoveryAttempt;
  recoveryLogSinkFactory?: (storagePath: string) => import("../persistence/log-stream.ts").LogSink;
  executeTerminalPublication?: (input: TerminalPublicationInput) => Promise<TerminalPublicationResult>;
  daemonSocketPath?: string;
  connectStaleResetClient?: (socketPath: string) => Promise<IpcClient>;
  staleResetCliDeps?: CliDeps;
  reconciledRunIds?: readonly string[];
  notificationWaitRegistry?: NotificationWaitRegistry;
};

export type RunControlHandlerContext = {
  registry: WorktreeOwnershipRegistry;
  activeRuns: Map<string, ActiveRun>;
  waitAbortControllers: Set<AbortController>;
  retiring: boolean;
  reviewDebateProgressByInvocation: Map<string, Map<string, ReviewProgress>>;
  reportReviewProgress: (invocationId: string, stepId: string, progress: ReviewProgress) => void;
  clearLiveReviewProgress: (invocationId: string) => void;
  workflowPromisesByEntryRunId: Map<string, Promise<void>>;
  pipelineWaitObserver: PipelineWaitObserver;
  store: StateStore;
  logReader: LogReader | undefined;
  writeLoopExecutor: RunControlHandlerContextDeps["writeLoopExecutor"];
  failureReporter: RunControlHandlerContextDeps["failureReporter"];
  logsPath: string | undefined;
  operatorSessionId: string | undefined;
  intentFinalizationResumeDeps: RunControlHandlerContextDeps["intentFinalizationResumeDeps"];
  checkMemoryHeadroom: () => boolean;
  settleDelayMs: () => number;
  settleState: PromotionSettleState;
};

export function createRunControlHandlerContext(deps: RunControlHandlerContextDeps): RunControlHandlerContext {
  const registry = deps.registry ?? new WorktreeOwnershipRegistryImpl();
  const activeRuns = new Map<string, ActiveRun>();
  const waitAbortControllers = new Set<AbortController>();
  const reviewDebateProgressByInvocation = new Map<string, Map<string, ReviewProgress>>();
  const reportReviewProgress = (invocationId: string, stepId: string, progress: ReviewProgress): void => {
    let steps = reviewDebateProgressByInvocation.get(invocationId);
    if (!steps) {
      steps = new Map<string, ReviewProgress>();
      reviewDebateProgressByInvocation.set(invocationId, steps);
    }
    if (progress.status === "in_progress") {
      steps.set(stepId, progress);
      return;
    }
    steps.set(stepId, { ...progress, attemptCount: Math.max(progress.attemptCount ?? 0, 1) });
  };
  const clearLiveReviewProgress = (invocationId: string): void => {
    const steps = reviewDebateProgressByInvocation.get(invocationId);
    if (steps === undefined) return;
    for (const [stepId, progress] of steps) {
      if (progress.status === "in_progress") steps.delete(stepId);
    }
    if (steps.size === 0) reviewDebateProgressByInvocation.delete(invocationId);
  };
  const workflowPromisesByEntryRunId = new Map<string, Promise<void>>();
  const pipelineWaitObserver = new PipelineWaitObserver();
  const store = bindPipelineWaitObserver(deps.stateStore, pipelineWaitObserver);
  const { logReader, writeLoopExecutor, failureReporter, logsPath, operatorSessionId, intentFinalizationResumeDeps } =
    deps;
  const checkMemoryHeadroom = deps.hasMemoryHeadroom ?? (() => hasMemoryHeadroom(resolveMachineProfile()));
  const injectedSettleDelayMs = deps.settleDelayMs;
  const settleDelayMs: () => number =
    injectedSettleDelayMs !== undefined
      ? () => injectedSettleDelayMs
      : () => loadSettleDelayMs(resolveMachineProfile());
  const settleState: PromotionSettleState = { suppressedUntil: 0 };

  return {
    registry,
    activeRuns,
    waitAbortControllers,
    retiring: false,
    reviewDebateProgressByInvocation,
    reportReviewProgress,
    clearLiveReviewProgress,
    workflowPromisesByEntryRunId,
    pipelineWaitObserver,
    store,
    logReader,
    writeLoopExecutor,
    failureReporter,
    logsPath,
    operatorSessionId,
    intentFinalizationResumeDeps,
    checkMemoryHeadroom,
    settleDelayMs,
    settleState,
  };
}

/** Single owner for the `activeRuns` map key; handler modules must not re-derive it. */
export function ownershipKeyString(key: OwnershipKey): string {
  return `${key.project}:${key.branch}`;
}

/** Single owner for daemon-side invocation-failure details; keeps bounded message truncation uniform. */
export function daemonFailureDetail(failureKind: InvocationFailureKind, message: string): InvocationFailureDetail {
  return { failureKind, bindingAttempts: [], message: truncateLogText(message) };
}
