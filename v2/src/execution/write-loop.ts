import { appendFileSync, existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { openSessionLog, type SessionLog } from "../../../shared/invocation/session-log.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import type { AgentModelConfig } from "../config/agent-model-config.ts";
import { type LogSink, truncateLogText } from "../persistence/log-stream.ts";
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
import { createReadyFinalizer, type ReadyFinalizer, ReadyGateError } from "./ready-finalize.ts";
import { resolvePublicationTitle } from "./spec-creation-title.ts";
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
  "ready_gate_failed",
  "ready_flip_failed",
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
  readyGateError?: string;
  readyFlipError?: string;
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
  /** Fires when an iteration has yielded without reaching a bound agent invocation. */
  onAttemptStalled?: (runId: string, attemptId: string) => void;
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
  sessionsDir?: string;
  clock?: () => Date;
  /** When set, suppresses reuse of completed runs from prior invocations. */
  freshDispatch?: boolean;
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
const MAX_READY_GATE_REPAIRS = 3;
const READY_GATE_OUTPUT_MAX_CHARS = 16 * 1024;
export const DEFAULT_ITERATION_TIMEOUT_MS = 600_000;

async function getUncommittedPaths(worktreePath: string): Promise<string[]> {
  try {
    return (await realAsyncSubprocessRunner.runAsync("git", ["status", "--porcelain"], worktreePath))
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
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
            const creationTitle = resolveAndPersistCreationTitle(
              store,
              prepared.result.runId,
              getExternalWorktreePath(args.worktree),
              args.specPath,
              prepared.creationTitle,
            );
            const publication = await publishWithReadyRepair(args, store, prepared.result, 0, {
              worktreePath: getExternalWorktreePath(args.worktree),
              baseRef: args.worktree.baseRef,
              specPath: args.specPath,
              branch: args.worktree.branchName,
              creationTitle,
            });
            if (publication.failure !== undefined) {
              const publishedResult = { ...prepared.result, iterationsConsumed: publication.iterationsConsumed };
              return publication.failure.kind === "completion_commit_failed"
                ? completionCommitFailed(args, publishedResult, publication.failure.error)
                : readyFailed(args, publishedResult, publication.failure.kind, publication.failure.error);
            }
          }
          if (published.commitSha === undefined) {
            const uncommitted = await getUncommittedPaths(getExternalWorktreePath(args.worktree));
            if (uncommitted.length > 0) {
              return completionCommitFailed(
                args,
                prepared.result,
                new Error(`Uncommitted changes: ${uncommitted.join(", ")}`),
              );
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
        } catch (error) {
          return completionCommitFailed(
            args,
            prepared.result,
            error instanceof Error ? error : new Error(String(error)),
          );
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

      const clock = args.clock ?? (() => new Date());
      const sessionLog = openSessionLog(runId, formatSessionLogTimestamp(clock()), {
        ...(args.sessionsDir !== undefined ? { sessionsDir: args.sessionsDir } : {}),
        clock,
      });
      sessionLog.append("harness", `run=${runId} spec=${args.specPath} iteration=${iterationsConsumed + 1}`);

      const settled = await awaitIteration(args, runId, attemptId, sessionLog);
      if (settled.kind === "aborted") {
        closeSessionLog(sessionLog, "abort");
        return finishLoop(args, runId, "progress", iterationsConsumed + 1, true);
      }
      if (settled.kind === "timed_out") {
        closeSessionLog(sessionLog, "timeout");
        return finishIterationTimeout(args, store, runId, attemptId, iterationsConsumed + 1);
      }
      if (settled.kind === "threw") {
        if (args.signal?.aborted) {
          closeSessionLog(sessionLog, "abort");
          return finishLoop(args, runId, "progress", iterationsConsumed, true);
        }
        closeSessionLog(sessionLog, "error");
        return finishExecuteWriteThrow(args, store, runId, attemptId, iterationsConsumed + 1, settled.error);
      }
      closeSessionLog(sessionLog, "completed");
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
          responseText: truncateLogText(responseText),
        });
      }

      if (result.blockerReprompt !== undefined) {
        args.logSink?.append(runId, {
          kind: "blocker_reprompt",
          attemptId,
          responseText: truncateLogText(result.blockerReprompt.responseText),
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
        const targetSpecPath =
          result.failedContractId === "spec.criteria-ticked"
            ? resolveSpecPath(worktreePath, args.expectedArtifactPath)
            : resolveSpecPath(worktreePath, args.specPath);
        appendBlockerToSpec(targetSpecPath, reason);
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
        args.logSink?.append(runId, {
          kind: "invalid_token_detail",
          attemptId,
          tokenText: truncateLogText(result.tokenText),
        });
      }
      if (result.kind === "missing_blocker") {
        args.logSink?.append(runId, {
          kind: "missing_blocker_detail",
          attemptId,
          responseText: truncateLogText(result.responseText),
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
        result.kind === "invalid_token" || result.kind === "missing_blocker",
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
          const creationTitle = resolveAndPersistCreationTitle(
            store,
            runId,
            worktreePath,
            args.specPath,
            prepared.creationTitle,
          );
          const publication = await publishWithReadyRepair(args, store, attributed, iterationsConsumed, {
            worktreePath,
            baseRef: args.worktree.baseRef,
            specPath: args.specPath,
            branch: args.worktree.branchName,
            creationTitle,
            ...(args.promptId === "patch.prompt.body" || args.promptId === "plan.prompt.draft"
              ? { specTemplate: true }
              : {}),
          });
          if (publication.failure !== undefined) {
            const publishedResult = { ...attributed, iterationsConsumed: publication.iterationsConsumed };
            return publication.failure.kind === "completion_commit_failed"
              ? completionCommitFailed(args, publishedResult, publication.failure.error)
              : readyFailed(args, publishedResult, publication.failure.kind, publication.failure.error);
          }
        }
        if (published.commitSha === undefined) {
          const uncommitted = await getUncommittedPaths(worktreePath);
          if (uncommitted.length > 0) {
            return completionCommitFailed(
              args,
              attributed,
              new Error(`Uncommitted changes: ${uncommitted.join(", ")}`),
            );
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
      } catch (error) {
        return completionCommitFailed(args, attributed, error instanceof Error ? error : new Error(String(error)));
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
function awaitIteration(
  args: WriteLoopInput,
  runId: string,
  attemptId: string,
  sessionLog: SessionLog,
): Promise<IterationSettlement> {
  const executionController = new AbortController();
  let activeAgentInvocations = 0;
  const abortExecution = () => executionController.abort();
  if (args.signal?.aborted) abortExecution();
  args.signal?.addEventListener("abort", abortExecution, { once: true });
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const execution = executeWrite(
    buildWriteExecuteInput(args, runId, attemptId, executionController.signal, sessionLog, {
      started: () => {
        activeAgentInvocations += 1;
      },
      settled: () => {
        activeAgentInvocations -= 1;
      },
    }),
  ).then(
    (result): IterationSettlement => ({ kind: "settled", result }),
    (error): IterationSettlement => ({ kind: "threw", error }),
  );
  void execution.then(() => {
    if (stallTimer !== undefined) clearTimeout(stallTimer);
  });
  stallTimer = setTimeout(() => {
    if (activeAgentInvocations === 0) args.onAttemptStalled?.(runId, attemptId);
  }, 0);
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

  if (existingRun === null || args.freshDispatch === true) {
    const creationTitle = args.creationTitle;
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

function resolveAndPersistCreationTitle(
  store: StateStore,
  runId: string,
  worktreePath: string,
  specPath: string,
  existingTitle?: string,
): string {
  const title = resolvePublicationTitle(worktreePath, specPath, existingTitle);
  if (existingTitle === undefined) store.setCreationTitle(runId, title);
  return title;
}

function buildWriteExecuteInput(
  args: WriteLoopInput,
  runId: string,
  attemptId: string,
  signal: AbortSignal,
  sessionLog: SessionLog,
  agentInvocation: { started: () => void; settled: () => void },
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
    bindings: args.bindings.map((binding) => ({
      ...binding,
      invoke: async (input) => {
        agentInvocation.started();
        try {
          return await binding.invoke(input);
        } finally {
          agentInvocation.settled();
        }
      },
    })),
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
    sessionLog,
    ...(args.withExternalWorktree && { withExternalWorktree: args.withExternalWorktree }),
  };
}

type SessionLogSettleOutcome = "completed" | "timeout" | "abort" | "error";

function formatSessionLogTimestamp(date: Date): string {
  return date.toISOString().replace(/:/g, "-");
}

function closeSessionLog(sessionLog: SessionLog, outcome: SessionLogSettleOutcome): void {
  sessionLog.append("harness", `outcome=${outcome}`);
  sessionLog.close();
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
  if (result.kind === "missing_blocker") {
    return { kind: "invocation_failure", runStatus: "paused", outcomeKind: "missing_blocker" };
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
  kind: "completion_commit_failed" | "ready_gate_failed" | "ready_flip_failed";
  error?: Error;
};

type CompletionPublishInput = Parameters<typeof publishCompletionArtifacts>[1];

/** `unsettled` consumed no iteration; `blocked` and `continue` each consumed one. */
type ReadyRepairIterationOutcome = "unsettled" | "blocked" | "continue";

/** One repair iteration: reprompt the agent with the gate failure, then record its boundary. */
async function runReadyRepairIteration(
  args: WriteLoopInput,
  store: StateStore,
  result: WriteLoopResult,
  gateError: ReadyGateError,
  iterationNumber: number,
): Promise<ReadyRepairIterationOutcome> {
  const attemptId = store.recordAttemptStart(result.runId);
  args.logSink?.append(result.runId, { kind: "iteration_started", attemptId });
  const clock = args.clock ?? (() => new Date());
  const sessionLog = openSessionLog(result.runId, formatSessionLogTimestamp(clock()), {
    ...(args.sessionsDir !== undefined ? { sessionsDir: args.sessionsDir } : {}),
    clock,
  });
  sessionLog.append("harness", `run=${result.runId} spec=${args.specPath} iteration=${iterationNumber}`);

  const repairArgs: WriteLoopInput = {
    ...args,
    promptId: "write.ready-repair",
    promptPlaceholders: {
      GATE_COMMAND: gateError.command,
      GATE_EXIT_CODE: String(gateError.exitCode ?? "unknown"),
      GATE_OUTPUT: gateError.output.slice(-READY_GATE_OUTPUT_MAX_CHARS),
    },
  };
  const settled = await awaitIteration(repairArgs, result.runId, attemptId, sessionLog);
  if (settled.kind !== "settled") {
    closeSessionLog(
      sessionLog,
      settled.kind === "timed_out" ? "timeout" : settled.kind === "aborted" ? "abort" : "error",
    );
    return "unsettled";
  }
  closeSessionLog(sessionLog, "completed");

  const stepResult = settled.result.result;
  const terminal = stepResult.kind === "progress" ? undefined : terminalMapping(stepResult);
  const boundary = terminal ?? { runStatus: "in-progress" as const, outcomeKind: "progress" as const };
  store.commitCompletionBoundary({
    attemptId,
    runStatus: boundary.runStatus,
    outcomeKind: boundary.outcomeKind,
  });
  args.logSink?.append(result.runId, {
    kind: "boundary_committed",
    attemptId,
    outcomeKind: boundary.outcomeKind,
    runStatus: boundary.runStatus,
  });
  return stepResult.kind === "blocked" ? "blocked" : "continue";
}

async function publishWithReadyRepair(
  args: WriteLoopInput,
  store: StateStore,
  result: WriteLoopResult,
  iterationsConsumed: number,
  input: CompletionPublishInput,
): Promise<{ failure?: CompletionPublishFailure; iterationsConsumed: number }> {
  let failure = await publishCompletionArtifacts(args, input);
  let repairAttempt = 0;
  while (failure?.kind === "ready_gate_failed" && failure.error instanceof ReadyGateError) {
    repairAttempt += 1;
    if (repairAttempt > MAX_READY_GATE_REPAIRS) return { failure, iterationsConsumed };
    if (iterationsConsumed >= (args.maxIterations ?? DEFAULT_MAX_ITERATIONS)) return { failure, iterationsConsumed };
    args.logSink?.append(result.runId, {
      kind: "ready_gate_repair",
      attempt: repairAttempt,
      gateExitCode: failure.error.exitCode,
    });

    const outcome = await runReadyRepairIteration(args, store, result, failure.error, iterationsConsumed + 1);
    if (outcome === "unsettled") return { failure, iterationsConsumed };
    iterationsConsumed += 1;
    if (outcome === "blocked") return { failure, iterationsConsumed };
    try {
      await (args.completionCommitter ?? createCompletionCommitter())({
        worktreePath: input.worktreePath,
        baseRef: input.baseRef,
        specPath: input.specPath,
        agent: result.completionAgent ?? "",
      });
      failure = await publishCompletionArtifacts(args, input);
    } catch (error) {
      return {
        failure: { kind: "completion_commit_failed", error: error instanceof Error ? error : new Error(String(error)) },
        iterationsConsumed,
      };
    }
    if (failure === undefined) return { iterationsConsumed };
  }
  return { ...(failure !== undefined ? { failure } : {}), iterationsConsumed };
}

export async function publishCompletionArtifacts(
  seams: CompletionPublicationSeams,
  input: {
    worktreePath: string;
    baseRef: string;
    specPath: string;
    branch: string;
    creationTitle?: unknown;
    bodySummary?: string;
    specTemplate?: boolean;
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
    return { kind: err instanceof ReadyGateError ? "ready_gate_failed" : "ready_flip_failed", error: err };
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

function readyFailed(
  args: WriteLoopInput,
  result: WriteLoopResult,
  kind: "ready_gate_failed" | "ready_flip_failed",
  error?: Error,
): WriteLoopResult {
  args.logSink?.append(result.runId, {
    kind: "loop_finished",
    loopOutcomeKind: kind,
    iterationsConsumed: result.iterationsConsumed,
    resumable: true,
  });
  return {
    ...result,
    kind,
    resumable: true,
    ...(kind === "ready_gate_failed"
      ? { readyGateError: error?.message ?? "ready gate failed" }
      : { readyFlipError: error?.message ?? "ready flip failed" }),
  };
}

function resolveSpecPath(worktreePath: string, specPath: string): string {
  return isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
}

function appendBlockerToSpec(specPath: string, reason: string): void {
  appendFileSync(specPath, `\n## Blocker\n\nArtifact contract check failed: ${reason}\n`, "utf8");
}
