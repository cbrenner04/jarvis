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
import { verifyDiffDerivedMutations } from "./diff-derived-mutation-verifier.ts";
import { getExternalWorktreePath } from "./external-worktree.ts";
import type { InvocationFailureDetail } from "./invocation-failure.ts";
import { type PublicationFailure, publicationFailureFor } from "./publication-retry.ts";
import {
  createReadyFinalizer,
  type ReadyFinalizer,
  ReadyGateError,
  RuntimeSmokeFailedError,
  SurvivingMutationError,
  survivingMutationLogFields,
} from "./ready-finalize.ts";
import { verifyRuntimeSmoke } from "./runtime-smoke-verifier.ts";
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
  "surviving_mutation_failed",
  "runtime_smoke_failed",
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
  readyFlipPrNumber?: number;
  publicationFailure?: PublicationFailure;
  attemptId?: string;
  outcomeKind?: OutcomeKind;
  runStatus?: RunStatus;
  boundaryTelemetryFailure?: string;
  prNumber?: number;
  prUrl?: string;
  survivingMutation?: string;
  survivingMutationSourceFile?: string;
  survivingMutationSourceLine?: number;
  runtimeSmokeCommand?: string;
  runtimeSmokeObservation?: string;
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
  sessionsDir?: string;
  clock?: () => Date;
  /** When set, suppresses reuse of completed runs from prior invocations. */
  freshDispatch?: boolean;
  /** Required integration test scope (e.g., "test:integration:v2") from active subspec. */
  requiredIntegrationScope?: string;
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

/** `git status --porcelain` paths; fail-soft to [] — diagnostic listing only. */
export async function getUncommittedPaths(worktreePath: string): Promise<string[]> {
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
          const worktreePath = getExternalWorktreePath(args.worktree);
          const creationTitle = resolveAndPersistCreationTitle(
            store,
            prepared.result.runId,
            worktreePath,
            args.specPath,
            prepared.creationTitle,
          );
          const published = await (args.completionCommitter ?? createCompletionCommitter())({
            worktreePath,
            baseRef: args.worktree.baseRef,
            specPath: args.specPath,
            agent: prepared.result.completionAgent ?? "",
            title: creationTitle,
          });
          if (published.commitSha !== undefined) {
            store.setRunStatus(prepared.result.runId, "in-progress");
            const publication = await publishWithReadyRepair(args, store, prepared.result, 0, {
              worktreePath: getExternalWorktreePath(args.worktree),
              baseRef: args.worktree.baseRef,
              specPath: args.specPath,
              branch: args.worktree.branchName,
              creationTitle,
              ...(args.requiredIntegrationScope ? { requiredIntegrationScope: args.requiredIntegrationScope } : {}),
            });
            if (publication.failure !== undefined) {
              const publishedResult = {
                ...prepared.result,
                iterationsConsumed: publication.iterationsConsumed,
                ...(publication.failure.prNumber !== undefined ? { prNumber: publication.failure.prNumber } : {}),
                ...(publication.failure.prUrl !== undefined ? { prUrl: publication.failure.prUrl } : {}),
              };
              return publication.failure.kind === "completion_commit_failed"
                ? completionCommitFailed(args, store, publishedResult, publication.failure.error)
                : readyFailed(args, store, publishedResult, publication.failure.kind, publication.failure.error);
            }
            store.setRunStatus(prepared.result.runId, "completed");
            if (
              publication.success !== undefined &&
              publication.success.prNumber !== undefined &&
              publication.success.prUrl !== undefined
            ) {
              store.setPrEvidence(prepared.result.runId, publication.success.prNumber, publication.success.prUrl);
              prepared.result.prNumber = publication.success.prNumber;
              prepared.result.prUrl = publication.success.prUrl;
            }
          }
          if (published.commitSha === undefined) {
            const uncommitted = await getUncommittedPaths(getExternalWorktreePath(args.worktree));
            if (uncommitted.length > 0) {
              return completionCommitFailed(
                args,
                store,
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
            ...(prepared.result.prNumber !== undefined ? { prNumber: prepared.result.prNumber } : {}),
            ...(prepared.result.prUrl !== undefined ? { prUrl: prepared.result.prUrl } : {}),
          });
          if (published.commitSha === undefined) {
            return prepared.result;
          }
          return withBoundaryTelemetry(args, prepared.result, published.commitSha, published.filesChanged);
        } catch (error) {
          return completionCommitFailed(
            args,
            store,
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
      if (result.kind === "blocked" && result.blockerText !== undefined) {
        args.logSink?.append(runId, {
          kind: "blocker_text_detail",
          attemptId,
          blockerText: truncateLogText(result.blockerText),
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
      if (!agent) return completionCommitFailed(args, store, attributed);
      try {
        const creationTitle = resolveAndPersistCreationTitle(
          store,
          runId,
          worktreePath,
          args.specPath,
          prepared.creationTitle,
        );
        const published = await (args.completionCommitter ?? createCompletionCommitter())({
          worktreePath,
          baseRef: args.worktree.baseRef,
          specPath: args.specPath,
          agent,
          title: creationTitle,
        });
        if (published.commitSha !== undefined) {
          store.setRunStatus(runId, "in-progress");
          const publication = await publishWithReadyRepair(args, store, attributed, iterationsConsumed, {
            worktreePath,
            baseRef: args.worktree.baseRef,
            specPath: args.specPath,
            branch: args.worktree.branchName,
            creationTitle,
            ...(args.promptId === "patch.prompt.body" || args.promptId === "plan.prompt.draft"
              ? { specTemplate: true }
              : {}),
            ...(args.requiredIntegrationScope ? { requiredIntegrationScope: args.requiredIntegrationScope } : {}),
          });
          if (publication.failure !== undefined) {
            const publishedResult = {
              ...attributed,
              iterationsConsumed: publication.iterationsConsumed,
              ...(publication.failure.prNumber !== undefined ? { prNumber: publication.failure.prNumber } : {}),
              ...(publication.failure.prUrl !== undefined ? { prUrl: publication.failure.prUrl } : {}),
            };
            return publication.failure.kind === "completion_commit_failed"
              ? completionCommitFailed(args, store, publishedResult, publication.failure.error)
              : readyFailed(args, store, publishedResult, publication.failure.kind, publication.failure.error);
          }
          store.setRunStatus(runId, "completed");
          if (
            publication.success !== undefined &&
            publication.success.prNumber !== undefined &&
            publication.success.prUrl !== undefined
          ) {
            store.setPrEvidence(runId, publication.success.prNumber, publication.success.prUrl);
            attributed.prNumber = publication.success.prNumber;
            attributed.prUrl = publication.success.prUrl;
          }
        }
        if (published.commitSha === undefined) {
          const uncommitted = await getUncommittedPaths(worktreePath);
          if (uncommitted.length > 0) {
            return completionCommitFailed(
              args,
              store,
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
          ...(attributed.prNumber !== undefined ? { prNumber: attributed.prNumber } : {}),
          ...(attributed.prUrl !== undefined ? { prUrl: attributed.prUrl } : {}),
        });
        if (published.commitSha === undefined) {
          return attributed;
        }
        return withBoundaryTelemetry(args, attributed, published.commitSha, published.filesChanged);
      } catch (error) {
        return completionCommitFailed(
          args,
          store,
          attributed,
          error instanceof Error ? error : new Error(String(error)),
        );
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
  const abortExecution = () => executionController.abort();
  if (args.signal?.aborted) abortExecution();
  args.signal?.addEventListener("abort", abortExecution, { once: true });
  const execution = executeWrite(
    buildWriteExecuteInput(args, runId, attemptId, executionController.signal, sessionLog),
  ).then(
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
      ...(run.prNumber !== undefined && run.prNumber !== null ? { prNumber: run.prNumber } : {}),
      ...(run.prUrl !== undefined && run.prUrl !== null ? { prUrl: run.prUrl } : {}),
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
  kind:
    | "completion_commit_failed"
    | "ready_gate_failed"
    | "ready_flip_failed"
    | "surviving_mutation_failed"
    | "runtime_smoke_failed";
  error?: Error;
  prNumber?: number;
  prUrl?: string;
};

export type CompletionPublishSuccess = {
  prNumber?: number;
  prUrl?: string;
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

export async function publishWithReadyRepair(
  args: WriteLoopInput,
  store: StateStore,
  result: WriteLoopResult,
  iterationsConsumed: number,
  input: CompletionPublishInput,
): Promise<{ failure?: CompletionPublishFailure; success?: CompletionPublishSuccess; iterationsConsumed: number }> {
  let outcome = await publishCompletionArtifacts(args, input);
  let repairAttempt = 0;
  while (outcome.kind === "ready_gate_failed" && outcome.error instanceof ReadyGateError) {
    repairAttempt += 1;
    if (repairAttempt > MAX_READY_GATE_REPAIRS) break;
    if (iterationsConsumed >= (args.maxIterations ?? DEFAULT_MAX_ITERATIONS)) break;
    args.logSink?.append(result.runId, {
      kind: "ready_gate_repair",
      attempt: repairAttempt,
      gateExitCode: outcome.error.exitCode,
    });

    const repairOutcome = await runReadyRepairIteration(args, store, result, outcome.error, iterationsConsumed + 1);
    if (repairOutcome === "unsettled") return { failure: outcome, iterationsConsumed };
    iterationsConsumed += 1;
    if (repairOutcome === "blocked") return { failure: outcome, iterationsConsumed };
    try {
      await (args.completionCommitter ?? createCompletionCommitter())({
        worktreePath: input.worktreePath,
        baseRef: input.baseRef,
        specPath: input.specPath,
        agent: result.completionAgent ?? "",
        title: resolvePublicationTitle(input.worktreePath, input.specPath, input.creationTitle),
      });
      outcome = await publishCompletionArtifacts(args, input);
    } catch (error) {
      return {
        failure: { kind: "completion_commit_failed", error: error instanceof Error ? error : new Error(String(error)) },
        iterationsConsumed,
      };
    }
  }
  return outcome.kind === "success"
    ? { success: outcome, iterationsConsumed }
    : { failure: outcome, iterationsConsumed };
}

async function runPublisher(
  seams: CompletionPublicationSeams,
  input: {
    worktreePath: string;
    baseRef: string;
    specPath: string;
    branch: string;
    creationTitle?: unknown;
    bodySummary?: string;
    specTemplate?: boolean;
    requiredIntegrationScope?: string;
  },
): Promise<Awaited<ReturnType<CompletionPublisher>> | undefined> {
  return await (seams.completionPublisher ?? createCompletionPublisher())(input);
}

async function runReadyFinalizer(
  seams: CompletionPublicationSeams,
  input: { worktreePath: string; baseRef: string; branch: string; requiredIntegrationScope?: string },
): Promise<void> {
  const readyFinalizer =
    seams.readyFinalizer ??
    createReadyFinalizer({
      runMutationVerification: async (worktreePath: string, baseRef: string) => {
        const verificationResult = await verifyDiffDerivedMutations({
          worktreePath,
          runBase: baseRef,
        });
        if (verificationResult.kind === "surviving-mutation") {
          throw new SurvivingMutationError(
            verificationResult.mutation,
            verificationResult.sourceSite.file,
            verificationResult.sourceSite.line,
          );
        }
      },
      runRuntimeSmokeVerification: async (worktreePath: string, baseRef: string) => {
        const verificationResult = await verifyRuntimeSmoke({
          worktreePath,
          runBase: baseRef,
        });
        if (verificationResult.kind === "smoke-failure") {
          throw new RuntimeSmokeFailedError(verificationResult.command, verificationResult.observation);
        }
      },
    });
  const finalInput = {
    worktreePath: input.worktreePath,
    branch: input.branch,
    baseRef: input.baseRef,
    ...(input.requiredIntegrationScope ? { requiredIntegrationScope: input.requiredIntegrationScope } : {}),
  };
  await readyFinalizer(finalInput);
}

function buildFinalizationErrorResponse(
  err: Error,
  prNumber: number | undefined,
  prUrl: string | undefined,
): CompletionPublishFailure {
  if (err instanceof SurvivingMutationError) {
    return {
      kind: "surviving_mutation_failed",
      error: err,
      ...(prNumber !== undefined ? { prNumber } : {}),
      ...(prUrl !== undefined ? { prUrl } : {}),
    };
  }
  if (err instanceof RuntimeSmokeFailedError) {
    return {
      kind: "runtime_smoke_failed",
      error: err,
      ...(prNumber !== undefined ? { prNumber } : {}),
      ...(prUrl !== undefined ? { prUrl } : {}),
    };
  }
  return {
    kind: err instanceof ReadyGateError ? "ready_gate_failed" : "ready_flip_failed",
    error: err,
    ...(prNumber !== undefined ? { prNumber } : {}),
    ...(prUrl !== undefined ? { prUrl } : {}),
  };
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
    requiredIntegrationScope?: string;
  },
): Promise<CompletionPublishFailure | (CompletionPublishSuccess & { kind: "success" })> {
  let publisherResult: Awaited<ReturnType<CompletionPublisher>> | undefined;
  try {
    publisherResult = await runPublisher(seams, input);
  } catch (publishError) {
    const err = publishError instanceof Error ? publishError : new Error(String(publishError));
    return { kind: "completion_commit_failed", error: err };
  }
  if (publisherResult?.pushSha !== undefined && publisherResult?.prNumber === undefined) {
    const err = new Error("Pushed completion without PR evidence is a publication failure");
    return {
      kind: "completion_commit_failed",
      error: err,
    };
  }
  try {
    await runReadyFinalizer(seams, {
      worktreePath: input.worktreePath,
      baseRef: input.baseRef,
      branch: input.branch,
      ...(input.requiredIntegrationScope ? { requiredIntegrationScope: input.requiredIntegrationScope } : {}),
    });
  } catch (finalizeError) {
    const err = finalizeError instanceof Error ? finalizeError : new Error(String(finalizeError));
    return buildFinalizationErrorResponse(err, publisherResult?.prNumber, publisherResult?.prUrl);
  }
  return {
    kind: "success",
    ...(publisherResult?.prNumber !== undefined ? { prNumber: publisherResult.prNumber } : {}),
    ...(publisherResult?.prUrl !== undefined ? { prUrl: publisherResult.prUrl } : {}),
  };
}

function completionCommitFailed(
  args: WriteLoopInput,
  store: StateStore,
  result: WriteLoopResult,
  error?: Error,
): WriteLoopResult {
  store.setRunStatus(result.runId, "completed");
  const publicationFailure = error === undefined ? undefined : publicationFailureFor(error);
  args.logSink?.append(result.runId, {
    kind: "loop_finished",
    loopOutcomeKind: "completion_commit_failed",
    iterationsConsumed: result.iterationsConsumed,
    resumable: true,
    ...(publicationFailure !== undefined ? { publicationFailure } : {}),
    ...(result.prNumber !== undefined ? { prNumber: result.prNumber } : {}),
    ...(result.prUrl !== undefined ? { prUrl: result.prUrl } : {}),
  });
  return {
    ...result,
    kind: "completion_commit_failed",
    resumable: true,
    completionCommitError: error?.message ?? "completion commit failed",
    ...(publicationFailure !== undefined ? { publicationFailure } : {}),
  };
}

function readyFailed(
  args: WriteLoopInput,
  store: StateStore,
  result: WriteLoopResult,
  kind: "ready_gate_failed" | "ready_flip_failed" | "surviving_mutation_failed" | "runtime_smoke_failed",
  error?: Error,
): WriteLoopResult {
  const publicationFailure = error === undefined ? undefined : publicationFailureFor(error);
  const resumable = kind === "ready_gate_failed" || kind === "surviving_mutation_failed";
  const mutationFields = survivingMutationLogFields(error);
  if (kind === "surviving_mutation_failed" || kind === "ready_gate_failed") {
    store.setRunStatus(result.runId, "failed");
  }
  args.logSink?.append(result.runId, {
    kind: "loop_finished",
    loopOutcomeKind: kind,
    iterationsConsumed: result.iterationsConsumed,
    resumable,
    ...mutationFields,
    ...(publicationFailure !== undefined ? { publicationFailure } : {}),
    ...(result.prNumber !== undefined ? { prNumber: result.prNumber } : {}),
    ...(result.prUrl !== undefined ? { prUrl: result.prUrl } : {}),
  });

  const smokeDetails =
    error instanceof RuntimeSmokeFailedError
      ? {
          runtimeSmokeCommand: error.command,
          runtimeSmokeObservation: error.observation,
        }
      : {};

  return {
    ...result,
    kind,
    resumable,
    ...(kind === "ready_gate_failed"
      ? { readyGateError: error?.message ?? "ready gate failed" }
      : kind === "ready_flip_failed"
        ? {
            readyFlipError: error?.message ?? "ready flip failed",
            ...(result.prNumber !== undefined ? { readyFlipPrNumber: result.prNumber } : {}),
          }
        : {}),
    ...mutationFields,
    ...smokeDetails,
    ...(publicationFailure !== undefined ? { publicationFailure } : {}),
  };
}

function resolveSpecPath(worktreePath: string, specPath: string): string {
  return isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
}

function appendBlockerToSpec(specPath: string, reason: string): void {
  appendFileSync(specPath, `\n## Blocker\n\nArtifact contract check failed: ${reason}\n`, "utf8");
}
