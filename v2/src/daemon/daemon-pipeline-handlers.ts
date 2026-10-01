import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { CliDeps } from "../cli/deps.ts";
import { readProjectRegistry } from "../config/machine-config-loader.ts";
import type { PipelineDefinition } from "../execution/pipeline-definition.ts";
import type { TerminalPublicationInput, TerminalPublicationResult } from "../execution/terminal-publication.ts";
import { WORKFLOW_PRESET_BUILDERS } from "../execution/workflow-presets.ts";
import type { AnyWorkflowStep } from "../execution/workflow-runner.ts";
import { recoverPlanStage } from "../execution/workflow-runner-resume.ts";
import { connectIpcClient, type IpcClient } from "../ipc/client";
import type { RpcHandler } from "../ipc/server.ts";
import { jarvisHome, MACHINE_CONFIG_PATH } from "../paths.ts";
import { type LogSink, openLogSink } from "../persistence/log-stream.ts";
import { loadPipelineContext, type Pipeline, type PipelineStageRecord } from "../persistence/state-store.ts";
import type { ActiveRun, OwnershipKey } from "./daemon.ts";
import { ownershipKeyString, type RunControlHandlerContext } from "./daemon-run-control-context.ts";
import type { WorkflowStartAdmission, WorkflowStartResult } from "./daemon-workflow-admission-handlers.ts";
import {
  applyPipelineApprovalDecision,
  derivePipelineState,
  isPipelineTerminal,
  type PipelineDerivedState,
  type PipelineExecutionDeps,
  probePipelineRecoverRedispatchRefusal,
  recoverContinuablePipelines,
  resumePipeline,
  runPipeline,
} from "./pipeline-execution.ts";
import {
  ambiguousPipelineIdMessage,
  PIPELINE_ID_AMBIGUOUS,
  resolvePipelineIdArgument,
} from "./pipeline-id-resolution.ts";
import {
  PIPELINE_WAIT_ABORTED,
  PipelineWaitAbortedError,
  projectPipelineSnapshot,
  resolvePipelineOwnership,
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
import {
  executePipelineStageReviewFeedbackLaunch,
  type PipelineStageReviewFeedbackLaunchDeps,
  parsePipelineStageReviewFeedbackLaunchParams,
} from "./pipeline-stage-review-feedback-launch.ts";

const STALE_RESET_RPC_TIMEOUT_MS = 30_000;
const PIPELINE_LIST_TERMINAL_LIMIT = 50;

/** Every `PipelineDerivedState`, for `pipeline_list` param validation. */
const PIPELINE_DERIVED_STATES: readonly PipelineDerivedState[] = [
  "succeeded",
  "failed",
  "rejected",
  "interrupted",
  "awaiting-approval",
  "running",
  "pending",
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPipelineDerivedState(value: unknown): value is PipelineDerivedState {
  return typeof value === "string" && (PIPELINE_DERIVED_STATES as readonly string[]).includes(value);
}

type PipelineListRow = Pipeline & { stages: PipelineStageRecord[] };

/** `listPipelines()` issues an unordered SELECT; sort newest-first, `id` descending as tie break. */
function sortPipelinesNewestFirst(pipelines: PipelineListRow[]): PipelineListRow[] {
  return [...pipelines].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });
}

/** Default projection: every non-terminal pipeline plus the newest `PIPELINE_LIST_TERMINAL_LIMIT` terminals. */
function retainListedPipelines(pipelines: PipelineListRow[]): PipelineListRow[] {
  let terminalKept = 0;
  return pipelines.filter((pipeline) => {
    if (!isPipelineTerminal(derivePipelineState(pipeline))) return true;
    if (terminalKept >= PIPELINE_LIST_TERMINAL_LIMIT) return false;
    terminalKept++;
    return true;
  });
}

/** Filtered/history path: `sinceMs` and/or `state` compose conjunctively; no retention cap applies. */
function pipelineMatchesListFilter(
  pipeline: PipelineListRow,
  sinceMs: number | undefined,
  state: PipelineDerivedState | undefined,
): boolean {
  if (sinceMs !== undefined && pipeline.createdAt < sinceMs) return false;
  if (state !== undefined && derivePipelineState(pipeline) !== state) return false;
  return true;
}

type PipelineStageReviewFeedbackLaunchHandlerDeps = Omit<
  PipelineStageReviewFeedbackLaunchDeps,
  "store" | "handleWorkflowStart"
>;

type PipelineHandlerDeps = {
  pipelineDispatch: PipelineWorkflowDispatch;
  pipelineWait: PipelineWorkflowWait;
  admitWorkflowStart: WorkflowStartAdmission["admitWorkflowStart"];
  handleWorkflowStart: (steps: AnyWorkflowStep[]) => WorkflowStartResult;
  reviewFeedbackLaunch?: Partial<PipelineStageReviewFeedbackLaunchHandlerDeps>;
  resolveStage?: typeof resolveStageWorkflowSteps;
  recoveryAttempt?: PipelineStageRecoveryAttempt;
  recoveryLogSinkFactory?: (storagePath: string) => LogSink;
  executeTerminalPublication?: (input: TerminalPublicationInput) => Promise<TerminalPublicationResult>;
  daemonSocketPath?: string;
  connectStaleResetClient?: (socketPath: string) => Promise<IpcClient>;
  staleResetCliDeps?: CliDeps;
  reconciledRunIds?: readonly string[];
  attemptFailedImplementPipelineResume?: PipelineExecutionDeps["attemptFailedImplementPipelineResume"];
};

type PipelineHandlers = {
  pipeline_start: RpcHandler;
  pipeline_approve: RpcHandler;
  pipeline_reject: RpcHandler;
  pipeline_resume: RpcHandler;
  pipeline_stage_review_feedback_launch: RpcHandler;
  pipeline_recover: RpcHandler;
  pipeline_dismiss: RpcHandler;
  pipeline_undismiss: RpcHandler;
  pipeline_list: RpcHandler;
  pipeline_wait: RpcHandler;
  pipeline_owner: RpcHandler;
  continueContinuablePipelines: () => Promise<void>;
  pipelineExecutionDeps: () => Omit<PipelineExecutionDeps, "context">;
};

function defaultReviewFeedbackLaunchDeps(
  overrides: Partial<PipelineStageReviewFeedbackLaunchHandlerDeps> | undefined,
): PipelineStageReviewFeedbackLaunchHandlerDeps {
  const machineConfigPath = overrides?.machineConfigPath ?? MACHINE_CONFIG_PATH;
  const resolveProjectRoot =
    overrides?.resolveProjectRoot ?? ((projectKey: string) => readProjectRegistry(machineConfigPath)[projectKey]?.root);
  return {
    subprocessRunner: overrides?.subprocessRunner ?? realAsyncSubprocessRunner,
    machineConfigPath,
    resolveProjectRoot,
    builder: overrides?.builder ?? WORKFLOW_PRESET_BUILDERS["review-feedback"],
  };
}

export function createPipelineHandlers(ctx: RunControlHandlerContext, deps: PipelineHandlerDeps): PipelineHandlers {
  const { store, pipelineWaitObserver, logReader, logsPath } = ctx;
  const { pipelineDispatch, pipelineWait, admitWorkflowStart, handleWorkflowStart } = deps;
  const resolveStage = deps.resolveStage ?? resolveStageWorkflowSteps;
  const reviewFeedbackLaunchDeps = defaultReviewFeedbackLaunchDeps(deps.reviewFeedbackLaunch);

  const pipelineExecutionDeps = (): Omit<PipelineExecutionDeps, "context"> => {
    const daemonSocketPath = deps.daemonSocketPath;
    const connectStaleResetClient = deps.connectStaleResetClient;
    return {
      store,
      dispatch: pipelineDispatch,
      wait: pipelineWait,
      resolveStage,
      ...(logReader !== undefined ? { loadLogRecords: (entryRunId: string) => logReader.tail(entryRunId) } : {}),
      isEntryRunLive: (entryRunId: string) => ctx.workflowPromisesByEntryRunId.has(entryRunId),
      ...(deps.executeTerminalPublication !== undefined
        ? { executeTerminalPublication: deps.executeTerminalPublication }
        : {}),
      ...(deps.attemptFailedImplementPipelineResume !== undefined
        ? { attemptFailedImplementPipelineResume: deps.attemptFailedImplementPipelineResume }
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

  /** Resolve a verb's id argument (exact or unique ≥8-char prefix); `ambiguous` carries the refusal payload. */
  const resolvePipelineId = (
    argument: string,
  ): {
    pipelineId: string;
    ambiguous?: { reason: typeof PIPELINE_ID_AMBIGUOUS; candidates: string[]; message: string };
  } => {
    const resolution = resolvePipelineIdArgument(store, argument);
    if (resolution.kind === "ambiguous") {
      return {
        pipelineId: argument,
        ambiguous: {
          reason: PIPELINE_ID_AMBIGUOUS,
          candidates: resolution.candidates,
          message: ambiguousPipelineIdMessage(argument, resolution.candidates),
        },
      };
    }
    return { pipelineId: resolution.pipelineId };
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
      const { stageId, branchKey } = params;
      const { pipelineId, ambiguous } = resolvePipelineId(params.pipelineId);
      if (ambiguous !== undefined) {
        return { kind: "response", result: { kind: "refused", pipelineId, stageId, ...ambiguous } };
      }
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
    const { pipelineId, ambiguous } = resolvePipelineId(params.pipelineId);
    if (ambiguous !== undefined) {
      return { kind: "response", result: { kind: "refused", pipelineId, ...ambiguous } };
    }
    const branchKey = params.branchKey as string | undefined;
    const outcome = await resumePipeline(pipelineId, pipelineExecutionDeps(), {
      detachContinuation: true,
      ...(branchKey !== undefined ? { branchKey } : {}),
      resetDespiteDirty: params.resetDespiteDirty === true,
      resetDespiteLandedCriteria: params.resetDespiteLandedCriteria === true,
    });
    if (outcome.kind === "dispatch_refused") {
      const message = outcome.message.endsWith("\n") ? outcome.message.slice(0, -1) : outcome.message;
      return { kind: "error", code: "resume_dispatch_refused", message };
    }
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
    const { branchKey } = params;
    const { pipelineId, ambiguous } = resolvePipelineId(params.pipelineId);
    if (ambiguous !== undefined) {
      return {
        kind: "response",
        result: {
          kind: "resolution_refused",
          pipelineId,
          branchKey,
          reason: ambiguous.reason,
          message: ambiguous.message,
        },
      };
    }

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
    const dispatchRefusal = await probePipelineRecoverRedispatchRefusal(
      pipelineId,
      { stageId: target.stageId, branchKey },
      pipelineExecutionDeps(),
      {
        resetDespiteDirty: params.resetDespiteDirty === true,
        resetDespiteLandedCriteria: params.resetDespiteLandedCriteria === true,
      },
    );
    if (dispatchRefusal !== undefined) {
      const message = dispatchRefusal.message.endsWith("\n")
        ? dispatchRefusal.message.slice(0, -1)
        : dispatchRefusal.message;
      return { kind: "error", code: "recover_dispatch_refused", message };
    }
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
      const argument = typeof params?.pipelineId === "string" ? params.pipelineId : "";
      if (argument.length === 0) {
        return { kind: "error", code: "invalid_params", message: "pipelineId required" };
      }
      const { pipelineId, ambiguous } = resolvePipelineId(argument);
      if (ambiguous !== undefined) {
        return { kind: "response", result: { kind: "refused", pipelineId, ...ambiguous } };
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
    const params = frame.params as { includeDismissed?: unknown; sinceMs?: unknown; state?: unknown } | undefined;
    const includeDismissed = params?.includeDismissed === true;
    // Both filter params fail closed. A non-finite sinceMs would make every `createdAt < sinceMs`
    // comparison false and return the whole unbounded history — the condition retention exists to
    // remove — and an unrecognized state would match nothing and read to the operator as "no
    // pipelines" rather than as a bad request.
    if (params?.sinceMs !== undefined && !isFiniteNumber(params.sinceMs)) {
      return { kind: "error", code: "invalid_params", message: "sinceMs must be a finite number" };
    }
    if (params?.state !== undefined && !isPipelineDerivedState(params.state)) {
      return {
        kind: "error",
        code: "invalid_params",
        message: `state must be one of ${PIPELINE_DERIVED_STATES.join(", ")}`,
      };
    }
    const sinceMs = params?.sinceMs as number | undefined;
    const state = params?.state as PipelineDerivedState | undefined;
    const isFiltered = sinceMs !== undefined || state !== undefined;

    // Dismissal filter runs ahead of retention/filtered matching: a dismissed pipeline must not
    // consume a terminal-retention slot.
    const sorted = sortPipelinesNewestFirst(
      store.listPipelines().filter((pipeline) => includeDismissed || pipeline.dismissedAt === null),
    );
    const projected = isFiltered
      ? sorted.filter((pipeline) => pipelineMatchesListFilter(pipeline, sinceMs, state))
      : retainListedPipelines(sorted);

    return { kind: "response", result: { pipelines: projected.map(projectPipelineSnapshot) } };
  };

  /**
   * Durable ownership answer for one full pipeline id — no prefix resolution. A `pipeline_list`
   * snapshot proves nothing about ownership under a shared store; this is the dedicated answer.
   */
  const pipeline_owner: RpcHandler = async (frame) => {
    const params = frame.params as { pipelineId?: unknown } | undefined;
    if (typeof params?.pipelineId !== "string" || params.pipelineId.length === 0) {
      return { kind: "error", code: "invalid_params", message: "pipelineId required" };
    }
    const { pipelineId } = params;
    const ownerIdentity = store.currentOwnerIdentity();
    let pipeline = store.loadPipeline(pipelineId);
    let ownership = resolvePipelineOwnership(pipeline, ownerIdentity);
    // A dead (or absent) recorded owner — e.g. a drained daemon generation after a handoff — is
    // adopted here, so the answering daemon owns the pipeline instead of stranding every verb.
    if (ownership.kind === "not_owner" && !ctx.retiring && (await store.adoptOrphanedPipeline(pipelineId))) {
      pipeline = store.loadPipeline(pipelineId);
      ownership = resolvePipelineOwnership(pipeline, ownerIdentity);
    }
    // The identity lets a caller tell one daemon answering on two socket paths (stable public plus
    // digest-keyed private) from two daemons genuinely claiming the same pipeline.
    return { kind: "response", result: { ...ownership, pipelineId, ownerIdentity } };
  };

  const pipeline_wait: RpcHandler = async (frame, signal) => {
    const params = frame.params as { pipelineId?: unknown } | undefined;
    if (typeof params?.pipelineId !== "string" || params.pipelineId.length === 0) {
      return { kind: "error", code: "invalid_params", message: "Missing pipelineId" };
    }

    const { pipelineId, ambiguous } = resolvePipelineId(params.pipelineId);
    if (ambiguous !== undefined) {
      return { kind: "error", code: ambiguous.reason, message: ambiguous.message };
    }
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

  const pipeline_stage_review_feedback_launch: RpcHandler = async (frame) => {
    if (ctx.retiring) {
      return { kind: "error", code: "daemon_superseded", message: "Daemon is retiring and not accepting new work" };
    }
    const parsed = parsePipelineStageReviewFeedbackLaunchParams(frame.params);
    if (!parsed.ok) {
      return { kind: "error", code: "invalid_params", message: parsed.message };
    }
    return executePipelineStageReviewFeedbackLaunch(parsed.value, {
      store,
      handleWorkflowStart,
      ...reviewFeedbackLaunchDeps,
    });
  };

  return {
    pipeline_start,
    pipeline_approve,
    pipeline_reject,
    pipeline_resume,
    pipeline_stage_review_feedback_launch,
    pipeline_recover,
    pipeline_dismiss,
    pipeline_undismiss,
    pipeline_list,
    pipeline_wait,
    pipeline_owner,
    continueContinuablePipelines,
    pipelineExecutionDeps,
  };
}
