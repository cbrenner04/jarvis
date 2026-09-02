import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { TerminalPublicationInput, TerminalPublicationResult } from "../execution/terminal-publication.ts";
import { recoverPlanStage } from "../execution/workflow-runner.ts";
import { connectIpcClient, type IpcClient } from "../ipc/client";
import type { RpcHandler } from "../ipc/server.ts";
import { jarvisHome } from "../paths.ts";
import { type LogSink, openLogSink } from "../persistence/log-stream.ts";
import { loadPipelineContext } from "../persistence/state-store.ts";
import type { ActiveRun, OwnershipKey } from "./daemon.ts";
import type { RunControlHandlerContext } from "./daemon-run-control-context.ts";
import type { WorkflowStartAdmission } from "./daemon-workflow-admission-handlers.ts";
import {
  applyPipelineApprovalDecision,
  derivePipelineState,
  type PipelineExecutionDeps,
  recoverContinuablePipelines,
  resumePipeline,
  runPipeline,
} from "./pipeline-execution.ts";
import {
  PIPELINE_WAIT_ABORTED,
  PipelineWaitAbortedError,
  projectPipelineSnapshot,
  waitForPipelineBoundary,
} from "./pipeline-observation.ts";
import type { PipelineWorkflowDispatch, PipelineWorkflowWait } from "./pipeline-stage-dispatch.ts";
import {
  claimResolvedPipelineBranchStageRecovery,
  executeClaimedPipelineBranchStageRecovery,
  type PipelineStageRecoveryAttempt,
  resolveBlockedPlanStageRecoveryTarget,
} from "./pipeline-stage-recovery.ts";
import { resolveStageWorkflowSteps } from "./pipeline-stage-resolve.ts";

const STALE_RESET_RPC_TIMEOUT_MS = 30_000;

function ownershipKeyString(key: OwnershipKey): string {
  return `${key.project}:${key.branch}`;
}

export type PipelineHandlerDeps = {
  pipelineDispatch: PipelineWorkflowDispatch;
  pipelineWait: PipelineWorkflowWait;
  admitWorkflowStart: WorkflowStartAdmission["admitWorkflowStart"];
  resolveStage?: typeof resolveStageWorkflowSteps;
  recoveryAttempt?: PipelineStageRecoveryAttempt;
  recoveryLogSinkFactory?: (storagePath: string) => LogSink;
  executeTerminalPublication?: (input: TerminalPublicationInput) => Promise<TerminalPublicationResult>;
  daemonSocketPath?: string;
  connectStaleResetClient?: (socketPath: string) => Promise<IpcClient>;
  staleResetCliDeps?: CliDeps;
  reconciledRunIds?: readonly string[];
};

export type PipelineHandlers = {
  pipeline_start: RpcHandler;
  pipeline_approve: RpcHandler;
  pipeline_reject: RpcHandler;
  pipeline_resume: RpcHandler;
  pipeline_recover: RpcHandler;
  pipeline_dismiss: RpcHandler;
  pipeline_undismiss: RpcHandler;
  pipeline_list: RpcHandler;
  pipeline_wait: RpcHandler;
  continueContinuablePipelines: () => Promise<void>;
  pipelineExecutionDeps: () => Omit<PipelineExecutionDeps, "context">;
};

export function createPipelineHandlers(ctx: RunControlHandlerContext, deps: PipelineHandlerDeps): PipelineHandlers {
  const { store, pipelineWaitObserver, logReader, logsPath } = ctx;
  const { pipelineDispatch, pipelineWait, admitWorkflowStart } = deps;
  const resolveStage = deps.resolveStage ?? resolveStageWorkflowSteps;

  const pipelineExecutionDeps = (): Omit<PipelineExecutionDeps, "context"> => {
    const daemonSocketPath = deps.daemonSocketPath;
    const connectStaleResetClient = deps.connectStaleResetClient;
    return {
      store,
      dispatch: pipelineDispatch,
      wait: pipelineWait,
      resolveStage,
      ...(logReader !== undefined ? { loadLogRecords: (entryRunId: string) => logReader.tail(entryRunId) } : {}),
      ...(deps.executeTerminalPublication !== undefined
        ? { executeTerminalPublication: deps.executeTerminalPublication }
        : {}),
      ...(daemonSocketPath !== undefined
        ? {
            staleResetPreflight: {
              cliDeps:
                deps.staleResetCliDeps ??
                ({ jarvisRoot: jarvisHome(), subprocessRunner: realAsyncSubprocessRunner } as unknown as CliDeps),
              io: { stdout: () => {}, stderr: (text: string) => console.error(text) },
              connectClient: connectStaleResetClient
                ? () => connectStaleResetClient(daemonSocketPath)
                : () => connectIpcClient(daemonSocketPath, STALE_RESET_RPC_TIMEOUT_MS),
            },
          }
        : {}),
    };
  };

  /**
   * Admit an already-validated pipeline definition: create its durable rows, start the
   * ordered daemon-owned loop, and resolve once those rows exist — not once the pipeline
   * finishes. The loop keeps running after this handler resolves and the client disconnects.
   */
  const pipeline_start: RpcHandler = (frame) => {
    const params = frame.params as { definition?: PipelineDefinition; context?: unknown } | undefined;
    if (!params?.definition || !params?.context) {
      return { kind: "error", code: "invalid_params", message: "definition and context required" };
    }
    const { definition } = params;
    const admittedContext = loadPipelineContext(params.context);
    if (!admittedContext.ok) {
      return { kind: "error", code: "invalid_params", message: admittedContext.error.errors.join("; ") };
    }
    const pipelineId = store.createPipeline({ definition, context: admittedContext.context });
    const admitted = store.loadPipeline(pipelineId);
    if (!admitted?.context) {
      return {
        kind: "error",
        code: "admission_failed",
        message: "pipeline context was not durably persisted",
      };
    }
    const executionContext = loadPipelineContext(admitted.context);
    if (!executionContext.ok) {
      return {
        kind: "error",
        code: "admission_failed",
        message: executionContext.error.errors.join("; "),
      };
    }
    void runPipeline(pipelineId, { ...pipelineExecutionDeps(), context: executionContext.context }).catch(
      (err: unknown) => {
        console.error(`Pipeline ${pipelineId} execution failed:`, err);
      },
    );
    return { kind: "response", result: { pipelineId } };
  };

  const handlePipelineApprovalDecisionHandler =
    (decision: "approved" | "rejected"): RpcHandler =>
    (frame) => {
      if (ctx.retiring) {
        return { kind: "error", code: "daemon_superseded", message: "Daemon is retiring and not accepting new work" };
      }
      const params = frame.params as { pipelineId?: string; stageId?: string; branchKey?: string } | undefined;
      if (!params?.pipelineId || !params?.stageId) {
        return { kind: "error", code: "invalid_params", message: "pipelineId and stageId required" };
      }
      const { pipelineId, stageId, branchKey } = params;
      const outcome = applyPipelineApprovalDecision(pipelineId, stageId, decision, pipelineExecutionDeps(), branchKey);
      return { kind: "response", result: outcome };
    };

  const pipeline_approve = handlePipelineApprovalDecisionHandler("approved");
  const pipeline_reject = handlePipelineApprovalDecisionHandler("rejected");

  const pipeline_resume: RpcHandler = async (frame) => {
    if (ctx.retiring) {
      return { kind: "error", code: "daemon_superseded", message: "Daemon is retiring and not accepting new work" };
    }
    const params = frame.params as
      | {
          pipelineId?: string;
          branchKey?: unknown;
          resetDespiteDirty?: boolean;
          resetDespiteLandedCriteria?: boolean;
        }
      | undefined;
    if (!params?.pipelineId) {
      return { kind: "error", code: "invalid_params", message: "pipelineId required" };
    }
    if (params.branchKey !== undefined && (typeof params.branchKey !== "string" || params.branchKey.trim() === "")) {
      return { kind: "error", code: "invalid_params", message: "branchKey must be a non-blank string" };
    }
    const { pipelineId } = params;
    const branchKey = params.branchKey as string | undefined;
    const outcome = await resumePipeline(pipelineId, pipelineExecutionDeps(), {
      detachContinuation: true,
      ...(branchKey !== undefined ? { branchKey } : {}),
      resetDespiteDirty: params.resetDespiteDirty === true,
      resetDespiteLandedCriteria: params.resetDespiteLandedCriteria === true,
    });
    return { kind: "response", result: outcome };
  };

  /** Resolves a recovery target before shared workflow admission, then detaches its distinct lifecycle. */
  const pipeline_recover: RpcHandler = async (frame) => {
    // `=== true` (not the bare `if (retiring)` every sibling handler uses) only so the
    // `@mutate` checkpoint in daemon-pipeline-recover.test.ts has a unique line to match —
    // do not "normalize" this back to the bare form without updating that directive.
    if (ctx.retiring === true) {
      return { kind: "error", code: "daemon_superseded", message: "Daemon is retiring and not accepting new work" };
    }
    const params = frame.params as
      | {
          pipelineId?: string;
          branchKey?: string;
          resetDespiteDirty?: boolean;
          resetDespiteLandedCriteria?: boolean;
        }
      | undefined;
    if (
      typeof params?.pipelineId !== "string" ||
      params.pipelineId.length === 0 ||
      typeof params?.branchKey !== "string" ||
      params.branchKey.length === 0
    ) {
      return { kind: "error", code: "invalid_params", message: "pipelineId and branchKey required" };
    }
    const { pipelineId, branchKey } = params;

    const resolution = await resolveBlockedPlanStageRecoveryTarget({ pipelineId, branchKey }, { store, resolveStage });
    if (!resolution.ok) {
      return {
        kind: "response",
        result: {
          kind: "resolution_refused",
          pipelineId,
          branchKey,
          reason: resolution.reason,
          message: resolution.message,
        },
      };
    }
    const { target } = resolution;
    const key: OwnershipKey = { project: target.project, branch: target.branch };
    const activeKey = ownershipKeyString(key);
    const activeRun: ActiveRun = { kind: "recovery", runId: target.runId };
    const stageAdmission = { pipelineId, stageId: target.stageId, branchKey };
    let releaseDurableAdmission = false;
    let logSink: LogSink | undefined;
    return admitWorkflowStart({
      key,
      ownership: { runId: target.runId, worktreePath: target.worktreePath },
      activeKey,
      activeRun,
      admit: () => {
        logSink = logsPath !== undefined ? (deps.recoveryLogSinkFactory ?? openLogSink)(logsPath) : undefined;
        try {
          const outcome = claimResolvedPipelineBranchStageRecovery({ pipelineId, branchKey }, target, store);
          if (outcome.kind === "admitted") {
            releaseDurableAdmission = true;
            return { kind: "admitted" };
          }
          return { kind: "refused", result: { kind: "response", result: outcome } };
        } catch (error) {
          store.releasePipelineStageAdmission(stageAdmission);
          throw error;
        }
      },
      execute: (onSettled) => {
        void executeClaimedPipelineBranchStageRecovery(
          { pipelineId, branchKey },
          target,
          {
            ...pipelineExecutionDeps(),
            attempt: deps.recoveryAttempt ?? recoverPlanStage,
            ...(logSink !== undefined ? { logSink } : {}),
          },
          { detachContinuation: true, onSettled },
        );
        return {
          kind: "response",
          result: { kind: "admitted", pipelineId, branchKey, stageId: target.stageId, entryRunId: target.runId },
        };
      },
      rollbackAdmission: () => {
        if (releaseDurableAdmission) store.releasePipelineStageAdmission(stageAdmission);
        logSink?.close();
      },
      settle: () => logSink?.close(),
    });
  };

  const handlePipelineDismissalHandler =
    (mode: "dismiss" | "undismiss"): RpcHandler =>
    (frame) => {
      const params = frame.params as { pipelineId?: unknown } | undefined;
      const pipelineId = typeof params?.pipelineId === "string" ? params.pipelineId : "";
      if (pipelineId.length === 0) {
        return { kind: "error", code: "invalid_params", message: "pipelineId required" };
      }
      const outcome =
        mode === "dismiss" ? store.dismissPipeline({ pipelineId }) : store.undismissPipeline({ pipelineId });
      if (outcome.kind === "refused") {
        return { kind: "response", result: outcome };
      }
      // biome-ignore lint/style/noNonNullAssertion: dismissal returned non-refused, so the pipeline is present
      const pipeline = store.loadPipeline(pipelineId)!;
      return { kind: "response", result: { ...outcome, state: derivePipelineState(pipeline) } };
    };

  const pipeline_dismiss = handlePipelineDismissalHandler("dismiss");
  const pipeline_undismiss = handlePipelineDismissalHandler("undismiss");

  const pipeline_list: RpcHandler = (frame) => {
    const params = frame.params as { includeDismissed?: unknown } | undefined;
    const includeDismissed = params?.includeDismissed === true;
    const pipelines = store.listPipelines().filter((pipeline) => includeDismissed || pipeline.dismissedAt === null);
    return { kind: "response", result: { pipelines: pipelines.map(projectPipelineSnapshot) } };
  };

  const pipeline_wait: RpcHandler = async (frame, signal) => {
    const params = frame.params as { pipelineId?: unknown } | undefined;
    if (typeof params?.pipelineId !== "string" || params.pipelineId.length === 0) {
      return { kind: "error", code: "invalid_params", message: "Missing pipelineId" };
    }

    const pipelineId = params.pipelineId;
    if (!store.loadPipeline(pipelineId)) {
      return { kind: "error", code: "unknown_pipeline", message: `Pipeline ${pipelineId} not found` };
    }

    try {
      const boundary = await waitForPipelineBoundary(store, pipelineId, signal, pipelineWaitObserver);
      return { kind: "response", result: boundary };
    } catch (error) {
      if (signal.aborted || error instanceof PipelineWaitAbortedError) {
        throw new Error(PIPELINE_WAIT_ABORTED);
      }
      throw error;
    }
  };

  const continueContinuablePipelines = async (): Promise<void> => {
    await recoverContinuablePipelines(store, pipelineExecutionDeps(), undefined, new Set(deps.reconciledRunIds ?? []));
  };

  return {
    pipeline_start,
    pipeline_approve,
    pipeline_reject,
    pipeline_resume,
    pipeline_recover,
    pipeline_dismiss,
    pipeline_undismiss,
    pipeline_list,
    pipeline_wait,
    continueContinuablePipelines,
    pipelineExecutionDeps,
  };
}
