import { appendFileSync, existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { INVALID_TOKEN_LOG_MAX_CHARS, type LogSink } from "../persistence/log-stream.ts";
import {
  type OutcomeKind,
  openStateStore,
  type RunStatus,
  type StateStore,
  type WorkflowSnapshot,
} from "../persistence/state-store.ts";
import { type CompletionCommitter, createCompletionCommitter } from "./completion-commit.ts";
import { type CompletionPublisher, createCompletionPublisher } from "./completion-publisher.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import type { InvocationFailureDetail } from "./invocation-failure.ts";
import { createReadyFinalizer, type ReadyFinalizer } from "./ready-finalize.ts";
import { resolveSpecCreationTitle } from "./spec-creation-title.ts";
import type { StepRunResult } from "./step-runner.ts";
import { buildJsonlSink } from "./telemetry-sink.ts";
import { type BoundaryStamp, boundaryStampFromStoredRun, emitWorkBoundaryRecorded } from "./work-boundary-telemetry.ts";
import { executeWrite, type WriteExecuteInput } from "./write.ts";

const WRITE_LOOP_OUTCOME_KINDS = [
  "complete",
  "progress",
  "blocked",
  "contract_miss",
  "invocation_failure",
  "iteration_timeout",
  "budget-exhausted",
  "paused",
  "completion_commit_failed",
  "ready_finalize_failed",
] as const;

export type WriteLoopOutcomeKind = (typeof WRITE_LOOP_OUTCOME_KINDS)[number];

const writeLoopOutcomeKindSet = new Set<string>(WRITE_LOOP_OUTCOME_KINDS);

export function isWriteLoopOutcomeKind(value: unknown): value is WriteLoopOutcomeKind {
  return typeof value === "string" && writeLoopOutcomeKindSet.has(value);
}

export type WriteLoopResult = {
  kind: WriteLoopOutcomeKind;
  runId: string;
  iterationsConsumed: number;
  resumable: boolean;
  commitSha?: string;
  completionAgent?: string;
  completionCommitError?: string;
  readyFinalizeError?: string;
  attemptId?: string;
  outcomeKind?: OutcomeKind;
  runStatus?: RunStatus;
  boundaryTelemetryFailure?: string;
} & Partial<InvocationFailureDetail>;

/** Input for the write loop. Run identity derives from `worktree` (project, branch, base). */
export type WriteLoopInput = WriteExecuteInput & {
  maxIterations?: number;
  iterationTimeoutMs?: number;
  stateStore?: StateStore;
  logSink?: LogSink;
  pauseSignal?: AbortSignal;
  stepId?: string;
  workflowSnapshot?: WorkflowSnapshot;
  bindingResolution?: {
    role: string;
    agents: readonly string[];
    agentModelConfig: AgentModelConfig;
  };
  /** Fires once this run's row is durably created/resolved, before any iteration executes. */
  onRunCreated?: (runId: string) => void;
  telemetry?: {
    sinkPath?: string;
    operatorSessionId: string;
    workflow?: string;
    role?: string;
  };
  completionCommitter?: CompletionCommitter;
  completionPublisher?: CompletionPublisher;
  readyFinalizer?: ReadyFinalizer;
  publishCompletion?: boolean;
  creationTitle?: string;
};

/**
 * Attaches `operatorSessionId` to `input.telemetry`, whether or not the input already
 * carries a `telemetry` block. Merge policy: the given `operatorSessionId` always
 * overwrites any existing `telemetry.operatorSessionId`; other `telemetry` fields
 * (`sinkPath`, `workflow`, `role`) are preserved.
 */
export function applyOperatorSessionId(input: WriteLoopInput, operatorSessionId: string): WriteLoopInput {
  return { ...input, telemetry: { ...input.telemetry, operatorSessionId } };
}

const DEFAULT_MAX_ITERATIONS = 10;
export const DEFAULT_ITERATION_TIMEOUT_MS = 600_000;
type StoredRun = NonNullable<ReturnType<StateStore["loadRun"]>>;
type PreparedRun =
  | { runId: string; worktreePath: string; resumedAttemptId: string | null; creationTitle?: string }
  | { result: WriteLoopResult; creationTitle?: string };

/**
 * Execute a resumable write loop: repeatedly call executeWrite until work is
 * done, blocked, or budget runs out, persisting run + per-iteration attempt
 * rows through the state store.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: boundary ordering must stay in the runner.
export async function executeWriteLoop(args: WriteLoopInput): Promise<WriteLoopResult> {
  const store = args.stateStore ?? openStateStore();
  const maxIterations = args.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  try {
    const prepared = prepareRun(args, store);
    if ("result" in prepared) {
      args.onRunCreated?.(prepared.result.runId);
      // Completed runs may still have an unpublished, retryable git boundary.
      if (
        prepared.result.kind === "complete" &&
        args.publishCompletion !== false &&
        existsSync(join(getExternalWorktreePath(args.worktree), ".git"))
      ) {
        try {
          const published = await (args.completionCommitter ?? createCompletionCommitter())({
            worktreePath: getExternalWorktreePath(args.worktree),
            baseRef: args.worktree.baseRef,
            specPath: args.specPath,
            agent: prepared.result.completionAgent ?? "",
          });
          if (published.commitSha !== undefined) {
            const publishError = await publishCompletionArtifacts(args, {
              worktreePath: getExternalWorktreePath(args.worktree),
              baseRef: args.worktree.baseRef,
              specPath: args.specPath,
              branch: args.worktree.branchName,
              creationTitle: prepared.creationTitle,
            });
            if (publishError !== undefined) {
              return publishError.kind === "completion_commit_failed"
                ? completionCommitFailed(args, prepared.result, publishError.error)
                : readyFinalizeFailed(args, prepared.result, publishError.error);
            }
          }
          args.logSink?.append(prepared.result.runId, {
            kind: "loop_finished",
            loopOutcomeKind: "complete",
            iterationsConsumed: prepared.result.iterationsConsumed,
            resumable: false,
          });
          if (published.commitSha === undefined) {
            return prepared.result;
          }
          return withBoundaryTelemetry(args, prepared.result, published.commitSha, published.filesChanged);
        } catch {
          return completionCommitFailed(args, prepared.result);
        }
      }
      return prepared.result;
    }
    const { runId, worktreePath } = prepared;
    args.onRunCreated?.(runId);
    let iterationsConsumed = 0;
    let resumedAttemptId = prepared.resumedAttemptId;

    store.setRunStatus(runId, "in-progress");

    while (iterationsConsumed < maxIterations) {
      if (args.signal?.aborted) {
        return finishLoop(args, runId, "progress", iterationsConsumed, true);
      }

      const attemptId = resumedAttemptId ?? store.recordAttemptStart(runId);
      resumedAttemptId = null;

      args.logSink?.append(runId, { kind: "iteration_started", attemptId });

      const settled = await awaitIteration(args, runId, attemptId);
      if (settled.kind === "aborted") return finishLoop(args, runId, "progress", iterationsConsumed + 1, true);
      if (settled.kind === "timed_out")
        return finishIterationTimeout(args, store, runId, attemptId, iterationsConsumed + 1);
      if (settled.kind === "threw") {
        if (args.signal?.aborted) return finishLoop(args, runId, "progress", iterationsConsumed, true);
        return finishExecuteWriteThrow(args, store, runId, attemptId, iterationsConsumed + 1, settled.error);
      }
      const stepResult = settled.result;
      iterationsConsumed += 1;

      // If the abort signal was triggered while the step was running, skip boundary commit
      if (args.signal?.aborted) {
        return finishLoop(args, runId, "progress", iterationsConsumed, true);
      }

      const { result } = stepResult;

      if (result.reprompt !== undefined) {
        const responseText = result.reprompt.responseText;
        args.logSink?.append(runId, {
          kind: "token_reprompt",
          attemptId,
          responseText:
            responseText.length <= INVALID_TOKEN_LOG_MAX_CHARS
              ? responseText
              : `${responseText.slice(0, INVALID_TOKEN_LOG_MAX_CHARS)}…`,
        });
      }

      if (result.kind === "progress") {
        store.commitCompletionBoundary({ attemptId, runStatus: "in-progress", outcomeKind: "progress" });
        args.logSink?.append(runId, {
          kind: "boundary_committed",
          attemptId,
          outcomeKind: "progress",
          runStatus: "in-progress",
        });

        // Check for graceful pause at the loop boundary
        if (args.pauseSignal?.aborted) {
          store.setRunStatus(runId, "paused");
          return finishLoop(args, runId, "paused", iterationsConsumed, true);
        }

        continue;
      }

      if (result.kind === "contract_miss") {
        const reason = result.failureReason ?? result.failedContractId;
        appendBlockerToSpec(resolveSpecPath(worktreePath, args.specPath), reason);
      }

      const terminal = terminalMapping(result);
      const detail =
        result.kind === "invocation_failure"
          ? {
              failureKind: result.failureKind,
              bindingAttempts: result.invocation.attempts.map((attempt) => ({
                bindingId: attempt.binding.id,
                resultKind: attempt.result.kind,
              })),
            }
          : undefined;
      const completionAgent =
        result.kind === "complete" ? result.invocation.final?.binding.metadata?.agent?.trim() : undefined;
      store.commitCompletionBoundary({
        attemptId,
        runStatus: terminal.runStatus,
        outcomeKind: terminal.outcomeKind,
        ...(detail !== undefined ? { invocationFailureDetail: detail } : {}),
        ...(completionAgent ? { completionAgent } : {}),
      });
      args.logSink?.append(runId, {
        kind: "boundary_committed",
        attemptId,
        outcomeKind: terminal.outcomeKind,
        runStatus: terminal.runStatus,
      });
      if (result.kind === "invalid_token") {
        const tokenText = result.tokenText;
        args.logSink?.append(runId, {
          kind: "invalid_token_detail",
          attemptId,
          tokenText:
            tokenText.length <= INVALID_TOKEN_LOG_MAX_CHARS
              ? tokenText
              : `${tokenText.slice(0, INVALID_TOKEN_LOG_MAX_CHARS)}…`,
        });
      }

      const boundaryStamp: BoundaryStamp = {
        runId,
        attemptId,
        outcomeKind: terminal.outcomeKind,
        runStatus: terminal.runStatus,
      };
      const loopResult = finishLoop(
        args,
        runId,
        terminal.kind,
        iterationsConsumed,
        result.kind === "invalid_token",
        detail,
        terminal.kind !== "complete",
      );
      if (terminal.kind !== "complete") {
        return { ...loopResult, ...boundaryStamp };
      }
      const agent = result.invocation.final?.binding.metadata?.agent?.trim();
      const attributed = {
        ...loopResult,
        ...boundaryStamp,
        ...(agent ? { completionAgent: agent } : {}),
      };
      if (args.publishCompletion === false) {
        args.logSink?.append(runId, {
          kind: "loop_finished",
          loopOutcomeKind: "complete",
          iterationsConsumed,
          resumable: false,
        });
        return attributed;
      }
      if (!existsSync(join(worktreePath, ".git")) && !agent) {
        args.logSink?.append(runId, {
          kind: "loop_finished",
          loopOutcomeKind: "complete",
          iterationsConsumed,
          resumable: false,
        });
        return loopResult;
      }
      if (!agent) return completionCommitFailed(args, attributed);
      try {
        const published = await (args.completionCommitter ?? createCompletionCommitter())({
          worktreePath,
          baseRef: args.worktree.baseRef,
          specPath: args.specPath,
          agent,
        });
        if (published.commitSha !== undefined) {
          const publishError = await publishCompletionArtifacts(args, {
            worktreePath,
            baseRef: args.worktree.baseRef,
            specPath: args.specPath,
            branch: args.worktree.branchName,
            creationTitle: prepared.creationTitle,
          });
          if (publishError !== undefined) {
            return publishError.kind === "completion_commit_failed"
              ? completionCommitFailed(args, attributed, publishError.error)
              : readyFinalizeFailed(args, attributed, publishError.error);
          }
        }
        args.logSink?.append(runId, {
          kind: "loop_finished",
          loopOutcomeKind: "complete",
          iterationsConsumed,
          resumable: false,
        });
        if (published.commitSha === undefined) {
          return attributed;
        }
        return withBoundaryTelemetry(args, attributed, published.commitSha, published.filesChanged);
      } catch {
        return completionCommitFailed(args, attributed);
      }
    }

    store.setRunStatus(runId, "budget-soft-stopped");
    args.logSink?.append(runId, {
      kind: "loop_finished",
      loopOutcomeKind: "budget-exhausted",
      iterationsConsumed,
      resumable: true,
    });
    return { kind: "budget-exhausted", runId, iterationsConsumed, resumable: true };
  } finally {
    if (!args.stateStore) {
      store.close();
    }
  }
}

type IterationSettlement =
  | { kind: "settled"; result: Awaited<ReturnType<typeof executeWrite>> }
  | { kind: "threw"; error: unknown }
  | { kind: "timed_out" }
  | { kind: "aborted" };

/** Starts after `iteration_started`, so pre-spawn stalls are fenced too. */
function awaitIteration(args: WriteLoopInput, runId: string, attemptId: string): Promise<IterationSettlement> {
  const executionController = new AbortController();
  const abortExecution = () => executionController.abort();
  if (args.signal?.aborted) abortExecution();
  args.signal?.addEventListener("abort", abortExecution, { once: true });
  const execution = executeWrite(buildWriteExecuteInput(args, runId, attemptId, executionController.signal)).then(
    (result): IterationSettlement => ({ kind: "settled", result }),
    (error): IterationSettlement => ({ kind: "threw", error }),
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeAbort: (() => void) | undefined;
  const watchdog = new Promise<IterationSettlement>((resolve) => {
    timeout = setTimeout(() => {
      abortExecution();
      resolve({ kind: "timed_out" });
    }, args.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS);
  });
  const abort = new Promise<IterationSettlement>((resolve) => {
    if (!args.signal) return;
    const resolveAbort = () => queueMicrotask(() => resolve({ kind: "aborted" }));
    if (args.signal.aborted) return resolveAbort();
    const onAbort = () => resolveAbort();
    args.signal.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => args.signal?.removeEventListener("abort", onAbort);
  });
  return Promise.race([execution, watchdog, abort]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
    args.signal?.removeEventListener("abort", abortExecution);
    removeAbort?.();
  });
}

function finishIterationTimeout(
  args: WriteLoopInput,
  store: StateStore,
  runId: string,
  attemptId: string,
  iterationsConsumed: number,
): WriteLoopResult {
  store.commitCompletionBoundary({ attemptId, runStatus: "failed", outcomeKind: "iteration_timeout" });
  args.logSink?.append(runId, {
    kind: "boundary_committed",
    attemptId,
    outcomeKind: "iteration_timeout",
    runStatus: "failed",
  });
  return {
    ...finishLoop(args, runId, "iteration_timeout", iterationsConsumed, false),
    attemptId,
    outcomeKind: "iteration_timeout",
    runStatus: "failed",
  };
}

function finishExecuteWriteThrow(
  args: WriteLoopInput,
  store: StateStore,
  runId: string,
  attemptId: string,
  iterationsConsumed: number,
  error: unknown,
): WriteLoopResult {
  const detail: InvocationFailureDetail = { failureKind: "error", bindingAttempts: [] };
  store.commitCompletionBoundary({
    attemptId,
    runStatus: "failed",
    outcomeKind: "invocation_failure",
    invocationFailureDetail: detail,
  });
  args.logSink?.append(runId, {
    kind: "boundary_committed",
    attemptId,
    outcomeKind: "invocation_failure",
    runStatus: "failed",
  });
  const message = error instanceof Error ? error.message : String(error);
  args.logSink?.append(runId, { kind: "run_execution_failed", message });
  return {
    kind: "invocation_failure",
    runId,
    iterationsConsumed,
    resumable: false,
    ...detail,
    attemptId,
    outcomeKind: "invocation_failure",
    runStatus: "failed",
  };
}

function finishLoop(
  args: WriteLoopInput,
  runId: string,
  kind: WriteLoopOutcomeKind,
  iterationsConsumed: number,
  resumable: boolean,
  detail?: InvocationFailureDetail,
  emitLog = true,
): WriteLoopResult {
  if (emitLog) {
    args.logSink?.append(runId, {
      kind: "loop_finished",
      loopOutcomeKind: kind,
      iterationsConsumed,
      resumable,
    });
  }
  return {
    kind,
    runId,
    iterationsConsumed,
    resumable,
    ...(detail !== undefined ? detail : {}),
  };
}

function prepareRun(args: WriteLoopInput, store: StateStore): PreparedRun {
  const worktreePath = getExternalWorktreePath(args.worktree);
  const existingRun = store.findRunByProjectBranch({
    project: args.worktree.projectName,
    branch: args.worktree.branchName,
    ...(args.stepId !== undefined ? { stepId: args.stepId } : {}),
  });

  if (existingRun === null) {
    const creationTitle = args.creationTitle ?? resolveSpecCreationTitle(worktreePath, args.specPath);
    const runId = store.createRun({
      project: args.worktree.projectName,
      specRef: args.worktree.baseRef,
      worktreePath,
      branch: args.worktree.branchName,
      specPath: args.specPath,
      ...(creationTitle !== undefined ? { creationTitle } : {}),
      ...(args.stepId !== undefined ? { stepId: args.stepId } : {}),
      ...(args.workflowSnapshot !== undefined ? { workflowSnapshot: args.workflowSnapshot } : {}),
    });
    return { runId, worktreePath, resumedAttemptId: null, ...(creationTitle !== undefined ? { creationTitle } : {}) };
  }

  const lastAttempt = existingRun.attempts[existingRun.attempts.length - 1];
  if (lastAttempt?.status === "in-progress") {
    // Interrupted mid-step: re-run that iteration over the dirty worktree.
    return {
      runId: existingRun.id,
      worktreePath,
      resumedAttemptId: lastAttempt.id,
      ...(existingRun.creationTitle ? { creationTitle: existingRun.creationTitle } : {}),
    };
  }

  const committed = committedResult(existingRun);
  return committed === null
    ? {
        runId: existingRun.id,
        worktreePath,
        resumedAttemptId: null,
        ...(existingRun.creationTitle ? { creationTitle: existingRun.creationTitle } : {}),
      }
    : { result: committed, ...(existingRun.creationTitle ? { creationTitle: existingRun.creationTitle } : {}) };
}

function buildWriteExecuteInput(
  args: WriteLoopInput,
  runId: string,
  attemptId: string,
  signal: AbortSignal,
): WriteExecuteInput {
  const telemetry = args.telemetry;
  // An operator-session-only telemetry attachment (no sinkPath/workflow/role) is a
  // legitimate value that carries no invocation-emission context; only build the
  // full invocationTelemetry record once all three are actually present.
  const fullTelemetry =
    telemetry !== undefined &&
    telemetry.sinkPath !== undefined &&
    telemetry.workflow !== undefined &&
    telemetry.role !== undefined
      ? {
          sinkPath: telemetry.sinkPath,
          operatorSessionId: telemetry.operatorSessionId,
          workflow: telemetry.workflow,
          role: telemetry.role,
        }
      : undefined;
  return {
    worktree: args.worktree,
    specPath: args.specPath,
    stepRules: args.stepRules,
    expectedArtifactPath: args.expectedArtifactPath,
    bindings: args.bindings,
    ...(args.promptId !== undefined ? { promptId: args.promptId } : {}),
    ...(args.promptPlaceholders !== undefined ? { promptPlaceholders: args.promptPlaceholders } : {}),
    ...(args.intentSeed !== undefined ? { intentSeed: args.intentSeed, intentBefore: args.intentSeed } : {}),
    ...(fullTelemetry !== undefined
      ? {
          invocationTelemetry: {
            sink: buildJsonlSink(fullTelemetry.sinkPath),
            operatorSessionId: fullTelemetry.operatorSessionId,
            runId,
            attemptId,
            project: args.worktree.projectName,
            workflow: fullTelemetry.workflow,
            stepId: args.stepId ?? null,
            role: fullTelemetry.role,
            branch: args.worktree.branchName,
            specRef: args.worktree.baseRef,
            invocationIds: args.bindings.map(() => crypto.randomUUID()),
          },
        }
      : {}),
    signal,
    ...(args.withExternalWorktree && { withExternalWorktree: args.withExternalWorktree }),
  };
}

function terminalMapping(result: Exclude<StepRunResult, { kind: "progress" }>): {
  kind: WriteLoopOutcomeKind;
  runStatus: RunStatus;
  outcomeKind: OutcomeKind;
} {
  if (result.kind === "complete") return { kind: "complete", runStatus: "completed", outcomeKind: result.token };
  if (result.kind === "blocked") return { kind: "blocked", runStatus: "blocked", outcomeKind: "blocked" };
  if (result.kind === "contract_miss") {
    return { kind: "contract_miss", runStatus: "blocked", outcomeKind: "contract_miss" };
  }
  if (result.kind === "invalid_token") {
    return { kind: "invocation_failure", runStatus: "paused", outcomeKind: "invalid_token" };
  }
  return { kind: "invocation_failure", runStatus: "failed", outcomeKind: "invocation_failure" };
}

/** Terminal result already committed by a prior invocation, returned idempotently; null when resumable. */
function committedResult(run: StoredRun): WriteLoopResult | null {
  if (run.status === "completed") {
    const agent = run.attempts.at(-1)?.completionAgent?.trim();
    const stamp = boundaryStampFromStoredRun(run);
    return {
      kind: "complete",
      runId: run.id,
      iterationsConsumed: 0,
      resumable: false,
      ...(agent ? { completionAgent: agent } : {}),
      ...(stamp !== undefined ? stamp : {}),
    };
  }
  if (run.status === "failed") {
    const outcomeKind = run.attempts[run.attempts.length - 1]?.outcomeKind;
    const detail = run.attempts[run.attempts.length - 1]?.invocationFailureDetail ?? undefined;
    return {
      kind: outcomeKind === "iteration_timeout" ? "iteration_timeout" : "invocation_failure",
      runId: run.id,
      iterationsConsumed: 0,
      resumable: false,
      ...(detail !== undefined ? detail : {}),
    };
  }
  if (run.status === "blocked") {
    const lastOutcome = run.attempts[run.attempts.length - 1]?.outcomeKind;
    return {
      kind: lastOutcome === "contract_miss" ? "contract_miss" : "blocked",
      runId: run.id,
      iterationsConsumed: 0,
      resumable: false,
    };
  }
  return null; // in-progress, paused, or budget-soft-stopped: resume
}

function withBoundaryTelemetry(
  args: WriteLoopInput,
  result: WriteLoopResult,
  commitSha: string,
  filesChanged: number | undefined,
): WriteLoopResult {
  if (
    filesChanged === undefined ||
    result.attemptId === undefined ||
    result.outcomeKind === undefined ||
    result.runStatus === undefined
  ) {
    return { ...result, commitSha };
  }
  const boundaryTelemetryFailure = emitWorkBoundaryRecorded(
    args.telemetry,
    {
      runId: result.runId,
      attemptId: result.attemptId,
      outcomeKind: result.outcomeKind,
      runStatus: result.runStatus,
    },
    { commitSha, filesChanged },
  );
  return {
    ...result,
    commitSha,
    ...(boundaryTelemetryFailure !== undefined ? { boundaryTelemetryFailure } : {}),
  };
}

export type CompletionPublicationSeams = Pick<WriteLoopInput, "completionPublisher" | "readyFinalizer">;

export type CompletionPublishFailure = {
  kind: "completion_commit_failed" | "ready_finalize_failed";
  error?: Error;
};

export async function publishCompletionArtifacts(
  seams: CompletionPublicationSeams,
  input: {
    worktreePath: string;
    baseRef: string;
    specPath: string;
    branch: string;
    creationTitle?: unknown;
    bodySummary?: string;
  },
): Promise<CompletionPublishFailure | undefined> {
  try {
    await (seams.completionPublisher ?? createCompletionPublisher())(input);
  } catch (publishError) {
    const err = publishError instanceof Error ? publishError : new Error(String(publishError));
    return { kind: "completion_commit_failed", error: err };
  }
  try {
    await (seams.readyFinalizer ?? createReadyFinalizer())({
      worktreePath: input.worktreePath,
      branch: input.branch,
    });
  } catch (finalizeError) {
    const err = finalizeError instanceof Error ? finalizeError : new Error(String(finalizeError));
    return { kind: "ready_finalize_failed", error: err };
  }
  return undefined;
}

function completionCommitFailed(args: WriteLoopInput, result: WriteLoopResult, error?: Error): WriteLoopResult {
  args.logSink?.append(result.runId, {
    kind: "loop_finished",
    loopOutcomeKind: "completion_commit_failed",
    iterationsConsumed: result.iterationsConsumed,
    resumable: true,
  });
  return {
    ...result,
    kind: "completion_commit_failed",
    resumable: true,
    completionCommitError: error?.message ?? "completion commit failed",
  };
}

function readyFinalizeFailed(args: WriteLoopInput, result: WriteLoopResult, error?: Error): WriteLoopResult {
  args.logSink?.append(result.runId, {
    kind: "loop_finished",
    loopOutcomeKind: "ready_finalize_failed",
    iterationsConsumed: result.iterationsConsumed,
    resumable: true,
  });
  return {
    ...result,
    kind: "ready_finalize_failed",
    resumable: true,
    readyFinalizeError: error?.message ?? "ready finalize failed",
  };
}

function resolveSpecPath(worktreePath: string, specPath: string): string {
  return isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
}

function appendBlockerToSpec(specPath: string, reason: string): void {
  appendFileSync(specPath, `\n## Blocker\n\nArtifact contract check failed: ${reason}\n`, "utf8");
}
